import { randomBytes, createHash } from 'node:crypto'
import type { Address } from 'viem'
import { generatePrivateKey } from 'viem/accounts'
import { Account } from 'viem/tempo'
import { GUARANTOR_FLAGS, guaranteeKeyPolicy, maxGuarantee } from '@keycard/sdk'
import { net, tiers } from './config'
import { lineBookWrite, registryRead, remainingLimit, treasury, verifyKeyPolicy } from './chain'
import { audit, sql } from './db'
import { UserError, lineView, moveOnce, setSpendLimit } from './lines'
import { seal } from './vault'

const lower = (a: string) => a.toLowerCase() as Address

export async function createInvite(borrower: Address, requested: bigint) {
  const [line] = await sql`SELECT * FROM lines WHERE borrower_wallet=${lower(borrower)} AND status='active'`
  if (!line) throw new UserError('open your line first')
  if (line.guarantor_wallet) throw new UserError('line already has a guarantor')
  if (requested <= 0n || requested > BigInt(line.mandate_cap)) throw new UserError('invalid amount')
  const id = randomBytes(16).toString('base64url')
  await sql`INSERT INTO guarantee_invites (id, line_id, requested) VALUES (${id}, ${line.id}, ${requested.toString()})`
  await audit({ lineId: line.id, actor: 'borrower', action: 'guarantee.invited', detail: { requested } })
  return { inviteId: id }
}

export async function getInvite(id: string) {
  const [inv] = await sql`SELECT i.*, l.borrower_wallet, l.term_end, l.status AS line_status
                          FROM guarantee_invites i JOIN lines l ON l.id = i.line_id WHERE i.id=${id}`
  if (!inv) throw new UserError('invite not found', 404)
  const termMonths = Math.max(1, Math.ceil((new Date(inv.term_end).getTime() - Date.now()) / (30 * 86400_000)))
  return {
    inviteId: inv.id,
    status: inv.status,
    borrowerWallet: inv.borrower_wallet,
    requested: inv.requested.toString(),
    termEnd: inv.term_end,
    termMonths,
    token: net.token,
  }
}

export function consentText(p: { cap: bigint; borrower: string; termEnd: Date }) {
  const usd = (Number(p.cap) / 1e6).toFixed(2)
  return [
    `I guarantee the KEYCARD credit line of ${p.borrower}.`,
    `If they miss a repayment and do not pay within the grace period, KEYCARD may take up to $${usd} from my wallet, in total, only to KEYCARD.`,
    `This permission is enforced by the Tempo blockchain: KEYCARD cannot take more than $${usd}, or send it anywhere else.`,
    `It ends on ${p.termEnd.toISOString().slice(0, 10)}. I can withdraw it at any time for future borrowing by revoking the key; the borrower's credit limit will then be reduced.`,
  ].join('\n')
}

