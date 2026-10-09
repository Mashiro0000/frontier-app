// Stage 12.6 (D-042), in the real window against the mock: APPLYING A CHANGE AND UNDOING IT. A reply proposes an edit and a new file. From the Review window the first is
// asked for (a no from the system's box writes nothing; a yes writes exactly the bytes shown and keeps the original); the Tools page lists what was applied and offers
// "Undo..." only while the file is still exactly what the change wrote; an undo asks in the box too and puts the original back; a file changed since is "changed" and
// has no Undo button; the new file is made and removed again; deleting the undo history asks and leaves the files alone; the audit log shows all of it in words; and the
// pages cannot do any of it themselves (the chat page has no apply, a page cannot answer the box, the model has no tool that applies).
// Needs: USER_DATA_DIR (scratch), INSPECT_PORT, MOCK_PORT, a saved key (setup-key.mjs).
import './temp-on-a.mjs'
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

const base = mkdtempSync(join(tmpdir(), 'frontier-126w-'))
const WS = join(realpathSync.native(base), 'project')
const MAIN_TS = 'export const x = 1\nexport const y = 2\n'
mkdirSync(join(WS, 'src'), { recursive: true })
writeFileSync(join(WS, 'src', 'main.ts'), MAIN_TS)
const NEW_MD = '# Notes\n\nwritten by a change\n'
const EDITED = 'export const x = 42\nexport const y = 2\n'
const fileOf = (...p) => join(WS, ...p)
const textOf = (...p) => readFileSync(fileOf(...p), 'utf8')
const dirBytesNow = () => { const out = []; const walk = (d) => { for (const e of readdirSync(d, { withFileTypes: true })) { const f = join(d, e.name); if (e.isDirectory()) walk(f); else out.push(`${f}:${readFileSync(f, 'utf8')}`) } }; walk(WS); return out.join('\n') }
const treeStart = dirBytesNow()
await main.inMain(`(() => { const { dialog } = process.mainModule.require('electron'); const p = globalThis.__pick = { next: null }; dialog.showOpenDialog = async () => (p.next === null ? { canceled: true, filePaths: [] } : { canceled: false, filePaths: [p.next] }); return true })()`)
const pick = (path) => main.inMain(`globalThis.__pick.next = ${JSON.stringify(path)}; true`)

const openTools = async () => { await H.clickChat('Tools'); await page.waitFor(`!!document.querySelector('dialog.tools')?.open`, { timeoutMs: 8000, label: 'Tools' }); await sleep(600) }
const closeTools = async () => { await page.press('Escape'); await sleep(300) }
const wsClick = (text) => ev(`(() => { const s = [...document.querySelectorAll('dialog.tools .tools-section')].find((x) => x.querySelector('#tools-workspace-title')); [...s.querySelectorAll('button')].find((x) => x.textContent === ${JSON.stringify(text)}).click(); return true })()`)
const wsToggle = () => ev(`(() => { const s = [...document.querySelectorAll('dialog.tools .tools-section')].find((x) => x.querySelector('#tools-workspace-title')); s.querySelector('.tools-toggle').click(); return true })()`)
const waiting = () => ev(`[...document.querySelectorAll('dialog.tools [aria-label="Changes waiting"] li')].map((li) => li.querySelector('.tools-switch-title')?.textContent)`)
const appliedRows = () => ev(`[...document.querySelectorAll('dialog.tools [aria-label="Changes applied"] li')].map((li) => ({ title: li.querySelector('.tools-switch-title')?.textContent, about: li.querySelector('.tools-hint')?.textContent, button: li.querySelector('button')?.textContent ?? null }))`)
const clickReview = (index) => ev(`(() => { document.querySelectorAll('dialog.tools [aria-label="Changes waiting"] li button')[${index}].click(); return true })()`)
const clickInApplied = (text) => ev(`(() => { const b = [...document.querySelectorAll('dialog.tools button')].find((x) => x.textContent === ${JSON.stringify(text)}); if (!b) return false; b.click(); return true })()`)
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
const status = (rv) => rv.evaluate(`document.getElementById('status').textContent`)
const quiet = () => sleep(3400) // after a "no" the next question waits a moment (systemQuestion.ts)
const lastBox = async () => (await Q.asked()).at(-1)

