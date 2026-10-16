// Slice 15.2 under plain Node (no window): the rules of voice (D-047). The shared constants and checks (the settings, a voice's name, the rate, the price of a clip),
// voice.json (kept like tools.json: both switches OFF unless the file says exactly otherwise), what main takes as a recording (a WebM clip of a sensible size from a
// hold of a sensible length, charged for the longer of what the page says and what the size allows), what is put in the message box (the words, cleaned), the gate
// for the microphone (one hold at a time, closes by itself, a rest after a burst), what is said when a reply is read aloud (the Markdown tree made into sentences,
// cut into pieces), and source checks on what may import what.
// Run: node tools/guarded.mjs tools/verify-15-2.mjs
import './ts-resolve.mjs'
import { checker } from './cdp.mjs'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { REPO, REPO_URL } from './paths.mjs'
import { makeBox } from './lib8b3.mjs'

const check = checker()
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(',')) : null
const guard = async (name, fn) => { if (ONLY && !ONLY.has(name)) return; try { await fn() } catch (error) { check(`${name} did not run to its end: ${String(error?.stack ?? error).slice(0, 300)}`, false) } }
const show = (v) => JSON.stringify(v)?.slice(0, 300)
const SRC = `${REPO_URL}/src`
const V = await import(`${SRC}/shared/voice.ts`)
const settingsMod = await import(`${SRC}/main/voiceSettings.ts`)
const clipMod = await import(`${SRC}/main/voiceClip.ts`)
const gateMod = await import(`${SRC}/main/voiceGate.ts`)
const speechMod = await import(`${SRC}/renderer/src/voice/speechText.ts`)
const source = (rel) => readFileSync(join(REPO, rel), 'utf8')
const rejects = async (promise) => { try { await promise; return null } catch (error) { return error } }
const cp = (n) => String.fromCodePoint(n)

// ============ A. the shared part ============
await guard('A', async () => {
  check('A: the limits are the plan\'s: 60 s, a third of a second, 1 MiB, 20,000 characters, pieces of 600', V.VOICE_LIMITS.maxClipSeconds === 60 && V.VOICE_LIMITS.minClipMs === 300 && V.VOICE_LIMITS.maxClipBytes === 1_048_576 && V.VOICE_LIMITS.maxTranscriptChars === 20_000 && V.VOICE_LIMITS.readPieceChars === 600 && V.VOICE_LIMITS.readMaxChars === 20_000, show(V.VOICE_LIMITS))
  check('A: the limits are frozen (nothing can raise them at run time)', Object.isFrozen(V.VOICE_LIMITS) && Object.isFrozen(V.VOICE_CHANNELS) && Object.isFrozen(V.VOICE_WORDS) && Object.isFrozen(V.DEFAULT_VOICE_SETTINGS))
  check('A: the model is gpt-transcribe at $0.0045 a minute', V.TRANSCRIBE_MODEL === 'gpt-transcribe' && V.TRANSCRIBE_USD_PER_MINUTE === 0.0045)
  const near = (a, b) => Math.abs(a - b) < 1e-12
  check('A: a clip is charged by the second, rounded UP, at least one second', near(V.transcribeFee(1), 0.000075) && near(V.transcribeFee(0.2), 0.000075) && near(V.transcribeFee(0), 0.000075) && near(V.transcribeFee(59.1), 0.0045) && near(V.transcribeFee(60), 0.0045) && near(V.transcribeFee(30), 0.00225), show([V.transcribeFee(1), V.transcribeFee(0.2), V.transcribeFee(59.1), V.transcribeFee(60)]))
  check('A: the defaults are both OFF, the system\'s own voice, normal speed', show(V.DEFAULT_VOICE_SETTINGS) === '{"listen":false,"speak":false,"voice":null,"rate":100}')
  const good = ['Microsoft David - English (United States)', 'Zira', 'Microsoft Ravi - English (India)', 'Voz de Sabina (es-MX)', '日本語の声', 'x'.repeat(120)]
  check('A: a voice\'s name is accepted when it is visible text', good.every(V.isVoiceName))
  const hostile = ['', 'x'.repeat(121), ' Zira', 'Zira ', 'Zi\nra', 'Zi\tra', 'Zi\u0000ra', 'Zira' + cp(0x202e), cp(0x200b) + 'Zira', 'Zi' + cp(0x2028) + 'ra', cp(0xfeff) + 'Zira', 'Zi' + cp(0x85) + 'ra', 'Zi' + cp(0x2066) + 'ra', 7, null, undefined, {}, ['Zira']]
  check('A: refused: empty, too long, spaces at the ends, a line break, a tab, a null, reversing and hiding characters, other kinds', hostile.every((v) => !V.isVoiceName(v)), show(hostile.filter(V.isVoiceName)))
  check('A: the speed is a whole number from 50 to 200', [50, 100, 200, 75].every(V.isRate) && [49, 201, 0, -100, 100.5, NaN, Infinity, '100', null, undefined].every((v) => !V.isRate(v)))
  check('A: the channels are voice:* names and the bridge will need no others', Object.values(V.VOICE_CHANNELS).every((n) => /^voice:[a-z-]+$/.test(n)) && Object.keys(V.VOICE_CHANNELS).sort().join() === 'begin,cancel,end,setListen,setSpeak,setVoice,status', Object.keys(V.VOICE_CHANNELS).join())
})

