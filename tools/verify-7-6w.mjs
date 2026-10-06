// Stage 7.6 (D-029), in the real window against the mock: New chat, History and Instructions live in a bar UNDER the message box, and the header
// is ONE row at the default window width in every state: each model (the OpenAI ones show "No API key"; Haiku, with no Effort menu, was removed in D-036), each task
// (a task makes the model menu wider, "(suggested)"), and the widest one (a task chosen and both badges at once, which would need about 870 px
// without the menus giving way). Also: where the bar sits, that its buttons keep the rules they had in the header (off while a reply arrives,
// the same sentences, focus back to the button after a dialog), the keyboard order, narrow windows. The "Not saved" badge is made on the page for
// the width check only (the real one is checked, in the header, by verify-4-5). Needs: MOCK_PORT, USER_DATA_DIR (scratch) and a saved key (setup-key.mjs).
import './ts-resolve.mjs'
import { connect, checker, sleep } from './cdp.mjs'
import { assertScratchProfile } from './profile-guard.mjs'
import { helpers } from './lib3.mjs'

const shots = process.argv[2]
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
const OPUS = 'claude-opus-5-5'
const reset = () => fetch(`${mockUrl}/__reset`, { method: 'POST' })

// ---- what the page looks like ----
/** The header as one row or not: its height, how far apart the vertical centres of its controls are, whether each is inside the window and none overlaps the next. */
const headerShape = () => ev(`(() => {
  const kids = [...document.querySelectorAll('.app-header .app-title, .app-header-actions > *')]
  const boxes = kids.map((e) => { const b = e.getBoundingClientRect(); return { l: b.left, r: b.right, c: (b.top + b.bottom) / 2, w: b.width, cls: e.className.split(' ')[0] } })
  const byLeft = [...boxes].sort((a, b) => a.l - b.l)
  const cs = boxes.map((b) => b.c)
  return { vw: innerWidth, h: document.querySelector('.app-header').getBoundingClientRect().height, spread: Math.max(...cs) - Math.min(...cs), count: boxes.length,
    inside: boxes.every((b) => b.l >= 0 && b.r <= innerWidth), noOverlap: byLeft.every((b, i) => i === 0 || byLeft[i - 1].r <= b.l + 0.5),
    overflowX: document.documentElement.scrollWidth > innerWidth, widths: Object.fromEntries(boxes.map((b) => [b.cls + (b.cls === 'app-badge' ? '#' + Math.round(b.l) : ''), Math.round(b.w)])) }
})()`)
const oneRow = (s) => s.h < 60 && s.spread <= 4 && s.inside && s.noOverlap && !s.overflowX
const layout = () => ev(`(() => {
  const r = (s) => { const b = document.querySelector(s).getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom, h: b.height } }
  return { vw: innerWidth, vh: innerHeight, header: r('.app-header'), list: r('.message-list'), composer: r('.composer'), box: r('.composer-inner'), bar: r('.chat-bar'), first: r('.chat-bar .chat-button'),
    scroll: document.documentElement.scrollHeight > innerHeight || document.documentElement.scrollWidth > innerWidth }
})()`)
const chatBtns = () => ev(`[...document.querySelectorAll('.chat-bar .chat-button')].map((b) => ({ text: b.textContent, disabled: b.disabled, title: b.title, mark: b.querySelector('.chat-mark')?.textContent ?? null, focused: document.activeElement === b }))`)
const btn = async (text) => (await chatBtns()).find((b) => b.text.startsWith(text))
const setSel = (cls, value) => ev(`(() => { const s = document.querySelector('${cls}'); const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; set.call(s, ${JSON.stringify(value)}); s.dispatchEvent(new Event('change', { bubbles: true })); return s.value })()`)
const addProbes = () => ev(`(() => { const a = document.querySelector('.app-header-actions'); const settings = [...a.children].at(-1); for (const [tag, cls, text] of [['button', 'app-badge app-badge-warn app-badge-button', 'Not saved'], ['span', 'app-badge app-badge-warn', 'No API key']]) { const e = document.createElement(tag); e.className = cls + ' probe'; e.textContent = text; a.insertBefore(e, settings) } return a.querySelectorAll('.probe').length })()`)
const removeProbes = () => ev(`(() => { document.querySelectorAll('.probe').forEach((e) => e.remove()); return document.querySelectorAll('.probe').length })()`)
const metrics = async (width, height = 634) => { await page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false }); await sleep(300) }
const active = () => ev(`(() => { const a = document.activeElement; return a ? (a.textContent || a.className || a.tagName).trim().slice(0, 30) : null })()`)
const dialogOpen = (cls) => ev(`document.querySelector('dialog.${cls}')?.open === true`)

