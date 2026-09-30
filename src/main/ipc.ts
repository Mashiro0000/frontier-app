import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import { CHANNELS, type SetKeyResult, type SettingsStatus } from '../shared/ipc'
import { checkApiKey } from '../shared/validate'
import { canStoreKey, clearApiKey, readApiKey, saveApiKey } from './keyStore'
import { isAppUrl } from './security'

/**
 * True only for a call made by the app's own page, from the window's top frame. The preload's API
 * also exists in an `about:blank` page (the navigation lock cannot stop that one), so being "in our
 * window" is not enough: check who is really calling.
 */
function isTrusted(event: IpcMainInvokeEvent, appUrl: string): boolean {
  const frame = event.senderFrame
  return frame !== null && frame === event.sender.mainFrame && isAppUrl(frame.url, appUrl)
}

async function currentStatus(): Promise<SettingsStatus> {
  return { hasKey: (await readApiKey()) !== null, canStoreKey: canStoreKey() }
}

/** Registers every message the page may send to main. Call once, after the app is ready. */
export function registerIpc(appUrl: string): void {
  // A thrown error rejects the promise the page is waiting on.
  const guarded =
    <A extends unknown[], R>(handler: (...args: A) => Promise<R>) =>
    (event: IpcMainInvokeEvent, ...args: A): Promise<R> => {
      if (!isTrusted(event, appUrl)) {
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
}
