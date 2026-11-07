// Stage 20 (D-052), the layout taken from ChatGPT and Claude (Claude's parts measured on claude.ai in 20b), in the real window against the mock: an empty chat puts the greeting and the
// message box together in the middle and the first message sends the box to the foot; the header leads with the menus as plain words, the
// chat's title in the middle, the warnings at the right; New chat is a row of the sidebar; the person's bubble is grey and round; the text
// of messages is 16 px; a note under the box; Settings has the list of its sections at the left (each brings its section to the top), no
// sideways scroll, and no list in a narrow window; the contrast of the new colour pairs (the message box) in both themes. Screenshots go
// to the shots20 folder. Needs: MOCK_PORT, USER_DATA_DIR (scratch) and a saved key (setup-key.mjs).
import './ts-resolve.mjs'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { connect, checker, sleep } from './cdp.mjs'
import { assertScratchProfile } from './profile-guard.mjs'
import { helpers } from './lib3.mjs'

// Beside the shots folder, which a guarded window run does not keep (as shots19).
const shots = join(process.argv[2], '..', 'shots20')
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
const READY = `document.readyState === 'complete' && !!document.querySelector('.header-select, .app-badge') && !!document.querySelector('.chat-bar')`

const box = (s) => ev(`(() => { const e = document.querySelector(${JSON.stringify(s)}); if (!e) return null; const b = e.getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom, w: b.width, h: b.height } })()`)
const css = (s, prop) => ev(`(() => { const e = document.querySelector(${JSON.stringify(s)}); return e ? getComputedStyle(e)[${JSON.stringify(prop)}] : null })()`)
const visible = (s) => ev(`(() => { const e = document.querySelector(${JSON.stringify(s)}); if (!e) return false; const b = e.getBoundingClientRect(); return b.width > 2 && b.height > 2 && getComputedStyle(e).visibility !== 'hidden' })()`)
const metrics = async (width, height = 634) => { await page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false }); await sleep(350) }
const clearMetrics = async () => { await page.send('Emulation.clearDeviceMetricsOverride'); await sleep(350) }
const theme = () => ev(`document.documentElement.dataset.theme ?? null`)

// The contrast of two colours of the page's own palette (as verify-19-1w), for the pairs this stage added.
const CONTRAST = `(() => {
  const css = getComputedStyle(document.documentElement)
  const rgb = (name) => { const v = css.getPropertyValue(name).trim(); const h = v.replace('#', ''); if (!/^[0-9a-f]{6}$/i.test(h)) return null; return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) }
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]) }
  return (a, b) => { const x = rgb(a), y = rgb(b); if (!x || !y) return null; const p = lum(x), q = lum(y); return Math.round(((Math.max(p, q) + 0.05) / (Math.min(p, q) + 0.05)) * 100) / 100 }
})()`
const PAIRS = [
  ['--color-text', '--color-composer', 4.5], ['--color-text-muted', '--color-composer', 4.5], ['--color-accent-text', '--color-composer', 4.5],
  ['--color-input-border', '--color-composer', 3], ['--color-input-border', '--color-background', 3], ['--color-focus', '--color-composer', 3],
  ['--color-text-muted', '--color-user-bubble', 4.5], ['--color-text', '--color-sidebar-active', 4.5]
]
const contrastFails = () => ev(`(() => { const ratio = ${CONTRAST}; return ${JSON.stringify(PAIRS)}.map(([a, b, min]) => ({ a, b, min, r: ratio(a, b) })).filter((p) => p.r === null || p.r < p.min) })()`)

