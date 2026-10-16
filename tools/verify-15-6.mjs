// Slice 15.6 under plain Node (no window): the part of the page that reads a reply aloud (D-047). The speaker is given a STAND-IN for the window's speech, so what it does is seen exactly:
// one piece at a time, the next only when the one before has ended, Stop heard at once and an old reading never going on after Stop or after another reading began, the system's
// errors told apart (Stop causes two of them), the voice and the speed, a long reply cut with a notice, the list of voices that may come late; and source checks on what the page
// may do (nothing in the reading sends anything; the microphone is opened in one place; the words from the microphone are never sent by the page).
// The page itself, with a fake microphone, is in verify-15-6w.mjs.
// Run: node tools/guarded.mjs tools/verify-15-6.mjs      (ONLY=A,C runs some parts)
import './ts-resolve.mjs'
import { checker } from './cdp.mjs'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { REPO, REPO_URL } from './paths.mjs'

const check = checker()
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(',')) : null
const guard = async (name, fn) => { if (ONLY && !ONLY.has(name)) return; try { await fn() } catch (error) { check(`${name} did not run to its end: ${String(error?.stack ?? error).slice(0, 400)}`, false) } }
const show = (v) => JSON.stringify(v)?.slice(0, 400)
const SRC = `${REPO_URL}/src`
const S = await import(`${SRC}/renderer/src/voice/speaker.ts`)
const T = await import(`${SRC}/renderer/src/voice/speechText.ts`)
const V = await import(`${SRC}/shared/voice.ts`)
const source = (rel) => readFileSync(join(REPO, rel), 'utf8')

// what the window has and the speaker uses: the utterance, and the speech with its three functions
globalThis.SpeechSynthesisUtterance = class {
  constructor(text) { this.text = text; this.voice = null; this.lang = ''; this.rate = 1; this.onend = null; this.onerror = null }
}
const VOICES = [{ name: 'Microsoft Zira - English (United States)', lang: 'en-US' }, { name: 'Microsoft David - English (United States)', lang: 'en-US' }, { name: 'Microsoft Ravi - English (India)', lang: 'en-IN' }]
function fakeSpeech(voices = VOICES) {
  const seen = { spoken: [], cancelled: 0, asked: 0 }
  const api = { speak: (u) => { seen.spoken.push(u) }, cancel: () => { seen.cancelled++ }, getVoices: () => { seen.asked++; return typeof voices === 'function' ? voices(seen.asked) : voices } }
  return { seen, api, speaker: S.createSpeaker(() => api) }
}
const LONG = Array.from({ length: 120 }, (_, i) => `This is sentence number ${i + 1} of a long reply that goes on.`).join(' ')
const OPTIONS = { voice: null, rate: 100 }

// ============ A. when there is nothing to read with, or nothing to read ============
await guard('A', async () => {
  const none = S.createSpeaker(() => null)
  none.speak('m1', 'Hello there.', OPTIONS)
  check('A: with no speech in the window: nothing is read and the person is told why', none.state().speaking === null && /no voice/.test(none.state().notice ?? ''), show(none.state()))
  const empty = fakeSpeech([])
  empty.speaker.speak('m1', 'Hello there.', OPTIONS)
  check('A: with a speech that has no voice: nothing is spoken, the person is told why', empty.seen.spoken.length === 0 && empty.speaker.state().speaking === null && /no voice/.test(empty.speaker.state().notice ?? ''), show(empty.speaker.state()))
  const blank = fakeSpeech()
  blank.speaker.speak('m1', '   \n\n  ', OPTIONS)
  check('A: a reply with nothing to say is not spoken, and the person is told', blank.seen.spoken.length === 0 && blank.speaker.state().speaking === null && /nothing in this reply/.test(blank.speaker.state().notice ?? ''), show(blank.speaker.state()))
  check('A: the state starts as nothing being read and no notice', fakeSpeech().speaker.state().speaking === null && fakeSpeech().speaker.state().notice === null)
  check('A: stop with nothing being read does nothing wrong', (() => { const f = fakeSpeech(); f.speaker.stop(); f.speaker.stop(); return f.speaker.state().speaking === null })())
})

