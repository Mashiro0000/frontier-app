// Slice 17.3 under plain Node (no window): the Gemini adapter (src/main/providers/gemini.ts, D-049), written over Node's own fetch, against the stand-in of the mock
// (tools/mock-gemini.mjs) and a few small servers of its own for what the stand-in cannot do (bytes cut in the middle of a character, a redirect). What it shows:
//   A. the request: the address, the key in x-goog-api-key and nowhere else, the body field by field (contents and roles, the system prompt, the reply's ceiling, the
//      thinking level asked and the thoughts not asked), for both models and every level; hostile environment variables change nothing; a redirect is not followed;
//   B. the stream read strictly: text as it arrives, the events however they are cut (CRLF or LF, a character cut in two, a comment), thoughts never shown, usage as
//      Google reports it (cached inside the prompt, thoughts beside the answer) and impossible usage counted as nothing;
//   C. how a reply ends: done, cut off, declined (a blocked question that comes back as a success, a blocked reply, prohibited content, recitation), a broken call;
//   D. every failure: the kind, the sentence (a refused key is said with its 400, quota and rate told apart, the model named, the key scrubbed), ONE request each, the
//      adapter's own clocks, Stop, a dead server, leaving the loop;
//   E. the model listing: pages, a runaway list, failures, the clock, the key;
//   F. usage() on its own;
//   G. what the source must keep true.
// Run: node tools/guarded.mjs tools/verify-17-3.mjs      (ONLY=A,C runs some parts)
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
const show = (v) => JSON.stringify(v)?.slice(0, 400)
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const source = (rel) => readFileSync(join(REPO, rel), 'utf8')
const G = await import(`${REPO_URL}/src/main/providers/gemini.ts`)
const { buildStreamRequest } = await import(`${REPO_URL}/src/main/providers/request.ts`)
const { describeFailure } = await import(`${REPO_URL}/src/main/providers/errors.ts`)
const { adapterFor } = await import(`${REPO_URL}/src/main/providers/index.ts`)
const { parseRegistry } = await import(`${REPO_URL}/src/shared/registry.ts`)

const PORT = Number(process.env.GEMINI_TEST_PORT ?? 8901)
await startMock(PORT)
const origin = `http://127.0.0.1:${PORT}`
const KEY = 'AIza' + randomBytes(27).toString('base64url').slice(0, 35)
const credentials = { apiKey: KEY, baseURL: origin }
const reset = () => fetch(`${origin}/__reset`, { method: 'POST' })
const requests = async () => (await (await fetch(`${origin}/__requests`)).json()).filter((r) => r.provider === 'google')
const models = (body) => fetch(`${origin}/__models`, { method: 'POST', body: JSON.stringify(body) })
const expectKey = (key) => fetch(`${origin}/__expect-key`, { method: 'POST', body: JSON.stringify({ key, provider: 'google' }) })
const registry = parseRegistry(JSON.parse(source('registry/models.json')))
const MODEL = registry.registry.models.find((m) => m.id === 'gemini-3.8-flash')
const ARGON = registry.registry.models.find((m) => m.id === 'gemini-4-argon')
const adapter = G.createGeminiAdapter({ startMs: 1500, idleMs: 600, listMs: 1500 })
const request = (text, extra = {}) => buildStreamRequest({ credentials, model: MODEL, messages: [{ role: 'user', content: text }], signal: new AbortController().signal, ...extra })
/** Runs a stream to its end: the text, the end event, or what it threw (normalized, and as the person reads it). */
async function run(req, which = adapter) {
  let text = ''
  let end = null
  try {
    for await (const event of which.stream(req)) {
      if (event.type === 'text') text += event.text
      else end = event
    }
    return { text, end }
  } catch (error) {
    const n = which.normalizeError(error, { modelId: req.model.id })
    return { text, error, n, said: describeFailure(n, req.credentials.apiKey) }
  }
}

