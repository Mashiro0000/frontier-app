import {
  IMAGE_LIMITS,
  isPrompt,
  isQuality,
  isShape,
  type ImageQuality,
  type ImageShape
} from '../shared/images'
import { isConversationId, isModelId } from '../shared/validate'
import type { WriteMode } from './chatFile'
import type { SecretBox } from './credentialStore'
import { createKeptFile, type KeptFile } from './keptFile'
import type { PictureType } from './imageCheck'

// The gallery's index (Stage 16.2, D-048): images.json in the data folder, one line per picture the app keeps. The pictures themselves are files in `images/`, named by
// the random id here (never by the description or by anything the provider sent); imageStore.ts writes them. The index is kept like the person's other documents
// (keptFile.ts: written like a chat, sealed like the chats, a damaged file never written over unless the person starts again), and read as strictly: anything that is not
// exactly what this app writes makes the whole file unreadable (the gallery then says so and shows nothing; it is not mended by guessing). No Electron imports.

export const IMAGE_INDEX_VERSION = 1
/** The most the file may weigh: the largest gallery of the longest descriptions, with room. */
const MAX_FILE_BYTES = 6 * 1024 * 1024
const PICTURE_ID = /^[0-9a-f]{32}$/
const SHA256 = /^[0-9a-f]{64}$/
const TYPES: readonly string[] = ['image/png', 'image/jpeg', 'image/webp']

export const isPictureId = (value: unknown): value is string =>
  typeof value === 'string' && PICTURE_ID.test(value)

/** One picture the gallery holds. */
export interface PictureRecord {
  readonly id: string
  /** The description exactly as the person typed it. */
  readonly prompt: string
  readonly model: string
  readonly shape: ImageShape
  readonly quality: ImageQuality
  readonly type: PictureType
  readonly width: number
  readonly height: number
  /** The size of the picture's own bytes, and their SHA-256 (a copy that does not match is damaged). */
  readonly bytes: number
  readonly sha256: string
  /** When it was made, in milliseconds since 1970. */
  readonly at: number
  /** Its share of what the request cost, in US dollars. */
  readonly costUsd: number
  /** True when that cost is the app's figure and not the provider's report. */
  readonly estimate: boolean
  /** The chat it was asked from, or null. */
  readonly chat: string | null
}

export interface ImageIndex {
  readonly pictures: readonly PictureRecord[]
}

export const EMPTY_INDEX: ImageIndex = Object.freeze({ pictures: Object.freeze([]) })

const RECORD_KEYS =
  'at,bytes,chat,costUsd,estimate,height,id,model,prompt,quality,sha256,shape,type,width'

const isEdge = (value: unknown): value is number =>
  typeof value === 'number' &&
  Number.isInteger(value) &&
  value >= 1 &&
  value <= IMAGE_LIMITS.maxEdge

/** One record as the file holds it, checked, or null. */
export function parsePictureRecord(raw: unknown): PictureRecord | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>
  if (Object.keys(r).sort().join() !== RECORD_KEYS) return null
  if (!isPictureId(r.id) || !isPrompt(r.prompt) || !isModelId(r.model)) return null
  if (!isShape(r.shape) || !isQuality(r.quality)) return null
  if (typeof r.type !== 'string' || !TYPES.includes(r.type)) return null
  if (!isEdge(r.width) || !isEdge(r.height)) return null
  if (
    !Number.isSafeInteger(r.bytes) ||
    (r.bytes as number) < 8 ||
    (r.bytes as number) > IMAGE_LIMITS.maxPictureBytes
  )
    return null
  if (typeof r.sha256 !== 'string' || !SHA256.test(r.sha256)) return null
  if (!Number.isSafeInteger(r.at) || (r.at as number) < 0) return null
  if (
    typeof r.costUsd !== 'number' ||
    !Number.isFinite(r.costUsd) ||
    r.costUsd < 0 ||
    r.costUsd > 100
  )
    return null
  if (typeof r.estimate !== 'boolean') return null
  if (r.chat !== null && !isConversationId(r.chat)) return null
  return Object.freeze({
    id: r.id,
    prompt: r.prompt,
    model: r.model,
    shape: r.shape,
    quality: r.quality,
    type: r.type as PictureType,
    width: r.width,
    height: r.height,
    bytes: r.bytes as number,
    sha256: r.sha256,
    at: r.at as number,
    costUsd: r.costUsd,
    estimate: r.estimate,
    chat: r.chat
  })
}

/** The file's own text. The fields in a fixed order, so the same gallery is always the same text. */
export const imageIndexText = (index: ImageIndex): string =>
  JSON.stringify({
    version: IMAGE_INDEX_VERSION,
    pictures: index.pictures.map((p) => ({
      id: p.id,
      prompt: p.prompt,
      model: p.model,
      shape: p.shape,
      quality: p.quality,
      type: p.type,
      width: p.width,
      height: p.height,
      bytes: p.bytes,
      sha256: p.sha256,
      at: p.at,
      costUsd: p.costUsd,
      estimate: p.estimate,
      chat: p.chat
    }))
  })

/** The index in a file's text, or null when it is not exactly what this app writes (a field more or less, an id used twice, more than the gallery keeps). */
export function parseImageIndex(content: string): ImageIndex | null {
  let raw: unknown
  try {
    raw = JSON.parse(content)
  } catch {
    return null
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const file = raw as Record<string, unknown>
  if (
    Object.keys(file).sort().join() !== 'pictures,version' ||
    file.version !== IMAGE_INDEX_VERSION
  )
    return null
  if (!Array.isArray(file.pictures) || file.pictures.length > IMAGE_LIMITS.galleryMax) return null
  const pictures: PictureRecord[] = []
  const ids = new Set<string>()
  for (const one of file.pictures) {
    const record = parsePictureRecord(one)
    if (record === null || ids.has(record.id)) return null
    ids.add(record.id)
    pictures.push(record)
  }
  return Object.freeze({ pictures: Object.freeze(pictures) })
}

export function createImageIndexFile(options: {
  pathOf: () => string
  box?: SecretBox
  writeMode: () => Promise<WriteMode>
  now?: () => number
}): KeptFile<ImageIndex> {
  return createKeptFile<ImageIndex>({
    pathOf: options.pathOf,
    name: 'the list of your pictures',
    parse: parseImageIndex,
    text: imageIndexText,
    maxBytes: MAX_FILE_BYTES,
    box: options.box,
    writeMode: options.writeMode,
    now: options.now
  })
}
