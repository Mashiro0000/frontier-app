// Stage 23.8 (D-055), reordering, in the real window against the mock: the sidebar's pages move with Alt+Down / Alt+Up (the keyboard stays on the moved
// page) and by dragging one onto another, and keep their order after a reload; My experts and Your projects move the same way and main keeps the order
// (experts.json, projects.json); main refuses a move it cannot make. Screenshots in shots23.
// Needs: MOCK_PORT, USER_DATA_DIR (scratch) and setup-key.mjs.
import './ts-resolve.mjs'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { connect, checker, sleep } from './cdp.mjs'
import { assertScratchProfile } from './profile-guard.mjs'
import { helpers } from './lib3.mjs'

const shots = join(process.argv[2], '..', 'shots23')
mkdirSync(shots, { recursive: true })
const port = Number(process.argv[3] ?? 9222)
const userData = process.env.USER_DATA_DIR
if (!process.env.MOCK_PORT || !userData) throw new Error('MOCK_PORT and USER_DATA_DIR must be set')

const check = checker()
const page = await connect(port)
await assertScratchProfile()
const H = helpers(page, { userData, mockUrl: `http://127.0.0.1:${process.env.MOCK_PORT}` })
const { ev } = H
const READY = `document.readyState === 'complete' && !!document.querySelector('.composer-input')`
const pages = () => ev(`[...document.querySelectorAll('.sidebar-nav .sidebar-item .sidebar-label')].map((l) => l.textContent)`)
const altKey = async (keyName) => {
  const code = keyName === 'ArrowDown' ? 40 : 38
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', modifiers: 1, key: keyName, code: keyName, windowsVirtualKeyCode: code })
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', modifiers: 1, key: keyName, code: keyName, windowsVirtualKeyCode: code })
  await sleep(500)
}
// A drag of one row onto another, as the browser sends it: dragstart on the row, dragover and drop on the target, with one DataTransfer between them.
const drag = (fromSel, toSel) => ev(`(() => { const dt = new DataTransfer(); const from = document.querySelector(${JSON.stringify(fromSel)}); const to = document.querySelector(${JSON.stringify(toSel)}); from.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt })); to.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt })); to.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt })); from.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt })); return true })()`)
const START = ['Image Studio', 'Experts', 'Projects', 'Library', 'History', 'Tools']

try {
  await page.waitFor(READY, { timeoutMs: 20000 })

  // ============ A. the sidebar's pages ============
  check('A: the pages start in their first order', JSON.stringify(await pages()) === JSON.stringify(START), JSON.stringify(await pages()))
  check('A: each page says how it moves', await ev(`[...document.querySelectorAll('.sidebar-nav .sidebar-item')].every((b) => /Alt\\+Up/.test(b.title) && b.draggable)`))
  await ev(`document.querySelector('.sidebar-studio').focus()`)
  await altKey('ArrowDown')
  check('A: Alt+Down moves Image Studio below Experts', JSON.stringify(await pages()) === JSON.stringify(['Experts', 'Image Studio', 'Projects', 'Library', 'History', 'Tools']), JSON.stringify(await pages()))
  check('A: the keyboard stays on the moved page', await ev(`document.activeElement?.classList.contains('sidebar-studio')`))
  await altKey('ArrowUp'); await altKey('ArrowUp')
  check('A: Alt+Up at the top does nothing more', JSON.stringify(await pages()) === JSON.stringify(START))
  await drag('.chat-tools', '.sidebar-studio')
  await sleep(300)
  check('A: dragging Tools onto Image Studio puts Tools first', JSON.stringify(await pages()) === JSON.stringify(['Tools', 'Image Studio', 'Experts', 'Projects', 'Library', 'History']), JSON.stringify(await pages()))
  await ev(`location.reload()`); await sleep(500)
  await page.waitFor(READY, { timeoutMs: 20000 })
  check('A: the order is kept after a reload', JSON.stringify(await pages()) === JSON.stringify(['Tools', 'Image Studio', 'Experts', 'Projects', 'Library', 'History']))
  await page.screenshot(join(shots, '23-8-sidebar.png'))
  await page.click('.chat-tools'); await sleep(400)
  check('A: a moved page still opens its own page (Tools)', (await ev(`[...document.querySelectorAll('dialog')].filter((d) => d.open).length`)) === 1)
  await page.press('Escape'); await sleep(300)

  // ============ B. My experts ============
  for (const name of ['Alpha', 'Beta', 'Gamma']) await ev(`window.api.experts.save({ name: ${JSON.stringify(name)}, description: '', instructions: 'Be helpful.', task: 'chat' })`)
  const names = async () => (await ev(`window.api.experts.list()`)).experts.map((e) => e.name)
  await page.click('.sidebar-experts'); await sleep(500)
  await page.click('button@My experts'); await sleep(400)
  check('B: My experts are listed in their saved order, each card draggable', JSON.stringify(await ev(`[...document.querySelectorAll('ul[aria-label="My experts"] .expert-name')].map((n) => n.textContent)`)) === '["Alpha","Beta","Gamma"]' && (await ev(`[...document.querySelectorAll('ul[aria-label="My experts"] .expert-card')].every((c) => c.draggable)`)))
  await ev(`document.querySelector('ul[aria-label="My experts"] .expert-card .expert-start').focus()`)
  await altKey('ArrowDown')
  check('B: Alt+Down on Alpha moves it below Beta, and main keeps it', JSON.stringify(await names()) === '["Beta","Alpha","Gamma"]', JSON.stringify(await names()))
  check('B: the keyboard stays on Alpha\'s card', await ev(`document.activeElement?.closest('.expert-card')?.querySelector('.expert-name')?.textContent === 'Alpha'`))
  await drag('ul[aria-label="My experts"] .expert-card:nth-child(3)', 'ul[aria-label="My experts"] .expert-card:nth-child(1)')
  await sleep(500)
  check('B: dragging Gamma onto the first card puts it first', JSON.stringify(await names()) === '["Gamma","Beta","Alpha"]', JSON.stringify(await names()))
  await page.screenshot(join(shots, '23-8-experts.png'))
  await page.press('Escape'); await sleep(300)

  // ============ C. Your projects ============
  for (const name of ['One', 'Two']) await ev(`window.api.projects.create(${JSON.stringify(name)})`)
  const projects = async () => (await ev(`window.api.projects.status()`)).projects.map((p) => p.name)
  await page.click('.sidebar-projects'); await sleep(500)
  await ev(`document.querySelector('.projects-row .projects-open').focus()`)
  await altKey('ArrowDown')
  check('C: Alt+Down on the first project moves it down, and main keeps it', JSON.stringify(await projects()) === '["Two","One"]', JSON.stringify(await projects()))
  await page.press('Escape'); await sleep(300)

  // ============ D. what main refuses ============
  const ids = (await ev(`window.api.projects.status()`)).projects.map((p) => p.id)
  const refused = await ev(`Promise.all([window.api.experts.move('nope', 0), window.api.projects.move(${JSON.stringify(ids[0])}, 99), window.api.projects.move(${JSON.stringify(ids[0])}, -1), window.api.projects.move(${JSON.stringify(ids[0])}, 0.5), window.api.experts.move('x', 'first')])`)
  check('D: an unknown id, a place outside the list, a fraction and a word are refused', refused.every((r) => r.ok === false), JSON.stringify(refused))
  check('D: ...and nothing moved', JSON.stringify(await projects()) === '["Two","One"]')
} catch (error) {
  check('the suite ran to the end', false, error?.stack ?? String(error))
}
process.exit(check.summary() ? 0 : 1)
