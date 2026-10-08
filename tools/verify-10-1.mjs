// Slice 10.1 under plain Node (no window): the question main asks in the system's own message box before a change that lets the app spend more (D-039).
// What counts as "more" for a limit and for the amount the app asks above; the words of the questions; the gate (one question at a time, one answer per
// question, only a real yes is a yes); the flow with the 8.2 and 8.3 stores in a temporary folder and a played answer (asked or not, saved or not, exactly
// what was shown, a second call while one is open refused at once); and source checks on what the window cannot show (the handlers go through the flow,
// the message box's buttons, no way for the page to answer).
// Run: node tools/verify-10-1.mjs
import './ts-resolve.mjs'
import { checker } from './cdp.mjs'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { REPO, REPO_URL } from './paths.mjs'

const check = checker()
const guard = async (name, fn) => { try { await fn() } catch (error) { check(`${name} did not run to its end: ${String(error?.stack ?? error).slice(0, 300)}`, false) } }
const show = (v) => JSON.stringify(v)?.slice(0, 300)
const SRC = `${REPO_URL}/src`
const limits = await import(`${SRC}/shared/limits.ts`)
const ask = await import(`${SRC}/shared/askFirst.ts`)
const gateMod = await import(`${SRC}/main/systemQuestion.ts`)
const changes = await import(`${SRC}/main/limitChanges.ts`)
const { createLimitsStore } = await import(`${SRC}/main/limits.ts`)
const { createAskFirstStore } = await import(`${SRC}/main/askFirst.ts`)
const source = (rel) => readFileSync(join(REPO, rel), 'utf8')
const usd = (n) => ({ kind: 'usd', usd: n })
const NONE = { kind: 'none' }
const UNSET = { kind: 'unset' }
const L = (daily, monthly) => ({ daily, monthly })

await guard('A', async () => {
  const { limitChange, limitsRaise } = limits
  const table = [
    [UNSET, usd(5), 'up', 'an amount chosen from "not chosen" (which refuses every request)'],
    [UNSET, NONE, 'up', '"No limit" chosen from "not chosen"'],
    [usd(5), usd(20), 'up', 'a higher amount'],
    [usd(5), usd(5.01), 'up', 'one cent more'],
    [usd(5), NONE, 'up', '"No limit" from an amount'],
    [usd(5), usd(5), 'same', 'the same amount'],
    [usd(0.3), usd(0.1 + 0.2), 'same', '0.1 + 0.2 against 0.3 (float noise does not decide)'],
    [usd(5), usd(4.99), 'down', 'one cent less'],
    [NONE, usd(10000), 'down', 'an amount, even the largest, from "No limit"'],
    [NONE, NONE, 'same', '"No limit" kept']
  ]
  for (const [current, next, want, what] of table) {
    check(`A: ${what} is "${want}"`, limitChange(current, next) === want, limitChange(current, next))
  }
  check('A: a pair raises when either limit goes up (daily up, monthly down)', limitsRaise(L(usd(5), usd(50)), L(usd(6), usd(40))))
  check('A: ...or only the monthly one goes up', limitsRaise(L(usd(5), usd(50)), L(usd(5), NONE)))
  check('A: a pair that only goes down or stays does not raise', !limitsRaise(L(usd(5), usd(50)), L(usd(4), usd(50))) && !limitsRaise(L(NONE, NONE), L(usd(1), usd(2))) && !limitsRaise(L(usd(5), usd(50)), L(usd(5), usd(50))))
  check('A: from a half-chosen file (daily chosen, monthly not), any pair raises', limitsRaise(L(NONE, UNSET), L(NONE, usd(1))))
})

