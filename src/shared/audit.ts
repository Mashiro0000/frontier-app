// The audit log as the page sees it (Stage 11.2, D-041): every tool call the model asked for, what the person answered and how it ended. Main keeps the
// log (audit/log.jsonl, auditLog.ts) and groups it into calls (auditService.ts); the page only shows what it is given, and can read it, export it and ask
// for it to be deleted (which main asks the person about in the system's own box). Types and plain functions only: this file is bundled into the preload too.

import {
  toolTitle,
  type AnswerCode,
  type RefusalCode,
  type ShownArguments,
  type ToolEvent,
  type ToolSource
} from './tools'

/** How many calls the window shows at once (the newest). The export holds more. */
export const AUDIT_VIEW_CALLS = 300

/** How one call ended, as the log shows it. */
export type AuditOutcome =
  | { kind: 'refused'; code: RefusalCode }
  | { kind: 'declined'; answer: Exclude<AnswerCode, 'yes' | 'covered'> }
  /** `covered`: nobody was asked about this call itself; the person's yes for the reply's file access (12.2) allowed it. */
  | { kind: 'done'; size: number; sources: ToolSource[]; covered?: true }
  /** Allowed and started, but it failed or was stopped. */
  | { kind: 'failed'; covered?: true }
  /** Allowed and started, and no end was recorded (the app was probably closed meanwhile). */
  | { kind: 'running'; covered?: true }
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
export const REFUSED_TEXT: Record<RefusalCode, string> = {
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
  limit: 'Refused: a spending limit you set would be passed, so you were not asked.',
  internal: 'Refused: the app failed while checking the call, so nothing was done.',
  'no-workspace':
    'Refused: no workspace folder is chosen, or the chosen folder cannot be used now.',
  outside: 'Refused: the path leaves the workspace.',
  link: 'Refused: a link or junction is on the way, and links are never followed.',
  never:
    'Refused: it named a place that is never reached (version-control internals and the like).',
  'wrong-path': 'Refused: the path is not there, or is not the kind of thing the call needs.',
  'file-cap': 'Refused: the reply had used all its file calls.',
  'chars-cap': 'Refused: the reply had been given all the file text it may read.',
  'grant-declined':
    'Refused: you had said no to file access for this reply, so you were not asked again.'
}

export const DECLINED_TEXT: Record<Exclude<AnswerCode, 'yes' | 'covered'>, string> = {
  no: 'You said no.',
  busy: 'Not asked: another question was waiting for your answer.',
  resting: 'Not asked: you had said no a moment before.',
  failed: 'Not asked: the question could not be shown.',
  stopped: 'You stopped the reply while the question was open.'
}

const fmt = (n: number): string => n.toLocaleString('en-US')

/** What happened to a call, in a sentence. The window and the export say the same words. */
export function outcomeText(outcome: AuditOutcome, tool = 'web_search'): string {
  // The three tools of 12.6 write and undo: their result is a number of bytes written, not text that came back.
  if (tool === 'apply_change' || tool === 'undo_change' || tool === 'undo_clear') {
    if (outcome.kind === 'done') {
      const n = fmt(outcome.size)
      return tool === 'apply_change'
        ? `You said yes. It was written: ${n} bytes.`
        : tool === 'undo_change'
          ? 'You said yes. It was undone.'
          : 'You said yes. The undo history was deleted.'
    }
    if (outcome.kind === 'failed')
      return 'You said yes. It could not be done, and the file was put back as it was.'
  }
  switch (outcome.kind) {
    case 'refused':
      return REFUSED_TEXT[outcome.code]
    case 'declined':
      return DECLINED_TEXT[outcome.answer]
    case 'done': {
      const n = outcome.sources.length
      if (outcome.covered === true) {
        return `Allowed by your yes for this reply. It ran: ${fmt(outcome.size)} characters came back${n === 0 ? '' : `, from ${n === 1 ? '1 source' : `${n} sources`}`}.`
      }
      return `You said yes. It ran: ${fmt(outcome.size)} characters came back, from ${n === 1 ? '1 source' : `${n} sources`}.`
    }
    case 'failed':
      return outcome.covered === true
        ? 'Allowed by your yes for this reply. It started, but it failed or was stopped.'
        : 'You said yes. It started, but it failed or was stopped.'
    case 'running':
      return outcome.covered === true
        ? 'Allowed by your yes for this reply. No end was recorded (the app may have been closed).'
        : 'You said yes. No end was recorded (the app may have been closed).'
    case 'unanswered':
      return 'You were asked. No answer was recorded (the app may have been closed).'
  }
}

interface Building {
  id: string
  tool: string
  step: number
  at: number
  args: AuditCall['args']
  why: string | null
  refused: RefusalCode | null
  answer: AnswerCode | null
  ran: boolean
  result: Extract<ToolEvent, { type: 'result' }> | null
}

function outcomeOf(call: Building): AuditOutcome {
  if (call.refused !== null) return { kind: 'refused', code: call.refused }
  if (call.answer !== null && call.answer !== 'yes' && call.answer !== 'covered') {
    return { kind: 'declined', answer: call.answer }
  }
  const covered = call.answer === 'covered' ? ({ covered: true } as const) : {}
  if (call.result !== null) {
    return call.result.ok
      ? {
          kind: 'done',
          size: call.result.size,
          sources: call.result.sources.map(({ title, url }) => ({ title, url })),
          ...covered
        }
      : { kind: 'failed', ...covered }
  }
  if (call.ran || call.answer === 'yes' || call.answer === 'covered') {
    return { kind: 'running', ...covered }
  }
  return { kind: 'unanswered' }
}

/**
 * The events of the log put together into calls (the events that share a call id), in the order the calls began. Main uses it to read the log (11.2); from
 * 11.4 the window uses the same function for the calls of a reply as their events arrive, so the chat and the log always say the same thing.
 */
export function groupCalls(events: readonly ToolEvent[]): AuditCall[] {
  const byId = new Map<string, Building>()
  for (const event of events) {
    let call = byId.get(event.call)
    if (call === undefined) {
      call = {
        id: event.call,
        tool: event.tool,
        step: event.step,
        at: event.at,
        args: null,
        why: null,
        refused: null,
        answer: null,
        ran: false,
        result: null
      }
      byId.set(event.call, call)
    }
    switch (event.type) {
      case 'refused':
        call.refused = event.code
        break
      case 'asked':
        call.args = { ...event.args }
        call.why = event.why
        break
      case 'answered':
        call.answer = event.answer
        break
      case 'ran':
        call.ran = true
        break
      case 'result':
        call.result = event
        break
    }
  }
  return [...byId.values()].map((call) => ({
    id: call.id,
    tool: call.tool,
    title: toolTitle(call.tool),
    step: call.step,
    at: call.at,
    args: call.args,
    why: call.why,
    outcome: outcomeOf(call)
  }))
}
