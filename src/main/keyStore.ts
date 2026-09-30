import { app, safeStorage } from 'electron'
import { promises as fs } from 'fs'
import { dirname, join } from 'path'

// The API key lives in one small file in the app's per-user data folder. The file holds no readable
// text: the key is encrypted by the operating system's secure storage first (Windows DPAPI, the macOS
// Keychain, or the Linux desktop's secret service), so a copy of the file is useless on another
// computer or under another account. It does NOT protect against a program running as you on this
// computer, which can ask the same secure storage to decrypt it. That is the limit of this approach.

interface StoredCredentials {
  version: 1
  /** The encrypted key, as base64. */
  anthropicApiKey?: string
}

const credentialsPath = (): string => join(app.getPath('userData'), 'credentials.json')

/** True if this computer can keep a key safely. Only meaningful after the app is ready. */
export function canStoreKey(): boolean {
  if (!safeStorage.isEncryptionAvailable()) return false
  // With no desktop keyring, Electron on Linux falls back to a password written in its own source
  // code. That is disguise, not protection, so it is treated as "cannot store".
  if (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text') {
    return false
  }
  return true
}

async function readStored(): Promise<StoredCredentials | null> {
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(credentialsPath(), 'utf8'))
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      (parsed as StoredCredentials).version === 1
    ) {
      return parsed as StoredCredentials
    }
    return null
  } catch {
    return null // no file, or not readable: nothing is saved
  }
}

/** The saved key, decrypted. For the main process only: it must never be sent to the page. */
export async function readApiKey(): Promise<string | null> {
  const stored = await readStored()
  if (!stored?.anthropicApiKey || !canStoreKey()) return null
  try {
    return safeStorage.decryptString(Buffer.from(stored.anthropicApiKey, 'base64'))
  } catch {
    return null // saved under another account, or the secure-storage key it needs is gone
  }
}

export async function saveApiKey(key: string): Promise<void> {
  if (!canStoreKey()) throw new Error('This computer has no secure storage for the key.')
  const contents: StoredCredentials = {
    version: 1,
    anthropicApiKey: safeStorage.encryptString(key).toString('base64')
  }
  const file = credentialsPath()
  await fs.mkdir(dirname(file), { recursive: true })
  // Written in place, NOT as "write a temp file, then rename it over the real one". Renaming fails
  // on some Windows folders: on a PC whose %APPDATA% is EFS-encrypted (this project's own
  // machine) every rename there fails with EXDEV, found when a first version did it that way.
  // The file is one short line, and a torn write only means the key has to be entered again.
  await fs.writeFile(file, JSON.stringify(contents), { mode: 0o600 })
  // Do not claim success unless the key really reads back: the user is told "Saved" on this basis.
  if ((await readApiKey()) !== key) throw new Error('the saved key could not be read back')
}

export async function clearApiKey(): Promise<void> {
  await fs.rm(credentialsPath(), { force: true })
}
