import { promises as fs } from 'fs'
import { join } from 'path'
import {
  HISTORY_LIMITS,
  type ConversationSummary,
  type SavedConversation,
  type SavedMessage
} from '../shared/ipc'
import { checkSavedMessages, isConversationId } from '../shared/validate'

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
// The file is "version": 2 since Stage 5.4 (D-021): each reply says which provider and model wrote it. A version 1 file
// (Stages 2-4) is read as a version 2 one (its replies came from Anthropic, which model is not known) and stays version 1
// on disk, byte for byte, until the conversation is next saved. Nothing is converted in bulk, so no crash can leave the
// history half-converted. A file of any other version was made by another version of the app and is left alone.

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

export interface ConversationStore {
  /** Every readable conversation, newest first, and how many files could not be read (and were left alone). */
  list(): Promise<{ conversations: ConversationSummary[]; unreadable: number }>
  load(id: string): Promise<LoadOutcome>
  /**
   * Saves the whole conversation (a snapshot, not a change). Throws if the disk refuses, and then the earlier
   * saved copy is still there; answers `ok: false` for a refusal that is not a failure (too many, too large).
   */
  save(input: { id: string; messages: SavedMessage[] }): Promise<SaveOutcome>
  remove(id: string): Promise<RemoveOutcome>
  /** Resolves when every save and removal asked for so far has finished. For quitting the app. */
  whenIdle(): Promise<void>
}

/** The title shown in the list: the first message the person wrote, on one line, cut at 60 characters. */
export function titleFor(messages: readonly SavedMessage[]): string {
  const first = messages.find((message) => message.role === 'user')?.content ?? ''
  const oneLine = first.replace(/\s+/g, ' ').trim()
  const letters = Array.from(oneLine) // by character, so an emoji is not cut in half
  return letters.length > 60 ? `${letters.slice(0, 60).join('')}...` : oneLine || 'New chat'
}

const summaryOf = (conversation: SavedConversation): ConversationSummary => ({
  id: conversation.id,
  title: conversation.title,
  updatedAt: conversation.updatedAt,
  messageCount: conversation.messages.length
})

const isTime = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0

/** Checks one file's contents. `id` is the id in the file's name, which the file must agree with. */
export function parseSavedFile(raw: unknown, id: string): SavedConversation | string {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return 'it is not an object'
  const file = raw as Record<string, unknown>
  if (file.version !== 1 && file.version !== 2) return 'it was made by another version of the app'
  if (file.id !== id) return 'the id inside does not match the file name'
  if (typeof file.title !== 'string' || file.title.length > HISTORY_LIMITS.maxTitleChars) {
    return 'its title is not usable'
  }
  if (!isTime(file.createdAt) || !isTime(file.updatedAt)) return 'its dates are not usable'
  const messages = checkSavedMessages(file.messages, file.version === 1 ? 'file-v1' : 'file')
  if (!messages.ok) return messages.error
  return {
    id,
    title: file.title,
    createdAt: file.createdAt,
    updatedAt: file.updatedAt,
    messages: messages.messages
  }
}

type Read =
  | { kind: 'ok'; conversation: SavedConversation }
  | { kind: 'missing' }
  | { kind: 'bad'; why: string }

async function readFileAt(path: string, id: string): Promise<Read> {
  let size: number
  try {
    size = (await fs.stat(path)).size
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { kind: 'missing' }
    throw error
  }
  // Looked at before reading, so a file of any size cannot fill the memory.
  if (size > HISTORY_LIMITS.maxFileBytes) return { kind: 'bad', why: 'the file is too large' }
  let text = await fs.readFile(path, 'utf8')
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1) // a byte-order mark, which some editors add
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { kind: 'bad', why: 'it is not valid JSON' }
  }
  const result = parseSavedFile(parsed, id)
  return typeof result === 'string'
    ? { kind: 'bad', why: result }
    : { kind: 'ok', conversation: result }
}

