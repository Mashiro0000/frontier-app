import { promises as fs } from 'fs'
import { isAbsolute } from 'path'
import {
  AUDIT_VIEW_CALLS,
  groupCalls,
  outcomeText,
  type AuditCall,
  type AuditDeleteResult,
  type AuditExportResult,
  type AuditView
} from '../shared/audit'
import { AUDIT_LIMITS, type AuditLog, type AuditSnapshot } from './auditLog'
import { isInside } from './backupService'
import {
  QUESTION_BUSY,
  QUESTION_FAILED,
  QUESTION_RESTING,
  type QuestionGate,
  type SystemQuestion
} from './systemQuestion'

// What the person can do with the audit log (Stage 11.2, D-041): read it, export it to a text file, delete it all. The log itself is auditLog.ts; this puts
// its events together into calls, writes the export, and asks. Main alone: the page can ask for the view, the export and the deletion, and nothing else (it
// cannot add a line, change one or take one out). Deleting it is asked about in the system's own message box, which the page cannot answer: a page that
// had been taken over must not be able to wipe the record of what it made the model do. Nothing in this file is reachable from a request, and no model ever
// reads the log.

const fmt = (n: number): string => n.toLocaleString('en-US')
const two = (n: number): string => String(n).padStart(2, '0')
/** "2026-10-08 14:05:12", this computer's time. */
const when = (ms: number): string => {
  const d = new Date(ms)
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`
}
const callsWord = (count: number): string => `${fmt(count)} ${count === 1 ? 'call' : 'calls'}`

/** The events of the log put together into calls (the events that share a call id), in the order the calls began. Since 11.4 the function is shared with the window. */
export { groupCalls }

/** A value as the export writes it: quoted, with anything the eye cannot see or a line break written out, so that no value can pass for a line of the export. */
const quoted = (text: string): string => JSON.stringify(text)

/** The export: one plain text file, every call with what was asked, why, how it ended and the sources that came back. No page text is in the log, so none is in it. */
export function exportText(
  calls: readonly AuditCall[],
  at: number,
  snapshot: AuditSnapshot
): string {
  const lines = [
    `The audit log of Frontier App, exported on ${when(at)} (this computer's time).`,
    'Every tool call the model asked for: what was asked, why, what you answered and how it ended. It holds no page text.',
    snapshot.older
      ? 'The log also holds older calls than these; they are not in this file.'
      : 'It holds every call in the log.',
    ''
  ]
  if (snapshot.skipped > 0) {
    lines.splice(
      3,
      0,
      `${fmt(snapshot.skipped)} ${snapshot.skipped === 1 ? 'line' : 'lines'} of the log could not be read and ${snapshot.skipped === 1 ? 'is' : 'are'} not in this file.`
    )
  }
  for (const call of calls) {
    lines.push(`${when(call.at)}  ${call.title}, step ${call.step}`)
    if (call.args !== null) {
      for (const [name, value] of Object.entries(call.args)) {
        lines.push(
          `  Asked: ${name} = ${typeof value === 'number' ? String(value) : quoted(value)}`
        )
      }
    }
    if (call.why !== null) lines.push(`  Reason the model gave: ${quoted(call.why)}`)
    lines.push(`  ${outcomeText(call.outcome)}`)
    if (call.outcome.kind === 'done') {
      for (const source of call.outcome.sources) {
        lines.push(`  Source: ${quoted(source.title)} ${source.url}`)
      }
    }
    lines.push('')
  }
  return lines.join('\n')
}

/** The question before the log is deleted. */
export function deleteQuestion(facts: {
  calls: number
  older: boolean
  oldest: number | null
}): SystemQuestion {
  const what =
    facts.calls === 0
      ? 'The audit log will be deleted for good.'
      : `${facts.older ? 'At least ' : ''}${callsWord(facts.calls)} will be deleted for good${facts.oldest === null ? '' : `, the oldest from ${when(facts.oldest)}`}. They are the record of what the model asked tools to do, what you answered and how each call ended.`
  return {
    title: 'Audit log',
    message: 'Delete the whole audit log?',
    detail: [
      what,
      'Nothing else is deleted. Calls made after this are recorded again, from an empty log.',
      '',
      "Frontier App asks this in a window of its own, which the app's page cannot answer: only you can delete the record of what the model asked for."
    ].join('\n'),
    yes: 'Delete the log',
    no: 'Keep it'
  }
}