await guard('B', async () => {
  const { askFirstLoosens } = ask
  const DEF = { kind: 'default' }
  const NEVER = { kind: 'never' }
  const table = [
    [DEF, NEVER, true, '"Never ask" from the default'],
    [DEF, usd(0.51), true, 'one cent above the default ($0.50)'],
    [DEF, usd(0.5), false, 'the default\'s own amount, chosen'],
    [DEF, usd(0.25), false, 'a lower amount than the default'],
    [usd(2), usd(3), true, 'a higher amount'],
    [usd(2), NEVER, true, '"Never ask" from an amount'],
    [usd(2), usd(1), false, 'a lower amount'],
    [usd(0.3), usd(0.1 + 0.2), false, '0.1 + 0.2 against 0.3'],
    [NEVER, usd(10000), false, 'any amount from "Never ask" (it asks more often)'],
    [NEVER, NEVER, false, '"Never ask" kept']
  ]
  for (const [current, next, want, what] of table) {
    check(`B: ${what} ${want ? 'asks less often' : 'does not ask less often'}`, askFirstLoosens(current, next) === want)
  }
})

await guard('C', async () => {
  const { limitsQuestion, askFirstQuestion, ASKED_HERE } = changes
  const first = limitsQuestion(L(UNSET, UNSET), L(usd(5), usd(50)))
  check('C: the first choice: "Save these spending limits?", "Save the limits" / "Cancel", both limits and "not chosen until now"', first.message === 'Save these spending limits?' && first.yes === 'Save the limits' && first.no === 'Cancel' && first.title === 'Spending limits' && first.detail.split('\n')[0] === 'Daily limit: $5.00 (not chosen until now)' && first.detail.split('\n')[1] === 'Monthly limit: $50.00 (not chosen until now)', show(first))
  check('C: ...and its last line says why it is asked here', first.detail.endsWith(ASKED_HERE) && /page cannot answer/.test(ASKED_HERE))
  const daily = limitsQuestion(L(usd(5), usd(50)), L(usd(20), usd(50)))
  check('C: one limit raised: "Raise your daily spending limit to $20.00?", "Raise the limit", "Daily limit: $20.00 (now $5.00)", "Monthly limit: $50.00 (as now)"', daily.message === 'Raise your daily spending limit to $20.00?' && daily.yes === 'Raise the limit' && daily.detail.startsWith('Daily limit: $20.00 (now $5.00)\nMonthly limit: $50.00 (as now)\n'), show(daily))
  const remove = limitsQuestion(L(usd(5), usd(50)), L(usd(5), NONE))
  check('C: "No limit" for the month: "Remove your monthly spending limit?", "Remove the limit", and the warning that nothing in the app stops spending then', remove.message === 'Remove your monthly spending limit?' && remove.yes === 'Remove the limit' && remove.detail.includes('Monthly limit: No limit (now $50.00)') && remove.detail.includes('nothing in this app stops spending in that period'), show(remove))
  const both = limitsQuestion(L(usd(5), usd(50)), L(NONE, NONE))
  check('C: both removed: "Remove both spending limits?" / "Remove both limits"', both.message === 'Remove both spending limits?' && both.yes === 'Remove both limits', show(both))
  const mixed = limitsQuestion(L(usd(5), usd(50)), L(usd(6), usd(40)))
  check('C: daily up and monthly down: a question about the daily one, and the monthly line says it goes down from $50.00', mixed.message === 'Raise your daily spending limit to $6.00?' && mixed.detail.includes('Monthly limit: $40.00 (now $50.00)'), show(mixed))
  const never = askFirstQuestion({ kind: 'default' }, { kind: 'never' })
  check('C: "Never ask": "Stop asking before large requests?", "Never ask" / "Cancel", the default named, the limits still stop a request', never.message === 'Stop asking before large requests?' && never.yes === 'Never ask' && never.no === 'Cancel' && never.title === 'Large requests' && never.detail.includes('$0.50, the default') && never.detail.includes('spending limits still stop') && never.detail.endsWith(ASKED_HERE), show(never))
  const higher = askFirstQuestion(usd(0.5), usd(3))
  check('C: a higher amount: "Ask before a large request only above $3.00?", "Ask above $3.00", and the amount now', higher.message === 'Ask before a large request only above $3.00?' && higher.yes === 'Ask above $3.00' && higher.detail.startsWith('Now the app asks before sending a request whose input could cost more than $0.50.') && !higher.detail.includes('the default'), show(higher))
})