/** Reads one conversation, applying the recovery rule above. `null` if neither file exists. */
async function readConversation(
  dir: string,
  id: string
): Promise<{ conversation: SavedConversation } | { why: string } | null> {
  const file = join(dir, `${id}.json`)
  const copy = await readFileAt(`${file}.tmp`, id)
  if (copy.kind === 'ok') return { conversation: copy.conversation }
  const real = await readFileAt(file, id)
  if (real.kind === 'ok') return { conversation: real.conversation }
  if (real.kind === 'bad') return { why: real.why }
  if (copy.kind === 'bad') return { why: copy.why }
  return null
}

export function createConversationStore(dir: string): ConversationStore {
  const index = new Map<string, { summary: ConversationSummary; createdAt: number }>()
  const unreadable = new Set<string>()
  let scanned: Promise<void> | null = null

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
          try {
            const read = await readConversation(dir, id)
            if (read === null) return
            if ('conversation' in read) {
              index.set(id, {
                summary: summaryOf(read.conversation),
                createdAt: read.conversation.createdAt
              })
              return
            }
            console.warn(
              `The saved conversation ${id} could not be read (${read.why}); it was left as it is.`
            )
          } catch (error) {
            console.warn(
              `The saved conversation ${id} could not be read (${error instanceof Error ? error.message : error}); it was left as it is.`
            )
          }
          unreadable.add(id)
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

  return {
    list: () =>
      inOrder(async () => {
        await ensureScanned()
        const conversations = [...index.values()]
          .map((entry) => entry.summary)
          .sort((a, b) => b.updatedAt - a.updatedAt || (a.id < b.id ? -1 : 1))
        return { conversations, unreadable: unreadable.size }
      }),

    load: (id) =>
      inOrder(async (): Promise<LoadOutcome> => {
        assertId(id)
        await ensureScanned()
        if (!index.has(id)) return { ok: false, error: 'That conversation was not found.' }
        const read = await readConversation(dir, id)
        if (read !== null && 'conversation' in read)
          return { ok: true, conversation: read.conversation }
        index.delete(id) // gone, or damaged since it was listed: the list should say so too
        if (read === null) return { ok: false, error: 'That conversation was not found.' }
        unreadable.add(id)
        console.warn(
          `The saved conversation ${id} could not be read (${read.why}); it was left as it is.`
        )
        return { ok: false, error: 'That conversation could not be read.' }
      }),

    save: (input) =>
      inOrder(async (): Promise<SaveOutcome> => {
        assertId(input.id)
        await ensureScanned()
        const known = index.get(input.id)
        if (!known && index.size >= HISTORY_LIMITS.maxConversations) {
          return {
            ok: false,
            error: `There are already ${HISTORY_LIMITS.maxConversations} saved conversations. Delete some to save more.`
          }
        }
        const now = Date.now()
        const conversation: SavedConversation = {
          id: input.id,
          title: titleFor(input.messages),
          createdAt: known?.createdAt ?? now,
          updatedAt: now,
          messages: input.messages
        }
        const text = JSON.stringify({ version: 2, ...conversation })
        // Whatever is written must be readable again, so the limit on reading is also a limit on writing.
        if (Buffer.byteLength(text) > HISTORY_LIMITS.maxFileBytes) {
          return { ok: false, error: 'This conversation is too large to save.' }
        }
        await fs.mkdir(dir, { recursive: true, mode: 0o700 })
        const file = join(dir, `${input.id}.json`)
        const copy = `${file}.tmp`
        await fs.writeFile(copy, text, { mode: 0o600 })
        if ((await fs.readFile(copy, 'utf8')) !== text) {
          await fs.rm(copy, { force: true }).catch(() => undefined) // cut off: the real file is still the old copy
          throw new Error('the new copy could not be read back')
        }
        // From here on the ".tmp" is whole and checked, so it is kept if anything below fails: reading uses it.
        await fs.copyFile(copy, file)
        if ((await fs.readFile(file, 'utf8')) !== text)
          throw new Error('the saved file could not be read back')
        await fs.rm(copy, { force: true }).catch(() => undefined) // if this fails the ".tmp" only repeats the file
        const summary = summaryOf(conversation)
        index.set(input.id, { summary, createdAt: conversation.createdAt })
        unreadable.delete(input.id)
        return { ok: true, summary }
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
        unreadable.delete(id)
        return { ok: true }
      }),

    whenIdle: () => queue.then(() => undefined)
  }
}