// ============ B. voice.json ============
const tempRoot = mkdtempSync(join(tmpdir(), 'frontier-152-'))
let dirs = 0
const tempDir = () => { const d = join(tempRoot, `d${++dirs}`); mkdirSync(d, { recursive: true }); return d }
await guard('B', async () => {
  const { parseVoiceSettings, voiceSettingsText, createVoiceSettings } = settingsMod
  const on = { listen: true, speak: true, voice: 'Microsoft Zira - English (United States)', rate: 120 }
  const text = voiceSettingsText(on)
  check('B: the settings are one small document: version 1, the two switches, the voice, the speed', text === '{"version":1,"listen":true,"speak":true,"voice":"Microsoft Zira - English (United States)","rate":120}', text)
  check('B: it reads back as itself, frozen', show(parseVoiceSettings(text)) === show(on) && Object.isFrozen(parseVoiceSettings(text)))
  check('B: the system\'s own voice (null) is allowed', parseVoiceSettings(voiceSettingsText({ ...on, voice: null }))?.voice === null)
  const base = JSON.parse(text)
  const cases = [
    ['a field more', { extra: 1 }], ['version 2', { version: 2 }], ['no version', { version: undefined }], ['no listen', { listen: undefined }], ['no voice', { voice: undefined }],
    ['listen as "true"', { listen: 'true' }], ['listen as 1', { listen: 1 }], ['listen as null', { listen: null }], ['speak as 1', { speak: 1 }], ['speak as "yes"', { speak: 'yes' }],
    ['a voice with a line break', { voice: 'Zi\nra' }], ['an empty voice', { voice: '' }], ['a voice of 121 characters', { voice: 'x'.repeat(121) }], ['a voice as a number', { voice: 7 }],
    ['a rate of 49', { rate: 49 }], ['a rate of 201', { rate: 201 }], ['a rate of 100.5', { rate: 100.5 }], ['a rate as text', { rate: '100' }], ['a rate as null', { rate: null }]
  ]
  const refused = []
  for (const [what, patch] of cases) {
    const o = { ...base, ...patch }
    for (const k of Object.keys(o)) if (o[k] === undefined) delete o[k]
    if (parseVoiceSettings(JSON.stringify(o)) !== null) refused.push(what)
  }
  check('B: refused: a field more or less, another version, a switch that is not exactly a boolean, a bad voice, a speed out of range', refused.length === 0, refused.join('; '))
  check('B: refused: not JSON, a list, null, a number, an empty text', ['garbage', '[]', 'null', '7', '', '{'].every((t) => parseVoiceSettings(t) === null))
  check('B: refused: a key called __proto__ (an own key of the parsed text)', parseVoiceSettings('{"version":1,"listen":true,"speak":true,"voice":null,"rate":100,"__proto__":{"listen":true}}') === null)
  check('B: the bounds are the ones Settings will offer (50 and 200), at both ends', [50, 200].every((rate) => parseVoiceSettings(voiceSettingsText({ ...on, rate })) !== null))

  const dir = tempDir()
  const file = join(dir, 'voice.json')
  const mode = { form: 'plain' }
  const store = createVoiceSettings({ pathOf: () => file, writeMode: async () => ({ ...mode }) })
  let now = await store.read()
  check('B: with no file both switches are off and there is no problem', now.problem === null && show(now.settings) === show(V.DEFAULT_VOICE_SETTINGS))
  await store.write(on)
  now = await store.read()
  check('B: what is written is read back, and it is the plain text', now.problem === null && now.settings.listen === true && readFileSync(file, 'utf8') === text)
  writeFileSync(file, '{"version":1,"listen":true,"speak":true,"voice":null,"rate":100,"x":1}')
  now = await store.read()
  check('B: a file that is not exactly what this app writes: both OFF, the defaults, and the reason in words', now.settings.listen === false && now.settings.speak === false && /not a file this app wrote/.test(now.problem ?? ''), show(now))
  writeFileSync(file, 'garbage')
  now = await store.read()
  check('B: garbage: the same', now.settings.listen === false && now.problem !== null)
  const refusing = await rejects(store.write(on))
  check('B: a damaged file is not written over by itself', refusing !== null && readFileSync(file, 'utf8') === 'garbage', String(refusing))
  await store.write(on, { replace: true })
  check('B: ...only when the person starts again, and a copy is kept first', readdirSync(dir).some((n) => n.startsWith('voice.json.damaged-')) && (await store.read()).settings.listen === true)
  const box = makeBox()
  const sealedPath = join(tempDir(), 'voice.json')
  const sealed = createVoiceSettings({ pathOf: () => sealedPath, box, writeMode: async () => ({ form: 'encrypted' }) })
  await sealed.write(on)
  const sealedFile = readFileSync(sealedPath, 'utf8')
  check('B: sealed like the chats when encryption is on: an envelope, nothing readable', sealedFile.startsWith('{"format":"frontier-chat-encrypted"') && !sealedFile.includes('Zira') && (await sealed.read()).settings.listen === true)
  box.lose()
  const lost = await sealed.read()
  check('B: with the key lost: both off, with the reason', lost.settings.listen === false && /could not be opened/.test(lost.problem ?? ''), show(lost))
  const unreadable = createVoiceSettings({ pathOf: () => { throw new Error('no folder') }, writeMode: async () => ({ form: 'plain' }) })
  const nothing = await unreadable.read()
  check('B: a fault of the disk: read() does not throw, both are off', nothing.settings.listen === false && nothing.problem !== null)
})

