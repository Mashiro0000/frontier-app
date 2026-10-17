// Slice 5.3: API keys per provider, Settings with one section per provider (add, test, remove), in the real window.
// Needs USER_DATA_DIR (a scratch profile), MOCK_PORT (the Stage 5 mock), INSPECT_PORT (the main process's inspector) and APP_LOG.
// The "API keys" used here are invented on the spot, are not real credentials, and are never printed.
import './ts-resolve.mjs'
import { connect, checker, sleep } from './cdp.mjs'
import { assertScratchProfile } from './profile-guard.mjs'
import { mainInspector } from './lib4.mjs'
import { readRegistry } from './lib3.mjs'
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomBytes, createHash } from 'node:crypto'

const shots = process.argv[2]
const port = Number(process.argv[3] ?? 9222)
const { USER_DATA_DIR: userData, MOCK_PORT, INSPECT_PORT, APP_LOG } = process.env
if (!userData || !MOCK_PORT || !INSPECT_PORT) throw new Error('USER_DATA_DIR, MOCK_PORT and INSPECT_PORT must be set: this test must not touch the real profile')
const mock = `http://127.0.0.1:${MOCK_PORT}`
const check = checker()
const key1 = 'test-' + randomBytes(24).toString('hex')
const key2 = 'test-' + randomBytes(24).toString('hex')
const legacyKey = 'test-' + randomBytes(24).toString('hex')
const sha = (path) => createHash('sha256').update(readFileSync(path)).digest('hex').slice(0, 16)
const credFiles = () => readdirSync(userData).filter((n) => /^credentials/i.test(n)).sort()
const newFile = join(userData, 'credentials.anthropic.json')
const legacyFile = join(userData, 'credentials.json')
const post = (path, body) => fetch(`${mock}${path}`, { method: 'POST', body: JSON.stringify(body ?? {}) })
const reqs = async () => (await fetch(`${mock}/__requests`)).json()

const page = await connect(port)
await assertScratchProfile()
const main = await mainInspector(Number(INSPECT_PORT))
await page.send('Page.reload')
await sleep(1500)
await page.waitFor(`document.readyState === 'complete' && !!document.querySelector('.header-select, .app-badge')`, { timeoutMs: 20000 })
const appUrl = await page.evaluate('location.href')

const ev = (expr) => page.evaluate(expr)
const dialogOpen = () => ev(`!!document.querySelector('dialog.settings')?.open`)
const openSettings = async () => { await page.click('.header-button@Settings'); await page.waitFor(`!!document.querySelector('dialog.settings')?.open`) }
const closeSettings = async () => { await page.press('Escape'); await sleep(200) }
const section = (expr) => ev(`(() => { const f = document.querySelector('dialog.settings form.settings-section'); return f ? (${expr}) : null })()`)
const statusText = () => section(`f.querySelector('.settings-status')?.innerText ?? ''`)
const noticeText = () => section(`f.querySelector('.settings-notice')?.innerText ?? ''`)
const buttons = () => section(`[...f.querySelectorAll('button')].map((b) => ({ text: b.innerText, disabled: b.disabled, type: b.type }))`)
const hasButton = async (text) => ((await buttons()) ?? []).some((b) => b.text === text)
const buttonDisabled = async (text) => ((await buttons()) ?? []).find((b) => b.text === text)?.disabled
const click = (text) => ev(`[...document.querySelectorAll('dialog.settings form.settings-section button')].find((b) => b.innerText === ${JSON.stringify(text)}).click(); 0`)
const typeKey = async (text) => { await ev(`document.getElementById('api-key-anthropic').select()`); await page.type(text) }
// Waits for the notice "Saved." (it is what changes: the status line may already say "A key is saved." from an earlier key)
const saveKey = async (text) => { await typeKey(text); await page.click('.settings button[type=submit]'); await page.waitFor(`document.querySelector('dialog.settings .settings-notice')?.innerText === 'Saved.'`, { timeoutMs: 10000 }) }
const badges = () => ev(`[...document.querySelectorAll('.app-badge')].map((b) => ({ text: b.textContent, title: b.title }))`)
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'))

