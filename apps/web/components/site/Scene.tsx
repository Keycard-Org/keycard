'use client'

import { useEffect, useState } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { Environment, Lightformer, PerformanceMonitor } from '@react-three/drei'
import { Bloom, EffectComposer } from '@react-three/postprocessing'
import { FamilyCard, Keycard } from './Keycard'
import { Helix } from './Helix'
import { measure, pointer } from './story'

/** Marks the page as "3D is live" after the first real frame, so the CSS fallback card can step aside. */
function Ready() {
  const [done, setDone] = useState(false)
  useFrame(() => {
    if (done) return
    document.documentElement.classList.add('kc-webgl')
    setDone(true)
  })
  return null
}

function Studio() {
  return (
    <Environment resolution={256} frames={1}>
      <Lightformer form="rect" intensity={3} position={[0, 5, -2]} scale={[12, 3, 1]} rotation-x={Math.PI / 2} />
      <Lightformer form="rect" intensity={2.2} position={[-6, 1, 2]} scale={[3, 8, 1]} rotation-y={Math.PI / 2} color="#b3a9ff" />
      <Lightformer form="rect" intensity={1.6} position={[6, -1, 2]} scale={[3, 8, 1]} rotation-y={-Math.PI / 2} color="#ffffff" />
      <Lightformer form="ring" intensity={2.5} position={[2, 2, 6]} scale={3} color="#8b7cff" />
      <Lightformer form="rect" intensity={0.8} position={[0, -5, 0]} scale={[10, 2, 1]} rotation-x={-Math.PI / 2} color="#4b3fd1" />
    </Environment>
  )
}

export default function Scene() {
  const [coarse] = useState(() => window.matchMedia('(pointer: coarse)').matches)
  const [dpr, setDpr] = useState(coarse ? 1.25 : 1.5)
  const [fx, setFx] = useState(!coarse)

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return
      pointer.x = (e.clientX / window.innerWidth) * 2 - 1
      pointer.y = (e.clientY / window.innerHeight) * 2 - 1
    }
    const remeasure = () => measure()
    window.addEventListener('pointermove', onMove, { passive: true })
    window.addEventListener('resize', remeasure)
    const ro = new ResizeObserver(remeasure)
    ro.observe(document.body)
    document.fonts?.ready.then(remeasure)
    measure()
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('resize', remeasure)
      ro.disconnect()
      document.documentElement.classList.remove('kc-webgl')
    }
  }, [])

  return (
    <Canvas
      className="kc-canvas"
      dpr={[1, dpr]}
      camera={{ position: [0, 0, 10], fov: 35, near: 0.1, far: 60 }}
      gl={{ antialias: true, alpha: true, powerPreference: 'high-performance', failIfMajorPerformanceCaveat: false }}
      aria-hidden
    >
      <PerformanceMonitor
        onDecline={() => {
          setDpr(1)
          setFx(false)
        }}
      />
      <Studio />
      <Keycard />
      <FamilyCard />
      <Helix />
      {fx && (
        <EffectComposer multisampling={0}>
          <Bloom mipmapBlur luminanceThreshold={1} intensity={0.55} radius={0.7} />
        </EffectComposer>
      )}
      <Ready />
    </Canvas>
  )
}
