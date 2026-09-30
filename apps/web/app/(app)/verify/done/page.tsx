export default function Done() {
  return (
    <main className="wrap center">
      <div className="panel" style={{ marginTop: 48 }}>
        <div style={{ fontSize: 44, lineHeight: 1, color: 'var(--kc-ok)' }} aria-hidden>✓</div>
        <h1 style={{ fontSize: '1.8rem' }}>Proof sent</h1>
        <p className="muted">Your identity proof is on its way to KEYKARD. Go back to the KEYKARD tab: it continues by itself.</p>
      </div>
    </main>
  )
}
