'use client'

import { useEffect, useRef } from 'react'
import { ReactLenis, type LenisRef } from 'lenis/react'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { SplitText } from 'gsap/SplitText'

gsap.registerPlugin(ScrollTrigger, SplitText)

/**
 * One clock for everything: Lenis is driven from the GSAP ticker and feeds ScrollTrigger, so smooth scroll,
 * scroll-linked text and the 3D card never disagree. Touch devices and reduced-motion keep native scrolling.
 */
export function SmoothScroll({ children }: { children: React.ReactNode }) {
  const ref = useRef<LenisRef>(null)
  useEffect(() => {
    document.documentElement.classList.add('kc-js')
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const lenis = ref.current?.lenis
    if (!lenis) return
    // touch is never smoothed by Lenis (native scrolling); reduced motion turns wheel smoothing off too
    if (reduce) lenis.options.smoothWheel = false
    const tick = (t: number) => lenis.raf(t * 1000)
    gsap.ticker.add(tick)
    gsap.ticker.lagSmoothing(0)
    lenis.on('scroll', ScrollTrigger.update)
    return () => {
      gsap.ticker.remove(tick)
      lenis.off('scroll', ScrollTrigger.update)
    }
  }, [])
  return (
    <ReactLenis root ref={ref} options={{ autoRaf: false, lerp: 0.1, smoothWheel: true, anchors: true }}>
      {children}
    </ReactLenis>
  )
}
