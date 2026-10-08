// Stage 12.5 (D-042), in the real window against the mock: the Review window and the list of changes. A reply proposes two changes (one of them full of markup and next
// to a no-break space, the other a long new file); the Tools page lists them as summaries (no line of either); "Review..." opens ONE window of main's own, sandboxed,
// with its own preload, which draws the change as text (the markup is only text, the no-break space is written out), turns on "Ask to apply..." only when the whole
// difference was scrolled to its end, cannot load or run anything that is not its own, and closes on Escape; dropping a change takes it from the list; the chat page
// has no way to reach the window and the window has no way to reach the chat page's functions. Nothing is written to the workspace.
// Needs: USER_DATA_DIR (scratch), INSPECT_PORT, MOCK_PORT, a saved key (setup-key.mjs).
import './ts-resolve.mjs'
import { connect, checker, sleep } from './cdp.mjs'
import { assertScratchProfile } from './profile-guard.mjs'
import { h4, mainInspector } from './lib4.mjs'
import { installQuestions } from './lib10.mjs'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
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
const control = (body) => fetch(`${mockUrl}/__tools`, { method: 'POST', body: JSON.stringify(body) })
const NBSP = String.fromCharCode(0xa0)
const OPEN = String.fromCharCode(0x27e6)
const CLOSE = String.fromCharCode(0x27e7)

const base = mkdtempSync(join(tmpdir(), 'frontier-125w-'))
const WS = join(realpathSync.native(base), 'project')
const MAIN_TS = `export const x = 1\n// a${NBSP}b\n// third\n`
mkdirSync(join(WS, 'src'), { recursive: true })
writeFileSync(join(WS, 'src', 'main.ts'), MAIN_TS)
const treeNow = () => { const out = []; const walk = (d) => { for (const e of readdirSync(d, { withFileTypes: true })) { const f = join(d, e.name); if (e.isDirectory()) walk(f); else out.push(`${f}:${readFileSync(f, 'utf8')}`) } }; walk(WS); return out.join('\n') }
const treeStart = treeNow()
await main.inMain(`(() => { const { dialog } = process.mainModule.require('electron'); const p = globalThis.__pick = { next: null }; dialog.showOpenDialog = async () => (p.next === null ? { canceled: true, filePaths: [] } : { canceled: false, filePaths: [p.next] }); return true })()`)
const pick = (path) => main.inMain(`globalThis.__pick.next = ${JSON.stringify(path)}; true`)

