// Slice 5.4: each reply records which provider and model wrote it; the saved file is version 2; a version 1 file (Stages 2-4) is read as
// version 2 without being rewritten. In the real window, against the Stage 5 mock. Run through run54.mjs, which seeds the version 1 file.
// Needs USER_DATA_DIR (a scratch profile), MOCK_PORT, APP_LOG, TEMP (the seed's manifest) and a key saved by setup-key.mjs.
import './ts-resolve.mjs'
import { connect, checker, sleep } from './cdp.mjs'
import { assertScratchProfile } from './profile-guard.mjs'
import { h4 } from './lib4.mjs'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'

const port = Number(process.argv[3] ?? 9222)
const { MOCK_PORT, USER_DATA_DIR: userData, APP_LOG } = process.env
if (!MOCK_PORT || !userData) throw new Error('MOCK_PORT and USER_DATA_DIR must be set')
const mock = `http://127.0.0.1:${MOCK_PORT}`
const seed = JSON.parse(readFileSync(join(process.env.TEMP ?? '.', 'frontier-5-4-seed.json'), 'utf8'))
const check = checker()
const page = await connect(port)
await assertScratchProfile()
const H = h4(page, { userData, mockUrl: mock })
const ev = H.ev
const OPUS = 'claude-opus-5-5', SONNET = 'claude-sonnet-5-5'
const screen = () => ev(`[...document.querySelectorAll('.message')].map((m) => ({ role: m.classList.contains('message-user') ? 'user' : 'assistant', caption: m.querySelector('.message-model')?.textContent ?? null, text: m.querySelector('.bubble')?.textContent ?? '', note: m.querySelector('.message-note')?.textContent ?? null }))`)
const captions = async () => (await screen()).filter((m) => m.role === 'assistant').map((m) => m.caption)
const answerers = (conv) => conv.messages.filter((m) => m.role === 'assistant').map((m) => `${m.provider}/${m.model}`)
const stripAnswerer = ({ provider, model, ...rest }) => rest
await page.waitFor(`!!document.querySelector('.header-select, .app-badge')`, { timeoutMs: 20000 })
await sleep(500)
let successes = 0

// ============ A. a conversation saved by Stages 2-4 (version 1) ============
check('the seeded version 1 conversation is the only file, byte for byte as written, with its original modification time (the app already scanned the folder when it started)', JSON.stringify(H.convFiles()) === JSON.stringify([`${seed.id}.json`]) && H.sha(seed.id) === seed.sha && H.mtime(seed.id) === seed.mtime)
const before = { sha: H.sha(seed.id), mtime: seed.mtime } // the mtime from before the app started: the app scans the folder at startup
await H.openHistory()
check('History lists it, with its title', (await H.rows()).some((r) => r.title === seed.title))
await H.clickRow(seed.title)
await sleep(400)
const old = await screen()
check('opened: its six messages are on screen, as written', old.length === 6 && old[1].text === 'an old answer' && old[3].note === 'The service had a problem. (request req_old)' && old[5].note === 'Stopped', JSON.stringify(old.map((m) => [m.role, m.text.slice(0, 14)])))
check('...and no reply names a model (the old file does not know which one wrote it)', (await captions()).every((c) => c === null))
await sleep(1500)
check('opening it wrote nothing: same bytes, same modification time (reading never writes, D-016)', H.sha(seed.id) === before.sha && H.mtime(seed.id) === before.mtime)
await H.sendAndWait('a new question in the old conversation')
successes++
const upgraded = await H.waitConv(seed.id, (c) => c.messages.length === seed.messages + 2 && c.messages.at(-1).status === 'done')
check('after the next message the file is saved as version 2', upgraded.version === 2, String(upgraded.version))
const oldPart = upgraded.messages.slice(0, seed.messages)
check('every OLD assistant message now says provider "anthropic" and model null (a known fact and an unknown one, not an invented model)', oldPart.filter((m) => m.role === 'assistant').every((m) => m.provider === 'anthropic' && m.model === null), JSON.stringify(oldPart.filter((m) => m.role === 'assistant').map((m) => [m.provider, m.model])))
check('...and the old messages are otherwise exactly as they were (text, status, error)', JSON.stringify(oldPart.map(stripAnswerer)) === JSON.stringify(seed.original), JSON.stringify(oldPart.map(stripAnswerer)).slice(0, 160))
const fresh = upgraded.messages.at(-1)
check('the NEW reply says who wrote it: anthropic, claude-opus-5-5 (the model that was selected)', fresh.provider === 'anthropic' && fresh.model === OPUS, JSON.stringify([fresh.provider, fresh.model]))
check('the person\'s own messages carry neither field', upgraded.messages.filter((m) => m.role === 'user').every((m) => !('provider' in m) && !('model' in m)))
check('every assistant message has both fields (null where unknown), in the file', upgraded.messages.filter((m) => m.role === 'assistant').every((m) => 'provider' in m && 'model' in m))
check('on screen the new reply names its model above it, and the old replies still say nothing', JSON.stringify(await captions()) === JSON.stringify([null, null, null, 'Claude Opus 5.5']), JSON.stringify(await captions()))
check('one file, no temporary leftovers', JSON.stringify(H.files()) === JSON.stringify([`${seed.id}.json`]), JSON.stringify(H.files()))