// ============ A. the request ============
await guard('A', async () => {
  await reset()
  const got = await run(request('hello there'))
  const [r] = await requests()
  check('A: one POST to /v1beta/models/gemini-3.8-flash:streamGenerateContent?alt=sse', r?.url === '/v1beta/models/gemini-3.8-flash:streamGenerateContent?alt=sse', show(r?.url))
  check('A: the key in x-goog-api-key, and not in the address, not in Authorization, not in the body', r.headers['x-goog-api-key'] === KEY && !r.url.includes(KEY) && !r.headers.authorization && !r.raw.includes(KEY))
  check('A: the stand-in found nothing it would refuse', r.problems.length === 0, show(r.problems))
  check('A: exactly contents, systemInstruction, generationConfig, in that order', Object.keys(r.body).join() === 'contents,systemInstruction,generationConfig')
  check('A: the person\'s message as a user turn of one text part', same(r.body.contents, [{ role: 'user', parts: [{ text: 'hello there' }] }]))
  check('A: the system prompt is the app\'s own, which calls the model "an AI assistant" (not Claude)', r.body.systemInstruction.parts.length === 1 && r.body.systemInstruction.parts[0].text.startsWith('You are an AI assistant, chatting with someone in Frontier App'))
  check('A: the reply\'s ceiling is the app\'s 16,000 tokens; thinking at the registry\'s pick (medium); thoughts not asked for', same(r.body.generationConfig, { maxOutputTokens: 16000, thinkingConfig: { thinkingLevel: 'medium', includeThoughts: false } }))
  check('A: the request asks for JSON events (accept: text/event-stream) and sends JSON', r.headers.accept === 'text/event-stream' && /^application\/json/.test(r.headers['content-type']))
  check('A: no other Google header (no x-goog-user-project, no x-goog-api-client)', !r.headers['x-goog-user-project'] && !r.headers['x-goog-api-client'])
  check('A: the reply came back', got.text === 'Echo: hello there' && got.end?.end.kind === 'done', show(got))
  for (const model of [MODEL, ARGON]) {
    for (const effort of ['low', 'medium', 'high', null]) {
      await reset()
      await run(request('x', { model, effort }))
      const [q] = await requests()
      check(`A: ${model.id}, effort ${effort}: ${effort ? `thinkingLevel ${effort}` : 'no thinkingConfig at all'}, nothing refused`, q.url.includes(model.id) && q.problems.length === 0 && (effort ? q.body.generationConfig.thinkingConfig?.thinkingLevel === effort : q.body.generationConfig.thinkingConfig === undefined), show([q.body.generationConfig, q.problems]))
    }
  }
  await reset()
  await run(buildStreamRequest({ credentials, model: MODEL, instructions: 'Answer in French.', everyChat: 'I live in Lisbon.', notes: ['Likes tea'], project: 'A garden.', messages: [{ role: 'user', content: 'first' }, { role: 'assistant', content: 'an answer' }, { role: 'user', content: 'second' }, { role: 'user', content: 'third' }], signal: new AbortController().signal }))
  const [t] = await requests()
  check('A: turns as user / model / user; two messages of the person\'s in a row joined (as for the other providers)', same(t.body.contents, [{ role: 'user', parts: [{ text: 'first' }] }, { role: 'model', parts: [{ text: 'an answer' }] }, { role: 'user', parts: [{ text: 'second\n\nthird' }] }]), show(t.body.contents))
  check('A: the person\'s notes, instructions for every chat, project and chat instructions are in the system prompt, in that order', /Likes tea[\s\S]*I live in Lisbon[\s\S]*A garden[\s\S]*Answer in French/.test(t.body.systemInstruction.parts[0].text))
  await reset()
  await run(buildStreamRequest({ credentials, model: MODEL, messages: [{ role: 'user', content: 'a' }, { role: 'assistant', content: '' }, { role: 'user', content: 'b' }], signal: new AbortController().signal }))
  const [e] = await requests()
  check('A: an assistant turn with no text is left out (Gemini refuses an empty part), and nothing is refused', e.body.contents.every((c) => c.parts.every((p) => p.text !== '')) && e.problems.length === 0, show(e.body.contents))
  const SMILE = String.fromCodePoint(0x1f600)
  await reset()
  const u = await run(request(`quotes "x" \\ ${SMILE} é </script>`))
  check('A: unicode and quotes go and come back as they are', u.text === `Echo: quotes "x" \\ ${SMILE} é </script>`)
  // hostile environment
  const saved = { ...process.env }
  Object.assign(process.env, { GOOGLE_API_KEY: 'AIzaENVIRONMENTKEY000000000000000000000', GEMINI_API_KEY: 'AIzaENVIRONMENTKEY000000000000000000001', GOOGLE_GENAI_BASE_URL: 'http://127.0.0.1:1', GOOGLE_CLOUD_PROJECT: 'hostile', HTTPS_PROXY: 'http://127.0.0.1:1', HTTP_PROXY: 'http://127.0.0.1:1' })
  await reset()
  const h = await run(request('hostile'))
  const [hr] = await requests()
  for (const k of ['GOOGLE_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_GENAI_BASE_URL', 'GOOGLE_CLOUD_PROJECT', 'HTTPS_PROXY', 'HTTP_PROXY']) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k] }
  check('A: with GOOGLE_API_KEY, GEMINI_API_KEY, a base address, a project and proxies set in the environment: the same request, with the saved key, to the same place', h.text === 'Echo: hostile' && hr.headers['x-goog-api-key'] === KEY && !hr.raw.includes('ENVIRONMENTKEY') && !hr.headers['x-goog-user-project'])
  // a redirect would carry the key's header to another place: it is not followed
  const elsewhere = []
  const target = createServer((req, res) => { elsewhere.push(req.headers); res.end('{}') })
  await new Promise((resolve) => target.listen(0, '127.0.0.1', resolve))
  const redirecting = createServer((req, res) => { res.writeHead(307, { location: `http://127.0.0.1:${target.address().port}${req.url}` }); res.end() })
  await new Promise((resolve) => redirecting.listen(0, '127.0.0.1', resolve))
  const red = await run({ ...request('x'), credentials: { apiKey: KEY, baseURL: `http://127.0.0.1:${redirecting.address().port}` } })
  check('A: an answer that sends the request elsewhere (307) is not followed: the key never reaches the other place, and the reply fails as "could not reach"', elsewhere.length === 0 && red.n?.kind === 'connection', show([elsewhere.length, red.n]))
  redirecting.close(); target.close()
})

