import type { ErrorKind, NormalizedError } from './types'

// What the person reads when a request fails (D-018). Each adapter works out the FACTS about an error from its own
// SDK's error classes (what kind it is, the status, the provider's own words); the sentences are chosen here, so that
// every provider says the same thing the same way. The wording of the cases that existed before there was more than
// one provider (Anthropic's) is unchanged, character for character.

/** What an adapter works out about an error, before any words are chosen. */
export interface ErrorFacts {
  kind: ErrorKind
  /** The HTTP status, or null when the error did not come with one (it arrived in the middle of a reply, or it is not an HTTP error). */
  status: number | null
  /** The provider's own words for what went wrong, when it gave any. */
  detail: string | null
  requestId: string | null
  /** The error's own message: what is said when the provider gave no detail. */
  raw: string
}

/** The message of whatever was thrown (anything can be thrown). */
export const rawMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

/**
 * True if a reply was cut off by the connection dropping while it was arriving. The SDKs do not give that its own
 * error class: it surfaces as a plain error whose message is just "terminated" (from the HTTP client underneath),
 * so look at the error and what caused it.
 */
export function isInterrupted(error: unknown): boolean {
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

function sentence(facts: ErrorFacts, providerName: string, modelId: string): string {
  const { kind, status, detail, raw } = facts
  switch (kind) {
    case 'auth':
      // (17.3) Google refuses a key with a 400, not a 401: the status said is the one that came (for the other two it is always 401, so their words are unchanged)
      return `The API key was not accepted (${status ?? 401}). Check it in Settings.`
    case 'permission':
      return `This API key is not allowed to do that (403). ${detail ?? ''}`.trim()
    case 'not-found':
      return `The model ${modelId} was not found for this account (404). You can choose another model in the header. ${detail ?? ''}`.trim()
    case 'rate-limit':
      return 'Too many requests right now (429). Wait a moment and try again.'
    case 'quota':
      return `Your ${providerName} account has no credit left, or has reached its spending limit (429). Check your billing with ${providerName}.`
    case 'bad-request':
      return `The request was refused (400): ${detail ?? 'no details were given'}`
    case 'timeout':
      return 'The request timed out. Check your internet connection and try again.'
    case 'connection':
      return `Could not reach ${providerName}. Check your internet connection.`
    case 'overloaded':
      return `${providerName} is overloaded right now (${status}). Try again in a moment.`
    case 'server':
      return `${providerName} had a problem on its side (${status}). Try again in a moment.`
    case 'interrupted':
      return 'The connection was interrupted while the reply was arriving. Check your internet connection and try again.'
    case 'provider':
      // No status: the error arrived in the middle of a reply, as an event.
      return status === null
        ? `${providerName} stopped the reply: ${detail ?? raw}`
        : `${providerName} returned an error (${status}): ${detail ?? raw}`
    default:
      return `Something went wrong: ${raw}`
  }
}

/** Puts the facts and the provider's name into words. `providerName` is how the person knows the provider ("Anthropic"). */
export function normalizedError(
  facts: ErrorFacts,
  context: { providerName: string; modelId: string }
): NormalizedError {
  return {
    kind: facts.kind,
    status: facts.status,
    requestId: facts.requestId,
    message: sentence(facts, context.providerName, context.modelId)
  }
}

/** For a call that gave up waiting (Settings' "Test key" does, after 20 seconds), as if the provider's SDK had said so. */
export const timeoutError = (providerName: string): NormalizedError =>
  normalizedError(
    { kind: 'timeout', status: null, detail: null, requestId: null, raw: '' },
    { providerName, modelId: '' }
  )

/** For a failure that is no provider's: it happened before a provider was chosen, or is not an HTTP error at all. */
export const unknownError = (error: unknown): NormalizedError =>
  normalizedError(
    { kind: 'unknown', status: null, detail: null, requestId: null, raw: rawMessage(error) },
    { providerName: '', modelId: '' }
  )

/**
 * The sentence for the person, from a normalized error. The request id is added for support, and the API key is
 * scrubbed out of the whole thing, in case any text in the error ever contained it.
 */
export function describeFailure(error: NormalizedError, apiKey: string): string {
  let text = error.message
  if (error.requestId) text += ` (request ${error.requestId})`
  return apiKey.length >= 8 ? text.split(apiKey).join('[key]') : text
}