// ============ C. a recording, and its words ============
/** A WebM header as the window's recorder writes it (EBML, version, the doc type "webm"), then `rest` bytes of "audio". */
function webm(rest = 2000, { doctype = 'webm', head = [0x1a, 0x45, 0xdf, 0xa3] } = {}) {
  const dt = [...doctype].map((c) => c.charCodeAt(0))
  const header = [...head, 0x9f, 0x42, 0x86, 0x81, 0x01, 0x42, 0xf7, 0x81, 0x01, 0x42, 0xf2, 0x81, 0x04, 0x42, 0xf3, 0x81, 0x08, 0x42, 0x82, 0x80 + dt.length, ...dt, 0x42, 0x87, 0x81, 0x04, 0x42, 0x85, 0x81, 0x02]
  const bytes = new Uint8Array(header.length + rest)
  bytes.set(header)
  for (let i = header.length; i < bytes.length; i++) bytes[i] = (i * 31) & 0xff
  return bytes
}
await guard('C', async () => {
  const { checkClip, looksLikeWebm, cleanTranscript, MAX_BYTES_PER_SECOND } = clipMod
  const ok = checkClip({ bytes: webm(), ms: 2500 })
  check('C: a WebM clip from a hold of 2.5 s is taken, as a Buffer of its own', ok.ok === true && Buffer.isBuffer(ok.clip) && ok.clip.length === webm().length, show(ok.ok))
  check('C: and charged for the 3 seconds that were said (rounded up)', ok.seconds === 3, String(ok.seconds))
  const mine = webm()
  const copy = checkClip({ bytes: mine, ms: 2000 })
  mine[0] = 0
  mine[10] = 99
  check('C: the clip is a copy: what the page still holds cannot change it', copy.ok === true && copy.clip[0] === 0x1a && copy.clip[10] !== 99)
  check('C: a Buffer and an ArrayBuffer are taken too', checkClip({ bytes: Buffer.from(webm()), ms: 2000 }).ok === true && checkClip({ bytes: webm().buffer, ms: 2000 }).ok === true)
  check('C: a hold of 299 ms is "short" (nothing is sent) and 300 ms is taken', checkClip({ bytes: webm(), ms: 299 }).kind === 'short' && checkClip({ bytes: webm(), ms: 300 }).ok === true && checkClip({ bytes: webm(), ms: 0 }).kind === 'short')
  check('C: the longest hold: 60 s plus the 5 s grace is taken, 65.001 s is refused', checkClip({ bytes: webm(), ms: 65_000 }).ok === true && checkClip({ bytes: webm(), ms: 65_001 }).kind === 'refused')
  check('C: a duration that is not a whole number in range is refused', [-1, 1.5, NaN, Infinity, '2000', null, undefined, {}, [2000], true].every((ms) => checkClip({ bytes: webm(), ms }).kind === 'refused'), show([-1, 1.5, '2000'].map((ms) => checkClip({ bytes: webm(), ms }).kind)))
  check('C: the charge is never more than 60 seconds', checkClip({ bytes: webm(), ms: 65_000 }).seconds === 60)
  const big = webm(MAX_BYTES_PER_SECOND * 40)
  const lied = checkClip({ bytes: big, ms: 1000 })
  check('C: a page that says 1 second for a clip of 40 seconds of data is charged for the size (a lie cannot make it cheap)', lied.ok === true && lied.seconds >= 40, String(lied.seconds))
  check('C: the other way round, a short clip with a long hold is charged for the hold', checkClip({ bytes: webm(100), ms: 9000 }).seconds === 9)
  check('C: at the size limit: 1 MiB is taken (charged 60), one byte more is refused', checkClip({ bytes: webm(V.VOICE_LIMITS.maxClipBytes - webm(0).length), ms: 5000 }).seconds === 60 && checkClip({ bytes: webm(V.VOICE_LIMITS.maxClipBytes - webm(0).length + 1), ms: 5000 }).kind === 'refused')
  check('C: an empty clip, a text, a list of numbers, null and a number are refused', [new Uint8Array(0), 'RIFF', [26, 69, 223, 163], null, 7, undefined, {}].every((bytes) => checkClip({ bytes, ms: 2000 }).kind === 'refused'))
  check('C: a clip that is not WebM is refused: a WAV, an MP3, an Ogg, a PNG, a clip with the wrong first byte', [Buffer.from('RIFF....WAVEfmt '.padEnd(200, 'x')), Buffer.from('ID3'.padEnd(200, 'x')), Buffer.from('OggS'.padEnd(200, 'x')), Buffer.from([0x89, 0x50, 0x4e, 0x47].concat(new Array(200).fill(0))), webm(2000, { head: [0x1b, 0x45, 0xdf, 0xa3] })].every((bytes) => checkClip({ bytes, ms: 2000 }).kind === 'refused'))
  check('C: a Matroska file (doc type "matroska") is refused: only "webm"', checkClip({ bytes: webm(2000, { doctype: 'matroska' }), ms: 2000 }).kind === 'refused' && looksLikeWebm(webm()) === true)
  check('C: the doc type must be near the start: "webm" at byte 70 does not count', (() => { const b = new Uint8Array(300); b.set([0x1a, 0x45, 0xdf, 0xa3]); b.set([0x77, 0x65, 0x62, 0x6d], 70); return looksLikeWebm(b) === false })())
  check('C: a clip of 15 bytes is too small to be WebM', looksLikeWebm(webm(0).subarray(0, 15)) === false)
  check('C: the request is exactly { bytes, ms }: a field more or less is refused', ['extra', 'missing', 'array', 'null'].every((what) => checkClip(what === 'extra' ? { bytes: webm(), ms: 2000, model: 'whisper-1' } : what === 'missing' ? { bytes: webm() } : what === 'array' ? [webm(), 2000] : null).kind === 'refused'))
  check('C: a field named __proto__ or constructor does not get through', checkClip(JSON.parse('{"bytes":null,"ms":2000,"__proto__":{"bytes":1}}')).kind === 'refused')

  // the words
  check('C: ordinary words stay as they are', cleanTranscript('Hello, how are you today?') === 'Hello, how are you today?')
  check('C: nothing is nothing: empty, white space only, non-text', [cleanTranscript(''), cleanTranscript('  \n\t '), cleanTranscript(null), cleanTranscript(7), cleanTranscript({}), cleanTranscript(undefined)].every((v) => v === null))
  check('C: control characters go; a line break stays; a tab becomes a space', cleanTranscript('a\u0000b\u0007c\u001bd\u007fe\u0085f\tg\nh') === 'abcdef g\nh', show(cleanTranscript('a\u0000b\u0007c\u001bd\u007fe\u0085f\tg\nh')))
  check('C: the characters that hide or reverse text go (zero-width, left-to-right and right-to-left marks, embeddings, isolates, the byte-order mark, tag characters)', cleanTranscript(`a${cp(0x200b)}b${cp(0x200e)}c${cp(0x202e)}d${cp(0x2066)}e${cp(0xfeff)}f${cp(0xe0041)}g`) === 'abcdefg', show(cleanTranscript(`a${cp(0x200b)}b${cp(0x202e)}c`)))
  check('C: runs of spaces and of blank lines are shortened', cleanTranscript('a    b\n\n\n\n\nc') === 'a b\n\nc')
  check('C: a Windows line end is one line break', cleanTranscript('a\r\nb\rc') === 'a\nb\nc')
  const long = cleanTranscript('word '.repeat(10_000))
  check('C: at most 20,000 characters', long.length <= 20_000 && long.length > 19_000, String(long.length))
  const emoji = cleanTranscript('a'.repeat(19_999) + cp(0x1f600) + 'zzz')
  check('C: and never half of a pair of surrogates at the cut', emoji.length === 19_999 && !/[\ud800-\udbff]$/.test(emoji), String(emoji.length))
  check('C: text that is only hiding characters is nothing', cleanTranscript(cp(0x200b) + cp(0xfeff) + cp(0x202e)) === null)
})

