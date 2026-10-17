import type { ProviderId } from '../../shared/registry'
import { anthropicAdapter } from './anthropic'
import { geminiAdapter } from './gemini'
import { openaiAdapter } from './openai'
import type { ProviderAdapter } from './types'

// One adapter for every provider the registry may name (SUPPORTED_PROVIDERS). The type of this table is what makes
// that true: adding a provider to the list without writing its adapter does not compile.
const adapters: Record<ProviderId, ProviderAdapter> = {
  anthropic: anthropicAdapter,
  openai: openaiAdapter,
  google: geminiAdapter
}

export const adapterFor = (provider: ProviderId): ProviderAdapter => adapters[provider]

/**
 * (17.4, D-049) Whether the app's web search may run on this provider's own hosted search. Google's (grounding with Google Search) is not used: Google keeps
 * grounded prompts for 30 days and bills it apart (the owner's pick 5). Like the table above, it must name every provider.
 */
export const OFFERS_SEARCH: Readonly<Record<ProviderId, boolean>> = Object.freeze({
  anthropic: true,
  openai: true,
  google: false
})
