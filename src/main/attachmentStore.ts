import { createHash } from 'crypto'
import { promises as fs } from 'fs'
import { basename, join } from 'path'
import type { AttachmentPreview } from '../shared/ipc'
import {
  ATTACHMENT_LIMITS,
  cleanFileName,
  FALLBACK_NAMES,
  isAttachmentId,
  type AttachedFile,
  type AttachmentChanges,
  type AttachmentInfo,
  type AttachmentMediaType
} from '../shared/attachments'
import {
  checkText,
  imageHeader,
  MAX_INPUT_BYTES,
  pdfFacts,
  sniff,
  stripMetadata,
  type ImageMediaType
} from './attachmentFormats'
import type { FileForm, WriteMode } from './chatFile'
import type { SecretBox } from './credentialStore'

// The attachments (Stage 9.1, D-037): the main process's own copies of the files the person attaches, in one folder of the data folder
// (`attachments/`). No Electron imports, so it can be checked under plain Node with any folder: decoding and re-encoding an image is handed in
// (`ImageTools`; attachmentImages.ts gives Electron's), as the secure storage is (a `SecretBox`).
//
// A FILE COMES IN as bytes and a name (pasted, dropped, or read by main from a path the person chose in the system's own dialog, `readLocalFile`). What it
// is comes from its first bytes (attachmentFormats.ts), an image's size from its header BEFORE anything decodes it, and the caps are applied
// (ATTACHMENT_LIMITS). An image's metadata is taken out by rewriting its bytes; a PNG or JPEG that is too big, or a photo recorded as held sideways, is
// re-encoded (made smaller, turned upright). A PDF is kept as it is, its metadata included (D-037: removing it needs a PDF library). The original is
// only ever read.
//
// A COPY IS NAMED BY THE SHA-256 OF WHAT IS KEPT (`<64 hex>`, no extension), so the same file is kept once, and a copy that does not hash to its own
// name is damaged. It is written like a saved chat (D-016, and D-010: never renamed, because every rename fails in this project's EFS-encrypted
// %APPDATA%): `<id>.tmp` written and read back, copied over `<id>` and read back, the `.tmp` removed. Reading checks the hash every time.
//
// SEALED when the person has turned encryption on (D-035): `writeMode` (chatProtection.ts) is asked before every write, as the chat store does, and
// either names the form or refuses, and then nothing is written. A sealed copy is `SEALED_MAGIC` followed by what the secure storage made of the
// file's bytes (as base64 text, which is what it takes); its name is still the hash of the file's own bytes, so it is checked after opening.
// `conform()` rewrites every copy in the form the choice says now, one per turn.
//
// NOTHING IS DELETED but by `deleteUnused` (the chat that used a file was deleted, or the person took a file off a message before sending it) and
// `sweep` (at start: copies no saved chat uses, left by a message that was never sent). Both skip a file that a saved chat names or that was attached
// in this run and not taken off (`hold`). A full folder refuses a new file; it never makes room.

/** Decoding and encoding images: Electron's own in the app (attachmentImages.ts), a stand-in under plain Node. Only PNG and JPEG are given to it. */
export interface ImageTools {
  /** The size a PNG or JPEG decodes to, or null if it does not decode. */
  decodedSize(bytes: Buffer): { width: number; height: number } | null
  /**
   * The picture re-encoded: made to fit `maxEdge` on its longer side (never larger), turned the way `orientation` (EXIF, 1 to 8) says, and at most
   * `maxBytes`. Kept in its own type, unless a PNG is too big and has no transparency (then a JPEG). Null if it does not decode or cannot be made to fit.
   */
  reencode(
    bytes: Buffer,
    type: 'image/png' | 'image/jpeg',
    options: { maxEdge: number; orientation: number; maxBytes: number }
  ): { bytes: Buffer; type: 'image/png' | 'image/jpeg' } | null
  /** A small picture of a PNG or JPEG, at most `maxEdge` a side, as a data URL of a PNG, for the chip. Null if it does not decode. */
  thumbnail(bytes: Buffer, maxEdge: number): string | null
}

