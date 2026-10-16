// What each reply used and what it cost (Stage 8.1, D-030): the pure part. No Electron and nothing only Node has, because the page
// (to draw the numbers) and the preload (it bundles the shared contract) use it too. The ledger that keeps these records on disk is
// main's (src/main/usageLedger.ts); everything here is arithmetic and checking, so a plain-Node suite can run it.

import {
  EFFORT_LEVELS,
  SUPPORTED_PROVIDERS,
  type Effort,
  type ModelPricing,
  type ProviderId
} from './registry'
import { isConversationId, isModelId } from './validate'

/**
 * A reply's tokens, in the four buckets that never overlap (`Usage` in providers/types.ts says why): every token is in exactly one of
 * them, so they can be added up and priced one by one. The thinking a model does first is `output`, because it is billed as output.
 */
export interface TokenCounts {
  input: number
  cacheRead: number
  cacheWrite: number
  output: number
}

export const NO_TOKENS: Readonly<TokenCounts> = Object.freeze({
  input: 0,
  cacheRead: 0,
  cacheWrite: 0,
  output: 0
})

/**
 * How a request ended, as far as money goes.
 *  - sent     : on its way (or the app was closed before it ended): only the input is counted, as an estimate
 *  - done     : ended with the provider's own report of what it used (a reply that was cut off or declined still has one)
 *  - stopped  : the person pressed Stop (or the window went away) and there was no report: an estimate
 *  - failed   : the request failed after the provider may have worked on it, with no report: an estimate
 *  - rejected : the provider refused the request outright (a key it does not accept, no credit, a malformed request): nothing is owed
 */
export const LEDGER_STATES = ['sent', 'done', 'stopped', 'failed', 'rejected'] as const
export type LedgerState = (typeof LEDGER_STATES)[number]

/**
 * What a provider bills for ONE hosted web search, in US dollars, on top of the tokens the search puts in the request (D-041, 11.6). Anthropic: $10 per 1,000
 * searches (a search that fails is not billed); OpenAI: $10 per 1,000 calls of its `web_search` tool, whatever the model. Read from the providers' own pricing
 * pages on 8 October 2026 (11.1). It lives here and not in the registry because the registry's shape is strict and would change every fixture; a change of
 * price is a change of this one line, and a record keeps the price it was counted at.
 */
export const SEARCH_FEE_USD: Readonly<Record<ProviderId, number>> = Object.freeze({
  anthropic: 0.01,
  openai: 0.01
})

/** The searches a request was billed for, and the fee each was counted at. */
export interface SearchFee {
  count: number
  usdEach: number
}

/**
 * What a clip of speech to text cost (Stage 15.5, D-047): the whole seconds it was charged for and the price of a minute it was counted at. A record that carries
 * one has no tokens: the money is this. The price lives with the record, as for the tokens, so a change of price later does not change what was spent.
 */
export interface AudioFee {
  kind: 'transcribe'
  seconds: number
  usdPerMinute: number
}

/** What an audio fee comes to, in US dollars: the seconds rounded up (at least one) at the price of a minute. */
export const audioFeeUsd = (fee: AudioFee): number =>
  (Math.max(1, Math.ceil(fee.seconds)) / 60) * fee.usdPerMinute

/**
 * What a request for pictures cost (Stage 16.2, D-048): how many pictures were asked for and the US dollars counted for them. When it is begun, the most the request can
 * cost (reserved against the limits); when it ends, the cost from the tokens the answer reported, or the table figure marked as a guess. A record that carries one has
 * no priced tokens: the money is this.
 */
export interface ImageFee {
  kind: 'generate'
  count: number
  usd: number
}

/** One line of the ledger: one request to a provider, with the prices it was counted at (they may change in the registry later). */
export interface LedgerRecord {
  version: 1
  /** Made by the main process, never taken from the page: a page that could choose it could overwrite an earlier record. */
  id: string
  /** When the request began, in milliseconds since 1970. It decides which day and month the request counts in, and never changes. */
  at: number
  /** The conversation it belongs to, as the page said (it only decides which chat the cost is shown under), or null. */
  chat: string | null
  provider: ProviderId
  model: string
  /** The effort level the request asked for, or null for a model that takes none. */
  effort: Effort | null
  state: LedgerState
  /** True when the tokens are the app's own guess ("about"), not the provider's report. A real report replaces a guess (same id). */
  estimate: boolean
  tokens: TokenCounts
  /** The prices (US dollars per million tokens) the cost was worked out with. */
  prices: ModelPricing
  /** The hosted searches the provider billed for this request (11.6); absent for a request that had none. */
  search?: SearchFee
  /** (15.5) A clip of speech to text: absent for every other request. */
  audio?: AudioFee
  /** (16.2) A request for pictures: absent for every other request. */
  image?: ImageFee
}

