// The model registry: the shape of registry/models.json, and the one function that turns whatever is in
// that file into a list the app can trust. Plain functions with no Electron imports, so they can be
// checked on their own.
//
// The file is edited by hand, so it is checked as strictly as input from the page (D-014): a typo should
// end in a clear message here, not in a wrong request to a paid API later. Every object must have
// exactly the fields listed below, so a misspelt field is an error and not a setting that is silently
// missing. It holds facts about models and one setting the app picks for each; it never holds an
// address or a credential, so nothing in it can change where the API key is sent.

import type { ModelOption } from './ipc'

/** The shape of registry/models.json that this version of the app reads. 0.6 (Stage 17.2, D-049): every entry has `priceChanges`, and Google is a provider. */
export const REGISTRY_SCHEMA_VERSION = '0.6'

/** The providers this version of the app can call. An entry for any other provider is left out. */
export const SUPPORTED_PROVIDERS = ['anthropic', 'openai', 'google'] as const
export type ProviderId = (typeof SUPPORTED_PROVIDERS)[number]

/** How each provider is named to the person. */
export const PROVIDER_NAMES: Record<ProviderId, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  google: 'Google'
}

/**
 * Every effort level the registry may name. Which of them a model accepts differs from model to model, and from
 * provider to provider (one has no "none", another no "minimal"), so each entry lists its own (`effortLevels`), and
 * each provider has the words it knows (below): a word the provider does not know is a typo, not a fact.
 */
export const EFFORT_LEVELS = ['none', 'low', 'medium', 'high', 'xhigh', 'max'] as const
export type Effort = (typeof EFFORT_LEVELS)[number]

/** The effort words each provider's API knows. */
export const PROVIDER_EFFORTS: Record<ProviderId, readonly Effort[]> = {
  anthropic: ['low', 'medium', 'high', 'xhigh', 'max'],
  openai: ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
  // (17.2, D-049) Gemini's thinking levels; "minimal" is not a word of this app's, and Gemini 3.8 Flash refuses it.
  google: ['low', 'medium', 'high']
}

/**
 * What a model can do, as facts from the provider's own documentation (D-019). The app acts on `promptCaching` and
 * `effortLevels` today; `imageInput` and `toolUse` are facts for the features that will need them (the chat is text only).
 */
export interface ModelCapabilities {
  /** It reads images. */
  imageInput: boolean
  /** It reads PDFs (each page as its text and as a picture). Since schema 0.5 (Stage 9.3, D-037): a PDF is not sent to a model that does not. */
  documentInput: boolean
  /** It can call functions the app offers it. */
  toolUse: boolean
  /**
   * It thinks by itself before it answers. That thinking is billed as output and counts against the reply's token
   * limit. (A model that thinks only when asked to is false: this app does not ask.)
   */
  reasoning: boolean
  /** It can reuse the start of a conversation it has already read, which the provider bills at a lower price. */
  promptCaching: boolean
  /** The effort levels its API accepts. Empty if it rejects the setting altogether. */
  effortLevels: Effort[]
}

/**
 * What a model costs, as list prices in US dollars per million tokens (D-030). Four, because a reply's tokens are billed in four
 * buckets (`Usage`, D-018): ordinary input, input read back from the provider's prompt cache, input written to it, and output
 * (which includes the thinking).
 */
export interface ModelPricing {
  inputPerMTok: number
  cacheReadPerMTok: number
  cacheWritePerMTok: number
  outputPerMTok: number
}

/**
 * (17.2, D-049) A change of a model's list prices that the provider has announced for a set day: from that day (on this computer's calendar) the request is
 * priced at `pricing`. Google's Gemini prices double on set days, and the app prices correctly after them by itself.
 */
export interface PriceChange {
  /** The first day of the new prices, written like 2026-12-01. */
  from: string
  pricing: ModelPricing
}

