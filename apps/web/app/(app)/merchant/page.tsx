'use client'

import { useCallback, useEffect, useState } from 'react'
import { Onboard, type Me } from '@/components/Onboard'
import { Qr, CopyText } from '@/components/Qr'
import { api, getConfig, short, usd, type AppConfig } from '@/lib/api'
import { signOut } from '@/lib/wallet'
import { TapToCharge } from '@/components/TapToCharge'

type Dash = {
  merchant: { code: string; label: string; owner: string; settleTo: string; settlement: string }
  payments: { amount: string; pay_tx: string | null; settle_tx: string; status: string; created_at: string | null }[]
  pending?: { amount: string; pay_tx: string; status: string; created_at: string }[]
  settledTotal: string
  settledCount: number
}

export default function MerchantPage() {
  const [me, setMe] = useState<Me | null>(null)
  const [cfg, setCfg] = useState<AppConfig | null>(null)
  const [dash, setDash] = useState<Dash | null>(null)
  const [label, setLabel] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      setDash(await api<Dash | null>('/api/merchant/me'))
    } catch (e: any) {
      setErr(e.message)
    }
  }, [])
  const onReady = useCallback((m: Me) => {
    setMe(m)
    void load()
  }, [load])

  useEffect(() => {
    getConfig().then(setCfg).catch(() => {})
  }, [])
  useEffect(() => {
    if (!dash) return
    const t = setInterval(load, 8000)
    return () => clearInterval(t)
  }, [dash, load])

  const register = async () => {
    setErr(null)
    setBusy(true)
    try {
      await api('/api/merchants', { body: { label } })
      await load()
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }

  const payLink = dash && typeof window !== 'undefined' ? `${window.location.origin}/card?pay=${dash.merchant.code}` : ''

  return (
    <main className="wrap">
      <h1>Accept KEYCARD</h1>
      <p className="muted">
        Get paid by KEYCARD holders. Customers pay from their credit line; you are settled by the KEYCARD network in{' '}
        {cfg?.tokenSymbol ?? 'USDC'} on Tempo within seconds. <b>Coming next:</b> settlement in local currency to your
        bank, and acceptance on any card terminal through our card-network partner.
      </p>
      {err && <p className="error">{err}</p>}
      {!me && <Onboard role="merchant" onReady={onReady} />}

      {me && !dash && (
        <div className="panel">
          <h2>Your business</h2>
          <label htmlFor="label">Name customers will see</label>
          <input id="label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Tita Rosa’s Sari-Sari Store" />
          <p />
          <button className="block" disabled={busy || label.trim().length < 2} onClick={register}>
            Get my merchant code
          </button>
        </div>
      )}

      {dash && (
        <>
          <div className="panel" style={{ textAlign: 'center' }}>
            <p className="small muted">Your KEYCARD merchant code</p>
            <div style={{ fontSize: 40, fontWeight: 800, letterSpacing: '0.15em' }}>{dash.merchant.code}</div>
            <p><b>{dash.merchant.label}</b></p>
            <Qr value={payLink} size={220} />
            <p className="small muted">Customers scan this to pay you.</p>
            <CopyText text={payLink} label="Copy pay link" />
          </div>
          <TapToCharge merchantCode={dash.merchant.code} onPaid={() => setTimeout(load, 3000)} />
          <div className="grid">
            <div className="stat"><b>{usd(dash.settledTotal)}</b><span className="small muted">received</span></div>
            <div className="stat"><b>{dash.settledCount}</b><span className="small muted">payments</span></div>
          </div>
          <div className="panel">
            <h2>Payments</h2>
            {dash.pending && dash.pending.length > 0 && (
              <p className="small notice">
                {dash.pending.length} payment(s) settling now: {dash.pending.map((p) => usd(p.amount)).join(', ')}
              </p>
            )}
            {dash.payments.length === 0 ? (
              <p className="small muted">No payments yet.</p>
            ) : (
              <table>
                <tbody>
                  {dash.payments.map((p) => (
                    <tr key={p.settle_tx}>
                      <td>{usd(p.amount)}</td>
                      <td className="small muted">{p.created_at ? new Date(p.created_at).toLocaleString() : ''}</td>
                      <td className="small">
                        {cfg && (
                          <a href={`${cfg.explorerUrl}/tx/${p.settle_tx}`} target="_blank" rel="noreferrer">on-chain ↗</a>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className="small muted">History is read from the Tempo blockchain (every settlement to your wallet).</p>
            <p className="small muted">Settled to <span className="mono">{short(dash.merchant.settleTo)}</span> (your KEYCARD wallet).</p>
          </div>
          <button className="ghost" onClick={() => (signOut(), location.reload())}>Sign out</button>
        </>
      )}
    </main>
  )
}
