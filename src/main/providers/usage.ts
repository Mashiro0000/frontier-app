import type { Usage } from './types'

/** A token count from a provider's usage report: a whole, finite, non-negative number, or 0 for anything else. */
export function tokenCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0
}

/** The fields of a provider's usage report, whatever it is (a report that is not an object counts as empty). */
export function fieldsOf(report: unknown): Record<string, unknown> {
  return typeof report === 'object' && report !== null && !Array.isArray(report)
    ? (report as Record<string, unknown>)
    : {}
}

/** What a reply that reported nothing used. */
export const NO_USAGE: Usage = Object.freeze({
  inputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  outputTokens: 0
})
