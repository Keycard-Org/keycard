// Creates operator keys for a network into ../../.env.<network> (gitignored). Refuses to overwrite.
import { existsSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { randomBytes } from 'node:crypto'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'

const network = process.argv[2] ?? 'testnet'
if (network === 'mainnet') throw new Error('mainnet keys are provided by the operator (TEMPO_PK), not generated here')
const file = resolve(import.meta.dirname, `../../../.env.${network}`)
if (existsSync(file)) throw new Error(`${file} exists; refusing to overwrite`)
const k = () => generatePrivateKey()
const treasury = k(), attester = k(), servicer = k(), repayTo = k(), recovery = k()
const lines = [
  `TEMPO_NETWORK=${network}`,
  `TREASURY_PK=${treasury}`,
  `ATTESTER_PK=${attester}`,
  `SERVICER_PK=${servicer}`,
  `REPAY_PK=${repayTo}`,
  `RECOVERY_PK=${recovery}`,
  `KEY_ENC_SECRET=${randomBytes(32).toString('base64')}`,
  `PERIOD_SECONDS=600`,
  `GRACE_SECONDS=300`,
]
writeFileSync(file, lines.join('\n') + '\n', { mode: 0o600 })
for (const [n, pk] of Object.entries({ treasury, attester, servicer, repayTo, recovery }))
  console.log(n.padEnd(10), privateKeyToAccount(pk).address)
console.log('wrote', file)
