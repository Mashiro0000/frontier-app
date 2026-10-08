import OpenAI from 'openai'
import { PROVIDER_NAMES } from '../../shared/registry'
import { isInterrupted, normalizedError, rawMessage, type ErrorFacts } from './errors'
import { textFileLead } from './request'
import { addSource, addUsage, NO_USAGE, SEARCH_SYSTEM, searchedWords, searchPrompt } from './search'
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

// OpenAI's models, through OpenAI's own SDK, as the second adapter (D-022). It uses the Responses API, which OpenAI recommends
// for new work (the model pages list both it and Chat Completions). Nothing here imports Electron. Which model to ask, and the
// effort it takes, come from its registry entry (D-014, D-019). The address does not: it is fixed here.

export const API_BASE_URL = 'https://api.openai.com/v1'

/** A listing longer than this is cut short: nobody has this many models, and a runaway listing should not run on. */
const MAX_LISTED_MODELS = 1000

/** Runs `run` with the named environment variables removed, and puts them back afterwards. It is synchronous on purpose. */
function withoutEnvironment<T>(names: readonly string[], run: () => T): T {
  const saved = names.map((name) => [name, process.env[name]] as const)
  for (const name of names) delete process.env[name]
  try {
    return run()
  } finally {
    for (const [name, value] of saved) if (value !== undefined) process.env[name] = value
  }
}

function newClient({ apiKey, baseURL }: Credentials): OpenAI {
  // Left alone, the SDK fills in whatever it is not given from the environment: OPENAI_API_KEY, OPENAI_ADMIN_KEY,
  // OPENAI_ORG_ID, OPENAI_PROJECT_ID, OPENAI_WEBHOOK_SECRET, OPENAI_BASE_URL (which could send this key to another server),
  // OPENAI_LOG (at "debug" it would print the messages) and OPENAI_CUSTOM_HEADERS (which could add an Authorization header
  // of its own). The key saved in Settings is the only credential, and it goes only where this file says. Everything the
  // constructor accepts is given here, so nothing is read from the environment; the one thing it takes from the
  // environment and has no option for, custom headers, is removed for the moment it takes it. (Checked with hostile variables.)
  return withoutEnvironment(
    ['OPENAI_CUSTOM_HEADERS'],
    () =>
      new OpenAI({
        apiKey,
        baseURL: baseURL ? `${baseURL.replace(/\/+$/, '')}/v1` : API_BASE_URL,
        organization: null,
        project: null,
        adminAPIKey: null,
        webhookSecret: null,
        logLevel: 'warn'
      })
  )
}

async function listModels(
  credentials: Credentials,
  signal?: AbortSignal
): Promise<ProviderModel[]> {
  const models: ProviderModel[] = []
  // The listing is one page; iterating it would fetch more if there were more. OpenAI gives ids but no names for people.
  for await (const model of newClient(credentials).models.list({ signal })) {
    models.push({ id: model.id, label: null })
    if (models.length >= MAX_LISTED_MODELS) break
  }
  return models
}

/** What a reply that the provider says failed (a `response.failed`, which the SDK reports as a finished response) throws. */
class ReplyFailed extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ReplyFailed'
  }
}

/** The reply ended without the provider saying it was complete: the connection closed cleanly, but too soon. */
class ReplyEndedEarly extends Error {
  constructor() {
    super('terminated') // what the HTTP client says when a connection is cut off: isInterrupted knows it
    this.name = 'ReplyEndedEarly'
  }
}

function endOf(response: OpenAI.Responses.Response, refused: boolean): ReplyEnd {
  if (response.status === 'incomplete') {
    // 'content_filter' is a decision of the provider's, like a refusal; 'max_output_tokens' (and any reason this app has not
    // met) means the reply ran out of room, which is what the person is told.
    return response.incomplete_details?.reason === 'content_filter'
      ? { kind: 'declined', category: 'content_filter' }
      : { kind: 'cut-off' }
  }
  // OpenAI writes a refusal as the reply's text. It is shown like any text, and the reply also ends as declined.
  return refused ? { kind: 'declined', category: null } : { kind: 'done' }
}

