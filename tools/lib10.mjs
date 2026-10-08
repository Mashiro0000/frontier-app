// Helpers for the Stage 10 suites (projects, custom instructions and memory, D-039). Test tooling only.
//
// The system's question (10.1): main asks the person in the system's own message box (dialog.showMessageBox) before any change that lets the app spend
// more, and later before anything is saved to go out with every message. A suite cannot click that box (the operating system draws it), so it stands in
// for the person from the main process's inspector, as the 8b suites do for the save and open dialogs: every question is recorded (with its options:
// title, message, detail, buttons, defaultId, cancelId, and whether it was given a window) and answered from a queue, or with the fallback answer.
//   'yes'  -> the first button (index 0, the one that names the change)
//   'no'   -> the box's cancelId (what Escape or closing it gives)
//   a number -> that response, as it is
// Older suites that raise a limit through the page (8.2, 8.3, 9.4) install it with the fallback 'yes': what they test is not the question.
import { mainInspector } from './lib4.mjs'

/**
 * For the suites written before 10.1 that raise a limit (8.2, 8.3): connects to the main process (INSPECT_PORT) and says yes to every system question,
 * so that they go on testing what they tested. Close `main` at the end.
 */
export async function sayYesFromMain() {
  const inspectPort = Number(process.env.INSPECT_PORT)
  if (!inspectPort) throw new Error("INSPECT_PORT must be set: since 10.1 (D-039) raising a limit is asked about in the system's own message box, which a suite answers from the main process")
  const main = await mainInspector(inspectPort)
  const Q = await installQuestions(main, { fallback: 'yes' })
  return { main, Q }
}

export async function installQuestions(main, { fallback = 'yes' } = {}) {
  await main.inMain(`(() => {
    const { dialog } = process.mainModule.require('electron')
    const q = globalThis.__questions ?? (globalThis.__questions = { asked: [], answers: [], fallback: 'yes', hold: null, release: null })
    q.fallback = ${JSON.stringify(fallback)}
    if (!q.installed) {
      q.installed = true
      dialog.showMessageBox = async (...args) => {
        const options = args[args.length - 1]
        q.asked.push({ withWindow: args.length > 1 && args[0] !== null && typeof args[0] === 'object' && typeof args[0].isDestroyed === 'function', options })
        if (q.hold) await q.hold
        const next = q.answers.length > 0 ? q.answers.shift() : q.fallback
        const response = next === 'yes' ? 0 : next === 'no' ? (options.cancelId ?? 1) : next
        return { response, checkboxChecked: false }
      }
    }
    return true
  })()`)
  const read = async () => JSON.parse(await main.inMain('JSON.stringify(globalThis.__questions.asked)'))
  return {
    /** Answers for the next questions, in order ('yes', 'no' or a response number). */
    queue: (...answers) => main.inMain(`globalThis.__questions.answers.push(...${JSON.stringify(answers)}); true`),
    /** Every question asked so far: { withWindow, options }. */
    asked: read,
    count: async () => (await read()).length,
    reset: () => main.inMain('globalThis.__questions.asked.length = 0; globalThis.__questions.answers.length = 0; true'),
    /** Keeps the next questions open (unanswered) until `release`. */
    hold: () => main.inMain(`(() => { const q = globalThis.__questions; q.hold = new Promise((r) => { q.release = r }); return true })()`),
    release: () => main.inMain(`(() => { const q = globalThis.__questions; const r = q.release; q.hold = null; q.release = null; if (r) r(); return true })()`),
    fallback: (answer) => main.inMain(`globalThis.__questions.fallback = ${JSON.stringify(answer)}; true`)
  }
}

/** The question's lines, for reading: message, then the detail's lines. */
export const linesOf = (asked) => [asked.options.message, ...String(asked.options.detail ?? '').split('\n')]
