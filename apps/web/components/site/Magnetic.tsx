'use client'

import Link from 'next/link'
import { useRef } from 'react'
import gsap from 'gsap'
import { useGSAP } from '@gsap/react'

/** A pill link that leans toward the cursor (mouse only). */
export function Magnetic({ href, children, variant = 'primary', className = '' }: { href: string; children: React.ReactNode; variant?: 'primary' | 'ghost'; className?: string }) {
  const ref = useRef<HTMLAnchorElement>(null)
  useGSAP(
    () => {
      const el = ref.current
      if (!el || !window.matchMedia('(pointer: fine)').matches || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
      const x = gsap.quickTo(el, 'x', { duration: 0.6, ease: 'expo.out' })
      const y = gsap.quickTo(el, 'y', { duration: 0.6, ease: 'expo.out' })
      const move = (e: PointerEvent) => {
        const r = el.getBoundingClientRect()
        x((e.clientX - (r.left + r.width / 2)) * 0.28)
        y((e.clientY - (r.top + r.height / 2)) * 0.4)
      }
      const leave = () => {
        x(0)
        y(0)
      }
      el.addEventListener('pointermove', move)
      el.addEventListener('pointerleave', leave)
      return () => {
        el.removeEventListener('pointermove', move)
        el.removeEventListener('pointerleave', leave)
      }
    },
    { scope: ref },
  )
  return (
    <Link ref={ref} href={href} className={`kc-pill kc-pill--${variant} ${className}`}>
      <span>{children}</span>
    </Link>
  )
}
