'use client'

import dynamic from 'next/dynamic'
import { useEffect, useState } from 'react'

const Scene = dynamic(() => import('./Scene'), { ssr: false })

function canWebGL() {
  try {
    const c = document.createElement('canvas')
    const gl = (c.getContext('webgl2') || c.getContext('webgl')) as WebGLRenderingContext | null
    if (!gl) return false
    gl.getExtension('WEBGL_lose_context')?.loseContext()
    return true
  } catch {
    return false
  }
}

/**
 * Mounts the 3D layer only when it will work and is wanted: WebGL available and the visitor hasn't asked for
 * reduced motion. It loads after the page is readable (idle callback), so text and layout never wait for three.js.
 * Otherwise the CSS card and plain sections stay: every word is always in the HTML.
 */
export function Stage() {
  const [on, setOn] = useState(false)
  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)')
    if (reduce.matches || !canWebGL()) return
    const start = () => setOn(true)
    const id = 'requestIdleCallback' in window ? (window as any).requestIdleCallback(start, { timeout: 1200 }) : setTimeout(start, 200)
    const onChange = () => reduce.matches && setOn(false)
    reduce.addEventListener('change', onChange)
    return () => {
      reduce.removeEventListener('change', onChange)
      if ('cancelIdleCallback' in window) (window as any).cancelIdleCallback(id)
      else clearTimeout(id)
    }
  }, [])
  return on ? <Scene /> : null
}
