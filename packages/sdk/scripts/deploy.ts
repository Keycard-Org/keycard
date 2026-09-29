// Deploys KeycardRegistry + LineBook to Tempo and writes deployments/<network>.json.
//   pnpm --filter @keycard/sdk deploy testnet
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createClient, http, type Hex } from 'viem'
import { deployContract, waitForTransactionReceipt } from 'viem/actions'
import { Account, Actions } from 'viem/tempo'
import { getNetwork, keycardRegistryAbi, keycardRegistryBytecode, lineBookAbi, lineBookBytecode } from '../src/index'

const networkName = process.argv[2] ?? 'testnet'
const env = Object.fromEntries(
  readFileSync(resolve(import.meta.dirname, `../../../.env.${networkName}`), 'utf8')
    .split('\n').filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
)
const net = getNetwork(networkName)
const chain = net.chain.extend({ feeToken: net.feeToken })
const treasury = Account.fromSecp256k1(env.TREASURY_PK as Hex)
const attester = Account.fromSecp256k1(env.ATTESTER_PK as Hex)
const servicer = Account.fromSecp256k1(env.SERVICER_PK as Hex)
const client = createClient({ account: treasury, chain, transport: http(net.rpcUrl) })

const bal = async (a: `0x${string}`) =>
  ((await Actions.token.getBalance(client, { account: a, token: net.token } as any)) as any).amount as bigint

async function main() {
  if (networkName === 'testnet') {
    for (const a of [treasury, attester, servicer]) {
      if ((await bal(a.address)) === 0n) {
        await Actions.faucet.fund(client, { account: a.address })
        console.log('faucet ->', a.address)
      }
    }
    for (let i = 0; i < 30 && (await bal(treasury.address)) === 0n; i++) await new Promise((r) => setTimeout(r, 2000))
  }
  console.log('treasury balance', await bal(treasury.address))

  const h1 = await deployContract(client, {
    abi: keycardRegistryAbi, bytecode: keycardRegistryBytecode, args: [treasury.address, attester.address],
  } as any)
  const r1 = await waitForTransactionReceipt(client, { hash: h1 })
  const h2 = await deployContract(client, {
    abi: lineBookAbi, bytecode: lineBookBytecode, args: [treasury.address, servicer.address],
  } as any)
  const r2 = await waitForTransactionReceipt(client, { hash: h2 })
  if (r1.status !== 'success' || r2.status !== 'success') throw new Error('deploy failed')

  const out = {
    network: networkName,
    chainId: net.chainId,
    registry: r1.contractAddress,
    lineBook: r2.contractAddress,
    deployBlock: String(r1.blockNumber),
    owner: treasury.address,
    attester: attester.address,
    servicer: servicer.address,
    txs: { registry: h1, lineBook: h2 },
    deployedAt: new Date().toISOString(),
  }
  writeFileSync(resolve(import.meta.dirname, `../../../deployments/${networkName}.json`), JSON.stringify(out, null, 2))
  console.log(out)
}
main().catch((e) => { console.error(e); process.exit(1) })
