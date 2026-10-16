// Image generation (Stage 16, D-048): the part main and the window share. Plain types, constants, the reading of registry/images.json, the cost of a request and the
// check of what the page may ask. No Electron imports, nothing only Node has (the preload bundles this file).
//
// What the stage does, in one paragraph: a person writes a description in the "Make an image" dialog and chooses the shape, the quality, how many and the model; the dialog
// shows the most it can cost; main checks everything again, reserves that most against the spending limits, sends ONE request to OpenAI's Image API (Anthropic cannot make
// pictures), checks the bytes that come back and keeps the pictures in the gallery. Nothing else starts a picture: the model has no tool for it.

import { isConversationId, isModelId } from './ids'

/** The limits of image generation. Constants, not settings: a higher one is a change that lets the app spend more, and this stage has no box for it. */
export const IMAGE_LIMITS = Object.freeze({
  /** The longest description sent (the GPT image models take 32,000 characters; a description longer than this is not one a person typed into a dialog). */
  maxPromptChars: 4000,
  /** The most pictures one request asks for. */
  maxCount: 4,
  /** The most bytes one picture the app keeps may weigh (a PNG of 3840x2160 is a few MB). */
  maxPictureBytes: 12 * 1024 * 1024,
  /** The longest edge of a picture the app keeps, in pixels (the API's largest is 3840x2160). */
  maxEdge: 3840,
  /** The most pictures the gallery keeps. A full gallery refuses a new request; it never makes room by itself. */
  galleryMax: 500,
  /** The most the pictures folder may hold, in bytes. */
  folderMaxBytes: 2 * 1024 * 1024 * 1024,
  /** How long main waits for the provider, in milliseconds. */
  timeoutMs: 120_000,
  /** A request whose most is above this asks in the system's box first (the owner's pick: an ordinary few-cent picture does not ask). */
  askAboveUsd: 0.5,
  /** A model that retires within this many days is marked so; a retired one cannot be chosen. */
  retireWarnDays: 30,
  /** The longer edge of the small pictures in the gallery's grid, made in main. */
  thumbnailEdge: 256
})

/** The three shapes the dialog offers, and the size each is asked as (OpenAI's three ordinary sizes). */
export const IMAGE_SHAPES = Object.freeze({
  square: '1024x1024',
  portrait: '1024x1536',
  landscape: '1536x1024'
} as const)
export type ImageShape = keyof typeof IMAGE_SHAPES
export const SHAPE_NAMES: readonly ImageShape[] = Object.freeze(['square', 'portrait', 'landscape'])

/** The three qualities the dialog offers (Draft, Standard, High), as the API names them. */
export const QUALITY_NAMES = Object.freeze(['low', 'medium', 'high'] as const)
export type ImageQuality = (typeof QUALITY_NAMES)[number]
export const QUALITY_LABELS: Readonly<Record<ImageQuality, string>> = Object.freeze({
  low: 'Draft',
  medium: 'Standard',
  high: 'High'
})
export const SHAPE_LABELS: Readonly<Record<ImageShape, string>> = Object.freeze({
  square: 'Square',
  portrait: 'Portrait',
  landscape: 'Landscape'
})

export const isShape = (value: unknown): value is ImageShape =>
  typeof value === 'string' && (SHAPE_NAMES as readonly string[]).includes(value)
export const isQuality = (value: unknown): value is ImageQuality =>
  typeof value === 'string' && (QUALITY_NAMES as readonly string[]).includes(value)

// ---- registry/images.json -------------------------------------------------------------------------------------------------------

/** What a picture costs at most, in US dollars, for each shape and quality. */
export type PictureTable = Readonly<Record<ImageShape, Readonly<Record<ImageQuality, number>>>>

export interface ImageModelEntry {
  readonly id: string
  readonly label: string
  readonly description: string
  /** The day OpenAI shuts the model down ('YYYY-MM-DD'), or null when none is announced. */
  readonly retires: string | null
  /** True when the table is OpenAI's own; false when it is the app's ceiling (the token counts are not published), and the cost is shown as "about". */
  readonly published: boolean
  /** US dollars a million tokens, for the cost when the answer says what it used. */
  readonly prices: { readonly textInPerMTok: number; readonly imageOutPerMTok: number }
  readonly perPicture: PictureTable
}

