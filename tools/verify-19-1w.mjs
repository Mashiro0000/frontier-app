// Stage 19 (D-051), the new look, in the real window against the mock: the sidebar (New chat, History, Tools, the saved chats newest first,
// Settings and the theme), the header beside it (the chat's title and the three menus), the message box with the chat's own buttons inside
// it, the theme (dark unless the person picks light; kept on this computer), the sidebar folded to a rail (kept too; always a rail in a narrow
// window), narrow windows, the contrast of every colour pair the page uses, and the keyboard order. Screenshots of each state go to the shots
// folder. Needs: MOCK_PORT, USER_DATA_DIR (scratch) and a saved key (setup-key.mjs).
import './ts-resolve.mjs'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { connect, checker, sleep } from './cdp.mjs'
import { assertScratchProfile } from './profile-guard.mjs'
import { helpers } from './lib3.mjs'

// The pictures of the look are the point of this suite, so they go beside the shots folder, which a guarded window run does not keep.
const shots = join(process.argv[2], '..', 'shots19')
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
const SEND_READY = `!!document.querySelector('.composer-button[type=submit]')`
const READY = `document.readyState === 'complete' && !!document.querySelector('.header-select, .app-badge') && !!document.querySelector('.chat-bar')`

// ---- what the page looks like ----
const box = (s) => ev(`(() => { const e = document.querySelector(${JSON.stringify(s)}); if (!e) return null; const b = e.getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom, w: b.width, h: b.height } })()`)
const theme = () => ev(`document.documentElement.dataset.theme ?? null`)
const stored = () => ev(`({ theme: localStorage.getItem('frontier.theme'), sidebar: localStorage.getItem('frontier.sidebar') })`)
const pageBackground = () => ev(`getComputedStyle(document.body).backgroundColor`)
const metrics = async (width, height = 634) => { await page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false }); await sleep(350) }
const clearMetrics = async () => { await page.send('Emulation.clearDeviceMetricsOverride'); await sleep(350) }
const dialogOpen = (cls) => ev(`document.querySelector('dialog.${cls}')?.open === true`)
const visible = (s) => ev(`(() => { const e = document.querySelector(${JSON.stringify(s)}); if (!e) return false; const b = e.getBoundingClientRect(); return b.width > 2 && b.height > 2 && getComputedStyle(e).visibility !== 'hidden' })()`)
const sidebarButtons = () => ev(`[...document.querySelectorAll('.sidebar button')].map((b) => ({ text: b.textContent.trim(), cls: b.className, disabled: b.disabled, title: b.title }))`)
const recent = () => ev(`[...document.querySelectorAll('.sidebar-chat')].map((b) => ({ text: b.textContent, current: b.getAttribute('aria-current') === 'true', disabled: b.disabled, title: b.title }))`)
const chatTitle = () => ev(`document.querySelector('.chat-title')?.textContent ?? null`)
/** The header as one row: its height, how far apart the vertical centres of its controls are, and that each is inside the window. */
const headerShape = () => ev(`(() => {
  const kids = [...document.querySelectorAll('.app-header .chat-title, .app-header-actions > *')].filter((e) => e.getBoundingClientRect().width > 0)
  const boxes = kids.map((e) => { const b = e.getBoundingClientRect(); return { l: b.left, r: b.right, c: (b.top + b.bottom) / 2 } })
  const cs = boxes.map((b) => b.c)
  return { h: document.querySelector('.app-header').getBoundingClientRect().height, spread: Math.max(...cs) - Math.min(...cs), inside: boxes.every((b) => b.l >= 0 && b.r <= innerWidth + 0.5), overflowX: document.documentElement.scrollWidth > innerWidth }
})()`)
const oneRow = (s) => s.h < 64 && s.spread <= 4 && s.inside && !s.overflowX