// ============ D. the gate ============
function clock() {
  let t = 1_000_000
  const timers = []
  return {
    now: () => t,
    advance: (ms) => { t += ms; for (const timer of [...timers]) if (!timer.done && !timer.cleared && timer.at <= t) { timer.done = true; timer.fn() } },
    timers: { set: (fn, ms) => { const timer = { fn, at: t + ms, done: false, cleared: false }; timers.push(timer); return timer }, clear: (h) => { h.cleared = true } },
    pending: () => timers.filter((x) => !x.done && !x.cleared).length
  }
}
await guard('D', async () => {
  const c = clock()
  const gate = gateMod.createVoiceGate({ now: c.now, timers: c.timers })
  const told = []
  gate.onChange((armed) => told.push(armed))
  check('D: a new gate is closed, and the microphone may not be opened', gate.isArmed() === false && gate.mayOpenMicrophone() === false)
  const a = gate.arm()
  check('D: arming opens it for at most 60 s and tells the indicator', a.ok === true && a.maxMs === 60_000 && gate.isArmed() && gate.mayOpenMicrophone() && told.join() === 'true', show(a))
  check('D: a second arm while it is open is refused as busy (never queued)', show(gate.arm()) === '{"ok":false,"why":"busy"}' && told.join() === 'true')
  c.advance(64_999)
  check('D: it is still open 64.999 s later (60 s and the grace)', gate.isArmed())
  c.advance(2)
  check('D: and shut by itself after that, and the indicator is told', !gate.isArmed() && !gate.mayOpenMicrophone() && told.join() === 'true,false', told.join())
  check('D: its timer is gone (nothing left running)', c.pending() === 0)
  const b = gate.arm()
  check('D: it can be armed again', b.ok === true && gate.isArmed())
  check('D: closing says it was open, and closes at once', gate.close() === true && !gate.isArmed() && told.join() === 'true,false,true,false' && c.pending() === 0)
  check('D: closing a closed gate does nothing and says so (a clip handed in twice is one clip)', gate.close() === false && told.length === 4)
  gate.arm()
  c.advance(10_000)
  gate.close()
  gate.arm()
  c.advance(64_000)
  check('D: a timer from an earlier hold does not shut a later one', gate.isArmed(), 'the second hold was shut by the first one\'s timer')
  gate.close()

  // a burst: more than 8 holds in 30 seconds
  const c2 = clock()
  const g2 = gateMod.createVoiceGate({ now: c2.now, timers: c2.timers })
  let arms = 0
  for (let i = 0; i < 8; i++) { const r = g2.arm(); if (r.ok) arms++; g2.close(); c2.advance(500) }
  check('D: eight holds in a few seconds are all allowed', arms === 8)
  const ninth = g2.arm()
  check('D: the ninth is refused as resting', show(ninth) === '{"ok":false,"why":"resting"}' && !g2.isArmed(), show(ninth))
  c2.advance(29_000)
  check('D: it rests for 30 seconds', show(g2.arm()) === '{"ok":false,"why":"resting"}')
  c2.advance(2000)
  const after = g2.arm()
  check('D: and then allows a hold again', after.ok === true)
  g2.close()

  // slow use is never rested
  const c3 = clock()
  const g3 = gateMod.createVoiceGate({ now: c3.now, timers: c3.timers })
  let allowed = 0
  for (let i = 0; i < 40; i++) { if (g3.arm().ok) allowed++; g3.close(); c3.advance(10_000) }
  check('D: a person who holds the button every 10 seconds for a long time is never rested', allowed === 40, String(allowed))

  // an indicator that throws must not keep the gate open
  const c4 = clock()
  const g4 = gateMod.createVoiceGate({ now: c4.now, timers: c4.timers })
  const silence = console.error
  const logged = []
  console.error = (...args) => logged.push(args.join(' '))
  g4.onChange(() => { throw new Error('the indicator broke') })
  g4.arm()
  const closed = g4.close()
  console.error = silence
  check('D: a listener that throws is logged and the gate still opens and closes', closed === true && !g4.isArmed() && logged.length === 2, show(logged))
  const stop = g4.onChange(() => {})
  stop()
  check('D: a listener can be removed', typeof stop === 'function')
})

