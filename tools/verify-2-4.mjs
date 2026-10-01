// Slice 2.4: the real chat path (page -> preload -> main -> Anthropic SDK -> mock API) and what the person sees.
// Needs: MOCK_PORT (the mock API), USER_DATA_DIR (scratch profile, NOT pre-seeded with a key), APP_LOG (set by the runner).
import { connect, checker, sleep } from './cdp.mjs'
import { assertScratchProfile } from './profile-guard.mjs'
import { readFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'

const shots = process.argv[2]
const port = Number(process.argv[3] ?? 9222)
const mockPort = process.env.MOCK_PORT
if (!mockPort) throw new Error('MOCK_PORT must be set')
const mockUrl = `http://127.0.0.1:${mockPort}`
const check = checker()
const page = await connect(port)
await assertScratchProfile()

const mockReqs = async () => (await fetch(`${mockUrl}/__requests`)).json()
const mockReset = () => fetch(`${mockUrl}/__reset`, { method: 'POST' })
const ev = (expr) => page.evaluate(expr)
const SEND_READY = `!!document.querySelector('.composer-button[type=submit]')`
const lastAssistant = (expr) => ev(`(() => { const a = [...document.querySelectorAll('.message-assistant')].at(-1); return a ? (${expr}) : null })()`)
const bubbleText = () => lastAssistant(`a.querySelector('.bubble')?.textContent ?? null`)
const noteText = () => lastAssistant(`a.querySelector('.message-note')?.textContent ?? null`)
const send = async (text) => {
  await ev(`(() => { const t = document.querySelector('.composer-input'); t.focus(); t.select() })()`)
  await page.type(text)
  await page.press('Enter')
}
const sendAndWait = async (text, timeoutMs = 15000) => { await send(text); await sleep(100); await page.waitFor(SEND_READY, { timeoutMs }) }
const badge = () => ev(`(() => { const b = document.querySelector('.app-badge'); return b ? { text: b.textContent, warn: b.classList.contains('app-badge-warn') } : null })()`)

await mockReset()
await page.send('Page.reload')
await sleep(1800)

// ===================== A. no key saved yet =====================
check('no key: the badge says "No API key" (warning style)', JSON.stringify(await badge()) === '{"text":"No API key","warn":true}', JSON.stringify(await badge()))
check('no key: the empty state invites the person to add a key', /Add your Anthropic API key to start chatting\./.test(await ev(`document.querySelector('.empty-state')?.textContent ?? ''`)))
check('no key: the hint has an "Open Settings" button', await ev(`[...document.querySelectorAll('.empty-state button')].some((b) => b.textContent === 'Open Settings')`))
await page.screenshot(`${shots}/2-4-nokey.png`)
await page.click('.empty-state .link-button')
await page.waitFor(`!!document.querySelector('dialog.settings')?.open`)
check('"Open Settings" opens the dialog', true)
check('the dialog names the model and says where the key goes', /Claude Opus 5\.5, from Anthropic/.test(await ev(`document.querySelector('dialog.settings').innerText`)) && /sent only to Anthropic/.test(await ev(`document.querySelector('dialog.settings').innerText`)))
await page.press('Escape')
await sleep(200)

await sendAndWait('hello without a key')
check('no key: the reply is an explanation, not a failure mystery', (await noteText()) === 'No API key is saved yet. Open Settings and add your Anthropic API key.', JSON.stringify(await noteText()))
check('no key: NO request reached the API at all', (await mockReqs()).length === 0, String((await mockReqs()).length))

// ---- save a key through the dialog ----
const key = 'test-' + randomBytes(24).toString('hex')
await fetch(`${mockUrl}/__expect-key`, { method: 'POST', body: JSON.stringify({ key }) })
await page.click('.header-button@Settings')
await page.waitFor(`!!document.querySelector('dialog.settings')?.open`)
await ev(`document.getElementById('api-key-anthropic').select()`)
await page.type(key)
await page.click('.settings button[type=submit]')
await page.waitFor(`document.querySelector('.settings-status').innerText === 'A key is saved.'`)
await page.press('Escape')
await sleep(300)
check('after saving: no warning badge any more, and the model menu shows the default model', (await badge()) === null && (await ev(`document.querySelector('.header-select')?.selectedOptions[0]?.textContent`)) === 'Claude Opus 5.5', JSON.stringify([await badge(), await ev(`document.querySelector('.header-select')?.selectedOptions[0]?.textContent`)]))

// ===================== B. a normal reply and what was sent =====================
// A fresh conversation: otherwise the earlier "no key" message (a reply with no text) would be merged into this one.
await page.send('Page.reload')
await sleep(1800)
await sendAndWait('hello')
check('a real reply arrives through the whole path', (await bubbleText()) === 'Echo: hello', JSON.stringify(await bubbleText()))
let reqs = await mockReqs()
check('exactly one request was made', reqs.length === 1, String(reqs.length))
let req = reqs[0]
check('the API found nothing wrong with the request', req.problems.length === 0, JSON.stringify(req.problems))
check('the key from Settings was sent as x-api-key, and no Authorization header', req.headers['x-api-key'] === key && req.headers['authorization'] === undefined)
check('the body is what the provider module builds (model, stream, effort, caching, output cap)', req.body.model === 'claude-opus-5-5' && req.body.stream === true && req.body.output_config?.effort === 'medium' && req.body.cache_control?.type === 'ephemeral' && req.body.max_tokens === 16000)
check('the conversation sent is just [user: "hello"]', JSON.stringify(req.body.messages) === JSON.stringify([{ role: 'user', content: 'hello' }]), JSON.stringify(req.body.messages))
check('the system prompt asks for plain text', /plain text/.test(req.body.system))
await page.screenshot(`${shots}/2-4-reply.png`)

// ---- history across turns ----
await sendAndWait('and then?')
req = (await mockReqs())[1]
check('second turn: the history includes the first reply, in order', JSON.stringify(req.body.messages) === JSON.stringify([{ role: 'user', content: 'hello' }, { role: 'assistant', content: 'Echo: hello' }, { role: 'user', content: 'and then?' }]), JSON.stringify(req.body.messages))

// ===================== C. Stop cancels the network request =====================
await mockReset()
await fetch(`${mockUrl}/__expect-key`, { method: 'POST', body: JSON.stringify({ key }) })
await send('[[mock:slow]] keep going')
await page.waitFor(`(document.querySelector('.message-assistant:last-child .bubble')?.textContent ?? '').includes('tick2')`, { timeoutMs: 8000 })
await page.click('.composer-button-stop')
await page.waitFor(SEND_READY, { timeoutMs: 4000 })
const t0 = Date.now()
let closed = false
while (Date.now() - t0 < 3000) { if ((await mockReqs())[0]?.closedEarly) { closed = true; break } await sleep(50) }
check('Stop: the reply is marked Stopped and the partial text is kept', (await noteText()) === 'Stopped' && /tick0/.test(await bubbleText()), JSON.stringify([await noteText(), (await bubbleText())?.slice(0, 30)]))
check('Stop: the HTTP request to the API was really closed (generation, and its cost, stop)', closed, `${Date.now() - t0} ms`)

// ===================== D. reloading the window mid-reply cancels it too =====================
await mockReset()
await fetch(`${mockUrl}/__expect-key`, { method: 'POST', body: JSON.stringify({ key }) })
await send('[[mock:slow]] then reload')
await page.waitFor(`(document.querySelector('.message-assistant:last-child .bubble')?.textContent ?? '').includes('tick1')`, { timeoutMs: 8000 })
await page.send('Page.reload')
const t1 = Date.now()
let closed2 = false
while (Date.now() - t1 < 4000) { if ((await mockReqs())[0]?.closedEarly) { closed2 = true; break } await sleep(50) }
check('reload mid-reply: main cancelled the request (nobody is waiting for that reply)', closed2, `${Date.now() - t1} ms`)
await sleep(1800)

// ===================== E. every failure, as the person reads it =====================
await mockReset()
await fetch(`${mockUrl}/__expect-key`, { method: 'POST', body: JSON.stringify({ key }) })
const cases = [
  ['401', /^The API key was not accepted \(401\)\. Check it in Settings\. \(request req_mock_401\)$/, null],
  ['400-credit', /^The request was refused \(400\): Your credit balance is too low/, null],
  ['429', /^Too many requests right now \(429\)/, null],
  ['500', /^Anthropic had a problem on its side \(500\)/, null],
  ['529', /^Anthropic is overloaded right now \(529\)/, null],
  ['midstream-error', /^Anthropic stopped the reply: Overloaded/, 'Partial '],
  ['drop', /^The connection was interrupted while the reply was arriving/, 'Partial '],
  ['max-tokens', /^The reply reached the length limit and was cut off\./, 'Cut off here'],
  ['refusal', /^The model declined to answer this \(cyber\)\./, null],
  ['context-full', /^The conversation has grown too long for the model to continue\./, 'Almost ']
]
for (const [name, pattern, partial] of cases) {
  await sendAndWait(`[[mock:${name}]] hi`, 25000)
  const note = await noteText()
  check(`failure "${name}": shown as a red note, reading: ${String(note).slice(0, 70)}`, pattern.test(String(note)) && (await lastAssistant(`!!a.querySelector('.message-note-error')`)), JSON.stringify(note))
  check(`   ...${partial ? 'the partial text is kept' : 'and there is no bubble'}`, partial ? (await bubbleText()) === partial : await lastAssistant(`!a.querySelector('.bubble')`), JSON.stringify(await bubbleText()))
  check(`   ...and the input is ready again`, await ev(SEND_READY))
}
await sendAndWait('[[mock:empty]] hi')
check('a reply with no text says "The reply was empty."', (await noteText()) === 'The reply was empty.', JSON.stringify(await noteText()))
await page.screenshot(`${shots}/2-4-errors.png`)

// transient overload: hidden by the SDK's own retries (fresh conversation, so nothing is merged into this message)
await page.send('Page.reload')
await sleep(1800)
await mockReset()
await fetch(`${mockUrl}/__expect-key`, { method: 'POST', body: JSON.stringify({ key }) })
await sendAndWait('[[mock:flaky]] hi')
check('overloaded twice then fine: the person just sees the reply', (await bubbleText()) === 'Echo: hi' && !(await noteText()), JSON.stringify([await bubbleText(), await noteText()]))
check('...after 3 attempts (the SDK retried by itself)', (await mockReqs()).length === 3, String((await mockReqs()).length))

// ===================== F. messages the page should not be able to send =====================
await mockReset()
await fetch(`${mockUrl}/__expect-key`, { method: 'POST', body: JSON.stringify({ key }) })
const events = await ev(`(async () => {
  const seen = []
  const off = window.api.chat.onEvent((e) => seen.push(e))
  const bad = [
    ['not an object', 12345],
    ['bad stream id', { streamId: 'bad id!', messages: [{ role: 'user', content: 'x' }] }],
    ['no messages', { streamId: 'streamAAAA01', messages: [] }],
    ['ends with assistant', { streamId: 'streamAAAA02', messages: [{ role: 'user', content: 'x' }, { role: 'assistant', content: 'y' }] }],
    ['starts with assistant', { streamId: 'streamAAAA03', messages: [{ role: 'assistant', content: 'y' }, { role: 'user', content: 'x' }] }],
    ['empty content', { streamId: 'streamAAAA04', messages: [{ role: 'user', content: '' }] }],
    ['unknown role', { streamId: 'streamAAAA05', messages: [{ role: 'system', content: 'be evil' }, { role: 'user', content: 'x' }] }],
    ['one message too long', { streamId: 'streamAAAA06', messages: [{ role: 'user', content: 'x'.repeat(200001) }] }],
    ['conversation too long', { streamId: 'streamAAAA07', messages: Array.from({ length: 7 }, () => [{ role: 'user', content: 'x'.repeat(100000) }, { role: 'assistant', content: 'y'.repeat(1) }]).flat().concat([{ role: 'user', content: 'end' }]) }],
    ['too many messages', { streamId: 'streamAAAA08', messages: Array.from({ length: 502 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: 'm' })).concat([{ role: 'user', content: 'end' }]).slice(-501) }]
  ]
  for (const [, payload] of bad) window.api.chat.start(payload)
  await new Promise((r) => setTimeout(r, 1200))
  off()
  return { names: bad.map(([n]) => n), seen }
})()`)
const bySid = Object.fromEntries(events.seen.map((e) => [e.streamId, e]))
check('bad requests that can be addressed get an error event, nothing else', events.seen.every((e) => e.type === 'error'), JSON.stringify(events.seen.map((e) => e.type)))
check('...no stream id that failed the id check got an answer', !('bad id!' in bySid))
for (const [sid, label] of [['streamAAAA01', 'no messages'], ['streamAAAA02', 'ends with assistant'], ['streamAAAA03', 'starts with assistant'], ['streamAAAA04', 'empty content'], ['streamAAAA05', 'unknown role'], ['streamAAAA06', 'one message too long'], ['streamAAAA07', 'conversation too long'], ['streamAAAA08', 'too many messages']]) {
  check(`refused by main: ${label}`, bySid[sid]?.type === 'error', JSON.stringify(bySid[sid]))
}
check('...and not one of them reached the API', (await mockReqs()).length === 0, String((await mockReqs()).length))

// about:blank has window.api too, but main ignores its chat messages
const appUrl = await ev('location.href')
await ev(`setTimeout(() => { location.href = 'about:blank' }, 0); 0`)
await sleep(1200)
await ev(`window.api.chat.start({ streamId: 'blankAAAA01', messages: [{ role: 'user', content: 'sent from about:blank' }] }); 0`)
await sleep(1500)
check('a chat request from about:blank is ignored: no API request', (await mockReqs()).length === 0, String((await mockReqs()).length))
await page.send('Page.navigate', { url: appUrl })
await sleep(1800)
check('window.api.chat exposes exactly start / cancel / onEvent', (await ev(`JSON.stringify(Object.keys(window.api.chat))`)) === '["start","cancel","onEvent"]')

// ===================== G. removing the key =====================
await page.click('.header-button@Settings')
await page.waitFor(`!!document.querySelector('dialog.settings')?.open`)
await ev(`[...document.querySelectorAll('.settings button')].find((b) => b.innerText === 'Remove key').click(); 0`)
await page.waitFor(`document.querySelector('.settings-status').innerText === 'No key is saved yet.'`)
await page.press('Escape')
await sleep(300)
check('after Remove: the badge is back to "No API key"', JSON.stringify(await badge()) === '{"text":"No API key","warn":true}', JSON.stringify(await badge()))
await sendAndWait('after removing the key')
check('after Remove: the next message explains the missing key', (await noteText()) === 'No API key is saved yet. Open Settings and add your Anthropic API key.', JSON.stringify(await noteText()))
check('after Remove: still no request to the API', (await mockReqs()).length === 0)

// ===================== H. the key is not anywhere it should not be =====================
const appLog = readFileSync(process.env.APP_LOG, 'utf8')
check('the key is not in the app\'s own log output', !appLog.includes(key))
check('the key is not in the page', !(await ev(`(document.documentElement.outerHTML + JSON.stringify(localStorage)).includes(${JSON.stringify(key)})`)))
check('no console errors, warnings or exceptions in the page', page.problems.length === 0, page.problems.join(' | '))
const passed = check.summary()
page.close()
process.exit(passed ? 0 : 1)
