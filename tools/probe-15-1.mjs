// Stage 15.1 (D-047), the probe and the gate: can a sandboxed window of this app record a microphone, can the installed SDK send that clip as a transcription request,
// and can the window speak with the voices of this PC? Run in the real window with Chromium's FAKE microphone (a file of a tone, tools/run151.mjs makes it), so no real
// microphone is opened and nothing is heard, except that the speech check says one short word with the volume at 0.
// It also reports what the window lets the page do (before 15.4 it let the page open the microphone and the camera by itself and change the window's title; D-047 has the
// baseline measured without Chromium's fake-UI switch, which hides the permission handler). The probe keeps its 19 checks of what the stage needs; those three are notes.
// Stop rule (the plan): if the window cannot record, or the SDK cannot send the clip, the stage stops and speech stays manual.
// Needs: USER_DATA_DIR (scratch), INSPECT_PORT, FAKE_TONE_HZ (the tone the fake microphone plays, for the check that the clip is not silence).
import './temp-on-a.mjs'
import './ts-resolve.mjs'
import { connect, checker, sleep } from './cdp.mjs'
import { assertScratchProfile } from './profile-guard.mjs'
import { mainInspector } from './lib4.mjs'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { REPO } from './paths.mjs'

const require = createRequire(REPO + '/package.json')
const sdk = await import(pathToFileURL(require.resolve('openai')).href)
const OpenAI = sdk.default?.default ?? sdk.default
const toFile = sdk.toFile ?? OpenAI.toFile

const port = Number(process.argv[3] ?? 9222)
const inspectPort = Number(process.env.INSPECT_PORT)
const hz = Number(process.env.FAKE_TONE_HZ ?? 440)
const check = checker()
const page = await connect(port)
await assertScratchProfile()
const main = await mainInspector(inspectPort)
const ev = (expression) => page.evaluate(expression)
const show = (v) => JSON.stringify(v)?.slice(0, 700)

