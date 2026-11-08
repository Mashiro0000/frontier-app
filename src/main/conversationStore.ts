import { promises as fs } from 'fs'
import { join } from 'path'
import {
  HISTORY_LIMITS,
  type ConversationSummary,
  type SavedConversation,
  type SavedMessage
} from '../shared/ipc'
import { plainTitle } from '../shared/chatNames'
import { isProjectId } from '../shared/projects'
import { checkInstructions, checkSavedMessages, isConversationId } from '../shared/validate'
import {
  isEnvelope,
  MAX_ENCRYPTED_FILE_BYTES,
  opensTo,
  openChat,
  SEALED_PREFIX,
  sealChat,
  type FileForm,
  type WriteMode
} from './chatFile'
import type { SecretBox } from './credentialStore'

// The saved conversations: one small JSON file per conversation, all in one folder (D-016). No Electron
// imports, so it can be checked under plain Node with any folder.
//
// Writing follows D-010: never "write a temp file, then rename it over the real one", because every rename
// fails with EXDEV in this project's own EFS-encrypted %APPDATA%. But a conversation, unlike the key or the
// model choice, is something a person does not want to lose to a torn write, so a save is three steps:
//   1. write the whole new text to "<id>.json.tmp" and read it back (it is now complete and checked),
//   2. copy it over "<id>.json" and read that back,
//   3. delete the ".tmp".
// A crash between the steps leaves one of two states, and reading tells them apart: a ".tmp" that parses is
// always at least as new as the real file (it is written first, deleted last), so a parseable ".tmp" wins; a
// ".tmp" that does not parse was cut off in step 1, and then the real file is still the untouched old copy.
// A cut-off JSON object never parses, so a torn write cannot pass for a whole one.
//
// Reading never writes: a conversation that cannot be read is left exactly as it is, counted, and named in the
// log (by its id, never by a path). Nothing here deletes a file except remove().
//
// The file is "version": 3 since Stage 7.4 (D-027): it also holds the person's instructions for the chat ("" for none). Version 2
// (Stages 5.4-7.3, D-021: each reply says which provider and model wrote it) is read as a version 3 one with no instructions, and
// a version 1 file (Stages 2-4) as a version 2 one (its replies came from Anthropic, which model is not known) with no
// instructions. Both stay as they are on disk, byte for byte, until the conversation is next saved. Nothing is converted in bulk
// (with ONE exception, below), so no crash can leave the history half-converted. A file of any other version was made by another version of the app and is
// left alone.
//
// ENCRYPTION (Stage 8b.3 and 8b.4, D-035). A chat's file is either plain (the JSON above) or ENCRYPTED: the same name, holding an envelope that the secure
// storage sealed the plain text into (chatFile.ts). Reading takes either (an envelope is opened first, and what it holds goes through the same strict
// check), so a folder with both, which a conversion that was cut short leaves, is fine. HOW A WRITE IS MADE is not decided here: `writeMode` (from
// chatProtection.ts) is asked before EVERY write, and either names the form or REFUSES, and then nothing is written (no plain fallback, no new key).
// A file that cannot be opened is read as unreadable, left exactly as it is, and counted (`unopened` says how many of those are encrypted).
// FILES (Stage 9.3, D-037). A message of the person's may carry files: each described in full (`attachments`, what it was when attached); the copies
// themselves are in attachments/ (attachmentStore.ts), named by their hash. A chat with files is written as VERSION 4, which a build from before
// Stage 9 leaves alone (it is "made by another version"); a chat without files is still written as version 3, byte for byte what it was. The store
// keeps, for every chat it has read, the ids of its files, so that the files no chat uses can be found (`attachmentRefs`).
// The exception to "nothing is converted in bulk": `conform()` rewrites every readable chat in the form the choice now says, one at a time, when the
// person turns encryption on or off. Each file is rewritten by the same three steps, proved by opening what was written, and read again after; a chat
// that cannot be rewritten is left as it was. A chat's dates, title and instructions are kept as they are, and a version 1 or 2 file comes out as version 3.

