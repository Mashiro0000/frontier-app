import { PROVIDER_NAMES } from '../../shared/registry'
import { isInterrupted, normalizedError, rawMessage, type ErrorFacts } from './errors'
import { textFileLead } from './request'
import type {
  Credentials,
  NeutralMessage,
  NeutralToolCall,
  NormalizedError,
  ProviderAdapter,
  ProviderModel,
  ReplyEnd,
  SearchResult,
  StreamEvent,
  StreamRequest,
  Usage
} from './types'
import { fieldsOf, NO_USAGE } from './usage'

// Google's Gemini models, the third adapter (Stage 17.3, D-049), written over Node's own `fetch` and the server-sent events of
// `streamGenerateContent`: no Google package is installed (the owner's pick 3). Nothing here imports Electron. Which model to ask and the
// thinking level it takes come from its registry entry and the person's choice (D-014, D-024). The address does not: it is fixed here.
//
// What the probe of 17.1 found, and what this file does about it (all against the stand-in, tools/mock-gemini.mjs, which is my reading of
// Google's pages, not the real API):
//  - The key goes in the `x-goog-api-key` header and NOWHERE else: never in the address (Google's own examples put it in `?key=`, which would
//    leave it in logs and in the words of an error), never in a sentence (every sentence is scrubbed by describeFailure).
//  - ONE try: `fetch` retries nothing, and neither does this file (a request sent twice is billed twice).
//  - `fetch` has no clock of its own: a provider that never answers would be waited for for ever. This file has two: one for the answer to
//    begin, one for the silence between two events. Stop (the caller's signal) ends the wait at once.
//  - The answer is read strictly: every event must be JSON; the reply must end with a finish reason (a stream that just stops is an
//    interrupted reply); usage numbers are believed only when they are whole and in bounds; a part marked `thought` is never shown (the
//    thoughts are not asked for, owner's pick 6), though its tokens are counted.
//  - A blocked question comes back as a SUCCESS with no answer in it (`promptFeedback.blockReason`): it ends as declined. A refused key is a
//    400 whose details say API_KEY_INVALID: it is told as a refused key. "Too many requests" and "no quota left" are both 429.

export const API_BASE_URL = 'https://generativelanguage.googleapis.com'
const API_VERSION = 'v1beta'

/** A listing longer than this is cut short (as for OpenAI): nobody has this many models, and a runaway listing should not run on. */
const MAX_LISTED_MODELS = 1000
/** And never more than this many pages of it. */
const MAX_LIST_PAGES = 20
/** A token count above this in a usage report is not believed (the registry's own bound on a count). */
const MAX_TOKEN_COUNT = 100_000_000
/** One event of the stream larger than this is not an answer the app can use; the reading stops there. */
const MAX_EVENT_CHARS = 16 * 1024 * 1024
/** What an error body may weigh before it is read (a page of HTML, a runaway body): only its first part is looked at. */
const MAX_ERROR_CHARS = 64 * 1024

/** The adapter's clocks, in milliseconds. Handed in so that the checks can make them short. */
export interface GeminiClocks {
  /** From sending the request to the first byte of the answer (the head of a stream, or an error). */
  startMs: number
  /** The longest silence between two pieces of a stream. */
  idleMs: number
  /** A model listing ("Test key"), whole. */
  listMs: number
}

export const GEMINI_CLOCKS: GeminiClocks = Object.freeze({
  startMs: 10 * 60_000, // as long as the other providers' SDKs wait by default; a long prompt with high thinking can take minutes to begin
  idleMs: 5 * 60_000,
  listMs: 60_000
})

/** What the provider answered when it refused a request: the HTTP status, its own status word, the reason in its details, and its words. */
export class GeminiApiError extends Error {
  readonly status: number | null
  readonly code: string | null
  readonly reason: string | null
  readonly quota: boolean
  constructor(
    message: string,
    status: number | null,
    code: string | null,
    reason: string | null,
    quota: boolean
  ) {
    super(message)
    this.name = 'GeminiApiError'
    this.status = status
    this.code = code
    this.reason = reason
    this.quota = quota
  }
}

/** The provider said the reply failed, or sent something that cannot be read: the words say which. */
class ReplyFailed extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ReplyFailed'
  }
}