/** How a sealed copy begins. A plain copy is told apart by its hash (it hashes to its name), so a text file that begins like this is still read right. */
export const SEALED_MAGIC = Buffer.from('FRONTIER-SEALED-ATTACHMENT-1\n', 'latin1')
const MAX_KEPT_BYTES = Math.max(
  ATTACHMENT_LIMITS.maxImageBytes,
  ATTACHMENT_LIMITS.maxPdfBytes,
  ATTACHMENT_LIMITS.maxTextBytes
)
/** The most a copy may weigh on disk: the largest file, sealed (base64 and the secure storage's few dozen bytes), and its first line. */
export const MAX_COPY_BYTES = Math.ceil(MAX_KEPT_BYTES / 3) * 4 + 4096 + SEALED_MAGIC.length
const THUMBNAIL_EDGE = 160
const FIRST_LINES = 5

const sha256 = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex')
const mb = (bytes: number): string => `${Math.round(bytes / (1024 * 1024))} MB`
const count = (value: number): string => value.toLocaleString('en-US')

/** What the page is shown of a text file: its first few lines, each cut short. */
function firstLinesOf(text: string): string {
  return text
    .split(/\r\n|\r|\n/)
    .slice(0, FIRST_LINES)
    .map((line) =>
      Array.from(line).length > 120 ? `${Array.from(line).slice(0, 120).join('')}...` : line
    )
    .join('\n')
    .slice(0, 600)
}

/** A file ready to be kept, or why it cannot be. */
export type Prepared = { ok: true; bytes: Buffer; file: AttachedFile } | { ok: false; why: string }

const NONE: AttachmentChanges = {
  metadataRemoved: false,
  shrunkFrom: null,
  turned: false,
  convertedFrom: null
}

/**
 * Everything a file goes through before it is kept: what it is, its caps, its metadata, its size. Pure but for the image tools, and never throws for
 * bytes that are not what they claim (`why` is a fragment: "it is animated, ...").
 */
