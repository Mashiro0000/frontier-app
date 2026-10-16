// Slice 16.3 under plain Node (no window): the picture adapter in main (D-048). The real SDK of the repo against the fake image endpoint of the mock (tools/mock-images.mjs).
// What it shows:
//   A. the request: where it goes, exactly which six fields, the description exactly as typed, no moderation level, the key only in Authorization, ONE try;
//   B. the answers: the pictures checked and handed on, the tokens read only when they make sense, and every kind of answer that cannot be used refused as a whole;
//   C. every failure: the sentence, whether nothing is owed, one try only (a block is never tried again with a lower moderation level), the key scrubbed out, a dead server,
//      a clock, Stop;
//   D. hostile environment variables change nothing;
//   E. what the source must keep true.
// Run: node tools/guarded.mjs tools/verify-16-3.mjs      (ONLY=A,C runs some parts)
import './ts-resolve.mjs'
import { checker } from './cdp.mjs'
import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { REPO, REPO_URL } from './paths.mjs'
import { startMock } from './mock-providers.mjs'
import { solidPng } from './mock-images.mjs'

const check = checker()
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(',')) : null
const guard = async (name, fn) => { if (ONLY && !ONLY.has(name)) return; try { await fn() } catch (error) { check(`${name} did not run to its end: ${String(error?.stack ?? error).slice(0, 400)}`, false) } }
const show = (v) => JSON.stringify(v)?.slice(0, 400)
const A = await import(`${REPO_URL}/src/main/providers/openaiImages.ts`)
const source = (rel) => readFileSync(join(REPO, rel), 'utf8')

const PORT = Number(process.env.IMAGES_TEST_PORT ?? 8897)
const mock = await startMock(PORT)
const origin = `http://127.0.0.1:${PORT}`
const KEY = 'sk-proj-' + randomBytes(24).toString('hex')
const credentials = { apiKey: KEY, baseURL: origin }
const requests = async () => (await (await fetch(`${origin}/__requests`)).json()).filter((r) => r.images)
const reset = () => fetch(`${origin}/__reset`, { method: 'POST' })
const control = (body) => fetch(`${origin}/__images`, { method: 'POST', body: JSON.stringify(body) })
const failure = async (promise) => { try { await promise; return null } catch (error) { return error } }
const ASK = { credentials, model: 'gpt-image-2', modelLabel: 'GPT Image 2', prompt: 'A red bicycle\n  leaning on a blue wall  ', size: '1024x1024', quality: 'medium', count: 1 }
const gen = (extra = {}) => A.generatePictures({ ...ASK, ...extra })

// ============ A. the request ============
await guard('A', async () => {
  await reset()
  const got = await gen()
  const all = await requests()
  const r = all[0]
  check('A: one request, a POST to /v1/images/generations', all.length === 1 && r.url === '/v1/images/generations', show(r?.url))
  check('A: exactly six fields: model, n, output_format, prompt, quality, size (no moderation, no background, no user)', r.fields.join() === 'model,n,output_format,prompt,quality,size', show(r.fields))
  check('A: the values are the checked request\'s', r.body.model === 'gpt-image-2' && r.body.n === 1 && r.body.size === '1024x1024' && r.body.quality === 'medium' && r.body.output_format === 'png', show(r.body))
  check('A: the description EXACTLY as typed (the line break and the spaces too)', r.body.prompt === ASK.prompt)
  check('A: the key is in Authorization: Bearer, and nowhere else', r.headers.authorization === `Bearer ${KEY}` && !r.headers['x-api-key'] && !JSON.stringify(r.body).includes(KEY))
  check('A: the mock found nothing the real API would refuse', r.problems.length === 0, show(r.problems))
  check('A: no retry', r.retryCount === 0)
  check('A: one picture back', got.pictures.length === 1 && got.pictures[0].type === 'image/png' && got.pictures[0].width === 1024)
  await reset()
  const four = await gen({ count: 4, size: '1536x1024', quality: 'high', model: 'gpt-image-2.5-flare', modelLabel: 'GPT Image 2.5 Flare' })
  const r4 = (await requests())[0]
  check('A: four landscape pictures of Flare at high: n 4, the size and the model as given', r4.body.n === 4 && r4.body.size === '1536x1024' && r4.body.model === 'gpt-image-2.5-flare' && four.pictures.length === 4 && four.pictures.every((p) => p.width === 1536 && p.height === 1024))
})

