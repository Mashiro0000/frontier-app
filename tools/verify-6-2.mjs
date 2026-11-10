// Stage 6 (D-023), in the real window: the Task menu, the "(suggested)" marks in the model menu, and the promise that
// nothing is chosen for the person. A key is saved straight through window.api on a SCRATCH profile (the guard checks it),
// then the page is reloaded so it asks main again; the models are never called.
// Needs: USER_DATA_DIR (the scratch profile, nothing saved in it). Run through run-with-app.mjs / drive.mjs.
import './ts-resolve.mjs'
import { connect, checker, sleep } from './cdp.mjs'
import { assertScratchProfile } from './profile-guard.mjs'
import { helpers } from './lib3.mjs'
import { SHOTS } from './paths.mjs'
import { randomBytes } from 'node:crypto'
import { join } from 'node:path'

const port = Number(process.argv[3] ?? 9222)
const userData = process.env.USER_DATA_DIR
if (!userData) throw new Error('USER_DATA_DIR must be set')
const check = checker()
const page = await connect(port)
await assertScratchProfile()
const H = helpers(page, { userData })
const { ev } = H

const OPUS = 'claude-opus-5-5', SONNET = 'claude-sonnet-5-5', FABLE = 'claude-fable-5-1'
// "Quick answer" had one row, Claude Haiku 4.5's; the model and its row were removed on 2026-10-06 (D-036), so it has no suggestion with any key.
const ASTRA = 'gpt-6-astra', SOL = 'gpt-6.1-sol', LUNA = 'gpt-6-luna'
const READY = `document.readyState === 'complete' && !!document.querySelector('.header-select, .app-badge')`
const reload = async () => {
  await page.send('Page.reload')
  await sleep(600)
  await page.waitFor(READY, { timeoutMs: 20000, label: 'the page to be ready after the reload' })
  await page.waitFor(`!!document.querySelector('.task-select')`, { timeoutMs: 10000, label: 'the Task menu' })
}
const taskMenu = () => ev(`(() => { const s = document.querySelector('.task-select'); return s && { values: [...s.options].map((o) => o.value), labels: [...s.options].map((o) => o.textContent), value: s.value, title: s.title, aria: s.getAttribute('aria-label'), disabled: s.disabled } })()`)
const modelMenu = () => ev(`(() => { const s = document.querySelector('.header-select'); return { values: [...s.options].map((o) => o.value), labels: [...s.options].map((o) => o.textContent), value: s.value } })()`)
const chooseTask = async (id) => {
  await ev(`(() => { const s = document.querySelector('.task-select'); s.value = ${JSON.stringify(id)}; s.dispatchEvent(new Event('change', { bubbles: true })) })()`)
  await page.waitFor(`document.querySelector('.task-select').value === ${JSON.stringify(id)}`)
  await sleep(150)
}
const marked = async () => {
  const m = await modelMenu()
  return m.values.filter((v, i) => /\(suggested\)$/.test(m.labels[i]))
}
const note = () => ev(`document.querySelector('.task-note')?.textContent ?? null`)
const status = () => ev(`window.api.settings.getStatus()`)
const sameSet = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort())
const fakeKey = () => 'test-' + randomBytes(24).toString('hex')

await page.waitFor(READY, { timeoutMs: 20000 })
await page.waitFor(`!!document.querySelector('.task-select')`, { timeoutMs: 10000, label: 'the Task menu' })

// ============ 1. no key saved: a menu, and nothing to suggest ============
const t0 = await taskMenu()
check('the header has a Task menu, labelled "Task", enabled', t0 && t0.aria === 'Task' && t0.disabled === false, JSON.stringify(t0))
check('...offering "Any task", Chat, Coding, Writing, Quick answer, in this order, starting on "Any task"', JSON.stringify(t0.labels) === JSON.stringify(['Any task', 'Chat', 'Coding', 'Writing', 'Quick answer']) && JSON.stringify(t0.values) === JSON.stringify(['', 'chat', 'coding', 'writing', 'quick']) && t0.value === '', JSON.stringify(t0))
check('the model menu is still the FIRST ".header-select" (the older suites find it that way); the Task menu is a different class', await ev(`document.querySelector('.header-select').getAttribute('aria-label') === 'Model' && document.querySelectorAll('.header-select').length === 1`))
const st0 = await status()
check('getStatus: the four tasks, and no suggestions while no key is saved', JSON.stringify(st0.tasks.map((t) => t.id)) === '["chat","coding","writing","quick"]' && st0.suggestions.length === 0 && st0.providers.every((p) => p.hasKey === false), JSON.stringify(st0.suggestions))
check('"Any task": no mark in the model menu and no note', (await marked()).length === 0 && (await note()) === null)
const model0 = (await status()).selectedModelId
await chooseTask('coding')
check('Coding with no key: nothing is marked, and the page SAYS there is no suggestion for coding', (await marked()).length === 0 && (await note()) === 'No suggestion for coding', String(await note()))
check('...and the Task menu\'s tooltip says nothing is guessed', /Nothing is guessed/.test((await taskMenu()).title))