export function prepare(input: { bytes: Buffer; name: unknown }, images: ImageTools): Prepared {
  const L = ATTACHMENT_LIMITS
  const { bytes } = input
  const refuse = (why: string): Prepared => ({ ok: false, why })
  if (bytes.length === 0) return refuse('it is empty')
  if (bytes.length > MAX_INPUT_BYTES) return refuse(`it is larger than ${mb(MAX_INPUT_BYTES)}`)
  const type = sniff(bytes)
  const finish = (
    kept: Buffer,
    mediaType: AttachmentMediaType,
    facts: Partial<AttachmentInfo>,
    changes: AttachmentChanges,
    thumbnail: string | null,
    firstLines: string | null
  ): Prepared => {
    const info: AttachmentInfo = {
      id: sha256(kept),
      name: cleanFileName(input.name, FALLBACK_NAMES[mediaType]),
      kind: mediaType === 'application/pdf' ? 'pdf' : mediaType === 'text/plain' ? 'text' : 'image',
      mediaType,
      bytes: kept.length,
      ...facts,
      changes
    }
    return { ok: true, bytes: kept, file: { info, thumbnail, firstLines } }
  }

  if (type === 'application/pdf') {
    if (bytes.length > L.maxPdfBytes) return refuse(`a PDF may be at most ${mb(L.maxPdfBytes)}`)
    const pdf = pdfFacts(bytes)
    if (!pdf.ok) return refuse(pdf.why)
    if (pdf.pages > L.maxPdfPages) {
      return refuse(`it has ${count(pdf.pages)} pages, and a PDF may have at most ${L.maxPdfPages}`)
    }
    return finish(bytes, 'application/pdf', { pages: pdf.pages }, NONE, null, null)
  }

  if (type === null) {
    if (bytes.length > L.maxTextBytes) {
      return refuse(
        `it is not an image or a PDF, and a text file may be at most ${mb(L.maxTextBytes)}`
      )
    }
    const text = checkText(bytes)
    if (!text.ok) {
      return refuse(
        text.why === 'it is empty'
          ? text.why
          : 'it is not a PNG, JPEG, GIF or WebP image, a PDF, or a text file (UTF-8)'
      )
    }
    if (text.chars > L.maxTextChars) {
      return refuse(
        `it has ${count(text.chars)} characters, and a text file may have at most ${count(L.maxTextChars)}`
      )
    }
    return finish(
      text.bytes,
      'text/plain',
      { chars: text.chars, lines: text.lines },
      NONE,
      null,
      firstLinesOf(text.text)
    )
  }

  // An image. Its size comes from its header, and is checked, before anything decodes it.
  const imageType: ImageMediaType = type
  const reencodable = imageType === 'image/png' || imageType === 'image/jpeg'
  if (!reencodable && bytes.length > L.maxImageBytes) {
    return refuse(`a GIF or WebP image may be at most ${mb(L.maxImageBytes)} (it is sent as it is)`)
  }
  const header = imageHeader(bytes, imageType)
  if (!header.ok) return refuse(header.why)
  const { width, height, orientation } = header
  if (width > L.maxImageSide || height > L.maxImageSide || width * height > L.maxImagePixels) {
    return refuse(
      `it is ${count(width)} x ${count(height)} pixels, and an image may be at most ${count(L.maxImageSide)} a side and ${count(L.maxImagePixels / 1_000_000)} million pixels in all`
    )
  }
  if (header.animated) return refuse('it is animated, and only still images can be sent')
  const stripped = stripMetadata(bytes, imageType)
  // What is kept must still be the same picture: the rewritten bytes are read again, as a new file would be.
  const again = imageHeader(stripped.bytes, imageType)
  if (!again.ok || again.width !== width || again.height !== height) {
    return refuse('its metadata could not be taken out')
  }

  if (!reencodable) {
    if (Math.max(width, height) > L.sendLongEdge) {
      return refuse(
        `a GIF or WebP image may be at most ${count(L.sendLongEdge)} pixels a side (it is sent as it is; save it as PNG or JPEG to have it made smaller)`
      )
    }
    if (orientation !== 1) {
      return refuse(
        'it is a WebP image that is meant to be shown turned, which the app cannot do; save it as PNG or JPEG'
      )
    }
    return finish(
      stripped.bytes,
      imageType,
      { width, height },
      { ...NONE, metadataRemoved: stripped.removed },
      `data:${imageType};base64,${stripped.bytes.toString('base64')}`,
      null
    )
  }

  // A PNG or a JPEG: it must decode, to the size its header says.
  const decoded = images.decodedSize(stripped.bytes)
  if (decoded === null) return refuse('it could not be read as an image')
  if (decoded.width !== width || decoded.height !== height) {
    return refuse('its picture is not the size its header says')
  }
  const needs =
    Math.max(width, height) > L.sendLongEdge ||
    orientation !== 1 ||
    stripped.bytes.length > L.maxImageBytes
  let kept = stripped.bytes
  let keptType: 'image/png' | 'image/jpeg' = imageType
  let keptWidth = width
  let keptHeight = height
  if (needs) {
    const redone = images.reencode(stripped.bytes, imageType, {
      maxEdge: L.sendLongEdge,
      orientation,
      maxBytes: L.maxImageBytes
    })
    if (redone === null) return refuse('it is too large, even when made smaller')
    // What the image tools made is checked like any file that comes in: its type, its header, its caps; and it must be what was asked for: upright (its
    // own header no longer says "turn me"), the shape of the original as it is meant to be seen, and no larger than asked. Its metadata is then taken out.
    const made = sniff(redone.bytes) === redone.type ? imageHeader(redone.bytes, redone.type) : null
    const clean = made !== null && made.ok ? stripMetadata(redone.bytes, redone.type) : null
    const upright = orientation >= 5 ? { width: height, height: width } : { width, height }
    const shapeOf = (w: number, h: number): number => w / h
    if (
      made === null ||
      !made.ok ||
      clean === null ||
      made.orientation !== 1 ||
      Math.max(made.width, made.height) > L.sendLongEdge ||
      Math.max(made.width, made.height) > Math.max(width, height) ||
      Math.abs(shapeOf(made.width, made.height) - shapeOf(upright.width, upright.height)) >
        0.02 * shapeOf(upright.width, upright.height) + 1 / Math.min(made.width, made.height) ||
      clean.bytes.length > L.maxImageBytes
    ) {
      return refuse('it could not be made smaller')
    }
    kept = clean.bytes
    keptType = redone.type
    keptWidth = made.width
    keptHeight = made.height
  }
  const turned = orientation !== 1
  // Turned upright, a photo held sideways is as big as it was, with its sides swapped: only a smaller longer side counts as "made smaller".
  const shrunk = Math.max(keptWidth, keptHeight) < Math.max(width, height)
  return finish(
    kept,
    keptType,
    { width: keptWidth, height: keptHeight },
    {
      metadataRemoved: stripped.removed,
      shrunkFrom: shrunk ? { width, height } : null,
      turned,
      convertedFrom: keptType === imageType ? null : imageType
    },
    images.thumbnail(kept, THUMBNAIL_EDGE),
    null
  )
}

