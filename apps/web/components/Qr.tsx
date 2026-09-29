'use client'
import { useEffect, useState } from 'react'
import QRCode from 'qrcode'

export function Qr({ value, size = 200 }: { value: string; size?: number }) {
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    QRCode.toDataURL(value, { margin: 1, width: size }).then(setSrc).catch(() => setSrc(null))
  }, [value, size])
  return src ? <img src={src} width={size} height={size} alt="QR code" style={{ borderRadius: 8, background: '#fff' }} /> : null
}

export function CopyText({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="row">
      <span className="mono" style={{ flex: 1 }}>{text}</span>
      <button
        className="ghost"
        onClick={() => {
          navigator.clipboard.writeText(text).then(() => {
            setCopied(true)
            setTimeout(() => setCopied(false), 1500)
          })
        }}
      >
        {copied ? 'Copied' : label ?? 'Copy'}
      </button>
    </div>
  )
}
