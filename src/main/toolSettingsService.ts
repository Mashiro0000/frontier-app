import {
  TOOL_CAPS_BOUNDS,
  TOOL_CAPS_DEFAULT,
  toolIsOn,
  type ToolCaps,
  type ToolChangeResult,
  type ToolInfo,
  type ToolSettings,
  type ToolsStatus
} from '../shared/tools'
import { KeptRefused } from './keptFile'
import {
  QUESTION_BUSY,
  QUESTION_FAILED,
  QUESTION_RESTING,
  type QuestionGate,
  type SystemQuestion
} from './systemQuestion'
import { ASKED_HERE } from './toolQuestion'
import type { ToolDefinition, ToolRegistry } from './toolRegistry'
import type { ToolSettingsStore } from './toolSettings'

// What the person can do with the tool settings (Stage 11.4, D-041): see which tools are on and the caps on one reply, switch a tool on or off, change the caps.
// The settings file is toolSettings.ts; this decides what may change and asks. The rule is the one of 10.1: a change that lets the app do MORE (a tool on, a
// higher cap) is made only after the person's yes in the system's own message box, which the page cannot answer, so a page that had been taken over cannot
// switch a tool on; a change that does LESS (a tool off, lower caps) is made at once. A file that cannot be read means every tool is off, nothing can be
// switched on, and the person can start again (the file is kept as a copy beside it). Main alone; the page gets `status()` and the three changes. No Electron
// imports.

export const TOOL_NOT_ON = 'The tool is still off.'
export const CAPS_NOT_RAISED = 'The limits are as they were.'
const NOT_UNDERSTOOD = 'That change was not understood.'
const BUSY = 'The tool settings are still being changed.'
const NO_TOOL = 'That tool does not exist in this version of the app.'
const NOTHING_TO_RESET = 'The tool settings can be read, so there is nothing to start again.'

const changeRefused = (why: string): string =>
  `Nothing was changed: your tool settings could not be read (${why}). Every tool is off. Start again on the Tools page; the app keeps a copy of the file.`

/** The question before a tool is switched on. */
export function toolOnQuestion(def: ToolDefinition, caps: ToolCaps): SystemQuestion {
  return {
    title: def.title,
    message: `Let the model ask to use "${def.title}"?`,
    detail: [
      `Turning this on lets the model ask for this while it answers you: ${def.title}.`,
      '',
      def.effect,
      '',
      'Nothing runs without you. Every time the model asks, the call is shown to you in full in a window like this one, and it runs only if you say yes there.',
      `One reply may take at most ${caps.steps} ${caps.steps === 1 ? 'tool step' : 'tool steps'} and ${caps.seconds} seconds of working time.`,
      '',
      'You can turn it off again on the Tools page, and "Stop everything" ends a reply that is using it.',
      '',
      ASKED_HERE
    ].join('\n'),
    yes: 'Turn on',
    no: "Don't turn on"
  }
}

/** The question before a cap is raised: what changes, line by line. */
export function capsQuestion(from: ToolCaps, to: ToolCaps): SystemQuestion {
  const lines = ['One reply may use at most:']
  if (to.steps !== from.steps) lines.push(`  Tool steps: ${from.steps} -> ${to.steps}`)
  if (to.seconds !== from.seconds)
    lines.push(`  Seconds of working time: ${from.seconds} -> ${to.seconds}`)
  return {
    title: 'Tool limits',
    message: 'Let a reply use more tools?',
    detail: [
      ...lines,
      '',
      'A higher limit lets one reply use more tools, and a tool can cost money (a web search is billed by your AI provider). A reply stops when it reaches either limit.',
      '',
      ASKED_HERE
    ].join('\n'),
    yes: 'Raise the limits',
    no: "Don't raise"
  }
}

export interface ToolSettingsService {
  status(): Promise<ToolsStatus>
  /** `{ tool, on }` from the page. ON asks in the system's box (for `owner`, the window that asked); OFF does not. */
  setEnabled(owner: unknown, input: unknown): Promise<ToolChangeResult>
  /** `{ steps, seconds }` from the page. A higher value asks in the system's box; lower ones do not. */
  setCaps(owner: unknown, input: unknown): Promise<ToolChangeResult>
  /** Starts again when the file could not be read: every tool off, the caps at their defaults, the old file kept as a copy. */
  reset(): Promise<ToolChangeResult>
}

export interface ToolSettingsServiceOptions {
  store: ToolSettingsStore
  registry: ToolRegistry
  gate: QuestionGate
}

