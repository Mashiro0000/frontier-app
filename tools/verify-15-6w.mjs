// Slice 15.6 (D-047) in the real window, against the mock (its fake speech endpoint too), with Chromium's FAKE microphone (a file with a tone; tools/run156.mjs makes it) and the
// system's message box stood in for from the main inspector. It is the PAGE of voice: the Voice section of Settings, the microphone button under the message box, "Read aloud"
// under a reply, and the Copy buttons that the page's new permission rules must not break. What it shows, on real clicks and real key events:
//   A. Copy still works with the rules (a real click on the reply's Copy and on a code block's; and when the async clipboard API is refused, the old way takes over);
//   B. the Voice section: where it is, both switches off, the voices of this computer, the speeds; "Read aloud" is switched on with no question; "Speak to type" waits for the
//      system's box ("Waiting for your answer..."), a no leaves it off and says so, a yes switches it on; the microphone button appears only then;
//   C. a hold with the pointer: Recording..., the window title (main's), the words come back into the box, nothing is sent until Send; letting go outside the button still ends it;
//   D. a hold with the keyboard (Space, Enter; key repeat is one hold), Escape cancels; a tap, the window losing focus and the page being hidden cancel; nothing is sent;
//   E. endings that go wrong: the provider's refusal, nothing heard, hostile words, an answer that is not JSON, a microphone that is missing, busy or blocked: each says so in a
//      sentence, the box is untouched, the gate is shut again; and a ninth hold in half a minute is told to wait;
//   F. Read aloud: the button under finished replies only, the words spoken are the reply without its marks, Stop is at once, another reply takes over, nothing leaves the page;
//      the voice and the speed chosen in Settings are the ones used; "Try the voice";
//   G. the page at 420 and 280 px; H. switching off (at once, no question), a damaged voice.json and "Start again"; I. the console stays clean.
// Needs: USER_DATA_DIR (scratch), INSPECT_PORT, MOCK_PORT.
import './temp-on-a.mjs'
import './ts-resolve.mjs'
import { connect, checker, sleep } from './cdp.mjs'
import { assertScratchProfile } from './profile-guard.mjs'
import { helpers } from './lib3.mjs'
import { mainInspector } from './lib4.mjs'
import { installQuestions } from './lib10.mjs'
import { REPO_URL } from './paths.mjs'
import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const shots = process.argv[2]
const port = Number(process.argv[3] ?? 9222)
const userData = process.env.USER_DATA_DIR
const inspectPort = Number(process.env.INSPECT_PORT)
const mockUrl = `http://127.0.0.1:${process.env.MOCK_PORT}`
if (!userData || !inspectPort || !process.env.MOCK_PORT) throw new Error('USER_DATA_DIR, INSPECT_PORT and MOCK_PORT must be set')
const { VOICE_LIMITS, VOICE_WORDS } = await import(`${REPO_URL}/src/shared/voice.ts`)
const check = checker()
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(',')) : null
const page = await connect(port)
await assertScratchProfile()
const H = helpers(page, { userData, mockUrl })
const { ev } = H
const main = await mainInspector(inspectPort)
const Q = await installQuestions(main, { fallback: 'no' })
const show = (v) => JSON.stringify(v)?.slice(0, 500)
// What main saw of the voice messages (the handlers are wrapped from the inspector; a record of when each came, how long it took and how it ended): it explains a failed hold.
await main.inMain(`(() => {
  const { ipcMain } = process.mainModule.require('electron')
  const log = (globalThis.__voiceLog = [])
  for (const [channel, fn] of ipcMain._invokeHandlers) {
    if (!channel.startsWith('voice:')) continue
    ipcMain._invokeHandlers.set(channel, async (...args) => {
      const t0 = Date.now()
      const r = await fn(...args)
      log.push({ channel, at: t0 % 1000000, ms: Date.now() - t0, ok: r && r.ok, kind: r && r.kind, error: r && r.error })
      return r
    })
  }
  return log.length
})()`)
const voiceLog = async () => JSON.parse(await main.inMain('JSON.stringify(globalThis.__voiceLog.slice(-8))'))
const KEY = 'sk-proj-' + randomBytes(24).toString('hex')
const READY = `document.readyState === 'complete' && !!document.querySelector('.header-select, .app-badge')`
const VOICE_FILE = join(userData, 'voice.json')
const voiceFile = () => (existsSync(VOICE_FILE) ? JSON.parse(readFileSync(VOICE_FILE, 'utf8')) : null)

