// Stage 23.1 (D-055), names, pins and days in the sidebar, in the real window against the mock: the chats under "Today"; a first message in Markdown
// titled without its marks; the "..." button hidden until hover or focus (shown for the chat on screen); its menu (focus on the first item, the arrows,
// Escape back to the button); Rename (Enter keeps, Escape keeps the old name, empty goes back to the first message, the header follows, kept in
// chat-names.json and across a reload, found by Search); Pin and Unpin (the Pinned group on top); Delete that asks in the row (Cancel keeps, Delete
// removes the chat and its mark); 420 px. Screenshots in shots23.
// Needs: MOCK_PORT, USER_DATA_DIR (scratch) and setup-key.mjs.
import './ts-resolve.mjs'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { connect, checker, sleep } from './cdp.mjs'
import { assertScratchProfile } from './profile-guard.mjs'
import { helpers } from './lib3.mjs'

const shots = join(process.argv[2], '..', 'shots23')
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
const READY = `document.readyState === 'complete' && !!document.querySelector('.composer-input')`
const namesFile = join(userData, 'chat-names.json')
const marks = () => (existsSync(namesFile) ? JSON.parse(readFileSync(namesFile, 'utf8')).chats : null)
// The sidebar as groups of titles: ["Today: A | B", ...]
const groups = () => ev(`[...document.querySelectorAll('.sidebar-group')].map((g) => g.querySelector('.sidebar-group-heading').textContent + ': ' + [...g.querySelectorAll('.sidebar-chat-title')].map((t) => t.textContent).join(' | '))`)
const rowIndex = (title) => `[...document.querySelectorAll('.sidebar-chat-row')].findIndex((r) => r.querySelector('.sidebar-chat-title')?.textContent === ${JSON.stringify(title)})`
const moreOf = (title) => `document.querySelectorAll('.sidebar-chat-row')[${rowIndex(title)}]?.querySelector('.sidebar-chat-more')`
const clickMore = async (title) => {
  const box = await ev(`(() => { const b = ${moreOf(title)}; if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })()`)
  if (!box) throw new Error(`no "..." for ${title}`)
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y })
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', clickCount: 1 })
  await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x, y: box.y, button: 'left', clickCount: 1 })
  await sleep(250)
}
const MENU_OPEN = `!!document.querySelector('.sidebar-chat-menu')`
const opacityOf = (title) => ev(`getComputedStyle(${moreOf(title)}).opacity`)
const headerTitle = () => ev(`document.querySelector('.chat-title')?.textContent ?? null`)
const newChat = async () => { await page.click('.sidebar-new'); await sleep(500) }

