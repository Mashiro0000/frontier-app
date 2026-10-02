// The provider module (src/main/provider.ts) against the mock API, under plain Node: no Electron, no window.
// Node 24 runs the .ts file directly (types are stripped).
import { REPO, REPO_URL } from './paths.mjs'
import './ts-resolve.mjs'
import { checker } from './cdp.mjs'
import { readFileSync } from 'node:fs'
import { startMock } from './mock-providers.mjs'
import { randomBytes } from 'node:crypto'

const check = checker()
const { streamReply, describeError, mergeAdjacent, API_BASE_URL } = await import(new URL('./shim-new.mjs', import.meta.url).href)
const { parseRegistry } = await import(`${REPO_URL}/src/shared/registry.ts`)
// Stage 3: the models come from the real registry file, exactly as the app loads them.
const parsedRegistry = parseRegistry(JSON.parse(readFileSync(`${REPO}/registry/models.json`, 'utf8')))
if (!parsedRegistry.ok) throw new Error('registry unusable: ' + parsedRegistry.error)
const models = Object.fromEntries(parsedRegistry.registry.models.map((m) => [m.id, m]))
const opus = models['claude-opus-5-5']
const mock = await startMock(Number(process.env.NODE_TEST_PORT ?? 8791))
const base = `http://127.0.0.1:${mock.port}`
const fakeKey = 'test-' + randomBytes(24).toString('hex')
const get = async () => (await fetch(`${base}/__requests`)).json()
const reset = () => fetch(`${base}/__reset`, { method: 'POST' })

async function run(text, extra = {}) {
  const pieces = []
  const controller = new AbortController()
  let end = null, error = null
  try {
    end = await streamReply({ apiKey: fakeKey, baseURL: base, model: opus, messages: [{ role: 'user', content: text }], signal: controller.signal, onText: (t) => pieces.push(t), ...extra, ...(extra.signal ? {} : {}) })
  } catch (e) { error = e }
  return { pieces, text: pieces.join(''), end, error, controller }
}

// ---- pure helpers ---------------------------------------------------------------------------------
check('API_BASE_URL is the real address', API_BASE_URL === 'https://api.anthropic.com')
check('the default model comes from the registry: claude-opus-5-5', opus?.id === 'claude-opus-5-5' && parsedRegistry.registry.defaultModel === opus)
const m1 = mergeAdjacent([{ role: 'user', content: 'a' }, { role: 'user', content: 'b' }, { role: 'assistant', content: 'c' }, { role: 'user', content: 'd' }])
check('mergeAdjacent joins consecutive messages from one side', JSON.stringify(m1) === JSON.stringify([{ role: 'user', content: 'a\n\nb' }, { role: 'assistant', content: 'c' }, { role: 'user', content: 'd' }]), JSON.stringify(m1))
const input = [{ role: 'user', content: 'a' }, { role: 'user', content: 'b' }]
mergeAdjacent(input)
check('mergeAdjacent does not modify its input', JSON.stringify(input) === JSON.stringify([{ role: 'user', content: 'a' }, { role: 'user', content: 'b' }]))
check('mergeAdjacent leaves a clean alternation alone', mergeAdjacent([{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }, { role: 'user', content: 'c' }]).length === 3)

// ---- a normal reply ------------------------------------------------------------------------------
let r = await run('hello there')
check('streams the reply text as pieces and ends "done"', r.text === 'Echo: hello there' && r.end?.kind === 'done' && !r.error, JSON.stringify({ text: r.text, end: r.end, err: String(r.error) }))
check('the thinking block produced no text', !r.pieces.some((p) => p === ''))
let [req] = await get()
check('mock saw no problems with the request', req.problems.length === 0, JSON.stringify(req.problems))
check('x-api-key carries the key; no Authorization header', req.headers['x-api-key'] === fakeKey && req.headers['authorization'] === undefined)
check('body: model, stream, system, effort, caching are as designed', req.body.model === 'claude-opus-5-5' && req.body.stream === true && typeof req.body.system === 'string' && req.body.output_config?.effort === 'medium' && req.body.cache_control?.type === 'ephemeral' && req.body.max_tokens === 16000, JSON.stringify({ ...req.body, messages: undefined, system: undefined }))
check('body: no sampling parameters, no thinking parameter, no tools', !['temperature', 'top_p', 'top_k', 'thinking', 'tools', 'tool_choice'].some((k) => k in req.body))
check('body: the system prompt says the window renders Markdown (D-025)', /renders Markdown/.test(req.body.system) && !/plain text/.test(req.body.system))

