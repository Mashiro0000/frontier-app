// Slice 16.1 under plain Node (no window): the investigation made executable (D-048). The SDK installed in the repo (openai 7.25), called directly (no app code yet), against the fake
// image endpoint of the mock (tools/mock-images.mjs, which refuses what OpenAI's guide and the SDK's own comments say the API refuses). What it shows:
//   A. the SDK knows the images API and the model names the plan uses; what it sends: where, as what, exactly the fields given, the key only in Authorization; and that its own
//      retries WOULD send a picture request twice (so the adapter must switch them off);
//   B. the answers: base64 pictures, the count asked for, `usage` present and absent (the SDK passes both through unchecked), an answer with an address in place of base64;
//   C. the refusals as the SDK hands them over: a block (moderation_blocked), an organisation that is not verified, a refused key, a server error, a hang (the clock), Stop, an
//      answer that is not JSON;
//   D. the mock itself refuses what the documentation says is refused (so a wrong request from the app cannot pass unnoticed);
//   E. the baseline: nothing in the app makes pictures yet; the page's policy; a ledger record can name an image model.
// Run: node tools/guarded.mjs tools/verify-16-1.mjs      (ONLY=A,C runs some parts)
import './ts-resolve.mjs'
import { checker } from './cdp.mjs'
import { randomBytes } from 'node:crypto'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { REPO, REPO_URL } from './paths.mjs'
import { startMock } from './mock-providers.mjs'

const check = checker()
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(',')) : null
const guard = async (name, fn) => { if (ONLY && !ONLY.has(name)) return; try { await fn() } catch (error) { check(`${name} did not run to its end: ${String(error?.stack ?? error).slice(0, 400)}`, false) } }
const show = (v) => JSON.stringify(v)?.slice(0, 400)
const source = (rel) => readFileSync(join(REPO, rel), 'utf8')
const require = createRequire(REPO + '/package.json')
const sdk = await import(pathToFileURL(require.resolve('openai')).href)
const OpenAI = sdk.default?.default ?? sdk.default
const usage = await import(`${REPO_URL}/src/shared/usage.ts`)

const PORT = Number(process.env.IMAGES_TEST_PORT ?? 8896)
const mock = await startMock(PORT)
const origin = `http://127.0.0.1:${PORT}`
const KEY = 'sk-proj-' + randomBytes(24).toString('hex')
const client = (extra = {}) => new OpenAI({ apiKey: KEY, baseURL: `${origin}/v1`, organization: null, project: null, maxRetries: 0, ...extra })
const requests = async () => (await (await fetch(`${origin}/__requests`)).json()).filter((r) => r.images)
const reset = () => fetch(`${origin}/__reset`, { method: 'POST' })
const control = (body) => fetch(`${origin}/__images`, { method: 'POST', body: JSON.stringify(body) })
const failure = async (promise) => { try { await promise; return null } catch (error) { return error } }
const pngSize = (bytes) => bytes.length >= 24 && bytes.subarray(1, 4).toString('latin1') === 'PNG' ? [bytes.readUInt32BE(16), bytes.readUInt32BE(20)] : null
const ASK = { model: 'gpt-image-2', prompt: 'A red bicycle leaning on a blue wall', n: 1, size: '1024x1024', quality: 'medium', output_format: 'png' }

// ============ A. what the SDK knows and sends ============
await guard('A', async () => {
  await reset()
  const types = readFileSync(require.resolve('openai/resources/images').replace(/\.js$/, '.d.ts'), 'utf8')
  for (const name of ['gpt-image-2', 'gpt-image-2.5-flare', 'gpt-image-2.5-sunburst']) check(`A: the installed SDK names the model ${name}`, types.includes(`'${name}'`))
  check('A: and has images.generate', typeof client().images.generate === 'function')
  check('A: its own comment says `usage` is for gpt-image-1 only (so it may be missing for the newer models)', /For `gpt-image-1` only, the token usage information/.test(types))
  check('A: its comment gives the size rules (divisible by 16, 1:3 to 3:1, at most 3840x2160)', /divisible by 16/.test(types) && /between 1:3 and 3:1/.test(types) && /3840x2160/.test(types))
  const got = await client().images.generate(ASK)
  const all = await requests()
  const r = all[0]
  check('A: one request, a POST to /v1/images/generations', all.length === 1 && r.url === '/v1/images/generations', show(r?.url))
  check('A: as JSON', /^application\/json/.test(r.headers['content-type']), r.headers['content-type'])
  check('A: with exactly the fields given, nothing added by the SDK', r.fields.join() === 'model,n,output_format,prompt,quality,size', show(r.fields))
  check('A: the words exactly as given', r.body.prompt === ASK.prompt)
  check('A: the key is in Authorization: Bearer, and nowhere else', r.headers.authorization === `Bearer ${KEY}` && !r.headers['x-api-key'] && !JSON.stringify(r.body).includes(KEY))
  check('A: the mock found nothing the real API would refuse', r.problems.length === 0, show(r.problems))
  check('A: an answer came back', Array.isArray(got.data) && got.data.length === 1, show(Object.keys(got)))
  // The SDK's default is to try again: a picture asked for twice would be billed twice.
  await reset()
  await control({ mode: '503retry' })
  const e1 = await failure(new OpenAI({ apiKey: KEY, baseURL: `${origin}/v1`, organization: null, project: null }).images.generate(ASK, { timeout: 20000 }))
  const tries = await requests()
  check('A: with the SDK\'s own default the same picture request is SENT THREE TIMES on a 503 (so the adapter must say maxRetries: 0)', e1 !== null && tries.length === 3 && tries.map((t) => t.retryCount).join() === '0,1,2', show(tries.map((t) => t.retryCount)))
  await reset()
  await control({ mode: '503retry' })
  await failure(client().images.generate(ASK))
  check('A: with maxRetries: 0 it is sent once', (await requests()).length === 1)
})