// ============ B. the stream ============
await guard('B', async () => {
  await reset()
  let got = await run(request('one two three'))
  check('B: the text in pieces, the end "done", the usage: input 25, output 12 + 28 thinking = 40', got.text === 'Echo: one two three' && got.end.end.kind === 'done' && same(got.end.usage, { inputTokens: 25, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 40 }), show(got.end))
  got = await run(request('q [[mock:cached]]'))
  check('B: cached tokens are taken out of the prompt: 4,100 in of which 4,000 cached = 100 ordinary + 4,000 cache reads', same(got.end.usage, { inputTokens: 100, cacheReadTokens: 4000, cacheWriteTokens: 0, outputTokens: 40 }), show(got.end.usage))
  got = await run(request('q [[mock:no-usage]]'))
  check('B: no usage at all: four zeros (chat.ts then makes its own guess, marked as one)', got.text === 'No usage here.' && same(got.end.usage, { inputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 }))
  got = await run(request('q [[mock:hostile-usage]]'))
  check('B: impossible usage (-5, 10^15, a word) is not believed: four zeros', same(got.end.usage, { inputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 }) && got.end.end.kind === 'done')
  got = await run(request('q [[mock:thoughts]]'))
  check('B: a thought sent although not asked for is NEVER shown; the reply is the rest', got.text === 'The answer.' && !got.text.includes('SECRET') && got.end.end.kind === 'done', show(got.text))
  got = await run(request('[[mock:say]] plain words back'))
  check('B: "say": the words exactly', got.text === 'plain words back')
  // a server of the test's own: events cut anywhere, LF only, a comment, a character cut in two, the last event with no blank line after it
  const SMILE = String.fromCodePoint(0x1f600)
  const event = (o) => `data: ${JSON.stringify(o)}`
  const chunk = (text, finish) => ({ candidates: [{ content: { role: 'model', parts: [{ text }] }, ...(finish ? { finishReason: finish } : {}) }], ...(finish ? { usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 2 } } : {}) })
  const stream = Buffer.from([': a comment', '', event(chunk('Hé ')), '', `event: message\n${event(chunk(`${SMILE} two`))}`, '', event(chunk(' three', 'STOP'))].join('\n'), 'utf8')
  const cuts = [3, 17, 18, stream.indexOf(Buffer.from(SMILE, 'utf8')) + 1, stream.indexOf(Buffer.from(SMILE, 'utf8')) + 2, stream.length - 5]
  const raw = createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    let at = 0
    const pieces = [...cuts, stream.length].map((end) => { const p = stream.subarray(at, end); at = end; return p })
    const next = () => { const p = pieces.shift(); if (p === undefined) return res.end(); res.write(p); setTimeout(next, 15) }
    next()
  })
  await new Promise((resolve) => raw.listen(0, '127.0.0.1', resolve))
  got = await run({ ...request('x'), credentials: { apiKey: KEY, baseURL: `http://127.0.0.1:${raw.address().port}` } })
  raw.close()
  check('B: events cut in the middle of a line and of a character, LF only, a comment, an "event:" line, the last event without a blank line after it: read whole', got.text === `Hé ${SMILE} two three` && got.end?.end.kind === 'done' && got.end.usage.outputTokens === 2, show(got))
  const notStream = createServer((req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end('[{"candidates":[]}]') })
  await new Promise((resolve) => notStream.listen(0, '127.0.0.1', resolve))
  got = await run({ ...request('x'), credentials: { apiKey: KEY, baseURL: `http://127.0.0.1:${notStream.address().port}` } })
  notStream.close()
  check('B: an answer that is not a stream (JSON) is not read as one: Google "stopped the reply" in words', got.n?.kind === 'provider' && /not a stream/.test(got.said), show(got.said))
})

