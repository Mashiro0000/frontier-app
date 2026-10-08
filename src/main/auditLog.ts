import { promises as fs } from 'fs'
import type { FileHandle } from 'fs/promises'
import { dirname } from 'path'
import {
  ANSWER_CODES,
  REFUSAL_CODES,
  TOOL_RESULT_LIMITS,
  type ToolEvent,
  type ToolSource
} from '../shared/tools'
import {
  isEnvelope,
  openChat,
  sealChat,
  SEALED_PREFIX,
  type FileForm,
  type WriteMode
} from './chatFile'
import type { SecretBox } from './credentialStore'
import { KeptRefused, type KeptDocument, type KeptRead } from './keptFile'
import { isSafeExternalUrl } from './security'

// The audit log (Stage 11.2, D-041): one line of JSON for every thing that happens to a tool call (the events of shared/tools.ts), in audit/log.jsonl in the
// data folder, written by main alone and kept for ever until the person deletes it all. It holds no page text: what was asked, what the person answered, how
// big the result was and which sources (title and address) came back. No Electron imports, so it is checked under plain Node with a stand-in for the secure
// storage.
//
// WRITING. It is appended to and never rewritten, which suits a log: a crash can only cut off the last line, a cut line is skipped when the file is read, and
// the next write starts on a new line, so it cannot join the cut one. No temp file and no rename (every rename fails with EXDEV in this project's EFS-encrypted
// data folder, D-010). `append` is awaited by the core BEFORE a question is asked and before a tool runs (toolCore.ts): it REJECTS when the line cannot be kept
// (the disk refuses, the protection rule says no, the line would not read back), and then nothing is asked or run. Every line is proved by reading it back from
// the disk. The form of a line follows the one rule for how the app's files may be written (`writeMode`, D-035): plain, or sealed like a chat when the person
// has turned encryption on (the same envelope, one sealed line each, chatFile.ts); with the key unusable no line is written at all.
//
// READING. Only the newest part of the file is read (the window shows the newest calls; older ones stay in the file). A line that cannot be read is counted,
// never guessed at and never removed: cut off, edited, from another version, or sealed with a key that cannot be used now.
//
// ENCRYPTION being turned on or off rewrites the lines in the new form, all together (`document.conform`, with the kept files, D-039): the converted text is
// written to `<file>.tmp` with a closing line that says how many lines came before it, proved by reading it back, written over the file and proved again. A
// crash in the middle is mended at the next use: a `.tmp` that is whole (its closing line is right) finishes the job, one that is cut off is thrown away and
// the file was never touched. A sealed line that cannot be opened stops the rewrite and leaves the file exactly as it is.

export const AUDIT_FORMAT_VERSION = 1

export const AUDIT_LIMITS = Object.freeze({
  /** One plain line: an event with twenty sources at their longest is about 50,000 characters. */
  maxLineChars: 65_536,
  /** How much of the end of the file the window reads. */
  maxReadBytes: 2 * 1024 * 1024,
  /** ...and an export. */
  maxExportBytes: 64 * 1024 * 1024,
  /** The most the whole-file work (rewriting the lines in another form) takes on. */
  maxConformBytes: 128 * 1024 * 1024
})
const MAX_SEALED_LINE_CHARS = Math.ceil((AUDIT_LIMITS.maxLineChars + 256) / 3) * 4 + 128

const TOOL_ID = /^(?:[a-z][a-z0-9_]{1,31}|\(unknown\))$/
const CALL_ID = /^[a-z0-9][a-z0-9-]{0,39}$/
const ARG_NAME = /^[a-z][a-z0-9_]{0,31}$/
/** Controls, invisible and reversing characters, line and paragraph separators, private-use, unassigned and lone surrogates: never in a line of the log. */
const HIDDEN = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Co}\p{Cn}\p{Cs}]/u

