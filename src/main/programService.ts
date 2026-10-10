import {
  PROGRAM_TOOL_IDS,
  SELFTEST_PROBES,
  type ProgramsChangeResult,
  type ProgramsStatus,
  type SelfTestReport
} from '../shared/programs'
import type { ToolSettings } from '../shared/tools'
import type { WorkspaceStatus } from '../shared/workspace'
import { KeptRefused } from './keptFile'
import type { BoxAnswer } from './programBox'
import { defaultPlaces, resolveProgram, type ProgramPlaces } from './programTools'
import { runSelfTest, type SelfTestOptions } from './selfTest'
import {
  QUESTION_BUSY,
  QUESTION_FAILED,
  QUESTION_RESTING,
  type QuestionGate,
  type SystemQuestion
} from './systemQuestion'
import { ASKED_HERE } from './toolQuestion'
import type { ToolSettingsStore } from './toolSettings'

// What the person can do with running programs (Stage 13.5, D-043): see whether the switch is on and what the last self-test said, and switch it on or off. The rule
// is the one of 10.1 and 11.4: a change that lets the app do MORE (running programs on) is made only after the SELF-TEST has passed and the person has said yes in the
// system's own message box, which the page cannot answer; a change that does LESS (off) is made at once. There is no way to switch it on without the box: the test is
// the box's own, made now, on this PC, and any line that is not good keeps the switch off. A reply can run a program only while the switch is on AND a self-test of THIS
// session has passed (`available`): after a restart the test is made again in the background, and if it fails the switch is taken off. No Electron imports.

export const TOOL_ID = 'run_program'
export const NO_FOLDER =
  'Choose a workspace folder first (Code workspace, above): a run copies a folder of it.'
export const NO_NODE =
  'Node.js is not installed on this PC. Running programs needs it: the self-test runs a small program with it, and it is the program most runs use. Install it, then try again.'
export const NOT_ON = 'Running programs is still off.'
const BUSY = 'Running programs is still being changed.'
const NOT_UNDERSTOOD = 'That change was not understood.'
const NO_BOX = 'The box for running programs could not be made on this PC, so nothing was changed.'
const STOPPED_EARLY = 'The test was stopped before it started. Running programs stays off.'

/** The question before running programs is switched on, after the self-test has passed. */
export function runOnQuestion(report: SelfTestReport, folderName: string | null): SystemQuestion {
  return {
    title: 'Run programs',
    message: 'Let the model ask to run programs?',
    detail: [
      `The box was tested just now on this PC and passed all ${report.lines.length} checks: a program in it cannot read your files, write outside its own copy, reach the network or keep running past its limits.`,
      '',
      `Turning this on lets the model ask, while it answers you, to run ONE program (for example node) on a COPY of a folder of your workspace${folderName === null ? '' : ` (${folderName})`}.`,
      'Every run asks you first, in a window like this one, and shows the program, its arguments, the folder and what the box allows. "Don\'t run it" is the default.',
      'At most 5 runs and 240 seconds of program time in a reply; each run at most 120 seconds and 1 GB. Text files a program changes or makes come back as proposals that you review first.',
      '',
      'You can turn it off again on the Tools page, and "Stop everything" ends a reply that is running one.',
      '',
      ASKED_HERE
    ].join('\n'),
    yes: 'Turn on',
    no: "Don't turn on"
  }
}

/**
 * The tool settings as a reply sees them: the run tool is on only while it is AVAILABLE (switched on, and a self-test of this session passed; the caller adds that a
 * folder is chosen). Without that it is taken out, as if it were off; a file on its own, with the switch on, does not open the box.
 */
export function withPrograms(settings: ToolSettings, available: boolean): ToolSettings {
  if (available) return settings
  const enabled = { ...settings.enabled }
  for (const id of PROGRAM_TOOL_IDS) delete enabled[id]
  return { enabled, caps: settings.caps }
}

export interface ProgramServiceOptions {
  toolSettings: ToolSettingsStore
  gate: QuestionGate
  /** Only the folder and whether it can be used are asked of the workspace. */
  workspace: { status: () => Promise<WorkspaceStatus> }
  /** The box: the runner and the folder of runs, or why there is none. Asked for every test. */
  box: () => Promise<BoxAnswer>
  /** The folders the self-test lays its canaries in and lists. */
  dataDir: string
  tempDir: string
  homeDir: string
  places?: ProgramPlaces
  /** For checks: the self-test (played), and shorter clocks for the real one. */
  selfTest?: (options: SelfTestOptions) => Promise<SelfTestReport>
  timing?: SelfTestOptions['timing']
  now?: () => number
}

