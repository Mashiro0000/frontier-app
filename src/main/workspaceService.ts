import type { ToolSettings } from '../shared/tools'
import type { WorkspaceChangeResult, WorkspaceStatus } from '../shared/workspace'
import type { DataFolderGuard } from './dataFolderGuard'
import { KeptRefused } from './keptFile'
import {
  QUESTION_BUSY,
  QUESTION_FAILED,
  QUESTION_RESTING,
  type QuestionGate,
  type SystemQuestion
} from './systemQuestion'
import { ASKED_HERE, shown } from './toolQuestion'
import type { ToolSettingsStore } from './toolSettings'
import { WORKSPACE_TOOL_IDS } from './workspaceTools'
import { checkWorkspaceFolder, type AvoidPlaces, type WorkspaceStore } from './workspace'
import type { WorkspaceGuard } from './workspaceGuard'

// What the person can do with the code workspace (Stage 12.3, D-042): see the chosen folder, choose one, clear it, and switch the "Code workspace" tools on and
// off. The rule is the one of 10.1 and 11.4: a change that lets the app do MORE (a folder chosen, the tools on) is made only after the person's yes in the
// system's own message box, which the page cannot answer; a change that does LESS (the folder cleared, the tools off) is made at once. The page never supplies
// a path: main opens the system's folder dialog itself and judges the answer (workspace.ts). No Electron imports: the dialog is handed in.

export const WORKSPACE_NOT_CHOSEN = 'No folder was chosen.'
export const WORKSPACE_NOT_ON = 'The workspace tools are still off.'
export const WORKSPACE_NOT_SET = 'The workspace is as it was.'
const BUSY = 'The workspace is still being changed.'
const NOT_UNDERSTOOD = 'That change was not understood.'
const NO_FOLDER = 'Choose a folder first.'

/** The question before a folder is kept as the workspace. */
export function chooseQuestion(folder: string, toolsOn: boolean): SystemQuestion {
  return {
    title: 'Code workspace',
    message: 'Use this folder as your code workspace?',
    detail: [
      `Folder: ${shown(folder)}`,
      '',
      toolsOn
        ? 'The workspace tools are switched ON: the model will be able to ask to list and read files in this folder and to propose changes to them.'
        : 'The model can use this folder only after you switch the workspace tools on (a second question), and then only after you say yes for each reply.',
      'Nothing is ever written to the folder without your separate approval of each change.',
      'Names that begin with a dot, names that look like they hold secrets, version-control folders and links are treated with extra care (or never reached).',
      '',
      'You can choose another folder or clear this one at any time.',
      '',
      ASKED_HERE
    ].join('\n'),
    yes: 'Use this folder',
    no: "Don't use it"
  }
}

/** The question before the workspace tools are switched on. */
export function workspaceOnQuestion(folder: string): SystemQuestion {
  return {
    title: 'Code workspace',
    message: 'Let the model ask to use your workspace?',
    detail: [
      `Turning this on lets the model ask, while it answers you, to list and read files in: ${shown(folder)}`,
      '',
      'Nothing runs without you. The first time a reply wants your files you are asked in a window like this one, and your yes covers that one reply only. Hidden files and files that look like they hold secrets are asked about one at a time.',
      'What the model reads is sent to your AI provider as part of the conversation, and it costs tokens like any other text.',
      '',
      'You can turn it off again on the Tools page, and "Stop everything" ends a reply that is using it.',
      '',
      ASKED_HERE
    ].join('\n'),
    yes: 'Turn on',
    no: "Don't turn on"
  }
}

/** The tool settings as a reply sees them: the workspace tools are on only while a folder is chosen (without one every call would be refused). */
export function withWorkspace(settings: ToolSettings, hasFolder: boolean): ToolSettings {
  if (hasFolder) return settings
  const enabled = { ...settings.enabled }
  for (const id of WORKSPACE_TOOL_IDS) delete enabled[id]
  return { enabled, caps: settings.caps }
}

export interface WorkspaceServiceOptions {
  store: WorkspaceStore
  toolSettings: ToolSettingsStore
  gate: QuestionGate
  /** The system's folder dialog (Electron's; played by the checks): the folder the person chose, or null when they closed it. */
  pickFolder: (owner: unknown) => Promise<string | null>
  dataGuard: DataFolderGuard
  avoid: () => AvoidPlaces
  guard: WorkspaceGuard
  /** Told the chosen folder (or null) every time the file is read, for the guard, which asks synchronously. */
  onFolder: (folder: string | null) => void
  now?: () => number
}

export interface WorkspaceService {
  status(): Promise<WorkspaceStatus>
  choose(owner: unknown): Promise<WorkspaceChangeResult>
  clear(): Promise<WorkspaceChangeResult>
  /** `{ on }` from the page. ON asks in the system's box (for `owner`); OFF does not. */
  setOn(owner: unknown, input: unknown): Promise<WorkspaceChangeResult>
  /** Reads the file again: called before every request of a reply, so the guard never works from a folder that was changed or cleared meanwhile. */
  refresh(): Promise<string | null>
}

const reason = (error: unknown): unknown => (error instanceof Error ? error.message : error)
const isOn = (settings: ToolSettings): boolean =>
  WORKSPACE_TOOL_IDS.every((id) => settings.enabled[id] === true)

