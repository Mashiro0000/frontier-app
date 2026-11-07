import type { ModelPricing } from './registry'

// (21.1, D-053) How dear a model is, in four steps, for the badge in the model chooser and its filter. The step is read from the price
// of the reply (output per million tokens), which is what most of a chat's cost is; the exact prices are always shown beside it.
// Plain functions with no React, so they can be checked on their own.

export type CostTier = 1 | 2 | 3 | 4

/** The highest output price (US dollars per million tokens) of each step but the last; anything dearer is step 4. */
export const COST_TIER_CEILINGS: readonly [number, number, number] = [1, 5, 15]

/** The step of a model's price: 1 for the cheapest (a dollar or less a million output tokens) to 4 for the dearest (over $15). */
export function costTier(pricing: ModelPricing): CostTier {
  const out = pricing.outputPerMTok
  if (!Number.isFinite(out) || out < 0) return 4 // a price that cannot be read is shown as the dearest, never as cheap
  if (out <= COST_TIER_CEILINGS[0]) return 1
  if (out <= COST_TIER_CEILINGS[1]) return 2
  if (out <= COST_TIER_CEILINGS[2]) return 3
  return 4
}

/** The badge: "$" to "$$$$". */
export const costTierBadge = (tier: CostTier): string => '$'.repeat(tier)

/** The badge's words, for its tooltip and the filter. */
export function costTierWords(tier: CostTier): string {
  switch (tier) {
    case 1:
      return 'Cheapest'
    case 2:
      return 'Low cost'
    case 3:
      return 'Mid cost'
    case 4:
      return 'High cost'
  }
}

/** A price per million tokens as it is written in the chooser: "$0.10", "$2", "$12.50". */
export function perMillion(usd: number): string {
  if (!Number.isFinite(usd) || usd < 0) return '?'
  if (Number.isInteger(usd)) return `$${usd}`
  return `$${usd.toFixed(2)}`
}
