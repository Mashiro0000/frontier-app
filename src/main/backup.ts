import { createHash } from 'crypto'
import { promises as fs } from 'fs'
import { isAttachmentId } from '../shared/attachments'
import { HISTORY_LIMITS, type SavedConversation } from '../shared/ipc'
import { parseNote, type Note } from '../shared/memory'
import type { Project } from '../shared/projects'
import { isConversationId } from '../shared/validate'
import { factsOf, MAX_KEPT_BYTES } from './attachmentStore'
import { fileVersion, parseSavedFile } from './conversationStore'
import { parseProject } from './projects'

// The backup file (D-034): saved chats written out to ONE plain text file the person keeps wherever they like, and read back in. No Electron
// imports, so it can be checked under plain Node with any folder.
//
// The file is JSON Lines, UTF-8, one JSON object per line:
//   line 1      {"format":"frontier-chats","version":1,"exportedAt":<ms>}
//   chat lines  {"n":1,"sha256":"<64 hex>","chat":{...the chat exactly as its own file holds it...}}   (n counts from 1)
//   last line   {"end":true,"count":<how many chat lines>,"leftOut":<saved files that could not be read, so are not here>}
// VERSION 2 (Stage 9.5, D-037) is written only when a chat in the backup carries files, so a backup without files is what it always was. After the
// chat lines it has one line for each file those chats name (once, however often they name it), and its last line counts them:
//   file lines  {"file":"<64 hex: its id, the SHA-256 of its bytes>","data":"<its bytes, base64>"}    (the PLAIN bytes, even of a sealed copy)
//   last line   {"end":true,"count":...,"leftOut":...,"files":<how many file lines>,"filesLeftOut":<copies that could not be read, so are not here>}
// A file line is checked as a copy in the app's folder is (its bytes hash to its id, and they are a file the app keeps) and one that is not is set aside,
// counted apart from the chats. This version still reads version 1.
// VERSION 3 (Stage 10.7, D-039) is written only when a backup of every chat is made and the person has projects or notes. Right after the header it has
// one line for each project and one for each note, each with the checksum of what it holds, BEFORE the chats (so a restore knows every project before
// it meets a chat of one); then the chats and the file lines as in version 2 (a project's files are file lines too); and its last line counts them all:
//   project lines {"project":{...as projects.json holds it...},"sha256":"<64 hex>"}
//   note lines    {"note":{...as memory.json holds it...},"sha256":"<64 hex>"}
//   last line     {"end":true,"count":...,"leftOut":...,"files":...,"filesLeftOut":...,"projects":<project lines>,"notes":<note lines>}
// A project or note line is checked as its own file would check it; one after the first chat line is not used. Versions 1 and 2 still read.
// Why lines and not one JSON object: a file that was cut off (a copy that stopped, a full disk) still gives back every chat before the cut, and
// can say so, where one big object would give back nothing; and a reader never needs more memory than one chat. Why a checksum on each chat: a
// byte that changed inside a message still parses as JSON, so nothing else would notice; with the checksum a changed chat is refused, named by
// its line, and the others are unaffected. (The checksum guards against damage, not against a person who rewrites both the chat and its
// checksum: the file is the owner's own.) The trailer is what tells a whole file from a cut-off one.
//
// Reading never writes anything and never needs more memory than one line: the file is read in pieces, a line that grows past the largest chat
// is skipped without being kept, and how many chats are looked at is capped. Writing follows D-016: the new file is written beside the real
// one as "<name>.part", read back and checked with THIS reader, and only then copied over the real path (and read back again), so a crash or a
// full disk can never leave the person with a damaged file where a good backup used to be.

export const BACKUP_FORMAT = 'frontier-chats'
export const BACKUP_VERSION = 1
/** A backup that holds attached files (D-037). */
export const BACKUP_VERSION_FILES = 2
/** A backup that holds the projects and the notes (D-039, 10.7). */
export const BACKUP_VERSION_KEPT = 3

