// Stage 24 (D-056) in the real window against the mock, as a person sees it (no unfolding: connect's "plain"): the model inside the message box and
// Enter in its search sending nothing; the "+" menu (closed, opened above its button, a row opens its page, Escape closes it); a page that fills the
// chat area with the sidebar still in reach (a click on another row changes the page; a page with a text field in use stays); Settings in five panes
// with the long explanations folded away until "Show details". Screenshots in shots24.
// Needs: MOCK_PORT, USER_DATA_DIR (scratch) and setup-key.mjs.
import './ts-resolve.mjs'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { connect, checker, sleep } from './cdp.mjs'
import { assertScratchProfile } from './profile-guard.mjs'
import { helpers } from './lib3.mjs'

const shots = join(process.argv[2], '..', 'shots24')
mkdirSync(shots, { recursive: true })
const port = Number(process.argv[3] ?? 9222)
const mockUrl = `http://127.0.0.1:${process.env.MOCK_PORT}`
const userData = process.env.USER_DATA_DIR
if (!process.env.MOCK_PORT || !userData) throw new Error('MOCK_PORT and USER_DATA_DIR must be set')

const check = checker()
const page = await connect(port, { plain: true })
await assertScratchProfile()
const H = helpers(page, { userData, mockUrl })
const { ev } = H
const READY = `document.readyState === 'complete' && !!document.querySelector('.composer-input')`
const open = () => ev(`[...document.querySelectorAll('dialog')].filter((d) => d.open).map((d) => d.className.split(' ')[0])`)
const menuOpen = () => ev(`document.querySelector('.chat-menu').matches(':popover-open')`)
const shown = (selector) => ev(`[...document.querySelectorAll(${JSON.stringify(selector)})].filter((e) => e.getClientRects().length > 0).map((e) => e.textContent.trim())`)
const clickText = (scope, text) => ev(`(() => { const b = [...document.querySelectorAll(${JSON.stringify(scope)})].find((x) => x.textContent.trim() === ${JSON.stringify(text)}); if (!b) return false; b.click(); return true })()`)

