// Slice 2.3: settings dialog + encrypted API-key storage + the IPC sender guard, in the real window.
// Needs USER_DATA_DIR (a scratch profile), so the test key never touches the user's own app data.
// The "API key" used here is invented on the spot, is not a real credential, and is never printed.
import { REPO_URL } from './paths.mjs'
import './ts-resolve.mjs'
import { connect, checker, sleep } from './cdp.mjs'
import { assertScratchProfile } from './profile-guard.mjs'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'

const shots = process.argv[2]
const port = Number(process.argv[3] ?? 9222)
const userData = process.env.USER_DATA_DIR
if (!userData) throw new Error('USER_DATA_DIR must be set: this test must not touch the real profile')
const credFile = join(userData, 'credentials.anthropic.json')
const check = checker()
const fakeKey = 'test-' + randomBytes(24).toString('hex')
const otherFakeKey = 'test-' + randomBytes(24).toString('hex')

// ---- the shared validation function, straight under Node ----------------------------------------
const { checkApiKey } = await import(`${REPO_URL}/src/shared/validate.ts`)
const ok = (v) => checkApiKey(v).ok
check('checkApiKey: a plausible key passes', ok('sk-ant-api03-' + 'A'.repeat(90)))
check('checkApiKey: surrounding whitespace and line breaks are trimmed', checkApiKey(' \n\t' + 'k'.repeat(30) + ' \r\n').key === 'k'.repeat(30))
check('checkApiKey: 19 characters fail, 20 pass', !ok('k'.repeat(19)) && ok('k'.repeat(20)))
check('checkApiKey: 300 pass, 301 fail', ok('k'.repeat(300)) && !ok('k'.repeat(301)))
for (const [name, value] of [['number', 123], ['null', null], ['undefined', undefined], ['object', {}], ['array', ['k'.repeat(30)]], ['empty string', ''], ['spaces only', '     ']]) {
  check(`checkApiKey: ${name} is refused`, !ok(value))
}
for (const [name, value] of [['inner space', 'k'.repeat(15) + ' ' + 'k'.repeat(15)], ['inner newline', 'k'.repeat(15) + '\n' + 'k'.repeat(15)], ['tab', 'k'.repeat(15) + '\t' + 'k'.repeat(15)], ['accented letter', 'k'.repeat(15) + 'é' + 'k'.repeat(15)], ['emoji', 'k'.repeat(15) + '😀' + 'k'.repeat(15)], ['NUL', 'k'.repeat(15) + '\u0000' + 'k'.repeat(15)], ['DEL', 'k'.repeat(15) + '\u007f' + 'k'.repeat(15)]]) {
  check(`checkApiKey: ${name} inside the key is refused`, !ok(value))
}
const probe = 'secret-looking ' + 'k'.repeat(30)
check('checkApiKey: an error message never echoes the input back', !String(checkApiKey(probe).error).includes('k'.repeat(30)))

// ---- the real window ----------------------------------------------------------------------------
const page = await connect(port)
await assertScratchProfile() // abort before writing anything if the scratch profile is not in use
await page.send('Page.reload')
await sleep(1800)
const appUrl = await page.evaluate('location.href')
const dialogOpen = () => page.evaluate(`!!document.querySelector('dialog.settings')?.open`)
const statusText = () => page.evaluate(`document.querySelector('.settings-status')?.innerText ?? ''`)
const noticeText = () => page.evaluate(`document.querySelector('.settings-notice')?.innerText ?? ''`)
const focused = () => page.evaluate(`document.activeElement ? (document.activeElement.id || document.activeElement.className || document.activeElement.tagName) : ''`)
const saveDisabled = () => page.evaluate(`document.querySelector('.settings button[type=submit]').disabled`)
const hasRemove = () => page.evaluate(`[...document.querySelectorAll('.settings button')].some((b) => b.innerText === 'Remove key')`)
const openSettings = async () => { await page.click('.header-button@Settings'); await page.waitFor(`!!document.querySelector('dialog.settings')?.open`) }
const readCred = () => (existsSync(credFile) ? readFileSync(credFile, 'utf8') : null)
const selectKeyField = () => page.evaluate(`document.getElementById('api-key-anthropic').select()`)

// 1. The header button and the closed dialog
check('the header has a Settings button', await page.evaluate(`[...document.querySelectorAll('.header-button')].some((b) => b.innerText === 'Settings')`))
check('the dialog is closed at first', !(await dialogOpen()))
check('no credentials file exists on a fresh profile', readCred() === null)

