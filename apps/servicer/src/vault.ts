import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto'
import type { Hex } from 'viem'
import { env } from './config'

// AES-256-GCM for server-held private keys (credit-account roots, mandate keys, guarantee keys).
// Key material = SHA-256(KEY_ENC_SECRET). Format: v1.<iv b64>.<tag b64>.<ciphertext b64>
const key = createHash('sha256').update(env.KEY_ENC_SECRET).digest()

export function seal(secret: Hex): string {
  const iv = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', key, iv)
  const ct = Buffer.concat([c.update(secret, 'utf8'), c.final()])
  return ['v1', iv.toString('base64'), c.getAuthTag().toString('base64'), ct.toString('base64')].join('.')
}

export function open(sealed: string): Hex {
  const [v, iv, tag, ct] = sealed.split('.')
  if (v !== 'v1') throw new Error('unknown vault format')
  const d = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'))
  d.setAuthTag(Buffer.from(tag, 'base64'))
  return Buffer.concat([d.update(Buffer.from(ct, 'base64')), d.final()]).toString('utf8') as Hex
}
