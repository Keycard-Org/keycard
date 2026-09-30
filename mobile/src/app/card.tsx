import { Redirect, useLocalSearchParams } from 'expo-router'
import { codeFromQr } from '@/lib/qr'
import { homeFor, useSession } from '@/lib/session'

/** App Link target for https://…/card?pay=CODE (merchant QR codes scanned with the phone camera). */
export default function CardLink() {
  const { pay } = useLocalSearchParams<{ pay?: string }>()
  const { me, loading, signedIn } = useSession()
  if (loading) return null
  if (!signedIn || !me) return <Redirect href="/welcome" />
  const code = pay ? codeFromQr(String(pay)) : null
  if (code && me.user?.role === 'borrower' && me.line?.status === 'active') return <Redirect href={{ pathname: '/pay', params: { code } }} />
  return <Redirect href={homeFor(me) as any} />
}
