import type { Effort, ModelEntry, ProviderId } from '../../shared/registry'

// The vocabulary of the provider layer (D-018): what the rest of the app says to any provider, and what any provider
// says back. Nothing here is Anthropic's or OpenAI's. Each provider has one adapter (anthropic.ts, ...) that
// translates between this and its own API; everything else in the app (chat.ts, the registry, the page) knows
// only these types. No Electron imports, so every adapter can be run and checked under plain Node.

/**
 * One turn of a conversation, in no provider's format. Text only, because the chat shows text (a reply is Markdown, D-025):
 * a different kind of content (an image, a tool call) would be a new field here and a translation in each adapter.
 */
export interface NeutralMessage {
  role: 'user' | 'assistant'
  content: string
}

/** What a provider is given to prove who is asking. */
export interface Credentials {
  apiKey: string
  /**
   * For tests only (see chat.ts): the origin of a fake server, such as "http://127.0.0.1:8790". Each adapter adds its
   * own API path to it. It is never taken from the page, from the registry, or from a packaged app.
   */
  baseURL?: string
}

/**
 * Everything one reply needs, in no provider's format. The adapter translates it and decides nothing: which system
 * prompt, how long a reply may be and what the conversation holds are the app's policy (policy.ts, request.ts).
 */
export interface StreamRequest {
  credentials: Credentials
  /** The registry entry: which model to ask, and what it can do (its limits, the effort levels it takes). */
  model: ModelEntry
  /**
   * How hard to ask the model to think (D-024): the person's saved choice for this model, or else the registry's pick. Null
   * for a model that takes no effort setting, and then nothing about effort is sent. An adapter sends THIS, never
   * `model.effort`, which is only the registry's default.
   */
  effort: Effort | null
  system: string
  /** Ends with the person's latest message, and the two sides take turns (consecutive turns are already joined, D-013). */
  messages: NeutralMessage[]
  /** The longest reply to ask for. For models that think first, the thinking counts against it. */
  maxOutputTokens: number
  /** Aborting cancels the network request. The stream then throws, and that is a Stop, not a failure. */
  signal: AbortSignal
}

/** How a reply ended, when it ended without an error. */
export type ReplyEnd =
  | { kind: 'done' }
  /** Stopped at the length limit: what arrived is a cut-off reply. */
  | { kind: 'cut-off' }
  /** The model declined to answer (a safety decision). `category` is the reason class, if one was given. */
  | { kind: 'declined'; category: string | null }
  | { kind: 'context-full' }

/**
 * What a reply used, in four buckets that never overlap: every token is counted in exactly one of them, so they can
 * be added up, and priced one by one. Providers report this differently (Anthropic lists cached tokens beside the
 * input, OpenAI inside it), which is why each adapter converts its own report (`ProviderAdapter.usage`).
 */
export interface Usage {
  /** Tokens read at the ordinary input price. */
  inputTokens: number
  /** Tokens read back from the provider's prompt cache, which is billed at a lower price. */
  cacheReadTokens: number
  /** Tokens written to the prompt cache, which some providers bill at a higher price. */
  cacheWriteTokens: number
  /** Everything the model wrote, including the thinking it did first: it is billed as output. */
  outputTokens: number
}

export type StreamEvent =
  | { type: 'text'; text: string }
  /** The last event of a reply that did not fail. Exactly one. */
  | { type: 'end'; end: ReplyEnd; usage: Usage }

/** What a provider says about one model it offers. */
export interface ProviderModel {
  id: string
  /** A name for people, when the provider gives one. */
  label: string | null
}

/** The ways a request can fail, in terms every provider shares. */
export type ErrorKind =
  | 'auth' //         the key was not accepted
  | 'permission' //   the key is not allowed to do this
  | 'not-found' //    usually: the model, for this account
  | 'rate-limit' //   too many requests
  | 'quota' //        no credit left, or a spending limit reached (some providers answer 429 for this too)
  | 'bad-request' //  the provider refused the request itself
  | 'timeout'
  | 'connection' //   could not reach the provider
  | 'overloaded' //   the provider is too busy to answer
  | 'server' //       a problem on the provider's side
  | 'interrupted' //  the connection dropped while a reply was arriving
  | 'provider' //     the provider reported an error that fits none of the above
  | 'unknown' //      not an error from a provider at all

export interface NormalizedError {
  kind: ErrorKind
  /** The HTTP status, when there was one. */
  status: number | null
  /** The provider's own id for the request, for support. */
  requestId: string | null
  /**
   * One sentence for the person, in this app's voice. It does not yet carry the request id and has not yet been
   * scrubbed of the API key: `describeFailure` (errors.ts) does both.
   */
  message: string
}

/** One provider, as the rest of the app sees it. There is one adapter per entry of SUPPORTED_PROVIDERS. */
export interface ProviderAdapter {
  readonly provider: ProviderId
  /**
   * The models this key can use, as the provider lists them. A listing costs nothing (no tokens), so it is also what
   * "Test key" runs. Throws on failure: pass the error to `normalizeError`.
   */
  listModels(credentials: Credentials, signal?: AbortSignal): Promise<ProviderModel[]>
  /**
   * Sends the conversation and yields the reply as it arrives: `text` events, then exactly one `end`. Throws if the
   * request fails, at any point (the text that arrived before stays with the caller). Aborting `request.signal`
   * makes it throw too.
   */
  stream(request: StreamRequest): AsyncGenerator<StreamEvent>
  /** The provider's own usage report as the four neutral buckets. Never throws: a report it cannot read counts as nothing. */
  usage(report: unknown): Usage
  /** What went wrong, from anything a call to this provider can throw. `modelId` names the model for the errors that need to. */
  normalizeError(error: unknown, context: { modelId: string }): NormalizedError
}
