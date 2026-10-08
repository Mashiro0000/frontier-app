import { TOOL_CAPS_BOUNDS, TOOL_CAPS_DEFAULT, type ToolCaps } from '../shared/tools'

// What one reply may use of tools (Stage 11.1, D-041): a number of steps and an amount of working time, counted in one place so that no reply can go on
// for ever. A step is one tool call the model makes, whatever becomes of it (a call that is refused, or that the person says no to, counts too: a
// model that keeps asking for something that does not exist is stopped by the same cap). The time is WORKING time: the clock stops while the person
// is deciding in the approval box, otherwise a slow reader would use the cap up before saying yes. The clock is monotonic, so changing the computer's
// time cannot give a reply more of it. No Electron imports.

export type BudgetAnswer = 'ok' | 'step-cap' | 'time-cap'

export interface ReplyBudget {
  /** Counts one tool call and says whether the reply may make it. Once a cap is reached it says so every time and counts nothing more. */
  take(): BudgetAnswer
  /** Stops the clock (the person is deciding). Pauses count: the clock runs again only when every pause has been resumed. */
  pause(): void
  /** Ends one pause. Resuming a clock that is not paused does nothing. */
  resume(): void
  /** The working milliseconds left; 0 when the time is used. */
  remainingMs(): number
  used(): { steps: number; workingMs: number }
  readonly caps: Readonly<ToolCaps>
}

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
  now: () => number = () => performance.now()
): ReplyBudget {
  const caps = Object.freeze(sensibleCaps(input))
  const started = now()
  let steps = 0
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
    take: () => {
      if (steps >= caps.steps) return 'step-cap'
      if (workingMs() >= limitMs) return 'time-cap'
      steps++
      return 'ok'
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
    used: () => ({ steps, workingMs: workingMs() })
  }
}
