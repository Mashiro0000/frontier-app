// Stage 13 (D-043): running a program in a box. The numbers that bound a run and the shapes that go in and come out, as plain data with no
// Electron and no Node imports, so that main, the tool (13.4) and the checks all read one set of numbers. Nothing here runs anything.

const MIB = 1024 * 1024

/** The most a single run may use, and the least that makes sense. The launcher holds the same maxima for itself (commandLauncher.ps1). */
export const RUN_LIMITS = {
  /** The program's own clock, started when the box lets it run (making the box takes about a second and is not counted). */
  timeoutMs: { min: 100, max: 120_000, default: 120_000 },
  /** A job-wide limit: the sum over every process of the run. */
  memoryBytes: { min: 16 * MIB, max: 1024 * MIB, default: 1024 * MIB },
  maxProcesses: { min: 1, max: 64, default: 64 },
  /** Bytes kept of each of the two output streams (the rest is counted and thrown away). */
  outputBytes: { min: 1, max: 65_536, default: 65_536 },
  /** Characters of output that go back to the model, in all, for one run. */
  modelChars: 20_000,
  /** In one reply: runs, and their clocks together. */
  runsPerReply: 5,
  msPerReply: 240_000,
  /** The copy of the workspace the program works on. */
  copyFiles: 20_000,
  copyBytes: 100 * MIB
} as const

/** The arguments of a program: the box shows them as they are, so they are bounded. */
export const RUN_ARGS = { count: 100, charsEach: 8192, charsTotal: 30_000 } as const

/** What a caller asks for. Every field is checked (commandRunner.ts); a field more or less is a refusal. */
export interface RunRequest {
  /** The full path of an .exe: under the Windows folder, or the installed node.exe (a private copy of which is what runs). */
  program: string
  args: string[]
  /** The folder the program works in (a copy of the workspace, 13.3): inside the run root, not a link. */
  scratchDir: string
  timeoutMs?: number
  memoryBytes?: number
  maxProcesses?: number
  outputBytes?: number
}

export type NotRunWhy =
  | 'refused' // the request was not acceptable; nothing was started
  | 'launcher-modified' // the launcher on disk is not the one inside the app and could not be put right
  | 'isolation-unavailable' // the box could not be made on this PC (a policy, a security product, a Windows without it): nothing ran
  | 'launcher-failed' // the launcher died, said something we do not understand, or refused the spec
  | 'launcher-timeout' // the launcher did not finish in the time it was given (it was ended)
  | 'aborted' // Stop everything, or the app was closing

export type RunOutcome =
  | {
      kind: 'ran'
      /** The program's exit code as Windows gives it (a crash is a big number such as 3221225477). */
      exitCode: number
      /** The clock ended it. */
      timedOut: boolean
      elapsedMs: number
      stdout: string
      stderr: string
      /** How many bytes the program wrote; `stdout`/`stderr` hold at most the first `outputBytes` of them. */
      stdoutBytes: number
      stderrBytes: number
      peakMemoryBytes: number
      /** How many processes were still running when the run ended (they were ended with it). */
      leftoverKilled: number
      /** Processes still alive after the box was ended: must be 0. */
      leftoverAfter: number
    }
  | { kind: 'not-run'; why: NotRunWhy; message: string }
