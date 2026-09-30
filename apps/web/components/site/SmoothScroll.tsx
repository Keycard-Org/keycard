'use client'

import { useEffect } from 'react'
import { ReactLenis, useLenis } from 'lenis/react'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { SplitText } from 'gsap/SplitText'

gsap.registerPlugin(ScrollTrigger, SplitText)

/** Drives Lenis from the GSAP ticker once the Lenis instance exists (it is created after first render). */
function Clock() {
  const lenis = useLenis()
  useEffect(() => {
    if (!lenis) return
    const tick = (t: number) => lenis.raf(t * 1000)
    gsap.ticker.add(tick)
    gsap.ticker.lagSmoothing(0)
    const update = () => ScrollTrigger.update()
    lenis.on('scroll', update)
    return () => {
      gsap.ticker.remove(tick)
      lenis.off('scroll', update)
    }
  }, [lenis])
  return null
}

/**
 * One clock for everything: Lenis is driven from the GSAP ticker and feeds ScrollTrigger, so smooth scroll,
 * scroll-linked text and the 3D card never disagree. Touch keeps native scrolling; Lenis turns itself off
 * for reduced motion (respectReducedMotion).
 */
export function SmoothScroll({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    document.documentElement.classList.add('kc-js')
  }, [])
  return (
    <ReactLenis root options={{ autoRaf: false, lerp: 0.1, smoothWheel: true, anchors: true }}>
      <Clock />
      {children}
    </ReactLenis>
  )
}
