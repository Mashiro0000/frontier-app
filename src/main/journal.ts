import { promises as fs } from 'fs'
import type { FileHandle } from 'fs/promises'
import { dirname } from 'path'
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

// A journal of the person's own things, in one file of lines (Stage 12.6, D-042): the undo copies of the changes that were applied. The same machinery as the audit log
// (auditLog.ts, D-041), made for any kind of line: appended and never rewritten; each line PROVED by reading it back from the disk before the caller goes on (the
// caller REJECTS the whole job when `append` rejects, so a file is never changed without its undo copy); sealed like the chats when encryption is on, one envelope per
// line (the one rule for how the app's files may be written, D-035); rewritten in the other form, all together, when encryption is turned on or off (a `.tmp` with a
// closing line that says how many lines came before it, so that a crash in the middle is mended and a cut-off copy thrown away); a line that cannot be read is
// counted and left where it is. What a line holds is the caller's: `parse` says whether a thing parsed from a line is exactly one of this app's, and `render` turns
// one back into the plain object that is written. No Electron imports.

const commitLine = (version: number, lines: number): string =>
  JSON.stringify({ v: version, type: 'commit', lines })

export interface JournalOptions<T> {
  /** The file's full path; a function so that the data folder is not asked for before it is known. */
  pathOf: () => string
  box?: SecretBox
  /** The one rule for how the app's files may be written (chatProtection.ts). */
  writeMode: () => Promise<WriteMode>
  /** What a line may hold: exactly one of this app's entries, or null. Nothing is repaired. */
  parse: (raw: unknown) => T | null
  /** The plain object to write for an entry. */
  render: (value: T) => unknown
  /** The version number in the closing line of a rewrite (it must differ from the version an entry carries only in its `type`). */
  version: number
  /** The longest plain line, in characters. */
  maxLineChars: number
  /** The most the whole-file work (rewriting the lines in another form) takes on. */
  maxConformBytes: number
  /** What to call it in a sentence ("the undo journal"). */
  name: string
}

export interface JournalSnapshot<T> {
  state: 'none' | 'ok'
  /** The readable entries, oldest first. */
  entries: T[]
  /** Lines that could not be read, and, of those, sealed ones that the key cannot open. */
  skipped: number
  sealedClosed: number
}

export interface Journal<T> {
  /** Keeps one entry as a new line, proved by reading it back. REJECTS when it cannot (then the caller must not go on). */
  append(value: T): Promise<void>
  /** Every entry of the file (it is read whole, up to `maxConformBytes`). Never changes the file. */
  readAll(): Promise<JournalSnapshot<T> | { state: 'too-big' }>
  /** The size of the file in bytes (0 when there is none). */
  size(): Promise<number>
  /** Deletes the whole journal (and a leftover rewrite). Rejects if the file is still there afterwards. */
  removeAll(): Promise<void>
  /** What the encryption flow needs of it. */
  document: KeptDocument
  whenIdle(): Promise<void>
}

type Decoded<T> = { value: T; form: FileForm; plain: string } | { bad: 'damaged' | 'sealed' }

