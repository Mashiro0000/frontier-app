// Stage 22.1-22.2 (D-054), the Library and Experts, in the real window against the mock: the sidebar's new rows (Experts, Projects, Library) in AI Fiesta's
// order; a chat with a pasted picture and a pasted note; the Library lists both files with the chat that carries them, filters (Images / Files / Starred),
// searches, stars one (kept by main in library.json, still starred when opened again), opens a file and its chat; Experts lists the ready-made ones in
// categories, searches, starts a chat whose own instructions are the expert's (nothing is sent), makes, changes and deletes one of the person's own (kept in
// experts.json); both pages in the dark and the light look and in a narrow window. Screenshots in shots22.
// Needs: MOCK_PORT, USER_DATA_DIR (scratch) and setup-key.mjs.
import './ts-resolve.mjs'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { connect, checker, sleep } from './cdp.mjs'
import { assertScratchProfile } from './profile-guard.mjs'
import { helpers } from './lib3.mjs'

const shots = join(process.argv[2], '..', 'shots22')
mkdirSync(shots, { recursive: true })
const port = Number(process.argv[3] ?? 9222)
const mockUrl = `http://127.0.0.1:${process.env.MOCK_PORT}`
const userData = process.env.USER_DATA_DIR
if (!process.env.MOCK_PORT || !userData) throw new Error('MOCK_PORT and USER_DATA_DIR must be set')

const check = checker()
const page = await connect(port)
await assertScratchProfile()
const H = helpers(page, { userData, mockUrl })
const { ev } = H
const READY = `document.readyState === 'complete' && !!document.querySelector('.header-select')`
const SEND_READY = `!!document.querySelector('.composer-button[type=submit]')`
const LIB = `!!document.querySelector('dialog.library')?.open`
const EXP = `!!document.querySelector('dialog.experts')?.open`
// A 2x2 PNG (red), made here: no file of the project is needed.
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg=='
const pasteFile = (name, type, b64) =>
  ev(`(() => { const t = document.querySelector('.composer-input'); const dt = new DataTransfer(); dt.items.add(new File([Uint8Array.from(atob(${JSON.stringify(b64)}), (c) => c.charCodeAt(0))], ${JSON.stringify(name)}, { type: ${JSON.stringify(type)} })); t.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); return true })()`)
const chipCount = () => ev(`document.querySelectorAll('.attachment-chip').length`)
const cards = () => ev(`[...document.querySelectorAll('dialog.library .library-card')].map((c) => ({ kind: c.dataset.kind, name: c.querySelector('.library-name').textContent, meta: c.querySelector('.library-meta').textContent, starred: c.querySelector('.library-star').getAttribute('aria-pressed') === 'true', thumb: !!c.querySelector('.library-thumb img') }))`)
const tab = (label) => ev(`(() => { const b = [...document.querySelectorAll('dialog.library [role=tab]')].find((x) => x.textContent.trim() === ${JSON.stringify(label)}); b.click(); return true })()`)
const typeInto = async (selector, text) => {
  await ev(`(() => { const i = document.querySelector(${JSON.stringify(selector)}); i.focus(); i.select?.(); return true })()`)
  await page.type(text)
  await sleep(300)
}
const sidebarRows = () => ev(`[...document.querySelectorAll('.sidebar-nav .sidebar-label')].map((l) => l.textContent.trim())`)
const theme = (t) => ev(`(() => { document.documentElement.dataset.theme = ${JSON.stringify(t)}; return true })()`)