/** The stream ended cleanly but without a finish reason: an interrupted reply. */
class ReplyEndedEarly extends Error {
  constructor() {
    super('terminated') // what the HTTP client says when a connection is cut off: isInterrupted knows it
    this.name = 'ReplyEndedEarly'
  }
}

/** One of the adapter's own clocks ran out (not the caller's Stop). */
class GeminiTimeout extends Error {
  constructor(what: string) {
    super(`no answer from Google ${what}`)
    this.name = 'GeminiTimeout'
  }
}

/** The connection could not be made at all (no network, nothing listening, a name that does not resolve). */
class GeminiConnectionFailed extends Error {
  constructor(cause: unknown) {
    super(`could not connect (${rawMessage(cause)})`, { cause })
    this.name = 'GeminiConnectionFailed'
  }
}

const base = (credentials: Credentials): string =>
  `${credentials.baseURL ? credentials.baseURL.replace(/\/+$/, '') : API_BASE_URL}/${API_VERSION}`

/** The headers of every request: the key in Google's header, and nothing that names anyone else. */
const headersFor = (apiKey: string, accept: string): Record<string, string> => ({
  'content-type': 'application/json',
  accept,
  'x-goog-api-key': apiKey
})

/**
 * A signal that aborts when the caller's does, or when `clock` says (re-armed with `restart`). `clockFired` tells the two apart afterwards: a
 * Stop is the caller's, a timeout is the adapter's.
 */
function watchdog(signal: AbortSignal | undefined): {
  signal: AbortSignal
  arm: (ms: number, what: string) => void
  clockFired: () => string | null
  done: () => void
} {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | null = null
  let fired: string | null = null
  const onAbort = (): void => controller.abort(signal?.reason)
  if (signal?.aborted) controller.abort(signal.reason)
  else signal?.addEventListener('abort', onAbort, { once: true })
  return {
    signal: controller.signal,
    arm: (ms, what) => {
      if (timer !== null) clearTimeout(timer)
      timer = setTimeout(() => {
        fired = what
        controller.abort(new GeminiTimeout(what))
      }, ms)
    },
    clockFired: () => fired,
    done: () => {
      if (timer !== null) clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
    }
  }
}

/** The facts of an error answer, read from its body (Google's `{ error: { code, message, status, details } }`), or from its status alone. */
async function errorOf(response: Response): Promise<GeminiApiError> {
  let text = ''
  try {
    text = (await response.text()).slice(0, MAX_ERROR_CHARS)
  } catch {
    // the body could not be read: the status says enough
  }
  let body: Record<string, unknown> = {}
  try {
    body = fieldsOf(fieldsOf(JSON.parse(text))['error'])
  } catch {
    // not JSON (a proxy's page of HTML): only the status is known
  }
  const message = typeof body['message'] === 'string' ? body['message'] : null
  const code = typeof body['status'] === 'string' ? body['status'] : null
  const details = Array.isArray(body['details']) ? (body['details'] as unknown[]).map(fieldsOf) : []
  const info = details.find((d) => String(d['@type']).endsWith('google.rpc.ErrorInfo'))
  const reason = typeof info?.['reason'] === 'string' ? info['reason'] : null
  const quota =
    details.some((d) => String(d['@type']).endsWith('google.rpc.QuotaFailure')) ||
    (message !== null && /exceeded your current quota/i.test(message))
  return new GeminiApiError(
    message ?? `HTTP ${response.status}`,
    response.status,
    code,
    reason,
    quota
  )
}

/** Sends one request, ONCE, under the watchdog's first clock. Throws the adapter's own errors (a refusal, a timeout, no connection). */
async function send(
  url: string,
  init: { method: 'GET' | 'POST'; headers: Record<string, string>; body?: string },
  dog: ReturnType<typeof watchdog>,
  startMs: number
): Promise<Response> {
  dog.arm(startMs, 'within the time allowed for an answer to begin')
  let response: Response
  try {
    response = await fetch(url, { ...init, signal: dog.signal, redirect: 'error' })
  } catch (error) {
    const fired = dog.clockFired()
    if (fired !== null) throw new GeminiTimeout(fired)
    if (dog.signal.aborted) throw error // the caller's Stop
    throw new GeminiConnectionFailed(error)
  }
  if (!response.ok) throw await errorOf(response)
  return response
}