// ============ B. a new conversation: the model per reply, and the names on screen ============
await H.clickHeader('New chat')
await sleep(300)
await H.sendAndWait('one: first, with Opus')
successes++
await H.sendAndWait('two: second, still Opus')
successes++
await H.chooseInPage(SONNET)
await H.settle(SONNET)
await H.sendAndWait('three: third, with Sonnet')
successes++
const bFound = await H.waitFirst('one: first', (c) => c.messages.length === 6 && c.messages[5].status === 'done')
check('the file records the model of each reply: Opus, Opus, Sonnet', JSON.stringify(answerers(bFound.conv)) === JSON.stringify([`anthropic/${OPUS}`, `anthropic/${OPUS}`, `anthropic/${SONNET}`]), JSON.stringify(answerers(bFound.conv)))
check('...as version 2', bFound.conv.version === 2)
check('on screen: the first reply names its model, the second (same model) does not, the third (a change) does', JSON.stringify(await captions()) === JSON.stringify(['Claude Opus 5.5', null, 'Claude Sonnet 5.5']), JSON.stringify(await captions()))
const reqs = await H.mockReqs()
check('the requests really went to those models', JSON.stringify(reqs.slice(-3).map((r) => r.body.model)) === JSON.stringify([OPUS, OPUS, SONNET]), JSON.stringify(reqs.slice(-3).map((r) => r.body.model)))
await page.screenshot(`${process.argv[2]}/5-4-captions.png`)
await page.send('Page.reload')
await sleep(1500)
await page.waitFor(`!!document.querySelector('.header-select, .app-badge')`, { timeoutMs: 20000 })
await H.openHistory()
await H.clickRow('one: first, with Opus')
await sleep(400)
check('after a reload, opening it from History shows the same names in the same places', JSON.stringify(await captions()) === JSON.stringify(['Claude Opus 5.5', null, 'Claude Sonnet 5.5']), JSON.stringify(await captions()))

// ============ C. a reply that fails, or is stopped, still says which model was asked ============
await H.sendAndWait('[[mock:401]] this one is refused')
const failed = await H.waitFirst('one: first', (c) => c.messages.length === 8 && c.messages[7].status === 'error')
check('a refused request: the reply is an error that says which model was asked (Sonnet, as selected)', failed.conv.messages[7].provider === 'anthropic' && failed.conv.messages[7].model === SONNET && /not accepted \(401\)/.test(failed.conv.messages[7].error), JSON.stringify(failed.conv.messages[7]).slice(0, 160))
await H.send('[[mock:slow]] and this one is stopped')
await page.waitFor(`document.querySelector('.message-assistant:last-child .bubble')?.textContent.length > 20`, { timeoutMs: 8000 })
await page.click('.composer-button.stop, .composer-button[aria-label="Stop"], .composer-button:not([type=submit])').catch(() => {})
await H.waitReady()
const stopped = await H.waitFirst('one: first', (c) => c.messages.length === 10 && c.messages[9].status === 'stopped' && c.messages[9].content.length > 20)
check('a stopped reply keeps its model too', stopped.conv.messages[9].model === SONNET && stopped.conv.messages[9].provider === 'anthropic')
// no key at all: the reply fails before anything is sent, and still names the model that would have answered
const noKeyKey = 'test-' + randomBytes(24).toString('hex')
await ev(`window.api.settings.clearApiKey('anthropic')`)
await sleep(200)
const sent0 = (await H.mockReqs()).length
await H.sendAndWait('and now with no key at all')
const noKey = await H.waitFirst('one: first', (c) => c.messages.length === 12 && c.messages[11].status === 'error')
check('with no key: an error about the missing key, naming the model that would have answered', /No API key is saved yet/.test(noKey.conv.messages[11].error) && noKey.conv.messages[11].model === SONNET && noKey.conv.messages[11].provider === 'anthropic', JSON.stringify(noKey.conv.messages[11]).slice(0, 200))
check('...and nothing was sent to anyone', (await H.mockReqs()).length === sent0)
await fetch(`${mock}/__expect-key`, { method: 'POST', body: JSON.stringify({ key: noKeyKey }) })
check('a key can be saved again (test key)', (await ev(`window.api.settings.setApiKey('anthropic', ${JSON.stringify(noKeyKey)})`)).ok === true)

