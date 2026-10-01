// Slice 5.5: the OpenAI adapter (src/main/providers/openai.ts) against the OpenAI mock, under plain Node: no window, no Electron.
// The mock is my reading of OpenAI's documentation, so this proves the adapter does what that reading says; the real API is a
// separate check (the real-call script, run by the person who has a key).
import { REPO_URL } from './paths.mjs'
import './ts-resolve.mjs'
import { checker } from './cdp.mjs'
import { readFileSync } from 'node:fs'
import { startMock } from './mock-providers.mjs'
import { randomBytes } from 'node:crypto'

const check = checker()
const base = `${REPO_URL}/src/main/providers/`
const { adapterFor } = await import(base + 'index.ts')
const { openaiAdapter, API_BASE_URL } = await import(base + 'openai.ts')
const { buildStreamRequest, systemPromptFor } = await import(base + 'request.ts')
const { describeFailure } = await import(base + 'errors.ts')
const { parseRegistry, SUPPORTED_PROVIDERS, PROVIDER_NAMES } = await import(`${REPO_URL}/src/shared/registry.ts`)
const OpenAI = (await import(`${REPO_URL}/node_modules/openai/index.mjs`)).default

const registry = parseRegistry(JSON.parse(readFileSync(new URL('./registry-good.json', import.meta.url), 'utf8')))
if (!registry.ok) throw new Error('registry unusable: ' + registry.error)
const models = Object.fromEntries(registry.registry.models.map((m) => [m.id, m]))
const openaiModels = registry.registry.models.filter((m) => m.provider === 'openai')
const sol = models['gpt-6.1-sol']
const luna = models['gpt-6-luna']
const astra = models['gpt-6-astra']

const PORT = Number(process.env.OPENAI_TEST_PORT ?? 8899)
const mock = await startMock(PORT)
const origin = `http://127.0.0.1:${PORT}`
const KEY = 'test-' + randomBytes(24).toString('hex')
const creds = { apiKey: KEY, baseURL: origin }
const get = async () => (await fetch(`${origin}/__requests`)).json()
const reset = () => fetch(`${origin}/__reset`, { method: 'POST' })
const post = (path, body) => fetch(`${origin}${path}`, { method: 'POST', body: JSON.stringify(body) })
const n = (e, modelId = sol.id) => openaiAdapter.normalizeError(e, { modelId })

async function collect(request) {
  const events = []
  let error = null
  try { for await (const e of openaiAdapter.stream(request)) events.push(e) } catch (e) { error = e }
  return { events, error }
}
const req = (text, extra = {}) => buildStreamRequest({ credentials: creds, model: sol, messages: [{ role: 'user', content: text }], signal: new AbortController().signal, ...extra })
const sentence = (e, modelId) => describeFailure(n(e, modelId), KEY)

// ---- the table, the registry, the prompt ---------------------------------------------------------------------------
check('OpenAI is a supported provider, with an adapter that says so', SUPPORTED_PROVIDERS.includes('openai') && adapterFor('openai') === openaiAdapter && openaiAdapter.provider === 'openai')
check('...named "OpenAI" for the person', PROVIDER_NAMES.openai === 'OpenAI')
check('the registry lists three OpenAI models: Astra, Sol, Luna', JSON.stringify(openaiModels.map((m) => m.id)) === JSON.stringify(['gpt-6-astra', 'gpt-6.1-sol', 'gpt-6-luna']))
check('API_BASE_URL is the real address (with /v1, as the SDK wants it)', API_BASE_URL === 'https://api.openai.com/v1')
check('the system prompt for OpenAI does not call the assistant Claude, and still asks for plain text', !/Claude/.test(systemPromptFor('openai')) && /^You are an AI assistant, chatting with someone in Frontier App/.test(systemPromptFor('openai')) && /plain text/.test(systemPromptFor('openai')) && /Markdown/.test(systemPromptFor('openai')))
check('...and Anthropic\'s is unchanged', /^You are Claude, chatting/.test(systemPromptFor('anthropic')))
check('the OpenAI request builder keeps the app\'s own ceiling and joins turns, like any provider', (() => { const r = buildStreamRequest({ credentials: creds, model: sol, messages: [{ role: 'user', content: 'a' }, { role: 'user', content: 'b' }], signal: new AbortController().signal }); return r.maxOutputTokens === 16000 && r.messages.length === 1 && r.messages[0].content === 'a\n\nb' })())