try {
  await page.waitFor(READY, { timeoutMs: 20000 })
  await page.send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false })
  await sleep(300)

  // ============ A. the sidebar ============
  check('A: the sidebar lists Image Studio, Experts, Projects, Library, then History and Tools (AI Fiesta\'s order)', JSON.stringify(await sidebarRows()) === JSON.stringify(['Image Studio', 'Experts', 'Projects', 'Library', 'History', 'Tools']), JSON.stringify(await sidebarRows()))
  check('A: each new row has a tooltip that says what it opens', (await ev(`['.sidebar-studio', '.sidebar-experts', '.sidebar-projects', '.sidebar-library'].every((s) => (document.querySelector(s)?.title ?? '').length > 20)`)) === true)

  // ============ B. a chat with two files ============
  await pasteFile('red-square.png', 'image/png', PNG)
  await page.waitFor(`document.querySelectorAll('.attachment-chip').length === 1`, { timeoutMs: 15000 })
  await pasteFile('shopping notes.txt', 'text/plain', Buffer.from('eggs, milk, bread').toString('base64'))
  await page.waitFor(`document.querySelectorAll('.attachment-chip').length === 2`, { timeoutMs: 15000 })
  check('B: two files are on the message', (await chipCount()) === 2)
  await H.askMock('What is in these files?')
  await page.waitFor(SEND_READY, { timeoutMs: 15000 })
  await sleep(800)
  check('B: the reply has come and the Library row can be clicked', (await ev(`document.querySelector('.sidebar-library')?.disabled`)) === false, JSON.stringify(await ev(`({ disabled: document.querySelector('.sidebar-library')?.disabled, title: document.querySelector('.sidebar-library')?.title, open: [...document.querySelectorAll('dialog')].filter((d) => d.open).map((d) => d.className) })`)))

  // ============ C. the Library ============
  await ev("document.querySelector('.sidebar-library').click()")
  await page.waitFor(LIB, { timeoutMs: 4000 })
  await page.waitFor(`document.querySelectorAll('dialog.library .library-card').length >= 2 || /Nothing here/.test(document.querySelector('dialog.library')?.innerText ?? '')`, { timeoutMs: 10000 })
  let c = await cards()
  check('C: the Library lists both files, each once, with its size and "1 chat"', c.length === 2 && c.some((x) => x.name === 'red-square.png') && c.some((x) => x.name === 'shopping notes.txt') && c.every((x) => /1 chat$/.test(x.meta)), JSON.stringify(c))
  check('C: the picture has its small picture; the note shows its kind', c.find((x) => x.name === 'red-square.png')?.thumb === true && (await ev(`[...document.querySelectorAll('dialog.library .library-kind')].map((k) => k.textContent)`)).includes('TXT'))
  check('C: the title and a line that says what it holds', (await ev(`document.querySelector('#library-title').textContent`)) === 'Library' && /in one place/.test(await ev(`document.querySelector('dialog.library .page-subtitle').textContent`)))
  await page.screenshot(join(shots, '22-1-library-dark.png'))
  await tab('Images')
  c = await cards()
  check('C: Images shows the picture only', c.length === 1 && c[0].name === 'red-square.png', JSON.stringify(c))
  await tab('Files')
  c = await cards()
  check('C: Files shows the note only', c.length === 1 && c[0].name === 'shopping notes.txt', JSON.stringify(c))
  await tab('All')
  await typeInto('dialog.library .library-search', 'shopping')
  c = await cards()
  check('C: a search finds the note by its name', c.length === 1 && c[0].name === 'shopping notes.txt', JSON.stringify(c))
  await typeInto('dialog.library .library-search', 'volcano')
  check('C: nothing found: it says so', (await cards()).length === 0 && /Nothing matches/.test(await ev(`document.querySelector('dialog.library').innerText`)))
  await typeInto('dialog.library .library-search', 'shopping')
  await ev(`document.querySelector('dialog.library .library-card .library-star').click()`)
  await sleep(600)
  check('C: a star is put on, and main keeps it in library.json', (await cards())[0]?.starred === true && existsSync(join(userData, 'library.json')) && JSON.parse(readFileSync(join(userData, 'library.json'), 'utf8')).starred.length === 1)
  await ev(`(() => { const i = document.querySelector('dialog.library .library-search'); i.focus(); i.select(); return true })()`)
  await page.press('Backspace')
  await sleep(300)
  await tab('Starred')
  c = await cards()
  check('C: Starred shows only the starred note', c.length === 1 && c[0].name === 'shopping notes.txt' && c[0].starred, JSON.stringify(c))
  const focusBefore = await ev(`(() => { const a = document.activeElement; return a ? a.tagName + '.' + a.className + ' value=' + (a.value ?? '') : 'none' })()`)
  await page.press('Escape')
  await sleep(400)
  const afterOne = await ev(LIB)
  if (afterOne) { await page.press('Escape'); await sleep(400) }
  // As Search chats (21.5): in a search box with text the first Escape clears the text; the next one closes the page.
  check('C: Escape with text in the search clears it first; the next Escape closes the Library', afterOne && !(await ev(LIB)), `focus was ${focusBefore}; open after one Escape: ${afterOne}`)
  await ev("document.querySelector('.sidebar-library').click()")
  await page.waitFor(LIB, { timeoutMs: 4000 })
  await page.waitFor(`document.querySelectorAll('dialog.library .library-card').length >= 2`, { timeoutMs: 10000 })
  c = await cards()
  check('C: opened again it starts at All, and the star is still there (read from main)', c.length === 2 && c.find((x) => x.name === 'shopping notes.txt')?.starred === true && (await ev(`[...document.querySelectorAll('dialog.library [role=tab]')].find((t) => t.getAttribute('aria-selected') === 'true')?.textContent.trim()`)) === 'All', JSON.stringify(c))
  await ev(`[...document.querySelectorAll('dialog.library .library-open')].find((b) => b.textContent.includes('shopping')).click()`)
  await sleep(500)
  const detail = await ev(`document.querySelector('dialog.library .library-detail')?.innerText ?? ''`)
  check('C: a file opens with its kind, size and the chat it is in', /shopping notes\.txt/.test(detail) && /Text/.test(detail) && /In 1 chat/.test(detail) && /What is in these files\?/.test(detail), detail)
  await page.screenshot(join(shots, '22-1-library-file.png'))
  await ev(`document.querySelector('dialog.library .library-chats .search-hit').click()`)
  await sleep(800)
  check('C: its chat opens and the Library closes', !(await ev(LIB)) && (await ev(`[...document.querySelectorAll('.message-user')].map((m) => m.innerText).join('|')`)).includes('What is in these files?'))

  // ============ D. Experts ============
  await ev("document.querySelector('.sidebar-experts').click()")
  await page.waitFor(EXP, { timeoutMs: 4000 })
  const experts = () => ev(`[...document.querySelectorAll('dialog.experts .expert-card')].map((e) => e.querySelector('.expert-name').textContent)`)
  const all = await experts()
  check('D: Experts lists the ready-made assistants (12)', all.length === 12, JSON.stringify(all))
  check('D: each card has a round mark of initials, a category and Start a chat', (await ev(`[...document.querySelectorAll('dialog.experts .expert-card')].every((e) => /^[A-Z]{1,2}$/.test(e.querySelector('.expert-mark').textContent) && !!e.querySelector('.model-tag') && e.querySelector('.expert-start')?.textContent === 'Start a chat')`)) === true)
  await page.screenshot(join(shots, '22-2-experts-dark.png'))
  await ev(`[...document.querySelectorAll('dialog.experts .experts-categories .chip')].find((b) => b.textContent === 'Money').click()`)
  await sleep(200)
  const money = await experts()
  check('D: a category shows only its experts', money.length >= 1 && money.length < 12, JSON.stringify(money))
  await ev(`[...document.querySelectorAll('dialog.experts .experts-categories .chip')].find((b) => b.textContent === 'All').click()`)
  await typeInto('dialog.experts .library-search', 'career')
  check('D: a search finds Career Coach', JSON.stringify(await experts()) === '["Career Coach"]', JSON.stringify(await experts()))
  const before = (await H.mockReqs()).length
  await ev(`document.querySelector('dialog.experts .expert-card[data-expert="career-coach"] .expert-start').click()`)
  await sleep(700)
  check('D: Start a chat closes Experts and opens a new, empty chat', !(await ev(EXP)) && (await ev(`document.querySelectorAll('.message-user').length`)) === 0)
  check('D: the chat\'s own instructions are the expert\'s (the Instructions button says so)', /on for this chat/.test(await ev(`document.querySelector('.chat-instructions').title`)) && (await ev(`document.querySelector('.chat-instructions .chat-mark')?.textContent`)) === 'on')
  check('D: nothing was sent', (await H.mockReqs()).length === before)
  await H.askMock('Help me plan my week at work')
  await sleep(800)
  const last = (await H.mockReqs()).at(-1)
  check('D: the first message carries the expert\'s instructions', JSON.stringify(last?.body ?? last ?? '').includes('experienced career coach'), JSON.stringify(last).slice(0, 300))

  // ============ E. My experts ============
  await ev("document.querySelector('.sidebar-experts').click()")
  await page.waitFor(EXP, { timeoutMs: 4000 })
  await ev(`[...document.querySelectorAll('dialog.experts [role=tab]')].find((b) => b.textContent === 'My experts').click()`)
  await sleep(300)
  check('E: My experts starts empty and says how to make one', /no experts of your own yet/.test(await ev(`document.querySelector('dialog.experts').innerText`)))
  await ev(`[...document.querySelectorAll('dialog.experts button')].find((b) => b.textContent === 'Make an expert').click()`)
  await sleep(200)
  await typeInto('#expert-name', 'Plant Doctor')
  await typeInto('#expert-description', 'Keeps house plants alive')
  await typeInto('.expert-instructions', 'Act as a patient gardener. Ask about light and water first.')
  await page.screenshot(join(shots, '22-2-my-expert-form.png'))
  await ev(`document.querySelector('dialog.experts .expert-form').requestSubmit()`)
  await sleep(700)
  check('E: the expert is saved and listed', JSON.stringify(await experts()) === '["Plant Doctor"]', JSON.stringify(await experts()))
  const kept = JSON.parse(readFileSync(join(userData, 'experts.json'), 'utf8'))
  check('E: main keeps it in experts.json, with an id it made', kept.experts.length === 1 && kept.experts[0].name === 'Plant Doctor' && /^[0-9a-f-]{36}$/.test(kept.experts[0].id))
  await ev(`[...document.querySelectorAll('dialog.experts .expert-card .link-button')].find((b) => b.textContent === 'Edit').click()`)
  await sleep(200)
  await typeInto('#expert-name', 'Plant Friend')
  await ev(`document.querySelector('dialog.experts .expert-form').requestSubmit()`)
  await sleep(700)
  check('E: a change is saved in place', JSON.stringify(await experts()) === '["Plant Friend"]' && JSON.parse(readFileSync(join(userData, 'experts.json'), 'utf8')).experts.length === 1)
  await ev(`window.confirm = () => false`)
  await ev(`[...document.querySelectorAll('dialog.experts .expert-card .link-button')].find((b) => b.textContent === 'Delete').click()`)
  await sleep(500)
  check('E: Delete asks first; a no keeps it', JSON.stringify(await experts()) === '["Plant Friend"]')
  await ev(`window.confirm = () => true`)
  await ev(`[...document.querySelectorAll('dialog.experts .expert-card .link-button')].find((b) => b.textContent === 'Delete').click()`)
  await sleep(700)
  check('E: a yes deletes it, in the file too', (await experts()).length === 0 && JSON.parse(readFileSync(join(userData, 'experts.json'), 'utf8')).experts.length === 0)
  await page.press('Escape')
  await sleep(300)

  // ============ F. the look: light, narrow ============
  await theme('light')
  await sleep(200)
  await ev("document.querySelector('.sidebar-experts').click()")
  await page.waitFor(EXP, { timeoutMs: 4000 })
  await page.screenshot(join(shots, '22-2-experts-light.png'))
  await page.press('Escape'); await sleep(300)
  await ev("document.querySelector('.sidebar-library').click()")
  await page.waitFor(`document.querySelectorAll('dialog.library .library-card').length >= 2`, { timeoutMs: 10000 })
  await page.screenshot(join(shots, '22-1-library-light.png'))
  await page.send('Emulation.setDeviceMetricsOverride', { width: 560, height: 800, deviceScaleFactor: 1, mobile: false })
  await sleep(500)
  check('F: in a narrow window the Library fits without a sideways scroll', (await ev(`(() => { const d = document.querySelector('dialog.library'); return d.scrollWidth <= d.clientWidth + 1 && d.getBoundingClientRect().right <= innerWidth })()`)) === true)
  await page.screenshot(join(shots, '22-1-library-narrow.png'))
  await page.press('Escape'); await sleep(300)
  await page.send('Emulation.clearDeviceMetricsOverride')
  await theme('dark')

  check('no console errors / warnings / exceptions', page.problems.length === 0, page.problems.join(' | '))
} catch (error) {
  check(`the run did not stop: ${error?.message ?? error}`, false, page.problems.join(' | ').slice(0, 1500))
}
const ok = check.summary()
page.close()
process.exit(ok ? 0 : 1)
