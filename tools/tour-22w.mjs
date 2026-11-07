// Stage 22.4 (D-054), the polish pass: a tour of every page of the app in the real window, dark and light, at 1400x900 and narrow (700x800), with
// screenshots in shots22tour for a person (and me) to look at. Three chats are made against the mock first (so History, the chart and the Library have
// something), pictures are turned on (the Windows box answered by the stand-in) and one is made. The only checks: every page opens, and nothing is said on
// the console. Needs: USER_DATA_DIR (scratch), INSPECT_PORT, MOCK_PORT.
import './temp-on-a.mjs'
import './ts-resolve.mjs'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { connect, checker, sleep } from './cdp.mjs'
import { assertScratchProfile } from './profile-guard.mjs'
import { mainInspector, h4 } from './lib4.mjs'
import { installQuestions } from './lib10.mjs'
import { randomBytes } from 'node:crypto'

const shots = join(process.argv[2], '..', 'shots22tour')
mkdirSync(shots, { recursive: true })
const port = Number(process.argv[3] ?? 9222)
const userData = process.env.USER_DATA_DIR
const inspectPort = Number(process.env.INSPECT_PORT)
const mockUrl = `http://127.0.0.1:${process.env.MOCK_PORT}`
if (!userData || !inspectPort || !process.env.MOCK_PORT) throw new Error('USER_DATA_DIR, INSPECT_PORT and MOCK_PORT must be set')
const check = checker()
const page = await connect(port)
await assertScratchProfile()
const main = await mainInspector(inspectPort)
await installQuestions(main, { fallback: 'yes' })
const H = h4(page, { userData, mockUrl })
const ev = (expression) => page.evaluate(expression)
const KEY_O = 'sk-proj-' + randomBytes(24).toString('hex')
const KEY_A = 'sk-ant-api03-' + randomBytes(24).toString('hex')
const READY = `document.readyState === 'complete' && !!document.querySelector('.header-select')`
const size = (width, height) => page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })
const setTheme = (t) => ev(`(() => { document.documentElement.dataset.theme = ${JSON.stringify(t)}; return true })()`)
const shot = async (name) => { await sleep(350); await page.screenshot(join(shots, `${name}.png`)) }
const closeAll = async () => { await ev(`[...document.querySelectorAll('dialog[open]')].forEach((d) => d.close())`); await sleep(300) }
const clickText = (scope, text) => ev(`(() => { const b = [...document.querySelectorAll(${JSON.stringify(scope)})].find((x) => x.textContent.trim() === ${JSON.stringify(text)}); if (!b) return false; b.click(); return true })()`)
const opened = (cls) => ev(`!!document.querySelector('dialog.${cls}')?.open`)
const send = async (text) => {
  await ev(`(() => { const t = document.querySelector('.composer-input'); t.focus(); return true })()`)
  await page.type(text)
  await page.press('Enter')
  await page.waitFor(`!!document.querySelector('.composer-button[type=submit]') && !document.querySelector('.typing')`, { timeoutMs: 20000 })
  await sleep(600)
}

// Each page: how to open it, and the dialog that shows it (null: the window itself).
const PAGES = [
  ['home', async () => { await ev(`document.querySelector('.sidebar-new')?.click()`) }, null],
  ['chat', async () => { await ev(`document.querySelector('.sidebar-chat')?.click()`); await sleep(500) }, null],
  ['chooser', async () => { await ev(`document.querySelector('.header-select').dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true, cancelable: true }))`) }, 'model-chooser'],
  ['search', async () => { await ev(`document.querySelector('.sidebar-search').click()`) }, 'search-chats'],
  ['studio', async () => { await ev(`document.querySelector('.sidebar-studio').click()`) }, 'studio'],
  ['experts', async () => { await ev(`document.querySelector('.sidebar-experts').click()`) }, 'experts'],
  ['projects', async () => { await ev(`document.querySelector('.sidebar-projects').click()`) }, 'projects'],
  ['library', async () => { await ev(`document.querySelector('.sidebar-library').click()`) }, 'library'],
  ['history', async () => { await ev(`document.querySelector('.sidebar-nav .sidebar-item:not(.sidebar-studio):not(.sidebar-experts):not(.sidebar-projects):not(.sidebar-library):not(.chat-tools)').click()`) }, 'history'],
  ['tools', async () => { await ev(`document.querySelector('.chat-tools').click()`) }, 'tools'],
  ['memory', async () => { await ev(`document.querySelector('.chat-memory').click()`) }, 'memory'],
  ['instructions', async () => { await ev(`document.querySelector('.chat-instructions').click()`) }, 'instructions'],
  ['make-image', async () => { await ev(`document.querySelector('.chat-make-image').click()`) }, 'make-image'],
  ['gallery', async () => { await ev(`document.querySelector('.sidebar-studio').click()`); await sleep(400); await clickText('dialog.studio button', 'See them all') }, 'gallery'],
  ['settings', async () => { await clickText('.sidebar button', 'Settings') }, 'settings'],
  ['settings-usage', async () => { await clickText('.sidebar button', 'Settings'); await sleep(300); await ev(`document.getElementById('settings-usage-heading').scrollIntoView({ block: 'start' })`) }, 'settings'],
  ['settings-appearance', async () => { await clickText('.sidebar button', 'Settings'); await sleep(300); await ev(`document.getElementById('settings-appearance-heading').scrollIntoView({ block: 'start' })`) }, 'settings']
]

try {
  await page.waitFor(READY, { timeoutMs: 20000 })
  await size(1400, 900)
  check('(setup) keys saved, pictures on, one picture made', (await ev(`window.api.settings.setApiKey('openai', ${JSON.stringify(KEY_O)})`)).ok && (await ev(`window.api.settings.setApiKey('anthropic', ${JSON.stringify(KEY_A)})`)).ok && (await ev(`window.api.images.setOn(true)`)).ok && (await ev(`window.api.images.generate({ prompt: 'A lighthouse at dusk', model: 'gpt-image-2', shape: 'square', quality: 'medium', count: 1, chat: null })`)).ok)
  await send('Plan a three-day trip to Lisbon with a short list of things to eat')
  await ev(`document.querySelector('.sidebar-new').click()`); await sleep(400)
  await send('Explain inflation in simple terms')
  await ev(`document.querySelector('.sidebar-new').click()`); await sleep(400)
  await send('Write a haiku about the sea')

  for (const [label, w, h] of [['wide', 1400, 900], ['narrow', 700, 800]]) {
    await size(w, h)
    for (const theme of ['dark', 'light']) {
      await setTheme(theme)
      for (const [name, open, dialog] of PAGES) {
        if (label === 'narrow' && !['home', 'chat', 'library', 'experts', 'studio', 'settings', 'chooser'].includes(name)) continue
        await closeAll()
        await open()
        await sleep(400)
        const ok = dialog === null ? true : await opened(dialog)
        check(`${label} ${theme}: ${name} opens`, ok)
        await shot(`${label}-${theme}-${name}`)
      }
      await closeAll()
    }
  }
  await setTheme('dark')
  await page.send('Emulation.clearDeviceMetricsOverride')
  check('no console errors / warnings / exceptions', page.problems.length === 0, page.problems.join(' | ').slice(0, 1500))
} catch (error) {
  check(`the run did not stop: ${error?.message ?? error}`, false, page.problems.join(' | ').slice(0, 1500))
}
const ok = check.summary()
page.close()
process.exit(ok ? 0 : 1)
