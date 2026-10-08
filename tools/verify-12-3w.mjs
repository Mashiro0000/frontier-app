// Stage 12.3 (D-042), in the real window against the mock: the code workspace. The Tools page has a "Code workspace" section (the folder dialog and the system's
// message box are replaced from the main inspector): choosing a folder and switching the tools on ask in the box, a reply that lists and reads files asks ONCE
// for the whole reply and shows each call where the model stopped to ask, a hidden file is asked about on its own, a path outside or in .git is refused with no
// question, the saved chat holds the calls and none of the files' text, switching off and clearing stop the tools being offered, the section fits at 420 and
// 280 px, and the console stays clean.
// Needs: USER_DATA_DIR (scratch), INSPECT_PORT, MOCK_PORT, a saved key (setup-key.mjs).
import './ts-resolve.mjs'
import { connect, checker, sleep } from './cdp.mjs'
import { assertScratchProfile } from './profile-guard.mjs'
import { h4, mainInspector } from './lib4.mjs'
import { installQuestions } from './lib10.mjs'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const port = Number(process.argv[3] ?? 9222)
const userData = process.env.USER_DATA_DIR
const inspectPort = Number(process.env.INSPECT_PORT)
const mockUrl = `http://127.0.0.1:${process.env.MOCK_PORT}`
if (!userData || !inspectPort || !process.env.MOCK_PORT) throw new Error('USER_DATA_DIR, INSPECT_PORT and MOCK_PORT must be set')
const check = checker()
const page = await connect(port)
await assertScratchProfile()
const H = h4(page, { userData, mockUrl })
const { ev } = H
const main = await mainInspector(inspectPort)
const Q = await installQuestions(main, { fallback: 'no' })
const show = (v) => JSON.stringify(v)?.slice(0, 500)
const TOOLS_FILE = join(userData, 'tools.json')
const WS_FILE = join(userData, 'workspace.json')
const json = (f) => (existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null)
const control = (body) => fetch(`${mockUrl}/__tools`, { method: 'POST', body: JSON.stringify(body) })

// the scratch workspace: a few ordinary files, a hidden one and a git one, and a folder beside it
const base = mkdtempSync(join(tmpdir(), 'frontier-123w-'))
const WS = join(realpathSync.native(base), 'project')
const OUTSIDE = join(base, 'outside')
for (const [rel, text] of [['notes.txt', 'POSITIVE-notes\nsecond line'], ['src/main.ts', 'export const x = 1\n'], ['.env', 'SECRET-CANARY env'], ['.git/config', 'GIT-CANARY']]) {
  mkdirSync(join(WS, rel, '..'), { recursive: true })
  writeFileSync(join(WS, rel), text)
}
mkdirSync(OUTSIDE, { recursive: true })
writeFileSync(join(OUTSIDE, 'secret.txt'), 'OUTSIDE-CANARY')
await main.inMain(`(() => { const { dialog } = process.mainModule.require('electron'); const p = globalThis.__pick = { next: null, calls: [] }; dialog.showOpenDialog = async (...args) => { p.calls.push({ withWindow: args.length > 1, options: args.at(-1) }); return p.next === null ? { canceled: true, filePaths: [] } : { canceled: false, filePaths: [p.next] } }; return true })()`)
const pick = (path) => main.inMain(`globalThis.__pick.next = ${JSON.stringify(path)}; true`)
const picks = async () => JSON.parse(await main.inMain('JSON.stringify(globalThis.__pick.calls)'))

