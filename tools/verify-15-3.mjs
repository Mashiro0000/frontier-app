// Slice 15.3 under plain Node (no window): the speech-to-text adapter (D-047). The real SDK of the repo against the fake speech endpoint of the mock (tools/mock-audio.mjs, which
// refuses what OpenAI's guide says it refuses). What it shows:
//   A. the request: where it goes, as what, with exactly which three fields, the clip's bytes unchanged, the key only in Authorization, no retry;
//   B. the answers: the text, the seconds the provider says it billed (only a sensible `duration`), an empty answer, a hostile one passed on untouched for the service to clean,
//      an answer without text, an answer that is not JSON;
//   C. every failure: the sentence, whether nothing is owed (the provider refused outright), one try only, the key scrubbed out of the words, a dead server, a clock, Stop;
//   D. hostile environment variables change nothing (another base address, another key, an organisation, custom headers);
//   E. what the source must keep true.
// Run: node tools/guarded.mjs tools/verify-15-3.mjs      (ONLY=A,C runs some parts)
import './ts-resolve.mjs'
import { checker } from './cdp.mjs'
import { createHash, randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { REPO, REPO_URL } from './paths.mjs'
import { startMock } from './mock-providers.mjs'

const check = checker()
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(',')) : null
const guard = async (name, fn) => { if (ONLY && !ONLY.has(name)) return; try { await fn() } catch (error) { check(`${name} did not run to its end: ${String(error?.stack ?? error).slice(0, 400)}`, false) } }
const show = (v) => JSON.stringify(v)?.slice(0, 400)
const SRC = `${REPO_URL}/src`
const audio = await import(`${SRC}/main/providers/openaiAudio.ts`)
const V = await import(`${SRC}/shared/voice.ts`)
const source = (rel) => readFileSync(join(REPO, rel), 'utf8')

const PORT = Number(process.env.AUDIO_TEST_PORT ?? 8894)
const mock = await startMock(PORT)
const origin = `http://127.0.0.1:${PORT}`
const KEY = 'sk-proj-' + randomBytes(24).toString('hex')
const credentials = { apiKey: KEY, baseURL: origin }
const requests = async () => (await (await fetch(`${origin}/__requests`)).json()).filter((r) => r.audio)
const reset = () => fetch(`${origin}/__reset`, { method: 'POST' })
const control = (body) => fetch(`${origin}/__audio`, { method: 'POST', body: JSON.stringify(body) })
/** A WebM-looking clip of `rest` bytes (the mock looks at the form, not at the audio). */
const clip = (rest = 3000) => Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01, 0x42, 0x82, 0x84, 0x77, 0x65, 0x62, 0x6d]), randomBytes(rest)])
const sha = (b) => createHash('sha256').update(b).digest('hex')
const within = (promise, ms, what) => Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error(`no answer within ${ms} ms: ${what}`)), ms))])
const failure = async (promise) => { try { await promise; return null } catch (error) { return error } }

// ============ A. the request ============
await guard('A', async () => {
  await reset()
  const bytes = clip(5000)
  const got = await audio.transcribe({ credentials, clip: bytes })
  const [r] = await requests()
  check('A: one request, a POST to /v1/audio/transcriptions', (await requests()).length === 1 && r.url === '/v1/audio/transcriptions', show(r?.url))
  check('A: as multipart/form-data', /^multipart\/form-data; boundary=/.test(r.headers['content-type']), r.headers['content-type'])
  check('A: with exactly three fields: file, model, response_format (nothing the person said in text, no prompt, no language)', [...r.fields].sort().join() === 'file,model,response_format', show(r.fields))
  check('A: the model is gpt-transcribe and the answer is asked for as json', r.model === 'gpt-transcribe' && r.responseFormat === 'json', show([r.model, r.responseFormat]))
  check('A: the clip is named clip.webm and typed audio/webm', r.fileName === 'clip.webm' && r.fileType === 'audio/webm', show([r.fileName, r.fileType]))
  check('A: its bytes arrive unchanged', r.fileBytes === bytes.length && r.fileSha === sha(bytes), show([r.fileBytes, bytes.length]))
  check('A: the key is in Authorization: Bearer, and nowhere else', r.headers.authorization === `Bearer ${KEY}` && !r.headers['x-api-key'] && !JSON.stringify(r.fields).includes(KEY))
  check('A: the real API would take it: no problem was found', r.problems.length === 0, show(r.problems))
  check('A: no retry (a clip sent twice is billed twice)', r.retryCount === 0 && (await requests()).length === 1)
  check('A: the answer is the text', got.text === 'hello from the mock', show(got))
  const two = await Promise.all([audio.transcribe({ credentials, clip: clip(100) }), audio.transcribe({ credentials, clip: clip(100) })])
  check('A: two at once are two requests', two.length === 2 && (await requests()).length === 3)
  const big = clip(1_000_000)
  const bigGot = await audio.transcribe({ credentials, clip: big })
  check('A: a clip of 1 MB goes through', bigGot.text === 'hello from the mock' && (await requests()).at(-1).fileBytes === big.length)
  check('A: the model is the shared constant', V.TRANSCRIBE_MODEL === 'gpt-transcribe')
})