export const BACKUP_LIMITS = {
  /** One line: the largest chat file (HISTORY_LIMITS.maxFileBytes) plus the few bytes that wrap it. A longer line is skipped unread. */
  maxLineBytes: HISTORY_LIMITS.maxFileBytes + 4096,
  /** One file line (version 2): the largest attached file as base64, and its id. */
  maxFileLineBytes: Math.ceil(MAX_KEPT_BYTES / 3) * 4 + 4096,
  /** A file larger than this is not read, and one that would be larger is not written. Far above any real history (1000 chats of 22 KB are 22 MB). */
  maxFileBytes: 2 * 1024 * 1024 * 1024,
  /** More chat lines than the app can hold are not looked at. */
  maxChats: HISTORY_LIMITS.maxConversations,
  /** How many unusable lines are kept with their reasons (the count is always exact). */
  keptRefusals: 20
} as const

const READ_PIECE_BYTES = 64 * 1024
const HASH = /^[0-9a-f]{64}$/

const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex')
const sameList = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((one, index) => one === b[index])
const sha256Bytes = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex')
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/
const FILE_LINE_START = Buffer.from('{"file":', 'utf8')
const isCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0

/** The text of a project and of a note as written in a backup (version 3): the fields in the order their own files write them. */
export const projectText = ({
  id,
  name,
  instructions,
  files,
  createdAt,
  updatedAt
}: Project): string => JSON.stringify({ id, name, instructions, files, createdAt, updatedAt })
export const noteText = ({ id, text, scope, createdAt, updatedAt }: Note): string =>
  JSON.stringify({ id, text, scope, createdAt, updatedAt })

/**
 * The text of a chat as written in a backup: its own file's text (version 3, or 4 for a chat with files, D-037), which is also what the checksum is of.
 * The files a chat carries follow the chats, as file lines (version 2).
 */
export const chatText = (chat: SavedConversation): string =>
  JSON.stringify({ version: fileVersion(chat), ...chat })

/** Whether two chats are the same chat: the same dates, instructions and messages (the title follows from the messages). */
export const contentKey = (chat: SavedConversation): string =>
  sha256(JSON.stringify([chat.createdAt, chat.updatedAt, chat.instructions, chat.messages]))

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Reading

/** Splits a file into lines without ever holding more than `maxLine` bytes of one: a longer line comes out as 'too-long' and is dropped as it is read. */
async function* readLines(
  handle: fs.FileHandle,
  size: number,
  maxLine: number
): AsyncGenerator<Buffer | 'too-long'> {
  const piece = Buffer.allocUnsafe(READ_PIECE_BYTES)
  let parts: Buffer[] = []
  let have = 0
  let tooLong = false
  let position = 0
  while (position < size) {
    const { bytesRead } = await handle.read(
      piece,
      0,
      Math.min(piece.length, size - position),
      position
    )
    if (bytesRead === 0) break // the file got shorter while it was read: what was read is what there is
    position += bytesRead
    const view = piece.subarray(0, bytesRead)
    let start = 0
    for (;;) {
      const newline = view.indexOf(0x0a, start)
      const end = newline === -1 ? view.length : newline
      if (!tooLong && end > start) {
        if (have + (end - start) > maxLine) {
          tooLong = true
          parts = []
          have = 0
        } else {
          parts.push(Buffer.from(view.subarray(start, end))) // a copy: `piece` is reused for the next read
          have += end - start
        }
      }
      if (newline === -1) break
      if (tooLong) yield 'too-long'
      else if (have > 0) yield Buffer.concat(parts, have)
      parts = []
      have = 0
      tooLong = false
      start = newline + 1
    }
  }
  if (tooLong) yield 'too-long'
  else if (have > 0) yield Buffer.concat(parts, have)
}