const isTime = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0
const isCount = (value: unknown, max: number): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= max
const isText = (value: unknown, min: number, max: number): value is string =>
  typeof value === 'string' && value.length >= min && value.length <= max && !HIDDEN.test(value)

function exactKeys(raw: Record<string, unknown>, keys: readonly string[]): boolean {
  const have = Object.keys(raw)
  return (
    have.length === keys.length &&
    keys.every((key) => Object.prototype.hasOwnProperty.call(raw, key))
  )
}

const HEAD = ['v', 'type', 'at', 'call', 'tool', 'step'] as const

function parseSource(raw: unknown): ToolSource | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const fields = raw as Record<string, unknown>
  if (!exactKeys(fields, ['title', 'url'])) return null
  const { title, url } = fields
  if (!isText(title, 1, TOOL_RESULT_LIMITS.maxTitleChars * 2)) return null
  if (Array.from(title).length > TOOL_RESULT_LIMITS.maxTitleChars) return null
  if (!isText(url, 9, TOOL_RESULT_LIMITS.maxUrlChars)) return null
  if (!/^https:\/\/[\x21-\x7e]+$/.test(url) || !isSafeExternalUrl(url)) return null
  return { title, url }
}

/**
 * One event exactly as this app writes one, from what JSON.parse made of a line, or null: a field more or less, a value out of its range, a character the
 * eye cannot see, an address that is not a plain https one, an event of a kind this version does not know. Nothing is repaired.
 */
export function parseAuditEvent(raw: unknown): ToolEvent | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const o = raw as Record<string, unknown>
  if (o.v !== AUDIT_FORMAT_VERSION) return null
  const { type, at, call, tool, step } = o
  if (!isTime(at) || typeof call !== 'string' || !CALL_ID.test(call)) return null
  if (typeof tool !== 'string' || !TOOL_ID.test(tool) || !isCount(step, 100_000)) return null
  switch (type) {
    case 'refused': {
      const code = o.code
      if (!exactKeys(o, [...HEAD, 'code'])) return null
      if (typeof code !== 'string' || !(REFUSAL_CODES as readonly string[]).includes(code)) {
        return null
      }
      return { type, at, call, tool, step, code: code as (typeof REFUSAL_CODES)[number] }
    }
    case 'asked': {
      if (!exactKeys(o, [...HEAD, 'args', 'why'])) return null
      const { args, why } = o
      if (!isText(why, 1, 1000)) return null
      if (typeof args !== 'object' || args === null || Array.isArray(args)) return null
      const shown: Record<string, string | number> = {}
      const names = Object.keys(args)
      if (names.length > 8) return null
      for (const name of names) {
        const value = (args as Record<string, unknown>)[name]
        if (!ARG_NAME.test(name)) return null
        if (typeof value === 'number') {
          if (!Number.isFinite(value)) return null
          shown[name] = value
        } else if (isText(value, 0, 2000)) {
          shown[name] = value
        } else {
          return null
        }
      }
      return { type, at, call, tool, step, args: shown, why }
    }
    case 'answered': {
      const answer = o.answer
      if (!exactKeys(o, [...HEAD, 'answer'])) return null
      if (typeof answer !== 'string' || !(ANSWER_CODES as readonly string[]).includes(answer)) {
        return null
      }
      return { type, at, call, tool, step, answer: answer as (typeof ANSWER_CODES)[number] }
    }
    case 'ran':
      return exactKeys(o, HEAD) ? { type, at, call, tool, step } : null
    case 'result': {
      if (!exactKeys(o, [...HEAD, 'ok', 'size', 'sources', 'searched', 'searches'])) return null
      const { ok, size, sources, searched, searches } = o
      if (typeof ok !== 'boolean') return null
      if (searched !== null) {
        if (!isText(searched, 1, TOOL_RESULT_LIMITS.maxSearchedChars * 2)) return null
        if (Array.from(searched).length > TOOL_RESULT_LIMITS.maxSearchedChars) return null
      }
      if (!isCount(searches, TOOL_RESULT_LIMITS.maxSearches)) return null
      if (!isCount(size, TOOL_RESULT_LIMITS.maxChars + 200)) return null
      if (!Array.isArray(sources) || sources.length > TOOL_RESULT_LIMITS.maxSources) return null
      const kept: ToolSource[] = []
      for (const item of sources as unknown[]) {
        const source = parseSource(item)
        if (source === null) return null
        kept.push(source)
      }
      return { type, at, call, tool, step, ok, size, sources: kept, searched, searches }
    }
    default:
      return null
  }
}

