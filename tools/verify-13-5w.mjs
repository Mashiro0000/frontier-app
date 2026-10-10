// Stage 13.5 (D-043), in the real window against the mock, with the REAL box: running programs. The Tools page has a "Run programs" section (the folder dialog and the system's
// message box are replaced from the main inspector). Switching it on makes the self-test of the box on this PC (a real AppContainer and job object) and then asks in the box;
// a stopped test, a test the person says no to and a yes are each shown; a reply that runs node on a COPY of the workspace asks once for that run, shows the program, brings its
// text files back as proposals and changes nothing in the folder; Stop everything ends a program that is running; the generic switch cannot turn it on; switching off asks
// nothing and the tool is no longer offered; the page fits at 420 and 280 px, and the console stays clean.
// Needs: USER_DATA_DIR (scratch), INSPECT_PORT, MOCK_PORT, FRONTIER_RUN_ROOT (a folder of runs INSIDE this run's own folder: the app makes its folder of runs at the root of the
// workspace's drive, and from source it takes this variable instead, so that everything it makes and removes stays in the run's folder), a saved key (setup-key.mjs).
import './temp-on-a.mjs'
import './ts-resolve.mjs'
import { connect, checker, sleep } from './cdp.mjs'
import { assertScratchProfile } from './profile-guard.mjs'
import { h4, mainInspector } from './lib4.mjs'
import { installQuestions } from './lib10.mjs'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const port = Number(process.argv[3] ?? 9222)
const userData = process.env.USER_DATA_DIR
const inspectPort = Number(process.env.INSPECT_PORT)
const mockUrl = `http://127.0.0.1:${process.env.MOCK_PORT}`
const RUNS = process.env.FRONTIER_RUN_ROOT
if (!userData || !inspectPort || !process.env.MOCK_PORT || !RUNS) throw new Error('USER_DATA_DIR, INSPECT_PORT, MOCK_PORT and FRONTIER_RUN_ROOT must be set')
const check = checker()
// STOP_AFTER=C1 ends the run after that part; SKIP=C1,C2 leaves the parts out (a negative control that targets an early part needs no more than that). Parts: A B C1 C2 C3 D E F G.
class Done extends Error {}
const skipped = new Set((process.env.SKIP ?? '').split(',').filter((x) => x !== ''))
const part = (id) => { if (process.env.STOP_AFTER === id) throw new Done(id) }
const page = await connect(port)
await assertScratchProfile()
const H = h4(page, { userData, mockUrl })
const { ev } = H
const main = await mainInspector(inspectPort)
const Q = await installQuestions(main, { fallback: 'no' })
const show = (v) => JSON.stringify(v)?.slice(0, 600)
const TOOLS_FILE = join(userData, 'tools.json')
const json = (f) => (existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null)
const control = (body) => fetch(`${mockUrl}/__tools`, { method: 'POST', body: JSON.stringify(body) })

// the workspace: a folder in this run's own temp folder, with a script that prints, changes a file and makes one, a script that never ends, and a hidden file
const WS = join(realpathSync.native(mkdtempSync(join(tmpdir(), 'frontier-135w-'))), 'project')
mkdirSync(WS, { recursive: true })
const HELLO = [
  "const fs = require('fs')",
  "console.log('HELLO-FROM-THE-BOX ' + process.argv.slice(2).join(' '))",
  "fs.appendFileSync('data.txt', 'added by the program\\n')",
  "fs.writeFileSync('made.txt', 'made by the program\\n')",
  "try { fs.readFileSync(process.env.USERPROFILE + '\\\\ntuser.dat') } catch (e) { console.log('USER-FILE-REFUSED ' + e.code) }"
].join('\n')
writeFileSync(join(WS, 'hello.js'), HELLO)
writeFileSync(join(WS, 'sleeper.js'), "setInterval(() => {}, 1000)\nconsole.log('SLEEPER-STARTED')\n")
writeFileSync(join(WS, 'data.txt'), 'original data\n')
writeFileSync(join(WS, '.env'), 'SECRET-CANARY\n')
const treeText = () => readdirSync(WS).sort().map((n) => `${n}:${readFileSync(join(WS, n), 'utf8').length}`).join(',')
const WS_BEFORE = treeText()
await main.inMain(`(() => { const { dialog } = process.mainModule.require('electron'); const p = globalThis.__pick = { next: null, calls: [] }; dialog.showOpenDialog = async (...args) => { p.calls.push({ options: args.at(-1) }); return p.next === null ? { canceled: true, filePaths: [] } : { canceled: false, filePaths: [p.next] } }; return true })()`)
const pick = (path) => main.inMain(`globalThis.__pick.next = ${JSON.stringify(path)}; true`)