const openTools = async () => { await H.clickChat('Tools'); await page.waitFor(`!!document.querySelector('dialog.tools')?.open`, { timeoutMs: 8000, label: 'Tools' }); await sleep(500) }
const closeTools = async () => { await page.press('Escape'); await sleep(300) }
const wsText = () => ev(`(() => { const s = [...document.querySelectorAll('dialog.tools .tools-section')].find((x) => x.querySelector('#tools-workspace-title')); return s ? { path: s.querySelector('.workspace-path')?.textContent ?? null, buttons: [...s.querySelectorAll('.workspace-buttons button')].map((b) => ({ text: b.textContent, disabled: b.disabled })), toggle: (() => { const t = s.querySelector('.tools-toggle'); return t ? { on: t.getAttribute('aria-checked') === 'true', disabled: t.disabled } : null })(), notice: s.querySelector('.tools-notice')?.textContent ?? null, alert: [...s.querySelectorAll('[role=alert]')].map((x) => x.textContent) } : null })()`)
const click = (text) => ev(`(() => { const s = [...document.querySelectorAll('dialog.tools .tools-section')].find((x) => x.querySelector('#tools-workspace-title')); const b = [...s.querySelectorAll('button')].find((x) => x.textContent === ${JSON.stringify(text)}); b.click(); return true })()`)
const clickToggle = () => ev(`(() => { const s = [...document.querySelectorAll('dialog.tools .tools-section')].find((x) => x.querySelector('#tools-workspace-title')); s.querySelector('.tools-toggle').click(); return true })()`)
const settle = async (ms = 700) => { await sleep(ms) }
const noteCards = () => ev(`[...document.querySelectorAll('.message-assistant .tool-note')].map((n) => ({ title: n.querySelector('.tool-note-title')?.textContent, about: n.querySelector('.tool-note-about')?.textContent ?? null, outcome: n.querySelector('.tool-note-outcome')?.textContent ?? null }))`)
async function converse(text, { timeoutMs = 40000 } = {}) {
  await H.send(text)
  await page.waitFor(`!!document.querySelector('.composer-button[type=submit]')`, { timeoutMs })
  await sleep(300)
}
const lastRequestTools = async () => { const reqs = (await H.mockReqs()).filter((r) => r.body && Array.isArray(r.body.messages)); return (reqs.at(-1)?.body.tools ?? []).map((t) => t.name) }
const toolResultsOf = async () => (await H.mockReqs()).filter((r) => r.body && Array.isArray(r.body.messages)).flatMap((r) => r.body.messages.flatMap((m) => (Array.isArray(m.content) ? m.content.filter((b) => b?.type === 'tool_result') : []))).map((b) => (typeof b.content === 'string' ? b.content : (b.content ?? []).map((x) => x?.text ?? '').join('')))
const uniqueResults = async () => [...new Set(await toolResultsOf())]

