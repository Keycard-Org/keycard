'use client'

import { useRef } from 'react'
import gsap from 'gsap'
import { SplitText } from 'gsap/SplitText'
import { useGSAP } from '@gsap/react'

gsap.registerPlugin(SplitText, useGSAP)

type Tag = 'h1' | 'h2' | 'h3' | 'p' | 'div' | 'span'

/**
 * Line-by-line masked reveal. The text is plain HTML (SEO, screen readers); if JS or GSAP never runs, a CSS
 * timeout un-hides it, so nothing can stay invisible.
 */
export function Reveal({ as = 'div', children, className, delay = 0, onLoad = false, id }: { as?: Tag; children: React.ReactNode; className?: string; delay?: number; onLoad?: boolean; id?: string }) {
  const ref = useRef<HTMLElement>(null)
  useGSAP(
    () => {
      const el = ref.current
      if (!el) return
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        gsap.set(el, { autoAlpha: 1 })
        return
      }
      SplitText.create(el, {
        type: 'lines',
        mask: 'lines',
        autoSplit: true,
        linesClass: 'kc-line',
        onSplit(self) {
          gsap.set(el, { autoAlpha: 1 })
          return gsap.from(self.lines, {
            yPercent: 115,
            duration: 1.2,
            ease: 'expo.out',
            stagger: 0.09,
            delay,
            ...(onLoad ? {} : { scrollTrigger: { trigger: el, start: 'top 88%', once: true } }),
          })
        },
      })
    },
    { scope: ref },
  )
  const Comp = as as any
  return (
    <Comp ref={ref} className={className} data-reveal="" id={id}>
      {children}
    </Comp>
  )
}

/** Fade + rise for non-text blocks. */
export function Rise({ children, className, delay = 0 }: { children: React.ReactNode; className?: string; delay?: number }) {
  const ref = useRef<HTMLDivElement>(null)
  useGSAP(
    () => {
      const el = ref.current
      if (!el) return
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        gsap.set(el, { autoAlpha: 1 })
        return
      }
      gsap.fromTo(
        el,
        { autoAlpha: 0, y: 40 },
        { autoAlpha: 1, y: 0, duration: 1.2, ease: 'expo.out', delay, scrollTrigger: { trigger: el, start: 'top 90%', once: true } },
      )
    },
    { scope: ref },
  )
  return (
    <div ref={ref} className={className} data-reveal="">
      {children}
    </div>
  )
}