/** A whole, finite count from 0 to MAX_TOKEN_COUNT, or undefined when the field is absent; null when it is there and cannot be believed. */
function count(value: unknown): number | null | undefined {
  if (value === undefined) return undefined
  return typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= MAX_TOKEN_COUNT
    ? value
    : null
}

// Google's usage report: `cachedContentTokenCount` is INSIDE `promptTokenCount`; `thoughtsTokenCount` is BESIDE `candidatesTokenCount` (both
// billed as output); `toolUsePromptTokenCount` is input of its own. A report with any number that cannot be believed counts as nothing, and
// the app then makes its own guess, marked as one (chat.ts): a wrong number is never priced.
function usage(report: unknown): Usage {
  const fields = fieldsOf(report)
  const read = [
    'promptTokenCount',
    'cachedContentTokenCount',
    'candidatesTokenCount',
    'thoughtsTokenCount',
    'toolUsePromptTokenCount'
  ].map((name) => count(fields[name]))
  if (read.some((value) => value === null)) return { ...NO_USAGE }
  const [prompt = 0, cached = 0, candidates = 0, thoughts = 0, toolUse = 0] = read as (
    number | undefined
  )[]
  const cacheRead = Math.min(cached, prompt)
  return {
    inputTokens: prompt - cacheRead + toolUse,
    cacheReadTokens: cacheRead,
    cacheWriteTokens: 0,
    outputTokens: candidates + thoughts
  }
}

/** One part of a turn as Gemini takes it. */
type Part =
  | { text: string; thoughtSignature?: string }
  | { inlineData: { mimeType: string; data: string } }
  | {
      functionCall: { name: string; args: Record<string, unknown>; id?: string }
      thoughtSignature?: string
    }
  | {
      functionResponse: { name: string; response: Record<string, unknown>; id?: string }
    }

interface Content {
  role: 'user' | 'model'
  parts: Part[]
}

/** The adapter's record of a turn that called functions: the parts as they came (signatures and all), and for each call its name and whether Google gave it an id. */
interface TurnRecord {
  parts: Part[]
  calls: { id: string; name: string; googleId: boolean }[]
}

/** The ids the app makes for a call that came without one (an older model): never sent to Google. */
const madeId = (index: number): string => `gemini-call-${index}`

/**
 * The conversation in Gemini's form: roles `user` and `model`; files as inline data (pictures and PDFs, base64) and a text file as text led by a line
 * that names it (as for OpenAI); a turn that called functions sent back exactly as it came; the results as `functionResponse` parts, by the name of the
 * call they answer (and its id, when Google gave one). An assistant turn with no text is left out (Gemini refuses an empty part).
 */
function geminiContents(messages: readonly NeutralMessage[]): Content[] {
  const contents: Content[] = []
  let lastCalls: TurnRecord['calls'] = []
  for (const message of messages) {
    if (message.toolTurn !== undefined) {
      const record = message.toolTurn.record as TurnRecord
      lastCalls = record.calls
      contents.push({ role: 'model', parts: record.parts })
      continue
    }
    if (message.toolResults !== undefined) {
      contents.push({
        role: 'user',
        parts: message.toolResults.map((result): Part => {
          const call = lastCalls.find((c) => c.id === result.callId)
          return {
            functionResponse: {
              name: call?.name ?? result.callId,
              ...(call?.googleId === true ? { id: call.id } : {}),
              response: result.isError ? { error: result.text } : { output: result.text }
            }
          }
        })
      })
      continue
    }
    if (message.role === 'assistant') {
      if (message.content !== '')
        contents.push({ role: 'model', parts: [{ text: message.content }] })
      continue
    }
    const parts: Part[] = (message.attachments ?? []).map((file): Part =>
      file.kind === 'image'
        ? { inlineData: { mimeType: file.mediaType, data: file.data } }
        : file.kind === 'pdf'
          ? { inlineData: { mimeType: 'application/pdf', data: file.data } }
          : { text: `${textFileLead(file.name)}\n\n${file.text}` }
    )
    if (message.content !== '') parts.push({ text: message.content })
    contents.push({ role: 'user', parts })
  }
  return contents
}