/** One model as the main process uses it: facts about the model, and the one setting the app picks for it. */
export interface ModelEntry {
  provider: ProviderId
  /** What the API calls it. Sent as the `model` of every request. */
  id: string
  /** For example "Claude Opus 5.5". */
  label: string
  description: string
  /** Tokens: how much conversation it can read at once. */
  contextWindow: number
  /** Tokens: the longest reply it can write. */
  maxOutputTokens: number
  /** List prices in US dollars per million tokens, until the first of `priceChanges` (if any). Use `pricesOn` for the prices of a given moment. */
  pricing: ModelPricing
  /** (17.2) Announced changes of price, oldest first, each on a later day than the one before. Empty for most models. */
  priceChanges: PriceChange[]
  capabilities: ModelCapabilities
  /**
   * The effort level to ask for: one of `capabilities.effortLevels`, written out because the default differs
   * between models. Null exactly when the model takes none (it would reject the setting).
   */
  effort: Effort | null
}

export interface Registry {
  /** When the facts and prices were last checked, as a date like "2026-10-01". */
  updatedAt: string
  /** Where they came from. */
  source: string
  /** Used until the person chooses another. Always one of `models`. */
  defaultModel: ModelEntry
  /** In the order to show them. */
  models: ModelEntry[]
}

export type RegistryResult =
  | {
      ok: true
      registry: Registry
      /** Entries that were left out, and why. Empty when the file is clean. */
      problems: string[]
    }
  | { ok: false; error: string; problems: string[] }

const MAX_MODELS = 50
/** (17.2) More announced changes than this for one model is a mistake in the file, not a price list. */
const MAX_PRICE_CHANGES = 10
export const MODEL_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/
const MAX_TOKEN_COUNT = 100_000_000
const MAX_PRICE = 10_000

type Fields = Record<string, unknown>

