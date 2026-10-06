// Images and files the person attaches to a message (Stage 9, D-037): what the page may know about one, the caps, and the two checks both sides
// run (an attachment's id, and the name it is shown under). Types, limits and plain functions only: this file is bundled into the preload, which
// runs sandboxed (D-004).
//
// An attachment is the main process's own COPY of a file, kept in the app's data folder (`attachments/`) and named by the SHA-256 of what is kept,
// so the same file is kept once. The page never holds a path: it holds ids, and main reads the copies from its own folder. What a file is comes from
// its first bytes, never from its name: the name is a label for the person (and, for a text file, says which language it is in).

/** The kinds of file that can be attached: images, PDFs, and text (UTF-8). Anything else is refused. */
export type AttachmentKind = 'image' | 'pdf' | 'text'

/** The exact types, as their first bytes say. GIF and WebP go as they are; PNG and JPEG can be made smaller (D-037). */
export type AttachmentMediaType =
  'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp' | 'application/pdf' | 'text/plain'

/** What was done to a file on its way in, so the person can be told (rule 1: nothing leaves the PC unseen). */
export interface AttachmentChanges {
  /** Metadata was taken out of an image (EXIF and XMP of a JPEG, where a phone keeps the place a photo was taken; the text chunks of a PNG; ...). */
  metadataRemoved: boolean
  /** The image was made smaller: its size before, in pixels. Null if it was not. */
  shrunkFrom: { width: number; height: number } | null
  /** The image was turned upright (a photo whose camera recorded that it was held sideways). */
  turned: boolean
  /** The image was kept as another type: a PNG with no transparency that was too heavy becomes a JPEG. Null if it was not. */
  convertedFrom: AttachmentMediaType | null
}

/** One attachment, as the page may know it. Main works every field out from the copy it keeps; nothing here is the page's. */
export interface AttachmentInfo {
  /** The SHA-256 of the copy, in lower-case hexadecimal: 64 characters. The page hands it back to send or drop the file. */
  id: string
  /** The name it is shown under (cleaned: no folder, no control or direction characters, at most `maxNameChars`). */
  name: string
  kind: AttachmentKind
  mediaType: AttachmentMediaType
  /** The size of the copy, in bytes (what is sent, before the provider's own encoding). */
  bytes: number
  /** An image's size in pixels, as it is kept (after any shrinking). */
  width?: number
  height?: number
  /** A PDF's number of pages. */
  pages?: number
  /** A text file's length in characters (as JavaScript counts them, like every other text limit of the app) and in lines. */
  chars?: number
  lines?: number
  changes: AttachmentChanges
}

/** A file just attached: what it is, and what the page shows of it on the chip (both made by main). */
export interface AttachedFile {
  info: AttachmentInfo
  /** An image's small picture, as a data URL main made (a PNG, for a PNG or JPEG; the file itself, for a GIF or WebP). Null for other kinds. */
  thumbnail: string | null
  /** A text file's first lines. Null for other kinds. */
  firstLines: string | null
}

/**
 * The caps (D-037). Checked against the providers' own pages on 6 October 2026: Anthropic takes images of at most 8000 px a side and 10 MB (base64)
 * each, PDFs of at most 100 pages in a request (to a model with a context window under 1M tokens), and a request of at most 32 MB; a request with more
 * than 20 images refuses any image over 2000 px a side. OpenAI takes files of at most 50 MB in all per request, and no animated GIF. The caps here are
 * below all of these, so a request the app sends is never refused for its size by either provider. The whole conversation is sent again with every
 * message (D-028), attachments included, which is why the cap on a request matters most.
 */
export const ATTACHMENT_LIMITS = {
  /** A PNG or JPEG may be this big when it comes in (it is made smaller before it is kept). */
  maxImageInputBytes: 20 * 1024 * 1024,
  /** An image as it is kept and sent. A GIF or WebP must be this small when it comes in (it is sent as it is). */
  maxImageBytes: 5 * 1024 * 1024,
  /** An image whose header says more than this a side, or more pixels in all, is refused before anything decodes it. */
  maxImageSide: 8000,
  maxImagePixels: 40_000_000,
  /** The longest side an image is sent with: a bigger PNG or JPEG is made smaller to this; a bigger GIF or WebP is refused. */
  sendLongEdge: 2000,
  maxPdfBytes: 10 * 1024 * 1024,
  maxPdfPages: 100,
  /** A text file: as long as one message may be (CHAT_LIMITS.maxMessageChars), and at most this many bytes. */
  maxTextChars: 200_000,
  maxTextBytes: 1024 * 1024,
  /** Files on one message, and in one chat. */
  perMessage: 10,
  perChat: 50,
  /** Everything attached to one request (the whole conversation's attachments), in bytes before base64, and in PDF pages. */
  maxRequestBytes: 20 * 1024 * 1024,
  maxRequestPages: 100,
  /** The attachments folder as a whole. When it is full, a new file is refused; nothing is ever deleted to make room. */
  folderMaxBytes: 2 * 1024 * 1024 * 1024,
  folderMaxFiles: 5000,
  maxNameChars: 200
} as const

const ATTACHMENT_ID = /^[0-9a-f]{64}$/

/** An attachment's id becomes a file name, so it is checked against the one spelling the app makes: 64 lower-case hexadecimal characters. */
export function isAttachmentId(value: unknown): value is string {
  return typeof value === 'string' && ATTACHMENT_ID.test(value)
}

/** Characters a name must not carry: control characters, and the ones that reverse the direction of text (which can make "exe.pdf" read as "fdp.exe"). */
const range = (from: number, to: number): string =>
  `${String.fromCharCode(from)}-${String.fromCharCode(to)}`
const UNSAFE_IN_NAME = new RegExp(
  `[${[range(0x00, 0x1f), range(0x7f, 0x9f), range(0x200e, 0x200f), range(0x202a, 0x202e), range(0x2066, 0x2069), String.fromCharCode(0xfeff)].join('')}]`,
  'g'
)

/**
 * The name a file is shown under: the last part of what was given (never a folder), without control or direction characters, with runs of white
 * space as one space, and at most `maxNameChars` characters (by character, so an emoji is not cut in half). A name with nothing left is `fallback`.
 * It is a label only: what a file is comes from its bytes.
 */
export function cleanFileName(input: unknown, fallback: string): string {
  if (typeof input !== 'string') return fallback
  const last = input.split(/[/\\]/).pop() ?? ''
  const clean = last.replace(/\s+/g, ' ').replace(UNSAFE_IN_NAME, '').replace(/ +/g, ' ').trim()
  const letters = Array.from(clean)
  const cut =
    letters.length > ATTACHMENT_LIMITS.maxNameChars
      ? letters.slice(0, ATTACHMENT_LIMITS.maxNameChars).join('')
      : clean
  return cut === '' || cut === '.' || cut === '..' ? fallback : cut
}

/** The name a file of this type is given when it came with none (a pasted image). */
export const FALLBACK_NAMES: Record<AttachmentMediaType, string> = {
  'image/png': 'image.png',
  'image/jpeg': 'image.jpg',
  'image/gif': 'image.gif',
  'image/webp': 'image.webp',
  'application/pdf': 'document.pdf',
  'text/plain': 'text.txt'
}