// ============ B. one piece at a time ============
await guard('B', async () => {
  const f = fakeSpeech()
  const expected = T.readingOf(T.speechOf(LONG)).pieces
  check('B: (setup) the long reply is several pieces, none longer than 600 characters', expected.length >= 3 && expected.every((p) => p.length <= V.VOICE_LIMITS.readPieceChars), show(expected.map((p) => p.length)))
  f.speaker.speak('m1', LONG, OPTIONS)
  check('B: only the FIRST piece is given to the system at the start, and the state says which reply is being read', f.seen.spoken.length === 1 && f.seen.spoken[0].text === expected[0] && f.speaker.state().speaking === 'm1', show([f.seen.spoken.length, f.speaker.state()]))
  f.seen.spoken[0].onend()
  check('B: the next piece is given only when the one before has ended', f.seen.spoken.length === 2 && f.seen.spoken[1].text === expected[1])
  for (let i = 1; i < expected.length; i++) f.seen.spoken[i].onend()
  check('B: after the last piece the reading is over, and the pieces were said in order, all of them', f.speaker.state().speaking === null && f.seen.spoken.map((u) => u.text).join('|') === expected.join('|'), show([f.speaker.state(), f.seen.spoken.length, expected.length]))
  check('B: a reply read to its end leaves no notice', f.speaker.state().notice === null)
  const g = fakeSpeech()
  g.speaker.speak('m1', 'A short one.', OPTIONS)
  check('B: a short reply is one piece', g.seen.spoken.length === 1)
  g.seen.spoken[0].onend()
  check('B: ...and is over when it ends', g.speaker.state().speaking === null && g.seen.spoken.length === 1)
  check('B: markdown is made into words first: no asterisks, hashes or backticks are spoken', (() => { const h = fakeSpeech(); h.speaker.speak('m', '# Title\n\nSome **bold** words and `code` here.', OPTIONS); return h.seen.spoken.length >= 1 && !/[*#`]/.test(h.seen.spoken.map((u) => u.text).join(' ')) })())
})

// ============ C. stop ============
await guard('C', async () => {
  const f = fakeSpeech()
  f.speaker.speak('m1', LONG, OPTIONS)
  const first = f.seen.spoken[0]
  const before = f.seen.cancelled
  f.speaker.stop()
  check('C: stop tells the system to cancel and the state says nothing is being read', f.seen.cancelled > before && f.speaker.state().speaking === null)
  first.onend()
  check('C: the piece that ends AFTER stop does not start the next one', f.seen.spoken.length === 1, String(f.seen.spoken.length))
  f.speaker.stop()
  check('C: stopping again is harmless', f.speaker.state().speaking === null && f.seen.spoken.length === 1)
  f.speaker.speak('m1', LONG, OPTIONS)
  check('C: reading the same reply again after a stop starts again from its beginning', f.seen.spoken.length === 2 && f.seen.spoken[1].text === f.seen.spoken[0].text)
})

// ============ D. another reply while one is being read ============
await guard('D', async () => {
  const f = fakeSpeech()
  f.speaker.speak('A', LONG, OPTIONS)
  const a0 = f.seen.spoken[0]
  f.speaker.speak('B', 'Second reply here.', OPTIONS)
  check('D: reading another reply stops the first (a cancel) and the state says it is the second', f.speaker.state().speaking === 'B' && f.seen.cancelled >= 2 && f.seen.spoken.length === 2 && f.seen.spoken[1].text === 'Second reply here.', show([f.speaker.state(), f.seen.cancelled, f.seen.spoken.length]))
  a0.onend()
  check('D: the first reply\'s late end does NOT start its next piece, and does not end the second', f.seen.spoken.length === 2 && f.speaker.state().speaking === 'B', show([f.seen.spoken.length, f.speaker.state()]))
  a0.onerror({ error: 'synthesis-failed' })
  check('D: nor does the first reply\'s late error stop the second', f.speaker.state().speaking === 'B' && f.speaker.state().notice === null, show(f.speaker.state()))
  f.seen.spoken[1].onend()
  check('D: the second ends normally', f.speaker.state().speaking === null)
})

// ============ E. errors ============
await guard('E', async () => {
  const f = fakeSpeech()
  f.speaker.speak('m1', LONG, OPTIONS)
  f.seen.spoken[0].onerror({ error: 'interrupted' })
  f.seen.spoken[0].onerror({ error: 'canceled' })
  check('E: "interrupted" and "canceled" (what Stop causes) are not a problem: still reading, no notice', f.speaker.state().speaking === 'm1' && f.speaker.state().notice === null, show(f.speaker.state()))
  f.seen.spoken[0].onerror({ error: 'synthesis-failed' })
  check('E: any other error ends the reading and says so', f.speaker.state().speaking === null && /problem/.test(f.speaker.state().notice ?? ''), show(f.speaker.state()))
  f.seen.spoken[0].onend()
  check('E: ...and the failed piece\'s end does not go on to the next piece', f.seen.spoken.length === 1)
  for (const error of ['audio-busy', 'audio-hardware', 'network', 'synthesis-unavailable', 'language-unavailable', 'voice-unavailable', 'text-too-long', 'invalid-argument', 'not-allowed', undefined]) {
    const g = fakeSpeech()
    g.speaker.speak('m', 'Hello there.', OPTIONS)
    g.seen.spoken[0].onerror({ error })
    if (g.speaker.state().speaking !== null) { check(`E: the error ${error} ends the reading`, false, show(g.speaker.state())); return }
  }
  check('E: each of the other errors the system can give (and none at all) ends the reading', true)
  f.speaker.speak('m2', 'Again.', OPTIONS)
  check('E: after an error a new reading works and clears the notice', f.speaker.state().speaking === 'm2' && f.speaker.state().notice === null)
})

// ============ F. the voice and the speed ============
await guard('F', async () => {
  const f = fakeSpeech()
  f.speaker.speak('m', 'Hello.', { voice: 'Microsoft David - English (United States)', rate: 150 })
  const u = f.seen.spoken[0]
  check('F: the named voice is given, with its language, at the asked speed', u.voice?.name === 'Microsoft David - English (United States)' && u.lang === 'en-US' && u.rate === 1.5, show([u.voice, u.lang, u.rate]))
  f.speaker.speak('m', 'Hello.', { voice: 'Microsoft Ravi - English (India)', rate: 100 })
  check('F: another voice brings its own language', f.seen.spoken[1].voice?.name === 'Microsoft Ravi - English (India)' && f.seen.spoken[1].lang === 'en-IN')
  f.speaker.speak('m', 'Hello.', { voice: 'A Voice Nobody Has', rate: 100 })
  check('F: a voice this computer does not have is left to the system\'s own (nothing is set)', f.seen.spoken[2].voice === null && f.seen.spoken[2].lang === '', show(f.seen.spoken[2]))
  f.speaker.speak('m', 'Hello.', { voice: null, rate: 100 })
  check('F: no voice named: the system\'s own', f.seen.spoken[3].voice === null)
  const rates = [[50, 0.5], [75, 0.75], [100, 1], [200, 2], [1, 0.5], [0, 0.5], [999, 2], [-5, 0.5]]
  const got = rates.map(([rate]) => { f.speaker.speak('m', 'Hello.', { voice: null, rate }); return f.seen.spoken.at(-1).rate })
  check('F: the speed is a percent from 50 to 200 and never leaves that range', got.every((r, i) => r === rates[i][1]), show(got))
})

// ============ G. a very long reply ============
await guard('G', async () => {
  const f = fakeSpeech()
  const huge = LONG.repeat(8)
  check('G: (setup) the long reply is longer than the limit', huge.length > V.VOICE_LIMITS.readMaxChars, String(huge.length))
  f.speaker.speak('m', huge, OPTIONS)
  check('G: a reply past 20,000 characters is cut, and the notice says how much is read', f.speaker.state().speaking === 'm' && /Only the first 20,000 characters/.test(f.speaker.state().notice ?? ''), show(f.speaker.state()))
  let n = 0
  while (f.speaker.state().speaking !== null && n < 500) { f.seen.spoken.at(-1).onend(); n++ }
  check('G: it reads to the cut and ends; the notice stays so the person can see it', f.speaker.state().speaking === null && /Only the first/.test(f.speaker.state().notice ?? '') && f.seen.spoken.map((u) => u.text.length).reduce((a, b) => a + b, 0) <= V.VOICE_LIMITS.readMaxChars + f.seen.spoken.length, show([n, f.speaker.state().speaking]))
})

// ============ H. the list of voices ============
await guard('H', async () => {
  const f = fakeSpeech()
  const names = await f.speaker.voices()
  check('H: the voices are listed by name, in the system\'s order', show(names) === show(VOICES.map((v) => v.name)), show(names))
  const late = fakeSpeech((asked) => (asked < 4 ? [] : VOICES))
  const t0 = Date.now()
  const lateNames = await late.speaker.voices()
  check('H: a list that arrives a little late is waited for (not more than 3 s)', lateNames.length === 3 && Date.now() - t0 < 1500, show([lateNames.length, Date.now() - t0]))
  const never = fakeSpeech([])
  const t1 = Date.now()
  const noNames = await never.speaker.voices()
  const waited = Date.now() - t1
  check('H: a list that never comes ends as an empty list after about 3 s', noNames.length === 0 && waited >= 2500 && waited < 5000, show([noNames, waited]))
  check('H: with no speech in the window the list is empty at once', (await S.createSpeaker(() => null).voices()).length === 0)
})

// ============ I. listeners ============
await guard('I', async () => {
  const f = fakeSpeech()
  const states = []
  const off = f.speaker.subscribe((s) => states.push(s.speaking))
  f.speaker.speak('m', 'Hello.', OPTIONS)
  f.seen.spoken[0].onend()
  check('I: a listener hears the reading start and end', show(states) === '["m",null]', show(states))
  off()
  f.speaker.speak('m', 'Hello.', OPTIONS)
  check('I: and nothing after it is removed', states.length === 2)
})

// ============ J. what the page may do (the source) ============
await guard('J', async () => {
  const dir = join(REPO, 'src/renderer/src')
  const files = (d) => readdirSync(join(REPO, d), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(d, e.name)) : [join(d, e.name).replace(/\\/g, '/')]))
  const all = files('src/renderer/src').filter((f) => /\.(ts|tsx)$/.test(f))
  const uses = (re) => all.filter((f) => re.test(source(f)))
  const speaker = source('src/renderer/src/voice/speaker.ts')
  check('J: the reading touches no network, no storage and no bridge: speaker.ts has no fetch, XMLHttpRequest, WebSocket, sendBeacon, window.api, localStorage or IndexedDB', !/\bfetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon|window\.api|localStorage|sessionStorage|indexedDB|EventSource/.test(speaker.replace(/\/\/.*$/gm, '')))
  check('J: speaker.ts imports only the shared limits and the speech text', [...speaker.matchAll(/^import .* from '([^']+)'/gm)].map((m) => m[1]).sort().join() === '../../../shared/voice,./speechText', show([...speaker.matchAll(/^import .* from '([^']+)'/gm)].map((m) => m[1])))
  const code = (f) => source(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '')
  const usesCode = (re) => all.filter((f) => re.test(code(f)))
  check('J: the system\'s speech is used in one place (speaker.ts) and nowhere else in the page (comments aside)', usesCode(/speechSynthesis/).join() === 'src/renderer/src/voice/speaker.ts', usesCode(/speechSynthesis/).join())
  check('J: the microphone is opened in one place (useListen.ts): getUserMedia and MediaRecorder', uses(/getUserMedia|MediaRecorder/).join() === 'src/renderer/src/voice/useListen.ts', uses(/getUserMedia|MediaRecorder/).join())
  check('J: nothing in the page asks for the camera or the screen', uses(/getDisplayMedia|video:\s*true/).length === 0)
  const listen = source('src/renderer/src/voice/useListen.ts')
  check('J: useListen opens the microphone only AFTER main has said yes to voice.begin', listen.indexOf('voice.begin()') > 0 && listen.indexOf('voice.begin()') < listen.indexOf('getUserMedia'))
  check('J: voice.begin and voice.end are called from useListen.ts only', uses(/voice\.(begin|end)\(/).join() === 'src/renderer/src/voice/useListen.ts', uses(/voice\.(begin|end)\(/).join())
  check('J: the words from the microphone go to the message box and are NOT sent from useListen (it has no way to send a message)', !/chat\.|\.send\(|onSend|submit/.test(listen.replace(/\/\/.*$/gm, '')))
  const composer = source('src/renderer/src/chat/Composer.tsx')
  const handler = /useListen\(\(words\) => \{([\s\S]*?)\n  \}\)/.exec(composer)?.[1] ?? ''
  check('J: in the Composer the words only go into the box and the box takes the focus (no send)', handler.includes('setText') && handler.includes('focus()') && !/onSend|submit|send/.test(handler), handler.slice(0, 200))
  check('J: the Composer shows the microphone button only while "Speak to type" is on', /voice\?\.listen === true && <MicButton/.test(composer))
  const actions = source('src/renderer/src/chat/MessageActions.tsx')
  check('J: "Read aloud" is shown only for a finished assistant reply with text, and only while Read aloud is on', /voice\?\.speak === true && message\.role === 'assistant' && message\.content !== '' && !arriving/.test(actions.replace(/\s+/g, ' ').replace(/\( /g, '(')), actions.match(/const canRead[\s\S]{0,200}/)?.[0])
  check('J: and a reply is read only from that click: nothing but the button calls speaker.speak in the chat', uses(/speaker\.speak\(/).sort().join() === 'src/renderer/src/chat/MessageActions.tsx,src/renderer/src/settings/VoiceSection.tsx', uses(/speaker\.speak\(/).join())
  const section = source('src/renderer/src/settings/VoiceSection.tsx')
  check('J: the Settings section reaches main only through window.api.voice (status and the changes), nothing else', [...section.matchAll(/window\.api\.(\w+)\.?(\w*)/g)].every((m) => m[1] === 'voice' && ['setListen', 'setSpeak', 'setVoice', 'reset'].includes(m[2])), show([...section.matchAll(/window\.api\.(\w+)\.?(\w*)/g)].map((m) => m[0])))
  check('J: the microphone button has no way to switch on "Speak to type" (the page only asks main for a change; the box is main\'s)', !/setListen/.test(source('src/renderer/src/voice/MicButton.tsx')) && !/setListen/.test(listen))
  check('J: the page keeps the clip and the words nowhere (no storage of any kind in the voice folder or the section)', ['src/renderer/src/voice/useListen.ts', 'src/renderer/src/voice/MicButton.tsx', 'src/renderer/src/voice/voiceStatus.ts', 'src/renderer/src/voice/speaker.ts', 'src/renderer/src/settings/VoiceSection.tsx'].every((f) => !/localStorage|sessionStorage|indexedDB|URL\.createObjectURL|FileReader|download|showSaveFilePicker/.test(source(f))))
})

const ok = check.summary()
process.exit(ok ? 0 : 1)
