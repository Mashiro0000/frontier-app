import { RUN_LIMITS } from '../shared/run'
import {
  toolIsOn,
  DEFAULT_TOOL_SETTINGS,
  PROGRAM_ENDS,
  TOOL_RESULT_LIMITS,
  type AnswerCode,
  type ProgramEnd,
  type RefusalCode,
  type ShownArguments,
  type ToolEvent,
  type ToolSettings,
  type ToolSource
} from '../shared/tools'
import type { WorkspaceRefusal } from '../shared/workspace'
import type { DataFolderGuard, PathOp, PathVerdict } from './dataFolderGuard'
import type { ReplyBudget, RunCaps } from './replyBudget'
import { isSafeExternalUrl } from './security'
import type { GateAnswer, QuestionGate, SystemQuestion } from './systemQuestion'
import { approvalQuestion, SHOWN_LIMIT } from './toolQuestion'
import {
  checkArguments,
  offeredTool,
  type CheckedArgs,
  type OfferedTool,
  type ToolDefinition,
  type ToolRegistry
} from './toolRegistry'
import type { WorkspaceGuard, WorkspaceVerdict } from './workspaceGuard'

// The one place that decides what becomes of a tool call (Stage 11.1, D-041). The model asks; this decides; nothing else can run a tool, because the code
// that runs one is handed to this and kept here. The order, each step able to stop the call and none able to be skipped:
//   stopped? -> a step of the reply's budget -> a tool that exists -> switched on -> something to run it with -> the arguments exactly as the tool takes
//   them -> no saved API key in them -> every path past the data-folder guard -> the question fits the box -> the question is RECORDED -> the question,
//   in the system's own box -> the answer is RECORDED -> only a yes runs the tool -> the run is recorded, and so is its result.
// Since 12.2 a tool may also take a path in the code WORKSPACE (workspaceGuard.ts, which asks the data-folder guard as well) and be asked about by the
// REPLY: the first call of a reply opens one box for the whole reply, the calls after it run on that yes, and a file that is hidden or looks like it holds
// secrets is still asked about one at a time. The grant lives in this core, and a core is made for one reply, so it ends with the reply; a no is kept for the
// rest of the reply too, so that the person is not asked again and again. Everything else below is unchanged.
// Deny by default: a tool is off until the person switches it on; an unknown tool, a call that does not fit, a question that cannot be recorded, a box
// that cannot be shown, a person who says no, a second question while one is open, a reply that has used its steps or its time: none of them runs. Only
// the box's `yes` answers yes: there is no other way in (no argument, no setting, no note, instruction or file is ever read here), and the page has no
// way to answer. Nothing is run that has not been recorded first.
//
// What goes back to the model for a call that did not run is a short fixed sentence (below), never a path, a setting or the model's own words. What a
// tool brings back is UNTRUSTED text from outside: it is passed on as data with a size cap, and labelled as such by the loop (11.3, 11.5). No Electron
// imports, so every rule is checked under plain Node with played answers.

export type { ToolSource }

/** What a tool brought back: text from outside (never trusted) and where it came from. */
export interface ToolResult {
  text: string
  sources: ToolSource[]
  /** The words the provider says it searched, if it said (one visible line), else null. */
  searched: string | null
  /** How many searches the provider ran (and bills) for this call. */
  searches: number
  /** For a program run (13.4): how it ended, in numbers. Null for every other tool. */
  program: ProgramFacts | null
  /** For a call to a connector's tool (14.5): how long it took, whether the connector said it failed, what was not passed on. Null for every other tool. */
  connector: ConnectorCallFacts | null
}

/** What the audit log keeps of a call to a connector's tool (the "connector-call" event without its head), as the connector's executor reports it. */
export interface ConnectorCallFacts {
  ms: number
  isError: boolean
  dropped: number
}

/** What the audit log keeps of a program run (the "program" event without its head), as the run's executor reports it. */
export interface ProgramFacts {
  end: ProgramEnd
  exitCode: number | null
  ms: number
  copied: number
  changed: number
  created: number
  deleted: number
}

/**
 * How a tool is run. Given the checked arguments (a path as the real path that the guard resolved), a signal that ends the run, and `check`: the same
 * guard that judged the arguments, for a tool that goes through a folder and meets paths the model never named. A tool that walks a folder must not follow
 * a link it meets, or must ask `check` about every directory it goes into: the guard judges the path it is given, and cannot make a careless walker
 * careful (D-041).
 */
export type Executor = (
  args: CheckedArgs,
  context: {
    signal: AbortSignal
    check: (path: string, op: PathOp, recursive?: boolean) => Promise<PathVerdict>
    /** The most characters of text this call may return (a file call: what the reply may still be given, at most what one call may return). */
    maxChars: number
    /** A workspace argument looked at AGAIN, just before it is used (the folder may have changed since the first look); refuses what is not one. */
    again: (argName: string) => Promise<WorkspaceVerdict>
    /** The model's reason for the call, as the person was shown it (cleaned by the core). */
    why: string
    /** For a program run (13.4): the milliseconds of program time this reply may still use (the run's own clock must not be longer). 0 for every other tool. */
    runMsLeft: number
  }
) => Promise<{
  text: string
  sources?: ToolSource[]
  searched?: string | null
  searches?: number
  program?: ProgramFacts | null
  connector?: ConnectorCallFacts | null
}>