// ============ C. how a reply ends ============
await guard('C', async () => {
  const ends = {
    'blocked-prompt': ['', { kind: 'declined', category: 'SAFETY' }],
    'blocked-prompt-other': ['', { kind: 'declined', category: 'OTHER' }],
    'blocked-reply': ['Partial answer that ', { kind: 'declined', category: 'SAFETY' }],
    prohibited: ['Partial ', { kind: 'declined', category: 'PROHIBITED_CONTENT' }],
    recitation: ['Partial quoted ', { kind: 'declined', category: 'RECITATION' }],
    'max-tokens': ['Cut off here', { kind: 'cut-off' }],
    'finish-other': ['Partial ', { kind: 'cut-off' }],
    'finish-odd': ['Partial ', { kind: 'cut-off' }],
    empty: ['', { kind: 'done' }]
  }
  for (const [directive, [text, end]] of Object.entries(ends)) {
    await reset()
    const got = await run(request(`q [[mock:${directive}]]`))
    check(`C: ${directive}: the text "${text}" and the end ${show(end)}`, got.text === text && same(got.end?.end, end), show(got))
  }
  await reset()
  const blocked = await run(request('q [[mock:blocked-prompt]]'))
  check('C: a blocked question still reports what it used (the prompt), as Google sends it', blocked.end.usage.inputTokens === 25 && blocked.end.usage.outputTokens === 0)
  await reset()
  const broken = await run(request('q [[mock:malformed-call]]'))
  check('C: a call of a tool that could not be used (MALFORMED_FUNCTION_CALL) fails in words, after the text that came', broken.text === 'Let me ' && broken.n.kind === 'provider' && /Google stopped the reply: the model wrote a call of a tool that could not be used \(MALFORMED_FUNCTION_CALL\)/.test(broken.said), show(broken.said))
})