await guard('D', async () => {
  const { createQuestionGate } = gateMod
  // Every question waits for its own answer; `answer(n, yes)` gives question n its answer.
  const answers = []
  const answer = (n, yes) => answers[n]?.(yes)
  let calls = 0
  const held = createQuestionGate(() => { calls++; return new Promise((r) => { answers.push(r) }) })
  const first = held.ask('w', { title: 't', message: 'm', detail: 'd', yes: 'y', no: 'n' })
  check('D: while a question is open the gate says so', held.open() === true)
  // Bounded: a gate that let the second question through would wait for an answer that never comes, and the suite must say so, not hang.
  const second = await Promise.race([held.ask('w', { title: 't2', message: 'm', detail: 'd', yes: 'y', no: 'n' }), new Promise((r) => setTimeout(() => r('still waiting after 1 s'), 1000))])
  check('D: a second question while one is open is refused at once ("busy"), and not shown', second === 'busy' && calls === 1, String(second))
  answer(0, true)
  answer(1, false) // (only there when the gate let a second question through)
  check('D: the first is answered by its own yes', (await first) === 'yes' && held.open() === false)
  const before = calls
  const again = held.ask('w', { title: 't', message: 'm', detail: 'd', yes: 'y', no: 'n' })
  check('D: the next question is asked again (an answer is never kept for later)', calls === before + 1)
  answer(calls - 1, false)
  check('D: ...and a no is a no', (await again) === 'no')
  const truthy = createQuestionGate(async () => 1)
  check('D: an answer that is not exactly true (1) is not a yes', (await truthy.ask(null, {})) === 'no')
  const text = createQuestionGate(async () => 'yes')
  check('D: ...nor is the text "yes"', (await text.ask(null, {})) === 'no')
  const broken = createQuestionGate(async () => { throw new Error('no window') })
  const realError = console.error
  console.error = () => {}
  const failed = await broken.ask(null, {})
  console.error = realError
  check('D: a box that cannot be shown is "failed", not a yes, and the gate is free again', failed === 'failed' && broken.open() === false)
  let owner = null
  const sees = createQuestionGate(async (o) => { owner = o; return true })
  await sees.ask('window-7', {})
  check('D: the asker is given the window that asked', owner === 'window-7')
  let t = 5_000
  let asks = 0
  const quiet = createQuestionGate(async () => { asks++; return asks > 1 }, () => t)
  check('D: a no...', (await quiet.ask(null, {})) === 'no' && asks === 1)
  check('D: ...then for the next three seconds no question is asked at all ("resting"), so a page cannot put the box back the moment the person says no', (await quiet.ask(null, {})) === 'resting' && asks === 1 && gateMod.QUIET_AFTER_NO_MS === 3000)
  t += 2_999
  check('D: ...still resting at 2.999 s', (await quiet.ask(null, {})) === 'resting' && asks === 1)
  t += 1
  check('D: ...asked again at 3 s', (await quiet.ask(null, {})) === 'yes' && asks === 2)
  check('D: a yes leaves no rest: the next question is asked at once', (await quiet.ask(null, {})) === 'yes' && asks === 3)
  const failing = createQuestionGate(async () => { throw new Error('x') }, () => t)
  console.error = () => {}
  await failing.ask(null, {})
  console.error = realError
  check('D: a box that could not be shown is not a no: no rest after it', (await failing.ask(null, {})) !== 'resting')
})

