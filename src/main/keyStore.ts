import { app, safeStorage } from 'electron'
import type { ProviderId } from '../shared/registry'
import { createCredentialStore, type CredentialStore, type SecretBox } from './credentialStore'

// The API keys (D-010, D-020). The keeping of them, and the rules for it, are in credentialStore.ts, which imports nothing
// from Electron so that it can be checked on its own. This file only hands it the two things only Electron knows: the
// operating system's secure storage, and the app's per-user data folder.

/** True if this computer can keep a key safely. Only meaningful after the app is ready. */
function secureStorageAvailable(): boolean {
  if (!safeStorage.isEncryptionAvailable()) return false
  // With no desktop keyring, Electron on Linux falls back to a password written in its own source code. That is
  // disguise, not protection, so it is treated as "cannot store".
  if (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text') {
    return false
  }
  return true
}

/** The operating system's secure storage, as the API keys use it and, since 8b.3, the saved chats when the person turns encryption on (D-035). */
export const secureStorage: SecretBox = {
  isAvailable: secureStorageAvailable,
  encrypt: (plain) => safeStorage.encryptString(plain),
  decrypt: (blob) => safeStorage.decryptString(blob)
}

// Made on first use: the data folder is not known until the app is ready.
let store: CredentialStore | null = null
const credentials = (): CredentialStore =>
  (store ??= createCredentialStore(app.getPath('userData'), secureStorage))

export const canStoreKey = (): boolean => credentials().canStore()

/** The saved key, decrypted. For the main process only: it must never be sent to the page. */
export const readApiKey = (provider: ProviderId): Promise<string | null> =>
  credentials().read(provider)

export const saveApiKey = (provider: ProviderId, key: string): Promise<void> =>
  credentials().save(provider, key)

export const clearApiKey = (provider: ProviderId): Promise<void> => credentials().clear(provider)