const reason = (error: unknown): unknown => (error instanceof Error ? error.message : error)
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export function createToolSettingsService(
  options: ToolSettingsServiceOptions
): ToolSettingsService {
  const { store, registry, gate } = options
  let changing = false

  /** One change at a time: a second while one is being asked about or written is refused at once. */
  async function oneAtATime(task: () => Promise<ToolChangeResult>): Promise<ToolChangeResult> {
    if (changing) return { ok: false, error: BUSY }
    changing = true
    try {
      return await task()
    } finally {
      changing = false
    }
  }

  const infoOf = (settings: ToolSettings): ToolInfo[] =>
    registry.ids().flatMap((id): ToolInfo[] => {
      const def = registry.get(id)
      return def === undefined
        ? []
        : [{ id, title: def.title, about: def.effect, on: toolIsOn(settings, id) }]
    })

  async function status(): Promise<ToolsStatus> {
    const { settings, problem } = await store.read()
    return { tools: infoOf(settings), caps: { ...settings.caps }, problem }
  }

  async function write(settings: ToolSettings, replace = false): Promise<ToolChangeResult> {
    try {
      await store.write(settings, { replace })
    } catch (error) {
      if (error instanceof KeptRefused) return { ok: false, error: error.message }
      console.error('Saving the tool settings failed:', reason(error))
      return { ok: false, error: 'Your tool settings could not be saved on this computer.' }
    }
    return { ok: true, status: await status() }
  }

  /** Asks in the system's box; null for a yes, or what to answer the page. */
  async function ask(
    owner: unknown,
    question: SystemQuestion,
    notChanged: string
  ): Promise<ToolChangeResult | null> {
    const answer = await gate.ask(owner, question)
    if (answer === 'yes') return null
    if (answer === 'busy') return { ok: false, error: QUESTION_BUSY }
    if (answer === 'resting') return { ok: false, error: QUESTION_RESTING }
    if (answer === 'failed') return { ok: false, error: QUESTION_FAILED }
    return { ok: false, cancelled: true, error: notChanged }
  }

  const defaults = (): ToolSettings => ({ enabled: {}, caps: { ...TOOL_CAPS_DEFAULT } })

  return {
    status,

    setEnabled: (owner, input) => {
      if (!isRecord(input) || typeof input.tool !== 'string' || typeof input.on !== 'boolean') {
        return Promise.resolve({ ok: false, error: NOT_UNDERSTOOD })
      }
      const { tool, on } = input as { tool: string; on: boolean }
      const def = registry.get(tool)
      if (def === undefined) return Promise.resolve({ ok: false, error: NO_TOOL })
      return oneAtATime(async () => {
        const current = await store.read()
        if (!on) {
          // Off does less: no question. A file that cannot be read is kept as a copy, and the settings start again, every tool off.
          if (current.problem !== null) return write(defaults(), true)
          if (!toolIsOn(current.settings, tool)) return { ok: true, status: await status() }
          return write({
            enabled: { ...current.settings.enabled, [tool]: false },
            caps: { ...current.settings.caps }
          })
        }
        if (current.problem !== null) return { ok: false, error: changeRefused(current.problem) }
        if (toolIsOn(current.settings, tool)) return { ok: true, status: await status() }
        const no = await ask(owner, toolOnQuestion(def, current.settings.caps), TOOL_NOT_ON)
        if (no !== null) return no
        // Read again after the wait: what is written is the file as it is now, with this one tool switched on.
        const fresh = await store.read()
        if (fresh.problem !== null) return { ok: false, error: changeRefused(fresh.problem) }
        return write({
          enabled: { ...fresh.settings.enabled, [tool]: true },
          caps: { ...fresh.settings.caps }
        })
      })
    },

    setCaps: (owner, input) => {
      const steps = isRecord(input) ? input.steps : undefined
      const seconds = isRecord(input) ? input.seconds : undefined
      const { steps: s, seconds: t } = TOOL_CAPS_BOUNDS
      if (
        typeof steps !== 'number' ||
        typeof seconds !== 'number' ||
        !Number.isInteger(steps) ||
        !Number.isInteger(seconds) ||
        steps < s.min ||
        steps > s.max ||
        seconds < t.min ||
        seconds > t.max
      ) {
        return Promise.resolve({
          ok: false,
          error: `The limits must be whole numbers: ${s.min} to ${s.max} steps and ${t.min} to ${t.max} seconds.`
        })
      }
      const next: ToolCaps = { steps, seconds }
      return oneAtATime(async () => {
        const current = await store.read()
        if (current.problem !== null) return { ok: false, error: changeRefused(current.problem) }
        const from = current.settings.caps
        if (from.steps === next.steps && from.seconds === next.seconds) {
          return { ok: true, status: await status() }
        }
        // A lower limit does less: no question. A higher one (either of the two) lets a reply use more.
        if (next.steps > from.steps || next.seconds > from.seconds) {
          const no = await ask(owner, capsQuestion(from, next), CAPS_NOT_RAISED)
          if (no !== null) return no
        }
        const fresh = await store.read()
        if (fresh.problem !== null) return { ok: false, error: changeRefused(fresh.problem) }
        return write({ enabled: { ...fresh.settings.enabled }, caps: next })
      })
    },

    reset: () =>
      oneAtATime(async () => {
        const current = await store.read()
        if (current.problem === null) return { ok: false, error: NOTHING_TO_RESET }
        return write(defaults(), true)
      })
  }
}
