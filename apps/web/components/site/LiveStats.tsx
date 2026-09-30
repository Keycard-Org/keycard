'use client'

import { useEffect, useRef, useState } from 'react'
import NumberFlow from '@number-flow/react'
import { api } from '@/lib/api'

type Stats = {
  lines: { opened: number }
  users: { verified: number }
  merchants: number
  spent: { amount: string; count: number }
  repaid: { amount: string }
  onTimeRate: number | null
}

const dollars = (base: string) => Number(BigInt(base) / 10_000n) / 100

/** Live numbers from the servicer. Counts up when scrolled into view; quietly hides if the API is down. */
export function LiveStats({ compact = false }: { compact?: boolean }) {
  const [s, setS] = useState<Stats | null>(null)
  const [seen, setSeen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    api<Stats>('/api/stats', { auth: false }).then(setS).catch(() => setS(null))
    const io = new IntersectionObserver(([e]) => e.isIntersecting && setSeen(true), { threshold: 0.3 })
    if (ref.current) io.observe(ref.current)
    return () => io.disconnect()
  }, [])
  const v = (n: number) => (seen && s ? n : 0)
  const items: [React.ReactNode, string][] = s
    ? [
        [<NumberFlow key="a" value={v(s.lines.opened)} />, 'credit lines opened'],
        [<NumberFlow key="b" value={v(dollars(s.spent.amount))} format={{ style: 'currency', currency: 'USD', maximumFractionDigits: 2 }} />, 'spent at merchants'],
        [<NumberFlow key="c" value={v(dollars(s.repaid.amount))} format={{ style: 'currency', currency: 'USD', maximumFractionDigits: 2 }} />, 'auto-repaid'],
        [s.onTimeRate === null ? '—' : <NumberFlow key="d" value={v(s.onTimeRate)} format={{ style: 'percent' }} />, 'paid on time'],
      ]
    : []
  return (
    <div ref={ref} className={compact ? 'kc-stats kc-stats--compact' : 'kc-stats'} aria-live="polite">
      {s !== null &&
        items.slice(0, compact ? 2 : 4).map(([n, label]) => (
          <div key={label} className="kc-stat">
            <b>{n}</b>
            <span>{label}</span>
          </div>
        ))}
    </div>
  )
}
