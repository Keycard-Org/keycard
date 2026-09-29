'use client'
import { useEffect, useState } from 'react'
import { api, usd } from '@/lib/api'

export function StatsStrip() {
  const [s, setS] = useState<any>(null)
  useEffect(() => {
    api('/api/stats', { auth: false }).then(setS).catch(() => setS(null))
  }, [])
  if (!s) return <p className="small muted">Loading live numbers…</p>
  return (
    <div className="grid">
      <div className="stat">
        <b>{s.lines.opened}</b>
        <span className="small muted">credit lines opened</span>
      </div>
      <div className="stat">
        <b>{usd(s.spent.amount)}</b>
        <span className="small muted">spent at merchants</span>
      </div>
      <div className="stat">
        <b>{usd(s.repaid.amount)}</b>
        <span className="small muted">auto-repaid</span>
      </div>
      <div className="stat">
        <b>{s.onTimeRate === null ? '—' : `${Math.round(s.onTimeRate * 100)}%`}</b>
        <span className="small muted">on-time</span>
      </div>
    </div>
  )
}
