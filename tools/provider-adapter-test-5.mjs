// Stage 5.1: the provider LAYER's own contract, checked under plain Node against the mock (no window, no Electron).
// The old 93-check suite proves nothing changed; this one proves what is NEW: the interface (listModels, usage,
// normalizeError, the shape of stream), the request builder, and the properties an async generator adds.
import { REPO_URL } from './paths.mjs'
import './ts-resolve.mjs'
import { checker } from './cdp.mjs'
import { readFileSync } from 'node:fs'
import { startMock } from './mock-providers.mjs'
import { randomBytes } from 'node:crypto'

const check = checker()
const base = `${REPO_URL}/src/main/providers/`
const { adapterFor } = await import(base + 'index.ts')
const { anthropicAdapter, API_BASE_URL } = await import(base + 'anthropic.ts')
const { buildStreamRequest, mergeAdjacent, systemPromptFor, MAX_REPLY_TOKENS } = await import(base + 'request.ts')
const { describeFailure, unknownError, isInterrupted, normalizedError } = await import(base + 'errors.ts')
const { tokenCount, fieldsOf, NO_USAGE } = await import(base + 'usage.ts')
const { parseRegistry, SUPPORTED_PROVIDERS, PROVIDER_NAMES } = await import(`${REPO_URL}/src/shared/registry.ts`)
const Anthropic = (await import(`${REPO_URL}/node_modules/@anthropic-ai/sdk/index.mjs`)).default

const registry = parseRegistry(JSON.parse(readFileSync(new URL('./registry-good.json', import.meta.url), 'utf8')))
if (!registry.ok) throw new Error('registry unusable: ' + registry.error)
const models = Object.fromEntries(registry.registry.models.map((m) => [m.id, m]))
const opus = models['claude-opus-5-5']
const haiku = models['claude-haiku-4-5-20251001']

const PORT = Number(process.env.ADAPTER_TEST_PORT ?? 8897)
const mock = await startMock(PORT)
const origin = `http://127.0.0.1:${PORT}`
const KEY = 'test-' + randomBytes(24).toString('hex')
const creds = { apiKey: KEY, baseURL: origin }
const get = async () => (await fetch(`${origin}/__requests`)).json()
const reset = () => fetch(`${origin}/__reset`, { method: 'POST' })
const post = (path, body) => fetch(`${origin}${path}`, { method: 'POST', body: JSON.stringify(body) })

async function collect(request) {
  const events = []
  let error = null
  try { for await (const event of anthropicAdapter.stream(request)) events.push(event) } catch (e) { error = e }
  return { events, error }
}
const req = (text, extra = {}) => buildStreamRequest({ credentials: creds, model: opus, messages: [{ role: 'user', content: text }], signal: new AbortController().signal, ...extra })

// ---- the table of adapters ------------------------------------------------------------------------------
for (const provider of SUPPORTED_PROVIDERS) {
  const adapter = adapterFor(provider)
  check(`adapterFor('${provider}') exists and says which provider it is`, !!adapter && adapter.provider === provider)
  check(`...and has all four methods of the interface`, ['listModels', 'stream', 'usage', 'normalizeError'].every((m) => typeof adapter?.[m] === 'function'))
  check(`...and the provider has a display name`, typeof PROVIDER_NAMES[provider] === 'string' && PROVIDER_NAMES[provider] !== '')
}
check('Anthropic is the first provider and OpenAI the second (D-022)', JSON.stringify(SUPPORTED_PROVIDERS) === '["anthropic","openai"]')
check('API_BASE_URL is the real address', API_BASE_URL === 'https://api.anthropic.com')

