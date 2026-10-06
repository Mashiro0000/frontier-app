import { createHash } from 'crypto'
import { promises as fs } from 'fs'
import { HISTORY_LIMITS, type SavedConversation } from '../shared/ipc'
import { isConversationId } from '../shared/validate'
import { fileVersion, parseSavedFile } from './conversationStore'

// The backup file (D-034): saved chats written out to ONE plain text file the person keeps wherever they like, and read back in. No Electron
// imports, so it can be checked under plain Node with any folder.
//
// The file is JSON Lines, UTF-8, one JSON object per line:
//   line 1      {"format":"frontier-chats","version":1,"exportedAt":<ms>}
//   chat lines  {"n":1,"sha256":"<64 hex>","chat":{...the chat exactly as its own file holds it...}}   (n counts from 1)
//   last line   {"end":true,"count":<how many chat lines>,"leftOut":<saved files that could not be read, so are not here>}
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

export const BACKUP_LIMITS = {
  /** One line: the largest chat file (HISTORY_LIMITS.maxFileBytes) plus the few bytes that wrap it. A longer line is skipped unread. */
  maxLineBytes: HISTORY_LIMITS.maxFileBytes + 4096,
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
const isCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0

/**
 * The text of a chat as written in a backup: its own file's text (version 3, or 4 for a chat with files, D-037), which is also what the checksum is of.
 * A chat with files is backed up with its files' descriptions; the files themselves are not in a backup of this version.
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
  /** What the last line says, or null if the file ends without one (cut off). */
  trailer: { count: number; leftOut: number } | null
  /** The file is whole: it has its last line, that line's count is the number of chat lines, and they are numbered 1, 2, 3 ... with nothing after the end. */
  complete: boolean
  /** The file has more chat lines than the app can hold; the rest were not looked at. */
  tooMany: boolean
}

/**
 * Reads a backup, one chat at a time, and hands each USABLE chat to `onChat` (after its checksum, its id and the same strict check as a saved
 * file's contents). It never throws for a damaged file: a damaged file is a result. It throws only if `onChat` does, or the disk fails
 * in a way that is not the file's fault.
 */
export async function readBackup(
  path: string,
  onChat: (chat: SavedConversation, hash: string, line: number) => Promise<void> | void
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
    for await (const raw of readLines(handle, info.size, BACKUP_LIMITS.maxLineBytes)) {
      lineNumber += 1
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
        if (header.version !== BACKUP_VERSION) {
          return stop(
            'That backup was made by another version of the app, and this one cannot read it.'
          )
        }
        if (!isCount(header.exportedAt)) return stop('That file is not a Frontier chat backup.')
        result.header = { exportedAt: header.exportedAt }
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
        if (isCount(line.count) && isCount(line.leftOut)) {
          result.trailer = { count: line.count, leftOut: line.leftOut }
        } else {
          refuse(lineNumber, 'its last line is not understood')
        }
        ended = true
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
}

export type WriteOutcome =
  { ok: true; count: number; leftOut: number; bytes: number } | { ok: false; error: string }

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
    await put(
      `${JSON.stringify({ format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt: now })}\n`
    )
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
    }
    if (!tooLarge) {
      await put(
        `${JSON.stringify({ end: true, count: written.length, leftOut: source.leftOut + gone })}\n`
      )
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
    const read = await readBackup(path, (chat, hash) => {
      seen.push({ id: chat.id, hash })
    })
    return (
      read.problem === null &&
      read.complete &&
      read.refusedCount === 0 &&
      read.trailer?.count === written.length &&
      seen.length === written.length &&
      seen.every((one, index) => one.id === written[index].id && one.hash === written[index].hash)
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
  return { ok: true, count: written.length, leftOut: source.leftOut + gone, bytes }
}
