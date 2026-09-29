import type { Address } from 'viem'
import { Account } from 'viem/tempo'
import { env, tiers } from './config'
import { lineBookWrite, registryWrite, remainingLimit, tokenBalance, treasury } from './chain'
import { audit, sql } from './db'
import { freezeLine, moveOnce, setSpendLimit } from './lines'
import { open } from './vault'

/**
 * Line economics (pilot, 0% fee):
 *   - The credit account is funded to `credit_limit`. Its balance IS the available credit, so exposure
 *     can never exceed the limit regardless of the spend key's periodic allowance.
 *   - owed = credit_limit - balance(creditAccount)
 *   - Each period a statement is cut: amount_due = owed. The mandate pulls min(due, mandate remaining,
 *     income balance) to the treasury, and the treasury tops the credit account back up by the same amount.
 *   - Short -> grace. Grace expired -> guarantor pull (capped by the guarantee key) -> otherwise default.
 */

const lower = (a: string) => a.toLowerCase() as Address
const now = () => new Date()

async function repayFromBorrower(row: any, amount: bigint, seq: number) {
  const borrower = row.borrower_wallet as Address
  const [bal, lim] = await Promise.all([tokenBalance(borrower), remainingLimit(borrower, row.repay_key_id)])
  let pull = amount
  if (lim.remaining < pull) pull = lim.remaining
  if (bal < pull) pull = bal
  if (pull <= 0n) return { pulled: 0n, reason: bal === 0n ? 'no balance' : 'mandate limit used this period' }
  const repayKey = Account.fromSecp256k1(open(row.repay_key_enc), { access: borrower })
  const r = await moveOnce({ lineId: Number(row.id), kind: 'INST', seq, from: repayKey, to: treasury.address, amount: pull, memoKind: 'INST' })
  if (r.status !== 'confirmed') return { pulled: 0n, reason: r.error ?? 'pull failed' }
  return { pulled: pull, txHash: r.txHash! }
}

async function topUp(row: any, amount: bigint, seq: number) {
  if (amount <= 0n) return
  const r = await moveOnce({ lineId: Number(row.id), kind: 'TOPUP', seq, from: treasury, to: row.credit_account, amount, memoKind: 'FUND' })
  if (r.status !== 'confirmed') throw new Error(`top-up failed: ${r.error}`)
}

async function maybeUpgrade(row: any, onTimeCount: number) {
  if (onTimeCount === 0 || onTimeCount % env.ON_TIME_TO_UPGRADE !== 0) return
  const current = BigInt(row.credit_limit)
  const next = tiers.find((t) => t > current)
  if (!next || next > BigInt(row.mandate_cap)) return
  await topUp(row, next - current, 500_000 + onTimeCount)
  await setSpendLimit(row, next)
  await lineBookWrite('recordLimitChange', [BigInt(row.linebook_id), next])
  await sql`UPDATE lines SET credit_limit=${next.toString()}, updated_at=now() WHERE id=${row.id}`
  await audit({ lineId: row.id, actor: 'servicer', action: 'line.limit_raised', detail: { from: current, to: next } })
}

/** Statement date reached for an active line. */
async function runStatement(row: any) {
  const limit = BigInt(row.credit_limit)
  const available = await tokenBalance(row.credit_account)
  const owed = limit > available ? limit - available : 0n
  const seq = row.statement_seq + 1
  const nextDue = new Date(new Date(row.next_due).getTime() + row.period_seconds * 1000)

  if (owed === 0n) {
    await sql`UPDATE lines SET statement_seq=${seq}, amount_due=0, next_due=${nextDue}, updated_at=now() WHERE id=${row.id}`
    return
  }
  const r = await repayFromBorrower(row, owed, seq)
  if (r.pulled > 0n) await topUp(row, r.pulled, seq)
  const remaining = owed - r.pulled

  if (remaining === 0n) {
    const onTime = row.on_time_count + 1
    await lineBookWrite('recordRepayment', [BigInt(row.linebook_id), r.txHash!, r.pulled, true])
    await sql`UPDATE lines SET statement_seq=${seq}, amount_due=0, on_time_count=${onTime}, next_due=${nextDue}, updated_at=now() WHERE id=${row.id}`
    await audit({ lineId: row.id, actor: 'servicer', action: 'repaid.on_time', detail: { amount: r.pulled, seq }, txHash: r.txHash })
    const [fresh] = await sql`SELECT * FROM lines WHERE id=${row.id}`
    await maybeUpgrade(fresh, onTime)
    return
  }
  if (r.pulled > 0n) await lineBookWrite('recordRepayment', [BigInt(row.linebook_id), r.txHash!, r.pulled, false])
  await lineBookWrite('recordMissed', [BigInt(row.linebook_id)])
  const graceUntil = new Date(Date.now() + env.GRACE_SECONDS * 1000)
  await sql`
    UPDATE lines SET status='grace', statement_seq=${seq}, amount_due=${remaining.toString()}, grace_until=${graceUntil},
      missed_count=missed_count+1, next_due=${nextDue}, updated_at=now() WHERE id=${row.id}`
  await audit({ lineId: row.id, actor: 'servicer', action: 'repayment.short', detail: { owed, pulled: r.pulled, remaining, reason: r.reason } })
}

