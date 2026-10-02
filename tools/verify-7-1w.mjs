// Stage 7.1 (D-024), in the real window against the mock: the Effort menu, what it offers per model, what each reply asks for, how the
// choice is saved (per model, in preferences.json, beside the model choice), what a misbehaving page cannot do, and the header at
// narrow widths. FIRST launch on a fresh scratch profile; it leaves a known state for verify-7-1b.mjs (the restart).
// Needs: MOCK_PORT, USER_DATA_DIR (scratch profile inside the real %APPDATA%), APP_LOG. Keys are invented and saved through window.api.
import './ts-resolve.mjs'
import { connect, checker, sleep } from './cdp.mjs'
import { assertScratchProfile } from './profile-guard.mjs'
import { helpers, lcg, readRegistry } from './lib3.mjs'
import { randomBytes, createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

const shots = process.argv[2]
const port = Number(process.argv[3] ?? 9222)
const mockUrl = `http://127.0.0.1:${process.env.MOCK_PORT}`
const userData = process.env.USER_DATA_DIR
if (!process.env.MOCK_PORT || !userData) throw new Error('MOCK_PORT and USER_DATA_DIR must be set')
const check = checker()
const page = await connect(port)
await assertScratchProfile()
const H = helpers(page, { userData, mockUrl })
const { ev } = H

const registry = readRegistry()
const OPUS = 'claude-opus-5-5', SONNET = 'claude-sonnet-5-5', HAIKU = 'claude-haiku-4-5-20251001', FABLE = 'claude-fable-5-1'
const ASTRA = 'gpt-6-astra', SOL = 'gpt-6.1-sol', LUNA = 'gpt-6-luna'
const READY = `document.readyState === 'complete' && !!document.querySelector('.header-select, .app-badge')`
const fakeKey = () => 'test-' + randomBytes(24).toString('hex')
const sha = () => createHash('sha256').update(readFileSync(H.prefFile)).digest('hex').slice(0, 16)
// The app writes preferences.json in place, so a read can land in the middle of a write (empty or cut off): that is "not there yet",
// not a failure of the app (D-010). Callers that need the file poll; this answers null for such a moment.
const prefsJson = () => {
  try { const t = H.prefs(); return t === null ? null : JSON.parse(t) } catch { return null }
}
/** The parsed file once it is whole and `ok` accepts it (or null after `timeoutMs`). */
const prefsWhen = async (ok, timeoutMs = 4000) => {
  const t0 = Date.now()
  for (;;) {
    const file = prefsJson()
    if (file !== null && ok(file)) return file
    if (Date.now() - t0 > timeoutMs) return file
    await sleep(30)
  }
}
const reset = () => fetch(`${mockUrl}/__reset`, { method: 'POST' })
const reload = async () => {
  await page.send('Page.reload')
  await sleep(600)
  await page.waitFor(READY, { timeoutMs: 20000, label: 'the page to be ready after the reload' })
}

const effortMenu = () => ev(`(() => { const s = document.querySelector('.effort-select'); return s && { values: [...s.options].map((o) => o.value), labels: [...s.options].map((o) => o.textContent), value: s.value, title: s.title, aria: s.getAttribute('aria-label'), disabled: s.disabled, tag: s.tagName } })()`)
const status = () => ev(`window.api.settings.getStatus()`)
const setEffortInPage = (level) => ev(`(() => { const s = document.querySelector('.effort-select'); s.value = ${JSON.stringify(level)}; s.dispatchEvent(new Event('change', { bubbles: true })); return s.value })()`)
/** Waits until main reports `level` as the selected effort and the menu shows it. */
const settleEffort = async (level, timeoutMs = 6000) => {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    const [st, menu] = [await status(), await effortMenu()]
    if (st.effort?.selected === level && menu?.value === level) return Date.now() - t0
    await sleep(40)
  }
  throw new Error(`timed out waiting for the effort to become ${level}`)
}
const chooseEffort = async (level) => { await setEffortInPage(level); await settleEffort(level) }
const chooseModel = async (id) => { await H.chooseInPage(id); await H.settle(id); await page.waitFor(`document.querySelector('.effort-select') ? true : ${id === HAIKU ? 'true' : 'false'}`) }
const lastReq = async () => (await H.mockReqs()).at(-1)
/** Sends one message to whatever model is selected and returns the request the mock received for it (a stub that fails the checks if none came). */
const ask = async (text) => {
  await reset()
  return (await H.askMock(text)) ?? { provider: null, body: {}, problems: ['no request reached the mock'] }
}
const effortSent = (req) => (req.provider === 'openai' ? req.body.reasoning?.effort : req.body.output_config?.effort) ?? null

