import { join } from 'path'
import {
  checkStarred,
  filesOfChats,
  isLibraryId,
  type LibraryFilesResult,
  type StarResult
} from '../shared/library'
import type { SavedConversation } from '../shared/ipc'
import type { SecretBox } from './credentialStore'
import type { WriteMode } from './chatFile'
import { createKeptFile, KeptRefused, type KeptFile } from './keptFile'

// (22.1, D-054) The Library's side in main: the files of the saved chats (worked out from the chats main can read, as Search does) and the person's stars, kept
// in `library.json` like the other small documents (D-039: written and read back, sealed with the chats when encryption is on, never written over by itself
// when it cannot be read). A star is only a mark: it changes nothing else, so the file is not part of a backup (losing it loses marks only).

export const LIBRARY_FILE_VERSION = 1
const MAX_FILE_BYTES = 128 * 1024

export const libraryFileText = (starred: readonly string[]): string =>
  JSON.stringify({ version: LIBRARY_FILE_VERSION, starred })

/** What the file holds, or null when it is not exactly the shape this app writes. */
export function parseLibraryFile(content: string): string[] | null {
  let raw: unknown
  try {
    raw = JSON.parse(content)
  } catch {
    return null
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const fields = raw as Record<string, unknown>
  if (fields.version !== LIBRARY_FILE_VERSION || Object.keys(fields).length !== 2) return null
  return checkStarred(fields.starred)
}

export interface LibraryDeps {
  folder: () => string
  box?: SecretBox
  writeMode: () => Promise<WriteMode>
  /** Every saved chat main can read, and how many it could not. */
  chats: () => Promise<{ chats: SavedConversation[]; unreadable: number }>
}

export interface LibraryService {
  files(): Promise<LibraryFilesResult>
  star(id: unknown, on: unknown): Promise<StarResult>
  file: KeptFile<string[]>
}

export function createLibrary(deps: LibraryDeps): LibraryService {
  const file = createKeptFile<string[]>({
    pathOf: () => join(deps.folder(), 'library.json'),
    name: 'your stars in the Library',
    parse: parseLibraryFile,
    text: libraryFileText,
    maxBytes: MAX_FILE_BYTES,
    ...(deps.box !== undefined ? { box: deps.box } : {}),
    writeMode: deps.writeMode
  })
  // One change at a time, in the order they come (two quick clicks on two stars must not lose one).
  let queue: Promise<unknown> = Promise.resolve()
  const inOrder = <T>(task: () => Promise<T>): Promise<T> => {
    const run = queue.then(task)
    queue = run.catch(() => undefined)
    return run
  }

  const readStars = async (): Promise<{ starred: string[]; problem: string | null }> => {
    const read = await file.read()
    if (read.state === 'ok') return { starred: read.value, problem: null }
    if (read.state === 'none') return { starred: [], problem: null }
    return { starred: [], problem: read.why }
  }

  return {
    file,
    async files() {
      try {
        const { chats, unreadable } = await deps.chats()
        const stars = await readStars()
        return {
          ok: true,
          files: filesOfChats(chats),
          starred: stars.starred,
          unreadable,
          starsProblem: stars.problem
        }
      } catch (error) {
        console.error('Listing the Library failed:', error instanceof Error ? error.message : error)
        return { ok: false, error: 'The Library could not be read.' }
      }
    },
    star(id, on) {
      if (!isLibraryId(id) || typeof on !== 'boolean')
        return Promise.resolve({ ok: false, error: 'That was not understood.' })
      return inOrder(async () => {
        const read = await file.read()
        if (read.state === 'unreadable') {
          return {
            ok: false as const,
            error: `Your stars could not be read (${read.why}), so none is changed.`
          }
        }
        const now = read.state === 'ok' ? read.value : []
        const next = on ? (now.includes(id) ? now : [...now, id]) : now.filter((x) => x !== id)
        if (next.length > 1000)
          return { ok: false as const, error: 'At most 1,000 things can be starred.' }
        try {
          await file.write(next)
        } catch (error) {
          return {
            ok: false as const,
            error: error instanceof KeptRefused ? error.message : 'The star could not be saved.'
          }
        }
        return { ok: true as const, starred: next }
      })
    }
  }
}
