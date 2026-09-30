import Link from 'next/link'
import { Magnetic } from './Magnetic'

export function Nav() {
  return (
    <header className="kc-nav">
      <Link href="/" className="kc-wordmark" aria-label="KEYKARD home">
        <svg viewBox="0 0 30 16" aria-hidden><circle cx="7" cy="8" r="5.5" /><path d="M12.5 8H28M24 8v5" /></svg>
        KEYKARD
      </Link>
      <nav className="kc-nav__links" aria-label="Sections">
        <a href="#how">How it works</a>
        <a href="#family">Family</a>
        <a href="#merchants">Merchants</a>
        <a href="#faq">FAQ</a>
      </nav>
      <Magnetic href="/start" className="kc-pill--sm">Get your card</Magnetic>
    </header>
  )
}
