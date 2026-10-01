// How numbers from the registry are written for the person. Kept apart from the components, which may
// export nothing but components (the dev server's hot reload relies on that).

import type { ProviderStatus, SettingsStatus } from '../../../shared/ipc'
import type { Suggestion, TaskId } from '../../../shared/rankings'
import type { ProviderId } from '../../../shared/registry'

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