// ============ E. what is said ============
await guard('E', async () => {
  const { speechOf, readingOf } = speechMod
  const say = (md) => speechOf(md)
  check('E: plain sentences stay as they are', say('Hello there. How are you?') === 'Hello there. How are you?', say('Hello there. How are you?'))
  check('E: bold, italic and strikethrough are said as their words', say('This is **very** *important* and ~~not~~ true.') === 'This is very important and not true.', say('This is **very** *important* and ~~not~~ true.'))
  check('E: a heading is said as a sentence of its own', say('# Title\n\nBody text.') === 'Title.\n\nBody text.', say('# Title\n\nBody text.'))
  check('E: a code block is said as "Code block." and none of its text is read', say('Run this:\n\n```js\nconsole.log("secret");\n```\n\nDone.') === 'Run this:\n\nCode block.\n\nDone.', say('Run this:\n\n```js\nconsole.log("secret");\n```\n\nDone.'))
  check('E: short code in a sentence is read, a long span is not', say('Use `npm test` now.') === 'Use npm test now.' && say('See `' + 'x'.repeat(60) + '` here.') === 'See code here.', say('See `' + 'x'.repeat(60) + '` here.'))
  check('E: a link is said as its words', say('Read [the guide](https://example.com/guide) first.') === 'Read the guide first.', say('Read [the guide](https://example.com/guide) first.'))
  check('E: a link whose words are its address is said as the site', say('See [https://www.example.com/a/b?c=d](https://www.example.com/a/b?c=d).') === 'See link to example.com.', say('See [https://www.example.com/a/b?c=d](https://www.example.com/a/b?c=d).'))
  check('E: a bare address in a sentence is said as "link to" the site', say('Go to https://docs.example.org/very/long/path?x=1#frag, then stop.') === 'Go to link to docs.example.org, then stop.', say('Go to https://docs.example.org/very/long/path?x=1#frag, then stop.'))
  check('E: a list: bullets are not said; a numbered list says its numbers', say('- one\n- two\n- three') === 'one.\n\ntwo.\n\nthree.' || say('- one\n- two\n- three') === 'one. two. three.' || /^one\.\s+two\.\s+three\.$/.test(say('- one\n- two\n- three')), show(say('- one\n- two\n- three')))
  check('E: a numbered list keeps its numbers', /^1\. First\.\s+2\. Second\.$/.test(say('1. First\n2. Second')), show(say('1. First\n2. Second')))
  check('E: a table is one sentence about its size, none of its cells', say('| a | b |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |') === 'Table with 2 columns and 2 rows, not read aloud.', say('| a | b |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |'))
  check('E: a rule and a quote: a rule is silent, a quote is read', say('Before.\n\n---\n\nAfter.') === 'Before.\n\nAfter.' && say('> quoted words') === 'quoted words', show([say('Before.\n\n---\n\nAfter.'), say('> quoted words')]))
  check('E: raw HTML and images are read as the text they were (the reader never makes HTML of them)', say('<script>alert(1)</script> ![pic](https://example.com/x.png)').includes('script') && !say('![pic](https://example.com/x.png)').includes('<img'), say('<b>hi</b>'))
  check('E: an empty reply is nothing', say('') === '' && say('   \n\n  ') === '' && say('```\n\n```') === 'Code block.')

  const r1 = readingOf('One short sentence. Another one.')
  check('E: a short text is one piece', r1.pieces.length === 1 && r1.pieces[0] === 'One short sentence. Another one.' && r1.truncated === false, show(r1))
  const para = (n) => Array.from({ length: n }, (_, i) => `This is sentence number ${i + 1}.`).join(' ')
  const r2 = readingOf(para(60))
  check('E: a long paragraph is cut at the end of a sentence into pieces of at most 600 characters', r2.pieces.length > 2 && r2.pieces.every((p) => p.length <= 600) && r2.pieces.every((p) => /\.$/.test(p)) && r2.pieces.join(' ') === para(60), show(r2.pieces.map((p) => p.length)))
  const r3 = readingOf('word '.repeat(500))
  check('E: a sentence with no full stop is cut at a space, and no word is cut', r3.pieces.every((p) => p.length <= 600 && p.split(' ').every((w) => w === 'word')) && r3.pieces.join(' ').split(' ').length === 500, show(r3.pieces.map((p) => p.length)))
  const r4 = readingOf('x'.repeat(2500))
  check('E: one word longer than a piece is cut hard, in pieces of 600', r4.pieces.length === 5 && r4.pieces.every((p) => p.length <= 600) && r4.pieces.join('') === 'x'.repeat(2500), show(r4.pieces.map((p) => p.length)))
  const paragraphs = Array.from({ length: 5 }, (_, i) => `Paragraph ${i + 1} is short.`).join('\n\n')
  const r5 = readingOf(paragraphs)
  check('E: paragraphs are kept apart (a piece never joins two)', r5.pieces.length === 5 && r5.pieces[2] === 'Paragraph 3 is short.', show(r5.pieces))
  const huge = Array.from({ length: 2000 }, (_, i) => `Paragraph number ${i} has some words in it.`).join('\n\n')
  const r6 = readingOf(huge)
  check('E: a reply of more than 20,000 characters is read up to there and says it was cut', r6.truncated === true && r6.pieces.join('').length <= 20_000 && r6.pieces.join('').length > 19_000, show([r6.pieces.length, r6.pieces.join('').length]))
  check('E: a reply of exactly the limit is not cut', readingOf('a'.repeat(600) + '\n\n' + 'b'.repeat(400), 600, 1000).truncated === false && readingOf('a'.repeat(600) + '\n\n' + 'b'.repeat(401), 600, 1000).truncated === true)
  const t0 = Date.now()
  const hostile = speechOf('*'.repeat(100_000) + '\n\n' + '['.repeat(50_000) + '\n\n' + '> '.repeat(5000) + 'x')
  const r7 = readingOf(hostile)
  check('E: hostile Markdown (100,000 stars, 50,000 brackets, deeply nested quotes) is handled quickly and in bounds', Date.now() - t0 < 5000 && r7.pieces.every((p) => p.length <= 600), `${Date.now() - t0} ms`)
  check('E: a pair of surrogates is never cut in two by a piece', (() => { const s = readingOf(cp(0x1f600).repeat(400)); return s.pieces.every((p) => !/[\ud800-\udbff]$/.test(p) && !/^[\udc00-\udfff]/.test(p)) })(), 'a surrogate pair was cut')
})