export function createWorkspaceService(options: WorkspaceServiceOptions): WorkspaceService {
  const { store, gate } = options
  const now = options.now ?? Date.now
  let changing = false

  async function oneAtATime(
    task: () => Promise<WorkspaceChangeResult>
  ): Promise<WorkspaceChangeResult> {
    if (changing) return { ok: false, error: BUSY }
    changing = true
    try {
      return await task()
    } finally {
      changing = false
    }
  }

  const seen = (folder: string | null): string | null => {
    options.onFolder(folder)
    return folder
  }

  async function status(): Promise<WorkspaceStatus> {
    const { record, problem } = await store.read()
    seen(record?.folder ?? null)
    const tools = await options.toolSettings.read()
    let unusable: string | null = null
    let name: string | null = null
    if (record !== null) {
      const root = await options.guard.root()
      if (root.ok) name = root.name
      else {
        unusable = root.why
        name =
          record.folder
            .split(/[\\/]/)
            .filter((part) => part !== '')
            .pop() ?? null
      }
    }
    return {
      folder: record?.folder ?? null,
      name,
      on: tools.problem === null && isOn(tools.settings),
      problem,
      unusable
    }
  }

  /** Asks in the system's box; null for a yes, or what to answer the page. */
  async function ask(
    owner: unknown,
    question: SystemQuestion,
    notChanged: string
  ): Promise<WorkspaceChangeResult | null> {
    const answer = await gate.ask(owner, question)
    if (answer === 'yes') return null
    if (answer === 'busy') return { ok: false, error: QUESTION_BUSY }
    if (answer === 'resting') return { ok: false, error: QUESTION_RESTING }
    if (answer === 'failed') return { ok: false, error: QUESTION_FAILED }
    return { ok: false, cancelled: true, error: notChanged }
  }

  const saveFailed = (error: unknown): WorkspaceChangeResult => {
    if (error instanceof KeptRefused) return { ok: false, error: error.message }
    console.error('Saving the workspace setting failed:', reason(error))
    return { ok: false, error: 'Your workspace setting could not be saved on this computer.' }
  }

  return {
    refresh: async () => seen((await store.read()).record?.folder ?? null),
    status,

    choose: (owner) =>
      oneAtATime(async () => {
        const before = await store.read()
        const picked = await options.pickFolder(owner)
        if (picked === null) return { ok: false, cancelled: true, error: WORKSPACE_NOT_CHOSEN }
        const checked = await checkWorkspaceFolder(picked, {
          dataGuard: options.dataGuard,
          avoid: options.avoid()
        })
        if (!checked.ok) return { ok: false, error: checked.why }
        const tools = await options.toolSettings.read()
        const no = await ask(
          owner,
          chooseQuestion(checked.folder, tools.problem === null && isOn(tools.settings)),
          WORKSPACE_NOT_SET
        )
        if (no !== null) return no
        try {
          // A setting that could not be read is kept as a copy and started again: the person has just chosen a folder, which is what they want now.
          await store.write(
            { folder: checked.folder, chosenAt: now() },
            { replace: before.problem !== null }
          )
        } catch (error) {
          return saveFailed(error)
        }
        return { ok: true, status: await status() }
      }),

    clear: () =>
      oneAtATime(async () => {
        try {
          await store.clear({ replace: true })
        } catch (error) {
          return saveFailed(error)
        }
        return { ok: true, status: await status() }
      }),

    setOn: (owner, input) => {
      const on =
        typeof input === 'object' && input !== null ? (input as { on?: unknown }).on : undefined
      if (typeof on !== 'boolean') return Promise.resolve({ ok: false, error: NOT_UNDERSTOOD })
      return oneAtATime(async () => {
        const tools = await options.toolSettings.read()
        const write = async (
          enabled: boolean,
          replace: boolean
        ): Promise<WorkspaceChangeResult> => {
          const settings = replace ? { enabled: {}, caps: tools.settings.caps } : tools.settings
          const next = { ...settings.enabled }
          for (const id of WORKSPACE_TOOL_IDS) next[id] = enabled
          try {
            await options.toolSettings.write(
              { enabled: next, caps: { ...settings.caps } },
              { replace }
            )
          } catch (error) {
            return saveFailed(error)
          }
          return { ok: true, status: await status() }
        }
        if (!on) {
          // Off does less: no question. A tool file that cannot be read is kept as a copy and started again with every tool off.
          if (tools.problem !== null) return write(false, true)
          if (
            !isOn(tools.settings) &&
            WORKSPACE_TOOL_IDS.every((id) => !tools.settings.enabled[id])
          ) {
            return { ok: true, status: await status() }
          }
          return write(false, false)
        }
        if (tools.problem !== null) {
          return {
            ok: false,
            error: `Nothing was changed: your tool settings could not be read (${tools.problem}). Every tool is off. Start again on the Tools page.`
          }
        }
        const { record, problem } = await store.read()
        if (record === null) {
          return {
            ok: false,
            error:
              problem === null
                ? NO_FOLDER
                : 'Your workspace setting could not be read, so no folder is chosen.'
          }
        }
        if (isOn(tools.settings)) return { ok: true, status: await status() }
        const no = await ask(owner, workspaceOnQuestion(record.folder), WORKSPACE_NOT_ON)
        if (no !== null) return no
        // Read again after the wait: what is written is the file as it is now, with the two tools switched on.
        const fresh = await options.toolSettings.read()
        if (fresh.problem !== null) {
          return {
            ok: false,
            error: `Nothing was changed: your tool settings could not be read (${fresh.problem}).`
          }
        }
        const next = { ...fresh.settings.enabled }
        for (const id of WORKSPACE_TOOL_IDS) next[id] = true
        try {
          await options.toolSettings.write({ enabled: next, caps: { ...fresh.settings.caps } })
        } catch (error) {
          return saveFailed(error)
        }
        return { ok: true, status: await status() }
      })
    }
  }
}
