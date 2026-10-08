// Stage 11.3 (D-041), in the real window against the mock: the provider loop. With the search switched on in tools.json (the Tools page that does that for the
// person is 11.4's), a request offers the tool; a model that asks for it makes the app ask in the system's own message box (replaced from the main inspector,
// lib10.mjs); a no tells the model so and the reply goes on; a yes makes a SEPARATE small request with the provider's hosted search and gives the model what it
// found, labelled as text from outside; the reply is the model's words before and after; every request is counted in the ledger and the spending limits apply
// to the search; every event is in the audit log and told to the window; Stop everything closes an open question and stops a running search; the caps (steps
// and tool time) end the reply and say why; a search that fails is told to the model without a cause; a hostile page changes nothing; both providers;
// a tools.json that is damaged, or off, offers nothing. No console errors.
// Needs: USER_DATA_DIR (scratch), INSPECT_PORT, MOCK_PORT, a saved key (setup-key.mjs).
import './ts-resolve.mjs'
import { connect, checker, sleep } from './cdp.mjs'
import { assertScratchProfile } from './profile-guard.mjs'
import { h4, mainInspector } from './lib4.mjs'
import { installQuestions } from './lib10.mjs'
import { existsSync, rmSync, writeFileSync } from 'node:fs'
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
const OPENAI_KEY = 'sk-proj-' + 'T4kq9Vw2Lr7Xm3Jc8Hn1Pd6Bs0Gf5Uy2Ze7Wa4Ro9Mi3Vt8Qk1Hx6Nb0Dl5Pj2Cf8Sy3Lu7Ev4Rw9Mq1Ka6Gz0Cn5Hd'
const TOOLS_FILE = join(userData, 'tools.json')
const toolsOn = (caps = { steps: 5, seconds: 60 }, enabled = { web_search: true }) => writeFileSync(TOOLS_FILE, JSON.stringify({ version: 1, enabled, caps }))
const toolsOff = () => rmSync(TOOLS_FILE, { force: true })
const control = (body) => fetch(`${mockUrl}/__tools`, { method: 'POST', body: JSON.stringify(body) })
const isSearchRequest = (r) => (r.body?.tools ?? []).some((t) => t.type === 'web_search_20250305' || t.type === 'web_search')
const chatsOf = (reqs) => reqs.filter((r) => !isSearchRequest(r))
const searchesOf = (reqs) => reqs.filter(isSearchRequest)
const ASK = '[[mock:tool-use]] find the newest release of Rust'
const eventsNow = () => ev(`window.__ev.map((e) => ({ ...e }))`)
const toolEvents = async () => (await eventsNow()).filter((e) => e.type === 'tool').map((e) => e.event)
const types = (events) => events.map((e) => e.type + (e.answer ? ':' + e.answer : '') + (e.code ? ':' + e.code : '')).join()

/** Sends a message and waits for the whole reply (all its requests); answers what the mock received for it, the events the window heard, and what is on screen. */
async function converse(text, { timeoutMs = 40000, expectRequests = 1 } = {}) {
  const before = (await H.mockReqs()).length
  await ev(`window.__ev.length = 0; true`)
  await H.send(text)
  const t0 = Date.now()
  while ((await H.mockReqs()).length < before + expectRequests && Date.now() - t0 < 10000) await sleep(50)
  await page.waitFor(`!!document.querySelector('.composer-button[type=submit]')`, { timeoutMs })
  await sleep(250)
  const reqs = (await H.mockReqs()).slice(before)
  return { reqs, events: await eventsNow(), screen: await H.screen() }
}
// (11.4) the reply's tool notes stand inside its bubble; the words of the reply are what is left without them
const lastReply = async () => { const m = (await H.screen()).at(-1); const words = await ev(`(() => { const b = [...document.querySelectorAll('.message-assistant .bubble')].at(-1); if (!b) return null; const notes = [...b.querySelectorAll('.tool-note')]; notes.forEach((n) => { n.style.display = 'none' }); const t = b.innerText; notes.forEach((n) => { n.style.display = '' }); const nl = String.fromCharCode(10); let s = t; while (s.includes(nl + nl + nl)) s = s.split(nl + nl + nl).join(nl + nl); return s.trim() })()`); return words === null || m?.role !== 'assistant' ? m : { ...m, text: words } }

