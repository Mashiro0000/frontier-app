// Stage 14.6 (D-045), in the real window against the mock, with the REAL box: connectors. The Tools page has a "Connectors" section (the file dialog and the system's message box are
// replaced from the main inspector). Adding a program asks in the box with the exact command; "Check its tools" starts it in the box and lists its tools with the connector's own words
// and what is not offered; switching a tool on asks; a reply that calls it asks for that call, runs it in the box and labels what came back; the chat and the audit log say so; the
// page can only ask (it never names a program or sees a token); a web address with a token is added without the token ever coming back to the page; removing asks; the page fits at
// 420 and 280 px, and the console stays clean.
// Needs: USER_DATA_DIR (scratch), INSPECT_PORT, MOCK_PORT, FRONTIER_CONNECTOR_ROOT (the connectors' folder of runs, inside this run's own folder), a saved key (setup-key.mjs).
import './temp-on-a.mjs'
import './ts-resolve.mjs'
import { connect, checker, sleep } from './cdp.mjs'
import { assertScratchProfile } from './profile-guard.mjs'
import { h4, mainInspector } from './lib4.mjs'
import { installQuestions } from './lib10.mjs'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TOOLS } from './paths.mjs'

const port = Number(process.argv[3] ?? 9222)
const userData = process.env.USER_DATA_DIR
const inspectPort = Number(process.env.INSPECT_PORT)
const mockUrl = `http://127.0.0.1:${process.env.MOCK_PORT}`
const CONNECTORS = process.env.FRONTIER_CONNECTOR_ROOT
if (!userData || !inspectPort || !process.env.MOCK_PORT || !CONNECTORS) throw new Error('USER_DATA_DIR, INSPECT_PORT, MOCK_PORT and FRONTIER_CONNECTOR_ROOT must be set')
const check = checker()
class Done extends Error {}
const part = (id) => { if (process.env.STOP_AFTER === id) throw new Done(id) }
const page = await connect(port)
await assertScratchProfile()
const H = h4(page, { userData, mockUrl })
const { ev } = H
const main = await mainInspector(inspectPort)
const Q = await installQuestions(main, { fallback: 'no' })
const show = (v) => JSON.stringify(v)?.slice(0, 600)
const FILE = join(userData, 'connectors.json')
const TOKEN = 'tok-window-check-5b1e8d'
const control = (body) => fetch(`${mockUrl}/__tools`, { method: 'POST', body: JSON.stringify(body) })

// the connector: the reference server in a folder of its own (with a package.json), in this run's own temp folder
const SERVER_DIR = join(realpathSync.native(mkdtempSync(join(tmpdir(), 'frontier-146w-'))), 'ref')
mkdirSync(SERVER_DIR, { recursive: true })
writeFileSync(join(SERVER_DIR, 'package.json'), '{"name":"ref","type":"module"}')
const PROGRAM = join(SERVER_DIR, 'ref-server.mjs')
copyFileSync(join(TOOLS, 'fixtures14', 'ref-server.mjs'), PROGRAM)
await main.inMain(`(() => { const { dialog } = process.mainModule.require('electron'); const p = globalThis.__pick = { next: null, calls: [] }; dialog.showOpenDialog = async (...args) => { p.calls.push({ options: args.at(-1) }); return p.next === null ? { canceled: true, filePaths: [] } : { canceled: false, filePaths: [p.next] } }; return true })()`)
const pick = (path) => main.inMain(`globalThis.__pick.next = ${JSON.stringify(path)}; true`)
const pickCalls = async () => JSON.parse(await main.inMain('JSON.stringify(globalThis.__pick.calls)'))

