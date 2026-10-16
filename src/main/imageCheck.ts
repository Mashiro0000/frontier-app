import { IMAGE_LIMITS } from '../shared/images'
import { imageHeader, sniff } from './attachmentFormats'

// What main takes as a picture from the provider (Stage 16.2, D-048). 16.1 showed that the SDK checks nothing in the answer (a text in place of a picture, the wrong count,
// an address in place of base64 all pass), so everything is checked here, before anything is kept or shown: the answer's pictures are exactly as many as were asked for;
// each is base64 and nothing else (an address is never fetched); the bytes are a PNG, a JPEG or a WebP by their header (not by any name), still, whole enough for the header
// to give a size, at most `maxPictureBytes` and `maxEdge` pixels an edge. Nothing is decoded here (the header is read, as attachmentFormats.ts does for an attachment).
// No Electron imports.

export type PictureType = 'image/png' | 'image/jpeg' | 'image/webp'

export interface CheckedPicture {
  readonly bytes: Buffer
  readonly type: PictureType
  readonly width: number
  readonly height: number
}

export type PicturesCheck = { ok: true; pictures: CheckedPicture[] } | { ok: false; why: string }

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/
/** The most base64 text of one picture that is decoded at all: the largest picture, as base64. */
export const MAX_BASE64_CHARS = Math.ceil(IMAGE_LIMITS.maxPictureBytes / 3) * 4
const KEPT_TYPES: readonly string[] = ['image/png', 'image/jpeg', 'image/webp']

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** One picture's bytes, checked. `why` is a fragment ("it is not a picture"). */
export function checkPictureBytes(
  bytes: Buffer
): { ok: true; picture: CheckedPicture } | { ok: false; why: string } {
  if (bytes.length < 8) return { ok: false, why: 'it is empty or cut off' }
  if (bytes.length > IMAGE_LIMITS.maxPictureBytes) {
    return {
      ok: false,
      why: `it is larger than ${IMAGE_LIMITS.maxPictureBytes / (1024 * 1024)} MB`
    }
  }
  const type = sniff(bytes)
  if (type === null || !KEPT_TYPES.includes(type)) {
    return { ok: false, why: 'it is not a PNG, JPEG or WebP picture' }
  }
  const header = imageHeader(bytes, type as PictureType)
  if (!header.ok) return { ok: false, why: header.why }
  if (header.animated) return { ok: false, why: 'it is animated' }
  if (header.width > IMAGE_LIMITS.maxEdge || header.height > IMAGE_LIMITS.maxEdge) {
    return { ok: false, why: `it is larger than ${IMAGE_LIMITS.maxEdge} pixels on an edge` }
  }
  return {
    ok: true,
    picture: Object.freeze({
      bytes,
      type: type as PictureType,
      width: header.width,
      height: header.height
    })
  }
}

/** The pictures of an answer's `data`, checked against the count that was asked for. All or nothing: one bad picture refuses them all. */
export function checkAnswerPictures(data: unknown, count: number): PicturesCheck {
  if (!Array.isArray(data)) return { ok: false, why: 'the answer held no pictures' }
  if (data.length !== count) {
    return {
      ok: false,
      why: `${data.length} ${data.length === 1 ? 'picture' : 'pictures'} came back for ${count} asked for`
    }
  }
  const pictures: CheckedPicture[] = []
  for (const item of data) {
    if (!isRecord(item) || typeof item.b64_json !== 'string' || item.url !== undefined) {
      return { ok: false, why: 'a picture came as an address or not at all (only base64 is taken)' }
    }
    const text = item.b64_json
    if (text.length > MAX_BASE64_CHARS + 4) {
      return {
        ok: false,
        why: `a picture is larger than ${IMAGE_LIMITS.maxPictureBytes / (1024 * 1024)} MB`
      }
    }
    if (text.length % 4 !== 0 || !BASE64.test(text))
      return { ok: false, why: 'a picture is not base64' }
    const bytes = Buffer.from(text, 'base64')
    if (bytes.toString('base64') !== text) return { ok: false, why: 'a picture is not base64' }
    const checked = checkPictureBytes(bytes)
    if (!checked.ok) return { ok: false, why: `a picture was refused: ${checked.why}` }
    pictures.push(checked.picture)
  }
  return { ok: true, pictures }
}