export interface ProgramService {
  status(): Promise<ProgramsStatus>
  /** `{ on }` from the page. ON makes the self-test and asks in the system's box (for `owner`); OFF does neither. */
  setOn(owner: unknown, input: unknown): Promise<ProgramsChangeResult>
  /** Whether a reply may run a program now: the switch is on and a self-test of this session passed. */
  available(): Promise<boolean>
  /** At start-up: when the switch is on, the test is made again; if it fails the switch is taken off. Never throws. */
  startUp(): Promise<void>
  /** Ends the self-test that is going on, if one is: the switch stays as it was (off). */
  stopTest(): void
}

const reason = (error: unknown): unknown => (error instanceof Error ? error.message : error)

export function createProgramService(options: ProgramServiceOptions): ProgramService {
  const { gate } = options
  const places = options.places ?? defaultPlaces()
  const now = options.now ?? Date.now
  const selfTest = options.selfTest ?? runSelfTest
  let changing = false
  let testing = false
  /** The test that is going on can be ended by the person (the page's Stop), or when the app closes. */
  let control: AbortController | null = null
  let stoppedByPerson = false
  let lastTest: SelfTestReport | null = null
  let problem: string | null = null

  async function status(): Promise<ProgramsStatus> {
    const tools = await options.toolSettings.read()
    const workspace = await options.workspace.status()
    const node = await resolveProgram('node', places)
    return {
      on: tools.problem === null && tools.settings.enabled[TOOL_ID] === true,
      workspaceReady: workspace.folder !== null && workspace.unusable === null,
      nodeInstalled: node !== null,
      testing,
      test: lastTest,
      problem: tools.problem ?? problem
    }
  }

  /** Makes the self-test now. The report is kept as the last one of this session. */
  async function testNow(): Promise<
    { ok: true; report: SelfTestReport } | { ok: false; error: string; report?: SelfTestReport }
  > {
    // The test counts as going on from the moment it is asked for (making the box takes a second or two), so that the page can show it and the person can stop it.
    testing = true
    stoppedByPerson = false
    const controller = new AbortController()
    control = controller
    try {
      const node = await resolveProgram('node', places)
      if (node === null) return { ok: false, error: NO_NODE }
      const box = await options.box()
      if (!box.ok) return { ok: false, error: `${NO_BOX} (${box.why})` }
      if (controller.signal.aborted) return { ok: false, error: STOPPED_EARLY }
      const report = await selfTest({
        runner: box.runner,
        runRoot: box.runRoot,
        nodePath: node,
        dataDir: options.dataDir,
        tempDir: options.tempDir,
        homeDir: options.homeDir,
        signal: controller.signal,
        now,
        ...(options.timing === undefined ? {} : { timing: options.timing })
      })
      lastTest = report
      return report.ok ? { ok: true, report } : { ok: false, error: failedText(report), report }
    } finally {
      testing = false
      control = null
    }
  }

  const failedText = (report: SelfTestReport): string => {
    if (report.message !== null && report.lines.length === 0) {
      return `The self-test could not be made, so running programs stays off: ${report.message}`
    }
    if (report.message !== null) return `${report.message} Running programs stays off.`
    const bad = report.lines.filter((l) => !l.good).map((l) => l.label.replace(/\.$/, ''))
    return `The self-test did not pass, so running programs stays off. Not as it must be: ${bad.slice(0, 4).join('; ')}${bad.length > 4 ? '; and more' : ''}.`
  }

  const saveFailed = (error: unknown): ProgramsChangeResult => {
    if (error instanceof KeptRefused) return { ok: false, error: error.message }
    console.error('Saving the tool setting for running programs failed:', reason(error))
    return { ok: false, error: 'Your tool settings could not be saved on this computer.' }
  }

  async function write(on: boolean, replace: boolean): Promise<ProgramsChangeResult> {
    const tools = await options.toolSettings.read()
    const settings = replace ? { enabled: {}, caps: tools.settings.caps } : tools.settings
    try {
      await options.toolSettings.write(
        { enabled: { ...settings.enabled, [TOOL_ID]: on }, caps: { ...settings.caps } },
        { replace }
      )
    } catch (error) {
      return saveFailed(error)
    }
    return { ok: true, status: await status() }
  }

  /**
   * The test of this session when the switch is already on (it was on when the app started, or a folder was chosen after that): made in the background, once at a time.
   * A pass makes the tool available; a test that does not pass takes the switch off (less needs no question) and says why. Never throws.
   */
  let background: Promise<void> | null = null
  async function testInBackground(): Promise<void> {
    if (testing || changing) return
    try {
      const tools = await options.toolSettings.read()
      if (tools.problem !== null || tools.settings.enabled[TOOL_ID] !== true) return
      const workspace = await options.workspace.status()
      // A run copies a folder of the workspace, and the box lives on its drive: with no usable folder nothing can be run, and nothing is tested yet.
      if (workspace.folder === null || workspace.unusable !== null) return
      const result = await testNow()
      if (result.ok) {
        problem = null
        return
      }
      // The box does not hold on this PC any more (a Windows update, a security product): the switch is taken off, which does less and needs no question.
      problem = `Running programs was switched off at start-up: ${result.error}`
      await write(false, false)
    } catch (error) {
      console.error('The start-up self-test failed:', reason(error))
      // A test that could not even be made is a test that did not pass: nothing is available, and the switch is taken off rather than tried again at every reply.
      lastTest = {
        at: now(),
        ok: false,
        lines: [],
        ms: 0,
        message: 'The self-test could not be made on this PC.'
      }
      problem = 'Running programs was switched off at start-up: the self-test could not be made.'
      await write(false, false).catch(() => undefined)
    }
  }
  const startUp = (): Promise<void> => {
    if (background === null) {
      background = testInBackground().finally(() => {
        background = null
      })
    }
    return background
  }

  return {
    status,

    stopTest: () => {
      if (control === null) return
      stoppedByPerson = true
      control.abort()
    },

    available: async () => {
      const tools = await options.toolSettings.read()
      if (tools.problem !== null || tools.settings.enabled[TOOL_ID] !== true) return false
      // A switch that is on in the file does not open the box by itself: a test of THIS session has to pass first. When none was made (the app has just started, or
      // the folder was chosen later), it is made now, in the background, and the answer is no until it has passed.
      if (lastTest === null && !testing && !changing && background === null) void startUp()
      return !testing && lastTest !== null && lastTest.ok
    },

    startUp,

    setOn: async (owner, input) => {
      const on =
        typeof input === 'object' && input !== null ? (input as { on?: unknown }).on : undefined
      if (typeof on !== 'boolean') return { ok: false, error: NOT_UNDERSTOOD }
      if (changing || testing) return { ok: false, error: BUSY }
      changing = true
      try {
        const tools = await options.toolSettings.read()
        if (!on) {
          // Off does less: no test, no question. A settings file that cannot be read is kept as a copy and started again with every tool off.
          if (tools.problem !== null) return await write(false, true)
          if (tools.settings.enabled[TOOL_ID] !== true) return { ok: true, status: await status() }
          return await write(false, false)
        }
        if (tools.problem !== null) {
          return {
            ok: false,
            error: `Nothing was changed: your tool settings could not be read (${tools.problem}). Every tool is off. Start again on the Tools page.`
          }
        }
        if (tools.settings.enabled[TOOL_ID] === true) return { ok: true, status: await status() }
        const workspace = await options.workspace.status()
        if (workspace.folder === null || workspace.unusable !== null) {
          return { ok: false, error: NO_FOLDER }
        }
        const tested = await testNow()
        if (!tested.ok) {
          return {
            ok: false,
            error: tested.error,
            // a test the person stopped is not a fault of the box
            ...(stoppedByPerson ? { cancelled: true as const } : {}),
            ...(tested.report === undefined ? {} : { test: tested.report })
          }
        }
        const answer = await gate.ask(owner, runOnQuestion(tested.report, workspace.name))
        if (answer !== 'yes') {
          const error =
            answer === 'busy'
              ? QUESTION_BUSY
              : answer === 'resting'
                ? QUESTION_RESTING
                : answer === 'failed'
                  ? QUESTION_FAILED
                  : NOT_ON
          return {
            ok: false,
            error,
            test: tested.report,
            ...(answer === 'no' || answer === 'stopped' ? { cancelled: true as const } : {})
          }
        }
        // Read again after the wait: what is written is the file as it is now, with the one tool switched on.
        const fresh = await options.toolSettings.read()
        if (fresh.problem !== null) {
          return {
            ok: false,
            error: `Nothing was changed: your tool settings could not be read (${fresh.problem}).`
          }
        }
        problem = null
        const written = await write(true, false)
        return written.ok ? { ...written, test: tested.report } : written
      } finally {
        changing = false
      }
    }
  }
}

/** For the Tools page: how many checks a report has to have to be a whole one. */
export const SELFTEST_LINES = SELFTEST_PROBES.length