// ============ B. the answers ============
await guard('B', async () => {
  await reset()
  let got = await audio.transcribe({ credentials, clip: clip() })
  check('B: a duration is read: the seconds the provider says it billed', got.providerSeconds === 2, show(got))
  await control({ usage: 'tokens' })
  got = await audio.transcribe({ credentials, clip: clip() })
  check('B: token usage is not seconds: null', got.providerSeconds === null && got.text === 'hello from the mock', show(got))
  await control({ usage: 'none' })
  got = await audio.transcribe({ credentials, clip: clip() })
  check('B: no usage: null', got.providerSeconds === null)
  for (const seconds of [-1, 3601, 1e9]) {
    await control({ seconds })
    got = await audio.transcribe({ credentials, clip: clip() })
    if (got.providerSeconds !== null) check(`B: a duration of ${seconds} s is not believed`, false, show(got))
  }
  check('B: a duration below 0 or above an hour is not believed', true)
  await control({ seconds: 3600 })
  check('B: an hour exactly is', (await audio.transcribe({ credentials, clip: clip() })).providerSeconds === 3600)
  await control({ seconds: 0 })
  check('B: zero is', (await audio.transcribe({ credentials, clip: clip() })).providerSeconds === 0)
  await control({ mode: 'empty' })
  got = await audio.transcribe({ credentials, clip: clip() })
  check('B: an empty answer is an empty text (the service says "nothing was heard")', got.text === '')
  await control({ mode: 'hostile' })
  got = await audio.transcribe({ credentials, clip: clip() })
  check('B: a hostile text is passed on as it came (controls, reversing marks, 30,000 characters): cleaning is the service\'s', got.text.includes('\u0000') && got.text.includes('‮') && got.text.length > 30_000, String(got.text.length))
  await control({ mode: 'notext' })
  let e = await failure(audio.transcribe({ credentials, clip: clip() }))
  check('B: an answer without text is a failure with a sentence, and is not "rejected" (it may have been billed)', e instanceof audio.TranscribeFailed && /could not read/.test(e.message) && e.rejected === false, show(e?.message))
  await control({ mode: 'garbage' })
  e = await failure(audio.transcribe({ credentials, clip: clip() }))
  check('B: an answer that is not JSON is a failure with a sentence', e instanceof audio.TranscribeFailed && e.message.length > 5 && e.rejected === false, show(e?.message))
})

