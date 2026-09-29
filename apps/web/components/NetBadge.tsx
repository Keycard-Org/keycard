'use client'
import { useEffect, useState } from 'react'
import { getConfig } from '@/lib/api'

export function NetBadge() {
  const [net, setNet] = useState<string | null>(null)
  useEffect(() => {
    getConfig().then((c) => setNet(c.network === 'mainnet' ? 'Tempo mainnet' : 'Tempo testnet')).catch(() => setNet('offline'))
  }, [])
  return net ? <span className="net">{net}</span> : null
}
