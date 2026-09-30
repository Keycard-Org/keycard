import Link from 'next/link'
import { NetBadge } from '@/components/NetBadge'

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="app">
      <header className="top">
        <Link href="/" className="brand" aria-label="KEYCARD home">
          <svg viewBox="0 0 30 16" aria-hidden><circle cx="7" cy="8" r="5.5" /><path d="M12.5 8H28M24 8v5" /></svg>
          KEYCARD
        </Link>
        <div className="row">
          <Link href="/stats" className="small">Live</Link>
          <NetBadge />
        </div>
      </header>
      {children}
    </div>
  )
}