// ---- request building (the app's own rules, applied once) ---------------------------------------------
{
  const r = req('hi')
  check('buildStreamRequest: the neutral request has exactly the documented fields', JSON.stringify(Object.keys(r).sort()) === JSON.stringify(['credentials', 'effort', 'maxOutputTokens', 'messages', 'model', 'signal', 'system']), Object.keys(r).join(','))
  // 7.1 (D-024): `effort` is what this reply asks for. Left out, it is the registry's pick; given, it is used; null (a model that takes none) stays null.
  check('...effort is the registry\'s pick when chat.ts gives none', r.effort === opus.effort && r.effort !== null)
  check('...a given effort is used, and the registry\'s pick is no longer what the request says', req('hi', { effort: opus.effort === 'low' ? 'high' : 'low' }).effort === (opus.effort === 'low' ? 'high' : 'low'))
  check('...null stays null (a model that takes none), not the registry\'s pick', req('hi', { model: opus, effort: null }).effort === null)
  check('...max output is the app ceiling for a model that can write more', r.maxOutputTokens === MAX_REPLY_TOKENS && MAX_REPLY_TOKENS === 16000)
  check('...and the model\'s own limit when that is lower', buildStreamRequest({ credentials: creds, model: { ...opus, maxOutputTokens: 4000 }, messages: [{ role: 'user', content: 'x' }], signal: r.signal }).maxOutputTokens === 4000)
  check('...the system prompt is the provider\'s (it names Claude, says the window renders Markdown: D-025)', r.system === systemPromptFor('anthropic') && /^You are Claude, chatting with someone in Frontier App/.test(r.system) && /renders Markdown/.test(r.system) && !/plain text/.test(r.system))
  check('...consecutive turns by one side are joined', buildStreamRequest({ credentials: creds, model: opus, messages: [{ role: 'user', content: 'a' }, { role: 'user', content: 'b' }], signal: r.signal }).messages.length === 1)
  const input = [{ role: 'user', content: 'a' }, { role: 'user', content: 'b' }]
  const frozen = Object.freeze(input.map((m) => Object.freeze({ ...m })))
  let threw = false
  try { mergeAdjacent(frozen) } catch { threw = true }
  check('mergeAdjacent accepts frozen input (it must never write to what it is given)', !threw)
  check('the request does not carry policy the adapter should not see twice (no stream flag, no provider fields)', !('stream' in r) && !('output_config' in r) && !('cache_control' in r))
}

// ---- stream(): the contract ---------------------------------------------------------------------------
{
  const { events, error } = await collect(req('hello there'))
  const kinds = events.map((e) => e.type)
  check('stream yields text events then exactly ONE end event, last', !error && kinds.at(-1) === 'end' && kinds.filter((k) => k === 'end').length === 1 && kinds.slice(0, -1).every((k) => k === 'text') && kinds.length >= 2, JSON.stringify(kinds))
  check('...the text is the reply', events.filter((e) => e.type === 'text').map((e) => e.text).join('') === 'Echo: hello there')
  const end = events.at(-1)
  check('...the end says "done"', end?.end?.kind === 'done')
  check('...and carries usage in the four neutral buckets (the mock reports 25 in, 12 out)', JSON.stringify(end?.usage) === JSON.stringify({ inputTokens: 25, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 12 }), JSON.stringify(end?.usage))
  check('...usage is whole numbers only', Object.values(end?.usage ?? {}).every((n) => Number.isInteger(n) && n >= 0))
}
{
  // a failure THROWS from the generator, after the text that arrived before it
  const events = []
  let error = null
  try { for await (const e of anthropicAdapter.stream(req('[[mock:midstream-error]] hi'))) events.push(e) } catch (e) { error = e }
  check('a failure in the middle of a reply throws out of the generator, with the earlier text already delivered', !!error && events.length === 1 && events[0].type === 'text' && events[0].text === 'Partial ', JSON.stringify(events))
  const n = anthropicAdapter.normalizeError(error, { modelId: opus.id })
  check('...and normalizeError calls it a provider error with no status', n.kind === 'provider' && n.status === null && /Anthropic stopped the reply: Overloaded/.test(n.message), JSON.stringify(n))
}
{
  // an end event is never produced for a failed reply
  const { events, error } = await collect(req('[[mock:500]] hi'))
  check('a request refused up front yields no events at all and throws', !!error && events.length === 0)
}
{
  // breaking out of the loop (the consumer gives up) must cancel the network request: this is new with a generator
  await reset()
  let seen = 0
  for await (const e of anthropicAdapter.stream(req('[[mock:slow]] go'))) { if (e.type === 'text' && ++seen >= 2) break }
  await new Promise((r) => setTimeout(r, 500))
  const [record] = await get()
  check('breaking out of the for-await loop closes the HTTP request (the server stops generating)', record?.closedEarly === true && seen === 2, JSON.stringify({ closedEarly: record?.closedEarly, seen }))
}
{
  // an aborted signal: the call throws, whatever the SDK calls it
  await reset()
  const controller = new AbortController()
  const out = []
  let error = null
  const run = (async () => { try { for await (const e of anthropicAdapter.stream(req('[[mock:slow]] go', { signal: controller.signal }))) out.push(e) } catch (e) { error = e } })()
  await new Promise((r) => setTimeout(r, 900))
  controller.abort()
  await run
  check('aborting the signal makes the generator throw, with the text so far delivered and no end event', !!error && out.length > 2 && out.every((e) => e.type === 'text'))
}
{
  // an already-aborted signal
  const controller = new AbortController(); controller.abort()
  const { events, error } = await collect(req('hi', { signal: controller.signal }))
  check('a signal that is already aborted throws before anything is yielded', !!error && events.length === 0)
}
{
  // other endings carry the right kind AND usage
  for (const [directive, kind] of [['max-tokens', 'cut-off'], ['refusal', 'declined'], ['context-full', 'context-full'], ['empty', 'done']]) {
    const { events, error } = await collect(req(`[[mock:${directive}]] hi`))
    const end = events.at(-1)
    check(`ending "${directive}" is reported as ${kind}, with usage`, !error && end?.type === 'end' && end.end.kind === kind && end.usage.outputTokens === 12, JSON.stringify(end))
  }
  const { events } = await collect(req('[[mock:refusal]] hi'))
  check('a refusal carries its category', events.at(-1).end.category === 'cyber')
}