// ============ B. the answers ============
await guard('B', async () => {
  await reset()
  let got = await client().images.generate(ASK)
  const bytes = Buffer.from(got.data[0].b64_json, 'base64')
  check('B: the picture comes as base64 and nothing else (no address)', typeof got.data[0].b64_json === 'string' && got.data[0].url === undefined)
  check('B: it decodes to a PNG of the size asked for', show(pngSize(bytes)) === '[1024,1024]', show(pngSize(bytes)))
  check('B: the answer says the size, quality and format', got.size === '1024x1024' && got.quality === 'medium' && got.output_format === 'png', show([got.size, got.quality, got.output_format]))
  check('B: usage comes as tokens (input, output) when the provider sends it', got.usage?.output_tokens === 1767 && got.usage.input_tokens === Math.ceil(ASK.prompt.length / 4), show(got.usage))
  check('B: 1767 output tokens at $30 a million is the table\'s $0.053', Math.abs(got.usage.output_tokens * 30 / 1e6 - 0.053) < 0.0001)
  got = await client().images.generate({ ...ASK, n: 4, size: '1536x1024', quality: 'high' })
  check('B: four pictures when four are asked for, each the size asked for', got.data.length === 4 && got.data.every((d) => show(pngSize(Buffer.from(d.b64_json, 'base64'))) === '[1536,1024]'))
  await control({ usage: 'none' })
  got = await client().images.generate(ASK)
  check('B: with no usage the SDK hands over no usage (nothing to read the real cost from)', got.usage === undefined && got.data.length === 1)
  await control({ usage: 'hostile' })
  got = await client().images.generate(ASK)
  check('B: the SDK passes impossible numbers through unchecked (so the adapter must check them)', got.usage.input_tokens === -5 && got.usage.output_tokens === 1e15)
  await control({ mode: 'fewer' })
  got = await client().images.generate({ ...ASK, n: 3 })
  check('B: nor does it check the count (two pictures for three asked)', got.data.length === 2)
  await control({ mode: 'url' })
  got = await client().images.generate(ASK)
  check('B: nor that a picture is base64 (an answer with an address passes)', typeof got.data[0].url === 'string' && got.data[0].b64_json === undefined)
  await control({ mode: 'text' })
  got = await client().images.generate(ASK)
  check('B: nor what the bytes are (a text passes as a "picture")', Buffer.from(got.data[0].b64_json, 'base64').toString().startsWith('this is a text'))
  await control({ mode: 'nodata' })
  got = await client().images.generate(ASK)
  check('B: an answer with no data at all is handed over as it is', got.data === undefined)
})