// ---- ambient environment must not leak in ------------------------------------------------------------
await reset()
Object.assign(process.env, { ANTHROPIC_AUTH_TOKEN: 'ambient-token-should-not-be-sent', ANTHROPIC_API_KEY: 'ambient-key-should-not-be-sent', ANTHROPIC_BASE_URL: 'http://127.0.0.1:1' })
r = await run('ambient check')
;[req] = await get()
delete process.env.ANTHROPIC_AUTH_TOKEN; delete process.env.ANTHROPIC_API_KEY; delete process.env.ANTHROPIC_BASE_URL
check('hostile ANTHROPIC_* variables: request still reaches our server and succeeds', r.end?.kind === 'done' && !!req, String(r.error))
check('...sent our key, not the ambient one', req?.headers['x-api-key'] === fakeKey)
check('...and sent no bearer token from the environment', req?.headers['authorization'] === undefined)

// ---- history handling ---------------------------------------------------------------------------------
await reset()
r = await run('follow up', { messages: [{ role: 'user', content: 'first, never answered' }, { role: 'user', content: 'second' }] })
;[req] = await get()
check('two user messages in a row are merged, so the strict mock accepts them', r.end?.kind === 'done' && req.body.messages.length === 1 && req.body.messages[0].content === 'first, never answered\n\nsecond', JSON.stringify(req.body.messages))
await reset()
r = await run('x', { messages: [{ role: 'user', content: 'q1' }, { role: 'assistant', content: 'partial answer' }, { role: 'user', content: 'q2' }] })
;[req] = await get()
check('a normal multi-turn history goes through unchanged', r.end?.kind === 'done' && req.body.messages.length === 3 && req.body.messages[1].content === 'partial answer')

// ---- failures: what the person will read --------------------------------------------------------------
const expectError = async (directive, pattern, label) => {
  const res = await run(`[[mock:${directive}]] hi`)
  const message = res.error ? describeError(res.error, fakeKey, opus.id) : '(no error)'
  check(`${label}`, !!res.error && pattern.test(message), message)
  check(`   ...and the key is not in the message`, !message.includes(fakeKey))
  return message
}
await expectError('401', /API key was not accepted \(401\)\. Check it in Settings\. \(request req_mock_401\)/, '401 -> "key not accepted", with the request id')
await expectError('403', /not allowed to do that \(403\)/, '403 -> "not allowed"')
await expectError('404', /model claude-opus-5-5 was not found .*\(404\)\. You can choose another model in the header\./, '404 -> "model not found"')
await expectError('400-credit', /The request was refused \(400\): Your credit balance is too low/, '400 (credit) -> shows the API\'s own reason')
await expectError('429', /Too many requests right now \(429\)/, '429 -> "too many requests"')
await expectError('500', /problem on its side \(500\)/, '500 -> "problem on its side"')
await expectError('529', /overloaded right now \(529\)/, '529 -> "overloaded"')
const mid = await expectError('midstream-error', /Anthropic stopped the reply: Overloaded/, 'error event mid-reply -> "stopped the reply: Overloaded"')
const midRun = await run('[[mock:midstream-error]] hi')
check('...the text that arrived before it is kept', midRun.text === 'Partial ', JSON.stringify(midRun.text))
const dropRun = await run('[[mock:drop]] hi')
check('a dropped connection mid-reply is an error, with partial text kept', !!dropRun.error && dropRun.text === 'Partial ', `${dropRun.text} | ${describeError(dropRun.error, fakeKey, opus.id)}`)
check('...and it reads as an interrupted connection, not "terminated"', /connection was interrupted while the reply was arriving/.test(describeError(dropRun.error, fakeKey, opus.id)), describeError(dropRun.error, fakeKey, opus.id))
const refused = await run('x', { baseURL: 'http://127.0.0.1:1' })
const refusedMsg = describeError(refused.error, fakeKey, opus.id)
check('nothing listening: "Could not reach Anthropic"', /Could not reach Anthropic/.test(refusedMsg), refusedMsg)
check('a wrong key against a server that checks it gives the 401 message', await (async () => {
  await fetch(`${base}/__expect-key`, { method: 'POST', body: JSON.stringify({ key: 'some-other-key-that-is-long-enough' }) })
  const res = await run('plain hi')
  await reset()
  return /not accepted \(401\)/.test(describeError(res.error, fakeKey, opus.id))
})())
check('describeError scrubs the key even if an error message contained it', describeError(new Error(`failed with ${fakeKey} inside`), fakeKey, opus.id) === 'Something went wrong: failed with [key] inside')
check('describeError copes with a non-Error', describeError('plain string', fakeKey, opus.id) === 'Something went wrong: plain string')