// ---------------------------------------------------------------- facts of a kept copy

/** What a kept copy is, worked out again from its bytes (they passed `prepare` when they were kept, and their hash is checked before this). */
export type CopyFacts =
  | {
      kind: 'image'
      mediaType: ImageMediaType
      width: number
      height: number
    }
  | { kind: 'pdf'; mediaType: 'application/pdf'; pages: number }
  | { kind: 'text'; mediaType: 'text/plain'; text: string; chars: number; lines: number }

export function factsOf(bytes: Buffer): CopyFacts | null {
  const type = sniff(bytes)
  if (type === 'application/pdf') {
    const pdf = pdfFacts(bytes)
    return pdf.ok ? { kind: 'pdf', mediaType: type, pages: pdf.pages } : null
  }
  if (type === null) {
    const text = checkText(bytes)
    return text.ok && text.bytes.length === bytes.length
      ? {
          kind: 'text',
          mediaType: 'text/plain',
          text: text.text,
          chars: text.chars,
          lines: text.lines
        }
      : null
  }
  const header = imageHeader(bytes, type)
  return header.ok
    ? { kind: 'image', mediaType: type, width: header.width, height: header.height }
    : null
}

// ---------------------------------------------------------------- reading a file the person chose

export type LocalRead = { ok: true; bytes: Buffer; name: string } | { ok: false; why: string }

/**
 * Reads a file the person picked in the system's own open dialog (main has the path; the page never does). Only a file on a local drive: a network
 * share, a device path, an alternate data stream and a file that is itself a link (a symbolic link or a junction) are refused, not followed. Its size
 * is looked at before it is read, and no more than the cap is ever read. The file is opened for reading only.
 */
export async function readLocalFile(
  path: unknown,
  maxBytes: number,
  platform: NodeJS.Platform = process.platform
): Promise<LocalRead> {
  const refuse = (why: string): LocalRead => ({ ok: false, why })
  if (typeof path !== 'string' || path.length === 0 || path.length > 4096)
    return refuse('that is not a file')
  if (platform === 'win32') {
    // "C:\...": a drive letter, a backslash, and no other colon (a colon later names an alternate data stream). \\server\share, \\?\ and \\.\ are not this.
    if (!/^[A-Za-z]:\\/.test(path) || path.indexOf(':', 2) !== -1) {
      return refuse('only a file on a drive of this computer can be attached')
    }
  } else if (!path.startsWith('/'))
    return refuse('only a file on a drive of this computer can be attached')
  let handle: fs.FileHandle | null = null
  try {
    const link = await fs.lstat(path)
    if (link.isSymbolicLink()) return refuse('it is a link to another file')
    if (!link.isFile()) return refuse('it is not a file')
    // The real place: a mapped network drive resolves to \\server\share here, and is refused.
    const real = await fs.realpath(path)
    if (platform === 'win32' && !/^[A-Za-z]:\\/.test(real)) {
      return refuse('only a file on a drive of this computer can be attached')
    }
    handle = await fs.open(path, 'r')
    const { size } = await handle.stat()
    if (size > maxBytes) return refuse(`it is larger than ${mb(maxBytes)}`)
    if (size === 0) return refuse('it is empty')
    const bytes = Buffer.alloc(size)
    let got = 0
    while (got < size) {
      const { bytesRead } = await handle.read(bytes, got, size - got, got)
      if (bytesRead === 0) break
      got += bytesRead
    }
    if (got !== size) return refuse('it changed while it was being read')
    return { ok: true, bytes, name: basename(path) }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    return refuse(code === 'ENOENT' ? 'it is not there any more' : 'it could not be read')
  } finally {
    await handle?.close().catch(() => undefined)
  }
}