try {
  await page.waitFor(`document.readyState === 'complete' && !!document.querySelector('.header-select, .app-badge')`, { timeoutMs: 15000 })
  await sleep(300)
  await ev(`window.api.settings.setModel('claude-opus-5-5')`)

  // ============ A. set up ============
  await openTools()
  await pick(WS)
  await Q.reset(); await Q.queue('yes')
  await wsClick('Choose a folder...')
  await sleep(900)
  await sleep(3300)
  await Q.reset(); await Q.queue('yes')
  await wsToggle()
  await sleep(900)
  await closeTools()
  await H.clickChat('New chat')
  await control({ calls: [{ name: 'propose_edit', input: { path: 'src/main.ts', find: 'x = 1', replace: 'x = 42' } }, { name: 'propose_new_file', input: { path: 'docs/notes.md', content: NEW_MD } }] })
  await Q.reset(); await Q.queue('yes')
  await converse('[[mock:tool-use]] propose two things')
  check('A: two changes wait and nothing was written', dirBytesNow() === treeStart && !existsSync(fileOf('docs')))
  const fingerprintEdit = createHash('sha256').update(Buffer.from(EDITED)).digest('hex').slice(0, 12)

  // ============ B. a no from the box writes nothing ============
  await Q.reset()
  await openTools()
  check('B: the Tools page lists the two waiting changes and no applied one yet', (await waiting()).length === 2 && (await appliedRows()).length === 0)
  let rv = await openReview(1)
  check('B: the Review window shows the edit, and "Ask to apply..." is on (the short difference counts as read)', (await rv.evaluate(`document.getElementById('ask').disabled`)) === false)
  await Q.queue('no')
  await rv.click('#ask')
  await sleep(900)
  let box = await lastBox()
  check('B: a system box was asked: it names the file, the counts, the fingerprint of the exact bytes and the reason, says where the original is kept, has a "no" that is the default, and was shown for the Review window', (await Q.count()) === 1 && box.options.message === 'Write this change to your file?' && box.options.detail.includes('src') && box.options.detail.includes('main.ts') && box.options.detail.includes(fingerprintEdit) && /copy of the original in its own data folder/.test(box.options.detail) && box.options.buttons[0] === 'Write this change' && box.options.buttons[1] === "Don't write" && box.options.defaultId === 1 && box.withWindow === true, show(box))
  check('B: the window says that nothing was written, and the file is as it was', /Nothing was written/.test(await status(rv)) && textOf('src', 'main.ts') === MAIN_TS && dirBytesNow() === treeStart)
  check('B: the change still waits', (await waiting()).length === 2)
  const journalFile = join(userData, 'workspace', 'changes.jsonl')
  check('B: nothing was kept in the undo journal', !existsSync(journalFile))

  // ============ C. a yes writes it ============
  await quiet()
  await Q.queue('yes')
  await rv.click('#ask')
  await rv.waitFor(`/Done\\./.test(document.getElementById('status').textContent)`, { timeoutMs: 8000, label: 'Done' }).catch(() => undefined)
  const doneText = await status(rv)
  check('C: with a yes the file is written, byte for byte what the window showed (the fingerprint of the file on disk is the one in the box)', textOf('src', 'main.ts') === EDITED && createHash('sha256').update(readFileSync(fileOf('src', 'main.ts'))).digest('hex').slice(0, 12) === fingerprintEdit, show(textOf('src', 'main.ts')))
  check('C: the window says it was written and where the original is kept', /Done\. The change was written\./.test(doneText) && /undo/.test(doneText), doneText)
  check('C: the other file of the workspace was not touched, and no temporary file is left', !existsSync(fileOf('docs')) && readdirSync(fileOf('src')).join() === 'main.ts')
  check('C: the undo journal exists in the data folder (not in the workspace), and the workspace holds no copy of the original', existsSync(journalFile) && !readdirSync(WS, { recursive: true }).some((n) => /changes|undo|journal/i.test(String(n))))
  const journalPlain = readFileSync(journalFile, 'utf8')
  check('C: the journal is a plain file here (encryption is off in this profile) holding the original as base64 and the fingerprint', journalPlain.includes(fingerprintEdit) && journalPlain.includes(Buffer.from(MAIN_TS).toString('base64')))
  await rv.press('Escape').catch(() => undefined)
  await gone()
  rv.close()
  await closeTools()
  await openTools()
  check('C: the applied change left the waiting list; the new file still waits', (await waiting()).length === 1 && /docs\/notes\.md/.test((await waiting())[0]))
  let rows = await appliedRows()
  check('C: "Changes you applied" lists it: the path, the bytes, "still as the change wrote it", and an Undo button', rows.length === 1 && /^Change: src\/main\.ts$/.test(rows[0].title) && /\d+ bytes written\./.test(rows[0].about) && /still as the change wrote it/.test(rows[0].about) && rows[0].button === 'Undo...', show(rows))

  // ============ D. undo asks, and puts the original back ============
  await quiet()
  await Q.reset()
  await Q.queue('no')
  await clickInApplied('Undo...')
  await sleep(900)
  box = await lastBox()
  check('D: undo asks in the box too: "Put the original back?", the file and the fingerprint, and a no leaves the file as the change wrote it', box.withWindow === true && box.options.message === 'Put the original back?' && box.options.detail.includes(fingerprintEdit) && box.options.buttons[0] === 'Put the original back' && textOf('src', 'main.ts') === EDITED && (await appliedRows())[0].button === 'Undo...')
  await quiet()
  await Q.queue('yes')
  await clickInApplied('Undo...')
  await sleep(1200)
  check('D: with a yes the original is back, byte for byte', textOf('src', 'main.ts') === MAIN_TS)
  rows = await appliedRows()
  check('D: the list says "Undone." and has no Undo button for it', rows.length === 1 && /Undone\./.test(rows[0].about) && rows[0].button === null, show(rows))

  // ============ E. a file changed afterwards cannot be undone ============
  await rv?.close?.()
  await quiet()
  let rv2 = await openReview(0)
  // the new file: apply it (the only one left in the waiting list)
  await Q.reset(); await Q.queue('yes')
  await rv2.click('#ask')
  await rv2.waitFor(`/Done\\./.test(document.getElementById('status').textContent)`, { timeoutMs: 8000, label: 'Done' }).catch(() => undefined)
  check('E: a new file is made, in a folder that did not exist, with exactly the proposed bytes, and the window says so', textOf('docs', 'notes.md') === NEW_MD && /Done\. The new file was made\./.test(await status(rv2)))
  await rv2.press('Escape').catch(() => undefined)
  await gone()
  rv2.close()
  await closeTools()
  await openTools()
  rows = await appliedRows()
  check('E: it is listed as a new file, undoable (newest first)', rows.length === 2 && /^New file: docs\/notes\.md$/.test(rows[0].title) && rows[0].button === 'Undo...')
  writeFileSync(fileOf('docs', 'notes.md'), NEW_MD + 'and then I wrote more\n')
  await closeTools(); await openTools()
  rows = await appliedRows()
  check('E: after the person edits it, the list says it cannot be undone (changed since), and there is no Undo button', /was changed after this/.test(rows[0].about) && rows[0].button === null, show(rows[0]))
  const refusal = await ev(`window.api.changes.undo(${JSON.stringify(await ev(`window.api.changes.applied().then((a) => a[0].id)`))})`)
  check('E: asking for the undo anyway is refused in words, before any question, and the person\'s text is still there', refusal.ok === false && /lose what was written since/.test(refusal.error) && (await Q.count()) === 1 && textOf('docs', 'notes.md').endsWith('and then I wrote more\n'), show(refusal))
  writeFileSync(fileOf('docs', 'notes.md'), NEW_MD)
  await closeTools(); await openTools()
  rows = await appliedRows()
  check('E: when the file is exactly as written again it is undoable again (the check is of the bytes)', rows[0].button === 'Undo...')
  await Q.reset(); await Q.queue('yes')
  await clickInApplied('Undo...')
  await sleep(1200)
  box = await lastBox()
  check('E: undoing a new file deletes it (the box says so, and that the folders stay), the folder stays', !existsSync(fileOf('docs', 'notes.md')) && existsSync(fileOf('docs')) && box.options.message === 'Delete the file this change made?' && /Folders that were made for it stay/.test(box.options.detail))

  // ============ F. the audit log tells it in words ============
  const auditText = await ev(`document.querySelector('dialog.tools').innerText`)
  check('F: the log on the Tools page shows the writes and undos in words (written N bytes; undone)', /Write a change to the workspace/.test(auditText) && /You said yes\. It was written: \d+ bytes\./.test(auditText) && /Undo a change in the workspace/.test(auditText) && /You said yes\. It was undone\./.test(auditText), auditText.slice(-1200))
  check('F: the log shows the answers "no" as well, and none of the file text', /You said no|said no|Nothing was done/.test(auditText) && !auditText.includes('written by a change'))

  // ============ G. deleting the history ============
  await quiet()
  await Q.reset(); await Q.queue('no')
  await clickInApplied('Delete the undo history...')
  await sleep(900)
  box = await lastBox()
  check('G: it asks: how many changes, that files are not touched and that nothing can be undone afterwards; a no keeps the history', box.options.message === 'Delete the undo history?' && /originals of 2 applied changes/.test(box.options.detail) && /Your files are not touched/.test(box.options.detail) && existsSync(journalFile) && (await appliedRows()).length === 2)
  await quiet()
  await Q.queue('yes')
  const before = dirBytesNow()
  await clickInApplied('Delete the undo history...')
  await sleep(1200)
  check('G: with a yes the journal is deleted, the files are untouched and the list is empty', !existsSync(journalFile) && dirBytesNow() === before && (await appliedRows()).length === 0)

  // ============ H. what the pages cannot do ============
  const keys = await ev(`Object.keys(window.api.changes).sort()`)
  check('H: the chat page has no function that applies (list, review, applied, undo, clearHistory only)', show(keys) === show(['applied', 'clearHistory', 'list', 'review', 'undo']) && (await ev(`typeof window.api.changes.apply`)) === 'undefined')
  await quiet()
  await Q.reset(); await Q.queue('no')
  const spoof = await ev(`window.api.changes.undo('u1-1')`)
  check('H: an undo for an id that does not exist is answered in words and asks nothing', spoof.ok === false && /not in the undo history/.test(spoof.error) && (await Q.count()) === 0)
  const nothing = await ev(`window.api.changes.clearHistory()`)
  check('H: deleting a history that is already gone asks nothing', nothing.ok === true && /nothing to delete/i.test(nothing.message ?? '') && (await Q.count()) === 0)
  // a hostile reply: the model asks for tools that apply or undo
  await closeTools()
  await H.clickChat('New chat')
  await control({ calls: [{ name: 'apply_change', input: { id: 'p1' } }, { name: 'undo_change', input: { id: 'u1-1' } }] })
  await Q.reset()
  await converse('[[mock:tool-use]] try to apply by yourself')
  const notes = await ev(`[...document.querySelectorAll('.message-assistant .tool-note')].map((n) => n.innerText)`)
  check('H: a model that asks for "apply_change" or "undo_change" gets no such tool: no box is shown and nothing is written', (await Q.count()) === 0 && dirBytesNow() === before && notes.length === 2 && notes.every((t) => !/written|undone|You allowed it/i.test(t)), show(notes))
  // the Review window: before the end of a long difference is scrolled, apply is refused
  await closeTools().catch(() => undefined)
  await control({ calls: [{ name: 'propose_new_file', input: { path: 'big/long.md', content: Array.from({ length: 300 }, (_, i) => `row ${i}`).join('\n') + '\n' } }] })
  await H.clickChat('New chat')
  await quiet()
  await Q.reset(); await Q.queue('yes')
  await converse('[[mock:tool-use]] one long file')
  await Q.reset()
  await openTools()
  let rv3 = await openReview(0)
  const direct = await rv3.evaluate(`window.review.apply()`)
  check('H: the Review window itself cannot apply a long difference it has not scrolled to its end: refused in words, no box, nothing written', direct.ok === false && /Scroll the whole difference/.test(direct.error) && (await Q.count()) === 0 && !existsSync(fileOf('big')), show(direct))
  await rv3.press('Escape').catch(() => undefined)
  await gone()
  rv3.close()
  check('H: the page logged no errors and no warnings in the whole run', page.problems.length === 0, show(page.problems))
} catch (error) {
  check(`the suite stopped before its end: ${String(error?.stack ?? error).slice(0, 400)}`, false)
} finally {
  try { rmSync(base, { recursive: true, force: true }) } catch { /* left for the system */ }
}
const ok = check.summary()
process.exit(ok ? 0 : 1)
