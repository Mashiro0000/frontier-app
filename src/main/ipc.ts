import { app, ipcMain, type IpcMainInvokeEvent } from 'electron'
import { join } from 'path'
import {
  CHANNELS,
  type HistoryList,
  type HistoryLoadResult,
  type HistoryRemoveResult,
  type HistorySaveResult,
  type SetKeyResult,
  type SetModelResult,
  type SettingsStatus
} from '../shared/ipc'
import { toModelOption } from '../shared/registry'
import {
  checkApiKey,
  checkConversationId,
  checkConversationSave,
  checkModelChoice
} from '../shared/validate'
import { registerChatIpc } from './chat'
import { createConversationStore } from './conversationStore'
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

/**
 * Registers every message the page may send to main. Call once, after the app is ready. Returns a function
 * that resolves when every save and deletion of a conversation asked for so far has finished: quitting
 * waits for it, so closing the window cannot cut a file off halfway.
 */
export function registerIpc(appUrl: string): () => Promise<void> {
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

  // Saved conversations (D-016, D-017). The store owns the files; these handlers only check who is asking and
  // what they ask. A failure is logged here with its real reason (which could name a path) and the page gets
  // a plain sentence.
  const folder = join(app.getPath('userData'), 'conversations')
  const history = createConversationStore(folder)
  const reason = (error: unknown): unknown => (error instanceof Error ? error.message : error)

  ipcMain.handle(
    CHANNELS.historyList,
    guarded(async (): Promise<HistoryList> => {
      try {
        return { ...(await history.list()), folder }
      } catch (error) {
        console.error('Listing the saved conversations failed:', reason(error))
        throw new Error('The saved conversations could not be listed.')
      }
    })
  )

  ipcMain.handle(
    CHANNELS.historyLoad,
    guarded(async (input: unknown): Promise<HistoryLoadResult> => {
      const check = checkConversationId(input) // never trust what the page sends: it becomes part of a file name
      if (!check.ok) return check
      try {
        return await history.load(check.id)
      } catch (error) {
        console.error('Reading a saved conversation failed:', reason(error))
        return { ok: false, error: 'That conversation could not be read.' }
      }
    })
  )

  ipcMain.handle(
    CHANNELS.historySave,
    guarded(async (input: unknown): Promise<HistorySaveResult> => {
      const check = checkConversationSave(input) // the title and dates are not the page's to choose
      if (!check.ok) return check
      try {
        return await history.save(check.conversation)
      } catch (error) {
        console.error('Saving a conversation failed:', reason(error))
        return { ok: false, error: 'The conversation could not be saved on this computer.' }
      }
    })
  )

  ipcMain.handle(
    CHANNELS.historyRemove,
    guarded(async (input: unknown): Promise<HistoryRemoveResult> => {
      const check = checkConversationId(input)
      if (!check.ok) return check
      try {
        return await history.remove(check.id)
      } catch (error) {
        console.error('Deleting a saved conversation failed:', reason(error))
        return { ok: false, error: 'The conversation could not be deleted.' }
      }
    })
  )

  registerChatIpc(appUrl)
  return () => history.whenIdle()
}