/** One file line of a version 2 backup, checked: its id and its bytes, or why it cannot be used. */
function fileOfLine(line: Record<string, unknown>): { id: string; bytes: Buffer } | string {
  const keys = Object.keys(line)
  if (keys.length !== 2 || keys[0] !== 'file' || keys[1] !== 'data') return 'it is not a file line'
  const { file: id, data } = line
  if (!isAttachmentId(id)) return 'its id is not usable'
  if (typeof data !== 'string' || data.length % 4 !== 0 || !BASE64.test(data)) {
    return 'its data is not base64'
  }
  if (data.length > Math.ceil(MAX_KEPT_BYTES / 3) * 4)
    return 'it is larger than any attached file can be'
  const bytes = Buffer.from(data, 'base64')
  if (sha256Bytes(bytes) !== id) {
    return 'it does not match its id: it was changed or damaged after the backup was made'
  }
  if (factsOf(bytes) === null) return 'it is not a file the app keeps'
  return { id, bytes }
}

/** One project or note line of a version 3 backup, checked: what it holds, or why it cannot be used. */
function keptOfLine(
  line: Record<string, unknown>,
  kind: 'project' | 'note'
): Project | Note | string {
  const keys = Object.keys(line)
  if (keys.length !== 2 || keys[0] !== kind || keys[1] !== 'sha256')
    return `it is not a ${kind} line`
  const value = line[kind]
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return `it is not a ${kind}`
  const claimed = line.sha256
  if (
    typeof claimed !== 'string' ||
    !HASH.test(claimed) ||
    claimed !== sha256(JSON.stringify(value))
  ) {
    return 'it does not match its checksum: it was changed or damaged after the backup was made'
  }
  const checked = kind === 'project' ? parseProject(value) : parseNote(value)
  return checked ?? `it is not a ${kind} this app can keep`
}

/** What a version 3 backup's project or note lines came to. */
export interface KeptCounts {
  seen: number
  good: number
  refusedCount: number
  refused: { line: number; why: string }[]
}

export interface BackupRead {
  /** Null if the file is not a backup this app can read (see `problem`); nothing was looked at then. */
  header: { exportedAt: number } | null
  /** Why the file could not be read at all, in a sentence for the person. */
  problem: string | null
  /** Chat lines looked at, how many were usable, and how many were not (with the first few reasons). */
  seen: number
  good: number
  refusedCount: number
  refused: { line: number; why: string }[]
  /** What the last line says, or null if the file ends without one (cut off). Version 2 counts the file lines too. */
  trailer: {
    count: number
    leftOut: number
    files?: number
    filesLeftOut?: number
    projects?: number
    notes?: number
  } | null
  /** The file is whole: it has its last line, that line's count is the number of chat lines, and they are numbered 1, 2, 3 ... with nothing after the end. */
  complete: boolean
  /** The file has more chat lines than the app can hold; the rest were not looked at. */
  tooMany: boolean
  /** Version 2 (D-037): the file lines looked at, how many were usable, and how many were not (with the first few reasons). Absent for version 1. */
  files?: {
    seen: number
    good: number
    refusedCount: number
    refused: { line: number; why: string }[]
  }
  /** Version 3 (D-039): the project and note lines looked at, and what they came to. Absent for versions 1 and 2. */
  kept?: { projects: KeptCounts; notes: KeptCounts }
}

/** What a version 3 backup's projects and notes are handed to, each once it has passed its checks. */
export interface KeptReaders {
  project?(project: Project, line: number): Promise<void> | void
  note?(note: Note, line: number): Promise<void> | void
}

/**
 * Reads a backup, one chat at a time, and hands each USABLE chat to `onChat` (after its checksum, its id and the same strict check as a saved
 * file's contents). It never throws for a damaged file: a damaged file is a result. It throws only if `onChat` does, or the disk fails
 * in a way that is not the file's fault.
 */
