import { randomUUID } from 'crypto'
import { promises as fs } from 'fs'
import { dirname } from 'path'
import type { Spend } from '../shared/limits'
import type { Effort, ModelPricing, ProviderId } from '../shared/registry'
import {
  costOf,
  ledgerLine,
  NO_TOKENS,
  parseLedgerRecord,
  summarize,
  type LedgerRecord,
  type LedgerState,
  type SearchFee,
  type AudioFee,
  type TokenCounts,
  type UsageSummary
} from '../shared/usage'

// The usage ledger (Stage 8.1, D-030): one line of JSON for every request sent to a provider, in one plain file the owner can open.
// No Electron imports, so it can be checked under plain Node with any folder.
//
// It is appended to and never rewritten, which suits a log of money: a crash can only cut off the last line, and a cut line is
// skipped when the file is read (and the next write starts on a new line, so it cannot join the cut one). Writing follows D-010 (no
// temp file and rename: every rename fails with EXDEV in this project's own EFS-encrypted %APPDATA%). A request is written TWICE,
// under one id: when it is about to be sent (`begin`: its input, as an estimate) and when it ends (`finish`: the provider's own
// report, or a guess marked as one). The later line replaces the earlier one when the file is read, so a real report replaces a
// guess, and a request that never ended (the app was killed) still counts for what it had cost by then.
//
// `begin` is awaited BEFORE the request goes out and throws if the line cannot be written: a request that cannot be counted is not
// sent (the limit of 8.2 depends on this). `finish` never throws: the reply has already happened, so a failure to write its end is
// logged, and the sums in memory are right for as long as the app runs.
//
// The spending limit (Stage 8.2, D-031) is checked INSIDE `begin`, in the same turn as the write: the sums it is checked against and the
// line that adds the request to them cannot be separated by another request, so two requests cannot both pass on the same remaining
// money. The ledger does not know what a limit is: it is handed a check, which answers with a sentence that refuses or with null.

/** More than this is not read: the newest part of the file is, and the oldest records are left out of the sums (and logged). */
export const LEDGER_LIMITS = { maxFileBytes: 64 * 1024 * 1024 } as const

export interface BeginInput {
  chat: string | null
  provider: ProviderId
  model: string
  effort: Effort | null
  /** The prices the cost will be worked out with, from the registry as it is now. */
  prices: ModelPricing
  /** A guess at the request's input tokens (`estimateInputTokens`). */
  inputTokens: number
  /** Money this request may cost beyond its tokens (11.6: the fee of a search), counted in the check against the limits. */
  reserveUsd?: number
  /** (15.5) A clip of speech to text: the fee it is reserved at. It is kept in the record, so a request that never ends still counts for it. */
  audio?: AudioFee
}

export interface FinishInput {
  state: Exclude<LedgerState, 'sent'>
  tokens: TokenCounts
  estimate: boolean
  /** The searches the provider billed for (11.6); left out when there were none. */
  search?: SearchFee
  /** (15.5) What the clip was charged at in the end; left out for a request that was not one. */
  audio?: AudioFee
}

/** Thrown by `begin` when the check it was given refuses the request. Its message is the sentence for the person; nothing was written. */
export class RequestRefused extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RequestRefused'
  }
}

/** Answers with the sentence that refuses a request, given what has been spent, or null when it may go out. */
export type RequestCheck = (spend: Spend) => string | null

export interface UsageLedger {
  /**
   * Records that a request is about to be sent, and answers with it. Throws if it cannot be written: then nothing may be sent. With a
   * `check`, it is given what has been spent today and this month (requests still on their way included) and what this request's input
   * costs, in the same turn as the write; if it refuses, this throws `RequestRefused` and writes nothing.
   */
  begin(input: BeginInput, check?: RequestCheck): Promise<LedgerRecord>
  /**
   * Records how the request ended, replacing what `begin` wrote. Never throws; `saved` says whether the line reached the disk (the
   * sums in memory are right either way). Answers null for an id that was never begun.
   */
  finish(id: string, outcome: FinishInput): Promise<{ record: LedgerRecord; saved: boolean } | null>
  /** This chat's sum (when `chat` is given), today's and this month's, from the records as they are now. */
  summary(chat: string | null): Promise<UsageSummary>
  /** Resolves when every write asked for so far has finished. For quitting the app. */
  whenIdle(): Promise<void>
}

export interface LedgerOptions {
  /** The clock, for tests. */
  now?: () => number
  /** Where record ids come from, for tests. */
  newId?: () => string
  /** Instead of LEDGER_LIMITS.maxFileBytes, for tests. */
  maxFileBytes?: number
}