// ---- usage(): provider reports of every shape ---------------------------------------------------------
{
  const u = (r) => anthropicAdapter.usage(r)
  const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b)
  check('usage: a full Anthropic report maps to the four buckets', eq(u({ input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 300, cache_creation_input_tokens: 40, server_tool_use: null, service_tier: 'standard' }), { inputTokens: 10, cacheReadTokens: 300, cacheWriteTokens: 40, outputTokens: 20 }))
  check('usage: nulls (the SDK reports null for a cache that was not used) count as 0', eq(u({ input_tokens: 5, output_tokens: 6, cache_read_input_tokens: null, cache_creation_input_tokens: null }), { inputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 6 }))
  for (const [name, report] of [['undefined', undefined], ['null', null], ['a string', 'x'], ['a number', 7], ['an array', []], ['an empty object', {}]]) {
    check(`usage: ${name} counts as nothing and does not throw`, eq(u(report), NO_USAGE))
  }
  check('usage: garbage numbers count as 0 (NaN, Infinity, negative, text, objects)', eq(u({ input_tokens: NaN, output_tokens: Infinity, cache_read_input_tokens: -5, cache_creation_input_tokens: '7' }), NO_USAGE))
  check('usage: fractions are floored to whole tokens', u({ input_tokens: 10.9 }).inputTokens === 10)
  check('usage: extra unknown fields are ignored', eq(u({ input_tokens: 1, output_tokens: 2, something_new: 99 }), { inputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 2 }))
  check('usage: the result is a fresh object each time (callers may add to it)', u({}) !== u({}))
  check('tokenCount / fieldsOf: the helpers behave', tokenCount(3) === 3 && tokenCount('3') === 0 && tokenCount(-1) === 0 && JSON.stringify(fieldsOf(null)) === '{}' && JSON.stringify(fieldsOf([1])) === '{}')
  check('usage: the four buckets can be added up (the total is what the model read plus wrote)', (() => { const x = u({ input_tokens: 1, output_tokens: 2, cache_read_input_tokens: 3, cache_creation_input_tokens: 4 }); return x.inputTokens + x.cacheReadTokens + x.cacheWriteTokens + x.outputTokens === 10 })())
}