/** The body of a request, in a fixed order of fields (the golden checks compare bytes). */
export function geminiBody(request: StreamRequest): string {
  const tools = request.tools ?? []
  return JSON.stringify({
    contents: geminiContents(request.messages),
    systemInstruction: { parts: [{ text: request.system }] },
    generationConfig: {
      maxOutputTokens: request.maxOutputTokens,
      // The thinking level is the person's choice for this model, or else the registry's pick (D-024); the thoughts themselves are not asked for
      // (owner's pick 6), but they are billed as output and count against maxOutputTokens.
      ...(request.effort
        ? { thinkingConfig: { thinkingLevel: request.effort, includeThoughts: false } }
        : {})
    },
    // (17.4) The app's own tools, as function declarations with their JSON schemas as they are (`parametersJsonSchema`: Gemini's `parameters`
    // takes only a subset of OpenAPI). Google's own tools (Search, code execution, the Files API) are never offered.
    ...(tools.length > 0
      ? {
          tools: [
            {
              functionDeclarations: tools.map((tool) => ({
                name: tool.name,
                description: tool.description,
                parametersJsonSchema: tool.parameters
              }))
            }
          ],
          toolConfig: { functionCallingConfig: { mode: 'AUTO' } }
        }
      : {})
  })
}

/** Reads a stream of server-sent events: yields the JSON of each `data:` event. Events end at a blank line, written with LF or CRLF. */
async function* sseEvents(
  body: ReadableStream<Uint8Array>,
  dog: ReturnType<typeof watchdog>,
  idleMs: number
): AsyncGenerator<unknown> {
  const reader = body.getReader()
  const decoder = new TextDecoder() // a character cut between two pieces is kept until the rest of it comes
  let buffer = ''
  const take = (block: string): unknown | undefined => {
    const data = block
      .split(/\r?\n|\r/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).replace(/^ /, ''))
      .join('\n')
    if (data === '') return undefined // a comment, or a keep-alive
    try {
      return JSON.parse(data)
    } catch {
      throw new ReplyFailed('Google sent a part of the answer that could not be read')
    }
  }
  try {
    for (;;) {
      dog.arm(idleMs, 'for too long in the middle of the reply')
      let chunk: ReadableStreamReadResult<Uint8Array>
      try {
        chunk = await reader.read()
      } catch (error) {
        const fired = dog.clockFired()
        if (fired !== null) throw new GeminiTimeout(fired)
        throw error // the caller's Stop, or the connection cut ("terminated")
      }
      if (chunk.done) {
        buffer += decoder.decode()
        break
      }
      buffer += decoder.decode(chunk.value, { stream: true })
      for (;;) {
        const end = /\r?\n\r?\n/.exec(buffer)
        if (end === null) break
        const block = buffer.slice(0, end.index)
        buffer = buffer.slice(end.index + end[0].length)
        const event = take(block)
        if (event !== undefined) yield event
      }
      if (buffer.length > MAX_EVENT_CHARS)
        throw new ReplyFailed('Google sent more than the app can read')
    }
    if (buffer.trim() !== '') {
      const event = take(buffer)
      if (event !== undefined) yield event
    }
  } finally {
    reader.cancel().catch(() => undefined)
  }
}

/** The finish reasons that mean Google decided not to go on (a safety system, a copyright check, a list of blocked terms). */
const DECLINED = new Set([
  'SAFETY',
  'PROHIBITED_CONTENT',
  'BLOCKLIST',
  'SPII',
  'RECITATION',
  'IMAGE_SAFETY',
  'LANGUAGE'
])
/** The finish reasons that mean the model's call of a tool could not be used. */
const BROKEN_CALL = new Set([
  'MALFORMED_FUNCTION_CALL',
  'UNEXPECTED_TOOL_CALL',
  'TOO_MANY_TOOL_CALLS'
])

function endOf(reason: string): ReplyEnd {
  if (reason === 'STOP') return { kind: 'done' }
  if (DECLINED.has(reason)) return { kind: 'declined', category: reason }
  // MAX_TOKENS, OTHER, and any reason this app has not met: the reply stopped before it was complete, which is what the person is told.
  return { kind: 'cut-off' }
}