// "<id>.json" or "<id>.json.tmp", with the id in the one spelling the app itself produces (lower case: Windows
// treats upper and lower case as the same file, so two spellings of one id would be one file).
const FILE_NAME = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.json(\.tmp)?$/

const SCAN_AT_A_TIME = 16

// The caller has already checked the id (ipc.ts), and it is checked again here: it becomes part of a path.
function assertId(id: unknown): asserts id is string {
  if (!isConversationId(id)) throw new Error('that is not a conversation id')
}

export type SaveOutcome = { ok: true; summary: ConversationSummary } | { ok: false; error: string }
export type LoadOutcome =
  { ok: true; conversation: SavedConversation } | { ok: false; error: string }
export type RemoveOutcome = { ok: true } | { ok: false; error: string }
/**
 * Why a chat brought in from a backup was not added (D-034): `occupied` = something is already saved under that id; `full` and `too-large` as for a save;
 * `blocked` = nothing may be written now (D-035: the key that protects the chats cannot be used, or the choice cannot be read).
 */
export type AddOutcome =
  | { ok: true; summary: ConversationSummary }
  | { ok: false; why: 'occupied' | 'full' | 'too-large' | 'blocked'; error: string }
/** What is saved under an id, for deciding what to do with a chat in a backup. `damaged`: a file is there (or was) that cannot be read. */
export type Inspection =
  { kind: 'free' } | { kind: 'here'; conversation: SavedConversation } | { kind: 'damaged' }

/** How the saved chats are kept (D-035): the readable ones by the form of their file, and the files that could not be read. */
export interface StoreCounts {
  plain: number
  encrypted: number
  unreadable: number
  /** Of `unreadable`: files that are encrypted and could not be opened (another key, a lost key, damage). */
  unopened: number
}

/** What `conform` did: files rewritten, files already in the form, and files that could not be rewritten (left exactly as they were). */
export interface ConformResult {
  changed: number
  already: number
  failed: number
}

export interface ConversationStoreOptions {
  /** The secure storage, to open encrypted files and to make them. Without it the store has only plain files: an encrypted file cannot be opened. */
  box?: SecretBox
  /** How the next write must be made, or why none may be (chatProtection.ts). Without it every write is plain. */
  writeMode?: () => Promise<WriteMode>
}

export interface ConversationStore {
  /**
   * The ids of the files every readable chat uses (D-037), and whether that is every chat: with a file that could not be read (a damaged one, or its key
   * gone), the files it uses are not known, and nothing may be deleted on the strength of this list.
   */
  attachmentRefs(): Promise<{ ids: Set<string>; complete: boolean }>
  /** The ids of the files one chat uses ([] for a chat that is not listed). */
  attachmentsOf(id: string): Promise<string[]>
  /** Every readable conversation, newest first, and how many files could not be read (and were left alone). */
  list(): Promise<{ conversations: ConversationSummary[]; unreadable: number }>
  /** How many chats are kept plain and how many encrypted, and how many files could not be read (D-035). */
  counts(): Promise<StoreCounts>
  /** Why nothing can be written right now (the key cannot be used, the choice cannot be read), or null (D-035). Looks at nothing on disk but the choice. */
  blocked(): Promise<string | null>
  /**
   * Rewrites every readable chat in the form the choice says now (D-035): to encrypted after the person turned encryption on, to plain after they turned
   * it off, or the rest of either after it was cut short. One chat at a time, so that saving goes on meanwhile; each is proved by opening what was written
   * and reading it again. A chat that cannot be rewritten, and every file that could not be read, is left exactly as it was. Writes nothing while writing is refused.
   */
  conform(): Promise<ConformResult>
  load(id: string): Promise<LoadOutcome>
  /**
   * Saves the whole conversation (a snapshot, not a change). Throws if the disk refuses, and then the earlier
   * saved copy is still there; answers `ok: false` for a refusal that is not a failure (too many, too large).
   * `instructions` is the person's own text for the chat, already checked (D-027); absent is none.
   */
  save(input: {
    id: string
    messages: SavedMessage[]
    instructions?: string
    /** The project the chat belongs to (D-039, 10.5): a project id, or absent for none. Then the file is version 5. */
    project?: string
  }): Promise<SaveOutcome>
  remove(id: string): Promise<RemoveOutcome>
  /**
   * Looks at what is saved under an id without changing anything (D-034).
   */
  inspect(id: string): Promise<Inspection>
  /**
   * Saves a chat that comes from a backup (D-034), exactly as it is: its id, its dates and its instructions are kept, only the title is worked out
   * again. Unlike `save` it NEVER replaces anything: if a file, a half-written copy or a damaged file is already there under the id, it answers
   * `occupied` and writes nothing. The file is written like any other (a ".tmp" first, read back, copied, read back).
   */
  add(conversation: SavedConversation): Promise<AddOutcome>
  /** Resolves when every save and removal asked for so far has finished. For quitting the app. */
  whenIdle(): Promise<void>
}

