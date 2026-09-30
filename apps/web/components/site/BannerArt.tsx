'use client'

import dynamic from 'next/dynamic'
import { useEffect, useState } from 'react'

const BannerCanvas = dynamic(() => import('./BannerCanvas'), { ssr: false })

/**
 * Social header art. Safe zones for X: the avatar covers the bottom-left, and phones crop the top and bottom,
 * so the copy sits mid-left above the avatar and the cards live in the right half.
 */
export function BannerArt() {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    document.fonts?.ready.then(() => setReady(true))
  }, [])
  return (
    <div className="bn">
      <style>{css}</style>
      <div className="bn-glow" />
      <div className="bn-lines" />
      <div className="bn-canvas">{ready && <BannerCanvas />}</div>
      <div className="bn-grain" />
      <div className="bn-copy">
        <div className="bn-brand">
          <svg viewBox="0 0 30 16" aria-hidden><circle cx="7" cy="8" r="5.5" /><path d="M12.5 8H28M24 8v5" /></svg>
          KEYKARD
        </div>
        <h1>Credit without<br />the bank.</h1>
        <p>No collateral. No fees. Every rule enforced on-chain.</p>
        <div className="bn-tags">
          <span>Passkey wallet</span><i /><span>Auto-pay</span><i /><span>Family backup</span><i /><span>Tap to pay</span>
        </div>
      </div>
      <div className="bn-live"><b /> Live on Tempo testnet</div>
    </div>
  )
}

const css = `
html, body { margin: 0; background: #0A0A0B; }
.bn { position: relative; width: 1500px; height: 500px; overflow: hidden; background: #0A0A0B; color: #F5F5F7; font-family: var(--font-sans-stack); }
.bn-glow { position: absolute; inset: 0;
  background:
    radial-gradient(620px 460px at 1100px 260px, rgba(139,124,255,0.26), transparent 72%),
    radial-gradient(700px 380px at 1250px 520px, rgba(75,63,209,0.30), transparent 70%),
    radial-gradient(520px 300px at 260px -40px, rgba(139,124,255,0.14), transparent 70%); }
.bn-lines { position: absolute; inset: 0; opacity: 0.07;
  background-image: repeating-linear-gradient(172deg, rgba(179,169,255,0.9) 0 1px, transparent 1px 26px);
  -webkit-mask-image: radial-gradient(900px 500px at 1100px 250px, #000, transparent 75%); mask-image: radial-gradient(900px 500px at 1100px 250px, #000, transparent 75%); }
.bn-canvas { position: absolute; inset: 0; }
.bn-grain { position: absolute; inset: 0; opacity: 0.08; mix-blend-mode: overlay; pointer-events: none;
  background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='180' height='180'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='3' stitchTiles='stitch'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>"); }
.bn-copy { position: absolute; left: 96px; top: 96px; width: 640px; }
.bn-brand { display: inline-flex; align-items: center; gap: 12px; font-weight: 700; letter-spacing: 0.24em; font-size: 17px; }
.bn-brand svg { width: 34px; height: 18px; fill: none; stroke: #8B7CFF; stroke-width: 2.2; }
.bn h1 { margin: 26px 0 0; font-size: 76px; line-height: 0.95; letter-spacing: -0.055em; font-weight: 500; }
.bn p { margin: 20px 0 0; font-size: 21px; color: rgba(245,245,247,0.66); letter-spacing: -0.01em; }
.bn-tags { display: flex; align-items: center; gap: 14px; margin-top: 26px; font: 500 13px/1 var(--font-mono-stack); letter-spacing: 0.14em; text-transform: uppercase; color: #B3A9FF; }
.bn-tags i { width: 4px; height: 4px; border-radius: 50%; background: #8B7CFF; box-shadow: 0 0 10px #8B7CFF; }
.bn-live { position: absolute; right: 64px; top: 90px; display: inline-flex; align-items: center; gap: 9px; padding: 9px 15px; border-radius: 99px;
  border: 1px solid rgba(255,255,255,0.12); background: rgba(20,20,22,0.55); backdrop-filter: blur(8px); font: 500 13px/1 var(--font-mono-stack); letter-spacing: 0.08em; color: rgba(245,245,247,0.8); }
.bn-live b { width: 8px; height: 8px; border-radius: 50%; background: #3DDC97; box-shadow: 0 0 12px #3DDC97; }
`