// ============ D. failures ============
await guard('D', async () => {
  const fail = async (directive, { key = null, which = adapter, model = MODEL } = {}) => { await reset(); if (key) await expectKey(key); const got = await run(request(`q [[mock:${directive}]]`, { model }), which); return { ...got, count: (await requests()).length } }
  let f = await fail('echo', { key: 'AIza-another-key-000000000000000000000' })
  check('D: a key Google does not accept (400 API_KEY_INVALID) is told as a refused key, with the 400 it came with', f.n.kind === 'auth' && f.said === 'The API key was not accepted (400). Check it in Settings.' && f.count === 1, show(f.said))
  f = await fail('echo-key')
  check('D: a provider that repeats the whole key: the sentence holds [key], never the key', f.n.kind === 'auth' && !f.said.includes(KEY), show(f.said))
  const cases = [
    ['403', 'permission', /^This API key is not allowed to do that \(403\)\. Generative Language API has not been used/],
    ['404', 'not-found', /^The model gemini-3\.8-flash was not found for this account \(404\)/],
    ['429', 'rate-limit', /^Too many requests right now \(429\)/],
    ['429-quota', 'quota', /^Your Google account has no credit left, or has reached its spending limit \(429\)\. Check your billing with Google\./],
    ['400', 'bad-request', /^The request was refused \(400\): Request contains an invalid argument\./],
    ['500', 'server', /^Google had a problem on its side \(500\)/],
    ['503', 'overloaded', /^Google is overloaded right now \(503\)/],
    ['504', 'server', /^Google had a problem on its side \(504\)/],
    ['html-error', 'server', /^Google had a problem on its side \(502\)/],
    ['midstream-error', 'provider', /^Google stopped the reply: An internal error has occurred\./],
    ['drop', 'interrupted', /^The connection was interrupted while the reply was arriving/],
    ['early-close', 'interrupted', /^The connection was interrupted while the reply was arriving/],
    ['not-json', 'provider', /^Google stopped the reply: Google sent a part of the answer that could not be read/]
  ]
  for (const [directive, kind, re] of cases) {
    f = await fail(directive)
    check(`D: ${directive}: ${kind}, in words, ONE request`, f.n?.kind === kind && re.test(f.said) && f.count === 1 && !f.said.includes(KEY), show([f.n?.kind, f.said, f.count]))
  }
  f = await fail('midstream-error')
  check('D: the text that came before a failure stays with the caller', f.text === 'Partial ')
  // clocks
  let t0 = Date.now()
  f = await fail('hang-before')
  check('D: a provider that never answers: the adapter\'s own clock ends it (1.5 s here; 10 minutes in the app) as a timeout, ONE request', f.n?.kind === 'timeout' && Date.now() - t0 < 5000 && f.count === 1 && /timed out/.test(f.said), show([f.n?.kind, Date.now() - t0]))
  await new Promise((r) => setTimeout(r, 200))
  check('D: ... and the connection is closed', (await requests())[0].closedEarly === true)
  t0 = Date.now()
  f = await fail('slow')
  check('D: a stream that goes silent longer than the idle clock (0.6 s here, 5 minutes in the app; the stand-in waits 0.1 s between ticks, so this run makes it 0.6) ends as a timeout... or runs to its end when every gap is short', f.n?.kind === 'timeout' || f.end?.end.kind === 'done', show([f.n?.kind, f.text.slice(0, 40)]))
  // (the clock for the answer to begin is long here, 10 s, so that only the idle clock can end this within the 3 s the check allows: a control showed that with a
  // short first clock the idle clock could be missing and the check still pass)
  const tight = G.createGeminiAdapter({ startMs: 10000, idleMs: 50, listMs: 1500 })
  t0 = Date.now()
  f = await fail('slow', { which: tight })
  check('D: with an idle clock shorter than the stand-in\'s gaps (50 ms): a timeout, after the first tick, ONE request', f.n?.kind === 'timeout' && /^tick0/.test(f.text) && f.count === 1 && Date.now() - t0 < 3000, show([f.n?.kind, f.text, Date.now() - t0]))
  // Stop
  await reset()
  const stop = new AbortController()
  let text = ''
  let thrown = null
  setTimeout(() => stop.abort(), 700)
  t0 = Date.now()
  try { for await (const e of adapter.stream(request('q [[mock:slow]]', { signal: stop.signal }))) if (e.type === 'text') text += e.text } catch (error) { thrown = error }
  await new Promise((r) => setTimeout(r, 200))
  check('D: Stop in the middle of a reply ends it at once (it throws; the caller knows it was a Stop), the connection closed, ONE request', thrown !== null && Date.now() - t0 < 2500 && text.startsWith('tick0') && (await requests()).length === 1 && (await requests())[0].closedEarly === true, show([String(thrown), Date.now() - t0]))
  check('D: a Stop is not told as a timeout of the adapter\'s', adapter.normalizeError(thrown, { modelId: 'x' }).kind !== 'timeout')
  await reset()
  const early = new AbortController()
  early.abort()
  thrown = null
  try { for await (const e of adapter.stream(request('x', { signal: early.signal }))) void e } catch (error) { thrown = error }
  check('D: a signal already aborted: nothing is sent at all', thrown !== null && (await requests()).length === 0)
  await reset()
  const stopWhileWaiting = new AbortController()
  setTimeout(() => stopWhileWaiting.abort(), 300)
  thrown = null
  try { for await (const e of adapter.stream(request('q [[mock:hang-before]]', { signal: stopWhileWaiting.signal }))) void e } catch (error) { thrown = error }
  check('D: Stop while waiting for the answer to begin: ends at once, not a timeout', thrown !== null && adapter.normalizeError(thrown, { modelId: 'x' }).kind !== 'timeout')
  // leaving the loop closes the connection
  await reset()
  for await (const e of adapter.stream(request('q [[mock:slow]]'))) { if (e.type === 'text') break }
  await new Promise((r) => setTimeout(r, 300))
  check('D: a caller that stops reading (leaves the loop) closes the connection', (await requests())[0].closedEarly === true)
  // nothing listening
  const dead = await run({ ...request('x'), credentials: { apiKey: KEY, baseURL: 'http://127.0.0.1:9' } })
  check('D: nothing listening: "Could not reach Google"', dead.n?.kind === 'connection' && /^Could not reach Google\./.test(dead.said), show(dead.said))
  check('D: a failure that is no provider\'s at all is "unknown"', adapter.normalizeError(new Error('odd'), { modelId: 'x' }).kind === 'unknown')
  check('D: the search is never offered for Gemini: it refuses in words if ever called', (await adapter.search({}).catch((e) => adapter.normalizeError(e, { modelId: 'x' }))).kind === 'provider')
})