// ============ C. the refusals ============
await guard('C', async () => {
  await reset()
  await control({ mode: 'blocked' })
  let e = await failure(client().images.generate(ASK))
  check('C: a block is an APIError 400 with the code moderation_blocked', e instanceof OpenAI.APIError && e.status === 400 && e.code === 'moderation_blocked', show([e?.constructor?.name, e?.status, e?.code]))
  check('C: its words carry the coarse categories (safety_violations=[...])', /safety_violations=\[violence\]/.test(e?.message ?? ''), e?.message)
  await control({ mode: 'verify' })
  e = await failure(client().images.generate(ASK))
  check('C: an organisation that is not verified is a 403 whose words say so', e instanceof OpenAI.PermissionDeniedError && /must be verified/.test(e.message), show([e?.constructor?.name, e?.message?.slice(0, 80)]))
  await control({ mode: '401' })
  e = await failure(client().images.generate(ASK))
  check('C: a refused key is AuthenticationError', e instanceof OpenAI.AuthenticationError)
  await control({ mode: '500' })
  e = await failure(client().images.generate(ASK))
  check('C: a server error is InternalServerError', e instanceof OpenAI.InternalServerError)
  await control({ mode: 'echokey' })
  e = await failure(client().images.generate(ASK))
  check('C: a provider that repeats the key puts it in the SDK\'s message (so the adapter must scrub it)', (e?.message ?? '').includes(KEY))
  await control({ mode: 'hang' })
  let t0 = Date.now()
  e = await failure(client().images.generate(ASK, { timeout: 1500 }))
  check('C: a hang ends at the clock with APIConnectionTimeoutError', e instanceof OpenAI.APIConnectionTimeoutError && Date.now() - t0 < 6000, show([e?.constructor?.name, Date.now() - t0]))
  const stop = new AbortController()
  setTimeout(() => stop.abort(), 300)
  t0 = Date.now()
  e = await failure(client().images.generate(ASK, { signal: stop.signal, timeout: 60000 }))
  check('C: Stop ends the wait at once with APIUserAbortError', e instanceof OpenAI.APIUserAbortError && Date.now() - t0 < 3000, show([e?.constructor?.name, Date.now() - t0]))
  await control({ mode: 'garbage' })
  e = await failure(client().images.generate(ASK))
  check('C: an answer that is not JSON is a SyntaxError from the SDK\'s parser', e instanceof SyntaxError, show(e?.constructor?.name))
  const dead = new OpenAI({ apiKey: KEY, baseURL: 'http://127.0.0.1:9/v1', organization: null, project: null, maxRetries: 0 })
  e = await failure(dead.images.generate(ASK, { timeout: 5000 }))
  check('C: a server that is not there is APIConnectionError', e instanceof OpenAI.APIConnectionError, show(e?.constructor?.name))
})

// ============ D. the mock refuses what the documentation refuses ============
await guard('D', async () => {
  await reset()
  const refused = async (body, what) => {
    const e = await failure(client().images.generate(body))
    check(`D: the mock refuses ${what}`, e instanceof OpenAI.BadRequestError, show([e?.status, e?.message?.slice(0, 120)]))
  }
  await refused({ ...ASK, size: '1000x1000' }, 'a size not divisible by 16')
  await refused({ ...ASK, size: '3840x1024' }, 'a ratio beyond 3 to 1')
  await refused({ ...ASK, size: '4096x2304' }, 'a size above 3840x2160')
  await refused({ ...ASK, quality: 'xhigh' }, 'xhigh for gpt-image-2 (only the 2.5 models take it)')
  await refused({ ...ASK, n: 11 }, 'eleven pictures')
  await refused({ ...ASK, response_format: 'b64_json' }, 'response_format (the GPT image models always answer in base64)')
  await refused({ ...ASK, moderation: 'off' }, 'a moderation level that is not low or auto')
  await refused({ ...ASK, colour: 'red' }, 'a field it does not know')
  const { model, ...noModel } = ASK
  await refused(noModel, 'a request that names no model (the API would use dall-e-2)')
  const ok = await client().images.generate({ ...ASK, model: 'gpt-image-2.5-flare', quality: 'xhigh', size: '3840x2160' })
  check('D: and takes xhigh at 3840x2160 for a 2.5 model', ok.data.length === 1 && show(pngSize(Buffer.from(ok.data[0].b64_json, 'base64'))) === '[3840,2160]')
})

// ============ E. the baseline ============
await guard('E', async () => {
  const files = []
  const walk = (dir) => { for (const name of readdirSync(dir)) { const p = join(dir, name); if (statSync(p).isDirectory()) walk(p); else if (/\.(ts|tsx)$/.test(name)) files.push(p) } }
  walk(join(REPO, 'src'))
  const users = files.filter((f) => /images\.generate|images\/generations|b64_json/.test(readFileSync(f, 'utf8')))
  check('E: nothing in the app makes a picture yet (no images.generate, no endpoint, no b64_json)', users.length === 0, show(users))
  const html = source('src/renderer/index.html')
  check("E: the page's policy allows pictures only from the app and data: (img-src 'self' data:), so a picture must be handed over as data:", /img-src 'self' data:"/.test(html) && !/blob:/.test(html))
  const record = { version: 1, id: '00000000-0000-4000-8000-000000000001', at: 1, chat: null, provider: 'openai', model: 'gpt-image-2.5-flare', effort: null, state: 'done', estimate: true, tokens: { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 }, prices: { inputPerMTok: 0, cacheReadPerMTok: 0, cacheWritePerMTok: 0, outputPerMTok: 0 } }
  check('E: a ledger record can name an image model as it is (the model id rule allows the dot)', usage.parseLedgerRecord(record) !== null)
  check('E: and a record has no place for an image fee yet (an extra field is dropped)', !('image' in (usage.parseLedgerRecord({ ...record, image: { usd: 1 } }) ?? {})))
})

await mock.close()
const ok = check.summary()
process.exit(ok ? 0 : 1)
