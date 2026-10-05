import { promises as fs } from 'fs'
import { dirname } from 'path'
import type { WriteMode } from './chatFile'
import type { SecretBox } from './credentialStore'

// How saved chats are kept (Stage 8b.3 and 8b.4, D-035): the person's choice, "plain files" or "encrypted", in one small plain file of its own
// (chat-encryption.json, beside limits.json and ask-first.json). Like them it is written in place and read back, not written to a temp file and
// renamed: every rename fails with EXDEV in this project's own EFS-encrypted %APPDATA% (D-010). No Electron imports, so it can be checked under
// plain Node with any folder and a stand-in for the secure storage.
//
// WHAT THE FILE HOLDS:
//   {"version":1,"encrypt":false}
//   {"version":1,"encrypt":true,"check":"<base64>"}
// `check` is a short known text that the secure storage encrypted when the choice was made. It is what lets the app tell, without opening a single
// chat, whether the key that protects the chats can still be used: it opens, or it does not (another Windows account, a reset profile, a copied
// folder). It holds nothing secret.
//
// THE RULES (8b.4): this is the one place that says how a chat may be written, and the store obeys it for every save, every chat added from a
// backup and every conversion (conversationStore.ts, `writeMode`). It never says "plain" because something is wrong:
//   - no file                       -> plain. The default, and what "never turned on" is.
//   - "encrypt": false              -> plain.
//   - "encrypt": true, check opens  -> encrypted.
//   - "encrypt": true, and the secure storage is missing, or the check does not open -> REFUSED: nothing new is saved. The app does not fall back to
//                                      plain (that would put the chats the person wanted protected on disk as text), and it does not encrypt (with a
//                                      key that cannot be the one the saved chats were made with, that would split one folder between two keys).
//   - a file that is there but cannot be read, or says something else -> REFUSED, until the person chooses again. Damage never means "plain" and never
//                                      means "encrypted"; it means "ask".
// Nothing here creates, chooses, stores or replaces a key: the secure storage owns the key. The only thing this file ever asks it to do is to encrypt
// the check (when the person turns encryption on) and to decrypt it (every time a chat is about to be written).
//
// What is held is read once and kept: it changes only in `turnOn` and `turnOff`, which run one at a time. A person who edits the file while the app
// runs is not heard until the next start.

/** The text the check holds. Not a secret: it only has to come back exactly. */
export const CHECK_TEXT = 'frontier chats: the key that protects them still opens'

const FILE_VERSION = 1
/** The file is a few hundred bytes; anything bigger is not one, and is not read. */
const MAX_FILE_BYTES = 8 * 1024
const MAX_CHECK_CHARS = 4096
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/

/** What nothing can be saved for, in the words the person reads (they appear after "The chat on screen is not saved", and in Settings). */
export const BLOCKED = {
  setting:
    'Chats are not being saved: the file that says whether they are encrypted could not be read. Open Settings, Saved chats, and choose again. Nothing was changed.',
  noStorage:
    "Chats are not being saved: they are set to be encrypted, but this computer's secure storage is not available right now. Nothing was changed.",
  key: 'Chats are not being saved: the key that protects your encrypted chats cannot be read on this computer or account, and a new key is never made for you. Nothing was changed. Open Settings, Saved chats.'
} as const

export type Choice = 'off' | 'on' | 'unreadable'

type Setting = { choice: 'off' } | { choice: 'on'; check: string } | { choice: 'unreadable' }

/** What the file holds, or `unreadable` for anything that is not exactly one of the two shapes above. Pure. */
export function parseSettingFile(text: string): Setting {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1) // a byte-order mark, which some editors add
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { choice: 'unreadable' }
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { choice: 'unreadable' }
  const file = raw as Record<string, unknown>
  if (file.version !== FILE_VERSION) return { choice: 'unreadable' }
  if (file.encrypt === false) return { choice: 'off' }
  if (
    file.encrypt === true &&
    typeof file.check === 'string' &&
    file.check.length > 0 &&
    file.check.length <= MAX_CHECK_CHARS &&
    BASE64.test(file.check)
  ) {
    return { choice: 'on', check: file.check }
  }
  return { choice: 'unreadable' }
}

export const settingFileText = (
  setting: { choice: 'off' } | { choice: 'on'; check: string }
): string =>
  setting.choice === 'on'
    ? JSON.stringify({ version: FILE_VERSION, encrypt: true, check: setting.check })
    : JSON.stringify({ version: FILE_VERSION, encrypt: false })

/** What the app can say about how chats are kept, without opening a chat. */
export interface ProtectionState {
  choice: Choice
  /** The secure storage is there (the same test as for an API key). */
  canEncrypt: boolean
  /** With the choice 'on': the check opens. Null otherwise. */
  keyUsable: boolean | null
  /** Why nothing new can be saved, or null. */
  blocked: string | null
}