/** What a reply used and cost, as the page is told when the reply ends (and the ledger has the same). */
export interface ReplyUsage {
  tokens: TokenCounts
  /** In US dollars, at the list prices. */
  costUsd: number
  /** True when the tokens are the app's guess ("about"), not the provider's report. */
  estimate: boolean
}

/** Several requests added up. */
export interface UsageTotals {
  costUsd: number
  tokens: TokenCounts
  /** How many requests were counted (a refused one is not). */
  requests: number
  /** True if any of them is a guess or still on its way, so the sum is "about". */
  about: boolean
}

/** What the page may be told about usage: three sums, and how many ledger lines could not be read. */
export interface UsageSummary {
  /** The conversation on screen; null when there is none to ask about. */
  chat: UsageTotals | null
  /** Since midnight on this computer's clock. */
  today: UsageTotals
  /** Since the first of this month, on this computer's clock. */
  month: UsageTotals
  /** Lines of the ledger that were skipped because they could not be read (their cost is not in the sums). */
  unreadable: number
  /** When the sums were made (milliseconds since 1970): the page says which day and month they are for. */
  at: number
}

/** What a request costs, in US dollars: each bucket at its own list price. */
export function costOf(tokens: TokenCounts, prices: ModelPricing): number {
  return (
    (tokens.input * prices.inputPerMTok +
      tokens.cacheRead * prices.cacheReadPerMTok +
      tokens.cacheWrite * prices.cacheWritePerMTok +
      tokens.output * prices.outputPerMTok) /
    1_000_000
  )
}

export const costOfRecord = (record: LedgerRecord): number =>
  costOf(record.tokens, record.prices) +
  (record.search === undefined ? 0 : record.search.count * record.search.usdEach) +
  (record.audio === undefined ? 0 : audioFeeUsd(record.audio)) +
  (record.image === undefined ? 0 : record.image.usd)

export const tokensAreEmpty = (tokens: TokenCounts): boolean =>
  tokens.input === 0 && tokens.cacheRead === 0 && tokens.cacheWrite === 0 && tokens.output === 0

// --- Guessing, when a provider gives no report (D-030) -----------------------------------------------------------------------
// Nothing here knows a provider's tokenizer, so the guess is made to be on the high side for ordinary text: one token for every
// three bytes of UTF-8. English runs near four characters to a token, so this over-counts it by a third; Chinese, Japanese and
// Korean text takes about one token a character, which is three bytes, so this is about right for them. It leaves out the
// thinking a model did and did not show (no way to see it), which is said wherever a guess is shown.

const BYTES_PER_TOKEN = 3
/** A little for the framing of each message (its role and separators). */
const TOKENS_PER_MESSAGE = 4

const encoder = new TextEncoder()
export const utf8Length = (text: string): number => encoder.encode(text).length

const tokensForBytes = (bytes: number): number => Math.ceil(bytes / BYTES_PER_TOKEN)

/**
 * A guess at the input tokens of a request: the system prompt and every message that is sent. A model's turn that asked for tools is sent back as the
 * provider's own record of it (12.7), which holds what the model asked FOR, such as the whole text of a proposed file: that record is counted, not only the
 * words the model said before it.
 */
export function estimateInputTokens(
  system: string,
  messages: readonly { content: string; toolTurn?: { record: unknown } }[]
): number {
  let bytes = utf8Length(system)
  for (const message of messages) {
    bytes += utf8Length(message.content)
    if (message.toolTurn !== undefined)
      bytes += utf8Length(JSON.stringify(message.toolTurn.record) ?? '')
  }
  return tokensForBytes(bytes) + TOKENS_PER_MESSAGE * messages.length
}

/** A guess at the output tokens of a reply, from the text that arrived. */
export const estimateOutputTokens = (arrivedBytes: number): number => tokensForBytes(arrivedBytes)

// --- Guessing what attached files send (Stage 9.4, D-037) ----------------------------------------------------------------------------
// A provider counts an image by its size in pixels and a PDF by its pages, not by their bytes, so the guess does the same, on the high side as
// above. An image: one token for every square of 28 x 28 pixels, and a quarter more (Anthropic's pages say about one token for every 750 pixels;
// OpenAI counts fewer); an image is sent at most 2000 px a side, so one is at most 6,480 tokens. A PDF page: 4,800 tokens (Anthropic bills each page
// as its text, 1,500 to 3,000 tokens, and as a picture of the page). A text file is text: one token for every three bytes. Each file adds a little
// for its framing (its title, or the line that names it). Every file is counted each time it is sent: the whole chat goes with every message (D-028).

