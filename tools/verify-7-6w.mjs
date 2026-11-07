// Stage 7.6 (D-029), brought to the layout of Stage 19 (D-051) and of Stage 20 (D-052: the title alone in the header, the Task, model and Effort menus
// in a row under the message box, as Claude's), in the real window against the mock. The header and the menus' row are each ONE row wherever the chat
// area beside the sidebar has room (600 px: the default window with the sidebar open, or a narrower one with the rail), in every state: each model (the
// OpenAI and Gemini ones show "No API key"), each task (a task makes the model menu wider, "(suggested)"), and the widest one (a task chosen and both
// badges at once). The chat's own buttons keep the rules they had in the header and under the box: New chat, History and Tools in the sidebar,
// Instructions, Memory and Project in the message box; off while a reply arrives, the same sentences, focus back to the button after a dialog;
// the keyboard order; narrow windows. The "Not saved" badge is made on the page for the width check only (the real one is checked by verify-4-5).
// Needs: MOCK_PORT, USER_DATA_DIR (scratch) and a saved key (setup-key.mjs).
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
/**
 * (D-052) Two rows: the header (the title and the badges) and the menus' row under the box. For each: how far apart the vertical centres of its shown parts
 * are; for all: whether each is inside the window and none overlaps the next in its row.
 */
const headerShape = () => ev(`(() => {
  const take = (sel) => [...document.querySelectorAll(sel)].filter((e) => e.getBoundingClientRect().width > 0).map((e) => { const b = e.getBoundingClientRect(); return { l: b.left, r: b.right, c: (b.top + b.bottom) / 2, w: b.width, cls: e.className.split(' ')[0] } })
  const head = take('.app-header .chat-title, .app-header-badges > *'), menus = take('.app-header-actions > *'), boxes = [...head, ...menus]
  const spread = (g) => g.length === 0 ? 0 : Math.max(...g.map((b) => b.c)) - Math.min(...g.map((b) => b.c))
  // (the menus' group is right-aligned, so menus that do not give way spill LEFT, over the note, while staying inside the window: measure against the row and the note)
  const row = document.querySelector('.composer-meta').getBoundingClientRect(), nb = document.querySelector('.chat-footnote').getBoundingClientRect()
  const inRow = menus.every((b) => b.l >= row.left + 0.5 && b.r <= row.right + 0.5), offNote = menus.every((b) => b.r <= nb.left + 0.5 || b.l >= nb.right - 0.5 || b.c - (nb.top + nb.bottom) / 2 > 12 || (nb.top + nb.bottom) / 2 - b.c > 12)
  const apart = (g) => { const byLeft = [...g].sort((a, b) => a.l - b.l); return byLeft.every((b, i) => i === 0 || byLeft[i - 1].r <= b.l + 0.5) }
  return { vw: innerWidth, h: document.querySelector('.app-header').getBoundingClientRect().height, spread: spread(head), menuSpread: spread(menus), count: boxes.length,
    inside: boxes.every((b) => b.l >= 0 && b.r <= innerWidth) && inRow, noOverlap: apart(head) && apart(menus) && offNote, inRow, offNote,
    overflowX: document.documentElement.scrollWidth > innerWidth, widths: Object.fromEntries(boxes.map((b) => [b.cls + (b.cls === 'app-badge' ? '#' + Math.round(b.l) : ''), Math.round(b.w)])) }
})()`)
const oneRow = (s) => s.h < 64 && s.spread <= 4 && s.menuSpread <= 4 && s.inside && s.noOverlap && !s.overflowX
const layout = () => ev(`(() => {
  const r = (s) => { const b = document.querySelector(s).getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom, h: b.height } }
  return { vw: innerWidth, vh: innerHeight, side: r('.sidebar'), main: r('.app-main'), header: r('.app-header'), list: r('.message-list'), composer: r('.composer'), chat: r('main.chat'), box: r('.composer-inner'), bar: r('.chat-bar'), first: r('.chat-bar .chat-button'),
    scroll: document.documentElement.scrollHeight > innerHeight || document.documentElement.scrollWidth > innerWidth }
})()`)
// Every .chat-button, in the order of the page (since D-051: New chat, History and Tools in the sidebar, then Attach..., Instructions, Memory and Project in the
// message box). Attach... is verify-9-2w's; this suite leaves it out.
const chatBtns = () => ev(`[...document.querySelectorAll('.chat-button')].filter((b) => b.textContent !== 'Attach...').map((b) => ({ text: b.textContent, disabled: b.disabled, title: b.title, mark: b.querySelector('.chat-mark')?.textContent ?? null, focused: document.activeElement === b }))`)
const btn = async (text) => (await chatBtns()).find((b) => b.text.startsWith(text))
const setSel = (cls, value) => ev(`(() => { const s = document.querySelector('${cls}'); const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; set.call(s, ${JSON.stringify(value)}); s.dispatchEvent(new Event('change', { bubbles: true })); return s.value })()`)
const addProbes = () => ev(`(() => { const a = document.querySelector('.app-header-badges'); for (const [tag, cls, text] of [['button', 'app-badge app-badge-warn app-badge-button', 'Not saved'], ['span', 'app-badge app-badge-warn', 'No API key']]) { const e = document.createElement(tag); e.className = cls + ' probe'; e.textContent = text; a.append(e) } return a.querySelectorAll('.probe').length })()`)
const removeProbes = () => ev(`(() => { document.querySelectorAll('.probe').forEach((e) => e.remove()); return document.querySelectorAll('.probe').length })()`)
const metrics = async (width, height = 634) => { await page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false }); await sleep(350) }
const active = () => ev(`(() => { const a = document.activeElement; return a ? (a.textContent || a.className || a.tagName).trim().slice(0, 30) : null })()`)
const dialogOpen = (cls) => ev(`document.querySelector('dialog.${cls}')?.open === true`)
const rail = async (on) => { if ((await ev(`document.querySelector('.app').classList.contains('app-rail')`)) !== on) { await page.click('.sidebar-toggle'); await sleep(450) } }

