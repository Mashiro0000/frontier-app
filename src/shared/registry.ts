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

/** The shape of registry/models.json that this version of the app reads. */
export const REGISTRY_SCHEMA_VERSION = '0.2'

/** The providers this version of the app can call. An entry for any other provider is left out. */
export const SUPPORTED_PROVIDERS = ['anthropic'] as const
export type ProviderId = (typeof SUPPORTED_PROVIDERS)[number]

/** How each provider is named to the person. */
export const PROVIDER_NAMES: Record<ProviderId, string> = { anthropic: 'Anthropic' }

/**
 * The effort levels the registry may name. The models that take the setting differ in which of the
 * higher levels they accept, but every one of them accepts these three.
 */
export const EFFORT_LEVELS = ['low', 'medium', 'high'] as const
export type Effort = (typeof EFFORT_LEVELS)[number]

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
  /** List price in US dollars per million tokens. */
  pricing: { inputPerMTok: number; outputPerMTok: number }
  /** The effort level to ask for, or null if the model does not take the setting (it would reject it). */
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
const MODEL_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/
const MAX_TOKEN_COUNT = 100_000_000
const MAX_PRICE = 10_000

type Fields = Record<string, unknown>

function isFields(value: unknown): value is Fields {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const quoted = (names: string[]): string =>
  names.map((name) => JSON.stringify(name.slice(0, 40))).join(', ')

/**
 * What is wrong with the field names of `value`, or null if they are exactly `names`. A missing field and
 * an unknown one are both reported: a misspelt name is both at once ("effort" missing, "effrot" unknown),
 * and seeing the two together is what lets a person spot the typo.
 */
function fieldProblem(value: Fields, names: readonly string[]): string | null {
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
function isText(value: unknown, maxLength: number): value is string {
  return (
    typeof value === 'string' &&
    value !== '' &&
    value === value.trim() &&
    value.length <= maxLength &&
    ![...value].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
  )
}

function isCalendarDate(value: unknown): value is string {
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
  'effort'
] as const
const PRICING_FIELDS = ['inputPerMTok', 'outputPerMTok'] as const

type EntryResult = { ok: true; entry: ModelEntry } | { ok: false; problem: string }

/** Checks one entry and returns a clean copy of it: only the known fields, each of a known kind. */
function parseEntry(item: unknown): EntryResult {
  const bad = (problem: string): EntryResult => ({ ok: false, problem })
  if (!isFields(item)) return bad('is not an object')
  const fields = fieldProblem(item, ENTRY_FIELDS)
  if (fields) return bad(fields)

  const { provider, id, label, description, contextWindow, maxOutputTokens, pricing, effort } = item
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
  if (!isFields(pricing) || fieldProblem(pricing, PRICING_FIELDS) !== null) {
    return bad('pricing must have exactly inputPerMTok and outputPerMTok')
  }
  const { inputPerMTok, outputPerMTok } = pricing
  if (!isPrice(inputPerMTok) || !isPrice(outputPerMTok)) {
    return bad('the prices must be numbers from 0 to 10000 (US dollars per million tokens)')
  }
  if (effort !== null && !isEffort(effort)) {
    return bad(`effort must be ${EFFORT_LEVELS.map((level) => `"${level}"`).join(', ')} or null`)
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
      pricing: { inputPerMTok, outputPerMTok },
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

/** What the page is told about a model: what to show, never how it is called (no effort, no limits). */
export function toModelOption(entry: ModelEntry): ModelOption {
  return {
    id: entry.id,
    label: entry.label,
    provider: PROVIDER_NAMES[entry.provider],
    description: entry.description,
    contextWindow: entry.contextWindow,
    pricing: { ...entry.pricing }
  }
}
