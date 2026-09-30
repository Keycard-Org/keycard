import { MERCHANT_CODE_RE } from '@keycard/sdk'

/** Merchant QR codes are pay links (…/card?pay=CODE); a bare 6-character code works too. */
export function codeFromQr(data: string): string | null {
  const t = data.trim()
  const m = t.match(/[?&]pay=([A-Za-z0-9]{6})\b/)
  const code = (m?.[1] ?? t).toUpperCase()
  return MERCHANT_CODE_RE.test(code) ? code : null
}
