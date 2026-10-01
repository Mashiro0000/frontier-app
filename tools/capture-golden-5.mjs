// Stage 5.1 golden capture (lives outside the project on purpose).
// Records, for the Anthropic path, EVERYTHING observable that the refactor must not change:
//   - for every registry model x several conversation shapes: the full request the mock receives (method, path,
//     headers except the ones that vary per run, and the exact body text);
//   - for every mock directive: the text pieces, the way the reply ended, and the sentence the person would read;
//   - the sentence for a grid of hand-built errors (every status the SDK has a class for, non-Errors, cause chains);
//   - the key is scrubbed, the request id is appended, and so on.
// usage: IMPL=old node capture-golden-5.mjs   -> golden-5-old.json   (the untouched tree: src/main/provider.ts)
//        IMPL=new node capture-golden-5.mjs   -> golden-5-new.json   (after the refactor, through shim-new.mjs)
// Then: the two files must be IDENTICAL (cmp).
import { REPO_URL } from './paths.mjs'
import './ts-resolve.mjs'
import { readFileSync, writeFileSync } from 'node:fs'
import { startMock } from './mock-providers.mjs'

const impl = process.env.IMPL ?? 'old'
const PORT = Number(process.env.GOLDEN_PORT ?? 8895)
const { streamReply, describeError, mergeAdjacent, API_BASE_URL } =
  impl === 'old'
    ? await import(`${REPO_URL}/src/main/provider.ts`)
    : await import(new URL('./shim-new.mjs', import.meta.url).href)
const { parseRegistry } = await import(`${REPO_URL}/src/shared/registry.ts`)
// The ESM entry (index.mjs) is what Node resolves for provider.ts's own import, so the error classes built here
// are the same classes it checks with `instanceof` (the CommonJS build would be a different set of classes).
const Anthropic = (await import(`${REPO_URL}/node_modules/@anthropic-ai/sdk/index.mjs`)).default

// The SAVED GOOD COPY, not the live file: the registry scenarios temporarily swap broken variants into the project's
// registry/models.json, and a capture taken at that moment would silently record the wrong thing.
const registry = parseRegistry(JSON.parse(readFileSync(new URL('./registry-good.json', import.meta.url), 'utf8')))
if (!registry.ok) throw new Error('registry unusable: ' + registry.error)
const models = registry.registry.models

const mock = await startMock(PORT)
const base = `http://127.0.0.1:${PORT}`
const KEY = 'test-golden-key-0123456789abcdef0123456789'
const reset = () => fetch(`${base}/__reset`, { method: 'POST' })
const requests = async () => (await fetch(`${base}/__requests`)).json()

// Headers that legitimately differ between two runs of the same code (none should, but be explicit about it).
const VARYING = new Set(['host'])
const stable = (headers) => Object.fromEntries(Object.entries(headers).filter(([k]) => !VARYING.has(k)).sort(([a], [b]) => (a < b ? -1 : 1)))

const out = { impl, apiBaseUrl: API_BASE_URL, requests: {}, outcomes: {}, errorGrid: {}, merge: {} }

async function run(model, messages, extra = {}) {
  const pieces = []
  let end = null
  let error = null
  try {
    end = await streamReply({ apiKey: KEY, baseURL: base, model, messages, signal: new AbortController().signal, onText: (t) => pieces.push(t), ...extra })
  } catch (e) {
    error = e
  }
  return { pieces, end, error }
}

// ---- 1. full requests: every model x every shape --------------------------------------------------------
const shapes = {
  single: [{ role: 'user', content: 'hello' }],
  multi: [{ role: 'user', content: 'q1' }, { role: 'assistant', content: 'a1' }, { role: 'user', content: 'q2' }],
  merged: [{ role: 'user', content: 'first, never answered' }, { role: 'user', content: 'second' }],
  mergedMany: [{ role: 'user', content: 'a' }, { role: 'user', content: 'b' }, { role: 'assistant', content: 'c' }, { role: 'assistant', content: 'd' }, { role: 'user', content: 'e' }],
  unicode: [{ role: 'user', content: 'héllo \u{1F600} "quotes" \\ back\nslash\ttab' }],
  long: [{ role: 'user', content: 'x'.repeat(5000) }]
}
for (const model of models) {
  for (const [name, messages] of Object.entries(shapes)) {
    await reset()
    const r = await run(model, messages)
    const [req] = await requests()
    out.requests[`${model.id} / ${name}`] = {
      method: 'POST',
      problems: req?.problems ?? null,
      headers: req ? stable(req.headers) : null,
      bodyText: req ? JSON.stringify(req.body) : null,
      pieces: r.pieces,
      end: r.end,
      error: r.error ? String(r.error) : null
    }
  }
}