// OpenAI's `input_tokens` already contains the tokens read from the cache and the tokens written to it (the prompt-caching guide
// says they are subsets of it, not additions), so the ordinary input is what is left. Reasoning tokens are inside
// `output_tokens` already, and are billed as output.
function usage(report: unknown): Usage {
  const fields = fieldsOf(report)
  const details = fieldsOf(fields['input_tokens_details'])
  const input = tokenCount(fields['input_tokens'])
  const cacheRead = Math.min(tokenCount(details['cached_tokens']), input)
  const cacheWrite = Math.min(tokenCount(details['cache_write_tokens']), input - cacheRead)
  return {
    inputTokens: input - cacheRead - cacheWrite,
    cacheReadTokens: cacheRead,
    cacheWriteTokens: cacheWrite,
    outputTokens: tokenCount(fields['output_tokens'])
  }
}

/**
 * One turn in OpenAI's form. With no files it is `{ role, content }` with the text, exactly as before files existed. With files (D-037): an image as
 * `input_image` (a data URL; the detail left to the model), a PDF as `input_file` (a data URL and its file name), a text file as `input_text` led by a line
 * that names it (the Responses API has no titled text document); then the person's text, if there is any. Only the person's messages carry files.
 */
function openaiInputs(message: NeutralMessage): OpenAI.Responses.ResponseInputItem[] {
  // (11.3) A turn in which the model asked for tools is sent back as the items it was made of (its reasoning, its words, its calls); then the results.
  if (message.toolTurn !== undefined) {
    return message.toolTurn.record as OpenAI.Responses.ResponseInputItem[]
  }
  if (message.toolResults !== undefined) {
    return message.toolResults.map((result): OpenAI.Responses.ResponseInputItem => ({
      type: 'function_call_output',
      call_id: result.callId,
      output: result.text
    }))
  }
  return [openaiInput(message)]
}

function openaiInput(message: NeutralMessage): OpenAI.Responses.ResponseInputItem {
  if (message.attachments === undefined) return { role: message.role, content: message.content }
  const parts: OpenAI.Responses.ResponseInputContent[] = message.attachments.map((file) =>
    file.kind === 'image'
      ? {
          type: 'input_image',
          image_url: `data:${file.mediaType};base64,${file.data}`,
          detail: 'auto'
        }
      : file.kind === 'pdf'
        ? {
            type: 'input_file',
            filename: file.name,
            file_data: `data:application/pdf;base64,${file.data}`
          }
        : { type: 'input_text', text: `${textFileLead(file.name)}\n\n${file.text}` }
  )
  if (message.content !== '') parts.push({ type: 'input_text', text: message.content })
  return { role: 'user', content: parts }
}