/** A call as the model made it: nothing in it has been checked. */
export interface ToolCall {
  tool: unknown
  args: unknown
}

/** One workspace path of a call as the workspace guard judged it. */
export interface WorkspacePathFacts {
  arg: string
  verdict: Extract<WorkspaceVerdict, { ok: true }>
}

/** A call to a tool that is asked about by the reply, as the words of its questions need it (12.3 makes them; the core checks that they fit). */
export interface WorkspaceCall {
  tool: ToolDefinition
  /** The arguments as the tool will be given them: a workspace path as the real path. */
  args: CheckedArgs
  why: string
  /** The number this call has in the reply's record. */
  step: number
  /** The provider that answers this chat, if known. */
  provider?: string
  /** The workspace as it really is now. */
  root: string
  paths: readonly WorkspacePathFacts[]
}

export interface WorkspaceQuestions {
  /** The first file call of a reply: the box that asks for the whole reply. */
  grant(call: WorkspaceCall): SystemQuestion
  /** A file that is hidden or looks like it holds secrets: asked about that one file, whatever the reply's grant says. */
  oneByOne(call: WorkspaceCall): SystemQuestion
}

/** A call to a tool that runs a program (13.4, `ask: 'run'`), as the words of its question and the look at the program need it. */
export interface ProgramCall {
  tool: ToolDefinition
  /** The arguments as checked: the folder as the real path that the workspace guard resolved, the program still as the model wrote it. */
  args: CheckedArgs
  why: string
  /** The number this call has in the reply's record. */
  step: number
  /** The provider that answers this chat, if known. */
  provider?: string
  /** The workspace as it really is now, and the folder of it that the program would work on (a copy of it). */
  root: string
  folder: WorkspacePathFacts
  /** What this reply may still run: how many runs, and how many milliseconds of program time, of what its caps allow. */
  runsLeft: number
  runMsLeft: number
  runCaps: Readonly<RunCaps>
  /** Stop everything: a look at the folder that takes long ends with it. */
  signal: AbortSignal
}

/**
 * What the preparation of a run answers. `replace`: arguments as the program will really be given them (the program as a full path), which are also what the person is shown.
 * `shown`: what the audit log keeps of the call. `question`: the words of the box. A refusal carries one of the fixed sentences and its code.
 */
export type ProgramPreparation =
  | {
      ok: true
      replace: Readonly<Record<string, string>>
      shown: ShownArguments
      question: SystemQuestion
    }
  | { ok: false; code: RefusalCode; text: string }

/** What the core is given to ask about a run (13.4): the look at the call before anybody is asked. Nothing is copied or started here. */
export interface ProgramSupport {
  prepare(call: ProgramCall): Promise<ProgramPreparation>
}

export interface RunContext {
  /** The window the question is for. */
  owner: unknown
  /** Stop everything: a signal that aborts ends the call, wherever it is, and denies the question if one is open. */
  signal: AbortSignal
  /** The reply's steps and working time. */
  budget: ReplyBudget
  /** The provider that answers this chat, by the name the person knows it by (11.4): the question names it. */
  provider?: string
  /**
   * Whether the call could be paid for under the spending limits (11.6), asked before the question: a call the limits would refuse is not asked about (a yes
   * could not make it run). A fault in it counts as yes (the request itself is checked again, and refused there, when it is made).
   */
  affordable?: () => Promise<boolean>
}

interface NotRun {
  tool: string
  step: number
  /** What goes back to the model as the tool's result. */
  text: string
  /** True when the reply must end now (a cap was reached, or Stop everything). */
  endsReply: boolean
}

export type ToolOutcome =
  | { kind: 'ran'; tool: string; step: number; result: ToolResult }
  | (NotRun & { kind: 'refused'; code: RefusalCode })
  | (NotRun & { kind: 'declined'; answer: Exclude<AnswerCode, 'yes' | 'covered'> })
  | (NotRun & { kind: 'failed'; code: 'run-failed' | 'time-cap' | 'stopped' })

export interface ToolCore {
  run(call: ToolCall, context: RunContext): Promise<ToolOutcome>
  /** The tools to tell the model about: only those switched on that this build can run. None while every tool is off. */
  offered(): OfferedTool[]
}

export interface ToolCoreOptions {
  tools: ToolRegistry
  /** The person's settings, asked for at each call. A settings object that cannot be had counts as the default: everything off. */
  settings: () => ToolSettings
  /** The app's one gate for questions in the system's box (10.1), so that only one question is open across the app. */
  gate: QuestionGate
  guard: DataFolderGuard
  /** Keeps the audit record (11.2). Required: a core with nowhere to record runs nothing. Rejecting means the call is not made. */
  record: (event: ToolEvent) => Promise<void>
  /** True when the text holds one of the API keys saved in the app (secrets.ts `heldKey`), so that a key can never leave inside a tool call. */
  holdsSavedKey: (text: string) => Promise<boolean>
  /** How each tool is run, by id. Copied when the core is made. */
  executors: Readonly<Record<string, Executor>>
  /** The code workspace (12.2): the guard for its paths and the words of its two kinds of question. Absent: a call with a workspace path is refused. */
  workspace?: { guard: WorkspaceGuard; questions: WorkspaceQuestions }
  /** Running a program (13.4): the look at a run before it is asked about. Absent: a call to a tool that is asked about as a run is refused as "no runner". */
  programs?: ProgramSupport
  now?: () => number
  /** Where a call's id comes from (the record names every event by it, so that calls that overlap can be told apart). Tests hand in their own. */
  newId?: () => string
}