try {
  await page.waitFor(READY, { timeoutMs: 20000 })
  await H.askMock('**Rainbows** and `light`')
  await sleep(800)
  await newChat()
  await H.askMock('Explain inflation simply')
  await sleep(800)

  // ============ A. groups and plain titles ============
  check('A: both chats sit under "Today", newest first', JSON.stringify(await groups()) === JSON.stringify(['Today: Explain inflation simply | Rainbows and light']), JSON.stringify(await groups()))
  check('A: a first message in Markdown is titled without its marks', (await ev(`[...document.querySelectorAll('.sidebar-chat-title')].map((t) => t.textContent)`)).includes('Rainbows and light'))
  check('A: the "Recent" heading is kept for screen readers only', await ev(`(() => { const h = document.getElementById('sidebar-recent-heading'); return h.textContent.trim() === 'Recent' && h.classList.contains('visually-hidden') })()`))
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 900, y: 400 })
  await sleep(200)
  check('A: the "..." of a chat not on screen is hidden until hover; the one on screen is shown', (await opacityOf('Rainbows and light')) === '0' && (await opacityOf('Explain inflation simply')) === '1')
  check('A: each "..." is named for screen readers and says it opens a menu', await ev(`(() => { const b = ${moreOf('Rainbows and light')}; return b.getAttribute('aria-haspopup') === 'menu' && b.getAttribute('aria-expanded') === 'false' && /More for "Rainbows and light"/.test(b.getAttribute('aria-label')) })()`))

  // ============ B. the menu ============
  await clickMore('Rainbows and light')
  check('B: a click opens the menu: Rename, Pin, Delete, the first one focused', (await ev(MENU_OPEN)) && JSON.stringify(await ev(`[...document.querySelectorAll('.sidebar-chat-menu [role=menuitem]')].map((b) => b.textContent)`)) === '["Rename","Pin","Delete"]' && (await ev(`document.activeElement?.textContent`)) === 'Rename')
  check('B: the "..." says the menu is open', (await ev(`${moreOf('Rainbows and light')}.getAttribute('aria-expanded')`)) === 'true')
  await page.screenshot(join(shots, '23-1-menu.png'))
  await page.press('ArrowDown')
  check('B: ArrowDown moves to Pin', (await ev(`document.activeElement?.textContent`)) === 'Pin')
  await page.press('ArrowUp'); await page.press('ArrowUp')
  check('B: ArrowUp from the first goes round to the last', (await ev(`document.activeElement?.textContent`)) === 'Delete')
  await page.press('Escape'); await sleep(200)
  check('B: Escape closes it and puts the keyboard back on the "..."', !(await ev(MENU_OPEN)) && (await ev(`document.activeElement === ${moreOf('Rainbows and light')}`)))
  await clickMore('Rainbows and light')
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 900, y: 300, button: 'left', clickCount: 1 })
  await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 900, y: 300, button: 'left', clickCount: 1 })
  await sleep(200)
  check('B: a click elsewhere closes it', !(await ev(MENU_OPEN)))

  // ============ C. Rename ============
  await clickMore('Rainbows and light')
  await page.click('.sidebar-chat-menu-item@Rename'); await sleep(200)
  check('C: Rename puts a box in the row with the title, all selected', (await ev(`(() => { const i = document.querySelector('.sidebar-chat-rename'); return !!i && document.activeElement === i && i.value === 'Rainbows and light' && i.selectionStart === 0 && i.selectionEnd === i.value.length })()`)))
  await page.type('Light and colour')
  await page.press('Escape'); await sleep(300)
  check('C: Escape keeps the old name and writes nothing', (await ev(rowIndex('Rainbows and light'))) >= 0 && marks() === null)
  await clickMore('Rainbows and light')
  await page.click('.sidebar-chat-menu-item@Rename'); await sleep(200)
  await page.type('  Light   and colour ')
  await page.press('Enter'); await sleep(800)
  const named = marks()
  check('C: Enter keeps the new name, on one line and trimmed, in chat-names.json', (await ev(rowIndex('Light and colour'))) >= 0 && named !== null && Object.values(named).some((m) => m.title === 'Light and colour'), JSON.stringify(named))
  check('C: the keyboard goes back to the row\'s "..."', await ev(`document.activeElement === ${moreOf('Light and colour')}`))
  await page.click('.sidebar-chat@Light and colour'); await sleep(600)
  check('C: the header shows the name of the chat on screen', (await headerTitle()) === 'Light and colour', await headerTitle())
  await ev(`location.reload()`); await sleep(500)
  await page.waitFor(READY, { timeoutMs: 20000 }); await sleep(800)
  check('C: the name is still there after a reload', (await ev(rowIndex('Light and colour'))) >= 0)
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', modifiers: 2, key: 'k', code: 'KeyK', windowsVirtualKeyCode: 75 })
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', modifiers: 2, key: 'k', code: 'KeyK', windowsVirtualKeyCode: 75 })
  await sleep(400)
  await ev(`(() => { const i = document.querySelector('.search-chats-input'); i.focus(); return true })()`)
  await page.type('colour'); await sleep(900)
  check('C: Search finds a chat by its new name', (await ev(`[...document.querySelectorAll('dialog.search-chats .search-hit-title')].map((t) => t.textContent)`)).includes('Light and colour'))
  await page.press('Escape'); await page.press('Escape'); await sleep(300)
  await clickMore('Light and colour')
  await page.click('.sidebar-chat-menu-item@Rename'); await sleep(200)
  await ev(`(() => { const i = document.querySelector('.sidebar-chat-rename'); i.select(); return true })()`)
  await page.press('Enter'); await sleep(200) // nothing typed over the selection: the old name stays
  check('C: Enter without a change writes nothing new', JSON.stringify(marks()) === JSON.stringify(named))
  await clickMore('Light and colour')
  await page.click('.sidebar-chat-menu-item@Rename'); await sleep(200)
  await ev(`(() => { const i = document.querySelector('.sidebar-chat-rename'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, ''); i.dispatchEvent(new Event('input', { bubbles: true })); return true })()`)
  await page.press('Enter'); await sleep(800)
  check('C: an empty name goes back to the first message, and the mark is gone', (await ev(rowIndex('Rainbows and light'))) >= 0 && JSON.stringify(marks()) === '{}', JSON.stringify(marks()))

  // ============ D. Pin ============
  await clickMore('Rainbows and light')
  await page.click('.sidebar-chat-menu-item@Pin'); await sleep(800)
  check('D: Pin puts the chat in a "Pinned" group on top, with a pin mark', JSON.stringify(await groups()) === JSON.stringify(['Pinned: Rainbows and light', 'Today: Explain inflation simply']) && (await ev(`!!document.querySelectorAll('.sidebar-chat-row')[${rowIndex('Rainbows and light')}].querySelector('.sidebar-chat-pin .icon')`)), JSON.stringify(await groups()))
  check('D: a screen reader hears "Pinned:" before the title', /^Pinned:\s*Rainbows and light$/.test(await ev(`document.querySelectorAll('.sidebar-chat')[${rowIndex('Rainbows and light')}].textContent`)))
  check('D: the pin is in chat-names.json', Object.values(marks() ?? {}).some((m) => m.pinned === true))
  await page.screenshot(join(shots, '23-1-pinned.png'))
  await clickMore('Rainbows and light')
  check('D: the menu now offers Unpin', (await ev(`[...document.querySelectorAll('.sidebar-chat-menu [role=menuitem]')].map((b) => b.textContent).join(',')`)) === 'Rename,Unpin,Delete')
  await page.click('.sidebar-chat-menu-item@Unpin'); await sleep(800)
  check('D: Unpin puts it back under its day', JSON.stringify(await groups()) === JSON.stringify(['Today: Explain inflation simply | Rainbows and light']))

  // ============ E. Delete ============
  await clickMore('Rainbows and light')
  await page.click('.sidebar-chat-menu-item@Rename'); await sleep(200)
  await page.type('Doomed'); await page.press('Enter'); await sleep(800)
  await clickMore('Doomed')
  await page.click('.sidebar-chat-menu-item@Delete'); await sleep(300)
  check('E: Delete asks in the row, with Cancel focused', (await ev(`!!document.querySelector('.sidebar-chat-ask')`)) && (await ev(`document.activeElement?.textContent`)) === 'Cancel')
  await page.screenshot(join(shots, '23-1-delete.png'))
  await page.press('Enter'); await sleep(300)
  check('E: Cancel keeps the chat', (await ev(rowIndex('Doomed'))) >= 0 && !(await ev(`!!document.querySelector('.sidebar-chat-ask')`)))
  await clickMore('Doomed')
  await page.click('.sidebar-chat-menu-item@Delete'); await sleep(300)
  await page.click('.sidebar-chat-ask-yes'); await sleep(1000)
  check('E: Delete removes the chat from the list', (await ev(rowIndex('Doomed'))) === -1 && JSON.stringify(await groups()) === JSON.stringify(['Today: Explain inflation simply']))
  check('E: ...and its name from chat-names.json', JSON.stringify(marks()) === '{}', JSON.stringify(marks()))
  const saved = await ev(`window.api.history.list().then((l) => l.conversations.map((c) => c.title))`)
  check('E: ...and from the saved chats', JSON.stringify(saved) === '["Explain inflation simply"]', JSON.stringify(saved))

  // ============ F. what the page may ask ============
  const refused = await ev(`Promise.all([window.api.history.rename('00000000-0000-4000-8000-0000000000ff', 'x'), window.api.history.pin('nope', true), window.api.history.rename(${JSON.stringify((await ev(`window.api.history.list().then((l) => l.conversations[0].id)`)))}, 'a\\u202Eb')])`)
  check('F: a chat that is not saved, an id that is not one, and a name with a direction override are all refused', refused.every((r) => r.ok === false), JSON.stringify(refused))

  // ============ G. narrow ============
  await page.send('Emulation.setDeviceMetricsOverride', { width: 420, height: 700, deviceScaleFactor: 1, mobile: false }); await sleep(400)
  check('G: at 420 px (the sidebar a rail) the chat list is hidden and nothing scrolls sideways', await ev(`getComputedStyle(document.querySelector('.sidebar-recent')).display === 'none' && document.documentElement.scrollWidth <= document.documentElement.clientWidth`))
  await page.send('Emulation.clearDeviceMetricsOverride'); await sleep(300)
} catch (error) {
  check('the suite ran to the end', false, error?.stack ?? String(error))
}
process.exit(check.summary() ? 0 : 1)
