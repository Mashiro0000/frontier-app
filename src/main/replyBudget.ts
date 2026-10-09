import { TOOL_CAPS_BOUNDS, TOOL_CAPS_DEFAULT, type ToolCaps } from '../shared/tools'
import { WORKSPACE_LIMITS } from '../shared/workspace'

// What one reply may use of tools (Stage 11.1, D-041): a number of steps and an amount of working time, counted in one place so that no reply can go on
// for ever. A step is one tool call the model makes, whatever becomes of it (a call that is refused, or that the person says no to, counts too: a
// model that keeps asking for something that does not exist is stopped by the same cap). The time is WORKING time: the clock stops while the person
// is deciding in the approval box, otherwise a slow reader would use the cap up before saying yes. The clock is monotonic, so changing the computer's
// time cannot give a reply more of it. Since 12.2 a reply also has FILE calls (a list, a read, a proposal) with a count of their own and a total of
// characters they may bring back, so that a project can be explored without using up the steps of a web search (and the other way round); both kinds share
// the working time. No Electron imports.

export type BudgetAnswer = 'ok' | 'step-cap' | 'time-cap'
export type FileBudgetAnswer = 'ok' | 'file-cap' | 'time-cap'

export interface ReplyBudget {
  /** Counts one tool call and says whether the reply may make it. Once a cap is reached it says so every time and counts nothing more. */
  take(): BudgetAnswer
  /** Counts one FILE call (12.2) and says whether the reply may make it: the same rules, with the file calls' own count. */
  takeFile(): FileBudgetAnswer
  /** The characters of file text this reply may still be given. */
  charsLeft(): number
  /** Counts file text that was handed to the model. */
  useChars(count: number): void
  /** Stops the clock (the person is deciding). Pauses count: the clock runs again only when every pause has been resumed. */
  pause(): void
  /** Ends one pause. Resuming a clock that is not paused does nothing. */
  resume(): void
  /** The working milliseconds left; 0 when the time is used. */
  remainingMs(): number
  /** `calls` is every call so far, of either kind: the number a call is given in the record. */
  used(): { steps: number; fileCalls: number; calls: number; chars: number; workingMs: number }
  readonly caps: Readonly<ToolCaps>
  readonly fileCaps: Readonly<FileCaps>
}

/** What a reply may use of file calls (the plan, D6). Fixed for now: 12.3 puts them in the settings, and a raise asks in the system's box. */
export interface FileCaps {
  calls: number
  chars: number
}

export const FILE_CAPS_DEFAULT: Readonly<FileCaps> = Object.freeze({
  calls: WORKSPACE_LIMITS.maxFileCalls,
  chars: WORKSPACE_LIMITS.maxFileChars
})

const inRange = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max

/**
 * The caps to count with: the saved ones when both are whole numbers inside the bounds Settings allows, otherwise the defaults. A damaged or edited
 * value therefore never gives a reply MORE than the person could have chosen, and never fewer than one step.
 */
export function sensibleCaps(input: unknown): ToolCaps {
  const caps = (input ?? {}) as Partial<Record<keyof ToolCaps, unknown>>
  const { steps, seconds } = TOOL_CAPS_BOUNDS
  return {
    steps: inRange(caps.steps, steps.min, steps.max) ? caps.steps : TOOL_CAPS_DEFAULT.steps,
    seconds: inRange(caps.seconds, seconds.min, seconds.max)
      ? caps.seconds
      : TOOL_CAPS_DEFAULT.seconds
  }
}

/** `now` is handed in only so that the checks can move the clock; by default it is the monotonic one. */
export function createReplyBudget(
  input: unknown,
  now: () => number = () => performance.now(),
  fileCaps: Readonly<FileCaps> = FILE_CAPS_DEFAULT
): ReplyBudget {
  const caps = Object.freeze(sensibleCaps(input))
  const files = Object.freeze({ calls: fileCaps.calls, chars: fileCaps.chars })
  const started = now()
  let steps = 0
  let fileCalls = 0
  let chars = 0
  let pausedFor = 0
  let pausedAt = 0
  // A count, not a flag: two calls of one reply can have a question open at the same time (the second is refused as "busy", but it still pauses and
  // resumes), and the clock must stay stopped until the person has answered the FIRST.
  let pauses = 0

  const workingMs = (): number => {
    const t = now()
    const paused = pausedFor + (pauses > 0 ? t - pausedAt : 0)
    return Math.max(0, t - started - paused)
  }
  const limitMs = caps.seconds * 1000

  return {
    caps,
    fileCaps: files,
    take: () => {
      if (steps >= caps.steps) return 'step-cap'
      if (workingMs() >= limitMs) return 'time-cap'
      steps++
      return 'ok'
    },
    takeFile: () => {
      if (fileCalls >= files.calls) return 'file-cap'
      if (workingMs() >= limitMs) return 'time-cap'
      fileCalls++
      return 'ok'
    },
    charsLeft: () => Math.max(0, files.chars - chars),
    useChars: (count) => {
      if (Number.isFinite(count) && count > 0) chars += Math.floor(count)
    },
    pause: () => {
      if (pauses === 0) pausedAt = now()
      pauses++
    },
    resume: () => {
      if (pauses === 0) return // nothing was paused
      pauses--
      if (pauses === 0) pausedFor += now() - pausedAt
    },
    remainingMs: () => Math.max(0, limitMs - workingMs()),
    used: () => ({
      steps,
      fileCalls,
      calls: steps + fileCalls,
      chars,
      workingMs: workingMs()
    })
  }
}
