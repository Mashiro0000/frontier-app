import { inflateSync } from 'zlib'
import { ATTACHMENT_LIMITS } from '../shared/attachments'

// What a file IS, from its bytes (Stage 9.1, D-037): the first bytes, an image's header read before anything decodes it, the metadata taken out of an
// image by rewriting its bytes, a PDF's pages, and whether a text is text. Plain functions on a Buffer: no files, no Electron, no package (D-037: a
// package for any of this would be a new dependency). Every reader is bounded by the buffer it is given and answers a result, never an exception, for
// bytes that are not what they claim: a file is untrusted (rule 2), and a crafted one must cost no more than its own length to refuse.

export type ImageMediaType = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/** The type the first bytes say, or null. A file that is none of the binary types may still be text: `checkText` decides that. */
export function sniff(bytes: Buffer): ImageMediaType | 'application/pdf' | null {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(PNG_SIGNATURE)) return 'image/png'
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return 'image/jpeg'
  const head = bytes.subarray(0, 12).toString('latin1')
  if (head.startsWith('GIF87a') || head.startsWith('GIF89a')) return 'image/gif'
  if (head.startsWith('RIFF') && head.slice(8, 12) === 'WEBP') return 'image/webp'
  if (head.startsWith('%PDF-')) return 'application/pdf'
  return null
}

/** What an image's header says. `orientation` is the EXIF orientation (1 to 8) when the file carries one, else 1. */
export interface ImageFacts {
  width: number
  height: number
  animated: boolean
  orientation: number
}

export type HeaderResult = ({ ok: true } & ImageFacts) | { ok: false; why: string }

const NOT_IMAGE = (what: string): HeaderResult => ({
  ok: false,
  why: `it is not a whole ${what} image`
})

/** The orientation an EXIF (TIFF) block records, or 1. Never reads outside `tiff`. */
export function exifOrientation(tiff: Buffer): number {
  if (tiff.length >= 6 && tiff.subarray(0, 6).toString('latin1') === 'Exif\0\0')
    tiff = tiff.subarray(6)
  if (tiff.length < 8) return 1
  const order = tiff.subarray(0, 2).toString('latin1')
  if (order !== 'II' && order !== 'MM') return 1
  const little = order === 'II'
  const u16 = (at: number): number => (little ? tiff.readUInt16LE(at) : tiff.readUInt16BE(at))
  const u32 = (at: number): number => (little ? tiff.readUInt32LE(at) : tiff.readUInt32BE(at))
  if (u16(2) !== 42) return 1
  const ifd = u32(4)
  if (ifd + 2 > tiff.length) return 1
  const count = u16(ifd)
  for (let i = 0; i < count; i++) {
    const entry = ifd + 2 + i * 12
    if (entry + 12 > tiff.length) return 1
    if (u16(entry) === 0x0112 && u16(entry + 2) === 3 && u32(entry + 4) === 1) {
      const value = u16(entry + 8)
      return value >= 1 && value <= 8 ? value : 1
    }
  }
  return 1
}

// ---------------------------------------------------------------- PNG

interface PngChunk {
  type: string
  start: number // where the chunk begins (its length field)
  end: number // just after its CRC
  data: Buffer
}

function pngChunks(bytes: Buffer): PngChunk[] | null {
  const chunks: PngChunk[] = []
  let at = 8
  while (at + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(at)
    if (length > 0x7fffffff || at + 12 + length > bytes.length) return null
    const type = bytes.subarray(at + 4, at + 8).toString('latin1')
    if (!/^[A-Za-z]{4}$/.test(type)) return null
    chunks.push({
      type,
      start: at,
      end: at + 12 + length,
      data: bytes.subarray(at + 8, at + 8 + length)
    })
    at += 12 + length
    if (type === 'IEND') return chunks
  }
  return null // no IEND: cut off
}