// The flow, with the real stores of 8.2 and 8.3 in a temporary folder and a played answer.
const base = join(tmpdir(), `frontier-v101-${randomUUID()}`)
mkdirSync(base, { recursive: true })
let n = 0
function world({ answer = true, limitsFile, askFile } = {}) {
  const dir = join(base, `w${++n}`)
  mkdirSync(dir, { recursive: true })
  if (limitsFile !== undefined) writeFileSync(join(dir, 'limits.json'), limitsFile)
  if (askFile !== undefined) writeFileSync(join(dir, 'ask-first.json'), askFile)
  const asked = []
  const state = { answer, hold: null }
  const asker = async (owner, question) => {
    asked.push({ owner, question })
    if (state.hold) await state.hold
    if (typeof state.answer === 'function') return state.answer()
    return state.answer
  }
  const limitsStore = createLimitsStore(() => join(dir, 'limits.json'))
  const askFirstStore = createAskFirstStore(() => join(dir, 'ask-first.json'))
  const clock = { t: 1_000_000 }
  const gate = gateMod.createQuestionGate(asker, () => clock.t)
  const flow = changes.createLimitChanges({ limitsStore, askFirstStore, gate })
  const file = (name) => (existsSync(join(dir, name)) ? readFileSync(join(dir, name), 'utf8') : null)
  // After a no the gate rests three seconds (D); the played person waits them out with `pass()`.
  return { dir, asked, state, flow, gate, pass: () => { clock.t += 3_001 }, limitsFile: () => file('limits.json'), askFile: () => file('ask-first.json'), limitsStore, askFirstStore }
}
const FIVE_FIFTY = '{"version":1,"daily":5,"monthly":50}'