// 2. Open it: empty state
await openSettings()
check('clicking Settings opens the modal dialog', await dialogOpen())
check('keyboard focus lands in the key field', (await focused()) === 'api-key-anthropic', await focused())
check('fresh profile: "No key is saved yet."', (await statusText()) === 'No key is saved yet.', await statusText())
check('Save is disabled while the field is empty', await saveDisabled())
check('there is no Remove button when nothing is saved', !(await hasRemove()))
check('the field is a password field with autocomplete off', await page.evaluate(`(() => { const i = document.getElementById('api-key-anthropic'); return i.type === 'password' && i.autocomplete === 'off' && i.spellcheck === false })()`))
check('the field has a visible label and the dialog is named', await page.evaluate(`!!document.querySelector('label[for=api-key-anthropic]') && document.getElementById(document.querySelector('dialog.settings').getAttribute('aria-labelledby'))?.innerText === 'Settings'`))
await page.screenshot(`${shots}/2-3-empty.png`)

// 3. Escape closes it and focus goes back to the button
await page.press('Escape')
await sleep(200)
check('Escape closes the dialog', !(await dialogOpen()))
check('focus returns to the Settings button', await page.evaluate(`document.activeElement?.textContent === 'Settings'`), await page.evaluate('document.activeElement?.textContent'))

// 3b. The modal traps keyboard focus: tabbing around never reaches the chat behind it
await openSettings()
const tabStops = []
for (let i = 0; i < 56; i++) {
  // (56 since D-054: the chart adds its ranges and Cost / Tokens, Appearance its accents and fonts; the walk goes round past the list to the first key)
  // (16 since 15.6: the Voice section adds the Read aloud switch, the voice, the speed and "Try the voice" before the Close button; 9 before)
  // (18 since D-051: the Appearance section adds Dark and Light before Close)
  // (28 since D-052: the list of the ten sections comes first, beside them)
  await page.press('Tab')
  tabStops.push(await page.evaluate(`document.activeElement.closest('dialog.settings') ? (document.activeElement.id || document.activeElement.innerText || document.activeElement.tagName) : 'OUTSIDE:' + (document.activeElement.className || document.activeElement.tagName)`))
}
check('Tab stays inside the dialog (56 presses, never reaches the chat)', tabStops.every((s) => !String(s).startsWith('OUTSIDE')), JSON.stringify(tabStops))
check('Tab visits the field and the Close button', tabStops.includes('api-key-anthropic') && tabStops.includes('Close'), JSON.stringify(tabStops))
await page.press('Escape')
await sleep(200)

// 4. Validation feedback while typing
await openSettings()
await page.type('abc')
check('a short entry keeps Save disabled and explains why', (await saveDisabled()) && /does not look like an API key/.test(await page.evaluate(`document.querySelector('.settings').innerText`)))
await selectKeyField()
await page.type('has a space inside it and is long enough')
check('a key with spaces keeps Save disabled', await saveDisabled())
await selectKeyField()
await page.type('k'.repeat(25))
check('a plausible entry enables Save and clears the hint', !(await saveDisabled()) && !/does not look like an API key/.test(await page.evaluate(`document.querySelector('.settings').innerText`)))

// 5. Save a key
await selectKeyField()
await page.type(fakeKey)
check('typing the key enables Save', !(await saveDisabled()))
await page.click('.settings button[type=submit]')
await page.waitFor(`document.querySelector('.settings-status').innerText === 'A key is saved.'`)
check('after Save the status says a key is saved', (await statusText()) === 'A key is saved.')
check('the notice says "Saved."', (await noticeText()) === 'Saved.', await noticeText())
check('the key field was cleared', (await page.evaluate(`document.getElementById('api-key-anthropic').value`)) === '')
check('a Remove button appears', await hasRemove())
await page.screenshot(`${shots}/2-3-saved.png`)