/** Where the parts are (D-052, as measured on Claude): the title and the badges in the header; the menus' group and the note under the box. */
const headerParts = () => ev(`(() => {
  const b = (s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { l: r.left, r: r.right, w: r.width, shown: r.width > 2 && getComputedStyle(e).display !== 'none' } }
  const t = (s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom } }
  return { menus: b('.app-header-actions'), title: b('.chat-title'), badges: b('.app-header-badges'), header: b('.app-header'), box: t('.composer-inner'), menusBox: t('.app-header-actions'), note: t('.chat-footnote'),
    inHeader: !!document.querySelector('.app-header .app-header-actions'), underBox: !!document.querySelector('.composer-meta > .app-header-actions'),
    menuKids: [...document.querySelectorAll('.app-header-actions > *')].filter((e) => e.tagName !== 'DIALOG').map((e) => e.className.split(' ')[0]), /* (21.1) the chooser's dialog sits beside the menu */
    badgeKids: [...document.querySelectorAll('.app-header-badges > *')].map((e) => e.textContent.trim()),
    titleAlign: getComputedStyle(document.querySelector('.chat-title')).textAlign, menusLabel: document.querySelector('.app-header-actions')?.getAttribute('aria-label') }
})()`)

const SECTIONS = ['API keys', 'Model', 'Usage', 'Spending limits', 'Large requests', 'Voice', 'Images', 'Updates', 'Saved chats', 'Appearance']

