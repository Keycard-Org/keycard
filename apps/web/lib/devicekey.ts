'use client'

import type { Hex } from 'viem'
import { generatePrivateKey, privateKeyToAddress } from 'viem/accounts'

/**
 * Password wallet ("device key"): a secp256k1 key generated in the browser and stored ONLY encrypted
 * (PBKDF2-SHA256 600k iterations → AES-256-GCM), the MetaMask model. The password never leaves the device.
 * Trade-offs shown in the UI: the key lives on this device only; security equals password strength.
 */
const STORE = 'keycard.devicekey'
const ITER = 600_000
type Vault = { address: `0x${string}`; salt: string; iv: string; ct: string; iter: number }

let unlocked: { address: `0x${string}`; pk: Hex } | null = null

const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u))
const unb64 = (s: string): Uint8Array<ArrayBuffer> => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))

async function deriveKey(password: string, salt: Uint8Array<ArrayBuffer>, iter: number) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, base, { name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt',
  ])
}

export function deviceVault(): Vault | null {
  try {
    const s = localStorage.getItem(STORE)
    return s ? (JSON.parse(s) as Vault) : null
  } catch {
    return null
  }
}

export async function createDeviceKey(password: string) {
  if (password.length < 10) throw new Error('Use at least 10 characters.')
  const pk = generatePrivateKey()
  const address = privateKeyToAddress(pk)
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await deriveKey(password, salt, ITER)
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(pk)))
  const v: Vault = { address, salt: b64(salt), iv: b64(iv), ct: b64(ct), iter: ITER }
  localStorage.setItem(STORE, JSON.stringify(v))
  unlocked = { address, pk }
  return { ...unlocked, vault: v }
}

/**
 * Login proof for password sign-in on other devices: a SEPARATE derivation (different salt) from the vault key,
 * so the server can check the password without ever being able to decrypt the vault.
 */
export async function deriveAuthProof(username: string, password: string): Promise<string> {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits'])
  const salt = new TextEncoder().encode(`keycard-auth:${username.trim().toLowerCase()}`)
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITER }, base, 256)
  return [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** Install a vault fetched from KEYKARD (encrypted) and unlock it locally with the password. */
export async function importVaultAndUnlock(vault: Vault, password: string) {
  localStorage.setItem(STORE, JSON.stringify(vault))
  return unlockDeviceKey(password)
}

export async function unlockDeviceKey(password: string) {
  const v = deviceVault()
  if (!v) throw new Error('No password wallet on this device.')
  try {
    const key = await deriveKey(password, unb64(v.salt), v.iter)
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(v.iv) }, key, unb64(v.ct))
    unlocked = { address: v.address, pk: new TextDecoder().decode(pt) as Hex }
    return unlocked
  } catch {
    throw new Error('Wrong password.')
  }
}

export const unlockedDeviceKey = () => unlocked
export function forgetDeviceKey() {
  unlocked = null
  try {
    localStorage.removeItem(STORE)
  } catch {}
}
export function lockDeviceKey() {
  unlocked = null
}

/** Minimal password prompt (native <dialog>, masked input). Resolves null if cancelled. */
export function askPassword(message = 'Enter your KEYKARD password'): Promise<string | null> {
  return new Promise((resolve) => {
    const d = document.createElement('dialog')
    d.style.cssText = 'border:1px solid #ccc;border-radius:14px;padding:18px;max-width:340px;width:90%'
    d.innerHTML = `<form method="dialog"><p style="margin:0 0 10px;font-weight:600"></p>
      <input type="password" autocomplete="current-password" style="width:100%;padding:12px;border-radius:10px;border:1px solid #ccc" />
      <div style="display:flex;gap:8px;margin-top:12px"><button value="cancel" style="flex:1">Cancel</button><button value="ok" style="flex:1">Unlock</button></div></form>`
    ;(d.querySelector('p') as HTMLElement).textContent = message
    document.body.appendChild(d)
    const input = d.querySelector('input') as HTMLInputElement
    d.addEventListener('close', () => {
      const v = d.returnValue === 'ok' ? input.value : null
      d.remove()
      resolve(v)
    })
    d.showModal()
    input.focus()
  })
}
