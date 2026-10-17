// Slice 17.1 under plain Node (no window): the investigation of Google's Gemini API made executable, and the probe (D-049). There is no Google SDK in the repo (and none is
// installed: the adapter of 17.3 is written over Node's own fetch), so the probe is a plain fetch against the stand-in endpoint of the mock (tools/mock-gemini.mjs), which
// is MY READING of Google's pages, not the real API. What it shows:
//   A. what a request looks like on the wire (the address, the one header that carries the key, the body) and that the stand-in finds nothing wrong with it;
//   B. what comes back: the server-sent events (CRLF between events), text pieces, the finish reason, usage present, absent, cached and impossible, thoughts sent
//      although not asked for, a function call with its thought signature, a blocked prompt (HTTP 200 and no candidate), a blocked reply, every other finish reason;
//   C. every failure as it arrives: a refused key is a 400 (not a 401) told by its reason, no key is a 403, a model not found, rate and quota are BOTH 429
//      RESOURCE_EXHAUSTED (told apart only by the details), overloaded, a server error, a page of HTML, an error in the middle of the stream, a cut connection, a stream that
//      ends without a finish reason, an event that is not JSON, a hang (only a clock ends it), a provider that repeats the key in its words;
//   D. what the stand-in refuses, the way the documentation says (or flags as what this app must never do): the key in the address, an Authorization header, unknown
//      fields, a sampling setting, the thoughts asked for, a thinking level the model does not take, too long a reply, a GIF, bad base64, too much inline data, a schema
//      keyword Gemini does not take, a function call sent back without its signature, a response that answers nothing, Google's own hosted tools, the Files API,
//      safety settings, the call that does not stream;
//   E. the model listing (pages, a runaway listing, a failure, a hang, the key);
//   F. the baseline: nothing in the app knows Google yet, no Google package is installed, and the golden record of the other two providers is in place.
// Run: node tools/guarded.mjs tools/verify-17-1.mjs      (ONLY=A,C runs some parts)
import { checker } from './cdp.mjs'
import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { REPO } from './paths.mjs'
import { startMock } from './mock-providers.mjs'

const check = checker()
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(',')) : null
const guard = async (name, fn) => { if (ONLY && !ONLY.has(name)) return; try { await fn() } catch (error) { check(`${name} did not run to its end: ${String(error?.stack ?? error).slice(0, 400)}`, false) } }
const show = (v) => JSON.stringify(v)?.slice(0, 400)
const source = (rel) => readFileSync(join(REPO, rel), 'utf8')

const PORT = Number(process.env.GEMINI_TEST_PORT ?? 8899)
await startMock(PORT)
const origin = `http://127.0.0.1:${PORT}`
const KEY = 'AIza' + randomBytes(18).toString('base64url').slice(0, 35)
const reset = () => fetch(`${origin}/__reset`, { method: 'POST' })
const requests = async () => (await (await fetch(`${origin}/__requests`)).json()).filter((r) => r.provider === 'google')
const tools = (body) => fetch(`${origin}/__tools`, { method: 'POST', body: JSON.stringify(body) })
const models = (body) => fetch(`${origin}/__models`, { method: 'POST', body: JSON.stringify(body) })
const expectKey = (key) => fetch(`${origin}/__expect-key`, { method: 'POST', body: JSON.stringify({ key, provider: 'google' }) })

