// The changes the model has proposed (Stage 12.5, D-042), as the two windows see them. The chat page sees only a summary of each (the path, what kind, the counts
// and the warnings: never a line of the change), and can ask main to open the Review window for one. The Review window, a window of its own that main opens and
// that the chat page cannot script, gets the whole change as text it can show. Plain types and constants; nothing here decides anything. This file is bundled into
// both preloads. No Electron imports.

/** One waiting change, as the chat page's list shows it. */
export interface ChangeSummary {
  id: string
  kind: 'edit' | 'create'
  /** The path below the workspace, with `/`, written so that nothing in it is invisible. */
  path: string
  added: number
  removed: number
  bytes: number
  /** The file is hidden or looks like it holds secrets. */
  secret: boolean
  /** The file runs commands when it is used later (a script, `package.json`, a workflow...). */
  runsCommands: boolean
}

/** `message`: what to tell the person when it worked (the Review window shows it). */
export type ChangeActionResult = { ok: true; message?: string } | { ok: false; error: string }

/**
 * A change that was applied, as the Tools page lists it (12.6). `state`: `undoable` (the file is still exactly what the change wrote), `changed` (it was changed
 * since: an undo would lose what was written), `gone`, `unavailable` (the guard no longer lets the path through) or `undone`.
 */
export interface AppliedChange {
  id: string
  at: number
  kind: 'edit' | 'create'
  path: string
  bytes: number
  fingerprint: string
  state: 'undoable' | 'changed' | 'gone' | 'unavailable' | 'undone'
}

/**
 * What the Review window is told about the file now, compared with what the proposal saw. `ok`: it is as it was. `changed`: the file is not the bytes the proposal
 * was made from. `gone`: the file is not there. `exists`: a file that was to be new is there now. `unavailable`: the guard no longer lets the path through.
 */
export type ChangeState = 'ok' | 'changed' | 'gone' | 'exists' | 'unavailable'

/** What the Review window shows of a change. Every text in it has been made visible (the characters the eye cannot see are written out). */
export interface ReviewModel {
  id: string
  kind: 'edit' | 'create'
  path: string
  /** The model's reason, one line. */
  why: string
  added: number
  removed: number
  bytes: number
  /** The first 12 characters of the SHA-256 of the exact bytes that would be written. */
  fingerprint: string
  eol: 'lf' | 'crlf' | 'mixed' | 'none'
  bom: boolean
  secret: boolean
  runsCommands: boolean
  state: ChangeState
  /** The unified diff, line by line, each with its kind (a header, the heading of a place, a line that is the same, added or removed). */
  diff: { kind: 'header' | 'hunk' | 'same' | 'add' | 'del'; text: string }[]
  /** The file as it would be, line by line (the dry-run view). */
  after: string[]
  /** True when `after` is only the first lines of a longer file (the dry-run view is cut; the diff never is). */
  afterCut: boolean
  /** Whether the diff has been scrolled to its end, as main knows it. */
  reachedEnd: boolean
}

/** The messages between the Review window and main. Main answers only the window it opened (see reviewWindow.ts). */
export const REVIEW_CHANNELS = {
  get: 'review:get',
  reachedEnd: 'review:reached-end',
  apply: 'review:apply',
  drop: 'review:drop',
  close: 'review:close',
  /** Main to the window: another change is to be shown. */
  changed: 'review:changed'
} as const

/** The most lines of the file as it would be that the dry-run view holds. */
export const REVIEW_AFTER_LINES = 4000
