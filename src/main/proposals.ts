import { createHash } from 'crypto'
import { WORKSPACE_LIMITS } from '../shared/workspace'
import { diffLines, splitLines, type LineDiff } from './lineDiff'
import { lineEndings, type DecodedText, type LineEnding } from './workspaceText'

// What a proposed change is (Stage 12.4, D-042): a change to ONE file that the model asked for and the person has not decided on. It is held in MEMORY (nothing is
// written anywhere, and it is gone when the app closes); the Review window (12.5) shows it whole and the person applies or drops it (12.6). Here: how a change
// is made from the file as it is now (an edit: the text to find occurs exactly once; a new file), what is refused at once, the exact bytes that would be
// written and their fingerprint (what the system's box will name, so that what is written is what was reviewed), the flags the Review window shows, and the
// store of what is waiting. No Electron imports, no file access.

export const PROPOSAL_LIMITS = Object.freeze({
  /** The most proposals waiting at one time; the person has to decide on some before more can be made. */
  waiting: 20,
  /** The most proposals one reply may make. */
  perReply: 10
})

export interface ProposalFlags {
  /** The file is hidden or looks like it holds secrets (the one-by-one class): a red line in the Review window and in the box. */
  secret: boolean
  /** The file runs commands when it is used later (a script, `package.json`, a workflow, a task file): an amber line. */
  runsCommands: boolean
}

export interface Proposal {
  id: string
  kind: 'edit' | 'create'
  /** The names below the workspace, as they really are, and the same as one text with `/`. */
  rel: string[]
  path: string
  /** The real path at the time of the proposal (the apply looks at it again). */
  real: string
  /** The SHA-256 of the file's bytes as the proposal saw them, or null for a new file: a file that is not these bytes any more is not changed. */
  baseHash: string | null
  /** The file's text before (null for a new file) and after, as the file would be: line endings and byte-order mark kept. */
  before: string | null
  after: string
  bom: boolean
  eol: LineEnding
  diff: LineDiff
  added: number
  removed: number
  /** The size in bytes of the file as it would be, and the first 12 characters of the SHA-256 of those exact bytes. */
  bytes: number
  fingerprint: string
  flags: ProposalFlags
  /** The model's reason (cleaned by the core), shown beside the change. */
  why: string
  createdAt: number
}

export type Made = { ok: true; proposal: Omit<Proposal, 'id'> } | { ok: false; why: string }

const BOM = String.fromCharCode(0xfeff)
const no = (why: string): { ok: false; why: string } => ({ ok: false, why })

/** The characters that change what a text means to a reader without showing: bidirectional controls, zero-width and joiner characters, the soft hyphen. */
const HIDDEN_RANGES: readonly (readonly [number, number])[] = [
  [0x202a, 0x202e],
  [0x2066, 0x2069],
  [0x200b, 0x200f],
  [0x2060, 0x2064],
  [0xfeff, 0xfeff],
  [0x00ad, 0x00ad],
  [0x061c, 0x061c],
  [0x180e, 0x180e]
]

/** The first hidden or reversing character in a text, as "U+202E", or null. */
export function firstHiddenCharacter(text: string): string | null {
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0
    if (HIDDEN_RANGES.some(([from, to]) => code >= from && code <= to)) {
      return `U+${code.toString(16).toUpperCase().padStart(4, '0')}`
    }
  }
  return null
}

/** Names whose files run commands when they are used later (the plan, D4). */
const RUNS_COMMANDS =
  /(^|\/)(package\.json|makefile|[^/]*\.(bat|cmd|ps1|vbs|vbe|wsf|sh))$|(^|\/)\.vscode\/tasks\.json$|(^|\/)\.github\/workflows\//i

export const runsCommands = (path: string): boolean => RUNS_COMMANDS.test(path)

export const sha256 = (bytes: Uint8Array): string =>
  createHash('sha256').update(bytes).digest('hex')

/** The bytes that would be written for a proposal's text. */
export const bytesFor = (text: string, bom: boolean): Buffer =>
  Buffer.from(bom ? BOM + text : text, 'utf8')

function build(
  parts: Pick<
    Proposal,
    'kind' | 'rel' | 'real' | 'baseHash' | 'before' | 'after' | 'bom' | 'eol' | 'why'
  > & { secret: boolean; now: number }
): Made {
  const bytes = bytesFor(parts.after, parts.bom)
  if (bytes.length > WORKSPACE_LIMITS.maxFileBytes) {
    return no(
      `The file would be ${bytes.length.toLocaleString('en-US')} bytes after the change, more than the ${WORKSPACE_LIMITS.maxFileBytes.toLocaleString('en-US')} a file may have here.`
    )
  }
  const diff = diffLines(
    parts.before === null ? [] : splitLines(parts.before),
    splitLines(parts.after)
  )
  const path = parts.rel.join('/')
  return {
    ok: true,
    proposal: {
      kind: parts.kind,
      rel: parts.rel,
      path,
      real: parts.real,
      baseHash: parts.baseHash,
      before: parts.before,
      after: parts.after,
      bom: parts.bom,
      eol: parts.eol,
      diff,
      added: diff.added,
      removed: diff.removed,
      bytes: bytes.length,
      fingerprint: sha256(bytes).slice(0, 12),
      flags: { secret: parts.secret, runsCommands: runsCommands(path) },
      why: parts.why,
      createdAt: parts.now
    }
  }
}

