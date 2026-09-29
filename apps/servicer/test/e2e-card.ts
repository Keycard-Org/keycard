/**
 * End-to-end test against a RUNNING servicer on Tempo testnet. Real transactions, real relay,
 * real scheduler/watcher. Only the phone is simulated (headless WebAuthn signer) and the Self
 * webhook is signed with the test webhook secret the servicer is configured with.
 *
 *   TEMPO_NETWORK=testnet PERIOD_SECONDS=90 GRACE_SECONDS=60 SELF_WEBHOOK_SECRET=whsec_... \
 *   SELF_FLOW_ID_BORROWER=flow-b SELF_FLOW_ID_GUARANTOR=flow-g SELF_API_KEY=sk_test_x npx tsx src/main.ts
 *   ... then in another shell with the same env:  npx tsx test/e2e.ts
 */
import { randomUUID } from 'node:crypto'
import { createClient, http, parseUnits, type Address, type Hex } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { Account, Actions, withRelay } from 'viem/tempo'
import { KeyAuthorization } from 'ox/tempo'
import { P256, PublicKey } from 'ox'
import { Webhook } from 'svix'
import { mandateKeyPolicy, guaranteeKeyPolicy, encodePayMemo } from '@keycard/sdk'
import { env, net } from '../src/config'
import { sql } from '../src/db'
import { mintSession } from '../src/auth'

const API = `http://localhost:${env.PORT}`
const u = (n: string) => parseUnits(n, 6)
const chain = net.chain.extend({ feeToken: net.feeToken })
const relayTransport = withRelay(http(net.rpcUrl), http(`${API}/relay`), { policy: 'sign-only' })
const sleep = (s: number) => new Promise((r) => setTimeout(r, s * 1000))
const results: string[] = []
function check(name: string, ok: boolean, detail = '') {
  const line = `${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`
  console.log(line)
  results.push(line)
  if (!ok) process.exitCode = 1
}

