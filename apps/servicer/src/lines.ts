import { parseEventLogs, type Address, type Hex } from 'viem'
import { generatePrivateKey } from 'viem/accounts'
import { Abis, Account, Actions } from 'viem/tempo'
import { PublicKey } from 'ox'
import {
  BORROWER_FLAGS,
  FreezeReason,
  encodeMemo,
  lineBookAbi,
  mandateKeyPolicy,
  spendKeyPolicy,
} from '@keycard/sdk'
import { env, net, tiers } from './config'
import {
  clientFor,
  findMemoTransfer,
  getKey,
  lineBookRead,
  lineBookWrite,
  registryRead,
  remainingLimit,
  settlement,
  sponsoredTransfer,
  tokenBalance,
  treasury,
  verifyKeyPolicy,
} from './chain'
import { audit, sql } from './db'
import { open, seal } from './vault'

export class UserError extends Error {
  constructor(message: string, public status = 400) {
    super(message)
  }
}

const lower = (a: string) => a.toLowerCase() as Address
const isTransient = (e: any) => /HTTP request failed|rate limit|429|50[234]|timed? ?out|ECONNRESET|fetch failed/i.test(String(e?.details ?? e?.shortMessage ?? e?.message ?? e))

/** Run a write; on transient failure, check `done()` on-chain before retrying (never blind-resend). */
export async function resilient<T>(label: string, run: () => Promise<T>, done: () => Promise<boolean>): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    if (await done().catch(() => false)) return
    try {
      await run()
      return
    } catch (e) {
      await new Promise((r) => setTimeout(r, 800 * 2 ** attempt))
      if (await done().catch(() => false)) return
      if (!isTransient(e) || attempt >= 4) throw e
      console.warn(`[${label}] transient failure, retrying`, String((e as any)?.shortMessage ?? e))
    }
  }
}

/** keyId Tempo assigns to a WebAuthn public key acting as an access key on `parent`. */
export function webAuthnKeyId(publicKey: Hex, parent: Address): Address {
  return lower(
    (Account.from({ access: parent, keyType: 'webAuthn', publicKey: PublicKey.fromHex(publicKey), sign: async () => '0x' } as any) as any)
      .accessKeyAddress,
  )
}

/**
 * The card's allow-list is exactly ONE address: the KEYCARD settlement address. Merchants are
 * identified by the memo (KCP:<code>:<nonce>) and settled by the servicer, like a card network.
 * Any other destination is refused by the Tempo protocol.
 */
export async function activeMerchants(): Promise<Address[]> {
  return [settlement.address]
}

/** Maximum any line can ever reach; the mandate is authorised for this cap once, up front. */
export const mandateCap = () => tiers[tiers.length - 1]

// ---------------------------------------------------------------------------------------------
// 1. PREPARE: create the credit account + mandate key; return what the borrower must sign.
// ---------------------------------------------------------------------------------------------
export async function prepareLine(borrower: Address) {
  borrower = lower(borrower)
  const [user] = await sql`SELECT * FROM users WHERE wallet = ${borrower}`
  if (!user || user.role !== 'borrower') throw new UserError('register as a borrower first')

  const [unsettled] = await sql`SELECT id, amount_due FROM lines WHERE borrower_wallet=${borrower} AND status='defaulted' LIMIT 1`
  if (unsettled) throw new UserError('your previous line defaulted: settle it first (Pay now on your card page)', 403)
  const [existing] = await sql`
    SELECT * FROM lines WHERE borrower_wallet = ${borrower} AND status IN ('preparing','active','grace','frozen')`
  if (existing && existing.status !== 'preparing') throw new UserError('you already have a live line')
  const eligible = await registryRead<boolean>('isEligible', [borrower, BORROWER_FLAGS])
  if (!eligible) throw new UserError('identity not verified yet (Self)', 403)
  let row = existing
  if (!row) {
    const creditPk = generatePrivateKey()
    const repayPk = generatePrivateKey()
    const creditAccount = lower(Account.fromSecp256k1(creditPk).address)
    const repayKeyId = lower(Account.fromSecp256k1(repayPk, { access: borrower }).accessKeyAddress)
    const termEnd = new Date(Date.now() + env.TERM_DAYS * 86400_000)
    ;[row] = await sql`
      INSERT INTO lines (borrower_wallet, credit_account, credit_root_enc, repay_key_id, repay_key_enc,
                         mandate_cap, token, credit_limit, period_seconds, term_end)
      VALUES (${borrower}, ${creditAccount}, ${seal(creditPk)}, ${repayKeyId}, ${seal(repayPk)},
              ${mandateCap().toString()}, ${lower(net.token)}, ${tiers[0].toString()}, ${env.PERIOD_SECONDS}, ${termEnd})
      RETURNING *`
    await audit({ lineId: row.id, actor: 'servicer', action: 'line.prepared', detail: { creditAccount, repayKeyId } })
  }

  const expiry = Math.floor(new Date(row.term_end).getTime() / 1000)
  const policy = mandateKeyPolicy({
    token: net.token,
    instalment: BigInt(row.mandate_cap),
    period: row.period_seconds,
    repayTo: treasury.address,
    expiry,
  })
  return {
    lineId: Number(row.id),
    creditAccount: row.credit_account as Address,
    mandate: {
      keyId: row.repay_key_id as Address,
      keyType: 'secp256k1' as const,
      token: net.token,
      cap: row.mandate_cap.toString(),
      periodSeconds: row.period_seconds,
      recipient: treasury.address,
      expiry,
      policy: JSON.parse(JSON.stringify(policy, (_, v) => (typeof v === 'bigint' ? v.toString() : v))),
    },
    startingLimit: row.credit_limit.toString(),
    settlement: settlement.address,
  }
}