const openTools = async () => { await H.clickChat('Tools'); await page.waitFor(`!!document.querySelector('dialog.tools')?.open`, { timeoutMs: 8000, label: 'Tools' }); await sleep(500) }
const closeTools = async () => { await page.press('Escape'); await sleep(300) }
const sectionOf = (id) => `[...document.querySelectorAll('dialog.tools .tools-section')].find((x) => x.querySelector('#${id}'))`
const progs = () => ev(`(() => { const s = ${sectionOf('tools-programs-title')}; if (!s) return null; const t = s.querySelector('.tools-toggle'); return { toggle: t ? { on: t.getAttribute('aria-checked') === 'true', disabled: t.disabled } : null, hint: s.querySelector('.tools-switch-text .tools-hint')?.textContent ?? null, notice: s.querySelector('.tools-notice')?.textContent ?? null, alerts: [...s.querySelectorAll('[role=alert]')].map((x) => x.textContent), stop: !!s.querySelector('.programs-stop button'), report: s.querySelector('.programs-report .tools-hint')?.textContent ?? null, lines: [...s.querySelectorAll('.programs-lines li')].map((li) => ({ good: li.classList.contains('programs-good'), label: li.querySelector('.programs-label')?.textContent })) } })()`)
const clickProgToggle = () => ev(`(() => { ${sectionOf('tools-programs-title')}.querySelector('.tools-toggle').click(); return true })()`)
const clickProgStop = () => ev(`(() => { ${sectionOf('tools-programs-title')}.querySelector('.programs-stop button').click(); return true })()`)
const progIdle = (label) => page.waitFor(`(() => { const s = ${sectionOf('tools-programs-title')}; const t = s?.querySelector('.tools-toggle'); return !!t && !t.disabled && !s.querySelector('.programs-stop') })()`, { timeoutMs: 240000, label })
const noteCards = () => ev(`[...document.querySelectorAll('.message-assistant .tool-note')].map((n) => ({ title: n.querySelector('.tool-note-title')?.textContent, about: n.querySelector('.tool-note-about')?.textContent ?? null, outcome: n.querySelector('.tool-note-outcome')?.textContent ?? null }))`)
async function converse(text, { timeoutMs = 90000 } = {}) {
  await H.send(text)
  await page.waitFor(`!!document.querySelector('.composer-button[type=submit]')`, { timeoutMs })
  await sleep(300)
}
const lastRequestTools = async () => { const reqs = (await H.mockReqs()).filter((r) => r.body && Array.isArray(r.body.messages)); return (reqs.at(-1)?.body.tools ?? []).map((t) => t.name) }
const toolResultsOf = async () => (await H.mockReqs()).filter((r) => r.body && Array.isArray(r.body.messages)).flatMap((r) => r.body.messages.flatMap((m) => (Array.isArray(m.content) ? m.content.filter((b) => b?.type === 'tool_result') : []))).map((b) => (typeof b.content === 'string' ? b.content : (b.content ?? []).map((x) => x?.text ?? '').join('')))
const scratchCount = () => (existsSync(join(RUNS, 'scratch')) ? readdirSync(join(RUNS, 'scratch')).length : 0)
const boxProcesses = () => {
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', "(Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne $PID -and $_.ExecutablePath -like '*FrontierRun*' } | Measure-Object).Count"], { encoding: 'utf8', timeout: 60000 })
  return Number((r.stdout ?? '').trim())
}

