import { promises as fs } from 'fs'
import { join } from 'path'
import { SUPPORTED_PROVIDERS, type ProviderId } from '../shared/registry'

// The API keys, one small file per provider in the app's per-user data folder (D-020). No Electron imports, so it can
// be checked under plain Node with any folder; the operating system's secure storage is handed in as a SecretBox.
//
// What a file holds is not readable text: the key is encrypted by the secure storage first (Windows DPAPI, the macOS
// Keychain, the Linux desktop's secret service), so a copy of the file is useless on another computer or under another
// account. It does NOT protect against a program running as you on this computer, which can ask the same secure
// storage to decrypt it: that is the limit of any per-user store without a master password (D-010).
//
// One file per provider, not one file for all of them, so that saving or removing one key never rewrites another, and a
// torn write can cost the person only the key it was writing. A file says which provider it is for, and that must be
// the provider it is asked for: a file copied or renamed to the wrong name must never hand one provider's key to
// another provider's servers.
//
// Like every file in the data folder (D-010) a key is written in place and read back, never written to a temp file and
// renamed over the real one: every rename fails with EXDEV in this project's own EFS-encrypted %APPDATA%.
//
// Before there was more than one provider the key lived in "credentials.json" ({ version: 1, anthropicApiKey }). That
// file is still read, as Anthropic's key, when there is no file of the new kind. Reading never writes: it is replaced
// (and deleted) only when the person saves or removes that key.

/** What the store needs from the operating system's secure storage. */
export interface SecretBox {
  /** False if this computer has no secure place to keep a secret. */
  isAvailable(): boolean
  encrypt(plain: string): Buffer
  /** Throws if the secret was saved under another account, or the key that protects it is gone. */
  decrypt(blob: Buffer): string
}

export interface CredentialStore {
  /** True if this computer can keep a key safely. */
  canStore(): boolean
  /** The saved key, decrypted. Null if none is saved, if it cannot be read, or if the file is for another provider. */
  read(provider: ProviderId): Promise<string | null>
  /** Saves the key and reads it back. Throws if that failed: the person is told "Saved" only on this basis. */
  save(provider: ProviderId, key: string): Promise<void>
  /** Deletes the key, from wherever it is kept. Throws if a file could not be deleted. */
  clear(provider: ProviderId): Promise<void>
}

/** What a file may weigh. A key file is a few hundred bytes; anything bigger is not one, and is not read. */
const MAX_FILE_BYTES = 16 * 1024

interface StoredKey {
  version: 2
  provider: ProviderId
  /** The encrypted key, as base64. */
  key: string
}

export const credentialFileName = (provider: ProviderId): string => `credentials.${provider}.json`
export const LEGACY_FILE_NAME = 'credentials.json'

async function readJson(path: string): Promise<unknown> {
  try {
    if ((await fs.stat(path)).size > MAX_FILE_BYTES) return null // looked at before it is read: no file can fill the memory
    return JSON.parse(await fs.readFile(path, 'utf8'))
  } catch {
    return null // no file, or not readable: nothing is saved there
  }
}

/**
 * `providers` is the list of providers the store will keep keys for: the registry's, unless a test says otherwise.
 */
export function createCredentialStore(
  dir: string,
  box: SecretBox,
  providers: readonly ProviderId[] = SUPPORTED_PROVIDERS
): CredentialStore {
  // A provider becomes part of a file name, so it must be exactly one of the known ones. Callers have checked it already.
  function assertProvider(provider: unknown): asserts provider is ProviderId {
    if (!providers.some((known) => known === provider)) throw new Error('that is not a provider')
  }
  const fileOf = (provider: ProviderId): string => join(dir, credentialFileName(provider))
  const legacyFile = join(dir, LEGACY_FILE_NAME)

  // One thing at a time, in the order asked for (as the model choice, D-015, and the conversations, D-016): a save and a
  // removal, or a read in the middle of a write, must never cross.
  let queue: Promise<unknown> = Promise.resolve()
  function inOrder<T>(task: () => Promise<T>): Promise<T> {
    const run = queue.then(task)
    queue = run.catch(() => undefined)
    return run
  }

  function decrypt(encoded: unknown): string | null {
    if (typeof encoded !== 'string') return null
    try {
      return box.decrypt(Buffer.from(encoded, 'base64'))
    } catch {
      return null // saved under another account, or the secure-storage key it needs is gone
    }
  }

  async function readNow(provider: ProviderId): Promise<string | null> {
    assertProvider(provider)
    if (!box.isAvailable()) return null
    // The first source that can be used wins: the file of the new kind, then (for Anthropic) the old one.
    const stored = (await readJson(fileOf(provider))) as Partial<StoredKey> | null
    if (
      stored &&
      typeof stored === 'object' &&
      stored.version === 2 &&
      stored.provider === provider
    ) {
      return decrypt(stored.key)
    }
    if (provider === 'anthropic') {
      const legacy = (await readJson(legacyFile)) as {
        version?: unknown
        anthropicApiKey?: unknown
      } | null
      if (legacy && typeof legacy === 'object' && legacy.version === 1)
        return decrypt(legacy.anthropicApiKey)
    }
    return null
  }

  return {
    canStore: () => box.isAvailable(),

    read: (provider) => inOrder(() => readNow(provider)),

    save: (provider, key) =>
      inOrder(async () => {
        assertProvider(provider)
        if (!box.isAvailable()) throw new Error('this computer has no secure storage for the key')
        const contents: StoredKey = {
          version: 2,
          provider,
          key: box.encrypt(key).toString('base64')
        }
        await fs.mkdir(dir, { recursive: true })
        // Written in place (see the top). The file is one short line: a torn write costs this provider's key only.
        await fs.writeFile(fileOf(provider), JSON.stringify(contents), { mode: 0o600 })
        // Do not claim success unless the key really reads back: the person is told "Saved" on this basis.
        if ((await readNow(provider)) !== key)
          throw new Error('the saved key could not be read back')
        // The old file only matters until its key has a file of the new kind. Left behind, it would bring a removed
        // key back to life; it is deleted last, so a failure here loses nothing (the file of the new kind wins).
        if (provider === 'anthropic')
          await fs.rm(legacyFile, { force: true }).catch(() => undefined)
      }),

    clear: (provider) =>
      inOrder(async () => {
        assertProvider(provider)
        const files = provider === 'anthropic' ? [fileOf(provider), legacyFile] : [fileOf(provider)]
        await Promise.all(files.map((file) => fs.rm(file, { force: true })))
        // Do not say "removed" unless every file is really gone.
        for (const file of files) {
          const still = await fs.access(file).then(
            () => true,
            () => false
          )
          if (still) throw new Error('the key file could not be deleted')
        }
      })
  }
}
