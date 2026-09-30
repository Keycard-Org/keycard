'use client'

import { createClient, http, type Address, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { Account, Actions, WebAuthnP256, withRelay } from 'viem/tempo'
import { PublicKey, WebAuthnP256 as OxWebAuthn } from 'ox'
import { Credential, Registration } from 'ox/webauthn'
import { KeyAuthorization, SignatureEnvelope } from 'ox/tempo'
import { encodePayMemo, guaranteeKeyPolicy, mandateKeyPolicy } from '@keycard/sdk'
import { api, API_URL, getConfig, setToken, type AppConfig } from './api'
import { askPassword, deviceVault, forgetDeviceKey, unlockDeviceKey, unlockedDeviceKey } from './devicekey'

/**
 * The KEYCARD wallet is a Tempo account controlled by ONE of:
 *   - a passkey (Face ID / fingerprint), or
 *   - a password-locked device key (see devicekey.ts).
 * The same signer is the ROOT of the user's own wallet and an ACCESS KEY on the KEYCARD credit account (the card).
 * Every transaction is fee-sponsored by the KEYCARD relay, so users never need a gas token.
 */
const CRED_KEY = 'keycard.passkey'
export type StoredCred = { id: string; publicKey: Hex }
export type Signer = { kind: 'passkey'; cred: StoredCred } | { kind: 'password'; address: Address; pk: Hex }

export const rpId = () => window.location.hostname

export function storedCredential(): StoredCred | null {
  try {
    const s = localStorage.getItem(CRED_KEY)
    return s ? (JSON.parse(s) as StoredCred) : null
  } catch {
    return null
  }
}
function storeCredential(c: StoredCred | null) {
  try {
    if (c) localStorage.setItem(CRED_KEY, JSON.stringify(c))
    else localStorage.removeItem(CRED_KEY)
  } catch {}
}

/** The signer on this device; unlocks the password wallet if needed (one password prompt per session). */
export async function getSigner(): Promise<Signer> {
  const cred = storedCredential()
  if (cred) return { kind: 'passkey', cred }
  const v = deviceVault()
  if (v) {
    let k = unlockedDeviceKey()
    if (!k) {
      const pw = await askPassword()
      if (pw === null) throw new Error('Password entry cancelled.')
      k = await unlockDeviceKey(pw)
    }
    return { kind: 'password', address: k.address, pk: k.pk }
  }
  throw new Error('No KEYCARD wallet on this device. Sign in again.')
}
export const hasLocalWallet = () => Boolean(storedCredential() || deviceVault())

/**
 * Creates the passkey against a server challenge. The server verifies the registration (challenge,
 * origin, rpId) and signs the user in, so sign-up needs exactly ONE passkey prompt.
 */
export async function createPasskey(label: string): Promise<{ cred: StoredCred; registration: { challengeId: string; credential: unknown } }> {
  const { id: challengeId, challenge } = await api<{ id: string; challenge: Hex }>('/api/auth/register-challenge', { auth: false })
  const credential = await Registration.create({ name: label, challenge, rp: { id: rpId(), name: 'KEYCARD' } } as any)
  const serialized = Credential.serialize(credential as any)
  const c = { id: (credential as any).id as string, publicKey: serialized.publicKey as Hex }
  forgetDeviceKey()
  storeCredential(c)
  return { cred: c, registration: { challengeId, credential: serialized } }
}

/** Password wallet registration: the new device key signs the server challenge (no passkey involved). */
export async function registrationForDeviceKey(k: { address: Address; pk: Hex }) {
  const { id: challengeId, challenge } = await api<{ id: string; challenge: Hex }>('/api/auth/register-challenge', { auth: false })
  const signature = await privateKeyToAccount(k.pk).signMessage({ message: { raw: challenge } })
  storeCredential(null)
  return { challengeId, address: k.address, signature }
}

/** Sign in with an existing passkey on this device (public key fetched from KEYCARD). */
export async function restorePasskey(): Promise<StoredCred> {
  const cred = await WebAuthnP256.getCredential({
    rpId: rpId(),
    async getPublicKey(credential: { id: string }) {
      const r = await api<{ publicKey: Hex }>(`/api/passkeys/${encodeURIComponent(credential.id)}`, { auth: false })
      return r.publicKey
    },
  } as any)
  const c = { id: (cred as any).id, publicKey: (cred as any).publicKey as Hex }
  storeCredential(c)
  return c
}

export function signOut() {
  storeCredential(null)
  setToken(null)
}

/** Forget everything KEYCARD stored in this browser (session, passkey reference, password wallet). */
export function startOver() {
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith('keycard.')) localStorage.removeItem(k)
  } catch {}
  forgetDeviceKey()
  setToken(null)
}

