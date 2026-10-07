import { randomUUID } from 'crypto'
import { promises as fs } from 'fs'
import { isAbsolute } from 'path'
import {
  ALL_CHATS,
  checkNoteText,
  isNoteId,
  isNoteScope,
  MEMORY_LIMITS,
  scopeUse,
  type MemoryChangeResult,
  type MemoryExportResult,
  type MemoryStatus,
  type Note
} from '../shared/memory'
import { isInside } from './backupService'
import type { WriteMode } from './chatFile'
import type { SecretBox } from './credentialStore'
import { createKeptFile, KeptRefused, type KeptFile } from './keptFile'
import { checkForSecrets, type SavedKey } from './secrets'
import {
  QUESTION_BUSY,
  QUESTION_FAILED,
  QUESTION_RESTING,
  type QuestionGate,
  type SystemQuestion
} from './systemQuestion'

// The person's notes (Stage 10.3, D-039): the app's memory, kept by main in memory.json in the data folder (keptFile.ts: written like a chat, sealed
// like the chats when encryption is on). Main alone writes it, and only for the person:
//  - a note is made or changed only after the person's yes in the system's own message box (systemQuestion.ts), which shows the note: a page, a fault
//    or a model's words cannot add anything that goes out with every message;
//  - one of the API keys saved in this app is refused outright, and text that looks like a key or a password is kept only on "Save anyway" (secrets.ts);
//  - deleting notes and turning memory off send less, so they ask nothing here (the page asks first, as for any deletion);
//  - turning memory back on sends the notes again, so it asks (when there are any).
// Caps (MEMORY_LIMITS): a note is at most 500 characters, and the notes of one place (every chat, or one project) at most 8,000 characters and 100 notes.
// When the file cannot be read, no request is sent (`forRequest`), and nothing is changed but by the two ways out, "Delete all" and "Turn memory off",
// which first keep a copy of the damaged file. The export writes every note to one plain text file the person picks in the system's save dialog.

export const MEMORY_FILE_VERSION = 1

/** The most notes the file may hold: every place full (every chat and 100 projects). Their text, escaped, and the fields around it fit in 8 MB. */
const MAX_NOTES = MEMORY_LIMITS.maxScopeNotes * 101
const MAX_FILE_BYTES = 8 * 1024 * 1024

/** What memory.json holds. */
export interface MemoryFile {
  on: boolean
  notes: Note[]
}

export const memoryFileText = (memory: MemoryFile): string =>
  JSON.stringify({
    version: MEMORY_FILE_VERSION,
    on: memory.on,
    notes: memory.notes.map(({ id, text, scope, createdAt, updatedAt }) => ({
      id,
      text,
      scope,
      createdAt,
      updatedAt
    }))
  })

const isTime = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0