const openTools = async () => { await H.clickChat('Tools'); await page.waitFor(`!!document.querySelector('dialog.tools')?.open`, { timeoutMs: 8000, label: 'Tools' }); await sleep(500) }
const closeTools = async () => { await page.press('Escape'); await sleep(300) }
const SECTION = `[...document.querySelectorAll('dialog.tools .tools-section')].find((x) => x.querySelector('#tools-connectors-title'))`
const view = () => ev(`(() => { const s = ${SECTION}; if (!s) return null; return { notice: s.querySelector('.tools-notice')?.textContent ?? null, cards: [...s.querySelectorAll('.connector-card')].map((c) => ({ name: c.querySelector('.connector-head .tools-switch-title')?.textContent, state: c.querySelector('.connector-head .tools-hint')?.textContent, command: c.querySelector('.connector-command')?.textContent, tools: [...c.querySelectorAll('.connector-tools > li')].map((li) => ({ name: li.querySelector('.tools-switch-title')?.textContent, on: li.querySelector('.tools-toggle')?.getAttribute('aria-checked') === 'true', disabled: li.querySelector('.tools-toggle')?.disabled, said: li.querySelector('.connector-said')?.textContent, text: li.textContent })) })) } })()`)
const fill = async (label, text) => {
  await ev(`(() => { const el = ${SECTION}.querySelector('[aria-label=${JSON.stringify(label)}]'); el.focus(); el.select?.(); return true })()`)
  await page.type(text)
  await sleep(100)
}
const clickIn = (selector, text) => ev(`(() => { const el = [...${SECTION}.querySelectorAll(${JSON.stringify(selector)})].find((e) => e.textContent.trim() === ${JSON.stringify(text)}); if (!el) return false; el.click(); return true })()`)
// the section says "Working..." or "Answer the question..." from the click until main has answered; "Check its tools" is disabled meanwhile too (an empty name keeps the add button disabled for good)
const idle = async (label) => {
  await sleep(300)
  await page.waitFor(`(() => { const s = ${SECTION}; return !!s && !/Working|Answer the question/.test(s.querySelector('.tools-notice')?.textContent ?? '') && ![...s.querySelectorAll('button')].some((b) => b.disabled && b.textContent === 'Check its tools') })()`, { timeoutMs: 90000, label })
}
const noteCards = () => ev(`[...document.querySelectorAll('.message-assistant .tool-note')].map((n) => ({ title: n.querySelector('.tool-note-title')?.textContent, outcome: n.querySelector('.tool-note-outcome')?.textContent ?? null }))`)
async function converse(text, { timeoutMs = 120000 } = {}) {
  await H.send(text)
  await page.waitFor(`!!document.querySelector('.composer-button[type=submit]')`, { timeoutMs })
  await sleep(300)
}
const lastRequestTools = async () => { const reqs = (await H.mockReqs()).filter((r) => r.body && Array.isArray(r.body.messages)); return (reqs.at(-1)?.body.tools ?? []).map((t) => t.name) }
const toolResultsOf = async () => (await H.mockReqs()).filter((r) => r.body && Array.isArray(r.body.messages)).flatMap((r) => r.body.messages.flatMap((m) => (Array.isArray(m.content) ? m.content.filter((b) => b?.type === 'tool_result') : []))).map((b) => (typeof b.content === 'string' ? b.content : (b.content ?? []).map((x) => x?.text ?? '').join('')))