// ---- endings --------------------------------------------------------------------------------------------
r = await run('[[mock:max-tokens]] hi')
check('max_tokens ends as "cut-off" with its text', r.end?.kind === 'cut-off' && r.text === 'Cut off here', JSON.stringify(r.end))
r = await run('[[mock:refusal]] hi')
check('refusal ends as "declined" with its category', r.end?.kind === 'declined' && r.end.category === 'cyber' && r.text === '', JSON.stringify(r.end))
r = await run('[[mock:context-full]] hi')
check('context window exceeded ends as "context-full"', r.end?.kind === 'context-full' && r.text === 'Almost ')
r = await run('[[mock:empty]] hi')
check('a reply with no text still ends "done" (the UI says it was empty)', r.end?.kind === 'done' && r.text === '')

// ---- the SDK's own retries hide a transient overload --------------------------------------------------
await reset()
r = await run('[[mock:flaky]] hi')
const attempts = (await get()).length
check('overloaded twice, then fine: the person just gets the reply', r.end?.kind === 'done' && r.text === 'Echo: hi' && !r.error, String(r.error))
check('...it took 3 attempts (the SDK retried by itself)', attempts === 3, `attempts: ${attempts}`)

// ---- Stop: aborting must close the connection so the server stops generating ----------------------
await reset()
const pieces = []
const controller = new AbortController()
const slow = streamReply({ apiKey: fakeKey, baseURL: base, model: opus, messages: [{ role: 'user', content: '[[mock:slow]] go' }], signal: controller.signal, onText: (t) => pieces.push(t) })
await new Promise((resolve) => setTimeout(resolve, 900))
controller.abort()
let slowError = null
try { await slow } catch (e) { slowError = e }
await new Promise((resolve) => setTimeout(resolve, 400))
;[req] = await get()
check('abort rejects the call', !!slowError, String(slowError))
check('some text had arrived before the abort', pieces.length > 2, `${pieces.length} pieces`)
check('the HTTP request was really closed early (the server stops generating)', req.closedEarly === true)
check('...and quickly (well before the 30 s the slow reply would take)', req.finishedAt - req.startedAt < 3000, `${req.finishedAt - req.startedAt} ms`)
await reset()
const c2 = new AbortController()
const hung = streamReply({ apiKey: fakeKey, baseURL: base, model: opus, messages: [{ role: 'user', content: '[[mock:hang-before]] go' }], signal: c2.signal, onText: () => {} })
await new Promise((resolve) => setTimeout(resolve, 400))
c2.abort()
let hungError = null
try { await hung } catch (e) { hungError = e }
await new Promise((resolve) => setTimeout(resolve, 300))
check('Stop before the server has answered at all also cancels cleanly', !!hungError && (await get())[0]?.closedEarly === true, String(hungError))

// ============================== STAGE 3 ADDITIONS ==============================
// (inserted into provider-node-test-3.mjs by make-provider-test-3.mjs)

