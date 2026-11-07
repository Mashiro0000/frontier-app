// Stage 21.3 (D-053), Auto, in the real window against the mock (Anthropic's and OpenAI's keys saved; Google has none): the Auto card at the top of the
// chooser; Auto on: the menu says "Auto"; each message goes ONCE, to the model the rules pick (no task: the cheapest $$$ all-rounder; Quick answer: the
// cheapest; Coding: the lowest-priced model named for coding), with the model and the reason above the reply; the model menu's own choice is not changed;
// the saved chat names the model that answered; choosing a model in the chooser turns Auto off; a reload starts with Auto off. Screenshots in shots21.
// Needs: MOCK_PORT, USER_DATA_DIR (scratch) and setup-key.mjs.
import './ts-resolve.mjs'
import { mkdirSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { connect, checker, sleep } from './cdp.mjs'
import { assertScratchProfile } from './profile-guard.mjs'
import { helpers } from './lib3.mjs'

const shots = join(process.argv[2], '..', 'shots21')
mkdirSync(shots, { recursive: true })
const port = Number(process.argv[3] ?? 9222)
const mockUrl = `http://127.0.0.1:${process.env.MOCK_PORT}`
const userData = process.env.USER_DATA_DIR
if (!process.env.MOCK_PORT || !userData) throw new Error('MOCK_PORT and USER_DATA_DIR must be set')

const check = checker()
const page = await connect(port)
await assertScratchProfile()
const H = helpers(page, { userData, mockUrl })
const { ev } = H
const READY = `document.readyState === 'complete' && !!document.querySelector('.header-select')`
const OPEN = `!!document.querySelector('dialog.model-chooser')?.open`
const sectionOf = (provider) => `[...document.querySelectorAll('dialog.settings form.settings-section')].find((f) => f.querySelector('#api-key-${provider}'))`
const newestChat = () => {
  const dir = join(userData, 'conversations')
  const files = readdirSync(dir).filter((n) => /^[0-9a-f-]{36}\.json$/.test(n)).map((n) => JSON.parse(readFileSync(join(dir, n), 'utf8')))
  return files.sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? null
}
const sentModels = async () => (await H.mockReqs()).filter((r) => !r.listing).map((r) => r.body?.model)
const caption = () => H.lastAssistant(`a.querySelector('.message-model')?.textContent ?? null`)
const pillShown = () => ev(`(() => { const p = document.querySelector('.auto-pill'); const s = document.querySelector('.header-select'); return { pill: !!p && p.getBoundingClientRect().width > 2, select: !!s && !s.hidden && s.getBoundingClientRect().width > 2 } })()`)
const setTask = (id) => ev(`(() => { const s = document.querySelector('.task-select'); s.value = ${JSON.stringify(id)}; s.dispatchEvent(new Event('change', { bubbles: true })); return s.value })()`)
const ask = async (text) => { await fetch(`${mockUrl}/__reset`, { method: 'POST' }); await H.askMock(text); await sleep(300) }

try {
  await page.waitFor(READY, { timeoutMs: 20000 })
  // OpenAI's key too (as verify-9-3w), so that Auto has two makers to pick from.
  const openaiKey = 'sk-test-' + 'c'.repeat(40)
  await fetch(`${mockUrl}/__expect-key`, { method: 'POST', body: JSON.stringify({ key: openaiKey, provider: 'openai' }) })
  await page.click('.header-button@Settings')
  await page.waitFor(`!!document.querySelector('dialog.settings')?.open`)
  await ev(`document.getElementById('api-key-openai').select()`)
  await page.type(openaiKey)
  await ev(`(() => { const b = ${sectionOf('openai')}.querySelector('button[type=submit]'); b.setAttribute('data-click', '1'); b.scrollIntoView({ block: 'center' }) })()`)
  await sleep(150)
  await page.click('[data-click="1"]')
  await page.waitFor(`${sectionOf('openai')}.querySelector('.settings-notice')?.innerText === 'Saved.'`, { timeoutMs: 8000 })
  await page.press('Escape')
  await sleep(300)
  const chosen = (await H.status()).selectedModelId

  // ============ A. the Auto card ============
  check('A: Auto is off at first: the model menu shows, no "Auto"', JSON.stringify(await pillShown()) === '{"pill":false,"select":true}')
  await page.click('.header-select')
  await page.waitFor(OPEN, { timeoutMs: 4000 })
  const card = await ev(`(() => { const c = document.querySelector('dialog.model-chooser .model-card-auto'); const list = document.querySelector('dialog.model-chooser .model-chooser-list'); return c ? { pressed: c.getAttribute('aria-pressed'), name: c.querySelector('.model-card-name').textContent, desc: c.querySelector('.model-card-desc').textContent, above: c.getBoundingClientRect().bottom <= list.getBoundingClientRect().top + 1 } : null })()`)
  check('A: the chooser has an Auto card above the models, not pressed, saying what it does', card?.name === 'Auto' && card.pressed === 'false' && card.above && /by rules and without asking any model/.test(card.desc) && /sent\s+once, to one model/.test(card.desc), JSON.stringify(card))
  check('A: ...and the chosen model is marked as before', (await ev(`[...document.querySelectorAll('dialog.model-chooser .model-chooser-list .model-card[aria-pressed="true"]')].map((c) => c.dataset.model).join()`)) === chosen)
  const prefsBefore = H.prefs()
  await page.click('dialog.model-chooser .model-card-auto')
  await sleep(300)
  check('A: choosing Auto closes the chooser; the menu says "Auto" in place of the model', !(await ev(OPEN)) && JSON.stringify(await pillShown()) === '{"pill":true,"select":false}')
  check('A: the model menu\'s own choice is not changed (nothing saved)', (await H.status()).selectedModelId === chosen && H.prefs() === prefsBefore)
  await page.click('.auto-pill'); await page.waitFor(OPEN, { timeoutMs: 4000 })
  check('A: "Auto" opens the chooser, with Auto pressed and no model marked', (await ev(`document.querySelector('dialog.model-chooser .model-card-auto').getAttribute('aria-pressed')`)) === 'true' && (await ev(`document.querySelectorAll('dialog.model-chooser .model-chooser-list .model-card[aria-pressed="true"]').length`)) === 0)
  await page.screenshot(join(shots, '21-3-auto-card.png'))
  await page.press('Escape'); await sleep(250)

  // ============ B. each message once, to the model the rules pick ============
  await ask('Hello auto')
  let sent = await sentModels()
  check('B: no task: ONE request, to the cheapest $$$ all-rounder with a key (Claude Sonnet 5.5)', JSON.stringify(sent) === '["claude-sonnet-5-5"]', JSON.stringify(sent))
  check('B: above the reply: the model and Auto\'s reason', /^Claude Sonnet 5\.5\s*Auto: a balanced all-rounder at a middle price$/.test(await caption()), await caption())
  await setTask('quick'); await sleep(200)
  await ask('Quick one')
  sent = await sentModels()
  check('B: Quick answer: the cheapest model with a key (GPT-6 Luna, OpenAI)', JSON.stringify(sent) === '["gpt-6-luna"]', JSON.stringify(sent))
  check('B: ...and says why', /^GPT-6 Luna\s*Auto: the cheapest model you have a key for, for a quick answer$/.test(await caption()), await caption())
  await setTask('coding'); await sleep(200)
  await ask('Code please')
  sent = await sentModels()
  check('B: Coding: the lowest-priced model named for coding (Claude Sonnet 5.5; Gemini 3.8 Flash is cheaper but Google has no key)', JSON.stringify(sent) === '["claude-sonnet-5-5"]', JSON.stringify(sent))
  check('B: ...and says why', /Auto: the lowest-priced model its maker names for coding$/.test(await caption()), await caption())
  check('B: the model menu\'s own choice is still not changed', (await H.status()).selectedModelId === chosen)
  await sleep(800)
  const file = newestChat()
  const replies = (file?.messages ?? []).filter((m) => m.role === 'assistant').map((m) => m.model)
  check('B: the saved chat names the model that answered each reply', JSON.stringify(replies) === '["claude-sonnet-5-5","gpt-6-luna","claude-sonnet-5-5"]', JSON.stringify(replies))
  check('B: ...and no Auto reason is saved (on screen only)', !JSON.stringify(file).includes('autoReason') && !JSON.stringify(file).includes('balanced all-rounder'))
  await page.screenshot(join(shots, '21-3-auto-replies.png'))

  // ============ C. choosing a model turns Auto off ============
  await page.click('.auto-pill'); await page.waitFor(OPEN, { timeoutMs: 4000 })
  await ev(`document.querySelector('dialog.model-chooser .model-card[data-model="gpt-6.1-sol"]').scrollIntoView({ block: 'center' })`); await sleep(150)
  await page.click('dialog.model-chooser .model-card[data-model="gpt-6.1-sol"]')
  await H.settle('gpt-6.1-sol')
  check('C: choosing a model turns Auto off: the menu shows the model again, chosen and saved', JSON.stringify(await pillShown()) === '{"pill":false,"select":true}' && JSON.parse(H.prefs() ?? '{}').modelId === 'gpt-6.1-sol')
  await ask('Manual again')
  sent = await sentModels()
  check('C: the next message goes to that model, with no Auto line', JSON.stringify(sent) === '["gpt-6.1-sol"]' && !/Auto:/.test((await caption()) ?? ''), JSON.stringify(sent))

  // ============ D. a reload starts with Auto off ============
  await page.click('.header-select'); await page.waitFor(OPEN, { timeoutMs: 4000 })
  await page.click('dialog.model-chooser .model-card-auto'); await sleep(300)
  check('D: Auto on again', (await pillShown()).pill === true)
  await page.send('Page.reload'); await sleep(800)
  await page.waitFor(READY, { timeoutMs: 20000 })
  check('D: after a reload Auto is off (it is for one run of the app)', JSON.stringify(await pillShown()) === '{"pill":false,"select":true}')
} catch (error) {
  check('the suite ran to the end', false, error?.stack ?? String(error))
}
process.exit(check.summary() ? 0 : 1)