export interface ImagesRegistry {
  readonly schemaVersion: '1'
  readonly updatedAt: string
  readonly source: string
  readonly defaultModelId: string
  readonly models: readonly ImageModelEntry[]
}

export type ImagesRegistryResult =
  { ok: true; registry: ImagesRegistry; problems: string[] } | { ok: false; error: string }

const MAX_MODELS = 12
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/

const isPlain = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const keysAre = (value: Record<string, unknown>, keys: string): boolean =>
  Object.keys(value).sort().join() === keys

/** A real calendar day written as 'YYYY-MM-DD'. */
export function isDay(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const m = DATE.exec(value)
  if (m === null) return false
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const date = new Date(Date.UTC(y, mo - 1, d))
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d
}

/** Visible text on one line: no control, hiding or reversing characters, no address or anything that looks like a key, 1 to `max` characters. */
function isLine(value: unknown, max: number): value is string {
  if (typeof value !== 'string' || value.length < 1 || value.length > max) return false
  if (value.trim() !== value) return false
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069\ufeff]/.test(value))
    return false
  return !/:\/\/|\bsk-[A-Za-z0-9]/.test(value)
}

const isPrice = (value: unknown, max: number): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= max

function readTable(raw: unknown): PictureTable | null {
  if (!isPlain(raw) || !keysAre(raw, 'landscape,portrait,square')) return null
  const out: Partial<Record<ImageShape, Record<ImageQuality, number>>> = {}
  for (const shape of SHAPE_NAMES) {
    const row = raw[shape]
    if (!isPlain(row) || !keysAre(row, 'high,low,medium')) return null
    for (const quality of QUALITY_NAMES) if (!isPrice(row[quality], 5)) return null
    if (!(
      (row.low as number) <= (row.medium as number) &&
      (row.medium as number) <= (row.high as number)
    ))
      return null
    out[shape] = Object.freeze({
      low: row.low as number,
      medium: row.medium as number,
      high: row.high as number
    })
  }
  return Object.freeze(out as Record<ImageShape, Record<ImageQuality, number>>)
}

function readModel(raw: unknown): ImageModelEntry | string {
  if (!isPlain(raw)) return 'a model is not an object'
  if (!keysAre(raw, 'description,id,label,perPicture,prices,published,retires')) {
    return 'a model does not have exactly the fields this app reads'
  }
  const { id, label, description, retires, published, prices, perPicture } = raw
  if (!isModelId(id) || !/^gpt-image-/.test(id)) return 'a model id is not an OpenAI image model'
  if (!isLine(label, 60)) return `the label of ${id} is not usable`
  if (!isLine(description, 300)) return `the description of ${id} is not usable`
  if (retires !== null && !isDay(retires)) return `the retirement day of ${id} is not a day`
  if (typeof published !== 'boolean') return `whether the prices of ${id} are published is not said`
  if (
    !isPlain(prices) ||
    !keysAre(prices, 'imageOutPerMTok,textInPerMTok') ||
    !isPrice(prices.textInPerMTok, 1000) ||
    !isPrice(prices.imageOutPerMTok, 1000)
  ) {
    return `the prices of ${id} are not usable`
  }
  const table = readTable(perPicture)
  if (table === null) return `the picture table of ${id} is not usable`
  return Object.freeze({
    id,
    label,
    description,
    retires,
    published,
    prices: Object.freeze({
      textInPerMTok: prices.textInPerMTok,
      imageOutPerMTok: prices.imageOutPerMTok
    }),
    perPicture: table
  })
}