/** The fields of an event in the order a line writes them. Throws for anything that is not an event of this app. */
function lineObject(event: ToolEvent): Record<string, unknown> {
  const head = {
    v: AUDIT_FORMAT_VERSION,
    type: event.type,
    at: event.at,
    call: event.call,
    tool: event.tool,
    step: event.step
  }
  switch (event.type) {
    case 'refused':
      return { ...head, code: event.code }
    case 'asked':
      return { ...head, args: { ...event.args }, why: event.why }
    case 'answered':
      return { ...head, answer: event.answer }
    case 'ran':
      return head
    case 'result':
      return {
        ...head,
        ok: event.ok,
        size: event.size,
        sources: event.sources.map(({ title, url }) => ({ title, url })),
        searched: event.searched,
        searches: event.searches
      }
    default:
      throw new Error('that is not an event of this app')
  }
}

/** The plain text of one line (no line break in it). Throws when the event would not be read back as itself: such an event is never written. */
export function auditLine(event: ToolEvent): string {
  const text = JSON.stringify(lineObject(event))
  const back = parseAuditEvent(JSON.parse(text))
  if (back === null || JSON.stringify(lineObject(back)) !== text) {
    throw new Error('the record would not be readable again')
  }
  return text
}

/** The closing line of a rewrite's `.tmp`: it says how many lines came before it, so a cut-off file is told from a whole one. */
const commitLine = (lines: number): string =>
  JSON.stringify({ v: AUDIT_FORMAT_VERSION, type: 'commit', lines })

/** The lines of a whole `.tmp` (everything before its closing line, each ending in a line break) or null when it is cut off or its closing line is wrong. */
function wholeBody(text: string): string | null {
  if (!text.endsWith('\n')) return null
  const cut = text.lastIndexOf('\n', text.length - 2)
  const body = text.slice(0, cut + 1)
  const last = text.slice(cut + 1, -1)
  let count = 0
  for (const ch of body) if (ch === '\n') count += 1
  return last === commitLine(count) && count > 0 ? body : null
}

type Decoded = { event: ToolEvent; form: FileForm; plain: string } | { bad: 'damaged' | 'sealed' }

export interface AuditSnapshot {
  state: 'none' | 'ok'
  /** The readable events of the part that was read, oldest first. */
  events: ToolEvent[]
  /** Lines that could not be read (cut off, edited, from another version, or sealed with a key that cannot be used now). */
  skipped: number
  /** Of those, sealed lines that the key cannot open. */
  sealedClosed: number
  /** The file is bigger than the part that was read. */
  older: boolean
  /** How the readable lines are kept: null when there are none. */
  form: FileForm | 'mixed' | null
}

export interface AuditLogOptions {
  /** The file's full path; a function so that the data folder is not asked for before it is known. */
  pathOf: () => string
  box?: SecretBox
  /** The one rule for how the app's files may be written (chatProtection.ts). */
  writeMode: () => Promise<WriteMode>
}

export interface AuditLog {
  /** Keeps one event as a new line, proved by reading it back. REJECTS when it cannot: then the caller must not go on (KeptRefused carries a sentence for the person). */
  append(event: ToolEvent): Promise<void>
  /** The newest part of the log (`maxBytes`, by default what the window reads). Never changes the file. */
  read(options?: { maxBytes?: number }): Promise<AuditSnapshot>
  /** Deletes the whole log (and a leftover rewrite). Rejects if the file is still there afterwards. */
  removeAll(): Promise<void>
  /** What the encryption flow needs of it (keptFile.ts `KeptDocument`): how the lines are kept, and rewriting them in the form the rule now says. */
  document: KeptDocument
  whenIdle(): Promise<void>
}