// ---------------------------------------------------------------------------------------------
// 2. OPEN: after the borrower's mandate is on-chain, verify it, fund the line, issue the card key.
// ---------------------------------------------------------------------------------------------
export async function openLine(borrower: Address, lineId: number) {
  borrower = lower(borrower)
  const [row] = await sql`SELECT * FROM lines WHERE id = ${lineId} AND borrower_wallet = ${borrower}`
  if (!row) throw new UserError('line not found', 404)
  if (row.status !== 'preparing') return lineView(row.id)
  const [user] = await sql`SELECT * FROM users WHERE wallet = ${borrower}`

  // (a) the mandate must be exactly what we asked for
  const v = await verifyKeyPolicy({ account: borrower, keyId: row.repay_key_id, recipients: [treasury.address] })
  if (!v.ok) throw new UserError(`mandate not valid on-chain: ${v.reason}`)
  const lim = await remainingLimit(borrower, row.repay_key_id)
  if (lim.remaining < BigInt(row.mandate_cap)) throw new UserError('mandate limit is lower than required')

  const creditRoot = Account.fromSecp256k1(open(row.credit_root_enc))
  const limit = BigInt(row.credit_limit)
  const expiry = Math.floor(new Date(row.term_end).getTime() / 1000)

  // (b) fund the credit account (idempotent by memo)
  const funded = await moveOnce({
    lineId: Number(row.id),
    kind: 'FUND',
    seq: 0,
    from: treasury,
    to: row.credit_account,
    amount: limit,
    memoKind: 'FUND',
  })
  if (funded.status !== 'confirmed') throw new UserError(`could not fund credit line: ${funded.error}`, 502)

  // (c) authorise the borrower's passkey as the spend key on the credit account
  const merchants = await activeMerchants()
  const pol = spendKeyPolicy({ token: net.token, limit, period: row.period_seconds, merchants, expiry })
  // the user's own signer (passkey or password device key) becomes the card key on the credit account
  const deviceKey = user.key_type === 'secp256k1'
  const spendKeyId = deviceKey ? lower(user.wallet) : webAuthnKeyId(user.passkey_public_key as Hex, row.credit_account)
  const accessKey = deviceKey
    ? { address: spendKeyId, type: 'secp256k1' as const }
    : { publicKey: user.passkey_public_key as Hex, type: 'webAuthn' as const }
  await resilient(
    'authorize-spend-key',
    () =>
      Actions.accessKey.authorizeSync(clientFor(creditRoot), {
        accessKey,
        ...pol,
        feePayer: treasury,
      } as any),
    async () => (await getKey(row.credit_account, spendKeyId)).exists,
  )

  // (d) public credit file
  let linebookId = (await lineBookRead<bigint>('activeLineOf', [borrower])) || 0n
  let openTx: Hex | null = null
  if (linebookId === 0n) {
    await resilient(
      'linebook-open',
      async () => {
        const receipt = await lineBookWrite('openLine', [
          borrower,
          row.credit_account,
          borrower,
          '0x0000000000000000000000000000000000000000',
          net.token,
          limit,
          BigInt(row.mandate_cap),
          0n,
          BigInt(row.period_seconds),
          BigInt(expiry),
        ])
        const [opened] = parseEventLogs({ abi: lineBookAbi, logs: receipt.logs, eventName: 'LineOpened' }) as any[]
        linebookId = opened.args.id as bigint
        openTx = receipt.transactionHash
      },
      async () => {
        const id = await lineBookRead<bigint>('activeLineOf', [borrower])
        if (id > 0n) linebookId = id
        return id > 0n
      },
    )
  }

  await sql`
    UPDATE lines SET status = 'active', linebook_id = ${linebookId.toString()}, spend_key_id = ${spendKeyId},
      opened_at = now(), next_due = now() + (${row.period_seconds} || ' seconds')::interval, updated_at = now()
    WHERE id = ${row.id}`
  await audit({ lineId: row.id, actor: 'servicer', action: 'line.opened', detail: { linebookId, spendKeyId, limit }, txHash: openTx })
  return lineView(row.id)
}

