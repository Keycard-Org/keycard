import { createClient, http, type Address, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { Account, Actions, withRelay } from 'viem/tempo'
import { PublicKey } from 'ox'
import { KeyAuthorization, SignatureEnvelope } from 'ox/tempo'
import { encodePayMemo, guaranteeKeyPolicy, mandateKeyPolicy } from '@keycard/sdk'
import { API_URL, api, getConfig, setToken, type AppConfig } from './api'
import { KEYS, clearAll, get, set } from './storage'
import { deviceVault, forgetDeviceKey, unlockDeviceKey, unlockedDeviceKey } from './devicekey'
import { createPasskey as nativeCreatePasskey, discoverPasskey, signWithPasskey } from './passkey'

/**
 * The KEYKARD wallet: a Tempo account controlled by ONE of
 *   - a passkey (fingerprint / face / screen lock, via Android Credential Manager), or
 *   - a password-locked device key (devicekey.ts).
 * The same signer is the root of the user's own wallet and an ACCESS KEY on their KEYKARD credit account (the card).
 * Every transaction is fee-sponsored by the KEYKARD relay: users never need a gas token.
 * Mirrors apps/web/lib/wallet.ts; keep the two in step.
 */
export type StoredCred = { id: string; publicKey: Hex }
export type Signer = { kind: 'passkey'; cred: StoredCred } | { kind: 'password'; address: Address; pk: Hex }

const rpId = async () => (await getConfig()).passkeyRpId

export function storedCredential(): StoredCred | null {
  const s = get(KEYS.passkey)
  try {
    return s ? (JSON.parse(s) as StoredCred) : null
  } catch {
    return null
  }
}
const storeCredential = (c: StoredCred | null) => set(KEYS.passkey, c ? JSON.stringify(c) : null)

/* ---- password prompt: the UI registers a prompter (a masked modal) ---- */
let prompter: ((message: string) => Promise<string | null>) | null = null
export function setPasswordPrompter(fn: typeof prompter) {
  prompter = fn
}
export const askPassword = (message = 'Enter your KEYKARD password') => (prompter ? prompter(message) : Promise.resolve(null))

/** The signer on this phone; unlocks the password wallet if needed (one password entry per app session). */
export async function getSigner(): Promise<Signer> {
  const cred = storedCredential()
  if (cred) return { kind: 'passkey', cred }
  if (deviceVault()) {
    let k = unlockedDeviceKey()
    let message = 'Enter your KEYKARD password'
    while (!k) {
      const pw = await askPassword(message)
      if (pw === null) throw new Error('Password entry cancelled.')
      try {
        k = await unlockDeviceKey(pw)
      } catch (e: any) {
        if (!/Wrong password/.test(e.message)) throw e
        message = 'Wrong password. Try again'
      }
    }
    return { kind: 'password', address: k.address, pk: k.pk }
  }
  throw new Error('No KEYKARD wallet on this phone. Sign in again.')
}
export const hasLocalWallet = () => Boolean(storedCredential() || deviceVault())
export const signerKind = (): 'passkey' | 'password' | null => (storedCredential() ? 'passkey' : deviceVault() ? 'password' : null)

/** Sign-up with a passkey: one prompt. The server verifies the registration (challenge, origin, rpId) and signs you in. */
export async function createPasskey(username: string) {
  const { id: challengeId, challenge } = await api<{ id: string; challenge: Hex }>('/api/auth/register-challenge', { auth: false })
  const p = await nativeCreatePasskey({ username, challenge, rpId: await rpId() })
  const cred = { id: p.id, publicKey: p.publicKey }
  await forgetDeviceKey()
  await storeCredential(cred)
  return { cred, registration: { challengeId, credential: p.serialized } }
}

/** Password wallet registration: the new device key signs the server challenge. */
export async function registrationForDeviceKey(k: { address: Address; pk: Hex }) {
  const { id: challengeId, challenge } = await api<{ id: string; challenge: Hex }>('/api/auth/register-challenge', { auth: false })
  const signature = await privateKeyToAccount(k.pk).signMessage({ message: { raw: challenge } })
  await storeCredential(null)
  return { challengeId, address: k.address, signature }
}

/** "Sign in with passkey": pick a KEYKARD passkey on this phone; its public key comes from KEYKARD. */
export async function restorePasskey(): Promise<StoredCred> {
  const id = await discoverPasskey(await rpId())
  const r = await api<{ publicKey: Hex }>(`/api/passkeys/${encodeURIComponent(id)}`, { auth: false })
  const c = { id, publicKey: r.publicKey }
  await storeCredential(c)
  return c
}

export async function signOut() {
  await storeCredential(null)
  await setToken(null)
}

/** Forget everything KEYKARD stored on this phone (session, passkey reference, password wallet). */
export async function startOver() {
  await forgetDeviceKey()
  await clearAll()
}

function passkeyAccount(s: Extract<Signer, { kind: 'passkey' }>, access?: Address, onSigned?: () => void) {
  const publicKey = PublicKey.fromHex(s.cred.publicKey)
  return Account.from({
    ...(access ? { access } : {}),
    keyType: 'webAuthn',
    publicKey,
    async sign({ hash }: { hash: Hex }) {
      const { metadata, signature } = await signWithPasskey({ challenge: hash, credentialId: s.cred.id, rpId: await rpId() })
      onSigned?.()
      return SignatureEnvelope.serialize({ publicKey, metadata, signature, type: 'webAuthn' } as any)
    },
  } as any)
}

export const rootAccount = (s: Signer) => (s.kind === 'passkey' ? passkeyAccount(s) : Account.fromSecp256k1(s.pk))

/** The signer acting as an access key on another account (the credit account = the card). */
export const accessKeyAccount = (s: Signer, parent: Address, onSigned?: () => void) =>
  s.kind === 'password' ? Account.fromSecp256k1(s.pk, { access: parent }) : passkeyAccount(s, parent, onSigned)

export async function relayClient(account: any, cfg?: AppConfig) {
  const config = cfg ?? (await getConfig())
  const { tempo, tempoModerato } = await import('viem/chains')
  const base = config.network === 'mainnet' ? tempo : tempoModerato
  const chain = base.extend({ feeToken: config.token })
  return createClient({
    account,
    chain,
    transport: withRelay(http(`${API_URL}/rpc`, { timeout: 45_000 }), http(`${API_URL}/relay`, { timeout: 45_000 }), { policy: 'sign-only' }),
  })
}

/** A fresh random 2D nonce lane: no expiry while the user approves with a fingerprint or taps a card. */
function slowSignerNonce() {
  const r = crypto.getRandomValues(new Uint8Array(24))
  let key = 1n
  for (const b of r) key = (key << 8n) | BigInt(b)
  return { nonceKey: key, nonce: 0 }
}

/** Proves control of the wallet to KEYKARD; stores the session token. */
export async function signIn(s: Signer, wallet: Address) {
  const { challenge } = await api<{ challenge: Hex }>('/api/auth/challenge', { body: { wallet }, auth: false })
  let body: any
  if (s.kind === 'passkey') {
    const { metadata, signature } = await signWithPasskey({ challenge, credentialId: s.cred.id, rpId: await rpId() })
    body = { wallet, metadata, signature: { r: signature.r.toString(), s: signature.s.toString() } }
  } else {
    body = { wallet, keySignature: await privateKeyToAccount(s.pk).signMessage({ message: { raw: challenge } }) }
  }
  const { token } = await api<{ token: string }>('/api/auth/verify', { auth: false, body })
  await setToken(token)
  return token
}

export async function tokenBalance(owner: Address): Promise<bigint> {
  const cfg = await getConfig()
  const client = await relayClient(undefined, cfg)
  const r = (await Actions.token.getBalance(client, { account: owner, token: cfg.token } as any)) as any
  return r.amount as bigint
}

async function signKeyAuthorization(s: Signer, keyId: Address, policy: any): Promise<Hex> {
  const cfg = await getConfig()
  const client = await relayClient(rootAccount(s), cfg)
  const ka = await Actions.accessKey.signAuthorization(client, { accessKey: { address: keyId, type: 'secp256k1' }, ...policy } as any)
  return KeyAuthorization.serialize(ka as any) as Hex
}

type MandateTerms = { keyId: Address; cap: string; periodSeconds: number; recipient: Address; expiry: number }

export async function signMandate(s: Signer, lineId: number, m: MandateTerms) {
  const cfg = await getConfig()
  const policy = mandateKeyPolicy({ token: cfg.token, instalment: BigInt(m.cap), period: m.periodSeconds, repayTo: m.recipient, expiry: m.expiry })
  const keyAuthorization = await signKeyAuthorization(s, m.keyId, policy)
  return api<{ tx: Hex | null }>(`/api/lines/${lineId}/mandate`, { body: { keyAuthorization } })
}

export async function signGuarantee(s: Signer, inviteId: string, k: { keyId: Address; cap: string; recipient: Address; expiry: number }) {
  const cfg = await getConfig()
  const policy = guaranteeKeyPolicy({ token: cfg.token, cap: BigInt(k.cap), recoveryTo: k.recipient, expiry: k.expiry })
  const keyAuthorization = await signKeyAuthorization(s, k.keyId, policy)
  return api<{ tx: Hex | null }>(`/api/guarantee/${inviteId}/key`, { body: { keyAuthorization } })
}

export async function revokeKey(s: Signer, keyId: Address) {
  const client = await relayClient(rootAccount(s))
  const r = (await Actions.accessKey.revokeSync(client, { accessKey: keyId, feePayer: true, ...slowSignerNonce() } as any)) as any
  return r.receipt.transactionHash as Hex
}

export async function payWithCard(s: Signer, creditAccount: Address, merchantCode: string, amount: bigint, onStep?: (st: 'approve' | 'confirming') => void) {
  const cfg = await getConfig()
  onStep?.(s.kind === 'passkey' ? 'approve' : 'confirming') // a password wallet signs instantly
  const client = await relayClient(accessKeyAccount(s, creditAccount, () => onStep?.('confirming')), cfg)
  const r = (await Actions.token.transferSync(client, {
    token: cfg.token, to: cfg.settlement, amount, memo: encodePayMemo(merchantCode), feePayer: true, ...slowSignerNonce(),
  } as any)) as any
  return r.receipt.transactionHash as Hex
}

export async function payRawAddress(s: Signer, creditAccount: Address, to: Address, amount: bigint) {
  const cfg = await getConfig()
  const client = await relayClient(accessKeyAccount(s, creditAccount), cfg)
  const r = (await Actions.token.transferSync(client, { token: cfg.token, to, amount, feePayer: true, ...slowSignerNonce() } as any)) as any
  return r.receipt.transactionHash as Hex
}

export async function renewMandateFlow() {
  const s = await getSigner()
  const r = await api<{ lineId: number; mandate: MandateTerms }>('/api/lines/mandate/renew', { method: 'POST' })
  const cfg = await getConfig()
  const policy = mandateKeyPolicy({ token: cfg.token, instalment: BigInt(r.mandate.cap), period: r.mandate.periodSeconds, repayTo: r.mandate.recipient, expiry: r.mandate.expiry })
  const keyAuthorization = await signKeyAuthorization(s, r.mandate.keyId, policy)
  return api('/api/lines/mandate/renew/confirm', { body: { keyAuthorization } })
}

export type CardStep = 'hold' | 'reading' | 'checking' | 'signing' | 'confirming' | 'linking'

/**
 * Merchant: charge a customer's physical KEYKARD with ONE tap. While the card is held: read it, check it can pay,
 * and have the chip sign the payment; then confirm on Tempo (the reader stays reserved until it's done).
 */
export async function chargePhysicalCard(p: { merchantCode: string; amount: bigint; onStep?: (s: CardStep) => void }) {
  if (process.env.EXPO_PUBLIC_FAKE_NFC === '1') return simulateCard(['hold', 'reading', 'checking', 'signing', 'confirming'], p.onStep, p.amount > 50_000_000n)
  const { withCard, readCard, cardAccessKeyAccount } = await import('./halo')
  const cfg = await getConfig()
  p.onStep?.('hold')
  return withCard(async (session) => {
    p.onStep?.('reading')
    const card = await readCard(session)
    p.onStep?.('checking')
    const info = await api<{ creditAccount: Address; cardLimit: string }>(`/api/cards/${card.address}`, { auth: false })
    if (p.amount > BigInt(info.cardLimit)) throw new Error(`Over this card’s tap limit ($${(Number(info.cardLimit) / 1e6).toFixed(2)}).`)
    p.onStep?.('signing')
    const account = cardAccessKeyAccount(session, info.creditAccount, card.publicKey, () => p.onStep?.('confirming'))
    const client = await relayClient(account, cfg)
    const r = (await Actions.token.transferSync(client, {
      token: cfg.token, to: cfg.settlement, amount: p.amount, memo: encodePayMemo(p.merchantCode), feePayer: true, ...slowSignerNonce(),
    } as any)) as any
    return { hash: r.receipt.transactionHash as Hex, card: card.address }
  })
}

/** Test builds only (EXPO_PUBLIC_FAKE_NFC): walk the card steps with realistic timing so the UI can be checked on an emulator. */
async function simulateCard(steps: CardStep[], onStep?: (s: CardStep) => void, fail = false) {
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
  for (const st of steps) {
    onStep?.(st)
    await wait(st === 'hold' ? 2500 : st === 'confirming' ? 2200 : 900)
  }
  if (fail) throw new Error('Refused by the Tempo protocol: this is over your available limit for this period (or your card is frozen).')
  return { hash: ('0x' + 'ab'.repeat(32)) as Hex, card: '0x3c86aa11bb22cc33dd44ee55ff6677889900abcd' as Address }
}

/** Cardholder: link a physical card to your line with ONE tap (the card proves possession by signing a challenge). */
export async function linkPhysicalCard(onStep?: (s: CardStep) => void) {
  if (process.env.EXPO_PUBLIC_FAKE_NFC === '1') return simulateCard(['hold', 'signing', 'linking'], onStep, false).then(() => ({ cardAddress: '0x3c86aa11bb22cc33dd44ee55ff6677889900abcd' as Address, cardLimit: '10000000' }))
  const { withCard, cardSignDigest } = await import('./halo')
  const { digest } = await api<{ challenge: Hex; digest: Hex }>('/api/card/challenge', { method: 'POST' })
  onStep?.('hold')
  return withCard(async (session) => {
    onStep?.('signing')
    const { signature, address } = await cardSignDigest(session, digest)
    onStep?.('linking')
    return api<{ cardAddress: Address; cardLimit: string }>('/api/card/link', { body: { cardAddress: address, signature } })
  })
}

/** Human-readable reason from a Tempo keychain / TIP-20 revert or a wallet error. */
export function explainChainError(e: any): string {
  const s = String(e?.details ?? e?.shortMessage ?? e?.message ?? e)
  if (/CallNotAllowed/.test(s)) return 'Refused by the Tempo protocol: your card can only pay through the KEYKARD network, not a raw wallet.'
  if (/SpendingLimitExceeded/.test(s)) return 'Refused by the Tempo protocol: this is over your available limit for this period (or your card is frozen).'
  if (/KeyAlreadyRevoked|KeyExpired/.test(s)) return 'This card key is no longer active.'
  if (/InsufficientBalance/.test(s)) return 'Not enough available credit.'
  if (/HTTP request failed|fetch failed|Network request failed|timed out|took too long/i.test(s))
    return 'The network is slow right now. Check your connection; if a payment was sent, it will show up in your activity.'
  return s.slice(0, 220)
}