/** The title shown in the list: the first message the person wrote, on one line, cut at 60 characters. */
/**
 * The version a chat's file is written as: 7 when a message of it carries a request for pictures (D-048, 16.5; it may have tool calls, files and a project too), 6 when
 * a reply of it carries tool calls (D-041, 11.4; it may belong to a project too), 5 when it belongs to a project (D-039), 4 when a message of it carries files (D-037),
 * else 3, so a chat in no project, without files, tool calls or pictures is written exactly as before. A build from before Stage 16 leaves a version 7 file alone
 * ("made by another version").
 */
export const fileVersion = (conversation: {
  messages: readonly SavedMessage[]
  project?: string
}): 3 | 4 | 5 | 6 | 7 =>
  conversation.messages.some((message) => message.picture !== undefined)
    ? 7
    : conversation.messages.some((message) => message.tools !== undefined)
      ? 6
      : conversation.project !== undefined
        ? 5
        : conversation.messages.some((message) => message.attachments !== undefined)
          ? 4
          : 3

export function titleFor(messages: readonly SavedMessage[]): string {
  const firstMessage = messages.find((message) => message.role === 'user')
  // A first message that is only files (D-037) is named by its files.
  const first =
    firstMessage === undefined
      ? ''
      : firstMessage.content.trim() !== ''
        ? firstMessage.content
        : (firstMessage.attachments ?? []).map((file) => file.name).join(', ')
  const oneLine = first.replace(/\s+/g, ' ').trim()
  // (23.1, D-055) without Markdown's marks, which would show as they are in a list
  const plain = plainTitle(oneLine)
  const letters = Array.from(plain) // by character, so an emoji is not cut in half
  return letters.length > 60 ? `${letters.slice(0, 60).join('')}...` : plain
}

const summaryOf = (conversation: SavedConversation): ConversationSummary => ({
  id: conversation.id,
  title: conversation.title,
  updatedAt: conversation.updatedAt,
  messageCount: conversation.messages.length,
  ...(conversation.project !== undefined ? { project: conversation.project } : {})
})

const isTime = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0

