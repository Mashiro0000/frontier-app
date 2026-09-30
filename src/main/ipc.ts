import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import { CHANNELS, type SetKeyResult, type SettingsStatus } from '../shared/ipc'
import { checkApiKey } from '../shared/validate'
import { registerChatIpc } from './chat'
import { canStoreKey, clearApiKey, readApiKey, saveApiKey } from './keyStore'
import { MODEL_LABEL, PROVIDER_NAME } from './provider'
import { isTrustedSender } from './security'

async function currentStatus(): Promise<SettingsStatus> {
  return {
    hasKey: (await readApiKey()) !== null,
    canStoreKey: canStoreKey(),
    provider: PROVIDER_NAME,
    modelLabel: MODEL_LABEL
  }
}

/** Registers every message the page may send to main. Call once, after the app is ready. */
export function registerIpc(appUrl: string): void {
  // A thrown error rejects the promise the page is waiting on.
  const guarded =
    <A extends unknown[], R>(handler: (...args: A) => Promise<R>) =>
    (event: IpcMainInvokeEvent, ...args: A): Promise<R> => {
      if (!isTrustedSender(event, appUrl)) {
        throw new Error('Blocked: this call did not come from the app window.')
      }
      return handler(...args)
    }

  ipcMain.handle(CHANNELS.settingsStatus, guarded(currentStatus))

  ipcMain.handle(
    CHANNELS.settingsSetApiKey,
    guarded(async (input: unknown): Promise<SetKeyResult> => {
      const check = checkApiKey(input) // never trust what the page sends
      if (!check.ok) return check
      try {
        await saveApiKey(check.key)
      } catch (error) {
        // The message is logged here only; it could name a file path, and never contains the key.
        console.error('Saving the API key failed:', error instanceof Error ? error.message : error)
        return { ok: false, error: 'The key could not be saved on this computer.' }
      }
      return { ok: true, status: await currentStatus() }
    })
  )

  ipcMain.handle(
    CHANNELS.settingsClearApiKey,
    guarded(async () => {
      await clearApiKey()
      return currentStatus()
    })
  )

  registerChatIpc(appUrl)
}