// ---- listModels() ---------------------------------------------------------------------------------------
{
  await reset()
  const listed = await anthropicAdapter.listModels(creds)
  const [record] = await get()
  check('listModels returns every model the provider lists, with its display name', listed.length === 6 && listed[0].id === 'claude-fable-5-1' && listed[0].label === 'Claude Fable 5.1', JSON.stringify(listed.slice(0, 2)))
  check('...asks GET /v1/models with the key in x-api-key and no Authorization header', record?.listing === true && record.headers['x-api-key'] === KEY && record.headers['authorization'] === undefined, JSON.stringify(record?.headers))
  check('...a listing costs nothing: it is one GET, no messages request', (await get()).length === 1 && (await get())[0].url.startsWith('/v1/models'))
  check('...every Anthropic model of the registry is in this (mock) listing', Object.values(models).filter((m) => m.provider === 'anthropic').every((m) => listed.some((l) => l.id === m.id)))
  await reset()
  await post('/__models', { pageSize: 2 })
  const paged = await anthropicAdapter.listModels(creds)
  const pages = (await get()).filter((r) => r.listing)
  check('listModels follows the pages by itself (3 pages of 2 give all 6, in order)', paged.length === 6 && pages.length === 3 && JSON.stringify(paged.map((m) => m.id)) === JSON.stringify(listed.map((m) => m.id)), `${paged.length} models in ${pages.length} requests`)
  check('...the follow-up pages ask for after_id', pages[1]?.url.includes('after_id=') && !pages[0].url.includes('after_id='), pages.map((p) => p.url).join(' | '))
  check('...with the largest page size the API allows (limit=1000), to need as few requests as possible', pages[0]?.url.includes('limit=1000'), pages[0]?.url)
  await reset()
  await post('/__expect-key', { key: 'another-key-that-is-long-enough-1234' })
  let err = null
  try { await anthropicAdapter.listModels(creds) } catch (e) { err = e }
  const n401 = err && anthropicAdapter.normalizeError(err, { modelId: '' })
  check('a key the provider rejects: listModels throws, and it is an "auth" error with the request id', n401?.kind === 'auth' && n401.status === 401 && n401.requestId === 'req_mock_401', JSON.stringify(n401))
  check('...whose sentence, as the person reads it, has no key in it', !describeFailure(n401, KEY).includes(KEY) && /not accepted \(401\)/.test(describeFailure(n401, KEY)))
  for (const [status, kind] of [[403, 'permission'], [404, 'not-found'], [429, 'rate-limit'], [500, 'server'], [529, 'overloaded']]) {
    await reset()
    await post('/__models', { fail: status })
    let e2 = null
    try { await anthropicAdapter.listModels(creds) } catch (e) { e2 = e }
    check(`a listing that fails with ${status} is classified "${kind}"`, !!e2 && anthropicAdapter.normalizeError(e2, { modelId: '' }).kind === kind, e2 ? JSON.stringify(anthropicAdapter.normalizeError(e2, { modelId: '' })) : 'no error')
  }
  let down = null
  try { await anthropicAdapter.listModels({ apiKey: KEY, baseURL: 'http://127.0.0.1:1' }) } catch (e) { down = e }
  check('a server nobody listens on: "connection" ("Could not reach Anthropic")', !!down && anthropicAdapter.normalizeError(down, { modelId: '' }).kind === 'connection' && /Could not reach Anthropic/.test(anthropicAdapter.normalizeError(down, { modelId: '' }).message))
  await reset()
  const controller = new AbortController(); controller.abort()
  let aborted = null
  try { await anthropicAdapter.listModels(creds, controller.signal) } catch (e) { aborted = e }
  check('a listing with an aborted signal throws', !!aborted)
  // ambient environment must not redirect the key
  await reset()
  Object.assign(process.env, { ANTHROPIC_AUTH_TOKEN: 'ambient-token', ANTHROPIC_API_KEY: 'ambient-key', ANTHROPIC_BASE_URL: 'http://127.0.0.1:1' })
  let ambient = null, got = null
  try { got = await anthropicAdapter.listModels(creds) } catch (e) { ambient = e }
  const [rec2] = await get()
  delete process.env.ANTHROPIC_AUTH_TOKEN; delete process.env.ANTHROPIC_API_KEY; delete process.env.ANTHROPIC_BASE_URL
  check('hostile ANTHROPIC_* variables do not redirect a listing, and do not add a second credential', !ambient && got?.length === 6 && rec2?.headers['x-api-key'] === KEY && rec2.headers['authorization'] === undefined, String(ambient))
}

