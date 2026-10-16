// Slice 15.5 (D-047) in the real window, against the fake speech endpoint of the mock, with Chromium's FAKE microphone (a file with a 440 Hz tone; tools/run155.mjs makes it) and
// the system's message box stood in for from the main inspector. What it shows, on the real window and the real path (the switch, the key, the limits, the hold):
//   A. the gap 15.1 measured is closed: with no hold open the page cannot open the microphone, the camera or both, cannot ask the permission API for it, cannot rename the window;
//      the clipboard's async API is refused and the old way of copying needs no permission; the bridge has the eight voice functions and no other new door;
//   B. "Speak to type" is switched on only through the system's box (the words are read), and the file says so;
//   C. a hold: begin opens the microphone for the audio only; the title says RECORDING and the page cannot change it; the camera stays refused; a real clip recorded from the
//      fake microphone goes to the fake endpoint and the words come back; the gate is shut again at once (the microphone is refused, the title is back);
//   D. cancel, a clip with no hold, a tap; the switch turned off; the ledger line and the sums; nothing of the clip or the words on the disk;
//   E. the console stays clean.
// Needs: USER_DATA_DIR (scratch), INSPECT_PORT, MOCK_PORT.
import './temp-on-a.mjs'
import './ts-resolve.mjs'
import { connect, checker, sleep } from './cdp.mjs'
import { assertScratchProfile } from './profile-guard.mjs'
import { mainInspector } from './lib4.mjs'
import { installQuestions } from './lib10.mjs'
import { createHash, randomBytes } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const port = Number(process.argv[3] ?? 9222)
const userData = process.env.USER_DATA_DIR
const inspectPort = Number(process.env.INSPECT_PORT)
const mockUrl = `http://127.0.0.1:${process.env.MOCK_PORT}`
if (!userData || !inspectPort || !process.env.MOCK_PORT) throw new Error('USER_DATA_DIR, INSPECT_PORT and MOCK_PORT must be set')
const check = checker()
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(',')) : null
const part = async (name, fn) => { if (ONLY && !ONLY.has(name)) return; try { await fn() } catch (error) { check(`${name} did not run to its end: ${String(error?.stack ?? error).slice(0, 500)}`, false) } }
const show = (v) => JSON.stringify(v)?.slice(0, 600)
const page = await connect(port)
await assertScratchProfile()
const main = await mainInspector(inspectPort)
const Q = await installQuestions(main, { fallback: 'no' })
const ev = (expression) => page.evaluate(expression)
const KEY = 'sk-proj-' + randomBytes(24).toString('hex')
const titleOf = () => main.inMain(`process.mainModule.require('electron').BrowserWindow.getAllWindows()[0].getTitle()`)
const mockRequests = async () => (await (await fetch(`${mockUrl}/__requests`)).json()).filter((r) => r.audio)
const control = (body) => fetch(`${mockUrl}/__audio`, { method: 'POST', body: JSON.stringify(body) })
const sleepUntil = async (predicate, ms = 5000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await predicate()) return true; await sleep(100) } return false }

/** What the page gets for a request to open a device: the name of the error, or the track's label. */
const open = (constraints) => ev(`(async () => {
  try {
    const s = await navigator.mediaDevices.getUserMedia(${JSON.stringify(constraints)})
    const out = { ok: true, tracks: s.getTracks().map((t) => t.kind + ':' + t.label) }
    s.getTracks().forEach((t) => t.stop())
    return out
  } catch (e) { return { ok: false, name: e.name } }
})()`)
/** Records the fake microphone for `ms` and answers with the clip as base64 (the bytes are sent to main with voice.end by the caller). */
const record = (ms) => ev(`(async () => {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
  const rec = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 32000 })
  const parts = []
  rec.ondataavailable = (e) => { if (e.data.size > 0) parts.push(e.data) }
  const stopped = new Promise((resolve) => { rec.onstop = resolve })
  const t0 = performance.now()
  rec.start(250)
  await new Promise((r) => setTimeout(r, ${ms}))
  rec.stop()
  await stopped
  const held = Math.round(performance.now() - t0)
  stream.getTracks().forEach((t) => t.stop())
  const bytes = new Uint8Array(await new Blob(parts).arrayBuffer())
  window.__clip = bytes
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return { size: bytes.length, ms: held, sha: [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join(''), head: [...bytes.subarray(0, 4)] }
})()`)

