// Slice 5.5: OpenAI as the second provider, in the real window, against the mock (D-022). Two keys in Settings, replies from the
// three OpenAI models and from Claude in ONE conversation, each request carrying only its own provider's key, the errors worded
// for OpenAI, a missing key named per provider, and the usage in the log. Run through run55.mjs (a fresh scratch profile, no key).
// Needs USER_DATA_DIR (scratch), MOCK_PORT (mock-providers.mjs) and APP_LOG. All keys here are invented, never real, never printed.
import './ts-resolve.mjs'
import { connect, checker, sleep } from './cdp.mjs'
import { assertScratchProfile } from './profile-guard.mjs'
import { h4 } from './lib4.mjs'
import { readRegistry } from './lib3.mjs'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'

const port = Number(process.argv[3] ?? 9222)
const { MOCK_PORT, USER_DATA_DIR: userData, APP_LOG } = process.env
if (!MOCK_PORT || !userData) throw new Error('MOCK_PORT and USER_DATA_DIR must be set')
const mock = `http://127.0.0.1:${MOCK_PORT}`
const check = checker()
const page = await connect(port)
await assertScratchProfile()
const H = h4(page, { userData, mockUrl: mock })
const ev = H.ev
const registry = readRegistry()
const byId = Object.fromEntries(registry.models.map((m) => [m.id, m]))
const OPUS = 'claude-opus-5-5'
const [ASTRA, SOL, LUNA] = ['gpt-6-astra', 'gpt-6.1-sol', 'gpt-6-luna']
const keyA = 'test-' + randomBytes(24).toString('hex') // the "Anthropic" key
const keyO = 'test-' + randomBytes(24).toString('hex') // the "OpenAI" key
const credFiles = () => readdirSync(userData).filter((n) => /^credentials/i.test(n)).sort()
const readJson = (name) => JSON.parse(readFileSync(join(userData, name), 'utf8'))
const reqs = () => H.mockReqs()
const sendsOnly = (list) => list.filter((r) => !r.listing)
const captions = () => ev(`[...document.querySelectorAll('.message-assistant')].map((m) => m.querySelector('.message-model')?.textContent ?? null)`)
const expectKeys = async () => {
  await fetch(`${mock}/__expect-key`, { method: 'POST', body: JSON.stringify({ key: keyA }) })
  await fetch(`${mock}/__expect-key`, { method: 'POST', body: JSON.stringify({ key: keyO, provider: 'openai' }) })
}
const sectionOf = (provider) => `[...document.querySelectorAll('dialog.settings form.settings-section')].find((f) => f.querySelector('#api-key-${provider}'))`
const openSettings = async () => { await page.click('.header-button@Settings'); await page.waitFor(`!!document.querySelector('dialog.settings')?.open`) }
const closeSettings = async () => { await page.press('Escape'); await sleep(250) }
// types a key into one provider's section and presses its Save button, for real
const saveKeyInUi = async (provider, key) => {
  await openSettings()
  await ev(`document.getElementById('api-key-${provider}').select()`)
  await page.type(key)
  await ev(`(() => { const b = ${sectionOf(provider)}.querySelector('button[type=submit]'); b.setAttribute('data-click', '1'); b.scrollIntoView({ block: 'center' }) })()`)
  await sleep(150)
  await page.click('[data-click="1"]')
  await page.waitFor(`${sectionOf(provider)}.querySelector('.settings-notice')?.innerText === 'Saved.'`, { timeoutMs: 8000 })
  await ev(`document.querySelector('[data-click="1"]')?.removeAttribute('data-click'); 0`)
  await closeSettings()
}
await page.waitFor(`!!document.querySelector('.header-select, .app-badge')`, { timeoutMs: 20000 })
await sleep(400)

// ============ A. a fresh profile ============
const st0 = await ev(`window.api.settings.getStatus()`)
check('two providers, Anthropic then OpenAI, neither has a key', JSON.stringify(st0.providers) === '[{"id":"anthropic","name":"Anthropic","hasKey":false},{"id":"openai","name":"OpenAI","hasKey":false}]', JSON.stringify(st0.providers))
check('the menu lists all seven models, the three OpenAI ones last, by their registry names', JSON.stringify((await H.menu()).labels) === JSON.stringify(registry.models.map((m) => m.label)) && registry.models.slice(4).every((m) => m.provider === 'openai'), JSON.stringify((await H.menu()).labels))
check('the default model is still Claude Opus 5.5, so the badge asks for the ANTHROPIC key', (await H.badges()).some((b) => b.text === 'No API key' && b.title === 'Open Settings to add your Anthropic API key.'), JSON.stringify(await H.badges()))

