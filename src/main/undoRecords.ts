import { createHash } from 'crypto'
import { WORKSPACE_LIMITS } from '../shared/workspace'

// What the undo journal holds (Stage 12.6, D-042): for each change the person applied, the ORIGINAL file as it was (so that it can be put back) or the fact that the file
// was new (so that it can be taken away again), and when an undo was done. Read strictly, like every file of the app: an entry is exactly what this app writes or it is not
// read (and is left in the file, counted). The original is kept whole (a file is at most 256 KB), as base64 in one line, with its SHA-256, which is checked when the line is
// read: an entry whose copy does not match its checksum is not an entry. The journal is sealed like the chats when encryption is on and is not in a backup. No Electron imports.

export const UNDO_VERSION = 1

export const UNDO_LIMITS = Object.freeze({
  /** The most changes the journal may hold (applied ones, undone or not): when it is full, applying is refused until the person clears it. */
  maxChanges: 1000,
  /** The most the journal may weigh in bytes, for the same. */
  maxBytes: 200 * 1024 * 1024,
  /** One plain line: a file of 256 KB as base64 is about 350,000 characters. */
  maxLineChars: 360_000
})

export type UndoEntry =
  | {
      type: 'applied'
      id: string
      at: number
      kind: 'edit' | 'create'
      /** The path below the workspace, with `/`. */
      path: string
      /** The original file as base64 (an edit), or null (a new file). */
      before: string | null
      /** The SHA-256 of the original (hex), or null for a new file. */
      beforeHash: string | null
      /** The SHA-256 of the file as it was written (hex), its size in bytes and its fingerprint (the first 12 characters of the hash). */
      afterHash: string
      afterBytes: number
      fingerprint: string
    }
  | { type: 'undone'; id: string; at: number }

const ID = /^u[0-9a-z]{1,12}-[0-9a-z]{1,12}$/
const HEX64 = /^[0-9a-f]{64}$/
const HEX12 = /^[0-9a-f]{12}$/
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/
const HIDDEN = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Co}\p{Cn}\p{Cs}]/u

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')
const isTime = (v: unknown): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v > 0

function exactKeys(raw: Record<string, unknown>, keys: readonly string[]): boolean {
  const have = Object.keys(raw)
  return (
    have.length === keys.length && keys.every((k) => Object.prototype.hasOwnProperty.call(raw, k))
  )
}

/** One entry exactly as this app writes one, from what JSON.parse made of a line, or null. Nothing is repaired. */
export function parseUndoEntry(raw: unknown): UndoEntry | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const o = raw as Record<string, unknown>
  if (o.v !== UNDO_VERSION || typeof o.type !== 'string') return null
  if (o.type === 'undone') {
    if (!exactKeys(o, ['v', 'type', 'id', 'at'])) return null
    return typeof o.id === 'string' && ID.test(o.id) && isTime(o.at)
      ? { type: 'undone', id: o.id, at: o.at }
      : null
  }
  if (o.type !== 'applied') return null
  if (
    !exactKeys(o, [
      'v',
      'type',
      'id',
      'at',
      'kind',
      'path',
      'before',
      'beforeHash',
      'afterHash',
      'afterBytes',
      'fingerprint'
    ])
  )
    return null
  const { id, at, kind, path, before, beforeHash, afterHash, afterBytes, fingerprint } = o
  if (typeof id !== 'string' || !ID.test(id) || !isTime(at)) return null
  if (kind !== 'edit' && kind !== 'create') return null
  if (
    typeof path !== 'string' ||
    path.length < 1 ||
    path.length > WORKSPACE_LIMITS.maxPathChars ||
    HIDDEN.test(path)
  )
    return null
  if (typeof afterHash !== 'string' || !HEX64.test(afterHash)) return null
  if (
    typeof fingerprint !== 'string' ||
    !HEX12.test(fingerprint) ||
    fingerprint !== afterHash.slice(0, 12)
  )
    return null
  if (
    typeof afterBytes !== 'number' ||
    !Number.isSafeInteger(afterBytes) ||
    afterBytes < 0 ||
    afterBytes > WORKSPACE_LIMITS.maxFileBytes
  )
    return null
  if (kind === 'create') {
    if (before !== null || beforeHash !== null) return null
  } else {
    if (
      typeof before !== 'string' ||
      !BASE64.test(before) ||
      before.length > Math.ceil(WORKSPACE_LIMITS.maxFileBytes / 3) * 4
    )
      return null
    if (typeof beforeHash !== 'string' || !HEX64.test(beforeHash)) return null
    const bytes = Buffer.from(before, 'base64')
    if (bytes.length > WORKSPACE_LIMITS.maxFileBytes || sha256(bytes) !== beforeHash) return null
  }
  return {
    type: 'applied',
    id,
    at,
    kind,
    path,
    before: before as string | null,
    beforeHash: beforeHash as string | null,
    afterHash,
    afterBytes,
    fingerprint
  }
}

/** The plain object written for an entry (keys in a fixed order). */
export function renderUndoEntry(entry: UndoEntry): Record<string, unknown> {
  if (entry.type === 'undone')
    return { v: UNDO_VERSION, type: 'undone', id: entry.id, at: entry.at }
  return {
    v: UNDO_VERSION,
    type: 'applied',
    id: entry.id,
    at: entry.at,
    kind: entry.kind,
    path: entry.path,
    before: entry.before,
    beforeHash: entry.beforeHash,
    afterHash: entry.afterHash,
    afterBytes: entry.afterBytes,
    fingerprint: entry.fingerprint
  }
}

export interface AppliedRecord {
  entry: Extract<UndoEntry, { type: 'applied' }>
  undone: boolean
}

/** The applied changes of a journal, oldest first, each with whether an undo was done (an entry for an id that was never applied is ignored). */
export function foldJournal(entries: readonly UndoEntry[]): AppliedRecord[] {
  const byId = new Map<string, AppliedRecord>()
  for (const entry of entries) {
    if (entry.type === 'applied') {
      if (!byId.has(entry.id)) byId.set(entry.id, { entry, undone: false })
    } else {
      const found = byId.get(entry.id)
      if (found !== undefined) found.undone = true
    }
  }
  return [...byId.values()]
}