// ============ F. what may import what ============
await guard('F', async () => {
  const shared = source('src/shared/voice.ts')
  check('F: shared/voice.ts imports nothing', !/^import /m.test(shared))
  const clip = source('src/main/voiceClip.ts')
  const gate = source('src/main/voiceGate.ts')
  const settings = source('src/main/voiceSettings.ts')
  for (const [name, text] of [['voiceClip', clip], ['voiceGate', gate], ['voiceSettings', settings]]) {
    check(`F: ${name}.ts has no Electron import`, !/from 'electron'/.test(text))
  }
  check('F: voiceClip.ts and voiceGate.ts import only the shared voice part', [...clip.matchAll(/from '([^']+)'/g)].every((m) => m[1] === '../shared/voice') && [...gate.matchAll(/from '([^']+)'/g)].every((m) => m[1] === '../shared/voice'), [...clip.matchAll(/from '([^']+)'/g)].map((m) => m[1]).join())
  const speech = source('src/renderer/src/voice/speechText.ts')
  check('F: speechText.ts imports only the Markdown reader and the shared voice part (no DOM, no React)', [...speech.matchAll(/from '([^']+)'/g)].map((m) => m[1]).sort().join() === '../../../shared/voice,../markdown/parse' && !/\bdocument\.|\bwindow\./.test(speech))
  check('F: nothing in the app imports the voice modules yet (they are not wired until 15.5)', !['src/main/ipc.ts', 'src/main/chat.ts', 'src/preload/index.ts', 'src/main/index.ts'].some((f) => /voice/i.test(source(f))))
})

rmSync(tempRoot, { recursive: true, force: true })
const ok = check.summary()
process.exit(ok ? 0 : 1)