// ============ C. every failure ============
await guard('C', async () => {
  const cases = [
    ['400', 'bad-request', true, /The request was refused \(400\)/],
    ['401', 'auth', true, /The API key was not accepted \(401\)/],
    ['403', 'permission', true, /not allowed to do that \(403\)/],
    ['404', 'not-found', true, /was not found for this account \(404\)/],
    ['429', 'rate-limit', false, /Too many requests right now \(429\)/],
    ['429quota', 'quota', true, /no credit left/],
    ['500', 'server', false, /had a problem on its side \(500\)/],
    ['503', 'overloaded', false, /overloaded right now \(503\)/],
    ['503retry', 'overloaded', false, /overloaded right now \(503\)/]
  ]
  for (const [mode, kind, rejected, words] of cases) {
    await reset()
    await control({ mode })
    const e = await failure(audio.transcribe({ credentials, clip: clip() }))
    const sent = (await requests()).length
    check(`C: ${mode}: ${kind}, ${rejected ? 'nothing is owed' : 'maybe billed'}, the sentence, and exactly one try`, e instanceof audio.TranscribeFailed && e.kind === kind && e.rejected === rejected && words.test(e.message) && e.stopped === false && sent === 1, show([e?.kind, e?.rejected, e?.message, sent]))
  }
  await reset()
  await control({ mode: 'echokey' })
  let e = await failure(audio.transcribe({ credentials, clip: clip() }))
  check('C: the key is scrubbed out of the provider\'s own words', e instanceof audio.TranscribeFailed && !e.message.includes(KEY) && !e.message.includes(KEY.slice(0, 20)) && e.message.includes('[key]'), show(e?.message))
  await reset()
  await fetch(`${origin}/__expect-key`, { method: 'POST', body: JSON.stringify({ key: 'sk-proj-the-right-one', provider: 'openai' }) })
  e = await failure(audio.transcribe({ credentials, clip: clip() }))
  check('C: a key the provider does not know is "auth" and refused outright', e?.kind === 'auth' && e.rejected === true, show(e?.message))
  await reset()
  e = await failure(audio.transcribe({ credentials: { apiKey: KEY, baseURL: 'http://127.0.0.1:1' }, clip: clip() }))
  check('C: a server that is not there is "connection" and maybe billed (nothing is known)', e instanceof audio.TranscribeFailed && e.kind === 'connection' && e.rejected === false && /Could not reach OpenAI/.test(e.message), show([e?.kind, e?.message]))
  await control({ mode: 'hang' })
  const t0 = Date.now()
  e = await failure(within(audio.transcribe({ credentials, clip: clip(), timeoutMs: 400 }), 8000, 'the clock'))
  check('C: a server that never answers: the clock ends it ("timeout")', e instanceof audio.TranscribeFailed && e.kind === 'timeout' && e.stopped === false && Date.now() - t0 < 5000, show([e?.kind, Date.now() - t0]))
  check('C: the default clock is 45 seconds', audio.TRANSCRIBE_TIMEOUT_MS === 45_000)
  const ctl = new AbortController()
  const t1 = Date.now()
  setTimeout(() => ctl.abort(), 250)
  e = await failure(within(audio.transcribe({ credentials, clip: clip(), signal: ctl.signal }), 8000, 'the stop'))
  check('C: Stop (the signal) ends it at once and says it was given up, not refused', e instanceof audio.TranscribeFailed && e.stopped === true && e.rejected === false && Date.now() - t1 < 3000, show([e?.stopped, Date.now() - t1]))
  const already = new AbortController()
  already.abort()
  const t2 = Date.now()
  e = await failure(within(audio.transcribe({ credentials, clip: clip(), signal: already.signal }), 5000, 'an aborted signal'))
  check('C: a signal that is already aborted sends nothing', e instanceof audio.TranscribeFailed && e.stopped === true && Date.now() - t2 < 2000, show(e?.message))
})

// ============ D. hostile environment ============
await guard('D', async () => {
  await reset()
  const saved = { ...process.env }
  Object.assign(process.env, { OPENAI_BASE_URL: 'http://127.0.0.1:1/evil', OPENAI_API_KEY: 'sk-from-the-environment', OPENAI_ORG_ID: 'org-evil', OPENAI_PROJECT_ID: 'proj-evil', OPENAI_CUSTOM_HEADERS: 'Authorization: Bearer evil\nX-Evil: 1', OPENAI_LOG: 'debug' })
  let got, error
  try { got = await audio.transcribe({ credentials, clip: clip() }) } catch (e) { error = e }
  for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k]
  Object.assign(process.env, saved)
  const [r] = await requests()
  check('D: with another base address, another key, an organisation, a project, custom headers and debug logging in the environment, the request is the same', error === undefined && got?.text === 'hello from the mock' && r.headers.authorization === `Bearer ${KEY}` && !r.headers['openai-organization'] && !r.headers['openai-project'] && !r.headers['x-evil'], show([error?.message, r?.headers]))
})

// ============ E. the source ============
await guard('E', async () => {
  const text = source('src/main/providers/openaiAudio.ts')
  check('E: no Electron import', !/from 'electron'/.test(text))
  check('E: the SDK is told not to retry and to wait at most the clock', /maxRetries: 0/.test(text) && /timeout: timeoutMs/.test(text))
  check('E: the request has the three fields and no others (no prompt, language, keywords)', /\{ file, model: TRANSCRIBE_MODEL, response_format: 'json' \}/.test(text) && !/\bprompt\b\s*:|\blanguage\b\s*:|\bkeywords\b\s*:|\btemperature\b\s*:/.test(text))
  check('E: the environment is not read here', !/process\.env/.test(text))
  check('E: the client is the chat\'s own (nothing is read from the environment by it)', /newClient\(credentials\)/.test(text) && /export function newClient/.test(source('src/main/providers/openai.ts')))
  check('E: nothing in the app imports the adapter yet (15.5 wires it)', !['src/main/ipc.ts', 'src/main/chat.ts', 'src/main/index.ts'].some((f) => /openaiAudio/.test(source(f))))
})

await mock.close()
const ok = check.summary()
process.exit(ok ? 0 : 1)