export function rootAccount(s: Signer) {
  return s.kind === 'passkey'
    ? Account.fromWebAuthnP256({ id: s.cred.id, publicKey: s.cred.publicKey }, { rpId: rpId() })
    : Account.fromSecp256k1(s.pk)
}

/** The signer acting as an access key on another account (the credit account = the card). */
export function accessKeyAccount(s: Signer, parent: Address) {
  if (s.kind === 'password') return Account.fromSecp256k1(s.pk, { access: parent })
  const publicKey = PublicKey.fromHex(s.cred.publicKey)
  return Account.from({
    access: parent,
    keyType: 'webAuthn',
    publicKey,
    async sign({ hash }: { hash: Hex }) {
      const { metadata, signature } = await OxWebAuthn.sign({ challenge: hash, credentialId: s.cred.id, rpId: rpId() })
      return SignatureEnvelope.serialize({ publicKey, metadata, signature, type: 'webAuthn' } as any)
    },
  } as any)
}

async function relayClient(account: any, cfg?: AppConfig) {
  const config = cfg ?? (await getConfig())
  const { tempo, tempoModerato } = await import('viem/chains')
  const base = config.network === 'mainnet' ? tempo : tempoModerato
  const chain = base.extend({ feeToken: config.token })
  return createClient({
    account,
    chain,
    // chain reads/sends go through the KEYCARD RPC proxy (CORS + retries for reads); fees via the relay
    transport: withRelay(http(`${API_URL}/rpc`), http(`${API_URL}/relay`), { policy: 'sign-only' }),
  })
}

/**
 * Passkey-signed transactions can take a long time to approve (Face ID, or a phone QR hand-off). viem's
 * default for fee-sponsored txs is an EXPIRING nonce valid ~25s; a fresh random 2D nonce lane has no expiry.
 */
function slowSignerNonce() {
  const r = crypto.getRandomValues(new Uint8Array(24))
  let key = 1n
  for (const b of r) key = (key << 8n) | BigInt(b)
  return { nonceKey: key, nonce: 0 }
}

/** Proves control of the wallet to the KEYCARD server; stores the session token. */
export async function signIn(s: Signer, wallet: Address) {
  const { challenge } = await api<{ challenge: Hex }>('/api/auth/challenge', { body: { wallet }, auth: false })
  let body: any
  if (s.kind === 'passkey') {
    const { metadata, signature } = await OxWebAuthn.sign({ challenge, credentialId: s.cred.id, rpId: rpId() })
    body = { wallet, metadata, signature: { r: signature.r.toString(), s: signature.s.toString() } }
  } else {
    body = { wallet, keySignature: await privateKeyToAccount(s.pk).signMessage({ message: { raw: challenge } }) }
  }
  const { token } = await api<{ token: string }>('/api/auth/verify', { auth: false, body })
  setToken(token)
  return token
}

export async function tokenBalance(owner: Address): Promise<bigint> {
  const cfg = await getConfig()
  const client = await relayClient(undefined, cfg)
  const r = (await Actions.token.getBalance(client, { account: owner, token: cfg.token } as any)) as any
  return r.amount as bigint
}

/**
 * One-signature permission: the wallet signs ONLY the key authorization (one passkey prompt / no QR loop).
 * KEYCARD verifies it matches the agreed terms and activates it on-chain.
 */
async function signKeyAuthorization(s: Signer, keyId: Address, policy: any): Promise<Hex> {
  const cfg = await getConfig()
  const client = await relayClient(rootAccount(s), cfg)
  const ka = await Actions.accessKey.signAuthorization(client, { accessKey: { address: keyId, type: 'secp256k1' }, ...policy } as any)
  return KeyAuthorization.serialize(ka as any) as Hex
}

