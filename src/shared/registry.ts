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
export const REGISTRY_SCHEMA_VERSION = '0.3'

/** The providers this version of the app can call. An entry for any other provider is left out. */
export const SUPPORTED_PROVIDERS = ['anthropic', 'openai'] as const
export type ProviderId = (typeof SUPPORTED_PROVIDERS)[number]

/** How each provider is named to the person. */
export const PROVIDER_NAMES: Record<ProviderId, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI'
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
  openai: ['none', 'low', 'medium', 'high', 'xhigh', 'max']
}

/**
 * What a model can do, as facts from the provider's own documentation (D-019). The app acts on `promptCaching` and
 * `effortLevels` today; `imageInput` and `toolUse` are facts for the features that will need them (the chat is text only).
 */
export interface ModelCapabilities {
  /** It reads images. */
  imageInput: boolean
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
const MODEL_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/
const MAX_TOKEN_COUNT = 100_000_000
const MAX_PRICE = 10_000

type Fields = Record<string, unknown>

function isFields(value: unknown): value is Fields {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const quoted = (names: readonly string[]): string =>
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
  'capabilities',
  'effort'
] as const
const PRICING_FIELDS = ['inputPerMTok', 'outputPerMTok'] as const
const CAPABILITY_FLAGS = ['imageInput', 'toolUse', 'reasoning', 'promptCaching'] as const
const CAPABILITY_FIELDS = [...CAPABILITY_FLAGS, 'effortLevels'] as const

type EntryResult = { ok: true; entry: ModelEntry } | { ok: false; problem: string }
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
  if (!isFields(pricing) || fieldProblem(pricing, PRICING_FIELDS) !== null) {
    return bad('pricing must have exactly inputPerMTok and outputPerMTok')
  }
  const { inputPerMTok, outputPerMTok } = pricing
  if (!isPrice(inputPerMTok) || !isPrice(outputPerMTok)) {
    return bad('the prices must be numbers from 0 to 10000 (US dollars per million tokens)')
  }
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
      pricing: { inputPerMTok, outputPerMTok },
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

/** What the page is told about a model: what to show, never how it is called (no effort, no limits). */
export function toModelOption(entry: ModelEntry): ModelOption {
  return {
    id: entry.id,
    label: entry.label,
    provider: entry.provider,
    description: entry.description,
    contextWindow: entry.contextWindow,
    pricing: { ...entry.pricing }
  }
}
