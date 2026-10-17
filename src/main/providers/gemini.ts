import { PROVIDER_NAMES } from '../../shared/registry'
import { normalizedError, rawMessage } from './errors'
import type {
  NormalizedError,
  ProviderAdapter,
  ProviderModel,
  SearchResult,
  StreamEvent
} from './types'
import { NO_USAGE } from './usage'

// Google's Gemini models, the third adapter (Stage 17, D-049). 17.2 makes room for it in the tables (a provider of the registry must have an adapter, or the build
// fails); the adapter itself is 17.3. Until then every call refuses, in a sentence, and sends nothing anywhere.

const NOT_YET = 'The Gemini adapter is not built yet (Stage 17.3).'

async function listModels(): Promise<ProviderModel[]> {
  throw new Error(NOT_YET)
}

// eslint-disable-next-line require-yield
async function* stream(): AsyncGenerator<StreamEvent> {
  throw new Error(NOT_YET)
}

async function search(): Promise<SearchResult> {
  throw new Error(NOT_YET)
}

function normalizeError(error: unknown, context: { modelId: string }): NormalizedError {
  return normalizedError(
    { kind: 'unknown', status: null, detail: null, requestId: null, raw: rawMessage(error) },
    { providerName: PROVIDER_NAMES.google, modelId: context.modelId }
  )
}

export const geminiAdapter: ProviderAdapter = {
  provider: 'google',
  listModels,
  stream,
  search,
  usage: () => ({ ...NO_USAGE }),
  normalizeError
}
