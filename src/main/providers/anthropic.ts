import Anthropic, { type APIError } from '@anthropic-ai/sdk'
import { PROVIDER_NAMES, type Effort } from '../../shared/registry'
import { isInterrupted, normalizedError, rawMessage, type ErrorFacts } from './errors'
import type {
  Credentials,
  NormalizedError,
  ProviderAdapter,
  ProviderModel,
  ReplyEnd,
  StreamEvent,
  StreamRequest,
  Usage
} from './types'
import { fieldsOf, tokenCount } from './usage'

// Anthropic's Claude, through Anthropic's own SDK (D-012), as one adapter among others (D-018). Nothing here imports
// Electron, so it can be run and checked on its own. Which model to ask, and the settings it takes, come from its
// registry entry (D-014). The address does not: it is fixed here.

export const API_BASE_URL = 'https://api.anthropic.com'

/** A listing longer than this is cut short: nobody has this many models, and a runaway listing should not run on. */
const MAX_LISTED_MODELS = 1000

function newClient({ apiKey, baseURL }: Credentials): Anthropic {
  return new Anthropic({
    apiKey,
    // Both set on purpose. Left unset, the SDK reads ANTHROPIC_AUTH_TOKEN from the environment (and would send two
    // credentials, which the API rejects) and ANTHROPIC_BASE_URL (which could send this key to another server). The
    // key saved in Settings is the only credential, and it goes only where this file says.
    authToken: null,
    baseURL: baseURL ?? API_BASE_URL
  })
}

async function listModels(
  credentials: Credentials,
  signal?: AbortSignal
): Promise<ProviderModel[]> {
  const models: ProviderModel[] = []
  // Iterating the page fetches the following pages by itself (the API gives at most 1000 to a page).
  for await (const model of newClient(credentials).models.list({ limit: 1000 }, { signal })) {
    models.push({ id: model.id, label: model.display_name || null })
    if (models.length >= MAX_LISTED_MODELS) break
  }
  return models
}

// The registry only lets an Anthropic entry name the levels Anthropic knows (PROVIDER_EFFORTS, D-019), and a saved choice is only
// accepted from a model's own list (D-024), so "none" cannot get here. This is for the compiler, and for a registry that was
// edited around its validator: the request would be refused by the API, or worse, quietly ask for something other than what was
// chosen, so it fails here instead.
function effortOf(effort: Effort | null): Exclude<Effort, 'none'> | null {
  if (effort === 'none') throw new Error('Anthropic has no effort level "none"')
  return effort
}

function endOf(message: Anthropic.Message): ReplyEnd {
  switch (message.stop_reason) {
    case 'max_tokens':
      return { kind: 'cut-off' }
    case 'refusal':
      return { kind: 'declined', category: message.stop_details?.category ?? null }
    case 'model_context_window_exceeded':
      return { kind: 'context-full' }
    default:
      return { kind: 'done' }
  }
}

// Anthropic reports the tokens read from the cache and the tokens written to it beside `input_tokens`, not inside it,
// so the four numbers are already the four neutral buckets.
function usage(report: unknown): Usage {
  const fields = fieldsOf(report)
  return {
    inputTokens: tokenCount(fields['input_tokens']),
    cacheReadTokens: tokenCount(fields['cache_read_input_tokens']),
    cacheWriteTokens: tokenCount(fields['cache_creation_input_tokens']),
    outputTokens: tokenCount(fields['output_tokens'])
  }
}

async function* stream(request: StreamRequest): AsyncGenerator<StreamEvent> {
  const { model } = request
  const effort = effortOf(request.effort)
  const reply = newClient(request.credentials).messages.stream(
    {
      model: model.id,
      max_tokens: request.maxOutputTokens,
      system: request.system,
      messages: request.messages,
      // `effort` is the dial for how much the model thinks and writes. Its default differs between models, so it is
      // written out for the ones that take it, and left out for the ones that reject it outright (Haiku 4.5). The
      // registry says which (D-014), and the person's own choice may change the level (D-024). There is no `thinking`
      // setting: the models that think always do, and the others are not asked to.
      ...(effort ? { output_config: { effort } } : {}),
      // The whole conversation is sent again with every message. This lets the server reuse the part it has already
      // seen (billed far lower) instead of charging full price for it each time. The registry says which models can
      // (D-019): a model that cannot is not asked to.
      ...(model.capabilities.promptCaching ? { cache_control: { type: 'ephemeral' as const } } : {})
    },
    { signal: request.signal }
  )
  // The text arrives as pieces of a content block. Anything else in the stream (the thinking of a model that thinks
  // first, pings) is not text for the person to read.
  for await (const event of reply) {
    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
      yield { type: 'text', text: event.delta.text }
    }
  }
  const message = await reply.finalMessage()
  yield { type: 'end', end: endOf(message), usage: usage(message.usage) }
}

function apiMessage(error: APIError): string | null {
  const body: unknown = error.error
  if (typeof body !== 'object' || body === null) return null
  const inner = (body as { error?: unknown }).error
  if (typeof inner !== 'object' || inner === null) return null
  const message = (inner as { message?: unknown }).message
  return typeof message === 'string' ? message : null
}

function factsOf(error: unknown): ErrorFacts {
  const api = error instanceof Anthropic.APIError ? error : null
  const facts = {
    status: api?.status ?? null,
    detail: api ? apiMessage(api) : null,
    requestId: api?.requestID ?? null,
    raw: rawMessage(error)
  }
  // Most specific first: the timeout class is a kind of connection error, which is a kind of API error.
  if (error instanceof Anthropic.AuthenticationError) return { ...facts, kind: 'auth' }
  if (error instanceof Anthropic.PermissionDeniedError) return { ...facts, kind: 'permission' }
  if (error instanceof Anthropic.NotFoundError) return { ...facts, kind: 'not-found' }
  if (error instanceof Anthropic.RateLimitError) return { ...facts, kind: 'rate-limit' }
  if (error instanceof Anthropic.BadRequestError) return { ...facts, kind: 'bad-request' }
  if (error instanceof Anthropic.APIConnectionTimeoutError) return { ...facts, kind: 'timeout' }
  if (error instanceof Anthropic.APIConnectionError) return { ...facts, kind: 'connection' }
  if (error instanceof Anthropic.InternalServerError) {
    return { ...facts, kind: error.status === 529 ? 'overloaded' : 'server' }
  }
  if (api) return { ...facts, kind: 'provider' }
  if (isInterrupted(error)) return { ...facts, kind: 'interrupted' }
  return { ...facts, kind: 'unknown' }
}

function normalizeError(error: unknown, context: { modelId: string }): NormalizedError {
  return normalizedError(factsOf(error), {
    providerName: PROVIDER_NAMES.anthropic,
    modelId: context.modelId
  })
}

export const anthropicAdapter: ProviderAdapter = {
  provider: 'anthropic',
  listModels,
  stream,
  usage,
  normalizeError
}
