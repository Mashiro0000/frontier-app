// Stage 10.7 (D-039), in the real window against the mock: a backup holds the projects and the notes, and a restore adds them only after the person's
// yes in the system's own message box (replaced from the main inspector, lib10.mjs). A project and two notes are put in the data folder, a chat is moved
// into the project and sent; "Back up all chats..." (the save dialog replaced from main) writes a version 3 file and says it holds them; the chat, the
// project and the notes are taken away; "Restore from a backup..." (the open dialog replaced) shows what would be added and asks nothing; "Add" asks once,
// for the window: a no adds the chat alone, in no project; a yes adds the project and the notes as they were and the chat in its project; again, all is
// already here and nothing is asked; a damaged projects.json is said and nothing of it is added; 280 px; no console errors.
// Needs: USER_DATA_DIR (scratch), FILES_DIR (outside it), INSPECT_PORT, MOCK_PORT, a saved key (setup-key.mjs).
import './ts-resolve.mjs'
import { connect, checker, sleep } from './cdp.mjs'
import { assertScratchProfile } from './profile-guard.mjs'
import { h4, mainInspector, readRetry } from './lib4.mjs'
import { installQuestions } from './lib10.mjs'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const shots = process.argv[2]
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
const show = (v) => JSON.stringify(v)?.slice(0, 400)
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const projFile = join(userData, 'projects.json')
const memFile = join(userData, 'memory.json')
const convDir = join(userData, 'conversations')
const jsonOf = (path) => { if (!existsSync(path)) return null; try { return JSON.parse(readRetry(path, 'utf8')) } catch { return 'unreadable' } }
const chatFiles = () => (existsSync(convDir) ? readdirSync(convDir).filter((n) => n.endsWith('.json')).map((n) => jsonOf(join(convDir, n))) : [])
const lines = (path) => readFileSync(path, 'utf8').split('\n').filter((l) => l !== '').map((l) => JSON.parse(l))

const T = 1_780_000_000_000
const thesis = { id: '11111111-2222-4333-8444-000000000107', name: 'Thesis', instructions: 'Cite your sources.', files: [], createdAt: T, updatedAt: T }
const notes = [
  { id: '11111111-2222-4333-8444-0000000c0001', text: 'I write in British English.', scope: 'all', createdAt: T, updatedAt: T },
  { id: '11111111-2222-4333-8444-0000000c0002', text: 'My supervisor is Dr Rao.', scope: thesis.id, createdAt: T, updatedAt: T }
]
const seed = () => {
  writeFileSync(projFile, JSON.stringify({ version: 1, projects: [thesis] }))
  writeFileSync(memFile, JSON.stringify({ version: 1, on: true, notes }))
}

await main.inMain(`(() => {
  const { dialog } = process.mainModule.require('electron')
  globalThis.__d = { open: [], save: [] }
  dialog.showOpenDialog = async () => { const next = globalThis.__d.open.shift(); return next ? { canceled: false, filePaths: next } : { canceled: true, filePaths: [] } }
  dialog.showSaveDialog = async () => { const next = globalThis.__d.save.shift(); return next ? { canceled: false, filePath: next } : { canceled: true } }
  return true
})()`)
const queue = (kind, value) => main.inMain(`globalThis.__d.${kind}.push(${JSON.stringify(value)}); true`)
const notice = () => ev(`document.querySelector('dialog.history .backup-notice')?.textContent ?? null`)
const waitNotice = (re) => page.waitFor(`${re}.test(document.querySelector('dialog.history .backup-notice')?.textContent ?? '')`, { timeoutMs: 30000, label: `a notice like ${re}` })
const reveal = async (css, text) => { await ev(`(() => { const el = [...document.querySelectorAll(${JSON.stringify(css)})].find((e) => e.textContent.trim() === ${JSON.stringify(text)}); el?.scrollIntoView({ block: 'center' }) })()`); await sleep(80) }
const clickFooter = async (text) => { await reveal('dialog.history .history-footer .history-button', text); await page.click(`dialog.history .history-footer .history-button@${text}`) }
const clickPanel = async (text) => { await reveal('dialog.history .backup-preview button', text); await page.click(`dialog.history .backup-preview button@${text}`) }
const preview = () => ev(`(() => {
  const p = document.querySelector('dialog.history .backup-preview')
  if (!p) return null
  return {
    facts: [...p.querySelectorAll('.backup-preview-facts li')].map((li) => li.innerText),
    notices: [...p.querySelectorAll('.history-notice')].map((n) => n.innerText),
    buttons: [...p.querySelectorAll('.history-actions button')].map((b) => ({ text: b.textContent.trim(), disabled: b.disabled }))
  }
})()`)
const openPreview = async (path) => {
  await queue('open', [path])
  await clickFooter('Restore from a backup...')
  await page.waitFor(`!!document.querySelector('dialog.history .backup-preview')`, { timeoutMs: 20000, label: 'the preview' })
  await sleep(200)
}
const deleteTheChat = async () => {
  const title = (await H.rows())[0].title
  await H.clickRowButton(title, 'Delete')
  await sleep(200)
  await H.clickRowButton(title, 'Delete')
  await page.waitFor(`document.querySelectorAll('dialog.history .history-row').length === 0`, { timeoutMs: 8000, label: 'the row to go' })
  await sleep(300)
}

