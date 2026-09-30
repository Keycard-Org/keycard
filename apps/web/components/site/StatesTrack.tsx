'use client'

import { useRef } from 'react'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { useGSAP } from '@gsap/react'
import { CssCard, type CardSkin } from './CssCard'

gsap.registerPlugin(ScrollTrigger, useGSAP)

const STATES: { skin: CardSkin; title: string; body: string; amount: string }[] = [
  { skin: 'active', title: 'Active', body: 'Auto-pay is on. You can see your next bill and exactly how much it will take.', amount: '$50' },
  { skin: 'overdue', title: 'Overdue', body: '$5 is late. Your card pauses and one button fixes it. Pay before the deadline and nothing is recorded.', amount: '$5 due' },
  { skin: 'frozen', title: 'Frozen', body: 'You revoked auto-pay, and the chain froze your card instantly. Re-enable it and you’re back.', amount: '$50' },
  { skin: 'defaulted', title: 'Defaulted', body: 'Missed past the deadline. It goes on your public credit file, and paying it settles your record.', amount: '$20 due' },
  { skin: 'settled', title: 'Settled', body: 'All square. Your record shows you paid, and you can open a new line.', amount: '$0' },
]

/**
 * Pinned horizontal scroll through the five card states. The 3D card changes skin in step (markers below);
 * without 3D, each panel shows its own CSS card.
 */
export function StatesTrack() {
  const wrap = useRef<HTMLDivElement>(null)
  const track = useRef<HTMLDivElement>(null)
  useGSAP(
    () => {
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
      const el = track.current!
      gsap.to(el, {
        xPercent: -100 * (STATES.length - 1),
        ease: 'none',
        scrollTrigger: {
          trigger: wrap.current,
          start: 'top top',
          end: 'bottom bottom',
          scrub: 0.6,
          invalidateOnRefresh: true,
          snap: { snapTo: 1 / (STATES.length - 1), duration: { min: 0.25, max: 0.7 }, delay: 0.08, ease: 'power2.inOut' },
        },
      })
    },
    { scope: wrap },
  )
  return (
    <div ref={wrap} className="kc-states" style={{ ['--n' as any]: STATES.length }}>
      {STATES.map((_, i) => (
        <i key={i} data-k={`states-${i}`} className="kc-marker" style={{ top: `calc(${i} * (100% - 100vh) / ${STATES.length - 1} + 50vh)` }} />
      ))}
      <div className="kc-states__sticky">
        <div className="kc-states__head">
          <p className="kc-kicker">04 · Status</p>
          <h2 className="kc-h2">Your card tells you where you stand.</h2>
        </div>
        <div className="kc-states__viewport">
        <div ref={track} className="kc-states__track">
          {STATES.map((s, i) => (
            <article key={s.skin} className={`kc-state kc-state--${s.skin}`}>
              <span className="kc-state__n">0{i + 1}</span>
              <CssCard skin={s.skin} amount={s.amount} className="kc-state__card kc-only-fallback" />
              <h3>{s.title}</h3>
              <p>{s.body}</p>
            </article>
          ))}
        </div>
        </div>
      </div>
    </div>
  )
}
