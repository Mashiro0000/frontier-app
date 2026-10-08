// The audit log as the page sees it (Stage 11.2, D-041): every tool call the model asked for, what the person answered and how it ended. Main keeps the
// log (audit/log.jsonl, auditLog.ts) and groups it into calls (auditService.ts); the page only shows what it is given, and can read it, export it and ask
// for it to be deleted (which main asks the person about in the system's own box). Types and plain functions only: this file is bundled into the preload too.

import type { AnswerCode, RefusalCode, ShownArguments, ToolSource } from './tools'

/** How many calls the window shows at once (the newest). The export holds more. */
export const AUDIT_VIEW_CALLS = 300

/** How one call ended, as the log shows it. */
export type AuditOutcome =
  | { kind: 'refused'; code: RefusalCode }
  | { kind: 'declined'; answer: Exclude<AnswerCode, 'yes'> }
  | { kind: 'done'; size: number; sources: ToolSource[] }
  /** Allowed and started, but it failed or was stopped. */
  | { kind: 'failed' }
  /** Allowed and started, and no end was recorded (the app was probably closed meanwhile). */
  | { kind: 'running' }
  /** Asked, and no answer was recorded (the app was probably closed meanwhile). */
  | { kind: 'unanswered' }

/** One call: the events that share a call id, put together. */
export interface AuditCall {
  id: string
  /** The tool's id, and what the person calls it. */
  tool: string
  title: string
  /** The step of the reply it was (the first call of a reply is step 1). */
  step: number
  /** When the first thing happened to it (milliseconds since 1970). */
  at: number
  /** What the person was shown, exactly: the arguments and the model's reason. Null for a call that was refused before it was shown. */
  args: ShownArguments | null
  why: string | null
  outcome: AuditOutcome
}

export type AuditView =
  | {
      ok: true
      /** Newest first, at most `AUDIT_VIEW_CALLS`. */
      calls: AuditCall[]
      /** How many calls the part of the log that was read holds. */
      total: number
      /** The log is bigger than the part that was read: older calls are in the file, and not here. */
      older: boolean
      /** Lines that could not be read, and, of those, encrypted ones that this computer's key cannot open. */
      skipped: number
      sealedClosed: number
      /** How the lines are kept now. */
      form: 'plain' | 'encrypted' | 'mixed' | null
    }
  | { ok: false; error: string }

/** `cancelled`: the person said no in the system's own message box (or closed it); nothing was deleted. */
export type AuditDeleteResult = { ok: true } | { ok: false; error: string; cancelled?: true }

/** `cancelled`: the person closed the system's save dialog. `older`: the file also holds older calls that are not in the export. */
export type AuditExportResult =
  | { ok: true; calls: number; where: string; older: boolean }
  | { ok: false; error: string; cancelled?: true }

/** For each reason a call was refused without asking: a sentence for the person. */
const REFUSED: Record<RefusalCode, string> = {
  'unknown-tool': 'Refused: the model asked for a tool that does not exist.',
  'tool-off': 'Refused: that tool was switched off.',
  'bad-arguments': 'Refused: the call did not have the arguments the tool takes.',
  secret: 'Refused: the call held text that must never be sent (a saved key).',
  'data-folder': "Refused: it named a place tools may not use (the app's own data folder).",
  'bad-path': 'Refused: it named a path that tools may not use.',
  'step-cap': 'Refused: the reply had used all its tool steps.',
  'time-cap': 'Refused: the reply had used all its working time for tools.',
  stopped: 'Refused: you had stopped the reply.',
  'not-recorded': 'Refused: the app could not keep its record of the call, so nothing was done.',
  'no-runner': 'Refused: this version of the app cannot run that tool.',
  internal: 'Refused: the app failed while checking the call, so nothing was done.'
}

const DECLINED: Record<Exclude<AnswerCode, 'yes'>, string> = {
  no: 'You said no.',
  busy: 'Not asked: another question was waiting for your answer.',
  resting: 'Not asked: you had said no a moment before.',
  failed: 'Not asked: the question could not be shown.',
  stopped: 'You stopped the reply while the question was open.'
}

const fmt = (n: number): string => n.toLocaleString('en-US')

/** What happened to a call, in a sentence. The window and the export say the same words. */
export function outcomeText(outcome: AuditOutcome): string {
  switch (outcome.kind) {
    case 'refused':
      return REFUSED[outcome.code]
    case 'declined':
      return DECLINED[outcome.answer]
    case 'done': {
      const n = outcome.sources.length
      return `You said yes. It ran: ${fmt(outcome.size)} characters came back, from ${n === 1 ? '1 source' : `${n} sources`}.`
    }
    case 'failed':
      return 'You said yes. It started, but it failed or was stopped.'
    case 'running':
      return 'You said yes. No end was recorded (the app may have been closed).'
    case 'unanswered':
      return 'You were asked. No answer was recorded (the app may have been closed).'
  }
}