// ============ 2. an Anthropic key: only the Anthropic rows ============
const saved = await ev(`window.api.settings.setApiKey('anthropic', ${JSON.stringify(fakeKey())}).then((r) => r.ok)`)
check('(setup) an invented Anthropic key was saved on the scratch profile', saved === true)
await reload()
const st1 = await status()
check('getStatus: with an Anthropic key, exactly the three Anthropic rows (Opus coding; Sonnet coding and writing)', JSON.stringify(st1.suggestions.map((s) => `${s.modelId}:${s.task}`)) === JSON.stringify([`${OPUS}:coding`, `${SONNET}:coding`, `${SONNET}:writing`]), JSON.stringify(st1.suggestions.map((s) => `${s.modelId}:${s.task}`)))
check('...each carries what the documentation said, an https page and a date (the page is shown where it came from)', st1.suggestions.every((s) => s.note.includes('"') && /^https:\/\//.test(s.source) && /^\d{4}-\d{2}-\d{2}$/.test(s.asOf)))
check('a reload forgets the task: back on "Any task", nothing marked', (await taskMenu()).value === '' && (await marked()).length === 0)
await chooseTask('coding')
check('Coding: Opus 5.5 and Sonnet 5.5 are marked "(suggested)", no other model is', sameSet(await marked(), [OPUS, SONNET]), JSON.stringify(await marked()))
const m1 = await modelMenu()
check('...the label is the model\'s own name plus " (suggested)", and the value is still the plain model id', m1.labels[m1.values.indexOf(OPUS)] === 'Claude Opus 5.5 (suggested)' && m1.values.includes(OPUS) && m1.values.every((v) => /^[a-z0-9._-]+$/.test(v)), JSON.stringify(m1.labels))
check('...no note (there IS a suggestion), and the tooltip lists both with their page and date', (await note()) === null && (await taskMenu()).title.includes('Claude Opus 5.5:') && (await taskMenu()).title.includes('Claude Sonnet 5.5:') && (await taskMenu()).title.includes('https://platform.claude.com/docs/en/about-claude/models/choosing-a-model') && (await taskMenu()).title.includes('2026-10-01'), (await taskMenu()).title)
await chooseTask('writing')
check('Writing: only Sonnet 5.5', sameSet(await marked(), [SONNET]), JSON.stringify(await marked()))
await chooseTask('quick')
check('Quick answer: nothing is marked (its only row was Haiku 4.5\'s, removed with the model), and the page says so', (await marked()).length === 0 && (await note()) === 'No suggestion for quick answer', String(await note()))
await chooseTask('chat')
check('Chat: nothing is marked, and the page says there is no suggestion for chat (no source names one)', (await marked()).length === 0 && (await note()) === 'No suggestion for chat', String(await note()))
await chooseTask('')
check('back to "Any task": the marks and the note are gone', (await marked()).length === 0 && (await note()) === null)

// ============ 3. choosing a task chooses nothing ============
check('the model that answers never changed while the task changed (main still reports the first one)', (await status()).selectedModelId === model0 && (await modelMenu()).value === model0, `${model0} / ${(await status()).selectedModelId}`)
check('...and nothing was written to preferences.json (no model was saved)', H.prefs() === null, String(H.prefs()))

// ============ 4. both keys ============
await ev(`window.api.settings.setApiKey('openai', ${JSON.stringify(fakeKey())}).then((r) => r.ok)`)
await reload()
await chooseTask('coding')
check('with both keys, Coding: Opus, Sonnet, Astra and Sol are marked; Fable and Luna are not', sameSet(await marked(), [OPUS, SONNET, ASTRA, SOL]) && !(await marked()).some((id) => [FABLE, LUNA].includes(id)), JSON.stringify(await marked()))
await chooseTask('writing')
check('Writing: Sonnet and Astra', sameSet(await marked(), [SONNET, ASTRA]), JSON.stringify(await marked()))
await chooseTask('quick')
check('Quick answer, with both keys: still nothing (OpenAI states no latency, so no GPT model is named either), and the page says so', (await marked()).length === 0 && (await note()) === 'No suggestion for quick answer', String(await note()))
// (23.3, D-055) the Task menu is in the model chooser: it takes the keyboard there, once the chooser is open
await page.click('.header-select'); await sleep(400)
const choice = await ev(`(() => { const s = document.querySelector('dialog.model-chooser[open] .task-select'); s?.focus(); return !!s && document.activeElement === s })()`)
await page.press('Escape'); await sleep(300)
check('the Task menu can take the keyboard focus (in the model chooser)', choice === true)
await page.screenshot(join(SHOTS, 'verify-6-2-quick.png'))

// ============ 5. a key removed: its models drop out of the suggestions at once ============
await ev(`window.api.settings.clearApiKey('anthropic')`)
await reload()
await chooseTask('coding')
check('Anthropic key removed (after a reload): Coding marks only Astra and Sol', sameSet(await marked(), [ASTRA, SOL]), JSON.stringify(await marked()))
await chooseTask('quick')
check('...and Quick answer still has no suggestion, which the page says', (await marked()).length === 0 && (await note()) === 'No suggestion for quick answer', String(await note()))
await page.screenshot(join(SHOTS, 'verify-6-2-none.png'))

// ============ 6. the page does not break ============
check('no console errors and no page exceptions during the run', page.problems.length === 0, JSON.stringify(page.problems.slice(0, 3)))

const passed = check.summary()
process.exit(passed ? 0 : 1)