/** A clean copy of a part of the model's turn, with only the fields Gemini takes back; null for a part that is not kept (a thought, an empty text). */
function keptPart(part: Record<string, unknown>): Part | null {
  if (part['thought'] === true) return null
  const signature =
    typeof part['thoughtSignature'] === 'string'
      ? { thoughtSignature: part['thoughtSignature'] }
      : {}
  const call = fieldsOf(part['functionCall'])
  if (typeof call['name'] === 'string') {
    const args = fieldsOf(call['args'])
    return {
      functionCall: {
        name: call['name'],
        args,
        ...(typeof call['id'] === 'string' ? { id: call['id'] } : {})
      },
      ...signature
    }
  }
  if (
    typeof part['text'] === 'string' &&
    (part['text'] !== '' || 'thoughtSignature' in signature)
  ) {
    return { text: part['text'], ...signature }
  }
  return null
}

function streamFor(clocks: GeminiClocks): (request: StreamRequest) => AsyncGenerator<StreamEvent> {
  return async function* stream(request: StreamRequest): AsyncGenerator<StreamEvent> {
    const dog = watchdog(request.signal)
    try {
      const url = `${base(request.credentials)}/models/${encodeURIComponent(request.model.id)}:streamGenerateContent?alt=sse`
      const response = await send(
        url,
        {
          method: 'POST',
          headers: headersFor(request.credentials.apiKey, 'text/event-stream'),
          body: geminiBody(request)
        },
        dog,
        clocks.startMs
      )
      if (
        !/^text\/event-stream/i.test(response.headers.get('content-type') ?? '') ||
        response.body === null
      ) {
        throw new ReplyFailed('Google answered with something that is not a stream')
      }
      let report: unknown = undefined
      let finish: string | null = null
      let blocked: string | null = null
      const parts: Part[] = []
      for await (const event of sseEvents(response.body, dog, clocks.idleMs)) {
        const fields = fieldsOf(event)
        if ('error' in fields) {
          const error = fieldsOf(fields['error'])
          throw new GeminiApiError(
            typeof error['message'] === 'string' ? error['message'] : 'the reply failed',
            null,
            typeof error['status'] === 'string' ? error['status'] : null,
            null,
            false
          )
        }
        if (fields['usageMetadata'] !== undefined) report = fields['usageMetadata']
        const feedback = fieldsOf(fields['promptFeedback'])
        if (typeof feedback['blockReason'] === 'string') blocked = feedback['blockReason']
        const candidates = Array.isArray(fields['candidates'])
          ? (fields['candidates'] as unknown[])
          : []
        const candidate = fieldsOf(candidates[0])
        const content = fieldsOf(candidate['content'])
        for (const raw of Array.isArray(content['parts']) ? (content['parts'] as unknown[]) : []) {
          const part = fieldsOf(raw)
          const kept = keptPart(part)
          // A thought (sent although not asked for) is never shown; text is shown as it arrives.
          if (part['thought'] !== true && typeof part['text'] === 'string' && part['text'] !== '') {
            yield { type: 'text', text: part['text'] }
          }
          if (kept !== null) parts.push(kept)
        }
        if (typeof candidate['finishReason'] === 'string') finish = candidate['finishReason']
      }
      // A question Google blocked comes back as a success with no answer: declined, with its reason.
      if (blocked !== null && finish === null) {
        yield { type: 'end', end: { kind: 'declined', category: blocked }, usage: usage(report) }
        return
      }
      if (finish === null) throw new ReplyEndedEarly()
      if (BROKEN_CALL.has(finish)) {
        throw new ReplyFailed(`the model wrote a call of a tool that could not be used (${finish})`)
      }
      // (17.4) The model asked for tools: each call (Google's id, or one the app makes for a call without one), and the turn as it must be sent back.
      const calls: NeutralToolCall[] = []
      const recordCalls: TurnRecord['calls'] = []
      for (const part of parts) {
        if ('functionCall' in part) {
          const googleId = typeof part.functionCall.id === 'string'
          const id = googleId ? (part.functionCall.id as string) : madeId(recordCalls.length)
          calls.push({ id, name: part.functionCall.name, input: part.functionCall.args })
          recordCalls.push({ id, name: part.functionCall.name, googleId })
        }
      }
      if (calls.length > 0 && finish === 'STOP') {
        const record: TurnRecord = { parts, calls: recordCalls }
        yield { type: 'end', end: { kind: 'tool-use' }, usage: usage(report), calls, record }
        return
      }
      yield { type: 'end', end: endOf(finish), usage: usage(report) }
    } finally {
      dog.done()
    }
  }
}

