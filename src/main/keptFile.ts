import { promises as fs } from 'fs'
import { isEnvelope, openChat, sealChat, type FileForm, type WriteMode } from './chatFile'
import type { SecretBox } from './credentialStore'

// One small document of the person's own words that the app keeps in its data folder (Stage 10, D-039): the instructions for every chat
// (instructions.json, 10.2, everyChat.ts); later the notes and the projects. Written the way a chat is (D-016): `<name>.tmp` written and read back, copied over `<name>`
// and read back, the .tmp removed, so a crash in the middle leaves either a whole .tmp (which wins when the file is read) or a cut-off one (which is
// ignored). Never renamed: every rename fails with EXDEV in this project's EFS-encrypted data folder (D-010). Plain, or sealed like the chats when the
// person has turned encryption on (the same envelope, chatFile.ts, and the same one rule for how it may be written, `writeMode`, D-035). No Electron
// imports, so it is checked under plain Node with a stand-in for the secure storage.
//
// A file that cannot be read (damaged, made by another version, sealed with a key that cannot be used now) is NEVER written over by itself: `read`
// says why, and only a write the person asked for with `replace` (they chose to start again) first keeps a copy of it, `<name>.damaged-<time>`, and
// proves the copy by reading it back. Nothing is cached: every read is of the disk, in the file's own turn, so a file that was damaged, or a key that
// came back, is noticed at the next read (the file is small, and read once per request).

export type KeptRead<T> =
  | { state: 'none' }
  | { state: 'ok'; value: T; form: FileForm }
  | { state: 'unreadable'; why: string }

/** A write the rules refuse (encryption is on and the key cannot be used; the file cannot be read and the person has not chosen to start again). */
export class KeptRefused extends Error {}

export interface KeptFileOptions<T> {
  /** The file's full path; a function so that the data folder is not asked for before it is known. */
  pathOf: () => string
  /** What the person calls the document, for the sentences ("your instructions for every chat"). */
  name: string
  /** The value out of the file's own (plain) text, or null when the text is not one this app wrote. Never throws. */
  parse: (text: string) => T | null
  /** The file's own text for a value. */
  text: (value: T) => string
  /** The most a plain file may weigh; a sealed one may weigh about a third more (base64). A bigger file is not read. */
  maxBytes: number
  box?: SecretBox
  writeMode: () => Promise<WriteMode>
  /** The time, for the name of a copy set aside (the checks hand in their own). */
  now?: () => number
}

export interface KeptFile<T> {
  read(): Promise<KeptRead<T>>
  /** Writes `value` in the form the rule says now, and proves it by reading it back. Throws KeptRefused (a sentence for the person) or a disk error. */
  write(value: T, options?: { replace?: boolean }): Promise<void>
  /** Deletes the file (the person cleared the document). A file that cannot be read is kept, as for `write`, unless `replace`. */
  remove(options?: { replace?: boolean }): Promise<void>
  /** Rewrites a readable file in the form the rule says now (encryption turned on or off). Leaves a file that cannot be read exactly as it is. */
  conform(): Promise<'none' | 'already' | 'changed' | 'failed' | 'unreadable' | 'refused'>
  whenIdle(): Promise<void>
}

type Raw =
  | { state: 'none' }
  | { state: 'text'; text: string; form: FileForm }
  | { state: 'bad'; why: string }

