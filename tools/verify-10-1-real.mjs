// Slice 10.1 once with the REAL system message box (D-039), on a scratch profile: the page is driven from the debug port (script calls through its own
// bridge, no mouse), and the box is read and answered with tools/real-dialogs.ps1 (UI Automation reads its texts; a window message presses a button of that
// box only; nothing else on the desktop is touched). NO screenshot is taken (the owner's rule for real dialogs). Proves what the suites with the stand-in
// cannot: that Windows really shows the box main asks for, modal to the app, with the words and buttons of the question and "Cancel" focused, and that
// Cancel, Escape (the box's own cancel) and the yes button each do what they say.
// usage: node tools/run-one.mjs real101 dev verify-10-1-real.mjs USER_DATA_DIR=s101real WIPE_USER_DATA=1
import { connect, checker, sleep } from './cdp.mjs'
import { assertScratchProfile } from './profile-guard.mjs'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { TOOLS } from './paths.mjs'

const port = Number(process.argv[3] ?? 9222)
const userData = process.env.USER_DATA_DIR
if (!userData) throw new Error('USER_DATA_DIR must be set')
const check = checker()
const page = await connect(port)
await assertScratchProfile()
const ev = (e) => page.evaluate(e)
const box = (op, extra = []) => {
  const r = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(TOOLS, 'real-dialogs.ps1'), '-Op', op, '-Port', String(port), ...extra], { encoding: 'utf8', timeout: 60000 })
  return ((r.stdout ?? '') + (r.stderr ?? '')).trim()
}
const limitsFile = join(userData, 'limits.json')
const limitsText = () => (existsSync(limitsFile) ? readFileSync(limitsFile, 'utf8') : null)
const ask = (daily) => ev(`(() => { window.__answer = undefined; window.api.settings.setLimits({ daily: { kind: 'usd', usd: ${daily} }, monthly: { kind: 'usd', usd: 50 } }).then((r) => { window.__answer = r }); return true })()`)
const answer = async () => { await page.waitFor('window.__answer !== undefined', { timeoutMs: 15000, label: 'the answer to the bridge call' }); return ev('window.__answer') }

try {
  await page.waitFor(`!!document.querySelector('.chat-bar')`, { timeoutMs: 20000, label: 'the app' })
  await sleep(500)
  // The harness gave this profile "No limit" for both; $5 and $50 is lower, so it is saved with no question.
  const lower = await ev(`window.api.settings.setLimits({ daily: { kind: 'usd', usd: 5 }, monthly: { kind: 'usd', usd: 50 } })`)
  check('a lower pair ($5, $50 from No limit) is saved with no box', lower.ok === true && limitsText() === '{"version":1,"daily":5,"monthly":50}' && /NO DIALOG/.test(box('gone')), JSON.stringify(lower).slice(0, 80))

  await ask(20)
  const found = box('find', ['-WaitSec', '15'])
  console.log(found)
  check('raising the daily limit to $20 through the page\'s own bridge puts the REAL system box in front of the person, titled "Spending limits"', /DIALOG title=\[Spending limits\]/.test(found), found.slice(0, 200))
  check('...asking "Raise your daily spending limit to $20.00?" with the lines "Daily limit: $20.00 (now $5.00)" and "Monthly limit: $50.00 (as now)"', found.includes('Raise your daily spending limit to $20.00?') && found.includes('Daily limit: $20.00 (now $5.00)') && found.includes('Monthly limit: $50.00 (as now)'))
  check('...and why it is asked there ("the app\'s page cannot answer")', /page cannot answer/.test(found))
  // A message box's buttons show in UI Automation as panes of class CCPushButton, ids CommandButton_100, _101, ... in order.
  const buttons = [...found.matchAll(/class=\[CCPushButton\] id=\[CommandButton_(\d+)\] name=\[([^\]]*)\][^\n]*focus=(True|False)/g)].map((m) => ({ id: Number(m[1]), name: m[2], focus: m[3] === 'True' }))
  check('...with two buttons, "Raise the limit" (100) and "Cancel" (101), and Cancel has the keyboard focus', JSON.stringify(buttons) === JSON.stringify([{ id: 100, name: 'Raise the limit', focus: false }, { id: 101, name: 'Cancel', focus: true }]), JSON.stringify(buttons))
  box('tdclick', ['-Value', '101'])
  const cancelled = await answer()
  check('pressing Cancel: the page is told "cancelled", and limits.json is as it was', cancelled.ok === false && cancelled.cancelled === true && limitsText() === '{"version":1,"daily":5,"monthly":50}', JSON.stringify(cancelled))
  check('...and the box is gone', /NO DIALOG/.test(box('gone')))

  await sleep(3300) // after a no, the app rests three seconds before it asks again
  await ask(20)
  box('find', ['-WaitSec', '15'])
  box('tdclick', ['-Value', '2'])
  const escaped = await answer()
  check('closing the box as Escape does (its cancel): "cancelled", nothing saved', escaped.cancelled === true && limitsText() === '{"version":1,"daily":5,"monthly":50}', JSON.stringify(escaped))

  await sleep(3300)
  await ask(20)
  box('find', ['-WaitSec', '15'])
  box('tdclick', ['-Value', '100'])
  const yes = await answer()
  check('pressing "Raise the limit": saved exactly what the box showed ($20 a day, $50 a month)', yes.ok === true && limitsText() === '{"version":1,"daily":20,"monthly":50}', JSON.stringify(yes).slice(0, 80))
  check('no box is left open', /NO DIALOG/.test(box('gone')))
} catch (error) {
  check(`the run stopped before its end: ${String(error?.stack ?? error).slice(0, 400)}`, false)
  console.log(box('gone'))
} finally {
  page.close()
}
process.exit(check.summary() ? 0 : 1)