async function* stream(request: StreamRequest): AsyncGenerator<StreamEvent> {
  const { model } = request
  const reply = newClient(request.credentials).responses.stream(
    {
      model: model.id,
      instructions: request.system,
      input: request.messages.flatMap(openaiInputs),
      max_output_tokens: request.maxOutputTokens,
      // `effort` is how much the model thinks before it answers (its thinking is billed as output and counts against
      // max_output_tokens). Written out for every model that takes it, because the defaults differ between models (D-014);
      // the level is the person's choice for this model, or else the registry's pick (D-024).
      ...(request.effort ? { reasoning: { effort: request.effort } } : {}),
      // Responses are kept on the provider's side by default. This app sends the whole conversation every time and uses none of
      // that, so nothing is kept (D-022).
      store: false,
      // (11.3) The tools on offer, one call at a time. "strict" is off because the schema carries length limits that strict mode does not take; the
      // reasoning that goes with a call comes back encrypted (nothing is kept on the provider's side) and is sent back with the result.
      ...(request.tools !== undefined && request.tools.length > 0
        ? {
            tools: request.tools.map((tool): OpenAI.Responses.FunctionTool => ({
              type: 'function',
              name: tool.name,
              description: tool.description,
              parameters: tool.parameters,
              strict: false
            })),
            parallel_tool_calls: false,
            include: ['reasoning.encrypted_content' as const]
          }
        : {})
    },
    { signal: request.signal }
  )
  let refused = false
  for await (const event of reply) {
    if (event.type === 'response.output_text.delta') {
      yield { type: 'text', text: event.delta }
    } else if (event.type === 'response.refusal.delta') {
      refused = true
      yield { type: 'text', text: event.delta }
    }
  }
  const response = await reply.finalResponse()
  if (response.status === 'failed') {
    throw new ReplyFailed(response.error?.message ?? 'the provider reported that the reply failed')
  }
  if (response.status !== 'completed' && response.status !== 'incomplete')
    throw new ReplyEndedEarly()
  // (11.3) The model stopped to use a tool: what it asked for, and the items of its turn as they must be sent back.
  const calls: NeutralToolCall[] =
    response.status === 'completed'
      ? response.output.flatMap((item) =>
          item.type === 'function_call'
            ? [{ id: item.call_id, name: item.name, input: parseArguments(item.arguments) }]
            : []
        )
      : []
  if (calls.length > 0) {
    yield {
      type: 'end',
      end: { kind: 'tool-use' },
      usage: usage(response.usage),
      calls,
      record: response.output.flatMap((item) => {
        const again = replayItem(item)
        return again === null ? [] : [again]
      })
    }
    return
  }
  yield { type: 'end', end: endOf(response, refused), usage: usage(response.usage) }
}