/** Reads registry/images.json as strictly as models.json is read: anything this app did not write the way it reads it makes the whole file unusable. */
export function parseImagesRegistry(raw: unknown): ImagesRegistryResult {
  const fail = (error: string): ImagesRegistryResult => ({ ok: false, error })
  if (!isPlain(raw)) return fail('it is not an object')
  if (!keysAre(raw, 'defaultModelId,models,schemaVersion,source,updatedAt')) {
    return fail('it does not have exactly the fields this app reads')
  }
  if (raw.schemaVersion !== '1') return fail('its schemaVersion is not one this app reads')
  if (!isDay(raw.updatedAt)) return fail('its updatedAt is not a day')
  if (
    typeof raw.source !== 'string' ||
    raw.source.length < 1 ||
    raw.source.length > 600 ||
    /:\/\//.test(raw.source)
  ) {
    return fail('its source is not usable')
  }
  if (!Array.isArray(raw.models) || raw.models.length < 1 || raw.models.length > MAX_MODELS) {
    return fail(`it must list 1 to ${MAX_MODELS} models`)
  }
  const models: ImageModelEntry[] = []
  for (const one of raw.models) {
    const model = readModel(one)
    if (typeof model === 'string') return fail(model)
    if (models.some((there) => there.id === model.id))
      return fail(`the model ${model.id} is listed twice`)
    models.push(model)
  }
  const problems: string[] = []
  const fallback = models.find((model) => model.retires === null) ?? models[0]
  let defaultModelId = raw.defaultModelId
  if (typeof defaultModelId !== 'string' || !models.some((model) => model.id === defaultModelId)) {
    problems.push(`the default model is not in the list; ${fallback.id} is used`)
    defaultModelId = fallback.id
  }
  return {
    ok: true,
    problems,
    registry: Object.freeze({
      schemaVersion: '1',
      updatedAt: raw.updatedAt,
      source: raw.source,
      defaultModelId: defaultModelId as string,
      models: Object.freeze(models)
    })
  }
}

/** Today on this computer's clock, as 'YYYY-MM-DD'. */
export function dayOf(ms: number): string {
  const date = new Date(ms)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** Whole days from `from` to `to` (both 'YYYY-MM-DD'). */
const daysBetween = (from: string, to: string): number =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)

/** 'retired' from the day it retires on; 'retiring' within `retireWarnDays` before; else 'ok'. */
export function retirement(model: ImageModelEntry, now: number): 'ok' | 'retiring' | 'retired' {
  if (model.retires === null) return 'ok'
  const left = daysBetween(dayOf(now), model.retires)
  if (left <= 0) return 'retired'
  return left <= IMAGE_LIMITS.retireWarnDays ? 'retiring' : 'ok'
}

/** The sentences the log gets at start, one per model that retires soon or has retired. */
export function retirementWarnings(registry: ImagesRegistry, now: number): string[] {
  const out: string[] = []
  for (const model of registry.models) {
    const state = retirement(model, now)
    if (state === 'retired')
      out.push(
        `${model.label} (${model.id}) was retired by OpenAI on ${model.retires}; it cannot be chosen.`
      )
    else if (state === 'retiring')
      out.push(`${model.label} (${model.id}) is retired by OpenAI on ${model.retires}.`)
  }
  return out
}

// ---- cost ------------------------------------------------------------------------------------------------------------------------

/** The most a request can cost, in US dollars, from the model's table; `about` when the table is the app's ceiling and not OpenAI's. */
export function maximumCost(
  model: ImageModelEntry,
  shape: ImageShape,
  quality: ImageQuality,
  count: number
): { usd: number; about: boolean } {
  return { usd: model.perPicture[shape][quality] * count, about: !model.published }
}

/** What a request cost from the tokens the answer says it used: the words in at the text price, everything out at the image price. */
export const costFromTokens = (
  model: ImageModelEntry,
  tokens: { input: number; output: number }
): number =>
  (tokens.input * model.prices.textInPerMTok + tokens.output * model.prices.imageOutPerMTok) /
  1_000_000

// ---- what the page may ask ------------------------------------------------------------------------------------------------------

/** A request for pictures, as main has checked it. */
export interface ImageAsk {
  readonly prompt: string
  readonly model: ImageModelEntry
  readonly shape: ImageShape
  readonly size: string
  readonly quality: ImageQuality
  readonly count: number
  /** The chat it was asked from (only for the cost shown under that chat, and the gallery's note), or null. */
  readonly chat: string | null
}

/** The words of a description: text, 1 to `maxPromptChars` characters once trimmed, no control characters but line breaks and tabs, and not only spaces. */
export function isPrompt(value: unknown): value is string {
  if (typeof value !== 'string') return false
  if (value.trim() === '' || value.length > IMAGE_LIMITS.maxPromptChars) return false
  // eslint-disable-next-line no-control-regex
  return !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u2028\u2029\u202a-\u202e\u2066-\u2069]/.test(
    value
  )
}