// ============ E. the listing ============
await guard('E', async () => {
  await reset()
  let list = await adapter.listModels(credentials)
  const [r] = await requests()
  check('E: the models, by id (without "models/") and Google\'s name for each', list.some((m) => m.id === 'gemini-4-argon' && m.label === 'Gemini 4 Argon') && list.length === 7, show(list.slice(0, 3)))
  check('E: GET /v1beta/models?pageSize=1000, the key in x-goog-api-key only', r.url === '/v1beta/models?pageSize=1000' && r.headers['x-goog-api-key'] === KEY && !r.url.includes(KEY) && r.problems.length === 0, show(r.url))
  await reset()
  await models({ pageSize: 3 })
  list = await adapter.listModels(credentials)
  const reqs = await requests()
  check('E: pages are followed with pageToken until there is none (3 pages of 3, 3, 1)', list.length === 7 && reqs.length === 3 && reqs[1].url.includes('pageToken=3'), show(reqs.map((x) => x.url)))
  await reset()
  await models({ many: 5000 })
  list = await adapter.listModels(credentials)
  check('E: a runaway listing is cut at 1,000 models', list.length === 1000 && (await requests()).length === 1)
  await reset()
  await models({ many: 50000, pageSize: 10 })
  list = await adapter.listModels(credentials)
  check('E: ... and never more than 20 pages', list.length === 200 && (await requests()).length === 20)
  await reset()
  await models({ fail: 500 })
  let e = await adapter.listModels(credentials).catch((error) => error)
  check('E: a listing that fails: Google had a problem (500)', adapter.normalizeError(e, { modelId: '' }).kind === 'server')
  await reset()
  await expectKey('AIza-another-key-000000000000000000000')
  e = await adapter.listModels(credentials).catch((error) => error)
  check('E: Test key with a refused key: "The API key was not accepted (400)"', describeFailure(adapter.normalizeError(e, { modelId: '' }), KEY) === 'The API key was not accepted (400). Check it in Settings.')
  await reset()
  await models({ hang: true })
  const t0 = Date.now()
  e = await adapter.listModels(credentials).catch((error) => error)
  check('E: a listing that never answers: the adapter\'s clock (1.5 s here, a minute in the app) ends it as a timeout', adapter.normalizeError(e, { modelId: '' }).kind === 'timeout' && Date.now() - t0 < 5000)
  await reset()
  await models({ hang: true })
  const stop = new AbortController()
  setTimeout(() => stop.abort(), 200)
  e = await adapter.listModels(credentials, stop.signal).catch((error) => error)
  check('E: the caller\'s signal (Settings gives up after 20 s) ends it too, and is not a timeout of the adapter\'s', e instanceof Error && adapter.normalizeError(e, { modelId: '' }).kind !== 'timeout')
  await models({})
})

