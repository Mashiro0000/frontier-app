// How numbers from the registry are written for the person. Kept apart from the components, which may
// export nothing but components (the dev server's hot reload relies on that).

import type { EffortStatus, ProviderStatus, SettingsStatus } from '../../../shared/ipc'
import type { Suggestion, TaskId } from '../../../shared/rankings'
import type { Effort, ProviderId } from '../../../shared/registry'
import type { ReplyUsage, TokenCounts } from '../../../shared/usage'

/**
 * What the providers' documentation names for `task`, among the models on offer now (D-023). Empty while no task is
 * chosen, and when nothing is named: that is an answer, not an error.
 */
export function suggestionsForTask(
  status: SettingsStatus | null,
  task: TaskId | null
): Suggestion[] {
  if (!status || task === null) return []
  return status.suggestions.filter((suggestion) => suggestion.task === task)
}

/** What to call a provider: its name from the settings status (the id, if the status does not list it). */
export function providerName(status: SettingsStatus, id: ProviderId): string {
  return status.providers.find((provider) => provider.id === id)?.name ?? id
}

/**
 * The provider of the model that will answer, as the settings status describes it, with whether a key for it is saved.
 * Null until the status is known, and while no model is selected (the registry could not be loaded).
 */
export function answeringProvider(status: SettingsStatus | null): ProviderStatus | null {
  if (!status) return null
  const model = status.models.find((option) => option.id === status.selectedModelId)
  return (model && status.providers.find((provider) => provider.id === model.provider)) || null
}

/**
 * The provider whose API key is missing, if the app cannot answer for want of one: the provider of the model that will
 * answer. With no model selected (the registry could not be loaded) there is no such provider, so a missing key is
 * reported only if no key at all is saved. Null if nothing is missing.
 */
export function providerMissingKey(status: SettingsStatus | null): ProviderStatus | null {
  if (!status) return null
  const answering = answeringProvider(status)
  if (answering) return answering.hasKey ? null : answering
  return status.providers.every((provider) => !provider.hasKey)
    ? (status.providers[0] ?? null)
    : null
}

const EFFORT_NAMES: Record<Effort, string> = {
  none: 'None',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Extra high',
  max: 'Max'
}

/**
 * What an entry of the Effort menu says (D-024): "Effort: Low (faster)", "Effort: Medium (default)", "Effort: Max (smarter)". The
 * first level of the list is the faster end and the last the smarter one; the level the registry picks is marked, so the person
 * can find their way back to it.
 */
export function effortOptionText(level: Effort, effort: EffortStatus): string {
  const notes: string[] = []
  if (effort.levels.length > 1) {
    if (level === effort.levels[0]) notes.push('faster')
    if (level === effort.levels.at(-1)) notes.push('smarter')
  }
  if (level === effort.default) notes.push('default')
  return `Effort: ${EFFORT_NAMES[level]}${notes.length > 0 ? ` (${notes.join(', ')})` : ''}`
}

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

/** What something cost (D-030): "$0.00", "$0.0041" (a fraction of a cent keeps four places), "$0.12", "$12.34". */
export function formatCost(dollars: number): string {
  if (dollars === 0) return '$0.00'
  if (dollars < 0.0001) return 'less than $0.0001'
  if (dollars < 0.01) return `$${dollars.toFixed(4)}`
  return `$${dollars.toFixed(2)}`
}

/** A cost, with "about" in front when any of it is the app's own guess (D-030): "about $0.12". */
export const formatSpend = (dollars: number, about: boolean): string =>
  `${about ? 'about ' : ''}${formatCost(dollars)}`

/** 1234 -> "1,234". */
export const formatCount = (count: number): string => count.toLocaleString('en-US')

/** Every token that was read: the ordinary input, and what came from the provider's cache or went into it. */
export const inputSide = (tokens: TokenCounts): number =>
  tokens.input + tokens.cacheRead + tokens.cacheWrite

/** The small line under a reply (D-030): "1,204 in, 312 out, $0.0041". */
export function replyUsageText(usage: ReplyUsage): string {
  return `${formatCount(inputSide(usage.tokens))} in, ${formatCount(usage.tokens.output)} out, ${formatSpend(usage.costUsd, usage.estimate)}`
}

/** What the line says when it is hovered: the four buckets, and what the number is and is not (D-030). */
export function replyUsageTitle(usage: ReplyUsage): string {
  const { tokens } = usage
  return (
    `Read ${formatCount(tokens.input)} tokens, ${formatCount(tokens.cacheRead)} from the provider's cache, and put ${formatCount(tokens.cacheWrite)} into it. ` +
    `Wrote ${formatCount(tokens.output)} tokens (the thinking counts as writing). At list prices; your provider's invoice decides.` +
    (usage.estimate ? " This is the app's own guess: the provider gave no report." : '')
  )
}