// ============ D. the events main sends: "start" comes first, before anything else about the reply ============
await ev(`window.__events = []; window.__off = window.api.chat.onEvent((e) => window.__events.push(e)); 0`)
await H.sendAndWait('events: a normal reply')
successes++
const ok = await ev(`window.__events.map((e) => e.type)`)
const startEvent = await ev(`window.__events[0]`)
check('a normal reply: the first event is "start", then text, then done', ok[0] === 'start' && ok.at(-1) === 'done' && ok.slice(1, -1).every((t) => t === 'text') && ok.length > 2, JSON.stringify(ok))
check('...and "start" names the provider and the model (and nothing else, no key)', JSON.stringify(Object.keys(startEvent).sort()) === '["model","provider","streamId","type"]' && startEvent.provider === 'anthropic' && startEvent.model === SONNET, JSON.stringify(startEvent))
await ev(`window.__events.length = 0; 0`)
await H.sendAndWait('[[mock:401]] events: refused')
const bad = await ev(`window.__events.map((e) => e.type)`)
check('a refused reply: "start" and then "error" (nothing in between)', JSON.stringify(bad) === '["start","error"]', JSON.stringify(bad))
await ev(`window.__events.length = 0; window.api.chat.start({ streamId: 'abcdefgh-bad-1', messages: [] }); 0`)
await sleep(400)
check('a request main refuses before any reply begins gets an "error" only: no "start" (no model was asked)', JSON.stringify(await ev(`window.__events.map((e) => e.type)`)) === '["error"]', JSON.stringify(await ev(`window.__events.map((e) => e.type)`)))
await ev(`window.__off(); 0`)

// ============ E. what the page may hand over to be saved ============
const sid = await ev(`crypto.randomUUID()`)
const save = (messages) => ev(`window.api.history.save({ id: ${JSON.stringify(sid)}, messages: ${JSON.stringify(messages)} }).then((r) => r.ok ? 'saved' : 'refused: ' + r.error, (e) => 'threw')`)
const u = (c = 'q') => ({ role: 'user', content: c, status: 'done' })
const a = (extra = {}) => ({ role: 'assistant', content: 'answer', status: 'done', ...extra })
const refusedCases = [
  ['an unknown provider', a({ provider: 'nope', model: OPUS })], ['upper-case provider', a({ provider: 'ANTHROPIC', model: OPUS })], ['a provider that is a number', a({ provider: 5, model: OPUS })],
  ['a model with a space', a({ provider: 'anthropic', model: 'claude opus' })], ['a model in upper case', a({ provider: 'anthropic', model: 'CLAUDE-OPUS' })], ['a model that is a number', a({ provider: 'anthropic', model: 5 })],
  ['a model that is an object', a({ provider: 'anthropic', model: { id: OPUS } })], ['a 65-character model', a({ provider: 'anthropic', model: 'a'.repeat(65) })], ['a model with a path in it', a({ provider: 'anthropic', model: '../x' })],
  ['an empty model', a({ provider: 'anthropic', model: '' })]
]
for (const [name, message] of refusedCases) {
  const r = await save([u(), message])
  check(`a save with ${name} is refused, and no file is created`, r.startsWith('refused') && !H.convFiles().includes(`${sid}.json`), r)
}
check('a save with null provider and null model is accepted (unknown)', (await save([u(), a({ provider: null, model: null })])) === 'saved')
check('...and the file says null and null', (() => { const c = H.readConv(sid); return c.version === 2 && c.messages[1].provider === null && c.messages[1].model === null })())
check('a save with neither field is accepted, and the file gets null and null (never a missing field)', (await save([u(), a()])) === 'saved' && (() => { const c = H.readConv(sid); return c.messages[1].provider === null && c.messages[1].model === null })())
check('a person\'s message that claims a provider and a model: accepted, and the fields are dropped', (await save([{ ...u(), provider: 'anthropic', model: OPUS }, a({ provider: 'anthropic', model: OPUS })])) === 'saved' && (() => { const c = H.readConv(sid); return !('provider' in c.messages[0]) && !('model' in c.messages[0]) && c.messages[1].model === OPUS })())
check('extra fields on a reply are dropped (the file has exactly the documented ones)', (await save([u(), a({ provider: 'anthropic', model: SONNET, evil: { x: 1 }, usage: 99 })])) === 'saved' && JSON.stringify(Object.keys(H.readConv(sid).messages[1]).sort()) === '["content","model","provider","role","status"]', JSON.stringify(Object.keys(H.readConv(sid).messages[1])))
check('a model the registry has never heard of is a fine value to save (retired models must stay readable): it is kept as written', (await save([u(), a({ provider: 'anthropic', model: 'claude-retired-1' })])) === 'saved' && H.readConv(sid).messages[1].model === 'claude-retired-1')

// ============ F. the usage of each reply is in the app's log (once, only for replies that finished) ============
if (APP_LOG) {
  const log = readFileSync(APP_LOG, 'utf8')
  const lines = log.split('\n').filter((l) => /^Reply from /.test(l))
  check(`one usage line for each reply that finished (${successes}), none for the refused, stopped or key-less ones`, lines.length === successes, `${lines.length} lines: ${lines.slice(0, 2).join(' | ')}`)
  check('...each says provider/model and the four numbers (the mock reports 25 in, 12 out)', lines.every((l) => /^Reply from anthropic\/claude-[a-z0-9-]+ used 25 input, 0 cache-read, 0 cache-write and 12 output tokens\.$/.test(l)), lines[0])
  check('...and the log holds no key', !log.includes(noKeyKey))
}
check('no console errors, warnings or exceptions in the page', page.problems.length === 0, page.problems.join(' | '))
const passed = check.summary()
page.close()
process.exit(passed ? 0 : 1)