/** Checks one file's contents. `id` is the id in the file's name, which the file must agree with. */
export function parseSavedFile(raw: unknown, id: string): SavedConversation | string {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return 'it is not an object'
  const file = raw as Record<string, unknown>
  if (
    file.version !== 1 &&
    file.version !== 2 &&
    file.version !== 3 &&
    file.version !== 4 &&
    file.version !== 5 &&
    file.version !== 6 &&
    file.version !== 7
  ) {
    return 'it was made by another version of the app'
  }
  if (file.id !== id) return 'the id inside does not match the file name'
  if (typeof file.title !== 'string' || file.title.length > HISTORY_LIMITS.maxTitleChars) {
    return 'its title is not usable'
  }
  if (!isTime(file.createdAt) || !isTime(file.updatedAt)) return 'its dates are not usable'
  // Instructions (D-027) belong to version 3, where the field must be there and be usable: strict, like the title, because a chat that
  // opened without the instructions it was saved with would quietly answer differently. An older file has none, and whatever such a file
  // says about them is not read (it was not made by a version that knew them).
  let instructions = ''
  if (
    file.version === 3 ||
    file.version === 4 ||
    file.version === 5 ||
    file.version === 6 ||
    file.version === 7
  ) {
    const checked =
      typeof file.instructions === 'string' ? checkInstructions(file.instructions) : null
    if (checked === null || !checked.ok) return 'its instructions are not usable'
    instructions = checked.instructions
  }
  // Files are read only from a version 4 file (D-037), which must have at least one: a version 4 file without any is not one this app writes.
  const messages = checkSavedMessages(
    file.messages,
    file.version === 1 ? 'file-v1' : 'file',
    file.version === 4 || file.version === 5 || file.version === 6 || file.version === 7,
    file.version === 6 || file.version === 7, // tool calls (D-041, 11.4) are read only from a version 6 or 7 file
    file.version === 7 // a request for pictures (D-048, 16.5) only from a version 7 file
  )
  if (!messages.ok) return messages.error
  if (
    file.version === 4 &&
    !messages.messages.some((message) => message.attachments !== undefined)
  ) {
    return 'it says it holds files and holds none'
  }
  // Tool calls are read only from a version 6 file, which must hold at least one: a version 6 file without any is not one this app writes.
  if (file.version === 6 && !messages.messages.some((message) => message.tools !== undefined)) {
    return 'it says it holds tool calls and holds none'
  }
  // A request for pictures is read only from a version 7 file, which must hold at least one.
  if (file.version === 7 && !messages.messages.some((message) => message.picture !== undefined)) {
    return 'it says it holds pictures and holds none'
  }
  // A project (D-039, 10.5) is read only from a version 5 file, which must name one by an id that is one; an older file knew no projects. A version 6 file
  // may name one or not (a chat with tool calls may be in a project or in none).
  if (file.version === 5 && !isProjectId(file.project)) return 'its project is not usable'
  if (
    (file.version === 6 || file.version === 7) &&
    file.project !== undefined &&
    !isProjectId(file.project)
  ) {
    return 'its project is not usable'
  }
  return {
    id,
    title: file.title,
    createdAt: file.createdAt,
    updatedAt: file.updatedAt,
    instructions,
    messages: messages.messages,
    ...(file.version === 5 ||
    ((file.version === 6 || file.version === 7) && file.project !== undefined)
      ? { project: file.project as string }
      : {})
  }
}

type Read =
  | { kind: 'ok'; conversation: SavedConversation; form: FileForm }
  | { kind: 'missing' }
  /** `unopened`: the file is an encrypted one that could not be opened (as opposed to a file that is damaged as text). */
  | { kind: 'bad'; why: string; unopened?: true }

/** True if the file begins like a sealed chat. Looks at its first few bytes and reads nothing else. */
async function beginsSealed(path: string): Promise<boolean> {
  const handle = await fs.open(path, 'r')
  try {
    const head = Buffer.alloc(Buffer.byteLength(SEALED_PREFIX))
    const { bytesRead } = await handle.read(head, 0, head.length, 0)
    return head.subarray(0, bytesRead).toString('utf8') === SEALED_PREFIX
  } finally {
    await handle.close().catch(() => undefined)
  }
}

