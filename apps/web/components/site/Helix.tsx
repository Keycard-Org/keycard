'use client'

/**
 * Merchant helix: tiles on a tapering spiral that spins with scroll speed.
 *
 * Geometry, spiral layout and the depth-fade shader are ported from
 * github.com/YildizDikme/3D-threejs-spiral-gallery (used with the author's permission).
 * Changes for KEYCARD: one InstancedMesh + a texture atlas instead of 75 meshes/materials, tiles drawn in code,
 * visibility/opacity driven by the scroll story, and the loop does no work while the helix is hidden.
 */

import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import { live, } from './Keycard'
import { pointer } from './story'

const CONFIG = {
  tilesPerRevolution: 15,
  revolutions: 4,
  startRadius: 5,
  endRadius: 3.5,
  tileHeightRatio: 1.1,
  tileSegments: 24,
  spiralGap: 0.35,
  tileOverlap: 0.005,
  baseRotationSpeed: 0.06, // rad/s
  scrollRotationMultiplier: 0.0035,
  rotationDecay: 0.9,
}

const TILES = [
  ['Coffee', '$4.20'],
  ['Groceries', '$18.00'],
  ['Books', '$9.50'],
  ['Transit', '$1.80'],
  ['Street food', '$3.10'],
  ['Pharmacy', '$7.25'],
  ['Freelancers', '$25.00'],
  ['Online stores', '$12.40'],
  ['Tuition', '$40.00'],
  ['Mobile top-up', '$5.00'],
] as const
const COLS = 5
const ROWS = 2
const CELL = 512

