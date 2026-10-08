// What the window shows of the tool calls of ONE reply, and what a saved chat keeps of them (Stage 11.4, D-041). The calls are the audit log's (audit.ts): the
// window folds the events that main sends as they arrive with the very function main uses to read the log, so the chat and the log always say the same
// thing. A note adds one thing to a call: where in the reply's text it happened, so that it stands between the words the model wrote before it and after it.
// Plain types and functions, no Electron imports; this file is bundled into the page and the preload too.
//
// Everything in a note came from a model or a web page (the search words, the model's reason, the titles of pages), so a note is only ever SHOWN as text,
// and a saved chat's notes are checked field by field when they are read and when they are saved (`checkToolNotes`): nothing in them can be a link, a
// picture or markup, and an address in them opens only after the person clicks and says yes (LinkConfirm, https only).

import { DECLINED_TEXT, REFUSED_TEXT, groupCalls, type AuditCall, type AuditOutcome } from './audit'
import {
  ANSWER_CODES,
  REFUSAL_CODES,
  TOOL_RESULT_LIMITS,
  toolTitle,
  type ToolEvent,
  type ToolSource
} from './tools'

/** One call of a reply, as the chat shows it and a saved chat keeps it: the audit's call, and where in the reply's text it happened. */
export interface ReplyToolNote extends AuditCall {
  /** How many characters of the reply's text came before the call began: the note stands there. */
  offset: number
}

export const NOTE_LIMITS = Object.freeze({
  /** The most notes one reply keeps. The reply's step cap is at most 20 (a refused call counts as a step), so this is room to spare. */
  perMessage: 25,
  /** The model's reason, as the window keeps it. */
  why: 500,
  /** The arguments of one call: how many, the longest name and the longest value. */
  args: 8,
  argName: 32,
  argValue: 2000,
  /** The biggest size a result can have: the core passes on 60,000 characters and a line that says the rest was cut. */
  size: TOOL_RESULT_LIMITS.maxChars + 200
})

/** The notes of a reply from the events so far, each standing at the length of the reply's text when its call began (`offsets`, by call id). */
export function notesOf(
  events: readonly ToolEvent[],
  offsets: ReadonlyMap<string, number>
): ReplyToolNote[] {
  return groupCalls(events).map((call) => ({ ...call, offset: offsets.get(call.id) ?? 0 }))
}

const plural = (n: number, one: string, many: string): string =>
  n === 1 ? `1 ${one}` : `${n.toLocaleString('en-US')} ${many}`

/**
 * What happened to a call, in a sentence for the chat. `live` is true while the reply is still arriving: a call that was asked and not yet answered is
 * waiting for the person (in the system's own message box), and one that was allowed and has no end yet is running. When the reply is over, the same states
 * mean the app was closed meanwhile. The words for a refusal or a no are the audit log's.
 */
export function noteOutcomeText(outcome: AuditOutcome, live: boolean): string {
  switch (outcome.kind) {
    case 'refused':
      return REFUSED_TEXT[outcome.code]
    case 'declined':
      return DECLINED_TEXT[outcome.answer]
    case 'done':
      return outcome.sources.length === 0
        ? 'You allowed it. No sources came back.'
        : `You allowed it. ${plural(outcome.sources.length, 'source came', 'sources came')} back.`
    case 'failed':
      return 'You allowed it. It started, but it failed or was stopped.'
    case 'running':
      return live
        ? 'Working on it...'
        : 'You allowed it. No end was recorded (the app may have been closed).'
    case 'unanswered':
      return live
        ? 'Waiting for your answer in the Windows message box...'
        : 'You were asked. No answer was recorded (the app may have been closed).'
  }
}

/**
 * The notes of a reply that has ended. A call that has no end is one that was cut off: if the person stopped the reply, it was stopped while its question was
 * open (never answered) or while it ran (what main records as a call that failed or was stopped); the notes say so, as the audit log does. If the reply ended
 * some other way, they are left as they are.
 */
