import { app, BrowserWindow, ipcMain, shell, type IpcMainInvokeEvent } from 'electron'
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
import type { AuditDeleteResult, AuditExportResult, AuditView } from '../shared/audit'
import type { ToolChangeResult, ToolsStatus } from '../shared/tools'
import type { AppliedChange, ChangeActionResult, ChangeSummary } from '../shared/changes'
import type { WorkspaceChangeResult, WorkspaceStatus } from '../shared/workspace'
import type { ProgramsChangeResult, ProgramsStatus } from '../shared/programs'
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
import { createAuditLog } from './auditLog'
import { createAuditService } from './auditService'
import { electronImageTools } from './attachmentImages'
import { createAttachmentService } from './attachmentService'
import { createAttachmentStore } from './attachmentStore'
import {
  askPerson,
  pickAttachmentPaths,
  pickAuditExportPath,
  pickConnectorProgram,
  pickWorkspaceFolder,
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
import { createDataFolderGuard } from './dataFolderGuard'
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
import { createToolRuntime } from './replyTools'
import { heldKey, type SavedKey } from './secrets'
import { isSafeExternalUrl, isTrustedSender } from './security'
import { createQuestionGate } from './systemQuestion'
import { BUILT_IN_TOOLS, createToolRegistry } from './toolRegistry'
import { createWorkspaceStore, type AvoidPlaces } from './workspace'
import { createWorkspaceGuard } from './workspaceGuard'
import { createWorkspaceService, withWorkspace } from './workspaceService'
import { createProposalStore } from './proposals'
import { createApplier } from './applyService'
import { createJournal } from './journal'
import { createChangesService, fileStateOf } from './reviewService'
import { parseUndoEntry, renderUndoEntry, UNDO_LIMITS, UNDO_VERSION } from './undoRecords'
import { createReviewWindows } from './reviewWindow'
import { WORKSPACE_PROPOSE_TOOLS } from './proposalTools'
import { WORKSPACE_READ_TOOLS } from './workspaceTools'
import { createProgramBox } from './programBox'
import { createProgramService, withPrograms } from './programService'
import { defaultPlaces, resolveProgram, RUN_PROGRAM } from './programTools'
import { isInside } from './commandRunner'
import { createConnectorService } from './connectorService'
import { createConnectorStore } from './connectorStore'
import type { ConnectorChangeResult, ConnectorsStatus } from '../shared/connectors'
import type { ToolSettings } from '../shared/tools'
import { sweepSelfTest } from './selfTest'
import { createToolSettings } from './toolSettings'
import { createToolSettingsService } from './toolSettingsService'
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
    },
    // A backup of every chat holds the projects and the notes, and a restore adds them after the person's yes (10.7, D-039).
    kept: {
      projects: () => projects.restoreView(),
      notes: () => memory.restoreView(),
      savedKeys,
      gate: questions,
      addProjects: (added) => projects.addRestored(added),
      addNotes: (added) => memory.addRestored(added)
    }
  })
  // The audit log of tool calls (D-041), in audit/log.jsonl: one line for each thing that happens to a call, appended and proved, sealed like the chats when
  // encryption is on. The page can read it, export it and ask to delete it (which asks the person in the system's box); nothing else.
  const auditLog = createAuditLog({
    pathOf: () => join(app.getPath('userData'), 'audit', 'log.jsonl'),
    box: secureStorage,
    writeMode: protection.writeMode
  })
  const audit = createAuditService({
    log: auditLog,
    gate: questions,
    pickExportPath: pickAuditExportPath,
    dataDir: app.getPath('userData')
  })
  // Which tools are switched on and the caps on one reply (D-041), in tools.json, kept the same way. Main alone reads it, at every turn of a reply: with no
  // file, or a file that cannot be read, every tool is off.
  const toolSettings = createToolSettings({
    pathOf: () => join(app.getPath('userData'), 'tools.json'),
    box: secureStorage,
    writeMode: protection.writeMode
  })
  // The one registry of the build: the Tools page lists its tools, and the loop of a reply offers and runs them.
  const toolRegistry = createToolRegistry([
    ...BUILT_IN_TOOLS,
    ...WORKSPACE_READ_TOOLS,
    ...WORKSPACE_PROPOSE_TOOLS,
    RUN_PROGRAM
  ])
  // The code workspace (D-042): the one folder the model may list and read files in, kept in workspace.json like the tool settings. The guard holds the
  // containment rule beside the data-folder block; the service is what the page can ask for (choose, clear, switch on and off).
  const dataGuard = createDataFolderGuard({ roots: () => [app.getPath('userData')] })
  const workspaceStore = createWorkspaceStore({
    pathOf: () => join(app.getPath('userData'), 'workspace.json'),
    box: secureStorage,
    writeMode: protection.writeMode
  })
  let workspaceRoot: string | null = null
  // The changes the model has proposed and the person has not decided on (D-042, 12.4): held in memory only, gone when the app closes.
  const proposals = createProposalStore()
  // The places that may not be the workspace and the folders above them (the user's folder, the app-data folder, the personal folders), and the system's own.
  const avoidPlaces = (): AvoidPlaces => {
    const named = (name: Parameters<typeof app.getPath>[0]): string[] => {
      try {
        return [app.getPath(name)]
      } catch {
        return []
      }
    }
    const env = (name: string): string[] => {
      const value = process.env[name]
      return value === undefined || value === '' ? [] : [value]
    }
    return {
      holds: [
        ...named('home'),
        ...named('appData'),
        ...named('desktop'),
        ...named('documents'),
        ...named('downloads'),
        ...named('music'),
        ...named('pictures'),
        ...named('videos'),
        ...env('SystemDrive').map((drive) => `${drive}\\`)
      ],
      inside: [
        ...env('SystemRoot'),
        ...env('ProgramFiles'),
        ...env('ProgramFiles(x86)'),
        ...env('ProgramData')
      ]
    }
  }
  const workspaceGuard = createWorkspaceGuard({ root: () => workspaceRoot, dataGuard })
  // What the person can do with them (12.5): see the waiting ones, open the Review window (a window main owns, which this page cannot script), drop one, ask to apply
  // one. Applying is 12.6; until then the Review window says so.
  // The undo journal: the original of every file the person let the app change (sealed like the chats, not in a backup), and the applier, the one place that writes.
  const undoJournal = createJournal({
    pathOf: () => join(app.getPath('userData'), 'workspace', 'changes.jsonl'),
    box: secureStorage,
    writeMode: protection.writeMode,
    parse: parseUndoEntry,
    render: renderUndoEntry,
    version: UNDO_VERSION,
    maxLineChars: UNDO_LIMITS.maxLineChars,
    maxConformBytes: UNDO_LIMITS.maxBytes,
    name: 'the undo journal'
  })
  const applier = createApplier({
    guard: workspaceGuard,
    journal: undoJournal,
    gate: questions,
    record: (event) => auditLog.append(event)
  })
  const changes = createChangesService({
    store: proposals,
    state: fileStateOf(workspaceGuard),
    requestApply: (proposal, owner) => applier.apply(proposal, owner)
  })
  const reviewWindows = createReviewWindows({ service: changes })
  const workspaceService = createWorkspaceService({
    store: workspaceStore,
    toolSettings,
    gate: questions,
    pickFolder: pickWorkspaceFolder,
    dataGuard,
    guard: workspaceGuard,
    avoid: () => avoidPlaces(),
    onFolder: (folder) => {
      workspaceRoot = folder
    }
  })
  // What the page can do with the settings (D-041, 11.4): read them, and ask for a change. A tool switched ON and a higher cap ask in the system's message box.
  const toolsService = createToolSettingsService({
    store: toolSettings,
    registry: toolRegistry,
    gate: questions
  })
  // Running programs (D-043, 13.5): the box (a runner and a folder of runs that follows the workspace) and the service that owns the one switch: a self-test of the box
  // on this PC first, then the person's yes in the system's message box. The generic switches above cannot change it.
  const programBox = createProgramBox({
    workspaceRoot: () => workspaceRoot,
    tempDir: app.getPath('temp'),
    // For testing the whole path in the real window (tools/run135.mjs): FRONTIER_RUN_ROOT names the folder of runs, so that nothing is made at the root of a drive. It works only
    // when running from source, never in an installed app (the same rule as FRONTIER_API_BASE_URL, baseUrl.ts); a value that is not an ordinary absolute folder is ignored.
    fixedRunRoot: () => {
      const value = process.env['FRONTIER_RUN_ROOT']
      return value && !app.isPackaged ? value : null
    }
  })
  const programService = createProgramService({
    toolSettings,
    gate: questions,
    workspace: { status: () => workspaceService.status() },
    box: () => programBox.get(),
    dataDir: app.getPath('userData'),
    tempDir: app.getPath('temp'),
    homeDir: app.getPath('home')
  })
  // Connectors (D-045, 14.6): the person's list in connectors.json (kept like the tool settings; tokens sealed by the secure storage), a box of their own whose folder of runs
  // does not follow the workspace (a connector's data folder stays where it is: at the root of the drive of the user's folder, or in the system's temp folder), and the
  // service that owns every change. A connector starts only when it is needed, never at start-up, and only after the start-up sweep of the folders of runs.
  const connectorStore = createConnectorStore({
    pathOf: () => join(app.getPath('userData'), 'connectors.json'),
    box: secureStorage,
    writeMode: protection.writeMode
  })
  const connectorBox = createProgramBox({
    workspaceRoot: () => app.getPath('home'),
    tempDir: app.getPath('temp'),
    fixedRunRoot: () => {
      const value = process.env['FRONTIER_CONNECTOR_ROOT']
      return value && !app.isPackaged ? value : null
    }
  })
  const connectorService = createConnectorService({
    store: connectorStore,
    gate: questions,
    secrets: secureStorage,
    box: async () => {
      await programsSwept
      return connectorBox.get()
    },
    nodePath: () => resolveProgram('node', defaultPlaces()),
    workspaceRoot: () => workspaceRoot,
    pickProgram: pickConnectorProgram,
    // never the app's data folder or a folder that holds it, the user's folder or one that holds it, or the system's own folder
    forbidden: async (path) => {
      const verdict = await dataGuard
        .check({ path, base: null, op: 'list', recursive: true })
        .catch(() => ({ ok: false }))
      if (!verdict.ok) return true
      const real = path.toLowerCase().replace(/\\+$/, '')
      const places = avoidPlaces()
      if (
        places.holds.some((h) => h.toLowerCase().replace(/\\+$/, '') === real || isInside(path, h))
      )
        return true
      const systemRoot = process.env['SystemRoot']
      return (
        systemRoot !== undefined &&
        (isInside(systemRoot, path) || systemRoot.toLowerCase() === real)
      )
    },
    // the person's own browser, for a sign-in: an https address, or an address on this PC itself (the guard of oauthHttp.ts has already judged it)
    openBrowser: async (url) => {
      let local = false
      try {
        const u = new URL(url)
        local =
          u.protocol === 'http:' &&
          ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname) &&
          u.username === '' &&
          u.password === ''
      } catch {
        local = false
      }
      if (!isSafeExternalUrl(url) && !local) throw new Error('not an address the app opens')
      await shell.openExternal(url)
    },
    savedKeys,
    record: (event) => auditLog.append(event)
  })
  const encryption = createChatEncryptionService({
    store: history,
    protection,
    backups,
    asks: systemAskers,
    files: attachments,
    documents: keptDocuments([
      everyChat.file,
      memory.file,
      projects.file,
      auditLog.document,
      toolSettings.file,
      workspaceStore.file,
      undoJournal.document,
      connectorStore.file
    ]) // rewritten with the chats (D-039, D-041, D-045)
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
    // For the window that asked: a restore that would add projects or notes asks the person in the system's own box first (10.7, D-039).
    guardedForWindow((window, token: unknown): Promise<HistoryRestoreApplyResult> =>
      backups.restoreApply(token, window)
    )
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

  // The audit log (D-041). The page reads it and asks for the export and the deletion; deleting asks in the system's message box for the window that asked.
  ipcMain.handle(
    CHANNELS.auditRead,
    guarded(async (): Promise<AuditView> => audit.view())
  )
  ipcMain.handle(
    CHANNELS.auditExport,
    guardedForWindow(async (window): Promise<AuditExportResult> => {
      try {
        return await audit.exportAll(window)
      } catch (error) {
        console.error('Exporting the audit log failed:', reason(error))
        return { ok: false, error: 'The audit log could not be exported.' }
      }
    })
  )
  ipcMain.handle(
    CHANNELS.auditDeleteAll,
    guardedForWindow(async (window): Promise<AuditDeleteResult> => {
      try {
        return await audit.deleteAll(window)
      } catch (error) {
        console.error('Deleting the audit log failed:', reason(error))
        return { ok: false, error: 'The audit log could not be deleted.' }
      }
    })
  )

  // The code workspace (D-042, 12.3). The page reads the status and asks for a change; choosing a folder and switching the tools on ask in the system's box
  // for the window that asked, and the folder dialog is opened here, never by the page.
  ipcMain.handle(
    CHANNELS.workspaceStatus,
    guarded(async (): Promise<WorkspaceStatus> => {
      try {
        return await workspaceService.status()
      } catch (error) {
        console.error('Reading the workspace setting failed:', reason(error))
        throw new Error('Your workspace setting could not be read.')
      }
    })
  )
  ipcMain.handle(
    CHANNELS.workspaceChoose,
    guardedForWindow(async (window): Promise<WorkspaceChangeResult> => {
      try {
        return await workspaceService.choose(window)
      } catch (error) {
        console.error('Choosing the workspace failed:', reason(error))
        return { ok: false, error: 'The workspace could not be changed.' }
      }
    })
  )
  ipcMain.handle(
    CHANNELS.workspaceClear,
    guarded(async (): Promise<WorkspaceChangeResult> => {
      try {
        return await workspaceService.clear()
      } catch (error) {
        console.error('Clearing the workspace failed:', reason(error))
        return { ok: false, error: 'The workspace could not be changed.' }
      }
    })
  )
  ipcMain.handle(
    CHANNELS.workspaceSetOn,
    guardedForWindow(async (window, input: unknown): Promise<WorkspaceChangeResult> => {
      try {
        return await workspaceService.setOn(window, input)
      } catch (error) {
        console.error('Changing the workspace tools failed:', reason(error))
        return { ok: false, error: 'The workspace could not be changed.' }
      }
    })
  )
  // Running programs (D-043, 13.5). The page reads the status (with the last self-test) and asks for the switch to change; it never supplies a program or a path.
  // Switching on makes the self-test and then asks in the system's box for the window that asked; switching off does neither.
  ipcMain.handle(
    CHANNELS.programsStatus,
    guarded(async (): Promise<ProgramsStatus> => {
      try {
        return await programService.status()
      } catch (error) {
        console.error('Reading the setting for running programs failed:', reason(error))
        throw new Error('The setting for running programs could not be read.')
      }
    })
  )
  ipcMain.handle(
    CHANNELS.programsSetOn,
    guardedForWindow(async (window, input: unknown): Promise<ProgramsChangeResult> => {
      try {
        return await programService.setOn(window, input)
      } catch (error) {
        console.error('Changing the setting for running programs failed:', reason(error))
        return { ok: false, error: 'Running programs could not be changed.' }
      }
    })
  )
  ipcMain.handle(
    CHANNELS.programsStopTest,
    guarded(async (): Promise<void> => {
      programService.stopTest()
    })
  )
  // Connectors (D-045, 14.6). The page reads the list and asks; every change that lets the app do more is asked about in the system's box for the window that asked. The
  // page never supplies a program path (main opens the file dialog) and never sees a token again.
  ipcMain.handle(
    CHANNELS.connectorsStatus,
    guarded(async (): Promise<ConnectorsStatus> => {
      try {
        return await connectorService.status()
      } catch (error) {
        console.error('Reading the connectors failed:', reason(error))
        throw new Error('The connectors could not be read.')
      }
    })
  )
  const connectorChange =
    (
      work: (window: BrowserWindow | null, input: unknown) => Promise<ConnectorChangeResult>
    ): ((window: BrowserWindow | null, input: unknown) => Promise<ConnectorChangeResult>) =>
    async (window, input) => {
      try {
        return await work(window, input)
      } catch (error) {
        console.error('Changing a connector failed:', reason(error))
        return { ok: false, error: 'The connector could not be changed.' }
      }
    }
  ipcMain.handle(
    CHANNELS.connectorsAddLocal,
    guardedForWindow(connectorChange((w, i) => connectorService.addLocal(w, i)))
  )
  ipcMain.handle(
    CHANNELS.connectorsAddRemote,
    guardedForWindow(connectorChange((w, i) => connectorService.addRemote(w, i)))
  )
  ipcMain.handle(
    CHANNELS.connectorsRemove,
    guardedForWindow(connectorChange((w, i) => connectorService.remove(w, i)))
  )
  ipcMain.handle(
    CHANNELS.connectorsRefresh,
    guardedForWindow(connectorChange((_w, i) => connectorService.refresh(i)))
  )
  ipcMain.handle(
    CHANNELS.connectorsStop,
    guardedForWindow(connectorChange((_w, i) => connectorService.stop(i)))
  )
  ipcMain.handle(
    CHANNELS.connectorsSetTool,
    guardedForWindow(connectorChange((w, i) => connectorService.setTool(w, i)))
  )
  ipcMain.handle(
    CHANNELS.connectorsSetGrant,
    guardedForWindow(connectorChange((w, i) => connectorService.setGrant(w, i)))
  )
  ipcMain.handle(
    CHANNELS.connectorsSetPlace,
    guardedForWindow(connectorChange((w, i) => connectorService.setPlace(w, i)))
  )
  ipcMain.handle(
    CHANNELS.connectorsSignIn,
    guardedForWindow(connectorChange((w, i) => connectorService.signIn(w, i)))
  )
  ipcMain.handle(
    CHANNELS.connectorsCancelSignIn,
    guardedForWindow(connectorChange(() => connectorService.cancelSignIn()))
  )
  ipcMain.handle(
    CHANNELS.connectorsSignOut,
    guardedForWindow(connectorChange((_w, i) => connectorService.signOut(i)))
  )
  // The changes the model proposed (D-042, 12.5). The page reads a summary of each and asks main to open the Review window for one; it can do nothing else with them.
  ipcMain.handle(
    CHANNELS.changesList,
    guarded(async (): Promise<ChangeSummary[]> => changes.list())
  )
  ipcMain.handle(
    CHANNELS.changesReview,
    guardedForWindow(async (window, input: unknown): Promise<ChangeActionResult> => {
      try {
        const id =
          typeof input === 'object' && input !== null ? (input as { id?: unknown }).id : undefined
        return await reviewWindows.open(id, window)
      } catch (error) {
        console.error('Opening the Review window failed:', reason(error))
        return { ok: false, error: 'The Review window could not be opened.' }
      }
    })
  )
  // The applied changes (D-042, 12.6): the page lists them and may ask for an undo or for the history to be deleted; each of those asks in the system's own box for the
  // window that asked. The page has no way to apply a change.
  ipcMain.handle(
    CHANNELS.changesApplied,
    guarded(async (): Promise<AppliedChange[]> => {
      try {
        return await applier.applied()
      } catch (error) {
        console.error('Reading the applied changes failed:', reason(error))
        return []
      }
    })
  )
  ipcMain.handle(
    CHANNELS.changesUndo,
    guardedForWindow(async (window, input: unknown): Promise<ChangeActionResult> => {
      try {
        const id =
          typeof input === 'object' && input !== null ? (input as { id?: unknown }).id : undefined
        return await applier.undo(id, window)
      } catch (error) {
        console.error('Undoing a change failed:', reason(error))
        return { ok: false, error: 'The change could not be undone.' }
      }
    })
  )
  ipcMain.handle(
    CHANNELS.changesClearUndo,
    guardedForWindow(async (window): Promise<ChangeActionResult> => {
      try {
        return await applier.clearHistory(window)
      } catch (error) {
        console.error('Deleting the undo history failed:', reason(error))
        return { ok: false, error: 'The undo history could not be deleted.' }
      }
    })
  )
  // The tools (D-041, 11.4). The page reads which are on and the caps, and asks for a change; a tool switched on and a higher cap ask in the system's
  // message box for the window that asked. The page has no way to run a tool or to answer a question.
  ipcMain.handle(
    CHANNELS.toolsStatus,
    guarded(async (): Promise<ToolsStatus> => {
      try {
        return await toolsService.status()
      } catch (error) {
        console.error('Reading the tool settings failed:', reason(error))
        throw new Error('Your tool settings could not be read.')
      }
    })
  )
  ipcMain.handle(
    CHANNELS.toolsSetEnabled,
    guardedForWindow(async (window, input: unknown): Promise<ToolChangeResult> => {
      try {
        return await toolsService.setEnabled(window, input)
      } catch (error) {
        console.error('Changing a tool setting failed:', reason(error))
        return { ok: false, error: 'The tool settings could not be changed.' }
      }
    })
  )
  ipcMain.handle(
    CHANNELS.toolsSetCaps,
    guardedForWindow(async (window, input: unknown): Promise<ToolChangeResult> => {
      try {
        return await toolsService.setCaps(window, input)
      } catch (error) {
        console.error('Changing the tool limits failed:', reason(error))
        return { ok: false, error: 'The tool settings could not be changed.' }
      }
    })
  )
  ipcMain.handle(
    CHANNELS.toolsReset,
    guarded(async (): Promise<ToolChangeResult> => {
      try {
        return await toolsService.reset()
      } catch (error) {
        console.error('Starting the tool settings again failed:', reason(error))
        return { ok: false, error: 'The tool settings could not be changed.' }
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

  // The tools of a reply (D-041): the one tool of the build, the one place that decides what becomes of a call, the block that keeps every tool out of the
  // data folder, the audit log behind every question and run, and the app's one gate for questions in the system's box.
  // At start, what a crash left behind in the folders of runs goes (scratch copies, spec files, drive letters), and so do the files of a self-test that was cut off;
  // only then is a self-test made again if the switch for running programs is on (it is the test of THIS session that opens the box, never the file alone).
  const programsSwept = workspaceService
    .refresh() // the folder of the workspace is read first: its drive has a folder of runs too
    .then(() => programBox.sweep())
    .then(() => connectorBox.sweep())
    .then(() => sweepSelfTest([app.getPath('userData'), app.getPath('temp')]))
    .then(() => undefined)
    .catch((error: unknown) => console.error('Clearing up after programs failed:', reason(error)))
  void programsSwept.then(() => programService.startUp())
  // The keys saved in the app and the tokens of the connectors: neither may leave in a tool call, and a result that holds one is not passed on. (A token is checked the
  // way a key is: whole, without its white space, or a long enough piece of it.)
  const savedKeysAndTokens = async (): Promise<SavedKey[]> => [
    ...(await savedKeys()),
    ...(await connectorService.tokens()).map((key) => ({ provider: 'anthropic' as const, key }))
  ]
  const toolRuntime = createToolRuntime({
    tools: toolRegistry,
    gate: questions,
    guard: dataGuard,
    workspace: { guard: workspaceGuard, proposals },
    // The run tool: the box as it is for the workspace now, the saved keys (a file that holds one is not copied, output that holds one is not passed on), and whether
    // a run can be made at all (switched on, and the self-test of this session passed).
    programs: {
      box: () => programBox.get(),
      savedKeys,
      holdsSavedKey: async (text) => heldKey(text, await savedKeysAndTokens()) !== null,
      available: async () => {
        await programsSwept
        return programService.available()
      }
    },
    record: (event) => auditLog.append(event),
    holdsSavedKey: async (text) => heldKey(text, await savedKeysAndTokens()) !== null
  })
  registerChatIpc(appUrl, {
    ledger,
    limitsStore,
    askFirstStore,
    readAttachment: (id) => attachments.read(id),
    everyChat: () => everyChat.forRequest(),
    savedKeys,
    notes: (projectId) => memory.forRequest(projectId),
    project: (id) => projects.forRequest(id),
    tools: {
      // Read before every request of a reply: the workspace tools are offered only while a folder is chosen, and the guard works from the folder as it is now. The
      // run tool is offered only while it is on AND a self-test of this session passed AND a folder is chosen (withPrograms).
      settings: async () => {
        const folder = await workspaceService.refresh()
        const withFiles = withWorkspace((await toolSettings.read()).settings, folder !== null)
        await programsSwept
        const settings = withPrograms(
          withFiles,
          folder !== null && (await programService.available())
        )
        return withConnectorTools(settings, await connectorService.onIds().catch(() => []))
      },
      runtime: toolRuntime,
      // the tools of the connectors that are switched on (D-045): their definitions as the person read them, and how each is run
      connectors: () => connectorService.forReply()
    }
  })
  // The lock the encryption flows run in is the backup service's, so waiting for it waits for them too. The app is closing when this is asked: a program that is still
  // running in the box is ended first (13.5), and what its copy left is swept at the next start.
  return () => {
    connectorService.stopAll()
    connectorBox.stopAll()
    programBox.stopAll()
    return Promise.all([
      history.whenIdle(),
      ledger.whenIdle(),
      backups.whenIdle(),
      attachments.whenIdle(),
      everyChat.file.whenIdle(),
      memory.file.whenIdle(),
      projects.file.whenIdle(),
      auditLog.whenIdle(),
      toolSettings.file.whenIdle(),
      workspaceStore.file.whenIdle(),
      undoJournal.whenIdle(),
      connectorStore.file.whenIdle()
    ]).then(() => undefined)
  }
}

/** The settings with the connector tools that are switched on (D-045): each is its own yes, kept in connectors.json, never in tools.json. */
function withConnectorTools(settings: ToolSettings, ids: readonly string[]): ToolSettings {
  if (ids.length === 0) return settings
  const enabled: Record<string, boolean> = { ...settings.enabled }
  for (const id of ids) if (id.includes('__')) enabled[id] = true
  return { enabled, caps: settings.caps }
}