export function createUsageLedger(path: string, options: LedgerOptions = {}): UsageLedger {
  const now = options.now ?? Date.now
  const newId = options.newId ?? randomUUID
  const maxFileBytes = options.maxFileBytes ?? LEDGER_LIMITS.maxFileBytes

  const records = new Map<string, LedgerRecord>()
  let unreadable = 0
  // The size the file had when last looked at, and whether it ends in a cut-off line: the next write then starts a new line.
  let knownSize = 0
  let needsNewline = false
  let loaded: Promise<void> | null = null

  // One thing at a time, in the order asked for, like the store of conversations (D-015): two writes must never cross.
  let queue: Promise<unknown> = Promise.resolve()
  function inOrder<T>(task: () => Promise<T>): Promise<T> {
    const run = queue.then(task)
    queue = run.catch(() => undefined)
    return run
  }

  async function load(): Promise<void> {
    records.clear() // a failed attempt may have got part of the way
    unreadable = 0
    let size: number
    try {
      size = (await fs.stat(path)).size
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return // no ledger yet: nothing has been spent
      throw error
    }
    let text: string
    let last = 0x0a
    const handle = await fs.open(path, 'r')
    try {
      const start = Math.max(0, size - maxFileBytes)
      const buffer = Buffer.alloc(size - start)
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, start)
      const bytes = buffer.subarray(0, bytesRead)
      if (bytes.length > 0) last = bytes[bytes.length - 1]
      text = bytes.toString('utf8')
      if (start > 0) {
        // Began in the middle of a line: that line is not whole, and the records before it were left out.
        text = text.slice(text.indexOf('\n') + 1)
        console.warn(
          `The usage ledger is larger than ${maxFileBytes} bytes: only its newest part was read, so older requests are not in the sums.`
        )
      }
    } finally {
      await handle.close()
    }
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1) // a byte-order mark, which some editors add
    for (const line of text.split('\n')) {
      if (line.trim() === '') continue
      let record: LedgerRecord | null = null
      try {
        record = parseLedgerRecord(JSON.parse(line))
      } catch {
        // not JSON: counted below
      }
      if (record === null) unreadable += 1
      else records.set(record.id, record) // a later line with the same id replaces the earlier one
    }
    if (unreadable > 0) {
      console.warn(
        `${unreadable} line(s) of the usage ledger could not be read and are not in the sums; they were left as they are.`
      )
    }
    knownSize = size
    needsNewline = last !== 0x0a
  }

  // Looked at once, the first time anything asks. A failure is tried again next time instead of staying broken.
  function ensureLoaded(): Promise<void> {
    loaded ??= load().catch((error: unknown) => {
      loaded = null
      throw error
    })
    return loaded
  }

  /** Adds one line, and does not claim success unless the file really grew by it. */
  async function append(record: LedgerRecord): Promise<void> {
    const line = ledgerLine(record)
    // Whatever is written must be readable again.
    if (parseLedgerRecord(JSON.parse(line)) === null) {
      throw new Error('the record would not be readable again')
    }
    const text = `${needsNewline ? '\n' : ''}${line}\n`
    await fs.mkdir(dirname(path), { recursive: true, mode: 0o700 })
    await fs.appendFile(path, text, { mode: 0o600 })
    const size = (await fs.stat(path)).size
    // At least, not exactly: another copy of the app may have added a line of its own.
    if (size < knownSize + Buffer.byteLength(text))
      throw new Error('the ledger did not grow as expected')
    knownSize = size
    needsNewline = false
  }

  return {
    begin: (input, check) =>
      inOrder(async () => {
        await ensureLoaded()
        const at = now() // one reading of the clock, for the check and for the record: a request cannot straddle midnight
        if (check) {
          const sums = summarize(records.values(), null, at, unreadable)
          const refusal = check({
            today: sums.today.costUsd,
            month: sums.month.costUsd,
            request:
              costOf({ ...NO_TOKENS, input: input.inputTokens }, input.prices) +
              (input.reserveUsd ?? 0)
          })
          if (refusal !== null) throw new RequestRefused(refusal)
        }
        const record: LedgerRecord = {
          version: 1,
          id: newId(),
          at,
          chat: input.chat,
          provider: input.provider,
          model: input.model,
          effort: input.effort,
          state: 'sent',
          estimate: true,
          tokens: { input: input.inputTokens, cacheRead: 0, cacheWrite: 0, output: 0 },
          prices: { ...input.prices },
          ...(input.audio === undefined ? {} : { audio: { ...input.audio } })
        }
        await append(record)
        records.set(record.id, record)
        return record
      }),

    finish: (id, outcome) =>
      inOrder(async () => {
        try {
          await ensureLoaded()
        } catch {
          // The ledger could not be read; `begin` would have failed the same way, so there is nothing to finish.
          return null
        }
        const began = records.get(id)
        if (!began) return null
        const record: LedgerRecord = {
          ...began,
          state: outcome.state,
          estimate: outcome.estimate,
          tokens: { ...outcome.tokens },
          ...(outcome.search === undefined ? {} : { search: { ...outcome.search } }),
          ...(outcome.audio === undefined ? {} : { audio: { ...outcome.audio } })
        }
        // In memory first: the sums must be right even if the disk refuses.
        records.set(id, record)
        try {
          await append(record)
          return { record, saved: true }
        } catch (error) {
          console.error(
            'Writing the end of a request to the usage ledger failed:',
            error instanceof Error ? error.message : error
          )
          return { record, saved: false }
        }
      }),

    summary: (chat) =>
      inOrder(async () => {
        await ensureLoaded()
        return summarize(records.values(), chat, now(), unreadable)
      }),

    whenIdle: () => queue.then(() => undefined)
  }
}