export function createJournal<T>(options: JournalOptions<T>): Journal<T> {
  const { pathOf, box, writeMode, parse, render, version, maxLineChars, maxConformBytes, name } =
    options
  const maxSealedLineChars = Math.ceil((maxLineChars + 256) / 3) * 4 + 128
  let queue: Promise<unknown> = Promise.resolve()
  const inOrder = <R>(task: () => Promise<R>): Promise<R> => {
    const run = queue.then(task)
    queue = run.catch(() => undefined)
    return run
  }

  function lineOf(value: T): string {
    const text = JSON.stringify(render(value))
    const back = parse(JSON.parse(text))
    if (back === null || JSON.stringify(render(back)) !== text) {
      throw new Error(`the entry would not be readable again`)
    }
    return text
  }

  function decodeLine(line: string): Decoded<T> {
    if (line.length > maxSealedLineChars) return { bad: 'damaged' }
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      return { bad: 'damaged' }
    }
    if (isEnvelope(parsed)) {
      const opened = openChat(parsed, box)
      if (!opened.ok) return { bad: 'sealed' }
      if (opened.text.length > maxLineChars) return { bad: 'damaged' }
      let inner: unknown
      try {
        inner = JSON.parse(opened.text)
      } catch {
        return { bad: 'damaged' }
      }
      const value = parse(inner)
      return value === null ? { bad: 'damaged' } : { value, form: 'encrypted', plain: opened.text }
    }
    if (line.length > maxLineChars) return { bad: 'damaged' }
    const value = parse(parsed)
    return value === null ? { bad: 'damaged' } : { value, form: 'plain', plain: line }
  }

  async function readWhole(
    file: string
  ): Promise<{ state: 'none' } | { state: 'text'; text: string } | { state: 'too-big' }> {
    let handle: FileHandle
    try {
      handle = await fs.open(file, 'r')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { state: 'none' }
      throw error
    }
    try {
      const { size } = await handle.stat()
      if (size > maxConformBytes) return { state: 'too-big' }
      const buffer = Buffer.alloc(size)
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
      let text = buffer.subarray(0, bytesRead).toString('utf8')
      if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
      return { state: 'text', text }
    } finally {
      await handle.close()
    }
  }

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

  /** The lines of a whole `.tmp` (everything before its closing line) or null when it is cut off or its closing line is wrong. */
  function wholeBody(text: string): string | null {
    if (!text.endsWith('\n')) return null
    const cut = text.lastIndexOf('\n', text.length - 2)
    const body = text.slice(0, cut + 1)
    const last = text.slice(cut + 1, -1)
    let count = 0
    for (const ch of body) if (ch === '\n') count += 1
    return last === commitLine(version, count) && count > 0 ? body : null
  }

  /** Mends what a rewrite cut off: a whole `.tmp` finishes the job, a cut-off one is thrown away. Runs first in every turn of the queue. */
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
    if (current === null || body === null) {
      await fs.rm(tmp, { force: true })
      return
    }
    if (!current.startsWith(body)) {
      await fs.writeFile(file, body, { mode: 0o600 })
      if ((await fs.readFile(file, 'utf8')) !== body) {
        throw new Error(`${name} could not be mended`)
      }
    }
    await fs.rm(tmp, { force: true })
  }

  async function appendNow(value: T): Promise<void> {
    await recover()
    const mode = await writeMode()
    if ('refused' in mode) throw new KeptRefused(mode.refused)
    const plain = lineOf(value)
    let data = plain
    if (mode.form === 'encrypted') {
      if (box === undefined || !box.isAvailable()) {
        throw new Error('there is no secure storage to encrypt with')
      }
      data = sealChat(plain, box)
    }
    // What is about to be written must read back as this very entry BEFORE anything is written.
    const check = decodeLine(data)
    if ('bad' in check || check.plain !== plain || check.form !== mode.form) {
      throw new Error('the entry would not read back')
    }
    const file = pathOf()
    await fs.mkdir(dirname(file), { recursive: true, mode: 0o700 })
    const before = await tailOf(file)
    const wrote = Buffer.from(`${before.endsInNewline ? '' : '\n'}${data}\n`, 'utf8')
    await fs.appendFile(file, wrote, { mode: 0o600 })
    const after = await tailOf(file)
    if (after.size < before.size + wrote.length) throw new Error(`${name} did not grow`)
    const tail = await lastBytes(file, wrote.length)
    if (!tail.equals(wrote)) throw new Error('the entry did not reach the disk as it was written')
  }

  async function readNow(): Promise<JournalSnapshot<T> | { state: 'too-big' }> {
    await recover()
    const part = await readWhole(pathOf())
    if (part.state === 'none') return { state: 'none', entries: [], skipped: 0, sealedClosed: 0 }
    if (part.state === 'too-big') return { state: 'too-big' }
    const entries: T[] = []
    let skipped = 0
    let sealedClosed = 0
    for (const line of part.text.split('\n')) {
      if (line.trim() === '') continue
      const decoded = decodeLine(line)
      if ('bad' in decoded) {
        skipped += 1
        if (decoded.bad === 'sealed') sealedClosed += 1
        continue
      }
      entries.push(decoded.value)
    }
    return { state: 'ok', entries, skipped, sealedClosed }
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
    throw new Error(`${name} is still there`)
  }

  async function formNow(): Promise<KeptRead<undefined>> {
    await recover()
    const part = await readWhole(pathOf())
    if (part.state === 'none') return { state: 'none' }
    if (part.state === 'too-big') {
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
    // A file with both is reported in the form that is NOT the target, so that the flow sees work to do whichever way it turns.
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
    const part = await readWhole(file)
    if (part.state === 'none') return 'none'
    if (part.state === 'too-big') return 'failed'
    const decoded: { raw: string; d: Decoded<T> }[] = []
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
      const closed = `${body}${commitLine(version, lines.length)}\n`
      const proved = async (path: string, text: string): Promise<boolean> =>
        (await fs.readFile(path, 'utf8')) === text
      const sameEntries = (text: string): boolean => {
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
      await fs.writeFile(tmp, closed, { mode: 0o600 })
      if (!(await proved(tmp, closed))) {
        await fs.rm(tmp, { force: true }).catch(() => undefined)
        throw new Error('the rewritten file could not be read back')
      }
      await fs.writeFile(file, body, { mode: 0o600 })
      if (!(await proved(file, body)) || !sameEntries(body)) {
        throw new Error(`${name} could not be read back after the rewrite`)
      }
      await fs.rm(tmp, { force: true })
      return 'changed'
    } catch (error) {
      console.error(`Rewriting ${name} failed:`, error instanceof Error ? error.message : error)
      return 'failed'
    }
  }

  return {
    append: (value) => inOrder(() => appendNow(value)),
    readAll: () => inOrder(readNow),
    size: () =>
      inOrder(async () => {
        try {
          return (await fs.stat(pathOf())).size
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0
          throw error
        }
      }),
    removeAll: () => inOrder(removeNow),
    document: {
      read: () => inOrder(formNow),
      conform: () => inOrder(conformNow)
    },
    whenIdle: () => queue.then(() => undefined)
  }
}
