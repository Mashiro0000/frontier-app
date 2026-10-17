// Stage 10.5 (D-039), in the real window against the mock: projects. The Projects page (no projects; a new one, asking nothing; its instructions,
// asked in the system's own message box, replaced from the main inspector (lib10.mjs): a no, then a yes; its files through the system's open dialog,
// replaced from main, then a question that names each; taking one off; renaming), the chat on screen moved into a project ("Project: name" under the
// message box, the chat file version 5, History naming the project and showing one project's chats, "New chat in this project"), a project's notes on the
// Memory page, deleting a project (its chats stay, in no project; its notes and unused files go), a damaged projects.json and its way out, encryption on
// and off converting it, the bridge, 420 and 280 px, no console errors. Requests do not carry a project's parts yet (10.6).
// Needs: USER_DATA_DIR (scratch), FILES_DIR (outside it, with report.pdf and notes.txt), INSPECT_PORT, MOCK_PORT, a saved key (setup-key.mjs).
import './ts-resolve.mjs'
import { connect, checker, sleep } from './cdp.mjs'
import { assertScratchProfile } from './profile-guard.mjs'
import { h4, mainInspector, readRetry } from './lib4.mjs'
import { installQuestions } from './lib10.mjs'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
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
const projFile = join(userData, 'projects.json')
const projText = () => (existsSync(projFile) ? readRetry(projFile, 'utf8') : null)
const projJson = () => { const t = projText(); try { return t === null ? null : JSON.parse(t) } catch { return 'unreadable' } }
const attDir = join(userData, 'attachments')
const copies = () => (existsSync(attDir) ? readdirSync(attDir).filter((n) => /^[0-9a-f]{64}$/.test(n)) : [])
const sent = (r) => (r?.provider === 'openai' ? r.body.instructions : r?.body.system)

const bar = () => ev(`(() => { const b = document.querySelector('.chat-bar .chat-project'); if (!b) return null; return { text: b.textContent, title: b.title, height: b.getBoundingClientRect().height, before: b.previousElementSibling?.textContent ?? null } })()`)
const dlg = () => ev(`(() => {
  const d = document.querySelector('dialog.projects')
  if (!d) return null
  const notice = d.querySelector('.projects-notice')
  const detail = d.querySelector('.projects-detail')
  return { open: d.open, heading: d.querySelector('h2')?.textContent ?? null, chat: d.querySelector('.projects-chat-select')?.value ?? null, chatOptions: [...d.querySelectorAll('.projects-chat-select option')].map((o) => o.textContent), rows: [...d.querySelectorAll('.projects-row')].map((r) => ({ name: r.querySelector('.projects-name')?.textContent, facts: r.querySelector('.projects-facts')?.textContent, current: r.querySelector('.projects-open')?.getAttribute('aria-current') === 'true' })), none: d.querySelector('.projects-list-section .projects-none')?.textContent ?? null, detail: detail ? { title: detail.querySelector('.projects-detail-title')?.textContent ?? null, instructions: detail.querySelector('.projects-text')?.textContent ?? null, files: [...detail.querySelectorAll('.projects-file')].map((f) => ({ name: f.querySelector('.projects-file-name')?.textContent, facts: f.querySelector('.projects-file-facts')?.textContent })) } : null, value: d.querySelector('textarea, .projects-name-input')?.value ?? null, notice: notice ? { text: notice.textContent, error: notice.classList.contains('projects-notice-error') } : null, refused: [...d.querySelectorAll('.projects-refused li')].map((li) => li.textContent), problem: d.querySelector('.projects-problem')?.innerText ?? null, ask: d.querySelector('.projects-ask')?.innerText ?? null, text: d.innerText, sideways: d.scrollWidth > d.clientWidth + 1, pageSideways: document.documentElement.scrollWidth > window.innerWidth + 1 }
})()`)
const clickMarked = async (selectorJs) => {
  await ev(`(() => { const b = ${selectorJs}; b.scrollIntoView({ block: 'center' }); b.setAttribute('data-click', '1') })()`)
  await sleep(80)
  await page.click('[data-click="1"]')
  await ev(`document.querySelector('[data-click="1"]')?.removeAttribute('data-click')`)
  await sleep(200)
}
const button = (text, within = 'dialog.projects') => `[...document.querySelectorAll('${within} button')].find((b) => b.textContent === ${JSON.stringify(text)})`
const openProjects = async () => {
  await ev(`document.querySelector('.chat-project').scrollIntoView({ block: 'center' })`)
  await page.click('.chat-project')
  await page.waitFor(`document.querySelector('dialog.projects')?.open === true`, { timeoutMs: 6000, label: 'the Projects page to open' })
  await sleep(300)
}
const closeProjects = async () => { await page.press('Escape'); await page.waitFor(`!document.querySelector('dialog.projects')?.open`, { timeoutMs: 6000, label: 'the Projects page to close' }); await sleep(200) }
const typeIn = async (selector, text) => {
  await ev(`(() => { const t = document.querySelector(${JSON.stringify(selector)}); t.focus(); t.select() })()`)
  await sleep(60)
  await page.send('Input.insertText', { text })
  await sleep(120)
}
const waitCount = async (n) => { for (let i = 0; i < 60; i++) { if ((await Q.count()) >= n) return true; await sleep(100) } return false }
// A notice, or the box gone: the named check that follows says which.
const settled = (re) => page.waitFor(`!document.querySelector('dialog.projects .projects-editor') || ${re}.test(document.querySelector('dialog.projects .projects-notice')?.textContent ?? '')`, { timeoutMs: 8000, label: `a notice like ${re} (or the box gone)` }).then(() => true, () => false)
const pickNext = (paths) => main.inMain(`(() => { const { dialog } = process.mainModule.require('electron'); globalThis.__opens = globalThis.__opens ?? []; dialog.showOpenDialog = async (...args) => { globalThis.__opens.push({ withWindow: args.length > 1, options: args[args.length - 1] }); return ${JSON.stringify(paths)} === null ? { canceled: true, filePaths: [] } : { canceled: false, filePaths: ${JSON.stringify(paths)} } }; return true })()`)
const convFile = (id) => { const f = join(userData, 'conversations', `${id}.json`); return existsSync(f) ? JSON.parse(readRetry(f, 'utf8')) : null }