/** The arguments of a call as the model wrote them (a JSON text), or null when they are not JSON. */
function parseArguments(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

/**
 * An item of a turn as it is sent back with the results of its calls: only the fields the API takes in an input (the SDK adds some of its own to what it
 * hands back, such as `parsed_arguments`, and an unknown field is refused). Items of other kinds are not part of a turn that asked for a tool.
 */
function replayItem(
  item: OpenAI.Responses.ResponseOutputItem
): OpenAI.Responses.ResponseInputItem | null {
  switch (item.type) {
    case 'reasoning':
      return {
        type: 'reasoning',
        id: item.id,
        summary: item.summary,
        ...(typeof item.encrypted_content === 'string'
          ? { encrypted_content: item.encrypted_content }
          : {})
      }
    case 'function_call':
      return {
        type: 'function_call',
        id: item.id,
        call_id: item.call_id,
        name: item.name,
        arguments: item.arguments,
        ...(item.status !== undefined ? { status: item.status } : {})
      }
    case 'message':
      return {
        type: 'message',
        role: 'assistant',
        id: item.id,
        status: item.status,
        content: item.content.map((part) =>
          part.type === 'output_text'
            ? { type: 'output_text' as const, text: part.text, annotations: part.annotations ?? [] }
            : { type: 'refusal' as const, refusal: part.refusal }
        )
      }
    default:
      return null
  }
}

/**
 * One web search (11.3, D-041) with OpenAI's own tool, `web_search`, allowed once. The sources are every page it consulted (the API lists them on request)
 * and the pages it cited, each once; the words it searched are the ones the call reports.
 */
async function search(request: SearchRequest): Promise<SearchResult> {
  const reply = newClient(request.credentials).responses.stream(
    {
      model: request.model.id,
      instructions: SEARCH_SYSTEM,
      input: [{ role: 'user', content: searchPrompt(request.query) }],
      max_output_tokens: request.maxOutputTokens,
      tools: [{ type: 'web_search' }],
      max_tool_calls: 1,
      parallel_tool_calls: false,
      include: ['web_search_call.action.sources'],
      ...(request.effort ? { reasoning: { effort: request.effort } } : {}),
      store: false
    },
    { signal: request.signal }
  )
  const response = await reply.finalResponse()
  if (response.status === 'failed') {
    throw new ReplyFailed(response.error?.message ?? 'the provider reported that the search failed')
  }
  if (response.status !== 'completed' && response.status !== 'incomplete') {
    throw new ReplyEndedEarly()
  }
  let text = ''
  const sources: SearchResult['sources'] = []
  let searched: string | null = null
  let searches = 0
  let declined = false
  for (const item of response.output) {
    if (item.type === 'web_search_call') {
      // What the model wrote BEFORE the search is not what it found: the summary is the message that follows it.
      text = ''
      if (item.status === 'completed') searches += 1
      if (item.action.type === 'search') {
        searched ??= searchedWords(item.action.queries?.[0] ?? item.action.query)
        for (const source of item.action.sources ?? []) addSource(sources, null, source.url)
      }
    } else if (item.type === 'message') {
      for (const part of item.content) {
        if (part.type === 'output_text') {
          text += part.text
          for (const note of part.annotations ?? []) {
            if (note.type === 'url_citation') addSource(sources, note.title, note.url)
          }
        } else {
          declined = true
          text += part.refusal
        }
      }
    }
  }
  const end: SearchResult['end'] =
    response.status === 'incomplete'
      ? response.incomplete_details?.reason === 'content_filter'
        ? 'declined'
        : 'cut-off'
      : declined
        ? 'declined'
        : 'done'
  return {
    text,
    sources,
    searched,
    searches,
    usage: addUsage(NO_USAGE, usage(response.usage)),
    end
  }
}

function apiMessage(error: InstanceType<typeof OpenAI.APIError>): string | null {
  const body: unknown = error.error
  if (typeof body !== 'object' || body === null) return null
  const message = (body as { message?: unknown }).message
  return typeof message === 'string' ? message : null
}

// OpenAI answers 429 both for "too many requests" and for "no credit left"; only the error's own code tells them apart.
const QUOTA_CODES = new Set([
  'insufficient_quota',
  'credit_balance_exhausted',
  'organization_spend_limit_exceeded',
  'project_spend_limit_exceeded',
  'organization_usage_limit_exceeded'
])

function factsOf(error: unknown): ErrorFacts {
  const api = error instanceof OpenAI.APIError ? error : null
  const facts = {
    status: api?.status ?? null,
    detail: api ? apiMessage(api) : null,
    requestId: api?.requestID ?? null,
    raw: rawMessage(error)
  }
  // Most specific first: the timeout class is a kind of connection error, which is a kind of API error.
  if (error instanceof OpenAI.AuthenticationError) return { ...facts, kind: 'auth' }
  if (error instanceof OpenAI.PermissionDeniedError) return { ...facts, kind: 'permission' }
  if (error instanceof OpenAI.NotFoundError) return { ...facts, kind: 'not-found' }
  if (error instanceof OpenAI.RateLimitError) {
    return {
      ...facts,
      kind:
        QUOTA_CODES.has(String(api?.code)) || api?.type === 'insufficient_quota'
          ? 'quota'
          : 'rate-limit'
    }
  }
  if (error instanceof OpenAI.BadRequestError) return { ...facts, kind: 'bad-request' }
  if (error instanceof OpenAI.APIConnectionTimeoutError) return { ...facts, kind: 'timeout' }
  if (error instanceof OpenAI.APIConnectionError) return { ...facts, kind: 'connection' }
  if (error instanceof OpenAI.InternalServerError) {
    return { ...facts, kind: error.status === 503 ? 'overloaded' : 'server' }
  }
  if (error instanceof ReplyFailed) return { ...facts, detail: error.message, kind: 'provider' }
  if (api) return { ...facts, kind: 'provider' } // no status: the error arrived in the middle of a reply, as an event
  if (error instanceof ReplyEndedEarly || isInterrupted(error))
    return { ...facts, kind: 'interrupted' }
  return { ...facts, kind: 'unknown' }
}

function normalizeError(error: unknown, context: { modelId: string }): NormalizedError {
  return normalizedError(factsOf(error), {
    providerName: PROVIDER_NAMES.openai,
    modelId: context.modelId
  })
}

export const openaiAdapter: ProviderAdapter = {
  provider: 'openai',
  listModels,
  stream,
  search,
  usage,
  normalizeError
}