// The sentences that go back to the model for a call that did not run. Fixed, so that nothing a hostile page said or a path can ride back in them.
export const UNKNOWN_TOOL = 'That tool does not exist.'
export const TOOL_OFF = 'That tool is switched off.'
export const SECRET_TEXT =
  'The call was not accepted: its arguments hold text that must never be sent (a saved key).'
export const DATA_FOLDER_TEXT =
  'The call was not accepted: that location is not available to tools.'
export const BAD_PATH_TEXT = 'The call was not accepted: that is not a path a tool may use.'
export const TOO_LONG_TEXT = 'The call was not accepted: it is too long to show in full.'
export const NOT_RECORDED = 'The call was not made: the app could not keep its record of it.'
export const NO_RUNNER = 'This tool cannot be run by this version of the app.'
export const LIMIT_TEXT = 'This call was not made: a spending limit the person set would be passed.'
export const INTERNAL = 'The call was not made: the app failed while checking it.'
export const STOPPED = 'The person stopped this reply.'
export const TIME_CAP = 'This reply has used all of its working time for tools.'
export const stepCapText = (steps: number): string =>
  `This reply has used all ${steps} of its tool steps.`
export const DECLINED_TEXT: Readonly<Record<Exclude<AnswerCode, 'yes' | 'covered'>, string>> = {
  no: 'The person did not allow this.',
  busy: 'The person could not be asked just now, because another question is waiting for their answer. Do not ask again straight away.',
  resting: 'The person said no a moment ago, so they were not asked again.',
  failed: 'The question could not be shown, so the tool was not run.',
  stopped: STOPPED
}
export const RUN_FAILED = 'The tool failed.'
export const NO_WORKSPACE_TEXT =
  'No workspace folder is chosen, or the chosen folder cannot be used just now.'
export const WRONG_PATH_TEXT =
  'The call was not accepted: that path is not there, or it is not the kind of thing this call needs (a file or a folder).'
export const GRANT_DECLINED_TEXT = 'The person did not allow file access in this reply.'
export const fileCapText = (calls: number): string =>
  `This reply has used all ${calls} of its file calls.`
export const CHARS_CAP_TEXT = 'This reply has been given all the file text it may read.'
// The sentences for a program run (13.4). Fixed, like the rest: nothing of a program's name, arguments or folder rides in them.
export const NO_BOX_TEXT = 'This call was not made: a program cannot be run on this PC just now.'
export const NO_PROGRAM_TEXT = 'The call was not accepted: that is not a program a run may use.'
export const COPY_REFUSED_TEXT =
  'The call was not accepted: that folder is bigger than a run may copy (20,000 files and folders, 100 MB), or it cannot be copied. Run in a subfolder instead.'
export const RUN_DECLINED_TEXT = 'The person did not allow a program run in this reply.'
export const CONNECTOR_DECLINED_TEXT =
  'The person said no to this connector earlier in this reply, so they were not asked again.'
export const RUN_TIME_TEXT = 'This reply has used all the run time it may.'
export const runCapText = (runs: number): string =>
  `This reply has used all ${runs} of its program runs.`
/** The least program time left for which a run is still offered: the launcher takes about a second to make the box. */
export const MIN_RUN_MS = 5000
/** How long past the reply's remaining run time the core waits for a run to give its answer (copying the folder, making the box and looking afterwards are not the program's clock). */
export const RUN_BACKSTOP_MS = 60_000

/** What the model is told, and what the record keeps, for each reason the workspace guard refuses a path. Fixed: nothing of the path rides in them. */
const WORKSPACE_REFUSAL: Readonly<Record<WorkspaceRefusal, { code: RefusalCode; text: string }>> = {
  'no-workspace': { code: 'no-workspace', text: NO_WORKSPACE_TEXT },
  'workspace-changed': { code: 'no-workspace', text: NO_WORKSPACE_TEXT },
  outside: { code: 'outside', text: DATA_FOLDER_TEXT },
  link: { code: 'link', text: DATA_FOLDER_TEXT },
  never: { code: 'never', text: DATA_FOLDER_TEXT },
  'data-folder': { code: 'data-folder', text: DATA_FOLDER_TEXT },
  'bad-path': { code: 'bad-path', text: BAD_PATH_TEXT },
  'not-found': { code: 'wrong-path', text: WRONG_PATH_TEXT },
  'not-a-file': { code: 'wrong-path', text: WRONG_PATH_TEXT },
  'not-a-folder': { code: 'wrong-path', text: WRONG_PATH_TEXT },
  exists: { code: 'wrong-path', text: WRONG_PATH_TEXT }
}

/** Codes after which the reply itself stops (and says why), instead of going on without the call. */
const ENDS_REPLY: ReadonlySet<string> = new Set([
  'step-cap',
  'time-cap',
  'stopped',
  'file-cap',
  'chars-cap'
])

/** The most text of a result that is passed on, and the most sources. A bigger result is cut (and says so): it goes into the next request and costs. */
export const MAX_RESULT_CHARS = TOOL_RESULT_LIMITS.maxChars
export const MAX_SOURCES = TOOL_RESULT_LIMITS.maxSources
export const RESULT_CUT = '\n[The result was longer than the app passes on, so the rest was cut.]'

