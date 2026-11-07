// Stage 22.4 (D-054), the look in the real window: Settings > Appearance has System / Light / Dark, six accents and eight fonts; each changes the window at once
// (the theme on <html>, the colour of Send, the font of the text); System follows Windows (emulated) both ways and when it changes; the choices are kept after
// the window is loaded again; the default accent leaves the page's own colours; the light theme's glow is behind the greeting. Screenshots in shots22.
// Needs: MOCK_PORT, USER_DATA_DIR (scratch) and setup-key.mjs.
import './ts-resolve.mjs'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { connect, checker, sleep } from './cdp.mjs'
import { assertScratchProfile } from './profile-guard.mjs'
import { helpers } from './lib3.mjs'

const shots = join(process.argv[2], '..', 'shots22')
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
const SETTINGS = `!!document.querySelector('dialog.settings')?.open`
const theme = () => ev(`document.documentElement.dataset.theme`)
const windows = (scheme) => page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] })
const press = (selector) => ev(`(() => { const b = document.querySelector(${JSON.stringify(selector)}); if (!b) return false; b.click(); return true })()`)
const themeButton = (label) => `dialog.settings .theme-choice .theme-option:nth-child(${['System', 'Light', 'Dark'].indexOf(label) + 1})`
const pressedThemes = () => ev(`[...document.querySelectorAll('dialog.settings .theme-option')].filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.textContent.trim())`)
const openAppearance = async () => {
  await ev(`[...document.querySelectorAll('.sidebar button, .sidebar-foot button')].find((b) => /Settings/.test(b.textContent))?.click()`)
  await page.waitFor(SETTINGS, { timeoutMs: 4000 })
  await ev(`document.getElementById('settings-appearance-heading').scrollIntoView({ block: 'start' })`)
  await sleep(300)
}
const closeSettings = async () => { await page.press('Escape'); await sleep(300) }
const sendColour = () => ev(`getComputedStyle(document.documentElement).getPropertyValue('--color-accent').trim()`)
const bodyFont = () => ev(`getComputedStyle(document.body).fontFamily`)

try {
  await page.waitFor(READY, { timeoutMs: 20000 })
  await page.send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false })
  await windows('light')
  await sleep(300)
  check('A: dark at the first start, whatever Windows is (the default)', (await theme()) === 'dark')
  check('A: the default accent leaves the page\'s own colours (nothing set on <html>)', (await ev(`document.documentElement.style.getPropertyValue('--color-accent')`)) === '' && (await sendColour()) === '#6a4dff')
  await page.screenshot(join(shots, '22-4-home-dark.png'))

  // ============ B. the theme ============
  await openAppearance()
  check('B: Appearance offers System, Light and Dark; Dark is pressed', JSON.stringify(await ev(`[...document.querySelectorAll('dialog.settings .theme-option')].map((b) => b.textContent.trim())`)) === '["System","Light","Dark"]' && JSON.stringify(await pressedThemes()) === '["Dark"]')
  check('B: six accents and eight fonts, each a button with its name', (await ev(`document.querySelectorAll('dialog.settings .accent-option').length`)) === 6 && (await ev(`document.querySelectorAll('dialog.settings .font-option').length`)) === 8)
  await page.screenshot(join(shots, '22-4-appearance-dark.png'))
  await press(themeButton('Light'))
  await sleep(200)
  check('B: Light: the window turns light at once', (await theme()) === 'light' && JSON.stringify(await pressedThemes()) === '["Light"]')
  await press(themeButton('System'))
  await sleep(200)
  check('B: System with Windows light: light', (await theme()) === 'light' && JSON.stringify(await pressedThemes()) === '["System"]')
  await windows('dark')
  await sleep(400)
  check('B: Windows turns dark: the window follows, while it is open', (await theme()) === 'dark')
  await windows('light')
  await sleep(400)
  check('B: and back to light', (await theme()) === 'light')
  await press(themeButton('Dark'))
  await sleep(200)
  await windows('light')
  await sleep(300)
  check('B: Dark chosen: Windows changing does nothing', (await theme()) === 'dark')
  await press(themeButton('Light'))
  await sleep(200)

  // ============ C. the accent and the font ============
  await press(`dialog.settings .accent-option[data-accent="teal"]`)
  await sleep(200)
  check('C: Teal: the accent of the page changes at once', (await sendColour()) === '#0f766e' && (await ev(`document.querySelector('dialog.settings .accent-option[data-accent="teal"]').getAttribute('aria-pressed')`)) === 'true')
  await press(`dialog.settings .font-option[data-font="georgia"]`)
  await sleep(200)
  check('C: Georgia: the text of the app changes at once', /^Georgia/.test(await bodyFont()), await bodyFont())
  await page.screenshot(join(shots, '22-4-appearance-light-teal.png'))
  await closeSettings()
  check("C: New chat's round mark uses the accent's gradient", /15, 118, 110|0f766e/i.test(await ev(`getComputedStyle(document.querySelector('.sidebar-new .icon')).backgroundImage`)))
  const glow = await ev(`getComputedStyle(document.querySelector('.empty'), '::before').backgroundImage`)
  check('C: the light theme\'s glow is behind the greeting, in the accent\'s colour', /radial-gradient/.test(glow) && /20, 184, 166/.test(glow), glow.slice(0, 200))
  await page.screenshot(join(shots, '22-4-home-light-teal.png'))

  // ============ D. kept ============
  await ev(`location.reload()`)
  await page.waitFor(READY, { timeoutMs: 20000 })
  await sleep(500)
  check('D: after the window is loaded again: still light, teal and Georgia', (await theme()) === 'light' && (await sendColour()) === '#0f766e' && /^Georgia/.test(await bodyFont()))
  await openAppearance()
  await press(`dialog.settings .accent-option[data-accent="violet"]`)
  await press(`dialog.settings .font-option[data-font="segoe"]`)
  await sleep(200)
  check('D: back to violet and the default font: nothing is left on <html>', (await ev(`document.documentElement.style.getPropertyValue('--color-accent')`)) === '' && (await ev(`document.documentElement.style.getPropertyValue('--font-ui')`)) === '')
  await closeSettings()
  await page.screenshot(join(shots, '22-4-home-light.png'))
  for (const a of ['blue', 'orange', 'pink', 'green']) {
    await openAppearance()
    await press(`dialog.settings .accent-option[data-accent="${a}"]`)
    await closeSettings()
    await page.screenshot(join(shots, `22-4-home-light-${a}.png`))
  }
  await openAppearance()
  await press(themeButton('Dark'))
  await press(`dialog.settings .accent-option[data-accent="violet"]`)
  await closeSettings()
  await page.send('Emulation.setEmulatedMedia', { features: [] })
  await page.send('Emulation.clearDeviceMetricsOverride')

  check('no console errors / warnings / exceptions', page.problems.length === 0, page.problems.join(' | '))
} catch (error) {
  check(`the run did not stop: ${error?.message ?? error}`, false, page.problems.join(' | ').slice(0, 1500))
}
const ok = check.summary()
page.close()
process.exit(ok ? 0 : 1)
