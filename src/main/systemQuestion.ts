// A question main asks the person in a window the operating system draws (Stage 10.1, D-039): the system's own message box, which the app's page cannot
// see into, click or answer. It stands in front of every change that lets the app spend more (raising a spending limit, "No limit", asking less often
// before a large request) and, from 10.2 on, of everything saved to go out with every message. No Electron imports: the message box is handed in
// (`AskPerson`, from backupDialogs.ts), so every rule below is checked under plain Node with a played answer.
//
// The rules:
//  - ONE question at a time, across the app. A change that needs a question while one is open is refused at once (never queued), so a page that asks a
//    thousand times gets one question, not a thousand in a row.
//  - One answer per question. The answer is what the message box returned for THAT question; nothing can answer ahead of it or be kept for later, and
//    there is no channel by which the page could answer.
//  - Only a yes is a yes: `true` from the asker, nothing else that looks like it. A box that could not be shown (it threw) is not a yes either.
//  - After a no, no question is asked for a few seconds (QUIET_AFTER_NO_MS): a page that asks again the moment the person says no cannot keep a box in
//    front of them for ever (each box is modal, so a person in such a loop could not even reach the window to close it), or wear them down to a yes.

/** What the message box says. Plain text: the operating system draws it. */
export interface SystemQuestion {
  /** The window's title. */
  title: string
  /** The question itself, one sentence. */
  message: string
  /** Exactly what would change, line by line, and why it is asked here. */
  detail: string
  /** The button that says yes, in words that name the change ("Raise the limit"). */
  yes: string
  /** The button that says no. It has the focus, and Escape or closing the box is the same answer. */
  no: string
}

/**
 * Asks the person, for the window `owner`, and resolves `true` only for their yes. Handed in by main (backupDialogs.ts); played by the tests. With a
 * `signal` (11.3: Stop everything), aborting it closes the box, which then answers as if the person had said no.
 */
export type AskPerson = (
  owner: unknown,
  question: SystemQuestion,
  signal?: AbortSignal
) => Promise<boolean>

/**
 * `yes` and `no` are the person's answers; `busy`: another question was open, so this one was not asked; `resting`: the person said no a moment ago,
 * so this one was not asked; `failed`: the box could not be shown (nothing is changed, as for a no); `stopped` (11.3): the signal that was given
 * aborted (Stop everything), before the question or while it was open: never a yes, and not a "no" either, so no quiet time follows it.
 */
export type GateAnswer = 'yes' | 'no' | 'busy' | 'resting' | 'failed' | 'stopped'

export interface QuestionGate {
  ask(owner: unknown, question: SystemQuestion, signal?: AbortSignal): Promise<GateAnswer>
  /** True while a question is open (or about to be shown). */
  open(): boolean
}

/** How long after a no the next question waits. Long enough to reach the window and close the app; short enough not to matter otherwise. */
export const QUIET_AFTER_NO_MS = 3_000

/** The sentence for a change that needs the person's answer while another question is still open. */
export const QUESTION_BUSY =
  'Another question is waiting for your answer in a window of its own. Answer it first.'

/** The sentence for a change that needs the person's answer a moment after they said no to one. */
export const QUESTION_RESTING =
  'You said no to a question a moment ago. Wait a few seconds, then try again.'

/** The sentence for a question that could not be shown. Nothing was changed. */
export const QUESTION_FAILED = 'The question could not be shown, so nothing was changed. Try again.'

/** `now` is handed in only so that the checks can move the clock. */
export function createQuestionGate(
  askPerson: AskPerson,
  now: () => number = Date.now
): QuestionGate {
  let asking = false
  let quietUntil = 0
  return {
    ask: async (owner, question, signal) => {
      if (signal?.aborted) return 'stopped'
      if (asking) return 'busy'
      if (now() < quietUntil) return 'resting'
      asking = true
      try {
        const answered = await askPerson(owner, question, signal)
        // A Stop that came while the box was open wins over everything, a yes included.
        if (signal?.aborted) return 'stopped'
        if (answered === true) return 'yes'
        quietUntil = now() + QUIET_AFTER_NO_MS
        return 'no'
      } catch (error) {
        // Logged here only; the message could name a path.
        console.error(
          'Showing a question to the person failed:',
          error instanceof Error ? error.message : error
        )
        return 'failed'
      } finally {
        asking = false
      }
    },
    open: () => asking
  }
}
