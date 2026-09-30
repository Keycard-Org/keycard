import type { Address, Hex } from 'viem'
import { generatePrivateKey } from 'viem/accounts'
import { Account } from 'viem/tempo'
import { BORROWER_FLAGS, mandateKeyPolicy } from '@keycard/sdk'
import { net } from './config'
import { lineBookWrite, registryWrite, tokenBalance, treasury } from './chain'
import { audit, sql } from './db'
import { UserError, applyLimits, lineView } from './lines'
import { activateKeyAuthorization, checkKeyAuthorization } from './keyauth'
import { cureOverdue, repayFromBorrower, topUp } from './scheduler'
import { seal } from './vault'

/**
 * Recovery paths a real borrower needs:
 *   payNow         — repay what is owed right now (still capped by the on-chain mandate). Cures grace; settles a default.
 *   renewMandate   — re-grant the auto-debit after revoking it (a revoked keyId can never be reused, so a new key).
 *   settle         — a defaulted line repaid in full becomes 'settled': identity re-attested, a new line may be opened.
 */
const lower = (a: string) => a.toLowerCase() as Address

async function latestLine(wallet: Address) {
  const [row] = await sql`SELECT * FROM lines WHERE borrower_wallet=${lower(wallet)} AND status <> 'preparing'
                          ORDER BY created_at DESC LIMIT 1`
  if (!row) throw new UserError('no credit line', 404)
  return row
}

async function owedNow(row: any) {
  if (row.status === 'defaulted') return BigInt(row.amount_due)
  const limit = BigInt(row.credit_limit)
  const available = await tokenBalance(row.credit_account)
  const owed = limit > available ? limit - available : 0n
  return owed > BigInt(row.amount_due) ? owed : BigInt(row.amount_due)
}

export async function payNow(wallet: Address) {
  const row = await latestLine(wallet)
  if (row.status === 'settled' || row.status === 'closed') throw new UserError('nothing to pay')
  const owed = await owedNow(row)
  if (owed === 0n) throw new UserError('you owe nothing right now')
  const seq = 20_000_000 + Math.floor(Date.now() / 1000) % 10_000_000
  const r = await repayFromBorrower(row, owed, seq)
  if (r.pulled === 0n) {
    const why = r.reason === 'auto-debit is not active' ? 're-enable your auto-debit first, then pay' : r.reason === 'wallet is empty' ? 'add money to your KEYCARD wallet first' : r.reason
    throw new UserError(`could not collect: ${why}`)
  }
  await lineBookWrite('recordRepayment', [BigInt(row.linebook_id), r.txHash!, r.pulled, false])
  await audit({ lineId: row.id, actor: 'borrower', action: 'repaid.manual', detail: { amount: r.pulled, owed }, txHash: r.txHash })

  if (row.status === 'defaulted') {
    const left = BigInt(row.amount_due) - r.pulled
    await sql`UPDATE lines SET amount_due=${left.toString()}, updated_at=now() WHERE id=${row.id}`
    if (left === 0n) await settle(row)
    return lineView(row.id)
  }
  // restore the credit that was repaid
  await topUp(row, r.pulled, seq)
  const due = BigInt(row.amount_due)
  if (due > 0n) {
    const leftDue = due > r.pulled ? due - r.pulled : 0n
    await sql`UPDATE lines SET amount_due=${leftDue.toString()}, updated_at=now() WHERE id=${row.id}`
    if (leftDue === 0n) await cureOverdue(row)
  }
  return lineView(row.id)
}

/** A defaulted line repaid in full: record it, re-attest the identity (same nullifier), allow a new line. */
async function settle(row: any) {
  const [att] = await sql`SELECT * FROM attestations WHERE wallet=${row.borrower_wallet}`
  const expiresAt = new Date(Date.now() + 365 * 86400_000)
  if (att) {
    try {
      await registryWrite('attest', [row.borrower_wallet, att.nullifier_hash, att.flags || BORROWER_FLAGS, BigInt(Math.floor(expiresAt.getTime() / 1000))])
      await sql`UPDATE attestations SET expires_at=${expiresAt} WHERE wallet=${row.borrower_wallet}`
    } catch (e) {
      console.error('re-attest after settlement failed', e)
    }
  }
  await sql`UPDATE lines SET status='settled', amount_due=0, settled_at=now(), updated_at=now() WHERE id=${row.id}`
  await audit({ lineId: row.id, actor: 'servicer', action: 'line.settled_after_default' })
}

