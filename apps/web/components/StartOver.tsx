'use client'
import { startOver } from '@/lib/wallet'

/** Always-available escape hatch: forget this browser's KEYKARD session and wallet reference. */
export function StartOver({ label = 'Not you? Start over' }: { label?: string }) {
  return (
    <p className="small muted" style={{ textAlign: 'center', marginTop: 18 }}>
      <a
        href="#"
        onClick={(e) => {
          e.preventDefault()
          if (!confirm('Forget this KEYKARD session on this browser? (Your account and any on-chain line are not deleted.)')) return
          startOver()
          window.location.href = window.location.pathname
        }}
      >
        {label}
      </a>
    </p>
  )
}
