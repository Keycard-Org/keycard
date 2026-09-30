'use client'
import { useState } from 'react'
import { api } from '@/lib/api'

/** Greets the user by @username; accounts created before usernames existed can choose one once. */
export function UsernameBanner({ username, onSet }: { username?: string | null; onSet: () => void }) {
  const [v, setV] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  if (username) return <p className="muted" style={{ margin: '6px 2px 14px', fontSize: 15 }}>Hi, <b style={{ color: 'var(--kc-text)' }}>@{username}</b></p>
  const save = async () => {
    setErr(null)
    setBusy(true)
    try {
      await api('/api/me/username', { body: { username: v.trim().toLowerCase() } })
      onSet()
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="panel">
      <b className="small">Choose a username</b>
      <div className="row" style={{ marginTop: 8 }}>
        <input style={{ flex: 1 }} autoCapitalize="none" placeholder="e.g. maria.santos" value={v} onChange={(e) => setV(e.target.value.replace(/\s/g, ''))} />
        <button disabled={busy || v.trim().length < 3} onClick={save}>Save</button>
      </div>
      {err && <p className="small error">{err}</p>}
    </div>
  )
}
