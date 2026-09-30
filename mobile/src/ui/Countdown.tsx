import { useEffect, useState } from 'react'
import { until } from '@/lib/format'
import { Text } from './kit'
import { color, font } from './theme'

/** Only this label re-renders each second, not the whole screen. */
export function Countdown({ to }: { to: string | null }) {
  const [, setTick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [])
  const v = until(to)
  return <Text style={{ fontFamily: font.medium, fontSize: 17, color: color.text, marginTop: 2, fontVariant: ['tabular-nums'] }}>{to ? (v === 'now' ? 'due now' : `in ${v}`) : '—'}</Text>
}

