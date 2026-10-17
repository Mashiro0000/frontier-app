// Slice 17.4 under plain Node (no window): the app's tools with a Gemini model (D-049). The adapter against the stand-in, servers of the test's own for what the stand-in
// cannot do, and the reply's tool runtime (replyTools.ts) with a played person. What it shows:
//   A. a request that offers tools: each as a function declaration with the app's JSON schema as it is (`parametersJsonSchema`), the calling mode AUTO, the rules for
//      tools in the system prompt; nothing of Google's own (no Search, no code execution); a request with no tools is exactly as before;
//   B. a turn that asks for a tool: the text before it shown, the call (Google's id, the name, the arguments), the turn kept as it came (with its thought signature);
//   C. the turn sent back with its result: the model turn as it came, then a `functionResponse` for each call by its name and id (an error as `error`), which the stand-in
//      takes; two calls in one turn; a call that came without an id (the app's own id, never sent); a signature that came in a part of its own; a thought left out;
//   D. the runtime: with a Gemini model the web search is never offered, and a call of it that comes anyway is refused without a question and without a search; with
//      the other two it is offered as before; the question names Google; a tool of the workspace is offered and run as for the others;
//   E. what the source must keep true (chat.ts hands the search only to a provider that offers it; the table of providers that do).
// Run: node tools/guarded.mjs tools/verify-17-4.mjs      (ONLY=A,C runs some parts)
import './ts-resolve.mjs'
import { checker } from './cdp.mjs'
import { randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { REPO, REPO_URL } from './paths.mjs'
import { startMock } from './mock-providers.mjs'

const check = checker()
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(',')) : null
const guard = async (name, fn) => { if (ONLY && !ONLY.has(name)) return; try { await fn() } catch (error) { check(`${name} did not run to its end: ${String(error?.stack ?? error).slice(0, 400)}`, false) } }
const show = (v) => JSON.stringify(v)?.slice(0, 500)
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const source = (rel) => readFileSync(join(REPO, rel), 'utf8')
const SRC = `${REPO_URL}/src`
const G = await import(`${SRC}/main/providers/gemini.ts`)
const P = await import(`${SRC}/main/providers/index.ts`)
const { buildStreamRequest, TOOL_RULES } = await import(`${SRC}/main/providers/request.ts`)
const { parseRegistry } = await import(`${SRC}/shared/registry.ts`)
const replyMod = await import(`${SRC}/main/replyTools.ts`)
const registryMod = await import(`${SRC}/main/toolRegistry.ts`)
const coreMod = await import(`${SRC}/main/toolCore.ts`)
const gateMod = await import(`${SRC}/main/systemQuestion.ts`)

const PORT = Number(process.env.GEMINI_TEST_PORT ?? 8902)
await startMock(PORT)
const origin = `http://127.0.0.1:${PORT}`
const KEY = 'AIza' + randomBytes(27).toString('base64url').slice(0, 35)
const credentials = { apiKey: KEY, baseURL: origin }
const reset = () => fetch(`${origin}/__reset`, { method: 'POST' })
const tools = (body) => fetch(`${origin}/__tools`, { method: 'POST', body: JSON.stringify(body) })
const requests = async () => (await (await fetch(`${origin}/__requests`)).json()).filter((r) => r.provider === 'google' && !r.listing)
const MODEL = parseRegistry(JSON.parse(source('registry/models.json'))).registry.models.find((m) => m.id === 'gemini-3.8-flash')
const adapter = G.createGeminiAdapter({ startMs: 3000, idleMs: 2000, listMs: 2000 })
const registry = registryMod.createToolRegistry(registryMod.BUILT_IN_TOOLS)
/** The specs the runtime offers when web search is on (the app's own schema, with the reason required). */
const SEARCH_SPEC = (() => {
  const rt = replyMod.createToolRuntime({ tools: registry, gate: gateMod.createQuestionGate(async () => true), guard: { check: async () => { throw new Error('no path') } }, record: async () => undefined, holdsSavedKey: async () => false })
  return rt.forReply({ owner: null, signal: new AbortController().signal, settings: { enabled: { web_search: true }, caps: { steps: 5, seconds: 60 } }, search: async () => ({ text: '', sources: [], searched: null, searches: 1, usage: {}, end: 'done' }) }).specs()
})()
const request = (messages, extra = {}) => buildStreamRequest({ credentials, model: MODEL, messages, tools: SEARCH_SPEC, signal: new AbortController().signal, ...extra })
async function run(req) {
  let text = ''
  let end = null
  try {
    for await (const event of adapter.stream(req)) {
      if (event.type === 'text') text += event.text
      else end = event
    }
    return { text, end }
  } catch (error) {
    return { text, error, n: adapter.normalizeError(error, { modelId: req.model.id }) }
  }
}
const ASKED = [{ role: 'user', content: 'find the news [[mock:tool-use]]' }]
const followUp = (end, results) => [...ASKED, { role: 'assistant', content: '', toolTurn: { calls: end.calls, record: end.record } }, { role: 'user', content: '', toolResults: results }]