export function isFields(value: unknown): value is Fields {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export const quoted = (names: readonly string[]): string =>
  names.map((name) => JSON.stringify(name.slice(0, 40))).join(', ')

/**
 * What is wrong with the field names of `value`, or null if they are exactly `names`. A missing field and
 * an unknown one are both reported: a misspelt name is both at once ("effort" missing, "effrot" unknown),
 * and seeing the two together is what lets a person spot the typo.
 */
export function fieldProblem(value: Fields, names: readonly string[]): string | null {
  const present = Object.keys(value)
  const missing = names.filter((name) => !present.includes(name))
  const unknown = present.filter((name) => !names.includes(name))
  const parts: string[] = []
  if (missing.length > 0) {
    parts.push(`${missing.length > 1 ? 'fields' : 'field'} ${quoted(missing)} missing`)
  }
  if (unknown.length > 0) {
    parts.push(`unknown ${unknown.length > 1 ? 'fields' : 'field'} ${quoted(unknown)}`)
  }
  return parts.length > 0 ? parts.join('; ') : null
}

/** Text for the person to read: not empty, no padding, one line, and not unreasonably long. */
export function isText(value: unknown, maxLength: number): value is string {
  return (
    typeof value === 'string' &&
    value !== '' &&
    value === value.trim() &&
    value.length <= maxLength &&
    ![...value].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
  )
}

export function isCalendarDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00Z`)
  // 2026-02-30 must not pass as 2026-03-02.
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

const isProvider = (value: unknown): value is ProviderId =>
  SUPPORTED_PROVIDERS.some((provider) => provider === value)
const isEffort = (value: unknown): value is Effort => EFFORT_LEVELS.some((level) => level === value)
const isTokenCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= MAX_TOKEN_COUNT
const isPrice = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= MAX_PRICE

const ROOT_FIELDS = ['schemaVersion', 'updatedAt', 'source', 'defaultModelId', 'models'] as const
const ENTRY_FIELDS = [
  'provider',
  'id',
  'label',
  'description',
  'contextWindow',
  'maxOutputTokens',
  'pricing',
  'priceChanges',
  'capabilities',
  'effort'
] as const
const PRICE_CHANGE_FIELDS = ['from', 'pricing'] as const
const PRICING_FIELDS = [
  'inputPerMTok',
  'cacheReadPerMTok',
  'cacheWritePerMTok',
  'outputPerMTok'
] as const
const CAPABILITY_FLAGS = [
  'imageInput',
  'documentInput',
  'toolUse',
  'reasoning',
  'promptCaching'
] as const
const CAPABILITY_FIELDS = [...CAPABILITY_FLAGS, 'effortLevels'] as const

type EntryResult = { ok: true; entry: ModelEntry } | { ok: false; problem: string }
type PricingResult = { ok: true; pricing: ModelPricing } | { ok: false; problem: string }
type PriceChangesResult = { ok: true; changes: PriceChange[] } | { ok: false; problem: string }

/** Checks four list prices (`where` names them in the problem) and returns a clean copy. */
function parsePricing(pricing: unknown, where: string): PricingResult {
  const bad = (problem: string): PricingResult => ({ ok: false, problem })
  if (!isFields(pricing) || fieldProblem(pricing, PRICING_FIELDS) !== null) {
    return bad(`${where} must have exactly ${quoted(PRICING_FIELDS)}`)
  }
  const { inputPerMTok, cacheReadPerMTok, cacheWritePerMTok, outputPerMTok } = pricing
  if (
    !isPrice(inputPerMTok) ||
    !isPrice(cacheReadPerMTok) ||
    !isPrice(cacheWritePerMTok) ||
    !isPrice(outputPerMTok)
  ) {
    // (the words for the entry's own prices are those of before 17.2; a change's prices are named)
    return bad(
      `${where === 'pricing' ? '' : `${where}: `}the prices must be numbers from 0 to 10000 (US dollars per million tokens)`
    )
  }
  // Reading a token back from the cache is never dearer than reading it fresh; a price that says so is a typo, and it would be
  // counted into every reply's cost (D-030).
  if (cacheReadPerMTok > inputPerMTok) {
    return bad(`${where}.cacheReadPerMTok is more than ${where}.inputPerMTok`)
  }
  return { ok: true, pricing: { inputPerMTok, cacheReadPerMTok, cacheWritePerMTok, outputPerMTok } }
}

/** (17.2, D-049) Checks the announced changes of price of one entry: a list of `{ from, pricing }`, each a real day later than the one before. */
function parsePriceChanges(value: unknown): PriceChangesResult {
  const bad = (problem: string): PriceChangesResult => ({ ok: false, problem })
  if (!Array.isArray(value) || value.length > MAX_PRICE_CHANGES) {
    return bad(
      `priceChanges must be a list of at most ${MAX_PRICE_CHANGES} changes (empty for none)`
    )
  }
  const changes: PriceChange[] = []
  for (const [index, item] of (value as unknown[]).entries()) {
    const where = `priceChanges[${index}]`
    if (!isFields(item) || fieldProblem(item, PRICE_CHANGE_FIELDS) !== null) {
      return bad(`${where} must have exactly ${quoted(PRICE_CHANGE_FIELDS)}`)
    }
    if (!isCalendarDate(item['from']))
      return bad(`${where}.from must be a date written like 2026-12-01`)
    const from = item['from']
    const last = changes.at(-1)
    // In order and never twice for one day: the price of a day must be one price, and the file must read the way it is applied.
    if (last !== undefined && from <= last.from) {
      return bad(`${where}.from must be a later day than ${last.from}`)
    }
    const prices = parsePricing(item['pricing'], `${where}.pricing`)
    if (!prices.ok) return bad(prices.problem)
    changes.push({ from, pricing: prices.pricing })
  }
  return { ok: true, changes }
}

/** The calendar day of `at` (milliseconds since 1970) on this computer's clock, written like 2026-12-01: the day that decides a model's prices. */
export function localDay(at: number): string {
  const date = new Date(at)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/**
 * (17.2, D-049) The list prices of a model at the moment `at`: those of the last announced change whose day has come (on this computer's calendar), else its
 * own. A request is priced at the prices of the day it is sent; the ledger keeps them with its record, so a later change never alters what was spent.
 */
export function pricesOn(
  entry: Pick<ModelEntry, 'pricing' | 'priceChanges'>,
  at: number
): ModelPricing {
  const day = localDay(at)
  let prices = entry.pricing
  for (const change of entry.priceChanges) if (change.from <= day) prices = change.pricing
  return { ...prices }
}

/** The next announced change of a model's prices after the day of `at`, or null when none is coming. */
export function nextPriceChange(
  entry: Pick<ModelEntry, 'priceChanges'>,
  at: number
): PriceChange | null {
  const day = localDay(at)
  const next = entry.priceChanges.find((change) => change.from > day)
  return next === undefined ? null : { from: next.from, pricing: { ...next.pricing } }
}

/** The entry as it is priced at the moment `at` (`pricesOn`): what a request sent then is counted, limited and asked about with. */
export function pricedOn(entry: ModelEntry, at: number): ModelEntry {
  return { ...entry, pricing: pricesOn(entry, at) }
}
type CapabilitiesResult =
  { ok: true; capabilities: ModelCapabilities } | { ok: false; problem: string }

/** Checks the capabilities of one entry of `provider`, and returns a clean copy of them. */
function parseCapabilities(value: unknown, provider: ProviderId): CapabilitiesResult {
  const bad = (problem: string): CapabilitiesResult => ({ ok: false, problem })
  if (!isFields(value)) return bad('capabilities must be an object')
  if (fieldProblem(value, CAPABILITY_FIELDS) !== null) {
    return bad(`capabilities must have exactly ${quoted(CAPABILITY_FIELDS)}`)
  }
  for (const flag of CAPABILITY_FLAGS) {
    if (typeof value[flag] !== 'boolean') return bad(`capabilities.${flag} must be true or false`)
  }
  const { effortLevels } = value
  const known = PROVIDER_EFFORTS[provider]
  if (!Array.isArray(effortLevels) || effortLevels.length > known.length) {
    return bad(`capabilities.effortLevels must be a list of at most ${known.length} effort levels`)
  }
  const levels: Effort[] = []
  for (const level of effortLevels as unknown[]) {
    if (!isEffort(level) || !known.includes(level)) {
      return bad(
        `capabilities.effortLevels: ${quoted([String(level)])} is not an effort level ${provider} knows (${quoted(known)})`
      )
    }
    if (levels.includes(level))
      return bad(`capabilities.effortLevels names ${quoted([level])} twice`)
    levels.push(level)
  }
  return {
    ok: true,
    capabilities: {
      imageInput: value['imageInput'] as boolean,
      documentInput: value['documentInput'] as boolean,
      toolUse: value['toolUse'] as boolean,
      reasoning: value['reasoning'] as boolean,
      promptCaching: value['promptCaching'] as boolean,
      effortLevels: levels
    }
  }
}

/** Checks one entry and returns a clean copy of it: only the known fields, each of a known kind. */
function parseEntry(item: unknown): EntryResult {
  const bad = (problem: string): EntryResult => ({ ok: false, problem })
  if (!isFields(item)) return bad('is not an object')
  const fields = fieldProblem(item, ENTRY_FIELDS)
  if (fields) return bad(fields)

  const {
    provider,
    id,
    label,
    description,
    contextWindow,
    maxOutputTokens,
    pricing,
    priceChanges,
    capabilities,
    effort
  } = item
  if (!isProvider(provider)) {
    return bad(`provider ${quoted([String(provider)])} is not one this version of the app can call`)
  }
  if (typeof id !== 'string' || !MODEL_ID.test(id)) {
    return bad('id must be lower-case letters, digits, dots, hyphens or underscores (up to 64)')
  }
  if (!isText(label, 60)) return bad('label must be one line of text, up to 60 characters')
  if (!isText(description, 160)) {
    return bad('description must be one line of text, up to 160 characters')
  }
  if (!isTokenCount(contextWindow)) {
    return bad('contextWindow must be a whole number of tokens, greater than 0')
  }
  if (!isTokenCount(maxOutputTokens) || maxOutputTokens > contextWindow) {
    return bad(
      'maxOutputTokens must be a whole number of tokens, greater than 0 and at most contextWindow'
    )
  }
  const prices = parsePricing(pricing, 'pricing')
  if (!prices.ok) return bad(prices.problem)
  const changes = parsePriceChanges(priceChanges)
  if (!changes.ok) return bad(changes.problem)
  const parsed = parseCapabilities(capabilities, provider)
  if (!parsed.ok) return bad(parsed.problem)
  const { effortLevels } = parsed.capabilities

  // The effort the app asks for is explicit, never guessed (D-014): written out for a model that takes the setting, and
  // null for one that rejects it. It must be a level the model's own list names.
  if (effort !== null && !isEffort(effort)) {
    return bad(`effort must be one of ${quoted(EFFORT_LEVELS)} or null`)
  }
  if (effort === null && effortLevels.length > 0) {
    return bad(
      'effort is null, but capabilities.effortLevels is not empty: the level must be written out'
    )
  }
  if (effort !== null && effortLevels.length === 0) {
    return bad(
      'effort is set, but capabilities.effortLevels is empty: this model takes no effort setting'
    )
  }
  if (effort !== null && !effortLevels.includes(effort)) {
    return bad(`effort ${quoted([effort])} is not one of this model's capabilities.effortLevels`)
  }
  if (effortLevels.length > 0 && !parsed.capabilities.reasoning) {
    return bad('capabilities.effortLevels is not empty, but capabilities.reasoning is false')
  }

  return {
    ok: true,
    entry: {
      provider,
      id,
      label,
      description,
      contextWindow,
      maxOutputTokens,
      pricing: prices.pricing,
      priceChanges: changes.changes,
      capabilities: parsed.capabilities,
      effort
    }
  }
}

