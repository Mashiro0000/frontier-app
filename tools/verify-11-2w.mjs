// Stage 11.2 (D-041), in the real window against the mock: the audit log. The Tools button under the message box and the page it opens (nothing recorded; a
// seeded log read as it stands: newest first, every outcome in words, the sources as plain text, hostile words shown as text and nothing run; lines that
// cannot be read counted); "Export..." (the system's save dialog, replaced from the main inspector: the file, the notice, never into the data folder, a
// closed dialog); "Delete all..." (asked in the system's own message box, replaced the same way: a no changes nothing, a yes deletes, the page cannot answer,
// three calls at once make one box); the bridge (read, exportAll, deleteAll: nothing that adds, changes or removes a line); encryption on and off converting
// the log (the real secure storage); the page at 420 and 280 px; no console errors.
// Needs: USER_DATA_DIR (scratch), FILES_DIR (outside it), INSPECT_PORT, MOCK_PORT, a saved key (setup-key.mjs).
import './ts-resolve.mjs'
import { connect, checker, sleep } from './cdp.mjs'
import { assertScratchProfile } from './profile-guard.mjs'
import { h4, mainInspector, readRetry } from './lib4.mjs'
import { installQuestions } from './lib10.mjs'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { REPO_URL } from './paths.mjs'

const port = Number(process.argv[3] ?? 9222)
const userData = process.env.USER_DATA_DIR
const FILES = process.env.FILES_DIR
const inspectPort = Number(process.env.INSPECT_PORT)
const mockUrl = `http://127.0.0.1:${process.env.MOCK_PORT}`
if (!userData || !FILES || !inspectPort || !process.env.MOCK_PORT) throw new Error('USER_DATA_DIR, FILES_DIR, INSPECT_PORT and MOCK_PORT must be set')
const check = checker()
const page = await connect(port)
await assertScratchProfile()
const H = h4(page, { userData, mockUrl })
const { ev } = H
const main = await mainInspector(inspectPort)
const Q = await installQuestions(main, { fallback: 'no' })
const logMod = await import(`${REPO_URL}/src/main/auditLog.ts`)
const sharedAudit = await import(`${REPO_URL}/src/shared/audit.ts`)
const show = (v) => JSON.stringify(v)?.slice(0, 500)
const AUDIT_DIR = join(userData, 'audit')
const LOG = join(AUDIT_DIR, 'log.jsonl')
const logText = () => (existsSync(LOG) ? readRetry(LOG, 'utf8') : null)
const lines = (text) => (text ?? '').split('\n').filter((l) => l !== '')

const T0 = new Date(2026, 9, 7, 9, 30, 0).getTime()
const SOURCES = [
  { title: 'Rust 1.90 released', url: 'https://blog.rust-lang.org/2026/09/10/Rust-1.90.html' },
  { title: 'Release notes', url: 'https://doc.rust-lang.org/stable/releases.html' }
]
const HOSTILE_QUERY = '<img src=x onerror="window.__pwned=1"> & <b>bold</b>'
const HOSTILE_WHY = '<script>window.__pwned=2</script> Refused: fake line'
const HOSTILE_TITLE = '<a href="https://evil.example/">click here</a>'
const CANARY = 'canary-4711-search-words'
const asked = (call, at, step, query, why) => ({ type: 'asked', at, call, tool: 'web_search', step, args: { query }, why })
const answered = (call, at, step, answer) => ({ type: 'answered', at, call, tool: 'web_search', step, answer })
const ran = (call, at, step) => ({ type: 'ran', at, call, tool: 'web_search', step })
const result = (call, at, step, ok, size, sources) => ({ type: 'result', at, call, tool: 'web_search', step, ok, size, sources, searched: ok ? 'rust 1.90 release' : null, searches: ok ? 1 : 0 })
const EVENTS = [
  asked('c1', T0, 1, CANARY, 'The person asked for the newest release.'),
  answered('c1', T0 + 1000, 1, 'yes'),
  ran('c1', T0 + 1001, 1),
  result('c1', T0 + 2500, 1, true, 5123, SOURCES),
  asked('c2', T0 + 60_000, 2, 'second question', 'A follow-up.'),
  answered('c2', T0 + 61_000, 2, 'no'),
  { type: 'refused', at: T0 + 120_000, call: 'c3', tool: 'web_search', step: 3, code: 'tool-off' },
  asked('c4', T0 + 180_000, 1, HOSTILE_QUERY, HOSTILE_WHY),
  answered('c4', T0 + 181_000, 1, 'yes'),
  ran('c4', T0 + 181_001, 1),
  result('c4', T0 + 182_000, 1, true, 12, [{ title: HOSTILE_TITLE, url: 'https://example.com/a?x=<b>' }]),
  asked('c5', T0 + 240_000, 2, 'stopped one', 'Another.'),
  answered('c5', T0 + 241_000, 2, 'yes'),
  ran('c5', T0 + 241_001, 2),
  result('c5', T0 + 242_000, 2, false, 0, []),
  asked('c6', T0 + 300_000, 3, 'left open', 'The app was closed.'),
  { type: 'refused', at: T0 + 360_000, call: 'c7', tool: 'web_search', step: 5, code: 'step-cap' }
]
const seed = (events = EVENTS, extra = '') => {
  mkdirSync(AUDIT_DIR, { recursive: true })
  writeFileSync(LOG, events.map((e) => logMod.auditLine(e)).join('\n') + '\n' + extra)
}