await guard('E', async () => {
  const low = world({ limitsFile: '{"version":1,"daily":"none","monthly":"none"}' })
  const r1 = await low.flow.setLimits('w', { daily: usd(5), monthly: usd(50) })
  check('E: lowering ("No limit" to $5 and $50) is saved at once, with no question', r1.ok === true && low.asked.length === 0 && low.limitsFile() === FIVE_FIFTY, show({ r1, asked: low.asked.length, file: low.limitsFile() }))
  const r2 = await low.flow.setLimits('w', { daily: usd(4), monthly: usd(50) })
  check('E: ...and lowering an amount again: no question', r2.ok && low.asked.length === 0 && low.limitsFile() === '{"version":1,"daily":4,"monthly":50}')

  const up = world({ limitsFile: FIVE_FIFTY, answer: false })
  const no = await up.flow.setLimits('win', { daily: usd(20), monthly: usd(50) })
  check('E: raising the daily limit asks once, for the window that asked, with the question for that change', up.asked.length === 1 && up.asked[0].owner === 'win' && up.asked[0].question.message === 'Raise your daily spending limit to $20.00?', show(up.asked.map((a) => a.question.message)))
  check('E: a no: nothing saved (the file is byte for byte as it was), and the answer says "cancelled" with a sentence', no.ok === false && no.cancelled === true && no.error === changes.LIMITS_NOT_SAVED && up.limitsFile() === FIVE_FIFTY, show(no))
  up.state.answer = true
  const soon = await up.flow.setLimits('win', { daily: usd(20), monthly: usd(50) })
  check('E: the same raise straight after the no: not asked, refused with the sentence to wait (not "cancelled"), nothing saved', soon.ok === false && !soon.cancelled && soon.error === gateMod.QUESTION_RESTING && up.asked.length === 1 && up.limitsFile() === FIVE_FIFTY, show(soon))
  const lowerSoon = await up.flow.setLimits('win', { daily: usd(4), monthly: usd(50) })
  check('E: ...but a lower limit right after the no is saved (it asks nothing)', lowerSoon.ok === true && up.asked.length === 1 && up.limitsFile() === '{"version":1,"daily":4,"monthly":50}', show(lowerSoon))
  up.pass()
  const yes = await up.flow.setLimits('win', { daily: usd(20), monthly: usd(50) })
  check('E: a yes: saved, exactly the pair the question showed', yes.ok === true && up.asked.length === 2 && up.limitsFile() === '{"version":1,"daily":20,"monthly":50}' && up.asked[1].question.detail.startsWith('Daily limit: $20.00 (now $4.00)'), show({ yes, file: up.limitsFile() }))
  const again = await up.flow.setLimits('win', { daily: usd(30), monthly: usd(50) })
  check('E: the next raise asks again (a yes is for one question)', again.ok && up.asked.length === 3)
  const none = await up.flow.setLimits('win', { daily: usd(30), monthly: NONE })
  check('E: "No limit" asks too, and says so', none.ok && up.asked.length === 4 && up.asked[3].question.message === 'Remove your monthly spending limit?' && up.limitsFile() === '{"version":1,"daily":30,"monthly":"none"}')

  const fresh = world({ answer: false })
  const r3 = await fresh.flow.setLimits('w', { daily: usd(5), monthly: usd(50) })
  check('E: the first choice (no limits.json) is asked about; a no leaves no file at all', r3.cancelled === true && fresh.asked.length === 1 && fresh.asked[0].question.message === 'Save these spending limits?' && fresh.limitsFile() === null, show(r3))
  const half = world({ limitsFile: '{"version":1,"daily":"none"}', answer: false })
  const r4 = await half.flow.setLimits('w', { daily: NONE, monthly: usd(1) })
  check('E: a half-chosen file (monthly not chosen): even $1 a month is asked about', r4.cancelled === true && half.asked.length === 1 && half.limitsFile() === '{"version":1,"daily":"none"}')

  const bad = world({ limitsFile: FIVE_FIFTY })
  for (const [name, input] of [['nothing', undefined], ['"not chosen"', { daily: UNSET, monthly: UNSET }], ['a negative amount', { daily: usd(-1), monthly: NONE }], ['a third of a cent', { daily: usd(0.333), monthly: NONE }], ['a string', 'none']]) {
    const r = await bad.flow.setLimits('w', input)
    check(`E: ${name} is refused before any question, and nothing changes`, r.ok === false && !r.cancelled && typeof r.error === 'string' && bad.asked.length === 0 && bad.limitsFile() === FIVE_FIFTY, show(r))
  }

  const busy = world({ limitsFile: FIVE_FIFTY })
  let release
  busy.state.hold = new Promise((r) => { release = r })
  const open = busy.flow.setLimits('w', { daily: NONE, monthly: NONE })
  await new Promise((r) => setTimeout(r, 30))
  const lower = await busy.flow.setLimits('w', { daily: usd(1), monthly: usd(2) })
  const askFirstMeanwhile = await busy.flow.setAskFirst('w', { kind: 'usd', usd: 0.1 })
  check('E: while a question is open, another change (even one that only lowers) is refused at once with the sentence, and not queued', lower.ok === false && lower.error === gateMod.QUESTION_BUSY && askFirstMeanwhile.ok === false && askFirstMeanwhile.error === gateMod.QUESTION_BUSY && busy.asked.length === 1, show({ lower, askFirstMeanwhile }))
  release()
  const opened = await open
  check('E: ...and the open question\'s yes saves its own change only', opened.ok && busy.limitsFile() === '{"version":1,"daily":"none","monthly":"none"}' && busy.askFile() === null, show({ opened, file: busy.limitsFile() }))

  const tick = world({ limitsFile: FIVE_FIFTY })
  const [a, b] = await Promise.all([tick.flow.setLimits('w', { daily: usd(9), monthly: usd(50) }), tick.flow.setLimits('w', { daily: NONE, monthly: NONE })])
  check('E: two raises in the same moment: one question, the other refused at once', tick.asked.length === 1 && [a, b].filter((r) => r.ok).length === 1 && [a, b].some((r) => r.ok === false && (r.error === changes.CHANGE_BUSY || r.error === gateMod.QUESTION_BUSY)), show([a, b]))
  check('E: ...and the file holds the one that was asked about', tick.limitsFile() === '{"version":1,"daily":9,"monthly":50}', tick.limitsFile())

  const many = world({ limitsFile: FIVE_FIFTY })
  const burst = await Promise.all(Array.from({ length: 50 }, (_, i) => many.flow.setLimits('w', { daily: usd(6 + i), monthly: usd(50) })))
  check('E: fifty raises at once: ONE question (no row of fifty boxes)', many.asked.length === 1 && burst.filter((r) => r.ok).length === 1, String(many.asked.length))

  const broken = world({ limitsFile: FIVE_FIFTY, answer: () => { throw new Error('no window') } })
  const realError = console.error
  console.error = () => {}
  const r5 = await broken.flow.setLimits('w', { daily: NONE, monthly: NONE })
  console.error = realError
  check('E: a box that cannot be shown: nothing saved, a sentence, not "cancelled"', r5.ok === false && !r5.cancelled && r5.error === gateMod.QUESTION_FAILED && broken.limitsFile() === FIVE_FIFTY, show(r5))
  const truthy = world({ limitsFile: FIVE_FIFTY, answer: 1 })
  const r6 = await truthy.flow.setLimits('w', { daily: NONE, monthly: NONE })
  check('E: an answer of 1 (not exactly yes) saves nothing', r6.cancelled === true && truthy.limitsFile() === FIVE_FIFTY)

  const folder = world()
  mkdirSync(join(folder.dir, 'limits.json'))
  console.error = () => {}
  const r7 = await folder.flow.setLimits('w', { daily: usd(1), monthly: usd(2) })
  console.error = realError
  check('E: limits.json that cannot be read (a folder) counts as "not chosen": the choice is asked about, then fails to save with a sentence', folder.asked.length === 1 && folder.asked[0].question.message === 'Save these spending limits?' && r7.ok === false && r7.error === 'The limits could not be saved on this computer.', show(r7))
})

