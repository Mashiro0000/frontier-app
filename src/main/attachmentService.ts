import { ATTACHMENT_LIMITS, cleanFileName, type AttachedFile } from '../shared/attachments'
import type { AttachBytesResult, AttachPickResult } from '../shared/ipc'
import { checkAttachmentBytes } from '../shared/validate'
import { MAX_INPUT_BYTES } from './attachmentFormats'
import { readLocalFile, type AttachmentStore } from './attachmentStore'

// Getting files in (Stage 9.2, D-037): the three things the page may ask about attachments. No Electron imports: the system's open dialog is handed
// in (backupDialogs.ts opens it), so the plain-Node suite plays it.
//
//   pick     the person chooses files in the system's own open dialog, which main opens for the window that asked; the page never names a path and
//            learns no path. Each file is read by main (readLocalFile: a local drive only, no link followed, the size looked at first) and kept by the
//            store (checked by its bytes). One dialog at a time.
//   addBytes a pasted or dropped file: the page hands over its bytes and its name, never a path (checkAttachmentBytes).
//   discard  the person took a file off the message before sending it: the store stops holding it, and deletes it if no saved chat uses it.

/** The system's open dialog: the paths the person chose, or null if they closed it. `owner` is the window that asked. */
export type PickPaths = (owner: unknown) => Promise<string[] | null>

export interface AttachmentService {
  pick(owner: unknown): Promise<AttachPickResult>
  addBytes(input: unknown): Promise<AttachBytesResult>
  discard(id: unknown): Promise<void>
}

export function createAttachmentService(options: {
  store: AttachmentStore
  pickPaths: PickPaths
  /** The attachments that saved chats use, so that a discarded file is deleted only if none does. Null when that cannot be known (a chat that cannot be read). */
  referenced: () => Promise<ReadonlySet<string> | null>
}): AttachmentService {
  const { store, pickPaths, referenced } = options
  let picking = false

  return {
    pick: async (owner) => {
      if (picking) return { ok: false, error: 'The window for choosing files is already open.' }
      picking = true
      try {
        const paths = await pickPaths(owner)
        if (paths === null || paths.length === 0) {
          return { ok: false, cancelled: true, error: 'Cancelled.' }
        }
        const max = ATTACHMENT_LIMITS.perMessage
        const files: AttachedFile[] = []
        const refused: string[] = []
        for (const path of paths.slice(0, max)) {
          const read = await readLocalFile(path, MAX_INPUT_BYTES)
          if (!read.ok) {
            // The name, never the folder: the page learns no path.
            refused.push(`${cleanFileName(path, 'A file')} was not attached: ${read.why}.`)
            continue
          }
          const added = await store.add({ bytes: read.bytes, name: read.name })
          if (added.ok) files.push(added.file)
          else refused.push(added.error)
        }
        if (paths.length > max) {
          refused.push(
            `At most ${max} files can be attached at a time: ${paths.length - max} ${paths.length - max === 1 ? 'was' : 'were'} left out.`
          )
        }
        return { ok: true, files, refused }
      } finally {
        picking = false
      }
    },

    addBytes: async (input) => {
      const check = checkAttachmentBytes(input, MAX_INPUT_BYTES)
      if (!check.ok) return check
      const bytes = Buffer.from(check.bytes.buffer, check.bytes.byteOffset, check.bytes.byteLength)
      const added = await store.add({ bytes: Buffer.from(bytes), name: check.name })
      return added.ok ? { ok: true, file: added.file } : added
    },

    discard: async (id) => {
      if (typeof id !== 'string') return
      store.release(id)
      const used = await referenced()
      if (used !== null) await store.deleteUnused([id], used)
    }
  }
}