// ============ B. a key for each provider, saved through the real Settings dialog ============
await saveKeyInUi('anthropic', keyA)
let badges = await H.badges()
check('with only the Anthropic key, Claude needs nothing more: no badge', badges.length === 0, JSON.stringify(badges))
await saveKeyInUi('openai', keyO)
await expectKeys()
check('two key files, one per provider, and nothing else', JSON.stringify(credFiles()) === '["credentials.anthropic.json","credentials.openai.json"]', JSON.stringify(credFiles()))
const fa = readJson('credentials.anthropic.json')
const fo = readJson('credentials.openai.json')
check('each file says which provider it is for (version 2), and holds a key that is encrypted, not plain', fa.provider === 'anthropic' && fo.provider === 'openai' && fa.version === 2 && fo.version === 2 && ![fa, fo].some((f) => JSON.stringify(f).includes(keyA) || JSON.stringify(f).includes(keyO)))
const st1 = await ev(`window.api.settings.getStatus()`)
check('the status says both providers have a key, and tells the page no key', JSON.stringify(st1.providers.map((p) => p.hasKey)) === '[true,true]' && !JSON.stringify(st1).includes(keyA) && !JSON.stringify(st1).includes(keyO))
await openSettings()
check('Settings: two sections, each says "A key is saved."', (await ev(`[...document.querySelectorAll('dialog.settings form.settings-section')].map((f) => f.querySelector('.settings-status')?.innerText).join('|')`)) === 'A key is saved.|A key is saved.')
// Test key, for OpenAI, through the real button: it lists models with the SAVED OpenAI key (a free call)
const before = (await reqs()).length
await ev(`(() => { const b = [...${sectionOf('openai')}.querySelectorAll('button')].find((x) => x.innerText === 'Test key'); b.setAttribute('data-click', '1'); b.scrollIntoView({ block: 'center' }) })()`)
await sleep(150)
await page.click('[data-click="1"]')
await page.waitFor(`/accepted/.test(${sectionOf('openai')}.querySelector('.settings-notice')?.innerText ?? '')`, { timeoutMs: 8000 })
await ev(`document.querySelector('[data-click="1"]')?.removeAttribute('data-click'); 0`)
const noticeText = await ev(`${sectionOf('openai')}.querySelector('.settings-notice').innerText`)
check('Test key (OpenAI): "The key was accepted. OpenAI lists 8 models for it."', noticeText === 'The key was accepted. OpenAI lists 8 models for it.', noticeText)
const listing = (await reqs()).slice(before)
check('...one GET /v1/models, to the OpenAI side, with the OpenAI key as a Bearer token and no x-api-key', listing.length === 1 && listing[0].provider === 'openai' && listing[0].listing === true && listing[0].headers.authorization === `Bearer ${keyO}` && listing[0].headers['x-api-key'] === undefined, JSON.stringify(listing.map((r) => [r.provider, r.url])))
await closeSettings()

// ============ C. the three OpenAI models, each answering through the whole path ============
const start = (await reqs()).length
for (const id of [ASTRA, SOL, LUNA]) {
  await H.chooseInPage(id)
  await H.settle(id)
  await H.sendAndWait(`hello ${id}`)
  const r = sendsOnly((await reqs()).slice(start)).at(-1)
  const m = byId[id]
  check(`${m.label}: a reply arrives, with no note`, (await H.bubbleText()) === `Echo: hello ${id}` && !(await H.noteText()), JSON.stringify([await H.bubbleText(), await H.noteText()]))
  check(`${m.label}: the request went to OpenAI's Responses API for ${id}, which the strict mock accepts`, r?.provider === 'openai' && r.body.model === id && r.problems.length === 0, JSON.stringify({ provider: r?.provider, model: r?.body.model, problems: r?.problems }))
  check(`${m.label}: the OpenAI key as a Bearer token, no x-api-key, no organization or project header`, r.headers.authorization === `Bearer ${keyO}` && !r.headers['x-api-key'] && !r.headers['openai-organization'] && !r.headers['openai-project'], JSON.stringify(Object.keys(r.headers)))
  check(`${m.label}: nothing kept on OpenAI's side (store false), the reply ceiling is 16000, effort "${m.effort}" as the registry says`, r.body.store === false && r.body.max_output_tokens === 16000 && r.body.reasoning?.effort === m.effort, JSON.stringify({ store: r.body.store, max: r.body.max_output_tokens, reasoning: r.body.reasoning }))
  check(`${m.label}: the system prompt is "instructions" and does not call the assistant Claude; the conversation is plain role and content`, /^You are an AI assistant/.test(r.body.instructions) && !/Claude/.test(r.body.instructions) && r.body.input.every((x) => Object.keys(x).join() === 'role,content'), JSON.stringify(r.body.input).slice(0, 120))
}
const onlyOpenAI = sendsOnly((await reqs()).slice(start))
check('these three replies sent exactly three requests, all to OpenAI (Anthropic was not called at all)', onlyOpenAI.length === 3 && onlyOpenAI.every((r) => r.provider === 'openai'), JSON.stringify(onlyOpenAI.map((r) => r.provider)))
check('the names above the replies: each model is named, because it changes every time', JSON.stringify(await captions()) === JSON.stringify(['GPT-6 Astra', 'GPT-6.1 Sol', 'GPT-6 Luna']), JSON.stringify(await captions()))
await page.screenshot(`${process.argv[2]}/5-5-openai.png`)

