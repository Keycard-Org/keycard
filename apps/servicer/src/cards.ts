import { randomBytes } from 'node:crypto'
import { keccak256, recoverAddress, type Address, type Hex } from 'viem'
import { Account, Actions } from 'viem/tempo'
import { spendKeyPolicy } from '@keycard/sdk'
import { env, net } from './config'
import { clientFor, getKey, treasury } from './chain'
import { audit, sql } from './db'
import { UserError, activeMerchants, resilient } from './lines'
import { open } from './vault'

/**
 * Physical KEYCARD (Burner card / Arx HaLo chip, key slot 1).
 * The chip key becomes a second access key on the credit account with a lower "contactless" limit,
 * the same settlement-only scope and the line's expiry. Slot 1 has no PIN, so like any contactless card
 * whoever holds it can spend up to CARD_LIMIT per period; freezing revokes it on-chain instantly.
 * We never touch the Burner wallet key (slots 8/9, PIN-protected).
 */
const lower = (a: string) => a.toLowerCase() as Address
const challenges = new Map<string, { challenge: Hex; exp: number }>()

export function cardChallenge(wallet: Address) {
  const challenge = `0x${randomBytes(32).toString('hex')}` as Hex
  challenges.set(lower(wallet), { challenge, exp: Date.now() + 5 * 60_000 })
  return { challenge, digest: keccak256(challenge) }
}

export async function linkCard(p: { wallet: Address; cardAddress: Address; signature: Hex }) {
  const wallet = lower(p.wallet)
  const c = challenges.get(wallet)
  if (!c || c.exp < Date.now()) throw new UserError('card challenge expired, tap again')
  challenges.delete(wallet)
  const recovered = lower(await recoverAddress({ hash: keccak256(c.challenge), signature: p.signature }))
  if (recovered !== lower(p.cardAddress)) throw new UserError('card signature did not match this card')

  const [row] = await sql`SELECT * FROM lines WHERE borrower_wallet=${wallet} AND status='active'`
  if (!row) throw new UserError('your credit line must be active to link a card')
  if (row.card_key_id) throw new UserError('a physical card is already linked to this KEYCARD; unlink it first')
  const [taken] = await sql`SELECT id FROM lines WHERE card_key_id=${recovered} AND id<>${row.id}`
  if (taken) throw new UserError('this card is linked to another KEYCARD')

  const cardLimit = env.CARD_LIMIT < BigInt(row.credit_limit) ? env.CARD_LIMIT : BigInt(row.credit_limit)
  const creditRoot = Account.fromSecp256k1(open(row.credit_root_enc))
  const pol = spendKeyPolicy({
    token: net.token,
    limit: cardLimit,
    period: row.period_seconds,
    merchants: await activeMerchants(),
    expiry: Math.floor(new Date(row.term_end).getTime() / 1000),
  })
  const existing = await getKey(row.credit_account, recovered)
  const [unlinked] = await sql`SELECT 1 FROM audit_log WHERE line_id=${row.id} AND action='card.unlinked' AND detail->>'card'=${recovered} LIMIT 1`
  if (existing.revoked || unlinked)
    throw new UserError('this card was unlinked from this KEYCARD. Tempo never re-authorises a revoked key on the same account, so it can only be linked to a different KEYCARD. (Use Freeze instead of Unlink to pause a card.)', 409)
  try {
    await resilient(
      'authorize-card-key',
      () =>
        Actions.accessKey.authorizeSync(clientFor(creditRoot), {
          accessKey: { address: recovered, type: 'secp256k1' },
          ...pol,
          feePayer: treasury,
        } as any),
      async () => (await getKey(row.credit_account, recovered)).exists,
    )
  } catch (e: any) {
    const m = String(e?.details ?? e?.shortMessage ?? e?.message ?? e)
    if (/KeyAlreadyRevoked/i.test(m))
      throw new UserError('this card was unlinked from this KEYCARD and cannot be re-linked to it (Tempo protocol rule). Link it to a different KEYCARD.', 409)
    throw new UserError(`could not link card: ${m.slice(0, 160)}`, 502)
  }
  await sql`UPDATE lines SET card_key_id=${recovered}, card_limit=${cardLimit.toString()}, card_status='active',
            card_linked_at=now(), updated_at=now() WHERE id=${row.id}`
  await audit({ lineId: row.id, actor: 'borrower', action: 'card.linked', detail: { card: recovered, cardLimit } })
  return { cardAddress: recovered, cardLimit: cardLimit.toString() }
}

