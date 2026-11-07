// Stage 22.3 (D-054), Image Studio, in the real window against the mock: the sidebar row opens the page; with pictures off it says so and offers Settings; on,
// the styles are chips (one at a time, again to take it off); a style is added under the description ("Style: ...") in what goes to OpenAI and counted in the
// cost; the cost shows before anything is sent; Make sends ONE request, keeps the picture, shows it under "Your pictures", gives a fresh form, and puts
// nothing into the chat; the picture is in the Library too; the page in the light look and in a narrow window. Screenshots in shots22.
// Needs: USER_DATA_DIR (scratch), INSPECT_PORT, MOCK_PORT, FRONTIER_GUARD_ROOT.
import './temp-on-a.mjs'
import './ts-resolve.mjs'
import { connect, checker, sleep } from './cdp.mjs'
import { assertScratchProfile } from './profile-guard.mjs'
import { mainInspector, h4 } from './lib4.mjs'
import { installQuestions } from './lib10.mjs'
import { randomBytes } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

const shots = join(process.argv[2], '..', 'shots22')
mkdirSync(shots, { recursive: true })
const port = Number(process.argv[3] ?? 9222)
const userData = process.env.USER_DATA_DIR
const inspectPort = Number(process.env.INSPECT_PORT)
const mockUrl = `http://127.0.0.1:${process.env.MOCK_PORT}`
if (!userData || !inspectPort || !process.env.MOCK_PORT) throw new Error('USER_DATA_DIR, INSPECT_PORT and MOCK_PORT must be set')
const check = checker()
const show = (v) => JSON.stringify(v)?.slice(0, 600)
const page = await connect(port)
await assertScratchProfile()
const main = await mainInspector(inspectPort)
await installQuestions(main, { fallback: 'yes' })
const H = h4(page, { userData, mockUrl })
const ev = (expression) => page.evaluate(expression)
const KEY_O = 'sk-proj-' + randomBytes(24).toString('hex')
const KEY_A = 'sk-ant-api03-' + randomBytes(24).toString('hex')
const STUDIO = `!!document.querySelector('dialog.studio')?.open`
const imageRequests = async () => (await (await fetch(`${mockUrl}/__requests`)).json()).filter((r) => r.images)
const cost = () => ev(`document.querySelector('dialog.studio .make-image-cost')?.textContent ?? null`)
const waitCost = async (re, ms = 6000) => { const t0 = Date.now(); let last = null; while (Date.now() - t0 < ms) { last = await cost(); if (re.test(last ?? '')) return last; await sleep(80) } return last }
const styleChip = (id) => `document.querySelector('dialog.studio .studio-styles [data-style="${id}"]')`
const pressed = () => ev(`[...document.querySelectorAll('dialog.studio .studio-styles .chip')].filter((c) => c.getAttribute('aria-pressed') === 'true').map((c) => c.textContent)`)
const thumbs = () => ev(`document.querySelectorAll('dialog.studio .studio-thumb').length`)
const openStudio = async () => { await ev(`document.querySelector('.sidebar-studio').click()`); await page.waitFor(STUDIO, { timeoutMs: 4000 }); await sleep(300) }
const closeStudio = async () => { await ev(`document.querySelector('dialog.studio .page-head .icon-button').click()`); await sleep(300) }

