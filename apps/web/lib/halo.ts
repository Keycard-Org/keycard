'use client'

import type { Address, Hex } from 'viem'
import { Signature, PublicKey } from 'ox'
import { Account } from 'viem/tempo'

/**
 * Physical KEYKARD: Burner card / Arx HaLo NFC chip, KEY SLOT 1 (factory secp256k1, no PIN, raw digests allowed).
 * We never use slots 8/9 (the Burner wallet key, PIN-locked, 20 wrong PINs brick the card).
 * libhalo picks the transport itself: Web NFC on Android Chrome, the WebAuthn "credential" method on iPhone Safari.
 * Requires HTTPS.
 */
export const CARD_KEY_SLOT = 1

async function halo(cmd: any, onStatus?: (s: string) => void) {
  const { execHaloCmdWeb } = await import('@arx-research/libhalo/api/web')
  return execHaloCmdWeb(cmd, {
    statusCallback: (cause: string) => {
      const msg =
        cause === 'init' ? 'Hold the card to the back of the phone…'
        : cause === 'again' ? 'Tap the card again…'
        : cause === 'retry' ? 'Keep the card still and tap again…'
        : cause === 'scanned' ? 'Card read.'
        : cause
      onStatus?.(msg)
    },
  } as any)
}

/** Tap 1: which card is this? (public key + address of slot 1) */
export async function readCard(onStatus?: (s: string) => void): Promise<{ address: Address; publicKey: Hex }> {
  const r = await halo({ name: 'get_pkeys' }, onStatus)
  const pk = String(r.publicKeys[CARD_KEY_SLOT])
  const addr = String(r.etherAddresses[CARD_KEY_SLOT])
  return { address: addr.toLowerCase() as Address, publicKey: (pk.startsWith('0x') ? pk : `0x${pk}`) as Hex }
}

/** Chip signs a raw 32-byte digest with slot 1. Returns a 65-byte r||s||v signature + the card address. */
export async function cardSignDigest(digest: Hex, onStatus?: (s: string) => void): Promise<{ signature: Hex; address: Address; publicKey: Hex }> {
  const r = await halo({ name: 'sign', keyNo: CARD_KEY_SLOT, digest: digest.slice(2) }, onStatus)
  const raw = r.signature.raw
  if (!raw) throw new Error('card did not return a raw signature')
  const signature = Signature.toHex({ r: BigInt(`0x${raw.r}`), s: BigInt(`0x${raw.s}`), yParity: raw.v - 27 } as any) as Hex
  const pk = String(r.publicKey)
  return { signature, address: String(r.etherAddress).toLowerCase() as Address, publicKey: (pk.startsWith('0x') ? pk : `0x${pk}`) as Hex }
}

/** The chip acting as an access key on the credit account (signs the Tempo tx hash on tap). */
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

export const nfcSupportedHint = () =>
  typeof window === 'undefined'
    ? ''
    : 'NDEFReader' in window
      ? 'Android: NFC via Chrome.'
      : /iPhone|iPad/.test(navigator.userAgent)
        ? 'iPhone: an NFC sheet will appear, hold the card near the top of the phone.'
        : 'This device may not have NFC. Use a phone.'