async function api(path: string, opts: { method?: string; body?: unknown; token?: string } = {}) {
  const r = await fetch(API + path, {
    method: opts.method ?? (opts.body ? 'POST' : 'GET'),
    headers: { 'Content-Type': 'application/json', ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  })
  const j = await r.json()
  if (!r.ok) throw new Error(`${path} ${r.status} ${JSON.stringify(j)}`)
  return j
}

function makePasskey() {
  const pk = P256.randomPrivateKey()
  const publicKey = PublicKey.toHex(P256.getPublicKey({ privateKey: pk })) as Hex
  const root = Account.fromHeadlessWebAuthn(pk, { rpId: 'localhost', origin: 'http://localhost:3000' } as any)
  return { pk, publicKey, root, id: randomUUID() }
}

async function selfVerify(wallet: Address, role: 'borrower' | 'guarantor', nullifier: string) {
  const externalUuid = randomUUID()
  const flowId = role === 'guarantor' ? env.SELF_FLOW_ID_GUARANTOR! : env.SELF_FLOW_ID_BORROWER!
  await sql`INSERT INTO self_sessions (id, wallet, role, status, external_uuid, flow_id) VALUES (${'sess_' + externalUuid}, ${wallet}, ${role}, 'pending', ${externalUuid}, ${flowId})`
  const payload = JSON.stringify({
    type: 'verification.completed', verification_id: randomUUID(), external_uuid: externalUuid, flow_id: flowId,
    flow_version_id: 'v1', environment: 'test', status: 'valid', product: 'pre_kyc',
    proof_attributes: role === 'guarantor' ? { nationality: 'PHL' } : {}, proof: null, nullifier,
    verified_at: new Date().toISOString(), storage_state: 'skipped', storage_uri: null,
  })
  const id = 'msg_' + randomUUID()
  const ts = new Date()
  const sig = new Webhook(env.SELF_WEBHOOK_SECRET!).sign(id, ts, payload)
  const r = await fetch(`${API}/api/self/webhook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'svix-id': id, 'svix-timestamp': String(Math.floor(ts.getTime() / 1000)), 'svix-signature': sig },
    body: payload,
  })
  return r.ok
}

const bal = async (a: Address) =>
  ((await Actions.token.getBalance(createClient({ chain, transport: http(net.rpcUrl) }), { account: a, token: net.token } as any)) as any).amount as bigint

async function waitFor<T>(label: string, fn: () => Promise<T | null | undefined | false>, timeoutS: number): Promise<T | null> {
  const t0 = Date.now()
  while ((Date.now() - t0) / 1000 < timeoutS) {
    const v = await fn()
    if (v) return v as T
    await sleep(5)
  }
  console.log(`timeout waiting for ${label}`)
  return null
}

if (process.env.E2E_TRACE) {
  const f = globalThis.fetch
  globalThis.fetch = (async (url: any, init: any) => {
    const r = await f(url, init)
    const t = await r.clone().text()
    try { JSON.parse(t) } catch { console.log('NON-JSON', String(url), r.status, t.slice(0, 200), String(init?.body ?? '').slice(0, 200)) }
    return r
  }) as any
}


async function makeMerchant(label: string) {
  const mk = makePasskey()
  const r = await api('/api/users', { body: { role: 'merchant', passkeyId: mk.id, passkeyPublicKey: mk.publicKey, residenceCountry: 'PHL', residenceConfirmed: true } })
  await selfVerify(r.wallet, 'borrower', 'nullifier-' + randomUUID())
  const t = mintSession(r.wallet)
  const m = await api('/api/merchants', { token: t, body: { label } })
  return { ...m, wallet: r.wallet as Address }
}

async function main() {
  // PHYSICAL CARD: a software secp256k1 key signing RAW digests stands in for the HaLo chip (slot 1)
  const { Signature, PublicKey: PK, Secp256k1 } = await import('ox')
  const chipPk = generatePrivateKey()
  const chipPub = PK.toHex(Secp256k1.getPublicKey({ privateKey: chipPk }))
  const chipSign = (digest: `0x${string}`) => Signature.toHex(Secp256k1.sign({ payload: digest, privateKey: chipPk })) as `0x${string}`
  const chipAddr = privateKeyToAccount(chipPk).address.toLowerCase() as Address

  const cfg = await api('/api/config')
  const settle = cfg.settlement as Address
  const shop = await makeMerchant('Card Test Cafe')
  const b = makePasskey()
  const reg = await api('/api/users', { body: { role: 'borrower', passkeyId: b.id, passkeyPublicKey: b.publicKey, residenceCountry: 'PHL', residenceConfirmed: true } })
  const wallet = reg.wallet as Address
  const token = mintSession(wallet)
  await selfVerify(wallet, 'borrower', 'nullifier-' + randomUUID())
  const prep = await api('/api/lines/prepare', { token, method: 'POST' })
  const pol = mandateKeyPolicy({ token: net.token, instalment: BigInt(prep.mandate.cap), period: prep.mandate.periodSeconds, repayTo: prep.mandate.recipient, expiry: prep.mandate.expiry })
  await Actions.accessKey.authorizeSync(createClient({ account: b.root, chain, transport: relayTransport }), { accessKey: { address: prep.mandate.keyId, type: 'secp256k1' }, ...pol, feePayer: true } as any)
  const line = await api(`/api/lines/${prep.lineId}/open`, { token, method: 'POST' })
  check('line open', line.status === 'active')

  // link: card signs the server challenge digest
  const ch = await api('/api/card/challenge', { token, method: 'POST' })
  let wrong = false
  try { await api('/api/card/link', { token, body: { cardAddress: chipAddr, signature: chipSign('0x' + 'ab'.repeat(32) as any) } }) } catch { wrong = true }
  check('link refused when card signed the wrong digest', wrong)
  const ch2 = await api('/api/card/challenge', { token, method: 'POST' })
  const linked = await api('/api/card/link', { token, body: { cardAddress: chipAddr, signature: chipSign(ch2.digest) } })
  check('card linked with its own limit', linked.cardAddress === chipAddr && linked.cardLimit === u('10').toString(), `limit=${linked.cardLimit}`)
  void ch

  // merchant phone: lookup by card address, then the chip signs the tx
  const info = await api(`/api/cards/${chipAddr}`)
  check('merchant lookup finds the credit account', info.creditAccount.toLowerCase() === line.creditAccount.toLowerCase())
  const chipAccount = Account.from({ access: info.creditAccount, keyType: 'secp256k1', publicKey: PK.fromHex(chipPub), sign: async ({ hash }: any) => chipSign(hash) } as any)
  const cardClient = createClient({ account: chipAccount, chain, transport: relayTransport })
  const pay = (await Actions.token.transferSync(cardClient, { token: net.token, to: settle, amount: u('6'), memo: encodePayMemo(shop.code), feePayer: true } as any)) as any
  check('tap-to-pay $6 signed by the chip key', pay.receipt.status === 'success', pay.receipt.transactionHash)
  const settled = await waitFor('settled', async () => { const [p] = await sql`SELECT * FROM payments WHERE pay_tx=${pay.receipt.transactionHash} AND status='settled'`; return p }, 60)
  check('merchant settled', Boolean(settled))
  let over = ''
  try { await Actions.token.transferSync(cardClient, { token: net.token, to: settle, amount: u('5'), memo: encodePayMemo(shop.code), feePayer: true } as any) } catch (e: any) { over = String(e?.details ?? e?.shortMessage) }
  check('card REFUSED over its $10 tap limit (protocol)', /SpendingLimitExceeded/.test(over), over.slice(0, 80))

  // freeze
  await api('/api/card/freeze', { token, method: 'POST' })
  let frozen = ''
  try { await Actions.token.transferSync(cardClient, { token: net.token, to: settle, amount: u('1'), memo: encodePayMemo(shop.code), feePayer: true } as any) } catch (e: any) { frozen = String(e?.details ?? e?.shortMessage) }
  check('frozen card REFUSED by protocol', /KeyAlreadyRevoked|KeyNotFound|revoked/i.test(frozen), frozen.slice(0, 80))
  let gone = false
  try { await api(`/api/cards/${chipAddr}`) } catch { gone = true }
  check('frozen card no longer resolves for merchants', gone)

  console.log(`\n${results.filter((r) => r.startsWith('PASS')).length}/${results.length} checks passed`)
  await sql.end()
}
main().catch(async (e) => { console.error('CARD E2E FATAL', e); process.exitCode = 1; await sql.end() })