// ---------------------------------------------------------------- the folder

export type AddResult =
  { ok: true; file: AttachedFile; already: boolean } | { ok: false; error: string }

/** A kept copy, read back and checked: its bytes and what they are. */
export type ReadResult =
  | { ok: true; bytes: Buffer; facts: CopyFacts; form: FileForm }
  | { ok: false; why: 'missing' | 'damaged' | 'unopened'; error: string }

export interface AttachmentCounts {
  files: number
  bytes: number
  plain: number
  encrypted: number
}

export interface AttachmentConformResult {
  changed: number
  already: number
  failed: number
}

export interface AttachmentStore {
  /** Checks a file, keeps a copy (or finds the same copy kept already), and holds it for this run. Never throws for a file that cannot be used. */
  add(input: { bytes: Buffer; name: unknown }): Promise<AddResult>
  /** Reads a kept copy and checks it against its name. */
  read(id: string): Promise<ReadResult>
  /** A kept copy's small picture (an image) or first lines (a text), for a chat opened from History; or why it cannot be read. */
  preview(id: string): Promise<AttachmentPreview>
  /** Keeps a copy from being deleted in this run (a file on a message not yet sent). `add` holds what it adds. */
  hold(id: string): void
  release(id: string): void
  /** Deletes those of `candidates` that no saved chat uses (`referenced`) and that are not held. Answers how many went, and how many could not be deleted. */
  deleteUnused(
    candidates: readonly string[],
    referenced: ReadonlySet<string>
  ): Promise<{ deleted: number; failed: number }>
  /**
   * Deletes every copy (and half-written `.tmp`) that no saved chat uses, is not held, and is older than `olderThanMs`. The caller must know every chat:
   * with a chat that could not be read, its files are not known, and nothing may be swept.
   */
  sweep(
    referenced: ReadonlySet<string>,
    olderThanMs: number
  ): Promise<{ deleted: number; failed: number }>
  /** Rewrites every copy in the form the choice says now (D-035), one per turn. Writes nothing while writing is refused. */
  conform(): Promise<AttachmentConformResult>
  counts(): Promise<AttachmentCounts>
  whenIdle(): Promise<void>
}

export interface AttachmentStoreOptions {
  images: ImageTools
  /** The secure storage, to open sealed copies and to make them. Without it the store keeps plain copies only. */
  box?: SecretBox
  /** How the next write must be made, or why none may be (chatProtection.ts). Without it every write is plain. */
  writeMode?: () => Promise<WriteMode>
  /** The clock, for `sweep` (tests move it). */
  now?: () => number
  /** The folder's caps (tests make them small); ATTACHMENT_LIMITS otherwise. */
  folderCaps?: { files: number; bytes: number }
}

const COPY_NAME = /^([0-9a-f]{64})(\.tmp)?$/

function assertId(id: unknown): asserts id is string {
  if (!isAttachmentId(id)) throw new Error('that is not an attachment id')
}

function seal(bytes: Buffer, box: SecretBox): Buffer {
  return Buffer.concat([SEALED_MAGIC, box.encrypt(bytes.toString('base64'))])
}

type Opened =
  { ok: true; bytes: Buffer; form: FileForm } | { ok: false; why: 'damaged' | 'unopened' }