export function settleNotes(
  notes: readonly ReplyToolNote[],
  stoppedByPerson: boolean
): ReplyToolNote[] {
  if (!stoppedByPerson) return [...notes]
  return notes.map((note) =>
    note.outcome.kind === 'unanswered'
      ? { ...note, outcome: { kind: 'declined', answer: 'stopped' } }
      : note.outcome.kind === 'running'
        ? { ...note, outcome: { kind: 'failed' } }
        : note
  )
}

/** The arguments of a call as one line, as the person was shown them: each value in quotes (numbers as they are), joined by commas. Empty when there are none. */
export function noteAbout(note: Pick<ReplyToolNote, 'args'>): string {
  if (note.args === null) return ''
  return Object.values(note.args)
    .map((value) => (typeof value === 'number' ? String(value) : `“${value}”`))
    .join(', ')
}

/** The pages that came back from every call in these notes that ran, each once (by address), in the order they came. */
export function sourcesOfNotes(notes: readonly ReplyToolNote[]): ToolSource[] {
  const seen = new Set<string>()
  const pages: ToolSource[] = []
  for (const note of notes) {
    if (note.outcome.kind !== 'done') continue
    for (const source of note.outcome.sources) {
      if (seen.has(source.url)) continue
      seen.add(source.url)
      pages.push({ title: source.title, url: source.url })
    }
  }
  return pages
}

/** The host of an address as the browser will read it, for the line that says where a source really is. Empty when it cannot be read. */
export function hostOf(address: string): string {
  try {
    return new URL(address).host
  } catch {
    return ''
  }
}

export type Piece = { kind: 'text'; text: string } | { kind: 'note'; note: ReplyToolNote }

/**
 * The reply's text cut at the places its calls happened, with each note in its place. Notes that stand at the same place keep their order. A note that stands
 * after the end of the text (it cannot, but a saved chat is not trusted) stands at the end. Text between two notes may be empty and is left out.
 */
export function piecesOf(content: string, notes: readonly ReplyToolNote[]): Piece[] {
  const ordered = notes
    .map((note, index) => ({ note, index, at: Math.min(Math.max(note.offset, 0), content.length) }))
    .sort((a, b) => a.at - b.at || a.index - b.index)
  const pieces: Piece[] = []
  let from = 0
  for (const { note, at } of ordered) {
    if (at > from) pieces.push({ kind: 'text', text: content.slice(from, at) })
    pieces.push({ kind: 'note', note })
    from = at
  }
  if (from < content.length) pieces.push({ kind: 'text', text: content.slice(from) })
  return pieces
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------
// Checking a saved chat's notes. Strict, like the chat's files (D-037): a note that is not exactly what the app writes refuses the whole save (from the page)
// or the whole chat (from a file), and says nothing of its parts. Used by validate.ts.
// ---------------------------------------------------------------------------------------------------------------------------------------------------------

const hasKeys = (value: Record<string, unknown>, names: readonly string[]): boolean => {
  const own = Object.keys(value)
  return own.length === names.length && names.every((name) => own.includes(name))
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isCount = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max

/** Text the eye can read as it is written: no control, invisible or reversing character, and no space but the plain one. */
const UNSEEN = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Co}\p{Cn}\p{Cs}]|[^\P{Zs} ]/u
const isShown = (text: unknown, min: number, max: number): text is string =>
  typeof text === 'string' &&
  Array.from(text).length >= min &&
  Array.from(text).length <= max &&
  !UNSEEN.test(text)

/** A title as the core keeps it: one visible line, white space as single spaces, nothing at either end. The same rule as toolCore's `tidyLine`. */
const isTidyTitle = (text: unknown): text is string =>
  typeof text === 'string' &&
  text !== '' &&
  Array.from(text).length <= TOOL_RESULT_LIMITS.maxTitleChars &&
  !UNSEEN.test(text) &&
  text === text.trim() &&
  !/\s{2,}/.test(text)

/** An address as the core keeps it: a plain https one in the page's own form, ASCII, without a name or a password. */
export function isKeptAddress(url: unknown): url is string {
  if (typeof url !== 'string' || url.length > TOOL_RESULT_LIMITS.maxUrlChars) return false
  if (!/^[\x21-\x7e]+$/.test(url)) return false
  try {
    const parsed = new URL(url)
    return (
      parsed.protocol === 'https:' &&
      parsed.username === '' &&
      parsed.password === '' &&
      parsed.href === url
    )
  } catch {
    return false
  }
}