export async function readBackup(
  path: string,
  onChat: (chat: SavedConversation, hash: string, line: number) => Promise<void> | void,
  onFile?: (id: string, bytes: Buffer, line: number) => Promise<void> | void,
  onKept?: KeptReaders
): Promise<BackupRead> {
  const result: BackupRead = {
    header: null,
    problem: null,
    seen: 0,
    good: 0,
    refusedCount: 0,
    refused: [],
    trailer: null,
    complete: false,
    tooMany: false
  }
  const refuse = (line: number, why: string): void => {
    result.refusedCount += 1
    if (result.refused.length < BACKUP_LIMITS.keptRefusals) result.refused.push({ line, why })
  }
  const stop = (problem: string): BackupRead => {
    result.problem = problem
    return result
  }

  let handle: fs.FileHandle
  try {
    handle = await fs.open(path, 'r')
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    return stop(code === 'ENOENT' ? 'That file is not there.' : 'That file could not be opened.')
  }
  try {
    const info = await handle.stat()
    if (!info.isFile()) return stop('That is not a file.')
    if (info.size > BACKUP_LIMITS.maxFileBytes)
      return stop('That file is too large to be a backup.')
    if (info.size === 0) return stop('That file is empty.')

    const decoder = new TextDecoder('utf-8', { fatal: true })
    let lineNumber = 0
    let ended = false // the last line has been read
    let afterTheEnd = false // and something came after it
    let numbering = true // every chat line had the number it should
    // Lines are read up to the size of a file line; a line longer than any chat that is not a file line of version 2 is treated as before.
    const longest = Math.max(BACKUP_LIMITS.maxLineBytes, BACKUP_LIMITS.maxFileLineBytes)
    for await (const piece of readLines(handle, info.size, longest)) {
      lineNumber += 1
      const fileSized =
        result.files !== undefined &&
        piece !== 'too-long' &&
        piece.subarray(0, FILE_LINE_START.length).equals(FILE_LINE_START)
      const raw =
        piece !== 'too-long' && piece.length > BACKUP_LIMITS.maxLineBytes && !fileSized
          ? 'too-long'
          : piece
      // The header is the first line, and until it is understood nothing else is.
      if (result.header === null) {
        let first: unknown
        try {
          if (raw === 'too-long') throw new Error('too long')
          first = JSON.parse(decoder.decode(raw).trim())
        } catch {
          return stop('That file is not a Frontier chat backup.')
        }
        const header = first as Record<string, unknown> | null
        if (typeof header !== 'object' || header === null || header.format !== BACKUP_FORMAT) {
          return stop('That file is not a Frontier chat backup.')
        }
        if (
          header.version !== BACKUP_VERSION &&
          header.version !== BACKUP_VERSION_FILES &&
          header.version !== BACKUP_VERSION_KEPT
        ) {
          return stop(
            'That backup was made by another version of the app, and this one cannot read it.'
          )
        }
        if (!isCount(header.exportedAt)) return stop('That file is not a Frontier chat backup.')
        result.header = { exportedAt: header.exportedAt }
        if (header.version === BACKUP_VERSION_FILES || header.version === BACKUP_VERSION_KEPT) {
          result.files = { seen: 0, good: 0, refusedCount: 0, refused: [] }
        }
        if (header.version === BACKUP_VERSION_KEPT) {
          const counts = (): KeptCounts => ({ seen: 0, good: 0, refusedCount: 0, refused: [] })
          result.kept = { projects: counts(), notes: counts() }
        }
        continue
      }
      // Whatever comes after the last line is not part of the backup, and is not read (two backups joined, or something appended).
      if (ended) {
        afterTheEnd = true
        refuse(lineNumber, 'it comes after the end of the backup')
        continue
      }
      let value: unknown = undefined
      let unreadableLine: string | null = null
      if (raw === 'too-long') {
        unreadableLine = 'it is larger than any chat can be'
      } else {
        try {
          value = JSON.parse(decoder.decode(raw).trim()) // trim: a line ending of CR LF (an editor, a copy through another system) is tolerated
        } catch {
          // A line that does not parse is, at the end of a file, a line that was cut off; in the middle it is damage. Either way it is a chat lost.
          unreadableLine = 'it is cut off or not readable text'
        }
      }
      const line = value as Record<string, unknown> | null
      if (
        unreadableLine === null &&
        typeof line === 'object' &&
        line !== null &&
        line.end === true
      ) {
        if (result.files === undefined && isCount(line.count) && isCount(line.leftOut)) {
          result.trailer = { count: line.count, leftOut: line.leftOut }
        } else if (
          result.files !== undefined &&
          isCount(line.count) &&
          isCount(line.leftOut) &&
          isCount(line.files) &&
          isCount(line.filesLeftOut) &&
          (result.kept === undefined || (isCount(line.projects) && isCount(line.notes)))
        ) {
          result.trailer = {
            count: line.count,
            leftOut: line.leftOut,
            files: line.files,
            filesLeftOut: line.filesLeftOut,
            ...(result.kept !== undefined
              ? { projects: line.projects as number, notes: line.notes as number }
              : {})
          }
        } else {
          refuse(lineNumber, 'its last line is not understood')
        }
        ended = true
        continue
      }
      // Version 3: a project or a note (D-039). Only before the chats: a restore must know every project before it meets one of its chats.
      const keptKind =
        result.kept !== undefined &&
        unreadableLine === null &&
        typeof line === 'object' &&
        line !== null &&
        !Array.isArray(line)
          ? 'project' in line
            ? 'project'
            : 'note' in line
              ? 'note'
              : null
          : null
      if (keptKind !== null && result.kept !== undefined && line !== null) {
        const counts = keptKind === 'project' ? result.kept.projects : result.kept.notes
        counts.seen += 1
        const value =
          result.seen > 0 || (result.files?.seen ?? 0) > 0
            ? `it comes after the chats, where a ${keptKind} cannot be`
            : keptOfLine(line, keptKind)
        if (typeof value === 'string') {
          counts.refusedCount += 1
          if (counts.refused.length < BACKUP_LIMITS.keptRefusals) {
            counts.refused.push({ line: lineNumber, why: value })
          }
        } else if (keptKind === 'project') {
          counts.good += 1
          await onKept?.project?.(value as Project, lineNumber)
        } else {
          counts.good += 1
          await onKept?.note?.(value as Note, lineNumber)
        }
        continue
      }
      // Version 2: a line that names a file is one of the backup's files, not a chat (D-037). It holds no place among the chats.
      if (
        result.files !== undefined &&
        unreadableLine === null &&
        typeof line === 'object' &&
        line !== null &&
        !Array.isArray(line) &&
        'file' in line
      ) {
        const files = result.files
        files.seen += 1
        const file = fileOfLine(line)
        if (typeof file === 'string') {
          files.refusedCount += 1
          if (files.refused.length < BACKUP_LIMITS.keptRefusals) {
            files.refused.push({ line: lineNumber, why: file })
          }
        } else {
          files.good += 1
          await onFile?.(file.id, file.bytes, lineNumber)
        }
        continue
      }
      // Anything else is a chat line, and is counted as one whether or not it can be used: the last line says how many there were.
      if (result.seen >= BACKUP_LIMITS.maxChats) {
        result.tooMany = true
        break
      }
      result.seen += 1
      // A line that cannot be used still holds its place: it is one of the lines the last line counts, and the chats after it keep their numbers.
      if (unreadableLine !== null) {
        refuse(lineNumber, unreadableLine)
        continue
      }
      if (typeof line !== 'object' || line === null || Array.isArray(line)) {
        refuse(lineNumber, 'it is not a chat')
        continue
      }
      if (line.n !== result.seen) numbering = false
      const { sha256: claimed, chat } = line
      if (typeof chat !== 'object' || chat === null || Array.isArray(chat)) {
        refuse(lineNumber, 'it is not a chat')
        continue
      }
      const id = (chat as Record<string, unknown>).id
      if (!isConversationId(id)) {
        refuse(lineNumber, 'its id is not usable')
        continue
      }
      const hash = sha256(JSON.stringify(chat))
      if (typeof claimed !== 'string' || !HASH.test(claimed) || claimed !== hash) {
        refuse(
          lineNumber,
          'it does not match its checksum: it was changed or damaged after the backup was made'
        )
        continue
      }
      const checked = parseSavedFile(chat, id)
      if (typeof checked === 'string') {
        refuse(lineNumber, checked)
        continue
      }
      result.good += 1
      await onChat(checked, hash, lineNumber)
    }
    if (result.header === null) return stop('That file is not a Frontier chat backup.')
    result.complete =
      result.trailer !== null &&
      result.trailer.count === result.seen &&
      (result.files === undefined || result.trailer.files === result.files.seen) &&
      (result.kept === undefined ||
        (result.trailer.projects === result.kept.projects.seen &&
          result.trailer.notes === result.kept.notes.seen)) &&
      numbering &&
      !result.tooMany &&
      !afterTheEnd
    return result
  } finally {
    await handle.close().catch(() => undefined)
  }
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Writing

export interface BackupSource {
  /** The chats to write, in this order. */
  ids: readonly string[]
  /** One chat, or null if it has gone or can no longer be read (it is then counted as left out). */
  load(id: string): Promise<SavedConversation | null>
  /** Saved files that could not be read when the list was made. They are not in the backup, and the backup says how many. */
  leftOut: number
  /**
   * The plain bytes of an attached file (D-037), or null if its copy cannot be read (it is then counted as left out). Without it, or when no chat
   * written names a file, the backup is version 1.
   */
  readFile?(id: string): Promise<Buffer | null>
  /**
   * The projects and the notes (D-039, 10.7), for a backup of every chat. When there are any the backup is version 3, with them before the chats and
   * the files of the projects among its file lines.
   */
  kept?: { projects: readonly Project[]; notes: readonly Note[] }
}

export type WriteOutcome =
  | {
      ok: true
      count: number
      leftOut: number
      bytes: number
      /** Version 2: the files written, and those whose copies could not be read. */
      files?: { count: number; leftOut: number }
      /** Version 3: the projects and the notes written. */
      kept?: { projects: number; notes: number }
    }
  | { ok: false; error: string }

/**
 * Writes the chats to `dest` and proves they are there: the file is written as "<dest>.part", read back with `readBackup` (every checksum,
 * every id, the count, the last line), copied over `dest`, read back again, and only then is the ".part" removed. If anything fails the old
 * `dest` is untouched or, once the copy has begun, a whole ".part" is kept beside it and named in the error. Throws only for a disk fault
 * before the copy began; the caller turns it into a sentence.
 */
export async function writeBackup(
  dest: string,
  source: BackupSource,
  now: number
): Promise<WriteOutcome> {
  const part = `${dest}.part`
  const written: { id: string; hash: string }[] = []
  // The files the written chats name, in the order they are first named, and what became of them (version 2).
  const named = new Set<string>()
  const filesWritten: string[] = []
  let filesGone = 0
  let withFiles = false
  const kept = source.kept
  const withKept = kept !== undefined && kept.projects.length + kept.notes.length > 0
  const keptWritten = { projects: [] as string[], notes: [] as string[] }
  let bytes = 0
  let gone = 0
  const discard = (): Promise<void> => fs.rm(part, { force: true }).catch(() => undefined)
  const handle = await fs.open(part, 'w', 0o600)
  let tooLarge = false
  try {
    const put = async (line: string): Promise<void> => {
      bytes += Buffer.byteLength(line)
      if (bytes > BACKUP_LIMITS.maxFileBytes) {
        tooLarge = true
        return
      }
      await handle.write(line)
    }
    const header = JSON.stringify({
      format: BACKUP_FORMAT,
      version: withKept ? BACKUP_VERSION_KEPT : BACKUP_VERSION,
      exportedAt: now
    })
    await put(`${header}\n`)
    // Version 3: the projects and the notes first, then the chats (D-039). A project's files are written with the chats' files.
    if (withKept && kept !== undefined) {
      for (const project of kept.projects) {
        const text = projectText(project)
        await put(`{"project":${text},"sha256":"${sha256(text)}"}\n`)
        keptWritten.projects.push(project.id)
        for (const file of project.files) named.add(file.id)
      }
      for (const note of kept.notes) {
        const text = noteText(note)
        await put(`{"note":${text},"sha256":"${sha256(text)}"}\n`)
        keptWritten.notes.push(note.id)
      }
    }
    for (const id of source.ids) {
      if (tooLarge) break
      const chat = await source.load(id)
      if (chat === null) {
        gone += 1
        continue
      }
      const text = chatText(chat)
      const hash = sha256(text)
      written.push({ id: chat.id, hash })
      await put(`{"n":${written.length},"sha256":"${hash}","chat":${text}}\n`)
      for (const message of chat.messages) {
        for (const file of message.attachments ?? []) named.add(file.id)
      }
    }
    // Version 2 when a written chat names a file and the files can be read: one line for each, then the trailer that counts them. The header was
    // written as version 1; once everything else is written, its one digit is changed in place (the two headers are the same length).
    withFiles = source.readFile !== undefined && named.size > 0
    if (withFiles && source.readFile !== undefined) {
      for (const id of named) {
        if (tooLarge) break
        const data = await source.readFile(id)
        if (data === null) {
          filesGone += 1
          continue
        }
        await put(`{"file":"${id}","data":"${data.toString('base64')}"}\n`)
        filesWritten.push(id)
      }
    }
    if (!tooLarge) {
      await put(
        `${JSON.stringify({
          end: true,
          count: written.length,
          leftOut: source.leftOut + gone,
          ...(withFiles || withKept ? { files: filesWritten.length, filesLeftOut: filesGone } : {}),
          ...(withKept
            ? { projects: keptWritten.projects.length, notes: keptWritten.notes.length }
            : {})
        })}\n`
      )
      if (withFiles && !withKept) {
        await handle.write(String(BACKUP_VERSION_FILES), header.indexOf('"version":1') + 10)
      }
    }
    if (!tooLarge) await handle.sync()
    await handle.close()
  } catch (error) {
    await handle.close().catch(() => undefined)
    await discard() // a disk that failed halfway: nothing of the half-written file is left lying about
    throw error
  }
  if (tooLarge) {
    await discard()
    return {
      ok: false,
      error: 'These chats are too large for one backup file. Back up fewer of them.'
    }
  }

  // The same proof for both copies: the file reads back whole, and holds exactly what was written, in the order it was written.
  const proves = async (path: string): Promise<boolean> => {
    const seen: { id: string; hash: string }[] = []
    const seenFiles: string[] = []
    const seenKept = { projects: [] as string[], notes: [] as string[] }
    const read = await readBackup(
      path,
      (chat, hash) => {
        seen.push({ id: chat.id, hash })
      },
      (id) => {
        seenFiles.push(id)
      },
      {
        project: (project) => {
          seenKept.projects.push(project.id)
        },
        note: (note) => {
          seenKept.notes.push(note.id)
        }
      }
    )
    return (
      read.problem === null &&
      read.complete &&
      read.refusedCount === 0 &&
      read.trailer?.count === written.length &&
      seen.length === written.length &&
      seen.every(
        (one, index) => one.id === written[index].id && one.hash === written[index].hash
      ) &&
      (read.files === undefined
        ? !withFiles && !withKept
        : (withFiles || withKept) &&
          read.files.refusedCount === 0 &&
          seenFiles.length === filesWritten.length &&
          seenFiles.every((id, index) => id === filesWritten[index])) &&
      (read.kept === undefined
        ? !withKept
        : withKept &&
          read.kept.projects.refusedCount === 0 &&
          read.kept.notes.refusedCount === 0 &&
          sameList(seenKept.projects, keptWritten.projects) &&
          sameList(seenKept.notes, keptWritten.notes))
    )
  }
  if (!(await proves(part))) {
    await discard()
    return {
      ok: false,
      error: 'The new backup could not be read back correctly, so it was not kept.'
    }
  }
  try {
    await fs.copyFile(part, dest)
  } catch {
    return {
      ok: false,
      error: `The backup was written but could not be copied to where you chose. A whole copy is at ${part}.`
    }
  }
  if (!(await proves(dest))) {
    return {
      ok: false,
      error: `The backup was written but could not be read back correctly from where you chose. A whole copy is at ${part}.`
    }
  }
  await discard() // if this fails the ".part" only repeats the file
  return {
    ok: true,
    count: written.length,
    leftOut: source.leftOut + gone,
    bytes,
    ...(withFiles ? { files: { count: filesWritten.length, leftOut: filesGone } } : {}),
    ...(withKept
      ? { kept: { projects: keptWritten.projects.length, notes: keptWritten.notes.length } }
      : {})
  }
}
