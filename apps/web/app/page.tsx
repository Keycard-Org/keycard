import Link from 'next/link'
import { StatsStrip } from '@/components/StatsStrip'

export default function Home() {
  return (
    <main className="wrap">
      <h1>Credit your family can back.</h1>
      <p className="muted">
        KEYCARD is a stablecoin credit line for people paid in digital dollars, the ones no bank will score. It runs on
        Tempo, and the blockchain itself enforces every rule.
      </p>

      <div className="card" aria-hidden>
        <div className="label">KEYCARD · credit line</div>
        <div className="big">$20 → $50 → $100</div>
        <div className="foot">
          <span>Pay on time, your limit grows</span>
          <span>Tempo</span>
        </div>
      </div>

      <div className="panel">
        <h2>How it works</h2>
        <ol className="small">
          <li>
            <b>Your card is a passkey.</b> It can only pay approved merchants, up to your limit. Try anything else and the
            Tempo protocol refuses it.
          </li>
          <li>
            <b>Repayment is an auto-debit you control.</b> You allow KEYCARD to take <i>at most</i> one statement per
            period, and only to KEYCARD. The blockchain caps it; we physically cannot take more. You can revoke it any
            time (your card freezes).
          </li>
          <li>
            <b>Family can back you.</b> A relative abroad signs one capped key on their own wallet. It pays only if you
            miss a payment. It never pays more than they agreed.
          </li>
          <li>
            <b>Real, unique people only.</b> Identity is a zero-knowledge passport proof via Self. We never see your
            passport.
          </li>
        </ol>
      </div>

      <div className="row">
        <Link href="/start" className="btn" style={{ flex: 1 }}>
          Get your line
        </Link>
        <Link href="/card" className="btn" style={{ flex: 1, background: 'transparent', color: 'var(--ink)', border: '1px solid var(--line)' }}>
          I have a KEYCARD
        </Link>
      </div>

      <div className="panel">
        <h2>Where you can pay</h2>
        <p className="small">
          <b>Today:</b> any KEYCARD merchant. Anyone can become one in a minute, scan their QR and pay. The KEYCARD network
          settles the merchant in stablecoins on Tempo within seconds. <Link href="/merchant">Accept KEYCARD →</Link>
        </p>
        <p className="small">
          <b>Next:</b> pay at <b>any shop or card terminal</b>. Through a card-network partner (Visa/Mastercard issuing),
          your credit line authorizes on Tempo and the merchant receives <b>local fiat</b>. They never touch crypto. Your
          card, limits and auto-debit stay exactly the same; only the settlement leg changes.
        </p>
      </div>

      <h2>Live on Tempo</h2>
      <StatsStrip />
      <p className="small muted">
        KEYCARD is a pilot credit programme with small limits.
      </p>
    </main>
  )
}
