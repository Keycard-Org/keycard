import Link from 'next/link'
import { NetBadge } from '@/components/NetBadge'

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <header className="top">
        <Link href="/" className="brand">KEYCARD</Link>
        <div className="row">
          <Link href="/stats" className="small">Live stats</Link>
          <NetBadge />
        </div>
      </header>
      {children}
    </>
  )
}