/** Line in grace: retry borrower; when grace ends, call the guarantee; otherwise default. */
async function runGrace(row: any) {
  let due = BigInt(row.amount_due)
  const seq = 10_000 + row.statement_seq * 100 + Math.floor((Date.now() / 1000) % 100) // unique retry memos
  const r = await repayFromBorrower(row, due, seq)
  if (r.pulled > 0n) {
    await topUp(row, r.pulled, seq)
    await lineBookWrite('recordRepayment', [BigInt(row.linebook_id), r.txHash!, r.pulled, false])
    due -= r.pulled
    await sql`UPDATE lines SET amount_due=${due.toString()}, updated_at=now() WHERE id=${row.id}`
  }
  if (due === 0n) {
    await sql`UPDATE lines SET status='active', grace_until=NULL, updated_at=now() WHERE id=${row.id}`
    await audit({ lineId: row.id, actor: 'servicer', action: 'grace.cured' })
    return
  }
  if (new Date(row.grace_until) > now()) return

  // grace over: guarantor
  if (row.guarantor_wallet && row.guar_key_id && BigInt(row.guaranteed) > 0n) {
    const g = row.guarantor_wallet as Address
    const [bal, lim] = await Promise.all([tokenBalance(g), remainingLimit(g, row.guar_key_id)])
    let pull = due
    for (const cap of [BigInt(row.guaranteed), lim.remaining, bal]) if (cap < pull) pull = cap
    if (pull > 0n) {
      const guarKey = Account.fromSecp256k1(open(row.guar_key_enc), { access: g })
      const m = await moveOnce({ lineId: Number(row.id), kind: 'GUAR', seq: row.statement_seq, from: guarKey, to: treasury.address, amount: pull, memoKind: 'GUAR' })
      if (m.status === 'confirmed') {
        await lineBookWrite('recordGuarantorPull', [BigInt(row.linebook_id), m.txHash!, pull])
        due -= pull
        await sql`UPDATE lines SET amount_due=${due.toString()}, guaranteed=guaranteed-${pull.toString()}, updated_at=now() WHERE id=${row.id}`
        await audit({ lineId: row.id, actor: 'servicer', action: 'guarantor.pulled', detail: { amount: pull }, txHash: m.txHash })
      }
    }
  }

  const [fresh] = await sql`SELECT * FROM lines WHERE id=${row.id}`
  if (due === 0n) {
    // covered by family: borrower's own card stays frozen until they settle with KEYCARD support
    await freezeLine(fresh, 'MissedPayment')
    return
  }
  // default
  await setSpendLimit(fresh, 0n)
  await lineBookWrite('recordDefault', [BigInt(fresh.linebook_id)])
  try {
    await registryWrite('revokeAttestation', [fresh.borrower_wallet])
  } catch (e) {
    console.error('revokeAttestation failed', e)
  }
  // sweep unused credit back to treasury
  const left = await tokenBalance(fresh.credit_account)
  if (left > 0n) {
    const creditRoot = Account.fromSecp256k1(open(fresh.credit_root_enc))
    await moveOnce({ lineId: Number(fresh.id), kind: 'TOPUP', seq: 900_000, from: creditRoot, to: treasury.address, amount: left, memoKind: 'REFUND' })
  }
  await sql`UPDATE lines SET status='defaulted', updated_at=now() WHERE id=${fresh.id}`
  await audit({ lineId: fresh.id, actor: 'servicer', action: 'line.defaulted', detail: { unpaid: due } })
}

let running = false
export async function tick() {
  if (running) return
  running = true
  try {
    const due = await sql`SELECT * FROM lines WHERE status='active' AND next_due <= now() ORDER BY next_due LIMIT 50`
    for (const row of due) {
      try {
        await runStatement(row)
      } catch (e) {
        console.error('statement failed', row.id, e)
        await audit({ lineId: row.id, actor: 'servicer', action: 'statement.error', detail: { error: String(e) } })
      }
    }
    const grace = await sql`SELECT * FROM lines WHERE status='grace' ORDER BY grace_until LIMIT 50`
    for (const row of grace) {
      try {
        await runGrace(row)
      } catch (e) {
        console.error('grace failed', row.id, e)
        await audit({ lineId: row.id, actor: 'servicer', action: 'grace.error', detail: { error: String(e) } })
      }
    }
  } finally {
    running = false
  }
}

export function startScheduler(intervalMs = 20_000) {
  const t = setInterval(() => void tick(), intervalMs)
  void tick()
  return () => clearInterval(t)
}

export const _internal = { lower }
