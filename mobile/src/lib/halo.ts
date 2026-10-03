import NfcManager, { NfcAdapter, NfcTech } from 'react-native-nfc-manager'
import type { Address, Hex } from 'viem'
import { PublicKey, Signature } from 'ox'
import { Account } from 'viem/tempo'

/**
 * Physical KEYKARD: Burner card / Arx HaLo NFC chip, KEY SLOT 1 (factory secp256k1, no PIN, raw digests allowed).
 * Slots 8/9 (the Burner wallet key, PIN-locked) are never used. Android talks to the chip over ISO-DEP.
 *
 * ONE TAP per action: a single NFC session in reader mode covers every command (read the card, sign), and stays
 * open until the whole action is finished. While it is open the app owns the reader, so Android never hands the
 * card to the browser (Burner cards carry a web link), which used to interrupt the app between two taps.
 */
export const CARD_KEY_SLOT = 1

export async function nfcState(): Promise<'ok' | 'off' | 'none'> {
  if (process.env.EXPO_PUBLIC_FAKE_NFC === '1') return 'ok' // test builds only: exercise the tap UI on an emulator
  try {
    if (!(await NfcManager.isSupported())) return 'none'
    await NfcManager.start()
    return (await NfcManager.isEnabled()) ? 'ok' : 'off'
  } catch {
    return 'none'
  }
}
export const openNfcSettings = () => NfcManager.goToNfcSetting().catch(() => {})

export type CardSession = {
  /** run a libhalo command on the card that is being held */
  exec: (cmd: any) => Promise<any>
}

function friendly(e: any): Error {
  const m = String(e?.message ?? e)
  if (/cancel/i.test(m)) return new Error('Cancelled.')
  if (/Tag was lost|TagLost|transceive|IOException/i.test(m)) return new Error('The card moved away too soon. Hold it flat against the back of the phone until it says done.')
  if (/no nfc support|not support/i.test(m)) return new Error('This phone can’t read NFC cards. Use a phone with NFC.')
  if (/nfc.*(disabled|not enabled|off)/i.test(m)) return new Error('NFC is turned off. Turn it on in Settings and try again.')
  return e instanceof Error ? e : new Error(m)
}

let busy = false
/**
 * Opens one NFC session, waits for a card, then runs `fn` with it. The reader stays reserved until `fn` finishes
 * (even after the card is no longer needed), then is always released.
 */
export async function withCard<T>(fn: (s: CardSession) => Promise<T>, onTapped?: () => void): Promise<T> {
  if (busy) throw new Error('Already waiting for a card.')
  busy = true
  let execHaloCmdRN: any
  try {
    ;({ execHaloCmdRN } = await import('@arx-research/libhalo/api/react-native'))
  } catch (e: any) {
    busy = false
    throw new Error(`Couldn’t start the card reader (${String(e?.message ?? e).slice(0, 80)}). Update the app and try again.`)
  }
  try {
    await NfcManager.start()
    await NfcManager.requestTechnology(NfcTech.IsoDep, {
      isReaderModeEnabled: true,
      readerModeFlags: NfcAdapter.FLAG_READER_NFC_A | NfcAdapter.FLAG_READER_SKIP_NDEF_CHECK,
      alertMessage: 'Hold your KEYKARD near the phone',
    } as any)
    onTapped?.()
    const session: CardSession = {
      exec: async (cmd) => {
        try {
          return await execHaloCmdRN(NfcManager as any, cmd)
        } catch (e) {
          throw friendly(e)
        }
      },
    }
    return await fn(session)
  } catch (e) {
    throw friendly(e)
  } finally {
    busy = false
    await NfcManager.cancelTechnologyRequest().catch(() => {})
  }
}
export const cancelCardRead = () => NfcManager.cancelTechnologyRequest().catch(() => {})

const hex0x = (s: string) => (s.startsWith('0x') ? s : `0x${s}`) as Hex

/** Which card is this? (public key + address of slot 1) */
export async function readCard(s: CardSession): Promise<{ address: Address; publicKey: Hex }> {
  const r: any = await s.exec({ name: 'get_pkeys' })
  return { address: String(r.etherAddresses[CARD_KEY_SLOT]).toLowerCase() as Address, publicKey: hex0x(String(r.publicKeys[CARD_KEY_SLOT])) }
}

/** The chip signs a raw 32-byte digest with slot 1 → 65-byte r‖s‖v signature + the card's address. */
export async function cardSignDigest(s: CardSession, digest: Hex): Promise<{ signature: Hex; address: Address; publicKey: Hex }> {
  const r: any = await s.exec({ name: 'sign', keyNo: CARD_KEY_SLOT, digest: digest.slice(2) })
  const raw = r.signature?.raw
  if (!raw) throw new Error('The card did not return a signature. Try again.')
  const signature = Signature.toHex({ r: BigInt(hex0x(raw.r)), s: BigInt(hex0x(raw.s)), yParity: raw.v - 27 } as any) as Hex
  return { signature, address: String(r.etherAddress).toLowerCase() as Address, publicKey: hex0x(String(r.publicKey)) }
}

/** The chip acting as an access key on the credit account: signs the Tempo transaction hash in the same session. */
export function cardAccessKeyAccount(s: CardSession, creditAccount: Address, cardPublicKey: Hex, onSigned?: () => void) {
  return Account.from({
    access: creditAccount,
    keyType: 'secp256k1',
    publicKey: PublicKey.fromHex(cardPublicKey),
    async sign({ hash }: { hash: Hex }) {
      const { signature } = await cardSignDigest(s, hash)
      onSigned?.()
      return signature
    },
  } as any)
}