// The contrast of two colours of the page's own palette, read from its variables (WCAG 2 relative luminance).
const CONTRAST = `(() => {
  const css = getComputedStyle(document.documentElement)
  const rgb = (name) => { const v = css.getPropertyValue(name).trim(); const h = v.replace('#', ''); if (!/^[0-9a-f]{6}$/i.test(h)) return null; return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) }
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]) }
  const ratio = (a, b) => { const x = rgb(a), y = rgb(b); if (!x || !y) return null; const p = lum(x), q = lum(y); return Math.round(((Math.max(p, q) + 0.05) / (Math.min(p, q) + 0.05)) * 100) / 100 }
  return ratio
})()`
const PAIRS = [
  // text that must be read: 4.5:1
  ['--color-text', '--color-background', 4.5], ['--color-text', '--color-background-soft', 4.5], ['--color-text', '--color-sidebar', 4.5],
  ['--color-text', '--color-user-bubble', 4.5], ['--color-text', '--color-background-mute', 4.5],
  ['--color-text-muted', '--color-background', 4.5], ['--color-text-muted', '--color-background-soft', 4.5], ['--color-text-muted', '--color-sidebar', 4.5],
  ['--color-text-muted', '--color-sidebar-active', 4.5], ['--color-text-muted', '--color-background-mute', 4.5],
  ['--color-accent-text', '--color-background', 4.5], ['--color-accent-text', '--color-background-soft', 4.5],
  ['--color-danger', '--color-background', 4.5], ['--color-danger', '--color-background-soft', 4.5],
  ['--color-warning-text', '--color-background', 4.5], ['--color-on-accent', '--color-accent', 4.5],
  // the edge of a control: 3:1
  ['--color-input-border', '--color-background', 3], ['--color-input-border', '--color-background-soft', 3], ['--color-focus', '--color-background-soft', 3]
]
const contrastFails = () => ev(`(() => { const ratio = ${CONTRAST}; return ${JSON.stringify(PAIRS)}.map(([a, b, min]) => ({ a, b, min, r: ratio(a, b) })).filter((p) => p.r === null || p.r < p.min) })()`)