try {
  await page.waitFor(READY, { timeoutMs: 20000 })
  await page.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false })
  await sleep(400)

  // ============ A. the model inside the box ============
  const place = await ev(`(() => { const b = document.querySelector('.composer-inner').getBoundingClientRect(); const m = document.querySelector('.header-select').getBoundingClientRect(); return { inside: m.left >= b.left && m.right <= b.right && m.top >= b.top && m.bottom <= b.bottom, inEnd: !!document.querySelector('.composer-end > .app-header-actions'), under: document.querySelectorAll('.composer-meta select, .composer-meta button').length } })()`)
  check('A: the model and its effort are inside the message box, before Send; under the box only the footnote is left', place.inside && place.inEnd && place.under === 0, JSON.stringify(place))
  await ev(`document.querySelector('.composer-input').focus()`)
  await page.type('a draft')
  const reqs = (await H.mockReqs()).length
  await page.click('.header-select'); await sleep(500)
  check('A: the model chooser opens, drawn outside the box\'s form', (await open()).includes('model-chooser') && (await ev(`document.querySelector('dialog.model-chooser').closest('form') === null`)))
  await ev(`document.querySelector('dialog.model-chooser input').focus()`)
  await page.type('opus')
  await page.press('Enter'); await sleep(700)
  check('A: Enter in the chooser\'s search sends nothing: no request, no message, the draft still in the box', (await H.mockReqs()).length === reqs && (await ev(`document.querySelectorAll('.message').length`)) === 0 && (await ev(`document.querySelector('.composer-input').value`)) === 'a draft')
  for (let i = 0; i < 2 && (await open()).includes('model-chooser'); i++) { await page.press('Escape'); await sleep(300) } // the first Escape clears the search text

  // ============ B. the "+" menu ============
  check('B: the box has a "+" button, named; its menu is closed and none of its rows is drawn', (await ev(`document.querySelector('.chat-plus')?.getAttribute('aria-label') ?? document.querySelector('.chat-plus')?.textContent.trim()`)) !== '' && !(await menuOpen()) && (await shown('.chat-menu .chat-button')).length === 0, JSON.stringify(await shown('.chat-menu .chat-button')))
  await page.click('.chat-plus'); await sleep(400)
  const rows = await shown('.chat-menu .chat-button')
  check('B: a click opens it: Attach..., Instructions, Memory, Project, with their words (pictures are off: no "Make an image...")', (await menuOpen()) && JSON.stringify(rows) === JSON.stringify(['Attach...', 'Instructions', 'Memory', 'Project']), JSON.stringify(rows))
  const where = await ev(`(() => { const m = document.querySelector('.chat-menu').getBoundingClientRect(); const p = document.querySelector('.chat-plus').getBoundingClientRect(); return { above: m.bottom <= p.top, left: Math.abs(m.left - p.left) < 2, inWindow: m.top >= 0 && m.right <= innerWidth } })()`)
  check('B: it is drawn right above the "+", from its left edge, inside the window', where.above && where.left && where.inWindow, JSON.stringify(where))
  await page.screenshot(join(shots, '24-plus.png'))
  await page.press('Escape'); await sleep(300)
  check('B: Escape closes the menu and nothing else', !(await menuOpen()) && (await open()).length === 0)
  await page.click('.chat-plus'); await sleep(300)
  await page.click('.chat-menu .chat-button@Instructions'); await sleep(500)
  check('B: a row opens its page and the menu closes', (await open()).includes('instructions') && !(await menuOpen()), JSON.stringify(await open()))
  await page.press('Escape'); await sleep(400)

  // ============ C. a page fills the chat area; the sidebar stays in reach ============
  await page.click('.sidebar-library'); await sleep(500)
  const fill = await ev(`(() => { const d = document.querySelector('dialog.library').getBoundingClientRect(); const s = document.querySelector('.sidebar').getBoundingClientRect(); return { left: Math.abs(d.left - s.right) < 1.5, top: d.top, right: Math.abs(d.right - innerWidth) < 1, bottom: Math.abs(d.bottom - innerHeight) < 1, current: document.querySelector('.sidebar-library').getAttribute('aria-current') } })()`)
  check('C: the Library fills the chat area from the sidebar\'s edge to the window\'s, and its row in the sidebar is marked as the page shown', (await open()).includes('library') && fill.left && fill.top === 0 && fill.right && fill.bottom && fill.current === 'page', JSON.stringify(fill))
  await page.screenshot(join(shots, '24-library.png'))
  await page.click('.sidebar-experts'); await sleep(600)
  check('C: a click on another row of the sidebar closes the page and opens that one', JSON.stringify(await open()) === '["experts"]' && (await ev(`document.querySelector('.sidebar-experts').getAttribute('aria-current') === 'page' && document.querySelector('.sidebar-library').getAttribute('aria-current') === null`)), JSON.stringify(await open()))
  await page.click('.sidebar-studio'); await sleep(600)
  await page.click('dialog.studio textarea'); await sleep(200)
  await page.type('a red kite')
  await page.click('.sidebar-library'); await sleep(600)
  check('C: a page with a text field in use stays (the words are not lost to a stray click)', JSON.stringify(await open()) === '["studio"]' && (await ev(`document.querySelector('dialog.studio textarea').value`)) === 'a red kite', JSON.stringify(await open()))
  await page.press('Escape'); await sleep(400)

  // ============ D. Settings: five panes, the details folded ============
  await clickText('.sidebar button', 'Settings'); await sleep(500)
  const nav = await shown('.settings-nav-item')
  check('D: Settings has five panes and a "Show details" switch', JSON.stringify(nav) === JSON.stringify(['Keys and model', 'Usage and limits', 'Voice and images', 'Saved chats', 'General', 'Show details']), JSON.stringify(nav))
  const panes = () => ev(`({ shown: [...document.querySelectorAll('.settings-pane')].filter((p) => !p.hidden).length, all: document.querySelectorAll('.settings-pane').length, current: [...document.querySelectorAll('.settings-nav-item[aria-current="page"]')].map((b) => b.textContent.trim()), more: [...document.querySelectorAll('.settings .settings-more')].filter((e) => e.getClientRects().length > 0).length, moreAll: document.querySelectorAll('.settings .settings-more').length, headings: [...document.querySelectorAll('.settings h3')].filter((e) => e.getClientRects().length > 0).map((e) => e.textContent.trim()) })`)
  const p0 = await panes()
  check('D: it opens on the keys: one pane of five drawn, marked in the list; none of the long explanations is drawn', p0.shown === 1 && p0.all === 5 && JSON.stringify(p0.current) === '["Keys and model"]' && p0.more === 0 && p0.moreAll > 0 && p0.headings.includes('Anthropic API key') && !p0.headings.includes('Appearance'), JSON.stringify(p0))
  await page.screenshot(join(shots, '24-settings.png'))
  await page.click('.settings-nav-item@General'); await sleep(300)
  const p1 = await panes()
  check('D: "General" shows Appearance and Updates and nothing of the keys', p1.shown === 1 && JSON.stringify(p1.current) === '["General"]' && p1.headings.includes('Appearance') && !p1.headings.includes('Anthropic API key'), JSON.stringify(p1))
  await page.click('.settings-nav-item@Show details'); await sleep(300)
  const p2 = await panes()
  check('D: "Show details" draws the pane\'s explanations and says it is on ("Hide details", pressed)', p2.more > 0 && (await ev(`(() => { const b = document.querySelector('.settings-details-toggle'); return b.textContent.trim() === 'Hide details' && b.getAttribute('aria-pressed') === 'true' })()`)), JSON.stringify(p2))
  await page.press('Escape'); await sleep(400)
  await clickText('.sidebar button', 'Settings'); await sleep(500)
  check('D: closed and opened again, Settings is back on the keys', JSON.stringify((await panes()).current) === '["Keys and model"]')
  await page.press('Escape'); await sleep(300)

  await page.send('Emulation.clearDeviceMetricsOverride')
  check('no console errors / warnings / exceptions', page.problems.length === 0, page.problems.join(' | ').slice(0, 1500))
} catch (error) {
  check(`the run did not stop: ${error?.stack ?? error}`, false, page.problems.join(' | ').slice(0, 1500))
}
const ok = check.summary()
page.close()
process.exit(ok ? 0 : 1)
