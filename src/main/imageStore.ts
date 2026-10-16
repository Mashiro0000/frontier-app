import { createHash, randomBytes } from 'crypto'
import { promises as fs } from 'fs'
import { join } from 'path'
import { IMAGE_LIMITS, type ImageQuality, type ImageShape } from '../shared/images'
import type { FileForm, WriteMode } from './chatFile'
import type { SecretBox } from './credentialStore'
import type { ImageTools } from './attachmentStore'
import { checkPictureBytes, type CheckedPicture } from './imageCheck'
import { EMPTY_INDEX, isPictureId, type ImageIndex, type PictureRecord } from './imageIndex'
import { KeptRefused, type KeptFile } from './keptFile'

// The gallery (Stage 16.4, D-048): the pictures the app keeps, one file each in `images/` of the data folder, named by a random id (32 hex characters: never by the
// description or by anything the provider sent), and the index of them, images.json (imageIndex.ts). No Electron imports: the small pictures for the grid are made by
// the image tools handed in (attachmentImages.ts gives Electron's), as the secure storage is (a `SecretBox`).
//
// A picture is written like a saved chat (D-016, and D-010: never renamed): `<id>.tmp` written and read back, copied over `<id>` and read back, the `.tmp` removed. It is
// plain, or SEALED when the person has turned encryption on (D-035: `writeMode` is asked before every write and either names the form or refuses, and then nothing is
// written): `SEALED_PICTURE` followed by what the secure storage made of the bytes as base64, which is what it takes. Every read checks the bytes against the SHA-256 the
// index keeps, and checks them again as a picture (imageCheck.ts), so a file changed on the disk is "damaged" and never shown.
//
// The order: the picture files first, then the index line that names them. A crash between the two leaves a file no index line names, which is never shown (and is
// counted by `counts`); never an index line without its file. NOTHING IS DELETED but by `remove`, which the service calls only after the person's yes in the system's box,
// and by `add` for the files it wrote itself when the index could not be written. A full gallery refuses a new picture; it never makes room.

/** How a sealed picture begins. A plain picture is told apart by its hash (it matches the index's), so a picture that begins like this is still read right. */
export const SEALED_PICTURE = Buffer.from('FRONTIER-SEALED-PICTURE-1\n', 'latin1')
/** The most a picture file may weigh on disk: the largest picture, sealed (base64 and the secure storage's few dozen bytes), and its first line. */
export const MAX_PICTURE_FILE_BYTES =
  Math.ceil(IMAGE_LIMITS.maxPictureBytes / 3) * 4 + 4096 + SEALED_PICTURE.length
const PICTURE_FILE = /^([0-9a-f]{32})(\.tmp)?$/

const sha256 = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex')
const onDisk = (size: number, form: FileForm): number =>
  form === 'encrypted' ? Math.ceil(size / 3) * 4 + 4096 + SEALED_PICTURE.length : size

/** What is known of a new picture besides its bytes. */
export interface NewPictureFacts {
  prompt: string
  model: string
  shape: ImageShape
  quality: ImageQuality
  chat: string | null
  /** Each picture's share of what the request cost. */
  costEach: number
  estimate: boolean
}

export type PictureRead =
  | { ok: true; bytes: Buffer; record: PictureRecord; form: FileForm }
  | { ok: false; why: 'missing' | 'damaged' | 'unopened' | 'unlisted'; error: string }

export interface ImageStore {
  /** The pictures the index names, oldest first, and why the index cannot be read (then there are none to show). */
  list(): Promise<{ pictures: readonly PictureRecord[]; problem: string | null }>
  /** Whether `count` more pictures fit now, or the sentence that says why not. Asked before a request is sent: a full gallery refuses before anything is paid for. */
  room(count: number): Promise<string | null>
  /** Keeps checked pictures and their index lines. Throws KeptRefused (a sentence for the person) or a disk error; on any failure nothing new is left in the index. */
  add(pictures: readonly CheckedPicture[], facts: NewPictureFacts): Promise<PictureRecord[]>
  read(id: unknown): Promise<PictureRead>
  /** A small picture of a kept one, as data:, for the grid; null when it cannot be had. */
  thumbnail(id: unknown): Promise<string | null>
  /** Deletes the app's own copy and its index line. The service asks the person first. */
  remove(id: unknown): Promise<{ ok: true } | { ok: false; error: string }>
  /** Rewrites every picture the index names in the form the rule says now (encryption turned on or off). The index itself is rewritten with the kept documents. */
  conform(): Promise<{ changed: number; already: number; failed: number }>
  /** How the pictures are kept, and how many files are in the folder that no index line names (left by a crash). */
  counts(): Promise<{
    pictures: number
    bytes: number
    plain: number
    encrypted: number
    unlisted: number
  }>
  whenIdle(): Promise<void>
}