// ---- a normal reply: what is sent ---------------------------------------------------------------------------------
{
  const { events, error } = await collect(req('hello there'))
  const kinds = events.map((e) => e.type)
  check('stream yields text events then exactly one end event, last', !error && kinds.at(-1) === 'end' && kinds.filter((k) => k === 'end').length === 1 && kinds.slice(0, -1).every((k) => k === 'text') && kinds.length >= 2, JSON.stringify(kinds) + String(error))
  check('...the text is the reply, and the reasoning item before it is not text', events.filter((e) => e.type === 'text').map((e) => e.text).join('') === 'Echo: hello there')
  check('...the end says "done", with usage in the four buckets (the mock reports 25 in, 40 out, nothing cached)', events.at(-1)?.end?.kind === 'done' && JSON.stringify(events.at(-1)?.usage) === JSON.stringify({ inputTokens: 25, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 40 }), JSON.stringify(events.at(-1)))
  const [r] = await get()
  check('the strict mock finds nothing wrong with the request', r.problems.length === 0, JSON.stringify(r.problems))
  check('it went to /v1/responses with the key as a Bearer token, and no x-api-key', r.headers['authorization'] === `Bearer ${KEY}` && r.headers['x-api-key'] === undefined)
  check('the body has exactly: model, instructions, input, max_output_tokens, reasoning, store, stream', JSON.stringify(Object.keys(r.body).sort()) === '["input","instructions","max_output_tokens","model","reasoning","store","stream"]', JSON.stringify(Object.keys(r.body).sort()))
  check('...store is false (nothing is kept on the provider), stream is true, the effort is the registry\'s', r.body.store === false && r.body.stream === true && JSON.stringify(r.body.reasoning) === `{"effort":"${sol.effort}"}`, JSON.stringify(r.body.reasoning))
  check('...the system prompt is `instructions`, the conversation is `input` as plain role/content, and max_output_tokens is 16000', /^You are an AI assistant/.test(r.body.instructions) && JSON.stringify(r.body.input) === '[{"role":"user","content":"hello there"}]' && r.body.max_output_tokens === 16000)
  check('...no Anthropic-only field (cache_control, output_config, system, max_tokens, messages) and no sampling field', !['cache_control', 'output_config', 'system', 'max_tokens', 'messages', 'temperature', 'top_p', 'tools'].some((k) => k in r.body))
}

// ---- every model in the registry, and the effort rules ----------------------------------------------------------
for (const m of openaiModels) {
  await reset()
  const { events, error } = await collect(buildStreamRequest({ credentials: creds, model: m, messages: [{ role: 'user', content: 'hi ' + m.id }], signal: new AbortController().signal }))
  const [r] = await get()
  check(`${m.id}: accepted by the (model-aware, strict) mock and streams`, !error && events.at(-1)?.end?.kind === 'done' && r.problems.length === 0, `${error ?? ''} ${r?.problems?.join(' | ')}`)
  check(`${m.id}: the request names this model and its own effort ("${m.effort}")`, r.body.model === m.id && r.body.reasoning?.effort === m.effort)
}
{
  await reset()
  const r1 = await collect(req('x', { model: { ...luna, effort: 'none' } }))
  check('Luna takes effort "none" (the mock accepts it)', !r1.error && (await get())[0].body.reasoning.effort === 'none')
  await reset()
  const r2 = await collect(req('x', { model: { ...sol, effort: 'none' } }))
  check('control: forcing "none" onto Sol makes the mock answer 400, which the person reads as a refused request', !!r2.error && /^The request was refused \(400\): .*does not support 'none'/.test(sentence(r2.error)), r2.error ? sentence(r2.error) : '')
  await reset()
  const r3 = await collect(req('x', { model: { ...sol, effort: 'max' } }))
  check('"max" and "xhigh" are accepted by models that list them', !r3.error)
  await reset()
  const noEffort = await collect(req('x', { model: { ...sol, effort: null } }))
  check('a model with effort null sends no reasoning field at all (the provider\'s own default applies)', !noEffort.error && !('reasoning' in (await get())[0].body))
}