// ---- 1. the default model's request is BYTE-FOR-BYTE what Stage 2 sent -----------------------------------
// golden-stage2.json was captured from the untouched Stage 2 tree before any Stage 3 code was written.
const golden = JSON.parse(readFileSync(new URL('./golden-stage2.json', import.meta.url), 'utf8'))
const sentBody = async (messages, model = opus) => {
  await reset()
  const res = await run('unused', { messages, model })
  const [request] = await get()
  return { res, request }
}
for (const [name, messages] of [
  ['single', [{ role: 'user', content: 'hello' }]],
  ['multi', [{ role: 'user', content: 'q1' }, { role: 'assistant', content: 'a1' }, { role: 'user', content: 'q2' }]],
  ['merged', [{ role: 'user', content: 'first, never answered' }, { role: 'user', content: 'second' }]]
]) {
  const { res, request } = await sendOne(name, messages)
  // 7.2 (D-025) changed ONE thing in the request: the system prompt now says the window renders Markdown. Everything else must be what
  // Stage 2 sent, key order included; the system prompt keeps its opening and is checked on its own.
  const noSystem = (body) => JSON.stringify({ ...body, system: '(checked below)' })
  check(`golden (${name}): the default model's request body is identical to Stage 2's except the system prompt, key order included`, noSystem(request.body) === noSystem(golden.bodies[name]), res.error ? String(res.error) : '')
  const opening = 'You are Claude, chatting with someone in Frontier App, a desktop chat window. '
  check(`golden (${name}): ...and the system prompt still opens as Stage 2's did, then says the window renders Markdown`, request.body.system.startsWith(opening) && golden.bodies[name].system.startsWith(opening) && /renders Markdown/.test(request.body.system) && !/plain text/.test(request.body.system))
}
async function sendOne(_name, messages) { return sentBody(messages) }

// ---- 2. every model in the registry: accepted by the strict mock, with exactly its own settings -----------
for (const model of parsedRegistry.registry.models.filter((m) => m.provider === 'anthropic')) { // OpenAI's models are checked by provider-openai-test-5.mjs
  const { res, request } = await sentBody([{ role: 'user', content: 'hello ' + model.id }], model)
  const body = request?.body ?? {}
  check(`${model.id}: the (model-aware, strict) mock finds nothing wrong, and the reply streams`, res.end?.kind === 'done' && res.text === 'Echo: hello ' + model.id && request.problems.length === 0, `${res.error ?? ''} ${request?.problems?.join(' | ')}`)
  check(`${model.id}: the request names exactly this model`, body.model === model.id)
  check(`${model.id}: max_tokens is 16000 (the app's ceiling; the model could write ${model.maxOutputTokens})`, body.max_tokens === 16000)
  if (model.effort === null) {
    check(`${model.id}: it rejects effort, so the request carries NO output_config at all`, !('output_config' in body), JSON.stringify(body.output_config))
  } else {
    check(`${model.id}: effort is written out as "${model.effort}" and nothing else is in output_config`, JSON.stringify(body.output_config) === JSON.stringify({ effort: model.effort }), JSON.stringify(body.output_config))
  }
  check(`${model.id}: automatic caching, Markdown system prompt, streaming`, body.cache_control?.type === 'ephemeral' && body.stream === true && /renders Markdown/.test(body.system))
  check(`${model.id}: no thinking, sampling, tool or prefill settings`, !['thinking', 'temperature', 'top_p', 'top_k', 'tools', 'tool_choice'].some((k) => k in body) && body.messages.at(-1).role === 'user')
}

