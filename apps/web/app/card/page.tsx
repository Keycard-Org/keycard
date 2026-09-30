'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { Address } from 'viem'
import { api, getConfig, getToken, short, toBase, usd, type AppConfig } from '@/lib/api'
import { explainChainError, getSigner, payRawAddress, payWithCard, revokeKey, signOut, tokenBalance } from '@/lib/wallet'
import { AddMoney } from '@/components/AddMoney'
import { StartOver } from '@/components/StartOver'
import { PhysicalCard } from '@/components/PhysicalCard'
import { LineStatus } from '@/components/LineStatus'
import { UsernameBanner } from '@/components/UsernameBanner'
import { MERCHANT_CODE_RE } from '@keycard/sdk'
import type { Me } from '@/components/Onboard'

export default function CardPage() {
  const router = useRouter()
  const [cfg, setCfg] = useState<AppConfig | null>(null)
  const [me, setMe] = useState<Me | null>(null)
  const [walletBal, setWalletBal] = useState<bigint | null>(null)
  const [activity, setActivity] = useState<any>(null)
  const [err, setErr] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [merchant, setMerchant] = useState('')
  const [merchantName, setMerchantName] = useState<string | null>(null)
  const [amount, setAmount] = useState('')
  const [invite, setInvite] = useState<string | null>(null)
  const [guarAmount, setGuarAmount] = useState('30')

  const load = useCallback(async () => {
    if (!getToken()) return router.replace('/start')
    try {
      const [c, m] = await Promise.all([getConfig(), api<Me>('/api/me')])
      setCfg(c)
      setMe(m)
      if (!m.line || m.line.status === 'preparing') return router.replace('/start')
      if (m.user) setWalletBal(await tokenBalance(m.user.wallet))
      setActivity(await api('/api/me/activity'))
    } catch (e: any) {
      if (e.status === 401) router.replace('/start')
      else setErr(e.message)
    }
  }, [router])

  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get('pay')
    if (code) setMerchant(code.toUpperCase())
  }, [])

  useEffect(() => {
    setMerchantName(null)
    if (!MERCHANT_CODE_RE.test(merchant)) return
    api<{ label: string }>(`/api/merchants/${merchant}`, { auth: false })
      .then((m) => setMerchantName(m.label))
      .catch(() => setMerchantName(''))
  }, [merchant])

  useEffect(() => {
    void load()
    const t = setInterval(load, 10_000)
    return () => clearInterval(t)
  }, [load])

  const line = me?.line
  const frozen = line && line.status !== 'active'

  const pay = async () => {
    setErr(null)
    setMsg(null)
    setBusy(true)
    try {
      const signer = await getSigner()
      const hash = await payWithCard(signer, line.creditAccount as Address, merchant, toBase(amount))
      setMsg(`Paid ${merchantName ?? merchant}. Transaction ${short(hash)} — settling to the merchant now.`)
      setAmount('')
      await load()
    } catch (e: any) {
      setErr(explainChainError(e))
    } finally {
      setBusy(false)
    }
  }

  const tryRawAddress = async () => {
    setErr(null)
    setMsg(null)
    const addr = prompt('Paste any wallet address to try paying $1 directly (the protocol should refuse):')
    if (!addr || !/^0x[0-9a-fA-F]{40}$/.test(addr)) return
    setBusy(true)
    try {
      const signer = await getSigner()
      await payRawAddress(signer, line.creditAccount as Address, addr as Address, 1_000_000n)
      setErr('Unexpected: the payment went through.')
    } catch (e: any) {
      setErr(explainChainError(e))
    } finally {
      setBusy(false)
    }
  }

  const inviteGuarantor = async () => {
    setErr(null)
    try {
      const r = await api<{ inviteId: string }>('/api/guarantee/invite', { body: { requested: toBase(guarAmount).toString() } })
      setInvite(`${window.location.origin}/g/${r.inviteId}`)
    } catch (e: any) {
      setErr(e.message)
    }
  }

  const revokeMandate = async () => {
    if (!confirm('Revoking your auto-debit freezes your card immediately. Continue?')) return
    setBusy(true)
    setErr(null)
    try {
      const signer = await getSigner()
      const keyId = line.repayKeyId as Address | undefined
      if (!keyId) throw new Error('Mandate key id unavailable')
      await revokeKey(signer, keyId)
      setMsg('Auto-debit revoked. Your card will freeze within a few seconds.')
      await load()
    } catch (e: any) {
      setErr(explainChainError(e))
    } finally {
      setBusy(false)
    }
  }

  if (!line || !cfg) return <main className="wrap"><p className="muted">Loading your card…</p>{err && <p className="error">{err}</p>}</main>

  return (
    <main className="wrap">
      <UsernameBanner username={(me as any)?.user?.username} onSet={load} />
      <div className={`card ${frozen ? 'frozen' : ''}`}>
        <div className="label">Available to spend</div>
        <div className="big">{usd(line.spendable)}</div>
        <div className="small" style={{ opacity: 0.85 }}>
          Limit {usd(line.limit)} · owed {usd(line.owed)}
        </div>
        <div className="foot">
          <span className="mono">{short(line.creditAccount)}</span>
          <span className="badge">{line.status.toUpperCase()}</span>
        </div>
      </div>

      <LineStatus line={line} walletBal={walletBal} onChange={load} />
      {err && <p className="error">{err}</p>}
      {msg && <p className="notice">{msg}</p>}

      {!frozen && (
        <div className="panel">
          <h2>Pay</h2>
          <label htmlFor="m">Merchant code</label>
          <input id="m" list="merchant-list" placeholder="e.g. 7QX2MD" value={merchant} onChange={(e) => setMerchant(e.target.value.toUpperCase().trim())} />
          <datalist id="merchant-list">
            {cfg.merchants.map((m) => (
              <option key={m.code} value={m.code}>{m.label}</option>
            ))}
          </datalist>
          {merchantName && <p className="small ok">Paying: {merchantName}</p>}
          {merchantName === '' && <p className="small error">No KEYCARD merchant with this code.</p>}
          <label htmlFor="a">Amount (USD)</label>
          <input id="a" inputMode="decimal" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} />
          <p />
          <button className="block" disabled={busy || !merchantName || !amount} onClick={pay}>
            {busy ? 'Confirming…' : 'Pay with KEYCARD'}
          </button>
          <p className="small muted">
            Your card can only pay through the KEYCARD network. The blockchain enforces this, not us.{' '}
            <a href="#" onClick={(e) => (e.preventDefault(), tryRawAddress())}>See it refuse a random wallet</a>
          </p>
        </div>
      )}

      <div className="panel">
        <div className="row between">
          <h2 style={{ margin: 0 }}>Repayment</h2>
          <span className="small muted">on-time streak: {line.onTimeCount}</span>
        </div>
        <p className="small">
          Next statement: <b>{line.nextDue ? new Date(line.nextDue).toLocaleString() : '—'}</b>. Your wallet{' '}
          <span className="mono">{short(me?.user?.wallet)}</span> holds <b>{walletBal === null ? '—' : usd(walletBal)}</b>.
          Keep at least what you owe there.
        </p>
        <p className="small muted">Two on-time statements in a row raise your limit: {cfg.tiers.map((t) => usd(t)).join(' → ')}.</p>
      </div>

      {(!frozen || ['active', 'frozen'].includes(line.card?.status)) && <PhysicalCard card={line.card} onChange={load} canLink={!frozen} />}

      {me?.user && <AddMoney wallet={me.user.wallet} balance={walletBal} cfg={cfg} onFunded={load} />}

      <div className="panel">
        <h2>Family guarantee</h2>
        {line.guarantorWallet ? (
          <p className="small ok">
            Guaranteed by <span className="mono">{short(line.guarantorWallet)}</span> for up to {usd(line.guaranteed)}.
          </p>
        ) : (
          <>
            <p className="small">
              A relative with income can back your line. They sign one capped key on their own wallet; it pays only if you
              miss a payment. A guarantee raises your limit one level.
            </p>
            <label htmlFor="g">Amount to ask for (USD)</label>
            <input id="g" inputMode="decimal" value={guarAmount} onChange={(e) => setGuarAmount(e.target.value)} />
            <p />
            <button className="ghost block" onClick={inviteGuarantor}>
              Create invite link
            </button>
            {invite && (
              <p className="small">
                Send this to your guarantor: <span className="mono">{invite}</span>
              </p>
            )}
          </>
        )}
      </div>

      <div className="panel">
        <h2>Activity</h2>
        {!activity ? (
          <p className="small muted">Loading…</p>
        ) : (
          <table>
            <tbody>
              {activity.spends.map((s: any) => (
                <tr key={s.tx_hash}>
                  <td>
                    {s.label ?? s.merchant_code ?? 'Payment'}{' '}
                    <span className="small muted">{s.status === 'settled' ? '· settled' : s.status === 'received' ? '· settling' : `· ${s.status.replace(/_/g, ' ')}`}</span>
                  </td>
                  <td>{usd(s.amount)}</td>
                  <td>
                    <a href={`${cfg.explorerUrl}/tx/${s.tx_hash}`} target="_blank" rel="noreferrer">tx</a>
                  </td>
                </tr>
              ))}
              {activity.movements
                .filter((m: any) => m.status === 'confirmed' && (m.kind === 'INST' || m.kind === 'GUAR'))
                .map((m: any) => (
                  <tr key={m.tx_hash}>
                    <td>{m.kind === 'INST' ? 'Auto-repayment' : 'Guarantor paid'}</td>
                    <td>{usd(m.amount)}</td>
                    <td>
                      <a href={`${cfg.explorerUrl}/tx/${m.tx_hash}`} target="_blank" rel="noreferrer">tx</a>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="row between">
        <button className="danger" disabled={busy || !line.mandateActive || ['defaulted', 'settled'].includes(line.status)} onClick={revokeMandate}>
          Revoke auto-debit
        </button>
        <button className="ghost" onClick={() => (signOut(), router.replace('/'))}>
          Sign out
        </button>
      </div>
      <StartOver label="Use a different account on this browser" />
      <p className="small muted">
        Public credit file: every line event is recorded on-chain.{' '}
        <Link href="/stats">See live stats</Link>
      </p>
    </main>
  )
}
