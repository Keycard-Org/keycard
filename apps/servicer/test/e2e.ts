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
  const cfg = await api('/api/config')
  const settle = cfg.settlement as Address
  const shop = await makeMerchant('E2E Sari-Sari Store')
  check('merchant registered with code', /^[A-Z2-9]{6}$/.test(shop.code), shop.code)
  const offList = privateKeyToAccount(generatePrivateKey()).address as Address

  // ---- borrower signs up ----
  const b = makePasskey()
  const reg = await api('/api/users', { body: { role: 'borrower', passkeyId: b.id, passkeyPublicKey: b.publicKey, residenceCountry: 'PHL', residenceConfirmed: true } })
  const wallet = reg.wallet as Address
  check('borrower wallet derived from passkey', wallet === b.root.address.toLowerCase(), wallet)
  const excl: string[] = cfg.excludedCountries
  if (excl.length > 0) {
    let refused = false
    try { await api('/api/users', { body: { role: 'borrower', passkeyId: 'x'.repeat(10), passkeyPublicKey: makePasskey().publicKey, residenceCountry: excl[0], residenceConfirmed: true } }) } catch { refused = true }
    check(`residents of excluded country ${excl[0]} refused at signup`, refused)
  } else {
    const r = await api('/api/users', { body: { role: 'borrower', passkeyId: randomUUID(), passkeyPublicKey: makePasskey().publicKey, residenceCountry: 'IND', residenceConfirmed: true } })
    check('no country restriction (hackathon pilot): IND resident can sign up', /^0x[0-9a-f]{40}$/.test(r.wallet))
  }
  const token = mintSession(wallet) // browser path uses /api/auth/verify with a real WebAuthn assertion

  check('Self webhook accepted', await selfVerify(wallet, 'borrower', 'nullifier-' + randomUUID()))
  const me = await api('/api/me', { token })
  check('identity verified + attested on-chain', me.identity.verified === true, me.identity.attestationTx)

  // borrower brings their own income (testnet faucet stands in for their salary)
  await Actions.faucet.fund(createClient({ chain, transport: http(net.rpcUrl) }), { account: wallet })
  await waitFor('income funded', async () => (await bal(wallet)) > 0n, 60)

  // ---- mandate ----
  const prep = await api('/api/lines/prepare', { token, method: 'POST' })
  const incomeClient = createClient({ account: b.root, chain, transport: relayTransport })
  const pol = mandateKeyPolicy({ token: net.token, instalment: BigInt(prep.mandate.cap), period: prep.mandate.periodSeconds, repayTo: prep.mandate.recipient, expiry: prep.mandate.expiry })
  const incomeBefore = await bal(wallet)
  const auth = (await Actions.accessKey.authorizeSync(incomeClient, { accessKey: { address: prep.mandate.keyId, type: 'secp256k1' }, ...pol, feePayer: true } as any)) as any
  check('borrower signed mandate via passkey, fee sponsored by relay', auth.receipt.status === 'success', auth.receipt.transactionHash)
  check('borrower paid zero fees', (await bal(wallet)) === incomeBefore)

  const line = await api(`/api/lines/${prep.lineId}/open`, { token, method: 'POST' })
  check('line opened', line.status === 'active' && line.linebookId > 0, `limit=${line.limit} available=${line.available}`)

  // ---- spend with the passkey (access key on the credit account) ----
  const spendKey = Account.fromHeadlessWebAuthn(b.pk, { access: line.creditAccount, rpId: 'localhost', origin: 'http://localhost:3000' } as any)
  const spendClient = createClient({ account: spendKey, chain, transport: relayTransport })
  const s1 = (await Actions.token.transferSync(spendClient, { token: net.token, to: settle, amount: u('7'), memo: encodePayMemo(shop.code), feePayer: true } as any)) as any
  check('card pays merchant $7 through the KEYKARD network', s1.receipt.status === 'success', s1.receipt.transactionHash)
  const settled = await waitFor('merchant settlement', async () => {
    const [p] = await sql`SELECT * FROM payments WHERE pay_tx=${s1.receipt.transactionHash} AND status='settled' AND settle_tx IS NOT NULL`
    return p
  }, 60)
  check('merchant settled $7 by the network', Boolean(settled) && (await bal(shop.wallet)) === u('7'), settled?.settle_tx)
  let offErr = ''
  try { await Actions.token.transferSync(spendClient, { token: net.token, to: offList, amount: u('1'), feePayer: true } as any) } catch (e: any) { offErr = String(e?.details ?? e?.shortMessage ?? e) }
  check('card REFUSED at off-list address (protocol)', /CallNotAllowed/.test(offErr), offErr.slice(0, 90))
  let overErr = ''
  try { await Actions.token.transferSync(spendClient, { token: net.token, to: settle, amount: u('14'), memo: encodePayMemo(shop.code), feePayer: true } as any) } catch (e: any) { overErr = String(e?.details ?? e?.shortMessage ?? e) }
  check('card REFUSED over available credit', overErr.length > 0, overErr.slice(0, 90))

  // ---- statement + auto-debit ----
  const inst = await waitFor('first instalment', async () => {
    const [m] = await sql`SELECT * FROM movements WHERE line_id=${prep.lineId} AND kind='INST' AND status='confirmed' LIMIT 1`
    return m
  }, env.PERIOD_SECONDS + 120)
  check('auto-debit pulled exactly what was owed ($7)', Boolean(inst) && BigInt(inst!.amount) === u('7'), inst?.tx_hash)
  const afterPull = await waitFor('credit top-up', async () => {
    const x = await api('/api/me', { token })
    return x.line.owed === '0' ? x : null
  }, 45)
  check('credit restored after repayment', Boolean(afterPull), `available=${afterPull?.line.available}`)

  // second on-time period -> tier upgrade ($20 -> $50)
  try {
    await Actions.token.transferSync(spendClient, { token: net.token, to: settle, amount: u('3'), memo: encodePayMemo(shop.code), feePayer: true } as any)
  } catch (e: any) {
    console.log('SECOND SPEND ERROR details:', e?.details, '| cause:', e?.cause?.details ?? e?.cause?.shortMessage)
    throw e
  }
  const upgraded = await waitFor('limit upgrade', async () => {
    const m = await api('/api/me', { token })
    return m.line.limit === u('50').toString() ? m : null
  }, env.PERIOD_SECONDS + 150)
  check('limit raised to $50 after 2 on-time repayments', Boolean(upgraded))

  // ---- guarantor ----
  const g = makePasskey()
  const greg = await api('/api/users', { body: { role: 'guarantor', passkeyId: g.id, passkeyPublicKey: g.publicKey, residenceCountry: 'ARE', residenceConfirmed: true } })
  const gtoken = mintSession(greg.wallet)
  check('guarantor Self webhook accepted', await selfVerify(greg.wallet, 'guarantor', 'nullifier-' + randomUUID()))
  await Actions.faucet.fund(createClient({ chain, transport: http(net.rpcUrl) }), { account: greg.wallet })
  await waitFor('guarantor funded', async () => (await bal(greg.wallet)) > 0n, 60)
  const inv = await api('/api/guarantee/invite', { token, body: { requested: u('30').toString() } })
  const gprep = await api(`/api/guarantee/${inv.inviteId}/prepare`, { token: gtoken, body: { monthlyIncome: u('1500').toString(), monthlyObligations: u('500').toString() } })
  check('affordability cap computed', BigInt(gprep.cap) === u('30'), `cap=${gprep.cap} max=${gprep.maxAllowed}`)
  const gpol = guaranteeKeyPolicy({ token: net.token, cap: BigInt(gprep.key.cap), recoveryTo: gprep.key.recipient, expiry: gprep.key.expiry })
  const gClient = createClient({ account: g.root, chain, transport: relayTransport })
  // one-signature flow (same as the app): guarantor signs ONLY the key authorization; KEYKARD verifies + activates
  const gka = await Actions.accessKey.signAuthorization(gClient, { accessKey: { address: gprep.key.keyId, type: 'secp256k1' }, ...gpol } as any)
  const bad = { ...(gka as any), limits: [{ ...(gka as any).limits[0], limit: BigInt(gprep.key.cap) * 10n }] }
  let tampered = false
  try { await api(`/api/guarantee/${inv.inviteId}/key`, { token: gtoken, body: { keyAuthorization: KeyAuthorization.serialize(bad) } }) } catch { tampered = true }
  check('tampered guarantee (10x cap) rejected by KEYKARD before touching the chain', tampered)
  const gact = await api(`/api/guarantee/${inv.inviteId}/key`, { token: gtoken, body: { keyAuthorization: KeyAuthorization.serialize(gka as any) } })
  check('guarantor signed capped guarantee key (one signature, activated by KEYKARD)', Boolean(gact.ok), gact.tx)
  const gl = await api(`/api/guarantee/${inv.inviteId}/confirm`, { token: gtoken, body: { consentHash: gprep.consentHash } })
  check('guarantee attached, limit raised to $100', gl.guaranteed === u('30').toString() && gl.limit === u('100').toString(), `limit=${gl.limit}`)

  // ---- borrower revokes mandate -> card freezes ----
  const rv = (await Actions.accessKey.revokeSync(incomeClient, { accessKey: prep.mandate.keyId, feePayer: true } as any)) as any
  check('borrower revoked mandate', rv.receipt.status === 'success', rv.receipt.transactionHash)
  const frozen = await waitFor('freeze', async () => {
    const m = await api('/api/me', { token })
    return m.line.status === 'frozen' ? m : null
  }, 90)
  check('card frozen after mandate revocation', Boolean(frozen), frozen?.line.freezeReason)
  let frozenErr = ''
  try { await Actions.token.transferSync(spendClient, { token: net.token, to: settle, amount: u('1'), memo: encodePayMemo(shop.code), feePayer: true } as any) } catch (e: any) { frozenErr = String(e?.details ?? e?.shortMessage ?? e) }
  check('frozen card REFUSED by protocol', /SpendingLimitExceeded/.test(frozenErr), frozenErr.slice(0, 90))

  const stats = await api('/api/stats')
  console.log('\nSTATS', JSON.stringify(stats.lines), 'spent', stats.spent, 'repaid', stats.repaid)
  console.log(`\n${results.filter((r) => r.startsWith('PASS')).length}/${results.length} checks passed`)
  await sql.end()
}
main().catch(async (e) => {
  console.error('E2E FATAL', e)
  process.exitCode = 1
  await sql.end()
})
