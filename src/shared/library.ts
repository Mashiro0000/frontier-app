import type { AttachmentInfo } from './attachments'
import type { SavedConversation } from './ipc'

// (22.1, D-054) The Library, as AI Fiesta's: everything the person attached to a chat and every picture the app made, in one place, with All / Starred / Images /
// Files, a search, and a star. The pictures are the gallery's (Stage 16, main's images store); the files are worked out here from the saved chats: every file on
// a message of the person's, once, with the chats that carry it. A file of a project is the project's (Projects shows those). Plain functions.

/** One file attached in the saved chats: what main knows of it, and where it is used (newest chat first). */
export interface LibraryFile {
  info: AttachmentInfo
  chats: { id: string; title: string }[]
  /** When the newest chat that carries it was saved (for the order). */
  lastUsed: number
}

export const LIBRARY_LIMITS = { maxStarred: 1000 } as const

/** Every file on the person's messages in these chats, once each, the most recently used first. */
export function filesOfChats(chats: readonly SavedConversation[]): LibraryFile[] {
  const byId = new Map<string, LibraryFile>()
  const newestFirst = [...chats].sort((a, b) => b.updatedAt - a.updatedAt)
  for (const chat of newestFirst) {
    for (const message of chat.messages) {
      if (message.role !== 'user') continue
      for (const info of message.attachments ?? []) {
        const known = byId.get(info.id)
        if (known === undefined) {
          byId.set(info.id, {
            info,
            chats: [{ id: chat.id, title: chat.title }],
            lastUsed: chat.updatedAt
          })
        } else if (!known.chats.some((c) => c.id === chat.id)) {
          known.chats.push({ id: chat.id, title: chat.title })
        }
      }
    }
  }
  return [...byId.values()].sort((a, b) => b.lastUsed - a.lastUsed)
}

/** The ids the person starred, as kept in library.json: an id is a file's (64 hex) or a picture's; at most `maxStarred`, each once. */
export function checkStarred(input: unknown): string[] | null {
  if (!Array.isArray(input) || input.length > LIBRARY_LIMITS.maxStarred) return null
  const seen = new Set<string>()
  for (const id of input) {
    if (typeof id !== 'string' || !isLibraryId(id) || seen.has(id)) return null
    seen.add(id)
  }
  return [...seen]
}

/** A file's id (a SHA-256: 64 lower-case hex characters) or a picture's id (32 lower-case hex characters): what can be starred. */
export function isLibraryId(value: unknown): value is string {
  return typeof value === 'string' && /^(?:[0-9a-f]{32}|[0-9a-f]{64})$/.test(value)
}

/** What a library item is called in a search: its name (a file) or its description (a picture). Every word must be in it, any case. */
export function matchesQuery(text: string, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  const hay = text.toLowerCase()
  return words.every((word) => hay.includes(word))
}

/** What the Library's list gives the page. */
export type LibraryFilesResult =
  | {
      ok: true
      files: LibraryFile[]
      starred: string[]
      unreadable: number
      starsProblem: string | null
    }
  | { ok: false; error: string }

/** What a star (or taking one off) leaves. */
export type StarResult = { ok: true; starred: string[] } | { ok: false; error: string }
