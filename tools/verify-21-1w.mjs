// Stage 21.1 (D-053), the model chooser, in the real window against the mock: a real mouse press on the model menu opens a dialog (not the plain list),
// the search has the keyboard; every model of the registry is a card with its maker, the cost badge of shared/costTier and its exact prices; the chosen
// model is marked; the search, the maker filter and the cost filter; "No key" on the makers without one (setup-key saves Anthropic's only); choosing a card
// closes the dialog and saves the choice (preferences.json); Escape and the backdrop close it without a change; the keyboard still changes the menu; the
// dialog in a narrow window; both themes. Screenshots go to shots21. Needs: MOCK_PORT, USER_DATA_DIR (scratch) and a saved key (setup-key.mjs).
import './ts-resolve.mjs'
import { mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { connect, checker, sleep } from './cdp.mjs'
import { assertScratchProfile } from './profile-guard.mjs'
import { helpers } from './lib3.mjs'
import { REPO } from './paths.mjs'

const shots = join(process.argv[2], '..', 'shots21')
mkdirSync(shots, { recursive: true })
const port = Number(process.argv[3] ?? 9222)
const mockUrl = `http://127.0.0.1:${process.env.MOCK_PORT}`
const userData = process.env.USER_DATA_DIR
if (!process.env.MOCK_PORT || !userData) throw new Error('MOCK_PORT and USER_DATA_DIR must be set')

// The step and the price are worked out HERE, from the rule written in the plan ($1, $5, $15 a million output tokens), not by the app's own module: a check that
// used the module would agree with any mistake in it (the negative control w211-badge-from-input proved that).
const costTier = (pricing) => { const out = pricing.outputPerMTok; return out <= 1 ? 1 : out <= 5 ? 2 : out <= 15 ? 3 : 4 }
const perMillion = (usd) => (Number.isInteger(usd) ? `$${usd}` : `$${usd.toFixed(2)}`)
const registry = JSON.parse(readFileSync(`${REPO}/registry/models.json`, 'utf8'))
const check = checker()
const page = await connect(port)
await assertScratchProfile()
const H = helpers(page, { userData, mockUrl })
const { ev } = H
const READY = `document.readyState === 'complete' && !!document.querySelector('.header-select')`
const OPEN = `!!document.querySelector('dialog.model-chooser')?.open`
const cards = () => ev(`[...document.querySelectorAll('dialog.model-chooser .model-chooser-list .model-card')].map((c) => ({ id: c.dataset.model, name: c.querySelector('.model-card-name')?.textContent, maker: c.querySelector('.model-card-maker')?.textContent, badge: c.querySelector('.cost-badge')?.textContent, price: c.querySelector('.model-card-price')?.textContent, pressed: c.getAttribute('aria-pressed'), nokey: !!c.querySelector('.model-tag-warn') }))`)
const ids = async () => (await cards()).map((c) => c.id)
const setSearch = (text) => ev(`(() => { const i = document.querySelector('dialog.model-chooser .model-chooser-search'); /* the Library's and Experts' search boxes share the class and come first in the page */ const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, ${JSON.stringify(text)}); i.dispatchEvent(new Event('input', { bubbles: true })); return true })()`)
const chip = (group, text) => `dialog.model-chooser .model-chooser-filters[aria-label="${group}"] .chip@${text}`
const metrics = async (width, height = 700) => { await page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false }); await sleep(350) }
const clearMetrics = async () => { await page.send('Emulation.clearDeviceMetricsOverride'); await sleep(350) }
const cardIntoView = async (id) => { await ev(`document.querySelector('dialog.model-chooser .model-chooser-list .model-card[data-model="${id}"]').scrollIntoView({ block: 'center' })`); await sleep(200) }
const selectValue = () => ev(`document.querySelector('.header-select').value`)