/** One note out of the file, exactly as this app writes one, or null. */
function parseNote(raw: unknown): Note | null {
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

/** What the file holds, or null when it is not exactly what this app writes (a field more or less, a note over a cap, an id twice). */
export function parseMemoryFile(content: string): MemoryFile | null {
  let raw: unknown
  try {
    raw = JSON.parse(content)
  } catch {
    return null
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const fields = raw as Record<string, unknown>
  if (fields.version !== MEMORY_FILE_VERSION || Object.keys(fields).length !== 3) return null
  if (typeof fields.on !== 'boolean' || !Array.isArray(fields.notes)) return null
  if (fields.notes.length > MAX_NOTES) return null
  const notes: Note[] = []
  const ids = new Set<string>()
  for (const raw of fields.notes) {
    const note = parseNote(raw)
    if (note === null || ids.has(note.id)) return null
    ids.add(note.id)
    notes.push(note)
  }
  for (const scope of new Set(notes.map((note) => note.scope))) {
    const use = scopeUse(notes, scope)
    if (use.notes > MEMORY_LIMITS.maxScopeNotes || use.chars > MEMORY_LIMITS.maxScopeChars)
      return null
  }
  return { on: fields.on, notes }
}

const fmt = (n: number): string => n.toLocaleString('en-US')
const notesWord = (count: number): string => `${count} ${count === 1 ? 'note' : 'notes'}`

/** "for every chat", or for one project's chats. */
const placeOf = (scope: string, projectName: string | null): string =>
  scope === ALL_CHATS ? 'every chat' : `the chats of the project "${projectName ?? 'unknown'}"`

const PAGE_CANNOT =
  "Frontier App asks this in a window of its own, which the app's page cannot answer: text that goes out with every message needs your yes here."

export function noteQuestion(input: {
  text: string
  was: string | null
  scope: string
  projectName: string | null
  on: boolean
  warned: boolean
  after: { notes: number; chars: number }
}): SystemQuestion {
  const place = placeOf(input.scope, input.projectName)
  const lines = [`"${input.text}"`]
  if (input.was !== null) lines.push('', `Was: "${input.was}"`)
  lines.push(
    '',
    `${fmt(input.text.length)} characters. Your notes go to the company that runs the model with every message of ${place}${input.on ? '' : ' (memory is off now: they go once you turn it on)'}, and are kept in this app's data folder.`,
    `With this one: ${notesWord(input.after.notes)} for ${place}, ${fmt(input.after.chars)} of ${fmt(MEMORY_LIMITS.maxScopeChars)} characters.`
  )
  if (input.warned)
    lines.push('Part of it looks like a key or a password; you chose to save it anyway.')
  lines.push('', PAGE_CANNOT)
  return input.was === null
    ? {
        title: 'Memory',
        message:
          input.scope === ALL_CHATS
            ? 'Remember this for every chat?'
            : `Remember this for the chats of "${input.projectName ?? 'unknown'}"?`,
        detail: lines.join('\n'),
        yes: 'Remember it',
        no: 'Cancel'
      }
    : {
        title: 'Memory',
        message: 'Change this note?',
        detail: lines.join('\n'),
        yes: 'Save the note',
        no: 'Cancel'
      }
}

export function memoryOnQuestion(notes: readonly Note[]): SystemQuestion {
  const chars = notes.reduce((sum, note) => sum + note.text.length, 0)
  return {
    title: 'Memory',
    message: 'Turn memory on?',
    detail: [
      `Your ${notesWord(notes.length)} (${fmt(chars)} characters) will go to the company that runs the model with every message again, each with the chats it is for.`,
      '',
      PAGE_CANNOT
    ].join('\n'),
    yes: 'Turn memory on',
    no: 'Cancel'
  }
}

export const NOTE_NOT_SAVED = 'Not saved: your notes are as they were.'
export const MEMORY_STILL_OFF = 'Memory is still off.'
const NOT_UNDERSTOOD = 'The note was not understood.'
const BUSY = 'Your notes are still being changed.'
const NO_NOTE = 'That note is not there any more.'
const NO_PROJECT = 'That project is not there any more.'
const ALREADY = 'This is already one of your notes.'

/** The refusal of a request, and of any change but the ways out, while the file cannot be read. */
export const memoryUnreadable = (why: string): string =>
  `Nothing was sent: your notes could not be read (${why}). Open Memory to delete them all or turn memory off; the app keeps a copy of the file.`
const changeRefused = (why: string): string =>
  `Nothing was changed: your notes could not be read (${why}). Delete them all or turn memory off first; the app keeps a copy of the file.`

type MemoryChange = MemoryChangeResult

export interface MemoryService {
  status(): Promise<MemoryStatus>
  /** A new note, from the person: `{ text, scope, saveAnyway? }`. Asks in the system's box. */
  add(owner: unknown, input: unknown): Promise<MemoryChange>
  /** New words for a note: `{ id, text, saveAnyway? }`. Asks in the system's box. */
  edit(owner: unknown, input: unknown): Promise<MemoryChange>
  /** Deletes one note: `{ id }`. Asks nothing (the page asks first). */
  remove(input: unknown): Promise<MemoryChange>
  /** Deletes every note. Asks nothing (the page asks first). A file that cannot be read is kept as a copy first. */
  removeAll(): Promise<MemoryChange>
  /** Deletes the notes of one project, when the project is deleted (10.5). Asks nothing; a file that cannot be read is left as it is. */
  removeScope(projectId: string): Promise<void>
  /** Memory on or off for every chat. On asks in the system's box when there are notes; off asks nothing. */
  setOn(owner: unknown, on: unknown): Promise<MemoryChange>
  /** Every note, to one plain text file the person picks in the system's save dialog. */
  exportAll(owner: unknown): Promise<MemoryExportResult>
  /**
   * The notes that go with a request of a chat in `projectId` (or none): the notes for every chat, then those for the project, oldest first; none while
   * memory is off. The sentence that refuses the request while the file cannot be read. Never throws.
   */
  forRequest(
    projectId: string | null
  ): Promise<{ ok: true; notes: Note[] } | { ok: false; error: string }>
  file: KeptFile<MemoryFile>
}

export interface MemoryOptions {
  pathOf: () => string
  box?: SecretBox
  writeMode: () => Promise<WriteMode>
  gate: QuestionGate
  savedKeys: () => Promise<SavedKey[]>
  /** The name of a project, or null when there is no such project (none before 10.5). */
  projectName: (id: string) => Promise<string | null>
  /** The app's data folder: the export never goes inside it. */
  dataDir: string
  /** The system's save dialog for the export (a suggested file name in); null when the person closed it. */
  pickExportPath: (owner: unknown, suggestedName: string) => Promise<string | null>
  now?: () => number
  newId?: () => string
}

const reason = (error: unknown): unknown => (error instanceof Error ? error.message : error)
const two = (n: number): string => String(n).padStart(2, '0')
/** "2026-10-07 14:05", local time. */
const when = (ms: number): string => {
  const d = new Date(ms)
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}`
}

export function createMemory(options: MemoryOptions): MemoryService {
  const now = options.now ?? Date.now
  const newId = options.newId ?? randomUUID
  const file = createKeptFile<MemoryFile>({
    pathOf: options.pathOf,
    name: 'your notes',
    parse: parseMemoryFile,
    text: memoryFileText,
    maxBytes: MAX_FILE_BYTES,
    box: options.box,
    writeMode: options.writeMode,
    now
  })
  let changing = false

  /** One change at a time: a second while one is being asked about or written is refused at once. */
  async function oneAtATime(task: () => Promise<MemoryChange>): Promise<MemoryChange> {
    if (changing) return { ok: false, error: BUSY }
    changing = true
    try {
      return await task()
    } finally {
      changing = false
    }
  }

  async function status(): Promise<MemoryStatus> {
    const current = await file.read()
    if (current.state === 'unreadable') return { on: true, notes: [], problem: current.why }
    if (current.state === 'none') return { on: true, notes: [], problem: null }
    return {
      on: current.value.on,
      notes: current.value.notes.map((n) => ({ ...n })),
      problem: null
    }
  }

  /** The memory as it is, or the refusal of a change while it cannot be read. */
  async function readable(): Promise<
    { ok: true; memory: MemoryFile } | { ok: false; error: string }
  > {
    const current = await file.read()
    if (current.state === 'unreadable') return { ok: false, error: changeRefused(current.why) }
    return { ok: true, memory: current.state === 'ok' ? current.value : { on: true, notes: [] } }
  }

  async function write(memory: MemoryFile, replace = false): Promise<MemoryChange> {
    try {
      await file.write(memory, { replace })
    } catch (error) {
      if (error instanceof KeptRefused) return { ok: false, error: error.message }
      console.error('Saving the notes failed:', reason(error))
      return { ok: false, error: 'Your notes could not be saved on this computer.' }
    }
    return { ok: true, status: await status() }
  }

  /** Asks in the system's box; null for a yes, or what to answer the page. */
  async function ask(
    owner: unknown,
    question: SystemQuestion,
    notSaved: string
  ): Promise<MemoryChange | null> {
    const answer = await options.gate.ask(owner, question)
    if (answer === 'yes') return null
    if (answer === 'busy') return { ok: false, error: QUESTION_BUSY }
    if (answer === 'resting') return { ok: false, error: QUESTION_RESTING }
    if (answer === 'failed') return { ok: false, error: QUESTION_FAILED }
    return { ok: false, cancelled: true, error: notSaved }
  }

  /** An id no note has yet (an id used twice would make the file one this app cannot read), or null when none could be made. */
  function freshId(notes: readonly Note[]): string | null {
    for (let tries = 0; tries < 5; tries++) {
      const id = newId()
      if (isNoteId(id) && !notes.some((note) => note.id === id)) return id
    }
    return null
  }

  /** The room a place has left once `text` is in it (`replacing`: the note it takes the place of). */
  function roomFor(
    notes: readonly Note[],
    scope: string,
    text: string,
    replacing: Note | null
  ): string | null {
    const use = scopeUse(notes, scope)
    const count = use.notes + (replacing === null ? 1 : 0)
    const chars = use.chars - (replacing?.text.length ?? 0) + text.length
    const place = scope === ALL_CHATS ? 'every chat' : 'this project'
    if (count > MEMORY_LIMITS.maxScopeNotes) {
      return `Not saved: you have ${MEMORY_LIMITS.maxScopeNotes} notes for ${place}, the most there can be. Delete one first.`
    }
    if (chars > MEMORY_LIMITS.maxScopeChars) {
      return `Not saved: your notes for ${place} would be ${fmt(chars)} characters, and the most is ${fmt(MEMORY_LIMITS.maxScopeChars)} (they go with every message). Shorten or delete a note first.`
    }
    return null
  }

  function add(owner: unknown, input: unknown): Promise<MemoryChange> {
    if (typeof input !== 'object' || input === null)
      return Promise.resolve({ ok: false, error: NOT_UNDERSTOOD })
    const { text, scope, saveAnyway } = input as Record<string, unknown>
    const checked = checkNoteText(text)
    if (!checked.ok) return Promise.resolve(checked)
    if (!isNoteScope(scope)) return Promise.resolve({ ok: false, error: NOT_UNDERSTOOD })
    return oneAtATime(async () => {
      const projectName = scope === ALL_CHATS ? null : await options.projectName(scope)
      if (scope !== ALL_CHATS && projectName === null) return { ok: false, error: NO_PROJECT }
      const now0 = await readable()
      if (!now0.ok) return now0
      const { memory } = now0
      if (memory.notes.some((note) => note.scope === scope && note.text === checked.text)) {
        return { ok: false, cancelled: true, error: ALREADY }
      }
      const full = roomFor(memory.notes, scope, checked.text, null)
      if (full !== null) return { ok: false, error: full }
      const secrets = checkForSecrets(
        checked.text,
        await options.savedKeys(),
        saveAnyway === true,
        'Notes'
      )
      if (!secrets.ok) return secrets
      const after = scopeUse(memory.notes, scope)
      const no = await ask(
        owner,
        noteQuestion({
          text: checked.text,
          was: null,
          scope,
          projectName,
          on: memory.on,
          warned: secrets.warned,
          after: { notes: after.notes + 1, chars: after.chars + checked.text.length }
        }),
        NOTE_NOT_SAVED
      )
      if (no !== null) return no
      // Read again after the wait: what is written is what is there now, with this note added.
      const fresh = await readable()
      if (!fresh.ok) return fresh
      const id = freshId(fresh.memory.notes)
      if (id === null)
        return { ok: false, error: 'Your notes could not be saved on this computer.' }
      const at = now()
      const note: Note = { id, text: checked.text, scope, createdAt: at, updatedAt: at }
      const fullNow = roomFor(fresh.memory.notes, scope, checked.text, null)
      if (fullNow !== null) return { ok: false, error: fullNow }
      return write({ on: fresh.memory.on, notes: [...fresh.memory.notes, note] })
    })
  }

  function edit(owner: unknown, input: unknown): Promise<MemoryChange> {
    if (typeof input !== 'object' || input === null)
      return Promise.resolve({ ok: false, error: NOT_UNDERSTOOD })
    const { id, text, saveAnyway } = input as Record<string, unknown>
    if (!isNoteId(id)) return Promise.resolve({ ok: false, error: NOT_UNDERSTOOD })
    const checked = checkNoteText(text)
    if (!checked.ok) return Promise.resolve(checked)
    return oneAtATime(async () => {
      const now0 = await readable()
      if (!now0.ok) return now0
      const { memory } = now0
      const old = memory.notes.find((note) => note.id === id)
      if (old === undefined) return { ok: false, error: NO_NOTE }
      if (old.text === checked.text) return { ok: true, status: await status() }
      const full = roomFor(memory.notes, old.scope, checked.text, old)
      if (full !== null) return { ok: false, error: full }
      const secrets = checkForSecrets(
        checked.text,
        await options.savedKeys(),
        saveAnyway === true,
        'Notes'
      )
      if (!secrets.ok) return secrets
      const projectName = old.scope === ALL_CHATS ? null : await options.projectName(old.scope)
      const use = scopeUse(memory.notes, old.scope)
      const no = await ask(
        owner,
        noteQuestion({
          text: checked.text,
          was: old.text,
          scope: old.scope,
          projectName,
          on: memory.on,
          warned: secrets.warned,
          after: { notes: use.notes, chars: use.chars - old.text.length + checked.text.length }
        }),
        NOTE_NOT_SAVED
      )
      if (no !== null) return no
      const fresh = await readable()
      if (!fresh.ok) return fresh
      const still = fresh.memory.notes.find((note) => note.id === id)
      if (still === undefined) return { ok: false, error: NO_NOTE }
      const fullNow = roomFor(fresh.memory.notes, still.scope, checked.text, still)
      if (fullNow !== null) return { ok: false, error: fullNow }
      return write({
        on: fresh.memory.on,
        notes: fresh.memory.notes.map((note) =>
          note.id === id
            ? { ...note, text: checked.text, updatedAt: Math.max(now(), note.createdAt) }
            : note
        )
      })
    })
  }

  function remove(input: unknown): Promise<MemoryChange> {
    const id =
      typeof input === 'object' && input !== null
        ? (input as Record<string, unknown>).id
        : undefined
    if (!isNoteId(id)) return Promise.resolve({ ok: false, error: NOT_UNDERSTOOD })
    return oneAtATime(async () => {
      const now0 = await readable()
      if (!now0.ok) return now0
      const { memory } = now0
      if (!memory.notes.some((note) => note.id === id)) return { ok: false, error: NO_NOTE }
      return write({ on: memory.on, notes: memory.notes.filter((note) => note.id !== id) })
    })
  }

  async function removeScope(projectId: string): Promise<void> {
    // Not one at a time with the person's changes: a project is deleted in its own turn, and this only waits for the file's own queue.
    const current = await file.read()
    if (current.state !== 'ok') return
    const kept = current.value.notes.filter((note) => note.scope !== projectId)
    if (kept.length === current.value.notes.length) return
    await file.write({ on: current.value.on, notes: kept })
  }

  function removeAll(): Promise<MemoryChange> {
    return oneAtATime(async () => {
      const current = await file.read()
      if (current.state === 'none') return { ok: true, status: await status() }
      // A file that cannot be read is kept as a copy beside it before the new, empty one takes its place (keptFile.ts, `replace`).
      const on = current.state === 'ok' ? current.value.on : true
      return write({ on, notes: [] }, current.state === 'unreadable')
    })
  }

  function setOn(owner: unknown, on: unknown): Promise<MemoryChange> {
    if (typeof on !== 'boolean') return Promise.resolve({ ok: false, error: NOT_UNDERSTOOD })
    return oneAtATime(async () => {
      const current = await file.read()
      if (!on) {
        if (current.state === 'ok' && !current.value.on) return { ok: true, status: await status() }
        // Off sends less: no question. A file that cannot be read is kept as a copy, and memory starts again, off and empty.
        if (current.state === 'unreadable') return write({ on: false, notes: [] }, true)
        return write({ on: false, notes: current.state === 'ok' ? current.value.notes : [] })
      }
      if (current.state === 'unreadable') return { ok: false, error: changeRefused(current.why) }
      if (current.state === 'none' || current.value.on) return { ok: true, status: await status() }
      const notes = current.value.notes
      if (notes.length > 0) {
        const no = await ask(owner, memoryOnQuestion(notes), MEMORY_STILL_OFF)
        if (no !== null) return no
      }
      const fresh = await readable()
      if (!fresh.ok) return fresh
      return write({ on: true, notes: fresh.memory.notes })
    })
  }

  async function exportAll(owner: unknown): Promise<MemoryExportResult> {
    const current = await file.read()
    if (current.state === 'unreadable') {
      return {
        ok: false,
        error: `Nothing was exported: your notes could not be read (${current.why}).`
      }
    }
    const memory = current.state === 'ok' ? current.value : { on: true, notes: [] }
    if (memory.notes.length === 0) return { ok: false, error: 'You have no notes to export.' }
    const at = now()
    const dest = await options.pickExportPath(owner, `frontier-notes-${when(at).slice(0, 10)}.txt`)
    if (dest === null) return { ok: false, cancelled: true, error: 'Cancelled.' }
    if (typeof dest !== 'string' || !isAbsolute(dest))
      return { ok: false, error: 'That place could not be used.' }
    if (await isInside(options.dataDir, dest)) {
      return {
        ok: false,
        error: "The notes cannot be exported into the app's own data folder. Choose another place."
      }
    }
    const text = await exportText(memory, at)
    try {
      await fs.writeFile(dest, text, 'utf8')
      if ((await fs.readFile(dest, 'utf8')) !== text)
        throw new Error('the file did not read back the same')
    } catch (error) {
      console.error('Exporting the notes failed:', reason(error))
      return { ok: false, error: 'The notes could not be written there. Choose another place.' }
    }
    return { ok: true, count: memory.notes.length, where: dest }
  }

  /** The export: one plain text file, every note under the place it is for, with when it was made. */
  async function exportText(memory: MemoryFile, at: number): Promise<string> {
    const lines = [
      `Your notes in Frontier App, exported on ${when(at)} (this computer's time).`,
      memory.on
        ? 'Memory is on: each note goes with every message of the chats it is for.'
        : 'Memory is off: no note is sent until it is turned on again.',
      ''
    ]
    const scopes = [...new Set(memory.notes.map((note) => note.scope))].sort((a, b) =>
      a === ALL_CHATS ? -1 : b === ALL_CHATS ? 1 : 0
    )
    for (const scope of scopes) {
      const notes = memory.notes.filter((note) => note.scope === scope)
      const use = scopeUse(memory.notes, scope)
      const projectName = scope === ALL_CHATS ? null : await options.projectName(scope)
      lines.push(
        `For ${placeOf(scope, projectName)} (${notesWord(use.notes)}, ${fmt(use.chars)} of ${fmt(MEMORY_LIMITS.maxScopeChars)} characters):`,
        ''
      )
      for (const note of notes) {
        const changed = note.updatedAt !== note.createdAt ? `, changed ${when(note.updatedAt)}` : ''
        lines.push(
          `- ${note.text.replace(/\r?\n/g, '\n  ')}`,
          `  (made ${when(note.createdAt)}${changed})`
        )
      }
      lines.push('')
    }
    return lines.join('\n')
  }

  async function forRequest(
    projectId: string | null
  ): Promise<{ ok: true; notes: Note[] } | { ok: false; error: string }> {
    try {
      const current = await file.read()
      if (current.state === 'unreadable') return { ok: false, error: memoryUnreadable(current.why) }
      if (current.state === 'none' || !current.value.on) return { ok: true, notes: [] }
      const notes = current.value.notes
      return {
        ok: true,
        notes: [
          ...notes.filter((note) => note.scope === ALL_CHATS),
          ...(projectId === null ? [] : notes.filter((note) => note.scope === projectId))
        ]
      }
    } catch (error) {
      console.error('Reading the notes failed:', reason(error))
      return { ok: false, error: memoryUnreadable('it could not be read from the disk') }
    }
  }

  return { status, add, edit, remove, removeAll, removeScope, setOn, exportAll, forRequest, file }
}