try {
  await page.waitFor(`document.readyState === 'complete' && !!document.querySelector('.header-select, .app-badge')`, { timeoutMs: 15000 })
  await sleep(300)
  await ev(`window.api.settings.setModel('claude-opus-5-5')`)

  // ============ A. the page, with no folder ============
  await openTools()
  const first = await ev(`(() => { const d = document.querySelector('dialog.tools'); return { sections: [...d.querySelectorAll('.tools-section-title')].map((x) => x.textContent), switches: [...d.querySelectorAll('ul[aria-label=Tools] .tools-switch-title')].map((x) => x.textContent) } })()`)
  check('A: the Tools page has "Run programs" after the code workspace and before the changes waiting', show(first.sections) === show(['What the model may ask for', 'Code workspace', 'Run programs', 'Changes waiting', 'Audit log']), show(first))
  check('A: the generic list of tools has only web search (running programs has its own switch)', show(first.switches) === show(['Search the web']))
  let p = await progs()
  let asked = []
  check('A: with no folder the switch is off and cannot be turned on, and says to choose a folder first', p.toggle.on === false && p.toggle.disabled === true && /Choose a workspace folder first/.test(p.hint ?? ''), show(p))
  const st0 = await ev(`window.api.programs.status()`)
  check('A: main\'s status: off, no folder, Node.js found, no test yet, nothing wrong', st0.on === false && st0.workspaceReady === false && st0.nodeInstalled === true && st0.testing === false && st0.test === null && st0.problem === null, show(st0))
  await Q.reset()
  const generic = await ev(`window.api.tools.setEnabled('run_program', true)`)
  check('A: the generic switch cannot turn it on (refused, nobody asked, nothing written)', generic.ok === false && (await Q.count()) === 0 && json(TOOLS_FILE) === null, show(generic))
  const apiKeys = await ev(`Object.keys(window.api.programs).sort().join()`)
  check('A: the page can read the status, switch and stop a test, and do nothing else with programs (no run, no path, no argument)', apiKeys === 'setOn,status,stopTest', apiKeys)
  const sent = await ev(`window.api.programs.setOn('yes')`).then((r) => r, (e) => ({ thrown: String(e) }))
  check('A: a switch that is not true or false is not understood', sent.ok === false && /not understood/.test(sent.error ?? ''), show(sent))

  part('A')
  // ============ B. choosing the folder ============
  await closeTools()
  await openTools()
  await pick(WS)
  await Q.reset()
  await Q.queue('yes')
  await ev(`(() => { const s = ${sectionOf('tools-workspace-title')}; [...s.querySelectorAll('button')].find((b) => b.textContent === 'Choose a folder...').click(); return true })()`)
  await sleep(1500)
  p = await progs()
  check('B: with a folder the switch can be turned on, and is still off', p.toggle.disabled === false && p.toggle.on === false && /Each run asks you once/.test(p.hint ?? ''), show(p))
  const st1 = await ev(`window.api.programs.status()`)
  check('B: main\'s status says the folder is ready', st1.workspaceReady === true && st1.on === false, show(st1))

  part('B')
  // ============ C1. a test the person stops ============
  if (!skipped.has('C1')) {
  await Q.reset()
  await clickProgToggle()
  await page.waitFor(`!!${sectionOf('tools-programs-title')}.querySelector('.programs-stop button')`, { timeoutMs: 15000, label: 'the Stop button of the test' })
  p = await progs()
  check('C1: while the test goes on the page says so, offers "Stop the test", and the switch cannot be pressed', p.stop === true && p.toggle.disabled === true && /Testing the box/.test((p.hint ?? '') + (p.notice ?? '')), show(p))
  const stDuring = await ev(`window.api.programs.status()`)
  check('C1: main says a test is going on (from the moment it is asked for, while the box is still being made)', stDuring.testing === true, show(stDuring))
  await sleep(1500)
  await clickProgStop()
  await progIdle('the stopped test to end')
  p = await progs()
  check('C1: Stop ends the test; the switch is off, nobody was asked, nothing was written, and the page says it was stopped', p.toggle.on === false && (await Q.count()) === 0 && json(TOOLS_FILE) === null && /stopped/i.test(p.notice ?? ''), show(p))
  check('C1: nothing is left of the test: no scratch copy, no program of the box running', scratchCount() === 0 && boxProcesses() === 0, show({ scratch: scratchCount(), procs: boxProcesses() }))
  }
  part('C1')

  // ============ C2. a test that passes and a no ============
  if (!skipped.has('C2')) {
  await Q.reset()
  await Q.queue('no')
  await clickProgToggle()
  await progIdle('the self-test (a no at the end)')
  p = await progs()
  asked = await Q.asked()
  check('C2: the REAL test passed: twelve lines, all good, and "Passed" above them', p.lines.length === 12 && p.lines.every((l) => l.good) && /^Passed/.test(p.report ?? ''), show(p))
  check('C2: then ONE question in the system\'s box, for this window, in its own words, with "Don\'t turn on" as the default', asked.length === 1 && asked[0].withWindow === true && asked[0].options.message === 'Let the model ask to run programs?' && /passed all 12 checks/.test(asked[0].options.detail) && /Every run asks you first/.test(asked[0].options.detail) && show(asked[0].options.buttons) === show(['Turn on', "Don't turn on"]) && asked[0].options.defaultId === 1 && asked[0].options.cancelId === 1, show(asked.map((a) => a.options)))
  check('C2: a no leaves it off and writes nothing, and the page says it was left as it was', p.toggle.on === false && json(TOOLS_FILE) === null && /as it was|still off/i.test(p.notice ?? ''), show(p))
  const stAfterNo = await ev(`window.api.programs.status()`)
  check('C2: but the test of this session passed, and main still does not let a run through (the switch is off)', stAfterNo.test?.ok === true && stAfterNo.on === false, show(stAfterNo))
  }
  part('C2')

  // ============ C3. a yes ============
  await sleep(3300)
  await Q.reset()
  await Q.queue('yes')
  await clickProgToggle()
  await progIdle('the self-test (a yes at the end)')
  p = await progs()
  check('C3: a yes turns it on: the switch is on, the file holds the one setting and the caps, nothing else', p.toggle.on === true && show(json(TOOLS_FILE)) === show({ version: 1, enabled: { run_program: true }, caps: { steps: 5, seconds: 60 } }), show([p, json(TOOLS_FILE)]))
  check('C3: the report is still there, all good', p.lines.length === 12 && p.lines.every((l) => l.good), show(p.lines))
  await closeTools()
  part('C3')

  // ============ D. a reply that runs a program ============
  await H.clickChat('New chat')
  await control({ calls: [{ name: 'run_program', input: { why: 'to run the script and see what it prints', program: 'node', args: ['hello.js', 'one'], folder: '.' } }] })
  await Q.reset()
  await Q.queue('yes')
  await ev(`window.__sawStop = []; new MutationObserver(() => { const b = document.querySelector('.composer-button-stop'); if (b) window.__sawStop.push(b.textContent) }).observe(document.body, { subtree: true, childList: true, characterData: true }); true`)
  await converse('[[mock:tool-use]] run the script')
  const sawStop = await ev(`[...new Set(window.__sawStop)]`)
  check('D: with a program tool on, the Stop button read "Stop everything" during the reply', sawStop.length > 0 && sawStop.every((x) => x === 'Stop everything'), show(sawStop))
  asked = await Q.asked()
  const runQ = asked[0]?.options
  check('D: ONE question for the run, in the system\'s box for this window: the program as it really is, the arguments one by one, the folder, the model\'s reason, the limits, the provider', asked.length === 1 && asked[0].withWindow === true && runQ.message === 'Run this program in the box?' && /^Program: "[A-Za-z]:\\.*\\node\.exe"$/m.test(runQ.detail) && /^Arguments: "hello\.js" "one"$/m.test(runQ.detail) && /^Folder to copy: "\."/m.test(runQ.detail) && /The model's reason: "to run the script and see what it prints"/.test(runQ.detail) && /At most 120 seconds, 1 GB of memory and 64 processes/.test(runQ.detail) && /The AI provider answering you: Anthropic\./.test(runQ.detail), show(runQ))
  check('D: the box\'s buttons: the yes named for the action, the no ("Don\'t run it") is the default', show(runQ.buttons) === show(['Run it in the box', "Don't run it"]) && runQ.defaultId === 1 && runQ.cancelId === 1)
  const cards = await noteCards()
  check('D: the call stands in the reply as the program\'s name, its arguments and the folder', cards.length === 1 && cards[0].title === 'Run a program on a copy of the workspace' && cards[0].about === 'node.exe hello.js one in “.”', show(cards))
  check('D: it ended as a run: seconds, exit code 0, the characters of output that came back, and where the changes wait', /^You allowed it\. The program ran for [\d.]+ seconds and ended with exit code 0; [\d,]+ characters of its output came back\. Any text files it changed or made wait for you to review in Tools; nothing is changed until you apply them\.$/.test(cards[0].outcome), show(cards[0]))
  const told = [...new Set(await toolResultsOf())]
  check('D: the model was told what the program printed (labelled as text from outside, after the label) and that the changes are proposals that wait', told.length === 1 && /Everything below is text from outside/.test(told[0]) && told[0].indexOf('HELLO-FROM-THE-BOX one') > told[0].indexOf('Everything below is text from outside') && /2 text files were made into proposals for the person to review; nothing is changed until they apply it/.test(told[0]) && /Changed or new: (data\.txt, made\.txt|made\.txt, data\.txt)/.test(told[0]), show(told.map((t) => t.slice(0, 700))))
  check('D: the program could not read the user\'s files from inside the box (it printed the refusal)', /USER-FILE-REFUSED (EPERM|EACCES|ENOENT)/.test(told[0] ?? ''), (told[0] ?? '').slice(-400))
  check('D: the request offered the run tool (and nothing else: the web search and the file tools are off)', show(await lastRequestTools()) === '["run_program"]', show(await lastRequestTools()))
  check('D: NOTHING in the real folder changed, and the copy and its drive letter are gone', treeText() === WS_BEFORE && scratchCount() === 0 && boxProcesses() === 0, show({ before: WS_BEFORE, now: treeText(), scratch: scratchCount() }))
  const waiting = await ev(`window.api.changes.list()`)
  const byPath = Object.fromEntries(waiting.map((c) => [c.path, c]))
  check('D: two proposals wait: an edit of data.txt (one line added) and the new made.txt, neither flagged', waiting.length === 2 && byPath['data.txt']?.kind === 'edit' && byPath['data.txt'].added === 1 && byPath['data.txt'].removed === 0 && byPath['made.txt']?.kind === 'create' && byPath['made.txt'].added === 1 && waiting.every((c) => c.secret === false), show(waiting))
  const log = await ev(`window.api.audit.read()`)
  const runCall = log.ok ? log.calls.find((c) => c.tool === 'run_program') : null
  check('D: the audit log has the run: the question, the yes and its numbers (exited, exit code 0, one changed, one new), and none of what the program printed', !!runCall && runCall.outcome.kind === 'ran-program' && runCall.outcome.program.end === 'exited' && runCall.outcome.program.exitCode === 0 && runCall.outcome.program.changed === 1 && runCall.outcome.program.created === 1 && !JSON.stringify(log).includes('HELLO-FROM-THE-BOX'), show(runCall))
  await sleep(700)
  const saved = H.allConvs().find((c) => (c.messages ?? []).some((m) => /run the script/.test(m.content ?? '')))
  const savedReply = saved?.messages?.at(-1)
  check('D: the saved chat holds the call and how it ended, and not one word of what the program printed', savedReply?.tools?.length === 1 && savedReply.tools[0].outcome.kind === 'ran-program' && !JSON.stringify(saved).includes('HELLO-FROM-THE-BOX'), show(savedReply?.tools?.map((t) => t.outcome)))

  part('D')
  // ============ E. a program that never ends, and Stop everything ============
  await sleep(3300)
  await H.clickChat('New chat')
  await control({ calls: [{ name: 'run_program', input: { why: 'to start a server', program: 'node', args: ['sleeper.js'], folder: '.' } }] })
  await Q.reset()
  await Q.queue('yes')
  await H.send('[[mock:tool-use]] start the sleeper')
  await page.waitFor(`/Working on it/.test(document.querySelector('.message-assistant .tool-note-outcome')?.textContent ?? '')`, { timeoutMs: 60000, label: 'the run to be going' })
  await sleep(3000)
  const during = await ev(`document.querySelector('.composer-button-stop')?.textContent ?? null`)
  await page.click('.composer-button-stop')
  await page.waitFor(`!!document.querySelector('.composer-button[type=submit]')`, { timeoutMs: 60000, label: 'the reply to end' })
  await sleep(2500)
  const stopped = await noteCards()
  check('E: the button said "Stop everything" while the program ran; the reply ended, and the call says it started and was stopped', during === 'Stop everything' && stopped.length === 1 && /It started, but it failed or was stopped\./.test(stopped[0].outcome), show({ during, stopped }))
  check('E: the program was ended, no copy is left, and nothing in the real folder changed', boxProcesses() === 0 && scratchCount() === 0 && treeText() === WS_BEFORE, show({ procs: boxProcesses(), scratch: scratchCount() }))

  part('E')
  // ============ F. off ============
  await sleep(3300)
  await openTools()
  await Q.reset()
  await clickProgToggle()
  await sleep(1500)
  p = await progs()
  check('F: switching off asks nothing, and the file says run_program is false', (await Q.count()) === 0 && p.toggle.on === false && json(TOOLS_FILE)?.enabled?.run_program === false, show([p.toggle, json(TOOLS_FILE)]))
  await closeTools()
  await H.clickChat('New chat')
  await control({})
  await converse('hello with the run tool off')
  check('F: with it off the request offers no tool at all', show(await lastRequestTools()) === '[]', show(await lastRequestTools()))

  part('F')
  // ============ G. the page fits ============
  await openTools()
  for (const width of [420, 280]) {
    await page.send('Emulation.setDeviceMetricsOverride', { width, height: 800, deviceScaleFactor: 1, mobile: false })
    await sleep(300)
    const fit = await ev(`(() => { const d = document.querySelector('dialog.tools'); const s = ${sectionOf('tools-programs-title')}; const r = s.getBoundingClientRect(); const dr = d.getBoundingClientRect(); return { overflow: d.scrollWidth - d.clientWidth, sectionRight: r.right, dialogRight: dr.right, lines: [...s.querySelectorAll('.programs-lines li')].every((li) => li.getBoundingClientRect().right <= dr.right + 1) } })()`)
    check(`G: at ${width} px nothing of the "Run programs" section sticks out sideways (the twelve lines wrap)`, fit.overflow <= 1 && fit.sectionRight <= fit.dialogRight + 1 && fit.lines === true, show(fit))
  }
  await page.send('Emulation.clearDeviceMetricsOverride', {})
  await closeTools()

  check('G: the page logged no errors and no warnings in the whole run', page.problems.length === 0, show(page.problems))
} catch (error) {
  if (!(error instanceof Done)) check(`the suite stopped before its end: ${String(error?.stack ?? error).slice(0, 500)}`, false)
}
const ok = check.summary()
process.exit(ok ? 0 : 1)