try {
  await page.waitFor(`!!document.querySelector('.chat-bar')`, { timeoutMs: 20000, label: 'the app' })
  await sleep(400)
  seed()

  // ============ A. a chat in the project ============
  await ev(`document.querySelector('.chat-project').scrollIntoView({ block: 'center' })`)
  await page.click('.chat-project')
  await page.waitFor(`document.querySelector('dialog.projects')?.open === true && !!document.querySelector('.projects-chat-select option[value="${thesis.id}"]')`, { timeoutMs: 8000, label: 'the Projects page with the project' })
  await ev(`(() => { const s = document.querySelector('.projects-chat-select'); const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; set.call(s, ${JSON.stringify(thesis.id)}); s.dispatchEvent(new Event('change', { bubbles: true })) })()`)
  await sleep(300)
  await page.press('Escape')
  await page.waitFor(`!document.querySelector('dialog.projects')?.open`, { timeoutMs: 6000, label: 'the Projects page to close' })
  await H.askMock('[[mock:count]] a chat in the thesis')
  await H.waitFirst('[[mock:count]] a chat in the thesis', (c) => c.messages.length === 2)
  const saved = chatFiles()
  check('(a chat in the project is sent and saved, version 5)', saved.length === 1 && saved[0].version === 5 && saved[0].project === thesis.id, show(saved.map((c) => [c.version, c.project])))
  const chatId = saved[0].id

  // ============ B. the backup ============
  mkdirSync(join(FILES, 'out'), { recursive: true })
  const dest = join(FILES, 'out', 'all.jsonl')
  rmSync(dest, { force: true })
  await queue('save', dest)
  await H.openHistory()
  await clickFooter('Back up all chats...')
  await waitNotice(/^Backed up/)
  const nb = await notice()
  check('B: "Back up all chats..." says it holds the project and the notes too', nb === `Backed up 1 chat to ${dest}. The file was read back and every chat matched. It holds your 1 project and 2 notes too.`, nb)
  const lb = lines(dest)
  check('B: the file is version 3: the project and the notes as they are kept, before the chat; the trailer counts them', lb[0].version === 3 && same(lb[1].project, thesis) && same(lb[2].note, notes[0]) && same(lb[3].note, notes[1]) && lb[4].chat?.id === chatId && same(lb.at(-1), { end: true, count: 1, leftOut: 0, files: 0, filesLeftOut: 0, projects: 1, notes: 2 }), show(lb.map((l) => Object.keys(l)[0])))
  check('B: making a backup asks nothing in the system\'s box', (await Q.count()) === 0)

  // ============ C. a fresh start: no chat, no project, no note ============
  await deleteTheChat()
  rmSync(projFile, { force: true })
  rmSync(memFile, { force: true })

  // ============ D. the look ============
  await openPreview(dest)
  let pv = await preview()
  check('D: the look says the project and the notes would be added, names the project, and says a yes is asked for in a window of its own', pv.facts.includes('1 project and 2 notes to be added') && pv.notices.some((n) => n.startsWith('Projects: Thesis.') && /asks you about them in a window of its own/.test(n) && /Without your yes only the chats are added\./.test(n)) && pv.buttons[0]?.text === 'Add 1 chat', show(pv))
  check('D: ...and asks nothing yet', (await Q.count()) === 0)

  // ============ E. a no: the chat alone ============
  await Q.queue('no')
  await clickPanel('Add 1 chat')
  await waitNotice(/Added 1 chat/)
  const ne = await notice()
  const asked = await Q.asked()
  check('E: "Add" asks once, in the box of this window: what and from which file, with "Add only the chats" for a no', asked.length === 1 && asked[0].withWindow && asked[0].options.message === 'Add 1 project and 2 notes from the backup "all.jsonl"?' && same(asked[0].options.buttons, ['Add them', 'Add only the chats']) && /- Project "Thesis": instructions of 18 characters, 0 files/.test(asked[0].options.detail) && /- 1 note for every chat/.test(asked[0].options.detail), show(asked.map((a) => a.options)))
  check('E: on no, the chat is added and the notice says nothing else was', ne === 'No project or note was added: you did not say yes in the question. Added 1 chat.', ne)
  const afterNo = chatFiles()
  check('E: ...no project, no note; the chat saved in no project (version 3)', (jsonOf(projFile) === null || jsonOf(projFile).projects.length === 0) && (jsonOf(memFile) === null || jsonOf(memFile).notes.length === 0) && afterNo.length === 1 && afterNo[0].version === 3 && afterNo[0].project === undefined, show([jsonOf(projFile), afterNo.map((c) => c.version)]))

  // ============ F. a yes: everything as it was ============
  await deleteTheChat()
  await sleep(3200) // the quiet after a no (10.1)
  await openPreview(dest)
  await Q.queue('yes')
  await clickPanel('Add 1 chat')
  await waitNotice(/Added 1 chat/)
  const nf = await notice()
  check('F: on yes, the notice says the project, the notes and the chat were added', nf === 'Added 1 project and 2 notes. Added 1 chat.', nf)
  const afterYes = chatFiles()
  check('F: ...the project and the notes are as they were (ids, words, places), and the chat is in its project again', same(jsonOf(projFile)?.projects, [thesis]) && same(jsonOf(memFile)?.notes, notes) && jsonOf(memFile)?.on === true && afterYes.length === 1 && afterYes[0].version === 5 && afterYes[0].project === thesis.id, show([jsonOf(projFile), jsonOf(memFile), afterYes.map((c) => c.project)]))

  // ============ G. again: all of it is here ============
  await openPreview(dest)
  pv = await preview()
  check('G: the same backup again: the chat, the project and the notes already here; nothing to add', pv.facts.includes('1 chat already here, left as it is') && pv.facts.includes('1 project and 2 notes already here') && same(pv.buttons[0], { text: 'Nothing to add', disabled: true }), show(pv))
  await page.send('Emulation.setDeviceMetricsOverride', { width: 280, height: 700, deviceScaleFactor: 1, mobile: false })
  await sleep(300)
  const narrow = await ev(`(() => { const d = document.querySelector('dialog.history'); return { dialog: d.scrollWidth > d.clientWidth + 1, page: document.documentElement.scrollWidth > window.innerWidth + 1 } })()`)
  check('G: at 280 px the preview has no sideways scroll, nor the page', !narrow.dialog && !narrow.page, show(narrow))
  await page.screenshot(`${shots}/10-7-280.png`)
  await page.send('Emulation.clearDeviceMetricsOverride')
  await clickPanel('Back to the list')
  check('G: ...and nothing was asked', (await Q.count()) === 2)

  // ============ H. projects that cannot be read here ============
  writeFileSync(projFile, 'not json')
  await openPreview(dest)
  pv = await preview()
  check('H: a damaged projects.json: the look says what the backup holds and that none of it can be added, and why', pv.notices.some((n) => /^The backup holds 1 project and 2 notes\. Your projects could not be read \(.+\)\. So none can be added\.$/.test(n)) && !pv.facts.some((f) => /project|note/.test(f)), show(pv))
  await clickPanel('Back to the list')
  check('H: ...the damaged file is left as it was, and nothing was asked', readFileSync(projFile, 'utf8') === 'not json' && (await Q.count()) === 2)
  writeFileSync(projFile, JSON.stringify({ version: 1, projects: [thesis] }))
} catch (error) {
  check(`the suite stopped before its end: ${String(error?.stack ?? error).slice(0, 500)}`, false)
}

check('the page logged no errors and no warnings', page.problems.length === 0, show(page.problems))
main.close()
page.close()
process.exit(check.summary() ? 0 : 1)