// ---- a tiny stand-in for the transcription endpoint: it keeps what the SDK sent ----
const seen = []
const server = createServer((req, res) => {
  const chunks = []
  req.on('data', (c) => chunks.push(c))
  req.on('end', () => {
    const body = Buffer.concat(chunks)
    seen.push({ method: req.method, url: req.url, headers: req.headers, body })
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ text: 'hello from the stand-in', usage: { type: 'duration', seconds: 2 } }))
  })
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${server.address().port}`

try {
  // ============ A. what the window can do today ============
  const hasApi = await ev(`typeof window.api === 'object' && typeof window.api.voice === 'undefined'`)
  // (15.1 was run before the bridge had a voice part; since 15.5 it has one, so this is only noted)
  console.log(`   (the bridge has a voice part: ${hasApi === true ? 'no' : 'yes'})`)

  const mic = await ev(`(async () => {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true })
      const t = s.getAudioTracks()[0]
      const out = { ok: true, label: t.label, state: t.readyState }
      s.getTracks().forEach((x) => x.stop())
      return out
    } catch (e) { return { ok: false, name: e.name, message: String(e.message).slice(0, 200) } }
  })()`)
  // (the probe's first run said yes here; since 15.4 the window refuses it unless main opened the gate. The baseline without a handler was measured again in 15.5 in a stand-alone Electron script: D-047)
  console.log(`   (the page opens a microphone by itself: ${mic.ok === true ? 'YES' : 'no'}${mic.ok ? '' : ' - ' + mic.name})`)

  const cam = await ev(`(async () => {
    try { const s = await navigator.mediaDevices.getUserMedia({ video: true }); s.getTracks().forEach((x) => x.stop()); return { ok: true } }
    catch (e) { return { ok: false, name: e.name } }
  })()`)
  console.log(`   (the camera, same question: ${show(cam)}) - 15.4 must refuse it for good`)

  const titleBefore = await main.inMain(`process.mainModule.require('electron').BrowserWindow.getAllWindows()[0].getTitle()`)
  await ev(`document.title = 'changed by the page'`)
  await sleep(300)
  const titleAfter = await main.inMain(`process.mainModule.require('electron').BrowserWindow.getAllWindows()[0].getTitle()`)
  console.log(`   (window title before: ${show(titleBefore)}, after the page set document.title: ${show(titleAfter)})`)
  // (the title: yes before 15.4; since then main cancels the page's title changes)
  console.log(`   (the page can change the window title: ${titleAfter === 'changed by the page' ? 'YES' : 'no'})`)
  await ev(`document.title = 'Frontier App'`)

  // ============ B. record the fake microphone in the sandboxed window ============
  const types = await ev(`({ webm: MediaRecorder.isTypeSupported('audio/webm;codecs=opus'), plain: MediaRecorder.isTypeSupported('audio/webm'), ogg: MediaRecorder.isTypeSupported('audio/ogg;codecs=opus') })`)
  check('B: MediaRecorder offers audio/webm with Opus (what the provider accepts)', types.webm === true, show(types))

  const rec = await ev(`(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    const rec = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' })
    const parts = []
    rec.ondataavailable = (e) => { if (e.data.size > 0) parts.push(e.data) }
    const stopped = new Promise((resolve) => { rec.onstop = resolve })
    const t0 = performance.now()
    rec.start(250)
    await new Promise((r) => setTimeout(r, 1500))
    rec.stop()
    await stopped
    const ms = performance.now() - t0
    stream.getTracks().forEach((x) => x.stop())
    const blob = new Blob(parts, { type: 'audio/webm' })
    const bytes = new Uint8Array(await blob.arrayBuffer())
    let bin = ''
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
    // decode it back and look at it: how long, and is there a signal (not silence)?
    const ctx = new AudioContext()
    const audio = await ctx.decodeAudioData(bytes.buffer.slice(0))
    const data = audio.getChannelData(0)
    let sum = 0
    for (const x of data) sum += x * x
    // the strongest frequency among a few candidates, by a plain correlation (is it the tone that was played?)
    const rate = audio.sampleRate
    const probe = (f) => { let a = 0, b = 0; for (let i = 0; i < data.length; i++) { a += data[i] * Math.cos(2 * Math.PI * f * i / rate); b += data[i] * Math.sin(2 * Math.PI * f * i / rate) } return Math.hypot(a, b) / data.length }
    const power = {}
    for (const f of [220, 440, 880, 1000]) power[f] = probe(f)
    await ctx.close()
    return { ms, size: bytes.length, head: [...bytes.subarray(0, 4)], mime: rec.mimeType, b64: btoa(bin), duration: audio.duration, rms: Math.sqrt(sum / data.length), rate, power }
  })()`)
  console.log(`   (recorded ${rec.size} bytes in ${Math.round(rec.ms)} ms, ${rec.mime}, decoded ${rec.duration.toFixed(2)} s at ${rec.rate} Hz, rms ${rec.rms.toFixed(4)}, tone power ${show(rec.power)})`)
  check('B: the clip is a WebM file (starts with the EBML mark 1A 45 DF A3)', rec.head.join() === '26,69,223,163', show(rec.head))
  check('B: 1.5 s of recording is a small clip (under 100 KB) and not empty', rec.size > 1000 && rec.size < 100_000, String(rec.size))
  check('B: the clip decodes, and is about as long as it was recorded', Math.abs(rec.duration - rec.ms / 1000) < 0.6, `${rec.duration} vs ${rec.ms / 1000}`)
  check('B: it is not silence: the fake microphone is really what was recorded', rec.rms > 0.02, `rms ${rec.rms}`)
  const strongest = Object.entries(rec.power).sort((a, b) => b[1] - a[1])[0][0]
  check(`B: and it is the tone the fake microphone plays (${hz} Hz)`, Number(strongest) === hz, show(rec.power))

  // ============ C. the installed SDK sends the clip as a transcription request ============
  const clip = Buffer.from(rec.b64, 'base64')
  const client = new OpenAI({ apiKey: 'sk-probe-not-real-0000', baseURL: `${base}/v1`, maxRetries: 0, timeout: 20_000 })
  const answer = await client.audio.transcriptions.create({ file: await toFile(clip, 'clip.webm', { type: 'audio/webm' }), model: 'gpt-transcribe', response_format: 'json' })
  const req = seen.at(-1)
  const text = req.body.toString('latin1')
  const boundary = /boundary=(.+)$/.exec(String(req.headers['content-type']))?.[1]
  const fields = [...text.matchAll(/Content-Disposition: form-data; name="([^"]+)"(?:; filename="([^"]*)")?/g)].map((m) => ({ name: m[1], filename: m[2] ?? null }))
  console.log(`   (the SDK sent: POST ${req.url}, ${req.headers['content-type']?.split(';')[0]}, fields ${show(fields)})`)
  check('C: the SDK posts to /v1/audio/transcriptions', req.method === 'POST' && req.url === '/v1/audio/transcriptions', `${req.method} ${req.url}`)
  check('C: as multipart/form-data with a boundary', String(req.headers['content-type']).startsWith('multipart/form-data') && !!boundary)
  check('C: with exactly a "file" (clip.webm) and the model and the format as fields', fields.map((f) => f.name).sort().join() === 'file,model,response_format' && fields.find((f) => f.name === 'file')?.filename === 'clip.webm', show(fields))
  check('C: the model field says gpt-transcribe (the installed SDK knows it)', /name="model"\r\n\r\ngpt-transcribe\r\n/.test(text))
  check('C: the key goes in the Authorization header', req.headers.authorization === 'Bearer sk-probe-not-real-0000')
  // the clip's bytes inside the body are exactly the clip
  check('C: the bytes of the clip travel unchanged', req.body.includes(clip), `${clip.length} bytes, sha256 ${createHash('sha256').update(clip).digest('hex').slice(0, 12)}`)
  check('C: the answer comes back as an object with the text', answer?.text === 'hello from the stand-in', show(answer))

  // ============ D. the window can speak with the voices of this PC ============
  const voices = await ev(`(async () => {
    const t0 = performance.now()
    let list = speechSynthesis.getVoices()
    while (list.length === 0 && performance.now() - t0 < 5000) { await new Promise((r) => setTimeout(r, 100)); list = speechSynthesis.getVoices() }
    return { n: list.length, ms: Math.round(performance.now() - t0), sample: list.slice(0, 6).map((v) => ({ name: v.name, lang: v.lang, local: v.localService, def: v.default })) }
  })()`)
  console.log(`   (voices: ${show(voices)})`)
  check('D: the window lists at least one voice of this PC', voices.n > 0, show(voices))
  check('D: and the first one is a local (offline) voice, so nothing leaves the PC', voices.sample[0]?.local === true, show(voices.sample[0]))

  const spoken = await ev(`(async () => {
    const u = new SpeechSynthesisUtterance('ok')
    u.volume = 0
    const events = []
    const t0 = performance.now()
    u.onstart = () => events.push(['start', Math.round(performance.now() - t0)])
    u.onend = () => events.push(['end', Math.round(performance.now() - t0)])
    u.onerror = (e) => events.push(['error', e.error])
    speechSynthesis.speak(u)
    const t1 = performance.now()
    while (!events.some((e) => e[0] === 'end' || e[0] === 'error') && performance.now() - t1 < 8000) await new Promise((r) => setTimeout(r, 50))
    return events
  })()`)
  console.log(`   (a word at volume 0: ${show(spoken)})`)
  check('D: a word is spoken: the utterance starts and ends, with no error', spoken.some((e) => e[0] === 'start') && spoken.some((e) => e[0] === 'end') && !spoken.some((e) => e[0] === 'error'), show(spoken))

  const cut = await ev(`(async () => {
    const u = new SpeechSynthesisUtterance('one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen')
    u.volume = 0
    const events = []
    u.onstart = () => events.push('start')
    u.onend = () => events.push('end')
    u.onerror = (e) => events.push('error:' + e.error)
    speechSynthesis.speak(u)
    const t0 = performance.now()
    while (!events.includes('start') && performance.now() - t0 < 5000) await new Promise((r) => setTimeout(r, 25))
    speechSynthesis.cancel()
    const t1 = performance.now()
    while (!events.some((e) => e === 'end' || e.startsWith('error')) && performance.now() - t1 < 3000) await new Promise((r) => setTimeout(r, 25))
    return { events, ms: Math.round(performance.now() - t1), speaking: speechSynthesis.speaking }
  })()`)
  console.log(`   (cancel in the middle of a sentence: ${show(cut)})`)
  check('D: cancel() stops a sentence at once and nothing is left speaking', cut.events.includes('start') && !cut.speaking && cut.ms < 2500, show(cut))

  // ============ E. the window itself ============
  check('E: the page logged no errors and no warnings', page.problems.length === 0, show(page.problems))
} catch (error) {
  check(`the probe stopped before its end: ${String(error?.stack ?? error).slice(0, 600)}`, false)
}
server.close()
main.close()
const ok = check.summary()
process.exit(ok ? 0 : 1)
