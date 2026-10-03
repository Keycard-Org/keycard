/**
 * Runs before anything else (imported first by index.ts; imports execute in order).
 * 1. Native crypto: global.crypto (getRandomValues, subtle) and Buffer, for viem / ox / libhalo.
 * 2. Node globals that libhalo's dependencies read while loading (pbkdf2 → readable-stream does
 *    `process.version.slice(…)`). Hermes has no process.version: without this, the first NFC tap
 *    crashes the release app.
 */
import { install } from 'react-native-quick-crypto'

install()

const g = globalThis as any
const proc = g.process ?? (g.process = {})
if (typeof proc.version !== 'string') proc.version = ''
if (typeof proc.versions !== 'object' || proc.versions === null) proc.versions = {}
if (typeof proc.env !== 'object' || proc.env === null) proc.env = {}
