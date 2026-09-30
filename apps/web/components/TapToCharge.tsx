'use client'
import { useState } from 'react'
import { short, toBase } from '@/lib/api'
import { chargePhysicalCard, explainChainError } from '@/lib/wallet'
import { nfcSupportedHint } from '@/lib/halo'

/** Merchant: charge a customer's physical KEYKARD by tapping it on this phone. */
export function TapToCharge({ merchantCode, onPaid }: { merchantCode: string; onPaid: () => void }) {
  const [amount, setAmount] = useState('')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const charge = async () => {
    setErr(null)
    setBusy(true)
    try {
      const tx = await chargePhysicalCard({ merchantCode, amount: toBase(amount), onStatus: setStatus })
      setStatus(`Paid ✓  (${short(tx)}) — settling to you now`)
      setAmount('')
      onPaid()
    } catch (e: any) {
      setErr(explainChainError(e))
      setStatus(null)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="panel">
      <h2>Tap to charge</h2>
      <p className="small muted">Customer taps their physical KEYKARD on this phone. {nfcSupportedHint()}</p>
      <label htmlFor="amt">Amount (USD)</label>
      <input id="amt" className="amount-input" inputMode="decimal" placeholder="$0.00" value={amount} onChange={(e) => setAmount(e.target.value)} />
      <button className="block" style={{ marginTop: 14 }} disabled={busy || !amount} onClick={charge}>{busy ? status ?? 'Waiting for card…' : 'Charge — tap card'}</button>
      {status && !busy && <p className="small notice">{status}</p>}
      {err && <p className="small error">{err}</p>}
    </div>
  )
}
