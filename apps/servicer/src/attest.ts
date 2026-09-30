import { keccak256, stringToHex, type Address } from 'viem'
import { registryWrite } from './chain'
import { audit, sql } from './db'

/**
 * Writes a Self-verified identity to KeycardRegistry and the DB.
 * The raw Self nullifier never goes on-chain; only keccak256(nullifier).
 */
export async function attestWallet(p: {
  wallet: Address
  nullifier: string
  flags: number
  expiresAt: Date
  nationality?: string | null
  selfSessionId?: string | null
}) {
  const wallet = p.wallet.toLowerCase() as Address
  const nullifierHash = keccak256(stringToHex(p.nullifier))
  const [clash] = await sql`SELECT wallet FROM attestations WHERE nullifier_hash=${nullifierHash} AND wallet<>${wallet}`
  if (clash) {
    await audit({ actor: 'servicer', action: 'self.identity_already_linked', detail: { wallet, linkedTo: clash.wallet.slice(0, 10) } })
    throw new Error('this identity is already linked to another KEYKARD account')
  }
  const receipt = await registryWrite('attest', [wallet, nullifierHash, p.flags, BigInt(Math.floor(p.expiresAt.getTime() / 1000))])
  await sql`
    INSERT INTO attestations (wallet, nullifier_hash, flags, expires_at, nationality, source, self_session_id, tx_hash)
    VALUES (${wallet}, ${nullifierHash}, ${p.flags}, ${p.expiresAt}, ${p.nationality ?? null}, 'self', ${p.selfSessionId ?? null}, ${receipt.transactionHash})
    ON CONFLICT (wallet) DO UPDATE SET flags=EXCLUDED.flags, expires_at=EXCLUDED.expires_at,
      nationality=COALESCE(EXCLUDED.nationality, attestations.nationality), tx_hash=EXCLUDED.tx_hash`
  await audit({ actor: 'servicer', action: 'identity.attested', detail: { wallet, flags: p.flags }, txHash: receipt.transactionHash })
  return receipt.transactionHash
}
