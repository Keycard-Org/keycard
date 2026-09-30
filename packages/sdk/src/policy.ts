import type { Address } from 'viem'
import { Scopes } from 'viem/tempo'

/**
 * Access-key policies. Every KEYKARD key allows ONLY direct TIP-20 transfer / transferWithMemo to an
 * explicit recipient list. Keychain limits apply to transfer, transferWithMemo and approve only, and
 * NOT to transferFrom (AccountKeychain docs), so we never scope any other selector.
 * Verified on testnet 2026-09-28 (spike/RESULTS.md): off-list recipients and approve() are rejected
 * with CallNotAllowed; over-limit with SpendingLimitExceeded.
 */
export function transferOnlyTo(token: Address, recipients: readonly Address[]) {
  if (recipients.length === 0) throw new Error('recipient allow-list must not be empty')
  const r = [...recipients]
  return [Scopes.tip20(token).transfer({ recipients: r }), Scopes.tip20(token).transferWithMemo({ recipients: r })]
}

export type KeyPolicy = {
  expiry: number
  limits: { token: Address; limit: bigint; period: number }[]
  scopes: ReturnType<typeof transferOnlyTo>
}

/** Borrower's card: spend up to `limit` per `period` at allow-listed merchants on the credit account. */
export function spendKeyPolicy(p: {
  token: Address
  limit: bigint
  period: number
  merchants: readonly Address[]
  expiry: number
}): KeyPolicy {
  return {
    expiry: p.expiry,
    limits: [{ token: p.token, limit: p.limit, period: p.period }],
    scopes: transferOnlyTo(p.token, p.merchants),
  }
}

/** Repayment mandate on the borrower's income wallet: at most one instalment per period, only to KEYKARD. */
export function mandateKeyPolicy(p: {
  token: Address
  instalment: bigint
  period: number
  repayTo: Address
  expiry: number
}): KeyPolicy {
  return {
    expiry: p.expiry,
    limits: [{ token: p.token, limit: p.instalment, period: p.period }],
    scopes: transferOnlyTo(p.token, [p.repayTo]),
  }
}

/** Guarantee on the guarantor's wallet: one-time cap (period 0), only to KEYKARD recovery. */
export function guaranteeKeyPolicy(p: { token: Address; cap: bigint; recoveryTo: Address; expiry: number }): KeyPolicy {
  return {
    expiry: p.expiry,
    limits: [{ token: p.token, limit: p.cap, period: 0 }],
    scopes: transferOnlyTo(p.token, [p.recoveryTo]),
  }
}

/**
 * Guarantor affordability (lesson of Amigo Loans, FCA 2023): the guarantee is capped at a share of the
 * guarantor's stated disposable monthly income over the term.
 */
export const GUARANTOR_MAX_INCOME_SHARE = 0.2

export function maxGuarantee(p: {
  monthlyIncome: bigint
  monthlyObligations: bigint
  termMonths: number
}): bigint {
  const disposable = p.monthlyIncome > p.monthlyObligations ? p.monthlyIncome - p.monthlyObligations : 0n
  // integer math: disposable * 20% * months
  return (disposable * BigInt(Math.round(GUARANTOR_MAX_INCOME_SHARE * 100)) * BigInt(p.termMonths)) / 100n
}
