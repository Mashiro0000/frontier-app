import { promises as fs } from 'fs'
import { win32 } from 'path'
import { createCommandRunner, type CommandRunner } from './commandRunner'
import { chooseRunRoot, runRootCandidates, sweepStartup } from './scratchCopy'

// Where the box lives (Stage 13.5, D-043): the folder of runs (`FrontierRun`, at the root of the workspace's own drive when it can be used, else in the system's temp
// folder: scratchCopy.ts `chooseRunRoot`) and the runner over it (commandRunner.ts). It is made when the first test or run needs it, once for each folder, because the
// workspace can be changed to a folder on another drive. At start-up the folders that already exist are swept: a scratch copy, a spec file or a drive letter that a crash
// left behind goes (only what the app made: scratchCopy.ts `sweepStartup`). No Electron imports: the folders are handed in.

export type BoxAnswer =
  { ok: true; runner: CommandRunner; runRoot: string } | { ok: false; why: string }

export interface ProgramBox {
  /** The runner and the run folder for the workspace as it is now, or why there is none. */
  get(): Promise<BoxAnswer>
  /** Ends every run that is going on (the app is closing). Synchronous on purpose. */
  stopAll(): void
  /** At start-up: takes away what a crash left behind in the run folders that exist. Never throws. */
  sweep(): Promise<void>
}

export interface ProgramBoxOptions {
  /** The workspace folder as it really is, or null when none is chosen. */
  workspaceRoot: () => string | null
  /** The system's temp folder. */
  tempDir: string
  /**
   * For testing the whole path in the real window without making a folder at the root of a drive (ipc.ts reads FRONTIER_RUN_ROOT, from source only, never in an installed
   * app): the one folder of runs to use instead of the usual places. A value that is not an absolute path of a folder below a drive's root is ignored.
   */
  fixedRunRoot?: () => string | null
  /** For checks: how the runner is made (the app uses the real one). */
  makeRunner?: typeof createCommandRunner
}

/** A fixed folder of runs is used only when it is an ordinary absolute folder below a drive (never a drive's root, never a network path). */
function usableFixed(value: string | null | undefined): string | null {
  if (typeof value !== 'string' || value === '' || value.includes('\0')) return null
  if (!win32.isAbsolute(value) || /^[\\/]{2}/.test(value) || !/^[A-Za-z]:/.test(value)) return null
  const resolved = win32.resolve(value)
  return win32.dirname(resolved) === resolved ? null : resolved
}

export function createProgramBox(options: ProgramBoxOptions): ProgramBox {
  const make = options.makeRunner ?? createCommandRunner
  const runners = new Map<string, CommandRunner>()

  const candidates = (): string[] => {
    const fixed = usableFixed(options.fixedRunRoot?.())
    if (fixed !== null) return [fixed]
    const root = options.workspaceRoot()
    // with no workspace the temp folder is the only candidate; the folder name is the same everywhere
    return root === null
      ? [win32.join(win32.resolve(options.tempDir), 'FrontierRun')]
      : runRootCandidates(root, options.tempDir)
  }

  return {
    get: async () => {
      const chosen = await chooseRunRoot(candidates())
      if (!chosen.ok) return { ok: false, why: chosen.message }
      let runner = runners.get(chosen.root.toLowerCase())
      if (runner === undefined) {
        try {
          runner = make({ runRoot: chosen.root })
        } catch (error) {
          return {
            ok: false,
            why: error instanceof Error ? error.message : 'the runner could not be made'
          }
        }
        runners.set(chosen.root.toLowerCase(), runner)
      }
      return { ok: true, runner, runRoot: chosen.root }
    },

    stopAll: () => {
      for (const runner of runners.values()) {
        try {
          runner.stopAll()
        } catch {
          /* ending the rest matters more */
        }
      }
    },

    sweep: async () => {
      for (const root of candidates()) {
        try {
          await fs.access(root)
        } catch {
          continue // no folder of runs there: nothing was left behind
        }
        try {
          await sweepStartup(root)
        } catch (error) {
          console.error(
            'Sweeping the folder of runs failed:',
            error instanceof Error ? error.message : error
          )
        }
      }
    }
  }
}