const IMAGE_SQUARE_PX = 28
const IMAGE_MARGIN = 1.25
export const PDF_PAGE_TOKENS = 4_800
const TOKENS_PER_FILE = 16

/** A guess at the tokens of one image of this size. */
export const imageTokens = (width: number, height: number): number =>
  Math.ceil(Math.ceil(width / IMAGE_SQUARE_PX) * Math.ceil(height / IMAGE_SQUARE_PX) * IMAGE_MARGIN)

/** What the files of one request come to, as far as the guess needs (main's `RequestFiles`). */
export interface FilesToGuess {
  /** How many files the request sends (a file named on two messages counts twice). */
  count: number
  images: readonly { width: number; height: number }[]
  pdfPages: number
  /** The text files' UTF-8 bytes in all. */
  textBytes: number
}

/** A guess at the input tokens of the files of a request: images by their size, PDFs by their pages, text by its bytes, and each file's framing. */
export function estimateFileTokens(files: FilesToGuess): number {
  let tokens =
    files.pdfPages * PDF_PAGE_TOKENS +
    tokensForBytes(files.textBytes) +
    TOKENS_PER_FILE * files.count
  for (const image of files.images) tokens += imageTokens(image.width, image.height)
  return tokens
}

// --- Reading a ledger line ---------------------------------------------------------------------------------------------------

const MAX_TOKENS_PER_BUCKET = 1_000_000_000
const MAX_PRICE = 10_000
const isCount = (value: unknown): value is number =>
  typeof value === 'number' &&
  Number.isSafeInteger(value) &&
  value >= 0 &&
  value <= MAX_TOKENS_PER_BUCKET
const isPrice = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= MAX_PRICE
const isFields = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * Checks one ledger line that was read back from disk and returns a clean copy, or null if it cannot be used. Strict about every
 * field the sums depend on (a record that is half understood would count the wrong amount), and blind to fields it does not know,
 * so a later version of the app may add some. Whatever is written passes this, which `append` in the ledger checks.
 */
