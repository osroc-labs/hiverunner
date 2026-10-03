import { MICRO, microTokensToUsd } from "@workspace/pricing"

const tokens = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 6,
})
const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
})

/** Ledger amounts are micro-tokens; people read tokens. */
export function formatTokens(amount: number) {
  return tokens.format(amount / MICRO)
}

/** The estimate shown beside a token amount. Never a quote. */
export function formatUsdEstimate(amount: number) {
  return usd.format(microTokensToUsd(amount))
}