/**
 * Turns the contents of registry/models.json into a trusted list. A broken entry is left out and
 * reported in `problems`, so one typo does not take the other models away. A broken file as a whole
 * (the wrong version, no usable model, a default that is not usable) is refused with `error`: the
 * default is a decision about what the person is billed, so it is never guessed.
 */
export function parseRegistry(input: unknown): RegistryResult {
  const problems: string[] = []
  const fail = (error: string): RegistryResult => ({ ok: false, error, problems })

  if (!isFields(input)) return fail('the file does not hold a JSON object')
  const rootProblem = fieldProblem(input, ROOT_FIELDS)
  if (rootProblem) return fail(rootProblem)
  if (input.schemaVersion !== REGISTRY_SCHEMA_VERSION) {
    return fail(
      `schemaVersion is ${JSON.stringify(input.schemaVersion)}, but this version of the app reads ${REGISTRY_SCHEMA_VERSION}`
    )
  }
  const { updatedAt, source, defaultModelId, models } = input
  if (!isCalendarDate(updatedAt)) return fail('updatedAt must be a date written like 2026-10-01')
  if (!isText(source, 300))
    return fail('source must be one line of text saying where the facts came from')
  if (typeof defaultModelId !== 'string') return fail('defaultModelId must be text')
  if (!Array.isArray(models) || models.length === 0 || models.length > MAX_MODELS) {
    return fail(`models must be a list of 1 to ${MAX_MODELS} entries`)
  }

  const entries: ModelEntry[] = []
  models.forEach((item: unknown, index: number) => {
    const name =
      isFields(item) && typeof item.id === 'string'
        ? `models[${index}] (${JSON.stringify(item.id.slice(0, 64))})`
        : `models[${index}]`
    const result = parseEntry(item)
    if (!result.ok) {
      problems.push(`${name}: ${result.problem}`)
    } else if (entries.some((entry) => entry.id === result.entry.id)) {
      // Ids are unique across providers, not just within one: the chosen model is saved as its id alone (D-015).
      problems.push(`${name}: this id is already used by an earlier entry`)
    } else {
      entries.push(result.entry)
    }
  })

  if (entries.length === 0) return fail('none of the entries in models is usable')
  const defaultModel = entries.find((entry) => entry.id === defaultModelId)
  if (!defaultModel) {
    return fail(
      `defaultModelId ${JSON.stringify(defaultModelId.slice(0, 64))} is not one of the usable models`
    )
  }
  return { ok: true, registry: { updatedAt, source, defaultModel, models: entries }, problems }
}

/**
 * What the page is told about a model: what to show, never how it is called (no effort, no limits). The prices are today's (17.2), with the next announced
 * change, if one is coming, so that Settings can say it ("from 1 December 2026: ...").
 */
export function toModelOption(entry: ModelEntry, at: number = Date.now()): ModelOption {
  return {
    id: entry.id,
    label: entry.label,
    provider: entry.provider,
    description: entry.description,
    contextWindow: entry.contextWindow,
    pricing: pricesOn(entry, at),
    priceChange: nextPriceChange(entry, at),
    imageInput: entry.capabilities.imageInput,
    documentInput: entry.capabilities.documentInput
  }
}