export async function signMandate(s: Signer, lineId: number, m: { keyId: Address; cap: string; periodSeconds: number; recipient: Address; expiry: number }) {
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

/** Revoke a key KEYCARD holds on the user's own wallet (mandate or guarantee). */
export async function revokeKey(s: Signer, keyId: Address) {
  const client = await relayClient(rootAccount(s))
  const r = (await Actions.accessKey.revokeSync(client, { accessKey: keyId, feePayer: true, ...slowSignerNonce() } as any)) as any
  return r.receipt.transactionHash as Hex
}

/**
 * Pay a KEYCARD merchant from the credit line. The card key can only pay the KEYCARD settlement
 * address (protocol-enforced); the memo names the merchant, who is settled by the network.
 */
export async function payWithCard(s: Signer, creditAccount: Address, merchantCode: string, amount: bigint) {
  const cfg = await getConfig()
  const client = await relayClient(accessKeyAccount(s, creditAccount), cfg)
  const memo = encodePayMemo(merchantCode)
  const r = (await Actions.token.transferSync(client, { token: cfg.token, to: cfg.settlement, amount, memo, feePayer: true, ...slowSignerNonce() } as any)) as any
  return r.receipt.transactionHash as Hex
}

/** Deliberately pay a raw address with the card: used to show the protocol refusal. */
export async function payRawAddress(s: Signer, creditAccount: Address, to: Address, amount: bigint) {
  const cfg = await getConfig()
  const client = await relayClient(accessKeyAccount(s, creditAccount), cfg)
  const r = (await Actions.token.transferSync(client, { token: cfg.token, to, amount, feePayer: true, ...slowSignerNonce() } as any)) as any
  return r.receipt.transactionHash as Hex
}

/** Human-readable reason from a Tempo keychain / TIP-20 revert. */
export function explainChainError(e: any): string {
  const s = String(e?.details ?? e?.shortMessage ?? e?.message ?? e)
  if (/CallNotAllowed/.test(s)) return 'Refused by the Tempo protocol: your card can only pay through the KEYCARD network, not a raw wallet.'
  if (/SpendingLimitExceeded/.test(s)) return 'Refused by the Tempo protocol: this is over your available limit for this period (or your card is frozen).'
  if (/KeyAlreadyRevoked|KeyExpired/.test(s)) return 'This card key is no longer active.'
  if (/InsufficientBalance/.test(s)) return 'Not enough available credit.'
  if (/NotAllowedError|AbortError|timed out or was not allowed/.test(s))
    return 'The passkey request was cancelled or timed out, or this passkey no longer exists (for example, deleted from your phone). Try again, or tap “Start over” to create a new account.'
  return s.slice(0, 200)
}

/**
 * Merchant-side: charge a customer's PHYSICAL KEYCARD (NFC chip). Tap 1 identifies the card; the chip then
 * signs the payment on tap 2. The card key can only pay the settlement address, within its own limit.
 */
export async function chargePhysicalCard(p: { merchantCode: string; amount: bigint; onStatus?: (s: string) => void }) {
  const { readCard, cardAccessKeyAccount } = await import('./halo')
  const cfg = await getConfig()
  p.onStatus?.('Customer: tap your KEYCARD')
  const card = await readCard(p.onStatus)
  const info = await api<{ creditAccount: Address; cardLimit: string }>(`/api/cards/${card.address}`, { auth: false })
  if (p.amount > BigInt(info.cardLimit)) throw new Error(`Over this card’s tap limit (${Number(info.cardLimit) / 1e6} USD).`)
  p.onStatus?.('Tap the card again to pay')
  const client = await relayClient(cardAccessKeyAccount(info.creditAccount, card.publicKey, p.onStatus), cfg)
  const r = (await Actions.token.transferSync(client, {
    token: cfg.token, to: cfg.settlement, amount: p.amount, memo: encodePayMemo(p.merchantCode), feePayer: true, ...slowSignerNonce(),
  } as any)) as any
  return r.receipt.transactionHash as Hex
}

/** Borrower-side: link a physical card to your line (card proves possession by signing a server challenge). */
export async function linkPhysicalCard(onStatus?: (s: string) => void) {
  const { cardSignDigest } = await import('./halo')
  const { digest } = await api<{ challenge: Hex; digest: Hex }>('/api/card/challenge', { method: 'POST' })
  onStatus?.('Tap your card to link it')
  const { signature, address } = await cardSignDigest(digest, onStatus)
  return api<{ cardAddress: Address; cardLimit: string }>('/api/card/link', { body: { cardAddress: address, signature } })
}

/** Re-enable a revoked auto-debit: new mandate key, one signature, KEYCARD activates it. */
export async function renewMandateFlow() {
  const s = await getSigner()
  const r = await api<{ lineId: number; mandate: { keyId: Address; cap: string; periodSeconds: number; recipient: Address; expiry: number } }>(
    '/api/lines/mandate/renew',
    { method: 'POST' },
  )
  const cfg = await getConfig()
  const policy = mandateKeyPolicy({ token: cfg.token, instalment: BigInt(r.mandate.cap), period: r.mandate.periodSeconds, repayTo: r.mandate.recipient, expiry: r.mandate.expiry })
  const keyAuthorization = await signKeyAuthorization(s, r.mandate.keyId, policy)
  return api('/api/lines/mandate/renew/confirm', { body: { keyAuthorization } })
}