function checkSources(raw: unknown): ToolSource[] | null {
  if (!Array.isArray(raw) || raw.length > TOOL_RESULT_LIMITS.maxSources) return null
  const kept: ToolSource[] = []
  for (const one of raw) {
    if (!isRecord(one) || !hasKeys(one, ['title', 'url'])) return null
    if (!isTidyTitle(one.title) || !isKeptAddress(one.url)) return null
    kept.push({ title: one.title, url: one.url })
  }
  return kept
}

function checkOutcome(raw: unknown): AuditOutcome | null {
  if (!isRecord(raw)) return null
  switch (raw.kind) {
    case 'refused':
      return hasKeys(raw, ['kind', 'code']) &&
        (REFUSAL_CODES as readonly unknown[]).includes(raw.code)
        ? { kind: 'refused', code: raw.code as (typeof REFUSAL_CODES)[number] }
        : null
    case 'declined':
      return hasKeys(raw, ['kind', 'answer']) &&
        (ANSWER_CODES as readonly unknown[]).includes(raw.answer) &&
        raw.answer !== 'yes'
        ? { kind: 'declined', answer: raw.answer as Exclude<(typeof ANSWER_CODES)[number], 'yes'> }
        : null
    case 'done': {
      if (!hasKeys(raw, ['kind', 'size', 'sources']) || !isCount(raw.size, 0, NOTE_LIMITS.size)) {
        return null
      }
      const sources = checkSources(raw.sources)
      return sources === null ? null : { kind: 'done', size: raw.size, sources }
    }
    case 'failed':
    case 'running':
    case 'unanswered':
      return hasKeys(raw, ['kind']) ? { kind: raw.kind } : null
    default:
      return null
  }
}

function checkArgs(raw: unknown): AuditCall['args'] | undefined {
  if (raw === null) return null
  if (!isRecord(raw)) return undefined
  const names = Object.keys(raw)
  if (names.length > NOTE_LIMITS.args) return undefined
  const kept: Record<string, string | number> = {}
  for (const name of names) {
    const value = raw[name]
    if (!/^[a-z][a-z0-9_]{0,31}$/.test(name)) return undefined
    if (typeof value === 'number' && Number.isFinite(value)) kept[name] = value
    else if (isShown(value, 0, NOTE_LIMITS.argValue)) kept[name] = value
    else return undefined
  }
  return kept
}

/**
 * The notes of one saved message, checked: an exact copy, or null when anything in them is not what the app writes. `textLength` is the length of the message's
 * text, which a note's place must lie within.
 */
export function checkToolNotes(raw: unknown, textLength: number): ReplyToolNote[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > NOTE_LIMITS.perMessage) return null
  const notes: ReplyToolNote[] = []
  const ids = new Set<string>()
  for (const one of raw) {
    if (
      !isRecord(one) ||
      !hasKeys(one, ['id', 'tool', 'title', 'step', 'at', 'args', 'why', 'outcome', 'offset'])
    ) {
      return null
    }
    const { id, tool, title, step, at, args, why, outcome, offset } = one
    if (typeof id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,39}$/.test(id) || ids.has(id)) return null
    if (
      typeof tool !== 'string' ||
      !(/^[a-z][a-z0-9_]{1,31}$/.test(tool) || tool === '(unknown)')
    ) {
      return null
    }
    // The title is what the app calls the tool, and nothing else: it is shown, so it is not left to the file.
    if (title !== toolTitle(tool)) return null
    if (!isCount(step, 1, 1000) || !isCount(at, 0, Number.MAX_SAFE_INTEGER)) return null
    if (!isCount(offset, 0, textLength)) return null
    const shownArgs = checkArgs(args)
    if (shownArgs === undefined) return null
    if (why !== null && !isShown(why, 0, NOTE_LIMITS.why)) return null
    const checkedOutcome = checkOutcome(outcome)
    if (checkedOutcome === null) return null
    ids.add(id)
    notes.push({
      id,
      tool,
      title,
      step,
      at,
      args: shownArgs,
      why,
      outcome: checkedOutcome,
      offset
    })
  }
  return notes
}