// ---------------------------------------------------------------------------------------------
// Money movements, idempotent by memo.
// ---------------------------------------------------------------------------------------------
export async function moveOnce(p: {
  lineId: number
  kind: 'FUND' | 'INST' | 'GUAR' | 'TOPUP'
  seq: number
  from: any // viem account (root or access key)
  to: Address
  amount: bigint
  memoKind: 'FUND' | 'INST' | 'GUAR' | 'REFUND'
}): Promise<{ txHash: Hex | null; status: 'confirmed' | 'failed'; error?: string }> {
  const memoSeq = p.kind === 'TOPUP' ? 1_000_000 + p.seq : p.seq
  const memoHex = encodeMemo(p.memoKind, p.lineId, memoSeq)
  const fromAddr = lower(p.from.address)
  const [m] = await sql`
    INSERT INTO movements (line_id, kind, seq, memo, amount, from_addr, to_addr)
    VALUES (${p.lineId}, ${p.kind}, ${p.seq}, ${memoHex}, ${p.amount.toString()}, ${fromAddr}, ${lower(p.to)})
    ON CONFLICT (memo) DO UPDATE SET updated_at = now()
    RETURNING *`
  if (m.status === 'confirmed') return { txHash: m.tx_hash, status: 'confirmed' }
  // reconcile first: a previous attempt may have landed even though we recorded a failure
  if (m.status === 'failed' || m.status === 'pending') {
    const landed = await findMemoTransfer({ from: fromAddr, to: lower(p.to), memo: memoHex }).catch(() => null)
    if (landed) {
      await sql`UPDATE movements SET status='confirmed', tx_hash=${landed.txHash}, error=NULL, updated_at=now() WHERE id=${m.id}`
      return { txHash: landed.txHash, status: 'confirmed' }
    }
  }
  try {
    // transient RPC errors (rate limits) are rejected before broadcast, so retrying is safe;
    // a genuinely failed transfer (revert) is not retried here.
    let txHash: Hex | undefined
    for (let attempt = 0; ; attempt++) {
      try {
        txHash = await sponsoredTransfer({ account: p.from, to: p.to, amount: p.amount, memo: memoHex })
        break
      } catch (e: any) {
        const msg = String(e?.details ?? e?.shortMessage ?? e?.message ?? e)
        if (attempt < 5 && /rate limit|429|timed? ?out|ECONNRESET|fetch failed/i.test(msg)) {
          await new Promise((r) => setTimeout(r, 500 * 2 ** attempt))
          const landed = await findMemoTransfer({ from: fromAddr, to: lower(p.to), memo: memoHex }).catch(() => null)
          if (landed) {
            txHash = landed.txHash
            break
          }
          continue
        }
        throw e
      }
    }
    await sql`UPDATE movements SET status='confirmed', tx_hash=${txHash}, error=NULL, updated_at=now() WHERE id=${m.id}`
    return { txHash, status: 'confirmed' }
  } catch (e: any) {
    // the send may have landed despite the error (timeout, dropped response): reconcile by memo
    const landed = await findMemoTransfer({ from: fromAddr, to: lower(p.to), memo: memoHex }).catch(() => null)
    if (landed) {
      await sql`UPDATE movements SET status='confirmed', tx_hash=${landed.txHash}, error=NULL, updated_at=now() WHERE id=${m.id}`
      return { txHash: landed.txHash, status: 'confirmed' }
    }
    const error = String(e?.details ?? e?.shortMessage ?? e?.message ?? e).slice(0, 500)
    await sql`UPDATE movements SET status='failed', error=${error}, updated_at=now() WHERE id=${m.id}`
    return { txHash: null, status: 'failed', error }
  }
}