const reason = (error: unknown): unknown => (error instanceof Error ? error.message : error)

/** A tool's id for the record, or `(unknown)`: the words of a model that named a tool that does not exist are never kept. */
const nameForRecord = (name: unknown): string =>
  typeof name === 'string' && /^[a-z][a-z0-9_]{1,31}$/.test(name) ? name : '(unknown)'

/** Text from outside as one visible line of at most `max` characters: controls and white space become one space, invisible and reversing characters go. */
function tidyLine(text: string, max: number): string {
  const line = text
    .slice(0, 1000)
    .replace(/[\p{Cc}\s]+/gu, ' ')
    .replace(/[\p{Cf}\p{Zl}\p{Zp}\p{Co}\p{Cn}\p{Cs}]/gu, '')
    .trim()
  return Array.from(line).slice(0, max).join('')
}

const tidyTitle = (title: string): string => tidyLine(title, TOOL_RESULT_LIMITS.maxTitleChars)

/**
 * The address as the app keeps and shows it (the page's own form of it, which is plain ASCII: a name with other letters is written the way the web writes
 * it, so that no invisible or reversing character can ride in an address), or null when it is not a plain https address without a name or a password,
 * or is too long.
 */
function tidyUrl(url: string): string | null {
  if (url.length > TOOL_RESULT_LIMITS.maxUrlChars || !isSafeExternalUrl(url)) return null
  let href: string
  try {
    href = new URL(url).href
  } catch {
    return null
  }
  return href.length <= TOOL_RESULT_LIMITS.maxUrlChars && /^[\x21-\x7e]+$/.test(href) ? href : null
}

const isCount = (value: unknown, max: number): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= max

/** The numbers of a run as the executor reported them, or null when anything in them is not what the audit log can keep. */
function shapeProgram(raw: unknown): ProgramFacts | null {
  if (raw === null || typeof raw !== 'object') return null
  const p = raw as Record<string, unknown>
  if (typeof p.end !== 'string' || !(PROGRAM_ENDS as readonly string[]).includes(p.end)) return null
  if (p.exitCode !== null && !isCount(p.exitCode, 4_294_967_295)) return null
  if (!isCount(p.ms, 1_000_000_000)) return null
  const { copied, changed, created, deleted } = p
  if (!isCount(copied, 1_000_000) || !isCount(changed, 1_000_000)) return null
  if (!isCount(created, 1_000_000) || !isCount(deleted, 1_000_000)) return null
  return {
    end: p.end as ProgramEnd,
    exitCode: p.exitCode as number | null,
    ms: p.ms,
    copied,
    changed,
    created,
    deleted
  }
}

/** The facts of a connector call as the executor reported them, or null when anything in them is not what the audit log can keep. */
function shapeConnector(raw: unknown): ConnectorCallFacts | null {
  if (raw === null || typeof raw !== 'object') return null
  const c = raw as Record<string, unknown>
  if (
    !isCount(c.ms, 1_000_000_000) ||
    typeof c.isError !== 'boolean' ||
    !isCount(c.dropped, 1000)
  ) {
    return null
  }
  return { ms: c.ms, isError: c.isError, dropped: c.dropped }
}

/** What a tool handed back, as the app passes it on, or null when it is not a result at all. */
export function shapeResult(raw: unknown): ToolResult | null {
  if (raw === null || typeof raw !== 'object') return null
  const { text, sources, searched, searches, program, connector } = raw as {
    text?: unknown
    sources?: unknown
    searched?: unknown
    searches?: unknown
    program?: unknown
    connector?: unknown
  }
  if (typeof text !== 'string') return null
  const called = connector === undefined || connector === null ? null : shapeConnector(connector)
  if (connector !== undefined && connector !== null && called === null) return null
  // Numbers about a run, if the tool gave any: they are kept as they are, or the result is not believed (a fault of the tool's own, never the model's)
  const facts = program === undefined || program === null ? null : shapeProgram(program)
  if (program !== undefined && program !== null && facts === null) return null
  const kept: ToolSource[] = []
  if (Array.isArray(sources)) {
    for (const source of sources.slice(0, MAX_SOURCES) as unknown[]) {
      if (source === null || typeof source !== 'object') continue
      const { title, url: raw } = source as { title?: unknown; url?: unknown }
      // An address opens only after the person clicks, and only if it is a plain https one (security.ts): anything else is dropped here.
      const url = typeof raw === 'string' ? tidyUrl(raw) : null
      if (url === null) continue
      const named = typeof title === 'string' ? tidyTitle(title) : ''
      kept.push({
        title: named === '' ? url.slice(0, TOOL_RESULT_LIMITS.maxTitleChars) : named,
        url
      })
    }
  }
  // The words the provider says it searched: one visible line, or none.
  const words =
    typeof searched === 'string' ? tidyLine(searched, TOOL_RESULT_LIMITS.maxSearchedChars) : ''
  return {
    text: text.length > MAX_RESULT_CHARS ? text.slice(0, MAX_RESULT_CHARS) + RESULT_CUT : text,
    sources: kept,
    searched: words === '' ? null : words,
    searches:
      typeof searches === 'number' &&
      Number.isInteger(searches) &&
      searches >= 0 &&
      searches <= TOOL_RESULT_LIMITS.maxSearches
        ? searches
        : 0,
    program: facts,
    connector: called
  }
}