export interface ChatProtection {
  state(): Promise<ProtectionState>
  /** How the next write must be made, or why none may be. Cheap; called before every write. Never throws. */
  writeMode(): Promise<WriteMode>
  /**
   * Turns encryption on: proves that the secure storage encrypts and decrypts (a check is made and opened again), writes the choice with that
   * check, and reads it back. Throws if anything fails, and then the choice is as it was (as far as the disk says: the next read looks at the file).
   */
  turnOn(): Promise<void>
  /** Writes the choice "plain", and reads it back. Throws if it cannot. Needs no key. */
  turnOff(): Promise<void>
}

export function createChatProtection(options: {
  box: SecretBox
  pathOf: () => string
}): ChatProtection {
  const { box, pathOf } = options
  let current: Setting | null = null
  let queue: Promise<unknown> = Promise.resolve()
  const inOrder = <T>(task: () => Promise<T>): Promise<T> => {
    const run = queue.then(task)
    queue = run.catch(() => undefined)
    return run
  }

  /** What the file holds, and whether to keep it: a file that could not be read at all is not kept, so that a later call tries again. */
  async function load(): Promise<{ setting: Setting; keep: boolean }> {
    let text: string
    try {
      if ((await fs.stat(pathOf())).size > MAX_FILE_BYTES) {
        console.warn(
          'chat-encryption.json is not a file this app made, so saving is paused until you choose again in Settings.'
        )
        return { setting: { choice: 'unreadable' }, keep: true }
      }
      text = await fs.readFile(pathOf(), 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return { setting: { choice: 'off' }, keep: true }
      }
      // Logged here only (a message could name a file path).
      console.error(
        'Reading chat-encryption.json failed, so saving is paused:',
        error instanceof Error ? error.message : error
      )
      return { setting: { choice: 'unreadable' }, keep: false }
    }
    const setting = parseSettingFile(text)
    if (setting.choice === 'unreadable') {
      console.warn(
        'chat-encryption.json is damaged, so saving is paused until you choose again in Settings.'
      )
    }
    return { setting, keep: true }
  }

  const read = (): Promise<Setting> =>
    inOrder(async () => {
      if (current !== null) return current
      const { setting, keep } = await load()
      if (keep) current = setting
      return setting
    })

  /** The check, opened: true only if it comes back as exactly the text it was made from. Never throws. */
  function opens(check: string): boolean {
    try {
      return box.decrypt(Buffer.from(check, 'base64')) === CHECK_TEXT
    } catch {
      return false
    }
  }

  async function state(): Promise<ProtectionState> {
    const setting = await read()
    const canEncrypt = box.isAvailable()
    if (setting.choice === 'off') {
      return { choice: 'off', canEncrypt, keyUsable: null, blocked: null }
    }
    if (setting.choice === 'unreadable') {
      return { choice: 'unreadable', canEncrypt, keyUsable: null, blocked: BLOCKED.setting }
    }
    if (!canEncrypt) {
      return { choice: 'on', canEncrypt, keyUsable: false, blocked: BLOCKED.noStorage }
    }
    const usable = opens(setting.check)
    return { choice: 'on', canEncrypt, keyUsable: usable, blocked: usable ? null : BLOCKED.key }
  }

  async function save(setting: { choice: 'off' } | { choice: 'on'; check: string }): Promise<void> {
    const file = pathOf()
    try {
      await fs.mkdir(dirname(file), { recursive: true })
      await fs.writeFile(file, settingFileText(setting), { mode: 0o600 })
      const back = parseSettingFile(await fs.readFile(file, 'utf8'))
      if (JSON.stringify(back) !== JSON.stringify(setting)) {
        throw new Error('the saved choice could not be read back')
      }
      current = back
    } catch (error) {
      current = null // what is on disk now is the truth: the next read looks at it
      throw error
    }
  }

  return {
    state: () => state(),

    writeMode: async (): Promise<WriteMode> => {
      try {
        const now = await state()
        if (now.blocked !== null) return { refused: now.blocked }
        return { form: now.choice === 'on' ? 'encrypted' : 'plain' }
      } catch (error) {
        // Not reached for a missing or damaged file (those are results); a thrown error here is a fault in the secure storage itself.
        console.error(
          'Looking at how chats are kept failed, so nothing is saved:',
          error instanceof Error ? error.message : error
        )
        return { refused: BLOCKED.setting }
      }
    },

    turnOn: () =>
      inOrder(async () => {
        if (!box.isAvailable()) throw new Error('this computer has no secure storage')
        const check = box.encrypt(CHECK_TEXT)
        if (!opens(check.toString('base64'))) {
          throw new Error('the secure storage did not give the check back')
        }
        await save({ choice: 'on', check: check.toString('base64') })
      }),

    turnOff: () => inOrder(() => save({ choice: 'off' }))
  }
}