function listModelsFor(
  clocks: GeminiClocks
): (credentials: Credentials, signal?: AbortSignal) => Promise<ProviderModel[]> {
  return async (credentials, signal) => {
    const dog = watchdog(signal)
    const models: ProviderModel[] = []
    try {
      let token: string | null = null
      for (let page = 0; page < MAX_LIST_PAGES && models.length < MAX_LISTED_MODELS; page++) {
        const query = `pageSize=1000${token === null ? '' : `&pageToken=${encodeURIComponent(token)}`}`
        const response = await send(
          `${base(credentials)}/models?${query}`,
          { method: 'GET', headers: headersFor(credentials.apiKey, 'application/json') },
          dog,
          clocks.listMs
        )
        let body: Record<string, unknown>
        try {
          body = fieldsOf(JSON.parse((await response.text()).slice(0, 8 * 1024 * 1024)))
        } catch {
          throw new ReplyFailed('Google sent a list of models that could not be read')
        }
        for (const raw of Array.isArray(body['models']) ? (body['models'] as unknown[]) : []) {
          const model = fieldsOf(raw)
          const name = model['name']
          if (typeof name !== 'string' || !name.startsWith('models/')) continue
          const label = model['displayName']
          models.push({
            id: name.slice('models/'.length),
            label: typeof label === 'string' && label.length <= 100 ? label : null
          })
          if (models.length >= MAX_LISTED_MODELS) break
        }
        token =
          typeof body['nextPageToken'] === 'string' && body['nextPageToken'] !== ''
            ? body['nextPageToken']
            : null
        if (token === null) break
      }
      return models
    } finally {
      dog.done()
    }
  }
}

/** Google Search grounding is not offered (owner's pick 5: Google keeps grounded prompts for 30 days, and it has its own price). Never called. */
async function search(): Promise<SearchResult> {
  throw new ReplyFailed('searching the web is not offered for Gemini models')
}

function factsOf(error: unknown): ErrorFacts {
  const api = error instanceof GeminiApiError ? error : null
  const facts = {
    status: api?.status ?? null,
    detail: api
      ? api.status === null || api.message !== `HTTP ${api.status}`
        ? api.message
        : null
      : null,
    requestId: null,
    raw: rawMessage(error)
  }
  if (api !== null) {
    if (api.status === null) return { ...facts, kind: 'provider' } // in the middle of a reply, as an event
    if (
      api.status === 401 ||
      api.reason === 'API_KEY_INVALID' ||
      /API key not valid/i.test(api.message)
    ) {
      return { ...facts, kind: 'auth' }
    }
    if (api.status === 403) return { ...facts, kind: 'permission' }
    if (api.status === 404) return { ...facts, kind: 'not-found' }
    if (api.status === 429) return { ...facts, kind: api.quota ? 'quota' : 'rate-limit' }
    if (api.status === 400) return { ...facts, kind: 'bad-request' }
    if (api.status === 503) return { ...facts, kind: 'overloaded' }
    if (api.status >= 500) return { ...facts, kind: 'server' }
    return { ...facts, kind: 'provider' }
  }
  if (error instanceof GeminiTimeout) return { ...facts, kind: 'timeout' }
  if (error instanceof GeminiConnectionFailed) return { ...facts, kind: 'connection' }
  if (error instanceof ReplyFailed) return { ...facts, detail: error.message, kind: 'provider' }
  if (error instanceof ReplyEndedEarly || isInterrupted(error))
    return { ...facts, kind: 'interrupted' }
  return { ...facts, kind: 'unknown' }
}

function normalizeError(error: unknown, context: { modelId: string }): NormalizedError {
  return normalizedError(factsOf(error), {
    providerName: PROVIDER_NAMES.google,
    modelId: context.modelId
  })
}

/** An adapter with its own clocks (the checks make them short); `geminiAdapter` is the app's. */
export function createGeminiAdapter(clocks: GeminiClocks = GEMINI_CLOCKS): ProviderAdapter {
  return {
    provider: 'google',
    listModels: listModelsFor(clocks),
    stream: streamFor(clocks),
    search,
    usage,
    normalizeError
  }
}

export const geminiAdapter: ProviderAdapter = createGeminiAdapter()