let d
let b
let r
try {
  await page.waitFor(`document.readyState === 'complete' && !!document.querySelector('.header-select, .app-badge')`, { timeoutMs: 15000 })
  await sleep(300)

  // ============ A. the page and a first project ============
  b = await bar()
  check('A: under the message box, "Project" comes after Memory, and says what a project is', b !== null && b.text === 'Project' && b.before?.startsWith('Memory') && /a project gives its chats the same instructions, files and notes/.test(b.title), show(b))
  await openProjects()
  d = await dlg()
  check('A: the Projects page: this chat in no project, "No projects yet.", and what a project is for', d.heading === 'Projects' && d.chat === '' && d.none === 'No projects yet.' && /same instructions, files and notes/.test(d.text) && /encrypted when your chats are/.test(d.text), show(d))
  await clickMarked(button('New project...'))
  await typeIn('#projects-name', '  My   thesis ')
  await clickMarked(button('Create'))
  await page.waitFor(`!document.querySelector('#projects-name')`, { timeoutMs: 6000, label: 'the new project made' })
  d = await dlg()
  const p1 = projJson()?.projects?.[0]
  check('A: "Create" makes the project at once, asking nothing: the name on one line, no instructions, no files, opened below the list', (await Q.count()) === 0 && p1?.name === 'My thesis' && p1.instructions === '' && p1.files.length === 0 && d.rows.length === 1 && d.rows[0].name === 'My thesis' && d.rows[0].current && d.detail?.title === 'My thesis', show([p1, d.rows, d.detail]))
  check('A: ...the page says the name is never sent to the model', /never sent to the model/.test((await ev(`document.querySelector('dialog.projects').innerText`)) + (await (async () => { await clickMarked(button('New project...')); const t = await ev(`document.querySelector('dialog.projects').innerText`); await clickMarked(button('Cancel')); return t })())))
  await clickMarked(button('New project...'))
  await typeIn('#projects-name', 'MY THESIS')
  await clickMarked(button('Create'))
  await page.waitFor(`/already a project/.test(document.querySelector('dialog.projects .projects-notice')?.textContent ?? '')`, { timeoutMs: 6000, label: 'the refusal of a second name' })
  check('A: a second project of the same name (other capitals) is refused', projJson().projects.length === 1)
  await clickMarked(button('Cancel'))

  // ============ B. its instructions ============
  await clickMarked(`[...document.querySelectorAll('dialog.projects .projects-part')].find((p) => /Instructions/.test(p.innerText)).querySelector('button')`)
  await typeIn('#projects-instructions', 'Cite your sources.')
  await Q.queue('no')
  await clickMarked(button('Save'))
  await settled(/Not saved/)
  const q1 = (await Q.asked())[0]
  d = await dlg()
  check('B: saving them asks in the system\'s box for this window: the project named, the text, where it goes; a no saves nothing', q1?.withWindow && q1.options.title === 'Project instructions' && q1.options.message === 'Save these instructions for the project "My thesis"?' && q1.options.detail.startsWith('"Cite your sources."') && /every message of every chat in this project/.test(q1.options.detail) && d.notice?.text === 'Not saved: the project is as it was.' && projJson().projects[0].instructions === '', show([q1?.options, d.notice]))
  await sleep(3300)
  await Q.queue('yes')
  await clickMarked(button('Save'))
  const savedInstr = await settled(/never/)
  d = await dlg()
  check('B: a yes: saved, and the page shows them', savedInstr && projJson().projects[0].instructions === 'Cite your sources.' && d.detail?.instructions === 'Cite your sources.', show(d.detail))

  // ============ C. its files ============
  await pickNext([join(FILES, 'report.pdf'), join(FILES, 'notes.txt')])
  await Q.hold()
  await clickMarked(button('Add files...'))
  const asked2 = await waitCount(3) // the instructions were asked about twice (a no, then a yes)
  const opens = JSON.parse(await main.inMain('JSON.stringify(globalThis.__opens)'))
  const q2 = (await Q.asked()).at(-1)
  check('C: "Add files..." opens the system\'s open dialog for this window, then asks a question naming each file', asked2 && opens.length === 1 && opens[0].withWindow && q2.options.title === 'Project files' && q2.options.message === 'Add these 2 files to the project "My thesis"?' && /- report\.pdf \(3 pages/.test(q2.options.detail) && /- notes\.txt \(\d+ characters\)/.test(q2.options.detail) && /at the start of the conversation/.test(q2.options.detail), show(q2?.options))
  await Q.queue('yes')
  await Q.release()
  await page.waitFor(`document.querySelectorAll('dialog.projects .projects-file').length === 2`, { timeoutMs: 8000, label: 'the files listed' })
  d = await dlg()
  check('C: on a yes both are listed with what they are, kept in the project file and as copies', d.detail.files.map((f) => f.name).join() === 'report.pdf,notes.txt' && /3 pages/.test(d.detail.files[0].facts) && projJson().projects[0].files.length === 2 && copies().length === 2, show([d.detail.files, copies().length]))
  await pickNext([join(FILES, 'report.pdf')])
  await clickMarked(button('Add files...'))
  await page.waitFor(`/already in the project/.test(document.querySelector('dialog.projects .projects-refused')?.textContent ?? '') || /No file was added/.test(document.querySelector('dialog.projects .projects-notice')?.textContent ?? '')`, { timeoutMs: 8000, label: 'the refusal of a file already there' })
  check('C: a file already in the project is not asked about again', (await Q.count()) === 3 && (await dlg()).refused.some((x) => /report\.pdf is already in the project/.test(x)))
  await pickNext([join(FILES, 'photo.jpg')])
  await Q.queue('no')
  await clickMarked(button('Add files...'))
  await page.waitFor(`/Not saved/.test(document.querySelector('dialog.projects .projects-notice')?.textContent ?? '')`, { timeoutMs: 8000, label: 'the no to a file' })
  await sleep(400)
  check('C: a no to a file adds nothing, and its copy is not kept', projJson().projects[0].files.length === 2 && copies().length === 2, show(copies().length))
  await page.screenshot(`${shots}/10-5-page.png`)

  // ============ D. the chat on screen in the project ============
  await ev(`(() => { const s = document.querySelector('.projects-chat-select'); const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; set.call(s, ${JSON.stringify(p1.id)}); s.dispatchEvent(new Event('change', { bubbles: true })) })()`)
  await sleep(300)
  check('D: choosing the project for this chat marks it in the list', (await dlg()).rows[0].facts.includes('this chat'))
  await closeProjects()
  b = await bar()
  check('D: under the message box: "Project: My thesis"', b.text === 'Project: My thesis' && /This chat is in the project "My thesis"/.test(b.title), show(b))
  r = await H.askMock('[[mock:count]] a chat in the thesis')
  const chatId = await ev(`(() => { return null })()`) ?? H.byFirst('[[mock:count]] a chat in the thesis')?.id
  const conv = await H.waitFirst('[[mock:count]] a chat in the thesis', (c) => c.messages.length === 2)
  check('D: the chat is saved as version 5, naming the project', conv.conv.version === 5 && conv.conv.project === p1.id, show({ version: conv.conv.version, project: conv.conv.project }))
  check('D: (since 10.6 the request carries the project\'s instructions) the project\'s name is never sent', !sent(r).includes('My thesis'))
  await H.openHistory()
  let rows = await H.rows()
  check('D: History names the chat\'s project', rows.some((x) => x.title === '[[mock:count]] a chat in the thesis' && /My thesis/.test(x.meta)), show(rows))
  await H.closeHistory()
  await openProjects()
  await clickMarked(button('New chat in this project'))
  await sleep(300)
  b = await bar()
  check('D: "New chat in this project" starts an empty chat already in it', b.text === 'Project: My thesis' && (await H.screen()).length === 0, show(b))
  await H.askMock('[[mock:count]] second chat in the thesis')
  await H.askMock('[[mock:count]] needed for a third chat') // stays in the project too
  await H.clickChat('New chat')
  await sleep(300)
  check('D: "New chat" starts a chat in no project', (await bar()).text === 'Project')
  await H.askMock('[[mock:count]] a chat in no project')
  const plainConv = await H.waitFirst('[[mock:count]] a chat in no project', (c) => c.messages.length === 2)
  check('D: a chat in no project is still saved as version 3', plainConv.conv.version === 3 && !('project' in plainConv.conv))
  await H.openHistory()
  await ev(`(() => { const s = document.querySelector('dialog.history .history-filter select'); const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; set.call(s, ${JSON.stringify(p1.id)}); s.dispatchEvent(new Event('change', { bubbles: true })) })()`)
  await sleep(300)
  rows = await H.rows()
  check('D: History can show one project\'s chats', rows.length === 2 && rows.every((x) => /My thesis/.test(x.meta)), show(rows.map((x) => x.title)))
  await ev(`(() => { const s = document.querySelector('dialog.history .history-filter select'); const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; set.call(s, 'none'); s.dispatchEvent(new Event('change', { bubbles: true })) })()`)
  await sleep(300)
  rows = await H.rows()
  check('D: ...or the chats in no project', rows.length === 1 && rows[0].title === '[[mock:count]] a chat in no project', show(rows.map((x) => x.title)))
  await H.closeHistory()

  // ============ E. rename, notes ============
  await openProjects()
  await clickMarked(`[...document.querySelectorAll('dialog.projects .projects-open')].find((x) => /My thesis/.test(x.textContent))`)
  if (!(await dlg()).detail) await clickMarked(`[...document.querySelectorAll('dialog.projects .projects-open')].find((x) => /My thesis/.test(x.textContent))`)
  await clickMarked(button('Rename...'))
  await typeIn('#projects-name', 'Thesis')
  await clickMarked(button('Rename'))
  await sleep(300)
  check('E: renaming asks nothing, and the list shows the new name', projJson().projects[0].name === 'Thesis' && (await Q.count()) === 4 && (await dlg()).rows[0].name === 'Thesis', show(projJson().projects[0].name))
  await closeProjects()
  await page.click('.chat-memory')
  await page.waitFor(`document.querySelector('dialog.memory')?.open === true`, { timeoutMs: 6000, label: 'the Memory page' })
  await sleep(300)
  const places = await ev(`[...document.querySelectorAll('dialog.memory .memory-place')].map((s) => s.getAttribute('aria-label'))`)
  check('E: the Memory page has a place for the project\'s notes', show(places) === show(['For every chat', 'For the project "Thesis"']), show(places))
  await clickMarked(`[...document.querySelectorAll('dialog.memory .memory-place')][1].querySelector('.memory-place-actions button')`)
  await typeIn('#memory-input', 'Chapter 3 is about sampling.')
  await Q.queue('yes')
  await clickMarked(`[...document.querySelectorAll('dialog.memory button')].find((x) => x.textContent === 'Remember')`)
  await page.waitFor(`!document.querySelector('dialog.memory textarea')`, { timeoutMs: 8000, label: 'the note kept' })
  const q5 = (await Q.asked()).at(-1)
  const mem = JSON.parse(readRetry(join(userData, 'memory.json'), 'utf8'))
  check('E: a note for the project is asked about with the project named, and kept for it', q5.options.message === 'Remember this for the chats of "Thesis"?' && mem.notes.length === 1 && mem.notes[0].scope === p1.id, show([q5.options.message, mem.notes]))
  await page.press('Escape')
  await sleep(300)

  // ============ F. deleting the project ============
  const reportId = projJson().projects[0].files[0].id
  await openProjects()
  if (!(await dlg()).detail) await clickMarked(`[...document.querySelectorAll('dialog.projects .projects-open')].find((x) => /Thesis/.test(x.textContent))`)
  await clickMarked(button('Delete project...'))
  d = await dlg()
  check('F: "Delete project..." asks on the page first, saying its chats stay and its notes go', /Delete the project "Thesis"\? Its chats stay, in no project; its notes are deleted, and its files unless a chat uses them\./.test(d.ask ?? ''), show(d.ask))
  const askedF = await Q.count()
  await clickMarked(`[...document.querySelectorAll('dialog.projects .projects-ask button')].find((x) => x.textContent === 'Delete')`)
  await sleep(500)
  d = await dlg()
  const memAfter = JSON.parse(readRetry(join(userData, 'memory.json'), 'utf8'))
  check('F: deleted, asking nothing in the system\'s box: no projects, its note gone, its files\' copies gone (no chat used them)', (await Q.count()) === askedF && projJson().projects.length === 0 && d.none === 'No projects yet.' && memAfter.notes.length === 0 && !copies().includes(reportId), show([projJson(), memAfter.notes.length, copies().length]))
  check('F: its chats stay (their files still name it), and the chat on screen is in no project', convFile(conv.id)?.messages.length === 2 && (await (async () => { await closeProjects(); return (await bar()).text })()) === 'Project', show(convFile(conv.id)?.version))
  await H.openHistory()
  rows = await H.rows()
  check('F: History no longer names a project, and has no filter', rows.every((x) => !/Thesis/.test(x.meta)) && !(await ev(`!!document.querySelector('dialog.history .history-filter')`)), show(rows.map((x) => x.meta)))
  await H.closeHistory()

  // ============ G. a damaged file, encryption, the bridge ============
  writeFileSync(projFile, '{"version":1,"projects":[{"id"')
  await openProjects()
  d = await dlg()
  check('G: a damaged projects.json: the page says why, that nothing is sent from a chat in a project, and offers "Delete all projects..."', /could not be read \(.*not a file this app wrote.*\)/.test(d.problem ?? '') && d.problem.includes('Delete all projects...'), show(d.problem))
  await clickMarked(button('Delete all projects...'))
  await clickMarked(`[...document.querySelectorAll('dialog.projects .projects-ask button')].find((x) => x.textContent === 'Delete all')`)
  await sleep(400)
  check('G: "Delete all" keeps a copy of the damaged file and starts again with none', readdirSync(userData).some((n) => n.startsWith('projects.json.damaged-')) && show(projJson()) === show({ version: 1, projects: [] }), show(projJson()))
  await clickMarked(button('New project...'))
  await typeIn('#projects-name', 'Sealed later')
  await clickMarked(button('Create'))
  await sleep(300)
  await closeProjects()
  await main.inMain(`(() => { const { dialog } = process.mainModule.require('electron'); dialog.showSaveDialog = async () => ({ canceled: false, filePath: ${JSON.stringify(join(FILES, 'backup-10-5.jsonl'))} }); return true })()`)
  await page.click('.header-button@Settings')
  await page.waitFor(`!!document.querySelector('dialog.settings')?.open`)
  await page.waitFor(`(() => { const s = document.getElementById('settings-storage-heading')?.closest('section')?.querySelector('.settings-status'); return !!s && s.innerText !== 'Checking...' })()`, { timeoutMs: 15000, label: 'the Saved chats section' })
  await clickMarked(`[...document.getElementById('settings-storage-heading').closest('section').querySelectorAll('button')].find((x) => x.textContent.trim() === 'Encrypt my saved chats...')`)
  await page.waitFor(`/encrypted too/.test(document.getElementById('settings-storage-heading').closest('section').innerText)`, { timeoutMs: 30000, label: 'the encryption report' })
  check('G: turning encryption on seals projects.json too (the name is nowhere in it)', (projText() ?? '').startsWith('{"format":"frontier-chat-encrypted"') && !(projText() ?? '').includes('Sealed later'), (projText() ?? '').slice(0, 60))
  await page.press('Escape')
  await sleep(300)
  const api = await ev(`({ top: Object.keys(window.api).sort(), projects: Object.keys(window.api.projects).sort() })`)
  check('G: window.api has projects (since 10.5) with exactly addFiles, create, remove, removeAll, removeFile, rename, setInstructions and status', show(api) === show({ top: ['attachments', 'audit', 'changes', 'chat', 'connectors', 'history', 'images', 'instructions', 'memory', 'programs', 'projects', 'settings', 'tools', 'updates', 'usage', 'voice', 'workspace'], projects: ['addFiles', 'create', 'remove', 'removeAll', 'removeFile', 'rename', 'setInstructions', 'status'] }), show(api))
  const bad = await ev(`Promise.all([window.api.projects.create(5), window.api.projects.rename('x', 'y'), window.api.projects.setInstructions('x', 'y'), window.api.projects.removeFile('x', 'y'), window.api.projects.remove(null)])`)
  check('G: input that is not what main takes is refused, and changes nothing', bad.every((x) => x.ok === false) && (await ev(`window.api.projects.status()`)).projects.length === 1, show(bad))
  const saveBad = await ev(`window.api.history.save({ id: crypto.randomUUID(), messages: [{ role: 'user', content: 'x', status: 'done' }], project: 'not-an-id' })`)
  check('G: a chat saved with a project that is not an id is refused', saveBad.ok === false, show(saveBad))
  const ghostId = '00000000-0000-4000-8000-0000000abcde'
  const saveGhost = await ev(`window.api.history.save({ id: ${JSON.stringify(ghostId)}, messages: [{ role: 'user', content: 'ghost', status: 'done' }], project: '99999999-2222-4333-8444-555555555555' })`)
  const ghost = await ev(`window.api.history.load(${JSON.stringify(ghostId)})`)
  check('G: a chat saved for a project that is not there is saved in none (it opens with no project)', saveGhost.ok === true && saveGhost.summary.project === undefined && ghost.ok === true && ghost.conversation.project === undefined, show([saveGhost, ghost.conversation?.project]))

  // ============ H. narrow windows ============
  for (const width of [420, 280]) {
    await page.send('Emulation.setDeviceMetricsOverride', { width, height: 700, deviceScaleFactor: 1, mobile: false })
    await sleep(300)
    await openProjects()
    d = await dlg()
    b = await bar()
    check(`H: at ${width} px the Projects page has no sideways scroll, nor the page, and the button stays on one line`, !d.sideways && !d.pageSideways && b.height <= 30, show([d.sideways, d.pageSideways, b.height]))
    await page.screenshot(`${shots}/10-5-${width}.png`)
    await closeProjects()
  }
  await page.send('Emulation.clearDeviceMetricsOverride')
  void chatId
} catch (error) {
  check(`the suite stopped before its end: ${String(error?.stack ?? error).slice(0, 400)}`, false)
}

check('the page logged no errors and no warnings', page.problems.length === 0, show(page.problems))
main.close()
page.close()
process.exit(check.summary() ? 0 : 1)
