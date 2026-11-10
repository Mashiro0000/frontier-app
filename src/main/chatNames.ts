import { join } from 'path'
import {
  CHAT_NAME_LIMITS,
  checkChatMarks,
  checkChatTitle,
  type ChatMark,
  type ChatMarkResult,
  type ChatMarks
} from '../shared/chatNames'
import { isConversationId } from '../shared/ids'
import type { SecretBox } from './credentialStore'
import type { WriteMode } from './chatFile'
import { createKeptFile, KeptRefused, type KeptFile } from './keptFile'

// (23.1, D-055) The chats' own names and pins, kept in `chat-names.json` like the other small documents (D-039: written and read back, sealed with the chats
// when encryption is on, never written over by itself when it cannot be read). The chat files are not touched, so they stay readable by an older build.

export const CHAT_NAMES_FILE_VERSION = 1
const MAX_FILE_BYTES = 1024 * 1024

export const chatNamesFileText = (chats: ChatMarks): string =>
  JSON.stringify({ version: CHAT_NAMES_FILE_VERSION, chats })

/** What the file holds, or null when it is not exactly the shape this app writes. */
export function parseChatNamesFile(content: string): ChatMarks | null {
  let raw: unknown
  try {
    raw = JSON.parse(content)
  } catch {
    return null
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const fields = raw as Record<string, unknown>
  if (fields.version !== CHAT_NAMES_FILE_VERSION || Object.keys(fields).length !== 2) return null
  return checkChatMarks(fields.chats)
}

export interface ChatNamesDeps {
  folder: () => string
  box?: SecretBox
  writeMode: () => Promise<WriteMode>
}

export interface ChatNames {
  /** The marks, or none with why when the file cannot be read (then nothing is shown as renamed or pinned, and nothing can be changed). */
  read(): Promise<{ marks: ChatMarks; problem: string | null }>
  rename(id: unknown, title: unknown): Promise<ChatMarkResult>
  pin(id: unknown, on: unknown): Promise<ChatMarkResult>
  /** A deleted chat's entry is dropped (best effort: an entry left behind names nothing and changes nothing). */
  forget(id: string): Promise<void>
  /** Adds the marks of restored chats without changing a mark already there (a restore never replaces). */
  addMissing(marks: ChatMarks): Promise<ChatMarkResult>
  file: KeptFile<ChatMarks>
}

const NOT_UNDERSTOOD: ChatMarkResult = { ok: false, error: 'That was not understood.' }

export function createChatNames(deps: ChatNamesDeps): ChatNames {
  const file = createKeptFile<ChatMarks>({
    pathOf: () => join(deps.folder(), 'chat-names.json'),
    name: 'the names and pins of your chats',
    parse: parseChatNamesFile,
    text: chatNamesFileText,
    maxBytes: MAX_FILE_BYTES,
    ...(deps.box !== undefined ? { box: deps.box } : {}),
    writeMode: deps.writeMode
  })
  // One change at a time, in the order they come (a rename and a pin clicked quickly must not lose one).
  let queue: Promise<unknown> = Promise.resolve()
  const inOrder = <T>(task: () => Promise<T>): Promise<T> => {
    const run = queue.then(task)
    queue = run.catch(() => undefined)
    return run
  }

  /** Reads, changes and writes the marks; the change returns the new marks, a refusal, or null for no change. */
  const change = (edit: (now: ChatMarks) => ChatMarks | string | null): Promise<ChatMarkResult> =>
    inOrder(async () => {
      const read = await file.read()
      if (read.state === 'unreadable') {
        return {
          ok: false as const,
          error: `The names and pins of your chats could not be read (${read.why}), so nothing is changed.`
        }
      }
      const next = edit(read.state === 'ok' ? read.value : {})
      if (typeof next === 'string') return { ok: false as const, error: next }
      if (next === null) return { ok: true as const } // nothing to change: nothing is written
      if (Object.keys(next).length > CHAT_NAME_LIMITS.maxEntries) {
        return { ok: false as const, error: 'Too many chats have a name or a pin.' }
      }
      try {
        await file.write(next)
      } catch (error) {
        return {
          ok: false as const,
          error: error instanceof KeptRefused ? error.message : 'The change could not be saved.'
        }
      }
      return { ok: true as const }
    })

  /** The marks with one chat's entry replaced (or dropped when it has neither a name nor a pin). */
  const withMark = (now: ChatMarks, id: string, mark: ChatMark): ChatMarks => {
    const next = { ...now }
    if (mark.title === undefined && mark.pinned === undefined) delete next[id]
    else next[id] = mark
    return next
  }

  return {
    file,
    async read() {
      const read = await file.read()
      if (read.state === 'ok') return { marks: read.value, problem: null }
      if (read.state === 'none') return { marks: {}, problem: null }
      return { marks: {}, problem: read.why }
    },
    rename(id, title) {
      const name = checkChatTitle(title)
      if (!isConversationId(id) || name === null) return Promise.resolve(NOT_UNDERSTOOD)
      return change((now) => {
        const rest: ChatMark = { ...now[id] }
        delete rest.title
        return withMark(now, id, name === '' ? rest : { ...rest, title: name })
      })
    },
    pin(id, on) {
      if (!isConversationId(id) || typeof on !== 'boolean') return Promise.resolve(NOT_UNDERSTOOD)
      return change((now) => {
        const rest: ChatMark = { ...now[id] }
        delete rest.pinned
        return withMark(now, id, on ? { ...rest, pinned: true } : rest)
      })
    },
    async forget(id) {
      const result = await change((now) => (id in now ? withMark(now, id, {}) : null))
      if (!result.ok) console.error('Forgetting the name of a deleted chat failed:', result.error)
    },
    addMissing(marks) {
      return change((now) => {
        const next = { ...now }
        for (const [id, mark] of Object.entries(marks)) if (!(id in next)) next[id] = mark
        return next
      })
    }
  }
}
