import Anthropic, { type APIError } from '@anthropic-ai/sdk'
import type { WireMessage } from '../shared/ipc'

// The one provider for now (D-012): Anthropic's Claude, through Anthropic's own SDK. Nothing here
// imports Electron, so it can be run and checked on its own.

export const PROVIDER_NAME = 'Anthropic'
export const MODEL = 'claude-opus-5-5'
export const MODEL_LABEL = 'Claude Opus 5.5'
export const API_BASE_URL = 'https://api.anthropic.com'

// A ceiling on one reply, and so on what one reply can cost (output tokens are the expensive ones).
// The thinking the model does before it answers counts against it too.
const MAX_TOKENS = 16000

// The chat window shows plain text only (D-009), and Claude writes Markdown by default, which would
// appear as stray asterisks and backticks. Remove this once replies are rendered as Markdown.
const SYSTEM_PROMPT =
  'You are Claude, chatting with someone in Frontier App, a desktop chat window. The window shows ' +
  'replies as plain text and does not render Markdown, so do not use Markdown syntax: no asterisks or ' +
  'underscores for emphasis, no # headings, no backticks, no tables. Write in ordinary paragraphs, and ' +
  'use simple hyphen lists or numbered lines when a list helps. If you include code, put it on its own ' +
  'lines, indented by four spaces.'

/** How a reply ended, when it ended without an error. */
export type ReplyEnd =
  | { kind: 'done' }
  /** Stopped at the length limit: what arrived is a cut-off reply. */
  | { kind: 'cut-off' }
  /** The model declined to answer (a safety decision). `category` is the reason class, if given. */
  | { kind: 'declined'; category: string | null }
  | { kind: 'context-full' }

/**
 * The API wants the two sides to take turns. After a reply that failed with no text, the person's
 * next message follows their previous one, so joins consecutive messages from the same side into one.
 * (The docs disagree on whether the API does this itself, so it is not left to the API.)
 */
export function mergeAdjacent(messages: WireMessage[]): WireMessage[] {
  const merged: WireMessage[] = []
  for (const message of messages) {
    const last = merged.at(-1)
    if (last && last.role === message.role) {
      last.content += `\n\n${message.content}`
    } else {
      merged.push({ ...message })
    }
  }
  return merged
}

export interface StreamOptions {
  apiKey: string
  /** The conversation so far, ending with the person's latest message. */
  messages: WireMessage[]
  /** Aborting it cancels the request. The rejected promise is then not a failure. */
  signal: AbortSignal
  /** For tests only (see chat.ts); normally the real API address. */
  baseURL?: string
  onText: (text: string) => void
}

/** Sends the conversation to the model and passes the reply on as it arrives. */
export async function streamReply(options: StreamOptions): Promise<ReplyEnd> {
  const client = new Anthropic({
    apiKey: options.apiKey,
    // Both set on purpose. Left unset, the SDK reads ANTHROPIC_AUTH_TOKEN from the environment (and
    // would send two credentials, which the API rejects) and ANTHROPIC_BASE_URL (which could send
    // this key to another server). The key saved in Settings is the only credential, and it goes
    // only where this file says.
    authToken: null,
    baseURL: options.baseURL ?? API_BASE_URL
  })

  const stream = client.messages.stream(
    {
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: SYSTEM_PROMPT,
      messages: mergeAdjacent(options.messages),
      // Thinking is always on for this model. `effort` is its dial: written out, because the default
      // differs between models and this should not change when the model does.
      output_config: { effort: 'medium' },
      // The whole conversation is sent again with every message. This lets the server reuse the part
      // it has already seen (billed far lower) instead of charging full price for it each time.
      cache_control: { type: 'ephemeral' }
    },
    { signal: options.signal }
  )
  stream.on('text', (delta) => options.onText(delta))
  const message = await stream.finalMessage()

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

function apiMessage(error: APIError): string | null {
  const body: unknown = error.error
  if (typeof body !== 'object' || body === null) return null
  const inner = (body as { error?: unknown }).error
  if (typeof inner !== 'object' || inner === null) return null
  const message = (inner as { message?: unknown }).message
  return typeof message === 'string' ? message : null
}

/**
 * True if a reply was cut off by the connection dropping while it was arriving. The SDK does not give
 * that its own error class: it surfaces as a plain error whose message is just "terminated" (from the
 * HTTP client underneath), so look at the error and what caused it.
 */
function isInterrupted(error: unknown): boolean {
  let current: unknown = error
  for (let depth = 0; current instanceof Error && depth < 4; depth++) {
    const code = (current as { code?: unknown }).code
    if (
      current.message === 'terminated' ||
      /other side closed/i.test(current.message) ||
      code === 'ECONNRESET' ||
      code === 'UND_ERR_SOCKET'
    ) {
      return true
    }
    current = current.cause
  }
  return false
}

function explain(error: unknown): string {
  // Most specific first: the timeout class is a kind of connection error, which is a kind of API error.
  if (error instanceof Anthropic.AuthenticationError) {
    return 'The API key was not accepted (401). Check it in Settings.'
  }
  if (error instanceof Anthropic.PermissionDeniedError) {
    return `This API key is not allowed to do that (403). ${apiMessage(error) ?? ''}`.trim()
  }
  if (error instanceof Anthropic.NotFoundError) {
    return `The model ${MODEL} was not found for this account (404). ${apiMessage(error) ?? ''}`.trim()
  }
  if (error instanceof Anthropic.RateLimitError) {
    return 'Too many requests right now (429). Wait a moment and try again.'
  }
  if (error instanceof Anthropic.BadRequestError) {
    return `The request was refused (400): ${apiMessage(error) ?? 'no details were given'}`
  }
  if (error instanceof Anthropic.APIConnectionTimeoutError) {
    return 'The request timed out. Check your internet connection and try again.'
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return 'Could not reach Anthropic. Check your internet connection.'
  }
  if (error instanceof Anthropic.InternalServerError) {
    return error.status === 529
      ? 'Anthropic is overloaded right now (529). Try again in a moment.'
      : `Anthropic had a problem on its side (${error.status}). Try again in a moment.`
  }
  if (error instanceof Anthropic.APIError) {
    // No status: the error arrived in the middle of a reply, as an event.
    return error.status === undefined
      ? `Anthropic stopped the reply: ${apiMessage(error) ?? error.message}`
      : `Anthropic returned an error (${error.status}): ${apiMessage(error) ?? error.message}`
  }
  if (isInterrupted(error)) {
    return 'The connection was interrupted while the reply was arriving. Check your internet connection and try again.'
  }
  return `Something went wrong: ${error instanceof Error ? error.message : String(error)}`
}

/**
 * A sentence for the person, from whatever went wrong. The API key is scrubbed out of it, in case
 * any text in the error ever contained it, and the request id is added for support.
 */
export function describeError(error: unknown, apiKey: string): string {
  let text = explain(error)
  if (error instanceof Anthropic.APIError && error.requestID)
    text += ` (request ${error.requestID})`
  return apiKey.length >= 8 ? text.split(apiKey).join('[key]') : text
}
