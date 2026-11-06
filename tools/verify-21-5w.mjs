// Stage 21.5 (D-053), Search chats, in the real window against the mock: two saved chats; the search button beside the fold button and Ctrl+K open the
// dialog with the box ready; a word finds the chat that holds it (title, a piece of text, a date); a word in both: newest first; nothing: says so; Enter
// opens the first chat found and closes the dialog; Escape closes it and the next opening starts empty; the dialog in a narrow window. Screenshots in shots21.
// Needs: MOCK_PORT, USER_DATA_DIR (scratch) and setup-key.mjs.
import './ts-resolve.mjs'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { connect, checker, sleep } from './cdp.mjs'
import { assertScratchProfile } from './profile-guard.mjs'
import { helpers } from './lib3.mjs'

const shots = join(process.argv[2], '..', 'shots21')
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
const OPEN = `!!document.querySelector('dialog.search-chats')?.open`
const search = async (text) => {
  await ev(`(() => { const i = document.querySelector('.search-chats-input'); i.focus(); i.select(); return true })()`)
  await page.type(text)
  await sleep(900) // the search waits a quarter of a second after the last key, then main answers
}
const hits = () => ev(`[...document.querySelectorAll('dialog.search-chats .search-hit')].map((h) => ({ title: h.querySelector('.search-hit-title').textContent, snippet: h.querySelector('.search-hit-snippet')?.textContent ?? '', date: h.querySelector('.search-hit-date').textContent }))`)
const bodyText = () => ev(`document.querySelector('dialog.search-chats .search-chats-body').innerText`)
const newChat = async () => { await page.click('.sidebar-new'); await sleep(500) }

try {
  await page.waitFor(READY, { timeoutMs: 20000 })
  await H.askMock('Tell me about rainbows')
  await sleep(800)
  await newChat()
  await H.askMock('Explain inflation simply')
  await sleep(800)
  await newChat()

  // ============ A. opening it ============
  check('A: the sidebar has a search button beside the fold button, named and with Ctrl+K in its tooltip', (await ev(`(() => { const b = document.querySelector('.sidebar-head .sidebar-search'); return !!b && b.textContent.trim() === 'Search chats' && /Ctrl\\+K/.test(b.title) })()`)) === true)
  await page.click('.sidebar-search')
  await page.waitFor(OPEN, { timeoutMs: 4000 })
  check('A: it opens Search chats with the box ready and a line that says how it searches', (await ev(`document.activeElement?.classList.contains('search-chats-input')`)) && /Searched on this computer only/.test(await bodyText()))

  // ============ B. finding ============
  await search('rainbows')
  let h = await hits()
  check('B: a word finds the chat that holds it: its title, a piece of text around the word, a date', h.length === 1 && h[0].title === 'Tell me about rainbows' && /rainbows/i.test(h[0].snippet) && h[0].date.length >= 5, JSON.stringify(h))
  await search('echo')
  h = await hits()
  check('B: a word in both chats (the mock\'s replies begin "Echo"): both, the newest first', h.length === 2 && h[0].title === 'Explain inflation simply' && h[1].title === 'Tell me about rainbows', JSON.stringify(h))
  await search('echo inflation')
  check('B: every word must be in the chat', (await hits()).length === 1)
  await search('volcano')
  check('B: nothing found: it says so', (await hits()).length === 0 && /No chat holds all of that/.test(await bodyText()))
  await page.screenshot(join(shots, '21-5-search-none.png'))
  await search('rainbows')
  await page.screenshot(join(shots, '21-5-search.png'))
  await page.press('Enter')
  await sleep(800)
  check('B: Enter opens the first chat found and closes the dialog', !(await ev(OPEN)) && (await ev(`[...document.querySelectorAll('.message-user')].map((m) => m.innerText).join('|')`)).includes('Tell me about rainbows'))

  // ============ C. Ctrl+K, Escape, a fresh start ============
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', modifiers: 2, key: 'k', code: 'KeyK', windowsVirtualKeyCode: 75 })
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', modifiers: 2, key: 'k', code: 'KeyK', windowsVirtualKeyCode: 75 })
  await sleep(400)
  check('C: Ctrl+K opens it', await ev(OPEN))
  check('C: ...empty: the box clear, no hits from before', (await ev(`document.querySelector('.search-chats-input').value`)) === '' && (await hits()).length === 0)
  await search('inflation')
  await page.press('Escape'); await sleep(300)
  check('C: Escape in a box with text clears the text first (a search box\'s own way), the dialog stays', (await ev(OPEN)) && (await ev(`document.querySelector('.search-chats-input').value`)) === '')
  await page.press('Escape'); await sleep(300)
  check('C: a second Escape closes it', !(await ev(OPEN)))
  await page.click('.sidebar-search'); await page.waitFor(OPEN, { timeoutMs: 4000 })
  check('C: opened again, it starts empty', (await ev(`document.querySelector('.search-chats-input').value`)) === '' && (await hits()).length === 0)
  await page.press('Escape'); await sleep(300)

  // ============ D. a narrow window ============
  await page.send('Emulation.setDeviceMetricsOverride', { width: 420, height: 700, deviceScaleFactor: 1, mobile: false }); await sleep(400)
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', modifiers: 2, key: 'k', code: 'KeyK', windowsVirtualKeyCode: 75 })
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', modifiers: 2, key: 'k', code: 'KeyK', windowsVirtualKeyCode: 75 })
  await sleep(400)
  const box = await ev(`(() => { const d = document.querySelector('dialog.search-chats').getBoundingClientRect(); return { l: d.left, r: d.right, w: innerWidth, side: document.documentElement.scrollWidth - document.documentElement.clientWidth } })()`)
  check('D: at 420 px (the sidebar a rail: its search button hidden, Ctrl+K still works) the dialog fits, nothing scrolls sideways', (await ev(OPEN)) && box.l >= 0 && box.r <= box.w && box.side <= 0, JSON.stringify(box))
  await page.press('Escape'); await sleep(200)
  await page.send('Emulation.clearDeviceMetricsOverride'); await sleep(300)
} catch (error) {
  check('the suite ran to the end', false, error?.stack ?? String(error))
}
process.exit(check.summary() ? 0 : 1)
