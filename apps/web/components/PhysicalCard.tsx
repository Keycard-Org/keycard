'use client'
import { useState } from 'react'
import { api, short, usd } from '@/lib/api'
import { explainChainError, linkPhysicalCard } from '@/lib/wallet'
import { nfcSupportedHint } from '@/lib/halo'

/**
 * Borrower: link a physical NFC KEYKARD (Burner card, chip slot 1), freeze/unfreeze it (reversible, limit 0 on-chain),
 * or unlink it (revokes the key: Tempo never re-authorises a revoked key on the same account).
 */
export function PhysicalCard({
  card,
  onChange,
  canLink = true,
}: {
  card: { address: string; limit: string; status: string } | null
  onChange: () => void
  canLink?: boolean
}) {
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const run = (fn: () => Promise<unknown>, done: string) => async () => {
    setErr(null)
    setBusy(true)
    try {
      await fn()
      setStatus(done)
      onChange()
    } catch (e: any) {
      setErr(explainChainError(e))
      setStatus(null)
    } finally {
      setBusy(false)
    }
  }
  const link = run(() => linkPhysicalCard(setStatus), 'Card linked.')
  const freeze = run(() => api('/api/card/freeze', { method: 'POST' }), 'Card frozen. Tap Unfreeze to use it again.')
  const unfreeze = run(() => api('/api/card/unfreeze', { method: 'POST' }), 'Card unfrozen.')
  const unlink = () => {
    if (!confirm('Unlink this card permanently from this KEYKARD? You will NOT be able to link this same card to this KEYKARD again (Tempo protocol rule). To pause it, use Freeze instead.')) return
    void run(() => api('/api/card/unlink', { method: 'POST' }), 'Card unlinked.')()
  }

  const linked = card && (card.status === 'active' || card.status === 'frozen')
  return (
    <div className="panel">
      <h2>Physical card</h2>
      {linked ? (
        <>
          <p className={`small ${card!.status === 'active' ? 'ok' : 'warn'}`}>
            {card!.status === 'active' ? 'Active' : 'Frozen'}: <span className="mono">{short(card!.address)}</span> · tap limit{' '}
            {usd(card!.limit)} per period
          </p>
          <p className="small muted">Tap it on any KEYKARD merchant’s phone to pay. Lost it? Freeze it instantly.</p>
          <div style={{ display: 'grid', gap: 8 }}>
            {card!.status === 'active' ? (
              <button className="danger block" disabled={busy} onClick={freeze}>Freeze card</button>
            ) : (
              <button className="block" disabled={busy || !canLink} onClick={unfreeze}>Unfreeze card</button>
            )}
            <button className="ghost block" disabled={busy} onClick={unlink}>Unlink card permanently</button>
          </div>
        </>
      ) : (
        <>
          <p className="small">
            Turn your NFC card (e.g. a <b>Burner</b> card) into a tap-to-pay KEYKARD. It gets its own small contactless
            limit. We use the card’s free key slot. <b>Your Burner wallet and PIN are never touched.</b>
          </p>
          <p className="small muted">{nfcSupportedHint()}</p>
          {!canLink && <p className="small warn">Your line must be active to link a card.</p>}
          <button className="block" disabled={busy || !canLink} onClick={link}>{busy ? status ?? 'Waiting for card…' : 'Link a physical card'}</button>
        </>
      )}
      {status && !busy && <p className="small notice">{status}</p>}
      {err && <p className="small error">{err}</p>}
    </div>
  )
}