// ---- 2. every directive, for the default model: pieces, ending, and the sentence ------------------------
const opus = models.find((m) => m.id === registry.registry.defaultModel.id)
for (const directive of ['echo', '401', '403', '404', '400-credit', '429', '500', '529', 'flaky', 'midstream-error', 'drop', 'max-tokens', 'refusal', 'context-full', 'empty', 'no-thinking']) {
  await reset()
  const text = directive === 'echo' ? 'plain hello' : `[[mock:${directive}]] hi`
  const r = await run(opus, [{ role: 'user', content: text }])
  out.outcomes[directive] = {
    pieces: r.pieces,
    end: r.end,
    sentence: r.error ? describeError(r.error, KEY, opus.id) : null,
    attempts: (await requests()).length
  }
}
// nothing listening, and a wrong key against a server that checks keys
{
  const r = await run(opus, [{ role: 'user', content: 'x' }], { baseURL: 'http://127.0.0.1:1' })
  out.outcomes['nothing-listening'] = { pieces: r.pieces, end: r.end, sentence: r.error ? describeError(r.error, KEY, opus.id) : null }
  await reset()
  await fetch(`${base}/__expect-key`, { method: 'POST', body: JSON.stringify({ key: 'some-other-key-that-is-long-enough' }) })
  const w = await run(opus, [{ role: 'user', content: 'plain hi' }])
  out.outcomes['wrong-key'] = { pieces: w.pieces, end: w.end, sentence: w.error ? describeError(w.error, KEY, opus.id) : null }
  await reset()
}
// an unknown model: a 404 that names it
{
  await reset()
  const r = await run({ ...opus, id: 'claude-nope-1' }, [{ role: 'user', content: 'hi' }])
  out.outcomes['unknown-model'] = { sentence: r.error ? describeError(r.error, KEY, 'claude-nope-1') : null }
}
// Stop (abort) before and during a reply: what the call does, not timings
{
  await reset()
  const controller = new AbortController()
  const pieces = []
  const slow = streamReply({ apiKey: KEY, baseURL: base, model: opus, messages: [{ role: 'user', content: '[[mock:slow]] go' }], signal: controller.signal, onText: (t) => pieces.push(t) })
  await new Promise((r) => setTimeout(r, 900))
  controller.abort()
  let err = null
  try { await slow } catch (e) { err = e }
  await new Promise((r) => setTimeout(r, 400))
  const [req] = await requests()
  out.outcomes['abort-during'] = { rejected: !!err, someText: pieces.length > 2, closedEarly: req?.closedEarly ?? null }
  await reset()
  const c2 = new AbortController()
  const hung = streamReply({ apiKey: KEY, baseURL: base, model: opus, messages: [{ role: 'user', content: '[[mock:hang-before]] go' }], signal: c2.signal, onText: () => {} })
  await new Promise((r) => setTimeout(r, 400))
  c2.abort()
  let err2 = null
  try { await hung } catch (e) { err2 = e }
  await new Promise((r) => setTimeout(r, 300))
  out.outcomes['abort-before'] = { rejected: !!err2, closedEarly: (await requests())[0]?.closedEarly ?? null }
}