export interface ImageStoreOptions {
  dir: string
  index: KeptFile<ImageIndex>
  images: Pick<ImageTools, 'thumbnail'>
  box?: SecretBox
  writeMode: () => Promise<WriteMode>
  /** Where picture ids come from (tests hand in their own); 16 random bytes otherwise. */
  newId?: () => string
  now?: () => number
  /** The most the folder may hold (tests make it small). */
  folderMaxBytes?: number
}

const reason = (error: unknown): unknown => (error instanceof Error ? error.message : error)

export function createImageStore(options: ImageStoreOptions): ImageStore {
  const { dir, index, images, box, writeMode } = options
  const newId = options.newId ?? ((): string => randomBytes(16).toString('hex'))
  const now = options.now ?? Date.now
  const folderMax = options.folderMaxBytes ?? IMAGE_LIMITS.folderMaxBytes

  let queue: Promise<unknown> = Promise.resolve()
  function inOrder<T>(task: () => Promise<T>): Promise<T> {
    const run = queue.then(task)
    queue = run.catch(() => undefined)
    return run
  }

  /** The index as it is on disk now; a file that cannot be read is said, and then nothing may be added or removed. */
  async function current(): Promise<{ ok: true; index: ImageIndex } | { ok: false; why: string }> {
    const read = await index.read()
    if (read.state === 'none') return { ok: true, index: EMPTY_INDEX }
    if (read.state === 'unreadable') return { ok: false, why: read.why }
    return { ok: true, index: read.value }
  }

  function open(
    data: Buffer,
    record: PictureRecord
  ): { ok: true; bytes: Buffer; form: FileForm } | { ok: false; why: 'damaged' | 'unopened' } {
    const asPicture = (bytes: Buffer): boolean => {
      const checked = checkPictureBytes(bytes)
      return checked.ok && checked.picture.type === record.type
    }
    if (data.length === record.bytes && sha256(data) === record.sha256) {
      return asPicture(data)
        ? { ok: true, bytes: data, form: 'plain' }
        : { ok: false, why: 'damaged' }
    }
    if (
      data.length <= SEALED_PICTURE.length ||
      !data.subarray(0, SEALED_PICTURE.length).equals(SEALED_PICTURE)
    ) {
      return { ok: false, why: 'damaged' }
    }
    if (box === undefined || !box.isAvailable()) return { ok: false, why: 'unopened' }
    let text: string
    try {
      text = box.decrypt(data.subarray(SEALED_PICTURE.length))
    } catch {
      return { ok: false, why: 'unopened' }
    }
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(text)) return { ok: false, why: 'damaged' }
    const bytes = Buffer.from(text, 'base64')
    if (bytes.length !== record.bytes || sha256(bytes) !== record.sha256 || !asPicture(bytes)) {
      return { ok: false, why: 'damaged' }
    }
    return { ok: true, bytes, form: 'encrypted' }
  }

  async function readAt(
    path: string,
    record: PictureRecord
  ): Promise<ReturnType<typeof open> | null> {
    let size: number
    try {
      size = (await fs.stat(path)).size
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
    if (size > MAX_PICTURE_FILE_BYTES) return { ok: false, why: 'damaged' } // looked at before it is read
    return open(await fs.readFile(path), record)
  }

  /** The picture of a record: the real file if it is whole, else a whole `.tmp` (the same bytes, written first). Null if there is neither. */
  async function readFile(record: PictureRecord): Promise<ReturnType<typeof open> | null> {
    const file = join(dir, record.id)
    const real = await readAt(file, record)
    if (real !== null && real.ok) return real
    const copy = await readAt(`${file}.tmp`, record)
    if (copy !== null && copy.ok) return copy
    return real ?? copy
  }

  /** The three steps of D-016 for one picture in one form. */
  async function writeFile(record: PictureRecord, bytes: Buffer, form: FileForm): Promise<void> {
    if (form === 'encrypted' && (box === undefined || !box.isAvailable())) {
      throw new Error('there is no secure storage to encrypt with')
    }
    const data =
      form === 'encrypted' && box !== undefined
        ? Buffer.concat([SEALED_PICTURE, box.encrypt(bytes.toString('base64'))])
        : bytes
    await fs.mkdir(dir, { recursive: true, mode: 0o700 })
    const file = join(dir, record.id)
    const tmp = `${file}.tmp`
    const proved = (read: ReturnType<typeof open>): boolean =>
      read.ok && read.form === form && read.bytes.equals(bytes)
    await fs.writeFile(tmp, data, { mode: 0o600 })
    if (!proved(open(await fs.readFile(tmp), record))) {
      await fs.rm(tmp, { force: true }).catch(() => undefined)
      throw new Error('the new picture could not be read back')
    }
    await fs.copyFile(tmp, file)
    if (!proved(open(await fs.readFile(file), record)))
      throw new Error('the picture could not be read back')
    await fs.rm(tmp, { force: true }).catch(() => undefined)
  }

  /** Removes a picture file and its `.tmp`; true when neither is left. Only ever for an id this store names (a random id it made). */
  async function removeFile(id: string): Promise<boolean> {
    if (!isPictureId(id)) return false
    const file = join(dir, id)
    await Promise.all([fs.rm(file, { force: true }), fs.rm(`${file}.tmp`, { force: true })]).catch(
      () => undefined
    )
    const left = await Promise.all(
      [file, `${file}.tmp`].map((path) =>
        fs.access(path).then(
          () => true,
          () => false
        )
      )
    )
    return !left.some(Boolean)
  }

  async function folderBytes(): Promise<number> {
    let names: string[] = []
    try {
      names = await fs.readdir(dir)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    let total = 0
    for (const name of names) {
      if (!PICTURE_FILE.test(name)) continue
      const stat = await fs.stat(join(dir, name)).catch(() => null)
      if (stat !== null && stat.isFile()) total += stat.size
    }
    return total
  }

  async function roomFor(count: number, bytes: number, form: FileForm): Promise<string | null> {
    const now2 = await current()
    if (!now2.ok)
      return `Nothing was made: the list of your pictures could not be read (${now2.why}).`
    if (now2.index.pictures.length + count > IMAGE_LIMITS.galleryMax) {
      return `The gallery is full (${now2.index.pictures.length} of ${IMAGE_LIMITS.galleryMax} pictures). Delete some to make room; nothing is deleted for you.`
    }
    if ((await folderBytes()) + onDisk(bytes, form) > folderMax) {
      return 'The pictures folder is full. Delete some pictures to make room; nothing is deleted for you.'
    }
    return null
  }

  const store: ImageStore = {
    list: () =>
      inOrder(async () => {
        const now2 = await current()
        return now2.ok
          ? { pictures: now2.index.pictures, problem: null }
          : { pictures: [], problem: now2.why }
      }),

    // Before a request: as many of the largest pictures as are asked for must fit.
    room: (count) => inOrder(() => roomFor(count, count * IMAGE_LIMITS.maxPictureBytes, 'plain')),

    add: (pictures, facts) =>
      inOrder(async () => {
        const mode = await writeMode()
        if ('refused' in mode)
          throw new KeptRefused(`The pictures could not be kept: ${mode.refused}`)
        const total = pictures.reduce((sum, p) => sum + p.bytes.length, 0)
        const full = await roomFor(pictures.length, total, mode.form)
        if (full !== null) throw new KeptRefused(full)
        const before = await current()
        if (!before.ok)
          throw new KeptRefused(`The list of your pictures could not be read (${before.why}).`)
        const at = now()
        const records: PictureRecord[] = []
        const taken = new Set(before.index.pictures.map((p) => p.id))
        try {
          for (const picture of pictures) {
            let id = newId()
            while (taken.has(id)) id = newId()
            if (!isPictureId(id)) throw new Error('a picture id was not one')
            taken.add(id)
            const record: PictureRecord = Object.freeze({
              id,
              prompt: facts.prompt,
              model: facts.model,
              shape: facts.shape,
              quality: facts.quality,
              type: picture.type,
              width: picture.width,
              height: picture.height,
              bytes: picture.bytes.length,
              sha256: sha256(picture.bytes),
              at,
              costUsd: facts.costEach,
              estimate: facts.estimate,
              chat: facts.chat
            })
            await writeFile(record, picture.bytes, mode.form)
            records.push(record)
          }
          await index.write({ pictures: [...before.index.pictures, ...records] })
        } catch (error) {
          // Nothing new is left half-kept: the files written for this request go again (the index never named them).
          for (const record of records) await removeFile(record.id)
          throw error
        }
        return records
      }),

    read: (id) =>
      inOrder(async (): Promise<PictureRead> => {
        if (!isPictureId(id))
          return { ok: false, why: 'unlisted', error: 'That picture is not in the gallery.' }
        const now2 = await current()
        if (!now2.ok)
          return {
            ok: false,
            why: 'unlisted',
            error: `The list of your pictures could not be read (${now2.why}).`
          }
        const record = now2.index.pictures.find((p) => p.id === id)
        if (record === undefined)
          return { ok: false, why: 'unlisted', error: 'This picture is no longer in the gallery.' }
        const opened = await readFile(record)
        if (opened === null)
          return {
            ok: false,
            why: 'missing',
            error: "This picture's file is missing from the app's data folder."
          }
        if (!opened.ok) {
          return opened.why === 'unopened'
            ? {
                ok: false,
                why: 'unopened',
                error:
                  'This picture is encrypted, and could not be opened with the key this computer has.'
              }
            : {
                ok: false,
                why: 'damaged',
                error: "This picture's file is damaged in the app's data folder."
              }
        }
        return { ok: true, bytes: opened.bytes, record, form: opened.form }
      }),

    thumbnail: async (id) => {
      const read = await store.read(id)
      if (!read.ok) return null
      if (read.record.type === 'image/webp')
        return `data:image/webp;base64,${read.bytes.toString('base64')}`
      try {
        return images.thumbnail(read.bytes, IMAGE_LIMITS.thumbnailEdge)
      } catch (error) {
        console.error('Making a small picture failed:', reason(error))
        return null
      }
    },

    remove: (id) =>
      inOrder(async () => {
        if (!isPictureId(id)) return { ok: false, error: 'That picture is not in the gallery.' }
        const now2 = await current()
        if (!now2.ok)
          return {
            ok: false,
            error: `Nothing was deleted: the list of your pictures could not be read (${now2.why}).`
          }
        if (!now2.index.pictures.some((p) => p.id === id))
          return { ok: false, error: 'This picture is no longer in the gallery.' }
        try {
          await index.write({ pictures: now2.index.pictures.filter((p) => p.id !== id) })
        } catch (error) {
          if (error instanceof KeptRefused) return { ok: false, error: error.message }
          console.error('Writing the list of pictures failed:', reason(error))
          return {
            ok: false,
            error: 'Nothing was deleted: the list of your pictures could not be saved.'
          }
        }
        // The line is gone first: a file left behind by a failure is never shown again, and is counted as unlisted.
        if (!(await removeFile(id)))
          console.error('A deleted picture file could not be removed; it is no longer listed.')
        return { ok: true }
      }),

    conform: async () => {
      const result = { changed: 0, already: 0, failed: 0 }
      const listed = await store.list()
      for (const record of listed.pictures) {
        const outcome = await inOrder(async (): Promise<keyof typeof result> => {
          try {
            const mode = await writeMode()
            if ('refused' in mode) return 'failed'
            const read = await readFile(record)
            if (read === null || !read.ok) return 'failed' // missing, damaged, or its key gone: left exactly as it is
            const tmpThere = await fs.access(join(dir, `${record.id}.tmp`)).then(
              () => true,
              () => false
            )
            const real = await readAt(join(dir, record.id), record)
            if (real !== null && real.ok && real.form === mode.form && !tmpThere) return 'already'
            await writeFile(record, read.bytes, mode.form)
            return 'changed'
          } catch (error) {
            console.error(`Rewriting a picture failed (${reason(error)}); it was left as it was.`)
            return 'failed'
          }
        })
        result[outcome] += 1
      }
      return result
    },

    counts: () =>
      inOrder(async () => {
        const now2 = await current()
        const listed = now2.ok ? now2.index.pictures : []
        const ids = new Set(listed.map((p) => p.id))
        let names: string[] = []
        try {
          names = await fs.readdir(dir)
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        }
        let bytes = 0
        let present = 0
        let encrypted = 0
        let unlisted = 0
        for (const name of names) {
          const match = PICTURE_FILE.exec(name)
          if (match === null || match[2] !== undefined) continue
          const path = join(dir, name)
          const stat = await fs.stat(path).catch(() => null)
          if (stat === null || !stat.isFile()) continue
          if (!ids.has(match[1])) {
            unlisted += 1
            continue
          }
          bytes += stat.size
          present += 1
          const handle = await fs.open(path, 'r')
          try {
            const head = Buffer.alloc(SEALED_PICTURE.length)
            const { bytesRead } = await handle.read(head, 0, head.length, 0)
            if (head.subarray(0, bytesRead).equals(SEALED_PICTURE)) encrypted += 1
          } finally {
            await handle.close().catch(() => undefined)
          }
        }
        return { pictures: listed.length, bytes, plain: present - encrypted, encrypted, unlisted }
      }),

    whenIdle: () => queue.then(() => undefined)
  }
  return store
}

/** Writes the plain copy of a picture where the person chose in the system's save dialog ("Save a copy..."): the picture's own bytes, nothing added. */
export async function writePlainCopy(path: string, bytes: Buffer): Promise<void> {
  await fs.writeFile(path, bytes)
}
