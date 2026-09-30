'use client'

import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import { QuadraticBezierLine } from '@react-three/drei'
import { BASE, pointer, sample, type Pose } from './story'
import { FACE_H, FACE_W, drawBack, drawFamily, drawFront } from './cardFace'

export const CARD_W = 3.2
export const CARD_H = (CARD_W * FACE_H) / FACE_W
const DEPTH = 0.03
const RADIUS = 0.16

function roundedRect(w: number, h: number, r: number) {
  const s = new THREE.Shape()
  const x = -w / 2
  const y = -h / 2
  s.moveTo(x + r, y)
  s.lineTo(x + w - r, y)
  s.quadraticCurveTo(x + w, y, x + w, y + r)
  s.lineTo(x + w, y + h - r)
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
  s.lineTo(x + r, y + h)
  s.quadraticCurveTo(x, y + h, x, y + h - r)
  s.lineTo(x, y + r)
  s.quadraticCurveTo(x, y, x + r, y)
  return s
}

/** A rounded-rectangle face with UVs normalised to 0…1, so a canvas texture maps edge to edge. */
function faceGeometry() {
  const g = new THREE.ShapeGeometry(roundedRect(CARD_W, CARD_H, RADIUS), 12)
  const pos = g.attributes.position
  const uv = new Float32Array(pos.count * 2)
  for (let i = 0; i < pos.count; i++) {
    uv[i * 2] = pos.getX(i) / CARD_W + 0.5
    uv[i * 2 + 1] = pos.getY(i) / CARD_H + 0.5
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
  return g
}

function bodyGeometry() {
  const g = new THREE.ExtrudeGeometry(roundedRect(CARD_W - 0.004, CARD_H - 0.004, RADIUS), {
    depth: DEPTH,
    bevelEnabled: true,
    bevelThickness: 0.006,
    bevelSize: 0.006,
    bevelSegments: 3,
    curveSegments: 12,
  })
  g.translate(0, 0, -DEPTH / 2)
  return g
}

/** The auto-pay border: a thin tube around the card, drawn progressively. */
function ringGeometry() {
  const pts = roundedRect(CARD_W + 0.28, CARD_H + 0.28, RADIUS + 0.14)
    .getSpacedPoints(240)
    .map((p) => new THREE.Vector3(p.x, p.y, 0))
  // start at the top middle, run clockwise
  const start = pts.reduce((best, p, i) => (p.y > pts[best].y - 1e-6 && Math.abs(p.x) < Math.abs(pts[best].x) ? i : best), 0)
  const ordered = [...pts.slice(start), ...pts.slice(0, start)].reverse()
  const curve = new THREE.CatmullRomCurve3(ordered, true)
  return new THREE.TubeGeometry(curve, 480, 0.014, 6, true)
}

function canvasTexture(draw: (ctx: CanvasRenderingContext2D) => void) {
  const c = document.createElement('canvas')
  c.width = FACE_W
  c.height = FACE_H
  const ctx = c.getContext('2d')!
  draw(ctx)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 8
  return { t, ctx }
}

// Per-state looks: 0 active · 1 overdue · 2 frozen · 3 defaulted · 4 settled
const SKINS = [
  { tint: '#ffffff', edge: '#8b7cff', irid: 0.6, rough: 0.3 },
  { tint: '#ffc877', edge: '#ffc857', irid: 0.3, rough: 0.36 },
  { tint: '#8e9ab3', edge: '#a8dcff', irid: 0.0, rough: 0.9 },
  { tint: '#ff7a7a', edge: '#ff5c5c', irid: 0.1, rough: 0.5 },
  { tint: '#ffffff', edge: '#ffffff', irid: 1.0, rough: 0.18 },
].map((s) => ({ ...s, tint: new THREE.Color(s.tint), edge: new THREE.Color(s.edge) }))

const tmpA = new THREE.Color()
function skinAt(v: number) {
  const i = Math.max(0, Math.min(SKINS.length - 1, Math.floor(v)))
  const j = Math.min(SKINS.length - 1, i + 1)
  const f = Math.max(0, Math.min(1, v - i))
  const a = SKINS[i]
  const b = SKINS[j]
  return {
    tint: tmpA.copy(a.tint).lerp(b.tint, f),
    edge: new THREE.Color().copy(a.edge).lerp(b.edge, f),
    irid: a.irid + (b.irid - a.irid) * f,
    rough: a.rough + (b.rough - a.rough) * f,
  }
}

function haloTexture() {
  const c = document.createElement('canvas')
  c.width = c.height = 256
  const ctx = c.getContext('2d')!
  const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128)
  g.addColorStop(0, 'rgba(255,255,255,0.9)')
  g.addColorStop(0.35, 'rgba(255,255,255,0.35)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 256, 256)
  return new THREE.CanvasTexture(c)
}

const damp = (cur: number, target: number, lambda: number, dt: number) => cur + (target - cur) * (1 - Math.exp(-lambda * dt))
const expoOut = (t: number) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t))

