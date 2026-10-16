import { VOICE_LIMITS, VOICE_WORDS } from '../shared/voice'

// What main will take as a recording (Stage 15.2, D-047). The window sends the bytes it recorded and how long the hold lasted; neither is trusted. A clip is a WebM
// file (what the window's recorder writes: 15.1) of at most 1 MiB, from a hold of at least a third of a second and at most a minute (and a little). Main cannot
// listen to it and does not decode it: the provider does. What main can do is stop a clip that is not what the window makes, and charge for the LONGER of what the
// page says and what the size allows, so a page cannot make a long recording cost like a short one. No Electron imports.

/** WebM starts with the EBML header: 1A 45 DF A3. */
const EBML = [0x1a, 0x45, 0xdf, 0xa3]
/** The header names its document type "webm" (the bytes 77 65 62 6D) in its first few dozen bytes. */
const DOCTYPE = [0x77, 0x65, 0x62, 0x6d]
/** A recording of Opus at the 128 kbit/s the window's recorder uses by default is 16 KB a second (15.1); the window asks for far less, so this is the high side. */
export const MAX_BYTES_PER_SECOND = 16_000

export type ClipCheck =
  | {
      ok: true
      /** The clip, as a Buffer of its own (a copy: nothing the page still holds can change it). */
      clip: Buffer
      /** The seconds it will be charged for: whole, at least 1, at most the longest hold. */
      seconds: number
    }
  | { ok: false; kind: 'short' | 'refused'; error: string }

const asBytes = (value: unknown): Uint8Array | null => {
  if (value instanceof Uint8Array) return value // a Buffer is one
  if (value instanceof ArrayBuffer) return new Uint8Array(value)
  return null
}

const hasAt = (bytes: Uint8Array, at: number, pattern: number[]): boolean =>
  pattern.every((b, i) => bytes[at + i] === b)

/** Whether the first bytes are those of a WebM file: the EBML mark, then the document type "webm" within the first 64 bytes. */
export function looksLikeWebm(bytes: Uint8Array): boolean {
  if (bytes.length < 16 || !hasAt(bytes, 0, EBML)) return false
  const end = Math.min(bytes.length - DOCTYPE.length, 64)
  for (let i = 4; i <= end; i++) if (hasAt(bytes, i, DOCTYPE)) return true
  return false
}

/**
 * Judges what the page sent for `voice.end`: `{ bytes, ms }`, where `ms` is how long the hold lasted by the page's clock. A hold under a third of a second is
 * `short` (nothing is sent, and the person is told to hold the button while they speak); anything that is not a WebM clip of a sensible size, or a duration that
 * is not a whole number in range, is `refused` with a sentence that says nothing about why.
 */
export function checkClip(input: unknown): ClipCheck {
  const refused = (): ClipCheck => ({ ok: false, kind: 'refused', error: VOICE_WORDS.notTheClip })
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return refused()
  const keys = Object.keys(input).sort().join()
  if (keys !== 'bytes,ms') return refused()
  const { bytes: given, ms } = input as { bytes: unknown; ms: unknown }
  const bytes = asBytes(given)
  if (bytes === null || bytes.length === 0 || bytes.length > VOICE_LIMITS.maxClipBytes) {
    return refused()
  }
  const longest = VOICE_LIMITS.maxClipSeconds * 1000 + VOICE_LIMITS.graceMs
  if (typeof ms !== 'number' || !Number.isInteger(ms) || ms < 0 || ms > longest) return refused()
  if (ms < VOICE_LIMITS.minClipMs) return { ok: false, kind: 'short', error: VOICE_WORDS.tooShort }
  if (!looksLikeWebm(bytes)) return refused()
  const seconds = Math.min(
    VOICE_LIMITS.maxClipSeconds,
    Math.max(1, Math.ceil(ms / 1000), Math.ceil(bytes.length / MAX_BYTES_PER_SECOND))
  )
  return { ok: true, clip: Buffer.from(bytes), seconds }
}

/**
 * The words the provider heard, made safe to put in the message box: text only; control characters and the characters that hide or reverse text are taken out
 * (a line break stays), runs of blank lines shortened, and at most 20,000 characters. Null when nothing is left.
 */
export function cleanTranscript(value: unknown): string | null {
  if (typeof value !== 'string') return null
  let out = ''
  for (const ch of value.replace(/\r\n?/g, '\n')) {
    const code = ch.codePointAt(0) as number
    if (ch === '\n' || ch === '\t') {
      out += ch === '\t' ? ' ' : ch
      continue
    }
    if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) continue
    if (code === 0x2028 || code === 0x2029) {
      out += '\n'
      continue
    }
    // zero-width characters, bidirectional marks and embeddings, the byte-order mark, and the tag characters: nothing a person said
    if (code >= 0x200b && code <= 0x200f) continue
    if (code >= 0x202a && code <= 0x202e) continue
    if (code >= 0x2060 && code <= 0x206f) continue
    if (code === 0xfeff || (code >= 0xe0000 && code <= 0xe007f)) continue
    out += ch
  }
  out = out
    .replace(/[ ]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  if (out.length > VOICE_LIMITS.maxTranscriptChars) {
    out = out.slice(0, VOICE_LIMITS.maxTranscriptChars)
    // do not leave half of a surrogate pair at the cut
    const last = out.charCodeAt(out.length - 1)
    if (last >= 0xd800 && last <= 0xdbff) out = out.slice(0, -1)
  }
  return out === '' ? null : out
}
