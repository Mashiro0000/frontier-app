// Spending limits (Stage 8.2, D-031): the pure part. No Electron and nothing only Node has, because the page (to check what is typed and to
// draw the figures) and the preload (it bundles the shared contract) use it too. The file the limits are kept in is main's
// (src/main/limits.ts), and the check that stops a request is main's (src/main/chat.ts, through the ledger); everything here is arithmetic,
// reading and wording, so a plain-Node suite can run it.
//
// There are no preset numbers (the owner's decision of 2 October 2026): until the person has chosen BOTH a daily and a monthly limit,
// every request is refused. "No limit" is a choice like any other, made on purpose, and is kept apart from "not chosen yet".

/** The most a limit can be set to, in US dollars. Past that, "No limit" says what is meant. */
export const LIMIT_MAX_USD = 10_000

/** One limit as the app holds it: not chosen yet (requests are refused), deliberately none, or an amount in US dollars. */
export type LimitSetting = { kind: 'unset' } | { kind: 'none' } | { kind: 'usd'; usd: number }

export interface Limits {
  /** What may be spent in a day, by the computer's clock (midnight to midnight). */
  daily: LimitSetting
  /** What may be spent in a month, by the computer's clock (the first to the last). */
  monthly: LimitSetting
}

/** What the page may hand over for one limit: never "unset", which is only what is there before anyone has chosen. */
export type LimitChoice = { kind: 'none' } | { kind: 'usd'; usd: number }

export interface LimitsChoice {
  daily: LimitChoice
  monthly: LimitChoice
}

export const unsetLimits = (): Limits => ({ daily: { kind: 'unset' }, monthly: { kind: 'unset' } })

/** True when both limits have been chosen, whether as an amount or as "No limit". Requests are refused until then. */
export const limitsAreSet = (limits: Limits): boolean =>
  limits.daily.kind !== 'unset' && limits.monthly.kind !== 'unset'

/** An amount a limit may be: more than nothing, at most LIMIT_MAX_USD, in whole cents. */
export const isLimitAmount = (value: unknown): value is number =>
  typeof value === 'number' &&
  Number.isFinite(value) &&
  value > 0 &&
  value <= LIMIT_MAX_USD &&
  Math.round(value * 100) / 100 === value

const sameSetting = (a: LimitSetting, b: LimitSetting): boolean =>
  a.kind === b.kind && (a.kind !== 'usd' || (b.kind === 'usd' && a.usd === b.usd))

export const sameLimits = (a: Limits, b: Limits): boolean =>
  sameSetting(a.daily, b.daily) && sameSetting(a.monthly, b.monthly)

/**
 * How one limit would change if the person's choice were saved (Stage 10.1, D-039): 'up' when the app could then spend MORE in that period than it can
 * now. "Not chosen" refuses every request, so any choice made from it is 'up'; so is "No limit" from an amount, and a higher amount. Compared in whole
 * cents, so float noise cannot decide.
 */
export function limitChange(current: LimitSetting, next: LimitChoice): 'up' | 'same' | 'down' {
  if (current.kind === 'unset') return 'up'
  if (current.kind === 'none') return next.kind === 'none' ? 'same' : 'down'
  if (next.kind === 'none') return 'up'
  const now = Math.round(current.usd * 100)
  const after = Math.round(next.usd * 100)
  return after > now ? 'up' : after < now ? 'down' : 'same'
}

/**
 * True when saving `next` would let the app spend more in a day or in a month than it may now. Main then asks the person first, in a window of the
 * system's own that the page cannot answer (D-039); a choice that only lowers a limit, or keeps it, is saved without that question.
 */
export const limitsRaise = (current: Limits, next: LimitsChoice): boolean =>
  limitChange(current.daily, next.daily) === 'up' ||
  limitChange(current.monthly, next.monthly) === 'up'

// --- What the person types ---------------------------------------------------------------------------------------------------

export type LimitTextCheck = { ok: true; usd: number } | { ok: false; error: string }

