'use client'

import { Canvas, useFrame } from '@react-three/fiber'
import { Bloom, EffectComposer } from '@react-three/postprocessing'
import { useState } from 'react'
import { Keycard } from './Keycard'
import { Studio } from './Scene'

function Ready() {
  const [n, setN] = useState(0)
  useFrame(() => {
    if (n === 90) document.documentElement.dataset.bannerReady = '1'
    if (n <= 90) setN(n + 1)
  })
  return null
}

/** Two KEYKARDs, the same 3D object as the website, posed for the header. */
export default function BannerCanvas() {
  return (
    <Canvas dpr={2} camera={{ position: [0, 0, 10], fov: 30 }} gl={{ antialias: true, alpha: true, preserveDrawingBuffer: true }}>
      <Studio />
      <Keycard fixed={{ x: 0.36, y: 0.16, z: -1.6, rx: 0.22, ry: -0.72, rz: 0.2, s: 0.92, limit: 50 }} fit={0.2} halo={0.25} />
      <Keycard fixed={{ x: 0.6, y: -0.06, z: 0, rx: 0.14, ry: -0.36, rz: -0.07, limit: 100 }} fit={0.23} halo={0.35} />
      <EffectComposer multisampling={0}>
        <Bloom mipmapBlur luminanceThreshold={1} intensity={0.6} radius={0.7} />
      </EffectComposer>
      <Ready />
    </Canvas>
  )
}