// ============ B. the answers ============
await guard('B', async () => {
  await reset()
  let got = await gen()
  check('B: the picture is the bytes that came, checked (a PNG of 1024x1024)', got.pictures[0].bytes.equals(solidPng(1024, 1024, [40, 120, 200])))
  check('B: the tokens are read (the words in, the picture out)', show(got.tokens) === show({ input: Math.ceil(ASK.prompt.length / 4), output: 1767 }), show(got.tokens))
  await control({ usage: 'none' })
  got = await gen()
  check('B: no usage: no tokens (the cost will be the table\'s)', got.tokens === null && got.pictures.length === 1)
  await control({ usage: 'hostile' })
  got = await gen()
  check('B: impossible tokens (-5 and 10^15) are not believed: none', got.tokens === null)
  check('B: tokens within bounds, whole: read; zero out, a part, beyond the bound: not', show(A.readTokens({ input_tokens: 9, output_tokens: 7033 }, 1)) === '{"input":9,"output":7033}' && A.readTokens({ input_tokens: 9, output_tokens: 0 }, 1) === null && A.readTokens({ input_tokens: 9.5, output_tokens: 100 }, 1) === null && A.readTokens({ input_tokens: 9, output_tokens: 100_001 }, 1) === null && A.readTokens({ input_tokens: 9, output_tokens: 400_000 }, 4) !== null && A.readTokens({ input_tokens: '9', output_tokens: 100 }, 1) === null && A.readTokens([9, 100], 1) === null)
  for (const mode of ['jpeg', 'webp']) {
    await control({ mode })
    got = await gen()
    check(`B: a ${mode.toUpperCase()} answer is taken by its header`, got.pictures[0].type === `image/${mode}`, show(got.pictures[0].type))
  }
  const unusable = { fewer: /0 pictures came back for 1/, more: /2 pictures came back for 1/, url: /address/, badb64: /not base64/, text: /not a PNG, JPEG or WebP/, gif: /not a PNG, JPEG or WebP/, huge: /larger than 12 MB/, wide: /3840 pixels/, cut: /not a whole PNG|cut off/, nodata: /held no pictures/ }
  for (const [mode, re] of Object.entries(unusable)) {
    await reset()
    await control({ mode })
    const e = await failure(gen())
    check(`B: refused as a whole (${mode}): "could not be used", maybe billed (not rejected), and one request`, e instanceof A.ImageFailed && e.kind === 'unusable' && !e.rejected && re.test(e.message) && /nothing was kept/.test(e.message) && (await requests()).length === 1, show([e?.kind, e?.rejected, e?.message]))
  }
  await reset()
  await control({ mode: 'fewer' })
  const e = await failure(gen({ count: 3 }))
  check('B: two pictures for three asked: all refused (none kept)', e instanceof A.ImageFailed && /2 pictures came back for 3/.test(e.message))
  await control({ mode: 'garbage' })
  const g = await failure(gen())
  check('B: an answer that is not JSON: a sentence, maybe billed', g instanceof A.ImageFailed && g.message === 'OpenAI sent an answer the app could not read.' && !g.rejected)
})