try {
  // ============ A. the gap is closed ============
  await part('A', async () => {
    const keys = await ev(`Object.keys(window.api.voice).sort().join()`)
    check('A: the bridge has exactly the eight voice functions', keys === 'begin,cancel,end,reset,setListen,setSpeak,setVoice,status', keys)
    check('A: and nothing that opens the microphone, takes a path, a key, a model or an address', !(await ev(`JSON.stringify(Object.keys(window.api)).match(/audio|mic|record|media|ipc/i)`)))
    const status = await ev(`window.api.voice.status()`)
    check('A: both switches start OFF, with the system\'s own voice at normal speed', status.listen === false && status.speak === false && status.voice === null && status.rate === 100 && status.problem === null, show(status))
    const a = await open({ audio: true })
    check('A: with no hold open the page cannot open the microphone (15.1 measured that it could)', a.ok === false && a.name === 'NotAllowedError', show(a))
    const v = await open({ video: true })
    const av = await open({ audio: true, video: true })
    check('A: nor the camera, nor both', v.ok === false && av.ok === false, show([v, av]))
    const display = await ev(`(async () => { try { const s = await navigator.mediaDevices.getDisplayMedia({ video: true }); s.getTracks().forEach((t) => t.stop()); return { ok: true } } catch (e) { return { ok: false, name: e.name } } })()`)
    check('A: nor the screen', display.ok === false, show(display))
    const query = await ev(`navigator.permissions.query({ name: 'microphone' }).then((p) => p.state, (e) => 'error:' + e.name)`)
    check('A: the permission API says the microphone is not available to the page', query === 'denied' || query === 'prompt' || /^error/.test(query), query)
    const devices = await ev(`navigator.mediaDevices.enumerateDevices().then((d) => d.map((x) => x.kind + ':' + x.label))`)
    check('A: the page sees no device names while the gate is shut', devices.every((d) => /:$/.test(d)), show(devices))
    const before = await titleOf()
    await ev(`document.title = 'RECORDING (set by the page)'`)
    await sleep(300)
    check('A: the page cannot rename the window', (await titleOf()) === before && before === 'Frontier App', show([before, await titleOf()]))
    await ev(`document.title = 'Frontier App'`)
    await page.send('Emulation.setFocusEmulationEnabled', { enabled: true })
    const copied = await ev(`navigator.clipboard.writeText('copied by 15.5').then(() => 'ok', (e) => 'error:' + e.name)`)
    check("A: the async clipboard API is refused (this Electron asks for the clipboard's READ permission even to write, and the window gives it to nobody); the app's Copy button uses the old way, which needs none: it is checked on the real button in 15.6's suite", copied !== 'ok', copied)
    await page.send('Runtime.evaluate', { expression: `(() => { const a = document.createElement('textarea'); a.value = 'copied the old way by 15.5'; document.body.appendChild(a); a.select(); const ok = document.execCommand('copy'); a.remove(); window.__copied = ok; return ok })()`, userGesture: true, returnByValue: true })
    // (this Electron's clipboard.readText() answers a Promise: settle it in main, read the result in a second call)
    await main.inMain(`(async () => { globalThis.__clipText = await process.mainModule.require('electron').clipboard.readText(); return true })()`)
    await sleep(300)
    const text = await main.inMain('globalThis.__clipText')
    check('A: the old way (a copy from a box that is not shown, in the same click) writes the clipboard with no permission', text === 'copied the old way by 15.5', show(text))
    const read = await ev(`navigator.clipboard.readText().then(() => 'allowed', (e) => 'error:' + e.name)`)
    check('A: reading the clipboard is refused', read !== 'allowed', read)
    const geo = await ev(`new Promise((resolve) => navigator.geolocation.getCurrentPosition(() => resolve('allowed'), (e) => resolve('error:' + e.code), { timeout: 3000 }))`)
    check('A: the location is refused', geo !== 'allowed', geo)
    const note = await ev(`Notification.requestPermission().then((p) => p)`)
    check('A: notifications are refused', note !== 'granted', note)
  })

  // ============ B. switching on ============
  await part('B', async () => {
    await fetch(`${mockUrl}/__expect-key`, { method: 'POST', body: JSON.stringify({ key: KEY, provider: 'openai' }) })
    const blocked = await ev(`window.api.voice.status()`)
    check('B: without an OpenAI key the status says so', /OpenAI key/.test(blocked.listenBlocked ?? ''), show(blocked.listenBlocked))
    const refused = await ev(`window.api.voice.setListen(true)`)
    check('B: and switching on is refused before any question', refused.ok === false && /OpenAI key/.test(refused.error) && (await Q.count()) === 0, show(refused))
    const saved = await ev(`window.api.settings.setApiKey('openai', ${JSON.stringify(KEY)})`)
    check('B: (setup) an OpenAI key is saved through the bridge', saved.ok === true, show(saved))
    await Q.queue('no')
    const no = await ev(`window.api.voice.setListen(true)`)
    check('B: a no in the system\'s box leaves it off', no.ok === false && (await ev(`window.api.voice.status()`)).listen === false && !existsSync(join(userData, 'voice.json')), show(no))
    await sleep(3300)
    await Q.queue('yes')
    const yes = await ev(`window.api.voice.setListen(true)`)
    const asked = await Q.asked()
    const q = asked.at(-1)?.options ?? {}
    const words = [q.title, q.message, q.detail].join('\n')
    check('B: a yes switches it on', yes.ok === true && yes.status.listen === true, show(yes))
    check('B: the question was asked for this window, in the system\'s box, with the buttons "Turn on" and "Don\'t turn on"', asked.at(-1)?.withWindow === true && q.buttons?.[0] === 'Turn on' && /Don't turn on/.test(String(q.buttons?.[1])), show([asked.at(-1)?.withWindow, q.buttons]))
    check('B: and it says what is sent, to whom, even with Claude, that nothing is kept, the cost, the indicator', /recording/.test(words) && /OpenAI/.test(words) && /even when you chat with Claude/.test(words) && /keeps no recording/.test(words) && /\$0\.0045 a minute/.test(words) && /RECORDING/.test(words) && /red dot/.test(words), words.slice(0, 200))
    check('B: voice.json says listen true and nothing about a key or a clip', (() => { const t = readFileSync(join(userData, 'voice.json'), 'utf8'); return JSON.parse(t).listen === true && !t.includes(KEY) })())
  })

  // ============ C. a hold ============
  await part('C', async () => {
    await control({})
    const begin = await ev(`window.api.voice.begin()`)
    check('C: begin opens the microphone for at most a minute', begin.ok === true && begin.maxMs === 60000, show(begin))
    check('C: the window title says RECORDING (main set it)', /RECORDING/.test(await titleOf()), await titleOf())
    await ev(`document.title = 'Frontier App'`)
    await sleep(300)
    check('C: and the page cannot take it down by setting its own title', /RECORDING/.test(await titleOf()), await titleOf())
    const a = await open({ audio: true })
    check('C: the microphone opens for the audio only: the fake microphone', a.ok === true && a.tracks.length === 1 && /^audio:/.test(a.tracks[0]), show(a))
    const v = await open({ video: true })
    const av = await open({ audio: true, video: true })
    check('C: the camera stays refused during the hold, and so does audio with video', v.ok === false && av.ok === false, show([v, av]))
    const display = await ev(`(async () => { try { const s = await navigator.mediaDevices.getDisplayMedia({ video: true }); s.getTracks().forEach((t) => t.stop()); return 'allowed' } catch (e) { return e.name } })()`)
    check('C: and the screen', display !== 'allowed', display)
    const second = await ev(`window.api.voice.begin()`)
    check('C: a second begin during the hold is refused as busy', second.ok === false && /in use already/.test(second.error), show(second))
    const clip = await record(1500)
    check('C: a clip is recorded from the fake microphone (WebM, opus at 32 kbit/s: a few KB, not 24)', clip.head.join() === '26,69,223,163' && clip.size > 2000 && clip.size < 20_000 && Math.abs(clip.ms - 1500) < 500, show(clip))
    const ended = await ev(`window.api.voice.end(window.__clip, ${clip.ms})`)
    check('C: end sends it and the words come back', ended.ok === true && ended.text === 'hello from the mock' && ended.seconds >= 2, show(ended))
    check('C: the title is back to normal', (await sleepUntil(async () => (await titleOf()) === 'Frontier App')), await titleOf())
    const after = await open({ audio: true })
    check('C: the gate is shut again: the microphone is refused', after.ok === false && after.name === 'NotAllowedError', show(after))
    const seen = await mockRequests()
    check('C: exactly one request reached the endpoint: three fields, gpt-transcribe, the clip unchanged, the saved OpenAI key', seen.length === 1 && [...seen[0].fields].sort().join() === 'file,model,response_format' && seen[0].model === 'gpt-transcribe' && seen[0].fileSha === clip.sha && seen[0].headers.authorization === `Bearer ${KEY}` && seen[0].problems.length === 0, show(seen[0]))
    const ledger = readFileSync(join(userData, 'usage', 'ledger.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
    const last = ledger.at(-1)
    check('C: the ledger has the clip: OpenAI, gpt-transcribe, done, no tokens, an audio fee', last.provider === 'openai' && last.model === 'gpt-transcribe' && last.state === 'done' && last.audio?.kind === 'transcribe' && last.tokens.input === 0 && last.costUsd > 0, show(last))
    const summary = await ev(`window.api.usage.summary(null)`)
    check('C: and the sums of Settings include it', summary.today.requests >= 1 && summary.today.costUsd > 0 && summary.today.costUsd < 0.01, show(summary.today))
  })

  // ============ D. other endings ============
  await part('D', async () => {
    const noHold = await ev(`window.api.voice.end(window.__clip ?? new Uint8Array(100), 2000)`)
    check('D: a clip with no hold open is refused and nothing is sent', noHold.ok === false && noHold.kind === 'refused' && (await mockRequests()).length === 1, show(noHold))
    const b = await ev(`window.api.voice.begin()`)
    const open1 = await open({ audio: true })
    await ev(`window.api.voice.cancel()`)
    const afterCancel = await open({ audio: true })
    check('D: cancel shuts the gate at once (the microphone is refused) and the title is back; nothing was sent', b.ok && open1.ok && afterCancel.ok === false && (await sleepUntil(async () => (await titleOf()) === 'Frontier App')) && (await mockRequests()).length === 1, show([afterCancel, await titleOf()]))
    await sleep(100)
    await ev(`window.api.voice.begin()`)
    const tap = await ev(`window.api.voice.end(window.__clip, 120)`)
    check('D: a tap is "too short": nothing sent, the gate shut', tap.ok === false && tap.kind === 'short' && (await mockRequests()).length === 1 && (await open({ audio: true })).ok === false, show(tap))
    await ev(`window.api.voice.begin()`)
    const junk = await ev(`window.api.voice.end(new Uint8Array(500), 2000)`)
    check('D: bytes that are not a WebM clip are refused', junk.ok === false && junk.kind === 'refused' && (await mockRequests()).length === 1, show(junk))
    await ev(`window.api.voice.begin()`)
    const odd = await ev(`window.api.voice.end(window.__clip, 2000).then(() => 'x').catch((e) => 'x')`)
    const stranger = await ev(`window.api.voice.end('a string', 2000)`)
    check('D: the wrong kind of thing for a clip is refused (and does not crash main)', stranger.ok === false, show([odd, stranger]))
    await ev(`window.api.voice.cancel()`)
    // the provider answers an error
    await control({ mode: '401' })
    await ev(`window.api.voice.begin()`)
    const clip = await record(1000)
    const failed = await ev(`window.api.voice.end(window.__clip, ${clip.ms})`)
    check('D: the provider refusing the key: a sentence, the gate shut, nothing owed', failed.ok === false && failed.kind === 'failed' && /key was not accepted/.test(failed.error) && !(await open({ audio: true })).ok, show(failed))
    await control({})
    // switching off
    await ev(`window.api.voice.begin()`)
    const before = await Q.count()
    const off = await ev(`window.api.voice.setListen(false)`)
    check('D: switching off is at once, asks nothing, and shuts the gate of a hold in progress', off.ok === true && off.status.listen === false && (await Q.count()) === before && !(await open({ audio: true })).ok && (await sleepUntil(async () => (await titleOf()) === 'Frontier App')), show(off))
    const begun = await ev(`window.api.voice.begin()`)
    check('D: with it off, begin is refused', begun.ok === false && /off/i.test(begun.error), show(begun))
    // read aloud and the voice keep their own place
    const sp = await ev(`window.api.voice.setSpeak(true)`)
    const sv = await ev(`window.api.voice.setVoice('Microsoft Zira - English (United States)', 120)`)
    check('D: read aloud and the voice are kept with no question', sp.ok && sv.ok && sv.status.speak === true && sv.status.voice === 'Microsoft Zira - English (United States)' && sv.status.rate === 120 && (await Q.count()) === before, show(sv))
    const bad = await ev(`window.api.voice.setVoice('x'.repeat(200), 100)`)
    check('D: a bad voice name is refused', bad.ok === false, show(bad))
  })

  // ============ E. what is kept ============
  await part('E', async () => {
    const stat = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? stat(join(dir, e.name)) : [join(dir, e.name)]))
    const files = stat(userData).filter((f) => !/[\\/](Cache|Code Cache|GPUCache|DawnGraphiteCache|DawnWebGPUCache|Local Storage|Session Storage|Network|Shared Dictionary|blob_storage|Crashpad|IndexedDB|Service Worker|WebStorage)[\\/]/.test(f))
    const magic = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01])
    const hits = files.filter((f) => { try { if (statSync(f).size > 50_000_000) return false; const b = readFileSync(f); return b.includes(magic) || b.includes(Buffer.from('hello from the mock')) } catch { return false } })
    check(`E: of the ${files.length} files in the app's data folder (not Chromium's caches), none holds a WebM header or the words that came back`, hits.length === 0, hits.join())
    check('E: the data folder has no folder or file for recordings', !files.some((f) => /record|audio|voice[\\/]|clip|\.webm$/i.test(f.replace(userData, '')) && !/voice\.json$/.test(f)), files.filter((f) => /record|audio|clip|\.webm$/i.test(f.replace(userData, ''))).join())
  })

  check('F: the page logged no errors and no warnings in the whole run', page.problems.length === 0, show(page.problems))
} catch (error) {
  check(`the suite stopped before its end: ${String(error?.stack ?? error).slice(0, 600)}`, false)
}
main.close()
const ok = check.summary()
process.exit(ok ? 0 : 1)