try {
  await page.waitFor(`document.readyState === 'complete' && !!document.querySelector('.header-select, .app-badge')`, { timeoutMs: 15000 })
  await sleep(400)

  // ============ A. where things are, at the default window ============
  const L = await layout()
  check('the page is as wide as the default window gives it (900 px window, 886 px of page): with the sidebar open this is the width that must stay one row', Math.abs(L.vw - 886) <= 2, `vw=${L.vw} vh=${L.vh}`)
  const headerTexts = await ev(`[...document.querySelectorAll('.app-header button')].map((b) => b.textContent)`)
  check('the header has no button: Settings is at the foot of the sidebar, New chat, History and Tools above it (D-051)', JSON.stringify(headerTexts) === '[]', JSON.stringify(headerTexts))
  // (21.1, D-053) The model chooser's dialog sits beside the model menu, shown only when opened: the row is what is SHOWN.
  const order = await ev(`[...document.querySelectorAll('.app-header-actions > *')].filter((e) => e.tagName !== 'DIALOG').map((e) => e.className.split(' ')[0])`)
  check('the menus\' row (under the box since D-052) holds the Task menu, the model menu and the Effort menu, in that order', JSON.stringify(order) === JSON.stringify(['task-select', 'header-select', 'effort-select']), JSON.stringify(order))
  const bar = await ev(`(() => { const b = document.querySelector('.chat-bar'); return b ? { role: b.getAttribute('role'), label: b.getAttribute('aria-label'), inBox: !!b.closest('.composer-inner'), afterText: !!b.closest('.composer-row')?.previousElementSibling?.matches('textarea.composer-input') } : null })()`)
  check('the chat bar is a named group INSIDE the message box, under the text, holding Instructions, Memory and Project; New chat, History and Tools are in the sidebar', bar !== null && bar.role === 'group' && bar.label === 'This chat' && bar.inBox && bar.afterText && JSON.stringify((await chatBtns()).map((b) => b.text)) === JSON.stringify(['New chat', 'History', 'Tools', 'Instructions', 'Memory', 'Project']), JSON.stringify(bar))
  check('the sidebar holds New chat, History and Tools', (await ev(`['New chat', 'History', 'Tools'].every((t) => [...document.querySelectorAll('.sidebar .chat-button')].some((b) => b.textContent === t))`)))
  check('the header is at the top of the chat area and ONE row (under 64 px high, every control on one line)', L.header.t === 0 && Math.abs(L.header.l - L.side.r) < 1 && oneRow(await headerShape()), JSON.stringify(await headerShape()))
  // (D-052) An empty chat holds the greeting and the box together in the middle (the box goes to the foot with the first message: verify-20-1w).
  check('an empty chat: the message box sits right under the greeting, inside the window, and the list starts under the header', L.composer.b <= L.vh && L.list.t >= L.header.b - 1 && Math.abs(L.list.b - L.composer.t) < 1, JSON.stringify({ composer: L.composer, list: L.list }))
  check('the first button of the bar is inside the message box, at its left', L.first.l >= L.box.l && L.first.l - L.box.l < 24, `button ${L.first.l} box ${L.box.l}`)
  check('the page does not scroll, and the chat area keeps at least 470 px of the 634', !L.scroll && L.chat.h >= 470, `chat ${Math.round(L.chat.h)}`)
  await page.screenshot(`${shots}/7-6-default.png`)

  // ============ B. the header stays ONE row, whatever is showing ============
  const menu = await H.menu()
  const rowsSeen = []
  for (const id of menu.values) {
    await H.chooseInPage(id)
    await H.settle(id)
    await sleep(250)
    const s = await headerShape()
    const badges = await H.badges()
    const openai = /^(gpt|gemini)-/.test(id) // (no key for either: since 17.2 Gemini's models show the badge as OpenAI's do)
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
  // the widest state: a task chosen (wide model menu) and both badges; with the sidebar open at the default width, and with the rail in narrower windows
  await setSel('.task-select', 'coding')
  await sleep(300)
  check('(the probes: a "Not saved" badge and a "No API key" badge are put in the header, only to measure)', (await addProbes()) === 2)
  const widest = async (width, how) => {
    await metrics(width)
    const s = await headerShape()
    check(`the widest state at ${width} px ${how} (a task chosen, both badges): the header still ONE row (${Math.round(s.h)} px) and the menus ONE line, none below 56 px`, oneRow(s) && ['task-select', 'header-select', 'effort-select'].every((k) => s.widths[k] >= 55.5), JSON.stringify(s))
  }
  await widest(886, 'with the sidebar open')
  await page.screenshot(`${shots}/7-6-widest.png`)
  // the tightest one-row widths beside the open sidebar (612 and 600 px of chat area; 872 and 860 px since D-052 made the sidebar 260 px): here the menus must give way more than the floor allows
  await widest(872, 'with the sidebar open')
  await widest(860, 'with the sidebar open')
  await page.send('Emulation.clearDeviceMetricsOverride')
  await sleep(300)
  await rail(true)
  await widest(800, 'with the rail')
  await widest(720, 'with the rail')
  await widest(700, '(a narrow window: always the rail)')
  // (D-052) a state where the menus cannot all fit at their full width (416 px of row for about 442 px of menus; at 560 px they still fit): they must give
  // way, staying on one line
  await widest(500, '(a narrow window: the menus give way)')
  await metrics(600)
  const below = await headerShape()
  check('with less than 600 px of chat area (a 600 px window) nothing scrolls sideways and every control is inside', !below.overflowX && below.inside, JSON.stringify(below))
  await page.send('Emulation.clearDeviceMetricsOverride')
  await sleep(300)
  await rail(false)
  check('(the probes are removed again)', (await removeProbes()) === 0)
  await setSel('.task-select', '')
  await sleep(300)
  check('and back to the default state the header is one row again', oneRow(await headerShape()))

  // ============ C. the buttons keep their rules ============
  await reset()
  let nc = await btn('New chat')
  check('an empty chat: New chat is off and says "This chat is empty."; History and Instructions are on, with their usual sentences', nc.disabled && nc.title === 'This chat is empty.' && !(await btn('History')).disabled && (await btn('History')).title === 'Open a saved chat, or delete one.' && !(await btn('Instructions')).disabled && /^Give the model instructions for this chat/.test((await btn('Instructions')).title), JSON.stringify(await chatBtns()))
  const first = await H.askMock('hello bar')
  nc = await btn('New chat')
  check('after a reply New chat is on and says the chat stays in History', first !== null && !nc.disabled && nc.title === 'Start a new chat. This one stays saved in History.', JSON.stringify(nc))
  await H.send('[[mock:slow]] busy')
  await page.waitFor(`!!document.querySelector('.composer-button-stop')`, { timeoutMs: 8000 })
  await sleep(300)
  let b = await chatBtns()
  check('while a reply arrives every one of them is off, New chat, History and Instructions each saying when they come back', b.every((x) => x.disabled) && (await btn('New chat')).title === 'A new chat can be started when the reply has finished.' && (await btn('History')).title === 'History can be opened when the reply has finished.' && (await btn('Instructions')).title === 'The instructions can be changed when the reply has finished.', JSON.stringify(b))
  await page.click('.chat-button@History').catch(() => {})
  await sleep(250)
  check('...and a click on History opens nothing', !(await dialogOpen('history')))
  await page.click('.composer-button')
  await page.waitFor(SEND_READY, { timeoutMs: 15000 })
  await sleep(300)
  b = await chatBtns()
  check('after Stop they are all on again', b.every((x) => !x.disabled), JSON.stringify(b.map((x) => x.disabled)))
  await page.click('.chat-button@History')
  await page.waitFor(`document.querySelector('dialog.history')?.open === true`, { timeoutMs: 6000 })
  await page.press('Escape')
  await sleep(250)
  check('History opens from the sidebar, Escape closes it, and the keyboard is back on the History button', !(await dialogOpen('history')) && (await btn('History')).focused, JSON.stringify(await btn('History')))
  await page.click('.chat-button@Instructions')
  await page.waitFor(`document.querySelector('dialog.instructions')?.open === true && !!document.querySelector('dialog.instructions textarea')`, { timeoutMs: 6000 })
  await page.press('Escape')
  await sleep(250)
  check('Instructions opens from the message box, Escape closes it, and the keyboard is back on the Instructions button', !(await dialogOpen('instructions')) && (await btn('Instructions')).focused, JSON.stringify(await btn('Instructions')))
  await page.click('.chat-button@Instructions')
  await page.waitFor(`document.querySelector('dialog.instructions')?.open === true && !!document.querySelector('dialog.instructions textarea')`, { timeoutMs: 6000 })
  await ev(`document.querySelector('dialog.instructions textarea').focus()`)
  await page.type('be brief')
  await sleep(150)
  await page.click('dialog.instructions button[type=submit]')
  await page.waitFor(`document.querySelector('dialog.instructions')?.open !== true`, { timeoutMs: 6000 })
  await sleep(250)
  const ins = await btn('Instructions')
  check('after Save the Instructions button reads "Instructions on", with the mark, and its tooltip says how long they are (8 characters)', ins.text === 'Instructions on' && ins.mark === 'on' && /^Instructions are on for this chat \(8 characters\)/.test(ins.title), JSON.stringify(ins))
  check('the bar is still one line at the default width, and the header did not change', (await ev(`new Set([...document.querySelectorAll('.chat-bar .chat-button')].map((e) => Math.round(e.getBoundingClientRect().top))).size`)) === 1 && oneRow(await headerShape()))
  await page.screenshot(`${shots}/7-6-instructions-on.png`)

  // ============ D. the keyboard: the sidebar, the header, the messages, then the box ============
  await ev(`document.querySelector('.composer-input').focus()`)
  await page.type('x')
  await sleep(100)
  const domOrder = await ev(`[...document.querySelectorAll('select, button:not(:disabled), textarea')].filter((e) => !e.closest('dialog') && !e.closest('.sidebar-recent')).map((e) => e.classList.contains('chat-button') ? 'chat:' + e.textContent.replace(/ on$/, '') : e.classList.contains('composer-input') ? 'input' : e.classList.contains('composer-button') ? 'send' : e.classList.contains('header-button') ? 'settings' : e.className.split(' ')[0])`)
  const at = (k) => domOrder.indexOf(k)
  // (D-052) The menus are under the box: they come after Send, and are the last of the page.
  check('in the order the keyboard goes: the sidebar (New chat, History, Tools, Settings), the messages, the box (the text, Attach..., Instructions, Memory, Project, Send), then the menus under it (Task, model, Effort), last', at('chat:New chat') < at('chat:History') && at('chat:History') + 1 === at('chat:Tools') && at('chat:Tools') < at('settings') && at('settings') < at('input') && at('send') + 1 === at('task-select') && at('task-select') + 1 === at('header-select') && at('header-select') + 1 === at('effort-select') && at('effort-select') === domOrder.length - 1 && at('input') + 1 === at('chat:Attach...') && at('chat:Attach...') + 1 === at('chat:Instructions') && at('chat:Instructions') + 1 === at('chat:Memory') && at('chat:Memory') + 1 === at('chat:Project') && at('chat:Project') < at('send'), JSON.stringify(domOrder))
  const walk = []
  for (let i = 0; i < 6; i++) { await page.press('Tab'); walk.push(await active()) } // (21.4) Enhance comes before Send
  check('Tab from the text goes Attach..., Instructions on, Memory, Project, Enhance (21.4), then Send', JSON.stringify(walk) === JSON.stringify(['Attach...', 'Instructions on', 'Memory', 'Project', 'composer-enhance', 'Send']), JSON.stringify(walk))
  const back = []
  for (let i = 0; i < 3; i++) { await page.press('Tab', { shift: true }); back.push(await active()) }
  check('and Shift+Tab goes back the same way (Enhance first, 21.4)', JSON.stringify(back) === JSON.stringify(['composer-enhance', 'Project', 'Memory']), JSON.stringify(back))
  await page.click('.chat-button@New chat')
  await page.waitFor(`document.querySelectorAll('.message-list-inner > .message').length === 0`, { timeoutMs: 6000 })
  await sleep(300)
  check('New chat empties the chat, puts the keyboard in the message box, and the new chat starts without instructions (no mark)', (await ev(`document.activeElement?.classList.contains('composer-input')`)) && (await btn('Instructions')).text === 'Instructions' && (await btn('Instructions')).mark === null && (await btn('New chat')).disabled, JSON.stringify(await chatBtns()))

  // ============ E. narrow windows: the bar wraps instead of overflowing ============
  await page.click('.chat-button@Instructions')
  await page.waitFor(`document.querySelector('dialog.instructions')?.open === true && !!document.querySelector('dialog.instructions textarea')`, { timeoutMs: 6000 })
  await ev(`document.querySelector('dialog.instructions textarea').focus()`)
  await page.type('be brief')
  await page.click('dialog.instructions button[type=submit]')
  await page.waitFor(`document.querySelector('dialog.instructions')?.open !== true`, { timeoutMs: 6000 })
  await sleep(250)
  for (const width of [420, 320, 280]) { // 280: where the buttons and the mark no longer fit one line, so a bar that cannot wrap would spill out of the window
    await metrics(width, 700)
    // In the box, the bar's buttons and Send must each be inside the box and none may lie over another: a bar that cannot wrap pushes its last buttons over Send or out of the box.
    const n = await ev(`(() => { const bs = [...document.querySelectorAll('.chat-button')].filter((e) => e.getBoundingClientRect().width > 0).map((e) => e.getBoundingClientRect()); const box = document.querySelector('.composer-inner').getBoundingClientRect(); const bar = document.querySelector('.chat-bar').getBoundingClientRect();
      const inBox = [...document.querySelectorAll('.chat-bar .chat-button, .composer-button')].map((e) => e.getBoundingClientRect()).filter((r) => r.width > 0)
      const overlap = (a, b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1
      return { overflowX: document.documentElement.scrollWidth > innerWidth, inside: bs.every((r) => r.left >= 0 && r.right <= innerWidth), boxInside: box.left >= 0 && box.right <= innerWidth && box.bottom <= innerHeight, barInBox: bar.left >= box.left && bar.right <= box.right + 0.5 && bar.bottom <= box.bottom,
        buttonsInBox: inBox.every((r) => r.left >= box.left - 0.5 && r.right <= box.right + 0.5), noOverlap: inBox.every((a, i) => inBox.every((b, j) => i === j || !overlap(a, b))),
        // a bar that cannot wrap squeezes its buttons instead (they may shrink, for a long project name): none may be narrower than what it holds
        notSqueezed: [...document.querySelectorAll('.chat-bar .chat-button')].every((b) => b.scrollWidth <= b.clientWidth + 1),
        rows: new Set([...document.querySelectorAll('.chat-bar .chat-button')].map((e) => Math.round(e.getBoundingClientRect().top))).size, oneLine: bs.every((r) => r.height <= 40) } })()`)
    check(`at ${width} px, with the "on" mark, there is no sideways scroll, every button is inside the window and keeps its label on ONE line (the bar wraps as a row, not inside a button), and the bar, its buttons and Send stay inside the box, none over another and none squeezed (${n.rows} row${n.rows === 1 ? '' : 's'} of buttons)`, !n.overflowX && n.inside && n.oneLine && n.boxInside && n.barInBox && n.buttonsInBox && n.noOverlap && n.notSqueezed, JSON.stringify(n))
    await page.screenshot(`${shots}/7-6-narrow-${width}.png`)
  }
  await page.send('Emulation.clearDeviceMetricsOverride')
  await sleep(300)
  check('no console errors, warnings, exceptions or CSP violations in the whole run', page.problems.length === 0, page.problems.join(' | '))
} catch (error) {
  check(`the suite ran to its end (it stopped: ${String(error?.message ?? error).slice(0, 240)})`, false)
  try {
    console.log('page at the stop: ' + JSON.stringify(await ev(`({ vw: innerWidth, header: document.querySelector('.app-header')?.getBoundingClientRect().height, buttons: [...document.querySelectorAll('.chat-button')].map((b) => b.textContent + (b.disabled ? '(off)' : '')), dialogs: [...document.querySelectorAll('dialog')].map((d) => d.className + ':' + d.open), active: document.activeElement?.tagName + '.' + document.activeElement?.className, probes: document.querySelectorAll('.probe').length })`)))
  } catch { /* the page is gone */ }
}
process.exit(check.summary() ? 0 : 1)