await guard('F', async () => {
  const w = world({ answer: false })
  const r1 = await w.flow.setAskFirst('w', { kind: 'never' })
  check('F: "Never ask" from the default is asked about; a no writes no file', w.asked.length === 1 && w.asked[0].question.message === 'Stop asking before large requests?' && r1.cancelled === true && r1.error === changes.ASK_FIRST_NOT_SAVED && w.askFile() === null, show(r1))
  w.pass()
  const r2 = await w.flow.setAskFirst('w', { kind: 'usd', usd: 3 })
  check('F: $3 from the default ($0.50) is asked about', w.asked.length === 2 && r2.cancelled === true && w.askFile() === null)
  const r3 = await w.flow.setAskFirst('w', { kind: 'usd', usd: 0.25 })
  check('F: $0.25 (asks sooner) is saved with no question', r3.ok && w.asked.length === 2 && w.askFile() === '{"version":1,"above":0.25}')
  w.state.answer = true
  w.pass()
  const r4 = await w.flow.setAskFirst('w', { kind: 'usd', usd: 2 })
  check('F: $2 from $0.25: asked, yes, saved', r4.ok && w.asked.length === 3 && w.askFile() === '{"version":1,"above":2}' && w.asked[2].question.message === 'Ask before a large request only above $2.00?')
  const r5 = await w.flow.setAskFirst('w', { kind: 'never' })
  check('F: "Never ask": asked, yes, saved', r5.ok && w.asked.length === 4 && w.askFile() === '{"version":1,"above":"never"}')
  const r6 = await w.flow.setAskFirst('w', { kind: 'usd', usd: 9999 })
  check('F: from "Never ask", any amount asks more often: no question', r6.ok && w.asked.length === 4 && w.askFile() === '{"version":1,"above":9999}')
  const r7 = await w.flow.setAskFirst('w', { kind: 'default' })
  check('F: the page cannot send "default": refused before any question', r7.ok === false && !r7.cancelled && w.asked.length === 4)
  const damaged = world({ askFile: '{"version":1,"above":"NEVER"}', answer: false })
  const r8 = await damaged.flow.setAskFirst('w', { kind: 'usd', usd: 1 })
  check('F: a damaged ask-first.json reads as the default ($0.50), so $1 is asked about (damage never reads as "Never ask")', damaged.asked.length === 1 && r8.cancelled === true, show(damaged.asked.map((a) => a.question.detail)))
})

