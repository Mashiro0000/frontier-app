// The person's notes (Stage 10.3, D-039): the app's own memory. Short texts the person keeps, each of which goes with every message of every chat, or
// only with the chats of one project (10.5). Made only by the person, never by a model; kept and sent by main (memory.json). The limits and the checks
// that both sides use. Types and plain functions only: this file is bundled into the preload too.

import type { SecretFinding } from './ipc'

export const MEMORY_LIMITS = {
  /** One note: a sentence or two. */
  maxNoteChars: 500,
  /**
   * All the notes of one place (every chat, or one project) together. They go with every message, so they are kept short: about 2,000 tokens, the
   * same as the instructions.
   */
  maxScopeChars: 8_000,
  /** Notes in one place. */
  maxScopeNotes: 100
} as const

/** Where a note applies: every chat ('all'), or the chats of one project (its id). */
export const ALL_CHATS = 'all'

/** A note, as main keeps it and the page is shown it. */
export interface Note {
  /** Made by main: a lower-case uuid. */
  id: string
  /** The person's words: trimmed, 1 to `maxNoteChars` characters. */
  text: string
  /** `ALL_CHATS`, or the id of the project whose chats it goes with. */
  scope: string
  /** Milliseconds since 1970: when it was made, and when it was last changed. */
  createdAt: number
  updatedAt: number
}

/** The memory as main has it. */
export interface MemoryStatus {
  /** False when the person has turned memory off: no note is sent, whatever there is. */
  on: boolean
  /** Every note, oldest first: the order in which they are sent. */
  notes: Note[]
  /** Why memory.json cannot be read, or null. While it cannot, main sends no request at all. */
  problem: string | null
}

/**
 * What a change of the notes came to. `cancelled`: the person said no in the system's own message box (or the note is already there); nothing changed,
 * and it is not shown as a failure. `warnings`: parts that look like a key or a password; nothing was saved, and the same text may be sent again with
 * "Save anyway".
 */
export type MemoryChangeResult =
  | { ok: true; status: MemoryStatus }
  | { ok: false; error: string; cancelled?: true; warnings?: SecretFinding[] }

/** What "Export all..." came to: how many notes, and where the file is; `cancelled` when the person closed the save dialog. */
export type MemoryExportResult =
  { ok: true; count: number; where: string } | { ok: false; error: string; cancelled?: true }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/** True for `ALL_CHATS` or the spelling of a project id (a lower-case uuid). Whether that project exists is main's to say. */
export const isNoteScope = (value: unknown): value is string =>
  value === ALL_CHATS || (typeof value === 'string' && UUID.test(value))

export const isNoteId = (value: unknown): value is string =>
  typeof value === 'string' && UUID.test(value)

/** A note's text as it may be kept: text, trimmed, not empty, at most `maxNoteChars`. One rule for the page and for main. */
export function checkNoteText(
  input: unknown
): { ok: true; text: string } | { ok: false; error: string } {
  if (typeof input !== 'string') return { ok: false, error: 'The note was not understood.' }
  const text = input.trim()
  if (text === '') return { ok: false, error: 'A note needs some text.' }
  if (text.length > MEMORY_LIMITS.maxNoteChars) {
    return {
      ok: false,
      error: `A note can be at most ${MEMORY_LIMITS.maxNoteChars} characters, because it goes with every message.`
    }
  }
  return { ok: true, text }
}

const isTime = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0

/** One note exactly as this app writes one (in memory.json, and in a backup since 10.7), or null. */
export function parseNote(raw: unknown): Note | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const fields = raw as Record<string, unknown>
  if (Object.keys(fields).length !== 5) return null
  const { id, text, scope, createdAt, updatedAt } = fields
  if (!isNoteId(id) || !isNoteScope(scope) || !isTime(createdAt) || !isTime(updatedAt)) return null
  if (updatedAt < createdAt) return null
  const checked = checkNoteText(text)
  if (!checked.ok || checked.text !== text) return null
  return { id, text: checked.text, scope, createdAt, updatedAt }
}

/** How much of one place's room its notes take. */
export function scopeUse(notes: readonly Note[], scope: string): { notes: number; chars: number } {
  let count = 0
  let chars = 0
  for (const note of notes) {
    if (note.scope !== scope) continue
    count += 1
    chars += note.text.length
  }
  return { notes: count, chars }
}