/**
 * Checks what the page sends for a request: exactly `{ prompt, model, shape, quality, count, chat }`, the model one of the file's that has not retired. The description
 * is kept exactly as typed (no rewrite); a description that is not usable is refused, not cleaned.
 */
export function checkImageAsk(
  input: unknown,
  registry: ImagesRegistry,
  now: number
): { ok: true; ask: ImageAsk } | { ok: false; error: string } {
  const refuse = (error: string): { ok: false; error: string } => ({ ok: false, error })
  if (!isPlain(input) || !keysAre(input, 'chat,count,model,prompt,quality,shape')) {
    return refuse(IMAGE_WORDS.notUnderstood)
  }
  const { prompt, model, shape, quality, count, chat } = input
  if (!isPrompt(prompt)) {
    return refuse(
      typeof prompt === 'string' && prompt.length > IMAGE_LIMITS.maxPromptChars
        ? `The description is longer than ${IMAGE_LIMITS.maxPromptChars.toLocaleString('en-US')} characters.`
        : typeof prompt === 'string' && prompt.trim() === ''
          ? IMAGE_WORDS.noPrompt
          : IMAGE_WORDS.notUnderstood
    )
  }
  const entry = registry.models.find((one) => one.id === model)
  if (entry === undefined) return refuse(IMAGE_WORDS.notUnderstood)
  if (retirement(entry, now) === 'retired') {
    return refuse(`${entry.label} was retired by OpenAI on ${entry.retires} and cannot be used.`)
  }
  if (!isShape(shape) || !isQuality(quality)) return refuse(IMAGE_WORDS.notUnderstood)
  if (
    !Number.isInteger(count) ||
    (count as number) < 1 ||
    (count as number) > IMAGE_LIMITS.maxCount
  ) {
    return refuse(IMAGE_WORDS.notUnderstood)
  }
  if (chat !== null && !isConversationId(chat)) return refuse(IMAGE_WORDS.notUnderstood)
  return {
    ok: true,
    ask: Object.freeze({
      prompt,
      model: entry,
      shape,
      size: IMAGE_SHAPES[shape],
      quality,
      count: count as number,
      chat
    })
  }
}

// ---- a made picture in a chat (16.5) -----------------------------------------------------------------------------------------

const PICTURE_ID = /^[0-9a-f]{32}$/
/** A picture's id in the gallery: 32 hex characters, made by main at random. */
export const isPictureId = (value: unknown): value is string =>
  typeof value === 'string' && PICTURE_ID.test(value)

/**
 * What a chat keeps of a request for pictures (the owner's pick: an id into the gallery, never the picture). It rides on a message of the person's whose text is the
 * description; the message is shown, saved and backed up with the chat, and NEVER sent to the model (a picture is sent only when the person attaches it, "Use in chat").
 */
export interface PictureNote {
  /** The pictures in the gallery, 1 to `maxCount`. A picture that was deleted since is said to be, never looked for anywhere else. */
  readonly ids: readonly string[]
  readonly model: string
  readonly shape: ImageShape
  readonly quality: ImageQuality
  /** What the request cost (for all its pictures), and whether that is the app's figure. */
  readonly costUsd: number
  readonly estimate: boolean
}

/** A note as the page sends it or a file holds it: exactly these fields, checked; null otherwise. */
export function checkPictureNote(raw: unknown): PictureNote | null {
  if (!isPlain(raw) || !keysAre(raw, 'costUsd,estimate,ids,model,quality,shape')) return null
  const { ids, model, shape, quality, costUsd, estimate } = raw
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > IMAGE_LIMITS.maxCount) return null
  if (!ids.every(isPictureId) || new Set(ids).size !== ids.length) return null
  if (!isModelId(model) || !isShape(shape) || !isQuality(quality)) return null
  if (typeof costUsd !== 'number' || !Number.isFinite(costUsd) || costUsd < 0 || costUsd > 100)
    return null
  if (typeof estimate !== 'boolean') return null
  return Object.freeze({ ids: Object.freeze([...ids]), model, shape, quality, costUsd, estimate })
}

// ---- what the page is told ------------------------------------------------------------------------------------------------------

export interface ImageModelOption {
  readonly id: string
  readonly label: string
  readonly description: string
  readonly retires: string | null
  readonly state: 'ok' | 'retiring' | 'retired'
  readonly published: boolean
  readonly perPicture: PictureTable
}

