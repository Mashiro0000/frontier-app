// Slices 3.3 + 3.4 in the real window: the model menu, the saved choice, the Settings details, what each model
// is sent, the guard on setModel, and rapid changes. FIRST launch on a fresh scratch profile (no key, no choice).
// Needs: MOCK_PORT, USER_DATA_DIR (scratch profile inside the real %APPDATA%, to exercise EFS), APP_LOG.
// It leaves a saved key and the choice "Claude Haiku 4.5" behind, for verify-3-4b.mjs (second launch).
import './ts-resolve.mjs'
import { connect, checker, sleep } from './cdp.mjs'
import { assertScratchProfile } from './profile-guard.mjs'
import { helpers, lcg, readRegistry, sha } from './lib3.mjs'
import { readFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'

const shots = process.argv[2]
const port = Number(process.argv[3] ?? 9222)
const mockPort = process.env.MOCK_PORT
const userData = process.env.USER_DATA_DIR
if (!mockPort || !userData) throw new Error('MOCK_PORT and USER_DATA_DIR must be set')
const mockUrl = `http://127.0.0.1:${mockPort}`
const check = checker()
const page = await connect(port)
await assertScratchProfile()
const H = helpers(page, { userData, mockUrl })
const { ev } = H

const registry = readRegistry()
const models = registry.models
const ids = models.map((m) => m.id)
const labels = models.map((m) => m.label)
const [FABLE, OPUS, SONNET, HAIKU] = ids
const label = (id) => models.find((m) => m.id === id).label
const SEND_READY = `!!document.querySelector('.composer-button[type=submit]')`

await fetch(`${mockUrl}/__reset`, { method: 'POST' })
await page.send('Page.reload')
await sleep(1800)
await page.waitFor(`!!document.querySelector('.header-select')`, { timeoutMs: 8000 })

// ===================== A. a fresh profile: no key, no saved choice =====================
let menu = await H.menu()
check('the header has a model menu, named "Model" for screen readers', menu?.aria === 'Model', JSON.stringify(menu))
check('it lists the registry models, in the registry\'s order (labels)', JSON.stringify(menu.labels) === JSON.stringify(labels), JSON.stringify(menu.labels))
check('...and the option values are the registry ids', JSON.stringify(menu.values) === JSON.stringify(ids))
check('the default model (from the registry) is selected: Claude Opus 5.5', menu.value === registry.defaultModelId && menu.value === OPUS && menu.label === 'Claude Opus 5.5', `${menu.value}`)
check('the menu is enabled when no reply is arriving', menu.disabled === false)
check('its tooltip names the model and points at Settings', /^Claude Opus 5\.5\. The details are in Settings\.$/.test(menu.title), menu.title)
check('reading the status at startup wrote nothing: no preferences.json yet', H.prefs() === null)
let badges = await H.badges()
check('no key: exactly one badge, the warning "No API key" (the model is no longer a badge)', badges.length === 1 && badges[0].text === 'No API key' && badges[0].warn, JSON.stringify(badges))

const apiKeys = await ev(`JSON.stringify(Object.keys(window.api.settings))`)
check('window.api.settings is exactly getStatus / setApiKey / clearApiKey / testApiKey / setModel', apiKeys === '["getStatus","setApiKey","clearApiKey","testApiKey","setModel"]', apiKeys)
const status0 = await H.status()
check('getStatus: exactly providers, canStoreKey, models, selectedModelId, modelsError, modelsCheckedOn', Object.keys(status0).join() === 'providers,canStoreKey,models,selectedModelId,modelsError,modelsCheckedOn', Object.keys(status0).join())
check('getStatus: default selected, no registry error, checked on 2026-10-01', status0.selectedModelId === OPUS && status0.modelsError === null && status0.modelsCheckedOn === '2026-10-01')
check('getStatus: each model has exactly id, label, provider, description, contextWindow, pricing', status0.models.length === 4 && status0.models.every((m) => Object.keys(m).join() === 'id,label,provider,description,contextWindow,pricing'))
check('the page is told nothing about how a model is called: no "effort", no output limit anywhere in the status', !/effort|maxOutputTokens/i.test(JSON.stringify(status0)))
check('the status carries the registry\'s facts (provider "anthropic", named "Anthropic" in providers, prices, context)', status0.providers[0].name === 'Anthropic' && status0.models.every((m, i) => m.provider === 'anthropic' && m.contextWindow === models[i].contextWindow && m.pricing.inputPerMTok === models[i].pricing.inputPerMTok && m.pricing.outputPerMTok === models[i].pricing.outputPerMTok))

// the Settings dialog describes the selected model
let text = await H.settingsText()
check('Settings, Model section: names the model and its provider', /Claude Opus 5\.5, from Anthropic/.test(text))
check('...shows the description from the registry', text.includes(models[1].description))
check('...says how much it can read: "about 1M tokens"', /about 1M tokens of conversation/.test(text))
check('...gives the list prices: $4 in, $20 out, per million tokens', /\$4 per million tokens it reads and \$20 per million tokens it writes/.test(text), text.match(/List price:[^.]*\./)?.[0])
check('...says when the prices were checked', /Prices were checked on 2026-10-01\./.test(text))
check('...says the bill goes to the Anthropic account, and how to change the model', /billed to your Anthropic account/.test(text) && /menu in the header/.test(text))
check('...warns that a mid-chat change sends the whole chat to the new model', /whole chat so far is sent to the new model/.test(text))
check('...the old "fixed for now" line is gone', !/fixed for now/i.test(text))
await page.screenshot(`${shots}/3-4-header-nokey.png`)

// header layout: all controls stay inside narrow windows (the header may wrap)
for (const width of [420, 320]) {
  await page.send('Emulation.setDeviceMetricsOverride', { width, height: 600, deviceScaleFactor: 1, mobile: false })
  await sleep(250)
  const fit = await ev(`(() => ({ over: document.documentElement.scrollWidth > innerWidth, rights: [...document.querySelectorAll('.app-header > *, .app-header-actions > *')].map((e) => Math.round(e.getBoundingClientRect().right)), inner: innerWidth }))()`)
  check(`at ${width}px wide (no key, so four header controls): nothing overflows sideways`, !fit.over && fit.rights.every((r) => r <= fit.inner), JSON.stringify(fit))
  if (width === 420) await page.screenshot(`${shots}/3-4-header-420.png`)
}
await page.send('Emulation.clearDeviceMetricsOverride')
await sleep(200)

// keyboard: Tab goes menu -> Settings
await ev(`document.querySelector('.header-select').focus()`)
await page.press('Tab')
check('keyboard: Tab from the menu lands on the Settings button', (await ev(`document.activeElement.textContent`)) === 'Settings', await ev(`document.activeElement.textContent`))

// ===================== B. choosing a model =====================
await H.chooseInPage(SONNET)
await H.settle(SONNET)
menu = await H.menu()
check('choose Sonnet in the menu: the menu shows it', menu.value === SONNET && menu.label === 'Claude Sonnet 5.5')
check('...and main reports it as selected', (await H.status()).selectedModelId === SONNET)
check('...and it is saved: preferences.json holds exactly {"version":1,"modelId":"claude-sonnet-5-5"}', H.prefs() === '{"version":1,"modelId":"claude-sonnet-5-5"}', H.prefs())
check('...written in place on the EFS-encrypted AppData, with no temporary file left', H.strayFiles().length === 0, JSON.stringify(H.strayFiles()))
check('...no error badge', !(await H.badges()).some((b) => b.alert))
text = await H.settingsText()
check('Settings now describes Sonnet and its prices ($2 / $10)', /Claude Sonnet 5\.5, from Anthropic/.test(text) && /\$2 per million tokens it reads and \$10 per million tokens it writes/.test(text))

// keyboard: ArrowDown / ArrowUp on the focused menu
await ev(`document.querySelector('.header-select').focus()`)
await page.press('ArrowDown')
await H.settle(HAIKU)
check('keyboard: ArrowDown on the menu moves to the next model (Haiku), saved', H.prefs() === `{"version":1,"modelId":"${HAIKU}"}` && (await H.menu()).value === HAIKU)
check('...and keyboard focus stays on the menu (it is not disabled while main answers)', (await ev(`document.activeElement.className`)) === 'header-select')
await page.press('ArrowUp')
await page.press('ArrowUp')
await H.settle(OPUS)
check('keyboard: two ArrowUp presses in quick succession end on Opus, saved', H.prefs() === `{"version":1,"modelId":"${OPUS}"}` && (await H.menu()).value === OPUS, `${H.prefs()} ${(await H.menu()).value}`)
await page.screenshot(`${shots}/3-4-header-key-opus.png`)

// ---- rapid changes (the arrow key held down): the LAST choice must win, everywhere ----
const rand = lcg(20261001)
let rapidOk = 0
let rapidFail = null
const ROUNDS = 25
for (let round = 0; round < ROUNDS; round++) {
  const seq = Array.from({ length: 6 }, () => ids[Math.floor(rand() * ids.length)])
  const last = seq.at(-1)
  await ev(`(() => { const s = document.querySelector('.header-select'); for (const id of ${JSON.stringify(seq)}) { s.value = id; s.dispatchEvent(new Event('change', { bubbles: true })) } })()`)
  await H.settle(last)
  await sleep(120) // let any straggling answer arrive
  const [m, st, alerts] = [await H.menu(), await H.status(), (await H.badges()).filter((b) => b.alert)]
  const good = m.value === last && st.selectedModelId === last && H.prefs() === `{"version":1,"modelId":"${last}"}` && alerts.length === 0 && H.strayFiles().length === 0
  if (good) rapidOk++
  else { rapidFail = { round, seq, menu: m.value, main: st.selectedModelId, file: H.prefs(), alerts }; break }
}
check(`rapid changes: ${ROUNDS} bursts of 6 changes each: the menu, main and the saved file all end on the last choice, with no error`, rapidOk === ROUNDS, JSON.stringify(rapidFail))

// ===================== C. saving a key, then real chats through the mock =====================
const key = 'test-' + randomBytes(24).toString('hex')
const resetMock = async () => { await fetch(`${mockUrl}/__reset`, { method: 'POST' }); await fetch(`${mockUrl}/__expect-key`, { method: 'POST', body: JSON.stringify({ key }) }) }
await resetMock()
await page.click('.header-button@Settings')
await page.waitFor(`!!document.querySelector('dialog.settings')?.open`)
await ev(`document.getElementById('api-key-anthropic').select()`)
await page.type(key)
await page.click('.settings button[type=submit]')
await page.waitFor(`document.querySelector('.settings-status').innerText === 'A key is saved.'`)
await page.press('Escape')
await sleep(300)
badges = await H.badges()
check('with a key: no badge at all, just the model menu and the Settings button', badges.length === 0 && (await H.menu()) !== null, JSON.stringify(badges))
check('saving the key did not disturb the saved model choice', H.prefs() === `{"version":1,"modelId":"${OPUS}"}`)
await page.screenshot(`${shots}/3-4-header-key.png`)

// every model: chosen in the menu, then one chat message; the mock sees exactly that model's request
for (const id of ids) {
  const m = models.find((x) => x.id === id)
  await resetMock()
  await H.chooseInPage(id)
  await H.settle(id)
  await H.sendAndWait(`hello ${id}`)
  const reqs = await H.mockReqs()
  const req = reqs.at(-1)
  check(`${m.label}: a reply arrives through the whole path`, (await H.bubbleText()) === `Echo: hello ${id}` && !(await H.noteText()), JSON.stringify([await H.bubbleText(), await H.noteText()]))
  check(`${m.label}: exactly one request, naming ${id}, which the strict mock accepts`, reqs.length === 1 && req.body.model === id && req.problems.length === 0, JSON.stringify({ n: reqs.length, model: req?.body.model, problems: req?.problems }))
  check(`${m.label}: ${m.effort === null ? 'no output_config at all (it rejects effort)' : `effort "${m.effort}" and nothing else in output_config`}`, m.effort === null ? !('output_config' in req.body) : JSON.stringify(req.body.output_config) === JSON.stringify({ effort: m.effort }), JSON.stringify(req.body.output_config))
  check(`${m.label}: max_tokens 16000, streaming, automatic caching, the key in x-api-key`, req.body.max_tokens === 16000 && req.body.stream === true && req.body.cache_control?.type === 'ephemeral' && req.headers['x-api-key'] === key)
}

// the menu is locked while a reply arrives, and the model of that reply cannot change under it
await resetMock()
await H.chooseInPage(SONNET)
await H.settle(SONNET)
await H.send('[[mock:slow]] keep going')
await page.waitFor(`(document.querySelector('.message-assistant:last-child .bubble')?.textContent ?? '').includes('tick1')`, { timeoutMs: 8000 })
menu = await H.menu()
check('while a reply is arriving the menu is disabled, and says why', menu.disabled === true && /can be changed when the reply has finished/.test(menu.title), JSON.stringify([menu.disabled, menu.title]))
await page.screenshot(`${shots}/3-4-replying.png`)
// A page that misbehaves (calls the API directly) can still ask main to switch models mid-reply.
const midReply = await ev(`window.api.settings.setModel(${JSON.stringify(HAIKU)})`)
check('a (misbehaving) page that switches the model mid-reply is accepted by main...', midReply.ok === true && midReply.status.selectedModelId === HAIKU)
const inFlight = await H.mockReqs()
check('...but the reply already running keeps its model: the request in flight was sent for Sonnet', inFlight.length === 1 && inFlight[0].body.model === SONNET, JSON.stringify(inFlight.map((r) => r.body.model)))
await page.click('.composer-button-stop')
await page.waitFor(SEND_READY, { timeoutMs: 4000 })
menu = await H.menu()
check('Stop unlocks the menu again', menu.disabled === false && !/finished/.test(menu.title))
await page.send('Page.reload')
await sleep(1800)
await page.waitFor(`!!document.querySelector('.header-select')`)
check('after a reload the page re-reads main\'s selection (Haiku, set by that call)', (await H.menu()).value === HAIKU)
await resetMock()
await H.sendAndWait('after the switch')
const after = (await H.mockReqs()).at(-1)
check('the NEXT reply uses the new model (Haiku), exactly as the registry says', after.body.model === HAIKU && !('output_config' in after.body) && after.problems.length === 0, JSON.stringify(after.body.model))

// switching in the middle of a conversation: the whole chat goes to the new model
await page.send('Page.reload')
await sleep(1800)
await resetMock()
await H.chooseInPage(OPUS)
await H.settle(OPUS)
await H.sendAndWait('first')
await H.chooseInPage(HAIKU)
await H.settle(HAIKU)
await H.sendAndWait('second')
const [r1, r2] = await H.mockReqs()
check('mid-chat switch: the first message went to Opus, the second to Haiku', r1.body.model === OPUS && r2.body.model === HAIKU, JSON.stringify([r1.body.model, r2.body.model]))
check('...and the second request carries the whole conversation, as plain text turns', JSON.stringify(r2.body.messages) === JSON.stringify([{ role: 'user', content: 'first' }, { role: 'assistant', content: 'Echo: first' }, { role: 'user', content: 'second' }]), JSON.stringify(r2.body.messages))
check('...with no thinking blocks or other extras sent back (only text is ever sent)', r2.body.messages.every((m) => typeof m.content === 'string') && !('thinking' in r2.body))

// a model the account cannot use: the person is told which one and what to do
await resetMock()
await H.chooseInPage(FABLE)
await H.settle(FABLE)
await H.sendAndWait('[[mock:404]] hi')
check('a 404 names the model and points at the menu', (await H.noteText()) === 'The model claude-fable-5-1 was not found for this account (404). You can choose another model in the header. model: claude-fable-5-1 (request req_mock_404)', JSON.stringify(await H.noteText()))
check('...and the input is ready again, the menu is enabled', (await ev(SEND_READY)) && !(await H.menu()).disabled)

// ===================== D. what the page must not be able to do =====================
await H.chooseInPage(SONNET)
await H.settle(SONNET)
const before = H.prefs()
const abusePairs = await ev(`(async () => {
  const out = []
  const cases = [['number', 5], ['null', null], ['undefined', undefined], ['object', {}], ['array', []], ['array holding a real id', [${JSON.stringify(OPUS)}]], ['empty', ''], ['upper case', ${JSON.stringify(OPUS.toUpperCase())}], ['trailing space', ${JSON.stringify(OPUS + ' ')}], ['__proto__', '__proto__'], ['constructor', 'constructor'], ['unknown id', 'claude-opus-9'], ['true', true], ['2 MB string', 'x'.repeat(2000000)]]
  for (const [name, value] of cases) {
    try { const r = await window.api.settings.setModel(value); out.push([name, r.ok ? 'ACCEPTED' : 'refused: ' + r.error]) } catch (e) { out.push([name, 'threw: ' + String(e.message).slice(0, 80)]) }
  }
  return out
})()`)
const abuse = Object.fromEntries(abusePairs)
check('bad input sent straight to setModel is refused by main (14 kinds, __proto__ included)', abusePairs.length === 14 && Object.keys(abuse).includes('__proto__') && abusePairs.every(([, v]) => v.startsWith('refused')), JSON.stringify(abusePairs.map(([n, v]) => n + ' -> ' + v.slice(0, 30))))
check('...the refusals are plain sentences (the input is not echoed back)', abusePairs.every(([, v]) => v === 'refused: The model choice was not understood.' || v === 'refused: That model is not available.'), JSON.stringify([...new Set(abusePairs.map(([, v]) => v))]))
check('...nothing was saved, and the selection did not move', H.prefs() === before && (await H.status()).selectedModelId === SONNET)

const appUrl = await ev('location.href')
await ev(`setTimeout(() => { location.href = 'about:blank' }, 0); 0`)
await sleep(1200)
const blank = await ev(`(async () => {
  const settle = (p) => p.then((r) => 'RESOLVED ' + JSON.stringify(r).slice(0, 60), (e) => 'rejected: ' + String(e.message).slice(0, 120))
  return { where: location.href, api: typeof window.api, set: await settle(window.api.settings.setModel(${JSON.stringify(HAIKU)})), status: await settle(window.api.settings.getStatus()) }
})()`)
check('precondition: the page really is about:blank and still has window.api', blank.where === 'about:blank' && blank.api === 'object', JSON.stringify(blank))
check('setModel from about:blank is rejected by main ("Blocked")', /^rejected: .*Blocked/.test(blank.set), blank.set)
check('getStatus from about:blank is rejected too (the model list is not for other pages)', /^rejected: .*Blocked/.test(blank.status), blank.status)
check('...and the saved choice did not change', H.prefs() === before)
await page.send('Page.navigate', { url: appUrl })
await sleep(1800)
check('back on the app page: the selection is still Sonnet', (await H.menu()).value === SONNET)

// ===================== E. the end state, for the restart test =====================
await H.chooseInPage(HAIKU)
await H.settle(HAIKU)
check('left behind for the restart test: Haiku chosen and saved, a key saved', H.prefs() === `{"version":1,"modelId":"${HAIKU}"}` && (await H.status()).providers[0].hasKey === true)
await page.screenshot(`${shots}/3-4-haiku.png`)
text = await H.settingsText()
await page.click('.header-button@Settings')
await page.waitFor(`!!document.querySelector('dialog.settings')?.open`)
await sleep(150)
await page.screenshot(`${shots}/3-4-settings-haiku.png`)
await page.press('Escape')
check('Settings for Haiku: 200K tokens, $1 / $5, its own description', /about 200K tokens/.test(text) && /\$1 per million tokens it reads and \$5 per million tokens it writes/.test(text) && text.includes(models[3].description), text.match(/It can read[^.]*\./)?.[0])

// ===================== F. nothing leaked =====================
const appLog = readFileSync(process.env.APP_LOG, 'utf8')
check('the key is not in the app\'s log output', !appLog.includes(key))
check('the app logged no registry problems (the real registry file is clean)', !/registry\/models\.json/.test(appLog), appLog.split('\n').filter((l) => /registry/.test(l)).join(' | '))
check('no console errors, warnings or exceptions in the page', page.problems.length === 0, page.problems.join(' | '))
const passed = check.summary()
page.close()
process.exit(passed ? 0 : 1)
