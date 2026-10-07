import {
  ASK_FIRST_DEFAULT_USD,
  askFirstAmount,
  askFirstLoosens,
  checkAskFirstChoice,
  type AskFirstChoice,
  type AskFirstSetting
} from '../shared/askFirst'
import {
  checkLimitsChoice,
  formatMoney,
  limitChange,
  limitsRaise,
  unsetLimits,
  type LimitChoice,
  type Limits,
  type LimitSetting,
  type LimitsChoice
} from '../shared/limits'
import type { AskFirstStore } from './askFirst'
import type { LimitsStore } from './limits'
import {
  QUESTION_BUSY,
  QUESTION_FAILED,
  QUESTION_RESTING,
  type QuestionGate,
  type SystemQuestion
} from './systemQuestion'

// Changing the spending limits and the amount the app asks above (Stage 10.1, D-039), the part of D-033's finding this stage closes: until now the page
// could raise a limit, choose "No limit" or "Never ask" with no answer from the person (`settings.setLimits` and `settings.setAskFirst` needed none), so
// the limits stopped a slip, a bug and a model's words but not a page that was itself hostile. Now a change that lets the app spend MORE is saved only
// after the person's yes in a window of the system's own (systemQuestion.ts), which the page cannot answer. A change that only lowers a limit, or asks
// sooner, is saved at once: it can only make the app send less. No Electron imports, so it is checked under plain Node with played answers.
//
// One change at a time, for both: a second call while one is being asked about or saved is refused at once, not queued (a page that calls a thousand times
// does not get a thousand questions). The value saved is exactly the one the question showed: main's own copy, built field by field from what the page sent.

export type ChangeResult = { ok: true } | { ok: false; error: string; cancelled?: true }

export interface LimitChanges {
  /** Saves the daily and the monthly limit, asking the person first when either would let the app spend more. */
  setLimits(owner: unknown, input: unknown): Promise<ChangeResult>
  /** Saves the amount the app asks above, or "Never ask", asking the person first when the question would come less often. */
  setAskFirst(owner: unknown, input: unknown): Promise<ChangeResult>
}

export interface LimitChangesOptions {
  limitsStore: LimitsStore
  askFirstStore: AskFirstStore
  gate: QuestionGate
}

export const CHANGE_BUSY = 'Another change of a limit is still being saved. Try again in a moment.'
export const LIMITS_NOT_SAVED = 'Not saved: the limits are as they were.'
export const ASK_FIRST_NOT_SAVED = 'Not saved: the amount is as it was.'
/** The last line of every such question: why it is asked here and not in the app's own window. */
export const ASKED_HERE =
  "Frontier App asks this in a window of its own, which the app's page cannot answer: a change that lets the app spend more needs your yes here."

const settingText = (setting: LimitSetting): string =>
  setting.kind === 'usd'
    ? formatMoney(setting.usd)
    : setting.kind === 'none'
      ? 'No limit'
      : 'not chosen'

function limitLine(name: 'Daily' | 'Monthly', current: LimitSetting, next: LimitChoice): string {
  const after = settingText(next)
  const change = limitChange(current, next)
  if (change === 'same') return `${name} limit: ${after} (as now)`
  const before = current.kind === 'unset' ? 'not chosen until now' : `now ${settingText(current)}`
  return `${name} limit: ${after} (${before})`
}

/** The question before a change of the limits that lets the app spend more: what each limit is now and would be, in plain lines. */
export function limitsQuestion(current: Limits, next: LimitsChoice): SystemQuestion {
  const daily = limitChange(current.daily, next.daily) === 'up'
  const monthly = limitChange(current.monthly, next.monthly) === 'up'
  const firstTime = current.daily.kind === 'unset' || current.monthly.kind === 'unset'
  const removes = (daily && next.daily.kind === 'none') || (monthly && next.monthly.kind === 'none')
  let message: string
  let yes: string
  if (firstTime) {
    message = 'Save these spending limits?'
    yes = 'Save the limits'
  } else if (daily && monthly) {
    const both = next.daily.kind === 'none' && next.monthly.kind === 'none'
    message = both ? 'Remove both spending limits?' : 'Raise your spending limits?'
    yes = both ? 'Remove both limits' : 'Raise the limits'
  } else {
    const name = daily ? 'daily' : 'monthly'
    const choice = daily ? next.daily : next.monthly
    message =
      choice.kind === 'none'
        ? `Remove your ${name} spending limit?`
        : `Raise your ${name} spending limit to ${formatMoney(choice.usd)}?`
    yes = choice.kind === 'none' ? 'Remove the limit' : 'Raise the limit'
  }
  const lines = [
    limitLine('Daily', current.daily, next.daily),
    limitLine('Monthly', current.monthly, next.monthly),
    ''
  ]
  if (removes) {
    lines.push(
      "With No limit, nothing in this app stops spending in that period; only a limit in your provider's own account would.",
      ''
    )
  }
  lines.push(ASKED_HERE)
  return { title: 'Spending limits', message, detail: lines.join('\n'), yes, no: 'Cancel' }
}

