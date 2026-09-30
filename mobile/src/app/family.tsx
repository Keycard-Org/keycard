import { useState } from 'react'
import { Share } from 'react-native'
import { router } from 'expo-router'
import * as Clipboard from 'expo-clipboard'
import { api } from '@/lib/api'
import { short, toBase, usd } from '@/lib/format'
import { useSession } from '@/lib/session'
import { Banner, Button, Field, Link, Panel, Row, Screen, Text } from '@/ui/kit'
import { color } from '@/ui/theme'

export default function Family() {
  const { me, cfg } = useSession()
  const line = me?.line
  const [amount, setAmount] = useState('30')
  const [invite, setInvite] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const create = async () => {
    setErr(null)
    setBusy(true)
    try {
      const r = await api<{ inviteId: string }>('/api/guarantee/invite', { body: { requested: toBase(amount).toString() } })
      setInvite(`${cfg?.publicWebOrigin ?? 'https://www.keykard.xyz'}/g/${r.inviteId}`)
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Screen>
      <Link title="‹ Back" style={{ marginTop: 6 }} onPress={() => router.back()} />
      <Text v="eyebrow" style={{ marginTop: 18 }}>Family backup</Text>
      <Text v="h1" style={{ marginTop: 8 }}>Backed by family, from anywhere.</Text>
      {line?.guarantorWallet ? (
        <Panel>
          <Text v="h3" style={{ color: color.ok }}>You’re backed</Text>
          <Text v="small" style={{ marginTop: 6 }}>
            {short(line.guarantorWallet)} backs your line for up to {usd(line.guaranteed ?? '0')}. They’re only charged if you miss a bill and don’t fix it in time, and never more than that.
          </Text>
        </Panel>
      ) : (
        <>
          <Text style={{ marginTop: 10 }}>
            A relative with income can back your line. They sign one capped permission on their own wallet, which is charged only if you miss a bill. A backup raises your limit a level.
          </Text>
          <Panel>
            <Field testID="family-amount" label="Amount to ask for (USD)" keyboardType="decimal-pad" value={amount} onChangeText={setAmount} />
            {err && <Banner kind="error">{err}</Banner>}
            <Button testID="family-invite" title="Create invite link" busy={busy} disabled={!amount} style={{ marginTop: 16 }} onPress={create} />
          </Panel>
          {invite && (
            <Panel>
              <Text v="h3">Send this to them</Text>
              <Text v="mono" selectable style={{ marginTop: 8, color: color.text }}>{invite}</Text>
              <Row style={{ marginTop: 14 }}>
                <Button title="Share" small onPress={() => Share.share({ message: `Could you back my KEYKARD credit line? It only charges you if I miss a bill, never more than you agree to. ${invite}` })} />
                <Button title="Copy" small kind="quiet" onPress={() => Clipboard.setStringAsync(invite)} />
              </Row>
              <Text v="small" style={{ marginTop: 12 }}>They open it on any phone or computer, verify with Self, and choose how much to back.</Text>
            </Panel>
          )}
        </>
      )}
    </Screen>
  )
}