// 6. What is on disk, and what the page can learn
const credText = readCred()
check('a credentials file was written', credText !== null)
let cred = null
try { cred = JSON.parse(credText) } catch { /* reported below */ }
check('it is JSON: { version: 2, provider: "anthropic", key: <base64> }', cred?.version === 2 && cred?.provider === 'anthropic' && typeof cred?.key === 'string' && /^[A-Za-z0-9+/=]+$/.test(cred.key), JSON.stringify(Object.keys(cred ?? {})))
const blob = Buffer.from(cred?.key ?? '', 'base64')
check('the file does not contain the key as plain text', !credText.includes(fakeKey))
check('the stored bytes do not contain the key either', !blob.includes(Buffer.from(fakeKey)) && !blob.includes(Buffer.from(fakeKey).toString('base64')))
check('the stored bytes are longer than the key (nonce + tag + wrapping)', blob.length > fakeKey.length, `${blob.length} vs ${fakeKey.length}`)
check('no temporary file was left behind', !existsSync(credFile + '.tmp'))
const apiShape = await page.evaluate(`JSON.stringify({ top: Object.keys(window.api), settings: Object.keys(window.api.settings) })`)
check('window.api.settings has exactly getStatus / setApiKey / clearApiKey / testApiKey / setModel / setEffort / setLimits / setAskFirst (setLimits since Stage 8.2, setAskFirst since 8.3; and window.api also has chat, since Stage 4 history, since 8.1 usage, since 9.2 attachments, since 10.2 instructions, since 10.4 memory and since 10.5 projects; since 22.1 library and experts)', apiShape === '{"top":["settings","chat","usage","history","attachments","instructions","memory","audit","tools","workspace","programs","connectors","changes","voice","library","experts","images","updates","projects"],"settings":["getStatus","setApiKey","clearApiKey","testApiKey","setModel","setEffort","setLimits","setAskFirst"]}', apiShape)
const pageStatus = await page.evaluate(`window.api.settings.getStatus().then((s) => JSON.stringify(s))`)
check('getStatus returns exactly { providers, canStoreKey, models, selectedModelId, modelsError, modelsCheckedOn, tasks, suggestions, effort, limits, askFirst }', Object.keys(JSON.parse(pageStatus)).join() === 'providers,canStoreKey,models,selectedModelId,modelsError,modelsCheckedOn,tasks,suggestions,effort,limits,askFirst' && JSON.parse(pageStatus).providers[0].hasKey === true && JSON.parse(pageStatus).canStoreKey === true, pageStatus.slice(0, 200))
check('the key appears nowhere in the page (DOM, status, storage)', !(await page.evaluate(`(document.documentElement.outerHTML + JSON.stringify(localStorage) + JSON.stringify(sessionStorage)).includes(${JSON.stringify(fakeKey)})`)))

// 7. The page cannot smuggle bad input past the main process
const abuse = await page.evaluate(`(async () => {
  const out = {}
  const cases = [['number', 12345], ['object', {}], ['null', null], ['huge (2 MB)', 'x'.repeat(2000000)], ['spaces', 'a b '.repeat(10)], ['empty', ''], ['a string of newlines', '\\n'.repeat(40)]]
  for (const [name, value] of cases) {
    try { const r = await window.api.settings.setApiKey('anthropic', value); out[name] = r.ok ? 'ACCEPTED' : 'refused' } catch (e) { out[name] = 'threw' }
  }
  return out
})()`)
check('bad input sent straight to setApiKey is refused by main', Object.values(abuse).every((v) => v === 'refused'), JSON.stringify(abuse))
check('...and the saved key is untouched', readCred() === credText)

// 8. The sender guard: about:blank also gets window.api (the navigation lock cannot stop that page)
await page.evaluate(`setTimeout(() => { location.href = 'about:blank' }, 0); 0`)
await sleep(1200)
const blank = await page.evaluate(`(async () => {
  const settle = (p) => p.then((r) => 'RESOLVED', (e) => 'rejected: ' + String(e.message).slice(0, 120))
  return {
    where: location.href,
    api: typeof window.api,
    status: await settle(window.api.settings.getStatus()),
    set: await settle(window.api.settings.setApiKey('anthropic', ${JSON.stringify(otherFakeKey)})),
    clear: await settle(window.api.settings.clearApiKey('anthropic'))
  }
})()`)
check('precondition: the page really is about:blank and still has window.api', blank.where === 'about:blank' && blank.api === 'object', JSON.stringify(blank))
check('getStatus from about:blank is rejected by main', /rejected: .*Blocked/.test(blank.status), blank.status)
check('setApiKey from about:blank is rejected by main', /rejected: .*Blocked/.test(blank.set), blank.set)
check('clearApiKey from about:blank is rejected by main', /rejected: .*Blocked/.test(blank.clear), blank.clear)
check('...and nothing on disk changed', readCred() === credText)
await page.send('Page.navigate', { url: appUrl })
await sleep(1800)

// 9. The key survives a reload, then Remove deletes it
await page.send('Page.reload')
await sleep(1800)
await openSettings()
check('after a reload the status still says a key is saved', (await statusText()) === 'A key is saved.', await statusText())
await page.evaluate(`[...document.querySelectorAll('.settings button')].find((b) => b.innerText === 'Remove key').click(); 0`)
await page.waitFor(`document.querySelector('.settings-status').innerText === 'No key is saved yet.'`)
check('Remove: status goes back to "No key is saved yet."', (await statusText()) === 'No key is saved yet.')
check('Remove: the notice says it was removed', (await noticeText()) === 'The key was removed.', await noticeText())
check('Remove: the credentials file is gone', readCred() === null)
check('Remove: the Remove button is gone', !(await hasRemove()))
await page.press('Escape')

// 10. Save once more and leave it for the restart test
await openSettings()
await selectKeyField()
await page.type(fakeKey)
await page.click('.settings button[type=submit]')
await page.waitFor(`document.querySelector('.settings-status').innerText === 'A key is saved.'`)
check('saved again for the restart test', readCred() !== null)
await page.press('Escape')

check('no console errors, warnings or exceptions', page.problems.length === 0, page.problems.join(' | '))
const passed = check.summary()
page.close()
process.exit(passed ? 0 : 1)