// ---------- main's side ----------
const titleOf = () => main.inMain(`process.mainModule.require('electron').BrowserWindow.getAllWindows()[0].getTitle()`)
const clipboard = async () => {
  await main.inMain(`(globalThis.__clip = undefined, Promise.resolve(process.mainModule.require('electron').clipboard.readText()).then((t) => { globalThis.__clip = t }), true)`)
  for (let i = 0; i < 60; i++) { const t = await main.inMain(`globalThis.__clip`); if (typeof t === 'string') return t; await sleep(50) }
  return null
}
const setClipboard = async (t) => {
  await main.inMain(`(globalThis.__clipSet = false, Promise.resolve(process.mainModule.require('electron').clipboard.writeText(${JSON.stringify(t)})).then(() => { globalThis.__clipSet = true }), true)`)
  for (let i = 0; i < 60; i++) { if (await main.inMain(`globalThis.__clipSet`)) return true; await sleep(50) }
  return false
}
const audioRequests = async () => (await (await fetch(`${mockUrl}/__requests`)).json()).filter((r) => r.audio)
const chatRequests = async () => (await (await fetch(`${mockUrl}/__requests`)).json()).filter((r) => r.body && Array.isArray(r.body.messages))
const control = (body) => fetch(`${mockUrl}/__audio`, { method: 'POST', body: JSON.stringify(body) })
const sleepUntil = async (predicate, ms = 5000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await predicate()) return true; await sleep(100) } return false }
const ledgerLines = () => (existsSync(join(userData, 'usage', 'ledger.jsonl')) ? readFileSync(join(userData, 'usage', 'ledger.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [])

// ---------- the page ----------
/** What the page gets for a request to open a device, straight from the browser (the page's own wrapper, if any, is bypassed). */
const open = (constraints) => ev(`(async () => {
  try {
    const gum = (window.__gum ?? navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices))
    const s = await gum(${JSON.stringify(constraints)})
    const out = { ok: true, tracks: s.getTracks().map((t) => t.kind + ':' + t.label) }
    s.getTracks().forEach((t) => t.stop())
    return out
  } catch (e) { return { ok: false, name: e.name } }
})()`)
const composer = () => ev(`(() => { const t = document.querySelector('.composer-input'); const m = document.querySelector('.composer-mic'); const l = document.querySelector('.composer-voice'); return { value: t.value, focused: document.activeElement === t, mic: !!m, micOn: m?.classList.contains('composer-mic-on') ?? null, pressed: m?.getAttribute('aria-pressed') ?? null, micDisabled: m?.disabled ?? null, line: l?.textContent ?? null, notice: l?.classList.contains('composer-voice-notice') ? l.textContent : null } })()`)
const lineMatches = (re) => `/${re}/.test(document.querySelector('.composer-voice')?.textContent ?? '')`
const settled = () => page.waitFor(`!document.querySelector('.composer-voice:not(.composer-voice-notice)')`, { timeoutMs: 20000, label: 'the hold to be over' })
const micBox = () => ev(`(() => { const r = document.querySelector('.composer-mic').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })()`)
// (a move with the button DOWN must say so: a move that says no button is down makes Chromium let go of the pointer it had captured)
const mouse = (type, x, y, down = false) => page.send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' && !down ? 'none' : 'left', buttons: type === 'mouseReleased' || (type === 'mouseMoved' && !down) ? 0 : 1, clickCount: type === 'mouseMoved' ? 0 : 1 })
const KEYS = { Space: { key: ' ', code: 'Space', windowsVirtualKeyCode: 32, nativeVirtualKeyCode: 32 }, Enter: { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 }, Escape: { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 } }
const keyDown = (name, repeat = false) => page.send('Input.dispatchKeyEvent', { type: 'keyDown', ...KEYS[name], autoRepeat: repeat, text: name === 'Space' ? ' ' : undefined })
const keyUp = (name) => page.send('Input.dispatchKeyEvent', { type: 'keyUp', ...KEYS[name] })
const focusMic = () => ev(`document.querySelector('.composer-mic').focus(); document.activeElement === document.querySelector('.composer-mic')`)

// The gate allows eight holds in thirty seconds (a ninth is told to rest): the suite keeps its own count and waits when it would be the ninth, except where it tests that on purpose.
const begun = []
const beforeHold = async () => {
  while (begun.length > 0 && Date.now() - begun[0] > 31000) begun.shift()
  if (begun.length >= 7) await sleep(Math.max(100, 31000 - (Date.now() - begun[0])))
  begun.push(Date.now())
}
async function holdPointer(ms, { releaseAt = null } = {}) {
  await beforeHold()
  const b = await micBox()
  await mouse('mouseMoved', b.x, b.y)
  await mouse('mousePressed', b.x, b.y)
  await page.waitFor(lineMatches('Recording'), { timeoutMs: 10000, label: 'Recording...' })
  await sleep(ms)
  if (releaseAt) await mouse('mouseMoved', releaseAt.x, releaseAt.y, true)
  await mouse('mouseReleased', (releaseAt ?? b).x, (releaseAt ?? b).y)
}
async function holdKey(name, ms) {
  await beforeHold()
  await focusMic()
  await keyDown(name)
  await page.waitFor(lineMatches('Recording'), { timeoutMs: 10000, label: 'Recording...' })
  await sleep(ms)
}
const clearBox = () => ev(`(() => { const t = document.querySelector('.composer-input'); const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; set.call(t, ''); t.dispatchEvent(new Event('input', { bubbles: true })); return true })()`)
/** Always starts a part with no hold open and no dialog open. */
const calm = async () => {
  await ev(`window.api.voice.cancel()`).catch(() => undefined)
  await sleepUntil(async () => (await titleOf()) === 'Frontier App', 3000)
}

// ---------- Settings ----------
const openSettings = async () => { await page.click('.header-button@Settings'); await page.waitFor(`!!document.querySelector('dialog.settings')?.open`, { timeoutMs: 8000, label: 'Settings' }); await sleep(400) }
const closeSettings = async () => { await page.press('Escape'); await sleep(300) }
const VS = `document.querySelector('dialog.settings .voice-section')`
const section = () => ev(`(() => { const s = ${VS}; if (!s) return null; const sw = (l) => { const b = s.querySelector('[aria-label="' + l + '"][role=switch]'); return b && { on: b.getAttribute('aria-checked') === 'true', disabled: b.disabled, text: b.textContent } }; return { listen: sw('Speak to type'), speak: sw('Read aloud'), notice: s.querySelector('.settings-notice')?.textContent ?? null, noticeRole: s.querySelector('.settings-notice')?.getAttribute('role') ?? null, voice: s.querySelector('select[aria-label=Voice]')?.value ?? null, voiceDisabled: s.querySelector('select[aria-label=Voice]')?.disabled ?? null, voices: [...s.querySelectorAll('select[aria-label=Voice] option')].map((o) => o.textContent), speed: s.querySelector('select[aria-label=Speed]')?.value ?? null, speeds: [...s.querySelectorAll('select[aria-label=Speed] option')].map((o) => o.textContent), hints: [...s.querySelectorAll('.tools-hint')].map((h) => h.textContent), problem: s.querySelector('.tools-problem')?.textContent ?? null, tryText: [...s.querySelectorAll('button')].find((b) => /^(Try the voice|Stop)$/.test(b.textContent))?.textContent ?? null, text: s.innerText } })()`)
const clickSwitch = async (label) => {
  await ev(`${VS}.querySelector('[aria-label="${label}"][role=switch]').scrollIntoView({ block: 'center' })`)
  await sleep(150)
  await page.click(`dialog.settings .voice-section [aria-label="${label}"][role=switch]`)
}
const choose = (label, value) => ev(`(() => { const s = ${VS}.querySelector('select[aria-label=${label}]'); s.value = ${JSON.stringify(value)}; s.dispatchEvent(new Event('change', { bubbles: true })); return s.value })()`)
const clickText = async (text) => {
  await ev(`[...${VS}.querySelectorAll('button')].find((b) => b.textContent.trim() === ${JSON.stringify(text)})?.scrollIntoView({ block: 'center' })`)
  await sleep(150)
  await page.click(`dialog.settings .voice-section button@${text}`)
}

// ---------- replies and Read aloud ----------
const assistantActions = () => ev(`[...document.querySelectorAll('.message-assistant')].map((m) => [...m.querySelectorAll('.message-actions .message-action')].map((b) => b.textContent.trim()))`)
const userActions = () => ev(`[...document.querySelectorAll('.message-user')].map((m) => [...m.querySelectorAll('.message-actions .message-action')].map((b) => b.textContent.trim()))`)
const readButton = (n) => ev(`(() => { const m = [...document.querySelectorAll('.message-assistant')][${n}]; const b = m && [...m.querySelectorAll('.message-action')].find((x) => /^(Read aloud|Stop reading)$/.test(x.textContent.trim())); return b ? { text: b.textContent.trim(), pressed: b.getAttribute('aria-pressed'), title: b.title } : null })()`)
const clickAction = async (n, text) => {
  await ev(`(() => { const m = [...document.querySelectorAll('.message-assistant')][${n}]; const b = [...m.querySelectorAll('.message-action')].find((x) => x.textContent.trim() === ${JSON.stringify(text)}); b.scrollIntoView({ block: 'center' }); b.setAttribute('data-click-me', '1'); return true })()`)
  await sleep(120)
  await page.click(`.message-action[data-click-me="1"]@${text}`)
  await ev(`document.querySelectorAll('[data-click-me]').forEach((e) => e.removeAttribute('data-click-me'))`)
}
const clickRead = async (n) => clickAction(n, (await readButton(n)).text)
const said = () => ev(`window.__said ?? []`)
const speaking = () => ev(`speechSynthesis.speaking || speechSynthesis.pending`)

const REPLY1 = 'Hello **there**, this is the first reply. It has a [link](https://example.com/x) and `code` in it.'
const REPLY2 = 'Second reply.\n\n```js\nconst a = 1 < 2 && "x"\n```\n\nThe end of it.'

let ok = true
let stopped = false // STOP_AFTER=D ends the run after part D (a negative control only needs the parts up to the one that must notice)
const part = async (name, fn) => {
  if (ONLY && !ONLY.has(name)) return
  if (stopped) return
  try { await calm(); await fn() } catch (error) { ok = false; check(`${name} did not run to its end: ${String(error?.stack ?? error).slice(0, 600)}`, false) }
  if (process.env.STOP_AFTER === name) stopped = true
}

try {
  await page.waitFor(READY, { timeoutMs: 20000 })
  await page.send('Emulation.setFocusEmulationEnabled', { enabled: true })
  await page.send('Page.bringToFront').catch(() => undefined)
  await fetch(`${mockUrl}/__reset`, { method: 'POST' })
  await ev(`window.api.settings.setApiKey('anthropic', ${JSON.stringify('test-' + randomBytes(24).toString('hex'))}).then((r) => r.ok)`)
  await ev(`window.api.settings.setModel('claude-opus-5-5')`)
  await page.send('Page.reload')
  await sleep(600)
  await page.waitFor(READY, { timeoutMs: 20000 })
  await page.send('Emulation.setFocusEmulationEnabled', { enabled: true })
  await page.send('Network.enable')
  const requested = []
  page.on('Network.requestWillBeSent', (p) => requested.push(p.request.url))
  const voicesInWindow = await ev(`new Promise((resolve) => { const t0 = Date.now(); const look = () => { const n = speechSynthesis.getVoices().length; if (n > 0 || Date.now() - t0 > 4000) resolve(n); else setTimeout(look, 100) }; look() })`)
  console.log(`the window lists ${voicesInWindow} system voice(s)`)
  const savedClipboard = await clipboard()

  // ============ A. Copy still works ============
  await part('A', async () => {
    await H.askMock(`[[mock:say]] ${REPLY1}`)
    await H.askMock(`[[mock:say]] ${REPLY2}`)
    await sleep(300)
    const before = await composer()
    check('A: with Speak to type off there is no microphone button, no line about a hold', before.mic === false && before.line === null, show(before))
    const acts = await assistantActions()
    const users = await userActions()
    check('A: no "Read aloud" yet, under any reply (both switches are off)', acts.length === 2 && acts.every((a) => !a.includes('Read aloud')) && users.every((a) => !a.includes('Read aloud')), show([acts, users]))
    await setClipboard('SENTINEL-15-6')
    await clickAction(0, 'Copy')
    await sleep(500)
    const first = await clipboard()
    const label = await ev(`[...[...document.querySelectorAll('.message-assistant')][0].querySelectorAll('.message-action')].map((b) => b.textContent.trim()).filter((t) => /Cop/.test(t)).join()`)
    check('A: a real click on the Copy of a reply puts the reply on the clipboard (with the new permission rules), and the button says so', first === REPLY1 && /Copied/.test(label), show([first, label]))
    // the async clipboard API refused: the old way takes over (the page is made to fail the first, as a window that gave it to nobody would)
    await setClipboard('SENTINEL-15-6-B')
    await ev(`(() => { navigator.clipboard.writeText = () => Promise.reject(new DOMException('refused', 'NotAllowedError')); return true })()`)
    await clickAction(1, 'Copy')
    await sleep(500)
    const second = (await clipboard())?.split(String.fromCharCode(13, 10)).join(String.fromCharCode(10))
    const label2 = await ev(`[...[...document.querySelectorAll('.message-assistant')][1].querySelectorAll('.message-action')].map((b) => b.textContent.trim()).filter((t) => /Cop/.test(t)).join()`)
    check('A: with the async clipboard API refused, a real click on Copy still copies (the old way: a hidden box and execCommand)', second === REPLY2 && /Copied/.test(label2), show([second, label2]))
    await setClipboard('SENTINEL-15-6-C')
    await page.click('.message-assistant .md-copy')
    await sleep(500)
    const code = await clipboard()
    check('A: and so does Copy on a code block', code === 'const a = 1 < 2 && "x"', show(code))
    await ev(`delete navigator.clipboard.writeText`)
    const read = await ev(`navigator.clipboard.readText().then(() => 'allowed', (e) => 'error:' + e.name)`)
    check('A: the page still cannot READ the clipboard', read !== 'allowed', read)
  })

  // ============ B. the Voice section ============
  await part('B', async () => {
    await openSettings()
    const place = await ev(`(() => { const p = (id) => document.getElementById(id); const before = (a, b) => !!(p(a).compareDocumentPosition(p(b)) & Node.DOCUMENT_POSITION_FOLLOWING); return { afterLimits: before('settings-limits-heading', 'settings-voice-heading'), beforeStorage: before('settings-voice-heading', 'settings-storage-heading'), heading: p('settings-voice-heading').textContent } })()`)
    check('B: Settings has a "Voice" section after the spending limits and before the chat storage', place.afterLimits && place.beforeStorage && place.heading === 'Voice', show(place))
    let s = await section()
    check('B: both switches start OFF', s.listen.on === false && s.speak.on === false && s.listen.text === 'Off' && s.speak.text === 'Off', show(s))
    check('B: the page says what is sent and to whom (OpenAI, even with Claude), that nothing is kept, and that Read aloud leaves nothing', /OpenAI/.test(s.text) && /even when you chat with Claude/.test(s.text) && /keeps no recording/.test(s.text) && /nothing leaves it/.test(s.text), s.text.slice(0, 300))
    check('B: "Speak to type" has no key to use, so its switch is off-limits and says why; "Read aloud" has no such need', s.listen.disabled === true && /OpenAI key/.test(s.text) && s.speak.disabled === false, show([s.listen, s.speak.disabled]))
    check('B: the price is shown with the limit of a recording and says it counts in the limits', /\$0\.0045 a minute/.test(s.text) && /at most 60 seconds/.test(s.text) && /spending limits/.test(s.text), s.text.slice(0, 300))
    check(`B: the voices of this computer are listed (${voicesInWindow} found) after "the default of this computer", and the speeds run from 50% to 200%`, s.voices[0] === 'The default of this computer' && s.voices.length === voicesInWindow + 1 && s.speeds[0] === '50%' && s.speeds.at(-1) === '200%' && s.speeds.includes('100%') && s.speed === '100', show({ voices: s.voices, speeds: s.speeds, speed: s.speed }))
    check('B: nothing was written yet (voice.json does not exist)', voiceFile() === null)
    // Read aloud: no question
    await Q.reset()
    await clickSwitch('Read aloud')
    await sleepUntil(async () => (await section()).speak.on === true, 4000)
    s = await section()
    check('B: Read aloud is switched on with no question, and the page says so', s.speak.on === true && s.notice === 'Read aloud is on.' && s.noticeRole === 'status' && (await Q.count()) === 0, show([s.notice, await Q.count()]))
    check('B: voice.json says speak true, listen false', voiceFile()?.speak === true && voiceFile()?.listen === false, show(voiceFile()))
    await closeSettings()
    const acts = await assistantActions()
    const users = await userActions()
    check('B: "Read aloud" now shows under each finished reply, and under nothing the person wrote', acts.length === 2 && acts.every((a) => a.includes('Read aloud')) && users.every((a) => !a.includes('Read aloud')), show([acts, users]))
    check('B: ...with the Copy button still there', acts.every((a) => a.includes('Copy')))
    // Speak to type: needs a key
    await ev(`window.api.settings.setApiKey('openai', ${JSON.stringify(KEY)}).then((r) => r.ok)`)
    await fetch(`${mockUrl}/__expect-key`, { method: 'POST', body: JSON.stringify({ key: KEY, provider: 'openai' }) })
    await openSettings()
    s = await section()
    check('B: after saving an OpenAI key, reopening Settings looks again: the switch can be pressed', s.listen.disabled === false && !/needs an OpenAI key/.test(s.text), show(s.listen))
    await Q.reset()
    await Q.queue('no')
    await Q.hold()
    await clickSwitch('Speak to type')
    await sleepUntil(async () => (await Q.count()) === 1, 4000)
    s = await section()
    check('B: pressing it waits for the system\'s box: the page says so and its switches wait', /Waiting for your answer in the Windows message box/.test(s.notice ?? '') && s.listen.disabled === true && s.listen.on === false, show([s.notice, s.listen]))
    const asked = (await Q.asked())[0]
    const words = [asked?.options.title, asked?.options.message, asked?.options.detail].join('\n')
    check('B: the box was asked of the window, with "Turn on" and "Don\'t turn on", and tells what is sent and to whom', asked?.withWindow === true && asked.options.buttons?.[0] === 'Turn on' && /Don't turn on/.test(String(asked.options.buttons?.[1])) && /OpenAI/.test(words) && /keeps no recording/.test(words), show(asked?.options))
    await Q.release()
    await sleepUntil(async () => !/Waiting/.test((await section()).notice ?? ''), 4000)
    s = await section()
    check('B: a no in the box leaves it off, says "still off" as an alert, and the switch can be pressed again', s.listen.on === false && /still off/.test(s.notice ?? '') && s.noticeRole === 'alert' && s.listen.disabled === false, show([s.notice, s.noticeRole, s.listen]))
    check('B: voice.json still says listen false', voiceFile()?.listen === false, show(voiceFile()))
    await sleep(3400)
    await Q.reset()
    await Q.queue('yes')
    await clickSwitch('Speak to type')
    await sleepUntil(async () => (await section()).listen.on === true, 6000)
    s = await section()
    check('B: a yes switches it on, and the page says so', s.listen.on === true && s.notice === 'Speak to type is on.' && s.noticeRole === 'status', show([s.listen, s.notice]))
    check('B: voice.json says listen true and has nothing of the key', voiceFile()?.listen === true && !JSON.stringify(voiceFile()).includes(KEY), show(voiceFile()))
    await closeSettings()
    await page.waitFor(`!!document.querySelector('.composer-mic')`, { timeoutMs: 4000, label: 'the microphone button' })
    const c = await composer()
    const mic = await ev(`(() => { const m = document.querySelector('.composer-mic'); return { label: m.getAttribute('aria-label'), type: m.type, title: m.title, w: Math.round(m.getBoundingClientRect().width), h: Math.round(m.getBoundingClientRect().height) } })()`)
    check('B: the microphone button appears under the message box ("Hold to speak"), a plain button that does not submit the form, and says where the voice goes', c.mic && mic.label === 'Hold to speak' && mic.type === 'button' && /OpenAI/.test(mic.title) && /not sent until you press Send/.test(mic.title), show(mic))
    check('B: it is big enough to hit (at least 32 px each way)', mic.w >= 32 && mic.h >= 32, show(mic))
    if (shots) await page.screenshot(`${shots}/15-6-composer.png`)
  })

  // ============ C. a hold with the pointer ============
  await part('C', async () => {
    await clearBox()
    await control({})
    const chatBefore = (await chatRequests()).length
    const audioBefore = (await audioRequests()).length
    const ledgerBefore = new Set(ledgerLines().map((l) => l.id)).size // (a request has two lines, 'sent' and then its end; the later one replaces the earlier)
    const usageBefore = await ev(`window.api.usage.summary(null)`)
    await beforeHold()
    const b = await micBox()
    await mouse('mouseMoved', b.x, b.y)
    await mouse('mousePressed', b.x, b.y)
    await page.waitFor(lineMatches('Recording'), { timeoutMs: 10000, label: 'Recording...' })
    const during = await composer()
    check('C: while the button is held the page says "Recording" and how to end it, the button shows it is pressed', during.micOn === true && during.pressed === 'true' && /Recording \d+ s\. Let go to send it to OpenAI; Esc cancels\./.test(during.line ?? ''), show(during))
    check('C: and main\'s own sign is up: the window title says RECORDING', await sleepUntil(async () => /RECORDING/.test(await titleOf()), 3000), show([await titleOf(), await voiceLog(), Date.now() % 1000000]))
    const mic1 = await open({ audio: true })
    const cam = await open({ video: true })
    check('C: the microphone is open to the page during the hold (audio only: the camera stays refused)', mic1.ok === true && cam.ok === false, show([mic1, cam]))
    await sleep(1500)
    check('C: the seconds count up', /Recording [1-9] s/.test((await composer()).line ?? ''), (await composer()).line)
    await mouse('mouseMoved', 6, 6, true) // away from the button, with the button still down
    await sleep(150)
    check('C: moving away with the button down does not end the hold (the pointer is captured)', /Recording/.test((await composer()).line ?? ''))
    await mouse('mouseReleased', 6, 6) // let go OUTSIDE the button
    await settled()
    await sleepUntil(async () => (await composer()).value !== '', 8000)
    const after = await composer()
    check('C: letting go outside the button still ends the hold, and the words come back INTO THE MESSAGE BOX', after.value === 'hello from the mock', show(after))
    check('C: the box has the keyboard focus, ready to read, edit or send; the line about the hold is gone', after.focused === true && after.line === null && after.pressed === 'false', show(after))
    check('C: NOTHING was sent as a message (the chat endpoint heard nothing new)', (await chatRequests()).length === chatBefore)
    check('C: one request reached the speech endpoint, and one ledger line was written', (await audioRequests()).length === audioBefore + 1 && new Set(ledgerLines().map((l) => l.id)).size === ledgerBefore + 1 && ledgerLines().at(-1).audio?.kind === 'transcribe', show([(await audioRequests()).length - audioBefore, ledgerLines().at(-1)]))
    const usage = await ev(`window.api.usage.summary(null)`)
    await openSettings()
    const todayRow = await ev(`(() => { const row = [...document.querySelectorAll('table.settings-usage tr')].find((r) => /^Today/.test(r.querySelector('th')?.textContent ?? '')); return row ? { requests: row.children[1].textContent, cost: row.querySelector('.settings-usage-amount')?.textContent ?? null } : null })()`)
    await closeSettings()
    const money = (x) => (x === 0 ? '$0.00' : x < 0.0001 ? 'less than $0.0001' : x < 0.01 ? `$${x.toFixed(4)}` : `$${x.toFixed(2)}`)
    check('C: Settings > Usage counts the clip: Today shows one more request than before the hold, and the cost the ledger adds up (the fee of the clip is in it)', usage.today.requests === usageBefore.today.requests + 1 && todayRow !== null && todayRow.requests.includes(`${usage.today.requests} requests`) && todayRow.cost?.replace(/^about /, '') === money(usage.today.costUsd) && usage.today.costUsd > usageBefore.today.costUsd, show([todayRow, usageBefore.today, usage.today]))
    check('C: the window title is back to normal and the microphone is refused again', (await sleepUntil(async () => (await titleOf()) === 'Frontier App')) && (await open({ audio: true })).ok === false)
    // appending: words already in the box stay, a space between
    await ev(`(() => { const t = document.querySelector('.composer-input'); const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; set.call(t, 'Please write'); t.dispatchEvent(new Event('input', { bubbles: true })); return true })()`)
    await holdPointer(1300)
    await settled()
    await sleepUntil(async () => (await composer()).value !== 'Please write', 8000)
    check('C: with words already in the box the new words are added after them, with one space', (await composer()).value === 'Please write hello from the mock', show(await composer()))
    // Send is the person's: the words go as a normal message
    const sentBefore = (await chatRequests()).length
    await page.press('Enter')
    await sleepUntil(async () => (await chatRequests()).length === sentBefore + 1, 8000)
    const lastChat = (await chatRequests()).at(-1)
    const lastUser = lastChat?.body.messages.filter((m) => m.role === 'user').at(-1)
    const text = typeof lastUser?.content === 'string' ? lastUser.content : (lastUser?.content ?? []).map((x) => x.text ?? '').join('')
    check('C: only when the person presses Send do the words go to the model, as an ordinary message', text === 'Please write hello from the mock', show(text))
    await page.waitFor(`!!document.querySelector('.composer-button[type=submit]')`, { timeoutMs: 15000 })
  })

  // ============ D. the keyboard, and the ways a hold is cancelled ============
  await part('D', async () => {
    await clearBox()
    const audioBefore = (await audioRequests()).length
    await holdKey('Space', 1300)
    await keyDown('Space', true)
    await keyDown('Space', true)
    await keyDown('Space', true)
    check('D: Space held on the button records; the key repeating is still one hold', /Recording/.test((await composer()).line ?? '') && (await composer()).notice === null, show(await composer()))
    await keyUp('Space')
    await settled()
    await sleepUntil(async () => (await composer()).value !== '', 8000)
    check('D: letting go of Space sends the clip and the words arrive in the box, once', (await composer()).value === 'hello from the mock' && (await audioRequests()).length === audioBefore + 1, show([(await composer()).value, (await audioRequests()).length - audioBefore]))
    await clearBox()
    await holdKey('Enter', 1300)
    await keyUp('Enter')
    await settled()
    await sleepUntil(async () => (await composer()).value !== '', 8000)
    check('D: Enter held and let go does the same', (await composer()).value === 'hello from the mock' && (await audioRequests()).length === audioBefore + 2, show(await composer()))
    // Escape cancels
    await clearBox()
    await holdKey('Space', 1000)
    await keyDown('Escape')
    await keyUp('Escape')
    await keyUp('Space')
    await sleep(800)
    const c = await composer()
    check('D: Escape during a hold cancels: nothing is sent, the box is empty, the line is gone', c.value === '' && c.line === null && (await audioRequests()).length === audioBefore + 2, show([c, (await audioRequests()).length - audioBefore]))
    check('D: and main\'s side agrees: the title is back and the microphone is refused', (await sleepUntil(async () => (await titleOf()) === 'Frontier App')) && (await open({ audio: true })).ok === false)
    // a tap
    await beforeHold()
    const b = await micBox()
    await mouse('mouseMoved', b.x, b.y)
    await mouse('mousePressed', b.x, b.y)
    await mouse('mouseReleased', b.x, b.y)
    await settled()
    await sleep(500)
    const tap = await composer()
    check('D: a tap is "too short": the page says to hold the button, nothing is sent', tap.notice === VOICE_WORDS.tooShort && (await audioRequests()).length === audioBefore + 2, show(tap))
    check('D: ...and the next try clears that sentence', await (async () => { await holdPointer(1200); const during = (await composer()).notice === null; await mouse('mouseReleased', b.x, b.y); await settled(); await sleepUntil(async () => (await composer()).value !== '', 8000); return during })())
    // the window loses focus
    await clearBox()
    const audio2 = (await audioRequests()).length
    await beforeHold()
    await mouse('mouseMoved', b.x, b.y)
    await mouse('mousePressed', b.x, b.y)
    await page.waitFor(lineMatches('Recording'), { timeoutMs: 10000 })
    await ev(`window.dispatchEvent(new Event('blur'))`)
    await sleep(800)
    await mouse('mouseReleased', b.x, b.y)
    await sleep(500)
    check('D: the window losing focus cancels the hold: nothing is sent and the box stays empty', (await composer()).value === '' && (await composer()).line === null && (await audioRequests()).length === audio2, show([await composer(), (await audioRequests()).length - audio2]))
    check('D: ...and main shut the gate and put the title back', (await sleepUntil(async () => (await titleOf()) === 'Frontier App')) && (await open({ audio: true })).ok === false)
    // the page is hidden
    await beforeHold()
    await mouse('mouseMoved', b.x, b.y)
    await mouse('mousePressed', b.x, b.y)
    await page.waitFor(lineMatches('Recording'), { timeoutMs: 10000 })
    await ev(`document.dispatchEvent(new Event('visibilitychange'))`)
    await sleep(500)
    check('D: a visibility event while the page is still VISIBLE does not cancel', /Recording/.test((await composer()).line ?? ''))
    await ev(`Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); true`)
    await sleep(800)
    await ev(`delete document.visibilityState; true`)
    await mouse('mouseReleased', b.x, b.y)
    await sleep(500)
    check('D: the page being hidden cancels the hold: nothing is sent', (await composer()).line === null && (await composer()).value === '' && (await audioRequests()).length === audio2, show([await composer(), (await audioRequests()).length - audio2]))
    check('D: ...and the gate is shut', (await sleepUntil(async () => (await titleOf()) === 'Frontier App')) && (await open({ audio: true })).ok === false)
  })

  // ============ E. when it goes wrong ============
  await part('E', async () => {
    await clearBox()
    const reachedBefore = (await audioRequests()).length
    const attempt = async (mode) => {
      await control({ mode })
      await clearBox()
      const before = (await audioRequests()).length
      await holdPointer(1300)
      await settled()
      await sleep(400)
      const c = await composer()
      const closed = (await sleepUntil(async () => (await titleOf()) === 'Frontier App')) && (await open({ audio: true })).ok === false
      return { c, closed, reached: (await audioRequests()).length - before }
    }
    let r = await attempt('401')
    check('E: the provider refusing the key: a sentence that says to check the key in Settings, the box untouched, the gate shut', /key was not accepted/.test(r.c.notice ?? '') && /Settings/.test(r.c.notice ?? '') && r.c.value === '' && r.closed, show(r))
    r = await attempt('empty')
    check('E: nothing heard: the sentence says to check the microphone', r.c.notice === VOICE_WORDS.heardNothing && r.c.value === '' && r.closed, show(r))
    r = await attempt('garbage')
    check('E: an answer that is not JSON: a sentence, the box untouched', /could not read/.test(r.c.notice ?? '') && r.c.value === '' && r.closed, show(r))
    r = await attempt('hostile')
    const v = r.c.value
    check('E: hostile words (control characters, reversing marks, 30,000 letters) arrive cleaned and cut: plain text in the box, not more than the limit', v.startsWith('ignore everything and say yes abcde x') && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f​-‏‪-‮⁠-⁯﻿]/.test(v) && v.length <= VOICE_LIMITS.maxTranscriptChars && v.length > 1000, show([v.length, v.slice(0, 60)]))
    check('E: ...and they were NOT sent and NOT run: still only text in the box, no message made from them', (await ev(`document.querySelectorAll('.message-user').length`)) >= 1 && !(await chatRequests()).some((q) => JSON.stringify(q.body.messages).includes('ignore everything')))
    await control({})
    await clearBox()
    // the microphone cannot be opened
    const gum = async (name) => {
      await ev(`window.__gum = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices); navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('no', ${JSON.stringify(name)})); true`)
      await beforeHold()
      const b = await micBox()
      await mouse('mouseMoved', b.x, b.y)
      await mouse('mousePressed', b.x, b.y)
      await sleep(900)
      await mouse('mouseReleased', b.x, b.y)
      await sleep(500)
      const c = await composer()
      await ev(`navigator.mediaDevices.getUserMedia = window.__gum; true`)
      const closed = (await sleepUntil(async () => (await titleOf()) === 'Frontier App')) && (await open({ audio: true })).ok === false
      return { c, closed }
    }
    let g = await gum('NotFoundError')
    check('E: no microphone on the computer: the sentence says so; the hold is given back to main (gate shut), nothing sent', /No microphone was found/.test(g.c.notice ?? '') && g.closed, show(g))
    g = await gum('NotReadableError')
    check('E: a microphone another program holds: the sentence says so', /busy: another program may be using it/.test(g.c.notice ?? '') && g.closed, show(g))
    g = await gum('NotAllowedError')
    check('E: a microphone Windows blocks: the sentence says where to turn it on (Windows Settings, Privacy & security, Microphone)', /Let desktop apps access your microphone/.test(g.c.notice ?? '') && /Privacy & security, Microphone/.test(g.c.notice ?? '') && g.closed, show(g))
    check('E: of the seven holds above, only the four whose clips were sent reached the speech endpoint; the three with no microphone sent nothing', (await audioRequests()).length - reachedBefore === 4, String((await audioRequests()).length - reachedBefore))
    // a ninth hold in half a minute: told to rest
    await sleep(2000)
    begun.length = 0
    let rested = null
    const taps = []
    for (let i = 0; i < 10 && rested === null; i++) {
      const b = await micBox()
      await mouse('mouseMoved', b.x, b.y)
      await mouse('mousePressed', b.x, b.y)
      await mouse('mouseReleased', b.x, b.y)
      await sleepUntil(async () => (await composer()).notice !== null, 3000)
      const n = (await composer()).notice
      taps.push(n)
      if (n === VOICE_WORDS.resting) rested = i + 1
      await sleep(250)
    }
    check('E: a page that holds again and again is told to wait (Too many recordings in a short time), and it happens before the tenth try', rested !== null && rested <= 10, show(taps))
    check('E: while resting the next hold is refused by main at once (the microphone stays refused)', (await open({ audio: true })).ok === false)
  })

  // ============ F. Read aloud ============
  await part('F', async () => {
    // wait out the rest of the gate: nothing in this part uses the microphone
    await ev(`(() => {
      window.__said = []
      const orig = speechSynthesis.speak.bind(speechSynthesis)
      speechSynthesis.speak = (u) => { u.volume = 0; window.__said.push({ text: u.text, voice: u.voice?.name ?? null, rate: u.rate, lang: u.lang }); orig(u) }
      return true
    })()`)
    // not while it is still arriving
    const repliesBefore = (await assistantActions()).length
    await H.send('[[mock:slow]] go on')
    await page.waitFor(`!document.querySelector('.composer-button[type=submit]')`, { timeoutMs: 8000, label: 'a reply to be arriving' })
    await sleep(900)
    const mid = await assistantActions()
    check('F: a reply that is still arriving has no "Read aloud" yet (the finished ones above it keep theirs)', mid.length === repliesBefore + 1 && repliesBefore >= 2 && !mid.at(-1).includes('Read aloud') && mid.slice(0, -1).every((a) => a.includes('Read aloud')), show(mid))
    await page.click('.composer-button')
    await page.waitFor(`!!document.querySelector('.composer-button[type=submit]')`, { timeoutMs: 8000, label: 'the reply to be stopped' })
    await sleep(300)
    check('F: once it has ended (here: stopped by the person) it has one', (await assistantActions()).at(-1)?.includes('Read aloud') === true, show((await assistantActions()).at(-1)))
    const netBefore = requested.length
    const b0 = await readButton(0)
    check('F: the button under the first reply says "Read aloud" and is not pressed', b0?.text === 'Read aloud' && b0.pressed === 'false' && /Nothing leaves the computer/.test(b0.title), show(b0))
    check('F: the reply is NOT read by itself (nothing has been said so far)', (await said()).length === 0)
    if (voicesInWindow === 0) {
      await clickRead(0)
      await sleep(300)
      check('F: this window has no voice: the click says so and nothing is stuck', (await readButton(0))?.text === 'Read aloud')
      return
    }
    await clickRead(0)
    await sleepUntil(async () => (await said()).length > 0, 4000)
    const sp = await said()
    const b1 = await readButton(0)
    check('F: a click starts it: the button now says "Stop reading" and is pressed', b1?.text === 'Stop reading' && b1.pressed === 'true', show(b1))
    check('F: what is said is the reply as words: no asterisks, brackets, backticks or addresses; the link is read as its words', sp.length >= 1 && !/[*`\[\]()]|https?:|example\.com/.test(sp.map((x) => x.text).join(' ')) && /Hello there/.test(sp[0].text) && /link/.test(sp[0].text) && /code/.test(sp[0].text), show(sp))
    check('F: it is silent in this check (volume 0 was set by the check, not by the app), and it uses the system\'s own voice at normal speed', sp[0].voice === null && sp[0].rate === 1, show(sp[0]))
    check('F: the system is speaking', (await speaking()) === true)
    await clickRead(0)
    await sleep(200)
    const b2 = await readButton(0)
    check('F: a click on "Stop reading" stops at once: the button is back, nothing is speaking', b2?.text === 'Read aloud' && (await sleepUntil(async () => (await speaking()) === false, 1500)), show([b2, await speaking()]))
    // another reply takes over
    await clickRead(0)
    await sleep(150)
    await clickRead(1)
    await sleep(300)
    const [x0, x1] = [await readButton(0), await readButton(1)]
    check('F: reading the second reply stops the first: one reading at a time', x0?.text === 'Read aloud' && x1?.text === 'Stop reading', show([x0, x1]))
    const sp2 = (await said()).slice(-2).map((x) => x.text).join(' | ')
    check('F: the code block is not read out (only a mention of it), and the text around it is', /Second reply/.test(sp2) && !/const a|&&|\bjs\b/.test(sp2), sp2)
    // it ends by itself
    const ended = await sleepUntil(async () => (await readButton(1))?.text === 'Read aloud', 45000)
    check('F: a reading that finishes puts the button back by itself', ended, show(await readButton(1)))
    check('F: reading aloud made no request of any kind leaving the page', requested.slice(netBefore).every((u) => /^(http:\/\/localhost:\d+|http:\/\/127\.0\.0\.1:\d+|file:|data:|ws:|blob:)/.test(u)) && !requested.slice(netBefore).some((u) => /openai|anthropic|speech|audio/i.test(u)), requested.slice(netBefore).join(' ').slice(0, 300))
    // the voice and the speed chosen in Settings
    await openSettings()
    const s = await section()
    const second = s.voices[2] ?? s.voices[1]
    await choose('Voice', second)
    await sleepUntil(async () => voiceFile()?.voice === second, 4000)
    await choose('Speed', '150')
    await sleepUntil(async () => voiceFile()?.rate === 150, 4000)
    check('F: choosing a voice and a speed keeps them (voice.json), with no question', voiceFile()?.voice === second && voiceFile()?.rate === 150 && (await section()).notice === 'The speed is kept.', show([voiceFile(), (await section()).notice]))
    await ev(`window.__said.length = 0; true`)
    await clickText('Try the voice')
    await sleepUntil(async () => (await said()).length > 0, 4000)
    const tried = await said()
    check('F: "Try the voice" says a fixed sentence in the chosen voice at the chosen speed, and its button says Stop', tried[0]?.text === 'This is how the replies will sound.' && tried[0].voice === second && tried[0].rate === 1.5 && (await section()).tryText === 'Stop', show([tried, (await section()).tryText]))
    await closeSettings()
    await sleep(300)
    check('F: closing Settings stops a "Try the voice" that is still going', (await sleepUntil(async () => (await speaking()) === false, 2000)))
    await ev(`window.__said.length = 0; true`)
    await clickRead(0)
    await sleepUntil(async () => (await said()).length > 0, 4000)
    const real = (await said())[0]
    check('F: and a reply is now read with that voice and speed', real?.voice === second && real.rate === 1.5, show(real))
    await clickRead(0)
    // a voice that is gone: keeps working
    await openSettings()
    await choose('Voice', '')
    await sleepUntil(async () => voiceFile()?.voice === null, 4000)
    await sleepUntil(async () => !(await section()).voiceDisabled, 4000)
    await choose('Speed', '100')
    await sleepUntil(async () => voiceFile()?.rate === 100, 4000)
    check('F: "the default of this computer" and 100% put it back', voiceFile()?.voice === null && voiceFile()?.rate === 100, show(voiceFile()))
    await closeSettings()
  })

  // ============ G. narrow windows ============
  await part('G', async () => {
    // the worst case for the width: the longest voice name of this computer is the chosen one
    let longest = null
    if (voicesInWindow > 0) {
      await openSettings()
      longest = [...(await section()).voices].slice(1).sort((x, y) => y.length - x.length)[0]
      await closeSettings()
      const chosen = await ev(`window.api.voice.setVoice(${JSON.stringify(longest)}, 125)`)
      check('G: (set up) the longest voice name of this computer is chosen, at 125%', chosen.ok === true && chosen.status.voice === longest, show(chosen))
    }
    const overlap = (a, b) => !(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top)
    for (const width of [420, 280]) {
      await page.send('Emulation.setDeviceMetricsOverride', { width, height: 800, deviceScaleFactor: 1, mobile: false })
      await sleep(500)
      const box = await ev(`(() => { const r = (s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return { left: b.left, right: b.right, top: b.top, bottom: b.bottom } }; return { inner: innerWidth, scroll: document.documentElement.scrollWidth, input: r('.composer-input'), mic: r('.composer-mic'), send: r('.composer-button') } })()`)
      check(`G: at ${width} px the page does not scroll sideways and the box, the microphone and Send are inside it, not on top of one another`, box.scroll <= box.inner && box.mic && box.input && box.send && [box.input, box.mic, box.send].every((b) => b.left >= 0 && b.right <= box.inner + 0.5) && !overlap(box.mic, box.input) && !overlap(box.mic, box.send), show(box))
      if (shots) await page.screenshot(`${shots}/15-6-composer-${width}.png`)
      await openSettings()
      const fit = await ev(`(() => { const d = document.querySelector('dialog.settings'); const s = ${VS}; const dr = d.getBoundingClientRect(); const limit = dr.left + d.clientWidth + 1; const out = (root) => [...root.querySelectorAll('*')].filter((e) => !e.closest('.settings-nav') /* (Stage 24) the list of panes scrolls inside itself */ && e.getBoundingClientRect().right > limit).map((e) => e.tagName + '.' + e.className + ':' + (e.textContent || '').slice(0, 24) + ':' + Math.round(e.getBoundingClientRect().right)); return { dialogScrollsSideways: d.scrollWidth > d.clientWidth + 1, scrollWidth: d.scrollWidth, clientWidth: d.clientWidth, limit: Math.round(limit), bad: out(s).slice(0, 8), badElsewhere: out(d).filter((x) => !out(s).includes(x)).slice(0, 3), elsewhereNotUsage: [...d.querySelectorAll('*')].filter((e) => !e.closest('.settings-nav') && e.getBoundingClientRect().right > limit && !s.contains(e) && !e.closest('table.settings-usage')).map((e) => e.tagName + '.' + e.className).slice(0, 5), selects: [...s.querySelectorAll('select')].map((e) => Math.round(e.getBoundingClientRect().width)) } })()`)
      check(`G: at ${width} px the Voice section fits inside Settings: nothing of it sticks out, and nothing else sticks out but, with big numbers, the cost column of the older Usage table (a finding, below)`, fit.bad.length === 0 && fit.elsewhereNotUsage.length === 0 && (fit.dialogScrollsSideways === false || fit.badElsewhere.every((x) => /settings-usage|^TBODY|^TR|^TABLE/.test(x))), show(fit))
      if (fit.dialogScrollsSideways) console.log(`FINDING (not Stage 15): at ${width} px Settings scrolls sideways by ${fit.scrollWidth - fit.clientWidth} px: the cost column of the Usage table (${fit.badElsewhere[0]}) with a three-digit token count`)
      await ev(`${VS}.scrollIntoView({ block: 'start' })`)
      await sleep(200)
      if (shots) await page.screenshot(`${shots}/15-6-voice-${width}.png`)
      await closeSettings()
    }
    await page.send('Emulation.clearDeviceMetricsOverride')
    if (longest !== null) await ev(`window.api.voice.setVoice(null, 100)`)
    await sleep(300)
  })

  // ============ H. switching off, a damaged file ============
  await part('H', async () => {
    await openSettings()
    await Q.reset()
    await clickSwitch('Speak to type')
    await sleepUntil(async () => (await section()).listen.on === false, 4000)
    let s = await section()
    check('H: switching Speak to type off is at once, asks nothing, and the page says so', s.listen.on === false && s.notice === 'Speak to type is off.' && (await Q.count()) === 0 && voiceFile()?.listen === false, show([s.notice, await Q.count(), voiceFile()]))
    await closeSettings()
    check('H: the microphone button is gone from the message box', (await composer()).mic === false)
    await openSettings()
    await clickSwitch('Read aloud')
    await sleepUntil(async () => (await section()).speak.on === false, 4000)
    await closeSettings()
    check('H: with Read aloud off the buttons are gone from the replies', (await assistantActions()).every((a) => !a.includes('Read aloud')), show(await assistantActions()))
    // a damaged file
    writeFileSync(VOICE_FILE, '{ this is not json')
    await openSettings()
    await sleep(600)
    s = await section()
    check('H: a damaged voice.json is said plainly: both switches off and not pressable, a "Start again..." button, no voice or speed to choose', /could not be read/.test(s.problem ?? '') && s.listen?.disabled === true && s.speak?.disabled === true && s.listen.on === false && s.voice === null, show(s))
    await clickText('Start again...')
    await sleep(250)
    s = await section()
    check('H: "Start again..." asks first (Yes, start again / No) and changes nothing yet', /Start again with both switches off\?/.test(s.problem ?? '') && /Yes, start again/.test(s.problem ?? ''), show(s.problem))
    await clickText('Yes, start again')
    await sleepUntil(async () => (await section()).problem === null, 5000)
    s = await section()
    check('H: yes starts again: both switches off, no problem shown, the file is good', s.problem === null && s.listen.on === false && s.speak.on === false && voiceFile()?.listen === false && voiceFile()?.version === 1, show([s.problem, voiceFile()]))
    await closeSettings()
  })

  check('I: the page logged no errors and no warnings in the whole run', page.problems.length === 0, show(page.problems))
  if (savedClipboard !== null) await setClipboard(savedClipboard)
} catch (error) {
  ok = false
  check(`the suite stopped before its end: ${String(error?.stack ?? error).slice(0, 700)}`, false)
}
main.close()
const passed = check.summary()
process.exit(passed && ok ? 0 : 1)