// ============ D. back to Claude, in the same conversation ============
await H.chooseInPage(OPUS)
await H.settle(OPUS)
await H.sendAndWait('and now Claude, who has read all of it')
const claude = sendsOnly(await reqs()).at(-1)
check('the Anthropic request carries the whole conversation, the OpenAI replies included, as plain turns', claude.provider === 'anthropic' && JSON.stringify(claude.body.messages.map((m) => m.role)) === '["user","assistant","user","assistant","user","assistant","user"]' && /Echo: hello gpt-6.1-sol/.test(JSON.stringify(claude.body.messages)), JSON.stringify(claude.body.messages.map((m) => m.role)))
check('...with the Anthropic key in x-api-key and no Authorization header', claude.headers['x-api-key'] === keyA && claude.headers.authorization === undefined && claude.problems.length === 0, JSON.stringify(claude.problems))
check('...and the new reply is named, because the model changed back', (await captions()).at(-1) === 'Claude Opus 5.5' && (await H.bubbleText()) === 'Echo: and now Claude, who has read all of it', JSON.stringify(await captions()))
const saved = await H.waitFirst('hello gpt-6-astra', (c) => c.messages.length === 8 && c.messages[7].status === 'done')
check('the file records who wrote each reply: three OpenAI models, then Claude', JSON.stringify(saved.conv.messages.filter((m) => m.role === 'assistant').map((m) => `${m.provider}/${m.model}`)) === JSON.stringify([`openai/${ASTRA}`, `openai/${SOL}`, `openai/${LUNA}`, `anthropic/${OPUS}`]), JSON.stringify(saved.conv.messages.filter((m) => m.role === 'assistant').map((m) => `${m.provider}/${m.model}`)))
check('...as version 3', saved.conv.version === 3)