try {
  await page.waitFor(`document.readyState === 'complete' && !!document.querySelector('.header-select, .app-badge')`, { timeoutMs: 15000 })
  await sleep(300)
  await ev(`window.api.settings.setModel('claude-opus-5-5')`)

  // ============ A. the page, with no folder ============
  await openTools()
  const first = await ev(`(() => { const d = document.querySelector('dialog.tools'); return { sections: [...d.querySelectorAll('.tools-section-title')].map((x) => x.textContent), switches: [...d.querySelectorAll('ul[aria-label=Tools] .tools-switch-title')].map((x) => x.textContent) } })()`)
  check('A: the Tools page has the switches, the code workspace and the audit log, in that order', show(first.sections) === show(['What the model may ask for', 'Code workspace', 'Audit log']), show(first))
  check('A: the list of tools has only web search (the workspace has its own switch)', show(first.switches) === show(['Search the web']))
  let w = await wsText()
  check('A: no folder is chosen, the way to choose one is there, no Clear, and the switch is off and cannot be turned on', w.path === 'No folder is chosen.' && show(w.buttons) === show([{ text: 'Choose a folder...', disabled: false }]) && w.toggle.on === false && w.toggle.disabled === true, show(w))
  check('A: nothing is kept yet', json(WS_FILE) === null)

  // ============ B. choosing the folder ============
  await Q.reset()
  await pick(null)
  await click('Choose a folder...')
  await settle()
  w = await wsText()
  check('B: closing the folder dialog changes nothing and says so, with no question', (await Q.count()) === 0 && /No folder was chosen/.test(w.notice ?? '') && json(WS_FILE) === null, show(w))
  const dialogCalls = await picks()
  check('B: the folder dialog was opened by main for this window, with the "open a folder" property (the page sent no path)', dialogCalls.length === 1 && dialogCalls[0].withWindow === true && dialogCalls[0].options.properties.join() === 'openDirectory')
  await pick(realpathSync.native(userData))
  await click('Choose a folder...')
  await settle()
  w = await wsText()
  check('B: the app\'s own data folder is refused in words before any question', (await Q.count()) === 0 && /data folder/.test(w.alert.join(' ') + (w.notice ?? '')) && json(WS_FILE) === null, show(w))
  await pick(WS)
  await Q.queue('no')
  await click('Choose a folder...')
  await settle(900)
  let asked = await Q.asked()
  w = await wsText()
  check('B: a good folder asks in the system\'s box for this window, naming the folder in quotes; a no keeps nothing', asked.length === 1 && asked[0].withWindow === true && asked[0].options.message === 'Use this folder as your code workspace?' && asked[0].options.detail.includes(`"${WS.replaceAll('\\', '\\\\')}"`) && json(WS_FILE) === null && /as it was/.test(w.notice ?? ''), show([asked.map((a) => a.options.detail.slice(0, 120)), w.notice]))
  check('B: the box has two buttons, the yes named for the action, and the no is the default', show(asked[0].options.buttons) === show(['Use this folder', "Don't use it"]) && asked[0].options.defaultId === 1 && asked[0].options.cancelId === 1)
  await sleep(3300)
  await Q.reset()
  await Q.queue('yes')
  await click('Choose a folder...')
  await settle(900)
  w = await wsText()
  check('B: a yes keeps it: the page shows the folder and a Clear button, and workspace.json holds exactly that', w.path?.toLowerCase() === WS.toLowerCase() && w.buttons.map((b) => b.text).join() === 'Choose another...,Clear' && json(WS_FILE)?.version === 1 && json(WS_FILE)?.folder.toLowerCase() === WS.toLowerCase() && Object.keys(json(WS_FILE)).join() === 'version,folder,chosenAt', show([w, json(WS_FILE)]))
  check('B: the switch can now be turned on, and is still off', w.toggle.disabled === false && w.toggle.on === false && json(TOOLS_FILE) === null)

  // ============ C. switching on ============
  await sleep(3300)
  await Q.reset()
  await Q.queue('no')
  await clickToggle()
  await settle(900)
  asked = await Q.asked()
  w = await wsText()
  check('C: switching on asks in the box, with the folder in quotes, what the yes covers and who gets the text; a no leaves it off', asked.length === 1 && asked[0].options.message === 'Let the model ask to use your workspace?' && /your yes covers that one reply only/.test(asked[0].options.detail) && /AI provider/.test(asked[0].options.detail) && w.toggle.on === false && json(TOOLS_FILE) === null, show([asked[0]?.options.detail.slice(0, 200), w.toggle]))
  await sleep(3300)
  await Q.reset()
  await Q.queue('yes')
  await clickToggle()
  await settle(900)
  w = await wsText()
  check('C: a yes turns both tools on; the file holds them and the caps, nothing else', w.toggle.on === true && show(json(TOOLS_FILE)) === show({ version: 1, enabled: { list_files: true, read_file: true }, caps: { steps: 5, seconds: 60 } }), show(json(TOOLS_FILE)))
  await closeTools()

  // ============ D. a reply that lists and reads ============
  await H.clickChat('New chat')
  await control({ calls: [{ name: 'list_files', input: { path: '.' } }, { name: 'read_file', input: { path: 'notes.txt', start_line: 1, max_lines: 50 } }] })
  await Q.reset()
  await Q.queue('yes')
  await ev(`window.__sawStop = []; new MutationObserver(() => { const b = document.querySelector('.composer-button-stop'); if (b) window.__sawStop.push(b.textContent) }).observe(document.body, { subtree: true, childList: true, characterData: true }); true`)
  await converse('[[mock:tool-use]] look at my files')
  const sawStop = await ev(`[...new Set(window.__sawStop)]`)
  check('D: with only the workspace tools on, the Stop button read "Stop everything" during the reply', sawStop.length > 0 && sawStop.every((x) => x === 'Stop everything'), show(sawStop))
  asked = await Q.asked()
  check('D: ONE box for the whole reply: the reply\'s, naming the workspace, the first call, the provider and the caps', asked.length === 1 && asked[0].options.message === 'Allow file access for this reply?' && asked[0].options.title === 'Code workspace' && asked[0].options.detail.includes(`"${WS.replaceAll('\\', '\\\\')}"`) && /First call: List files in the workspace: "\."/.test(asked[0].options.detail) && /The AI provider answering you: Anthropic\./.test(asked[0].options.detail) && /At most 30 file calls and 200,000 characters/.test(asked[0].options.detail), show(asked.map((a) => a.options.detail)))
  const cards = await noteCards()
  check('D: both calls stand in the reply, in order, with what was asked (the real path each tool was given, in quotes) and how each ended', cards.length === 2 && cards[0].title === 'List files in the workspace' && cards[0].about.toLowerCase() === `“${WS}”`.toLowerCase() && cards[1].title === 'Read a file in the workspace' && cards[1].about.toLowerCase() === `“${join(WS, 'notes.txt')}”, 1, 50`.toLowerCase(), show(cards))
  check('D: the first ended as a yes ("You allowed it"), the second as covered by the reply\'s yes, each with the characters that came back', /^You allowed it\. [\d,]+ characters came back\.$/.test(cards[0].outcome) && /^Allowed for this reply\. [\d,]+ characters came back\.$/.test(cards[1].outcome), show(cards.map((c) => c.outcome)))
  const results = await uniqueResults()
  check('D: the model was told the names (after the label) and then the file\'s text (after its label), each only inside its tool\'s result', results.length === 2 && /^The contents of the folder "\." in the person's workspace/.test(results[0]) && /notes\.txt/.test(results[0]) && /src\//.test(results[0]) && !/\.env|\.git/.test(results[0].split('\n').filter((l) => !l.startsWith('(')).join('\n')) && /^The text of the file "notes\.txt" in the person's workspace \(UTF-8, Unix line endings; 2 lines\)\./.test(results[1]) && /1\| POSITIVE-notes\n2\| second line/.test(results[1]), show(results.map((r) => r.slice(0, 160))))
  check('D: the request offered the two tools (and not the web search, which is off)', (await lastRequestTools()).sort().join() === 'list_files,read_file', show(await lastRequestTools()))
  const log = await ev(`window.api.audit.read()`)
  check('D: the audit log has both calls: the first an ordinary yes, the second covered, no file text anywhere in it', log.ok && log.calls.length === 2 && log.calls.some((c) => c.tool === 'list_files' && c.outcome.kind === 'done' && c.outcome.covered === undefined) && log.calls.some((c) => c.tool === 'read_file' && c.outcome.kind === 'done' && c.outcome.covered === true) && !JSON.stringify(log).includes('POSITIVE'), show(log.calls?.map((c) => [c.tool, c.outcome])))
  await sleep(700)
  const saved = H.allConvs().find((c) => (c.messages ?? []).some((m) => /look at my files/.test(m.content ?? '')))
  const reply = saved?.messages?.at(-1)
  check('D: the saved chat holds the two calls with their outcomes, and not one word of what was read', saved?.version === 6 && reply?.tools?.length === 2 && reply.tools.some((t) => t.outcome.covered === true) && !JSON.stringify(saved).includes('POSITIVE-notes') && !JSON.stringify(saved).includes('second line'), show(reply?.tools?.map((t) => t.outcome)))

  // ============ E. a hidden file, a path outside, a git file ============
  await sleep(3300)
  await H.clickChat('New chat')
  await control({ calls: [{ name: 'read_file', input: { path: '.env', start_line: 1, max_lines: 10 } }, { name: 'read_file', input: { path: '../outside/secret.txt', start_line: 1, max_lines: 10 } }, { name: 'read_file', input: { path: '.git/config', start_line: 1, max_lines: 10 } }, { name: 'list_files', input: { path: 'src' } }] })
  await Q.reset()
  await Q.queue('yes', 'no')
  await converse('[[mock:tool-use]] look at the hidden things')
  asked = await Q.asked()
  const c2 = await noteCards()
  check('E: a hidden file as the first call: the reply\'s box and then the file\'s own box (two in all), the second naming the file', asked.length === 2 && asked[0].options.message === 'Allow file access for this reply?' && asked[1].options.message === 'Allow the model to read this file?' && /File: "\.env"/.test(asked[1].options.detail) && /hidden/.test(asked[1].options.detail), show(asked.map((a) => a.options.message)))
  check('E: the person said no to the file: the call says so; the model was given the fixed sentence, not the text', /You said no\./.test(c2[0].outcome) && !(await toolResultsOf()).some((r) => /SECRET-CANARY/.test(r)))
  check('E: a path that leaves the workspace and a git file are refused with no question, in words', /Refused: the path leaves the workspace\./.test(c2[1].outcome) && /Refused: it named a place that is never reached/.test(c2[2].outcome) && asked.length === 2, show(c2.map((c) => c.outcome)))
  check('E: the list after them still runs, covered by the reply\'s yes (the no to one file is not a no to the reply)', /^Allowed for this reply\./.test(c2[3].outcome), show(c2[3]))
  check('E: no canary of the hidden file, the git file or the folder outside came back in anything the model was told', !(await toolResultsOf()).some((r) => /SECRET-CANARY|GIT-CANARY|OUTSIDE-CANARY/.test(r)))

  // ============ F. a new reply asks again ============
  await sleep(3300)
  await H.clickChat('New chat')
  await control({ calls: [{ name: 'list_files', input: { path: '.' } }] })
  await Q.reset()
  await Q.queue('no')
  await converse('[[mock:tool-use]] and again')
  const c3 = await noteCards()
  check('F: a new reply asks again (the yes was for one reply only), and a no to the reply means the call is declined', (await Q.count()) === 1 && /You said no\./.test(c3[0].outcome), show(c3))

  // ============ G. the audit view on the page ============
  await openTools()
  const auditText = await ev(`document.querySelector('dialog.tools').innerText`)
  check('G: the Tools page\'s audit log says "Allowed by your yes for this reply." for a covered call', /Allowed by your yes for this reply\./.test(auditText), auditText.slice(-400))
  await closeTools()

  // ============ H. off, and clear ============
  await openTools()
  await Q.reset()
  await clickToggle()
  await settle(700)
  w = await wsText()
  check('H: switching off asks nothing and both go off in the file', (await Q.count()) === 0 && w.toggle.on === false && show(json(TOOLS_FILE).enabled) === show({ list_files: false, read_file: false }), show(json(TOOLS_FILE)))
  await closeTools()
  await H.clickChat('New chat')
  await control({})
  await converse('hello with the tools off')
  check('H: with the tools off the request offers no tool at all', show(await lastRequestTools()) === '[]', show(await lastRequestTools()))
  await openTools()
  await sleep(3300)
  await Q.reset()
  await Q.queue('yes')
  await clickToggle()
  await settle(900)
  await click('Clear')
  await settle(700)
  w = await wsText()
  check('H: Clear asks nothing (the question count is the yes for switching on only), forgets the folder, and the switch is off to the touch (it stays as it was but cannot be turned on again)', (await Q.count()) === 1 && w.path === 'No folder is chosen.' && w.buttons.map((b) => b.text).join() === 'Choose a folder...', show(w))
  check('H: ...workspace.json is gone and tools.json still says both on (the file is only a setting)', !existsSync(WS_FILE) && json(TOOLS_FILE).enabled.read_file === true)
  await closeTools()
  await H.clickChat('New chat')
  await converse('hello with a switch on and no folder')
  check('H: with the tools on but no folder, the request offers no tool (a call could only be refused)', show(await lastRequestTools()) === '[]', show(await lastRequestTools()))

  // ============ I. the page fits ============
  await pick(WS)
  await openTools()
  await sleep(3300)
  await Q.reset()
  await Q.queue('yes')
  await click('Choose a folder...')
  await settle(900)
  for (const width of [420, 280]) {
    await page.send('Emulation.setDeviceMetricsOverride', { width, height: 800, deviceScaleFactor: 1, mobile: false })
    await sleep(300)
    const fit = await ev(`(() => { const d = document.querySelector('dialog.tools'); const body = d.querySelector('.tools-body') ?? d; const s = [...d.querySelectorAll('.tools-section')].find((x) => x.querySelector('#tools-workspace-title')); const r = s.getBoundingClientRect(); const dr = d.getBoundingClientRect(); return { overflow: d.scrollWidth - d.clientWidth, sectionRight: r.right, dialogRight: dr.right, buttons: [...s.querySelectorAll('button')].map((b) => b.getBoundingClientRect().right <= dr.right + 1) } })()`)
    check(`I: at ${width} px nothing of the workspace section sticks out sideways`, fit.overflow <= 1 && fit.sectionRight <= fit.dialogRight + 1 && fit.buttons.every(Boolean), show(fit))
  }
  await page.send('Emulation.clearDeviceMetricsOverride', {})
  await closeTools()

  check('I: the page logged no errors and no warnings in the whole run', page.problems.length === 0, show(page.problems))
} catch (error) {
  check(`the suite stopped before its end: ${String(error?.stack ?? error).slice(0, 400)}`, false)
} finally {
  try { rmSync(base, { recursive: true, force: true }) } catch { /* left for the system */ }
}
const ok = check.summary()
process.exit(ok ? 0 : 1)