/** Reads an amount typed into a limit's box: "5", "5.5", "$12.50". At most two decimals, more than nothing, at most LIMIT_MAX_USD. */
export function parseLimitText(text: string): LimitTextCheck {
  const typed = text.trim()
  if (typed === '') return { ok: false, error: 'Type an amount, or choose No limit.' }
  const match = /^\$?\s*(\d{1,6})(?:\.(\d{1,2}))?$/.exec(typed)
  if (!match) {
    return {
      ok: false,
      error: 'Type an amount in dollars, like 5 or 12.50 (no more than two decimals).'
    }
  }
  const usd = Number(match[2] === undefined ? match[1] : `${match[1]}.${match[2]}`)
  if (!(usd > 0)) return { ok: false, error: 'A limit must be more than $0.' }
  if (usd > LIMIT_MAX_USD) {
    return {
      ok: false,
      error: `The most a limit can be is $${LIMIT_MAX_USD.toLocaleString('en-US')}. Choose No limit if you mean none.`
    }
  }
  return { ok: true, usd }
}

// --- What the page hands over ------------------------------------------------------------------------------------------------

export type LimitsCheck = { ok: true; limits: LimitsChoice } | { ok: false; error: string }

const NOT_UNDERSTOOD = 'The limits were not understood.'

function checkOne(input: unknown): LimitChoice | null {
  if (typeof input !== 'object' || input === null) return null
  const { kind, usd } = input as Record<string, unknown>
  if (kind === 'none') return { kind: 'none' } // nothing else it carries is read
  if (kind === 'usd' && isLimitAmount(usd)) return { kind: 'usd', usd }
  return null
}

/**
 * Checks "save these limits" from the page: both must be given, each either "No limit" or an amount in whole cents between $0.01 and
 * LIMIT_MAX_USD. The value handed back is main's own, built field by field, so nothing else the page sends (an extra field, an object
 * that prints as a number) is kept. "Not chosen" is not something the page can send: it can only choose, not take a choice back.
 */
export function checkLimitsChoice(input: unknown): LimitsCheck {
  if (typeof input !== 'object' || input === null) return { ok: false, error: NOT_UNDERSTOOD }
  const { daily, monthly } = input as Record<string, unknown>
  const checkedDaily = checkOne(daily)
  const checkedMonthly = checkOne(monthly)
  if (checkedDaily === null || checkedMonthly === null) return { ok: false, error: NOT_UNDERSTOOD }
  return { ok: true, limits: { daily: checkedDaily, monthly: checkedMonthly } }
}

// --- The file ----------------------------------------------------------------------------------------------------------------

/** What is written to limits.json, so that a person can read it: `{"version":1,"daily":5,"monthly":"none"}`. A limit not chosen is left out. */
export function limitsFileText(limits: Limits): string {
  const stored: Record<string, unknown> = { version: 1 }
  for (const name of ['daily', 'monthly'] as const) {
    const setting = limits[name]
    if (setting.kind === 'usd') stored[name] = setting.usd
    else if (setting.kind === 'none') stored[name] = 'none'
  }
  return JSON.stringify(stored)
}

/**
 * Reads what limits.json holds. Forgiving the safe way: a field that is missing, or is not an amount this app could have written, is
 * "not chosen", so a damaged file never lets a request through that a good one would have refused. Each field stands alone, so one bad
 * field does not cost the other. `damaged` says whether anything was wrong (for the log); a file that holds no JSON at all is damaged too.
 */
export function parseLimitsFile(text: string): { limits: Limits; damaged: boolean } {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { limits: unsetLimits(), damaged: true }
  }
  if (typeof raw !== 'object' || raw === null || (raw as { version?: unknown }).version !== 1) {
    return { limits: unsetLimits(), damaged: true }
  }
  const fields = raw as Record<string, unknown>
  let damaged = false
  const settingOf = (value: unknown): LimitSetting => {
    if (value === undefined) return { kind: 'unset' }
    if (value === 'none') return { kind: 'none' }
    if (isLimitAmount(value)) return { kind: 'usd', usd: value }
    damaged = true
    return { kind: 'unset' }
  }
  return { limits: { daily: settingOf(fields.daily), monthly: settingOf(fields.monthly) }, damaged }
}

// --- The check before a request ----------------------------------------------------------------------------------------------

