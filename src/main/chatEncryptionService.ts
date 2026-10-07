import type { ChatStorageResult, ChatStorageStatus } from '../shared/ipc'
import type { BackupService } from './backupService'
import type { ChatProtection } from './chatProtection'
import type { ConversationStore } from './conversationStore'

// Turning encryption of the saved chats on and off (Stage 8b.3, D-035): the flow around chatProtection.ts (the choice, and the rule for how a chat may be
// written) and conversationStore.ts (the files), without Electron, so it can be checked under plain Node. The system's message box is handed in as
// `asks`; the save dialog for the backup is the backup service's own.
//
// TURNING IT ON, in this order, and it stops at the first step that does not work, with nothing changed up to that point:
//   1. the secure storage must be there, and (if encryption was already on) its key must be usable;
//   2. if there are saved chats, a backup of ALL of them, written, read back and checked like any backup (backup.ts), in the place the person
//      chooses in the system's save dialog; closing the dialog stops everything: nothing is encrypted without a backup the person made;
//   3. the choice is written (after the secure storage has been shown to encrypt and decrypt a check): from now on every chat is written encrypted;
//   4. every readable chat's file is rewritten in that form, one at a time, each proved by opening what was written (`store.conform`).
// A crash after 3 leaves the choice on and some chats plain; that is a state the page shows ("N chats are not encrypted yet") and `encrypt` finishes.
//
// TURNING IT OFF: the system asks the person first (a message box the page cannot answer: plain files protect less, and the page can already
// read every chat, so what it must not be able to do is quietly make the files on disk readable too); then the choice is written, and every chat
// that can be opened is rewritten as a plain file. Chats that cannot be opened (the key is gone) are left exactly as they are: they are not
// converted and not deleted, and the person is told so.
//
// Both run inside the backup service's lock, so a backup, a restore and a change of how chats are kept never overlap.

/** What the message box that asks about going back to plain files is told. */
export interface PlainFacts {
  /** Chats whose files are encrypted and can be opened: the ones that would be rewritten as plain text. */
  encrypted: number
  /** Encrypted files that could not be opened: they stay exactly as they are whatever the person answers. */
  unopened: number
  /** False if the key that protects the chats cannot be used now: then no file can be turned back, and the answer only changes the choice. */
  keyUsable: boolean
}

export interface Askers {
  /** Asks, in the system's own message box and for the window `owner`, whether to go back to plain files. True only for a yes from the person. */
  confirmPlain(owner: unknown, facts: PlainFacts): Promise<boolean>
}

const chats = (count: number): string => `${count} ${count === 1 ? 'chat' : 'chats'}`

/** What the message box says about going back to plain files, for what the app found. Plain sentences, and whatever stays as it is is named. */
export function plainQuestion(facts: PlainFacts): {
  title: string
  message: string
  detail: string
} {
  const left =
    facts.unopened > 0
      ? ` ${facts.unopened === 1 ? '1 encrypted file cannot be opened with this key and stays' : `${facts.unopened} encrypted files cannot be opened with this key and stay`} exactly as ${facts.unopened === 1 ? 'it is' : 'they are'}.`
      : ''
  if (!facts.keyUsable) {
    return {
      title: 'Turn encryption off?',
      message: 'The key that protects your encrypted chats cannot be read.',
      detail:
        `Your encrypted chats cannot be turned back into plain files, so they stay exactly as they are and will open again only if the key comes back.${left} ` +
        'Chats you save from now on will be plain files. To get the old chats back, use Restore from a backup in History.'
    }
  }
  if (facts.encrypted === 0) {
    return {
      title: 'Go back to plain files?',
      message: 'Chats you save from now on will be plain files.',
      detail: `No saved chat is encrypted now. Anyone who can read the app's data folder will be able to read the chats you save.${left}`
    }
  }
  const one = facts.encrypted === 1
  return {
    title: 'Go back to plain files?',
    message: `${chats(facts.encrypted)} will be rewritten as ${one ? 'a plain file' : 'plain files'}.`,
    detail: `Anyone who can read the app's data folder will then be able to read ${one ? 'it' : 'them'}, and every chat you save from now on. Your API keys stay encrypted, and a backup you made is not changed.${left}`
  }
}

export interface ChatEncryptionService {
  /** How the chats are kept now. Opens nothing but the check, and writes nothing. */
  status(): Promise<ChatStorageStatus>
  encrypt(owner: unknown): Promise<ChatStorageResult>
  decrypt(owner: unknown): Promise<ChatStorageResult>
}

export interface ChatEncryptionOptions {
  store: ConversationStore
  protection: ChatProtection
  /** The backup service: the lock, and the backup that turning encryption on starts with. */
  backups: Pick<BackupService, 'backUpAllBeforeEncrypting' | 'exclusive'>
  asks: Askers
  /**
   * The attachments' copies (D-037): sealed and opened with the chats, by the same rule (they ask the same `writeMode`). Rewritten after the chats, every
   * time the chats are. Optional: without it only the chats are rewritten.
   */
  files?: {
    conform(): Promise<{ changed: number; already: number; failed: number }>
    counts(): Promise<{ plain: number; encrypted: number }>
  }
}

