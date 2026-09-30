'use client'

import { use, useCallback, useEffect, useState } from 'react'
import { Onboard, type Me } from '@/components/Onboard'
import { api, short, toBase, usd } from '@/lib/api'
import { explainChainError, getSigner, signGuarantee } from '@/lib/wallet'
import { AccountBar, WrongAccount } from '@/components/AccountBar'

type Invite = { inviteId: string; status: string; borrowerWallet: string; requested: string; termEnd: string; termMonths: number }
type Prepared = {
  cap: string
  maxAllowed: string
  requested: string
  consentText: string
  consentHash: string
  key: { keyId: `0x${string}`; cap: string; recipient: `0x${string}`; expiry: number }
}

export default function GuarantorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [inv, setInv] = useState<Invite | null>(null)
  const [me, setMe] = useState<Me | null>(null)
  const [income, setIncome] = useState('')
  const [obligations, setObligations] = useState('')
  const [prep, setPrep] = useState<Prepared | null>(null)
  const [agree, setAgree] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [done, setDone] = useState<any>(null)

  useEffect(() => {
    api<Invite>(`/api/guarantee/${id}`, { auth: false }).then(setInv).catch((e) => setErr(e.message))
  }, [id])
  const onReady = useCallback((m: Me) => setMe(m), [])

  const check = async () => {
    setErr(null)
    setBusy(true)
    try {
      setPrep(await api<Prepared>(`/api/guarantee/${id}/prepare`, {
        body: { monthlyIncome: toBase(income).toString(), monthlyObligations: toBase(obligations || '0').toString() },
      }))
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }

  const sign = async () => {
    if (!prep) return
    setErr(null)
    setBusy(true)
    try {
      const signer = await getSigner()
      await signGuarantee(signer, id, prep.key)
      setDone(await api(`/api/guarantee/${id}/confirm`, { body: { consentHash: prep.consentHash } }))
    } catch (e: any) {
      setErr(explainChainError(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="wrap">
      <span className="eyebrow" style={{ marginTop: 18 }}>Family backup</span>
      <h1 style={{ marginTop: 0 }}>Back someone you trust</h1>
      {inv && (
        <p className="muted">
          <span className="mono">{short(inv.borrowerWallet)}</span> is asking you to guarantee up to <b>{usd(inv.requested)}</b>{' '}
          of their KEYCARD credit line, until {new Date(inv.termEnd).toLocaleDateString()}.
        </p>
      )}
      {err && <p className="error">{err}</p>}
      {inv && inv.status !== 'open' && inv.status !== 'prepared' && !done && <p className="notice">This invite is {inv.status}.</p>}

      {!me && inv && <Onboard role="guarantor" onReady={onReady} />}
      {me && <AccountBar me={me} />}
      {me && me.user?.role !== 'guarantor' && <WrongAccount me={me} want="family backup" here="Backing someone" />}

      {me && me.user?.role === 'guarantor' && !prep && !done && (
        <div className="panel">
          <h2>Can you afford this?</h2>
          <p className="small">
            We never let a guarantee exceed <b>20% of your spare monthly income</b> over the term. Guarantor lenders that
            skipped this check have hurt families.
          </p>
          <label htmlFor="inc">Your monthly income (USD)</label>
          <input id="inc" inputMode="decimal" value={income} onChange={(e) => setIncome(e.target.value)} />
          <label htmlFor="obl">Your monthly loan & rent payments (USD)</label>
          <input id="obl" inputMode="decimal" value={obligations} onChange={(e) => setObligations(e.target.value)} />
          <p />
          <button className="block" disabled={busy || !income} onClick={check}>
            Check what I can guarantee
          </button>
        </div>
      )}

      {prep && !done && (
        <div className="panel">
          <h2>Your guarantee</h2>
          <div className="chips">
            <div>You’re backing<b>{usd(prep.cap)}</b></div>
            <div>Most you could afford<b>{usd(prep.maxAllowed)}</b></div>
          </div>
          <p className="small">
            You can guarantee up to {usd(prep.maxAllowed)}. This guarantee is for <b>{usd(prep.cap)}</b>
            {BigInt(prep.cap) < BigInt(prep.requested) ? ` (less than the ${usd(prep.requested)} requested, to keep it affordable)` : ''}.
          </p>
          <div className="consent">{prep.consentText}</div>
          <label className="check">
            <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
            <span className="small">I have read this and I agree.</span>
          </label>
          <p />
          <button className="block" disabled={!agree || busy} onClick={sign}>
            {busy ? 'Signing…' : 'Sign guarantee'}
          </button>
          <p className="small muted center">The cap and destination are enforced by the Tempo protocol. You pay no network fees.</p>
        </div>
      )}

      {done && (
        <div className="panel center">
          <div style={{ fontSize: 40, lineHeight: 1 }} aria-hidden>✓</div>
          <h2 className="ok" style={{ marginTop: 10 }}>You’re backing them.</h2>
          <p className="small">
            Their limit is now {usd(done.limit)}. You’ll only ever be charged if they miss a payment and don’t fix it within
            the grace period — and never more than {usd(done.guaranteed)}.
          </p>
        </div>
      )}
    </main>
  )
}
