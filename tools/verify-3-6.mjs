// Registry scenarios in the real window (run through run-scenario.mjs, which swaps registry/models.json).
// Needs: SCENARIO, ORIGINAL_REGISTRY (the good file), MOCK_PORT, USER_DATA_DIR, APP_LOG.
import './ts-resolve.mjs'
import { connect, checker, sleep } from './cdp.mjs'
import { assertScratchProfile } from './profile-guard.mjs'
import { helpers } from './lib3.mjs'
import { readFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'

const port = Number(process.argv[3] ?? 9222)
const { SCENARIO, ORIGINAL_REGISTRY, MOCK_PORT, USER_DATA_DIR: userData } = process.env
if (!SCENARIO || !ORIGINAL_REGISTRY || !MOCK_PORT || !userData) throw new Error('SCENARIO, ORIGINAL_REGISTRY, MOCK_PORT and USER_DATA_DIR must be set')
const mockUrl = `http://127.0.0.1:${MOCK_PORT}`
const check = checker()
const page = await connect(port)
await assertScratchProfile()
const H = helpers(page, { userData, mockUrl })
const { ev } = H
const good = JSON.parse(readFileSync(ORIGINAL_REGISTRY, 'utf8'))
const L = (id) => good.models.find((m) => m.id === id).label
const OPUS = 'claude-opus-5-5', SONNET = 'claude-sonnet-5-5', HAIKU = 'claude-haiku-4-5-20251001', FABLE = 'claude-fable-5-1'
const all = good.models.map((m) => m.id)
const OPENAI = good.models.filter((m) => m.provider === 'openai').map((m) => m.id) // OpenAI's models stay on offer when an Anthropic entry is left out
const tag = `[${SCENARIO}]`

const EXPECT = {
  'wrong-version': { available: false, error: /schemaVersion is "0\.1", but this version of the app reads 0\.4/ },
  'no-usable-models': { available: false, error: /none of the entries in models is usable/, logMore: [/unknown field "effrot"/] },
  'default-missing': { available: false, error: /defaultModelId "claude-nope" is not one of the usable models/ },
  'default-is-broken-entry': { available: false, error: /defaultModelId "claude-opus-5-5" is not one of the usable models/, logMore: [/models\[1\] \("claude-opus-5-5"\): effort must be one of "none", "low", "medium", "high", "xhigh", "max" or null/] },
  'one-bad-entry': { available: true, ids: [FABLE, OPUS, SONNET, ...OPENAI], selected: OPUS, logMore: [/models\[3\] \("claude-haiku-4-5-20251001"\): effort is set, but capabilities\.effortLevels is empty: this model takes no effort setting/] },
  'unknown-provider': { available: true, ids: [FABLE, OPUS, SONNET, ...OPENAI], selected: OPUS, logMore: [/models\[3\] \("claude-haiku-4-5-20251001"\): provider "gemini" is not one this version of the app can call/] },
  reordered: { available: true, ids: [...all].reverse(), selected: OPUS, logMore: [] },
  'default-sonnet': { available: true, ids: all, selected: SONNET, logMore: [] },
  'saved-skipped': { available: true, ids: [FABLE, OPUS, SONNET, ...OPENAI], selected: OPUS, logMore: [/models\[3\] \("claude-haiku-4-5-20251001"\)/, /The saved model "claude-haiku-4-5-20251001" is not in the registry any more, so the default is used\./] }
}[SCENARIO]
if (!EXPECT) throw new Error('unknown scenario ' + SCENARIO)

await page.waitFor(`!!document.querySelector('.app-header-actions')`, { timeoutMs: 15000 })
await sleep(600)

// ---- a key can always be saved, whatever the registry looks like ----
const key = 'test-' + randomBytes(24).toString('hex')
await fetch(`${mockUrl}/__reset`, { method: 'POST' })
await fetch(`${mockUrl}/__expect-key`, { method: 'POST', body: JSON.stringify({ key }) })
await page.click('.header-button@Settings')
await page.waitFor(`!!document.querySelector('dialog.settings')?.open`)
const dialogText0 = await ev(`document.querySelector('dialog.settings').innerText`)
await ev(`document.getElementById('api-key-anthropic').select()`)
await page.type(key)
await page.click('.settings button[type=submit]')
await page.waitFor(`document.querySelector('.settings-status').innerText === 'A key is saved.'`)
check(`${tag} a key can be saved whatever state the registry is in`, true)

const status = await H.status()
const log = readFileSync(process.env.APP_LOG, 'utf8')

if (!EXPECT.available) {
  // ===================== the registry cannot be used at all =====================
  check(`${tag} getStatus: no models, nothing selected, the reason given, no "checked on" date`, status.models.length === 0 && status.selectedModelId === null && EXPECT.error.test(status.modelsError ?? '') && status.modelsCheckedOn === null, JSON.stringify({ n: status.models.length, sel: status.selectedModelId, err: status.modelsError }))
  check(`${tag} Settings, Model section, says so in an error style: "The list of models could not be loaded: ..."`, /The list of models could not be loaded: /.test(dialogText0) && EXPECT.error.test(dialogText0) && (await ev(`!!document.querySelector('dialog.settings .settings-notice-error')`)), dialogText0.match(/The list of models[^\n]*/)?.[0])
  await page.press('Escape')
  await sleep(250)
  check(`${tag} there is NO model menu (no hidden fallback list)`, (await H.menu()) === null)
  const badges = await H.badges()
  check(`${tag} the header shows a warning badge "Models unavailable", with the reason as its tooltip`, badges.length === 1 && badges[0].text === 'Models unavailable' && badges[0].warn && EXPECT.error.test(badges[0].title), JSON.stringify(badges))
  const hint = await ev(`document.querySelector('.empty-state')?.textContent ?? ''`)
  check(`${tag} the empty chat explains it and points at the file`, /The list of models could not be loaded \(/.test(hint) && /so replies are unavailable\. Check registry\/models\.json\./.test(hint), hint.slice(0, 160))
  await page.screenshot(`${process.argv[2]}/3-6-${SCENARIO}.png`)
  await H.sendAndWait('hello with a broken registry')
  const note = await H.noteText()
  check(`${tag} sending a message is explained, not mysterious`, /^The list of models could not be loaded: /.test(note ?? '') && EXPECT.error.test(note ?? '') && /Check registry\/models\.json\.$/.test(note ?? ''), JSON.stringify(note))
  check(`${tag} NO request reached the API (a key is saved, so only the missing model list stopped it)`, (await H.mockReqs()).length === 0, String((await H.mockReqs()).length))
  check(`${tag} the input is ready again`, await ev(`!!document.querySelector('.composer-button[type=submit]')`))
  const set = await ev(`window.api.settings.setModel(${JSON.stringify(OPUS)})`)
  check(`${tag} setModel is refused (there is nothing to choose from), and nothing is saved`, set.ok === false && H.prefs() === null, JSON.stringify(set))
  check(`${tag} the app log says why, once, at startup`, EXPECT.error.test(log) && /registry\/models\.json cannot be used: /.test(log), log.split('\n').filter((l) => /registry/.test(l)).join(' | ').slice(0, 300))
  for (const re of EXPECT.logMore ?? []) check(`${tag} ...and names the entries that were left out: ${re}`, re.test(log))
} else {
  // ===================== the registry works (possibly with entries left out, or a different order/default) =====================
  await page.press('Escape')
  await sleep(250)
  const menu = await H.menu()
  check(`${tag} the menu lists exactly: ${EXPECT.ids.map(L).join(', ')}`, JSON.stringify(menu?.values) === JSON.stringify(EXPECT.ids) && JSON.stringify(menu?.labels) === JSON.stringify(EXPECT.ids.map(L)), JSON.stringify(menu?.labels))
  check(`${tag} the selected model is ${L(EXPECT.selected)}`, menu?.value === EXPECT.selected && status.selectedModelId === EXPECT.selected, `${menu?.value} / ${status.selectedModelId}`)
  if (SCENARIO === 'reordered') check(`${tag} the default is the registry's defaultModelId, NOT the first entry`, menu.values[0] !== EXPECT.selected && menu.value === OPUS, JSON.stringify(menu.values))
  check(`${tag} no registry error is reported to the page`, status.modelsError === null && status.models.length === EXPECT.ids.length)
  check(`${tag} the left-out entries are not offered to the page at all`, EXPECT.ids.length === all.length || !JSON.stringify(status).includes(HAIKU))
  check(`${tag} nothing is saved just because a default applies`, H.prefs() === (SCENARIO === 'saved-skipped' ? '{"version":1,"modelId":"claude-haiku-4-5-20251001"}' : null), String(H.prefs()))
  await H.sendAndWait('hello with this registry')
  const req = (await H.mockReqs()).at(-1)
  check(`${tag} a chat works, and goes to ${EXPECT.selected}`, (await H.bubbleText()) === 'Echo: hello with this registry' && req?.body.model === EXPECT.selected && req.problems.length === 0, JSON.stringify([req?.body.model, req?.problems]))
  if (SCENARIO === 'default-sonnet') {
    check(`${tag} the request has Sonnet's settings (effort medium)`, JSON.stringify(req.body.output_config) === '{"effort":"medium"}')
    const text = await H.settingsText()
    check(`${tag} Settings describes Sonnet`, /Claude Sonnet 5\.5, from Anthropic/.test(text))
  }
  check(`${tag} the log reports every left-out entry, and says nothing about the registry being unusable`, !/cannot be used/.test(log) && (EXPECT.logMore ?? []).every((re) => re.test(log)), log.split('\n').filter((l) => /registry|saved model/.test(l)).join(' | ').slice(0, 400))
  if (SCENARIO === 'one-bad-entry') {
    await H.chooseInPage(SONNET)
    await H.settle(SONNET)
    check(`${tag} the models that are left work normally: choose Sonnet, saved`, H.prefs() === `{"version":1,"modelId":"${SONNET}"}`)
  }
  await page.screenshot(`${process.argv[2]}/3-6-${SCENARIO}.png`)
}
check(`${tag} the key is not in the app log`, !log.includes(key))
check(`${tag} no console errors, warnings or exceptions in the page`, page.problems.length === 0, page.problems.join(' | '))
const passed = check.summary()
page.close()
process.exit(passed ? 0 : 1)