export interface AuditService {
  /** The newest calls, for the window. Never changes the log. */
  view(): Promise<AuditView>
  /** Every call that fits the export's read to one plain text file the person places in the system's save dialog. */
  exportAll(owner: unknown): Promise<AuditExportResult>
  /** Deletes the whole log after the person's yes in the system's own message box. */
  deleteAll(owner: unknown): Promise<AuditDeleteResult>
}

export interface AuditServiceOptions {
  log: AuditLog
  gate: QuestionGate
  /** The system's save dialog for the export (a suggested file name in); null when the person closed it. */
  pickExportPath: (owner: unknown, suggestedName: string) => Promise<string | null>
  /** The app's data folder: the export never goes inside it. */
  dataDir: string
  now?: () => number
}

const reason = (error: unknown): unknown => (error instanceof Error ? error.message : error)

export function createAuditService(options: AuditServiceOptions): AuditService {
  const { log, gate } = options
  const now = options.now ?? Date.now

  async function view(): Promise<AuditView> {
    let snapshot: AuditSnapshot
    try {
      snapshot = await log.read()
    } catch (error) {
      console.error('Reading the audit log failed:', reason(error))
      return { ok: false, error: 'The audit log could not be read.' }
    }
    const calls = groupCalls(snapshot.events)
    return {
      ok: true,
      calls: calls.slice(-AUDIT_VIEW_CALLS).reverse(),
      total: calls.length,
      older: snapshot.older,
      skipped: snapshot.skipped,
      sealedClosed: snapshot.sealedClosed,
      form: snapshot.form
    }
  }

  async function exportAll(owner: unknown): Promise<AuditExportResult> {
    let snapshot: AuditSnapshot
    try {
      snapshot = await log.read({ maxBytes: AUDIT_LIMITS.maxExportBytes })
    } catch (error) {
      console.error('Reading the audit log for the export failed:', reason(error))
      return { ok: false, error: 'The audit log could not be read, so nothing was exported.' }
    }
    const calls = groupCalls(snapshot.events)
    if (calls.length === 0) {
      return { ok: false, error: 'The audit log has no calls in it: there is nothing to export.' }
    }
    const at = now()
    const dest = await options.pickExportPath(
      owner,
      `frontier-audit-log-${when(at).slice(0, 10)}.txt`
    )
    if (dest === null) return { ok: false, cancelled: true, error: 'Cancelled.' }
    if (typeof dest !== 'string' || !isAbsolute(dest)) {
      return { ok: false, error: 'That place could not be used.' }
    }
    if (await isInside(options.dataDir, dest)) {
      return {
        ok: false,
        error:
          "The audit log cannot be exported into the app's own data folder. Choose another place."
      }
    }
    const text = exportText(calls, at, snapshot)
    try {
      await fs.writeFile(dest, text, 'utf8')
      if ((await fs.readFile(dest, 'utf8')) !== text) {
        throw new Error('the file did not read back the same')
      }
    } catch (error) {
      console.error('Exporting the audit log failed:', reason(error))
      return { ok: false, error: 'The audit log could not be written there. Choose another place.' }
    }
    return { ok: true, calls: calls.length, where: dest, older: snapshot.older }
  }

  async function deleteAll(owner: unknown): Promise<AuditDeleteResult> {
    let snapshot: AuditSnapshot | null = null
    try {
      snapshot = await log.read()
    } catch (error) {
      // A log that cannot be read can still be deleted: the question then says no more than that the file will go.
      console.error('Reading the audit log before deleting it failed:', reason(error))
    }
    if (snapshot !== null && snapshot.state === 'none') return { ok: true } // nothing to delete: nothing asked
    const calls = snapshot === null ? [] : groupCalls(snapshot.events)
    const answer = await gate.ask(
      owner,
      deleteQuestion({
        calls: calls.length,
        older: snapshot?.older ?? false,
        oldest: calls.length > 0 ? calls[0].at : null
      })
    )
    if (answer === 'busy') return { ok: false, error: QUESTION_BUSY }
    if (answer === 'resting') return { ok: false, error: QUESTION_RESTING }
    if (answer === 'failed') return { ok: false, error: QUESTION_FAILED }
    if (answer !== 'yes') return { ok: false, cancelled: true, error: 'Nothing was deleted.' }
    try {
      await log.removeAll()
    } catch (error) {
      console.error('Deleting the audit log failed:', reason(error))
      return { ok: false, error: 'The audit log could not be deleted.' }
    }
    return { ok: true }
  }

  return { view, exportAll, deleteAll }
}