// ============ 1. a fresh profile ============
const api = await ev(`JSON.stringify({ top: Object.keys(window.api), settings: Object.keys(window.api.settings) })`)
check('window.api.settings has getStatus / setApiKey / clearApiKey / testApiKey / setModel / setEffort / setLimits / setAskFirst, in that order (and window.api has usage since 8.1, attachments since 9.2, instructions since 10.2, memory since 10.4 and projects since 10.5)', api === '{"top":["settings","chat","usage","history","attachments","instructions","memory","audit","tools","workspace","programs","connectors","changes","voice","images","projects"],"settings":["getStatus","setApiKey","clearApiKey","testApiKey","setModel","setEffort","setLimits","setAskFirst"]}', api)
const st0 = await ev(`window.api.settings.getStatus()`)
check('getStatus: exactly providers, canStoreKey, models, selectedModelId, modelsError, modelsCheckedOn, tasks, suggestions, effort, limits (since 8.2), askFirst (since 8.3)', Object.keys(st0).join() === 'providers,canStoreKey,models,selectedModelId,modelsError,modelsCheckedOn,tasks,suggestions,effort,limits,askFirst', Object.keys(st0).join())
check('getStatus: three providers (Google since 17.2), Anthropic, OpenAI, Google, none with a key', JSON.stringify(st0.providers) === '[{"id":"anthropic","name":"Anthropic","hasKey":false},{"id":"openai","name":"OpenAI","hasKey":false},{"id":"google","name":"Google","hasKey":false}]', JSON.stringify(st0.providers))
check('getStatus: every model of the registry is there, and names its provider by id', st0.models.length === readRegistry().models.length &&st0.models.every((m) => ['anthropic', 'openai', 'google'].includes(m.provider)) && new Set(st0.models.map((m) => m.provider)).size === 3, JSON.stringify(st0.models.map((m) => m.provider)))
check('getStatus: each model still has exactly id, label, provider, description, contextWindow, pricing, (since 9.3) whether it reads images and PDFs, and (since 17.2) its coming price change', st0.models.every((m) => Object.keys(m).join() === 'id,label,provider,description,contextWindow,pricing,priceChange,imageInput,documentInput'))
check('a fresh profile has no credential file of any kind', credFiles().length === 0, JSON.stringify(credFiles()))
const b0 = await badges()
check('the header says "No API key", and its tooltip names the provider', b0.some((b) => b.text === 'No API key' && b.title === 'Open Settings to add your Anthropic API key.'), JSON.stringify(b0))
check('the empty chat says to add the Anthropic key', /Add your Anthropic API key to start chatting\./.test(await ev(`document.querySelector('.empty-state')?.textContent ?? ''`)))
await openSettings()
check('Settings has one key section per provider (three since 17.5), headed "Anthropic API key", "OpenAI API key" and "Google API key", in that order', (await ev(`document.querySelectorAll('dialog.settings form.settings-section').length`)) === 3 && (await ev(`[...document.querySelectorAll('dialog.settings form.settings-section .settings-heading')].map((h) => h.innerText).join('|')`)) === 'Anthropic API key|OpenAI API key|Google API key')
check('the section says where to create a key and what it is billed to', /Anthropic's Claude on your account.*billed to that account\. You can create a key in your Anthropic Console account\./s.test(await section('f.innerText')))
check('fresh: "No key is saved yet."', (await statusText()) === 'No key is saved yet.', await statusText())
check('fresh: Save is disabled, and there is no Test and no Remove button', (await buttonDisabled('Save key')) === true && !(await hasButton('Test key')) && !(await hasButton('Remove key')), JSON.stringify(await buttons()))
const focusNow = await ev(`JSON.stringify({ tag: document.activeElement?.tagName, id: document.activeElement?.id, cls: document.activeElement?.className, hasFocus: document.hasFocus(), visibility: document.visibilityState, dialogs: [...document.querySelectorAll('dialog')].map((d) => d.className + ':' + d.open) })`)
check('keyboard focus lands in the key field of the first provider', JSON.parse(focusNow).id === 'api-key-anthropic', focusNow)
check('the field is a password field with autocomplete off, and has a label', await ev(`(() => { const i = document.getElementById('api-key-anthropic'); return i.type === 'password' && i.autocomplete === 'off' && i.spellcheck === false && !!document.querySelector('label[for=api-key-anthropic]') })()`))
await page.screenshot(`${shots}/5-3-empty.png`)
// a half-typed key must not be left sitting in the page when the dialog is closed
await typeKey('half-typed-key-that-must-not-survive-1234567890')
check('a key being typed is in the field', (await ev(`document.getElementById('api-key-anthropic').value`)).startsWith('half-typed'))
await closeSettings()
await openSettings()
check('closing the dialog throws a half-typed key away: the field is empty when it is opened again', (await ev(`document.getElementById('api-key-anthropic').value`)) === '')

// ============ 2. save a key ============
await post('/__reset')
await post('/__expect-key', { key: key1 })
await saveKey(key1)
check('after Save: "A key is saved." and the notice says "Saved."', (await statusText()) === 'A key is saved.' && (await noticeText()) === 'Saved.', `${await statusText()} / ${await noticeText()}`)
check('the key field was cleared', (await ev(`document.getElementById('api-key-anthropic').value`)) === '')
check('Test and Remove appear', (await hasButton('Test key')) && (await hasButton('Remove key')), JSON.stringify(await buttons()))
check('the files: credentials.anthropic.json only, no legacy file, no temp file', JSON.stringify(credFiles()) === '["credentials.anthropic.json"]', JSON.stringify(credFiles()))
const stored = readJson(newFile)
check('the file is { version: 2, provider: "anthropic", key: <base64> }', JSON.stringify(Object.keys(stored).sort()) === '["key","provider","version"]' && stored.version === 2 && stored.provider === 'anthropic' && /^[A-Za-z0-9+/=]+$/.test(stored.key))
const fileText = readFileSync(newFile, 'utf8')
check('the plain key is nowhere in the file, nor its base64', !fileText.includes(key1) && !fileText.includes(Buffer.from(key1).toString('base64')))
check('the page cannot learn the key: it is not in the DOM, the status, or storage', !(await ev(`(async () => (document.documentElement.outerHTML + JSON.stringify(localStorage) + JSON.stringify(sessionStorage) + JSON.stringify(await window.api.settings.getStatus())).includes(${JSON.stringify(key1)}))()`)))
check('getStatus now says the provider has a key', (await ev(`window.api.settings.getStatus()`)).providers[0].hasKey === true)
await page.screenshot(`${shots}/5-3-saved.png`)

// ============ 3. Test key ============
await post('/__reset')
await post('/__expect-key', { key: key1 })
await click('Test key')
await page.waitFor(`/accepted/.test(document.querySelector('dialog.settings .settings-notice')?.innerText ?? '')`, { timeoutMs: 8000 })
check('Test key (accepted): "The key was accepted. Anthropic lists 6 models for it."', (await noticeText()) === 'The key was accepted. Anthropic lists 6 models for it.', await noticeText())
const afterTest = await reqs()
check('...it asked the provider for the model list, with the saved key in x-api-key and no other credential', afterTest.length === 1 && afterTest[0].listing === true && afterTest[0].headers['x-api-key'] === key1 && afterTest[0].headers['authorization'] === undefined, JSON.stringify(afterTest.map((r) => r.url)))
check('...and it cost nothing: no message was sent to any model', afterTest.every((r) => r.listing === true))
check('...and the buttons are usable again', (await buttonDisabled('Test key')) === false && (await buttonDisabled('Remove key')) === false)
check('...the key is not in the notice or anywhere in the page', !(await ev(`document.documentElement.outerHTML.includes(${JSON.stringify(key1)})`)))

await post('/__reset')
await post('/__expect-key', { key: key2 }) // the provider now wants another key: ours is rejected
await click('Test key')
await page.waitFor(`/not accepted/.test(document.querySelector('dialog.settings .settings-notice')?.innerText ?? '')`, { timeoutMs: 8000 })
const rejected = await noticeText()
check('Test key (rejected): the sentence says the key was not accepted, with the request id', /^The API key was not accepted \(401\)\. Check it in Settings\. \(request req_mock_401\)$/.test(rejected), rejected)
check('...in the error style', await section(`!!f.querySelector('.settings-notice-error')`))
check('...and the key is not in it', !rejected.includes(key1))
check('...the saved key is untouched by a failed test', (await statusText()) === 'A key is saved.' && existsSync(newFile))

for (const [fail, pattern, label] of [[500, /Anthropic had a problem on its side \(500\)/, '500'], [529, /Anthropic is overloaded right now \(529\)/, '529'], [429, /Too many requests right now \(429\)/, '429'], [403, /not allowed to do that \(403\)/, '403']]) {
  await post('/__reset')
  await post('/__models', { fail })
  await click('Test key')
  await page.waitFor(`document.querySelector('dialog.settings .settings-notice-error') !== null`, { timeoutMs: 8000 })
  check(`Test key (the provider answers ${label}): a plain sentence`, pattern.test(await noticeText()), await noticeText())
}

// a provider that never answers: the test gives up after 20 s, tells the person, and cancels the request
await post('/__reset')
await post('/__models', { hang: true })
const tHang = Date.now()
await click('Test key')
await sleep(300)
const during = await buttons()
check('while a test runs, every button and the field are disabled (no second action can start)', during.every((b) => b.disabled) && (await ev(`document.getElementById('api-key-anthropic').disabled`)), JSON.stringify(during))
check('...and the notice says it is testing', /^Testing the key with Anthropic/.test(await noticeText()), await noticeText())
await page.waitFor(`document.querySelector('dialog.settings .settings-notice-error') !== null`, { timeoutMs: 30000, label: 'the 20 s test timeout' })
const waited = Date.now() - tHang
check('a provider that never answers: it gives up after about 20 seconds', waited >= 19000 && waited <= 27000, `${waited} ms`)
check('...and says so', /^The request timed out\. Check your internet connection and try again\.$/.test(await noticeText()), await noticeText())
await sleep(300)
const hung = (await reqs()).find((r) => r.listing)
check('...and the request was really cancelled (the server saw the connection close)', hung?.closedEarly === true, JSON.stringify(hung?.closedEarly))
check('...and the buttons work again', (await buttonDisabled('Test key')) === false)
await post('/__reset')

// ============ 4. what the page may and may not ask of main ============
const before = sha(newFile)
// the preload takes (provider, key); the raw contract is { provider, key } on a channel the page cannot name, so the page-side abuse goes
// through the one function it has, with every kind of argument
const abused = await ev(`(async () => {
  const out = {}
  const key = ${JSON.stringify('test-' + 'z'.repeat(30))}
  const cases = [
    ['an unknown provider', ['nope', key]], ['no provider', [undefined, key]], ['no key', ['anthropic', undefined]], ['upper-case provider', ['ANTHROPIC', key]],
    ['a provider with a path in it', ['../x', key]], ['__proto__', ['__proto__', key]], ['a key that is a number', ['anthropic', 5]], ['a 2 MB key', ['anthropic', 'x'.repeat(2000000)]],
    ['an object as provider', [{ toString: () => 'anthropic' }, key]], ['an array as provider', [['anthropic'], key]], ['a key with a space', ['anthropic', 'a b '.repeat(10)]], ['an empty key', ['anthropic', '']]
  ]
  for (const [name, args] of cases) {
    try { const r = await window.api.settings.setApiKey(...args); out[name] = r.ok ? 'ACCEPTED' : 'refused' } catch (e) { out[name] = 'threw' }
  }
  return out
})()`)
check('bad input to setApiKey is refused by main, every kind of it', Object.values(abused).every((v) => v === 'refused' || v === 'threw'), JSON.stringify(abused))
check('...and the saved key file is byte for byte untouched', sha(newFile) === before)
const cleared = await ev(`(async () => {
  const out = {}
  for (const [name, arg] of [['an unknown provider', 'nope'], ['undefined', undefined], ['an object', {}], ['upper case', 'ANTHROPIC'], ['a path', '../credentials.anthropic']]) {
    try { await window.api.settings.clearApiKey(arg); out[name] = 'ACCEPTED' } catch (e) { out[name] = 'refused' }
  }
  return out
})()`)
check('clearApiKey with anything but a known provider is refused, and the saved key survives', Object.values(cleared).every((v) => v === 'refused') && existsSync(newFile) && sha(newFile) === before, JSON.stringify(cleared))
const tested = await ev(`(async () => {
  const out = {}
  for (const [name, arg] of [['an unknown provider', 'nope'], ['undefined', undefined], ['an object', {}], ['a path', '../x']]) {
    try { const r = await window.api.settings.testApiKey(arg); out[name] = r.ok ? 'ACCEPTED' : 'refused' } catch (e) { out[name] = 'threw' }
  }
  return out
})()`)
check('testApiKey with anything but a known provider is refused', Object.values(tested).every((v) => v === 'refused' || v === 'threw'), JSON.stringify(tested))
check('...and none of those made a request to the provider', (await reqs()).length === 0, String((await reqs()).length))
await closeSettings()

// the sender guard: about:blank also gets window.api
await ev(`setTimeout(() => { location.href = 'about:blank' }, 0); 0`)
await sleep(1200)
const blank = await ev(`(async () => {
  const settle = (p) => p.then(() => 'RESOLVED', (e) => 'rejected: ' + String(e.message).slice(0, 100))
  return { where: location.href, set: await settle(window.api.settings.setApiKey('anthropic', ${JSON.stringify(key2)})), clear: await settle(window.api.settings.clearApiKey('anthropic')), test: await settle(window.api.settings.testApiKey('anthropic')) }
})()`)
check('setApiKey, clearApiKey and testApiKey from about:blank are all rejected by main', blank.where === 'about:blank' && [blank.set, blank.clear, blank.test].every((r) => /rejected: .*Blocked/.test(r)), JSON.stringify(blank))
check('...and nothing changed on disk, and no request was made', sha(newFile) === before && (await reqs()).length === 0)
await page.send('Page.navigate', { url: appUrl })
await sleep(1800)
await page.waitFor(`!!document.querySelector('.header-select, .app-badge')`, { timeoutMs: 20000 })

// ============ 5. Remove, then the key survives a reload ============
await openSettings()
check('after a reload the status still says a key is saved', (await statusText()) === 'A key is saved.')
await click('Remove key')
await page.waitFor(`document.querySelector('dialog.settings .settings-status').innerText === 'No key is saved yet.'`)
check('Remove: status, notice, buttons and files all say it is gone', (await noticeText()) === 'The key was removed.' && !(await hasButton('Remove key')) && !(await hasButton('Test key')) && credFiles().length === 0, JSON.stringify(credFiles()))
await closeSettings()
check('the header asks for a key again', (await badges()).some((b) => b.text === 'No API key'))
const noKey = await ev(`window.api.settings.testApiKey('anthropic')`)
check('testApiKey with no key saved: refused with a plain sentence, and no request made', noKey.ok === false && noKey.error === 'No Anthropic API key is saved yet.' && (await reqs()).length === 0, JSON.stringify(noKey))
await ev(`(() => { const t = document.querySelector('.composer-input'); t.focus() })()`)
await page.type('hello without a key')
await page.press('Enter')
await page.waitFor(`!!document.querySelector('.message-note')`, { timeoutMs: 8000 })
check('sending with no key explains what to do, and contacts nobody', (await ev(`document.querySelector('.message-assistant .message-note')?.textContent`)) === 'No API key is saved yet. Open Settings and add your Anthropic API key.' && (await reqs()).length === 0)

// ============ 6. the old credentials.json (written by Stages 2 to 4) is still Anthropic's key ============
const blob = await main.inMain(`process.mainModule.require('electron').safeStorage.encryptString(${JSON.stringify(legacyKey)}).toString('base64')`)
writeFileSync(legacyFile, JSON.stringify({ version: 1, anthropicApiKey: blob }))
const legacyHash = sha(legacyFile)
await post('/__reset')
await post('/__expect-key', { key: legacyKey })
await page.send('Page.reload')
await sleep(1500)
await page.waitFor(`!!document.querySelector('.header-select, .app-badge')`, { timeoutMs: 20000 })
check('with only the old file present, the app says a key is saved (and no longer asks for one)', (await ev(`window.api.settings.getStatus()`)).providers[0].hasKey === true && !(await badges()).some((b) => b.text === 'No API key'))
await page.screenshot(`${shots}/5-3-legacy.png`)
await ev(`(() => { const t = document.querySelector('.composer-input'); t.focus(); t.select() })()`)
await page.type('hello with the old key')
await page.press('Enter')
await page.waitFor(`!!document.querySelector('.composer-button[type=submit]') && document.querySelector('.message-assistant .bubble')?.textContent.startsWith('Echo:')`, { timeoutMs: 15000 })
const used = (await reqs()).at(-1)
check('a reply works with the old key: the provider received exactly that key', used?.headers['x-api-key'] === legacyKey && used.problems.length === 0, JSON.stringify(used?.problems))
check('reading the old file changed nothing: same bytes, no new file', sha(legacyFile) === legacyHash && JSON.stringify(credFiles()) === '["credentials.json"]', JSON.stringify(credFiles()))
await openSettings()
await click('Test key')
await page.waitFor(`/accepted/.test(document.querySelector('dialog.settings .settings-notice')?.innerText ?? '')`, { timeoutMs: 8000 })
check('Test key works with the old key too', /^The key was accepted/.test(await noticeText()))
await post('/__expect-key', { key: key2 })
await saveKey(key2)
check('saving a new key writes the new kind of file and DELETES the old one (it must not come back after a Remove)', JSON.stringify(credFiles()) === '["credentials.anthropic.json"]', JSON.stringify(credFiles()))
await click('Remove key')
await page.waitFor(`document.querySelector('dialog.settings .settings-status').innerText === 'No key is saved yet.'`)
check('after Remove nothing is left, and the old key does not reappear after a reload', credFiles().length === 0)
await closeSettings()
await page.send('Page.reload')
await sleep(1500)
await page.waitFor(`!!document.querySelector('.header-select, .app-badge')`, { timeoutMs: 20000 })
check('...(reloaded) still no key', (await ev(`window.api.settings.getStatus()`)).providers[0].hasKey === false)

// ============ 7. narrow windows ============
await post('/__reset')
await post('/__expect-key', { key: key1 })
await openSettings()
await saveKey(key1)
for (const width of [420, 320]) {
  await page.send('Emulation.setDeviceMetricsOverride', { width, height: 700, deviceScaleFactor: 1, mobile: false })
  await sleep(300)
  const fit = await ev(`(() => { const d = document.querySelector('dialog.settings'); const r = d.getBoundingClientRect(); const bs = [...d.querySelectorAll('.settings-actions button')].map((b) => b.getBoundingClientRect()); return { dialog: [Math.round(r.left), Math.round(r.right)], overflowX: d.scrollWidth > d.clientWidth, buttonsInside: bs.every((b) => b.left >= r.left - 1 && b.right <= r.right + 1), rows: new Set(bs.map((b) => Math.round(b.top))).size, count: bs.length } })()`)
  check(`at ${width} px wide: no sideways scroll, and Save / Test / Remove (and the second provider's Save, since 8.2 Save limits, and since 8.3 the Save of Large requests, and since 8b.3 Encrypt my saved chats) all stay inside the dialog`, !fit.overflowX && fit.buttonsInside && fit.count === 8, JSON.stringify(fit)) /* (one more Save since 17.5: the Google key's) */
  await page.screenshot(`${shots}/5-3-narrow-${width}.png`)
}
await page.send('Emulation.clearDeviceMetricsOverride')
await closeSettings()

if (APP_LOG) {
  const log = readFileSync(APP_LOG, 'utf8')
  check('none of the keys is in the app log', ![key1, key2, legacyKey].some((k) => log.includes(k)))
}
check('no console errors, warnings or exceptions in the page', page.problems.length === 0, page.problems.join(' | '))
main.close()
const passed = check.summary()
page.close()
process.exit(passed ? 0 : 1)