// ---- 3. a grid of hand-built errors: every branch of the sentence builder --------------------------------
const mk = (status, message, headers = {}) => Anthropic.APIError.generate(status, { type: 'error', error: { type: 't', message } }, message, new Headers(headers))
const grid = {
  'status 400': mk(400, 'bad thing'),
  'status 401': mk(401, 'no'),
  'status 402': mk(402, 'pay up'),
  'status 403': mk(403, 'forbidden thing'),
  'status 404': mk(404, 'model: x'),
  'status 409': mk(409, 'conflict'),
  'status 413': mk(413, 'too big'),
  'status 422': mk(422, 'unprocessable'),
  'status 429': mk(429, 'slow down'),
  'status 500': mk(500, 'oops'),
  'status 502': mk(502, 'bad gateway'),
  'status 503': mk(503, 'unavailable'),
  'status 529': mk(529, 'Overloaded'),
  '400 no body': Anthropic.APIError.generate(400, undefined, undefined, new Headers()),
  '500 with request id': mk(500, 'oops', { 'request-id': 'req_abc123' }),
  '401 with request id': mk(401, 'no', { 'request-id': 'req_xyz789' }),
  'mid-stream, no status': new Anthropic.APIError(undefined, { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }, 'Overloaded', undefined),
  'mid-stream, odd body': new Anthropic.APIError(undefined, 'not an object', 'fallback message', undefined),
  'connection error': new Anthropic.APIConnectionError({ message: 'down' }),
  'timeout': new Anthropic.APIConnectionTimeoutError(),
  'terminated': new Error('terminated'),
  'other side closed': new Error('read: other side closed the connection'),
  'ECONNRESET cause': Object.assign(new Error('fetch failed'), { cause: Object.assign(new Error('inner'), { code: 'ECONNRESET' }) }),
  'UND_ERR_SOCKET deep cause': Object.assign(new Error('a'), { cause: Object.assign(new Error('b'), { cause: Object.assign(new Error('c'), { code: 'UND_ERR_SOCKET' }) }) }),
  'cause too deep (5)': Object.assign(new Error('a'), { cause: Object.assign(new Error('b'), { cause: Object.assign(new Error('c'), { cause: Object.assign(new Error('d'), { cause: Object.assign(new Error('e'), { code: 'ECONNRESET' }) }) }) }) }),
  'plain Error': new Error('boom'),
  'plain Error with the key inside': new Error(`failed with ${KEY} inside`),
  'APIError whose message has the key': mk(400, `bad key ${KEY} here`),
  'non-Error string': 'plain string',
  'non-Error object': { message: 'x' },
  'null': null,
  'undefined': undefined,
  'number': 42
}
for (const [name, error] of Object.entries(grid)) {
  out.errorGrid[name] = {
    withModel: describeError(error, KEY, 'claude-opus-5-5'),
    otherModel: describeError(error, KEY, 'claude-haiku-4-5-20251001'),
    shortKey: describeError(error, 'short', 'claude-opus-5-5'),
    emptyKey: describeError(error, '', 'claude-opus-5-5')
  }
}

// ---- 4. mergeAdjacent on its own ---------------------------------------------------------------------
const mergeInputs = {
  alternating: [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }, { role: 'user', content: 'c' }],
  twoUsers: [{ role: 'user', content: 'a' }, { role: 'user', content: 'b' }],
  threeUsers: [{ role: 'user', content: 'a' }, { role: 'user', content: 'b' }, { role: 'user', content: 'c' }],
  empty: [],
  one: [{ role: 'user', content: 'a' }],
  assistantsFirst: [{ role: 'assistant', content: 'a' }, { role: 'assistant', content: 'b' }]
}
for (const [name, input] of Object.entries(mergeInputs)) {
  const copy = JSON.parse(JSON.stringify(input))
  const merged = mergeAdjacent(input)
  out.merge[name] = { merged, inputUnchanged: JSON.stringify(input) === JSON.stringify(copy) }
}

await mock.close()
const file = new URL(`./golden-5-${impl}.json`, import.meta.url)
writeFileSync(file, JSON.stringify(out, null, 2))
console.log(`captured (${impl}): ${Object.keys(out.requests).length} requests, ${Object.keys(out.outcomes).length} outcomes, ${Object.keys(out.errorGrid).length} errors x 4 variants, ${Object.keys(out.merge).length} merges -> ${file.pathname}`)