try {
  await page.waitFor(`document.readyState === 'complete' && !!document.querySelector('.header-select, .app-badge')`, { timeoutMs: 15000 })
  await sleep(300)
  await ev(`window.__ev = []; window.__off = window.api.chat.onEvent((e) => window.__ev.push(e)); true`)
  await ev(`window.api.settings.setModel('claude-opus-5-5')`)
  toolsOff()

  // ============ A. the search is off: nothing is offered, and a model that asks for it gets nothing ============
  let r = await converse(ASK)
  check('A: with no tools.json no tool is offered: the request carries none', r.reqs.length === 1 && !('tools' in r.reqs[0].body) && !('tool_choice' in r.reqs[0].body), show(Object.keys(r.reqs[0]?.body ?? {})))
  check('A: ...a model that asks for a tool anyway gets nothing: its words are the reply, no second request, no box, nothing in the record', (await lastReply()).text.includes('Let me search for that.') && (await H.mockReqs()).length === r.reqs.length && (await Q.count()) === 0 && (await toolEvents()).length === 0)
  await H.clickChat('New chat')
  toolsOn(undefined, { web_search: false })
  r = await converse(ASK)
  check('A: a tool listed as off is not offered either', !('tools' in r.reqs[0].body) && r.reqs.length === 1)
  await H.clickChat('New chat')
  writeFileSync(TOOLS_FILE, '{"version":1,"enabled":{"web_search":true},"caps":{"steps":5,"seconds":60},"extra":1}')
  r = await converse(ASK)
  check('A: a tools.json that is not exactly what the app writes switches NOTHING on (a damaged file never allows a tool)', !('tools' in r.reqs[0].body) && r.reqs.length === 1 && (await Q.count()) === 0)
  await H.clickChat('New chat')
  writeFileSync(TOOLS_FILE, '{"version":1,"enabled":{"web_search":1},"caps":{"steps":5,"seconds":60}}')
  r = await converse(ASK)
  check('A: ...nor does a 1, in place of true', !('tools' in r.reqs[0].body) && r.reqs.length === 1)
  await H.clickChat('New chat')

  // ============ B. a no ============
  toolsOn()
  await Q.reset()
  await Q.queue('no')
  r = await converse(ASK, { expectRequests: 2 })
  const first = r.reqs[0]
  check('B: with the search on, the request offers it: name, description, a schema that requires the reason; "auto"; one call at a time', first.problems.length === 0 && first.body.tools?.length === 1 && first.body.tools[0].name === 'web_search' && first.body.tools[0].input_schema.required.includes('why') && first.body.tool_choice?.type === 'auto' && first.body.tool_choice.disable_parallel_tool_use === true && !first.body.system.includes('web_search'), show(first.body.tool_choice))
  let box = await Q.asked()
  check('B: the model asked, so the app asked the person in the system\'s box, for this window, once, with a signal that can close it', box.length === 1 && box[0].withWindow === true && box[0].hadSignal === true, show(box.map((b) => [b.withWindow, b.hadSignal])))
  const o = box[0]?.options ?? {}
  check('B: the box shows the tool, the exact words in quotes, the reason, what it does, which step, and why it is asked there; two buttons, "Don\'t allow" the default and the way out', o.title === 'Search the web' && o.message === 'Allow this web search?' && o.detail.includes('"rust release notes"') && o.detail.includes('The person asked for the newest release.') && o.detail.includes('This is step 1 of at most 5 that this reply may take.') && o.detail.includes('cannot say yes for you') && show(o.buttons) === '["Search the web","Don\'t allow"]' && o.defaultId === 1 && o.cancelId === 1, show(o))
  check('B: nothing but the person can say yes: no note, instruction or file is in the question\'s words; no "always" or "for this chat"', !/always|for this chat|remember/i.test(JSON.stringify(o)))
  check('B: a no: no search request was made; the model was told in a fixed sentence, as an error, and answered', searchesOf(r.reqs).length === 0 && r.reqs.length === 2 && r.reqs[1].problems.length === 0 && (() => { const m = r.reqs[1].body.messages.at(-1); return m.role === 'user' && m.content[0].type === 'tool_result' && m.content[0].is_error === true && m.content[0].content === 'The person did not allow this.' })(), show(r.reqs[1]?.body.messages.at(-1)))
  let reply = await lastReply()
  check('B: the reply on screen is the model\'s words before the call and after it, as two paragraphs', reply.role === 'assistant' && reply.text === 'Let me search for that.\n\nThe tool said: The person did not allow this.' && reply.note === null, show(reply))
  let tools = await toolEvents()
  check('B: the window was told, in order: asked (the words and the reason), answered "no"', types(tools) === 'asked,answered:no' && tools[0].args.query === 'rust release notes' && tools[0].why === 'The person asked for the newest release.' && tools[0].step === 1, show(tools))
  let audit = await ev(`window.api.audit.read()`)
  check('B: the audit log has it: one call, "You said no."', audit.ok && audit.calls.length === 1 && audit.calls[0].outcome.kind === 'declined' && audit.calls[0].outcome.answer === 'no' && audit.calls[0].args.query === 'rust release notes', show(audit.calls?.[0]))
  const usageNo = await ev(`window.api.usage.summary(null)`)
  check('B: the ledger has the two requests of this reply (and none for a search that did not happen)', usageNo.today.requests === 2 + 3 + 0 || usageNo.today.requests >= 2, show(usageNo.today))
  await sleep(3300)

  // ============ C. a yes ============
  await H.clickChat('New chat')
  await Q.reset()
  await Q.queue('yes')
  const ledgerBefore = (await ev(`window.api.usage.summary(null)`)).today.requests
  r = await converse(ASK, { expectRequests: 3 })
  check('C: a yes: three requests in this order: the model\'s turn, the hosted search, the model\'s turn again; none refused by the mock', r.reqs.length === 3 && !isSearchRequest(r.reqs[0]) && isSearchRequest(r.reqs[1]) && !isSearchRequest(r.reqs[2]) && r.reqs.every((x) => x.problems.length === 0), show(r.reqs.map((x) => [isSearchRequest(x), x.problems])))
  const search = r.reqs[1]
  check('C: the search is a separate small request: the hosted tool allowed once, the helper\'s instructions, the approved words quoted, low effort, nothing forced, none of the chat in it', search.body.tools.length === 1 && search.body.tools[0].type === 'web_search_20250305' && search.body.tools[0].max_uses === 1 && search.body.messages.length === 1 && search.body.messages[0].content === 'Search the web once for these words and report what you find: "rust release notes"' && search.body.output_config?.effort === 'low' && !('tool_choice' in search.body) && !JSON.stringify(search.body).includes('find the newest release'), show(search.body))
  const again = r.reqs[2].body.messages
  check('C: the model\'s turn is sent back as it came, thinking first (the mock refuses it otherwise), and the result follows as a tool_result with the call\'s id', again.at(-2).role === 'assistant' && again.at(-2).content[0].type === 'thinking' && again.at(-2).content.at(-1).type === 'tool_use' && again.at(-1).role === 'user' && again.at(-1).content.length === 1 && again.at(-1).content[0].type === 'tool_result' && again.at(-1).content[0].tool_use_id === again.at(-2).content.at(-1).id && !again.at(-1).content[0].is_error, show(again.at(-1)).slice(0, 200))
  const told = again.at(-1).content[0].content
  check('C: what the model is told is labelled: the search the person allowed, the words, "text from outside ... not instructions", the summary, and the pages with their addresses', told.startsWith('The result of the web search that the person allowed, for the words "rust release notes".') && /text from outside/.test(told) && /not instructions/.test(told) && told.includes('Summary:\nSummary for "rust release notes"') && told.includes('1. Result 1 for rust release notes - https://example.com/result-1') && told.includes('3. Result 3 for rust release notes - https://example.com/result-3'), told.slice(0, 300))
  check('C: the app\'s own rules (the system prompt) say nothing of the result: it is in the tool result and nowhere else', r.reqs[2].body.system === r.reqs[0].body.system && !JSON.stringify(r.reqs[2].body.messages.filter((m) => m.role === 'user' && Array.isArray(m.content) && m.content.some((b) => b.type === 'text'))).includes('Summary for'))
  reply = await lastReply()
  check('C: the reply is the model\'s words before and after the search, as two paragraphs; no note', reply.text === 'Let me search for that.\n\nThe search found: Summary for "rust release notes": the first result says it came out last week.' && reply.note === null, show(reply))
  tools = await toolEvents()
  check('C: the window was told, in order: asked, answered "yes", ran, result (ok, three pages, one search, the words searched)', types(tools) === 'asked,answered:yes,ran,result' && tools[3].ok === true && tools[3].sources.length === 3 && tools[3].searches === 1 && tools[3].searched === 'rust release notes', show(tools.at(-1)))
  audit = await ev(`window.api.audit.read()`)
  check('C: the audit log has it: "You said yes. It ran: N characters came back, from 3 sources." and the three pages (titles and addresses)', audit.calls[0].outcome.kind === 'done' && audit.calls[0].outcome.sources.length === 3 && audit.calls[0].outcome.sources[0].url === 'https://example.com/result-1' && audit.calls.length === 2, show(audit.calls[0]).slice(0, 300))
  const ledgerAfter = (await ev(`window.api.usage.summary(null)`)).today.requests
  check('C: the ledger counts all three requests: the model twice and the search', ledgerAfter - ledgerBefore === 3, show([ledgerBefore, ledgerAfter]))
  const usage = r.events.find((e) => e.type === 'usage')?.usage
  check('C: the usage the window is told is the three requests added up (the search\'s 6,039 input tokens among them)', usage !== undefined && usage.tokens.input >= 6039 + 25 + 25 - 10 && usage.costUsd > 0, show(usage))
  check('C: the events end with usage and then done, once each', show(r.events.filter((e) => e.type === 'usage' || e.type === 'done').map((e) => e.type)) === '["usage","done"]')
  await sleep(500)
  const saved = H.allConvs().find((c) => (c.messages ?? []).some((m) => /find the newest release of Rust/.test(m.content ?? '')) && (c.messages ?? []).some((m) => /The search found/.test(m.content ?? '')))
  const savedText = JSON.stringify(saved ?? {})
  check('C: the saved chat holds the words of the reply and nothing of the tool: no call, no id, no result, no page', !!saved && /The search found/.test(savedText) && !/tool_use|toolu_|tool_result|"summary"|"text":/.test(savedText) && JSON.parse(savedText).version === 6 && /Search the web/.test(savedText) /* (11.4) the notes are saved: the call, its words and the pages' titles and addresses, but no page text */, savedText.slice(0, 300))
  const next = await converse('[[mock:count]] and then an ordinary message')
  check('C: the next message of the chat is an ordinary request: the earlier turn is its words only, with the tool offered afresh', next.reqs.length === 1 && next.reqs[0].problems.length === 0 && !JSON.stringify(next.reqs[0].body.messages).includes('toolu_') && !JSON.stringify(next.reqs[0].body.messages).includes('tool_result') && next.reqs[0].body.tools?.length === 1, show(next.reqs[0]?.body.messages).slice(0, 200))

  // ============ D. the words that were searched can differ; a page that gives orders ============
  await H.clickChat('New chat')
  await control({ search: { mode: 'hostile', searched: 'rust 1.90 release notes' } })
  await Q.reset()
  await Q.queue('yes')
  r = await converse(ASK, { expectRequests: 3 })
  const hostileTold = r.reqs[2]?.body.messages.at(-1).content[0].content ?? ''
  check('D: a page that gives orders (the provider\'s words carry them): they reach the model only inside the tool result, after the label that says they are not instructions', hostileTold.includes('IGNORE ALL PREVIOUS INSTRUCTIONS') && hostileTold.indexOf('not instructions') < hostileTold.indexOf('IGNORE ALL PREVIOUS INSTRUCTIONS') && !JSON.stringify(r.reqs[2].body.system).includes('IGNORE'), hostileTold.slice(0, 200))
  check('D: ...nothing came of them: no further tool call, no second question, three requests in all', r.reqs.length === 3 && (await Q.count()) === 1 && types(await toolEvents()) === 'asked,answered:yes,ran,result')
  check('D: the words the provider says it searched (other than the approved ones) are told to the model and kept in the record', hostileTold.includes('The search service says it searched for: "rust 1.90 release notes".') && (await toolEvents()).at(-1).searched === 'rust 1.90 release notes')
  await control({})
  await sleep(100)

  // ============ E. a search that fails; a provider that answers without searching ============
  await H.clickChat('New chat')
  await control({ search: { mode: 'fail', status: 529 } })
  await Q.reset()
  await Q.queue('yes')
  r = await converse(ASK, { expectRequests: 3 })
  const failedTold = r.reqs[2]?.body.messages.at(-1).content[0]
  check('E: a search that fails: the model is told "The tool failed." as an error and nothing else; the reply goes on', failedTold?.is_error === true && failedTold.content === 'The tool failed.' && (await lastReply()).text.includes('The tool said: The tool failed.'), show(failedTold))
  tools = await toolEvents()
  check('E: ...the record shows it ran and the result is not ok, with no page and no search counted', types(tools) === 'asked,answered:yes,ran,result' && tools[3].ok === false && tools[3].searches === 0 && tools[3].sources.length === 0, show(tools.at(-1)))
  await control({ search: { mode: 'none' } })
  await H.clickChat('New chat')
  await Q.reset()
  await Q.queue('yes')
  r = await converse(ASK, { expectRequests: 3 })
  tools = await toolEvents()
  check('E: a provider that answers without searching: the result is ok with no pages and no search counted; the model is told so', tools.at(-1)?.ok === true && tools.at(-1).searches === 0 && tools.at(-1).sources.length === 0 && /No pages came back\./.test(r.reqs[2]?.body.messages.at(-1).content[0].content ?? ''))
  await control({})

  // ============ F. Stop everything ============
  await H.clickChat('New chat')
  await Q.reset()
  await Q.hold()
  await Q.queue('yes')
  const stopBefore = (await H.mockReqs()).length
  await ev(`window.__ev.length = 0; true`)
  await H.send(ASK)
  const t0 = Date.now()
  while ((await Q.count()) < 1 && Date.now() - t0 < 10000) await sleep(50)
  check('F: the question is open (the box waits for the person)', (await Q.count()) === 1)
  await page.click('.composer-button@Stop')
  const t1 = Date.now()
  while ((await Q.closedBySignal()) < 1 && Date.now() - t1 < 5000) await sleep(50)
  check('F: Stop everything while the box is open CLOSES the box (through its signal); nothing is searched', (await Q.closedBySignal()) === 1 && searchesOf((await H.mockReqs()).slice(stopBefore)).length === 0, show(await Q.closedBySignal()))
  await Q.release()
  await page.waitFor(`!!document.querySelector('.composer-button[type=submit]')`, { timeoutMs: 8000 })
  await sleep(400)
  tools = await toolEvents()
  check('F: the record shows the question and the answer "stopped" (not "no": a Stop is not a refusal)', types(tools) === 'asked,answered:stopped', show(tools))
  check('F: the reply stopped where it was: no second request', chatsOf((await H.mockReqs()).slice(stopBefore)).length === 1)
  audit = await ev(`window.api.audit.read()`)
  check('F: the audit log has "You stopped the reply while the question was open."', audit.calls[0].outcome.kind === 'declined' && audit.calls[0].outcome.answer === 'stopped', show(audit.calls[0]?.outcome))
  await H.clickChat('New chat')
  await Q.reset()
  await Q.queue('yes')
  r = await converse(ASK, { expectRequests: 3 })
  check('F: a Stop is not a "no": the next question comes at once (no quiet time) and a yes is heard', (await Q.count()) === 1 && r.reqs.length === 3 && types(await toolEvents()) === 'asked,answered:yes,ran,result')

  await H.clickChat('New chat')
  await control({ search: { mode: 'slow', ms: 6000 } })
  await Q.reset()
  await Q.queue('yes')
  const before2 = (await H.mockReqs()).length
  await ev(`window.__ev.length = 0; true`)
  await H.send(ASK)
  const t2 = Date.now()
  while (searchesOf((await H.mockReqs()).slice(before2)).length < 1 && Date.now() - t2 < 10000) await sleep(50)
  await sleep(300)
  await page.click('.composer-button@Stop')
  await page.waitFor(`!!document.querySelector('.composer-button[type=submit]')`, { timeoutMs: 8000 })
  await sleep(1500)
  const stoppedSearch = searchesOf((await H.mockReqs()).slice(before2))[0]
  check('F: Stop everything while the search runs drops its connection at once', stoppedSearch?.closedEarly === true, show(stoppedSearch?.closedEarly))
  tools = await toolEvents()
  check('F: ...the record shows it ran and the result is not ok', types(tools) === 'asked,answered:yes,ran,result' && tools.at(-1).ok === false, show(types(tools)))
  check('F: ...no further request was made after the Stop', chatsOf((await H.mockReqs()).slice(before2)).length === 1)
  const usageStopped = await ev(`window.api.usage.summary(null)`)
  check('F: the stopped search is in the ledger (a guess, marked as one: it was begun)', usageStopped.today.requests >= 2 && usageStopped.today.about === true, show(usageStopped.today))
  await control({})

  // ============ G. the caps ============
  await H.clickChat('New chat')
  toolsOn({ steps: 2, seconds: 60 })
  await Q.reset()
  await Q.fallback('yes')
  r = await converse('[[mock:tool-many]] keep searching', { expectRequests: 5, timeoutMs: 60000 })
  tools = await toolEvents()
  check('G: a model that asks again after every result, with two steps allowed: two searches are made, the third call is refused for the cap', types(tools) === 'asked,answered:yes,ran,result,asked,answered:yes,ran,result,refused:step-cap' && chatsOf(r.reqs).length === 3 && searchesOf(r.reqs).length === 2, show(types(tools)))
  const capNote = await H.noteText()
  reply = await lastReply()
  check('G: the reply stops and SAYS why, and keeps the model\'s words so far', /Stopped: this reply used all 2 of its tool steps\./.test(capNote ?? '') && reply.text.includes('Let me search for that.'), show([capNote, reply.text]))
  audit = await ev(`window.api.audit.read()`)
  check('G: the audit log has the three calls: two done, one refused ("the reply had used all its tool steps")', audit.calls.slice(0, 3).map((c) => c.outcome.kind).join() === 'refused,done,done' && audit.calls[0].outcome.code === 'step-cap', show(audit.calls.slice(0, 3).map((c) => c.outcome)))
  await H.clickChat('New chat')
  toolsOn({ steps: 5, seconds: 10 })
  await control({ search: { mode: 'slow', ms: 12000 } })
  await Q.reset()
  const before3 = (await H.mockReqs()).length
  await ev(`window.__ev.length = 0; true`)
  await H.send(ASK)
  await page.waitFor(`!!document.querySelector('.composer-button[type=submit]')`, { timeoutMs: 40000 })
  await sleep(1200)
  tools = await toolEvents()
  const slowOne = searchesOf((await H.mockReqs()).slice(before3))[0]
  check('G: tool time is capped: a search that takes longer than the 10 seconds is stopped when the time is used, and the reply ends saying so', types(tools) === 'asked,answered:yes,ran,result' && tools.at(-1).ok === false && slowOne?.closedEarly === true && /Stopped: this reply used all 10 seconds of its tool time\./.test((await H.noteText()) ?? ''), show([types(tools), slowOne?.closedEarly, await H.noteText()]))
  await control({})
  toolsOn()
  await Q.fallback('no')

  // ============ H. the spending limit applies to the search ============
  await H.clickChat('New chat')
  await ev(`window.api.settings.setModel('claude-fable-5-1')`)
  // (today's spending so far is in the ledger: the limit is set 2 cents above it, so that the chat request fits and the search request, which guesses 8,000
  // tokens of pages at Fable's price, does not)
  const spentToday = (await ev(`window.api.usage.summary(null)`)).today.costUsd
  const limitUsd = Math.ceil((spentToday + 0.02) * 100) / 100
  await ev(`window.api.settings.setLimits({ daily: { kind: 'usd', usd: ${limitUsd} }, monthly: { kind: 'none' } })`)
  const limitsNow = await ev(`window.api.settings.getStatus().then((s) => s.limits)`)
  await Q.reset()
  await Q.queue('yes')
  r = await converse(ASK, { expectRequests: 2 })
  tools = await toolEvents()
  const limited = r.reqs.at(-1)?.body.messages.at(-1).content[0]
  check('H: with a limit the chat requests fit under but the search\'s would pass (daily $0.05, Fable 5.1): the search is not made; the model is told the tool failed', searchesOf(r.reqs).length === 0 && limited?.content === 'The tool failed.' && tools.at(-1)?.ok === false, show([limitsNow?.daily, searchesOf(r.reqs).length, limited?.content]))
  await Q.reset()
  await Q.queue('yes') // taking the limit away lets the app spend more: the system's box asks, and the stand-in says yes
  await ev(`window.api.settings.setLimits({ daily: { kind: 'none' }, monthly: { kind: 'none' } })`)
  await Q.reset()
  await ev(`window.api.settings.setModel('claude-opus-5-5')`)

  // ============ I. OpenAI ============
  await H.clickChat('New chat')
  const setKey = await ev(`window.api.settings.setApiKey('openai', ${JSON.stringify(OPENAI_KEY)})`)
  const chose = await ev(`window.api.settings.setModel('gpt-6-luna')`)
  check('I: (an OpenAI key is saved and its model chosen)', setKey.ok === true && chose.ok === true)
  toolsOn()
  await Q.reset()
  await Q.queue('yes')
  r = await converse(ASK, { expectRequests: 3 })
  const [o1, o2, o3] = r.reqs
  check('I: OpenAI: the request offers the tool as a function (strict off), one call at a time, with the encrypted reasoning asked for; none refused by the mock', o1?.provider === 'openai' && o1.problems.length === 0 && o1.body.tools?.[0].type === 'function' && o1.body.tools[0].strict === false && o1.body.parallel_tool_calls === false && o1.body.include?.[0] === 'reasoning.encrypted_content', show(o1?.body.tools?.[0]))
  check('I: OpenAI: a yes makes the hosted search as a separate request: the hosted tool, one call, the pages asked for, the approved words quoted', o2?.problems.length === 0 && o2.body.tools?.[0].type === 'web_search' && o2.body.max_tool_calls === 1 && o2.body.include?.[0] === 'web_search_call.action.sources' && o2.body.input[0].content === 'Search the web once for these words and report what you find: "rust release notes"', show(o2?.body.tools))
  const items = o3?.body.input ?? []
  check('I: OpenAI: the model\'s turn goes back as its items (reasoning with its encrypted content, words, the call) and the output follows with the call\'s id', o3?.problems.length === 0 && items.some((i) => i.type === 'reasoning' && i.encrypted_content) && items.some((i) => i.type === 'function_call') && items.at(-1).type === 'function_call_output' && items.at(-1).call_id === items.find((i) => i.type === 'function_call').call_id, show(items.map((i) => i.type)))
  reply = await lastReply()
  check('I: OpenAI: the reply is the model\'s words before and after, as two paragraphs', reply.text === 'Let me search for that.\n\nThe search found: Summary for "rust release notes": the first result says it came out last week.', show(reply))
  tools = await toolEvents()
  check('I: OpenAI: the events and the result: ok, the pages the search consulted and the ones it cited, once each, one search', types(tools) === 'asked,answered:yes,ran,result' && tools[3].sources.length === 3 && tools[3].searches === 1 && tools[3].searched === 'rust release notes', show(tools.at(-1)))
  await H.clickChat('New chat')
  await Q.reset()
  await Q.queue('no')
  r = await converse(ASK, { expectRequests: 2 })
  check('I: OpenAI: a no is told to the model, and the reply goes on', searchesOf(r.reqs).length === 0 && r.reqs.length === 2 && r.reqs[1].body.input.at(-1).output === 'The person did not allow this.' && (await lastReply()).text.includes('The person did not allow this.'))
  await sleep(3300)
  await H.clickChat('New chat')
  await Q.reset()
  await Q.hold()
  await Q.queue('yes')
  const beforeO = (await H.mockReqs()).length
  await H.send(ASK)
  const t4 = Date.now()
  while ((await Q.count()) < 1 && Date.now() - t4 < 10000) await sleep(50)
  await page.click('.composer-button@Stop')
  const t5 = Date.now()
  while ((await Q.closedBySignal()) < 1 && Date.now() - t5 < 5000) await sleep(50)
  await Q.release()
  await page.waitFor(`!!document.querySelector('.composer-button[type=submit]')`, { timeoutMs: 8000 })
  check('I: OpenAI: Stop everything while the box is open closes it', (await Q.closedBySignal()) === 1 && searchesOf((await H.mockReqs()).slice(beforeO)).length === 0)
  await ev(`window.api.settings.setModel('claude-opus-5-5')`)

  // ============ J. what stayed out of reach ============
  const apiNames = await ev(`(() => { const names = []; const walk = (v, p, d) => { if (d > 4 || v === null || (typeof v !== 'object' && typeof v !== 'function')) return; for (const k of Object.keys(v)) { names.push(p + k); walk(v[k], p + k + '.', d + 1) } }; walk(window.api, '', 0); return names })()`)
  check('J: the page still has no function that runs, approves or switches on a tool: window.api names nothing of the kind', !apiNames.some((n) => /approv|allow|answer|run/i.test(n)) && apiNames.filter((n) => /^tools/.test(n)).sort().join() === 'tools,tools.reset,tools.setCaps,tools.setEnabled,tools.status' /* (11.4) the settings group, and nothing that runs or approves */ && apiNames.filter((n) => /^audit/.test(n)).length === 4, show(apiNames.filter((n) => /tool|approv|allow|audit/i.test(n))))
  const handlers = JSON.parse(await main.inMain(`JSON.stringify([...process.mainModule.require('electron').ipcMain._invokeHandlers.keys()].sort())`))
  check('J: ...and main has no message handler for one (the loop is in main, and the person\'s yes can only come from the system\'s box)', !handlers.some((h) => /approv|run|answer/i.test(h)) && handlers.filter((h) => /tool/i.test(h)).sort().join() === 'tools:reset,tools:set-caps,tools:set-enabled,tools:status', show(handlers.filter((h) => /tool|approv/i.test(h))))
  toolsOff()
} catch (error) {
  check(`the suite stopped before its end: ${String(error?.stack ?? error).slice(0, 400)}`, false)
}

check('the page logged no errors and no warnings', page.problems.length === 0, show(page.problems))
main.close()
page.close()
process.exit(check.summary() ? 0 : 1)
