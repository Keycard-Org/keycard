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
  if (!row) throw new UserError('open your credit line first')
  if (row.card_key_id && row.card_status === 'active') throw new UserError('a physical card is already linked; freeze it first')
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
  await sql`UPDATE lines SET card_key_id=${recovered}, card_limit=${cardLimit.toString()}, card_status='active',
            card_linked_at=now(), updated_at=now() WHERE id=${row.id}`
  await audit({ lineId: row.id, actor: 'borrower', action: 'card.linked', detail: { card: recovered, cardLimit } })
  return { cardAddress: recovered, cardLimit: cardLimit.toString() }
}

export async function freezeCard(wallet: Address) {
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
  await sql`UPDATE lines SET card_status='frozen', card_key_id=NULL, updated_at=now() WHERE id=${row.id}`
  await audit({ lineId: row.id, actor: 'borrower', action: 'card.frozen', detail: { card: row.card_key_id } })
  return { ok: true }
}

/** Public lookup for a merchant's phone after the first tap: which credit account does this card spend from? */
export async function cardInfo(cardAddress: Address) {
  const [row] = await sql`SELECT credit_account, card_limit, card_status, status FROM lines WHERE card_key_id=${lower(cardAddress)}`
  if (!row || row.card_status !== 'active' || row.status !== 'active') throw new UserError('this card is not an active KEYCARD', 404)
  return { creditAccount: row.credit_account as Address, cardLimit: row.card_limit.toString() }
}
