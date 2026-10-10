// Running programs, the part that main and (from 13.5) the window share (Stage 13, D-043): what the self-test checks and says, and what main tells the Tools page about the
// "Run programs" switch. Plain types and constants; nothing here decides anything. The decisions are main's (programService.ts, selfTest.ts). No Electron imports.

/**
 * The ids of the tools that the one "Run programs" switch turns on and off (13.5). The generic list of tools on the Tools page does not list them and its switch
 * cannot change them: switching on needs the self-test, which only the program service makes.
 */
export const PROGRAM_TOOL_IDS: readonly string[] = ['run_program']

/**
 * What the self-test checks, in the order it says it (13.5). Each line is a thing a boxed program must NOT be able to do, except `ran` and `own`, which are the
 * checks that the test is not passing for nothing: a program that never started, or cannot even write in its own folder, would "fail to read a canary" too.
 */
export const SELFTEST_PROBES = [
  { id: 'ran', label: 'A program starts in the box and says what it is told' },
  { id: 'own', label: 'It can read and write in its own copy of the folder' },
  { id: 'read-data', label: "It cannot read a file in this app's data folder" },
  { id: 'read-temp', label: 'It cannot read a file in your temp folder' },
  { id: 'list-home', label: 'It cannot even list your user folder' },
  { id: 'write-data', label: "It cannot write in this app's data folder" },
  {
    id: 'write-launcher',
    label: "It cannot change the launcher's folder or the program copy it runs from"
  },
  { id: 'network', label: 'It cannot reach the network, not even this computer' },
  { id: 'environment', label: 'It starts with an empty environment: no keys, no profile folders' },
  { id: 'time', label: 'A program that never stops is ended by its clock' },
  { id: 'memory', label: 'A program that asks for too much memory is ended at its limit' },
  { id: 'clean', label: 'Nothing of it is left running or mounted afterwards' }
] as const
export type SelfTestId = (typeof SELFTEST_PROBES)[number]['id']

/** One line of the report: `good` is true when the box did what it must (the thing was stopped, or the program ran as it should). */
export interface SelfTestLine {
  id: SelfTestId
  label: string
  good: boolean
  /** A short plain sentence about what was seen; never a path or a secret. */
  detail: string
}

export interface SelfTestReport {
  /** When it was made (milliseconds since 1970). */
  at: number
  /** True only when EVERY line is good. */
  ok: boolean
  lines: SelfTestLine[]
  /** How long the test took, in milliseconds. */
  ms: number
  /** Why the test could not be made at all (no Node.js, the box could not be made), or null. The lines are then empty or partial. */
  message: string | null
}

/** What main says about running programs (13.5). */
export interface ProgramsStatus {
  /** The switch: the tool is on in the person's settings. */
  on: boolean
  /** A workspace folder is chosen and can be used now (a run copies a folder of it). */
  workspaceReady: boolean
  /** An installed Node.js was found (the program a run can use besides the Windows ones, and what the self-test runs). */
  nodeInstalled: boolean
  /** A self-test is going on now. */
  testing: boolean
  /** The last self-test of this session, or null (none yet since the app started). */
  test: SelfTestReport | null
  /** The tool settings could not be read (nothing can be switched on), or the box is unavailable: a sentence, or null. */
  problem: string | null
}

/** The answer to a change. `cancelled`: the person said no in the system's message box. `test` is given when a self-test was made, passed or not. */
export type ProgramsChangeResult =
  | { ok: true; status: ProgramsStatus; test?: SelfTestReport }
  | { ok: false; error: string; cancelled?: true; test?: SelfTestReport }