const openTools = async () => { await H.clickChat('Tools'); await page.waitFor(`!!document.querySelector('dialog.tools')?.open`, { timeoutMs: 8000, label: 'Tools' }); await sleep(600) }
const closeTools = async () => { await page.press('Escape'); await sleep(300) }
const wsClick = (text) => ev(`(() => { const s = [...document.querySelectorAll('dialog.tools .tools-section')].find((x) => x.querySelector('#tools-workspace-title')); [...s.querySelectorAll('button')].find((x) => x.textContent === ${JSON.stringify(text)}).click(); return true })()`)
const wsToggle = () => ev(`(() => { const s = [...document.querySelectorAll('dialog.tools .tools-section')].find((x) => x.querySelector('#tools-workspace-title')); s.querySelector('.tools-toggle').click(); return true })()`)
const rows = () => ev(`[...document.querySelectorAll('dialog.tools [aria-label="Changes waiting"] li')].map((li) => ({ title: li.querySelector('.tools-switch-title')?.textContent, about: li.querySelector('.tools-hint')?.textContent, warnings: [...li.querySelectorAll('.tools-hint')].slice(1).map((x) => x.textContent), button: li.querySelector('button')?.textContent }))`)
const clickReview = (index) => ev(`(() => { document.querySelectorAll('dialog.tools [aria-label="Changes waiting"] li button')[${index}].click(); return true })()`)
async function converse(text, { timeoutMs = 40000 } = {}) {
  await H.send(text)
  await page.waitFor(`!!document.querySelector('.composer-button[type=submit]')`, { timeoutMs })
  await sleep(300)
}
const reviewTargets = async () => (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).filter((t) => t.type === 'page' && t.url.startsWith('data:text/html') && t.title === 'Review a change')
async function openReview(index) {
  await clickReview(index)
  for (let i = 0; i < 80; i++) { if ((await reviewTargets()).length > 0) break; await sleep(100) }
  const rv = await connect(port, { urlPattern: /^data:text\/html/, title: 'Review a change', timeoutMs: 8000 })
  await rv.waitFor(`document.querySelectorAll('#view .line').length > 0`, { timeoutMs: 8000, label: 'the change in the Review window' })
  await sleep(300)
  return rv
}
const gone = async () => { for (let i = 0; i < 40; i++) { if ((await reviewTargets()).length === 0) return true; await sleep(150) } return false }
const rvState = (rv) => rv.evaluate(`(() => ({ title: document.title, head: document.getElementById('head').innerText, askDisabled: document.getElementById('ask').disabled, hint: document.getElementById('hint').textContent, status: document.getElementById('status').textContent, lines: [...document.querySelectorAll('#view .line')].map((l) => ({ cls: l.className.replace('line ', ''), text: l.querySelector('.text')?.textContent ?? '', no: l.querySelector('.no')?.textContent ?? null })), marks: [...document.querySelectorAll('#view .mark')].map((m) => m.textContent), scrolls: document.getElementById('view').scrollHeight > document.getElementById('view').clientHeight, scripts: document.querySelectorAll('script').length, imgs: document.querySelectorAll('img, iframe, a, form, link').length, handlers: document.querySelectorAll('[onerror], [onclick], [onload]').length }))()`)