/** What has been spent (US dollars, by the app's own count: requests still on their way are in it), and what the request will cost at least. */
export interface Spend {
  today: number
  month: number
  /** This request's input, at list price: the least it will cost. Its reply is not known yet. */
  request: number
}

/** 5 -> "$5.00", 0.0041 -> "$0.0041" (a fraction of a cent keeps four places), 0 -> "$0.00". */
export function formatMoney(dollars: number): string {
  if (dollars === 0) return '$0.00'
  if (dollars < 0.0001) return 'less than $0.0001'
  if (dollars < 0.01) return `$${dollars.toFixed(4)}`
  return `$${dollars.toFixed(2)}`
}

/**
 * A limit's refusal of a request that carries files (D-037), with one sentence more: they are part of every request of the chat. Unchanged for a
 * request without files, and for "no limits are set yet" (which is not about what the request costs).
 */
export function withFilesNote(
  refusal: string | null,
  files: { count: number; tokens: number; project?: number } | undefined
): string | null {
  if (
    refusal === null ||
    refusal === LIMITS_UNSET_MESSAGE ||
    files === undefined ||
    files.count === 0
  )
    return refusal
  const which =
    files.count === 1
      ? 'The file in this chat is'
      : `The ${files.count.toLocaleString('en-US')} files in this chat are`
  const base = `${refusal} ${which} about ${files.tokens.toLocaleString('en-US')} tokens of it: every file in a chat is sent again with each message, so a new chat without ${files.count === 1 ? 'it' : 'them'} costs less.`
  // A project's files (D-039) go with every message of every chat in it: a new chat in the same project does not leave them out.
  const project = files.project ?? 0
  return project === 0
    ? base
    : `${base} ${project === files.count ? (project === 1 ? 'It is' : 'They are') : `${project.toLocaleString('en-US')} of them are`} the project's, which go with every message of each of its chats.`
}

export const LIMITS_UNSET_MESSAGE =
  'Nothing was sent: no spending limits are set yet. Open Settings, set a daily and a monthly limit (or choose No limit), and try again.'

/**
 * Whether a request may go out, as the sentence that refuses it, or null when it may. Run by main, inside the ledger's own turn (so two
 * requests cannot both pass on the same remaining money), before the request is sent.
 *
 *  - Limits that are not both chosen refuse everything.
 *  - A limit refuses when what has been spent, plus this request's own input, is MORE than the limit (an amount exactly at the limit may
 *    go). A request that finds the limit already reached is refused too, since its input alone passes it.
 *  - "No limit" never refuses.
 *
 * What is not known before the reply is how long the reply will be, so a request that starts under a limit can end over it, by at most
 * what one reply can write (D-031 says how much). That is the one way past the limit.
 */
export function checkAgainstLimits(limits: Limits, spend: Spend): string | null {
  if (!limitsAreSet(limits)) return LIMITS_UNSET_MESSAGE
  const parts: string[] = []
  const tails: string[] = []
  const { daily, monthly } = limits
  if (daily.kind === 'usd' && spend.today + spend.request > daily.usd) {
    parts.push(
      spend.today >= daily.usd
        ? `you have reached your daily limit of ${formatMoney(daily.usd)} (${formatMoney(spend.today)} so far today)`
        : `this would take today's spending past your daily limit of ${formatMoney(daily.usd)} (${formatMoney(spend.today)} so far)`
    )
    tails.push("today's count starts again at midnight")
  }
  if (monthly.kind === 'usd' && spend.month + spend.request > monthly.usd) {
    parts.push(
      spend.month >= monthly.usd
        ? `you have reached your monthly limit of ${formatMoney(monthly.usd)} (${formatMoney(spend.month)} so far this month)`
        : `this would take this month's spending past your monthly limit of ${formatMoney(monthly.usd)} (${formatMoney(spend.month)} so far)`
    )
    tails.push("this month's count starts again on the 1st")
  }
  if (parts.length === 0) return null
  return `Nothing was sent: ${parts.join(', and ')}. You can raise ${parts.length === 1 ? 'the limit' : 'a limit'} in Settings (${tails.join(', ')}).`
}