/** What the page is told. Never a path, a key or an address. */
export interface ImageStatus {
  /** "Make images" is switched on (only after the person's yes in the system's box). */
  readonly on: boolean
  /** Why a picture cannot be asked for right now (switched off, no OpenAI key, no limits chosen, a file that cannot be read), as a sentence; null when it can. */
  readonly blocked: string | null
  /** The settings file could not be read: the switch is off and the sentence says why; null when it is fine. */
  readonly problem: string | null
  /** registry/images.json could not be used: no model can be chosen. */
  readonly registryError: string | null
  readonly models: readonly ImageModelOption[]
  readonly defaultModelId: string | null
  readonly askAboveUsd: number
  readonly maxCount: number
  readonly maxPromptChars: number
  /** How many pictures the gallery holds, and the most it keeps. */
  readonly pictures: number
  readonly galleryMax: number
}

export type ImageChangeResult = { ok: true; status: ImageStatus } | { ok: false; error: string }

/** What a request would cost at most, worked out by main from the file (the page's own figure is only shown). */
export type ImageEstimate =
  | {
      ok: true
      maxUsd: number
      about: boolean
      /** What may still be spent today and this month (null: no limit); the request is refused when it would not fit. */
      leftTodayUsd: number | null
      leftMonthUsd: number | null
      /** The system's box asks first (the most is above `askAboveUsd`). */
      asks: boolean
      /** Why it would be refused now, or null. */
      refusal: string | null
    }
  | { ok: false; error: string }

/** One picture as the page is shown it. */
export interface PictureSummary {
  readonly id: string
  readonly prompt: string
  readonly model: string
  readonly modelLabel: string
  readonly shape: ImageShape
  readonly quality: ImageQuality
  readonly width: number
  readonly height: number
  readonly at: number
  /** What the request it came from cost, shared out over its pictures. */
  readonly costUsd: number
  readonly estimate: boolean
  readonly chat: string | null
  /** A small picture for the grid, as data:, or null when it could not be made. */
  readonly thumbnail: string | null
  /** Why the picture cannot be shown (missing, damaged, sealed with a key that is gone), or absent. */
  readonly missing?: string
}

export type ImageGenerateResult =
  | { ok: true; pictures: PictureSummary[]; costUsd: number; estimate: boolean }
  /** `refused`: nothing was sent (switch, key, limits, a no in the box, a full gallery); `blocked`: OpenAI's safety system refused the description; `stopped`: Stop. */
  | { ok: false; kind: 'refused' | 'blocked' | 'failed' | 'stopped'; error: string }

export type PictureResult =
  { ok: true; dataUrl: string; summary: PictureSummary } | { ok: false; error: string }

/** The messages the window may send for images. Names only; nothing takes a path, a key, an address or a size that is not one of the three shapes. */
export const IMAGE_CHANNELS = Object.freeze({
  status: 'images:status',
  setOn: 'images:set-on',
  reset: 'images:reset',
  estimate: 'images:estimate',
  generate: 'images:generate',
  stop: 'images:stop',
  list: 'images:list',
  picture: 'images:picture',
  saveCopy: 'images:save-copy',
  remove: 'images:remove',
  useInChat: 'images:use-in-chat'
})

/** The sentences for the refusals the page shows. */
export const IMAGE_WORDS = Object.freeze({
  off: 'Making images is off. Switch it on in Settings, under Images.',
  noKey: 'Making images needs an OpenAI key. Save one in Settings.',
  noLimits: 'Choose your spending limits first (Settings, Spending limits).',
  noModels: 'No image model can be used: registry/images.json could not be read.',
  noPrompt: 'Write a description first.',
  notUnderstood: 'That request was not understood.',
  busy: 'A picture is being made already. Wait for it, or press Stop.',
  full: `The gallery is full (${IMAGE_LIMITS.galleryMax} pictures). Delete some to make room; nothing is deleted for you.`,
  notAsked: 'Nothing was sent.',
  stopped: 'Stopped. OpenAI may still bill the request.',
  failed: 'The picture could not be made.',
  notKept: 'The pictures that came back could not be used, so nothing was kept.',
  missing: 'This picture is no longer in the gallery.'
})