// ---------------------------------------------------------------------------------------------
// Card controls used by the scheduler / watcher / admin.
// ---------------------------------------------------------------------------------------------
async function updateKeyLimit(row: any, keyId: string, newLimit: bigint) {
  const creditRoot = Account.fromSecp256k1(open(row.credit_root_enc))
  await resilient(
    `update-limit-${keyId.slice(0, 8)}`,
    () =>
      Actions.accessKey.updateLimitSync(clientFor(creditRoot), {
        accessKey: keyId,
        token: net.token,
        limit: newLimit,
        feePayer: treasury,
      } as any),
    async () => {
      const k = await getKey(row.credit_account, keyId as Address)
      if (!k.exists || k.revoked) return true // nothing to update
      return (await remainingLimit(row.credit_account, keyId as Address)).remaining === newLimit && newLimit === 0n
    },
  )
}

/** Sets the phone/passkey card key's per-period limit (used on tier upgrades). */
export async function setSpendLimit(row: any, newLimit: bigint) {
  if (row.spend_key_id) await updateKeyLimit(row, row.spend_key_id, newLimit)
}

/**
 * Blocks or restores ALL spending keys on the credit account (phone card key AND physical NFC card key).
 * 'blocked' = on-chain limit 0 (grace, frozen, defaulted). 'normal' = line limit / card tap limit.
 */
export async function applyLimits(row: any, mode: 'normal' | 'blocked') {
  const spend = mode === 'normal' ? BigInt(row.credit_limit) : 0n
  if (row.spend_key_id) await updateKeyLimit(row, row.spend_key_id, spend)
  if (row.card_key_id && row.card_status === 'active') {
    const card = mode === 'normal' ? BigInt(row.card_limit ?? 0) : 0n
    await updateKeyLimit(row, row.card_key_id, card)
  }
}

export async function freezeLine(row: any, reason: keyof typeof FreezeReason) {
  if (row.status === 'frozen' || row.status === 'defaulted' || row.status === 'closed' || row.status === 'settled') return
  await applyLimits(row, 'blocked')
  await lineBookWrite('recordFreeze', [BigInt(row.linebook_id), FreezeReason[reason]])
  await sql`UPDATE lines SET status='frozen', freeze_reason=${reason}, updated_at=now() WHERE id=${row.id}`
  await audit({ lineId: row.id, actor: 'servicer', action: 'line.frozen', detail: { reason } })
}

/** Credit-line view for the app: on-chain balances + DB state. */
export async function lineView(id: number | bigint) {
  const [row] = await sql`SELECT * FROM lines WHERE id = ${String(id)}`
  if (!row) return null
  const limit = BigInt(row.credit_limit)
  let available: bigint | null = null
  let periodRemaining: bigint | null = null
  let periodEnd: bigint | null = null
  if (row.status !== 'preparing') {
    available = await tokenBalance(row.credit_account)
    if (row.spend_key_id) {
      const r = await remainingLimit(row.credit_account, row.spend_key_id)
      periodRemaining = r.remaining
      periodEnd = r.periodEnd
    }
  }
  const owed = available === null ? 0n : limit > available ? limit - available : 0n
  let mandateActive = false
  if (row.status !== 'preparing') {
    const k = await getKey(row.borrower_wallet, row.repay_key_id).catch(() => null)
    mandateActive = Boolean(k && k.exists && !k.revoked)
  }
  const spendable =
    available === null ? 0n : periodRemaining === null ? available : available < periodRemaining ? available : periodRemaining
  const s = (v: bigint | null) => (v === null ? null : v.toString())
  return {
    id: Number(row.id),
    linebookId: row.linebook_id ? Number(row.linebook_id) : null,
    status: row.status as string,
    freezeReason: row.freeze_reason as string | null,
    creditAccount: row.credit_account as Address,
    spendKeyId: row.spend_key_id as Address | null,
    repayKeyId: row.repay_key_id as Address,
    mandateActive,
    settledAt: row.settled_at,
    card: row.card_key_id ? { address: row.card_key_id as Address, limit: String(row.card_limit), status: row.card_status } : null,
    token: row.token as Address,
    limit: limit.toString(),
    available: s(available),
    owed: owed.toString(),
    spendable: spendable.toString(),
    periodRemaining: s(periodRemaining),
    periodEnd: s(periodEnd),
    nextDue: row.next_due,
    amountDue: row.amount_due.toString(),
    graceUntil: row.grace_until,
    onTimeCount: row.on_time_count,
    missedCount: row.missed_count,
    guarantorWallet: row.guarantor_wallet,
    guaranteed: row.guaranteed.toString(),
    mandateCap: row.mandate_cap.toString(),
    periodSeconds: row.period_seconds,
    termEnd: row.term_end,
  }
}