/** Shared live state so the family card and line can follow the main card. */
export const live = { pos: new THREE.Vector3(), scale: 1, pose: { ...BASE } as Pose }

export function Keycard({ intro = true }: { intro?: boolean }) {
  const viewport = useThree((s) => s.viewport)
  const group = useRef<THREE.Group>(null!)
  const inner = useRef<THREE.Group>(null!)
  const ring = useRef<THREE.Mesh>(null!)
  const ripples = useRef<THREE.Group>(null!)

  const geo = useMemo(() => ({ face: faceGeometry(), body: bodyGeometry(), ring: ringGeometry(), ripple: new THREE.RingGeometry(1, 1.035, 128) }), [])
  const front = useMemo(() => canvasTexture((ctx) => drawFront(ctx, BASE.limit)), [])
  const back = useMemo(() => canvasTexture(drawBack), [])

  const mats = useMemo(() => {
    const physical = (map: THREE.Texture) =>
      new THREE.MeshPhysicalMaterial({
        map,
        // the printed face is lit from within a little, so it always reads, whatever the reflection
        emissiveMap: map,
        emissive: new THREE.Color('#ffffff'),
        emissiveIntensity: 0.6,
        metalness: 0.12,
        roughness: 0.34,
        clearcoat: 1,
        clearcoatRoughness: 0.08,
        iridescence: 0.6,
        iridescenceIOR: 1.35,
        iridescenceThicknessRange: [120, 520],
      })
    return {
      front: physical(front.t),
      back: physical(back.t),
      edge: new THREE.MeshPhysicalMaterial({ color: '#15122a', metalness: 1, roughness: 0.22, emissive: '#8b7cff', emissiveIntensity: 1.6 }),
      ring: new THREE.MeshBasicMaterial({ color: new THREE.Color('#8b7cff').multiplyScalar(2.2), toneMapped: false }),
      halo: new THREE.MeshBasicMaterial({ map: haloTexture(), color: '#8b7cff', transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }),
      ripple: new THREE.MeshBasicMaterial({ color: new THREE.Color('#b3a9ff').multiplyScalar(1.6), toneMapped: false, transparent: true, depthWrite: false }),
    }
  }, [front, back])

  // Fonts arrive after first paint: redraw the faces once they're ready.
  useEffect(() => {
    let alive = true
    document.fonts?.ready.then(() => {
      if (!alive) return
      drawFront(front.ctx, Math.round(live.pose.limit))
      front.t.needsUpdate = true
      drawBack(back.ctx)
      back.t.needsUpdate = true
    })
    return () => {
      alive = false
      Object.values(geo).forEach((g) => g.dispose())
      Object.values(mats).forEach((m) => m.dispose())
      front.t.dispose()
      back.t.dispose()
    }
  }, [front, back, geo, mats])

  const target = useRef<Pose>({ ...BASE })
  const cur = useRef<Pose>({ ...BASE })
  const shownLimit = useRef(BASE.limit)
  const introT = useRef(intro && typeof window !== 'undefined' && window.scrollY < 40 ? 0 : 1)
  const first = useRef(true)

  useFrame((state, rawDt) => {
    const dt = Math.min(rawDt, 1 / 20)
    const t = state.clock.elapsedTime
    sample(window.scrollY, target.current)
    const c = cur.current
    const g = target.current
    if (first.current) {
      Object.assign(c, g)
      first.current = false
    }
    for (const k of Object.keys(c) as (keyof Pose)[]) c[k] = damp(c[k], g[k], k === 'limit' ? 6 : 4.2, dt)
    live.pose = c

    introT.current = Math.min(1, introT.current + dt / 1.9)
    const e = expoOut(introT.current)

    const portrait = viewport.aspect < 0.85
    const fit = Math.min(1, (viewport.width * (portrait ? 0.72 : 0.4)) / CARD_W)
    const px = portrait ? c.x * viewport.width * 0.08 : (c.x * viewport.width) / 2
    const py = portrait ? viewport.height * 0.25 + c.y * viewport.height * 0.2 : (c.y * viewport.height) / 2
    const jitter = c.glitch > 0.02 ? (Math.random() - 0.5) * 0.18 * c.glitch : 0

    group.current.position.set(px + jitter, py + Math.sin(t * 0.9) * 0.05 - (1 - e) * 2.4, c.z - (1 - e) * 2)
    group.current.rotation.set(
      c.rx + pointer.y * 0.14 + Math.sin(t * 0.7) * 0.03 + (1 - e) * 1.1,
      c.ry + pointer.x * 0.28 + (1 - e) * -2.2,
      c.rz + (1 - e) * 0.3 + (c.glitch > 0.02 ? (Math.random() - 0.5) * 0.08 * c.glitch : 0),
    )
    const scale = fit * c.s * (0.35 + 0.65 * c.show) * (0.6 + 0.4 * e)
    group.current.scale.setScalar(scale)
    group.current.visible = c.show > 0.02
    live.pos.copy(group.current.position)
    live.scale = scale

    // live amount on the face
    const lim = Math.round(c.limit)
    if (lim !== shownLimit.current) {
      shownLimit.current = lim
      drawFront(front.ctx, lim)
      front.t.needsUpdate = true
    }

    // state skin (+ red flash while refused)
    const sk = skinAt(c.skin)
    for (const m of [mats.front, mats.back]) {
      m.color.copy(sk.tint)
      m.emissive.copy(sk.tint)
      m.iridescence = sk.irid
      m.roughness = sk.rough
    }
    mats.edge.emissive.copy(sk.edge).lerp(SKINS[3].edge, Math.min(1, c.glitch * 1.4))
    mats.edge.emissiveIntensity = 1.4 + c.glitch * 3
    mats.halo.color.copy(mats.edge.emissive)
    mats.halo.opacity = 0.3 + Math.min(1, c.skin) * 0.25 + c.glitch * 0.4

    // auto-pay border
    const idx = geo.ring.index!.count
    const step = 6 * 6
    const n = Math.floor((idx * Math.min(1, c.ring)) / step) * step
    geo.ring.setDrawRange(0, n)
    ring.current.visible = n > 0

    // NFC ripples: continuous pulse, strength follows scroll
    ripples.current.visible = c.ripple > 0.02
    ripples.current.children.forEach((child, i) => {
      const p = (t * 0.55 + i / 3) % 1
      child.scale.setScalar(0.18 + p * 1.1)
      ;((child as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = (1 - p) * c.ripple * 0.9
    })
  })

  return (
    <group ref={group}>
      <group ref={inner}>
        <mesh material={mats.halo} position-z={-0.4} scale={[CARD_W * 2.1, CARD_H * 2.6, 1]}>
          <planeGeometry />
        </mesh>
        <mesh geometry={geo.body} material={mats.edge} />
        <mesh geometry={geo.face} material={mats.front} position-z={DEPTH / 2 + 0.0075} />
        <mesh geometry={geo.face} material={mats.back} position-z={-DEPTH / 2 - 0.0075} rotation-y={Math.PI} />
        <mesh ref={ring} geometry={geo.ring} material={mats.ring} />
        <group ref={ripples} position={[CARD_W * 0.36, CARD_H * 0.32, 0.05]}>
          {[0, 1, 2].map((i) => (
            <mesh key={i} geometry={geo.ripple} material={mats.ripple.clone()} />
          ))}
        </group>
      </group>
    </group>
  )
}

/** The guarantor's card, tethered to yours by a line of light. */
export function FamilyCard() {
  const group = useRef<THREE.Group>(null!)
  const line = useRef<any>(null)
  const geo = useMemo(() => ({ face: faceGeometry(), body: bodyGeometry() }), [])
  const face = useMemo(() => canvasTexture(drawFamily), [])
  const mats = useMemo(
    () => ({
      face: new THREE.MeshPhysicalMaterial({ map: face.t, metalness: 0.2, roughness: 0.35, clearcoat: 1, clearcoatRoughness: 0.1, iridescence: 0.4 }),
      body: new THREE.MeshPhysicalMaterial({ color: '#d9d4ff', metalness: 0.6, roughness: 0.3 }),
    }),
    [face],
  )
  useEffect(() => {
    document.fonts?.ready.then(() => {
      drawFamily(face.ctx)
      face.t.needsUpdate = true
    })
    return () => {
      Object.values(geo).forEach((g) => g.dispose())
      Object.values(mats).forEach((m) => m.dispose())
      face.t.dispose()
    }
  }, [face, geo, mats])

  const pos = useRef(new THREE.Vector3())
  const a = useMemo(() => new THREE.Vector3(), [])
  const b = useMemo(() => new THREE.Vector3(), [])
  const mid = useMemo(() => new THREE.Vector3(), [])

  useFrame((state, rawDt) => {
    const dt = Math.min(rawDt, 1 / 20)
    const f = live.pose.family
    const s = live.scale
    const visible = f > 0.02
    group.current.visible = visible
    if (line.current) line.current.visible = visible
    if (!visible) {
      pos.current.copy(live.pos)
      return
    }
    const t = state.clock.elapsedTime
    const goal = a.set(live.pos.x - CARD_W * 0.95 * s, live.pos.y - CARD_H * 1.05 * s + Math.sin(t * 1.1) * 0.06, live.pos.z - 0.6)
    pos.current.x = damp(pos.current.x, goal.x, 3, dt)
    pos.current.y = damp(pos.current.y, goal.y, 3, dt)
    pos.current.z = damp(pos.current.z, goal.z, 3, dt)
    group.current.position.copy(pos.current)
    group.current.rotation.set(0.1 + pointer.y * 0.1, 0.35 + pointer.x * 0.2, -0.06)
    group.current.scale.setScalar(s * 0.8 * f)

    a.copy(live.pos).add(new THREE.Vector3(-CARD_W * 0.35 * s, -CARD_H * 0.5 * s, 0))
    b.copy(pos.current).add(new THREE.Vector3(CARD_W * 0.3 * s * 0.8, CARD_H * 0.5 * s * 0.8, 0))
    mid.copy(a).lerp(b, 0.5).add(new THREE.Vector3(0.6 * s, -0.2, 0.4))
    line.current?.setPoints(a, b, mid)
  })

  return (
    <>
      <group ref={group} visible={false}>
        <mesh geometry={geo.body} material={mats.body} />
        <mesh geometry={geo.face} material={mats.face} position-z={DEPTH / 2 + 0.0075} />
      </group>
      <QuadraticBezierLine
        ref={line}
        start={[0, 0, 0]}
        end={[0, 0, 0]}
        color={new THREE.Color('#b3a9ff').multiplyScalar(2)}
        lineWidth={2}
        dashed
        dashScale={8}
        dashSize={0.6}
        gapSize={0.4}
        toneMapped={false}
        visible={false}
      />
    </>
  )
}
