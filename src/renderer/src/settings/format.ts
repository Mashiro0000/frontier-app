// How numbers from the registry are written for the person. Kept apart from the components, which may
// export nothing but components (the dev server's hot reload relies on that).

const oneDecimal = (n: number): string => String(Math.round(n * 10) / 10)

/** 1000000 -> "1M", 200000 -> "200K", 1500 -> "1.5K", 800 -> "800". */
export function formatTokens(count: number): string {
  if (count >= 1_000_000) return `${oneDecimal(count / 1_000_000)}M`
  if (count >= 1_000) return `${oneDecimal(count / 1_000)}K`
  return String(count)
}

/** 4 -> "$4", 0.25 -> "$0.25", 0.5 -> "$0.50". */
export function formatPrice(dollars: number): string {
  return Number.isInteger(dollars) ? `$${dollars}` : `$${dollars.toFixed(2)}`
}
