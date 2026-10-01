import type { ProviderId } from '../../shared/registry'
import { anthropicAdapter } from './anthropic'
import type { ProviderAdapter } from './types'

// One adapter for every provider the registry may name (SUPPORTED_PROVIDERS). The type of this table is what makes
// that true: adding a provider to the list without writing its adapter does not compile.
const adapters: Record<ProviderId, ProviderAdapter> = {
  anthropic: anthropicAdapter
}

export const adapterFor = (provider: ProviderId): ProviderAdapter => adapters[provider]
