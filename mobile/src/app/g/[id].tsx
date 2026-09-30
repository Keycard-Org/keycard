import { useEffect, useState } from 'react'
import { router, useLocalSearchParams } from 'expo-router'
import * as Haptics from 'expo-haptics'
import { api } from '@/lib/api'
import { short, toBase, usd } from '@/lib/format'
import { PasskeyCancelled } from '@/lib/passkey'
import { useSession } from '@/lib/session'
import { explainChainError, getSigner, signGuarantee } from '@/lib/wallet'
import { Banner, Button, Check, Chip, Field, Link, Panel, Row, Screen, Text } from '@/ui/kit'
import { WrongAccount } from '@/ui/Account'
import { color } from '@/ui/theme'
import { CheckIcon } from '@/ui/Icons'

type Invite = { inviteId: string; status: string; borrowerWallet: string; requested: string; termEnd: string; termMonths: number }
type Prepared = { cap: string; maxAllowed: string; requested: string; consentText: string; consentHash: string; key: { keyId: `0x${string}`; cap: string; recipient: `0x${string}`; expiry: number } }

export default function Guarantee() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const { me, signedIn } = useSession()
  const [inv, setInv] = useState<Invite | null>(null)
  const [income, setIncome] = useState('')
  const [obligations, setObligations] = useState('')
  const [prep, setPrep] = useState<Prepared | null>(null)
  const [agree, setAgree] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [done, setDone] = useState<{ limit: string; guaranteed: string } | null>(null)

  useEffect(() => {
    api<Invite>(`/api/guarantee/${id}`, { auth: false }).then(setInv).catch((e) => setErr(e.message))
  }, [id])

  const ready = signedIn && me?.user?.role === 'guarantor' && me.identity.verified
  const open = inv && (inv.status === 'open' || inv.status === 'prepared')

  const check = async () => {
    setErr(null)
    setBusy(true)
    try {
      setPrep(await api<Prepared>(`/api/guarantee/${id}/prepare`, { body: { monthlyIncome: toBase(income).toString(), monthlyObligations: toBase(obligations || '0').toString() } }))
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }
  const sign = async () => {
    if (!prep) return
    setErr(null)
    setBusy(true)
    try {
      await signGuarantee(await getSigner(), String(id), prep.key)
      setDone(await api(`/api/guarantee/${id}/confirm`, { body: { consentHash: prep.consentHash } }))
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {})
    } catch (e: any) {
      if (!(e instanceof PasskeyCancelled) && !/cancelled/i.test(e?.message)) setErr(explainChainError(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Screen>
      <Link title="‹ Close" style={{ marginTop: 6 }} onPress={() => router.replace('/')} />
      <Text v="eyebrow" style={{ marginTop: 18 }}>Family backup</Text>
      <Text v="h1" style={{ marginTop: 8 }}>Back someone you trust</Text>
      {inv && (
        <Text style={{ marginTop: 8 }}>
          {short(inv.borrowerWallet)} asks you to back up to <Text style={{ color: color.text, fontFamily: 'Geist_600SemiBold' }}>{usd(inv.requested)}</Text> of their KEYKARD credit line, until {new Date(inv.termEnd).toLocaleDateString()}.
        </Text>
      )}
      {err && <Banner kind="error">{err}</Banner>}
      {inv && !open && !done && <Banner kind="info">{`This invite is ${inv.status}.`}</Banner>}

      {done ? (
        <Panel style={{ alignItems: 'center' }}>
          <CheckIcon />
          <Text v="h2" style={{ marginTop: 8 }}>You’re backing them.</Text>
          <Text v="small" style={{ marginTop: 8, textAlign: 'center' }}>
            Their limit is now {usd(done.limit)}. You’re only charged if they miss a bill and don’t fix it in time, and never more than {usd(done.guaranteed)}.
          </Text>
          <Button title="Done" style={{ marginTop: 18, alignSelf: 'stretch' }} onPress={() => router.replace('/backing')} />
        </Panel>
      ) : !open ? null : !signedIn || !me?.user ? (
        <Panel>
          <Text v="small">To back them, create a family-backup account (a minute: username, fingerprint or password, and Self).</Text>
          <Button testID="g-start" title="Continue" style={{ marginTop: 14 }} onPress={() => router.push({ pathname: '/onboard', params: { role: 'guarantor', next: `/g/${id}` } })} />
          <Button title="I already have an account" kind="ghost" style={{ marginTop: 8 }} onPress={() => router.push('/signin')} />
        </Panel>
      ) : me.user.role !== 'guarantor' ? (
        <WrongAccount me={me} want="family backup" here="Backing someone" />
      ) : !me.identity.verified ? (
        <Panel>
          <Text v="small">Verify with Self first.</Text>
          <Button title="Verify" style={{ marginTop: 12 }} onPress={() => router.push({ pathname: '/onboard', params: { role: 'guarantor', next: `/g/${id}` } })} />
        </Panel>
      ) : !prep ? (
        <Panel>
          <Text v="h2">Can you afford this?</Text>
          <Text v="small" style={{ marginTop: 6 }}>A guarantee can never exceed 20% of your spare monthly income over the term. Lenders that skipped this check have hurt families.</Text>
          <Field testID="g-income" label="Your monthly income (USD)" keyboardType="decimal-pad" value={income} onChangeText={setIncome} />
          <Field testID="g-obligations" label="Your monthly loan & rent payments (USD)" keyboardType="decimal-pad" value={obligations} onChangeText={setObligations} />
          <Button testID="g-check" title="Check what I can back" busy={busy} disabled={!income || !ready} style={{ marginTop: 16 }} onPress={check} />
        </Panel>
      ) : (
        <Panel>
          <Text v="h2">Your guarantee</Text>
          <Row style={{ marginTop: 12 }}>
            <Chip label="You’re backing" value={usd(prep.cap)} />
            <Chip label="Most you could afford" value={usd(prep.maxAllowed)} />
          </Row>
          {BigInt(prep.cap) < BigInt(prep.requested) && <Text v="small" style={{ marginTop: 8 }}>Less than the {usd(prep.requested)} asked, to keep it affordable.</Text>}
          <Text v="small" style={{ marginTop: 12, padding: 12, borderRadius: 12, backgroundColor: color.surface2, color: color.text }}>{prep.consentText}</Text>
          <Check testID="g-agree" checked={agree} onChange={setAgree}>I have read this and I agree.</Check>
          <Button testID="g-sign" title={busy ? 'Signing…' : 'Sign guarantee'} busy={busy} disabled={!agree} style={{ marginTop: 16 }} onPress={sign} />
          <Text v="small" style={{ marginTop: 10, textAlign: 'center' }}>The cap and destination are enforced by the Tempo protocol. You pay no network fees.</Text>
        </Panel>
      )}
    </Screen>
  )
}
