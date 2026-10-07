import { app, BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron'
import { join } from 'path'
import {
  CHANNELS,
  type AttachBytesResult,
  type AttachmentPreview,
  type AttachPickResult,
  type ChatStorageResult,
  type ChatStorageStatus,
  type CheckChatInstructionsResult,
  type EveryChatStatus,
  type HistoryExportResult,
  type HistoryList,
  type HistoryRestoreApplyResult,
  type HistoryRestoreLookResult,
  type HistoryLoadResult,
  type HistoryRemoveResult,
  type HistorySaveResult,
  type SaveEveryChatResult,
  type SetAskFirstResult,
  type SetEffortResult,
  type SetKeyResult,
  type SetLimitsResult,
  type SetModelResult,
  type SettingsStatus,
  type TestKeyResult
} from '../shared/ipc'
import type { MemoryChangeResult, MemoryExportResult, MemoryStatus } from '../shared/memory'
import type { ProjectChangeResult, ProjectsStatus } from '../shared/projects'
import type { UsageSummary } from '../shared/usage'
import { effortStatusOf } from '../shared/effort'
import { unsetLimits } from '../shared/limits'
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
import { electronImageTools } from './attachmentImages'
import { createAttachmentService } from './attachmentService'
import { createAttachmentStore } from './attachmentStore'
import {
  askPerson,
  pickAttachmentPaths,
  pickNotesExportPath,
  systemAskers,
  systemPickers
} from './backupDialogs'
import { createBackupService } from './backupService'
import { baseUrlOverride } from './baseUrl'
import { registerChatIpc } from './chat'
import { createChatEncryptionService } from './chatEncryptionService'
import { createChatProtection } from './chatProtection'
import { createConversationStore } from './conversationStore'
import { createEveryChat } from './everyChat'
import { keptDocuments } from './keptFile'
import { canStoreKey, clearApiKey, readApiKey, saveApiKey, secureStorage } from './keyStore'
import { createLimitChanges } from './limitChanges'
import { createLimitsStore } from './limits'
import { createMemory } from './memory'
import { createProjects } from './projects'
import { chooseEffort, chooseModel, currentModel, inOrder } from './models'
import { adapterFor } from './providers'
import { describeFailure, timeoutError } from './providers/errors'
import { getRankings, reportRankingsProblems } from './rankings'
import { getRegistry, reportRegistryProblems } from './registry'
import type { SavedKey } from './secrets'
import { isTrustedSender } from './security'
import { createQuestionGate } from './systemQuestion'
import { createUsageLedger } from './usageLedger'

// The spending limits (D-031), in limits.json in the data folder. Main alone reads and writes them; the folder is asked for when first used.
const limitsStore = createLimitsStore(() => join(app.getPath('userData'), 'limits.json'))
// What the person chose for being asked before a very large request (D-032), in ask-first.json beside it. Damage to it never turns the question off.
const askFirstStore = createAskFirstStore(() => join(app.getPath('userData'), 'ask-first.json'))
// The questions main asks the person in the system's own message box (D-039), one at a time across the app. The page cannot answer them.
const questions = createQuestionGate(askPerson)
// A change of a limit, or of the amount the app asks above, that lets the app spend more is saved only after the person's yes in that box (D-039).
const limitChanges = createLimitChanges({ limitsStore, askFirstStore, gate: questions })

/** "Test key" gives up after this long, so a provider that never answers cannot leave the button spinning for ever. */
const TEST_KEY_TIMEOUT_MS = 20_000

/** The API keys saved in this app, for the look for secrets (D-039): text that holds one is never kept or sent as instructions. Never sent to the page. */
async function savedKeys(): Promise<SavedKey[]> {
  const keys: SavedKey[] = []
  for (const provider of SUPPORTED_PROVIDERS) {
    const key = await readApiKey(provider)
    if (key !== null) keys.push({ provider, key })
  }
  return keys
}

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

  // The spending limits (D-031): both together, as the person chose them. Checked again in limitChanges.ts; the page cannot take a choice back to "not
  // chosen" and has no other way to change a limit. A choice that lets the app spend more (a higher amount, "No limit", any choice made from "not
  // chosen") is saved only after the person's yes in the system's message box, for the window that asked (D-039). The request check that uses the
  // limits is in chat.ts, in main.
  ipcMain.handle(
    CHANNELS.settingsSetLimits,
    guardedForWindow(async (window, input: unknown): Promise<SetLimitsResult> => {
      const done = await limitChanges.setLimits(window, input)
      return done.ok ? { ok: true, status: await currentStatus() } : done
    })
  )

  // The amount above which a large request is asked about first, or "Never ask" (D-032). Checked again in limitChanges.ts, and rebuilt field by field. The
  // page cannot send "nothing chosen"; a choice that asks less often (a higher amount, "Never ask") is saved only after the person's yes in the system's
  // message box (D-039). The question before a large request itself is asked in chat.ts, in main, whatever the page says.
  ipcMain.handle(
    CHANNELS.settingsSetAskFirst,
    guardedForWindow(async (window, input: unknown): Promise<SetAskFirstResult> => {
      const done = await limitChanges.setAskFirst(window, input)
      return done.ok ? { ok: true, status: await currentStatus() } : done
    })
  )

  // Saved conversations (D-016, D-017). The store owns the files; these handlers only check who is asking and
  // what they ask. A failure is logged here with its real reason (which could name a path) and the page gets
  // a plain sentence.
  const folder = join(app.getPath('userData'), 'conversations')
  // How the chats are kept (D-035): plain files until the person turns encryption on. chatProtection.ts alone says how a chat may be written, and the
  // store asks it before every write; with the key unusable it says "no", and nothing new is saved.
  const protection = createChatProtection({
    box: secureStorage,
    pathOf: () => join(app.getPath('userData'), 'chat-encryption.json')
  })
  const history = createConversationStore(folder, {
    box: secureStorage,
    writeMode: protection.writeMode
  })
  // The person's instructions for every chat (D-039), in instructions.json beside the chats, written like them and sealed like them (the same rule). Main
  // adds them to every request itself; the page can read them and ask to change them, and a change that adds text waits for a yes in the system's box.
  const everyChat = createEveryChat({
    pathOf: () => join(app.getPath('userData'), 'instructions.json'),
    box: secureStorage,
    writeMode: protection.writeMode,
    gate: questions,
    savedKeys
  })
  // The person's notes (D-039), in memory.json beside them, kept the same way. Main sends them itself; the page shows them and asks to change them, and a
  // new or changed note waits for a yes in the system's box. A note for a project names it by id; the projects say whether it exists (10.5).
  const memory = createMemory({
    pathOf: () => join(app.getPath('userData'), 'memory.json'),
    box: secureStorage,
    writeMode: protection.writeMode,
    gate: questions,
    savedKeys,
    projectName: (id) => projects.nameOf(id),
    dataDir: app.getPath('userData'),
    pickExportPath: pickNotesExportPath
  })
  const reason = (error: unknown): unknown => (error instanceof Error ? error.message : error)
  // The attachments (D-037): main's own copies of the files the person attaches, in attachments/ beside the chats, checked by their bytes and sealed
  // like the chats (the same rule for how a file may be written). The page hands over bytes (a paste, a drop) or asks main to open the system's dialog;
  // it never names a path.
  const attachments = createAttachmentStore(join(app.getPath('userData'), 'attachments'), {
    images: electronImageTools,
    box: secureStorage,
    writeMode: protection.writeMode
  })
  const attaching = createAttachmentService({
    store: attachments,
    pickPaths: pickAttachmentPaths,
    // The files saved chats use (D-037): a file taken off a message is deleted only if no chat uses it, and only if every chat could be read.
    referenced: () => usedFiles()
  })
  // The files every saved chat and every project uses (D-037, D-039): null while a chat or projects.json cannot be read, and then nothing is deleted.
  async function usedFiles(): Promise<ReadonlySet<string> | null> {
    const chats = await history.attachmentRefs()
    const inProjects = await projects.fileRefs()
    return chats.complete && inProjects !== null ? new Set([...chats.ids, ...inProjects]) : null
  }
  /** Copies no chat and no project uses any more: deleted, and only when everything could be read. */
  async function deleteUnusedFiles(ids: readonly string[]): Promise<void> {
    if (ids.length === 0) return
    const used = await usedFiles()
    if (used !== null) await attachments.deleteUnused([...ids], used)
  }
  // The person's projects (D-039, 10.5), in projects.json beside the chats, kept the same way: a name, instructions and files for a group of chats. New
  // instructions and added files wait for a yes in the system's box; a project's files are the attachment store's own copies, kept while it names them.
  const projects = createProjects({
    pathOf: () => join(app.getPath('userData'), 'projects.json'),
    box: secureStorage,
    writeMode: protection.writeMode,
    gate: questions,
    savedKeys,
    files: {
      pick: (owner) => attaching.pick(owner),
      release: (id) => attachments.release(id),
      discard: (id) => attaching.discard(id),
      deleteUnused: deleteUnusedFiles
    },
    removeNotes: (projectId) => memory.removeScope(projectId)
  })

  // Backing up chats to a file and restoring them from one (D-034), and turning the encryption of the saved chats on and off (D-035): the same lock,
  // so that never two of them run at once. The person chooses places and answers questions in the system's own dialogs, which main opens for the
  // window that asked; the page sends "all", or "one" and an id, "add what you showed me", and never a path or an answer.
  const backups = createBackupService({
    store: history,
    dataDir: app.getPath('userData'),
    pickers: systemPickers,
    // A backup holds the files its chats carry, as their plain bytes, and a restore puts them back (D-037).
    files: {
      read: async (id) => {
        const copy = await attachments.read(id)
        return copy.ok ? copy.bytes : null
      },
      adopt: (id, bytes) => attachments.adopt(id, bytes)
    }
  })
  const encryption = createChatEncryptionService({
    store: history,
    protection,
    backups,
    asks: systemAskers,
    files: attachments,
    documents: keptDocuments([everyChat.file, memory.file, projects.file]) // rewritten with the chats (D-039)
  })

  ipcMain.handle(
    CHANNELS.historyList,
    guarded(async (): Promise<HistoryList> => {
      try {
        return { ...(await history.list()), folder, storage: await encryption.status() }
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
        // A chat moved into a project that is not there (deleted meanwhile, or never made) is saved in none (D-039).
        const { project, ...rest } = check.conversation
        const conversation =
          project !== undefined && (await projects.nameOf(project)) !== null
            ? check.conversation
            : rest
        const saved = await history.save(conversation)
        // A file attached in this run is held (kept from deletion) while it is on a message being written. Once a saved chat names it, the chat keeps
        // it instead: it is let go of, so that deleting the chat can delete it (D-037).
        if (saved.ok) {
          for (const message of check.conversation.messages) {
            for (const file of message.attachments ?? []) attachments.release(file.id)
          }
        }
        return saved
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
        // The chat's files are deleted with it when no other chat and no project uses them (D-037, D-039), and only when everything could be read
        // (else what uses them is not known). A file that cannot be deleted is left; the chat is still deleted.
        const files = await history.attachmentsOf(check.id)
        const removed = await history.remove(check.id)
        if (removed.ok) await deleteUnusedFiles(files)
        return removed
      } catch (error) {
        console.error('Deleting a saved conversation failed:', reason(error))
        return { ok: false, error: 'The conversation could not be deleted.' }
      }
    })
  )

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

  // How the saved chats are kept (D-035). The page asks how they are kept, and asks to turn encryption on or off; it sends nothing else (no path, no key,
  // no answer to a question). On: main asks the person where to put a backup in the system's save dialog, and changes nothing unless it is made and checked.
  // Off: main asks the person in the system's message box. Both answer with what was done.
  ipcMain.handle(
    CHANNELS.historyStorage,
    guarded(async (): Promise<ChatStorageStatus> => {
      try {
        return await encryption.status()
      } catch (error) {
        console.error('Looking at how the chats are kept failed:', reason(error))
        throw new Error('How the chats are kept could not be read.')
      }
    })
  )

  ipcMain.handle(
    CHANNELS.historyEncrypt,
    guardedForWindow(async (window): Promise<ChatStorageResult> => {
      try {
        return await encryption.encrypt(window)
      } catch (error) {
        console.error('Encrypting the chats failed:', reason(error))
        return {
          ok: false,
          error: 'The chats could not be encrypted. Your chats are as they were.'
        }
      }
    })
  )

  ipcMain.handle(
    CHANNELS.historyDecrypt,
    guardedForWindow(async (window): Promise<ChatStorageResult> => {
      try {
        return await encryption.decrypt(window)
      } catch (error) {
        console.error('Going back to plain files failed:', reason(error))
        return { ok: false, error: 'The chats could not be turned back into plain files.' }
      }
    })
  )

  // Attaching files (D-037). "Attach..." opens the system's open dialog for the window that asked; a paste or a drop hands over bytes and a name. Every
  // file is checked by its bytes and kept as a copy; the page learns what it is (and a small picture), never a path.
  ipcMain.handle(
    CHANNELS.attachmentsPick,
    guardedForWindow(async (window): Promise<AttachPickResult> => {
      try {
        return await attaching.pick(window)
      } catch (error) {
        console.error('Attaching files failed:', reason(error))
        return { ok: false, error: 'The files could not be attached.' }
      }
    })
  )

  ipcMain.handle(
    CHANNELS.attachmentsAddBytes,
    guarded(async (input: unknown): Promise<AttachBytesResult> => {
      try {
        return await attaching.addBytes(input)
      } catch (error) {
        console.error('Attaching a pasted or dropped file failed:', reason(error))
        return { ok: false, error: 'The file could not be attached.' }
      }
    })
  )

  ipcMain.handle(
    CHANNELS.attachmentsDescribe,
    guarded(async (input: unknown): Promise<AttachmentPreview[]> => attaching.describe(input))
  )

  ipcMain.on(CHANNELS.attachmentsDiscard, (event, id: unknown) => {
    if (!isTrustedSender(event, appUrl)) return
    attaching.discard(id).catch((error: unknown) => {
      console.error('Letting go of an attachment failed:', reason(error))
    })
  })

  // The person's instructions for every chat (D-039). The page reads them, and asks to change them: main checks the text again, looks for secrets, and
  // asks the person in the system's own message box before it keeps new text, for the window that asked. Requests read main's own copy (chat.ts).
  ipcMain.handle(
    CHANNELS.instructionsGetEveryChat,
    guarded(async (): Promise<EveryChatStatus> => {
      try {
        return await everyChat.status()
      } catch (error) {
        console.error('Reading the instructions for every chat failed:', reason(error))
        throw new Error('Your instructions for every chat could not be read.')
      }
    })
  )

  ipcMain.handle(
    CHANNELS.instructionsSetEveryChat,
    guardedForWindow((window, input: unknown): Promise<SaveEveryChatResult> =>
      everyChat.save(window, input)
    )
  )

  // A chat's own instructions (D-027) stay the page's, saved with the chat; before the page keeps them it asks main for the same look for secrets.
  ipcMain.handle(
    CHANNELS.instructionsCheckForChat,
    guarded((input: unknown): Promise<CheckChatInstructionsResult> => everyChat.checkForChat(input))
  )

  // The person's notes (D-039). Making or changing one, and turning memory back on, ask in the system's message box for the window that asked; deleting
  // and turning memory off ask nothing there (the page asks first). The export opens the system's save dialog; the page sends no path and no answer.
  ipcMain.handle(
    CHANNELS.memoryStatus,
    guarded(async (): Promise<MemoryStatus> => {
      try {
        return await memory.status()
      } catch (error) {
        console.error('Reading the notes failed:', reason(error))
        throw new Error('Your notes could not be read.')
      }
    })
  )

  ipcMain.handle(
    CHANNELS.memoryAdd,
    guardedForWindow((window, input: unknown): Promise<MemoryChangeResult> =>
      memory.add(window, input)
    )
  )

  ipcMain.handle(
    CHANNELS.memoryEdit,
    guardedForWindow((window, input: unknown): Promise<MemoryChangeResult> =>
      memory.edit(window, input)
    )
  )

  ipcMain.handle(
    CHANNELS.memoryRemove,
    guarded((input: unknown): Promise<MemoryChangeResult> => memory.remove(input))
  )

  ipcMain.handle(
    CHANNELS.memoryRemoveAll,
    guarded((): Promise<MemoryChangeResult> => memory.removeAll())
  )

  ipcMain.handle(
    CHANNELS.memorySetOn,
    guardedForWindow((window, on: unknown): Promise<MemoryChangeResult> => memory.setOn(window, on))
  )

  ipcMain.handle(
    CHANNELS.memoryExport,
    guardedForWindow(async (window): Promise<MemoryExportResult> => {
      try {
        return await memory.exportAll(window)
      } catch (error) {
        console.error('Exporting the notes failed:', reason(error))
        return { ok: false, error: 'The notes could not be exported.' }
      }
    })
  )

  // The person's projects (D-039, 10.5). New instructions and added files ask in the system's message box for the window that asked (the files come
  // through the system's open dialog first); making, renaming, taking a file off and deleting ask nothing there (the page asks before deleting).
  ipcMain.handle(
    CHANNELS.projectsStatus,
    guarded(async (): Promise<ProjectsStatus> => {
      try {
        return await projects.status()
      } catch (error) {
        console.error('Reading the projects failed:', reason(error))
        throw new Error('Your projects could not be read.')
      }
    })
  )
  ipcMain.handle(
    CHANNELS.projectsCreate,
    guarded((input: unknown): Promise<ProjectChangeResult> => projects.create(input))
  )
  ipcMain.handle(
    CHANNELS.projectsRename,
    guarded((input: unknown): Promise<ProjectChangeResult> => projects.rename(input))
  )
  ipcMain.handle(
    CHANNELS.projectsSetInstructions,
    guardedForWindow((window, input: unknown): Promise<ProjectChangeResult> =>
      projects.setInstructions(window, input)
    )
  )
  ipcMain.handle(
    CHANNELS.projectsAddFiles,
    guardedForWindow(async (window, input: unknown): Promise<ProjectChangeResult> => {
      try {
        return await projects.addFiles(window, input)
      } catch (error) {
        console.error('Adding files to a project failed:', reason(error))
        return { ok: false, error: 'The files could not be added.' }
      }
    })
  )
  ipcMain.handle(
    CHANNELS.projectsRemoveFile,
    guarded((input: unknown): Promise<ProjectChangeResult> => projects.removeFile(input))
  )
  ipcMain.handle(
    CHANNELS.projectsRemove,
    guarded((input: unknown): Promise<ProjectChangeResult> => projects.remove(input))
  )
  ipcMain.handle(
    CHANNELS.projectsRemoveAll,
    guarded((): Promise<ProjectChangeResult> => projects.removeAll())
  )

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

  // At start, the copies left by messages that were never sent (D-037): deleted when no chat and no project uses them (D-039), they are over an hour
  // old, and every chat and projects.json could be read (otherwise what uses them is not known, and nothing is deleted). It runs in the stores' own turns, after the folder has been read.
  void usedFiles()
    .then((used) => (used !== null ? attachments.sweep(used, 3_600_000) : undefined))
    .catch((error: unknown) => console.error('Clearing unused attachments failed:', reason(error)))

  registerChatIpc(appUrl, {
    ledger,
    limitsStore,
    askFirstStore,
    readAttachment: (id) => attachments.read(id),
    everyChat: () => everyChat.forRequest(),
    savedKeys,
    notes: (projectId) => memory.forRequest(projectId)
  })
  // The lock the encryption flows run in is the backup service's, so waiting for it waits for them too.
  return () =>
    Promise.all([
      history.whenIdle(),
      ledger.whenIdle(),
      backups.whenIdle(),
      attachments.whenIdle(),
      everyChat.file.whenIdle(),
      memory.file.whenIdle(),
      projects.file.whenIdle()
    ]).then(() => undefined)
}