async function readFileAt(path: string, id: string, box: SecretBox | undefined): Promise<Read> {
  let size: number
  try {
    size = (await fs.stat(path)).size
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { kind: 'missing' }
    throw error
  }
  // Looked at before reading, so a file of any size cannot fill the memory. A sealed chat is bigger than the chat in it, so it has a bigger limit; a file between
  // the two limits is read only if it BEGINS like a sealed chat (its first bytes are looked at, nothing else), and anything else that big is refused unread.
  if (size > MAX_ENCRYPTED_FILE_BYTES) return { kind: 'bad', why: 'the file is too large' }
  if (size > HISTORY_LIMITS.maxFileBytes && !(await beginsSealed(path))) {
    return { kind: 'bad', why: 'the file is too large' }
  }
  let text = await fs.readFile(path, 'utf8')
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1) // a byte-order mark, which some editors add
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { kind: 'bad', why: 'it is not valid JSON' }
  }
  if (isEnvelope(parsed)) {
    const opened = openChat(parsed, box)
    if (!opened.ok) return { kind: 'bad', why: opened.why, unopened: true }
    let inner: unknown
    try {
      inner = JSON.parse(opened.text)
    } catch {
      return { kind: 'bad', why: 'it is encrypted, and what it holds is not valid JSON' }
    }
    const checked = parseSavedFile(inner, id)
    return typeof checked === 'string'
      ? { kind: 'bad', why: checked }
      : { kind: 'ok', conversation: checked, form: 'encrypted' }
  }
  if (size > HISTORY_LIMITS.maxFileBytes) return { kind: 'bad', why: 'the file is too large' }
  const result = parseSavedFile(parsed, id)
  return typeof result === 'string'
    ? { kind: 'bad', why: result }
    : { kind: 'ok', conversation: result, form: 'plain' }
}

/**
 * What reading a chat gives (`null` if neither file exists). `form` is "plain" if ANY readable copy of the chat is plain, the real file or a ".tmp": a plain
 * copy on disk is exactly what encrypting is meant to get rid of, so it must not hide behind a newer encrypted ".tmp". `tmp`: a ".tmp" exists at all, whole
 * or cut off. It is a leftover of a write that did not finish (and a cut-off one can hold part of a chat as text), and the next write of the chat removes it.
 */
type ReadOutcome =
  | { conversation: SavedConversation; form: FileForm; tmp: boolean }
  | { why: string; unopened: boolean }
  | null

/** Reads one conversation, applying the recovery rule above. */
async function readConversation(
  dir: string,
  id: string,
  box: SecretBox | undefined
): Promise<ReadOutcome> {
  const file = join(dir, `${id}.json`)
  const copy = await readFileAt(`${file}.tmp`, id, box)
  if (copy.kind === 'ok') {
    // The ".tmp" wins (it is at least as new), but the real file beside it may still be a plain copy of an older version of this chat.
    const real = await readFileAt(file, id, box)
    const plain = copy.form === 'plain' || (real.kind === 'ok' && real.form === 'plain')
    return { conversation: copy.conversation, form: plain ? 'plain' : 'encrypted', tmp: true }
  }
  const real = await readFileAt(file, id, box)
  if (real.kind === 'ok') {
    return { conversation: real.conversation, form: real.form, tmp: copy.kind !== 'missing' }
  }
  if (real.kind === 'bad') return { why: real.why, unopened: real.unopened === true }
  if (copy.kind === 'bad') return { why: copy.why, unopened: copy.unopened === true }
  return null
}

const alwaysPlain = async (): Promise<WriteMode> => ({ form: 'plain' })