const toolsButton = () => ev(`(() => { const b = document.querySelector('.chat-bar .chat-tools'); if (!b) return null; const r = b.getBoundingClientRect(); return { text: b.textContent, title: b.title, disabled: b.disabled, w: r.width, h: r.height } })()`)
const dlg = () => ev(`(() => {
  const d = document.querySelector('dialog.tools')
  if (!d) return null
  const calls = [...d.querySelectorAll('.tools-call')].map((c) => ({
    title: c.querySelector('.tools-call-title')?.textContent ?? null,
    when: c.querySelector('.tools-call-when')?.textContent ?? null,
    args: [...c.querySelectorAll('.tools-args li')].map((li) => li.textContent),
    why: c.querySelector('.tools-why')?.textContent ?? null,
    outcome: c.querySelector('.tools-outcome')?.textContent ?? null,
    kind: [...(c.querySelector('.tools-outcome')?.classList ?? [])].find((n) => n.startsWith('tools-outcome-')) ?? null,
    sources: [...c.querySelectorAll('.tools-source')].map((s) => [s.querySelector('.tools-source-title')?.textContent ?? null, s.querySelector('.tools-source-url')?.textContent ?? null])
  }))
  const notice = d.querySelector('.tools-notice')
  return {
    open: d.open,
    heading: d.querySelector('h2')?.textContent ?? null,
    section: d.querySelector('#tools-audit-title')?.textContent ?? null,
    hint: d.querySelector('#tools-audit-title')?.parentElement.querySelector('.tools-hint')?.textContent ?? null,
    none: d.querySelector('.tools-none')?.textContent ?? null,
    problem: d.querySelector('.tools-problem')?.textContent ?? null,
    notice: notice ? { text: notice.textContent, error: notice.classList.contains('tools-notice-error'), role: notice.getAttribute('role') } : null,
    calls,
    footer: [...d.querySelectorAll('.tools-footer button')].map((b) => ({ text: b.textContent, disabled: b.disabled })),
    injected: d.querySelectorAll('a, img, script, iframe, style, svg, object, embed').length,
    pwned: window.__pwned ?? null
  }
})()`)
const clickMarked = async (selectorJs) => {
  await ev(`(() => { const b = ${selectorJs}; b.scrollIntoView({ block: 'center' }); b.setAttribute('data-click', '1') })()`)
  await sleep(80)
  await page.click('[data-click="1"]')
  await ev(`document.querySelector('[data-click="1"]')?.removeAttribute('data-click')`)
  await sleep(150)
}
const toolsFooter = (text) => `[...document.querySelectorAll('dialog.tools .tools-footer button')].find((b) => b.textContent === ${JSON.stringify(text)})`
const openTools = async () => {
  await ev(`document.querySelector('.chat-tools').scrollIntoView({ block: 'center' })`)
  await page.click('.chat-tools')
  await page.waitFor(`document.querySelector('dialog.tools')?.open === true`, { timeoutMs: 6000, label: 'the Tools page to open' })
  await page.waitFor(`!/^Reading/.test(document.querySelector('dialog.tools .tools-none')?.textContent ?? '')`, { timeoutMs: 6000, label: 'the audit log to be read' })
  await sleep(200)
}
const closed = () => page.waitFor(`!document.querySelector('dialog.tools')?.open`, { timeoutMs: 8000, label: 'the Tools page to close' })
const closeTools = async () => { await page.press('Escape'); await closed(); await sleep(150) }
const boxGone = () => page.waitFor(`!/Waiting for your answer/.test(document.querySelector('dialog.tools .tools-notice')?.textContent ?? '')`, { timeoutMs: 8000, label: 'the Windows message box to be answered' })

