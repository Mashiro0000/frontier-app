import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import {
  CHANNELS,
  type SetKeyResult,
  type SetModelResult,
  type SettingsStatus
} from '../shared/ipc'
import { toModelOption } from '../shared/registry'
import { checkApiKey, checkModelChoice } from '../shared/validate'
import { registerChatIpc } from './chat'
import { canStoreKey, clearApiKey, readApiKey, saveApiKey } from './keyStore'
import { chooseModel, currentModel, inOrder } from './models'
import { getRegistry, reportRegistryProblems } from './registry'
import { isTrustedSender } from './security'

async function currentStatus(): Promise<SettingsStatus> {
  const registry = getRegistry()
  const choice = await currentModel()
  return {
    hasKey: (await readApiKey()) !== null,
    canStoreKey: canStoreKey(),
    models: registry.ok ? registry.registry.models.map(toModelOption) : [],
    selectedModelId: choice.ok ? choice.entry.id : null,
    modelsError: registry.ok ? null : registry.error,
    modelsCheckedOn: registry.ok ? registry.registry.updatedAt : null
  }
}

/** Registers every message the page may send to main. Call once, after the app is ready. */
export function registerIpc(appUrl: string): void {
  reportRegistryProblems() // at startup, once: whatever is wrong with registry/models.json goes in the log

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

  ipcMain.handle(
    CHANNELS.settingsSetModel,
    guarded((input: unknown): Promise<SetModelResult> =>
      inOrder(async () => {
        const registry = getRegistry()
        const check = checkModelChoice(input, registry.ok ? registry.registry.models : [])
        if (!check.ok) return check // never trust what the page sends: only a model on offer gets through
        try {
          await chooseModel(check.modelId)
        } catch (error) {
          // Logged here only; the message could name a file path.
          console.error(
            'Saving the model choice failed:',
            error instanceof Error ? error.message : error
          )
          return { ok: false, error: 'The choice could not be saved on this computer.' }
        }
        return { ok: true, status: await currentStatus() }
      })
    )
  )

  registerChatIpc(appUrl)
}
