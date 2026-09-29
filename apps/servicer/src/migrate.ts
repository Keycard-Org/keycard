import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { sql } from './db'

export async function migrate() {
  const dir = resolve(import.meta.dirname, '../migrations')
  await sql`CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`
  const done = new Set((await sql`SELECT version FROM schema_migrations`).map((r) => r.version as string))
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    if (done.has(f)) continue
    await sql.begin(async (tx) => {
      await tx.unsafe(readFileSync(resolve(dir, f), 'utf8'))
      await tx`INSERT INTO schema_migrations (version) VALUES (${f})`
    })
    console.log('migrated', f)
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  migrate()
    .then(() => sql.end())
    .catch((e) => {
      console.error(e)
      process.exit(1)
    })
}