try {
  await page.waitFor(READY, { timeoutMs: 20000 })
  await sleep(500)

  // ============ A. an empty chat: the greeting and the box together, in the middle ============
  const vh = await ev('innerHeight')
  const greet = await box('.empty-title')
  let inner = await box('.composer-inner')
  check('A: an empty chat: the greeting (the mark beside the heading) sits right above the message box', greet && inner && (await visible('.empty-logo')) && inner.t > greet.b && inner.t - greet.b < 120 && Math.abs((greet.t + greet.b) / 2 - (await box('.empty-logo')).t - 18) < 30, JSON.stringify({ greet, inner }))
  check('A: ...and the two are in the middle of the window, not at its foot (the box ends in its upper three quarters)', inner.b < vh * 0.75 && greet.t > 100, JSON.stringify({ greet, inner, vh }))
  check('A: the main area says it is empty (chat-empty), and the heading is plain, not bold, in a serif (Georgia, as Claude\'s greeting)', (await ev(`document.querySelector('main.chat').classList.contains('chat-empty')`)) && Number(await css('.empty-heading', 'fontWeight')) < 600 && /^Georgia/.test(await css('.empty-heading', 'fontFamily')))
  check('A: a note under the box says a model can be wrong', (await ev(`document.querySelector('.chat-footnote')?.textContent`)) === 'Models can make mistakes. Check what matters.' && (await box('.chat-footnote')).t >= inner.b)
  const hp = await headerParts()
  check('A: the header (as Claude\'s): the title at its left, left-aligned, the "No API key" badge... at the right, and no menu in it', hp.title.shown && hp.title.l - hp.header.l < 24 && hp.titleAlign !== 'center' && hp.badges.r <= hp.header.r + 0.5 && hp.badges.l >= hp.title.l && !hp.inHeader, JSON.stringify(hp))
  check('A: the Task, model and Effort menus are a named group right under the message box, at its right edge (as Claude\'s model menu)', JSON.stringify(hp.menuKids) === JSON.stringify(['task-select', 'header-select', 'effort-select']) && hp.underBox && hp.menusLabel === 'Task, model and effort' && hp.menusBox.t >= hp.box.b - 0.5 && hp.menusBox.t - hp.box.b < 24 && Math.abs(hp.menusBox.r - hp.box.r) < 8, JSON.stringify(hp))
  // "As wide as its choice": the width of the chosen option's text in the menu's own font, measured on a canvas, plus the padding (10 + 28).
  const sel = await ev(`(() => { const c = document.createElement('canvas').getContext('2d'); return [...document.querySelectorAll('.app-header-actions select')].map((e) => { const s = getComputedStyle(e); c.font = s.fontWeight + ' ' + s.fontSize + ' ' + s.fontFamily; const text = Math.ceil(c.measureText(e.selectedOptions[0]?.textContent ?? '').width); return { cls: e.className.split(' ')[0], border: s.borderTopWidth, bg: s.backgroundColor, w: Math.round(e.getBoundingClientRect().width), h: Math.round(e.getBoundingClientRect().height), text, size: s.fontSize, weight: s.fontWeight, color: s.color } }) })()`)
  const textColour = await ev(`getComputedStyle(document.body).color`)
  check('A: the menus are words with an arrow (no edge, no fill until pointed at), 32 px high, each only as wide as its choice; the model\'s name in the text\'s colour, semibold', sel.length === 3 && sel.every((s) => s.border === '0px' && s.bg === 'rgba(0, 0, 0, 0)' && s.w <= s.text + 36 + 6 && s.h === 32) && sel.find((s) => s.cls === 'header-select').weight === '600' && sel.find((s) => s.cls === 'header-select').color === textColour && sel.find((s) => s.cls === 'task-select').color !== textColour, JSON.stringify({ sel, textColour }))
  const nc = await ev(`(() => { const b = document.querySelector('.sidebar-new'); const s = getComputedStyle(b); const i = getComputedStyle(b.querySelector('.icon')); const h = document.querySelector('.sidebar-nav .sidebar-item'); return { bg: s.backgroundColor, image: s.backgroundImage, h: b.getBoundingClientRect().height, itemH: h.getBoundingClientRect().height, left: b.getBoundingClientRect().left, iconBg: i.backgroundImage.slice(0, 15), sidebar: document.querySelector('.sidebar').getBoundingClientRect().width } })()`)
  check('A: New chat is a row like History (no filled button), its plus on the gradient; the sidebar is 260 px', nc.bg === 'rgba(0, 0, 0, 0)' && nc.image === 'none' && Math.abs(nc.h - nc.itemH) <= 1 && nc.iconBg.startsWith('linear-gradient') && Math.abs(nc.sidebar - 260) < 1, JSON.stringify(nc))
  const fails = await contrastFails()
  check('A: dark: the new colour pairs (the message box, the bubble, the chosen chat) are readable (text 4.5:1, an edge 3:1)', fails.length === 0, JSON.stringify(fails))
  await page.screenshot(`${shots}/20-dark-empty.png`)

  // ============ B. a chat: the box at the foot, the bubbles ============
  const reply = await H.askMock('[[mock:say]] A reply with **bold** text and a list:\n\n- one\n- two')
  check('B: a message goes and its reply comes back', reply !== null)
  await sleep(300)
  inner = await box('.composer-inner')
  const foot = await box('.composer-meta')
  const note = await box('.chat-footnote')
  check('B: with a message, the box is at the foot of the window (the menus and the note under it), and the main area is no longer "empty"', foot !== null && note !== null && note.h > 2 && foot.b <= vh + 0.5 && foot.b > vh - 80 && inner.b <= foot.t + 0.5 && !(await ev(`document.querySelector('main.chat').classList.contains('chat-empty')`)), JSON.stringify({ inner, foot, note, vh }))
  const bub = await ev(`(() => { const u = getComputedStyle(document.querySelector('.message-user .bubble')); const a = getComputedStyle(document.querySelector('.message-assistant .bubble')); const root = getComputedStyle(document.documentElement); return { userBg: u.backgroundColor, userSize: u.fontSize, radius: [u.borderTopLeftRadius, u.borderBottomRightRadius], aSize: a.fontSize, aBg: a.backgroundColor, want: root.getPropertyValue('--color-user-bubble').trim() } })()`)
  const hex = (rgb) => '#' + rgb.match(/\d+/g).slice(0, 3).map((n) => Number(n).toString(16).padStart(2, '0')).join('')
  check('B: the person\'s bubble is the grey of --color-user-bubble and round at every corner; both messages are set at 16 px; a reply has no bubble', hex(bub.userBg) === bub.want && bub.radius[0] === bub.radius[1] && bub.userSize === '16px' && bub.aSize === '16px' && bub.aBg === 'rgba(0, 0, 0, 0)', JSON.stringify(bub))
  check('B: who answered is said above the reply, without the old gradient dot', (await ev(`getComputedStyle(document.querySelector('.message-model'), '::before').content`)) === 'none')
  await page.screenshot(`${shots}/20-dark-chat.png`)
  await metrics(1200, 700)
  // Measured in a wide window, where the chat area (940 px) has room for more.
  const col = await box('.message-list-inner')
  const composerW = (await box('.composer-inner')).w
  check('B: in a wide window the column of messages and the box are 800 px wide (21.4, D-053: as AI Fiesta; 768 before), not wider', Math.abs(col.w - 800) < 1 && Math.abs(composerW - 800) < 1, JSON.stringify({ col, composerW }))
  const wide = await headerParts()
  check('B: in a wide window the title is at the header\'s left, and the note sits beside the menus in ONE row under the box (as Claude\'s)', wide.title.shown && wide.title.l - wide.header.l < 24 && Math.abs((wide.note.t + wide.note.b) / 2 - (wide.menusBox.t + wide.menusBox.b) / 2) < 4 && wide.note.r <= wide.menusBox.l, JSON.stringify(wide))
  await page.screenshot(`${shots}/20-dark-wide.png`)
  await clearMetrics()

  // ============ C. Settings: the list of its sections ============
  await page.click('.header-button@Settings')
  await page.waitFor(`!!document.querySelector('dialog.settings')?.open`, { timeoutMs: 6000 })
  await sleep(300)
  const nav = await ev(`(() => { const n = document.querySelector('dialog.settings .settings-nav'); return n ? { label: n.getAttribute('aria-label'), items: [...n.querySelectorAll('button')].map((b) => b.textContent), shown: n.getBoundingClientRect().width > 0 } : null })()`)
  check('C: Settings lists its ten sections at the left, in the order of the page', nav && nav.shown && nav.label === 'Sections of Settings' && JSON.stringify(nav.items) === JSON.stringify(SECTIONS), JSON.stringify(nav))
  const sideways = () => ev(`(() => { const d = document.querySelector('dialog.settings'); return { sw: d.scrollWidth, cw: d.clientWidth } })()`)
  let sw = await sideways()
  check('C: nothing in Settings scrolls sideways at the default window', sw.sw <= sw.cw, JSON.stringify(sw))
  const reached = []
  for (const section of [...SECTIONS].reverse()) {
    await page.click(`.settings-nav-item@${section}`)
    await sleep(250)
    reached.push(await ev(`(() => {
      const d = document.querySelector('dialog.settings'); const top = d.querySelector('.settings-title').getBoundingClientRect().bottom
      const t = ${JSON.stringify(section)} === 'API keys' ? d.querySelector('.settings-body > .settings-section') : [...d.querySelectorAll('.settings-heading')].find((h) => h.textContent.trim() === ${JSON.stringify(section)})
      const r = t.getBoundingClientRect(); const navR = d.querySelector('.settings-nav').getBoundingClientRect()
      return { section: ${JSON.stringify(section)}, below: Math.round(r.top - top), atEnd: Math.abs(d.scrollTop + d.clientHeight - d.scrollHeight) < 2, navTop: Math.round(navR.top - top) }
    })()`))
  }
  // A section near the end cannot reach the top when the page ends first: then it must at least be in view, the page scrolled to its end.
  check('C: each entry brings its section to the top (just under the title), or as far as the page goes; the list stays in view', reached.every((r) => (r.below >= -2 && r.below < 40) || (r.atEnd && r.below >= -2 && r.below < 500)) && reached.every((r) => r.navTop >= -2 && r.navTop < 40), JSON.stringify(reached))
  await page.click('.settings-nav-item@Appearance')
  await sleep(250)
  await page.screenshot(`${shots}/20-dark-settings.png`)
  await metrics(1200, 700)
  sw = await sideways()
  check('C: ...nor in a wide window', sw.sw <= sw.cw, JSON.stringify(sw))
  for (const width of [420, 280]) {
    await metrics(width, 700)
    const n = await ev(`(() => { const d = document.querySelector('dialog.settings'); return { nav: getComputedStyle(d.querySelector('.settings-nav')).display, sw: d.scrollWidth, cw: d.clientWidth, w: d.getBoundingClientRect().width } })()`)
    check(`C: at ${width} px the list is not shown, Settings is one column inside the window, and nothing scrolls sideways`, n.nav === 'none' && n.sw <= n.cw && n.w <= width - 31, JSON.stringify(n))
  }
  await page.screenshot(`${shots}/20-dark-settings-280.png`)
  await clearMetrics()
  await page.click('.theme-option@Light')
  await sleep(300)
  await page.screenshot(`${shots}/20-light-settings.png`)
  await page.press('Escape')
  await sleep(250)

  // ============ D. light ============
  check('D: light is on', (await theme()) === 'light')
  const lightFails = await contrastFails()
  check('D: light: the new colour pairs are readable too', lightFails.length === 0, JSON.stringify(lightFails))
  await page.screenshot(`${shots}/20-light-chat.png`)
  await page.click('.chat-button@New chat')
  await page.waitFor(`document.querySelector('main.chat').classList.contains('chat-empty')`, { timeoutMs: 6000, label: 'the empty chat' })
  await sleep(300)
  check('D: New chat gives the empty chat again: the box back in the middle', (await box('.composer-inner')).b < vh * 0.75)
  await page.screenshot(`${shots}/20-light-empty.png`)
  for (const width of [420, 280]) {
    await metrics(width, 700)
    const n = await ev(`(() => { const b = document.querySelector('.composer-inner').getBoundingClientRect(); const g = document.querySelector('.empty-title').getBoundingClientRect(); return { overflowX: document.documentElement.scrollWidth > innerWidth, box: b.right <= innerWidth + 0.5 && b.bottom <= innerHeight, greet: g.right <= innerWidth + 0.5 && g.left >= 0, over: g.bottom <= b.top + 0.5 } })()`)
    const m = await ev(`(() => { const s = [...document.querySelectorAll('.app-header-actions select')].map((e) => e.getBoundingClientRect()); return { tops: s.map((r) => Math.round(r.top)), inside: s.every((r) => r.left >= -0.5 && r.right <= innerWidth + 0.5), model: Math.round(document.querySelector('.header-select').getBoundingClientRect().width), modelWhole: (() => { const e = document.querySelector('.header-select'); const c = document.createElement('canvas').getContext('2d'); const st = getComputedStyle(e); c.font = st.fontWeight + ' ' + st.fontSize + ' ' + st.fontFamily; return c.measureText(e.selectedOptions[0].textContent).width + 36 <= e.getBoundingClientRect().width + 1 })(), widths: s.map((r) => Math.round(r.width)) } })()`)
    check(`D: at ${width} px an empty chat fits: no sideways scroll, the greeting and the box inside the window, the greeting above the box; the three menus on ONE line inside the window, the model's name whole or, where it must be cut, the widest (it gives way last)`, !n.overflowX && n.box && n.greet && n.over && new Set(m.tops).size === 1 && m.inside && (m.modelWhole || m.model === Math.max(...m.widths)), JSON.stringify({ n, m }))
    await page.screenshot(`${shots}/20-light-empty-${width}.png`)
  }
  await clearMetrics()
  await page.click('.icon-button.theme-button')
  await sleep(250)

  check('no console errors, warnings, exceptions or CSP violations in the whole run', page.problems.length === 0, page.problems.join(' | '))
} catch (error) {
  check(`the suite ran to its end (it stopped: ${String(error?.message ?? error).slice(0, 240)})`, false)
  try {
    console.log('page at the stop: ' + JSON.stringify(await ev(`({ vw: innerWidth, theme: document.documentElement.dataset.theme, dialogs: [...document.querySelectorAll('dialog')].map((d) => d.className + ':' + d.open), active: document.activeElement?.tagName + '.' + document.activeElement?.className })`)))
    await page.screenshot(`${shots}/20-at-the-stop.png`)
  } catch { /* the page is gone */ }
}
process.exit(check.summary() ? 0 : 1)