function pngHeader(bytes: Buffer): HeaderResult {
  const chunks = pngChunks(bytes)
  if (chunks === null || chunks[0]?.type !== 'IHDR' || chunks[0].data.length !== 13)
    return NOT_IMAGE('PNG')
  if (!chunks.some((chunk) => chunk.type === 'IDAT')) return NOT_IMAGE('PNG')
  const width = chunks[0].data.readUInt32BE(0)
  const height = chunks[0].data.readUInt32BE(4)
  const exif = chunks.find((chunk) => chunk.type === 'eXIf')
  return {
    ok: true,
    width,
    height,
    animated: chunks.some((chunk) => chunk.type === 'acTL'),
    orientation: exif ? exifOrientation(exif.data) : 1
  }
}

/** The chunks a PNG keeps: what draws the picture and its colours. Everything else (text, XMP, EXIF, times, private chunks, animation) is taken out. */
const PNG_KEEP = new Set([
  'IHDR',
  'PLTE',
  'IDAT',
  'IEND',
  'tRNS',
  'gAMA',
  'cHRM',
  'sRGB',
  'iCCP',
  'sBIT',
  'bKGD',
  'pHYs',
  'cICP'
])

function stripPng(bytes: Buffer): { bytes: Buffer; removed: boolean } {
  const chunks = pngChunks(bytes)
  if (chunks === null) return { bytes, removed: false }
  const kept = chunks.filter((chunk) => PNG_KEEP.has(chunk.type))
  if (kept.length === chunks.length)
    return { bytes: bytes.subarray(0, chunks.at(-1)!.end), removed: false }
  return {
    bytes: Buffer.concat([
      PNG_SIGNATURE,
      ...kept.map((chunk) => bytes.subarray(chunk.start, chunk.end))
    ]),
    removed: true
  }
}

// ---------------------------------------------------------------- JPEG

interface JpegSegment {
  marker: number
  start: number // the 0xFF of the marker
  end: number // just after the segment (for SOS: after its entropy-coded data)
  payload: Buffer // the segment's data after its length field (for SOS: the scan header only)
}

