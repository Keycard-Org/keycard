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
  // DEFAULT PATH: borrower spends, has no income to repay; guarantor covers after grace; card frozen.
  const cfg = await api('/api/config')
  const settle = cfg.settlement as Address
  const shop = await makeMerchant('Default-path Shop')
  const b = makePasskey()
  const reg = await api('/api/users', { body: { role: 'borrower', passkeyId: b.id, passkeyPublicKey: b.publicKey, residenceCountry: 'MEX', residenceConfirmed: true } })
  const wallet = reg.wallet as Address
  const token = mintSession(wallet)
  await selfVerify(wallet, 'borrower', 'nullifier-' + randomUUID())
  const prep = await api('/api/lines/prepare', { token, method: 'POST' })
  const incomeClient = createClient({ account: b.root, chain, transport: relayTransport })
  const pol = mandateKeyPolicy({ token: net.token, instalment: BigInt(prep.mandate.cap), period: prep.mandate.periodSeconds, repayTo: prep.mandate.recipient, expiry: prep.mandate.expiry })
  await Actions.accessKey.authorizeSync(incomeClient, { accessKey: { address: prep.mandate.keyId, type: 'secp256k1' }, ...pol, feePayer: true } as any)
  const line = await api(`/api/lines/${prep.lineId}/open`, { token, method: 'POST' })
  check('line opened with an EMPTY income wallet', line.status === 'active' && (await bal(wallet)) === 0n)

  // guarantor
  const g = makePasskey()
  const greg = await api('/api/users', { body: { role: 'guarantor', passkeyId: g.id, passkeyPublicKey: g.publicKey, residenceCountry: 'USA', residenceConfirmed: true } })
  const gtoken = mintSession(greg.wallet)
  await selfVerify(greg.wallet, 'guarantor', 'nullifier-' + randomUUID())
  await Actions.faucet.fund(createClient({ chain, transport: http(net.rpcUrl) }), { account: greg.wallet })
  await waitFor('guarantor funded', async () => (await bal(greg.wallet)) > 0n, 60)
  const inv = await api('/api/guarantee/invite', { token, body: { requested: u('15').toString() } })
  const gprep = await api(`/api/guarantee/${inv.inviteId}/prepare`, { token: gtoken, body: { monthlyIncome: u('2000').toString(), monthlyObligations: u('0').toString() } })
  const gpol = guaranteeKeyPolicy({ token: net.token, cap: BigInt(gprep.key.cap), recoveryTo: gprep.key.recipient, expiry: gprep.key.expiry })
  await Actions.accessKey.authorizeSync(createClient({ account: g.root, chain, transport: relayTransport }), { accessKey: { address: gprep.key.keyId, type: 'secp256k1' }, ...gpol, feePayer: true } as any)
  const gl = await api(`/api/guarantee/${inv.inviteId}/confirm`, { token: gtoken, body: { consentHash: gprep.consentHash } })
  check('guarantee of $15 attached', gl.guaranteed === u('15').toString(), `limit=${gl.limit}`)

  // borrower spends $12 and cannot repay
  const spendKey = Account.fromHeadlessWebAuthn(b.pk, { access: line.creditAccount, rpId: 'localhost', origin: 'http://localhost:3000' } as any)
  const s1 = (await Actions.token.transferSync(createClient({ account: spendKey, chain, transport: relayTransport }), { token: net.token, to: settle, amount: u('12'), memo: encodePayMemo(shop.code), feePayer: true } as any)) as any
  check('borrower spent $12', s1.receipt.status === 'success')

  const grace = await waitFor('grace', async () => { const x = await api('/api/me', { token }); return x.line.status === 'grace' ? x : null }, env.PERIOD_SECONDS + 120)
  check('missed payment -> grace', Boolean(grace), `amountDue=${grace?.line.amountDue}`)

  const gBefore = await bal(greg.wallet)
  const after = await waitFor('guarantor pull', async () => { const x = await api('/api/me', { token }); return ['frozen', 'defaulted'].includes(x.line.status) ? x : null }, env.GRACE_SECONDS + 150)
  const gAfter = await bal(greg.wallet)
  check('guarantor charged exactly $12 (the unpaid amount)', gBefore - gAfter === u('12'), `status=${after?.line.status}`)
  check('borrower card frozen after family covered it', after?.line.status === 'frozen')
  const [pull] = await sql`SELECT tx_hash FROM movements WHERE line_id=${prep.lineId} AND kind='GUAR' AND status='confirmed'`
  check('guarantor pull recorded with tx', Boolean(pull?.tx_hash), pull?.tx_hash)

  console.log(`\n${results.filter((r) => r.startsWith('PASS')).length}/${results.length} checks passed`)
  await sql.end()
}
main().catch(async (e) => {
  console.error('E2E FATAL', e)
  process.exitCode = 1
  await sql.end()
})
