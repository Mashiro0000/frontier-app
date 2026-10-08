// Tool calling, the part that main and (from 11.4) the window share (Stage 11, D-041): what one reply may use of tools, the settings that switch a tool on,
// and the events that the audit log keeps (11.2). Plain types and constants; nothing here decides anything. The one place that decides is main's
// toolCore.ts. No Electron imports.

/**
 * What one reply may use of tools (the plan's pick 3). Both are the person's to change in Settings (11.4), within TOOL_CAPS_BOUNDS, and both stop the
 * reply when reached.
 */
export interface ToolCaps {
  /** The most tool calls one reply may make, whatever becomes of them (a refused call counts). */
  steps: number
  /** The most working seconds one reply may take. The time the person spends deciding in the approval box is not working time. */
  seconds: number
}

export const TOOL_CAPS_DEFAULT: Readonly<ToolCaps> = Object.freeze({ steps: 5, seconds: 60 })

/** The room Settings gives the person for the two caps (and what main falls back from when a saved value is outside it). */
export const TOOL_CAPS_BOUNDS = Object.freeze({
  steps: Object.freeze({ min: 1, max: 20 }),
  seconds: Object.freeze({ min: 10, max: 600 })
})

/**
 * Which tools are switched on, and the caps. DENY BY DEFAULT: a tool that is not listed, or listed with anything but `true`, is off, and so is every
 * tool in the default settings. Switching one on is a change that lets the app do more, so it will be saved only after the person's yes in the system's
 * box (11.4, as for a higher limit in 10.1).
 */
export interface ToolSettings {
  readonly enabled: Readonly<Record<string, boolean>>
  readonly caps: Readonly<ToolCaps>
}

export const DEFAULT_TOOL_SETTINGS: ToolSettings = Object.freeze({
  enabled: Object.freeze({}),
  caps: TOOL_CAPS_DEFAULT
})

/** Whether a tool is switched on: only the exact value `true`, and only as a key of its own (a tool called "constructor" is not on because every object has one). */
export const toolIsOn = (settings: ToolSettings, id: string): boolean =>
  Object.prototype.hasOwnProperty.call(settings.enabled, id) && settings.enabled[id] === true

/** Why the app said no to a tool call without asking the person anything. */
export type RefusalCode =
  | 'unknown-tool' //   no such tool
  | 'tool-off' //       the tool is switched off (every tool starts off)
  | 'bad-arguments' //  the arguments are not exactly the ones the tool takes
  | 'secret' //         an argument holds one of the API keys saved in the app
  | 'data-folder' //    a path lies in the app's data folder (or is a folder that holds it)
  | 'bad-path' //       a path that cannot be told apart from one in the data folder, or is not one a tool may use
  | 'step-cap' //       the reply has used its steps
  | 'time-cap' //       the reply has used its working time
  | 'stopped' //        the person pressed Stop everything
  | 'not-recorded' //   the audit record could not be kept, and nothing runs that is not recorded first
  | 'no-runner' //      this build has no way to run the tool
  | 'internal' //       the app itself failed while deciding; nothing was run

/** What came of the question in the system's box. `stopped`: Stop everything came while it was open. */
export type AnswerCode = 'yes' | 'no' | 'busy' | 'resting' | 'failed' | 'stopped'

/** The arguments of a call as the person was shown them: exactly what the tool is given, with every path as the real one. */
export type ShownArguments = Readonly<Record<string, string | number>>

/**
 * What the audit log keeps (11.2), one event for each thing that happens to a call. Never any page text: what was asked, whether it was allowed, how big
 * the result was and how many sources came back. `tool` is a tool's id, or `(unknown)` when what the model named is not even shaped like an id (its words
 * are never kept).
 */
export type ToolEvent =
  | { type: 'refused'; at: number; tool: string; step: number; code: RefusalCode }
  | {
      type: 'asked'
      at: number
      tool: string
      step: number
      args: ShownArguments
      why: string
    }
  | { type: 'answered'; at: number; tool: string; step: number; answer: AnswerCode }
  | { type: 'ran'; at: number; tool: string; step: number }
  | {
      type: 'result'
      at: number
      tool: string
      step: number
      ok: boolean
      /** The characters of the result text that were passed on. */
      size: number
      /** How many sources came back (their titles and addresses are not kept here). */
      sources: number
    }