try {
  await page.waitFor(READY, { timeoutMs: 20000 })
  await sleep(400)
  check('A: the chooser is closed at first', !(await ev(OPEN)))
  const before = await selectValue()

  // ============ A. a real mouse press on the model menu opens the chooser ============
  await page.click('.header-select')
  await page.waitFor(OPEN, { timeoutMs: 4000, label: 'the chooser to open' })
  check('A: a real click on the model menu opens the chooser dialog', await ev(OPEN))
  check('A: ...the search box has the keyboard', await ev(`document.activeElement?.classList.contains('model-chooser-search')`))
  check('A: ...the menu says it opens a dialog (aria-haspopup) and its tooltip says so', (await ev(`document.querySelector('.header-select').getAttribute('aria-haspopup')`)) === 'dialog' && /every model with its prices/.test(await ev(`document.querySelector('.header-select').title`)))
  check('A: the dialog is titled "Choose a model" and names the date the prices were checked', (await ev(`document.getElementById('model-chooser-title')?.textContent`)) === 'Choose a model' && (await ev(`document.querySelector('.model-chooser-head .settings-hint').textContent`)).includes(`checked on ${(await H.status()).modelsCheckedOn}`))

  // ============ B. every model a card: maker, badge, prices ============
  const all = await cards()
  check('B: every model of the registry is a card, in the registry\'s order', JSON.stringify(all.map((c) => c.id)) === JSON.stringify(registry.models.map((m) => m.id)), JSON.stringify(all.map((c) => c.id)))
  const wrong = registry.models.filter((m) => { const c = all.find((x) => x.id === m.id); return !c || c.badge !== '$'.repeat(costTier(m.pricing)) || c.price !== `${perMillion(m.pricing.inputPerMTok)} / ${perMillion(m.pricing.outputPerMTok)}` || c.name !== m.label })
  check('B: each card has the model\'s name, the cost badge of shared/costTier and its exact prices (sent / written per million)', wrong.length === 0, JSON.stringify(wrong.map((m) => m.id)))
  check('B: each card names its maker', all.every((c) => ['Anthropic', 'OpenAI', 'Google'].includes(c.maker)), JSON.stringify(all.map((c) => c.maker)))
  check('B: the chosen model, and only it, is marked', all.filter((c) => c.pressed === 'true').map((c) => c.id).join() === before, before)
  const provider = Object.fromEntries(registry.models.map((m) => [m.id, m.provider]))
  check('B: "No key" on the models of makers with no key saved (OpenAI, Google), not on Anthropic\'s', all.every((c) => c.nokey === (provider[c.id] !== 'anthropic')), JSON.stringify(all.map((c) => [c.id, c.nokey])))
  await page.screenshot(join(shots, '21-1-chooser-dark.png'))

  // ============ C. search and filters ============
  await setSearch('luna'); await sleep(150)
  check('C: a search for "luna" leaves GPT-6 Luna only', JSON.stringify(await ids()) === '["gpt-6-luna"]', JSON.stringify(await ids()))
  await setSearch('google flash'); await sleep(150)
  check('C: every word must match, in the name, the maker or the description ("google flash")', JSON.stringify(await ids()) === '["gemini-3.8-flash"]', JSON.stringify(await ids()))
  await setSearch('zzzz'); await sleep(150)
  check('C: nothing matches: no card, and the dialog says so', (await ids()).length === 0 && (await ev(`document.querySelector('.model-chooser-none')?.textContent`)) === 'No model matches.')
  await setSearch(''); await sleep(150)
  await page.click(chip('Maker', 'Google')); await sleep(200)
  check('C: the maker filter "Google" leaves Google\'s models only', JSON.stringify(await ids()) === JSON.stringify(registry.models.filter((m) => m.provider === 'google').map((m) => m.id)) && (await ev(`document.querySelector('${chip('Maker', 'Google').split('@')[0]}[aria-pressed="true"]')?.textContent`)) === 'Google')
  await page.click(chip('Maker', 'All')); await sleep(150)
  await page.click(`dialog.model-chooser .model-chooser-filters[aria-label="Cost"] .chip[title="Cheapest"]`); await sleep(200)
  check('C: the cost filter "$" leaves the cheapest step only', JSON.stringify(await ids()) === JSON.stringify(registry.models.filter((m) => costTier(m.pricing) === 1).map((m) => m.id)), JSON.stringify(await ids()))
  await page.click(`dialog.model-chooser .model-chooser-filters[aria-label="Cost"] .chip[title="Cheapest"]`); await sleep(200)
  check('C: pressing it again takes the filter off', (await ids()).length === registry.models.length)

  // ============ D. Escape and the backdrop close it, with no change ============
  await page.press('Escape'); await sleep(250)
  check('D: Escape closes the chooser and changes nothing', !(await ev(OPEN)) && (await selectValue()) === before)
  await page.click('.header-select'); await page.waitFor(OPEN, { timeoutMs: 4000 })
  check('D: it opens again with the filters cleared', (await ids()).length === registry.models.length && (await ev(`document.querySelector('.model-chooser-search').value`)) === '')
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 6, y: 6, button: 'left', clickCount: 1 })
  await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 6, y: 6, button: 'left', clickCount: 1 })
  await sleep(300)
  check('D: a click on the backdrop closes it, with no change', !(await ev(OPEN)) && (await selectValue()) === before)

  // ============ E. choosing a card saves the choice ============
  await page.click('.header-select'); await page.waitFor(OPEN, { timeoutMs: 4000 })
  await cardIntoView('gemini-3.8-flash'); await page.click('dialog.model-chooser .model-chooser-list .model-card[data-model="gemini-3.8-flash"]')
  await H.settle('gemini-3.8-flash')
  check('E: choosing a card closes the chooser and the model menu shows it', !(await ev(OPEN)) && (await selectValue()) === 'gemini-3.8-flash')
  check('E: ...main saved it (preferences.json) and says so in its status', JSON.parse(H.prefs() ?? '{}').modelId === 'gemini-3.8-flash' && (await H.status()).selectedModelId === 'gemini-3.8-flash')
  await page.click('.header-select'); await page.waitFor(OPEN, { timeoutMs: 4000 })
  check('E: opened again, the new choice is the marked card', (await cards()).filter((c) => c.pressed === 'true').map((c) => c.id).join() === 'gemini-3.8-flash')
  await cardIntoView('gemini-3.8-flash'); await page.click(`dialog.model-chooser .model-chooser-list .model-card[data-model="gemini-3.8-flash"]`); await sleep(300)
  check('E: choosing the chosen model again closes it and asks main nothing new', !(await ev(OPEN)) && (await selectValue()) === 'gemini-3.8-flash')

  // ============ F. the keyboard still uses the menu ============
  await H.chooseInPage(before)
  await H.settle(before)
  check('F: the menu still changes the model from the keyboard\'s side (its change handler), and no chooser opens for it', (await selectValue()) === before && !(await ev(OPEN)) && JSON.parse(H.prefs() ?? '{}').modelId === before)

  // ============ G. a narrow window, the light theme ============
  await metrics(420)
  await page.click('.header-select'); await page.waitFor(OPEN, { timeoutMs: 4000 })
  const narrow = await ev(`(() => { const d = document.querySelector('dialog.model-chooser').getBoundingClientRect(); const l = document.querySelector('.model-chooser-list'); const cols = getComputedStyle(l).gridTemplateColumns.split(' ').length; return { l: d.left, r: d.right, w: innerWidth, cols, side: l.scrollWidth - l.clientWidth } })()`)
  check('G: at 420 px the chooser fits the window, one card a row, nothing scrolls sideways', narrow.l >= 0 && narrow.r <= narrow.w && narrow.cols === 1 && narrow.side <= 0, JSON.stringify(narrow))
  await page.screenshot(join(shots, '21-1-chooser-420.png'))
  await page.press('Escape'); await sleep(200)
  await clearMetrics()
  await ev(`document.documentElement.dataset.theme = 'light'`)
  await page.click('.header-select'); await page.waitFor(OPEN, { timeoutMs: 4000 })
  const light = await ev(`(() => { const c = document.querySelector('.model-card'); const s = getComputedStyle(c); return { bg: s.backgroundColor, color: s.color } })()`)
  check('G: in the light theme the cards are light with dark text', /^rgb\((2[0-9]{2}), (2[0-9]{2}), (2[0-9]{2})\)$/.test(light.bg) && /^rgb\(([0-9]{1,2}), /.test(light.color), JSON.stringify(light))
  await page.screenshot(join(shots, '21-1-chooser-light.png'))
  await page.press('Escape'); await sleep(200)
} catch (error) {
  check('the suite ran to the end', false, error?.stack ?? String(error))
}
process.exit(check.summary() ? 0 : 1)
