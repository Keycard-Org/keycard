'use client'
import { useState } from 'react'
import { api, short, usd } from '@/lib/api'
import { explainChainError, linkPhysicalCard } from '@/lib/wallet'
import { nfcSupportedHint } from '@/lib/halo'

/** Borrower: link / freeze a physical NFC KEYCARD (Burner card, chip slot 1). */
export function PhysicalCard({ card, onChange }: { card: { address: string; limit: string; status: string } | null; onChange: () => void }) {
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const link = async () => {
    setErr(null)
    setBusy(true)
    try {
      await linkPhysicalCard(setStatus)
      setStatus('Card linked.')
      onChange()
    } catch (e: any) {
      setErr(explainChainError(e))
      setStatus(null)
    } finally {
      setBusy(false)
    }
  }
  const freeze = async () => {
    if (!confirm('Freeze this physical card? It stops working immediately (your phone card keeps working).')) return
    setBusy(true)
    setErr(null)
    try {
      await api('/api/card/freeze', { method: 'POST' })
      setStatus('Physical card frozen on-chain.')
      onChange()
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }
  const active = card && card.status === 'active'
  return (
    <div className="panel">
      <h2>Physical card</h2>
      {active ? (
        <>
          <p className="small ok">
            Linked: <span className="mono">{short(card!.address)}</span> · tap limit {usd(card!.limit)} per period
          </p>
          <p className="small muted">Tap it on any KEYCARD merchant’s phone to pay. Lost it? Freeze it instantly.</p>
          <button className="danger block" disabled={busy} onClick={freeze}>Freeze physical card</button>
        </>
      ) : (
        <>
          <p className="small">
            Turn your NFC card (e.g. a <b>Burner</b> card) into a tap-to-pay KEYCARD. It gets its own small contactless
            limit. We use the card’s free key slot. <b>Your Burner wallet and PIN are never touched.</b>
          </p>
          <p className="small muted">{nfcSupportedHint()}</p>
          <button className="block" disabled={busy} onClick={link}>{busy ? status ?? 'Waiting for card…' : 'Link a physical card'}</button>
        </>
      )}
      {status && !busy && <p className="small notice">{status}</p>}
      {err && <p className="small error">{err}</p>}
    </div>
  )
}
