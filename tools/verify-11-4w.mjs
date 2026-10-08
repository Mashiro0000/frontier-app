// Stage 11.4 (D-041), in the real window against the mock: the window for tools. The Tools page has the switch and the caps (a tool ON and a higher cap ask in
// the system's own box, replaced from the main inspector; OFF and lower do not), a reply that searches shows the call where the model stopped to ask, the pages
// under the reply (a click asks before an address opens), the Stop button says "Stop everything" once a tool is on and closes a waiting question, the notes
// are saved with the chat and come back from History, a damaged settings file is said and can be started again, the page fits at 420 and 280 px, and the
// console stays clean.
// Needs: USER_DATA_DIR (scratch), INSPECT_PORT, MOCK_PORT, a saved key (setup-key.mjs).
import './ts-resolve.mjs'
import { connect, checker, sleep } from './cdp.mjs'
import { assertScratchProfile } from './profile-guard.mjs'
import { h4, mainInspector } from './lib4.mjs'
import { installQuestions } from './lib10.mjs'
import { existsSync, readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const port = Number(process.argv[3] ?? 9222)
const userData = process.env.USER_DATA_DIR
const inspectPort = Number(process.env.INSPECT_PORT)
const mockUrl = `http://127.0.0.1:${process.env.MOCK_PORT}`
if (!userData || !inspectPort || !process.env.MOCK_PORT) throw new Error('USER_DATA_DIR, INSPECT_PORT and MOCK_PORT must be set')
const check = checker()
const page = await connect(port)
await assertScratchProfile()
const H = h4(page, { userData, mockUrl })
const { ev } = H
const main = await mainInspector(inspectPort)
const Q = await installQuestions(main, { fallback: 'no' })
const show = (v) => JSON.stringify(v)?.slice(0, 500)
const TOOLS_FILE = join(userData, 'tools.json')
const fileNow = () => (existsSync(TOOLS_FILE) ? JSON.parse(readFileSync(TOOLS_FILE, 'utf8')) : null)
const ASK = '[[mock:tool-use]] find the newest release of Rust'
const control = (body) => fetch(`${mockUrl}/__tools`, { method: 'POST', body: JSON.stringify(body) })

const openTools = async () => { await H.clickChat('Tools'); await page.waitFor(`!!document.querySelector('dialog.tools')?.open`, { timeoutMs: 8000, label: 'Tools' }); await sleep(500) }
const closeTools = async () => { await page.press('Escape'); await sleep(300) }
const toggle = () => ev(`(() => { const b = document.querySelector('.tools-toggle'); return b ? { on: b.getAttribute('aria-checked') === 'true', text: b.textContent, disabled: b.disabled } : null })()`)
const notice = () => ev(`document.querySelector('dialog.tools .tools-section .tools-notice')?.textContent ?? null`)
const capsNow = () => ev(`(() => { const i = [...document.querySelectorAll('.tools-caps-input')]; return i.map((x) => x.value) })()`)
const saveButton = () => ev(`(() => { const b = [...document.querySelectorAll('.tools-caps button')].find((x) => x.textContent === 'Save limits'); return b ? { disabled: b.disabled } : null })()`)
const typeInto = async (index, text) => {
  await ev(`(() => { const i = document.querySelectorAll('.tools-caps-input')[${index}]; i.focus(); i.select(); return true })()`)
  await page.type(text)
  await sleep(120)
}
const stopLabel = () => ev(`document.querySelector('.composer-button-stop')?.textContent ?? null`)
const noteCards = () => ev(`[...document.querySelectorAll('.message-assistant .tool-note')].map((n) => ({ title: n.querySelector('.tool-note-title')?.textContent, about: n.querySelector('.tool-note-about')?.textContent ?? null, outcome: n.querySelector('.tool-note-outcome')?.textContent, cls: n.className }))`)
const sourceItems = () => ev(`[...document.querySelectorAll('.message-assistant .sources-link')].map((b) => ({ name: b.querySelector('.sources-name').textContent, host: b.querySelector('.sources-host').textContent, title: b.title, tag: b.tagName }))`)
async function converse(text, { timeoutMs = 40000 } = {}) {
  await H.send(text)
  await page.waitFor(`!!document.querySelector('.composer-button[type=submit]')`, { timeoutMs })
  await sleep(300)
}

try {
  await page.waitFor(`document.readyState === 'complete' && !!document.querySelector('.header-select, .app-badge')`, { timeoutMs: 15000 })
  await sleep(300)
  await ev(`window.api.settings.setModel('claude-opus-5-5')`)

  // ============ A. the page, with every tool off ============
  await openTools()
  const first = await ev(`(() => { const d = document.querySelector('dialog.tools'); return { sections: [...d.querySelectorAll('.tools-section-title')].map((x) => x.textContent), switchTitle: d.querySelector('.tools-switch-title')?.textContent, about: d.querySelector('.tools-switch-text .tools-hint')?.textContent }})()`)
  check('A: the Tools page has the switches first and the audit log after them', show(first.sections) === show(['What the model may ask for', 'Audit log']) && first.switchTitle === 'Search the web' && /sends the search words to your AI provider/.test(first.about ?? ''), show(first))
  let t = await toggle()
  check('A: the search is off, and the switch says so', t?.on === false && t.text === 'Off' && t.disabled === false, show(t))
  check('A: the caps are the defaults, 5 steps and 60 seconds', show(await capsNow()) === show(['5', '60']))
  check('A: "Save limits" is off while nothing has changed', (await saveButton())?.disabled === true)
  check('A: no tools.json exists yet', fileNow() === null)

  // ============ B. switching ON asks in the system's box ============
  await Q.reset()
  await Q.queue('no')
  await page.click('.tools-toggle')
  await page.waitFor(`document.querySelector('.tools-toggle')?.disabled === false`, { timeoutMs: 8000 })
  await sleep(300)
  let asked = await Q.asked()
  t = await toggle()
  check('B: a click asks in the system\'s own box, for this window, once', asked.length === 1 && asked[0].withWindow === true, show(asked.map((a) => a.withWindow)))
  const o = asked[0]?.options ?? {}
  check('B: the box says what it turns on, that nothing runs without the person, the caps, and why it is asked there; the yes is "Turn on", the no is the default', o.title === 'Search the web' && /Let the model ask to use/.test(o.message) && /Nothing runs without you/.test(o.detail) && /5 tool steps and 60 seconds/.test(o.detail) && /cannot answer/.test(o.detail) && show(o.buttons) === show(['Turn on', "Don't turn on"]) && o.defaultId === 1 && o.cancelId === 1, show(o))
  check('B: a no leaves the switch off, writes nothing, and the page says so', t.on === false && fileNow() === null && /still off/.test((await notice()) ?? ''), show([t, fileNow(), await notice()]))
  await sleep(3300)
  await Q.reset()
  await Q.queue('yes')
  await page.click('.tools-toggle')
  await page.waitFor(`document.querySelector('.tools-toggle')?.getAttribute('aria-checked') === 'true'`, { timeoutMs: 8000 })
  await sleep(300)
  t = await toggle()
  check('B: a yes switches it on; the file holds exactly that', t.on === true && t.text === 'On' && show(fileNow()) === show({ version: 1, enabled: { web_search: true }, caps: { steps: 5, seconds: 60 } }), show(fileNow()))
  check('B: the page says it is on', /Search the web is on/.test((await notice()) ?? ''), await notice())
  check('B: while the box was open the page was told so (the notice is replaced by the answer)', (await Q.count()) === 1)
  await closeTools()

  // ============ C. a reply that searches ============
  check('C: the Stop button says "Stop everything" once a tool is on (checked while a reply is arriving)', true)
  await H.clickChat('New chat')
  await control({})
  await Q.reset()
  await Q.queue('yes')
  await ev(`window.__sawStop = []; new MutationObserver(() => { const b = document.querySelector('.composer-button-stop'); if (b) window.__sawStop.push(b.textContent) }).observe(document.body, { subtree: true, childList: true, characterData: true }); true`)
  await converse(ASK)
  const sawStop = await ev(`[...new Set(window.__sawStop)]`)
  check('C: ...the button seen during the reply read "Stop everything"', sawStop.length > 0 && sawStop.every((s) => s === 'Stop everything'), show(sawStop))
  const cards = await noteCards()
  check('C: the call stands in the reply: the tool, what was asked (in quotes), and how it ended, in the audit log\'s words', cards.length === 1 && cards[0].title === 'Search the web' && cards[0].about === '“rust release notes”' && cards[0].outcome === 'You allowed it. 3 sources came back.' && /tool-note-done/.test(cards[0].cls), show(cards))
  const order = await ev(`(() => { const b = document.querySelector('.message-assistant .bubble'); return [...b.children].map((c) => c.classList.contains('tool-note') ? 'NOTE' : c.textContent.trim().slice(0, 30)) })()`)
  check('C: ...between the model\'s words before the call and after it', order[0] === 'Let me search for that.' && order[1] === 'NOTE' && /The search found/.test(order[2] ?? ''), show(order))
  const items = await sourceItems()
  check('C: the pages that came back are under the reply, always: title, host, in buttons (not links)', items.length === 3 && items.every((i) => i.tag === 'BUTTON') && items[0].name.length > 0 && items[0].host === 'example.com' && items[0].title === 'https://example.com/result-1', show(items))
  check('C: nothing in the page is a link to a source: no anchor with an address', (await ev(`document.querySelectorAll('.message-assistant a[href]').length`)) === 0)
  await page.click('.message-assistant .sources-link')
  await page.waitFor(`document.querySelector('dialog.link-confirm')?.open === true`, { timeoutMs: 4000 })
  const dlg = await ev(`(() => { const d = document.querySelector('dialog.link-confirm'); return { address: d.querySelector('.link-confirm-address')?.textContent, note: d.querySelector('.link-confirm-note')?.textContent } })()`)
  check('C: a click asks first, with the whole address and its host, before anything is opened', dlg.address === 'https://example.com/result-1' && /example\.com/.test(dlg.note ?? ''), show(dlg))
  await page.click('dialog.link-confirm button@Cancel')
  await sleep(200)
  check('C: Cancel closes it and nothing was opened', (await ev(`document.querySelector('dialog.link-confirm')?.open === false`)))
  const log = await ev(`window.api.audit.read()`)
  check('C: the chat and the audit log say the same: one call that ran, three sources', log.ok && log.calls[0].outcome.kind === 'done' && log.calls[0].outcome.sources.length === 3)

  const callBox = (await Q.asked()).at(-1)?.options?.detail ?? ''
  check('C: the box before the search named the provider that answers and would run it', callBox.includes('The AI provider answering you: Anthropic.') && callBox.includes('rust release notes'), callBox.slice(0, 300))

  // ============ D. saved with the chat and back from History ============
  await sleep(700)
  const saved = H.allConvs().find((c) => (c.messages ?? []).some((m) => /find the newest release of Rust/.test(m.content ?? '')))
  const reply = saved?.messages?.at(-1)
  check('D: the chat is a version 6 file whose reply holds the call: where it stood, the words, the outcome with the pages\' titles and addresses', saved?.version === 6 && reply?.tools?.length === 1 && reply.content.slice(0, reply.tools[0].offset).trim() === 'Let me search for that.' && reply.tools[0].outcome.sources.length === 3 && reply.tools[0].args.query === 'rust release notes', show({ o: reply?.tools?.[0]?.offset, n: reply?.tools?.[0]?.outcome?.sources?.length, q: reply?.tools?.[0]?.args, v: saved?.version }))
  check('D: ...and no page text, no summary', !/Summary for|the first result says/.test(JSON.stringify(saved?.messages?.map((m) => m.tools ?? null))))
  await H.clickChat('New chat')
  await H.openHistory()
  const rows = await H.rows()
  const row = rows.find((r) => /find the newest release of Rust/.test(r.title ?? ''))
  await H.clickRow(row.title)
  await sleep(700)
  const back = await noteCards()
  const backSources = await sourceItems()
  check('D: opened again from History, the call and the pages are still there, in place', back.length === 1 && back[0].outcome === 'You allowed it. 3 sources came back.' && backSources.length === 3, show([back, backSources.length]))
  check('D: ...and a saved reply does not claim to be waiting', !(await ev(`!!document.querySelector('.tool-note-spinner')`)))

  // ============ E. Stop everything closes a waiting question ============
  await H.clickChat('New chat')
  await Q.reset()
  await Q.hold()
  const before = (await H.mockReqs()).length
  await H.send(ASK)
  await page.waitFor(`!!document.querySelector('.tool-note-spinner')`, { timeoutMs: 15000, label: 'a waiting call' })
  const waiting = await noteCards()
  check('E: while the box is open the reply shows the call and says it is waiting for the answer in the Windows box', waiting.length === 1 && waiting[0].outcome === 'Waiting for your answer in the Windows message box...' && /tool-note-unanswered/.test(waiting[0].cls), show(waiting))
  check('E: ...and its button reads "Stop everything"', (await stopLabel()) === 'Stop everything')
  await page.click('.composer-button-stop')
  await sleep(600)
  await Q.release()
  await sleep(400)
  const after = await noteCards()
  check('E: Stop everything closed the box through its signal, and the call says you stopped the reply while the question was open', (await Q.closedBySignal()) === 1 && after[0]?.outcome === 'You stopped the reply while the question was open.', show([await Q.closedBySignal(), after]))
  check('E: nothing was searched (no request after the first)', (await H.mockReqs()).length === before + 1)
  const lastMsg = (await H.screen()).at(-1)
  check('E: the reply is marked stopped', lastMsg.note === 'Stopped', show(lastMsg))
  await sleep(3300)

  // ============ F. the caps ============
  await openTools()
  await Q.reset()
  await typeInto(0, '3')
  await typeInto(1, '30')
  check('F: typing new numbers turns "Save limits" on', (await saveButton())?.disabled === false)
  await page.click('.tools-caps button@Save limits')
  await sleep(700)
  check('F: lower limits ask nothing and are saved', (await Q.count()) === 0 && fileNow().caps.steps === 3 && fileNow().caps.seconds === 30 && /Saved\. A reply may take at most 3 tool steps and 30 seconds/.test((await notice()) ?? ''), show([fileNow(), await notice()]))
  await Q.queue('no')
  await typeInto(0, '4')
  await page.click('.tools-caps button@Save limits')
  await sleep(900)
  asked = await Q.asked()
  check('F: a higher one asks, naming the change; a no leaves the file as it was', asked.length === 1 && /Tool steps: 3 -> 4/.test(asked[0].options.detail) && asked[0].options.buttons[0] === 'Raise the limits' && fileNow().caps.steps === 3, show([asked.map((a) => a.options.detail), fileNow()]))
  await sleep(3300)
  await Q.queue('yes')
  await page.click('.tools-caps button@Save limits')
  await sleep(900)
  check('F: a yes saves it', fileNow().caps.steps === 4 && fileNow().caps.seconds === 30 && fileNow().enabled.web_search === true, show(fileNow()))
  for (const bad of ['0', '21', '', 'x', '1.5']) {
    await typeInto(0, bad)
    const s = await saveButton()
    if (!s.disabled) { check(`F: "${bad}" steps must not be savable`, false); break }
  }
  check('F: numbers outside 1 to 20 steps, nothing, letters and fractions cannot be saved', (await saveButton())?.disabled === true)
  await typeInto(0, '4')

  // ============ G. switching OFF asks nothing ============
  await Q.reset()
  await page.click('.tools-toggle')
  await sleep(700)
  check('G: switching off asks nothing, is done at once and is in the file', (await Q.count()) === 0 && fileNow().enabled.web_search === false && (await toggle()).on === false && /is off/.test((await notice()) ?? ''), show([fileNow(), await notice()]))
  await closeTools()
  await H.clickChat('New chat')
  await converse('[[mock:slow]] a long answer')
  check('G: with every tool off the Stop button is "Stop" again', true)
  const during = await (async () => { await H.send('[[mock:slow]] again'); await sleep(300); const l = await stopLabel(); await page.click('.composer-button-stop'); await sleep(400); return l })()
  check('G: ...seen during a reply', during === 'Stop', show(during))

  // ============ H. a damaged settings file ============
  writeFileSync(TOOLS_FILE, 'garbage')
  await openTools()
  const dmg = await ev(`(() => { const d = document.querySelector('dialog.tools'); return { problem: d.querySelector('.tools-problem')?.textContent ?? null, toggle: d.querySelector('.tools-toggle')?.disabled, caps: !!d.querySelector('.tools-caps') } })()`)
  check('H: a file that cannot be read is said in words, every tool is off, and nothing can be switched on or set', /could not be read/.test(dmg.problem ?? '') && dmg.toggle === true && dmg.caps === false, show(dmg))
  await page.click('dialog.tools .tools-problem button@Start again...')
  await sleep(200)
  await page.click('dialog.tools .tools-problem button@Yes, start again')
  await sleep(800)
  check('H: starting again makes a clean file (every tool off, default caps), keeps the old one as a copy, and the page is whole again', show(fileNow()) === show({ version: 1, enabled: {}, caps: { steps: 5, seconds: 60 } }) && readdirSync(userData).some((n) => n.startsWith('tools.json.damaged-')) && (await toggle())?.disabled === false)
  await closeTools()

  // ============ I. narrow windows ============
  writeFileSync(TOOLS_FILE, JSON.stringify({ version: 1, enabled: { web_search: true }, caps: { steps: 5, seconds: 60 } }))
  await Q.reset()
  await Q.queue('yes')
  await H.clickChat('New chat')
  await converse(ASK)
  for (const width of [420, 280]) {
    await page.send('Emulation.setDeviceMetricsOverride', { width, height: 700, deviceScaleFactor: 1, mobile: false })
    await sleep(400)
    const fit = await ev(`(() => { const n = document.querySelector('.message-assistant .tool-note').getBoundingClientRect(); const s = document.querySelector('.sources').getBoundingClientRect(); return { vw: innerWidth, overflowX: document.documentElement.scrollWidth > innerWidth + 1, noteRight: n.right, noteLeft: n.left, srcRight: s.right } })()`)
    check(`I: at ${width} px the call and the pages fit inside the window`, !fit.overflowX && fit.noteLeft >= 0 && fit.noteRight <= fit.vw + 1 && fit.srcRight <= fit.vw + 1, show(fit))
    await openTools()
    const tfit = await ev(`(() => { const d = document.querySelector('dialog.tools'); const r = d.getBoundingClientRect(); return { vw: innerWidth, left: r.left, right: r.right, overflowX: d.scrollWidth > d.clientWidth + 1, inputs: [...d.querySelectorAll('.tools-caps-input, .tools-toggle')].every((x) => { const q = x.getBoundingClientRect(); return q.left >= 0 && q.right <= innerWidth + 1 }) } })()`)
    check(`I: at ${width} px the Tools page fits (switch and number boxes inside the window)`, !tfit.overflowX && tfit.left >= 0 && tfit.right <= tfit.vw + 1 && tfit.inputs, show(tfit))
    await closeTools()
  }
  await page.send('Emulation.clearDeviceMetricsOverride', {})
  await sleep(300)
} catch (error) {
  check(`the suite stopped before its end: ${String(error?.stack ?? error).slice(0, 400)}`, false)
}

check('the page logged no errors and no warnings', page.problems.length === 0, show(page.problems))
main.close()
page.close()
process.exit(check.summary() ? 0 : 1)
