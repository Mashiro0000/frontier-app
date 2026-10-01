// The shortlist of models per task: the shape of registry/rankings.json, and the two functions that turn it into
// something the app can trust and use. Plain functions with no Electron imports, so they can be checked on their own.
//
// A row says that a provider's own documentation names a model for a kind of task, with the words it used, where
// they are, and the day they were read (D-023). It is NOT a score: no source gives one that compares these models
// with each other, and a number made up here would look like a fact. So a row is only a statement, and the app only
// ever offers the shortlist: it never picks a model by itself.
//
// Like the registry, the file is edited by hand and checked as strictly (D-014): every row must have exactly the
// fields below, and a broken row is left out and reported, so one typo does not take the other rows away.

import {
  fieldProblem,
  isCalendarDate,
  isFields,
  isText,
  MODEL_ID,
  quoted,
  type ProviderId
} from './registry'

/** The shape of registry/rankings.json that this version of the app reads. */
export const RANKINGS_SCHEMA_VERSION = '0.2'

/** The kinds of task a person can say they are doing. The page is told this list; it never makes one up. */
export const TASKS = [
  { id: 'chat', label: 'Chat' },
  { id: 'coding', label: 'Coding' },
  { id: 'writing', label: 'Writing' },
  { id: 'quick', label: 'Quick answer' }
] as const
export type TaskOption = (typeof TASKS)[number]
export type TaskId = TaskOption['id']

/** One statement from a provider's documentation: this model is named for this task. */
export interface RankingRow {
  task: TaskId
  /** The id of a model in registry/models.json. A row for a model that is not there (any more) is simply not used. */
  modelId: string
  /** What the documentation says, in a line. */
  note: string
  /** The page it was read on: an https address. */
  source: string
  /** The day it was read, like "2026-10-01". */
  asOf: string
}

export interface Rankings {
  /** When the rows were last checked, as a date like "2026-10-01". */
  updatedAt: string
  /** Where they came from, in a line. */
  source: string
  rows: RankingRow[]
}

export type RankingsResult =
  | {
      ok: true
      rankings: Rankings
      /** Rows that were left out, and why. Empty when the file is clean. */
      problems: string[]
    }
  | { ok: false; error: string; problems: string[] }

/** What the page is told about one row that can be used now: what to show, and where it comes from. */
export interface Suggestion {
  task: TaskId
  modelId: string
  note: string
  source: string
  asOf: string
}

const MAX_ROWS = 500
const ROOT_FIELDS = ['schemaVersion', 'updatedAt', 'source', 'rankings'] as const
const ROW_FIELDS = ['task', 'modelId', 'note', 'source', 'asOf'] as const
const HTTPS_ADDRESS = /^https:\/\/[^\s/][^\s]*$/

const isTask = (value: unknown): value is TaskId => TASKS.some((task) => task.id === value)

type RowResult = { ok: true; row: RankingRow } | { ok: false; problem: string }

/** Checks one row and returns a clean copy of it: only the known fields, each of a known kind. */
function parseRow(item: unknown): RowResult {
  const bad = (problem: string): RowResult => ({ ok: false, problem })
  if (!isFields(item)) return bad('is not an object')
  const fields = fieldProblem(item, ROW_FIELDS)
  if (fields) return bad(fields)
  const { task, modelId, note, source, asOf } = item
  if (!isTask(task)) {
    return bad(`task ${quoted([String(task)])} is not one of ${quoted(TASKS.map((t) => t.id))}`)
  }
  if (typeof modelId !== 'string' || !MODEL_ID.test(modelId)) {
    return bad(
      'modelId must be lower-case letters, digits, dots, hyphens or underscores (up to 64)'
    )
  }
  if (!isText(note, 160)) return bad('note must be one line of text, up to 160 characters')
  if (!isText(source, 200) || !HTTPS_ADDRESS.test(source)) {
    return bad('source must be the https address of the page it was read on (up to 200 characters)')
  }
  if (!isCalendarDate(asOf)) return bad('asOf must be a date written like 2026-10-01')
  return { ok: true, row: { task, modelId, note, source, asOf } }
}

/**
 * Turns the contents of registry/rankings.json into a trusted list. A broken row is left out and reported in
 * `problems`. A broken file as a whole (the wrong version, a missing field) is refused with `error`. An empty list
 * of rows is a valid file: it only means nothing is suggested.
 */
export function parseRankings(input: unknown): RankingsResult {
  const problems: string[] = []
  const fail = (error: string): RankingsResult => ({ ok: false, error, problems })

  if (!isFields(input)) return fail('the file does not hold a JSON object')
  const rootProblem = fieldProblem(input, ROOT_FIELDS)
  if (rootProblem) return fail(rootProblem)
  if (input.schemaVersion !== RANKINGS_SCHEMA_VERSION) {
    return fail(
      `schemaVersion is ${JSON.stringify(input.schemaVersion)}, but this version of the app reads ${RANKINGS_SCHEMA_VERSION}`
    )
  }
  const { updatedAt, source, rankings } = input
  if (!isCalendarDate(updatedAt)) return fail('updatedAt must be a date written like 2026-10-01')
  if (!isText(source, 300)) {
    return fail('source must be one line of text saying where the rows came from')
  }
  if (!Array.isArray(rankings) || rankings.length > MAX_ROWS) {
    return fail(`rankings must be a list of at most ${MAX_ROWS} rows`)
  }

  const rows: RankingRow[] = []
  rankings.forEach((item: unknown, index: number) => {
    const name =
      isFields(item) && typeof item.modelId === 'string'
        ? `rankings[${index}] (${JSON.stringify(item.modelId.slice(0, 64))})`
        : `rankings[${index}]`
    const result = parseRow(item)
    if (!result.ok) {
      problems.push(`${name}: ${result.problem}`)
    } else if (
      rows.some((row) => row.task === result.row.task && row.modelId === result.row.modelId)
    ) {
      problems.push(`${name}: this model is already named for ${result.row.task} by an earlier row`)
    } else {
      rows.push(result.row)
    }
  })
  return { ok: true, rankings: { updatedAt, source, rows }, problems }
}

/**
 * The rows that can be used now: for a model that is in the registry, and whose provider has a key saved (a model
 * that cannot be called is no use to suggest). In the registry's order, then the task list's. A row for a model the
 * registry no longer has (Haiku 4.5 may be retired) is skipped without a word: that is not an error. With no
 * rankings, nothing is suggested.
 */
export function suggestionsFor(
  rankings: Rankings | null,
  models: readonly { id: string; provider: ProviderId }[],
  hasKey: (provider: ProviderId) => boolean
): Suggestion[] {
  if (rankings === null) return []
  const out: Suggestion[] = []
  for (const model of models) {
    if (!hasKey(model.provider)) continue
    for (const task of TASKS) {
      const row = rankings.rows.find((r) => r.modelId === model.id && r.task === task.id)
      if (row) {
        out.push({
          task: row.task,
          modelId: row.modelId,
          note: row.note,
          source: row.source,
          asOf: row.asOf
        })
      }
    }
  }
  return out
}