export function createAuditLog(options: AuditLogOptions): AuditLog {
  const { pathOf, box, writeMode } = options
  let queue: Promise<unknown> = Promise.resolve()
  const inOrder = <R>(task: () => Promise<R>): Promise<R> => {
    const run = queue.then(task)
    queue = run.catch(() => undefined)
    return run
  }

  function decodeLine(line: string): Decoded {
    if (line.length > MAX_SEALED_LINE_CHARS) return { bad: 'damaged' }
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      return { bad: 'damaged' }
    }
    if (isEnvelope(parsed)) {
      const opened = openChat(parsed, box)
      if (!opened.ok) return { bad: 'sealed' }
      if (opened.text.length > AUDIT_LIMITS.maxLineChars) return { bad: 'damaged' }
      let inner: unknown
      try {
        inner = JSON.parse(opened.text)
      } catch {
        return { bad: 'damaged' }
      }
      const event = parseAuditEvent(inner)
      return event === null ? { bad: 'damaged' } : { event, form: 'encrypted', plain: opened.text }
    }
    if (line.length > AUDIT_LIMITS.maxLineChars) return { bad: 'damaged' }
    const event = parseAuditEvent(parsed)
    return event === null ? { bad: 'damaged' } : { event, form: 'plain', plain: line }
  }

  /** The end of the file, from a whole line on: `older` says the start was left out. */
  async function readPart(
    file: string,
    maxBytes: number
  ): Promise<{ state: 'none' } | { state: 'text'; text: string; older: boolean }> {
    let handle: FileHandle
    try {
      handle = await fs.open(file, 'r')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { state: 'none' }
      throw error
    }
    try {
      const { size } = await handle.stat()
      const start = Math.max(0, size - maxBytes)
      const buffer = Buffer.alloc(size - start)
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, start)
      let text = buffer.subarray(0, bytesRead).toString('utf8')
      if (start > 0) {
        // It began in the middle of a line: that line is not whole.
        const cut = text.indexOf('\n')
        text = cut < 0 ? '' : text.slice(cut + 1)
      }
      if (text.charCodeAt(0) === 0xfeff) text = text.slice(1) // a byte-order mark, which some editors add
      return { state: 'text', text, older: start > 0 }
    } finally {
      await handle.close()
    }
  }

  function snapshotOf(text: string, older: boolean): AuditSnapshot {
    const events: ToolEvent[] = []
    let skipped = 0
    let sealedClosed = 0
    let plain = 0
    let sealed = 0
    for (const line of text.split('\n')) {
      if (line.trim() === '') continue
      const decoded = decodeLine(line)
      if ('bad' in decoded) {
        skipped += 1
        if (decoded.bad === 'sealed') sealedClosed += 1
        continue
      }
      events.push(decoded.event)
      if (decoded.form === 'plain') plain += 1
      else sealed += 1
    }
    const form =
      plain > 0 && sealed > 0 ? 'mixed' : plain > 0 ? 'plain' : sealed > 0 ? 'encrypted' : null
    return { state: 'ok', events, skipped, sealedClosed, older, form }
  }

  /** The size of the file and whether it ends in a line break (a cut-off last line does not): read afresh for every line, so nothing is assumed. */
  async function tailOf(file: string): Promise<{ size: number; endsInNewline: boolean }> {
    let handle: FileHandle
    try {
      handle = await fs.open(file, 'r')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        return { size: 0, endsInNewline: true }
      throw error
    }
    try {
      const { size } = await handle.stat()
      if (size === 0) return { size, endsInNewline: true }
      const last = Buffer.alloc(1)
      await handle.read(last, 0, 1, size - 1)
      return { size, endsInNewline: last[0] === 0x0a }
    } finally {
      await handle.close()
    }
  }

  async function lastBytes(file: string, count: number): Promise<Buffer> {
    const handle = await fs.open(file, 'r')
    try {
      const { size } = await handle.stat()
      const start = Math.max(0, size - count)
      const buffer = Buffer.alloc(size - start)
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, start)
      return buffer.subarray(0, bytesRead)
    } finally {
      await handle.close()
    }
  }

  /** Mends what a rewrite cut off (see the top): a whole `.tmp` finishes the job, a cut-off one is thrown away. Runs first in every turn of the queue. */
  async function recover(): Promise<void> {
    const file = pathOf()
    const tmp = `${file}.tmp`
    let tmpText: string
    try {
      tmpText = await fs.readFile(tmp, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      throw error
    }
    let current: string | null = null
    try {
      current = await fs.readFile(file, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    const body = wholeBody(tmpText)
    // No file: it was deleted since (never a log to bring back from a leftover). Cut off: the file was never touched.
    if (current === null || body === null) {
      await fs.rm(tmp, { force: true })
      return
    }
    // Already in place (more lines may follow it): only the leftover goes. Otherwise the copy was cut off or never began: finish it.
    if (!current.startsWith(body)) {
      await fs.writeFile(file, body, { mode: 0o600 })
      if ((await fs.readFile(file, 'utf8')) !== body) {
        throw new Error('the audit log could not be mended')
      }
    }
    await fs.rm(tmp, { force: true })
  }

  async function appendNow(event: ToolEvent): Promise<void> {
    await recover()
    const mode = await writeMode()
    if ('refused' in mode) throw new KeptRefused(mode.refused)
    const plain = auditLine(event)
    let data = plain
    if (mode.form === 'encrypted') {
      if (box === undefined || !box.isAvailable()) {
        throw new Error('there is no secure storage to encrypt with')
      }
      data = sealChat(plain, box)
    }
    // What is about to be written must read back as this very event BEFORE anything is written (a secure storage that makes junk must not leave a junk line).
    const check = decodeLine(data)
    if ('bad' in check || check.plain !== plain || check.form !== mode.form) {
      throw new Error('the record would not read back')
    }
    const file = pathOf()
    await fs.mkdir(dirname(file), { recursive: true, mode: 0o700 })
    const before = await tailOf(file)
    const wrote = Buffer.from(`${before.endsInNewline ? '' : '\n'}${data}\n`, 'utf8')
    await fs.appendFile(file, wrote, { mode: 0o600 })
    const after = await tailOf(file)
    // At least, not exactly: another copy of the app may have added a line of its own.
    if (after.size < before.size + wrote.length) throw new Error('the audit log did not grow')
    const tail = await lastBytes(file, wrote.length)
    if (!tail.equals(wrote)) throw new Error('the record did not reach the disk as it was written')
  }

  async function readNow(maxBytes: number): Promise<AuditSnapshot> {
    await recover()
    const part = await readPart(pathOf(), maxBytes)
    if (part.state === 'none') {
      return { state: 'none', events: [], skipped: 0, sealedClosed: 0, older: false, form: null }
    }
    return snapshotOf(part.text, part.older)
  }

  async function removeNow(): Promise<void> {
    const file = pathOf()
    await fs.rm(`${file}.tmp`, { force: true })
    await fs.rm(file, { force: true })
    try {
      await fs.stat(file)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      throw error
    }
    throw new Error('the audit log is still there')
  }

  /** How the lines are kept, by what they begin with (nothing is opened): the encryption flow asks this for its counts. */
  async function formNow(): Promise<KeptRead<undefined>> {
    await recover()
    const part = await readPart(pathOf(), AUDIT_LIMITS.maxConformBytes)
    if (part.state === 'none') return { state: 'none' }
    if (part.older) {
      return { state: 'unreadable', why: 'it is larger than this app opens in one go' }
    }
    let plain = 0
    let sealed = 0
    for (const line of part.text.split('\n')) {
      if (line.trim() === '') continue
      if (line.startsWith(SEALED_PREFIX)) sealed += 1
      else plain += 1
    }
    const mode = await writeMode().catch(() => ({ refused: 'unknown' }) as WriteMode)
    const target: FileForm = 'refused' in mode ? 'plain' : mode.form
    // A file with both is reported in the form that is NOT the target, so that the flow sees it as work to do whichever way it turns.
    const form: FileForm =
      plain > 0 && sealed > 0
        ? target === 'encrypted'
          ? 'plain'
          : 'encrypted'
        : sealed > 0
          ? 'encrypted'
          : plain > 0
            ? 'plain'
            : target
    return { state: 'ok', value: undefined, form }
  }

  async function conformNow(): Promise<
    'none' | 'already' | 'changed' | 'failed' | 'unreadable' | 'refused'
  > {
    await recover()
    const file = pathOf()
    const part = await readPart(file, AUDIT_LIMITS.maxConformBytes)
    if (part.state === 'none') return 'none'
    if (part.older) return 'failed'
    const decoded: { raw: string; d: Decoded }[] = []
    for (const raw of part.text.split('\n')) {
      if (raw.trim() === '') continue
      const d = decodeLine(raw)
      if ('bad' in d && d.bad === 'sealed') return 'unreadable' // the file stays exactly as it is
      decoded.push({ raw, d })
    }
    const mode = await writeMode()
    if ('refused' in mode) return 'refused'
    const wanted = mode.form
    if (!decoded.some(({ d }) => !('bad' in d) && d.form !== wanted)) return 'already'
    try {
      const lines = decoded.map(({ raw, d }) => {
        if ('bad' in d || d.form === wanted) return raw // a damaged line is kept as it is
        if (wanted === 'plain') return d.plain
        if (box === undefined || !box.isAvailable()) {
          throw new Error('there is no secure storage to encrypt with')
        }
        return sealChat(d.plain, box)
      })
      const body = `${lines.join('\n')}\n`
      const tmp = `${file}.tmp`
      const proved = async (path: string, text: string): Promise<boolean> =>
        (await fs.readFile(path, 'utf8')) === text
      const sameEvents = (text: string): boolean => {
        const back = text.split('\n').filter((line) => line.trim() !== '')
        return (
          back.length === decoded.length &&
          back.every((line, i) => {
            const was = decoded[i].d
            const now = decodeLine(line)
            if ('bad' in was) return 'bad' in now && line === decoded[i].raw
            return !('bad' in now) && now.plain === was.plain && now.form === wanted
          })
        )
      }
      await fs.writeFile(tmp, `${body}${commitLine(lines.length)}\n`, { mode: 0o600 })
      if (!(await proved(tmp, `${body}${commitLine(lines.length)}\n`))) {
        await fs.rm(tmp, { force: true }).catch(() => undefined)
        throw new Error('the rewritten log could not be read back')
      }
      await fs.writeFile(file, body, { mode: 0o600 })
      if (!(await proved(file, body)) || !sameEvents(body)) {
        // The file is mended from the `.tmp` at the next use; it is left in place for that.
        throw new Error('the audit log could not be read back after the rewrite')
      }
      await fs.rm(tmp, { force: true })
      return 'changed'
    } catch (error) {
      console.error(
        'Rewriting the audit log failed:',
        error instanceof Error ? error.message : error
      )
      return 'failed'
    }
  }

  return {
    append: (event) => inOrder(() => appendNow(event)),
    read: (readOptions) =>
      inOrder(() => readNow(readOptions?.maxBytes ?? AUDIT_LIMITS.maxReadBytes)),
    removeAll: () => inOrder(removeNow),
    document: {
      read: () => inOrder(formNow),
      conform: () => inOrder(conformNow)
    },
    whenIdle: () => queue.then(() => undefined)
  }
}