// ============ C. the failures ============
await guard('C', async () => {
  const cases = {
    blocked: { rejected: true, kind: 'blocked', re: /^OpenAI's safety system refused this description \(violence\)\. Nothing was made\./ },
    verify: { rejected: true, kind: 'permission', re: /organization must be verified before it can use GPT Image 2\./ },
    '400': { rejected: true, kind: 'bad-request', re: /refused \(400\)/ },
    '401': { rejected: true, kind: 'auth', re: /API key was not accepted \(401\)/ },
    '403': { rejected: true, kind: 'permission', re: /not allowed to do that \(403\)/ },
    '404': { rejected: true, kind: 'not-found', re: /^OpenAI says GPT Image 2 \(gpt-image-2\) is not available to this account \(404\)\.$/ },
    '429': { rejected: false, kind: 'rate-limit', re: /Too many requests/ },
    '429quota': { rejected: true, kind: 'quota', re: /no credit left/ },
    '500': { rejected: false, kind: 'server', re: /problem on its side \(500\)/ },
    '503': { rejected: false, kind: 'overloaded', re: /overloaded right now \(503\)/ },
    '503retry': { rejected: false, kind: 'overloaded', re: /overloaded/ }
  }
  for (const [mode, want] of Object.entries(cases)) {
    await reset()
    await control({ mode })
    const e = await failure(gen())
    const sent = await requests()
    check(`C: ${mode}: ${want.kind}, ${want.rejected ? 'nothing owed' : 'maybe billed'}, the sentence, ONE request`, e instanceof A.ImageFailed && e.kind === want.kind && e.rejected === want.rejected && !e.stopped && want.re.test(e.message) && sent.length === 1, show([e?.kind, e?.rejected, e?.message, sent.length]))
  }
  await reset()
  await control({ mode: 'blocked' })
  await failure(gen())
  await failure(gen())
  const sent = await requests()
  check('C: a block is never tried again with a lower moderation level: no request ever carries moderation', sent.length === 2 && sent.every((r) => !('moderation' in r.body)))
  check('C: the categories of a block are plain words, at most five, letters only', show(A.blockedCategories('x safety_violations=[violence, self_harm, <script>, sexual]')) === show(['violence', 'self harm', 'sexual']) && show(A.blockedCategories('nothing here')) === '[]' && A.blockedCategories(`safety_violations=[${'a,'.repeat(20)}]`).length === 5)
  await reset()
  await control({ mode: 'echokey' })
  const k = await failure(gen())
  check('C: a provider that repeats the key: the whole key is scrubbed from the sentence', k instanceof A.ImageFailed && !k.message.includes(KEY) && k.message.includes('[key]'), k?.message)
  await reset()
  await control({ mode: 'hang' })
  let t0 = Date.now()
  const h = await failure(gen({ timeoutMs: 1500 }))
  check('C: a hang ends at the clock: a timeout, maybe billed, one request', h instanceof A.ImageFailed && h.kind === 'timeout' && !h.rejected && Date.now() - t0 < 6000 && (await requests()).length === 1, show([h?.kind, Date.now() - t0]))
  check('C: the clock is two minutes unless told otherwise', A.generatePictures.length === 1 && /timeoutMs = IMAGE_LIMITS\.timeoutMs/.test(source('src/main/providers/openaiImages.ts')))
  const stop = new AbortController()
  setTimeout(() => stop.abort(), 300)
  t0 = Date.now()
  const s = await failure(gen({ signal: stop.signal }))
  check('C: Stop ends the wait at once: stopped, not refused, and the sentence says OpenAI may still bill it', s instanceof A.ImageFailed && s.stopped && !s.rejected && Date.now() - t0 < 3000 && /may still bill/.test(s.message), show([s?.stopped, s?.message, Date.now() - t0]))
  await reset()
  await control({ mode: 'slow', ms: 800 })
  const slow = await gen()
  check('C: a slow answer within the clock is taken', slow.pictures.length === 1)
  const dead = await failure(A.generatePictures({ ...ASK, credentials: { apiKey: KEY, baseURL: 'http://127.0.0.1:9' }, timeoutMs: 5000 }))
  check('C: a server that is not there: could not reach OpenAI, not counted as refused (nothing is known of billing)', dead instanceof A.ImageFailed && dead.kind === 'connection' && !dead.rejected && /Could not reach OpenAI/.test(dead.message), show([dead?.kind, dead?.message]))
})

// ============ D. hostile environment ============
await guard('D', async () => {
  await reset()
  const saved = { ...process.env }
  Object.assign(process.env, { OPENAI_BASE_URL: 'http://127.0.0.1:1/evil', OPENAI_API_KEY: 'sk-from-the-environment', OPENAI_ORG_ID: 'org-evil', OPENAI_PROJECT_ID: 'proj-evil', OPENAI_CUSTOM_HEADERS: 'Authorization: Bearer evil\nX-Evil: 1', OPENAI_LOG: 'debug' })
  let got, error
  try { got = await gen() } catch (e) { error = e }
  for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k]
  Object.assign(process.env, saved)
  const [r] = await requests()
  check('D: with another base address, key, organisation, project, custom headers and debug logging in the environment, the request is the same', error === undefined && got?.pictures.length === 1 && r.headers.authorization === `Bearer ${KEY}` && !r.headers['openai-organization'] && !r.headers['openai-project'] && !r.headers['x-evil'], show([error?.message, r?.headers]))
})

// ============ E. the source ============
await guard('E', async () => {
  const text = source('src/main/providers/openaiImages.ts')
  check('E: no Electron import', !/from 'electron'/.test(text))
  check('E: the SDK is told not to retry and to wait at most the clock', /maxRetries: 0/.test(text) && /timeout: timeoutMs/.test(text))
  check('E: the request has the six fields and no others', /\{ model, prompt, n: count, size, quality, output_format: 'png' \}/.test(text))
  check('E: no moderation level is ever named in a request, and no "low"', !/moderation\s*:/.test(text))
  check('E: the environment is not read here', !/process\.env/.test(text))
  check('E: the client is the chat\'s own', /newClient\(credentials\)/.test(text))
  check('E: the answer goes through the picture checker', /checkAnswerPictures\(answer\.data, count\)/.test(text))
  check('E: the reply path does not import the adapter (no tool for the model)', !['src/main/chat.ts', 'src/main/replyTools.ts', 'src/main/toolRegistry.ts', 'src/main/toolCore.ts', 'src/main/index.ts'].some((f) => /openaiImages/.test(source(f))))
})

await mock.close()
const ok = check.summary()
process.exit(ok ? 0 : 1)
