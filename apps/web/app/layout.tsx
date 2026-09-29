import type { Metadata, Viewport } from 'next'
import Link from 'next/link'
import './globals.css'
import { NetBadge } from '@/components/NetBadge'

export const metadata: Metadata = {
  title: 'KEYCARD — credit your family can back',
  description:
    'A stablecoin credit line on Tempo. Your card can only pay approved merchants, repayment is an auto-debit capped by the blockchain, and family abroad can guarantee you.',
}
export const viewport: Viewport = { width: 'device-width', initialScale: 1 }

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="top">
          <Link href="/" className="brand">KEYCARD</Link>
          <div className="row">
            <Link href="/stats" className="small">Live stats</Link>
            <NetBadge />
          </div>
        </header>
        {children}
      </body>
    </html>
  )
}