try {
  await page.waitFor(READY, { timeoutMs: 20000 })
  await sleep(500)

  // ============ A. the default window: dark, the sidebar open ============
  check('A: a fresh profile starts dark: the page says data-theme="dark" and its background is the dark one', (await theme()) === 'dark' && (await pageBackground()) === 'rgb(33, 33, 33)', `${await theme()} ${await pageBackground()}`)
  check('A: nothing is kept until the person chooses (no theme or sidebar value in the page storage)', JSON.stringify(await stored()) === JSON.stringify({ theme: null, sidebar: null }), JSON.stringify(await stored()))
  const S = await box('.sidebar')
  const M = await box('.app-main')
  const vw = await ev('innerWidth')
  check('A: the sidebar is at the left, 260 px wide (D-052) and as tall as the window; the chat area takes the rest', S && S.l === 0 && Math.abs(S.w - 260) < 1 && Math.abs(M.l - S.r) < 1 && Math.abs(M.r - vw) < 1, JSON.stringify({ S, M, vw }))
  const sb = await sidebarButtons()
  const named = (t) => sb.find((b) => b.text === t)
  check('A: the sidebar holds New chat, History, Tools, Settings and the theme button, each with its name', ['New chat', 'History', 'Tools', 'Settings', 'Switch to the light theme'].every((t) => named(t)) && sb.every((b) => b.text !== ''), JSON.stringify(sb.map((b) => b.text)))
  check('A: the app\'s name is the page\'s heading, at the top of the sidebar', (await ev(`document.querySelector('.sidebar h1.app-title')?.textContent`)) === 'Frontier App')
  check('A: Settings keeps the name the checks know it by (.header-button)', (await ev(`[...document.querySelectorAll('.header-button')].map((b) => b.textContent.trim())`)).join() === 'Settings')
  check('A: an empty chat: New chat is off and says "This chat is empty."', named('New chat').disabled && named('New chat').title === 'This chat is empty.', JSON.stringify(named('New chat')))
  check('A: the list of saved chats says there are none yet', (await ev(`document.querySelector('.sidebar-none')?.textContent ?? null`)) === 'Your chats appear here once you send a message.')
  const head = await headerShape()
  const actions = await ev(`[...document.querySelectorAll('.app-header-actions > *')].map((e) => e.className.split(' ')[0])`)
  check('A: the header beside the sidebar is ONE row: the Task, model and Effort menus (and the "No API key" badge while no key is saved)', oneRow(head) && JSON.stringify(actions.filter((c) => c !== 'app-badge')) === JSON.stringify(['task-select', 'header-select', 'effort-select']), JSON.stringify({ head, actions }))
  check('A: at the default window the chat\'s title ("New chat") gives its room to the menus: it is not shown', (await chatTitle()) === 'New chat' && !(await visible('.chat-title')))
  await metrics(1200, 700)
  const wide = await headerShape()
  // (D-052) The title moved to the middle, after the menus (verify-20-1w checks where).
  check('A: in a wider window the title is shown after the menus, still ONE row', (await visible('.chat-title')) && oneRow(wide) && (await box('.chat-title')).l > (await box('.effort-select')).r, JSON.stringify(wide))
  await page.screenshot(`${shots}/19-dark-wide.png`)
  await clearMetrics()
  check('A: the header has no button any more (Settings is at the foot of the sidebar)', (await ev(`document.querySelectorAll('.app-header button').length`)) === 0)
  const inner = await box('.composer-inner')
  const bar = await ev(`(() => { const b = document.querySelector('.chat-bar'); return { inBox: !!b?.closest('.composer-inner'), role: b?.getAttribute('role'), label: b?.getAttribute('aria-label'), texts: [...b.querySelectorAll('.chat-button')].map((e) => e.textContent) } })()`)
  check('A: the chat\'s own buttons are a named group INSIDE the message box: Attach..., Instructions, Memory, Project (Make an image only while it is on)', bar.inBox && bar.role === 'group' && bar.label === 'This chat' && JSON.stringify(bar.texts) === JSON.stringify(['Attach...', 'Instructions', 'Memory', 'Project']), JSON.stringify(bar))
  const send = await ev(`(() => { const s = document.querySelector('.composer-button[type=submit]'); return { text: s.textContent, inBox: !!s.closest('.composer-inner'), disabled: s.disabled } })()`)
  check('A: Send is in the box too, named "Send" (an arrow on screen), and off while the box is empty', send.text === 'Send' && send.inBox && send.disabled, JSON.stringify(send))
  check('A: the message box sits at the bottom of the window, inside the chat area, and the page does not scroll', inner && inner.b <= (await ev('innerHeight')) - 8 && inner.l >= M.l && !(await ev(`document.documentElement.scrollHeight > innerHeight || document.documentElement.scrollWidth > innerWidth`)), JSON.stringify(inner))
  check('A: an empty chat shows the app\'s mark, a greeting and the first-step hint under it', (await visible('.empty-logo')) && (await ev(`document.querySelector('.empty-heading')?.textContent`)) === 'What are we working on?' && (await ev(`!!document.querySelector('.empty .empty-state')`)))
  const fails = await contrastFails()
  check('A: dark: every colour pair the page uses is readable (text 4.5:1, the edge of a control 3:1)', fails.length === 0, JSON.stringify(fails))
  await page.screenshot(`${shots}/19-dark-empty.png`)

  // ============ B. a chat: the saved chats in the sidebar, the title in the header ============
  const first = await H.askMock('[[mock:say]] Here is a **short** answer with `code`:\n\n```python\nprint("hello")\n```\n\n- one\n- two')
  check('B: a message goes and its reply comes back', first !== null)
  await page.waitFor(`document.querySelectorAll('.sidebar-chat').length === 1`, { timeoutMs: 6000, label: 'the chat in the sidebar' })
  let r = await recent()
  check('B: once sent, the chat is listed in the sidebar, marked as the one on screen, and its title is the header\'s', r.length === 1 && r[0].current && (await chatTitle()) === r[0].text, JSON.stringify({ r, title: await chatTitle() }))
  check('B: New chat is on and says the chat stays in History', (await sidebarButtons()).find((b) => b.text === 'New chat').title === 'Start a new chat. This one stays saved in History.')
  await page.screenshot(`${shots}/19-dark-chat.png`)
  await page.click('.chat-button@New chat')
  await page.waitFor(`document.querySelectorAll('.message-list-inner > .message').length === 0`, { timeoutMs: 6000 })
  await H.askMock('a second chat')
  await page.waitFor(`document.querySelectorAll('.sidebar-chat').length === 2`, { timeoutMs: 6000, label: 'two chats in the sidebar' })
  r = await recent()
  check('B: a second chat is listed first (newest first) and is the one marked', r.length === 2 && r[0].current && !r[1].current && r[0].text === (await chatTitle()), JSON.stringify(r))
  await H.send('[[mock:slow]] busy')
  await page.waitFor(`!!document.querySelector('.composer-button-stop')`, { timeoutMs: 8000 })
  await sleep(300)
  r = await recent()
  const busy = await sidebarButtons()
  check('B: while a reply arrives the saved chats, New chat, History and Tools are off, each saying when they come back; Settings and the theme stay on', r.every((c) => c.disabled && c.title === 'Another chat can be opened when the reply has finished.') && ['New chat', 'History', 'Tools'].every((t) => busy.find((b) => b.text === t).disabled) && busy.find((b) => b.text === 'History').title === 'History can be opened when the reply has finished.' && !busy.find((b) => b.text === 'Settings').disabled, JSON.stringify({ r, busy }))
  const stop = await ev(`(() => { const s = document.querySelector('.composer-button-stop'); return { text: s.textContent, inBox: !!s.closest('.composer-inner') } })()`)
  check('B: the Stop button is named on screen ("Stop"), in the box', stop.text === 'Stop' && stop.inBox, JSON.stringify(stop))
  await page.click('.composer-button-stop')
  await page.waitFor(SEND_READY, { timeoutMs: 15000 })
  await sleep(300)
  await page.click('.sidebar-chat:not([aria-current])')
  await page.waitFor(`document.querySelector('.sidebar-chat[aria-current]')?.textContent === ${JSON.stringify(r[1].text)}`, { timeoutMs: 6000, label: 'the older chat to open' })
  await sleep(300)
  check('B: a click on the older chat opens it: its messages are back, it is marked, and the header names it', (await ev(`document.querySelectorAll('.message-list-inner > .message').length`)) === 2 && (await chatTitle()) === r[1].text && (await ev(`!!document.querySelector('.md-codeblock')`)), JSON.stringify(await recent()))

  // ============ C. the theme: light, kept, and back ============
  await page.click('.header-button@Settings')
  await page.waitFor(`!!document.querySelector('dialog.settings')?.open`, { timeoutMs: 6000 })
  const look = await ev(`(() => { const s = document.querySelector('#settings-appearance-heading')?.closest('section'); return s ? [...s.querySelectorAll('.theme-option')].map((b) => ({ text: b.textContent, pressed: b.getAttribute('aria-pressed') })) : null })()`)
  check('C: Settings has an Appearance section: Dark (pressed) and Light', JSON.stringify(look) === JSON.stringify([{ text: 'Dark', pressed: 'true' }, { text: 'Light', pressed: 'false' }]), JSON.stringify(look))
  await ev(`document.querySelector('#settings-appearance-heading').scrollIntoView({ block: 'center' })`)
  await sleep(200)
  await page.screenshot(`${shots}/19-dark-settings.png`)
  await page.click('.theme-option@Light')
  await sleep(300)
  check('C: Light turns the whole page light at once and is kept on this computer', (await theme()) === 'light' && (await pageBackground()) === 'rgb(255, 255, 255)' && (await stored()).theme === 'light', `${await theme()} ${await pageBackground()} ${JSON.stringify(await stored())}`)
  await page.screenshot(`${shots}/19-light-settings.png`)
  await page.press('Escape')
  await sleep(250)
  const lightFails = await contrastFails()
  check('C: light: every colour pair the page uses is readable (text 4.5:1, the edge of a control 3:1)', lightFails.length === 0, JSON.stringify(lightFails))
  check('C: the sidebar\'s theme button now offers the dark theme', (await sidebarButtons()).some((b) => b.text === 'Switch to the dark theme'))
  await page.screenshot(`${shots}/19-light-chat.png`)
  await page.click('.chat-button@History')
  await page.waitFor(`document.querySelector('dialog.history')?.open === true`, { timeoutMs: 6000 })
  await page.screenshot(`${shots}/19-light-history.png`)
  await page.press('Escape')
  await sleep(250)
  await page.send('Page.reload')
  await sleep(600)
  await page.waitFor(READY, { timeoutMs: 20000 })
  check('C: after a reload the window is still light', (await theme()) === 'light')
  await page.click('.icon-button.theme-button')
  await sleep(250)
  check('C: the sidebar\'s button turns it dark again, and that is kept', (await theme()) === 'dark' && (await stored()).theme === 'dark')

  // ============ D. the rail: icons only, kept ============
  await page.click('.sidebar-toggle')
  await sleep(450)
  const rail = await box('.sidebar')
  const railState = await ev(`({ cls: document.querySelector('.app').className, expanded: document.querySelector('.sidebar-toggle').getAttribute('aria-expanded'), recent: getComputedStyle(document.querySelector('.sidebar-recent')).display, label: document.querySelector('.sidebar-new .sidebar-label').getBoundingClientRect().width })`)
  check('D: the toggle folds the sidebar to a 60 px rail: no list of chats, the labels hidden (still the buttons\' names), and it says so (aria-expanded false)', Math.abs(rail.w - 60) < 1 && railState.cls.includes('app-rail') && railState.expanded === 'false' && railState.recent === 'none' && railState.label <= 1 && (await stored()).sidebar === 'rail', JSON.stringify({ rail, railState }))
  check('D: in the rail every button is still there, inside it, with its name and a tooltip', (await ev(`[...document.querySelectorAll('.sidebar button')].filter((b) => getComputedStyle(b).display !== 'none' && !b.closest('.sidebar-recent')).every((b) => { const r = b.getBoundingClientRect(); return r.left >= 0 && r.right <= 60.5 && r.width >= 30 && b.textContent.trim() !== '' && b.title !== '' })`)))
  await page.click('.chat-button@History')
  await page.waitFor(`document.querySelector('dialog.history')?.open === true`, { timeoutMs: 6000 })
  await page.press('Escape')
  await sleep(250)
  check('D: History opens from the rail', !(await dialogOpen('history')))
  await page.screenshot(`${shots}/19-dark-rail.png`)
  await page.send('Page.reload')
  await sleep(600)
  await page.waitFor(READY, { timeoutMs: 20000 })
  await sleep(300)
  check('D: after a reload the sidebar is still a rail', Math.abs((await box('.sidebar')).w - 60) < 1)
  await page.click('.sidebar-toggle')
  await sleep(450)
  check('D: and the toggle opens it again, which is kept', Math.abs((await box('.sidebar')).w - 260) < 1 && (await stored()).sidebar === 'open')

  // ============ E. narrow windows ============
  for (const width of [700, 420, 320, 280]) {
    await metrics(width, 700)
    const n = await ev(`(() => {
      const side = document.querySelector('.sidebar').getBoundingClientRect()
      const buttons = [...document.querySelectorAll('button, select, textarea')].filter((e) => !e.closest('dialog') && getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().width > 0)
      return { side: Math.round(side.width), toggle: getComputedStyle(document.querySelector('.sidebar-toggle')).display, overflowX: document.documentElement.scrollWidth > innerWidth, inside: buttons.every((e) => { const r = e.getBoundingClientRect(); return r.left >= -0.5 && r.right <= innerWidth + 0.5 }),
        box: (() => { const b = document.querySelector('.composer-inner').getBoundingClientRect(); return b.right <= innerWidth + 0.5 && b.bottom <= innerHeight })(), oneLine: [...document.querySelectorAll('.chat-bar .chat-button')].every((b) => b.getBoundingClientRect().height <= 36) }
    })()`)
    check(`E: at ${width} px the sidebar is a 60 px rail with no toggle, nothing scrolls sideways, every control is inside the window, the box fits and its buttons keep one line`, n.side === 60 && n.toggle === 'none' && !n.overflowX && n.inside && n.box && n.oneLine, JSON.stringify(n))
    await page.screenshot(`${shots}/19-dark-narrow-${width}.png`)
  }
  await clearMetrics()

  // ============ F. the keyboard: the sidebar, the header, the messages, the box ============
  // No element has a tabindex of its own, so the order of the page is the order of the keyboard (buttons that are off are skipped by it, not moved).
  const order = await ev(`[...document.querySelectorAll('select, button, textarea')].filter((e) => !e.closest('dialog') && getComputedStyle(e).display !== 'none').map((e) => e.tagName === 'SELECT' ? e.className.split(' ')[0] : e.classList.contains('sidebar-chat') ? 'chat' : e.classList.contains('composer-input') ? 'input' : e.classList.contains('composer-button') ? 'send' : e.textContent.trim())`)
  const at = (k) => order.indexOf(k)
  check('F: no element changes the keyboard order with a tabindex', (await ev(`document.querySelectorAll('[tabindex]:not(dialog)').length`)) === 0)
  check('F: the keyboard goes through the sidebar (New chat, History, Tools, the chats, Settings, the theme), then the header\'s menus, then the box (the text, its buttons, Send)', at('New chat') < at('History') && at('History') < at('Tools') && at('Tools') < at('chat') && at('chat') < at('Settings') && at('Settings') < at('task-select') && at('task-select') < at('header-select') && at('header-select') < at('effort-select') && at('effort-select') < at('input') && at('input') < at('Attach...') && at('Attach...') < at('send') && order.at(-1) === 'send', JSON.stringify(order))

  check('no console errors, warnings, exceptions or CSP violations in the whole run', page.problems.length === 0, page.problems.join(' | '))
} catch (error) {
  check(`the suite ran to its end (it stopped: ${String(error?.message ?? error).slice(0, 240)})`, false)
  try {
    console.log('page at the stop: ' + JSON.stringify(await ev(`({ vw: innerWidth, theme: document.documentElement.dataset.theme, app: document.querySelector('.app')?.className, dialogs: [...document.querySelectorAll('dialog')].map((d) => d.className + ':' + d.open), active: document.activeElement?.tagName + '.' + document.activeElement?.className, chats: document.querySelectorAll('.sidebar-chat').length })`)))
    await page.screenshot(`${shots}/19-at-the-stop.png`)
  } catch { /* the page is gone */ }
}
process.exit(check.summary() ? 0 : 1)