const BUSY =
  'Another backup, restore or change of how chats are kept is still going. Wait for it to finish.'
export const NO_SECURE_STORAGE =
  'This computer has no secure storage to keep the key in, so the chats cannot be encrypted here. Nothing was changed.'

const reason = (error: unknown): unknown => (error instanceof Error ? error.message : error)

export function createChatEncryptionService(options: ChatEncryptionOptions): ChatEncryptionService {
  const { store, protection, backups, asks, files } = options

  /** The attachments rewritten in the form the choice now says; null when there are none at all (the report then says nothing about them). */
  async function conformFiles(): Promise<{ changed: number; failed: number } | null> {
    if (files === undefined) return null
    const before = await files.counts()
    if (before.plain + before.encrypted === 0) return null
    const done = await files.conform()
    return { changed: done.changed, failed: done.failed }
  }
  const withFiles = (
    done: { changed: number; failed: number } | null
  ): { files?: { changed: number; failed: number } } => (done === null ? {} : { files: done })

  async function status(): Promise<ChatStorageStatus> {
    const state = await protection.state()
    const counts = await store.counts()
    return {
      choice: state.choice,
      canEncrypt: state.canEncrypt,
      keyUsable: state.keyUsable,
      plain: counts.plain,
      encrypted: counts.encrypted,
      unreadable: counts.unreadable,
      unopened: counts.unopened,
      blocked: state.blocked
    }
  }

  async function encrypt(owner: unknown): Promise<ChatStorageResult> {
    const before = await protection.state()
    if (!before.canEncrypt) return { ok: false, error: NO_SECURE_STORAGE }
    if (before.choice === 'on' && before.keyUsable !== true) {
      return { ok: false, error: `Nothing was encrypted. ${before.blocked ?? ''}`.trim() }
    }
    const counts = await store.counts()
    const plainFiles = files === undefined ? 0 : (await files.counts()).plain
    if (before.choice === 'on' && counts.plain === 0 && plainFiles === 0) {
      // Nothing to do, and nothing to protect with a backup: say so instead of asking for one.
      return {
        ok: true,
        status: await status(),
        report: { changed: 0, already: counts.encrypted, failed: 0, backup: null }
      }
    }
    let backup: { count: number; leftOut: number; where: string } | null = null
    if (counts.plain + counts.encrypted > 0) {
      const made = await backups.backUpAllBeforeEncrypting(owner)
      if (!made.ok) {
        return made.cancelled
          ? { ok: false, cancelled: true, error: 'Cancelled. Nothing was encrypted.' }
          : {
              ok: false,
              error: `Nothing was encrypted, because the backup could not be made: ${made.error}`
            }
      }
      backup = { count: made.count, leftOut: made.leftOut, where: made.where }
    }
    try {
      await protection.turnOn()
    } catch (error) {
      console.error('Turning encryption on failed:', reason(error))
      return {
        ok: false,
        error:
          'Nothing was encrypted: the secure storage did not work, or the choice could not be saved on this computer. Your chats are as they were.'
      }
    }
    const done = await store.conform()
    const filesDone = await conformFiles()
    return {
      ok: true,
      status: await status(),
      report: { ...done, backup, ...withFiles(filesDone) }
    }
  }

  async function decrypt(owner: unknown): Promise<ChatStorageResult> {
    const before = await protection.state()
    const counts = await store.counts()
    const sealedFiles = files === undefined ? 0 : (await files.counts()).encrypted
    if (before.choice === 'off' && counts.encrypted === 0 && sealedFiles === 0) {
      // Plain already, and no encrypted chat to turn back: nothing is weakened, so nothing is asked.
      return {
        ok: true,
        status: await status(),
        report: { changed: 0, already: counts.plain, failed: 0, backup: null }
      }
    }
    const yes = await asks.confirmPlain(owner, {
      encrypted: counts.encrypted,
      unopened: counts.unopened,
      keyUsable: before.keyUsable !== false
    })
    if (!yes) return { ok: false, cancelled: true, error: 'Cancelled.' }
    try {
      await protection.turnOff()
    } catch (error) {
      console.error('Turning encryption off failed:', reason(error))
      return {
        ok: false,
        error: 'The choice could not be saved on this computer, so nothing was changed.'
      }
    }
    const done = await store.conform()
    const filesDone = await conformFiles()
    return {
      ok: true,
      status: await status(),
      report: { ...done, backup: null, ...withFiles(filesDone) }
    }
  }

  return {
    status,
    encrypt: (owner) =>
      backups.exclusive<ChatStorageResult>({ ok: false, error: BUSY }, () => encrypt(owner)),
    decrypt: (owner) =>
      backups.exclusive<ChatStorageResult>({ ok: false, error: BUSY }, () => decrypt(owner))
  }
}