try {
  await page.waitFor(`document.readyState === 'complete' && !!document.querySelector('.header-select, .app-badge')`, { timeoutMs: 15000 })
  await sleep(300)
  rmSync(AUDIT_DIR, { recursive: true, force: true })

  // ============ A. the button, and nothing recorded ============
  const btn = await toolsButton()
  check('A: the chat bar has a "Tools" button, enabled, with a tooltip that says what it opens', btn?.text === 'Tools' && btn.disabled === false && /what the model has asked tools to do/.test(btn.title), show(btn))
  await openTools()
  let d = await dlg()
  check('A: it opens the Tools page, with the Audit log section and what it is', d?.open === true && d.heading === 'Tools' && d.section === 'Audit log' && /Every time the model asks for a tool, the app writes it here/.test(d.hint ?? '') && /holds no page text/.test(d.hint ?? '') && /until you delete it/.test(d.hint ?? ''), show(d))
  check('A: with no log yet it says nothing has been recorded, and there is nothing to export or delete', d.none === 'Nothing has been recorded yet: no tool has been asked for.' && d.calls.length === 0 && show(d.footer) === show([{ text: 'Export...', disabled: true }, { text: 'Delete all...', disabled: true }, { text: 'Close', disabled: false }]), show(d))
  check('A: reading it made no file (the folder is not created by looking)', !existsSync(AUDIT_DIR))
  await page.press('Escape')
  await closed()
  check('A: Escape closes the page', !(await dlg())?.open)

  // ============ B. a log with every kind of call ============
  seed()
  await openTools()
  d = await dlg()
  const when = (ms) => new Date(ms).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  check('B: seven calls, newest first', d.calls.length === 7 && show(d.calls.map((c) => c.when)) === show([6, 5, 4, 3, 2, 1, 0].map((i) => `${when([T0, T0 + 60_000, T0 + 120_000, T0 + 180_000, T0 + 240_000, T0 + 300_000, T0 + 360_000][i])}, step ${[1, 2, 3, 1, 2, 3, 5][i]}`)), show(d.calls.map((c) => c.when)))
  const byQuery = (q) => d.calls.find((c) => c.args.some((a) => a.includes(q)))
  const done = byQuery(CANARY)
  check('B: an allowed call that finished: the tool\'s name, what was asked, the reason, the outcome in words', done.title === 'Search the web' && show(done.args) === show([`query \u201c${CANARY}\u201d`]) && done.why === 'The model\'s reason: The person asked for the newest release.' && done.outcome === 'You said yes. It ran: 5,123 characters came back, from 2 sources.' && done.kind === 'tools-outcome-done', show(done))
  check('B: ...with its sources: titles and addresses as plain text', show(done.sources) === show(SOURCES.map((s) => [s.title, s.url])))
  check('B: a no is "You said no."', byQuery('second question').outcome === 'You said no.' && byQuery('second question').kind === 'tools-outcome-declined')
  const switchedOff = d.calls.find((c) => c.outcome === 'Refused: that tool was switched off.')
  check('B: a refusal is a refusal in words, with nothing asked and nothing shown', switchedOff?.args.length === 0 && switchedOff.why === null && switchedOff.kind === 'tools-outcome-refused' && d.calls[4] === switchedOff, show(switchedOff))
  check('B: a call that failed or was stopped, one asked and never answered, one past the step cap', byQuery('stopped one').outcome === 'You said yes. It started, but it failed or was stopped.' && byQuery('left open').outcome === 'You were asked. No answer was recorded (the app may have been closed).' && d.calls[0].outcome === 'Refused: the reply had used all its tool steps.')
  const hostile = byQuery('onerror')
  check('B: hostile words (markup in the search words, the reason and a title) are shown as text, exactly', hostile.args[0] === `query \u201c${HOSTILE_QUERY}\u201d` && hostile.why === `The model's reason: ${HOSTILE_WHY}` && hostile.sources[0][0] === HOSTILE_TITLE && hostile.sources[0][1] === 'https://example.com/a?x=<b>', show(hostile))
  check('B: ...nothing was made of them: no link, picture, script or frame in the page, and nothing ran', d.injected === 0 && d.pwned === null, show([d.injected, d.pwned]))
  check('B: a source is text, not a link: nothing here opens an address', (await ev(`document.querySelectorAll('dialog.tools a, dialog.tools [href], dialog.tools [onclick]').length`)) === 0)
  check('B: the buttons are on: Export..., Delete all..., Close', show(d.footer) === show([{ text: 'Export...', disabled: false }, { text: 'Delete all...', disabled: false }, { text: 'Close', disabled: false }]))
  check('B: no notice and no complaint about unreadable lines', d.notice === null && d.problem === null)
  check('B: the words of the page are the words of the shared sentences (one place for them)', d.calls.every((c) => typeof c.outcome === 'string' && c.outcome.length > 10) && sharedAudit.outcomeText({ kind: 'declined', answer: 'no' }) === 'You said no.')
  await closeTools()

  // ============ C. lines that cannot be read ============
  seed(EVENTS, 'this line is damaged {{\n' + logMod.auditLine(EVENTS[6]).slice(0, 30))
  await openTools()
  d = await dlg()
  check('C: two lines that cannot be read are counted, and left in the file', d.problem === '2 lines of the log could not be read. They are left in the file as they are.' && d.calls.length === 7, show(d.problem))
  check('C: ...reading did not change the file', logText().includes('this line is damaged {{'))
  await closeTools()

  // ============ D. Export... ============
  seed()
  const exportPath = join(FILES, 'audit.txt')
  rmSync(exportPath, { force: true })
  await main.inMain(`(() => { const { dialog } = process.mainModule.require('electron'); globalThis.__saveTo = ${JSON.stringify(exportPath)}; globalThis.__saves = []; dialog.showSaveDialog = async (...args) => { globalThis.__saves.push({ withWindow: args.length > 1, options: args[args.length - 1] }); return globalThis.__saveTo === null ? { canceled: true } : { canceled: false, filePath: globalThis.__saveTo } }; return true })()`)
  await openTools()
  await clickMarked(toolsFooter('Export...'))
  await page.waitFor(`/Exported/.test(document.querySelector('dialog.tools .tools-notice')?.textContent ?? '')`, { timeoutMs: 8000, label: 'the export notice' })
  d = await dlg()
  const saves = JSON.parse(await main.inMain('JSON.stringify(globalThis.__saves)'))
  check('D: "Export..." opens the system\'s save dialog for this window ("Export the audit log", a dated .txt name, text files) and says where it wrote', saves.length === 1 && saves[0].withWindow && saves[0].options.title === 'Export the audit log' && /frontier-audit-log-\d{4}-\d{2}-\d{2}\.txt$/.test(saves[0].options.defaultPath) && show(saves[0].options.filters) === show([{ name: 'Text file', extensions: ['txt'] }]) && d.notice?.text === `Exported 7 calls to ${exportPath}. It is a plain text file: keep it somewhere safe.` && d.notice.error === false, show([saves, d.notice]))
  const exported = existsSync(exportPath) ? readFileSync(exportPath, 'utf8') : ''
  check('D: the file starts with what it is, oldest call first, and holds each call in words', exported.startsWith('The audit log of Frontier App, exported on ') && exported.indexOf(`query = "${CANARY}"`) < exported.indexOf('query = "second question"') && exported.includes('  You said yes. It ran: 5,123 characters came back, from 2 sources.\n  Source: "Rust 1.90 released" https://blog.rust-lang.org/2026/09/10/Rust-1.90.html\n'), exported.slice(0, 400))
  check('D: ...hostile words are written quoted and escaped: they cannot start a line of the export', exported.includes('query = "<img src=x onerror=\\"window.__pwned=1\\"> & <b>bold</b>"') && exported.includes('Reason the model gave: "<script>window.__pwned=2</script> Refused: fake line"') && !/^Refused: fake line/m.test(exported))
  await main.inMain(`globalThis.__saveTo = ${JSON.stringify(join(userData, 'audit-copy.txt'))}; true`)
  await clickMarked(toolsFooter('Export...'))
  await page.waitFor(`/data folder/.test(document.querySelector('dialog.tools .tools-notice')?.textContent ?? '')`, { timeoutMs: 8000, label: 'the refusal' })
  d = await dlg()
  check('D: never into the app\'s own data folder: an error in words, nothing written', d.notice?.error === true && /data folder/.test(d.notice.text) && !existsSync(join(userData, 'audit-copy.txt')), show(d.notice))
  await main.inMain(`globalThis.__saveTo = null; true`)
  await clickMarked(toolsFooter('Export...'))
  await sleep(500)
  d = await dlg()
  check('D: closing the save dialog is not a failure: no notice at all', d.notice === null && d.footer.every((b) => !b.disabled || b.text === 'x'), show(d.notice))
  await closeTools()

  // ============ E. Delete all... ============
  seed()
  await Q.reset()
  await openTools()
  await Q.queue('no')
  await clickMarked(toolsFooter('Delete all...'))
  await boxGone()
  d = await dlg()
  let box = await Q.asked()
  check('E: a no in the system\'s box: nothing deleted, said in words, not shown as an error', box.length === 1 && d.notice?.text === 'Nothing was deleted.' && d.notice.error === false && lines(logText()).length === EVENTS.length && d.calls.length === 7, show([box.length, d.notice]))
  const o = box[0]?.options
  check('E: the box was for this window, and asked the right thing: "Delete the whole audit log?", the number of calls, "Keep it" the default and the way out', box[0]?.withWindow === true && o.title === 'Audit log' && o.message === 'Delete the whole audit log?' && /^7 calls will be deleted for good, the oldest from /.test(o.detail) && o.detail.includes("which the app's page cannot answer") && show(o.buttons) === show(['Delete the log', 'Keep it']) && o.defaultId === 1 && o.cancelId === 1, show(o))
  await sleep(3300)
  // while the box is open: the page can do nothing else, and Escape does not close it
  await Q.hold()
  await Q.queue('no')
  await clickMarked(toolsFooter('Delete all...'))
  await page.waitFor(`/Waiting for your answer/.test(document.querySelector('dialog.tools .tools-notice')?.textContent ?? '')`, { timeoutMs: 6000, label: 'the waiting notice' })
  d = await dlg()
  check('E: while the box is open the buttons are off (Export..., Delete all..., Close)', d.footer.every((b) => b.disabled), show(d.footer))
  await page.press('Escape')
  await sleep(300)
  check('E: ...and Escape does not close the page (the answer is still to come)', (await dlg())?.open === true)
  await Q.release()
  await boxGone()
  await sleep(3300)
  await Q.reset()
  await Q.queue('yes')
  await clickMarked(toolsFooter('Delete all...'))
  await page.waitFor(`/was deleted/.test(document.querySelector('dialog.tools .tools-notice')?.textContent ?? '') || document.querySelector('dialog.tools .tools-notice-error')`, { timeoutMs: 8000, label: 'the deletion' })
  await sleep(300)
  d = await dlg()
  check('E: a yes deletes the log: the file is gone, the page says so and shows nothing recorded', !existsSync(LOG) && d.notice?.text === 'The audit log was deleted.' && d.none === 'Nothing has been recorded yet: no tool has been asked for.' && d.calls.length === 0 && d.footer[0].disabled && d.footer[1].disabled, show([existsSync(LOG), d.notice, d.none]))
  await closeTools()

  // ============ F. the page can do no more than that ============
  const api = await ev(`({ top: Object.keys(window.api).sort(), audit: Object.keys(window.api.audit).sort(), ipc: typeof window.ipcRenderer, electron: typeof window.electron, require: typeof window.require })`)
  check('F: window.api.audit has exactly deleteAll, exportAll and read: no way to add, change or remove a line', show(api.audit) === show(['deleteAll', 'exportAll', 'read']) && api.top.includes('audit') && api.ipc === 'undefined' && api.electron === 'undefined' && api.require === 'undefined', show(api))
  const handlers = JSON.parse(await main.inMain(`JSON.stringify([...process.mainModule.require('electron').ipcMain._invokeHandlers.keys()].sort())`))
  check('F: main has exactly three message handlers about the audit log (read, export, delete all) and no other one that could write to it', show(handlers.filter((h) => /audit/i.test(h))) === show(['audit:delete-all', 'audit:export', 'audit:read']), show(handlers.filter((h) => /audit/i.test(h))))
  seed()
  await Q.reset()
  await sleep(3300)
  await Q.hold()
  await Q.queue('no')
  const burst = await ev(`(async () => {
    const calls = [window.api.audit.deleteAll(), window.api.audit.deleteAll(), window.api.audit.deleteAll()]
    await new Promise((r) => setTimeout(r, 400))
    return 'sent'
  })()`)
  const during = await Q.count()
  await Q.release()
  await sleep(600)
  check('F: three deletions asked for at once by the page make ONE box, and a no leaves the log as it was', burst === 'sent' && during === 1 && (await Q.count()) === 1 && lines(logText()).length === EVENTS.length, show([during, await Q.count()]))
  const readCalls = await ev(`window.api.audit.read().then((v) => ({ ok: v.ok, n: v.calls.length, keys: Object.keys(v).sort() }))`)
  check('F: reading from the page gives the view and nothing else (no path, no file text)', readCalls.ok === true && readCalls.n === 7 && show(readCalls.keys) === show(['calls', 'form', 'ok', 'older', 'sealedClosed', 'skipped', 'total']), show(readCalls))
  const withArgs = await ev(`window.api.audit.read({ path: 'C:/x', maxBytes: 1 }).then((v) => v.calls.length)`)
  check('F: ...and what the page passes is ignored (no path, no size)', withArgs === 7)

  // ============ G. the Tools button waits for a reply ============
  await H.send('[[mock:slow]] busy')
  await sleep(500)
  const busyBtn = await toolsButton()
  check('G: while a reply is arriving the Tools button is off, and says when it comes back', busyBtn.disabled === true && /when the reply has finished/.test(busyBtn.title), show(busyBtn))
  await page.click('.composer-button@Stop')
  await H.waitReady()
  await sleep(300)
  check('G: ...and it is back when the reply is over', (await toolsButton()).disabled === false)
  await H.clickChat('New chat')

  // ============ H. encryption on and off converts the log ============
  seed()
  const original = logText()
  // (a chat was saved in G, so turning encryption on first asks for a backup of the chats: the save dialog is answered with a place outside the data folder)
  await main.inMain(`globalThis.__saveTo = ${JSON.stringify(join(FILES, 'backup-11-2.jsonl'))}; true`)
  await page.click('.header-button@Settings')
  await page.waitFor(`!!document.querySelector('dialog.settings')?.open`)
  await page.waitFor(`(() => { const s = document.getElementById('settings-storage-heading')?.closest('section')?.querySelector('.settings-status'); return !!s && s.innerText !== 'Checking...' })()`, { timeoutMs: 15000, label: 'the Saved chats section' })
  await clickMarked(`[...document.getElementById('settings-storage-heading').closest('section').querySelectorAll('button')].find((x) => x.textContent.trim() === 'Encrypt my saved chats...')`)
  await page.waitFor(`/encrypted too/.test(document.getElementById('settings-storage-heading').closest('section').innerText)`, { timeoutMs: 30000, label: 'the encryption report' })
  const onText = await ev(`document.getElementById('settings-storage-heading').closest('section').innerText`)
  const sealed = logText() ?? ''
  check('H: turning encryption on seals the audit log: every line is the chats\' envelope, and nothing that was asked is readable in the file', lines(sealed).length === EVENTS.length && lines(sealed).every((l) => l.startsWith('{"format":"frontier-chat-encrypted"')) && !sealed.includes(CANARY) && !sealed.includes('blog.rust-lang.org'), sealed.slice(0, 200))
  check('H: ...and the report names it', onText.includes('Your instructions for every chat, your notes, your projects, your tool settings and the audit log of tool calls are encrypted too.'), onText.slice(0, 300))
  await page.press('Escape')
  await sleep(300)
  await openTools()
  d = await dlg()
  check('H: the Tools page still shows every call, opened by main with the key of this computer', d.calls.length === 7 && d.calls.find((c) => c.args.some((a) => a.includes(CANARY)))?.outcome.startsWith('You said yes. It ran:') && d.problem === null, show(d.calls.length))
  await closeTools()
  await page.click('.header-button@Settings')
  await page.waitFor(`!!document.querySelector('dialog.settings')?.open`)
  await page.waitFor(`(() => { const s = document.getElementById('settings-storage-heading')?.closest('section')?.querySelector('.settings-status'); return !!s && s.innerText !== 'Checking...' })()`, { timeoutMs: 15000, label: 'the Saved chats section' })
  await Q.reset()
  await Q.queue('yes')
  await clickMarked(`[...document.getElementById('settings-storage-heading').closest('section').querySelectorAll('button')].find((x) => /plain files/.test(x.textContent))`)
  await page.waitFor(`/plain files again too/.test(document.getElementById('settings-storage-heading').closest('section').innerText)`, { timeoutMs: 30000, label: 'the report of going back' })
  check('H: going back to plain files gives the very text the log had before (byte for byte)', logText() === original)
  await page.press('Escape')
  await sleep(300)

  // ============ I. narrow windows ============
  seed()
  await openTools()
  for (const width of [420, 280]) {
    await page.send('Emulation.setDeviceMetricsOverride', { width, height: 700, deviceScaleFactor: 1, mobile: false })
    await sleep(300)
    const fit = await ev(`(() => { const d = document.querySelector('dialog.tools'); const r = d.getBoundingClientRect(); const buttons = [...d.querySelectorAll('.tools-footer button')].map((b) => { const q = b.getBoundingClientRect(); return { text: b.textContent, left: q.left, right: q.right, h: q.height } }); return { overflowX: d.scrollWidth > d.clientWidth + 1, left: r.left, right: r.right, vw: innerWidth, buttons } })()`)
    check(`I: at ${width} px the page fits (nothing wider than the page, every button inside the window, labels on one line)`, !fit.overflowX && fit.left >= 0 && fit.right <= fit.vw + 1 && fit.buttons.every((b) => b.left >= 0 && b.right <= fit.vw + 1 && b.h <= 40), show(fit))
  }
  await page.send('Emulation.clearDeviceMetricsOverride', {})
  await sleep(300)
  await closeTools()
  rmSync(AUDIT_DIR, { recursive: true, force: true })
} catch (error) {
  check(`the suite stopped before its end: ${String(error?.stack ?? error).slice(0, 400)}`, false)
}

check('the page logged no errors and no warnings', page.problems.length === 0, show(page.problems))
main.close()
page.close()
process.exit(check.summary() ? 0 : 1)
