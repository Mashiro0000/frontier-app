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
export const REFUSAL_CODES = [
  'unknown-tool', //   no such tool
  'tool-off', //       the tool is switched off (every tool starts off)
  'bad-arguments', //  the arguments are not exactly the ones the tool takes
  'secret', //         an argument holds one of the API keys saved in the app
  'data-folder', //    a path lies in the app's data folder (or is a folder that holds it)
  'bad-path', //       a path that cannot be told apart from one in the data folder, or is not one a tool may use
  'step-cap', //       the reply has used its steps
  'time-cap', //       the reply has used its working time
  'stopped', //        the person pressed Stop everything
  'not-recorded', //   the audit record could not be kept, and nothing runs that is not recorded first
  'no-runner', //      this build has no way to run the tool
  'limit', //          a spending limit the person set would be passed by the call, so nobody was asked (11.6)
  'internal', //       the app itself failed while deciding; nothing was run
  'no-workspace', //   no workspace folder is chosen, or it cannot be used now (12.2)
  'outside', //        a path leaves the workspace (12.2)
  'link', //           a link or junction is on the way (12.2)
  'never', //          a place that is never reached: version-control internals and the like (12.2)
  'wrong-path', //     the path is not there, or is not the kind of thing the call needs (12.2)
  'file-cap', //       the reply has used all its file calls (12.2)
  'chars-cap', //      the reply has read all the file text it may (12.2)
  'grant-declined', // the person said no to file access for this reply, so nobody was asked again (12.2)
  'no-program', //     the program is not one a run may use: not found, not a program, or a shell or script host (13.4)
  'no-box', //         this PC cannot make the box just now, so nothing was asked or run (13.4)
  'run-cap', //        the reply has used all its runs (13.4)
  'run-time-cap', //   the reply has used all the run time it may (13.4)
  'run-declined', //   the person said no to a run in this reply, so nobody was asked again (13.4)
  'copy-refused', //   the folder to copy is bigger than a run may copy, or cannot be copied (13.4)
  'connector-declined' // the person said no to this connector in this reply, so nobody was asked again (14)
] as const
export type RefusalCode = (typeof REFUSAL_CODES)[number]

/** How a run ended, in one word (the audit log keeps it, 13.4): the program finished; the clock ended it; the scratch folder grew past its cap; it never ran. */
export const PROGRAM_ENDS = ['exited', 'timed-out', 'disk-full', 'not-run'] as const
export type ProgramEnd = (typeof PROGRAM_ENDS)[number]

/**
 * What happened to a connector (14, D-045), for the audit log: added or removed, started or stopped (or failed), a tool switched on or off or changed by the connector since it
 * was switched on, and each grant given or taken back. The tool events carry the tool's id; the rest carry `(connector)`.
 */
export const CONNECTOR_EVENTS = [
  'added',
  'removed',
  'started',
  'stopped',
  'failed',
  'tool-on',
  'tool-off',
  'tool-changed',
  'network-on',
  'network-off',
  'folder-on',
  'folder-off',
  'as-you-on',
  'as-you-off',
  // Stage 14b: the sign-in of a web connector (no word of the provider's is ever kept, only that it happened)
  'signed-in',
  'signed-out',
  'sign-in-failed',
  'sign-in-needed'
] as const
export type ConnectorEvent = (typeof CONNECTOR_EVENTS)[number]

/** The `tool` of a connector event that is about the connector as a whole. */
export const CONNECTOR_TOOL = '(connector)'

/** What came of the question in the system's box. `stopped`: Stop everything came while it was open. */
export const ANSWER_CODES = [
  'yes',
  'no',
  'busy',
  'resting',
  'failed',
  'stopped',
  /** The person's yes for this reply's file access (12.2) covered the call: nobody was asked about this call itself. It runs like a yes. */
  'covered'
] as const
export type AnswerCode = (typeof ANSWER_CODES)[number]

/** What the person calls each tool that exists (the registry's titles; a suite checks they agree), so that the audit log can be read without the registry. */
export const TOOL_TITLES: Readonly<Record<string, string>> = Object.freeze({
  web_search: 'Search the web',
  list_files: 'List files in the workspace',
  read_file: 'Read a file in the workspace',
  propose_edit: 'Propose a change to a file in the workspace',
  propose_new_file: 'Propose a new file in the workspace',
  apply_change: 'Write a change to the workspace',
  undo_change: 'Undo a change in the workspace',
  undo_clear: 'Delete the undo history',
  run_program: 'Run a program on a copy of the workspace'
})

/**
 * What to call a tool in a sentence: its title; for a connector's tool (`notes__search`, 14) its own name and the connector's prefix; for an event about a connector,
 * "A connector"; or its id for a tool this version does not know (an entry of the log from another version).
 */