// ============ F. usage() ============
await guard('F', async () => {
  const u = adapter.usage
  check('F: prompt 100, cached 30, candidates 7, thoughts 5, tool prompt 4: input 74, cache reads 30, output 12', same(u({ promptTokenCount: 100, cachedContentTokenCount: 30, candidatesTokenCount: 7, thoughtsTokenCount: 5, toolUsePromptTokenCount: 4 }), { inputTokens: 74, cacheReadTokens: 30, cacheWriteTokens: 0, outputTokens: 12 }))
  check('F: cached above the prompt is held to the prompt', same(u({ promptTokenCount: 10, cachedContentTokenCount: 30 }), { inputTokens: 0, cacheReadTokens: 10, cacheWriteTokens: 0, outputTokens: 0 }))
  for (const [name, bad] of [['a part', 1.5], ['below 0', -1], ['text', '9'], ['above 100,000,000', 100_000_001], ['infinity', Infinity], ['NaN', NaN], ['null', null]]) {
    check(`F: a count that is ${name}: the whole report counts as nothing`, same(u({ promptTokenCount: 10, candidatesTokenCount: bad }), { inputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 }))
  }
  check('F: not an object: nothing', same(u(null), { inputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 }) && same(u([1, 2]), u(null)) && same(u('x'), u(null)))
  check('F: missing fields are 0', same(u({ candidatesTokenCount: 3 }), { inputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 3 }))
  check('F: the app\'s adapter is this adapter, with the app\'s clocks (10 min to begin, 5 min of silence, 1 min to list)', adapterFor('google').provider === 'google' && G.GEMINI_CLOCKS.startMs === 600000 && G.GEMINI_CLOCKS.idleMs === 300000 && G.GEMINI_CLOCKS.listMs === 60000 && Object.isFrozen(G.GEMINI_CLOCKS))
})

// ============ G. the source ============
await guard('G', async () => {
  const s = source('src/main/providers/gemini.ts')
  check('G: the address is Google\'s, fixed in the file', /export const API_BASE_URL = 'https:\/\/generativelanguage\.googleapis\.com'/.test(s))
  check('G: no "key=" anywhere in an address the adapter builds', !/[?&]key=/.test(s.replace(/\/\/.*$/gm, '')))
  const uses = s.split('\n').filter((line) => /apiKey/.test(line)).map((line) => line.trim())
  check('G: the key goes only into the x-goog-api-key header: four mentions, the helper\'s parameter, the header, and the two calls of the helper', uses.length === 4 && /^const headersFor = \(apiKey: string/.test(uses[0]) && uses[1] === "'x-goog-api-key': apiKey" && /headers: headersFor\(request\.credentials\.apiKey,/.test(uses[2]) && /headers: headersFor\(credentials\.apiKey,/.test(uses[3]), show(uses))
  check('G: nothing read from the environment', !/process\.env/.test(s))
  check('G: one call of fetch, with redirects refused', (s.match(/await fetch\(/g) ?? []).length === 1 && /redirect: 'error'/.test(s))
  check('G: no Google package, no SDK, nothing installed', !/from '@google|require\(/.test(s) && !/@google\//.test(source('package.json')))
  check('G: no retry: no loop around the request, no "retry" anywhere', !/retr(y|ies)/i.test(s.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')))
  check('G: the thoughts are never asked for (includeThoughts: false only)', /includeThoughts: false/.test(s) && !/includeThoughts: true/.test(s))
  check('G: no Google Search, code execution or Files API in what is sent', !/googleSearch|codeExecution|fileData|fileUri|urlContext/.test(s.replace(/\/\/.*$/gm, '')))
  const e = source('src/main/providers/errors.ts')
  check('G: the sentence for a refused key says the status that came (the other two always 401: their words unchanged)', /The API key was not accepted \(\$\{status \?\? 401\}\)\. Check it in Settings\./.test(e))
})

process.exit(check.summary() ? 0 : 1)