const SYSTEM = 'You are an AI assistant, chatting with someone in Frontier App.'
// The request as the plan says the adapter will make it (17.3 builds it in main): the key in x-goog-api-key and nowhere else, the model in the path, alt=sse.
const body = (text, extra = {}) => ({
  contents: [{ role: 'user', parts: [{ text }] }],
  systemInstruction: { parts: [{ text: SYSTEM }] },
  generationConfig: { maxOutputTokens: 16000, thinkingConfig: { thinkingLevel: 'medium', includeThoughts: false } },
  ...extra
})
const post = (payload, { model = 'gemini-3.8-flash', key = KEY, query = '?alt=sse', headers = {}, method = 'streamGenerateContent', signal } = {}) =>
  fetch(`${origin}/v1beta/models/${model}:${method}${query}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(key === null ? {} : { 'x-goog-api-key': key }), ...headers }, body: typeof payload === 'string' ? payload : JSON.stringify(payload), signal })

/** Reads a server-sent-events body the way the adapter will: events end at a blank line (LF or CRLF), each `data:` line is one JSON object. */
async function events(response) {
  const text = await response.text()
  const out = []
  for (const block of text.split(/\r?\n\r?\n/)) {
    const data = block.split(/\r?\n/).filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n')
    if (data === '') continue
    try { out.push(JSON.parse(data)) } catch { out.push({ notJson: data }) }
  }
  return { text, out }
}
const textOf = (chunks) => chunks.flatMap((c) => c.candidates?.[0]?.content?.parts ?? []).filter((p) => p.thought !== true && typeof p.text === 'string').map((p) => p.text).join('')
const finishOf = (chunks) => chunks.map((c) => c.candidates?.[0]?.finishReason).filter(Boolean).at(-1) ?? null
const usageOf = (chunks) => chunks.map((c) => c.usageMetadata).filter(Boolean).at(-1) ?? null

// ============ A. a request on the wire ============
await guard('A', async () => {
  await reset()
  const r = await post(body('hello there'))
  const got = await events(r)
  const [rec] = await requests()
  check('A: one POST to /v1beta/models/gemini-3.8-flash:streamGenerateContent?alt=sse', rec?.url === '/v1beta/models/gemini-3.8-flash:streamGenerateContent?alt=sse', show(rec?.url))
  check('A: the key travels in x-goog-api-key, and not in the address, in Authorization or in the body', rec.headers['x-goog-api-key'] === KEY && !rec.url.includes(KEY) && !rec.headers.authorization && !rec.raw.includes(KEY))
  check('A: the stand-in finds nothing the real API would refuse', rec.problems.length === 0, show(rec.problems))
  check('A: the body has exactly contents, systemInstruction and generationConfig', Object.keys(rec.body).join() === 'contents,systemInstruction,generationConfig', show(Object.keys(rec.body)))
  check('A: roles are "user" and "model"; the system prompt is a part of its own', rec.body.contents[0].role === 'user' && rec.body.systemInstruction.parts[0].text === SYSTEM)
  check('A: the answer is server-sent events (text/event-stream), 200', r.status === 200 && /event-stream/.test(r.headers.get('content-type')))
  check('A: events are separated by CRLF CRLF (the reader must take both line endings)', got.text.includes('\r\n\r\n') && !/[^\r]\n\n/.test(got.text))
  check('A: the text arrives in pieces and adds up to the reply', got.out.length > 2 && textOf(got.out) === 'Echo: hello there', show(textOf(got.out)))
  check('A: the last event says why it ended: STOP', finishOf(got.out) === 'STOP')
  const u = usageOf(got.out)
  check('A: usage comes with the last event: prompt 25, candidates 12, thoughts 28 (thoughts are NOT inside candidates: 25 + 12 + 28 = 65)', u?.promptTokenCount === 25 && u.candidatesTokenCount === 12 && u.thoughtsTokenCount === 28 && u.totalTokenCount === 65, show(u))
  check('A: earlier events carry only the prompt count (usage is not final until the end)', got.out[0].usageMetadata?.candidatesTokenCount === undefined)
  await reset()
  const argon = await events(await post(body('x', { generationConfig: { maxOutputTokens: 65536, thinkingConfig: { thinkingLevel: 'high', includeThoughts: false } } }), { model: 'gemini-4-argon' }))
  check('A: Gemini 4 Argon at high, 65,536 out: taken', finishOf(argon.out) === 'STOP' && (await requests())[0].problems.length === 0)
})

// ============ B. what comes back ============
await guard('B', async () => {
  const run = async (directive, extra) => { await reset(); return events(await post(body(`question [[mock:${directive}]]`, extra))) }
  let got = await run('no-usage')
  check('B: an answer can come with no usage at all (then nothing tells the cost but the app\'s guess)', usageOf(got.out) === null && finishOf(got.out) === 'STOP' && textOf(got.out) === 'No usage here.')
  got = await run('cached')
  const c = usageOf(got.out)
  check('B: cached tokens are INSIDE the prompt count (cachedContentTokenCount 4000 of promptTokenCount 4100)', c.cachedContentTokenCount === 4000 && c.promptTokenCount === 4100)
  got = await run('hostile-usage')
  check('B: impossible usage numbers can arrive (-5, 10^15, a word): the adapter must not believe them', usageOf(got.out).promptTokenCount === -5 && usageOf(got.out).candidatesTokenCount === 1e15)
  got = await run('thoughts')
  const parts = got.out.flatMap((x) => x.candidates?.[0]?.content?.parts ?? [])
  check('B: a part marked thought: true can arrive although no thoughts were asked for; it is not reply text', parts.some((p) => p.thought === true) && textOf(got.out) === 'The answer.')
  got = await run('blocked-prompt')
  check('B: a blocked prompt is HTTP 200 with promptFeedback.blockReason SAFETY and NO candidate', got.out.length === 1 && got.out[0].promptFeedback?.blockReason === 'SAFETY' && got.out[0].candidates === undefined)
  got = await run('blocked-prompt-other')
  check('B: ... or blockReason OTHER', got.out[0].promptFeedback?.blockReason === 'OTHER')
  got = await run('blocked-reply')
  check('B: a blocked reply has text first, then finishReason SAFETY (the text that came stays partial)', textOf(got.out) === 'Partial answer that ' && finishOf(got.out) === 'SAFETY')
  for (const [d, reason] of [['prohibited', 'PROHIBITED_CONTENT'], ['recitation', 'RECITATION'], ['max-tokens', 'MAX_TOKENS'], ['malformed-call', 'MALFORMED_FUNCTION_CALL'], ['finish-other', 'OTHER'], ['finish-odd', 'SOMETHING_NEW']]) {
    got = await run(d)
    check(`B: finishReason ${reason} arrives as it is`, finishOf(got.out) === reason)
  }
  got = await run('empty')
  check('B: an empty reply: STOP and no text', finishOf(got.out) === 'STOP' && textOf(got.out) === '')
  // a function call
  const decl = { functionDeclarations: [{ name: 'web_search', description: 'Search the web.', parametersJsonSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'], additionalProperties: false } }] }
  await reset()
  got = await events(await post(body('news [[mock:tool-use]]', { tools: [decl], toolConfig: { functionCallingConfig: { mode: 'AUTO' } } })))
  const callParts = got.out.flatMap((x) => x.candidates?.[0]?.content?.parts ?? []).filter((p) => p.functionCall)
  check('B: a function call: a part with functionCall { name, args, id } and a thoughtSignature, finishReason STOP (not a reason of its own)', callParts.length === 1 && callParts[0].functionCall.name === 'web_search' && typeof callParts[0].functionCall.args.query === 'string' && typeof callParts[0].thoughtSignature === 'string' && finishOf(got.out) === 'STOP', show(callParts))
  check('B: the request with parametersJsonSchema (additionalProperties in it) and toolConfig AUTO was taken', (await requests())[0].problems.length === 0, show((await requests())[0].problems))
  const modelTurn = { role: 'model', parts: got.out.flatMap((x) => x.candidates?.[0]?.content?.parts ?? []).filter((p) => p.text !== '' || p.functionCall) }
  await reset()
  const answered = await events(await post(body('news [[mock:tool-use]]', { tools: [decl], contents: [{ role: 'user', parts: [{ text: 'news [[mock:tool-use]]' }] }, modelTurn, { role: 'user', parts: [{ functionResponse: { name: 'web_search', id: callParts[0].functionCall.id, response: { output: 'Summary:\nIt came out last week.' } } }] }] })))
  check('B: the turn sent back as it came (with its signature) and the response by name and id: the model answers from it', textOf(answered.out) === 'The search found: It came out last week.' && (await requests())[0].problems.length === 0, show([textOf(answered.out), (await requests())[0].problems]))
  await reset()
  got = await events(await post(body('two [[mock:tool-two]]', { tools: [decl] })))
  check('B: two calls in one turn: two functionCall parts, the signature on the first only', got.out.flatMap((x) => x.candidates?.[0]?.content?.parts ?? []).filter((p) => p.functionCall).map((p) => typeof p.thoughtSignature).join() === 'string,undefined')
})

// ============ C. failures ============
await guard('C', async () => {
  const fail = async (directive, opts, key = null) => { await reset(); if (key !== null) await expectKey(key); const r = await post(body(`q [[mock:${directive}]]`), opts); const text = await r.text(); let parsed = null; try { parsed = JSON.parse(text) } catch { /* not JSON */ } return { status: r.status, text, error: parsed?.error } }
  let f = await fail('echo', {}, 'AIza-the-right-key-0000000000000000000')
  check('C: a key the provider does not accept is a 400 INVALID_ARGUMENT with reason API_KEY_INVALID (NOT a 401)', f.status === 400 && f.error.status === 'INVALID_ARGUMENT' && f.error.details?.[0]?.reason === 'API_KEY_INVALID', show(f.error))
  f = await fail('echo', { key: null })
  check('C: no key at all is a 403 PERMISSION_DENIED ("unregistered callers")', f.status === 403 && /unregistered callers/.test(f.error.message))
  f = await fail('400-key')
  check('C: (the same refusal on demand)', f.status === 400 && f.error.details[0].reason === 'API_KEY_INVALID')
  f = await fail('echo-key')
  check('C: a provider that repeats the whole key in its words: the key is in the error text (so every sentence must be scrubbed)', f.text.includes(KEY))
  f = await fail('403')
  check('C: 403 PERMISSION_DENIED (the API not enabled for the project)', f.status === 403 && f.error.status === 'PERMISSION_DENIED')
  f = await fail('echo', { model: 'gemini-9-nothing' })
  check('C: a model it does not have: 404 NOT_FOUND', f.status === 404 && f.error.status === 'NOT_FOUND')
  const rate = await fail('429')
  const quota = await fail('429-quota')
  check('C: too many requests and no quota left are BOTH 429 RESOURCE_EXHAUSTED: only the words and the details tell them apart', rate.status === 429 && quota.status === 429 && rate.error.status === quota.error.status && quota.error.details[0]['@type'].endsWith('QuotaFailure') && /quota/i.test(quota.error.message) && rate.error.details[0]['@type'].endsWith('RetryInfo'))
  for (const [d, s, st] of [['500', 500, 'INTERNAL'], ['503', 503, 'UNAVAILABLE'], ['504', 504, 'DEADLINE_EXCEEDED']]) {
    f = await fail(d)
    check(`C: ${s} ${st}`, f.status === s && f.error.status === st)
  }
  f = await fail('html-error')
  check('C: a page of HTML (a proxy\'s 502): no JSON error at all', f.status === 502 && f.error === undefined && /<html>/.test(f.text))
  // in the middle of a stream
  const stream = async (directive) => { await reset(); const r = await post(body(`q [[mock:${directive}]]`)); try { return { ...(await events(r)), status: r.status } } catch (error) { return { thrown: error, status: r.status } } }
  let s = await stream('midstream-error')
  check('C: an error in the middle of the stream: HTTP 200, some text, then an event with { error } and no finish reason', s.status === 200 && textOf(s.out) === 'Partial ' && s.out.at(-1).error?.status === 'INTERNAL' && finishOf(s.out) === null)
  s = await stream('early-close')
  check('C: a stream that ends cleanly without any finish reason (the adapter must call it interrupted)', s.status === 200 && textOf(s.out) === 'Partial ' && finishOf(s.out) === null)
  s = await stream('not-json')
  check('C: an event that is not JSON', s.out.some((x) => x.notJson !== undefined))
  s = await stream('drop')
  check('C: a cut connection: reading the body throws ("terminated")', s.thrown !== undefined && /terminated|other side closed|aborted/i.test(String(s.thrown?.message) + String(s.thrown?.cause?.message)), show(String(s.thrown)))
  await reset()
  const clock = AbortSignal.timeout(500)
  const started = Date.now()
  let hang = null
  try { await post(body('q [[mock:hang-before]]'), { signal: clock }) } catch (error) { hang = error }
  check('C: a provider that never answers: nothing ends the wait but the caller\'s own clock (fetch has no clock of its own)', hang?.name === 'TimeoutError' && Date.now() - started < 3000, show(hang?.name))
  await reset()
  const stop = new AbortController()
  const slow = await post(body('q [[mock:slow]]'), { signal: stop.signal })
  const reader = slow.body.getReader()
  await reader.read()
  stop.abort()
  let stopped = null
  try { for (;;) { const { done } = await reader.read(); if (done) break } } catch (error) { stopped = error }
  await new Promise((r) => setTimeout(r, 300))
  check('C: Stop (aborting the signal) in the middle of a stream ends the read and closes the connection', stopped?.name === 'AbortError' && (await requests())[0].closedEarly === true, show(stopped?.name))
})

// ============ D. what the stand-in refuses ============
await guard('D', async () => {
  const refused = async (label, payload, opts, re, keep = false) => {
    // (keep: the stand-in remembers the calls it gave out; a reset would forget them, and with them the signature it wants back)
    if (keep) await fetch(`${origin}/__requests`).then(() => undefined)
    else await reset()
    const r = await post(payload, opts)
    const t = await r.text()
    const rec = (await requests()).at(-1)
    check(`D: refused: ${label}`, r.status === 400 && rec.problems.some((p) => re.test(p)), show([r.status, rec?.problems]))
  }
  await refused('the key in the address (?key=), even with the header too', body('x'), { query: `?alt=sse&key=${KEY}` }, /KEY WAS PUT IN THE ADDRESS/)
  await refused('no alt=sse', body('x'), { query: '' }, /alt=sse/)
  await refused('an Authorization header', body('x'), { headers: { authorization: `Bearer ${KEY}` } }, /Authorization/)
  await refused('an unknown top-level field', { ...body('x'), store: false }, {}, /Unknown name "store"/)
  await refused('a sampling setting (temperature)', body('x', { generationConfig: { maxOutputTokens: 100, temperature: 0.2 } }), {}, /temperature/)
  await refused('the thoughts asked for (includeThoughts: true)', body('x', { generationConfig: { maxOutputTokens: 100, thinkingConfig: { thinkingLevel: 'low', includeThoughts: true } } }), {}, /includeThoughts/)
  await refused('thinking level "minimal" on 3.8 Flash', body('x', { generationConfig: { maxOutputTokens: 100, thinkingConfig: { thinkingLevel: 'minimal' } } }), {}, /minimal is not supported/)
  await refused('a thinking budget beside a level', body('x', { generationConfig: { maxOutputTokens: 100, thinkingConfig: { thinkingLevel: 'low', thinkingBudget: 100 } } }), {}, /cannot be set together/)
  await refused('more than 65,536 tokens out', body('x', { generationConfig: { maxOutputTokens: 65537 } }), {}, /maximum number of output tokens/)
  await refused('no generationConfig', { contents: body('x').contents, systemInstruction: body('x').systemInstruction }, {}, /no generationConfig/)
  await refused('no systemInstruction', { contents: body('x').contents, generationConfig: body('x').generationConfig }, {}, /no systemInstruction/)
  await refused('a role other than user and model ("assistant")', body('x', { contents: [{ role: 'user', parts: [{ text: 'a' }] }, { role: 'assistant', parts: [{ text: 'b' }] }, { role: 'user', parts: [{ text: 'c' }] }] }), {}, /valid role/)
  await refused('an empty text part', body('x', { contents: [{ role: 'user', parts: [{ text: '' }] }] }), {}, /non-empty string/)
  await refused('a GIF sent inline', body('x', { contents: [{ role: 'user', parts: [{ inlineData: { mimeType: 'image/gif', data: 'R0lGODlhAQABAAAAACw=' } }, { text: 'x' }] }] }), {}, /Unsupported MIME type: image\/gif/)
  await refused('inline data that is not base64', body('x', { contents: [{ role: 'user', parts: [{ inlineData: { mimeType: 'image/png', data: 'not base64!' } }, { text: 'x' }] }] }), {}, /Base64 decoding failed/)
  await refused('more than 20 MB inline', body('x', { contents: [{ role: 'user', parts: [{ inlineData: { mimeType: 'application/pdf', data: Buffer.alloc(20 * 1024 * 1024).toString('base64') } }, { text: 'x' }] }] }), {}, /payload size exceeds/)
  await refused('the Files API (fileData)', body('x', { contents: [{ role: 'user', parts: [{ fileData: { mimeType: 'application/pdf', fileUri: 'https://generativelanguage.googleapis.com/v1beta/files/abc' } }, { text: 'x' }] }] }), {}, /fileData/)
  await refused('a schema keyword `parameters` does not take (additionalProperties)', body('x', { tools: [{ functionDeclarations: [{ name: 'f', description: 'd', parameters: { type: 'object', properties: {}, additionalProperties: false } }] }] }), {}, /Unknown name "additionalProperties"/)
  await refused('Google Search grounding offered', body('x', { tools: [{ googleSearch: {} }] }), {}, /Google-hosted tool/)
  await refused('safety settings', body('x', { safetySettings: [{ category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' }] }), {}, /safetySettings/)
  await refused('toolConfig without tools', body('x', { toolConfig: { functionCallingConfig: { mode: 'AUTO' } } }), {}, /without tools/)
  await refused('a thought part sent back', body('x', { contents: [{ role: 'user', parts: [{ text: 'a' }] }, { role: 'model', parts: [{ text: 'secret', thought: true }] }, { role: 'user', parts: [{ text: 'c' }] }] }), {}, /thought part was sent back/)
  // the signature: a call the stand-in made, sent back without its signature
  const decl = { functionDeclarations: [{ name: 'web_search', description: 'Search.', parametersJsonSchema: { type: 'object', properties: { query: { type: 'string' } } } }] }
  await reset()
  const got = await events(await post(body('news [[mock:tool-use]]', { tools: [decl] })))
  const call = got.out.flatMap((x) => x.candidates?.[0]?.content?.parts ?? []).find((p) => p.functionCall)
  const answer = { role: 'user', parts: [{ functionResponse: { name: 'web_search', id: call.functionCall.id, response: { output: 'x' } } }] }
  await refused('a function call sent back WITHOUT its thought signature', body('x', { tools: [decl], contents: [{ role: 'user', parts: [{ text: 'news' }] }, { role: 'model', parts: [{ functionCall: call.functionCall }] }, answer] }), {}, /missing a thought_signature/, true)
  await refused('a call with no response after it', body('x', { tools: [decl], contents: [{ role: 'user', parts: [{ text: 'news' }] }, { role: 'model', parts: [call] }, { role: 'user', parts: [{ text: 'and?' }] }] }), {}, /number of function response parts/)
  await refused('a response that answers no call', body('x', { tools: [decl], contents: [{ role: 'user', parts: [{ text: 'news' }] }, { role: 'model', parts: [{ text: 'ok' }] }, answer] }), {}, /must follow the model turn/)
  await refused('a response by another name', body('x', { tools: [decl], contents: [{ role: 'user', parts: [{ text: 'news' }] }, { role: 'model', parts: [call] }, { role: 'user', parts: [{ functionResponse: { name: 'other', id: call.functionCall.id, response: { output: 'x' } } }] }] }), {}, /is named other/)
  await reset()
  const r = await post(body('x'), { method: 'generateContent', query: '' })
  check('D: the call that does not stream (generateContent) is flagged: this app streams', r.status === 400 && (await requests())[0].problems.some((p) => /not streamed/.test(p)))
})

// ============ E. the model listing ============
await guard('E', async () => {
  const list = async (query = '?pageSize=1000', key = KEY) => { const r = await fetch(`${origin}/v1beta/models${query}`, { headers: key === null ? {} : { 'x-goog-api-key': key } }); return { status: r.status, body: await r.json().catch(() => null) } }
  await reset()
  let l = await list()
  check('E: GET /v1beta/models lists { models: [{ name: "models/<id>", displayName, ... }] }', l.status === 200 && l.body.models.some((m) => m.name === 'models/gemini-4-argon' && m.displayName === 'Gemini 4 Argon') && l.body.nextPageToken === undefined)
  const [rec] = await requests()
  check('E: the key in x-goog-api-key only, nothing flagged', rec.headers['x-goog-api-key'] === KEY && rec.problems.length === 0 && !rec.url.includes(KEY))
  await models({ pageSize: 3 })
  l = await list()
  const second = await list(`?pageSize=1000&pageToken=${l.body.nextPageToken}`)
  check('E: pages: nextPageToken, then the next page with pageToken', l.body.models.length === 3 && typeof l.body.nextPageToken === 'string' && second.body.models[0].name === 'models/gemini-3.5-flash-lite')
  await models({ many: 5000 })
  l = await list()
  check('E: a runaway listing (5,000 made-up models, a page of 1,000 and a next token): the adapter must stop on its own', l.body.models.length === 1000 && l.body.nextPageToken === '1000')
  await models({ fail: 500 })
  l = await list()
  check('E: a listing that fails (500 INTERNAL)', l.status === 500 && l.body.error.status === 'INTERNAL')
  await models({})
  await expectKey('AIza-the-right-key-0000000000000000000')
  l = await list()
  check('E: a refused key on the listing: 400 API_KEY_INVALID', l.status === 400 && l.body.error.details[0].reason === 'API_KEY_INVALID')
  await reset()
  await list(`?pageSize=1000&key=${KEY}`)
  check('E: the key in the listing\'s address is flagged', (await requests())[0].problems.some((p) => /ADDRESS/.test(p)))
  await models({ hang: true })
  let hang = null
  try { await fetch(`${origin}/v1beta/models`, { headers: { 'x-goog-api-key': KEY }, signal: AbortSignal.timeout(400) }) } catch (error) { hang = error }
  check('E: a listing that never answers ends only by the caller\'s clock', hang?.name === 'TimeoutError')
  await models({})
})

// ============ F. the baseline ============
await guard('F', async () => {
  const registry = source('src/shared/registry.ts')
  check('F: the app knows two providers, anthropic and openai (no google yet)', /SUPPORTED_PROVIDERS = \['anthropic', 'openai'\] as const/.test(registry))
  const pkg = JSON.parse(source('package.json'))
  const deps = { ...pkg.dependencies, ...pkg.devDependencies }
  check('F: no Google package in package.json, and none installed (@google/genai, @google/generative-ai)', !Object.keys(deps).some((d) => /google/i.test(d)) && !existsSync(join(REPO, 'node_modules', '@google', 'genai')) && !existsSync(join(REPO, 'node_modules', '@google', 'generative-ai')))
  const models = JSON.parse(source('registry/models.json'))
  check('F: the registry has no Gemini model, and is schema 0.5', models.schemaVersion === '0.5' && !models.models.some((m) => /gemini/.test(m.id)))
  const golden = JSON.parse(readFileSync(join(REPO, 'tools', 'golden-17.json'), 'utf8'))
  const keys = Object.keys(golden.requests)
  check('F: the golden record of the other two providers is there (208 requests: 6 models, files, tools, search, listings)', keys.length === 208 && keys.includes('gpt-6-luna|tool-loop') && keys.includes('claude-opus-5-5|files|all') && keys.includes('anthropic|listing'), String(keys.length))
  check('F: Node\'s own fetch and web streams are there (what the adapter will use)', typeof fetch === 'function' && typeof ReadableStream === 'function' && typeof TextDecoderStream === 'function')
})

process.exit(check.summary() ? 0 : 1)