/** What a copy on disk holds, checked against its name. A plain copy hashes to it; a sealed one opens to bytes that do. */
function openCopy(data: Buffer, id: string, box: SecretBox | undefined): Opened {
  if (sha256(data) === id) return { ok: true, bytes: data, form: 'plain' }
  if (
    data.length <= SEALED_MAGIC.length ||
    !data.subarray(0, SEALED_MAGIC.length).equals(SEALED_MAGIC)
  ) {
    return { ok: false, why: 'damaged' }
  }
  if (box === undefined || !box.isAvailable()) return { ok: false, why: 'unopened' }
  let text: string
  try {
    text = box.decrypt(data.subarray(SEALED_MAGIC.length))
  } catch {
    return { ok: false, why: 'unopened' }
  }
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(text)) return { ok: false, why: 'damaged' }
  const bytes = Buffer.from(text, 'base64')
  return sha256(bytes) === id
    ? { ok: true, bytes, form: 'encrypted' }
    : { ok: false, why: 'damaged' }
}

const alwaysPlain = async (): Promise<WriteMode> => ({ form: 'plain' })

export function createAttachmentStore(
  dir: string,
  options: AttachmentStoreOptions
): AttachmentStore {
  const { images, box } = options
  const writeMode = options.writeMode ?? alwaysPlain
  const now = options.now ?? Date.now
  const caps = options.folderCaps ?? {
    files: ATTACHMENT_LIMITS.folderMaxFiles,
    bytes: ATTACHMENT_LIMITS.folderMaxBytes
  }
  /** What is in the folder: each copy's size on disk and its form, as its first bytes say (plain or sealed). */
  const index = new Map<string, { size: number; sealed: boolean }>()
  const held = new Set<string>()
  let scanned: Promise<void> | null = null

  let queue: Promise<unknown> = Promise.resolve()
  function inOrder<T>(task: () => Promise<T>): Promise<T> {
    const run = queue.then(task)
    queue = run.catch(() => undefined)
    return run
  }

  async function headOf(path: string): Promise<Buffer> {
    const handle = await fs.open(path, 'r')
    try {
      const head = Buffer.alloc(SEALED_MAGIC.length)
      const { bytesRead } = await handle.read(head, 0, head.length, 0)
      return head.subarray(0, bytesRead)
    } finally {
      await handle.close().catch(() => undefined)
    }
  }

  async function scan(): Promise<void> {
    let names: string[] = []
    try {
      names = await fs.readdir(dir)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    for (const name of names) {
      const match = COPY_NAME.exec(name)
      if (match === null || match[2] !== undefined) continue
      try {
        const path = join(dir, name)
        const stat = await fs.stat(path)
        if (!stat.isFile()) continue
        index.set(match[1], { size: stat.size, sealed: (await headOf(path)).equals(SEALED_MAGIC) })
      } catch {
        // gone, or locked: not counted now; a read later says what it is
      }
    }
  }

  function ensureScanned(): Promise<void> {
    scanned ??= scan().catch((error: unknown) => {
      scanned = null
      throw error
    })
    return scanned
  }

  async function readAt(path: string, id: string): Promise<Opened | null> {
    let size: number
    try {
      size = (await fs.stat(path)).size
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
    if (size > MAX_COPY_BYTES) return { ok: false, why: 'damaged' } // looked at before it is read: no file can fill the memory
    return openCopy(await fs.readFile(path), id, box)
  }

  /** The copy under an id: the real file if it is whole, or else a whole `.tmp` (written first, so it is the same bytes). Null if there is neither. */
  async function readCopy(id: string): Promise<Opened | null> {
    const file = join(dir, id)
    const real = await readAt(file, id)
    if (real !== null && real.ok) return real
    const copy = await readAt(`${file}.tmp`, id)
    if (copy !== null && copy.ok) return copy
    return real ?? copy
  }

  /** The three steps of D-016, for bytes already checked and a form `writeMode` named. Called only inside `inOrder`. */
  async function writeCopy(id: string, bytes: Buffer, form: FileForm): Promise<void> {
    if (form === 'encrypted' && box === undefined) {
      throw new Error('this store has no secure storage to encrypt with')
    }
    const data = form === 'encrypted' && box !== undefined ? seal(bytes, box) : bytes
    await fs.mkdir(dir, { recursive: true, mode: 0o700 })
    const file = join(dir, id)
    const copy = `${file}.tmp`
    await fs.writeFile(copy, data, { mode: 0o600 })
    const back = await fs.readFile(copy)
    const proved = (read: Buffer): boolean => {
      if (!read.equals(data)) return false
      const opened = openCopy(read, id, box)
      return opened.ok && opened.form === form && opened.bytes.equals(bytes)
    }
    if (!proved(back)) {
      await fs.rm(copy, { force: true }).catch(() => undefined)
      throw new Error('the new copy could not be read back')
    }
    await fs.copyFile(copy, file)
    if (!proved(await fs.readFile(file))) throw new Error('the copy could not be read back')
    await fs.rm(copy, { force: true }).catch(() => undefined)
    index.set(id, { size: data.length, sealed: form === 'encrypted' })
  }

  async function removeCopy(id: string): Promise<boolean> {
    const file = join(dir, id)
    await Promise.all([fs.rm(file, { force: true }), fs.rm(`${file}.tmp`, { force: true })]).catch(
      () => undefined
    )
    const left = await Promise.all(
      [file, `${file}.tmp`].map((path) =>
        fs.access(path).then(
          () => true,
          () => false
        )
      )
    )
    if (left.some(Boolean)) return false
    index.delete(id)
    return true
  }

  const store: AttachmentStore = {
    add: async (input) => {
      const prepared = prepare(input, images)
      const name = cleanFileName(input.name, 'The file')
      if (!prepared.ok) return { ok: false, error: `${name} was not attached: ${prepared.why}.` }
      const { info } = prepared.file
      return inOrder(async (): Promise<AddResult> => {
        // How this write is made is not decided here (D-035): it is asked for, every time, and a refusal means nothing is written.
        const mode = await writeMode()
        if ('refused' in mode)
          return {
            ok: false,
            error: `${info.name} was not attached: nothing can be saved right now. ${mode.refused}`
          }
        await ensureScanned()
        const there = index.has(info.id) ? await readCopy(info.id).catch(() => null) : null
        if (
          there !== null &&
          there.ok &&
          there.form === mode.form &&
          there.bytes.equals(prepared.bytes)
        ) {
          held.add(info.id)
          return { ok: true, file: prepared.file, already: true }
        }
        // A new copy, or one that must be written again (damaged, or kept in the other form): the caps count what the folder would hold after it.
        const sealedSize =
          mode.form === 'encrypted'
            ? Math.ceil(prepared.bytes.length / 3) * 4 + 4096 + SEALED_MAGIC.length
            : prepared.bytes.length
        let files = 0
        let total = 0
        for (const [id, entry] of index) {
          if (id === info.id) continue
          files += 1
          total += entry.size
        }
        if (files + 1 > caps.files || total + sealedSize > caps.bytes) {
          return {
            ok: false,
            error: `${info.name} was not attached: the attachments folder is full (${count(files)} files, ${mb(total)}). Delete chats with files in them to make room; nothing is deleted for you.`
          }
        }
        try {
          await writeCopy(info.id, prepared.bytes, mode.form)
        } catch (error) {
          // Logged here only (a message could name a path).
          console.error(
            'Keeping a copy of an attachment failed:',
            error instanceof Error ? error.message : error
          )
          return {
            ok: false,
            error: `${info.name} was not attached: it could not be copied into the app's data folder.`
          }
        }
        held.add(info.id)
        return { ok: true, file: prepared.file, already: false }
      })
    },

    read: (id) =>
      inOrder(async (): Promise<ReadResult> => {
        assertId(id)
        const opened = await readCopy(id)
        if (opened === null)
          return {
            ok: false,
            why: 'missing',
            error: "An attached file is missing from the app's data folder."
          }
        if (!opened.ok) {
          return opened.why === 'unopened'
            ? {
                ok: false,
                why: 'unopened',
                error:
                  'An attached file is encrypted, and could not be opened with the key this computer has.'
              }
            : {
                ok: false,
                why: 'damaged',
                error: "An attached file is damaged in the app's data folder."
              }
        }
        const facts = factsOf(opened.bytes)
        if (facts === null)
          return {
            ok: false,
            why: 'damaged',
            error: "An attached file is damaged in the app's data folder."
          }
        return { ok: true, bytes: opened.bytes, facts, form: opened.form }
      }),

    preview: async (id) => {
      const copy = await store.read(id)
      if (!copy.ok) return { id, missing: copy.error }
      const { facts, bytes } = copy
      if (facts.kind === 'text')
        return { id, thumbnail: null, firstLines: firstLinesOf(facts.text) }
      if (facts.kind === 'pdf') return { id, thumbnail: null, firstLines: null }
      const thumbnail =
        facts.mediaType === 'image/png' || facts.mediaType === 'image/jpeg'
          ? images.thumbnail(bytes, THUMBNAIL_EDGE)
          : `data:${facts.mediaType};base64,${bytes.toString('base64')}`
      return { id, thumbnail, firstLines: null }
    },

    hold: (id) => {
      if (isAttachmentId(id)) held.add(id)
    },
    release: (id) => {
      held.delete(id)
    },

    deleteUnused: (candidates, referenced) =>
      inOrder(async () => {
        let deleted = 0
        let failed = 0
        for (const id of new Set(candidates)) {
          if (!isAttachmentId(id) || referenced.has(id) || held.has(id)) continue
          if (await removeCopy(id)) deleted += 1
          else failed += 1
        }
        return { deleted, failed }
      }),

    sweep: (referenced, olderThanMs) =>
      inOrder(async () => {
        await ensureScanned()
        let names: string[] = []
        try {
          names = await fs.readdir(dir)
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        }
        const cutoff = now() - olderThanMs
        const ids = new Set<string>()
        for (const name of names) {
          const match = COPY_NAME.exec(name)
          if (match === null) continue
          const id = match[1]
          if (referenced.has(id) || held.has(id)) continue
          const stat = await fs.stat(join(dir, name)).catch(() => null)
          if (stat !== null && stat.isFile() && stat.mtimeMs < cutoff) ids.add(id)
        }
        let deleted = 0
        let failed = 0
        for (const id of ids) {
          if (await removeCopy(id)) deleted += 1
          else failed += 1
        }
        return { deleted, failed }
      }),

    conform: async () => {
      const ids = await inOrder(async () => {
        await ensureScanned()
        return [...index.keys()]
      })
      const result: AttachmentConformResult = { changed: 0, already: 0, failed: 0 }
      for (const id of ids) {
        const outcome = await inOrder(async (): Promise<keyof AttachmentConformResult | null> => {
          try {
            const mode = await writeMode()
            if ('refused' in mode) return 'failed'
            const read = await readCopy(id)
            if (read === null) {
              index.delete(id) // gone since the folder was looked at
              return null
            }
            if (!read.ok) return 'failed' // damaged, or its key gone: left exactly as it is
            // A leftover ".tmp" is rewritten even when the form is right: the write removes it (a plain one must not linger beside a sealed copy).
            const tmpThere = await fs.access(join(dir, `${id}.tmp`)).then(
              () => true,
              () => false
            )
            const real = await readAt(join(dir, id), id)
            if (real !== null && real.ok && real.form === mode.form && !tmpThere) return 'already'
            await writeCopy(id, read.bytes, mode.form)
            const again = await readAt(join(dir, id), id)
            return again !== null &&
              again.ok &&
              again.form === mode.form &&
              again.bytes.equals(read.bytes)
              ? 'changed'
              : 'failed'
          } catch (error) {
            console.error(
              `Rewriting an attachment failed (${error instanceof Error ? error.message : error}); it was left as it was.`
            )
            return 'failed'
          }
        })
        if (outcome !== null) result[outcome] += 1
      }
      return result
    },

    counts: () =>
      inOrder(async () => {
        await ensureScanned()
        let bytes = 0
        let encrypted = 0
        for (const entry of index.values()) {
          bytes += entry.size
          if (entry.sealed) encrypted += 1
        }
        return { files: index.size, bytes, plain: index.size - encrypted, encrypted }
      }),

    whenIdle: () => queue.then(() => undefined)
  }
  return store
}
