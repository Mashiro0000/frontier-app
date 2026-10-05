import { app, BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron'
import { join } from 'path'
import {
  CHANNELS,
  type HistoryExportResult,
  type HistoryList,
  type HistoryRestoreApplyResult,
  type HistoryRestoreLookResult,
  type HistoryLoadResult,
  type HistoryRemoveResult,
  type HistorySaveResult,
  type SetAskFirstResult,
  type SetEffortResult,
  type SetKeyResult,
  type SetLimitsResult,
  type SetModelResult,
  type SettingsStatus,
  type TestKeyResult
} from '../shared/ipc'
import type { UsageSummary } from '../shared/usage'
import { checkAskFirstChoice } from '../shared/askFirst'
import { effortStatusOf } from '../shared/effort'
import { checkLimitsChoice, unsetLimits } from '../shared/limits'
import { suggestionsFor, TASKS } from '../shared/rankings'
import {
  PROVIDER_NAMES,
  SUPPORTED_PROVIDERS,
  toModelOption,
  type ProviderId
} from '../shared/registry'
import {
  chatForUsage,
  checkConversationId,
  checkConversationSave,
  checkEffortChoice,
  checkKeySubmission,
  checkModelChoice,
  checkProvider
} from '../shared/validate'
import { createAskFirstStore } from './askFirst'
import { systemPickers } from './backupDialogs'
import { createBackupService } from './backupService'
import { baseUrlOverride } from './baseUrl'
import { registerChatIpc } from './chat'
import { createConversationStore } from './conversationStore'
import { canStoreKey, clearApiKey, readApiKey, saveApiKey } from './keyStore'
import { createLimitsStore } from './limits'
import { chooseEffort, chooseModel, currentModel, inOrder } from './models'
import { adapterFor } from './providers'
import { describeFailure, timeoutError } from './providers/errors'
import { getRankings, reportRankingsProblems } from './rankings'
import { getRegistry, reportRegistryProblems } from './registry'
import { isTrustedSender } from './security'
import { createUsageLedger } from './usageLedger'

// The spending limits (D-031), in limits.json in the data folder. Main alone reads and writes them; the folder is asked for when first used.
const limitsStore = createLimitsStore(() => join(app.getPath('userData'), 'limits.json'))
// What the person chose for being asked before a very large request (D-032), in ask-first.json beside it. Damage to it never turns the question off.
const askFirstStore = createAskFirstStore(() => join(app.getPath('userData'), 'ask-first.json'))

/** "Test key" gives up after this long, so a provider that never answers cannot leave the button spinning for ever. */
const TEST_KEY_TIMEOUT_MS = 20_000

async function currentStatus(): Promise<SettingsStatus> {
  const registry = getRegistry()
  const rankings = getRankings()
  const choice = await currentModel()
  const providers = await Promise.all(
    SUPPORTED_PROVIDERS.map(async (id) => ({
      id,
      name: PROVIDER_NAMES[id],
      hasKey: (await readApiKey(id)) !== null
    }))
  )
  const hasKey = (provider: ProviderId): boolean =>
    providers.some((candidate) => candidate.id === provider && candidate.hasKey)
  return {
    providers,
    canStoreKey: canStoreKey(),
    models: registry.ok ? registry.registry.models.map(toModelOption) : [],
    selectedModelId: choice.ok ? choice.entry.id : null,
    modelsError: registry.ok ? null : registry.error,
    modelsCheckedOn: registry.ok ? registry.registry.updatedAt : null,
    tasks: TASKS.map((task) => ({ ...task })),
    suggestions:
      registry.ok && rankings.ok
        ? suggestionsFor(rankings.rankings, registry.registry.models, hasKey)
        : [],
    effort: choice.ok ? effortStatusOf(choice.entry, choice.effort) : null,
    // A file that cannot be read at all shows as "not chosen", which is also what refuses requests: the page still loads, and asks.
    limits: await limitsStore.read().catch(() => unsetLimits()),
    askFirst: await askFirstStore.read() // never throws: a file that cannot be read is "nothing chosen", and the question is still asked
  }
}

/**
 * Registers every message the page may send to main. Call once, after the app is ready. Returns a function
 * that resolves when every save and deletion of a conversation asked for so far has finished: quitting
 * waits for it, so closing the window cannot cut a file off halfway.
 */
export function registerIpc(appUrl: string): () => Promise<void> {
  reportRegistryProblems() // at startup, once: whatever is wrong with registry/models.json goes in the log
  reportRankingsProblems() // ...and with registry/rankings.json, which only costs the suggestions

  // A thrown error rejects the promise the page is waiting on.
  const guarded =
    <A extends unknown[], R>(handler: (...args: A) => Promise<R>) =>
    (event: IpcMainInvokeEvent, ...args: A): Promise<R> => {
      if (!isTrustedSender(event, appUrl)) {
        throw new Error('Blocked: this call did not come from the app window.')
      }
      return handler(...args)
    }

  // The same check, for a handler that must open a dialog: it is given the window the call came from (never one the page named).
  const guardedForWindow =
    <A extends unknown[], R>(handler: (window: BrowserWindow | null, ...args: A) => Promise<R>) =>
    (event: IpcMainInvokeEvent, ...args: A): Promise<R> =>
      guarded((...rest: A) => handler(BrowserWindow.fromWebContents(event.sender), ...rest))(
        event,
        ...args
      )

  ipcMain.handle(CHANNELS.settingsStatus, guarded(currentStatus))

  ipcMain.handle(
    CHANNELS.settingsSetApiKey,
    guarded(async (input: unknown): Promise<SetKeyResult> => {
      const check = checkKeySubmission(input) // never trust what the page sends: which provider, and what key
      if (!check.ok) return check
      try {
        await saveApiKey(check.provider, check.key)
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
    guarded(async (input: unknown): Promise<SettingsStatus> => {
      const check = checkProvider(input)
      if (!check.ok) throw new Error(check.error) // refused: nothing is deleted for a provider that is not on the list
      await clearApiKey(check.provider)
      return currentStatus()
    })
  )

  // "Test key": ask the provider for its list of models, which costs nothing, with the key that is SAVED (never one the
  // page hands over). The page learns a count, or a sentence in which the key has been scrubbed out (D-020).
  ipcMain.handle(
    CHANNELS.settingsTestApiKey,
    guarded(async (input: unknown): Promise<TestKeyResult> => {
      const check = checkProvider(input)
      if (!check.ok) return check
      const { provider } = check
      const apiKey = await readApiKey(provider)
      if (apiKey === null) {
        return { ok: false, error: `No ${PROVIDER_NAMES[provider]} API key is saved yet.` }
      }
      const adapter = adapterFor(provider)
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), TEST_KEY_TIMEOUT_MS)
      try {
        const models = await adapter.listModels(
          { apiKey, baseURL: baseUrlOverride(provider) },
          controller.signal
        )
        return { ok: true, modelCount: models.length }
      } catch (error) {
        const failure = controller.signal.aborted
          ? timeoutError(PROVIDER_NAMES[provider]) // our own timer cancelled it
          : adapter.normalizeError(error, { modelId: '' })
        return { ok: false, error: describeFailure(failure, apiKey) }
      } finally {
        clearTimeout(timer)
      }
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

  // How hard a model thinks (D-024): the same shape as the model choice, and the same queue, because both live in preferences.json.
  // The model and the level are checked here against what the registry lists for that model, and again where they are saved.
  ipcMain.handle(
    CHANNELS.settingsSetEffort,
    guarded((input: unknown): Promise<SetEffortResult> =>
      inOrder(async () => {
        const registry = getRegistry()
        const check = checkEffortChoice(input, registry.ok ? registry.registry.models : [])
        if (!check.ok) return check // never trust what the page sends: only a model on offer, and a level it takes, get through
        try {
          await chooseEffort(check.modelId, check.level)
        } catch (error) {
          // Logged here only; the message could name a file path.
          console.error(
            'Saving the effort choice failed:',
            error instanceof Error ? error.message : error
          )
          return { ok: false, error: 'The choice could not be saved on this computer.' }
        }
        return { ok: true, status: await currentStatus() }
      })
    )
  )

  // The spending limits (D-031): both together, as the person chose them. Checked again here; the page cannot take a choice back to "not
  // chosen" and has no other way to change a limit. The request check that uses them is in chat.ts, in main.
  ipcMain.handle(
    CHANNELS.settingsSetLimits,
    guarded(async (input: unknown): Promise<SetLimitsResult> => {
      const check = checkLimitsChoice(input)
      if (!check.ok) return check
      try {
        await limitsStore.save(check.limits)
      } catch (error) {
        // Logged here only; the message could name a file path.
        console.error('Saving the limits failed:', error instanceof Error ? error.message : error)
        return { ok: false, error: 'The limits could not be saved on this computer.' }
      }
      return { ok: true, status: await currentStatus() }
    })
  )

  // The amount above which a large request is asked about first, or "Never ask" (D-032). Checked again here, and rebuilt field by field. The page
  // cannot send "nothing chosen"; the question itself is asked in chat.ts, in main, whatever the page says.
  ipcMain.handle(
    CHANNELS.settingsSetAskFirst,
    guarded(async (input: unknown): Promise<SetAskFirstResult> => {
      const check = checkAskFirstChoice(input)
      if (!check.ok) return check
      try {
        await askFirstStore.save(check.choice)
      } catch (error) {
        // Logged here only; the message could name a file path.
        console.error(
          'Saving the ask-first choice failed:',
          error instanceof Error ? error.message : error
        )
        return { ok: false, error: 'The choice could not be saved on this computer.' }
      }
      return { ok: true, status: await currentStatus() }
    })
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

  // Backing up chats to a file and restoring them from one (D-034). The person chooses the place and the file in the system's own dialogs, which main
  // opens for the window that asked; the page sends "all", or "one" and an id, and later "add what you showed me". It never sends a path.
  const backups = createBackupService({
    store: history,
    dataDir: app.getPath('userData'),
    pickers: systemPickers
  })

  ipcMain.handle(
    CHANNELS.historyExport,
    guardedForWindow((window, input: unknown): Promise<HistoryExportResult> =>
      backups.exportChats(input, window)
    )
  )

  ipcMain.handle(
    CHANNELS.historyRestoreLook,
    guardedForWindow((window): Promise<HistoryRestoreLookResult> => backups.restoreLook(window))
  )

  ipcMain.handle(
    CHANNELS.historyRestoreApply,
    guarded((token: unknown): Promise<HistoryRestoreApplyResult> => backups.restoreApply(token))
  )

  ipcMain.on(CHANNELS.historyRestoreCancel, (event, token: unknown) => {
    if (isTrustedSender(event, appUrl)) backups.restoreCancel(token)
  })

  // What was used and what it cost (D-030): one plain file, written by main alone. The page can ask for sums and nothing else.
  const ledger = createUsageLedger(join(app.getPath('userData'), 'usage', 'ledger.jsonl'))

  ipcMain.handle(
    CHANNELS.usageSummary,
    guarded(async (input: unknown): Promise<UsageSummary> => {
      try {
        return await ledger.summary(chatForUsage(input)) // an id that is not one is read as none
      } catch (error) {
        console.error('Reading the usage ledger failed:', reason(error))
        throw new Error('The usage could not be read.')
      }
    })
  )

  registerChatIpc(appUrl, ledger, limitsStore, askFirstStore)
  return () =>
    Promise.all([history.whenIdle(), ledger.whenIdle(), backups.whenIdle()]).then(() => undefined)
}
