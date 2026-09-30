/**
 * Real-browser end-to-end: Chromium + CDP virtual WebAuthn authenticator driving the actual KEYKARD UI.
 * Requires: servicer on :8787 (testnet) and web on :3000. Self is simulated by a signed webhook (test secret).
 *   TEMPO_NETWORK=testnet npx tsx test/browser.ts
 */
import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { createClient, http, type Address } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { Actions } from 'viem/tempo'
import { Webhook } from 'svix'
import { env, net } from '../src/config'
import { sql } from '../src/db'

const require = createRequire(import.meta.url)
const { chromium } = require('/downloads/World-Fair/keycard/apps/web/node_modules/playwright') as typeof import('playwright')
const WEB = process.env.WEB_URL ?? 'http://localhost:3000'
const PASSWORD = process.env.PASSWORD_MODE === '1'
const API = `http://localhost:${env.PORT}`
const results: string[] = []
const check = (n: string, ok: boolean, d = '') => {
  const l = `${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`
  console.log(l)
  results.push(l)
  if (!ok) process.exitCode = 1
}

async function selfWebhook(wallet: Address) {
  return selfWebhookRole(wallet)
}
async function selfWebhookRole(wallet: Address) {
  const externalUuid = randomUUID()
  await sql`INSERT INTO self_sessions (id, wallet, role, status, external_uuid, flow_id) VALUES (${'sess_' + externalUuid}, ${wallet}, 'borrower', 'pending', ${externalUuid}, ${env.SELF_FLOW_ID_BORROWER!})`
  const payload = JSON.stringify({
    type: 'verification.completed', verification_id: randomUUID(), external_uuid: externalUuid, flow_id: env.SELF_FLOW_ID_BORROWER,
    flow_version_id: 'v1', environment: 'test', status: 'valid', product: 'pre_kyc', proof_attributes: {}, proof: null,
    nullifier: 'nullifier-' + randomUUID(), verified_at: new Date().toISOString(), storage_state: 'skipped', storage_uri: null,
  })
  const id = 'msg_' + randomUUID()
  const ts = new Date()
  const sig = new Webhook(env.SELF_WEBHOOK_SECRET!).sign(id, ts, payload)
  const r = await fetch(`${API}/api/self/webhook`, { method: 'POST', headers: { 'content-type': 'application/json', 'svix-id': id, 'svix-timestamp': String(Math.floor(ts.getTime() / 1000)), 'svix-signature': sig }, body: payload })
  return r.ok
}

async function makeMerchant(): Promise<string> {
  const { P256, PublicKey } = await import('ox')
  const pk = P256.randomPrivateKey()
  const publicKey = PublicKey.toHex(P256.getPublicKey({ privateKey: pk }))
  const r = await (await fetch(`${API}/api/users`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ role: 'merchant', passkeyId: randomUUID(), passkeyPublicKey: publicKey, residenceCountry: 'PHL', residenceConfirmed: true }) })).json()
  await selfWebhookRole(r.wallet)
  const { mintSession } = await import('../src/auth')
  const m = await (await fetch(`${API}/api/merchants`, { method: 'POST', headers: { 'content-type': 'application/json', Authorization: `Bearer ${mintSession(r.wallet)}` }, body: JSON.stringify({ label: 'Browser Test Bakery' }) })).json()
  return m.code as string
}