try {
  await page.waitFor(`document.readyState === 'complete' && !!document.querySelector('.header-select, .app-badge')`, { timeoutMs: 15000 })
  await sleep(300)
  await ev(`window.api.settings.setModel('claude-opus-5-5')`)

  // ============ A. set up: a folder, the switch, a reply that proposes ============
  await openTools()
  await pick(WS)
  await Q.reset(); await Q.queue('yes')
  await wsClick('Choose a folder...')
  await sleep(900)
  await sleep(3300)
  await Q.reset(); await Q.queue('yes')
  await wsToggle()
  await sleep(900)
  const empty = await rows()
  check('A: with nothing proposed the Changes section says so', empty.length === 0 && /No changes are waiting\./.test(await ev(`document.querySelector('dialog.tools').innerText`)))
  await closeTools()
  await H.clickChat('New chat')
  const longContent = Array.from({ length: 300 }, (_, i) => `row ${i + 1}`).join('\n') + '\n'
  await control({ calls: [{ name: 'propose_edit', input: { path: 'src/main.ts', find: 'export const x = 1', replace: 'export const x = 2 // <script>alert(1)</script> <img src=x onerror=alert(1)>' } }, { name: 'propose_new_file', input: { path: 'docs/long.md', content: longContent } }] })
  await Q.reset(); await Q.queue('yes')
  await converse('[[mock:tool-use]] propose two things')
  const cards = await ev(`[...document.querySelectorAll('.message-assistant .tool-note')].map((n) => ({ title: n.querySelector('.tool-note-title')?.textContent, outcome: n.querySelector('.tool-note-outcome')?.textContent ?? null }))`)
  check('A: both proposals stand in the reply, each saying that the change waits for the person and that nothing is changed until they apply it', cards.length === 2 && /^You allowed it\. The change waits for you: open Tools to review it\. Nothing is changed until you apply it\.$/.test(cards[0].outcome) && /^Allowed for this reply\. The change waits for you/.test(cards[1].outcome), show(cards))
  check('A: nothing was written to the workspace', treeNow() === treeStart && !existsSync(join(WS, 'docs')))

  // ============ B. the list on the Tools page ============
  await openTools()
  const list = await rows()
  const dialogText = await ev(`document.querySelector('dialog.tools').innerText`)
  check('B: the page lists the two waiting changes, newest first, with the kind, the path, the counts and the size, and a Review button each', list.length === 2 && /^New file: docs\/long\.md$/.test(list[0].title) && /^Change: src\/main\.ts$/.test(list[1].title) && /300 lines added, 0 removed; the file would be 2,\d{3} bytes\./.test(list[0].about) && /1 line added, 1 removed/.test(list[1].about) && list.every((r) => r.button === 'Review...'), show(list))
  check('B: not a line of either change is anywhere on the page (no markup, no text of the new file)', !/alert\(1\)|onerror|row 17|<script>/.test(dialogText))
  const keys = await ev(`Object.keys(window.api.changes).sort()`)
  check('B: the chat page\'s bridge for changes is list, review and (12.6) applied, undo and clearHistory: nothing that applies', show(keys) === show(['applied', 'clearHistory', 'list', 'review', 'undo']))
  const summaries = await ev(`window.api.changes.list()`)
  check('B: what the page is given for each change holds no text of it (eight fields)', summaries.length === 2 && summaries.every((s) => Object.keys(s).length === 8) && !JSON.stringify(summaries).includes('alert') && !JSON.stringify(summaries).includes('because'))
  check('B: the chat page has no `review` object (the Review window\'s bridge is not loaded here)', (await ev(`typeof window.review`)) === 'undefined')
  const refused = await ev(`window.api.changes.review('p99')`)
  check('B: asking for a change that is not there is answered in words', refused.ok === false && /not there any more/.test(refused.error), show(refused))
  const refused2 = await ev(`window.api.changes.review({ id: 'p1' })`)
  check('B: an id that is not text is refused too', refused2.ok === false && (await reviewTargets()).length === 0)

  // ============ C. the Review window: the short change with markup and a no-break space ============
  let rv = await openReview(1)
  let st = await rvState(rv)
  check('C: ONE new window, titled "Review a change", showing the change: what it is, the path, the counts, the size, and the fingerprint of the exact bytes', (await reviewTargets()).length === 1 && st.title === 'Review a change' && /^A change to src\/main\.ts/.test(st.head) && /\+1 lines, -1 lines; the file would be \d+ bytes \(Unix line endings\)/.test(st.head) && /The model's reason: To answer the question\./.test(st.head), st.head)
  const expectedAfter = MAIN_TS.replace('export const x = 1', 'export const x = 2 // <script>alert(1)</script> <img src=x onerror=alert(1)>')
  const fingerprint = createHash('sha256').update(Buffer.from(expectedAfter)).digest('hex').slice(0, 12)
  check('C: the fingerprint shown is the first 12 characters of the SHA-256 of the exact file that would be written (computed here from what was proposed)', st.head.includes(`Fingerprint of the exact bytes that would be written: ${fingerprint}`), st.head)
  check('C: the markup is only TEXT: the line shows `<script>alert(1)</script> <img src=x onerror=alert(1)>` as typed, and the page has one script (its own), no image, frame, link or form, and no handler attribute', st.lines.some((l) => l.cls === 'add' && l.text.includes('<script>alert(1)</script> <img src=x onerror=alert(1)>')) && st.scripts === 1 && st.imgs === 0 && st.handlers === 0, show([st.scripts, st.imgs, st.handlers]))
  check('C: the lines are in the unified form: two headers, the heading of the place, the removed line, the added line, and the lines around them', show(st.lines.map((l) => l.cls)) === show(['header', 'header', 'hunk', 'del', 'add', 'same', 'same']) && st.lines[0].text === '--- a/src/main.ts' && st.lines[2].text === '@@ -1,3 +1,3 @@', show(st.lines.map((l) => l.cls)))
  check('C: the no-break space on the line of context is written out as a mark, not left to look like a space', st.marks.includes(`${OPEN}U+00A0${CLOSE}`) && st.lines.some((l) => l.cls === 'same' && l.text === `// a${OPEN}U+00A0${CLOSE}b`), show(st.marks))
  check('C: the difference fits the window, so it counts as read at once and "Ask to apply..." is on', st.scrolls === false && st.askDisabled === false, show([st.scrolls, st.askDisabled]))
  const bridge = await rv.evaluate(`({ api: typeof window.api, keys: Object.keys(window.review).sort(), ipc: typeof require, process: typeof process })`)
  check('C: the window has its own bridge with six things, and the chat page\'s `window.api`, `require` and `process` do not exist in it', show(bridge) === show({ api: 'undefined', keys: ['apply', 'close', 'drop', 'get', 'onChanged', 'reachedEnd'], ipc: 'undefined', process: 'undefined' }), show(bridge))
  const net = await rv.evaluate(`fetch('https://example.com/').then(() => 'loaded', () => 'blocked')`)
  check('C: it cannot load anything from the web (the policy and the session both stop it)', net === 'blocked', net)
  const inline = await rv.evaluate(`(() => { const s = document.createElement('script'); s.textContent = 'window.__ran = 1'; document.body.appendChild(s); return new Promise((r) => setTimeout(() => r(typeof window.__ran), 200)) })()`)
  check('C: a script that is added to it, without its nonce, does not run', inline === 'undefined', inline)
  await rv.evaluate(`(() => { location.href = 'https://example.com/'; return true })()`).catch(() => undefined)
  await sleep(500)
  check('C: it cannot be sent to another page: it is still the data page', (await reviewTargets()).length === 1 && (await rvState(rv)).title === 'Review a change')
  const prefs = JSON.parse(await main.inMain(`(() => { const { BrowserWindow } = process.mainModule.require('electron'); const w = BrowserWindow.getAllWindows().find((x) => x.getTitle() === 'Review a change'); const p = w.webContents.getLastWebPreferences(); return JSON.stringify({ n: BrowserWindow.getAllWindows().length, sandbox: p.sandbox, ci: p.contextIsolation, ni: p.nodeIntegration, ws: p.webSecurity, ownSession: w.webContents.session !== process.mainModule.require('electron').session.defaultSession && w.webContents.session !== BrowserWindow.getAllWindows().find((x) => x !== w).webContents.session, parent: !!w.getParentWindow() }) })()`))
  check('C: main\'s own view of it: two windows in all, sandbox, context isolation, no Node, web security, a session of its own, and the chat window as its parent', prefs.n === 2 && prefs.sandbox === true && prefs.ci === true && prefs.ni === false && prefs.ws === true && prefs.ownSession === true && prefs.parent === true, show(prefs))
  // the dry-run view
  await rv.click('#tab-file')
  await sleep(300)
  st = await rvState(rv)
  check('C: "The file as it would be" shows the whole file with line numbers, the markup still only text', st.lines.length === 3 && st.lines[0].no === '1' && st.lines[0].text === 'export const x = 2 // <script>alert(1)</script> <img src=x onerror=alert(1)>' && st.lines[1].text === `// a${OPEN}U+00A0${CLOSE}b`, show(st.lines))
  await rv.click('#tab-diff')
  await sleep(300)
  // apply: not available yet in this slice
  await rv.click('#ask')
  await sleep(700)
  st = await rvState(rv)
  check('C: "Ask to apply..." (12.6) asks the box, and with a no (the stand-in answers no) nothing is written and the window says so', /Nothing was written/.test(st.status) && (await Q.count()) === 2 && treeNow() === treeStart, show([st.status, await Q.count()]))

  // ============ D. the same window shows the long change; the end of the difference turns the button on ============
  await closeTools().catch(() => undefined)
  const toolsOpen = await ev(`!!document.querySelector('dialog.tools')?.open`)
  if (!toolsOpen) await openTools()
  rv.close()
  await ev(`(() => { document.querySelectorAll('dialog.tools [aria-label="Changes waiting"] li button')[0].click(); return true })()`)
  await sleep(1200)
  check('D: asking for the other change reuses the same window (one in all)', (await reviewTargets()).length === 1)
  rv = await connect(port, { urlPattern: /^data:text\/html/, title: 'Review a change', timeoutMs: 8000 })
  await rv.waitFor(`document.querySelector('#head h1')?.textContent.startsWith('A new file: docs/long.md')`, { timeoutMs: 8000, label: 'the long change' })
  await sleep(400)
  st = await rvState(rv)
  check('D: a new file: from /dev/null, 300 lines added, and the box scrolls', /^A new file: docs\/long\.md/.test(st.head) && st.lines[0].text === '--- /dev/null' && st.lines.filter((l) => l.cls === 'add').length === 300 && st.scrolls === true)
  check('D: "Ask to apply..." is OFF, and the page says why', st.askDisabled === true && /Scroll the whole difference to its end/.test(st.hint), show([st.askDisabled, st.hint]))
  await rv.click('#ask').catch(() => undefined)
  await sleep(300)
  check('D: a click on it does nothing while it is off', (await Q.count()) === 2 && /Waiting for your answer/.test((await rvState(rv)).status) === false)
  await rv.evaluate(`(() => { const v = document.getElementById('view'); v.scrollTop = Math.floor(v.scrollHeight / 2); return true })()`)
  await sleep(500)
  check('D: half way down it is still off', (await rvState(rv)).askDisabled === true)
  await rv.evaluate(`(() => { const v = document.getElementById('view'); v.scrollTop = v.scrollHeight; return true })()`)
  await rv.waitFor(`document.getElementById('ask').disabled === false`, { timeoutMs: 5000, label: 'Ask to apply on' }).catch(() => undefined)
  st = await rvState(rv)
  check('D: at the end of the difference main is told, and "Ask to apply..." comes on', st.askDisabled === false, show(st))
  check('D: main knows it too (the model of the change says the end was reached)', (await rv.evaluate(`window.review.get().then((m) => m.reachedEnd)`)) === true)

  // ============ E. Escape closes it; dropping a change takes it from the list ============
  await rv.press('Escape').catch(() => undefined)
  check('E: Escape closes the Review window', await gone())
  rv.close()
  rv = await openReview(0)
  await rv.click('#drop')
  await sleep(300)
  st = await rvState(rv)
  const dropText = await rv.evaluate(`document.getElementById('drop').textContent`)
  check('E: "Drop this change" asks for a second click (one click is not enough)', dropText === 'Click again to drop it' && (await reviewTargets()).length === 1, dropText)
  await rv.click('#drop')
  check('E: the second click drops it and closes the window', await gone())
  rv.close()
  await sleep(300)
  await ev(`(() => { return true })()`)
  await closeTools()
  await openTools()
  const after = await rows()
  check('E: the list now holds only the other change; nothing was written to the workspace', after.length === 1 && /^Change: src\/main\.ts$/.test(after[0].title) && treeNow() === treeStart, show(after))
  rv = await openReview(0)
  await rv.press('Escape').catch(() => undefined)
  check('E: Escape closes it again', await gone())
  rv.close()
  const none = await ev(`window.api.changes.review('p2')`)
  check('E: a dropped change cannot be opened any more', none.ok === false)

  // ============ F. the chat page and the Review window cannot reach each other ============
  const mainKeys = await ev(`Object.keys(window.api).sort()`)
  check('F: the chat page\'s bridge has no group or function for applying, dropping or reading a change', !mainKeys.some((k) => /review|apply|proposal/i.test(k)) && show(await ev(`Object.keys(window.api.changes).sort()`)) === show(['applied', 'clearHistory', 'list', 'review', 'undo']))
  check('F: the page logged no errors and no warnings in the whole run', page.problems.length === 0, show(page.problems))
} catch (error) {
  check(`the suite stopped before its end: ${String(error?.stack ?? error).slice(0, 400)}`, false)
} finally {
  try { rmSync(base, { recursive: true, force: true }) } catch { /* left for the system */ }
}
const ok = check.summary()
process.exit(ok ? 0 : 1)