export function createKeptFile<T>(options: KeptFileOptions<T>): KeptFile<T> {
  const { pathOf, name, parse, text, maxBytes, box, writeMode } = options
  const now = options.now ?? Date.now
  const maxSealedBytes = Math.ceil((maxBytes + 256) / 3) * 4 + 128
  let queue: Promise<unknown> = Promise.resolve()
  const inOrder = <R>(task: () => Promise<R>): Promise<R> => {
    const run = queue.then(task)
    queue = run.catch(() => undefined)
    return run
  }

  /** The plain text of one file on disk (the real one or its .tmp), or why it cannot be had. */
  async function rawAt(file: string): Promise<Raw> {
    let bytes: Buffer
    try {
      const size = (await fs.stat(file)).size
      if (size > maxSealedBytes)
        return { state: 'bad', why: 'it is larger than this app ever writes' }
      bytes = await fs.readFile(file)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { state: 'none' }
      return { state: 'bad', why: 'it could not be read from the disk' }
    }
    let content = bytes.toString('utf8')
    if (content.charCodeAt(0) === 0xfeff) content = content.slice(1) // a byte-order mark, which some editors add
    let parsed: unknown
    try {
      parsed = JSON.parse(content)
    } catch {
      return { state: 'bad', why: 'it is not a file this app wrote (it may be cut off or edited)' }
    }
    if (isEnvelope(parsed)) {
      const opened = openChat(parsed, box)
      return opened.ok
        ? { state: 'text', text: opened.text, form: 'encrypted' }
        : { state: 'bad', why: opened.why }
    }
    if (bytes.length > maxBytes)
      return { state: 'bad', why: 'it is larger than this app ever writes' }
    return { state: 'text', text: content, form: 'plain' }
  }

  /** The real file, unless a whole .tmp is there: a crash between writing the .tmp and copying it over left the newer text in the .tmp (D-016). */
  async function load(): Promise<KeptRead<T>> {
    const file = pathOf()
    const tmp = await rawAt(`${file}.tmp`)
    if (tmp.state === 'text') {
      const value = parse(tmp.text)
      if (value !== null) return { state: 'ok', value, form: tmp.form }
    }
    const raw = await rawAt(file)
    if (raw.state === 'none') return { state: 'none' }
    if (raw.state === 'bad') return { state: 'unreadable', why: raw.why }
    const value = parse(raw.text)
    if (value === null) {
      return {
        state: 'unreadable',
        why: 'it is not a file this app wrote (it may be cut off, edited, or from another version)'
      }
    }
    return { state: 'ok', value, form: raw.form }
  }

  const read = (): Promise<KeptRead<T>> => inOrder(load)

  /** Keeps a copy of a file that cannot be read before the person's new text takes its place; the copy is read back before anything else happens. */
  async function setAside(file: string): Promise<void> {
    const bytes = await fs.readFile(file).catch(() => null)
    if (bytes === null) return
    const aside = `${file}.damaged-${now()}`
    await fs.copyFile(file, aside)
    if (!(await fs.readFile(aside)).equals(bytes))
      throw new Error('the copy of the damaged file could not be read back')
  }

  /** The three steps of D-016 for one text in one form. */
  async function writeText(plain: string, form: FileForm): Promise<void> {
    if (form === 'encrypted' && (box === undefined || !box.isAvailable())) {
      throw new Error('there is no secure storage to encrypt with')
    }
    const data = form === 'encrypted' && box !== undefined ? sealChat(plain, box) : plain
    const file = pathOf()
    const tmp = `${file}.tmp`
    const proved = async (path: string): Promise<boolean> => {
      const back = await rawAt(path)
      return back.state === 'text' && back.form === form && back.text === plain
    }
    await fs.writeFile(tmp, data, { mode: 0o600 })
    if (!(await proved(tmp))) {
      await fs.rm(tmp, { force: true }).catch(() => undefined)
      throw new Error('the new file could not be read back')
    }
    await fs.copyFile(tmp, file)
    if (!(await proved(file))) throw new Error('the file could not be read back')
    await fs.rm(tmp, { force: true }).catch(() => undefined)
  }

  async function modeOrRefuse(): Promise<FileForm> {
    const mode = await writeMode()
    if ('refused' in mode) throw new KeptRefused(mode.refused)
    return mode.form
  }

  async function guardDamaged(replace: boolean | undefined): Promise<void> {
    const before = await load()
    if (before.state !== 'unreadable') return
    if (!replace) {
      throw new KeptRefused(`Nothing was changed: ${name} could not be read (${before.why}).`)
    }
    await setAside(pathOf())
  }

  return {
    read,

    write: (value, writeOptions) =>
      inOrder(async () => {
        // Whatever is written must be readable again (D-016): a value this file's own reader would refuse is never written (10.3 found a way to make
        // one: a note id used twice), so a fault can never turn the person's document into one that refuses every request.
        const plain = text(value)
        if (parse(plain) === null)
          throw new Error(`${name} would not read back, so nothing was written`)
        const form = await modeOrRefuse()
        await guardDamaged(writeOptions?.replace)
        await writeText(plain, form)
      }),

    remove: (removeOptions) =>
      inOrder(async () => {
        await guardDamaged(removeOptions?.replace)
        const file = pathOf()
        await fs.rm(`${file}.tmp`, { force: true })
        await fs.rm(file, { force: true })
      }),

    conform: () =>
      inOrder(async () => {
        const current = await load()
        if (current.state === 'none') return 'none'
        if (current.state === 'unreadable') return 'unreadable'
        const mode = await writeMode()
        if ('refused' in mode) return 'refused'
        if (current.form === mode.form) return 'already'
        try {
          await writeText(text(current.value), mode.form)
          return 'changed'
        } catch (error) {
          console.error(`Rewriting ${name} failed:`, error instanceof Error ? error.message : error)
          return 'failed'
        }
      }),

    whenIdle: () => queue.then(() => undefined)
  }
}

/** What the encryption flow needs of a kept file. */
export type KeptDocument = Pick<KeptFile<unknown>, 'read' | 'conform'>

/**
 * The person's kept files as the encryption flow sees them (D-035, D-039): rewritten together, after the chats, in the form the rule now says, and counted
 * by how they are kept. A file that cannot be read is left as it is and counted as neither.
 */
export function keptDocuments(files: readonly KeptDocument[]): {
  conform(): Promise<{ changed: number; failed: number }>
  counts(): Promise<{ plain: number; encrypted: number }>
} {
  return {
    conform: async () => {
      let changed = 0
      let failed = 0
      for (const file of files) {
        const done = await file.conform()
        if (done === 'changed') changed++
        else if (done === 'failed' || done === 'refused') failed++
      }
      return { changed, failed }
    },
    counts: async () => {
      let plain = 0
      let encrypted = 0
      for (const file of files) {
        const now = await file.read()
        if (now.state !== 'ok') continue
        if (now.form === 'plain') plain++
        else encrypted++
      }
      return { plain, encrypted }
    }
  }
}