// ---- normalizeError(): kinds, statuses, ids -------------------------------------------------------------
{
  const mk = (status, message, headers = {}) => Anthropic.APIError.generate(status, { type: 'error', error: { type: 't', message } }, message, new Headers(headers))
  const n = (e) => anthropicAdapter.normalizeError(e, { modelId: 'claude-opus-5-5' })
  const table = [
    [mk(400, 'x'), 'bad-request', 400], [mk(401, 'x'), 'auth', 401], [mk(403, 'x'), 'permission', 403], [mk(404, 'x'), 'not-found', 404],
    [mk(429, 'x'), 'rate-limit', 429], [mk(500, 'x'), 'server', 500], [mk(502, 'x'), 'server', 502], [mk(529, 'x'), 'overloaded', 529],
    [mk(409, 'x'), 'provider', 409], [mk(422, 'x'), 'provider', 422], [mk(413, 'x'), 'provider', 413],
    [new Anthropic.APIConnectionError({ message: 'x' }), 'connection', null], [new Anthropic.APIConnectionTimeoutError(), 'timeout', null],
    [new Error('terminated'), 'interrupted', null], [new Error('boom'), 'unknown', null], ['text', 'unknown', null], [null, 'unknown', null]
  ]
  for (const [error, kind, status] of table) {
    const r = n(error)
    check(`normalizeError: ${String(error?.constructor?.name ?? error)}${status ? ' ' + status : ''} -> ${kind}`, r.kind === kind && r.status === status, JSON.stringify(r))
  }
  check('normalizeError: the request id is carried, and only for errors that came with one', n(mk(500, 'x', { 'request-id': 'req_abc' })).requestId === 'req_abc' && n(new Error('x')).requestId === null && n(mk(500, 'x')).requestId === null)
  check('describeFailure: appends the request id', describeFailure(n(mk(500, 'x', { 'request-id': 'req_abc' })), KEY).endsWith('(request req_abc)'))
  check('describeFailure: scrubs a key of 8+ characters, wherever it appears', describeFailure({ kind: 'unknown', status: null, requestId: null, message: `a ${KEY} b ${KEY}` }, KEY) === 'a [key] b [key]')
  check('describeFailure: a short key (under 8) is not scrubbed (it would mangle ordinary words)', describeFailure({ kind: 'unknown', status: null, requestId: 'r', message: 'the key is abc' }, 'abc') === 'the key is abc (request r)')
  check('unknownError: a failure that is no provider\'s reads "Something went wrong: ..."', unknownError(new Error('disk on fire')).message === 'Something went wrong: disk on fire' && unknownError('x').kind === 'unknown')
  check('normalizedError: the provider\'s name goes into the sentences that name it', normalizedError({ kind: 'connection', status: null, detail: null, requestId: null, raw: '' }, { providerName: 'Acme', modelId: 'm' }).message === 'Could not reach Acme. Check your internet connection.')
  check('isInterrupted: looks through a chain of causes, but only four deep', isInterrupted(Object.assign(new Error('a'), { cause: Object.assign(new Error('b'), { code: 'ECONNRESET' }) })) && !isInterrupted(new Error('plain')))
}

// ---- the request really sent, once more, for a model that rejects effort ----------------------------------
{
  await reset()
  const { error, events } = await collect(buildStreamRequest({ credentials: creds, model: haiku, messages: [{ role: 'user', content: 'hi' }], signal: new AbortController().signal }))
  const [record] = await get()
  check('Haiku 4.5 through the adapter: accepted by the strict mock, no output_config', !error && events.at(-1)?.type === 'end' && record.problems.length === 0 && !('output_config' in record.body), JSON.stringify(record?.problems))
}

// ---- Stage 5.2: the adapter acts on the registry's capabilities --------------------------------------------
{
  const noCache = { ...opus, capabilities: { ...opus.capabilities, promptCaching: false } }
  await reset()
  await collect(req('hi', { model: noCache })) // the strict mock refuses a request without cache_control: only the request matters here
  const [withoutCaching] = await get()
  check('a model that cannot cache is not sent cache_control (the registry says so, D-019)', withoutCaching && !('cache_control' in withoutCaching.body), JSON.stringify(withoutCaching?.body && Object.keys(withoutCaching.body)))
  check('...and nothing else about the request changed (same fields, same order, minus cache_control)', JSON.stringify(Object.keys(withoutCaching?.body ?? {})) === '["model","max_tokens","system","messages","output_config","stream"]', JSON.stringify(Object.keys(withoutCaching?.body ?? {})))
  await reset()
  await collect(req('hi'))
  const [withCaching] = await get()
  check('a model that can cache is sent cache_control, last but for the stream flag', JSON.stringify(Object.keys(withCaching?.body ?? {})) === '["model","max_tokens","system","messages","output_config","cache_control","stream"]', JSON.stringify(Object.keys(withCaching?.body ?? {})))
}
{
  await reset()
  const { events, error } = await collect(req('hi', { model: { ...opus, effort: 'none' } }))
  check('an effort level Anthropic does not have ("none") fails before any request is made, saying so', !!error && /no effort level "none"/.test(error.message) && events.length === 0 && (await get()).length === 0, `${error?.message} / requests: ${(await get()).length}`)
}

await mock.close()
const ok = check.summary()
process.exit(ok ? 0 : 1)