/** Affordability (Amigo lesson): cap = min(requested, 20% of disposable income × months). */
export async function prepareGuarantee(p: {
  inviteId: string
  guarantor: Address
  monthlyIncome: bigint
  monthlyObligations: bigint
}) {
  const guarantor = lower(p.guarantor)
  const inv = await getInvite(p.inviteId)
  if (inv.status !== 'open' && inv.status !== 'prepared') throw new UserError('invite no longer open')
  if (guarantor === lower(inv.borrowerWallet)) throw new UserError('a borrower cannot guarantee themselves')
  const [u] = await sql`SELECT * FROM users WHERE wallet=${guarantor}`
  if (!u || u.role !== 'guarantor') throw new UserError('register as a guarantor first')
  if (!(await registryRead<boolean>('isEligible', [guarantor, GUARANTOR_FLAGS]))) throw new UserError('guarantor identity not verified yet', 403)

  const maxAllowed = maxGuarantee({ monthlyIncome: p.monthlyIncome, monthlyObligations: p.monthlyObligations, termMonths: inv.termMonths })
  const requested = BigInt(inv.requested)
  const cap = requested < maxAllowed ? requested : maxAllowed
  if (cap < 1_000_000n) throw new UserError('based on the income you entered, you cannot guarantee at least $1 safely')

  const guarPk = generatePrivateKey()
  const keyId = lower(Account.fromSecp256k1(guarPk, { access: guarantor }).accessKeyAddress)
  const text = consentText({ cap, borrower: inv.borrowerWallet, termEnd: new Date(inv.termEnd) })
  const consentHash = `0x${createHash('sha256').update(text).digest('hex')}`
  await sql`
    UPDATE guarantee_invites SET guarantor_wallet=${guarantor}, monthly_income=${p.monthlyIncome.toString()},
      monthly_obligations=${p.monthlyObligations.toString()}, max_allowed=${maxAllowed.toString()}, cap=${cap.toString()},
      consent_text_hash=${consentHash}, guar_key_id=${keyId}, guar_key_enc=${seal(guarPk)}, status='prepared'
    WHERE id=${p.inviteId}`
  const expiry = Math.floor(new Date(inv.termEnd).getTime() / 1000)
  const policy = guaranteeKeyPolicy({ token: net.token, cap, recoveryTo: treasury.address, expiry })
  return {
    cap: cap.toString(),
    maxAllowed: maxAllowed.toString(),
    requested: requested.toString(),
    consentText: text,
    consentHash,
    key: { keyId, keyType: 'secp256k1' as const, token: net.token, cap: cap.toString(), recipient: treasury.address, expiry },
    policy: JSON.parse(JSON.stringify(policy, (_, v) => (typeof v === 'bigint' ? v.toString() : v))),
  }
}

/** After the guarantor's key is on-chain: verify it, attach it, lift the borrower to the next tier. */
export async function confirmGuarantee(p: { inviteId: string; guarantor: Address; consentHash: string }) {
  const guarantor = lower(p.guarantor)
  const [inv] = await sql`SELECT * FROM guarantee_invites WHERE id=${p.inviteId}`
  if (!inv || inv.status !== 'prepared' || lower(inv.guarantor_wallet) !== guarantor) throw new UserError('invite not prepared for you')
  if (inv.consent_text_hash !== p.consentHash) throw new UserError('consent text mismatch')
  const cap = BigInt(inv.cap)

  const v = await verifyKeyPolicy({ account: guarantor, keyId: inv.guar_key_id, recipients: [treasury.address] })
  if (!v.ok) throw new UserError(`guarantee key not valid on-chain: ${v.reason}`)
  const lim = await remainingLimit(guarantor, inv.guar_key_id)
  if (lim.remaining < cap) throw new UserError('guarantee key limit lower than agreed')

  const [line] = await sql`SELECT * FROM lines WHERE id=${inv.line_id}`
  if (!line || line.status !== 'active') throw new UserError('borrower line is not active')

  await lineBookWrite('recordGuarantorChange', [BigInt(line.linebook_id), guarantor, cap])
  await sql`
    UPDATE lines SET guarantor_wallet=${guarantor}, guar_key_id=${inv.guar_key_id}, guar_key_enc=${inv.guar_key_enc},
      guaranteed=${cap.toString()}, updated_at=now() WHERE id=${line.id}`
  await sql`UPDATE guarantee_invites SET status='active', consented_at=now() WHERE id=${p.inviteId}`
  await audit({ lineId: line.id, actor: 'guarantor', action: 'guarantee.active', detail: { guarantor, cap } })

  // a family guarantee lifts the borrower one tier (never above the mandate cap)
  const current = BigInt(line.credit_limit)
  const next = tiers.find((t) => t > current)
  if (next && next <= BigInt(line.mandate_cap)) {
    await moveOnce({ lineId: Number(line.id), kind: 'TOPUP', seq: 700_000, from: treasury, to: line.credit_account, amount: next - current, memoKind: 'FUND' })
    await setSpendLimit(line, next)
    await lineBookWrite('recordLimitChange', [BigInt(line.linebook_id), next])
    await sql`UPDATE lines SET credit_limit=${next.toString()}, updated_at=now() WHERE id=${line.id}`
  }
  return lineView(line.id)
}