try {
  await page.waitFor(`document.readyState === 'complete' && !!document.querySelector('.header-select')`, { timeoutMs: 20000 })
  await page.send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false })
  check('A: (setup) an OpenAI and an Anthropic key are saved', (await ev(`window.api.settings.setApiKey('openai', ${JSON.stringify(KEY_O)})`)).ok && (await ev(`window.api.settings.setApiKey('anthropic', ${JSON.stringify(KEY_A)})`)).ok)

  // ============ A. pictures off ============
  check('A: the sidebar has Image Studio first among the pages, with a tooltip', (await ev(`(() => { const b = document.querySelector('.sidebar-nav .sidebar-item'); return b?.classList.contains('sidebar-studio') && b.textContent.trim() === 'Image Studio' && b.title.length > 20 })()`)) === true)
  await openStudio()
  const offText = await ev(`document.querySelector('dialog.studio').innerText`)
  check('A: with pictures off the page says so and offers Settings; Make cannot be pressed', /Open Settings/.test(offText) && (await ev(`[...document.querySelectorAll('dialog.studio button')].find((b) => b.textContent.trim() === 'Make')?.disabled`)) === true, offText.slice(0, 400))
  check('A: no picture yet: it says where they will appear', /The pictures you make appear here/.test(offText))
  await closeStudio()
  check('A: the close button closes it', !(await ev(STUDIO)))

  // ============ B. styles and the cost ============
  check('B: (setup) pictures turned on (the Windows box answered yes)', (await ev(`window.api.images.setOn(true)`)).ok)
  await openStudio()
  check('B: the page opens with the keyboard in the description', (await ev(`document.activeElement?.id`)) === 'make-image-prompt')
  check('B: ten styles and "No style", which is pressed at first', (await ev(`document.querySelectorAll('dialog.studio .studio-styles .chip').length`)) === 11 && JSON.stringify(await pressed()) === '["No style"]')
  await page.type('A lighthouse at dusk')
  const plain = await waitCost(/At most \$/)
  check('B: the cost shows before anything is sent', /At most \$\d/.test(plain ?? ''), plain)
  await ev(`${styleChip('watercolour')}.click()`)
  await sleep(200)
  check('B: a style is pressed (one at a time)', JSON.stringify(await pressed()) === '["Watercolour"]')
  await ev(`${styleChip('sketch')}.click()`)
  await sleep(200)
  check('B: another style takes its place', JSON.stringify(await pressed()) === '["Pencil sketch"]')
  await ev(`${styleChip('sketch')}.click()`)
  await sleep(200)
  check('B: pressed again, it comes off', JSON.stringify(await pressed()) === '["No style"]')
  await ev(`${styleChip('watercolour')}.click()`)
  await sleep(600)
  const styled = await waitCost(/At most \$/)
  check('B: the chip says what it adds', /Style: a loose watercolour painting/.test(await ev(`${styleChip('watercolour')}.title`)))
  check('B: the cost is still shown with a style', /At most \$\d/.test(styled ?? ''), styled)
  await page.screenshot(join(shots, '22-3-studio-dark.png'))

  // ============ C. Make ============
  const before = (await imageRequests()).length
  const chatBefore = await ev(`document.querySelectorAll('.message').length`)
  await ev(`[...document.querySelectorAll('dialog.studio button')].find((b) => b.textContent.trim() === 'Make').click()`)
  await page.waitFor(`document.querySelectorAll('dialog.studio .studio-thumb').length >= 1`, { timeoutMs: 20000 })
  await sleep(500)
  const reqs = await imageRequests()
  const sent = reqs.at(-1)?.body ?? {}
  check('C: ONE request to OpenAI', reqs.length === before + 1, show(reqs.map((r) => r.body?.prompt)))
  check('C: it carries the description and the style under it', sent.prompt === 'A lighthouse at dusk\n\nStyle: a loose watercolour painting on textured paper.', show(sent.prompt))
  check('C: the picture is under "Your pictures"', (await thumbs()) === 1)
  check('C: a fresh form: the description is empty again, the style kept', (await ev(`document.getElementById('make-image-prompt').value`)) === '' && JSON.stringify(await pressed()) === '["Watercolour"]')
  check('C: the page stays open', await ev(STUDIO))
  check('C: nothing was put into the chat', (await ev(`document.querySelectorAll('.message').length`)) === chatBefore)
  await page.screenshot(join(shots, '22-3-studio-made.png'))

  // ============ D. the Library, the light look, a narrow window ============
  await closeStudio()
  await ev(`document.querySelector('.sidebar-library').click()`)
  await page.waitFor(`document.querySelectorAll('dialog.library .library-card[data-kind="picture"]').length === 1`, { timeoutMs: 10000 })
  check('D: the picture is in the Library, under its description', /A lighthouse at dusk/.test(await ev(`document.querySelector('dialog.library .library-card[data-kind="picture"] .library-name').textContent`)))
  await page.press('Escape'); await sleep(300)
  await ev(`document.documentElement.dataset.theme = 'light'`)
  await openStudio()
  await page.screenshot(join(shots, '22-3-studio-light.png'))
  await page.send('Emulation.setDeviceMetricsOverride', { width: 560, height: 800, deviceScaleFactor: 1, mobile: false })
  await sleep(500)
  check('D: in a narrow window the page fits without a sideways scroll', (await ev(`(() => { const d = document.querySelector('dialog.studio'); return d.scrollWidth <= d.clientWidth + 1 && d.getBoundingClientRect().right <= innerWidth })()`)) === true)
  await page.screenshot(join(shots, '22-3-studio-narrow.png'))
  await closeStudio()
  await page.send('Emulation.clearDeviceMetricsOverride')
  await ev(`document.documentElement.dataset.theme = 'dark'`)

  check('no console errors / warnings / exceptions', page.problems.length === 0, page.problems.join(' | '))
} catch (error) {
  check(`the run did not stop: ${error?.message ?? error}`, false, page.problems.join(' | ').slice(0, 1500))
}
const ok = check.summary()
page.close()
await main.close?.()
process.exit(ok ? 0 : 1)
