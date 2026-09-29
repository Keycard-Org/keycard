'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Onboard, type Me } from '@/components/Onboard'
import { StartOver } from '@/components/StartOver'
import { api, duration, getConfig, short, usd } from '@/lib/api'
import { explainChainError, getSigner, signMandate } from '@/lib/wallet'

type Prepared = {
  lineId: number
  creditAccount: `0x${string}`
  mandate: { keyId: `0x${string}`; cap: string; periodSeconds: number; recipient: `0x${string}`; expiry: number }
  startingLimit: string
  merchants: string[]
}

export default function Start() {
  const router = useRouter()
  const [me, setMe] = useState<Me | null>(null)
  const [prep, setPrep] = useState<Prepared | null>(null)
  const [agree, setAgree] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [stage, setStage] = useState<string | null>(null)

  const onReady = useCallback(
    async (m: Me) => {
      setMe(m)
      if (m.line && m.line.status !== 'preparing') return router.replace('/card')
      try {
        setPrep(await api<Prepared>('/api/lines/prepare', { method: 'POST' }))
      } catch (e: any) {
        setErr(e.message)
      }
    },
    [router],
  )

  const accept = async () => {
    if (!prep) return
    setErr(null)
    setBusy(true)
    try {
      const signer = await getSigner()
      setStage(signer.kind === 'passkey' ? 'Approve the auto-debit with your passkey (one prompt)…' : 'Signing the auto-debit…')
      await signMandate(signer, prep.lineId, prep.mandate)
      setStage('Opening your line on Tempo (funding + issuing your card key)…')
      await api(`/api/lines/${prep.lineId}/open`, { method: 'POST' })
      router.replace('/card')
    } catch (e: any) {
      setErr(explainChainError(e))
      setStage(null)
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="wrap">
      <h1>Get your KEYCARD</h1>
      {!me && <Onboard role="borrower" onReady={onReady} />}
      {err && <p className="error">{err}</p>}

      {me && prep && (
        <div className="panel">
          <h2>Your auto-debit</h2>
          <p className="small">
            Your starting limit is <b>{usd(prep.startingLimit)}</b>. At the end of each period you repay what you spent,
            automatically, from your KEYCARD wallet (<span className="mono">{short(me.user?.wallet)}</span>).
          </p>
          <MandateTerms prep={prep} />
          <label className="check">
            <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
            <span className="small">
              I allow KEYCARD to take what I owe from my wallet each period, up to the cap above, only to KEYCARD. I
              understand I can revoke this at any time, and that revoking it freezes my card.
            </span>
          </label>
          <p />
          <button className="block" disabled={!agree || busy} onClick={accept}>
            {busy ? stage ?? 'Working…' : 'Sign & open my line'}
          </button>
          <p className="small muted">You pay no network fees. KEYCARD sponsors them.</p>
        </div>
      )}
      {me && <StartOver />}
    </main>
  )
}

function MandateTerms({ prep }: { prep: Prepared }) {
  const [sym, setSym] = useState('USD')
  useEffect(() => {
    getConfig().then((c) => setSym(c.tokenSymbol)).catch(() => {})
  }, [])
  return (
    <div className="consent">
      {`Auto-debit permission, enforced by the Tempo protocol
• Maximum per period: ${usd(prep.mandate.cap)} (${sym})
• Period: ${duration(prep.mandate.periodSeconds)}
• Can pay only: KEYCARD (${prep.mandate.recipient})
• Ends: ${new Date(prep.mandate.expiry * 1000).toISOString().slice(0, 10)}
KEYCARD only takes what you actually owe. The cap is the most it could ever take in one period.`}
    </div>
  )
}