try {
  await page.waitFor(`document.readyState === 'complete' && !!document.querySelector('.header-select, .app-badge')`, { timeoutMs: 15000 })
  await sleep(300)
  await ev(`window.api.settings.setModel('claude-opus-5-5')`)

  // ============ A. the page ============
  await openTools()
  const sections = await ev(`[...document.querySelectorAll('dialog.tools .tools-section-title')].map((x) => x.textContent)`)
  check('A: the Tools page has "Connectors" after the changes waiting and before the audit log', show(sections) === show(['What the model may ask for', 'Code workspace', 'Run programs', 'Changes waiting', 'Connectors', 'Audit log']), show(sections))
  let v = await view()
  check('A: no connectors yet', v.cards.length === 0 && /No connectors yet/.test(await ev(`${SECTION}.textContent`)))
  const apiKeys = await ev(`Object.keys(window.api.connectors).sort().join()`)
  check('A: the page can only read and ask: no way to name a program, start a call or answer a question', apiKeys === 'addLocal,addRemote,refresh,remove,setGrant,setPlace,setTool,status,stop', apiKeys)
  await Q.reset()
  const odd = await ev(`window.api.connectors.setTool('../../x', 'echo', true)`)
  check('A: what the page sends is checked (an id that is not one is not understood, nobody is asked)', odd.ok === false && /not understood/.test(odd.error) && (await Q.count()) === 0, show(odd))
  part('A')

  // ============ B. adding a program ============
  await fill('Name of the connector', 'Ref')
  await fill('Arguments, one per line', '--era\nmodern')
  await pick(PROGRAM)
  await Q.reset()
  await Q.queue('yes')
  await clickIn('button', 'Choose the program and add...')
  await idle('the connector to be added')
  const asked = await Q.asked()
  const addQ = asked[0]?.options
  check('B: main opened the system\'s file dialog itself (for a .js/.mjs/.cjs/.exe), the page named no path', (await pickCalls()).length === 1 && /js/.test(JSON.stringify((await pickCalls())[0].options.filters)))
  check('B: ONE question in the system\'s box for this window, with the exact command and the folder, and "Don\'t add" as the default', asked.length === 1 && asked[0].withWindow === true && addQ.message === 'Add the connector "Ref"?' && addQ.detail.includes(`node ${PROGRAM} --era modern`) && addQ.detail.includes(`read-only copy of the folder ${SERVER_DIR}`) && show(addQ.buttons) === show(['Add it', "Don't add"]) && addQ.defaultId === 1 && addQ.cancelId === 1, show(addQ))
  v = await view()
  check('B: the card shows the connector and exactly what runs', v.cards.length === 1 && v.cards[0].name === 'Ref' && v.cards[0].command === `node ${PROGRAM} --era modern`, show(v))
  const stored = JSON.parse(readFileSync(FILE, 'utf8'))
  check('B: connectors.json holds it, in the box, with no tool and no grant', stored.connectors.length === 1 && stored.connectors[0].place === 'box' && stored.connectors[0].tools.length === 0 && stored.connectors[0].network === false, show(stored))
  part('B')

  // ============ C. its tools ============
  await clickIn('button', 'Check its tools')
  await idle('its tools to be listed')
  v = await view()
  const card = v.cards[0]
  const echo = card.tools.find((t) => t.name === 'echo')
  const nested = card.tools.find((t) => t.name === 'nested')
  check('C: "Check its tools" started it in the box and listed its 14 tools, every one off', card.tools.length === 14 && card.tools.every((t) => !t.on) && /Running/.test(card.state), show({ state: card.state, n: card.tools.length }))
  check("C: each shows the connector's own words, marked as not checked, and its arguments", /What the connector says it does \(not checked by the app\): Says back the text it is given\./.test(echo.said) && /Arguments: text \(text, up to/.test(echo.text) && /The model calls it ref__echo/.test(echo.text), show(echo))
  check('C: a tool that cannot be offered says why, and its switch cannot be pressed', /Not offered: its argument "where" is an object of its own/.test(nested.text) && nested.disabled === true, show(nested))
  check('C: its folder is in the connectors\' folder of runs (inside this run)', existsSync(join(CONNECTORS, 'connectors')) && readdirSync(join(CONNECTORS, 'connectors')).length === 1)
  part('C')

  // ============ D. switching a tool on ============
  await Q.reset()
  await Q.queue('yes')
  await ev(`(() => { ${SECTION}.querySelector('[aria-label="Tool echo of Ref"]').click(); return true })()`)
  await idle('the tool to be switched on')
  const onQ = (await Q.asked())[0]?.options
  check('D: switching a tool on asks, showing the connector\'s words, the name, the arguments and where it runs', onQ?.message === 'Switch on the tool "echo" of "Ref"?' && /Says back the text it is given\./.test(onQ.detail) && /ref__echo/.test(onQ.detail) && /locked box/.test(onQ.detail) && show(onQ.buttons) === show(['Switch it on', "Don't switch on"]) && onQ.defaultId === 1, show(onQ))
  v = await view()
  check('D: a yes switches it on', v.cards[0].tools.find((t) => t.name === 'echo').on === true && JSON.parse(readFileSync(FILE, 'utf8')).connectors[0].tools.map((t) => t.name).join() === 'echo')
  await closeTools()
  part('D')

  // ============ E. a reply that calls it ============
  await H.clickChat('New chat')
  await control({ calls: [{ name: 'ref__echo', input: { why: 'to hear it back', text: 'hello from the window' } }] })
  await Q.reset()
  await Q.queue('yes')
  await converse('[[mock:tool-use]] say it back')
  const callQ = (await Q.asked())[0]
  check('E: ONE question for the call, for this window: the tool and its connector, the argument in full, the reason, where it runs, and "Don\'t allow" as the default', (await Q.count()) === 1 && callQ.withWindow === true && /Tool: echo \(Ref\)/.test(callQ.options.detail) && /"hello from the window"/.test(callQ.options.detail) && /"to hear it back"/.test(callQ.options.detail) && /in the locked box/.test(callQ.options.detail) && callQ.options.defaultId === 1, show(callQ?.options))
  check('E: the request offered the connector\'s tool (and nothing else that is off)', show(await lastRequestTools()) === '["ref__echo"]', show(await lastRequestTools()))
  const told = [...new Set(await toolResultsOf())]
  check('E: the model was told what came back, labelled as text from outside', told.length === 1 && /text from outside/.test(told[0]) && told[0].indexOf('hello from the window') > told[0].indexOf('text from outside'), show(told))
  const cards = await noteCards()
  check('E: the chat shows the call and how it ended', cards.length === 1 && cards[0].title === 'echo (connector ref)' && /^You allowed it\. The connector answered after [\d.]+ seconds; [\d,]+ characters came back\.$/.test(cards[0].outcome ?? ''), show(cards))
  const log = await ev(`window.api.audit.read()`)
  const callInLog = log.ok ? log.calls.find((c) => c.tool === 'ref__echo') : null
  const events = log.ok ? log.calls.filter((c) => c.outcome.kind === 'connector-event').map((c) => c.outcome.what) : []
  check('E: the audit log has the call with its numbers, and none of what came back', callInLog?.outcome.kind === 'ran-connector' && !JSON.stringify(log).includes('hello from the window" was') && !JSON.stringify(log.calls.map((c) => c.outcome)).includes('hello from the window'), show(callInLog))
  check('E: ...and the connector\'s own events: added, started, the tool switched on', ['added', 'started', 'tool-on'].every((w) => events.includes(w)), show(events))
  await sleep(700)
  const saved = H.allConvs().find((c) => (c.messages ?? []).some((m) => /say it back/.test(m.content ?? '')))
  check('E: the saved chat keeps the call and how it ended', saved?.messages?.at(-1)?.tools?.[0]?.outcome?.kind === 'ran-connector', show(saved?.messages?.at(-1)?.tools))
  part('E')

  // ============ F. a web address with a token ============
  await sleep(3300)
  await openTools()
  await ev(`(() => { [...${SECTION}.querySelectorAll('input[type=radio]')][1].click(); return true })()`)
  await sleep(200)
  await fill('Name of the connector', 'Web')
  await fill('Web address', 'https://mcp.example.com/mcp')
  await fill('Token (optional)', TOKEN)
  await Q.reset()
  await Q.queue('yes')
  await clickIn('button', 'Add...')
  await idle('the web address to be added')
  const webQ = (await Q.asked())[0]?.options
  check('F: adding a web address asks, with the address whole, that a token goes with it (never the token), and that what is sent leaves this PC', /https:\/\/mcp\.example\.com\/mcp/.test(webQ?.detail ?? '') && /With the token you pasted/.test(webQ.detail) && !webQ.detail.includes(TOKEN) && /leaves this PC for whoever runs mcp\.example\.com/.test(webQ.detail), show(webQ))
  const status = await ev(`window.api.connectors.status()`)
  check('F: the page is told it has a token, never the token; the field is emptied', status.connectors.find((c) => c.name === 'Web')?.hasToken === true && !JSON.stringify(status).includes(TOKEN) && (await ev(`${SECTION}.querySelector('[aria-label="Token (optional)"]')?.value ?? ''`)) === '')
  check('F: connectors.json keeps the token sealed by the system, never as it is', !readFileSync(FILE, 'utf8').includes(TOKEN) && JSON.parse(readFileSync(FILE, 'utf8')).connectors.find((c) => c.name === 'Web')?.token !== null)
  part('F')

  // ============ G. removing ============
  await sleep(3300)
  await Q.reset()
  await Q.queue('yes')
  await ev(`(() => { const c = [...${SECTION}.querySelectorAll('.connector-card')].find((x) => x.getAttribute('aria-label') === 'Connector Ref'); [...c.querySelectorAll('button')].find((b) => b.textContent === 'Remove...').click(); return true })()`)
  await idle('the connector to be removed')
  const rmQ = (await Q.asked())[0]?.options
  v = await view()
  check('G: removing asks, and a yes removes it and its folder in the box', rmQ?.message === 'Remove the connector "Ref"?' && v.cards.map((c) => c.name).join() === 'Web' && readdirSync(join(CONNECTORS, 'connectors')).length === 0, show({ rmQ: rmQ?.message, cards: v.cards.map((c) => c.name) }))
  await closeTools()
  await H.clickChat('New chat')
  await control({})
  await converse('hello with no connector tool on')
  check('G: with its tool gone, the request offers no tool', show(await lastRequestTools()) === '[]', show(await lastRequestTools()))
  part('G')

  // ============ H. the page fits ============
  await openTools()
  for (const width of [420, 280]) {
    await page.send('Emulation.setDeviceMetricsOverride', { width, height: 800, deviceScaleFactor: 1, mobile: false })
    await sleep(300)
    const fit = await ev(`(() => { const d = document.querySelector('dialog.tools'); const s = ${SECTION}; const r = s.getBoundingClientRect(); const dr = d.getBoundingClientRect(); return { overflow: d.scrollWidth - d.clientWidth, right: r.right, dialogRight: dr.right } })()`)
    check(`H: at ${width} px nothing of the "Connectors" section sticks out sideways`, fit.overflow <= 1 && fit.right <= fit.dialogRight + 1, show(fit))
  }
  await page.send('Emulation.clearDeviceMetricsOverride', {})
  await closeTools()
  check('H: the page logged no errors and no warnings in the whole run', page.problems.length === 0, show(page.problems))
} catch (error) {
  if (!(error instanceof Done)) check(`the suite stopped before its end: ${String(error?.stack ?? error).slice(0, 500)}`, false)
}
const ok = check.summary()
process.exit(ok ? 0 : 1)