// ---- other endings, each with usage --------------------------------------------------------------------------------
{
  const ending = async (directive) => (await collect(req(`[[mock:${directive}]] hi`)))
  let r = await ending('incomplete-max')
  check('incomplete / max_output_tokens ends as "cut-off", with the text that arrived', r.events.at(-1)?.end?.kind === 'cut-off' && r.events.filter((e) => e.type === 'text').map((e) => e.text).join('') === 'Cut off here', JSON.stringify(r.events.at(-1)))
  r = await ending('incomplete-filter')
  check('incomplete / content_filter ends as "declined" (category content_filter)', r.events.at(-1)?.end?.kind === 'declined' && r.events.at(-1).end.category === 'content_filter', JSON.stringify(r.events.at(-1)?.end))
  r = await ending('incomplete-odd')
  check('incomplete for a reason this app has not met ends as "cut-off" (it ran out of room, as far as anyone can tell)', r.events.at(-1)?.end?.kind === 'cut-off')
  r = await ending('refusal')
  check('a refusal is SHOWN as text (the explanation the model wrote) and the reply ends as "declined"', r.events.filter((e) => e.type === 'text').map((e) => e.text).join('').startsWith("I'm sorry") && r.events.at(-1)?.end?.kind === 'declined' && r.events.at(-1).end.category === null, JSON.stringify(r.events.at(-1)?.end))
  r = await ending('empty')
  check('a reply with no text ends "done" (the page says it was empty)', !r.error && r.events.length === 1 && r.events[0].end.kind === 'done')
  r = await ending('cached')
  check('cached tokens: usage splits input 25 into 11 ordinary + 10 read + 4 written, output 40 (they are subsets, not additions)', JSON.stringify(r.events.at(-1)?.usage) === JSON.stringify({ inputTokens: 11, cacheReadTokens: 10, cacheWriteTokens: 4, outputTokens: 40 }), JSON.stringify(r.events.at(-1)?.usage))
  r = await ending('failed')
  check('response.failed throws, after the text that arrived, and no end event is produced', !!r.error && r.events.every((e) => e.type === 'text') && r.events.length >= 1, String(r.error))
  const f = n(r.error)
  check('...it is a "provider" error without a status, in the provider\'s own words', f.kind === 'provider' && f.status === null && f.message === 'OpenAI stopped the reply: The model failed to generate a response.', JSON.stringify(f))
  r = await ending('midstream-error')
  const m = n(r.error)
  check('an error event in the middle of a reply throws, text kept, "OpenAI stopped the reply: ..."', !!r.error && r.events.length >= 1 && m.kind === 'provider' && m.status === null && /^OpenAI stopped the reply: The server had an error/.test(m.message), JSON.stringify(m))
  r = await ending('early-close')
  const e1 = n(r.error)
  check('a stream that closes cleanly WITHOUT saying the reply is complete is an interruption, not "done"', !!r.error && e1.kind === 'interrupted' && /connection was interrupted/.test(e1.message), JSON.stringify(e1))
  r = await ending('drop')
  check('a connection dropped mid-reply is an interruption, text kept', !!r.error && r.events.length >= 1 && n(r.error).kind === 'interrupted', String(r.error))
}

