export const usd = (base: string | bigint | number | null | undefined) => {
  if (base === null || base === undefined) return '—'
  const cents = Number(BigInt(base) / 10_000n)
  const neg = cents < 0
  const abs = Math.abs(cents)
  const s = `$${Math.floor(abs / 100).toLocaleString('en-US')}.${String(abs % 100).padStart(2, '0')}`
  return neg ? `−${s}` : s
}
/** "12.5" → 12500000n (6 decimals). Throws on anything that isn't a plain positive amount. */
export const toBase = (dollars: string) => {
  const t = dollars.trim().replace(/^\$/, '')
  const [i, f = ''] = t.split('.')
  if (!/^\d*$/.test(i) || !/^\d*$/.test(f) || (i === '' && f === '') || f.length > 6) throw new Error('Enter an amount like 12.50')
  return BigInt(i || '0') * 1_000_000n + BigInt((f + '000000').slice(0, 6))
}
export const short = (a?: string | null) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '—')
export const duration = (s: number) =>
  s >= 86400 ? `${Math.round(s / 86400)} days` : s >= 3600 ? `${Math.round(s / 3600)} hours` : `${Math.round(s / 60)} minutes`

/** "in 4 min" / "6 days" / "now" */
export function until(iso: string | null | undefined, now = Date.now()) {
  if (!iso) return null
  const ms = new Date(iso).getTime() - now
  if (ms <= 0) return 'now'
  const s = Math.round(ms / 1000)
  if (s < 90) return `${s}s`
  const m = Math.round(s / 60)
  if (m < 90) return `${m} min`
  const h = Math.round(m / 60)
  return h < 48 ? `${h} h` : `${Math.round(h / 24)} days`
}
export const when = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—'
