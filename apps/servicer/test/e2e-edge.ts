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
  const { Signature, PublicKey: PK, Secp256k1 } = await import('ox')
  const chipPk = generatePrivateKey()
  const chipPub = PK.toHex(Secp256k1.getPublicKey({ privateKey: chipPk }))
  const chipSign = (d: `0x${string}`) => Signature.toHex(Secp256k1.sign({ payload: d, privateKey: chipPk })) as `0x${string}`
  const chipAddr = privateKeyToAccount(chipPk).address.toLowerCase() as Address
  const cfg = await api('/api/config')
  const settle = cfg.settlement as Address
  const shop = await makeMerchant('Edge Case Store')
  const tclient = createClient({ chain, transport: http(net.rpcUrl) })

  // borrower with an EMPTY wallet
  const b = makePasskey()
  const reg = await api('/api/users', { body: { role: 'borrower', passkeyId: b.id, passkeyPublicKey: b.publicKey, residenceCountry: 'PHL', residenceConfirmed: true } })
  const wallet = reg.wallet as Address
  const token = mintSession(wallet)
  await selfVerify(wallet, 'borrower', 'nullifier-' + randomUUID())
  const incomeClient = createClient({ account: b.root, chain, transport: relayTransport })
  const prep = await api('/api/lines/prepare', { token, method: 'POST' })
  const pol = mandateKeyPolicy({ token: net.token, instalment: BigInt(prep.mandate.cap), period: prep.mandate.periodSeconds, repayTo: prep.mandate.recipient, expiry: prep.mandate.expiry })
  const ka = await Actions.accessKey.signAuthorization(incomeClient, { accessKey: { address: prep.mandate.keyId, type: 'secp256k1' }, ...pol } as any)
  await api(`/api/lines/${prep.lineId}/mandate`, { token, body: { keyAuthorization: KeyAuthorization.serialize(ka as any) } })
  const line = await api(`/api/lines/${prep.lineId}/open`, { token, method: 'POST' })
  const ch = await api('/api/card/challenge', { token, method: 'POST' })
  await api('/api/card/link', { token, body: { cardAddress: chipAddr, signature: chipSign(ch.digest) } })
  check('line open + physical card linked, wallet empty', line.status === 'active' && (await bal(wallet)) === 0n)

  const phone = createClient({ account: Account.fromHeadlessWebAuthn(b.pk, { access: line.creditAccount, rpId: 'localhost', origin: 'http://localhost:3000' } as any), chain, transport: relayTransport })
  const card = createClient({ account: Account.from({ access: line.creditAccount, keyType: 'secp256k1', publicKey: PK.fromHex(chipPub), sign: async ({ hash }: any) => chipSign(hash) } as any), chain, transport: relayTransport })
  const pay = async (cl: any, amt: string) => { try { const r = (await Actions.token.transferSync(cl, { token: net.token, to: settle, amount: u(amt), memo: encodePayMemo(shop.code), feePayer: true } as any)) as any; return r.receipt.status === 'success' ? 'OK' : 'REVERTED' } catch (e: any) { return String(e?.details ?? e?.shortMessage ?? e).slice(0, 90) } }
  const me = async () => (await api('/api/me', { token })).line

  // 1. GRACE blocks both keys
  check('spend $5 with phone', (await pay(phone, '5')) === 'OK')
  const g = await waitFor('grace', async () => { const l = await me(); return l.status === 'grace' ? l : null }, env.PERIOD_SECONDS + 90)
  check('empty wallet at statement → grace', Boolean(g), `due=${g?.amountDue}`)
  await new Promise((r) => setTimeout(r, 8000))
  check('GRACE: phone card refused on-chain', /SpendingLimitExceeded/.test(await pay(phone, '1')))
  check('GRACE: physical card refused on-chain', /SpendingLimitExceeded/.test(await pay(card, '1')))
  let lookup = ''
  try { await api(`/api/cards/${chipAddr}`) } catch (e: any) { lookup = e.message }
  check('GRACE: merchant lookup says overdue', /overdue/.test(lookup), lookup.slice(0, 80))

  // 2. PAY NOW cures, both keys restored
  let emptyErr = ''
  try { await api('/api/lines/pay-now', { token, method: 'POST' }) } catch (e: any) { emptyErr = e.message }
  check('pay-now with empty wallet explains why', /add money/.test(emptyErr), emptyErr.slice(0, 80))
  await Actions.faucet.fund(tclient, { account: wallet })
  await waitFor('funded', async () => (await bal(wallet)) > 0n, 60)
  const cured = await api('/api/lines/pay-now', { token, method: 'POST' })
  check('PAY NOW: overdue collected → active', cured.status === 'active' && cured.owed === '0', `status=${cured.status}`)
  check('restored: phone card pays again', (await pay(phone, '1')) === 'OK')
  check('restored: physical card pays again', (await pay(card, '1')) === 'OK')

  // 3. REVOKE mandate → frozen; RENEW → unfrozen
  await api('/api/lines/pay-now', { token, method: 'POST' }).catch(() => null) // clear the $2 just spent (a statement may already have)
  await Actions.accessKey.revokeSync(incomeClient, { accessKey: (await me()).repayKeyId, feePayer: true } as any)
  const fz = await waitFor('frozen', async () => { const l = await me(); return l.status === 'frozen' ? l : null }, 90)
  check('revoke auto-debit → card frozen', fz?.freezeReason === 'MandateRevoked' && fz?.mandateActive === false)
  check('FROZEN: physical card refused', /SpendingLimitExceeded/.test(await pay(card, '1')))
  const rn = await api('/api/lines/mandate/renew', { token, method: 'POST' })
  const rpol = mandateKeyPolicy({ token: net.token, instalment: BigInt(rn.mandate.cap), period: rn.mandate.periodSeconds, repayTo: rn.mandate.recipient, expiry: rn.mandate.expiry })
  const rka = await Actions.accessKey.signAuthorization(incomeClient, { accessKey: { address: rn.mandate.keyId, type: 'secp256k1' }, ...rpol } as any)
  const unfz = await api('/api/lines/mandate/renew/confirm', { token, body: { keyAuthorization: KeyAuthorization.serialize(rka as any) } })
  check('RE-ENABLE auto-debit → active, mandate live', unfz.status === 'active' && unfz.mandateActive === true)
  // 4. DEFAULT → blocked → SETTLE → new line   (empty the wallet FIRST, then spend, so the statement finds nothing)
  const drain = await bal(wallet)
  await Actions.token.transferSync(incomeClient, { token: net.token, to: privateKeyToAccount(generatePrivateKey()).address, amount: drain, feePayer: true } as any)
  check('wallet drained', (await bal(wallet)) === 0n)
  check('after re-enable: phone card pays $3', (await pay(phone, '3')) === 'OK')
  const df = await waitFor('default', async () => { const l = await me(); return l.status === 'defaulted' ? l : null }, env.PERIOD_SECONDS + env.GRACE_SECONDS + 150)
  check('no money, no guarantor → DEFAULTED', Boolean(df), `unpaid=${df?.amountDue}`)
  check('DEFAULT: physical card refused', /SpendingLimitExceeded|InsufficientBalance/.test(await pay(card, '1')))
  let newLineErr = ''
  try { await api('/api/lines/prepare', { token, method: 'POST' }) } catch (e: any) { newLineErr = e.message }
  check('new line refused until settled', /settle/.test(newLineErr), newLineErr.slice(0, 70))
  await Actions.faucet.fund(tclient, { account: wallet })
  await waitFor('funded2', async () => (await bal(wallet)) > 0n, 60)
  const st = await api('/api/lines/pay-now', { token, method: 'POST' })
  check('PAY TO SETTLE → settled', st.status === 'settled', `status=${st.status}`)
  const p2 = await api('/api/lines/prepare', { token, method: 'POST' })
  check('after settling: a NEW line can be prepared (identity re-attested)', p2.lineId > prep.lineId, `new line ${p2.lineId}`)

  console.log(`\n${results.filter((r) => r.startsWith('PASS')).length}/${results.length} checks passed`)
  await sql.end()
}
main().catch(async (e) => { console.error('EDGE E2E FATAL', e); process.exitCode = 1; await sql.end() })