// ============ E. OpenAI's errors, in this app's words ============
await H.chooseInPage(SOL)
await H.settle(SOL)
const errors = [
  ['[[mock:401]] refused', /^The API key was not accepted \(401\)\. Check it in Settings\. \(request req_mock_oai_401\)$/],
  ['[[mock:429-quota]] no credit', /^Your OpenAI account has no credit left, or has reached its spending limit \(429\)\. Check your billing with OpenAI\. \(request /],
  ['[[mock:429]] too fast', /^Too many requests right now \(429\)\. Wait a moment and try again\./],
  ['[[mock:500]] their fault', /^OpenAI had a problem on its side \(500\)\. Try again in a moment\./],
  ['[[mock:refusal]] declined', /^The model declined to answer this\./],
  ['[[mock:incomplete-max]] too long', /^The reply reached the length limit and was cut off\./]
]
for (const [text, pattern] of errors) {
  await H.sendAndWait(text)
  const note = await H.noteText()
  check(`${text.split(']] ')[0]}]]: ${pattern.source.slice(0, 50).replace(/\\/g, '')}...`, pattern.test(note ?? ''), JSON.stringify(note))
}
check('an OpenAI error never shows the key, and the page cannot read it', !(await ev(`document.body.innerText`)).includes(keyO) && !(await ev(`document.body.innerText`)).includes(keyA))
await H.sendAndWait('[[mock:echo-key]] a mock that repeats the whole key')
const scrubbed = await H.noteText()
check("a provider that repeats the whole key in its (401) error: the page is shown the app's own sentence, with no trace of the key (the scrubbing itself is checked in provider-openai-test-5)", !!scrubbed && /^The API key was not accepted \(401\)/.test(scrubbed) && !scrubbed.includes(keyO), JSON.stringify(scrubbed))
const afterErrors = await H.waitFirst('hello gpt-6-astra', (c) => c.messages.length >= 8 + 14 && c.messages.at(-1).status === 'error')
check('each failed reply is saved with its error and with openai/gpt-6.1-sol as the model that was asked', afterErrors.conv.messages.slice(8).filter((m) => m.role === 'assistant').every((m) => m.provider === 'openai' && m.model === SOL), JSON.stringify(afterErrors.conv.messages.slice(8).filter((m) => m.role === 'assistant').map((m) => [m.provider, m.model, m.status])))

// ============ F. a key missing for ONE provider is said per provider ============
await ev(`window.api.settings.clearApiKey('openai')`)
await sleep(300)
const st2 = await ev(`window.api.settings.getStatus()`)
check('removing the OpenAI key leaves the Anthropic one: [true, false], and only the Anthropic file is left', JSON.stringify(st2.providers.map((p) => p.hasKey)) === '[true,false]' && JSON.stringify(credFiles()) === '["credentials.anthropic.json"]', JSON.stringify(credFiles()))
await page.send('Page.reload')
await sleep(1500)
await page.waitFor(`!!document.querySelector('.header-select, .app-badge')`, { timeoutMs: 20000 })
check('a GPT model is selected and has no key: the badge names OpenAI', (await H.badges()).some((b) => b.text === 'No API key' && b.title === 'Open Settings to add your OpenAI API key.'), JSON.stringify(await H.badges()))
check('...the empty chat (after the reload) says to add the OpenAI key', /Add your OpenAI API key to start chatting\./.test(await ev(`document.querySelector('.empty-state')?.textContent ?? ''`)))
const sent0 = sendsOnly(await reqs()).length
await H.sendAndWait('and now with no OpenAI key')
check('a reply with no key for its provider: the note says to add the OpenAI key, and nothing is sent to anyone', /^No API key is saved yet\. Open Settings and add your OpenAI API key\.$/.test((await H.noteText()) ?? '') && sendsOnly(await reqs()).length === sent0, JSON.stringify(await H.noteText()))
await H.chooseInPage(OPUS)
await H.settle(OPUS)
check('choosing Claude again: no badge, because the Anthropic key is still saved', (await H.badges()).length === 0, JSON.stringify(await H.badges()))
await H.sendAndWait('claude still works')
check('...and Claude answers (the earlier unanswered message travels with this one, D-013)', (await H.bubbleText()) === 'Echo: and now with no OpenAI key\n\nclaude still works' && sendsOnly(await reqs()).at(-1).headers['x-api-key'] === keyA)

// ============ G. the two keys never crossed, and the log ============
const all = sendsOnly(await reqs()).concat((await reqs()).filter((r) => r.listing))
const openaiRecords = all.filter((r) => r.provider === 'openai')
const anthropicRecords = all.filter((r) => r.provider === 'anthropic')
check('every request to OpenAI carried the OpenAI key and never the Anthropic one', openaiRecords.length >= 10 && openaiRecords.every((r) => r.headers.authorization === `Bearer ${keyO}` && !JSON.stringify(r).includes(keyA)), `${openaiRecords.length} requests`)
check('every request to Anthropic carried the Anthropic key and never the OpenAI one', anthropicRecords.length >= 2 && anthropicRecords.every((r) => r.headers['x-api-key'] === keyA && !JSON.stringify(r).includes(keyO)), `${anthropicRecords.length} requests`)
if (APP_LOG) {
  const log = readFileSync(APP_LOG, 'utf8')
  const lines = log.split('\n').filter((l) => /^Reply from /.test(l))
  const okOpenAI = lines.filter((l) => /^Reply from openai\/gpt-6[a-z0-9.-]* used 25 input, 0 cache-read, 0 cache-write and 40 output tokens\.$/.test(l))
  check('the log has one usage line for each finished OpenAI reply (3 echoes), from the Responses API\'s own report', okOpenAI.length >= 3, `${lines.length} lines: ${lines.slice(0, 3).join(' | ')}`)
  check('...and one for the Claude replies (2)', lines.filter((l) => /^Reply from anthropic\/claude-opus-5-5 used /.test(l)).length === 2, lines.join(' | ').slice(0, 300))
  check('the log holds neither key', !log.includes(keyA) && !log.includes(keyO))
}
check('no console errors, warnings or exceptions in the page', page.problems.length === 0, page.problems.join(' | '))
const passed = check.summary()
page.close()
process.exit(passed ? 0 : 1)
