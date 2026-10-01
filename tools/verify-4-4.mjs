// Slice 4.3/4.4: a LONG list. 150 saved conversations (made through the real IPC, as the page could) in the real
// window: does the History dialog keep its heading and Close button in view, scroll the list inside itself, stay
// usable by keyboard, and open quickly, at the default window size and at 420 and 320 pixels?
// Needs: MOCK_PORT, USER_DATA_DIR (scratch profile), APP_LOG.
import './ts-resolve.mjs'
import { connect, checker, sleep } from './cdp.mjs'
import { assertScratchProfile } from './profile-guard.mjs'
import { h4 } from './lib4.mjs'

const shots = process.argv[2]
const port = Number(process.argv[3] ?? 9222)
const { MOCK_PORT, USER_DATA_DIR: userData } = process.env
const N = 150
const check = checker()
const page = await connect(port)
await assertScratchProfile()
const H = h4(page, { userData, mockUrl: `http://127.0.0.1:${MOCK_PORT}` })
const ev = H.ev
await page.waitFor(`!!document.querySelector('.header-select, .app-badge')`, { timeoutMs: 20000 })
await sleep(500)

const t0 = Date.now()
const made = await ev(`(async () => {
  let ok = 0
  for (let i = 1; i <= ${N}; i++) {
    const r = await window.api.history.save({ id: crypto.randomUUID(), messages: [{ role: 'user', content: 'Conversation number ' + i + ' with a title that is long enough to be cut off in a narrow dialog somewhere', status: 'done' }, { role: 'assistant', content: 'Answer ' + i, status: 'done' }] })
    if (r.ok) ok++
    await new Promise((r) => setTimeout(r, 2)) // distinct dates
  }
  return ok
})()`)
console.log(`  (info) ${N} conversations saved through the IPC in ${Date.now() - t0} ms`)
check(`${N} conversations were saved`, made === N && H.convFiles().length === N, `${made} saved, ${H.convFiles().length} files`)
check('no stray files from all those saves', H.strays().length === 0)

// a restart-free reload so the page's list is read from main afresh
await page.send('Page.reload')
await sleep(500)
await page.waitFor(`!!document.querySelector('.header-select, .app-badge')`, { timeoutMs: 20000 })
await sleep(500)
const list = await ev(`window.api.history.list()`)
check(`list() returns all ${N}, newest first`, list.conversations.length === N && list.conversations.every((c, i, a) => i === 0 || a[i - 1].updatedAt >= c.updatedAt) && /number 150/.test(list.conversations[0].title), `${list.conversations.length}; first: ${list.conversations[0]?.title.slice(0, 30)}`)

for (const [width, height] of [[900, 670], [420, 700], [320, 700]]) {
  await page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })
  await sleep(300)
  const tOpen = Date.now()
  await H.clickHeader('History')
  await page.waitFor(`!!document.querySelector('dialog.history')?.open && document.querySelectorAll('dialog.history .history-row').length === ${N}`, { timeoutMs: 8000 })
  const openMs = Date.now() - tOpen
  await sleep(150)
  const g = await ev(`(() => {
    const d = document.querySelector('dialog.history'), list = d.querySelector('.history-list'), close = d.querySelector('.history-footer button'), head = d.querySelector('.history-heading')
    const rect = (e) => { const r = e.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right) } }
    return { win: { w: window.innerWidth, h: window.innerHeight }, dialog: rect(d), list: rect(list), close: rect(close), head: rect(head), listScrolls: list.scrollHeight > list.clientHeight, listClient: list.clientHeight, dialogScrolls: d.scrollHeight > d.clientHeight + 1, rows: list.children.length }
  })()`)
  const inside = (r) => r.top >= 0 && r.bottom <= g.win.h && r.left >= 0 && r.right <= g.win.w
  check(`${width}x${height}: the dialog fits the window`, inside(g.dialog), JSON.stringify(g.dialog))
  check(`${width}x${height}: the heading and the Close button are both in view without scrolling anything`, inside(g.head) && inside(g.close), `head ${JSON.stringify(g.head)} close ${JSON.stringify(g.close)}`)
  check(`${width}x${height}: the LIST scrolls inside the dialog (${N} rows), the dialog itself does not`, g.listScrolls && !g.dialogScrolls && g.listClient >= 96, JSON.stringify({ listScrolls: g.listScrolls, dialogScrolls: g.dialogScrolls, listClient: g.listClient }))
  check(`${width}x${height}: opening it with ${N} rows takes under 1.5 s`, openMs < 1500, `${openMs} ms`)
  await page.screenshot(`${shots}/4-4-${width}.png`)
  if (width === 900) {
    // scroll the list to the very end and open the last row: it is reachable by mouse
    await ev(`(() => { const l = document.querySelector('dialog.history .history-list'); l.scrollTop = l.scrollHeight })()`)
    await sleep(150)
    const lastTitle = await ev(`[...document.querySelectorAll('dialog.history .history-title')].at(-1).textContent`)
    const lastVisible = await ev(`(() => { const l = document.querySelector('dialog.history .history-list').getBoundingClientRect(); const r = [...document.querySelectorAll('dialog.history .history-open')].at(-1).getBoundingClientRect(); return r.top >= l.top && r.bottom <= l.bottom + 1 })()`)
    check('scrolled to the end, the oldest conversation is fully visible inside the list', lastVisible && /number 1 /.test(lastTitle), lastTitle)
    await H.clickRow(lastTitle)
    await page.waitFor(`!document.querySelector('dialog.history')?.open`)
    await sleep(250)
    const screen = await H.screen()
    check('clicking the oldest one opens it (2 messages, the first is "Conversation number 1 ...")', screen.length === 2 && /^Conversation number 1 /.test(screen[0].text), JSON.stringify(screen.map((m) => m.text.slice(0, 24))))
    await H.openHistory()
  }
  // keyboard: Tab from the first row eventually reaches Close, and Escape closes
  await ev(`document.querySelector('dialog.history .history-open').focus()`)
  let reached = false
  for (let i = 0; i < 2 * N + 6 && !reached; i++) {
    await page.press('Tab')
    reached = await ev(`document.activeElement?.textContent === 'Close'`)
  }
  check(`${width}x${height}: Tab from the first row reaches Close (the dialog is not a keyboard trap, even with ${N} rows)`, reached)
  await page.press('Escape')
  await sleep(250)
  check(`${width}x${height}: Escape closes it and focus returns to the History button`, !(await H.historyOpen()) && (await H.focusedText()) === 'History', await H.focusedText())
}
await page.send('Emulation.clearDeviceMetricsOverride')
check('no console errors, warnings or exceptions in the page', page.problems.length === 0, page.problems.join(' | '))
const passed = check.summary()
page.close()
process.exit(passed ? 0 : 1)