export function createConversationStore(
  dir: string,
  options: ConversationStoreOptions = {}
): ConversationStore {
  const { box } = options
  const writeMode = options.writeMode ?? alwaysPlain
  const index = new Map<
    string,
    { summary: ConversationSummary; createdAt: number; form: FileForm; files: string[] }
  >()
  const filesOf = (conversation: SavedConversation): string[] => [
    ...new Set(
      conversation.messages.flatMap((message) => (message.attachments ?? []).map((file) => file.id))
    )
  ]
  const unreadable = new Set<string>()
  /** The part of `unreadable` that is encrypted files that could not be opened. */
  const unopened = new Set<string>()
  let scanned: Promise<void> | null = null

  const markUnreadable = (id: string, wasEncrypted: boolean): void => {
    unreadable.add(id)
    if (wasEncrypted) unopened.add(id)
    else unopened.delete(id)
  }
  const markReadable = (id: string): void => {
    unreadable.delete(id)
    unopened.delete(id)
  }

  // One thing at a time, in the order asked for, like the model choice (D-015): a save and a removal of the
  // same conversation, or two saves, must never cross. The page sends snapshots, so the last one must win.
  let queue: Promise<unknown> = Promise.resolve()
  function inOrder<T>(task: () => Promise<T>): Promise<T> {
    const run = queue.then(task)
    queue = run.catch(() => undefined)
    return run
  }

  async function scan(): Promise<void> {
    let names: string[] = []
    try {
      names = await fs.readdir(dir)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error // no folder yet: nothing saved
    }
    const ids = [...new Set(names.flatMap((name) => FILE_NAME.exec(name)?.[1] ?? []))]
    for (let start = 0; start < ids.length; start += SCAN_AT_A_TIME) {
      await Promise.all(
        ids.slice(start, start + SCAN_AT_A_TIME).map(async (id) => {
          let wasEncrypted = false
          try {
            const read = await readConversation(dir, id, box)
            if (read === null) return
            if ('conversation' in read) {
              index.set(id, {
                summary: summaryOf(read.conversation),
                createdAt: read.conversation.createdAt,
                form: read.form,
                files: filesOf(read.conversation)
              })
              return
            }
            wasEncrypted = read.unopened
            console.warn(
              `The saved conversation ${id} could not be read (${read.why}); it was left as it is.`
            )
          } catch (error) {
            console.warn(
              `The saved conversation ${id} could not be read (${error instanceof Error ? error.message : error}); it was left as it is.`
            )
          }
          markUnreadable(id, wasEncrypted)
        })
      )
    }
  }

  // Looked at once, the first time anything asks, and kept in step by save and remove after that.
  function ensureScanned(): Promise<void> {
    scanned ??= scan().catch((error: unknown) => {
      scanned = null // try again next time instead of staying broken
      throw error
    })
    return scanned
  }

  // The three steps of D-016, for a conversation whose fields are all decided (a save decides the dates itself, a chat brought in from a
  // backup keeps its own) and a form that `writeMode` named (never one the caller picked). Called only inside `inOrder`.
  async function writeConversation(
    conversation: SavedConversation,
    form: FileForm
  ): Promise<SaveOutcome> {
    // Version 4 only for a chat with files (D-037): a chat without any is written exactly as before.
    const version = fileVersion(conversation)
    const plain = JSON.stringify({ version, ...conversation })
    // Whatever is written must be readable again, so the limit on reading is also a limit on writing.
    if (Buffer.byteLength(plain) > HISTORY_LIMITS.maxFileBytes) {
      return { ok: false, error: 'This conversation is too large to save.' }
    }
    if (form === 'encrypted' && box === undefined) {
      throw new Error('this store has no secure storage to encrypt with')
    }
    const text = form === 'encrypted' && box !== undefined ? sealChat(plain, box) : plain
    await fs.mkdir(dir, { recursive: true, mode: 0o700 })
    const file = join(dir, `${conversation.id}.json`)
    const copy = `${file}.tmp`
    await fs.writeFile(copy, text, { mode: 0o600 })
    const back = await fs.readFile(copy, 'utf8')
    // An encrypted copy must also OPEN to the same chat: the same proof the API key gets ("the saved key could not be read back").
    if (back !== text || (form === 'encrypted' && !opensTo(back, plain, box))) {
      await fs.rm(copy, { force: true }).catch(() => undefined) // cut off: the real file is still the old copy
      throw new Error('the new copy could not be read back')
    }
    // From here on the ".tmp" is whole and checked, so it is kept if anything below fails: reading uses it.
    await fs.copyFile(copy, file)
    if ((await fs.readFile(file, 'utf8')) !== text)
      throw new Error('the saved file could not be read back')
    await fs.rm(copy, { force: true }).catch(() => undefined) // if this fails the ".tmp" only repeats the file
    const summary = summaryOf(conversation)
    index.set(conversation.id, {
      summary,
      createdAt: conversation.createdAt,
      form,
      files: filesOf(conversation)
    })
    markReadable(conversation.id)
    return { ok: true, summary }
  }

  /** One chat's file brought into the form the choice says now. `null` if the chat has gone. Called only inside `inOrder`. */
  async function conformOne(id: string): Promise<keyof ConformResult | null> {
    try {
      const mode = await writeMode()
      if ('refused' in mode) return 'failed'
      const read = await readConversation(dir, id, box)
      if (read === null) {
        index.delete(id)
        return null
      }
      if (!('conversation' in read)) {
        // Damaged (or its key gone) since it was listed: it is not touched, and the list says so.
        index.delete(id)
        markUnreadable(id, read.unopened)
        return 'failed'
      }
      // A leftover ".tmp" is rewritten even when the form is right: it is removed by the write, and until then a half-finished copy sits beside the chat.
      if (read.form === mode.form && !read.tmp) return 'already'
      const written = await writeConversation(read.conversation, mode.form)
      if (!written.ok) return 'failed'
      // The proof does not rest on the write alone: the chat is read again from disk, in the form it was meant to have, and must be the same chat.
      const again = await readConversation(dir, id, box)
      const same =
        again !== null &&
        'conversation' in again &&
        again.form === mode.form &&
        JSON.stringify(again.conversation) === JSON.stringify(read.conversation)
      return same ? 'changed' : 'failed'
    } catch (error) {
      console.error(
        `Rewriting the saved conversation ${id} failed (${error instanceof Error ? error.message : error}); it was left as it was.`
      )
      return 'failed'
    }
  }

  return {
    attachmentRefs: () =>
      inOrder(async () => {
        await ensureScanned()
        const ids = new Set<string>()
        for (const entry of index.values()) for (const file of entry.files) ids.add(file)
        return { ids, complete: unreadable.size === 0 }
      }),

    attachmentsOf: (id) =>
      inOrder(async () => {
        assertId(id)
        await ensureScanned()
        return [...(index.get(id)?.files ?? [])]
      }),

    list: () =>
      inOrder(async () => {
        await ensureScanned()
        const conversations = [...index.values()]
          .map((entry) => entry.summary)
          .sort((a, b) => b.updatedAt - a.updatedAt || (a.id < b.id ? -1 : 1))
        return { conversations, unreadable: unreadable.size }
      }),

    counts: () =>
      inOrder(async (): Promise<StoreCounts> => {
        await ensureScanned()
        let encrypted = 0
        for (const entry of index.values()) if (entry.form === 'encrypted') encrypted += 1
        return {
          plain: index.size - encrypted,
          encrypted,
          unreadable: unreadable.size,
          unopened: unopened.size
        }
      }),

    blocked: async () => {
      const mode = await writeMode()
      return 'refused' in mode ? mode.refused : null
    },

    conform: async (): Promise<ConformResult> => {
      const ids = await inOrder(async () => {
        await ensureScanned()
        return [...index.keys()]
      })
      const result: ConformResult = { changed: 0, already: 0, failed: 0 }
      // One chat per turn of the queue, not the whole folder in one: a save that is asked for meanwhile takes its turn between two chats and is never kept
      // waiting for the length of a conversion (1000 chats took 109 s to write in this PC's EFS-encrypted data folder).
      for (const id of ids) {
        const outcome = await inOrder(() => conformOne(id))
        if (outcome !== null) result[outcome] += 1
      }
      return result
    },

    load: (id) =>
      inOrder(async (): Promise<LoadOutcome> => {
        assertId(id)
        await ensureScanned()
        if (!index.has(id)) return { ok: false, error: 'That conversation was not found.' }
        const read = await readConversation(dir, id, box)
        if (read !== null && 'conversation' in read)
          return { ok: true, conversation: read.conversation }
        index.delete(id) // gone, or damaged since it was listed: the list should say so too
        if (read === null) return { ok: false, error: 'That conversation was not found.' }
        markUnreadable(id, read.unopened)
        console.warn(
          `The saved conversation ${id} could not be read (${read.why}); it was left as it is.`
        )
        return { ok: false, error: 'That conversation could not be read.' }
      }),

    save: (input) =>
      inOrder(async (): Promise<SaveOutcome> => {
        assertId(input.id)
        // Whatever is written must be readable again, so the rule for reading instructions is also the rule for writing them (the caller
        // has checked them already; a chat that turned unreadable because of a bug elsewhere would be a loss).
        const checkedInstructions = checkInstructions(input.instructions)
        if (!checkedInstructions.ok) return { ok: false, error: checkedInstructions.error }
        // How this write is made is not decided here (D-035): it is asked for, every time, and a refusal means nothing is written.
        const mode = await writeMode()
        if ('refused' in mode) return { ok: false, error: mode.refused }
        await ensureScanned()
        const known = index.get(input.id)
        if (!known && index.size >= HISTORY_LIMITS.maxConversations) {
          return {
            ok: false,
            error: `There are already ${HISTORY_LIMITS.maxConversations} saved conversations. Delete some to save more.`
          }
        }
        const now = Date.now()
        return writeConversation(
          {
            id: input.id,
            title: titleFor(input.messages),
            createdAt: known?.createdAt ?? now,
            updatedAt: now,
            instructions: checkedInstructions.instructions,
            messages: input.messages,
            ...(input.project !== undefined ? { project: input.project } : {})
          },
          mode.form
        )
      }),

    inspect: (id) =>
      inOrder(async (): Promise<Inspection> => {
        assertId(id)
        await ensureScanned()
        if (unreadable.has(id)) return { kind: 'damaged' }
        if (!index.has(id)) return { kind: 'free' }
        const read = await readConversation(dir, id, box)
        if (read !== null && 'conversation' in read)
          return { kind: 'here', conversation: read.conversation }
        // Gone or damaged since it was listed. A file that is still there (damaged) must not be written over; one that has gone is free.
        index.delete(id)
        if (read === null) return { kind: 'free' }
        markUnreadable(id, read.unopened)
        return { kind: 'damaged' }
      }),

    add: (conversation) =>
      inOrder(async (): Promise<AddOutcome> => {
        assertId(conversation.id)
        const mode = await writeMode()
        if ('refused' in mode) return { ok: false, why: 'blocked', error: mode.refused }
        await ensureScanned()
        const occupied = (why: string): AddOutcome => ({
          ok: false,
          why: 'occupied',
          error: `A chat is already saved under that id (${why}).`
        })
        if (index.has(conversation.id)) return occupied('listed')
        if (unreadable.has(conversation.id)) return occupied('a file that cannot be read')
        // Not trusted to the list alone: whatever is on disk under this id, readable or not, is somebody's chat and is never written over.
        const file = join(dir, `${conversation.id}.json`)
        for (const path of [file, `${file}.tmp`]) {
          const there = await fs.access(path).then(
            () => true,
            () => false
          )
          if (there) return occupied('a file that was not in the list')
        }
        if (index.size >= HISTORY_LIMITS.maxConversations) {
          return {
            ok: false,
            why: 'full',
            error: `There are already ${HISTORY_LIMITS.maxConversations} saved conversations. Delete some to add more.`
          }
        }
        const written = await writeConversation(
          {
            ...conversation,
            title: titleFor(conversation.messages) // worked out here, as for every save: a file's own title is not trusted
          },
          mode.form
        )
        return written.ok ? written : { ok: false, why: 'too-large', error: written.error }
      }),

    remove: (id) =>
      inOrder(async (): Promise<RemoveOutcome> => {
        assertId(id)
        await ensureScanned()
        const file = join(dir, `${id}.json`)
        await Promise.all([fs.rm(file, { force: true }), fs.rm(`${file}.tmp`, { force: true })])
        // Do not say "deleted" unless both are really gone.
        const left = await Promise.all(
          [file, `${file}.tmp`].map((path) =>
            fs.access(path).then(
              () => true,
              () => false
            )
          )
        )
        if (left.some(Boolean)) throw new Error('the file could not be deleted')
        index.delete(id)
        markReadable(id)
        return { ok: true }
      }),

    whenIdle: () => queue.then(() => undefined)
  }
}
