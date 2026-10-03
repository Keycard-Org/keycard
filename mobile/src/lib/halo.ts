import NfcManager, { NfcTech } from 'react-native-nfc-manager'
import type { Address, Hex } from 'viem'
import { PublicKey, Signature } from 'ox'
import { Account } from 'viem/tempo'

/**
 * Physical KEYKARD: Burner card / Arx HaLo NFC chip, KEY SLOT 1 (factory secp256k1, no PIN, raw digests allowed).
 * Slots 8/9 (the Burner wallet key, PIN-locked) are never used. Android talks to the chip over ISO-DEP.
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

let busy = false
/** One tap: open an ISO-DEP session, run the command, always release the NFC reader. */
async function halo(cmd: any, onStatus?: (s: string) => void) {
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
    onStatus?.('Hold the card to the back of the phone…')
    await NfcManager.requestTechnology(NfcTech.IsoDep, { alertMessage: 'Hold your KEYKARD near the phone' } as any)
    onStatus?.('Reading card…')
    return await execHaloCmdRN(NfcManager as any, cmd)
  } catch (e: any) {
    const m = String(e?.message ?? e)
    if (/cancel/i.test(m)) throw new Error('Cancelled.')
    if (/Tag was lost|TagLost|transceive/i.test(m)) throw new Error('The card moved away too soon. Hold it still against the phone and try again.')
    if (/no nfc support|not support/i.test(m)) throw new Error('This phone can’t read NFC cards. Use a phone with NFC.')
    if (/nfc.*(disabled|not enabled|off)/i.test(m)) throw new Error('NFC is turned off. Turn it on in Settings and try again.')
    throw e
  } finally {
    busy = false
    await NfcManager.cancelTechnologyRequest().catch(() => {})
  }
}
export const cancelCardRead = () => NfcManager.cancelTechnologyRequest().catch(() => {})

const hex0x = (s: string) => (s.startsWith('0x') ? s : `0x${s}`) as Hex

/** Which card is this? (public key + address of slot 1) */
export async function readCard(onStatus?: (s: string) => void): Promise<{ address: Address; publicKey: Hex }> {
  const r: any = await halo({ name: 'get_pkeys' }, onStatus)
  return { address: String(r.etherAddresses[CARD_KEY_SLOT]).toLowerCase() as Address, publicKey: hex0x(String(r.publicKeys[CARD_KEY_SLOT])) }
}

/** The chip signs a raw 32-byte digest with slot 1 → 65-byte r‖s‖v signature + the card's address. */
export async function cardSignDigest(digest: Hex, onStatus?: (s: string) => void): Promise<{ signature: Hex; address: Address; publicKey: Hex }> {
  const r: any = await halo({ name: 'sign', keyNo: CARD_KEY_SLOT, digest: digest.slice(2) }, onStatus)
  const raw = r.signature?.raw
  if (!raw) throw new Error('The card did not return a signature. Try again.')
  const signature = Signature.toHex({ r: BigInt(hex0x(raw.r)), s: BigInt(hex0x(raw.s)), yParity: raw.v - 27 } as any) as Hex
  return { signature, address: String(r.etherAddress).toLowerCase() as Address, publicKey: hex0x(String(r.publicKey)) }
}

/** The chip acting as an access key on the credit account: signs the Tempo transaction hash on tap. */
export function cardAccessKeyAccount(creditAccount: Address, cardPublicKey: Hex, onStatus?: (s: string) => void) {
  return Account.from({
    access: creditAccount,
    keyType: 'secp256k1',
    publicKey: PublicKey.fromHex(cardPublicKey),
    async sign({ hash }: { hash: Hex }) {
      const { signature } = await cardSignDigest(hash, onStatus)
      return signature
    },
  } as any)
}