try {
  await page.waitFor(`document.readyState === 'complete' && !!document.querySelector('.header-select, .app-badge')`, { timeoutMs: 15000 })
  await sleep(400)

  // ============ A. where things are, at the default window ============
  const L = await layout()
  check('the page is as wide as the default window gives it (900 px window, 886 px of page): this is the width that must stay one row', Math.abs(L.vw - 886) <= 2, `vw=${L.vw} vh=${L.vh}`)
  const headerTexts = await ev(`[...document.querySelectorAll('.app-header button')].map((b) => b.textContent)`)
  check('the header has only Settings among its buttons: New chat, History and Instructions are not in it any more', JSON.stringify(headerTexts) === JSON.stringify(['Settings']), JSON.stringify(headerTexts))
  const order = await ev(`[...document.querySelectorAll('.app-header .app-title, .app-header-actions > *')].map((e) => e.className.split(' ')[0])`)
  check('the header is: the title, the Task menu, the model menu, the Effort menu, then Settings', JSON.stringify(order) === JSON.stringify(['app-title', 'task-select', 'header-select', 'effort-select', 'header-button']), JSON.stringify(order))
  const bar = await ev(`(() => { const b = document.querySelector('.chat-bar'); return b ? { role: b.getAttribute('role'), label: b.getAttribute('aria-label'), next: b.previousElementSibling?.tagName + '.' + b.previousElementSibling?.className, last: !b.nextElementSibling || [...b.parentElement.children].slice([...b.parentElement.children].indexOf(b) + 1).every((e) => e.tagName === 'DIALOG') } : null })()`)
  check('under the message box there is a chat bar, a named group, holding New chat, History and Instructions in that order', bar !== null && bar.role === 'group' && bar.label === 'This chat' && JSON.stringify((await chatBtns()).map((b) => b.text)) === JSON.stringify(['New chat', 'History', 'Instructions']), JSON.stringify(bar))
  check('the bar is the last thing on the page (only closed dialogs follow it) and right after the chat area', bar.last && /MAIN/.test(bar.next), JSON.stringify(bar))
  check('the header is at the top and ONE row (under 60 px high, every control on one line)', L.header.t === 0 && oneRow(await headerShape()), JSON.stringify(await headerShape()))
  check('the bar sits at the very bottom of the window, the message box right above it, and the list fills what is between the header and the box', Math.abs(L.bar.b - L.vh) < 1 && Math.abs(L.composer.b - L.bar.t) < 1 && Math.abs(L.list.t - L.header.b) < 1 && Math.abs(L.list.b - L.composer.t) < 1, JSON.stringify({ bar: L.bar, composer: L.composer, list: L.list }))
  check('the first button lines up with the left edge of the message box', Math.abs(L.first.l - L.box.l) < 1.5, `button ${L.first.l} box ${L.box.l}`)
  check('the page does not scroll, and the chat area keeps at least 470 px of the 634 (the header cost 33 px more in 7.4)', !L.scroll && L.list.h + L.composer.h >= 470, `list ${Math.round(L.list.h)} composer ${Math.round(L.composer.h)}`)
  await page.screenshot(`${shots}/7-6-default.png`)

  // ============ B. the header stays ONE row, whatever is showing (default width) ============
  const menu = await H.menu()
  const rowsSeen = []
  for (const id of menu.values) {
    await H.chooseInPage(id)
    await H.settle(id)
    await sleep(250)
    const s = await headerShape()
    const badges = await H.badges()
    const openai = /^gpt-/.test(id)
    const hasEffort = await ev(`!!document.querySelector('.effort-select')`)
    rowsSeen.push([id, Math.round(s.h)])
    check(`model ${id}: the header is one row (${Math.round(s.h)} px), with its Effort menu${openai ? ', and the "No API key" badge showing' : ''}`, oneRow(s) && (openai ? badges.some((b) => /No API key/.test(b.text)) : badges.length === 0) && hasEffort, JSON.stringify({ s, badges: badges.map((b) => b.text), hasEffort }))
  }
  await H.chooseInPage(OPUS)
  await H.settle(OPUS)
  const tasks = await ev(`[...document.querySelectorAll('.task-select option')].map((o) => o.value)`)
  check('the Task menu offers any task and the four tasks', tasks.length === 5, JSON.stringify(tasks))
  for (const t of tasks) {
    await setSel('.task-select', t)
    await sleep(300)
    const s = await headerShape()
    check(`task "${t || 'any'}": the header is one row (${Math.round(s.h)} px)${t === 'coding' ? `; the model menu is wider (${s.widths['header-select']} px: it says "(suggested)")` : ''}`, oneRow(s), JSON.stringify(s))
  }
  // the widest state: a task chosen (wide model menu) and both badges, at the default width and at 800 and 720
  await setSel('.task-select', 'coding')
  await sleep(300)
  check('(the probes: a "Not saved" badge and a "No API key" badge are put in the header, only to measure)', (await addProbes()) === 2)
  for (const width of [886, 800, 720]) {
    await metrics(width)
    const s = await headerShape()
    check(`the widest state at ${width} px (a task chosen, both badges): still ONE row (${Math.round(s.h)} px), the menus give way and none is below 96 px`, oneRow(s) && ['task-select', 'header-select', 'effort-select'].every((k) => s.widths[k] >= 95.5), JSON.stringify(s))
    if (width === 886) await page.screenshot(`${shots}/7-6-widest.png`)
  }
  await metrics(719)
  const below = await headerShape()
  check('just under 720 px the controls drop under the title as before (the narrow-window rule), with no sideways scroll and every control inside', !below.overflowX && below.inside, JSON.stringify(below))
  await page.send('Emulation.clearDeviceMetricsOverride')
  await sleep(300)
  check('(the probes are removed again)', (await removeProbes()) === 0)
  await setSel('.task-select', '')
  await sleep(300)
  check('and back to the default state the header is one row again', oneRow(await headerShape()))

  // ============ C. the buttons keep the rules they had in the header ============
  await reset()
  let b = await chatBtns()
  check('an empty chat: New chat is off and says "This chat is empty."; History and Instructions are on, with their usual sentences', b[0].disabled && b[0].title === 'This chat is empty.' && !b[1].disabled && b[1].title === 'Open a saved chat, or delete one.' && !b[2].disabled && /^Give the model instructions for this chat/.test(b[2].title), JSON.stringify(b))
  const first = await H.askMock('hello bar')
  b = await chatBtns()
  check('after a reply New chat is on and says the chat stays in History', first !== null && !b[0].disabled && b[0].title === 'Start a new chat. This one stays saved in History.', JSON.stringify(b[0]))
  await H.send('[[mock:slow]] busy')
  await page.waitFor(`!!document.querySelector('.composer-button-stop')`, { timeoutMs: 8000 })
  await sleep(300)
  b = await chatBtns()
  check('while a reply arrives all three are off, each saying when it comes back', b.every((x) => x.disabled) && b[0].title === 'A new chat can be started when the reply has finished.' && b[1].title === 'History can be opened when the reply has finished.' && b[2].title === 'The instructions can be changed when the reply has finished.', JSON.stringify(b))
  await page.click('.chat-button@History').catch(() => {})
  await sleep(250)
  check('...and a click on History opens nothing', !(await dialogOpen('history')))
  await page.click('.composer-button')
  await page.waitFor(SEND_READY, { timeoutMs: 15000 })
  await sleep(300)
  b = await chatBtns()
  check('after Stop all three are on again', b.every((x) => !x.disabled), JSON.stringify(b.map((x) => x.disabled)))
  await page.click('.chat-button@History')
  await page.waitFor(`document.querySelector('dialog.history')?.open === true`, { timeoutMs: 6000 })
  await page.press('Escape')
  await sleep(250)
  check('History opens from the bar, Escape closes it, and the keyboard is back on the History button', !(await dialogOpen('history')) && (await btn('History')).focused, JSON.stringify(await btn('History')))
  await page.click('.chat-button@Instructions')
  await page.waitFor(`document.querySelector('dialog.instructions')?.open === true && !!document.querySelector('dialog.instructions textarea')`, { timeoutMs: 6000 })
  await page.press('Escape')
  await sleep(250)
  check('Instructions opens from the bar, Escape closes it, and the keyboard is back on the Instructions button', !(await dialogOpen('instructions')) && (await btn('Instructions')).focused, JSON.stringify(await btn('Instructions')))
  await page.click('.chat-button@Instructions')
  await page.waitFor(`document.querySelector('dialog.instructions')?.open === true && !!document.querySelector('dialog.instructions textarea')`, { timeoutMs: 6000 })
  await ev(`document.querySelector('dialog.instructions textarea').focus()`)
  await page.type('be brief')
  await sleep(150)
  await page.click('dialog.instructions button[type=submit]')
  await page.waitFor(`document.querySelector('dialog.instructions')?.open !== true`, { timeoutMs: 6000 })
  await sleep(250)
  b = await chatBtns()
  check('after Save the Instructions button reads "Instructions on", with the mark, and its tooltip says how long they are (8 characters)', b[2].text === 'Instructions on' && b[2].mark === 'on' && /^Instructions are on for this chat \(8 characters\)/.test(b[2].title), JSON.stringify(b[2]))
  check('the bar is still one line of three buttons at the default width, and the header did not change', (await ev(`new Set([...document.querySelectorAll('.chat-bar .chat-button')].map((e) => Math.round(e.getBoundingClientRect().top))).size`)) === 1 && oneRow(await headerShape()))
  await page.screenshot(`${shots}/7-6-instructions-on.png`)

  // ============ D. the keyboard: the bar comes last, after the message box and Send ============
  await ev(`document.querySelector('.composer-input').focus()`)
  await page.type('x')
  await sleep(100)
  const domOrder = await ev(`[...document.querySelectorAll('select, button:not(:disabled), textarea')].filter((e) => !e.closest('dialog')).map((e) => e.classList.contains('chat-button') ? 'chat:' + e.textContent.replace(/ on$/, '') : e.classList.contains('composer-input') ? 'input' : e.classList.contains('composer-button') ? 'send' : e.classList.contains('header-button') ? 'settings' : e.className.split(' ')[0])`)
  const at = (k) => domOrder.indexOf(k)
  check('in the order the keyboard goes: the header (Task, model, Effort, Settings), then the messages, the box, Send, and last New chat, History, Instructions', at('task-select') < at('header-select') && at('header-select') < at('effort-select') && at('effort-select') < at('settings') && at('settings') < at('input') && at('input') < at('send') && at('send') < at('chat:New chat') && at('chat:New chat') + 1 === at('chat:History') && at('chat:History') + 1 === at('chat:Instructions') && at('chat:Instructions') === domOrder.length - 1, JSON.stringify(domOrder))
  const walk = []
  for (let i = 0; i < 4; i++) { await page.press('Tab'); walk.push(await active()) }
  check('Tab from the message box goes Send, New chat, History, Instructions', JSON.stringify(walk) === JSON.stringify(['Send', 'New chat', 'History', 'Instructions on']), JSON.stringify(walk))
  const back = []
  for (let i = 0; i < 3; i++) { await page.press('Tab', { shift: true }); back.push(await active()) }
  check('and Shift+Tab goes back the same way', JSON.stringify(back) === JSON.stringify(['History', 'New chat', 'Send']), JSON.stringify(back))
  await page.click('.chat-button@New chat')
  await page.waitFor(`document.querySelectorAll('.message-list-inner > .message').length === 0`, { timeoutMs: 6000 })
  await sleep(300)
  b = await chatBtns()
  check('New chat empties the chat, puts the keyboard in the message box, and the new chat starts without instructions (no mark)', (await ev(`document.activeElement?.classList.contains('composer-input')`)) && b[2].text === 'Instructions' && b[2].mark === null && b[0].disabled, JSON.stringify(b))

  // ============ E. narrow windows: the bar wraps instead of overflowing ============
  await page.click('.chat-button@Instructions')
  await page.waitFor(`document.querySelector('dialog.instructions')?.open === true && !!document.querySelector('dialog.instructions textarea')`, { timeoutMs: 6000 })
  await ev(`document.querySelector('dialog.instructions textarea').focus()`)
  await page.type('be brief')
  await page.click('dialog.instructions button[type=submit]')
  await page.waitFor(`document.querySelector('dialog.instructions')?.open !== true`, { timeoutMs: 6000 })
  await sleep(250)
  for (const width of [420, 320, 280]) { // 280: where the three buttons and the mark no longer fit one line, so a bar that cannot wrap would spill out of the window
    await metrics(width, 700)
    const n = await ev(`(() => { const bs = [...document.querySelectorAll('.chat-bar .chat-button')].map((e) => e.getBoundingClientRect()); const box = document.querySelector('.composer-inner').getBoundingClientRect(); const bar = document.querySelector('.chat-bar').getBoundingClientRect();
      return { overflowX: document.documentElement.scrollWidth > innerWidth, inside: bs.every((r) => r.left >= 0 && r.right <= innerWidth), boxInside: box.left >= 0 && box.right <= innerWidth && box.bottom <= innerHeight, barBottom: Math.round(bar.bottom), vh: innerHeight, rows: new Set(bs.map((r) => Math.round(r.top))).size, oneLine: bs.every((r) => r.height <= 30) } })()`)
    check(`at ${width} px, with the "on" mark, the bar has no sideways scroll, every button is inside the window and keeps its label on ONE line (it wraps as a row, not inside a button), the box is above it (${n.rows} row${n.rows === 1 ? '' : 's'} of buttons)`, !n.overflowX && n.inside && n.oneLine && n.boxInside && n.barBottom <= n.vh, JSON.stringify(n))
    await page.screenshot(`${shots}/7-6-narrow-${width}.png`)
  }
  await page.send('Emulation.clearDeviceMetricsOverride')
  await sleep(300)
  check('no console errors, warnings, exceptions or CSP violations in the whole run', page.problems.length === 0, page.problems.join(' | '))
} catch (error) {
  check(`the suite ran to its end (it stopped: ${String(error?.message ?? error).slice(0, 240)})`, false)
  try {
    console.log('page at the stop: ' + JSON.stringify(await ev(`({ vw: innerWidth, header: document.querySelector('.app-header')?.getBoundingClientRect().height, bar: [...document.querySelectorAll('.chat-bar .chat-button')].map((b) => b.textContent + (b.disabled ? '(off)' : '')), dialogs: [...document.querySelectorAll('dialog')].map((d) => d.className + ':' + d.open), active: document.activeElement?.tagName + '.' + document.activeElement?.className, probes: document.querySelectorAll('.probe').length })`)))
  } catch { /* the page is gone */ }
}
process.exit(check.summary() ? 0 : 1)