/** Step 1 of re-enabling the auto-debit: a fresh mandate key (revoked keyIds can never be re-authorised). */
export async function renewMandate(wallet: Address) {
  const row = await latestLine(wallet)
  if (!['active', 'grace', 'frozen', 'defaulted'].includes(row.status)) throw new UserError('no line to re-enable')
  const pk = generatePrivateKey()
  const keyId = lower(Account.fromSecp256k1(pk, { access: lower(wallet) }).accessKeyAddress)
  await sql`UPDATE lines SET pending_repay_key_id=${keyId}, pending_repay_key_enc=${seal(pk)}, updated_at=now() WHERE id=${row.id}`
  const expiry = Math.floor(new Date(row.term_end).getTime() / 1000)
  const policy = mandateKeyPolicy({ token: net.token, instalment: BigInt(row.mandate_cap), period: row.period_seconds, repayTo: treasury.address, expiry })
  return {
    lineId: Number(row.id),
    mandate: {
      keyId,
      keyType: 'secp256k1' as const,
      token: net.token,
      cap: row.mandate_cap.toString(),
      periodSeconds: row.period_seconds,
      recipient: treasury.address,
      expiry,
      policy: JSON.parse(JSON.stringify(policy, (_, v) => (typeof v === 'bigint' ? v.toString() : v))),
    },
  }
}

/** Step 2: verify the signed permission, activate it, and unfreeze the card if the only problem was the mandate. */
export async function confirmRenewMandate(wallet: Address, keyAuthorization: Hex) {
  const row = await latestLine(wallet)
  if (!row.pending_repay_key_id) throw new UserError('start re-enabling first')
  const ka = checkKeyAuthorization(keyAuthorization, {
    keyId: row.pending_repay_key_id,
    expiry: Math.floor(new Date(row.term_end).getTime() / 1000),
    limit: BigInt(row.mandate_cap),
    period: row.period_seconds,
    recipients: [treasury.address],
  })
  const tx = await activateKeyAuthorization({ owner: lower(wallet), keyId: row.pending_repay_key_id, sealedKey: row.pending_repay_key_enc, ka })
  await sql`UPDATE lines SET repay_key_id=pending_repay_key_id, repay_key_enc=pending_repay_key_enc,
            pending_repay_key_id=NULL, pending_repay_key_enc=NULL, updated_at=now() WHERE id=${row.id}`
  await audit({ lineId: row.id, actor: 'borrower', action: 'mandate.renewed', txHash: tx })

  const [fresh] = await sql`SELECT * FROM lines WHERE id=${row.id}`
  if (fresh.status === 'frozen' && fresh.freeze_reason === 'MandateRevoked' && BigInt(fresh.amount_due) === 0n) {
    await lineBookWrite('recordUnfreeze', [BigInt(fresh.linebook_id)])
    await sql`UPDATE lines SET status='active', freeze_reason=NULL, updated_at=now() WHERE id=${row.id}`
    await applyLimits({ ...fresh, status: 'active' }, 'normal')
    await audit({ lineId: row.id, actor: 'servicer', action: 'line.unfrozen', detail: { reason: 'mandate renewed' } })
  }
  return lineView(row.id)
}

/** Frozen by a revoked mandate but debt now cleared and mandate renewed: unfreeze. Called after payNow. */
export async function maybeUnfreeze(wallet: Address) {
  const row = await latestLine(wallet)
  if (row.status !== 'frozen' || row.freeze_reason !== 'MandateRevoked' || BigInt(row.amount_due) !== 0n) return
  const v = await lineView(row.id)
  if (!v?.mandateActive) return
  await lineBookWrite('recordUnfreeze', [BigInt(row.linebook_id)])
  await sql`UPDATE lines SET status='active', freeze_reason=NULL, grace_until=NULL, updated_at=now() WHERE id=${row.id}`
  await applyLimits({ ...row, status: 'active' }, 'normal')
  await audit({ lineId: row.id, actor: 'servicer', action: 'line.unfrozen', detail: { reason: 'debt cleared' } })
}