// ============ A. a request with tools ============
await guard('A', async () => {
  check('A: (the runtime offers the search as one spec, the reason required, with length limits in the schema)', SEARCH_SPEC.length === 1 && SEARCH_SPEC[0].name === 'web_search' && SEARCH_SPEC[0].parameters.required.includes('why') && /"maxLength"/.test(JSON.stringify(SEARCH_SPEC[0].parameters)), show(SEARCH_SPEC))
  await reset()
  await run(request([{ role: 'user', content: 'hello' }]))
  const [r] = await requests()
  check('A: the body is contents, systemInstruction, generationConfig, tools, toolConfig, in that order', Object.keys(r.body).join() === 'contents,systemInstruction,generationConfig,tools,toolConfig', show(Object.keys(r.body)))
  check('A: one tools entry with the function declarations: the name, the description, and the schema EXACTLY as the app made it, as parametersJsonSchema', r.body.tools.length === 1 && Object.keys(r.body.tools[0]).join() === 'functionDeclarations' && same(r.body.tools[0].functionDeclarations, SEARCH_SPEC.map((s) => ({ name: s.name, description: s.description, parametersJsonSchema: s.parameters }))), show(r.body.tools))
  check('A: the calling mode is AUTO (the model may answer without a tool)', same(r.body.toolConfig, { functionCallingConfig: { mode: 'AUTO' } }))
  check('A: the stand-in takes it (a JSON schema with lengths and additionalProperties is fine as parametersJsonSchema)', r.problems.length === 0, show(r.problems))
  check('A: the rules for tools follow the app\'s rules in the system prompt', r.body.systemInstruction.parts[0].text.includes(TOOL_RULES))
  check('A: nothing of Google\'s own: no Search grounding, no code execution, no URL context', !/googleSearch|codeExecution|urlContext|googleSearchRetrieval/.test(r.raw))
  await reset()
  await run(request([{ role: 'user', content: 'hello' }], { tools: [] }))
  const [plain] = await requests()
  check('A: an empty list of tools: the request is exactly as with none (no tools, no toolConfig, no rules for tools)', Object.keys(plain.body).join() === 'contents,systemInstruction,generationConfig' && !plain.body.systemInstruction.parts[0].text.includes(TOOL_RULES))
})

// ============ B. a turn that asks for a tool ============
await guard('B', async () => {
  await reset()
  const got = await run(request(ASKED))
  check('B: the words before the call are shown', got.text === 'Let me search for that. ', show(got.text))
  check('B: the reply ends as tool-use, with one call: Google\'s id, the name, the arguments as the model wrote them', got.end?.end.kind === 'tool-use' && got.end.calls.length === 1 && /^gcall_mock_/.test(got.end.calls[0].id) && got.end.calls[0].name === 'web_search' && same(got.end.calls[0].input, { query: 'rust release notes', why: 'The person asked for the newest release.' }), show(got.end))
  const rec = got.end.record
  check('B: the turn is kept as it came: the text part, then the call part WITH its thought signature', rec.parts.length === 2 && rec.parts[0].text === 'Let me search for that. ' && rec.parts[1].functionCall.name === 'web_search' && typeof rec.parts[1].thoughtSignature === 'string', show(rec.parts))
  check('B: the record says which id each call has, and that Google gave it', same(rec.calls, [{ id: got.end.calls[0].id, name: 'web_search', googleId: true }]))
  check('B: the usage of the turn is reported', got.end.usage.inputTokens === 25 && got.end.usage.outputTokens === 40)
})