// Everything below runs inside this try, so a wait that times out or a page that goes away ends the run as a FAILED CHECK with a summary
// line, not as a crash: a crash shows as no summary at all (the drivers say CRASHED), and in a negative control it cannot be told from
// "the sabotage was noticed".
try {
await page.waitFor(READY, { timeoutMs: 20000 })
await ev(`window.api.settings.setApiKey('anthropic', ${JSON.stringify(fakeKey())}).then((r) => r.ok)`)
await ev(`window.api.settings.setApiKey('openai', ${JSON.stringify(fakeKey())}).then((r) => r.ok)`)
await reload()
await reset()

// ============ A. a fresh profile: Opus, with its registry pick ============
const m0 = await effortMenu()
check('the header has an Effort menu: a <select>, labelled "Effort", enabled', m0 && m0.tag === 'SELECT' && m0.aria === 'Effort' && m0.disabled === false, JSON.stringify(m0))
check('...Opus offers five levels, from least to most thinking', JSON.stringify(m0.values) === '["low","medium","high","xhigh","max"]', JSON.stringify(m0.values))
check('...worded: the first is "faster", the last "smarter", the registry\'s pick "default"', JSON.stringify(m0.labels) === JSON.stringify(['Effort: Low (faster)', 'Effort: Medium (default)', 'Effort: High', 'Effort: Extra high', 'Effort: Max (smarter)']), JSON.stringify(m0.labels))
check('...it starts on the registry\'s pick for Opus (medium)', m0.value === 'medium')
check('...its tooltip says higher is slower, billed as output, and that a reply may be cut off', /slower/.test(m0.title) && /billed as output/.test(m0.title) && /cut off/.test(m0.title), m0.title)
check('the model menu is still the FIRST and ONLY ".header-select" (older suites find it that way); the Effort menu has its own class', await ev(`document.querySelectorAll('.header-select').length === 1 && document.querySelector('.header-select').getAttribute('aria-label') === 'Model'`))
check('the Effort menu comes right after the model menu in the header', await ev(`(() => { const all = [...document.querySelectorAll('.app-header-actions > *')]; const i = all.findIndex((e) => e.classList.contains('header-select')); return all[i + 1]?.classList.contains('effort-select') === true })()`))
const st0 = await status()
check('getStatus.effort is exactly { levels, selected, default } for the chosen model', Object.keys(st0.effort).join() === 'levels,selected,default' && st0.effort.selected === 'medium' && st0.effort.default === 'medium', JSON.stringify(st0.effort))
check('...and the model list itself still says nothing about effort', st0.models.every((m) => !/effort/i.test(JSON.stringify(m))))
check('reading the status wrote nothing: no preferences.json yet', H.prefs() === null)
const r0 = await ask('hello default')
check('a reply at the default sends exactly what Stage 6 sent: output_config { effort: "medium" }, and the strict mock accepts it', JSON.stringify(r0.body.output_config) === '{"effort":"medium"}' && r0.problems.length === 0, JSON.stringify(r0.body.output_config))
check('...and still no preferences.json: replying saves nothing about effort', H.prefs() === null)
await page.screenshot(`${shots}/7-1-header-opus.png`)

// ============ B. choosing a level ============
await chooseEffort('high')
check('choose High: the menu shows it and main reports it as selected', (await effortMenu()).value === 'high' && (await status()).effort.selected === 'high')
check('...it is saved in preferences.json, which holds no model (none was ever chosen), exactly: {"version":1,"efforts":{"claude-opus-5-5":"high"}}', H.prefs() === `{"version":1,"efforts":{"${OPUS}":"high"}}`, H.prefs())
check('...written in place, no temporary file left (the AppData here is EFS-encrypted)', H.strayFiles().length === 0, JSON.stringify(H.strayFiles()))
check('...the registry\'s pick is still what "default" says', (await status()).effort.default === 'medium' && /Medium \(default\)/.test((await effortMenu()).labels[1]))
const r1 = await ask('hello high')
check('the next reply asks for High: output_config { effort: "high" }, accepted by the mock, max_tokens still 16000', JSON.stringify(r1.body.output_config) === '{"effort":"high"}' && r1.problems.length === 0 && r1.body.max_tokens === 16000, JSON.stringify(r1.body.output_config))
check('...the model chosen is still the default, Opus (choosing an effort did not choose a model)', r1.body.model === OPUS && (await status()).selectedModelId === OPUS)

// ============ C. per model: the choice belongs to the model ============
await chooseModel(SONNET)
let menu = await effortMenu()
check('switch to Sonnet: its menu shows ITS pick (medium), not Opus\'s High', menu.value === 'medium' && (await status()).effort.selected === 'medium', menu.value)
check('...the file keeps Opus\'s level and adds the model: {"version":1,"modelId":"claude-sonnet-5-5","efforts":{"claude-opus-5-5":"high"}}', H.prefs() === `{"version":1,"modelId":"${SONNET}","efforts":{"${OPUS}":"high"}}`, H.prefs())
await chooseEffort('low')
check('Sonnet at Low: saved beside Opus\'s', JSON.stringify(prefsJson()) === JSON.stringify({ version: 1, modelId: SONNET, efforts: { [OPUS]: 'high', [SONNET]: 'low' } }), H.prefs())
const r2 = await ask('hello sonnet low')
check('...and Sonnet\'s reply asks for Low', r2.body.model === SONNET && JSON.stringify(r2.body.output_config) === '{"effort":"low"}' && r2.problems.length === 0)
await chooseModel(OPUS)
check('back to Opus: it still shows High (one choice per model, remembered)', (await effortMenu()).value === 'high' && (await status()).effort.selected === 'high')
check('...choosing the model kept both levels in the file', JSON.stringify(prefsJson()) === JSON.stringify({ version: 1, modelId: OPUS, efforts: { [OPUS]: 'high', [SONNET]: 'low' } }), H.prefs())
const r3 = await ask('hello opus again')
check('...and Opus\'s reply asks for High again', r3.body.model === OPUS && JSON.stringify(r3.body.output_config) === '{"effort":"high"}')
await chooseModel(FABLE)
menu = await effortMenu()
check('Fable has its own pick, high, and the same five levels', menu.value === 'high' && JSON.stringify(menu.values) === '["low","medium","high","xhigh","max"]' && menu.labels[2] === 'Effort: High (default)', JSON.stringify(menu.labels))

// ============ D. a model that takes no effort: no menu, nothing sent ============
await chooseModel(HAIKU)
check('Haiku 4.5 takes no effort: the Effort menu is not in the page at all', await ev(`document.querySelector('.effort-select') === null`))
const stH = await status()
check('...and main says so: effort is null', stH.effort === null && stH.selectedModelId === HAIKU)
const rH = await ask('hello haiku')
check('...its request carries no output_config at all, and the mock (which refuses effort on Haiku) accepts it', rH.body.model === HAIKU && !('output_config' in rH.body) && rH.problems.length === 0)
check('...the levels chosen for the other models are still in the file', JSON.stringify(prefsJson().efforts) === JSON.stringify({ [OPUS]: 'high', [SONNET]: 'low' }) && prefsJson().modelId === HAIKU, H.prefs())
await page.screenshot(`${shots}/7-1-header-haiku.png`)

// ============ E. OpenAI models: their own levels, and "none" for Luna ============
await chooseModel(ASTRA)
menu = await effortMenu()
check('GPT-6 Astra: five levels, medium by default (the registry\'s pick)', JSON.stringify(menu.values) === '["low","medium","high","xhigh","max"]' && menu.value === 'medium', JSON.stringify(menu))
await chooseEffort('xhigh')
const rA = await ask('hello astra')
check('Astra\'s reply asks reasoning { effort: "xhigh" } (the Responses API), and the mock accepts it', rA.provider === 'openai' && rA.body.model === ASTRA && JSON.stringify(rA.body.reasoning) === '{"effort":"xhigh"}' && rA.problems.length === 0, JSON.stringify(rA.body.reasoning))
await chooseModel(LUNA)
menu = await effortMenu()
check('GPT-6 Luna: six levels, "none" first, labelled as the faster end', JSON.stringify(menu.values) === '["none","low","medium","high","xhigh","max"]' && menu.labels[0] === 'Effort: None (faster)' && menu.value === 'medium', JSON.stringify(menu.labels))
await chooseEffort('none')
const rL = await ask('hello luna')
check('Luna at None: its reply asks reasoning { effort: "none" } and the mock accepts it', JSON.stringify(rL.body.reasoning) === '{"effort":"none"}' && rL.problems.length === 0, JSON.stringify(rL.body.reasoning))
await chooseModel(SOL)
check('Sol: medium by default, the same five levels as Astra (Luna\'s "none" is not offered)', (await effortMenu()).value === 'medium' && !(await effortMenu()).values.includes('none'))

// ============ F. while a reply is arriving ============
await chooseModel(OPUS)
await reset()
await H.send('[[mock:slow]] keep going')
await page.waitFor(`(document.querySelector('.message-assistant:last-child .bubble')?.textContent ?? '').includes('tick1')`, { timeoutMs: 8000 })
menu = await effortMenu()
check('while a reply is arriving the Effort menu is disabled, and says why', menu.disabled === true && /can be changed when the reply has finished/.test(menu.title), JSON.stringify([menu.disabled, menu.title]))
const inFlightBefore = effortSent((await H.mockReqs()).at(-1))
const mid = await ev(`window.api.settings.setEffort(${JSON.stringify(OPUS)}, 'low')`)
check('a (misbehaving) page that changes the effort mid-reply is accepted by main...', mid.ok === true && mid.status.effort.selected === 'low')
const inFlightAfter = await H.mockReqs()
check('...but the reply already running keeps its effort: the request in flight was sent with High', inFlightAfter.length === 1 && inFlightBefore === 'high' && effortSent(inFlightAfter[0]) === 'high', JSON.stringify(inFlightAfter.map(effortSent)))
await page.click('.composer-button-stop')
await page.waitFor(`!!document.querySelector('.composer-button[type=submit]')`, { timeoutMs: 4000 })
check('Stop unlocks the menu again', (await effortMenu()).disabled === false && !/finished/.test((await effortMenu()).title))
await reload() // the page was not told about that direct call, so it shows the old level until it asks main again
check('after a reload the page re-reads main\'s level (Low, set by that call)', (await effortMenu()).value === 'low' && (await status()).effort.selected === 'low')
const rNext = await ask('after the change')
check('the NEXT reply uses the new level', effortSent(rNext) === 'low' && rNext.problems.length === 0)
await chooseEffort('high')

// ============ G. what the page must not be able to do ============
const before = H.prefs()
const hash0 = sha()
const abuse = await ev(`(async () => {
  const out = []
  const cases = [
    ['unknown model', ['claude-opus-9', 'high']], ['upper-case model', [${JSON.stringify(OPUS.toUpperCase())}, 'high']], ['model with trailing space', [${JSON.stringify(OPUS + ' ')}, 'high']],
    ['a level Opus does not take ("none")', [${JSON.stringify(OPUS)}, 'none']], ['a level that does not exist', [${JSON.stringify(OPUS)}, 'extreme']], ['wrong case', [${JSON.stringify(OPUS)}, 'HIGH']], ['padded', [${JSON.stringify(OPUS)}, ' high']],
    ['Haiku, which takes none', [${JSON.stringify(HAIKU)}, 'low']], ['Sonnet with Luna\\'s level', [${JSON.stringify(SONNET)}, 'none']],
    ['__proto__ as the model', ['__proto__', 'high']], ['constructor as the model', ['constructor', 'high']], ['a path as the model', ['..\\\\..\\\\x', 'high']],
    ['numbers', [5, 7]], ['nulls', [null, null]], ['undefineds', [undefined, undefined]], ['objects', [{}, {}]], ['arrays', [[${JSON.stringify(OPUS)}], ['high']]], ['2 MB level', [${JSON.stringify(OPUS)}, 'x'.repeat(2000000)]]
  ]
  for (const [name, args] of cases) {
    try { const r = await window.api.settings.setEffort(...args); out.push([name, r.ok ? 'ACCEPTED' : 'refused: ' + r.error]) } catch (e) { out.push([name, 'threw: ' + String(e.message).slice(0, 80)]) }
  }
  try { const r = await window.api.settings.setEffort(); out.push(['no arguments', r.ok ? 'ACCEPTED' : 'refused: ' + r.error]) } catch (e) { out.push(['no arguments', 'threw: ' + String(e.message).slice(0, 80)]) }
  return out
})()`)
check(`bad input sent straight to setEffort is refused by main (${abuse.length} kinds, __proto__ included)`, abuse.length === 19 && abuse.every(([, v]) => v.startsWith('refused')), JSON.stringify(abuse.filter(([, v]) => !v.startsWith('refused'))))
check('...the refusals are plain sentences that do not echo the input', abuse.every(([, v]) => ['refused: The effort choice was not understood.', 'refused: That model is not available.', 'refused: That model does not take that effort level.'].includes(v)), JSON.stringify([...new Set(abuse.map(([, v]) => v))]))
check('...nothing was written (the file is byte-identical), and the selection did not move', H.prefs() === before && sha() === hash0 && (await status()).effort.selected === 'high' && (await status()).selectedModelId === OPUS)

const appUrl = await ev('location.href')
await ev(`setTimeout(() => { location.href = 'about:blank' }, 0); 0`)
await sleep(1200)
const blank = await ev(`(async () => {
  const settle = (p) => p.then((r) => 'RESOLVED ' + JSON.stringify(r).slice(0, 60), (e) => 'rejected: ' + String(e.message).slice(0, 120))
  return { where: location.href, api: typeof window.api, set: await settle(window.api.settings.setEffort(${JSON.stringify(OPUS)}, 'low')) }
})()`)
check('precondition: the page really is about:blank and still has window.api', blank.where === 'about:blank' && blank.api === 'object', JSON.stringify(blank))
check('setEffort from about:blank is rejected by main ("Blocked")', /^rejected: .*Blocked/.test(blank.set), blank.set)
check('...and nothing changed on disk', H.prefs() === before)
await page.send('Page.navigate', { url: appUrl })
await sleep(1800)
await page.waitFor(`!!document.querySelector('.effort-select')`, { timeoutMs: 10000 })
check('back on the app page: Opus is still at High', (await effortMenu()).value === 'high')

// ============ H. rapid changes: the last one wins everywhere ============
const rand = lcg(20261002)
const levels = ['low', 'medium', 'high', 'xhigh', 'max']
let rapidOk = 0
let rapidFail = null
const ROUNDS = 20
for (let round = 0; round < ROUNDS; round++) {
  const seq = Array.from({ length: 6 }, () => levels[Math.floor(rand() * levels.length)])
  const last = seq.at(-1)
  await ev(`(() => { const s = document.querySelector('.effort-select'); for (const level of ${JSON.stringify(seq)}) { s.value = level; s.dispatchEvent(new Event('change', { bubbles: true })) } })()`)
  await settleEffort(last)
  // the six calls are handled one at a time, in order: wait until the LAST one has reached the disk, then let any straggling answer arrive
  await prefsWhen((f) => f.efforts?.[OPUS] === last)
  await sleep(150)
  const [m, st, alerts] = [await effortMenu(), await status(), (await H.badges()).filter((b) => b.alert)]
  const file = (await prefsWhen((f) => f.efforts?.[OPUS] === last)) ?? {}
  const good = m.value === last && st.effort.selected === last && file.efforts?.[OPUS] === last && file.modelId === OPUS && alerts.length === 0 && H.strayFiles().length === 0 && file.efforts?.[SONNET] === 'low'
  if (good) rapidOk++
  else { rapidFail = { round, seq, menu: m.value, main: st.effort.selected, file: H.prefs(), alerts }; break }
}
check(`rapid changes: ${ROUNDS} bursts of 6 changes: the menu, main and the saved file all end on the last choice, nothing else in the file moved, no error`, rapidOk === ROUNDS, JSON.stringify(rapidFail))

// ============ I. keyboard, layout ============
await ev(`document.querySelector('.header-select').focus()`)
await page.press('Tab')
check('keyboard: Tab from the model menu lands on the Effort menu', (await ev(`document.activeElement.getAttribute('aria-label')`)) === 'Effort')
await page.press('Tab')
check('...and the next Tab lands on the Settings button', (await ev(`document.activeElement.textContent`)) === 'Settings')
await chooseEffort('medium')
await ev(`document.querySelector('.effort-select').focus()`)
await page.press('ArrowDown')
await settleEffort('high')
check('keyboard: ArrowDown on the focused Effort menu moves to the next level (High), saved', (await effortMenu()).value === 'high' && prefsJson().efforts[OPUS] === 'high')
check('...and the focus stays on the menu', (await ev(`document.activeElement.className`)) === 'effort-select')
for (const width of [420, 320]) {
  await page.send('Emulation.setDeviceMetricsOverride', { width, height: 600, deviceScaleFactor: 1, mobile: false })
  await sleep(250)
  const fit = await ev(`(() => ({ over: document.documentElement.scrollWidth > innerWidth, rights: [...document.querySelectorAll('.app-header > *, .app-header-actions > *')].map((e) => Math.round(e.getBoundingClientRect().right)), inner: innerWidth }))()`)
  check(`at ${width}px wide (keys saved: New chat, History, Task, Model, Effort, Settings): nothing overflows sideways`, !fit.over && fit.rights.every((r) => r <= fit.inner), JSON.stringify(fit))
  await page.screenshot(`${shots}/7-1-header-${width}.png`)
}
await page.send('Emulation.clearDeviceMetricsOverride')
await sleep(200)

// ============ J. the end state, left for the restart (verify-7-1b.mjs) ============
await chooseEffort('max')
await chooseModel(SONNET)
await chooseEffort('low')
await chooseModel(ASTRA)
await chooseEffort('xhigh')
await chooseModel(OPUS)
const end = prefsJson()
check('left behind for the restart test: Opus chosen, efforts Opus max, Sonnet low, Astra xhigh', end.modelId === OPUS && end.efforts[OPUS] === 'max' && end.efforts[SONNET] === 'low' && end.efforts[ASTRA] === 'xhigh', H.prefs())
await page.screenshot(`${shots}/7-1-header-end.png`)
const log = readFileSync(process.env.APP_LOG, 'utf8')
check('the app\'s log holds no key and no warning about effort from this run', !/test-[0-9a-f]{48}/.test(log) && !/saved effort level/.test(log))
check('no console errors, warnings or exceptions', page.problems.length === 0, page.problems.join(' | '))
} catch (error) {
  check(`the suite ran to its end (it stopped: ${String(error?.message ?? error).slice(0, 220)})`, false)
}
const passed = check.summary()
page.close()
process.exit(passed ? 0 : 1)