// ---- 3. negative controls: these checks CAN fail ----------------------------------------------------------
// (a) Haiku is documented to reject effort. If the app sent it anyway, the mock must say so, loudly.
await reset()
const haiku = models['claude-haiku-4-5-20251001']
const wrongHaiku = await run('control', { model: { ...haiku, effort: 'medium' } })
const [wrongReq] = await get()
check('control: forcing effort onto Haiku makes the mock answer 400 "does not support the effort parameter"', !!wrongHaiku.error && /does not support the effort parameter/.test(describeError(wrongHaiku.error, fakeKey, haiku.id)) && wrongReq.problems.length === 1, `${describeError(wrongHaiku.error, fakeKey, haiku.id)}`)
// (b) a level the model does not accept
await reset()
const badLevel = await run('control', { model: { ...opus, effort: 'extreme' } })
check('control: an effort level that does not exist is refused by the mock', !!badLevel.error && /not a valid level/.test(describeError(badLevel.error, fakeKey, opus.id)))
// (c) the output ceiling of the mock really is enforced (raw request, since the app never asks for that much)
await reset()
const rawTooMany = await fetch(`${base}/v1/messages`, { method: 'POST', headers: { 'x-api-key': fakeKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, body: JSON.stringify({ model: haiku.id, max_tokens: 70000, stream: true, system: 's', cache_control: { type: 'ephemeral' }, messages: [{ role: 'user', content: 'x' }] }) })
check('control: asking Haiku for more than its 64K output limit is a 400 in the mock', rawTooMany.status === 400 && /maximum allowed number of output tokens/.test(await rawTooMany.text()))
// (d) an old-style hard-coded request with the wrong shape is caught: Opus without effort is NOT refused (effort is optional there)
await reset()
const opusNoEffort = await run('control', { model: { ...opus, effort: null } })
check('control: Opus without effort is accepted (the API default applies), so "effort: null" on a model that takes it is a real, silent change the tests must watch for', opusNoEffort.end?.kind === 'done')
const [noEffortReq] = await get()
check('...and the test of the registry data above would notice it, because the request really lacks output_config', !('output_config' in noEffortReq.body))

// ---- 4. max_tokens follows the model's own limit when it is lower than the app's ceiling -----------------
for (const [limit, expected] of [[8000, 8000], [16000, 16000], [16001, 16000], [64000, 16000], [1, 1]]) {
  const { request } = await sentBody([{ role: 'user', content: 'hi' }], { ...opus, maxOutputTokens: limit })
  check(`max_tokens: a model that can write ${limit} tokens gets ${expected}`, request?.body.max_tokens === expected, String(request?.body.max_tokens))
}

// ---- 5. a model the API does not know: the person is told which one, and what to do -----------------------
await reset()
const ghost = { ...opus, id: 'claude-nope-1' }
const ghostRun = await run('hi', { model: ghost })
const ghostText = ghostRun.error ? describeError(ghostRun.error, fakeKey, ghost.id) : '(no error)'
check('unknown model: the mock answers 404 and the message names that model and points at the header', /^The model claude-nope-1 was not found for this account \(404\)\. You can choose another model in the header\. model: claude-nope-1 \(request req_mock_404\)$/.test(ghostText), ghostText)
await reset()
const opus404 = await run('[[mock:404]] hi')
const wantNotFound = golden.notFound.replace('(404). ', '(404). You can choose another model in the header. ')
check('the 404 text for the default model is Stage 2\'s wording plus the one new sentence', describeError(opus404.error, fakeKey, opus.id) === wantNotFound, describeError(opus404.error, fakeKey, opus.id))
check('describeError for non-404 errors does not mention the model at all', !/claude-opus/.test(describeError(new Error('boom'), fakeKey, opus.id)))

// ---- 6. the model passed in is what is used: a second model in the same process --------------------------
await reset()
await run('one', { model: models['claude-sonnet-5-5'] })
await run('two', { model: models['claude-fable-5-1'] })
await run('three', { model: opus })
const sequence = (await get()).map((r) => r.body.model)
check('three calls in a row use three different models, none remembered from an earlier call', JSON.stringify(sequence) === JSON.stringify(['claude-sonnet-5-5', 'claude-fable-5-1', 'claude-opus-5-5']), JSON.stringify(sequence))
check('the provider module no longer exports a fixed model', !('MODEL' in (await import(`${REPO_URL}/src/main/providers/anthropic.ts`))) && !('MODEL_LABEL' in (await import(`${REPO_URL}/src/main/providers/anthropic.ts`))) && !('PROVIDER_NAME' in (await import(`${REPO_URL}/src/main/providers/anthropic.ts`))))

await mock.close()
const ok = check.summary()
process.exit(ok ? 0 : 1)
