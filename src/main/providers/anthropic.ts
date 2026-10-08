import Anthropic, { type APIError } from '@anthropic-ai/sdk'
import { PROVIDER_NAMES, type Effort } from '../../shared/registry'
import { isInterrupted, normalizedError, rawMessage, type ErrorFacts } from './errors'
import {
  addSource,
  addUsage,
  MAX_SEARCH_ROUNDS,
  NO_USAGE,
  SEARCH_SYSTEM,
  searchedWords,
  searchPrompt
} from './search'
import type {
  Credentials,
  NeutralMessage,
  NeutralToolCall,
  NormalizedError,
  ProviderAdapter,
  ProviderModel,
  ReplyEnd,
  SearchRequest,
  SearchResult,
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

/**
 * One turn in Anthropic's form. With no files it is `{ role, content }` with the text, exactly as before files existed. With files (D-037): the files first
 * (Anthropic's guide: a picture or a document before the question reads best), an image as an `image` block, a PDF as a `document` block of base64, a text
 * file as a `document` block of plain text, each document titled with its name; then the person's text, if there is any.
 */
function anthropicMessage(message: NeutralMessage): Anthropic.MessageParam {
  // (11.3) A turn in which the model asked for tools is sent back exactly as it came, thinking blocks and all: Anthropic refuses the results without them.
  if (message.toolTurn !== undefined) {
    return { role: 'assistant', content: message.toolTurn.record as Anthropic.ContentBlockParam[] }
  }
  // The results of those calls: the result blocks come first in the turn, one for each call.
  if (message.toolResults !== undefined) {
    return {
      role: 'user',
      content: message.toolResults.map((result): Anthropic.ToolResultBlockParam => ({
        type: 'tool_result',
        tool_use_id: result.callId,
        content: result.text,
        ...(result.isError ? { is_error: true } : {})
      }))
    }
  }
  if (message.attachments === undefined) return { role: message.role, content: message.content }
  const blocks: Anthropic.ContentBlockParam[] = message.attachments.map((file) =>
    file.kind === 'image'
      ? { type: 'image', source: { type: 'base64', media_type: file.mediaType, data: file.data } }
      : file.kind === 'pdf'
        ? {
            type: 'document',
            source: { type: 'base64', media_type: 'application/pdf', data: file.data },
            title: file.name
          }
        : {
            type: 'document',
            source: { type: 'text', media_type: 'text/plain', data: file.text },
            title: file.name
          }
  )
  if (message.content !== '') blocks.push({ type: 'text', text: message.content })
  return { role: message.role, content: blocks }
}

async function* stream(request: StreamRequest): AsyncGenerator<StreamEvent> {
  const { model } = request
  const effort = effortOf(request.effort)
  const reply = newClient(request.credentials).messages.stream(
    {
      model: model.id,
      max_tokens: request.maxOutputTokens,
      system: request.system,
      messages: request.messages.map(anthropicMessage),
      // `effort` is the dial for how much the model thinks and writes. Its default differs between models, so it is
      // written out for the ones that take it, and left out for the ones that reject it outright (Haiku 4.5 did; D-036). The
      // registry says which (D-014), and the person's own choice may change the level (D-024). There is no `thinking`
      // setting: the models that think always do, and the others are not asked to.
      ...(effort ? { output_config: { effort } } : {}),
      // The whole conversation is sent again with every message. This lets the server reuse the part it has already
      // seen (billed far lower) instead of charging full price for it each time. The registry says which models can
      // (D-019): a model that cannot is not asked to.
      ...(model.capabilities.promptCaching
        ? { cache_control: { type: 'ephemeral' as const } }
        : {}),
      // (11.3) The tools on offer, and at most one call at a time (the person is asked about each; a model that tries several is told to take them in turn).
      // `tool_choice` stays "auto": Opus 5.5, Sonnet 5.5 and Fable 5.1 refuse a forced tool (Anthropic's tool-use page, read on 2026-10-08).
      ...(request.tools !== undefined && request.tools.length > 0
        ? {
            tools: request.tools.map((tool): Anthropic.Tool => ({
              name: tool.name,
              description: tool.description,
              input_schema: tool.parameters as Anthropic.Tool.InputSchema
            })),
            tool_choice: { type: 'auto' as const, disable_parallel_tool_use: true }
          }
        : {})
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
  // (11.3) The model stopped to use a tool: what it asked for, and the whole turn as it came (the thinking blocks are needed to answer it).
  const calls: NeutralToolCall[] =
    message.stop_reason === 'tool_use'
      ? message.content.flatMap((block) =>
          block.type === 'tool_use' ? [{ id: block.id, name: block.name, input: block.input }] : []
        )
      : []
  if (calls.length > 0) {
    yield {
      type: 'end',
      end: { kind: 'tool-use' },
      usage: usage(message.usage),
      calls,
      // The whole turn as it came, thinking and all. Anthropic refuses an empty text block when a turn is sent back, so a block of no words (a model that
      // opened one before its call) is left out; nothing else is changed.
      record: message.content.filter((block) => !(block.type === 'text' && block.text === ''))
    }
    return
  }
  yield { type: 'end', end: endOf(message), usage: usage(message.usage) }
}

/**
 * One web search (11.3, D-041) with Anthropic's own tool, `web_search_20250305` (the basic version, which runs directly and not through code execution),
 * allowed once. A turn that the provider pauses is continued with the paused content sent back unchanged, at most `MAX_SEARCH_ROUNDS` times in all.
 */
async function search(request: SearchRequest): Promise<SearchResult> {
  const effort = effortOf(request.effort)
  const client = newClient(request.credentials)
  let messages: Anthropic.MessageParam[] = [{ role: 'user', content: searchPrompt(request.query) }]
  let paused: Anthropic.ContentBlock[] = []
  let total: Usage = NO_USAGE
  let text = ''
  const sources: SearchResult['sources'] = []
  let searched: string | null = null
  let searches = 0
  let end: SearchResult['end'] = 'unfinished'
  for (let round = 0; round < MAX_SEARCH_ROUNDS; round++) {
    const reply = client.messages.stream(
      {
        model: request.model.id,
        max_tokens: request.maxOutputTokens,
        system: SEARCH_SYSTEM,
        messages,
        tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 1 }],
        ...(effort ? { output_config: { effort } } : {})
      },
      { signal: request.signal }
    )
    const message = await reply.finalMessage()
    total = addUsage(total, usage(message.usage))
    searches += tokenCount(message.usage.server_tool_use?.web_search_requests)
    for (const block of message.content) {
      if (block.type === 'text') {
        text += block.text
        for (const citation of block.citations ?? []) {
          if (citation.type === 'web_search_result_location') {
            addSource(sources, citation.title, citation.url)
          }
        }
      } else if (block.type === 'server_tool_use' && block.name === 'web_search') {
        searched ??= searchedWords((block.input as { query?: unknown } | null)?.query)
      } else if (block.type === 'web_search_tool_result') {
        // What the model wrote BEFORE the results ("I'll search for...") is not what it found: the summary is what follows them.
        text = ''
        if (Array.isArray(block.content)) {
          for (const result of block.content) addSource(sources, result.title, result.url)
        }
      }
    }
    if (message.stop_reason === 'pause_turn') {
      // The paused content goes back unchanged as the turn so far; a turn that pauses again grows the same assistant turn (never two of them in a row).
      paused = [...paused, ...message.content]
      messages = [messages[0], { role: 'assistant', content: paused }]
      continue
    }
    end =
      message.stop_reason === 'max_tokens'
        ? 'cut-off'
        : message.stop_reason === 'refusal'
          ? 'declined'
          : 'done'
    break
  }
  return { text, sources, searched, searches, usage: total, end }
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
  search,
  usage,
  normalizeError
}
