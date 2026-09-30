'use client'
import { signOut } from '@/lib/wallet'
import type { Me } from './Onboard'

const ROLE: Record<string, string> = { borrower: 'Cardholder', merchant: 'Merchant', guarantor: 'Family backup' }

/**
 * Who is signed in here, and a way out. Switching signs this browser out of the session (the passkey picker or
 * password sign-in then chooses any account); a password wallet stored on this device is kept.
 */
export function AccountBar({ me }: { me: Me }) {
  const name = me.user?.username ? `@${me.user.username}` : me.user?.wallet ? `${me.user.wallet.slice(0, 6)}…${me.user.wallet.slice(-4)}` : ''
  return (
    <div className="account-bar">
      <span className="small">
        <span className="muted">Signed in as </span>
        <b>{name}</b>
        {me.user?.role && <span className="role">{ROLE[me.user.role] ?? me.user.role}</span>}
      </span>
      <button
        className="ghost sm"
        onClick={() => {
          signOut()
          window.location.reload()
        }}
      >
        Switch account
      </button>
    </div>
  )
}

/** Shown when the signed-in account is the wrong kind for this page. */
export function WrongAccount({ me, want, here }: { me: Me; want: string; here: string }) {
  const role = me.user?.role
  const home = role === 'merchant' ? '/merchant' : role === 'borrower' ? '/card' : null
  return (
    <div className="panel">
      <h2>This is a {ROLE[role ?? ''] ?? role} account</h2>
      <p className="small muted">
        {here} needs a {want} account. Accounts are separate, so one person can have both. Switch to your {want}{' '}
        account, or create one.
      </p>
      <button
        className="block"
        style={{ marginTop: 8 }}
        onClick={() => {
          signOut()
          window.location.reload()
        }}
      >
        Switch account
      </button>
      {home && (
        <a className="btn block ghostlink" href={home}>
          Back to my {role === 'merchant' ? 'shop' : 'card'}
        </a>
      )}
    </div>
  )
}