function curvedTile(radius: number, arcAngle: number, tileHeight: number, segments: number) {
  const positions: number[] = []
  const uvs: number[] = []
  const indices: number[] = []
  const halfArc = arcAngle / 2
  const halfHeight = tileHeight / 2
  for (let i = 0; i <= segments; i++) {
    const t = i / segments
    const theta = -halfArc + arcAngle * t
    const x = Math.sin(theta) * radius
    const z = Math.cos(theta) * radius
    positions.push(x, halfHeight, z, x, -halfHeight, z)
    uvs.push(t, 1, t, 0)
  }
  for (let i = 0; i < segments; i++) {
    const a = i * 2
    indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  g.setIndex(indices)
  g.computeVertexNormals()
  return g
}

function drawAtlas() {
  const c = document.createElement('canvas')
  c.width = COLS * CELL
  c.height = ROWS * CELL
  const ctx = c.getContext('2d')!
  const sans = getComputedStyle(document.documentElement).getPropertyValue('--font-sans').trim() || 'system-ui'
  TILES.forEach(([name, amount], i) => {
    const x = (i % COLS) * CELL
    const y = Math.floor(i / COLS) * CELL
    const hue = 250 + (i % 5) * 7
    const g = ctx.createLinearGradient(x, y, x + CELL, y + CELL)
    g.addColorStop(0, `hsl(${hue} 45% 16%)`)
    g.addColorStop(1, `hsl(${hue} 30% 6%)`)
    ctx.fillStyle = g
    ctx.fillRect(x, y, CELL, CELL)
    const glow = ctx.createRadialGradient(x + CELL * 0.8, y + CELL * 0.15, 0, x + CELL * 0.8, y + CELL * 0.15, CELL * 0.8)
    glow.addColorStop(0, 'rgba(139,124,255,0.35)')
    glow.addColorStop(1, 'rgba(139,124,255,0)')
    ctx.fillStyle = glow
    ctx.fillRect(x, y, CELL, CELL)

    ctx.fillStyle = 'rgba(179,169,255,0.9)'
    ctx.font = `700 22px ${sans}`
    ctx.letterSpacing = '5px'
    ctx.fillText('KEYCARD MERCHANT', x + 44, y + 76)
    ctx.letterSpacing = '0px'
    ctx.fillStyle = '#f5f5f7'
    ctx.font = `500 64px ${sans}`
    ctx.fillText(name, x + 40, y + 250)
    ctx.fillStyle = 'rgba(245,245,247,0.55)'
    ctx.font = `400 30px ${sans}`
    ctx.fillText(`Paid ${amount} · settled in USDC`, x + 44, y + 410)
    ctx.fillStyle = '#3ddc97'
    ctx.beginPath()
    ctx.arc(x + 56, y + 455, 9, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = 'rgba(245,245,247,0.8)'
    ctx.font = `500 26px ${sans}`
    ctx.fillText('Tempo · seconds', x + 78, y + 464)
  })
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 8
  return { t, redraw: () => { t.needsUpdate = true } }
}

const vertexShader = /* glsl */ `
  attribute float aTile;
  varying vec2 vUv;
  varying vec3 vWorldPosition;
  varying float vTile;
  void main() {
    vUv = uv;
    vTile = aTile;
    vec4 worldPosition = modelMatrix * instanceMatrix * vec4(position, 1.0);
    vWorldPosition = worldPosition.xyz;
    gl_Position = projectionMatrix * viewMatrix * worldPosition;
  }
`

const fragmentShader = /* glsl */ `
  precision highp float;
  uniform sampler2D uMap;
  uniform vec3 uCameraPosition;
  uniform float uOpacity;
  uniform vec2 uGrid;
  varying vec2 vUv;
  varying vec3 vWorldPosition;
  varying float vTile;
  void main() {
    float col = mod(vTile, uGrid.x);
    float row = floor(vTile / uGrid.x);
    vec2 uv = vec2((col + vUv.x) / uGrid.x, 1.0 - (row + 1.0 - vUv.y) / uGrid.y);
    vec4 tex = texture2D(uMap, uv);

    vec2 centered = vUv - 0.5;
    float edge = mix(0.78, 1.0, 1.0 - smoothstep(0.34, 0.86, length(centered)));

    float dist = distance(vWorldPosition, uCameraPosition);
    float depth = mix(0.35, 1.0, 1.0 - smoothstep(8.0, 20.0, dist));

    vec3 color = tex.rgb;
    float luma = dot(color, vec3(0.299, 0.587, 0.114));
    color = mix(vec3(luma) * 0.9, color, depth);
    color *= edge * depth;

    gl_FragColor = vec4(color, uOpacity);
    #include <colorspace_fragment>
  }
`

export function Helix() {
  const { camera, viewport } = useThree()
  const group = useRef<THREE.Group>(null!)
  const mesh = useRef<THREE.InstancedMesh>(null!)
  const total = CONFIG.tilesPerRevolution * CONFIG.revolutions
  const angleStep = (Math.PI * 2) / CONFIG.tilesPerRevolution

  const { geometry, material, atlas } = useMemo(() => {
    const chord = 2 * CONFIG.startRadius * Math.sin(angleStep / 2)
    const geometry = curvedTile(CONFIG.startRadius, angleStep + CONFIG.tileOverlap, chord * CONFIG.tileHeightRatio, CONFIG.tileSegments)
    const tiles = new Float32Array(total)
    for (let i = 0; i < total; i++) tiles[i] = i % TILES.length
    geometry.setAttribute('aTile', new THREE.InstancedBufferAttribute(tiles, 1))
    const atlas = drawAtlas()
    const material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        uMap: { value: atlas.t },
        uCameraPosition: { value: camera.position },
        uOpacity: { value: 0 },
        uGrid: { value: new THREE.Vector2(COLS, ROWS) },
      },
      side: THREE.DoubleSide,
      transparent: true,
      depthWrite: false,
    })
    return { geometry, material, atlas }
  }, [camera, angleStep, total])

  useEffect(() => {
    const m = new THREE.Matrix4()
    const r = new THREE.Matrix4()
    const s = new THREE.Matrix4()
    const totalHeight = (total - 1) * CONFIG.spiralGap
    for (let i = 0; i < total; i++) {
      const p = i / (total - 1)
      const radius = CONFIG.startRadius + (CONFIG.endRadius - CONFIG.startRadius) * p
      s.makeScale(radius / CONFIG.startRadius, 1, radius / CONFIG.startRadius)
      r.makeRotationY(i * angleStep)
      m.makeTranslation(0, totalHeight / 2 - i * CONFIG.spiralGap, 0).multiply(r).multiply(s)
      mesh.current.setMatrixAt(i, m)
    }
    mesh.current.instanceMatrix.needsUpdate = true
    document.fonts?.ready.then(() => {
      const fresh = drawAtlas()
      material.uniforms.uMap.value = fresh.t
      atlas.t.dispose()
    })
    return () => {
      geometry.dispose()
      material.dispose()
      atlas.t.dispose()
    }
  }, [geometry, material, atlas, angleStep, total])

  const spin = useRef(0)
  const lastScroll = useRef(0)
  const tilt = useRef({ x: 0, z: 0 })
  const opacity = useRef(0)

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 1 / 20)
    const target = live.pose.helix
    opacity.current += (target - opacity.current) * (1 - Math.exp(-4 * dt))
    const visible = opacity.current > 0.01
    group.current.visible = visible
    const y = window.scrollY
    const velocity = y - lastScroll.current
    lastScroll.current = y
    if (!visible) return

    material.uniforms.uOpacity.value = opacity.current
    spin.current = spin.current * CONFIG.rotationDecay + velocity * CONFIG.scrollRotationMultiplier * 0.4
    group.current.rotation.y += CONFIG.baseRotationSpeed * dt + spin.current
    tilt.current.x += (pointer.y * 0.1 - tilt.current.x) * 0.075
    tilt.current.z += (pointer.x * -0.05 - tilt.current.z) * 0.075
    group.current.rotation.x = tilt.current.x
    group.current.rotation.z = tilt.current.z

    const portrait = viewport.aspect < 0.85
    const k = portrait ? 0.34 : 0.62
    group.current.scale.setScalar(k * (0.9 + 0.1 * opacity.current))
    group.current.position.set(portrait ? 0 : viewport.width * 0.2, portrait ? viewport.height * 0.12 : 0, -2)
  })

  return (
    <group ref={group} visible={false}>
      <instancedMesh ref={mesh} args={[geometry, material, total]} frustumCulled={false} />
    </group>
  )
}