await guard('G', async () => {
  const ipc = source('src/main/ipc.ts')
  const handler = (channel) => { const start = ipc.indexOf(`CHANNELS.${channel},`); return start < 0 ? '' : ipc.slice(start, ipc.indexOf('\n  )\n', start)) }
  const setLimits = handler('settingsSetLimits')
  const setAskFirst = handler('settingsSetAskFirst')
  check('G: the set-limits handler is for a window (guardedForWindow) and goes through limitChanges.setLimits with that window', /guardedForWindow\(async \(window, input: unknown\)/.test(setLimits) && /limitChanges\.setLimits\(window, input\)/.test(setLimits), setLimits.slice(0, 200))
  check('G: the set-ask-first handler likewise (limitChanges.setAskFirst)', /guardedForWindow\(async \(window, input: unknown\)/.test(setAskFirst) && /limitChanges\.setAskFirst\(window, input\)/.test(setAskFirst))
  check('G: ipc.ts never saves a limit or the amount itself (no limitsStore.save, no askFirstStore.save)', !/limitsStore\.save|askFirstStore\.save/.test(ipc))
  check('G: one gate for the whole app, made once, from the system\'s message box (askPerson)', (ipc.match(/createQuestionGate\(/g) ?? []).length === 1 && /const questions = createQuestionGate\(askPerson\)/.test(ipc))
  const dialogs = source('src/main/backupDialogs.ts')
  const box = dialogs.slice(dialogs.indexOf('export const askPerson'), dialogs.indexOf('export const pickAttachmentPaths'))
  check('G: the message box: yes first, no second; no has the focus and is the Escape answer (defaultId 1, cancelId 1); noLink; only response 0 is a yes', /buttons: \[question\.yes, question\.no\]/.test(box) && /defaultId: 1,/.test(box) && /cancelId: 1,/.test(box) && /noLink: true/.test(box) && /return result\.response === 0/.test(box), box.slice(0, 120))
  check('G: ...modal to the window that asked, and `dialog` looked up when it is used (a test can stand in from main)', /dialog\.showMessageBox\(window, options\)/.test(box) && /^import \{ app, BrowserWindow, dialog \} from 'electron'/m.test(dialogs))
  const shared = source('src/shared/ipc.ts')
  const channels = shared.slice(shared.indexOf('export const CHANNELS'), shared.indexOf('} as const', shared.indexOf('export const CHANNELS')))
  check('G: no channel by which the page could answer a question (nothing named answer, question, approve or yes)', !/answer|question|approve|'yes/i.test(channels))
  const preload = source('src/preload/index.ts')
  const settingsPart = preload.slice(preload.indexOf('settings: {'), preload.indexOf('chat: {'))
  check('G: the preload\'s settings functions are the eight of Stage 8 (nothing added that answers)', (settingsPart.match(/^\s{4}\w+:/gm) ?? []).length === 8, String((settingsPart.match(/^\s{4}\w+:/gm) ?? []).length))
  for (const file of ['src/main/limitChanges.ts', 'src/main/systemQuestion.ts']) {
    check(`G: ${file} has no Electron import (checked here under plain Node)`, !/from 'electron'/.test(source(file)))
  }
  const gate = source('src/main/systemQuestion.ts')
  check('G: the gate takes only `true` as a yes', /const answered = await askPerson\(owner, question, signal\)/.test(gate) && /if \(answered === true\) return 'yes'/.test(gate) && (gate.match(/return 'yes'/g) ?? []).length === 1)
})

process.exit(check.summary() ? 0 : 1)