export const toolTitle = (id: string): string => {
  if (Object.prototype.hasOwnProperty.call(TOOL_TITLES, id)) return TOOL_TITLES[id]
  if (id === CONNECTOR_TOOL) return 'A connector'
  const at = id.indexOf('__')
  return at > 0 ? `${id.slice(at + 2)} (connector ${id.slice(0, at)})` : id
}

/** The arguments of a call as the person was shown them: exactly what the tool is given, with every path as the real one. */
export type ShownArguments = Readonly<Record<string, string | number>>

/** What of a tool's result is passed on (toolCore.ts) and what the audit log may therefore hold of it (auditLog.ts). */
export const TOOL_RESULT_LIMITS = Object.freeze({
  /** The most characters of a result passed on; a bigger one is cut. */
  maxChars: 60_000,
  /** The most sources of one result. */
  maxSources: 20,
  /** A source's title is one visible line of at most this many characters. */
  maxTitleChars: 200,
  /** A source's address, a plain https one, is at most this many characters. */
  maxUrlChars: 2000,
  /** The words a provider says it searched are one visible line of at most this many characters. */
  maxSearchedChars: 300,
  /** The most searches one call can have run (and been billed for). */
  maxSearches: 20
})

/** A page a result came from: what it is called and where it is. Plain text from outside; an address opens only after the person clicks. */
export interface ToolSource {
  title: string
  url: string
}

/**
 * What the audit log keeps (11.2), one event for each thing that happens to a call. Never any page text: what was asked, whether it was allowed, how big
 * the result was and which sources (title and address) came back. `call` names the call (made by the core, one for each, so that the events of calls that
 * overlap in time can be told apart); `tool` is a tool's id, or `(unknown)` when what the model named is not even shaped like an id (its words are never
 * kept).
 */
export type ToolEvent =
  | { type: 'refused'; at: number; call: string; tool: string; step: number; code: RefusalCode }
  | {
      type: 'asked'
      at: number
      call: string
      tool: string
      step: number
      args: ShownArguments
      why: string
    }
  | {
      type: 'answered'
      at: number
      call: string
      tool: string
      step: number
      answer: AnswerCode
    }
  | { type: 'ran'; at: number; call: string; tool: string; step: number }
  | {
      /** What became of a program run (13.4): in numbers and one word, never any of its output. Written after the run, before the `result`. */
      type: 'program'
      at: number
      call: string
      tool: string
      step: number
      end: ProgramEnd
      /** The program's exit code as Windows gives it; null when it did not run, or the clock or the disk cap ended it before it had one. */
      exitCode: number | null
      /** How long the program ran, in milliseconds (0 when it did not run). */
      ms: number
      /** Files copied into the box, and what the comparison found afterwards: changed, new, and deleted (deleted ones are only listed, never brought back). */
      copied: number
      changed: number
      created: number
      deleted: number
    }
  | {
      /** What became of a call to a connector's tool (14.5): how long it took, whether the connector said it failed, and how many pieces were not passed on. Never the result. */
      type: 'connector-call'
      at: number
      call: string
      tool: string
      step: number
      ms: number
      isError: boolean
      /** Pictures, sounds and links to files that came back and were not passed on. */
      dropped: number
    }
  | {
      /** Something that happened to a connector (14.6), not to a call: `call` is an id of its own, `step` is 0, `tool` is the tool's id or `(connector)`. */
      type: 'connector'
      at: number
      call: string
      tool: string
      step: number
      what: ConnectorEvent
      /** The connector's name as the person gave it (one visible line). */
      connector: string
    }
  | {
      type: 'result'
      at: number
      call: string
      tool: string
      step: number
      ok: boolean
      /** The characters of the result text that were passed on. */
      size: number
      /** The sources that came back: titles and addresses only, never any page text. */
      sources: ToolSource[]
      /** The words the provider says it actually searched, when it said (they can differ from the words the person approved); null otherwise. */
      searched: string | null
      /** How many searches the provider ran for this call, and bills (0 for a call that failed or was not a search). */
      searches: number
    }

/** A tool as the Tools page shows it (11.4): its id, what the person calls it, what it does, and whether it is switched on. */
export interface ToolInfo {
  id: string
  title: string
  /** What the tool does, for the person, in words main took from the registry. */
  about: string
  on: boolean
}

/**
 * What main says about the tool settings (11.4): the tools this version of the app has, which are on, the caps, and, when the settings file could not be read,
 * why (every tool is then off and the caps are the defaults, and nothing can be switched on until the person starts again).
 */
export interface ToolsStatus {
  tools: ToolInfo[]
  caps: ToolCaps
  problem: string | null
}

/**
 * The answer to a change of the tool settings. `cancelled`: the person said no (or closed the system's message box) when the change needed their yes, and
 * nothing was changed. A change that lets the app do more (a tool on, a higher cap) waits for that yes; a change that does less (a tool off, lower caps) does not.
 */
export type ToolChangeResult =
  { ok: true; status: ToolsStatus } | { ok: false; error: string; cancelled?: true }