export async function unlinkCard(wallet: Address) {
  const [row] = await sql`SELECT * FROM lines WHERE borrower_wallet=${lower(wallet)} AND card_key_id IS NOT NULL
                          ORDER BY created_at DESC LIMIT 1`
  if (!row) throw new UserError('no physical card linked')
  const creditRoot = Account.fromSecp256k1(open(row.credit_root_enc))
  await resilient(
    'revoke-card-key',
    () => Actions.accessKey.revokeSync(clientFor(creditRoot), { accessKey: row.card_key_id, feePayer: treasury } as any),
    async () => {
      const k = await getKey(row.credit_account, row.card_key_id)
      return !k.exists || k.revoked
    },
  )
  // revoked keyIds can never be re-authorised: clear it so a NEW card (or slot) can be linked
  await sql`UPDATE lines SET card_status='unlinked', card_key_id=NULL, updated_at=now() WHERE id=${row.id}`
  await audit({ lineId: row.id, actor: 'borrower', action: 'card.unlinked', detail: { card: row.card_key_id } })
  return { ok: true }
}

/** Public lookup for a merchant's phone after the first tap: which credit account does this card spend from? */
export async function cardInfo(cardAddress: Address) {
  const [row] = await sql`SELECT credit_account, card_limit, card_status, status FROM lines WHERE card_key_id=${lower(cardAddress)}
                          ORDER BY created_at DESC LIMIT 1`
  if (!row) throw new UserError('this card is not linked to any KEYCARD', 404)
  if (row.card_status !== 'active') throw new UserError('this physical card has been frozen by its owner', 403)
  if (row.status === 'grace') throw new UserError('declined: this KEYCARD has an overdue payment. The owner needs to add money to their wallet.', 403)
  if (row.status === 'frozen') throw new UserError('declined: this KEYCARD is frozen', 403)
  if (row.status !== 'active') throw new UserError(`declined: this KEYCARD is ${row.status}`, 403)
  return { creditAccount: row.credit_account as Address, cardLimit: row.card_limit.toString() }
}

/** Admin: release a physical card from whatever line it is linked to (revokes its key on-chain, frees it to re-link). */
export async function releaseCard(cardAddress: Address) {
  const [row] = await sql`SELECT borrower_wallet FROM lines WHERE card_key_id=${lower(cardAddress)} ORDER BY created_at DESC LIMIT 1`
  if (!row) throw new UserError('card is not linked to any line', 404)
  await unlinkCard(row.borrower_wallet)
  await audit({ actor: 'admin', action: 'card.released', detail: { card: lower(cardAddress) } })
  return { ok: true, releasedFrom: row.borrower_wallet.slice(0, 10) }
}

/** Reversible pause: card key limit 0 on-chain (the key stays authorised, so it can be unfrozen). */
export async function setCardFrozen(wallet: Address, frozen: boolean) {
  const [row] = await sql`SELECT * FROM lines WHERE borrower_wallet=${lower(wallet)} AND card_key_id IS NOT NULL
                          ORDER BY created_at DESC LIMIT 1`
  if (!row) throw new UserError('no physical card linked')
  if (!frozen && row.status !== 'active') throw new UserError('your line must be active to unfreeze the card')
  const limit = frozen ? 0n : BigInt(row.card_limit)
  const creditRoot = Account.fromSecp256k1(open(row.credit_root_enc))
  await Actions.accessKey.updateLimitSync(clientFor(creditRoot), {
    accessKey: row.card_key_id,
    token: net.token,
    limit,
    feePayer: treasury,
  } as any)
  await sql`UPDATE lines SET card_status=${frozen ? 'frozen' : 'active'}, updated_at=now() WHERE id=${row.id}`
  await audit({ lineId: row.id, actor: 'borrower', action: frozen ? 'card.frozen' : 'card.unfrozen', detail: { card: row.card_key_id } })
  return { ok: true, status: frozen ? 'frozen' : 'active' }
}