/** How many times `needle` occurs in `text`, overlaps included (a text that could be read two ways is not "exactly once"). */
function occurrences(text: string, needle: string): { count: number; first: number } {
  let count = 0
  let first = -1
  for (let at = text.indexOf(needle); at !== -1; at = text.indexOf(needle, at + 1)) {
    if (count === 0) first = at
    count++
    if (count > 50) break
  }
  return { count, first }
}

export interface EditInput {
  /** The file as it is now: its bytes and the text they decode to. */
  bytes: Uint8Array
  decoded: Extract<DecodedText, { ok: true }>
  rel: string[]
  real: string
  find: string
  replace: string
  why: string
  /** True for a file of the one-by-one class. */
  secret: boolean
  now: number
}

/**
 * A change to an existing file: `find` must occur exactly once, and is replaced by `replace`. A file with Windows line endings is matched and written with
 * them (the model may send either kind); a file with mixed endings is matched as it is. Refused in words (for the model) when the change cannot be made,
 * when it would change nothing, or when it adds a hidden or reversing character.
 */
export function makeEdit(input: EditInput): Made {
  const { decoded, find, replace } = input
  if (find === replace)
    return no(
      'The text to find and the text to put in its place are the same, so nothing would change.'
    )
  const hidden = firstHiddenCharacter(replace)
  if (hidden !== null) {
    return no(
      `The new text holds a hidden or reversing character (${hidden}), which is never proposed: such characters can make code read differently from what it does. Leave it out.`
    )
  }
  const crlf = decoded.eol === 'crlf'
  const hay = crlf ? decoded.text.replace(/\r\n/g, '\n') : decoded.text
  const needle = crlf ? find.replace(/\r\n/g, '\n') : find
  const { count, first } = occurrences(hay, needle)
  if (count === 0) {
    return no(
      'The text to find is not in the file exactly as given (letters, spaces and line breaks all count). Read the file again and copy the text as it is.'
    )
  }
  if (count > 1) {
    return no(
      `The text to find occurs ${count > 50 ? 'more than 50' : count} times in the file. Give more of the text around it, so that it occurs exactly once.`
    )
  }
  const put = crlf ? replace.replace(/\r\n/g, '\n') : replace
  let after = hay.slice(0, first) + put + hay.slice(first + needle.length)
  if (crlf) after = after.replace(/\n/g, '\r\n')
  if (after === decoded.text) return no('That change would leave the file as it is.')
  return build({
    kind: 'edit',
    rel: input.rel,
    real: input.real,
    baseHash: sha256(input.bytes),
    before: decoded.text,
    after,
    bom: decoded.bom,
    eol: decoded.eol,
    why: input.why,
    secret: input.secret,
    now: input.now
  })
}

export interface CreateInput {
  rel: string[]
  real: string
  content: string
  why: string
  secret: boolean
  now: number
}

/** A new file: its content as given (line endings as sent, no byte-order mark). Refused when it adds a hidden or reversing character. */
export function makeCreate(input: CreateInput): Made {
  const hidden = firstHiddenCharacter(input.content)
  if (hidden !== null) {
    return no(
      `The new file's text holds a hidden or reversing character (${hidden}), which is never proposed: such characters can make code read differently from what it does. Leave it out.`
    )
  }
  return build({
    kind: 'create',
    rel: input.rel,
    real: input.real,
    baseHash: null,
    before: null,
    after: input.content,
    bom: false,
    eol: lineEndings(input.content),
    why: input.why,
    secret: input.secret,
    now: input.now
  })
}

export interface ProposalStore {
  /** Keeps a proposal and gives it its id ("p1", "p2"...), or says why not (too many are waiting). */
  add(proposal: Omit<Proposal, 'id'>): { ok: true; proposal: Proposal } | { ok: false; why: string }
  get(id: unknown): Proposal | undefined
  /** Newest first. */
  list(): Proposal[]
  remove(id: unknown): boolean
  count(): number
}

export function createProposalStore(): ProposalStore {
  const waiting = new Map<string, Proposal>()
  let counter = 0
  return {
    add: (proposal) => {
      if (waiting.size >= PROPOSAL_LIMITS.waiting) {
        return {
          ok: false,
          why: `There are already ${PROPOSAL_LIMITS.waiting} proposals waiting for the person to decide on. No more can be made until they have.`
        }
      }
      counter++
      const kept: Proposal = Object.freeze({ ...proposal, id: `p${counter}` })
      waiting.set(kept.id, kept)
      return { ok: true, proposal: kept }
    },
    get: (id) => (typeof id === 'string' ? waiting.get(id) : undefined),
    list: () => [...waiting.values()].reverse(),
    remove: (id) => (typeof id === 'string' ? waiting.delete(id) : false),
    count: () => waiting.size
  }
}