// ---- failures before any text ---------------------------------------------------------------------------------------
{
  const fail = async (directive) => { const r = await collect(req(`[[mock:${directive}]] hi`)); return { r, n: r.error ? n(r.error) : null, sentence: r.error ? sentence(r.error) : '(no error)' } }
  const cases = [
    ['401', 'auth', 401, /^The API key was not accepted \(401\)\. Check it in Settings\. \(request req_mock_oai_401\)$/],
    ['403', 'permission', 403, /^This API key is not allowed to do that \(403\)\. Country, region, or territory not supported \(request /],
    ['404', 'not-found', 404, /^The model gpt-6\.1-sol was not found for this account \(404\)\. You can choose another model in the header\. .*does not exist or you do not have access to it\. \(request /],
    ['429', 'rate-limit', 429, /^Too many requests right now \(429\)\. Wait a moment and try again\. \(request /],
    ['429-quota', 'quota', 429, /^Your OpenAI account has no credit left, or has reached its spending limit \(429\)\. Check your billing with OpenAI\. \(request /],
    ['429-credit', 'quota', 429, /^Your OpenAI account has no credit left/],
    ['400-context', 'bad-request', 400, /^The request was refused \(400\): This model's maximum context length is 1050000 tokens/],
    ['500', 'server', 500, /^OpenAI had a problem on its side \(500\)\. Try again in a moment\. \(request /],
    ['503', 'overloaded', 503, /^OpenAI is overloaded right now \(503\)\. Try again in a moment\. \(request /]
  ]
  for (const [directive, kind, status, pattern] of cases) {
    const x = await fail(directive)
    check(`${directive}: classified "${kind}", and the sentence is plain`, x.n?.kind === kind && x.n.status === status && pattern.test(x.sentence) && x.r.events.length === 0, `${JSON.stringify(x.n)} | ${x.sentence}`)
  }
  const echo = await fail('echo-key')
  check('a provider that repeats the whole key in its error: the sentence has [key], never the key', echo.n?.kind === 'auth' && !echo.sentence.includes(KEY) && /^The API key was not accepted \(401\)/.test(echo.sentence), echo.sentence)
  check('...(and the raw message the SDK built DOES contain the key, so the scrub is what protects it)', n(echo.r.error).kind === 'auth' && String(echo.r.error.message).includes(KEY))
  await reset()
  const flaky = await collect(req('[[mock:flaky]] hi'))
  check('overloaded twice, then fine: the SDK\'s own retries hide it from the person (3 attempts)', !flaky.error && flaky.events.at(-1)?.end?.kind === 'done' && (await get()).length === 3, `${flaky.error} / ${(await get()).length}`)
  const unknown = await collect(req('x', { model: { ...sol, id: 'gpt-nope-1' } }))
  check('a model the API does not know: "The model gpt-nope-1 was not found..."', /^The model gpt-nope-1 was not found for this account \(404\)/.test(unknown.error ? sentence(unknown.error, 'gpt-nope-1') : ''))
  await post('/__expect-key', { provider: 'openai', key: 'a-completely-different-key-1234567890' })
  const wrong = await collect(req('hi'))
  check('a key the provider does not accept: auth, 401, and the message does not contain our key', n(wrong.error).kind === 'auth' && !sentence(wrong.error).includes(KEY))
  await reset()
  const nobody = await collect(req('x', { credentials: { apiKey: KEY, baseURL: 'http://127.0.0.1:1' } }))
  check('nothing listening: "Could not reach OpenAI"', n(nobody.error).kind === 'connection' && /^Could not reach OpenAI\. Check your internet connection\.$/.test(n(nobody.error).message), JSON.stringify(n(nobody.error)))
}

// ---- Stop -------------------------------------------------------------------------------------------------------------
{
  await reset()
  let seen = 0
  for await (const e of openaiAdapter.stream(req('[[mock:slow]] go'))) { if (e.type === 'text' && ++seen >= 2) break }
  await new Promise((r) => setTimeout(r, 500))
  check('breaking out of the loop closes the HTTP request (the server stops generating)', (await get())[0]?.closedEarly === true && seen === 2)
  await reset()
  const controller = new AbortController()
  const out = []
  let error = null
  const run = (async () => { try { for await (const e of openaiAdapter.stream(req('[[mock:slow]] go', { signal: controller.signal }))) out.push(e) } catch (e) { error = e } })()
  await new Promise((r) => setTimeout(r, 900))
  controller.abort()
  await run
  await new Promise((r) => setTimeout(r, 300))
  check('aborting the signal makes the generator throw, with text so far and no end event, and closes the request', !!error && out.length > 2 && out.every((e) => e.type === 'text') && (await get())[0]?.closedEarly === true)
  await reset()
  const c2 = new AbortController()
  const hung = collect(req('[[mock:hang-before]] go', { signal: c2.signal }))
  await new Promise((r) => setTimeout(r, 400))
  c2.abort()
  const h = await hung
  await new Promise((r) => setTimeout(r, 300))
  check('Stop before the server has answered at all also cancels cleanly', !!h.error && (await get())[0]?.closedEarly === true)
}

// ---- the environment must not leak in ----------------------------------------------------------------------------------
{
  await reset()
  const hostile = { OPENAI_API_KEY: 'ambient-key', OPENAI_ADMIN_KEY: 'ambient-admin', OPENAI_ORG_ID: 'org-ambient', OPENAI_PROJECT_ID: 'proj-ambient', OPENAI_WEBHOOK_SECRET: 'whsec_ambient', OPENAI_BASE_URL: 'http://127.0.0.1:1/v1', OPENAI_LOG: 'debug', OPENAI_CUSTOM_HEADERS: 'Authorization: Bearer ambient-header\nX-Smuggled: yes' }
  Object.assign(process.env, hostile)
  const logged = []
  const realLog = console.log, realDebug = console.debug, realInfo = console.info
  console.log = console.debug = console.info = (...a) => logged.push(a.join(' '))
  const { events, error } = await collect(req('ambient check'))
  Object.assign(console, { log: realLog, debug: realDebug, info: realInfo })
  const listed = await openaiAdapter.listModels(creds)
  const records = await get()
  const stillThere = Object.keys(hostile).every((k) => process.env[k] === hostile[k])
  for (const k of Object.keys(hostile)) delete process.env[k]
  const [r, l] = [records.find((x) => !x.listing), records.find((x) => x.listing)]
  check('hostile OPENAI_* variables: the request still reaches our server and succeeds', !error && events.at(-1)?.end?.kind === 'done' && !!r, String(error))
  check('...it carries OUR key and no other credential (an Authorization header from OPENAI_CUSTOM_HEADERS did not replace it)', r?.headers['authorization'] === `Bearer ${KEY}`)
  check('...no organization or project header, and nothing smuggled in through OPENAI_CUSTOM_HEADERS', r?.headers['openai-organization'] === undefined && r?.headers['openai-project'] === undefined && r?.headers['x-smuggled'] === undefined, JSON.stringify(Object.keys(r?.headers ?? {})))
  check('...the same holds for a model listing', listed.length === 8 && l?.headers['authorization'] === `Bearer ${KEY}` && l?.headers['x-smuggled'] === undefined)
  check('...the SDK printed nothing although OPENAI_LOG=debug (the app sets its own log level)', logged.length === 0, logged.slice(0, 2).join(' | ').slice(0, 200))
  check('...and the environment was put back exactly as it was (OPENAI_CUSTOM_HEADERS included)', stillThere)
}

// ---- listModels ------------------------------------------------------------------------------------------------------
{
  await reset()
  const listed = await openaiAdapter.listModels(creds)
  const [rec] = await get()
  check('listModels returns every model OpenAI lists (8 in the mock), with no names (OpenAI gives ids only)', listed.length === 8 && listed[0].id === 'gpt-6-astra' && listed.every((m) => m.label === null), JSON.stringify(listed.slice(0, 2)))
  check('...a GET /v1/models with the key as a Bearer token and no x-api-key', rec?.listing === true && rec.headers['authorization'] === `Bearer ${KEY}` && rec.headers['x-api-key'] === undefined)
  check('...every OpenAI registry model is in this (mock) listing', openaiModels.every((m) => listed.some((x) => x.id === m.id)))
  check('...and it cost nothing: one GET, no responses request', (await get()).length === 1)
  await reset()
  await post('/__models', { many: 2500 })
  const runaway = await openaiAdapter.listModels(creds)
  check('a listing of 2500 models is cut at 1000 (nobody has that many, and a runaway listing must not run on)', runaway.length === 1000 && runaway[0].id === 'made-up-model-0' && runaway.at(-1).id === 'made-up-model-999', String(runaway.length))
  await reset()
  await post('/__expect-key', { provider: 'openai', key: 'another-key-that-is-long-enough-1234' })
  let e401 = null
  try { await openaiAdapter.listModels(creds) } catch (e) { e401 = e }
  check('a rejected key: auth, 401, request id, and no key in the sentence', n(e401).kind === 'auth' && n(e401).status === 401 && n(e401).requestId === 'req_mock_oai_401' && !sentence(e401).includes(KEY))
  for (const [status, kind] of [[429, 'rate-limit'], [500, 'server']]) {
    await reset()
    await post('/__models', { fail: status })
    let e = null
    try { await openaiAdapter.listModels(creds) } catch (x) { e = x }
    check(`a listing that fails with ${status} is "${kind}"`, !!e && n(e).kind === kind, e ? JSON.stringify(n(e)) : 'no error')
  }
  await reset()
  await post('/__models', { hang: true })
  const controller = new AbortController()
  const hungList = openaiAdapter.listModels(creds, controller.signal).then(() => null, (e) => e)
  await new Promise((r) => setTimeout(r, 300))
  controller.abort()
  const aborted = await hungList
  await new Promise((r) => setTimeout(r, 300))
  check('a listing that never answers can be abandoned, and the request is closed', !!aborted && (await get())[0]?.closedEarly === true)
}

// ---- usage() -----------------------------------------------------------------------------------------------------------
{
  const u = (r) => openaiAdapter.usage(r)
  const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b)
  check('usage: a full report: input 100 (30 cached, 20 written) -> 50 ordinary, 30 read, 20 written; output 70 (reasoning inside it)', eq(u({ input_tokens: 100, input_tokens_details: { cached_tokens: 30, cache_write_tokens: 20 }, output_tokens: 70, output_tokens_details: { reasoning_tokens: 55 }, total_tokens: 170 }), { inputTokens: 50, cacheReadTokens: 30, cacheWriteTokens: 20, outputTokens: 70 }))
  check('usage: no details at all', eq(u({ input_tokens: 5, output_tokens: 6 }), { inputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 6 }))
  check('usage: cached or written counts larger than the input are clamped, never negative', (() => { const x = u({ input_tokens: 10, input_tokens_details: { cached_tokens: 50, cache_write_tokens: 50 }, output_tokens: 1 }); return x.inputTokens === 0 && x.cacheReadTokens === 10 && x.cacheWriteTokens === 0 })())
  check('usage: the four buckets always add up to input + output', (() => { const x = u({ input_tokens: 123, input_tokens_details: { cached_tokens: 40, cache_write_tokens: 7 }, output_tokens: 9 }); return x.inputTokens + x.cacheReadTokens + x.cacheWriteTokens + x.outputTokens === 132 })())
  for (const [name, report] of [['undefined', undefined], ['null', null], ['a string', 'x'], ['an array', []], ['an empty object', {}], ['details that are not an object', { input_tokens: 5, input_tokens_details: 'x' }]]) {
    check(`usage: ${name} does not throw`, (() => { try { u(report); return true } catch { return false } })())
  }
  check('usage: garbage numbers count as 0', eq(u({ input_tokens: NaN, output_tokens: -1, input_tokens_details: { cached_tokens: 'x' } }), { inputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 }))
}

// ---- normalizeError for hand-built errors ---------------------------------------------------------------------------------
{
  const mk = (status, message, code = null, type = 'invalid_request_error', headers = {}) => OpenAI.APIError.generate(status, { error: { message, type, param: null, code } }, message, new Headers(headers))
  const table = [
    [mk(400, 'x'), 'bad-request', 400], [mk(401, 'x'), 'auth', 401], [mk(403, 'x'), 'permission', 403], [mk(404, 'x'), 'not-found', 404],
    [mk(429, 'x', 'rate_limit_exceeded'), 'rate-limit', 429], [mk(429, 'x', 'slow_down'), 'rate-limit', 429], [mk(429, 'x', 'insufficient_quota'), 'quota', 429],
    [mk(429, 'x', 'organization_spend_limit_exceeded'), 'quota', 429], [mk(429, 'x', 'project_spend_limit_exceeded'), 'quota', 429], [mk(429, 'x', 'organization_usage_limit_exceeded'), 'quota', 429],
    [mk(429, 'x', null, 'insufficient_quota'), 'quota', 429],
    [mk(500, 'x'), 'server', 500], [mk(502, 'x'), 'server', 502], [mk(503, 'x'), 'overloaded', 503], [mk(504, 'x'), 'server', 504],
    [mk(409, 'x'), 'provider', 409], [mk(422, 'x'), 'provider', 422],
    [new OpenAI.APIConnectionError({ message: 'x' }), 'connection', null], [new OpenAI.APIConnectionTimeoutError(), 'timeout', null],
    [new Error('terminated'), 'interrupted', null], [new Error('boom'), 'unknown', null], ['text', 'unknown', null], [null, 'unknown', null]
  ]
  for (const [error, kind, status] of table) {
    const r = n(error)
    check(`normalizeError: ${String(error?.constructor?.name ?? error)}${status ? ' ' + status : ''}${error?.code ? ' ' + error.code : ''} -> ${kind}`, r.kind === kind && r.status === status, JSON.stringify(r))
  }
  check('normalizeError: the request id (the x-request-id header) is carried', n(mk(500, 'x', null, 'server_error', { 'x-request-id': 'req_abc' })).requestId === 'req_abc' && n(new Error('x')).requestId === null)
  check('normalizeError: the provider\'s own words are used for details (not the SDK\'s "400 ..." prefix)', n(mk(400, 'plain words')).message === 'The request was refused (400): plain words')
  check('normalizeError: the sentences name OpenAI, never Anthropic', ['connection', 'overloaded', 'server', 'provider', 'quota'].every((k) => !/Anthropic/.test(JSON.stringify([n(new OpenAI.APIConnectionError({ message: 'x' })), n(mk(503, 'x')), n(mk(500, 'x')), n(mk(409, 'x')), n(mk(429, 'x', 'insufficient_quota'))]))))
}

await mock.close()
const ok = check.summary()
process.exit(ok ? 0 : 1)
