'use client'

import { useEffect, useState } from 'react'
import { api, getConfig, usd, type AppConfig } from '@/lib/api'

export default function Stats() {
  const [s, setS] = useState<any>(null)
  const [cfg, setCfg] = useState<AppConfig | null>(null)
  useEffect(() => {
    const load = () => api('/api/stats', { auth: false }).then(setS).catch(() => {})
    getConfig().then(setCfg).catch(() => {})
    void load()
    const t = setInterval(load, 15_000)
    return () => clearInterval(t)
  }, [])
  if (!s) return <main className="wrap"><p className="muted">Loading…</p></main>
  return (
    <main className="wrap wide">
      <h1>KEYCARD, live</h1>
      <p className="muted small">Every number reconciles to a transaction on Tempo {cfg?.network}.</p>
      <div className="grid">
        <div className="stat"><b>{s.lines.opened}</b><span className="small muted">lines opened</span></div>
        <div className="stat"><b>{s.users.verified}</b><span className="small muted">verified humans (Self)</span></div>
        <div className="stat"><b>{usd(s.spent.amount)}</b><span className="small muted">spent · {s.spent.count} payments</span></div>
        <div className="stat"><b>{usd(s.repaid.amount)}</b><span className="small muted">auto-repaid · {s.repaid.count} pulls</span></div>
        <div className="stat"><b>{s.onTimeRate === null ? '—' : `${Math.round(s.onTimeRate * 100)}%`}</b><span className="small muted">on-time statements</span></div>
        <div className="stat"><b>{s.lines.withGuarantor}</b><span className="small muted">family-guaranteed lines</span></div>
        <div className="stat"><b>{usd(s.guarantorPulls.amount)}</b><span className="small muted">paid by guarantors</span></div>
        <div className="stat"><b>{s.mandatesRevoked}</b><span className="small muted">mandates revoked → frozen</span></div>
        <div className="stat"><b>{s.lines.defaulted}</b><span className="small muted">defaults</span></div>
      </div>
      <h2>Recent on-chain events</h2>
      <table>
        <tbody>
          {s.recent.map((r: any) => (
            <tr key={r.tx_hash + r.action}>
              <td>{r.action}</td>
              <td className="small muted">{new Date(r.created_at).toLocaleString()}</td>
              <td>{cfg && <a href={`${cfg.explorerUrl}/tx/${r.tx_hash}`} target="_blank" rel="noreferrer">tx</a>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {cfg && (
        <p className="small muted">
          Contracts: registry <a href={`${cfg.explorerUrl}/address/${(cfg as any).registry}`}>{(cfg as any).registry}</a> · credit file{' '}
          <a href={`${cfg.explorerUrl}/address/${(cfg as any).lineBook}`}>{(cfg as any).lineBook}</a>
        </p>
      )}
    </main>
  )
}