// ============ C. the turn sent back ============
await guard('C', async () => {
  await reset()
  let first = await run(request(ASKED))
  let id = first.end.calls[0].id
  let next = await run(request(followUp(first.end, [{ callId: id, text: 'Summary:\nIt came out last week.\nMore.', isError: false }])))
  let r = (await requests()).at(-1)
  check('C: the follow-up: user, model (the turn as it came, signature and all), user (the result)', same(r.body.contents.map((c) => c.role), ['user', 'model', 'user']) && same(r.body.contents[1].parts, first.end.record.parts), show(r.body.contents))
  check('C: the result is a functionResponse by the call\'s name and id, the text as `output`', same(r.body.contents[2].parts, [{ functionResponse: { name: 'web_search', id, response: { output: 'Summary:\nIt came out last week.\nMore.' } } }]), show(r.body.contents[2]))
  check('C: the stand-in takes it (the signature is there, the response answers the call) and the model answers from it', r.problems.length === 0 && next.text === 'The search found: It came out last week.' && next.end.end.kind === 'done', show([r.problems, next.text]))
  await reset()
  first = await run(request(ASKED))
  id = first.end.calls[0].id
  next = await run(request(followUp(first.end, [{ callId: id, text: 'That tool is switched off.', isError: true }])))
  r = (await requests()).at(-1)
  check('C: a refused or failed call goes back as `error`, not `output`', same(r.body.contents[2].parts[0].functionResponse.response, { error: 'That tool is switched off.' }) && r.problems.length === 0 && /^The tool failed: That tool is switched off\./.test(next.text), show([r.body.contents[2], next.text]))
  // two calls in one turn
  await reset()
  const two = await run(request([{ role: 'user', content: 'two [[mock:tool-two]]' }]))
  check('C: two calls in one turn: both, in order, the signature on the first part only', two.end.calls.length === 2 && two.end.record.parts.filter((p) => p.functionCall).map((p) => typeof p.thoughtSignature).join() === 'string,undefined', show(two.end.record.parts))
  const answers = two.end.calls.map((c, k) => ({ callId: c.id, text: `Summary:\nanswer ${k}`, isError: false }))
  const both = await run(request([{ role: 'user', content: 'two [[mock:tool-two]]' }, { role: 'assistant', content: '', toolTurn: { calls: two.end.calls, record: two.end.record } }, { role: 'user', content: '', toolResults: answers }]))
  r = (await requests()).at(-1)
  check('C: two responses, in the order of the calls, each with its call\'s id; the stand-in takes them', same(r.body.contents[2].parts.map((p) => p.functionResponse.id), two.end.calls.map((c) => c.id)) && r.problems.length === 0 && both.text === 'The search found: answer 0 | The search found: answer 1', show([r.problems, both.text]))
  // a server of the test's own: a call with no id, the signature in an empty text part of its own, a thought in the turn
  const bodies = []
  const SIG = 'SIGNATURE-ON-ITS-OWN=='
  const own = createServer((req, res) => {
    let raw = ''
    req.on('data', (c) => { raw += c })
    req.on('end', () => {
      bodies.push(JSON.parse(raw))
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      const ev = (o) => res.write(`data: ${JSON.stringify(o)}\r\n\r\n`)
      if (bodies.length === 1) {
        ev({ candidates: [{ content: { role: 'model', parts: [{ text: 'secret plan', thought: true }] } }] })
        ev({ candidates: [{ content: { role: 'model', parts: [{ functionCall: { name: 'web_search', args: { query: 'q', why: 'w' } } }] } }] })
        ev({ candidates: [{ content: { role: 'model', parts: [{ text: '', thoughtSignature: SIG }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 2 } })
      } else {
        ev({ candidates: [{ content: { role: 'model', parts: [{ text: 'done' }] }, finishReason: 'STOP' }] })
      }
      res.end()
    })
  })
  await new Promise((resolve) => own.listen(0, '127.0.0.1', resolve))
  const ownCredentials = { apiKey: KEY, baseURL: `http://127.0.0.1:${own.address().port}` }
  const noId = await run(request(ASKED, { credentials: ownCredentials }))
  check('C: a call without an id (an older model): the app gives it its own id; the record says Google gave none', noId.end?.end.kind === 'tool-use' && noId.end.calls[0].id === 'gemini-call-0' && noId.end.record.calls[0].googleId === false, show(noId.end))
  check('C: the thought is not kept; the signature that came in an empty text part of its own is', !JSON.stringify(noId.end.record.parts).includes('secret plan') && noId.end.record.parts.some((p) => p.text === '' && p.thoughtSignature === SIG), show(noId.end.record.parts))
  await run(request(followUp(noId.end, [{ callId: 'gemini-call-0', text: 'Summary:\nx', isError: false }]), { credentials: ownCredentials }))
  own.close()
  const sent = bodies[1]
  check('C: sent back: the call with no id (the app\'s own id never goes to Google), the signature part, and the response by name with no id', !JSON.stringify(sent).includes('gemini-call-0') && same(sent.contents[2].parts, [{ functionResponse: { name: 'web_search', response: { output: 'Summary:\nx' } } }]) && sent.contents[1].parts.some((p) => p.thoughtSignature === SIG), show(sent.contents))
})

// ============ D. the runtime ============
await guard('D', async () => {
  const rig = ({ search = true, answers = ['yes'], settings = { enabled: { web_search: true }, caps: { steps: 5, seconds: 60 } } } = {}) => {
    const asked = []
    const searches = []
    const queue = [...answers]
    const gate = gateMod.createQuestionGate(async (owner, question) => { asked.push(question); return queue.shift() === 'yes' })
    const events = []
    const rt = replyMod.createToolRuntime({ tools: registry, gate, guard: { check: async () => { throw new Error('no path') } }, record: async (e) => { events.push(e) }, holdsSavedKey: async () => false })
    const reply = rt.forReply({ owner: 'window', signal: new AbortController().signal, settings, provider: search ? 'Anthropic' : 'Google', ...(search ? { search: async (q) => { searches.push(q); return { text: `Summary for "${q}"`, sources: [], searched: null, searches: 1, usage: {}, end: 'done' } } } : {}) })
    return { reply, asked, searches, events }
  }
  let r = rig({ search: false })
  check('D: with a provider that offers no search (Gemini), the web search is NOT offered, though it is switched on', r.reply.specs().length === 0, show(r.reply.specs()))
  let turn = await r.reply.runTurn([{ id: 'c1', name: 'web_search', input: { query: 'rust', why: 'asked' } }])
  check('D: a call of it that comes anyway is refused with the fixed sentence, with no question and no search', turn.results.length === 1 && turn.results[0].isError === true && turn.results[0].text === coreMod.TOOL_OFF && r.asked.length === 0 && r.searches.length === 0 && turn.ended === null, show(turn))
  check('D: ... and the refusal is recorded like any other (the audit log sees it)', r.events.some((e) => e.type === 'refused' || /refus/.test(JSON.stringify(e))), show(r.events.slice(0, 2)))
  r = rig({ search: true })
  check('D: with Anthropic or OpenAI it is offered as before', r.reply.specs().map((s) => s.name).join() === 'web_search')
  turn = await r.reply.runTurn([{ id: 'c1', name: 'web_search', input: { query: 'rust', why: 'asked' } }])
  check('D: ... asked about, and run once on a yes', r.asked.length === 1 && r.searches.length === 1 && turn.results[0].isError === false)
  const named = rig({ search: false, settings: { enabled: {}, caps: { steps: 5, seconds: 60 } } })
  check('D: with every tool off, nothing is offered to Gemini either', named.reply.specs().length === 0)
})

// ============ E. the source ============
await guard('E', async () => {
  check('E: the table of providers whose hosted search the app may use: Anthropic and OpenAI yes, Google no', same(P.OFFERS_SEARCH, { anthropic: true, openai: true, google: false }) && Object.isFrozen(P.OFFERS_SEARCH))
  const chat = source('src/main/chat.ts')
  check('E: chat.ts hands the search (and the look at whether it can be paid for) only to a provider that offers it', /\.\.\.\(OFFERS_SEARCH\[entry\.provider\]\s*\?\s*\{ affordable: affordableSearch, search: countedSearch \}\s*:\s*\{\}\)/.test(chat), show(chat.match(/OFFERS_SEARCH[^\n]*\n[^\n]*/)?.[0]))
  const rt = source('src/main/replyTools.ts')
  check('E: the runtime treats the web search as switched off when it was handed no search', /const search = input\.search/.test(rt) && /search === undefined\s*\?\s*\{ \.\.\.settings, enabled: \{ \.\.\.settings\.enabled, web_search: false \} \}/.test(rt) && /settings: \(\) => forThisReply\(current\)/.test(rt))
  check('E: the adapter sends the schema as parametersJsonSchema and the mode AUTO, and no Google tool', /parametersJsonSchema: tool\.parameters/.test(source('src/main/providers/gemini.ts')) && /mode: 'AUTO'/.test(source('src/main/providers/gemini.ts')))
})

process.exit(check.summary() ? 0 : 1)
