import { sql } from './db'

/** Public numbers for /stats: every figure is reconcilable to on-chain transactions. */
export async function stats() {
  const [lines] = await sql`
    SELECT count(*) FILTER (WHERE linebook_id IS NOT NULL)            AS opened,
           count(*) FILTER (WHERE status IN ('active','grace'))        AS live,
           count(*) FILTER (WHERE status = 'frozen')                   AS frozen,
           count(*) FILTER (WHERE status = 'defaulted')                AS defaulted,
           count(*) FILTER (WHERE guarantor_wallet IS NOT NULL)        AS guaranteed,
           COALESCE(sum(on_time_count),0)                              AS on_time,
           COALESCE(sum(missed_count),0)                               AS missed
    FROM lines`
  const [spent] = await sql`SELECT COALESCE(sum(amount),0) AS total, count(*) AS n FROM payments WHERE status='settled'`
  const [merchants] = await sql`SELECT count(*) AS n FROM merchants WHERE owner_wallet IS NOT NULL AND active`
  const [repaid] = await sql`SELECT COALESCE(sum(amount),0) AS total, count(*) AS n FROM movements WHERE kind='INST' AND status='confirmed'`
  const [guar] = await sql`SELECT COALESCE(sum(amount),0) AS total, count(*) AS n FROM movements WHERE kind='GUAR' AND status='confirmed'`
  const [revoked] = await sql`SELECT count(*) AS n FROM audit_log WHERE action='mandate.revoked'`
  const [users] = await sql`SELECT count(*) FILTER (WHERE role='borrower') AS borrowers, count(*) FILTER (WHERE role='guarantor') AS guarantors FROM users`
  const [verified] = await sql`SELECT count(*) AS n FROM attestations WHERE expires_at > now()`
  const recent = await sql`SELECT action, tx_hash, created_at FROM audit_log WHERE tx_hash IS NOT NULL ORDER BY created_at DESC LIMIT 20`
  const onTime = Number(lines.on_time)
  const missed = Number(lines.missed)
  return {
    lines: {
      opened: Number(lines.opened),
      live: Number(lines.live),
      frozen: Number(lines.frozen),
      defaulted: Number(lines.defaulted),
      withGuarantor: Number(lines.guaranteed),
    },
    users: { borrowers: Number(users.borrowers), guarantors: Number(users.guarantors), verified: Number(verified.n) },
    merchants: Number(merchants.n),
    spent: { amount: spent.total.toString(), count: Number(spent.n) },
    repaid: { amount: repaid.total.toString(), count: Number(repaid.n) },
    guarantorPulls: { amount: guar.total.toString(), count: Number(guar.n) },
    onTimeRate: onTime + missed === 0 ? null : onTime / (onTime + missed),
    mandatesRevoked: Number(revoked.n),
    recent,
  }
}