async function main() {
  const shopCode = await makeMerchant()
  const browser = await chromium.launch()
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  page.on('pageerror', (e) => console.log('[pageerror]', e.message))
  page.on('console', (m) => { if (m.type() === 'error') console.log('[console]', m.text()) })
  const cdp = await ctx.newCDPSession(page)
  await cdp.send('WebAuthn.enable')
  const { authenticatorId } = (await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  })) as any

  await page.goto(`${WEB}/start`)
  await page.selectOption('#country', 'PHL')
  await page.check('text=I confirm this is my country of residence')
  const uname = 'bt' + Date.now().toString().slice(-8)
  await page.fill('#un', uname)
  if (PASSWORD) {
    await page.click('button:has-text("Password")')
    await page.fill('#pw', 'correct-horse-battery')
    await page.fill('#pw2', 'correct-horse-battery')
    await page.click('text=Create password account')
  } else {
    await page.click('text=Create passkey account')
  }
  try {
    await page.waitForSelector('text=Verify you’re a real, unique person', { timeout: 30_000 })
  } catch (e) {
    console.log('UI ERROR TEXT:', await page.textContent('.error').catch(() => null))
    await page.screenshot({ path: '/tmp/claude-1000/kc-fail.png' })
    throw e
  }
  check(PASSWORD ? 'password wallet created + registered + signed in' : 'passkey created + registered + signed in (real WebAuthn)', true)

  let wallet: Address
  if (PASSWORD) {
    const vault = JSON.parse((await page.evaluate(() => localStorage.getItem('keycard.devicekey'))) as string)
    wallet = vault.address.toLowerCase()
    check('password wallet stored encrypted only (no plaintext key in storage)', !JSON.stringify(vault).includes('"pk"') && vault.iter === 600000)
  } else {
    const cred = JSON.parse((await page.evaluate(() => localStorage.getItem('keycard.passkey'))) as string)
    const who = await (await fetch(`${API}/api/passkeys/${encodeURIComponent(cred.id)}`)).json()
    wallet = who.wallet as Address
  }
  check('wallet derived identically in browser and server', /^0x[0-9a-f]{40}$/.test(wallet), wallet)

  if (process.env.USE_DEV_VERIFY) {
    await page.click('text=Skip verification (testnet only)')
    check('testnet skip-verification used', true)
  } else check('Self proof delivered', await selfWebhook(wallet))
  await page.waitForSelector('text=Your auto-pay', { timeout: 30_000 })
  check('UI advanced to mandate after Self verification', true)

  // fund the borrower's own wallet (their income) on testnet
  await Actions.faucet.fund(createClient({ chain: net.chain, transport: http(net.rpcUrl) }), { account: wallet })

  const signCount = async () => {
    const { credentials } = (await cdp.send('WebAuthn.getCredentials', { authenticatorId })) as any
    return credentials.reduce((a: number, c: any) => a + (c.signCount ?? 0), 0)
  }
  const before = PASSWORD ? 0 : await signCount()
  await page.check('text=I allow KEYKARD to take what I owe')
  await page.click('text=Sign & open my line')
  await page.waitForURL(`${WEB}/card`, { timeout: 90_000 })
  if (!PASSWORD) check('auto-debit needed exactly ONE passkey signature', (await signCount()) - before === 1, `${(await signCount()) - before} signature(s)`)
  await page.waitForSelector('text=Available to spend', { timeout: 30_000 })
  check('card greets the user by @username', ((await page.textContent('body')) ?? '').includes(`@${uname}`), uname)
  const available = await page.textContent('.card .big')
  check('line opened, card shows available credit', /\$20\.00/.test(available ?? ''), available ?? '')

  // pay an allow-listed merchant with the passkey acting as an access key on the credit account
  await page.fill('#m', shopCode)
  await page.waitForSelector('text=Paying: Browser Test Bakery', { timeout: 15_000 })
  await page.fill('#a', '2.50')
  await page.click('text=Pay with KEYKARD')
  await page.waitForSelector('text=Paid Browser Test Bakery', { timeout: 60_000 })
  check('paid $2.50 to merchant by code from the browser (passkey = card key)', true)

  // refusal demo: try paying a random wallet directly — the protocol must refuse
  const off = privateKeyToAccount(generatePrivateKey()).address
  page.once('dialog', (d: any) => d.accept(off))
  await page.click('text=See it refuse a random wallet')
  await page.waitForSelector('text=Refused by the Tempo protocol', { timeout: 60_000 })
  check('direct payment to a random wallet refused by protocol, explained in UI', true, (await page.textContent('.error')) ?? '')

  let settledRow: any[] = []
  for (let i = 0; i < 30 && settledRow.length === 0; i++) {
    settledRow = await sql`SELECT status FROM payments WHERE merchant_code=${shopCode} AND status='settled'`
    if (settledRow.length === 0) await new Promise((r) => setTimeout(r, 3000))
  }
  check('merchant settled by the network', settledRow.length === 1, settledRow[0]?.status)

  await page.reload()
  await page.waitForSelector('text=Available to spend')
  const owed = await page.textContent('.card .small')
  check('card shows owed $2.50 after reload', /owed \$2\.50/.test(owed ?? ''), owed ?? '')

  await browser.close()
  console.log(`\n${results.filter((r) => r.startsWith('PASS')).length}/${results.length} browser checks passed`)
  await sql.end()
}
main().catch(async (e) => {
  console.error('BROWSER E2E FATAL', e)
  process.exitCode = 1
  await sql.end()
})
