import postgres from 'postgres'
import { env } from './config'

export const sql = postgres(env.DATABASE_URL, {
  max: 10,
  types: { bigint: postgres.BigInt },
  onnotice: () => {},
})

export async function audit(p: {
  lineId?: number | bigint | null
  actor: 'servicer' | 'borrower' | 'guarantor' | 'merchant' | 'admin' | 'chain'
  action: string
  detail?: unknown
  txHash?: string | null
}) {
  await sql`
    INSERT INTO audit_log (line_id, actor, action, detail, tx_hash)
    VALUES (${p.lineId === undefined || p.lineId === null ? null : String(p.lineId)}, ${p.actor}, ${p.action},
            ${p.detail === undefined ? null : sql.json(JSON.parse(JSON.stringify(p.detail, (_, v) => (typeof v === 'bigint' ? v.toString() : v))))},
            ${p.txHash ?? null})`
}