const STANDALONE = (marker: number): boolean =>
  (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01
const isSof = (marker: number): boolean =>
  marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc

/** The segments of a JPEG, up to and including EOI, or null if it is not one or is cut off. What follows EOI is not part of the picture. */
function jpegSegments(bytes: Buffer): JpegSegment[] | null {
  const segments: JpegSegment[] = []
  let at = 2
  while (at < bytes.length) {
    if (bytes[at] !== 0xff) return null
    let start = at
    while (at < bytes.length && bytes[at] === 0xff) at += 1 // fill bytes
    if (at >= bytes.length) return null
    const marker = bytes[at]
    start = at - 1
    at += 1
    if (marker === 0xd9) {
      segments.push({ marker, start, end: at, payload: Buffer.alloc(0) })
      return segments
    }
    if (marker === 0xd8 || marker === 0x00) return null
    if (STANDALONE(marker)) {
      segments.push({ marker, start, end: at, payload: Buffer.alloc(0) })
      continue
    }
    if (at + 2 > bytes.length) return null
    const length = bytes.readUInt16BE(at)
    if (length < 2 || at + length > bytes.length) return null
    const payload = bytes.subarray(at + 2, at + length)
    at += length
    if (marker === 0xda) {
      // The entropy-coded data runs to the next marker that is not a stuffed zero, a restart marker or a fill byte.
      while (at < bytes.length) {
        if (bytes[at] === 0xff && at + 1 < bytes.length) {
          const next = bytes[at + 1]
          if (next === 0x00 || (next >= 0xd0 && next <= 0xd7)) {
            at += 2
            continue
          }
          if (next === 0xff) {
            at += 1
            continue
          }
          break
        }
        at += 1
      }
    }
    segments.push({ marker, start, end: at, payload })
  }
  return null // no EOI: cut off
}

function jpegHeader(bytes: Buffer): HeaderResult {
  const segments = jpegSegments(bytes)
  if (segments === null) return NOT_IMAGE('JPEG')
  const sofAt = segments.findIndex((segment) => isSof(segment.marker))
  const sosAt = segments.findIndex((segment) => segment.marker === 0xda)
  if (sofAt === -1 || sosAt === -1 || sosAt < sofAt) return NOT_IMAGE('JPEG')
  const sof = segments[sofAt].payload
  if (sof.length < 6) return NOT_IMAGE('JPEG')
  const height = sof.readUInt16BE(1)
  const width = sof.readUInt16BE(3)
  const exif = segments.find(
    (segment) =>
      segment.marker === 0xe1 && segment.payload.subarray(0, 6).toString('latin1') === 'Exif\0\0'
  )
  return {
    ok: true,
    width,
    height,
    animated: false,
    orientation: exif ? exifOrientation(exif.payload) : 1
  }
}

/**
 * Which APPn and comment segments a JPEG keeps: JFIF (without a thumbnail), the colour profile (ICC) and Adobe's colour transform, which decoders need.
 * Everything else is taken out: EXIF (where a phone keeps the place, the time and the camera), XMP, IPTC and Photoshop data, comments, the extra
 * pictures of MPF (a second picture or a thumbnail that can show what was cropped away), and anything after the end of the picture (a phone's "motion
 * photo" keeps a video there).
 */
function keepJpegSegment(segment: JpegSegment): 'keep' | 'drop' | 'jfif-no-thumbnail' {
  const { marker, payload } = segment
  if (marker === 0xfe) return 'drop'
  if (marker < 0xe0 || marker > 0xef) return 'keep'
  const tag = payload.subarray(0, 14).toString('latin1')
  if (marker === 0xe0 && tag.startsWith('JFIF\0') && payload.length >= 14) {
    return payload[12] === 0 && payload[13] === 0 && payload.length === 14
      ? 'keep'
      : 'jfif-no-thumbnail'
  }
  if (marker === 0xe2 && tag.startsWith('ICC_PROFILE\0')) return 'keep'
  if (marker === 0xee && tag.startsWith('Adobe')) return 'keep'
  return 'drop'
}

function stripJpeg(bytes: Buffer): { bytes: Buffer; removed: boolean } {
  const segments = jpegSegments(bytes)
  if (segments === null) return { bytes, removed: false }
  const parts: Buffer[] = [bytes.subarray(0, 2)]
  let removed = segments.at(-1)!.end < bytes.length // something after EOI
  for (const segment of segments) {
    const keep = keepJpegSegment(segment)
    if (keep === 'keep') parts.push(bytes.subarray(segment.start, segment.end))
    else if (keep === 'drop') removed = true
    else {
      // JFIF with a thumbnail: the same header, with no thumbnail.
      const header = Buffer.from(segment.payload.subarray(0, 14))
      header[12] = 0
      header[13] = 0
      parts.push(Buffer.from([0xff, 0xe0, 0x00, 16]), header)
      removed = true
    }
  }
  return {
    bytes: removed ? Buffer.concat(parts) : bytes.subarray(0, segments.at(-1)!.end),
    removed
  }
}

// ---------------------------------------------------------------- GIF

interface GifBlock {
  kind: 'extension' | 'image'
  label: number // the extension's label (0xF9 graphic control, 0xFE comment, 0xFF application, 0x01 plain text); 0 for an image
  start: number
  end: number
}

function gifBlocks(
  bytes: Buffer
): { blocks: GifBlock[]; headerEnd: number; trailerAt: number } | null {
  if (bytes.length < 13) return null
  const packed = bytes[10]
  let at = 13 + (packed & 0x80 ? 3 * 2 ** ((packed & 0x07) + 1) : 0)
  const headerEnd = at
  const blocks: GifBlock[] = []
  const subBlocks = (from: number): number | null => {
    let p = from
    while (p < bytes.length) {
      const size = bytes[p]
      p += 1
      if (size === 0) return p
      p += size
    }
    return null
  }
  while (at < bytes.length) {
    const start = at
    const introducer = bytes[at]
    if (introducer === 0x3b) return { blocks, headerEnd, trailerAt: at }
    if (introducer === 0x21) {
      if (at + 2 > bytes.length) return null
      const end = subBlocks(at + 2)
      if (end === null) return null
      blocks.push({ kind: 'extension', label: bytes[at + 1], start, end })
      at = end
    } else if (introducer === 0x2c) {
      if (at + 10 > bytes.length) return null
      const local = bytes[at + 9]
      let p = at + 10 + (local & 0x80 ? 3 * 2 ** ((local & 0x07) + 1) : 0)
      p += 1 // the LZW minimum code size
      if (p > bytes.length) return null
      const end = subBlocks(p)
      if (end === null) return null
      blocks.push({ kind: 'image', label: 0, start, end })
      at = end
    } else return null
  }
  return null // no trailer: cut off
}

function gifHeader(bytes: Buffer): HeaderResult {
  const parsed = gifBlocks(bytes)
  if (parsed === null) return NOT_IMAGE('GIF')
  const images = parsed.blocks.filter((block) => block.kind === 'image').length
  if (images === 0) return NOT_IMAGE('GIF')
  return {
    ok: true,
    width: bytes.readUInt16LE(6),
    height: bytes.readUInt16LE(8),
    animated: images > 1,
    orientation: 1
  }
}

/** A GIF keeps its picture and its graphic control (transparency); comments, application blocks (XMP, the loop setting) and plain text go. */
function stripGif(bytes: Buffer): { bytes: Buffer; removed: boolean } {
  const parsed = gifBlocks(bytes)
  if (parsed === null) return { bytes, removed: false }
  const kept = parsed.blocks.filter((block) => block.kind === 'image' || block.label === 0xf9)
  const removed = kept.length !== parsed.blocks.length || parsed.trailerAt + 1 < bytes.length
  if (!removed) return { bytes, removed }
  return {
    bytes: Buffer.concat([
      bytes.subarray(0, parsed.headerEnd),
      ...kept.map((block) => bytes.subarray(block.start, block.end)),
      Buffer.from([0x3b])
    ]),
    removed
  }
}

// ---------------------------------------------------------------- WebP

interface RiffChunk {
  fourcc: string
  start: number
  end: number // after the padding byte
  data: Buffer
}

function webpChunks(bytes: Buffer): RiffChunk[] | null {
  if (bytes.length < 20) return null
  const riffEnd = 8 + bytes.readUInt32LE(4)
  if (riffEnd > bytes.length || riffEnd < 20) return null
  const chunks: RiffChunk[] = []
  let at = 12
  while (at + 8 <= riffEnd) {
    const fourcc = bytes.subarray(at, at + 4).toString('latin1')
    const size = bytes.readUInt32LE(at + 4)
    if (at + 8 + size > riffEnd) return null
    const end = Math.min(at + 8 + size + (size % 2), riffEnd)
    chunks.push({ fourcc, start: at, end, data: bytes.subarray(at + 8, at + 8 + size) })
    at = end
  }
  return at === riffEnd && chunks.length > 0 ? chunks : null
}

function webpHeader(bytes: Buffer): HeaderResult {
  const chunks = webpChunks(bytes)
  if (chunks === null) return NOT_IMAGE('WebP')
  const first = chunks[0]
  const exif = chunks.find((chunk) => chunk.fourcc === 'EXIF')
  const orientation = exif ? exifOrientation(exif.data) : 1
  const animatedChunks = chunks.some((chunk) => chunk.fourcc === 'ANIM' || chunk.fourcc === 'ANMF')
  if (first.fourcc === 'VP8X') {
    if (first.data.length < 10) return NOT_IMAGE('WebP')
    const animated = (first.data[0] & 0x02) !== 0 || animatedChunks
    const width = first.data.readUIntLE(4, 3) + 1
    const height = first.data.readUIntLE(7, 3) + 1
    if (!animated && !chunks.some((chunk) => chunk.fourcc === 'VP8 ' || chunk.fourcc === 'VP8L'))
      return NOT_IMAGE('WebP')
    return { ok: true, width, height, animated, orientation }
  }
  if (first.fourcc === 'VP8 ') {
    const data = first.data
    if (data.length < 10 || data[3] !== 0x9d || data[4] !== 0x01 || data[5] !== 0x2a)
      return NOT_IMAGE('WebP')
    return {
      ok: true,
      width: data.readUInt16LE(6) & 0x3fff,
      height: data.readUInt16LE(8) & 0x3fff,
      animated: animatedChunks,
      orientation
    }
  }
  if (first.fourcc === 'VP8L') {
    const data = first.data
    if (data.length < 5 || data[0] !== 0x2f) return NOT_IMAGE('WebP')
    const bits = data.readUInt32LE(1)
    return {
      ok: true,
      width: (bits & 0x3fff) + 1,
      height: ((bits >>> 14) & 0x3fff) + 1,
      animated: animatedChunks,
      orientation
    }
  }
  return NOT_IMAGE('WebP')
}

/** A WebP keeps its picture (VP8, VP8L, the alpha) and its colour profile; EXIF, XMP and unknown chunks go, and the header's flags say so. */
function stripWebp(bytes: Buffer): { bytes: Buffer; removed: boolean } {
  const chunks = webpChunks(bytes)
  if (chunks === null) return { bytes, removed: false }
  const keep = new Set(['VP8X', 'VP8 ', 'VP8L', 'ALPH', 'ICCP'])
  const kept = chunks.filter((chunk) => keep.has(chunk.fourcc))
  const riffEnd = 8 + bytes.readUInt32LE(4)
  const removed = kept.length !== chunks.length || riffEnd < bytes.length
  if (!removed) return { bytes, removed }
  const parts = kept.map((chunk) => {
    const copy = Buffer.from(bytes.subarray(chunk.start, chunk.end))
    if (chunk.fourcc === 'VP8X') copy[8] &= ~(0x08 | 0x04) // no EXIF, no XMP
    return copy
  })
  const body = Buffer.concat(parts)
  const header = Buffer.alloc(12)
  header.write('RIFF', 0, 'latin1')
  header.writeUInt32LE(4 + body.length, 4)
  header.write('WEBP', 8, 'latin1')
  return { bytes: Buffer.concat([header, body]), removed }
}

// ---------------------------------------------------------------- images, together

/** What an image's header says, read before anything decodes it. */
export function imageHeader(bytes: Buffer, type: ImageMediaType): HeaderResult {
  const facts =
    type === 'image/png'
      ? pngHeader(bytes)
      : type === 'image/jpeg'
        ? jpegHeader(bytes)
        : type === 'image/gif'
          ? gifHeader(bytes)
          : webpHeader(bytes)
  if (!facts.ok) return facts
  if (facts.width < 1 || facts.height < 1) return { ok: false, why: 'its header gives it no size' }
  return facts
}

/** The image without its metadata, by rewriting its bytes (nothing is decoded). `removed` says whether there was anything to take out. */
export function stripMetadata(
  bytes: Buffer,
  type: ImageMediaType
): { bytes: Buffer; removed: boolean } {
  switch (type) {
    case 'image/png':
      return stripPng(bytes)
    case 'image/jpeg':
      return stripJpeg(bytes)
    case 'image/gif':
      return stripGif(bytes)
    default:
      return stripWebp(bytes)
  }
}

/**
 * A bitmap (4 bytes a pixel, any channel order) turned the way an EXIF orientation says the picture is meant to be seen (1 = as it is). Pure: the
 * main process decodes and encodes, this only moves pixels.
 */
export function orientBitmap(
  data: Buffer,
  width: number,
  height: number,
  orientation: number
): { data: Buffer; width: number; height: number } {
  if (orientation < 2 || orientation > 8) return { data, width, height }
  const swap = orientation >= 5
  const outWidth = swap ? height : width
  const outHeight = swap ? width : height
  const out = Buffer.alloc(data.length)
  for (let y = 0; y < outHeight; y++) {
    for (let x = 0; x < outWidth; x++) {
      let sx: number
      let sy: number
      switch (orientation) {
        case 2:
          sx = width - 1 - x
          sy = y
          break
        case 3:
          sx = width - 1 - x
          sy = height - 1 - y
          break
        case 4:
          sx = x
          sy = height - 1 - y
          break
        case 5:
          sx = y
          sy = x
          break
        case 6:
          sx = y
          sy = height - 1 - x
          break
        case 7:
          sx = width - 1 - y
          sy = height - 1 - x
          break
        default:
          sx = width - 1 - y
          sy = x // 8
      }
      data.copy(out, (y * outWidth + x) * 4, (sy * width + sx) * 4, (sy * width + sx) * 4 + 4)
    }
  }
  return { data: out, width: outWidth, height: outHeight }
}

// ---------------------------------------------------------------- PDF

export type PdfFacts = { ok: true; pages: number } | { ok: false; why: string }

/** The most a PDF's compressed object streams may unpack to while its pages are counted: a "zip bomb" stops here. */
const MAX_INFLATED_BYTES = 64 * 1024 * 1024

/**
 * A PDF's number of pages, read without a PDF library (D-037): the largest `/Count` of a `/Type /Pages` dictionary, looked for in the file and inside its
 * compressed object streams (unpacked with the zlib that Node has, to a fixed total), or else the number of `/Type /Page` objects. This is a reading of
 * the file's own structure, not a renderer: a damaged or unusual PDF can be counted wrong, and the provider has the last word. A PDF with a password
 * (`/Encrypt`) is refused: neither provider reads one.
 */
export function pdfFacts(bytes: Buffer): PdfFacts {
  const raw = bytes.toString('latin1')
  if (!raw.startsWith('%PDF-')) return { ok: false, why: 'it is not a PDF' }
  if (!raw.slice(-1024).includes('%%EOF'))
    return { ok: false, why: 'the PDF is cut off (it has no end)' }
  if (/\/Encrypt[\s/<[0-9]/.test(raw))
    return { ok: false, why: 'the PDF is protected by a password' }
  const texts = [raw]
  let inflated = 0
  const streamStart = /(?<!end)stream\r?\n/g
  for (let match = streamStart.exec(raw); match !== null; match = streamStart.exec(raw)) {
    const dictStart = raw.lastIndexOf('obj', match.index)
    const dict = raw.slice(Math.max(dictStart, match.index - 2048), match.index)
    if (!/\/Type\s*\/ObjStm/.test(dict) || !/\/FlateDecode/.test(dict)) continue
    const from = match.index + match[0].length
    const to = raw.indexOf('endstream', from)
    if (to === -1) break
    try {
      const out = inflateSync(bytes.subarray(from, to), {
        maxOutputLength: MAX_INFLATED_BYTES - inflated
      })
      inflated += out.length
      texts.push(out.toString('latin1'))
    } catch {
      // A stream that does not unpack (damaged, or past the total) is not counted from.
    }
    if (inflated >= MAX_INFLATED_BYTES) break
  }
  let count = 0
  let objects = 0
  for (const text of texts) {
    for (const pages of text.matchAll(/\/Type\s*\/Pages(?![A-Za-z])/g)) {
      const around = text.slice(Math.max(0, pages.index - 400), pages.index + 400)
      for (const found of around.matchAll(/\/Count\s+(\d{1,7})(?!\d)/g))
        count = Math.max(count, Number(found[1]))
    }
    objects += [...text.matchAll(/\/Type\s*\/Page(?![A-Za-z])/g)].length
  }
  const pages = count > 0 ? count : objects
  if (pages < 1) return { ok: false, why: 'its pages could not be counted' }
  return { ok: true, pages }
}

// ---------------------------------------------------------------- text

export type TextFacts =
  | { ok: true; text: string; bytes: Buffer; chars: number; lines: number }
  | { ok: false; why: string }

/**
 * Whether a file is text the app can send: valid UTF-8 (a byte-order mark at the start is dropped), not empty, and with no control character but tab,
 * line feed and carriage return. `bytes` is what is kept (without the byte-order mark).
 */
export function checkText(bytes: Buffer): TextFacts {
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes)
  } catch {
    return { ok: false, why: 'it is not text in UTF-8' }
  }
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/.test(text))
    return { ok: false, why: 'it holds characters that text does not' }
  if (text.trim() === '') return { ok: false, why: 'it is empty' }
  const kept =
    bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf
      ? bytes.subarray(3)
      : bytes
  return { ok: true, text, bytes: kept, chars: text.length, lines: text.split(/\r\n|\r|\n/).length }
}

/** The most any file may weigh when it comes in, whatever it turns out to be: looked at before a file is read whole. */
export const MAX_INPUT_BYTES = Math.max(
  ATTACHMENT_LIMITS.maxImageInputBytes,
  ATTACHMENT_LIMITS.maxPdfBytes,
  ATTACHMENT_LIMITS.maxTextBytes
)