export function createToolCore(options: ToolCoreOptions): ToolCore {
  const { tools, gate, guard, record, holdsSavedKey } = options
  const now = options.now ?? Date.now
  let counter = 0
  /** A call's id: lower-case letters, digits and hyphens, never the same twice in one run of the app, and (by its random part) almost never across runs. */
  const newId =
    options.newId ??
    ((): string => {
      counter += 1
      return `${now().toString(36)}-${counter.toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    })
  // Copied now: an executor added to the caller's object later is not one this core has.
  const executors = new Map<string, Executor>(Object.entries(options.executors))
  const workspace = options.workspace
  /** What the person said to file access for THIS reply (a core is made for one reply): yes covers the calls after it, a no is not asked again. */
  const grants = new Map<string, 'granted' | 'declined'>()
  const programs = options.programs

  const settings = (): ToolSettings => {
    try {
      return options.settings()
    } catch {
      return DEFAULT_TOOL_SETTINGS
    }
  }

  /** The guard for a running tool (see Executor): absolute paths only, and a fault of the guard is a refusal. */
  const checkAgain = async (
    path: string,
    op: PathOp,
    recursive?: boolean
  ): Promise<PathVerdict> => {
    try {
      return await guard.check({ path, base: null, op, recursive })
    } catch {
      return { ok: false, code: 'bad-path', why: 'the check failed' }
    }
  }

  /** Keeps one record; false when it could not be kept. */
  async function keep(event: ToolEvent): Promise<boolean> {
    try {
      await record(event)
      return true
    } catch (error) {
      // Logged here only; the message could name a file path.
      console.error('Keeping the record of a tool call failed:', reason(error))
      return false
    }
  }

  /**
   * The question, with Stop everything able to end the wait at once. The same signal is handed to the gate (11.3), which has the box closed; if a box
   * ignores it, the answer that comes later is not waited for.
   */
  function askOrStop(
    owner: unknown,
    question: SystemQuestion,
    signal: AbortSignal
  ): Promise<GateAnswer> {
    if (signal.aborted) return Promise.resolve('stopped')
    return new Promise((resolve) => {
      const onAbort = (): void => resolve('stopped')
      signal.addEventListener('abort', onAbort, { once: true })
      gate.ask(owner, question, signal).then(
        (answer) => {
          signal.removeEventListener('abort', onAbort)
          resolve(answer)
        },
        () => {
          signal.removeEventListener('abort', onAbort)
          resolve('failed')
        }
      )
    })
  }

  /** Runs a tool that the person allowed, ending it when Stop everything comes or the reply's working time is used. Never throws. */
  async function execute(
    def: ToolDefinition,
    executor: Executor,
    args: CheckedArgs,
    call: string,
    step: number,
    context: RunContext,
    again: (argName: string) => Promise<WorkspaceVerdict>,
    why: string
  ): Promise<ToolOutcome> {
    const { signal, budget } = context
    const tool = def.id
    // A program run (13.4) has its own clock, apart from the reply's working time: that one stands still while the program runs, and the run's time is counted on the run budget.
    const isRun = def.ask === 'run'
    const startedAt = now()
    const failed = async (
      code: 'run-failed' | 'time-cap' | 'stopped',
      text: string
    ): Promise<ToolOutcome> => {
      // A run that was stopped, timed out or failed has used the time it took (its own clock is not known): nothing runs free of the run budget.
      if (isRun) budget.useRunMs(Math.max(0, now() - startedAt))
      await keep({
        type: 'result',
        at: now(),
        call,
        tool,
        step,
        ok: false,
        size: 0,
        sources: [],
        searched: null,
        searches: 0
      })
      return { kind: 'failed', tool, step, code, text, endsReply: ENDS_REPLY.has(code) }
    }
    if (signal.aborted) {
      return { kind: 'failed', tool, step, code: 'stopped', text: STOPPED, endsReply: true }
    }
    if (!(await keep({ type: 'ran', at: now(), call, tool, step }))) {
      return {
        kind: 'refused',
        tool,
        step,
        code: 'not-recorded',
        text: NOT_RECORDED,
        endsReply: false
      }
    }
    const controller = new AbortController()
    let ended: 'stopped' | 'time' | null = null
    const endBecause = (why: 'stopped' | 'time') => (): void => {
      if (ended === null) {
        ended = why
        controller.abort()
      }
    }
    const onStop = endBecause('stopped')
    signal.addEventListener('abort', onStop, { once: true })
    if (isRun) budget.pause()
    const timer = setTimeout(
      endBecause('time'),
      Math.max(0, isRun ? budget.runMsLeft() + RUN_BACKSTOP_MS : budget.remainingMs())
    )
    const aborted = new Promise<'aborted'>((resolve) =>
      controller.signal.addEventListener('abort', () => resolve('aborted'), { once: true })
    )
    try {
      if (signal.aborted) onStop()
      const maxChars =
        def.counts === 'file'
          ? Math.min(MAX_RESULT_CHARS, budget.charsLeft())
          : isRun
            ? Math.min(MAX_RESULT_CHARS, RUN_LIMITS.modelChars)
            : MAX_RESULT_CHARS
      const running = Promise.resolve()
        .then(() =>
          executor(args, {
            signal: controller.signal,
            check: checkAgain,
            maxChars,
            again,
            why,
            runMsLeft: isRun ? budget.runMsLeft() : 0
          })
        )
        .then((raw) => ({ raw }))
      running.catch(() => undefined) // if the run is given up on, a later failure of it is not an unhandled one
      const done = await Promise.race([running, aborted])
      if (done === 'aborted' || ended !== null) {
        return ended === 'time'
          ? await failed('time-cap', TIME_CAP)
          : await failed('stopped', STOPPED)
      }
      const result = shapeResult(done.raw)
      if (result === null) return await failed('run-failed', RUN_FAILED)
      if (def.counts === 'file') budget.useChars(result.text.length)
      if (isRun) {
        // the run's clock as the launcher measured it; a run that reports none is charged what it took
        budget.useRunMs(result.program?.ms ?? Math.max(0, now() - startedAt))
        if (result.program !== null) {
          await keep({ type: 'program', at: now(), call, tool, step, ...result.program })
        }
      }
      if (result.connector !== null) {
        await keep({ type: 'connector-call', at: now(), call, tool, step, ...result.connector })
      }
      await keep({
        type: 'result',
        at: now(),
        call,
        tool,
        step,
        ok: true,
        size: result.text.length,
        sources: result.sources.map(({ title, url }) => ({ title, url })),
        searched: result.searched,
        searches: result.searches
      })
      return { kind: 'ran', tool, step, result }
    } catch (error) {
      if (ended === 'time') return await failed('time-cap', TIME_CAP)
      if (ended === 'stopped') return await failed('stopped', STOPPED)
      // Logged here only; the message could name a path or hold text from outside.
      console.error(`The tool ${tool} failed:`, reason(error))
      return await failed('run-failed', RUN_FAILED)
    } finally {
      clearTimeout(timer)
      signal.removeEventListener('abort', onStop)
      if (isRun) budget.resume()
    }
  }

  /** Decides what becomes of one call, step by step. It can throw only if the app itself is at fault: `run` catches that and refuses the call. */
  async function decide(call: ToolCall, callId: string, context: RunContext): Promise<ToolOutcome> {
    const { owner, signal, budget } = context
    const name = nameForRecord(call.tool)

    const refused = async (code: RefusalCode, text: string, step: number): Promise<ToolOutcome> => {
      await keep({ type: 'refused', at: now(), call: callId, tool: name, step, code })
      return { kind: 'refused', tool: name, step, code, text, endsReply: ENDS_REPLY.has(code) }
    }

    if (signal.aborted) return refused('stopped', STOPPED, budget.used().calls)
    // A file call is counted on the reply's file calls, any other on its tool steps; a call to a tool that does not exist is a step, as before.
    const def = tools.get(call.tool)
    const isFile = def !== undefined && def.counts === 'file'
    const taken = isFile ? budget.takeFile() : budget.take()
    const step = budget.used().calls
    if (taken === 'step-cap') return refused('step-cap', stepCapText(budget.caps.steps), step)
    if (taken === 'file-cap') return refused('file-cap', fileCapText(budget.fileCaps.calls), step)
    if (taken === 'time-cap') return refused('time-cap', TIME_CAP, step)

    if (def === undefined) return refused('unknown-tool', UNKNOWN_TOOL, step)
    if (!toolIsOn(settings(), def.id)) return refused('tool-off', TOOL_OFF, step)
    const executor = executors.get(def.id)
    if (executor === undefined) return refused('no-runner', NO_RUNNER, step)

    const checked = checkArguments(def, call.args)
    if (!checked.ok) {
      return refused('bad-arguments', `The call was not accepted: ${checked.reason}.`, step)
    }

    // A key saved in the app never leaves inside a tool call (rule 5). If the look cannot be made, the call is refused.
    const texts = [
      checked.why,
      // (a list's items are text too: a saved key must not leave as the argument of a program either)
      ...Object.values(checked.args).flatMap((v) =>
        typeof v === 'string' ? [v] : typeof v === 'number' || typeof v === 'boolean' ? [] : [...v]
      )
    ]
    for (const text of texts) {
      let held = true
      try {
        held = await holdsSavedKey(text)
      } catch {
        held = true
      }
      if (held) return refused('secret', SECRET_TEXT, step)
    }

    // Every path goes past its guard, and the tool is given only the real path that the guard hands back: a path in the data folder past the data-folder
    // guard, a path in the code workspace past the workspace guard (which asks the data-folder guard as well).
    const args: Record<string, string | number | boolean | readonly string[]> = { ...checked.args }
    const paths: WorkspacePathFacts[] = []
    for (const [argName, spec] of Object.entries(def.args)) {
      if (spec.kind === 'workspace_path') {
        if (workspace === undefined) return refused('no-workspace', NO_WORKSPACE_TEXT, step)
        const found = await workspace.guard.check({ path: checked.args[argName], op: spec.op })
        if (!found.ok) {
          const why = WORKSPACE_REFUSAL[found.code] ?? WORKSPACE_REFUSAL['bad-path']
          return refused(why.code, why.text, step)
        }
        args[argName] = found.real
        paths.push({ arg: argName, verdict: found })
        continue
      }
      if (spec.kind !== 'path') continue
      let base: string | null = null
      try {
        base = def.base === undefined ? null : def.base()
      } catch {
        base = null
      }
      const verdict = await guard.check({
        path: checked.args[argName],
        base,
        op: spec.op,
        recursive: spec.recursive
      })
      if (!verdict.ok) {
        return refused(
          verdict.code,
          verdict.code === 'data-folder' ? DATA_FOLDER_TEXT : BAD_PATH_TEXT,
          step
        )
      }
      args[argName] = verdict.real
    }
    // A call that brings text back is refused once the reply has been given all the file text it may have (a proposal brings none).
    if (
      isFile &&
      budget.charsLeft() <= 0 &&
      paths.some((p) => {
        const op = (def.args[p.arg] as { op?: string }).op
        return op === 'list' || op === 'read'
      })
    ) {
      return refused('chars-cap', CHARS_CAP_TEXT, step)
    }

    // (a run and a connector's call cost no API money: the spending limits are for calls the provider bills, and the next request is checked against them when it is made)
    if (
      def.counts !== 'file' &&
      def.ask !== 'run' &&
      !def.id.includes('__') &&
      context.affordable !== undefined
    ) {
      let affordable = true
      try {
        affordable = await context.affordable()
      } catch {
        affordable = true
      }
      if (!affordable) return refused('limit', LIMIT_TEXT, step)
    }

    // What the record keeps of the arguments: what the person was shown, and for a long text only how long it is (the log holds paths and sizes, never the
    // text of a file or of a change).
    let shownArgs: Record<string, string | number> = {}
    for (const [argName, value] of Object.entries(args)) {
      shownArgs[argName] =
        def.args[argName]?.kind === 'body'
          ? `(${String(value).length} characters)`
          : typeof value === 'string' || typeof value === 'number'
            ? value
            : JSON.stringify(value)
    }

    // One question, with its record before and after it: the question is recorded before it is asked and the answer after, and nothing is asked that was
    // not recorded. The reply's clock stops while the person decides (D-041).
    const put = async (
      question: SystemQuestion
    ): Promise<{ answer: GateAnswer; recorded: boolean } | ToolOutcome> => {
      if (question.detail.length > SHOWN_LIMIT) return refused('bad-arguments', TOO_LONG_TEXT, step)
      if (
        !(await keep({
          type: 'asked',
          at: now(),
          call: callId,
          tool: def.id,
          step,
          args: shownArgs,
          why: checked.why
        }))
      ) {
        return refused('not-recorded', NOT_RECORDED, step)
      }
      budget.pause()
      let answer: GateAnswer
      try {
        answer = await askOrStop(owner, question, signal)
      } finally {
        budget.resume()
      }
      if (answer === 'yes' && signal.aborted) answer = 'stopped' // Stop came first: the yes is not one
      const recorded = await keep({
        type: 'answered',
        at: now(),
        call: callId,
        tool: def.id,
        step,
        answer
      })
      return { answer, recorded }
    }
    const declined = (answer: Exclude<GateAnswer, 'yes'>): ToolOutcome => ({
      kind: 'declined',
      tool: def.id,
      step,
      answer,
      text: DECLINED_TEXT[answer],
      endsReply: ENDS_REPLY.has(answer)
    })
    const isOutcome = (
      r: { answer: GateAnswer; recorded: boolean } | ToolOutcome
    ): r is ToolOutcome => 'kind' in r

    if (def.ask === 'reply') {
      // Asked about by the reply: one yes for the reply's file access, and one question for each file that is hidden or looks like it holds secrets.
      if (workspace === undefined) return refused('no-workspace', NO_WORKSPACE_TEXT, step)
      const root = await workspace.guard.root()
      if (!root.ok) return refused('no-workspace', NO_WORKSPACE_TEXT, step)
      if (grants.get('workspace') === 'declined') {
        return refused('grant-declined', GRANT_DECLINED_TEXT, step)
      }
      const asked: WorkspaceCall = {
        tool: def,
        args: Object.freeze({ ...args }),
        why: checked.why,
        step,
        ...(context.provider === undefined ? {} : { provider: context.provider }),
        root: root.real,
        paths
      }
      let yes = false
      if (grants.get('workspace') === undefined) {
        const r = await put(workspace.questions.grant(asked))
        if (isOutcome(r)) return r
        if (r.answer !== 'yes') {
          if (r.answer === 'no') grants.set('workspace', 'declined')
          return declined(r.answer)
        }
        if (!r.recorded) return refused('not-recorded', NOT_RECORDED, step)
        grants.set('workspace', 'granted')
        yes = true
      }
      if (paths.some((p) => p.verdict.fileClass === 'one-by-one')) {
        const r = await put(workspace.questions.oneByOne(asked))
        if (isOutcome(r)) return r
        if (r.answer !== 'yes') return declined(r.answer)
        if (!r.recorded) return refused('not-recorded', NOT_RECORDED, step)
        yes = true
      }
      if (!yes) {
        // The reply's yes covers this call: it is recorded as shown, and as covered, so that the log never says anybody was asked about it.
        const shown = await keep({
          type: 'asked',
          at: now(),
          call: callId,
          tool: def.id,
          step,
          args: shownArgs,
          why: checked.why
        })
        const covered =
          shown &&
          (await keep({
            type: 'answered',
            at: now(),
            call: callId,
            tool: def.id,
            step,
            answer: 'covered'
          }))
        if (!covered) return refused('not-recorded', NOT_RECORDED, step)
      }
    } else if (def.ask === 'run') {
      // A program run (13.4): one question for EVERY run, in the words of the preparation, which has looked at the call first (the program as a full path, the copy that would be
      // made). A no is kept for the rest of the reply. The run is counted at the yes: a refusal, a no or a stop used none of the reply's runs.
      if (programs === undefined || workspace === undefined) {
        return refused('no-runner', NO_RUNNER, step)
      }
      if (grants.get('run') === 'declined') return refused('run-declined', RUN_DECLINED_TEXT, step)
      if (budget.runsLeft() <= 0) {
        return refused('run-cap', runCapText(budget.runCaps.runs), step)
      }
      if (budget.runMsLeft() < MIN_RUN_MS) return refused('run-time-cap', RUN_TIME_TEXT, step)
      const root = await workspace.guard.root()
      if (!root.ok) return refused('no-workspace', NO_WORKSPACE_TEXT, step)
      // (the registry sees to it that exactly one workspace folder is named; a hidden or secret-looking folder is not one to run in)
      const folder = paths[0]
      if (folder === undefined || folder.verdict.fileClass !== 'ok') {
        return refused('bad-path', BAD_PATH_TEXT, step)
      }
      let prepared: ProgramPreparation
      try {
        prepared = await programs.prepare({
          tool: def,
          args: Object.freeze({ ...args }),
          why: checked.why,
          step,
          ...(context.provider === undefined ? {} : { provider: context.provider }),
          root: root.real,
          folder,
          runsLeft: budget.runsLeft(),
          runMsLeft: budget.runMsLeft(),
          runCaps: budget.runCaps,
          signal
        })
      } catch (error) {
        // Logged here only; the message could name a path.
        console.error('Looking at a program run failed:', reason(error))
        prepared = { ok: false, code: 'internal', text: INTERNAL }
      }
      if (!prepared.ok) return refused(prepared.code, prepared.text, step)
      // The program as it will really run (a full path) is what is shown and what is given to the tool; the record keeps what the preparation says of the call.
      for (const [argName, value] of Object.entries(prepared.replace)) {
        if (def.args[argName]?.kind !== 'text') return refused('internal', INTERNAL, step)
        args[argName] = value
      }
      shownArgs = { ...prepared.shown }
      const r = await put(prepared.question)
      if (isOutcome(r)) return r
      if (r.answer !== 'yes') {
        if (r.answer === 'no') grants.set('run', 'declined')
        return declined(r.answer)
      }
      if (!r.recorded) return refused('not-recorded', NOT_RECORDED, step)
      const took = budget.takeRun()
      if (took !== 'ok') {
        return refused(
          took,
          took === 'run-cap' ? runCapText(budget.runCaps.runs) : RUN_TIME_TEXT,
          step
        )
      }
    } else {
      // A connector's tool (14, `prefix__name`): every call is asked about, and a no to the connector is kept for the rest of the reply.
      const connector = def.id.includes('__')
        ? `connector:${def.id.slice(0, def.id.indexOf('__'))}`
        : null
      if (connector !== null && grants.get(connector) === 'declined') {
        return refused('connector-declined', CONNECTOR_DECLINED_TEXT, step)
      }
      const question = approvalQuestion(def, args, checked.why, {
        step: budget.used().steps,
        steps: budget.caps.steps,
        ...(context.provider === undefined ? {} : { provider: context.provider })
      })
      const r = await put(question)
      if (isOutcome(r)) return r
      if (r.answer !== 'yes') {
        if (r.answer === 'no' && connector !== null) grants.set(connector, 'declined')
        return declined(r.answer)
      }
      if (!r.recorded) return refused('not-recorded', NOT_RECORDED, step)
    }

    // A workspace argument, looked at again just before the tool uses it.
    const again = async (argName: string): Promise<WorkspaceVerdict> => {
      const spec = def.args[argName]
      if (workspace === undefined || spec === undefined || spec.kind !== 'workspace_path') {
        return { ok: false, code: 'bad-path', why: 'not a workspace path' }
      }
      try {
        return await workspace.guard.check({ path: checked.args[argName], op: spec.op })
      } catch {
        return { ok: false, code: 'bad-path', why: 'the check failed' }
      }
    }
    return execute(def, executor, Object.freeze(args), callId, step, context, again, checked.why)
  }

  return {
    offered: () => {
      const current = settings()
      return tools
        .ids()
        .filter((id) => toolIsOn(current, id) && executors.has(id))
        .map((id) => offeredTool(tools.get(id) as ToolDefinition))
    },

    run: async (call, context) => {
      let callId = 'call'
      try {
        callId = newId()
      } catch {
        // the fixed name above: the record is still kept, and the events of one call still share it
      }
      try {
        return await decide(call, callId, context)
      } catch (error) {
        // A fault of the app's own (or an object that throws when it is read): nothing was run, and the model is told no more than that.
        console.error('Deciding on a tool call failed:', reason(error))
        const tool = nameForRecord(
          call !== null && typeof call === 'object' ? (call as ToolCall).tool : undefined
        )
        const step = context.budget.used().calls
        await keep({ type: 'refused', at: now(), call: callId, tool, step, code: 'internal' })
        return { kind: 'refused', tool, step, code: 'internal', text: INTERNAL, endsReply: false }
      }
    }
  }
}