/** The question before the app asks less often before a large request: the amount in force now, and what it would be. */
export function askFirstQuestion(current: AskFirstSetting, next: AskFirstChoice): SystemQuestion {
  const now = askFirstAmount(current) ?? ASK_FIRST_DEFAULT_USD
  const nowText =
    current.kind === 'default'
      ? `${formatMoney(now)}, the default, as you have not chosen an amount`
      : formatMoney(now)
  const before = `Now the app asks before sending a request whose input could cost more than ${nowText}.`
  const limitsStill = 'Your spending limits still stop a request that would pass them.'
  if (next.kind === 'never') {
    return {
      title: 'Large requests',
      message: 'Stop asking before large requests?',
      detail: `${before} With Never ask, a request is sent without this question, however large it is. ${limitsStill}\n\n${ASKED_HERE}`,
      yes: 'Never ask',
      no: 'Cancel'
    }
  }
  const after = formatMoney(next.usd)
  return {
    title: 'Large requests',
    message: `Ask before a large request only above ${after}?`,
    detail: `${before} After this it asks only above ${after}. ${limitsStill}\n\n${ASKED_HERE}`,
    yes: `Ask above ${after}`,
    no: 'Cancel'
  }
}

const reason = (error: unknown): unknown => (error instanceof Error ? error.message : error)

export function createLimitChanges(options: LimitChangesOptions): LimitChanges {
  const { limitsStore, askFirstStore, gate } = options
  let changing = false

  /** Runs one change, or refuses at once when another is being asked about or saved. */
  async function oneAtATime(run: () => Promise<ChangeResult>): Promise<ChangeResult> {
    if (gate.open()) return { ok: false, error: QUESTION_BUSY }
    if (changing) return { ok: false, error: CHANGE_BUSY }
    changing = true
    try {
      return await run()
    } finally {
      changing = false
    }
  }

  /** The person's answer, as a refusal to hand back, or null for a yes. */
  async function askFirst(
    owner: unknown,
    question: SystemQuestion,
    notSaved: string
  ): Promise<ChangeResult | null> {
    const answer = await gate.ask(owner, question)
    if (answer === 'yes') return null
    if (answer === 'busy') return { ok: false, error: QUESTION_BUSY }
    if (answer === 'resting') return { ok: false, error: QUESTION_RESTING }
    if (answer === 'failed') return { ok: false, error: QUESTION_FAILED }
    return { ok: false, cancelled: true, error: notSaved }
  }

  return {
    setLimits: (owner, input) => {
      const check = checkLimitsChoice(input) // never trust what the page sends: main's own copy, field by field
      if (!check.ok) return Promise.resolve(check)
      const next = check.limits
      return oneAtATime(async () => {
        // A file that cannot be read counts as "not chosen" here (it refuses every request), so any choice is asked about.
        const current = await limitsStore.read().catch(() => unsetLimits())
        if (limitsRaise(current, next)) {
          const refused = await askFirst(owner, limitsQuestion(current, next), LIMITS_NOT_SAVED)
          if (refused !== null) return refused
        }
        try {
          await limitsStore.save(next)
        } catch (error) {
          // Logged here only; the message could name a file path.
          console.error('Saving the limits failed:', reason(error))
          return { ok: false, error: 'The limits could not be saved on this computer.' }
        }
        return { ok: true }
      })
    },

    setAskFirst: (owner, input) => {
      const check = checkAskFirstChoice(input)
      if (!check.ok) return Promise.resolve(check)
      const next = check.choice
      return oneAtATime(async () => {
        const current = await askFirstStore.read() // never throws: damage reads as the default
        if (askFirstLoosens(current, next)) {
          const refused = await askFirst(
            owner,
            askFirstQuestion(current, next),
            ASK_FIRST_NOT_SAVED
          )
          if (refused !== null) return refused
        }
        try {
          await askFirstStore.save(next)
        } catch (error) {
          // Logged here only; the message could name a file path.
          console.error('Saving the ask-first choice failed:', reason(error))
          return { ok: false, error: 'The choice could not be saved on this computer.' }
        }
        return { ok: true }
      })
    }
  }
}