export function parseLedgerRecord(raw: unknown): LedgerRecord | null {
  if (!isFields(raw) || raw.version !== 1) return null
  const {
    id,
    at,
    chat,
    provider,
    model,
    effort,
    state,
    estimate,
    tokens,
    prices,
    search,
    audio,
    image
  } = raw
  if (!isConversationId(id)) return null // the one spelling of a uuid the app makes (the same shape as a conversation id)
  if (typeof at !== 'number' || !Number.isSafeInteger(at) || at < 0) return null
  if (chat !== null && !isConversationId(chat)) return null
  const knownProvider = SUPPORTED_PROVIDERS.find((candidate) => candidate === provider)
  if (knownProvider === undefined || !isModelId(model)) return null
  const knownEffort =
    effort === null ? null : (EFFORT_LEVELS.find((candidate) => candidate === effort) ?? undefined)
  if (knownEffort === undefined) return null
  const knownState = LEDGER_STATES.find((candidate) => candidate === state)
  if (knownState === undefined || typeof estimate !== 'boolean') return null
  if (!isFields(tokens) || !isFields(prices)) return null
  if (
    !isCount(tokens.input) ||
    !isCount(tokens.cacheRead) ||
    !isCount(tokens.cacheWrite) ||
    !isCount(tokens.output)
  ) {
    return null
  }
  if (
    !isPrice(prices.inputPerMTok) ||
    !isPrice(prices.cacheReadPerMTok) ||
    !isPrice(prices.cacheWritePerMTok) ||
    !isPrice(prices.outputPerMTok)
  ) {
    return null
  }
  // The searches (11.6): absent, or exactly a whole count and a fee; anything else makes the line unusable, as for the prices.
  let fee: SearchFee | undefined
  if (search !== undefined) {
    if (
      !isFields(search) ||
      !isCount(search.count) ||
      (search.count as number) > 20 ||
      !isPrice(search.usdEach) ||
      (search.usdEach as number) > 10
    ) {
      return null
    }
    fee = { count: search.count as number, usdEach: search.usdEach as number }
  }
  // The clip of speech (15.5): absent, or exactly its kind, whole seconds from 1 to an hour, and a price of a minute; anything else makes the line unusable.
  let clipFee: AudioFee | undefined
  if (audio !== undefined) {
    if (
      !isFields(audio) ||
      Object.keys(audio).sort().join() !== 'kind,seconds,usdPerMinute' ||
      audio.kind !== 'transcribe' ||
      !Number.isSafeInteger(audio.seconds) ||
      (audio.seconds as number) < 1 ||
      (audio.seconds as number) > 3600 ||
      !isPrice(audio.usdPerMinute) ||
      (audio.usdPerMinute as number) > 10
    ) {
      return null
    }
    clipFee = {
      kind: 'transcribe',
      seconds: audio.seconds as number,
      usdPerMinute: audio.usdPerMinute as number
    }
  }
  // The pictures (16.2): absent, or exactly their kind, a whole count from 1 to 10 and the dollars, from 0 to 100; anything else makes the line unusable.
  let pictureFee: ImageFee | undefined
  if (image !== undefined) {
    if (
      !isFields(image) ||
      Object.keys(image).sort().join() !== 'count,kind,usd' ||
      image.kind !== 'generate' ||
      !Number.isSafeInteger(image.count) ||
      (image.count as number) < 1 ||
      (image.count as number) > 10 ||
      !isPrice(image.usd) ||
      (image.usd as number) > 100
    ) {
      return null
    }
    pictureFee = { kind: 'generate', count: image.count as number, usd: image.usd as number }
  }
  return {
    version: 1,
    id,
    at,
    chat,
    provider: knownProvider,
    model,
    effort: knownEffort,
    state: knownState,
    estimate,
    tokens: {
      input: tokens.input,
      cacheRead: tokens.cacheRead,
      cacheWrite: tokens.cacheWrite,
      output: tokens.output
    },
    prices: {
      inputPerMTok: prices.inputPerMTok,
      cacheReadPerMTok: prices.cacheReadPerMTok,
      cacheWritePerMTok: prices.cacheWritePerMTok,
      outputPerMTok: prices.outputPerMTok
    },
    ...(fee === undefined ? {} : { search: fee }),
    ...(clipFee === undefined ? {} : { audio: clipFee }),
    ...(pictureFee === undefined ? {} : { image: pictureFee })
  }
}

/**
 * The line that goes to the file: the record, and its cost beside it for a person reading the file (`costUsd`; it is not read back,
 * the cost is always worked out again from the tokens and the prices, so a line cannot claim a different cost than its numbers give).
 */
export const ledgerLine = (record: LedgerRecord): string =>
  JSON.stringify({ ...record, costUsd: costOfRecord(record) })

// --- Adding up ---------------------------------------------------------------------------------------------------------------

export const emptyTotals = (): UsageTotals => ({
  costUsd: 0,
  tokens: { ...NO_TOKENS },
  requests: 0,
  about: false
})

/** Adds one record to a sum, in place. A refused request owes nothing and is not counted. */
export function addRecord(totals: UsageTotals, record: LedgerRecord): void {
  if (record.state === 'rejected') return
  totals.costUsd += costOfRecord(record)
  totals.tokens.input += record.tokens.input
  totals.tokens.cacheRead += record.tokens.cacheRead
  totals.tokens.cacheWrite += record.tokens.cacheWrite
  totals.tokens.output += record.tokens.output
  totals.requests += 1
  if (record.estimate || record.state === 'sent') totals.about = true
}

/** Midnight, on this computer's clock, at the start of the day `ms` falls in. */
export function startOfDay(ms: number): number {
  const date = new Date(ms)
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

/** Midnight at the start of the first of the month `ms` falls in, on this computer's clock. */
export function startOfMonth(ms: number): number {
  const date = new Date(ms)
  return new Date(date.getFullYear(), date.getMonth(), 1).getTime()
}

/** The sums the page shows: this chat (when one is named), today and this month, from the ledger's current records. */
export function summarize(
  records: Iterable<LedgerRecord>,
  chat: string | null,
  now: number,
  unreadable: number
): UsageSummary {
  const dayStart = startOfDay(now)
  const monthStart = startOfMonth(now)
  const today = emptyTotals()
  const month = emptyTotals()
  const inChat = chat === null ? null : emptyTotals()
  for (const record of records) {
    if (record.at >= monthStart) addRecord(month, record)
    if (record.at >= dayStart) addRecord(today, record)
    if (inChat !== null && record.chat === chat) addRecord(inChat, record)
  }
  return { chat: inChat, today, month, unreadable, at: now }
}
