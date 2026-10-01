// Saves an invented test key through the real Settings dialog, and tells the mock API which key to expect.
// Run first in a list of scripts so the later ones see an app that "has a key". Scratch profile only.
// Stage 4: waits until the page is really ready (the header's model menu or badge exists once main has answered)
// instead of sleeping, and if the first click on Settings does not open the dialog it SAYS WHAT THE PAGE LOOKED LIKE
// (three launches in Stage 4's baseline misbehaved at exactly this step, and none could be explained afterwards).
import { connect, sleep } from './cdp.mjs'
import { assertScratchProfile } from './profile-guard.mjs'
import { randomBytes } from 'node:crypto'

const port = Number(process.argv[3] ?? 9222)
const mockPort = process.env.MOCK_PORT
const page = await connect(port)
await assertScratchProfile()
const READY = `document.readyState === 'complete' && !!document.querySelector('.header-select, .app-badge')`
const snapshot = () => page.evaluate(`JSON.stringify({ href: location.href, readyState: document.readyState, visibility: document.visibilityState, hasFocus: document.hasFocus(), header: document.querySelectorAll('.app-header .header-button').length, select: !!document.querySelector('.header-select'), badge: document.querySelector('.app-badge')?.textContent ?? null, dialogs: [...document.querySelectorAll('dialog')].map((d) => d.className + ':' + d.open), active: document.activeElement?.tagName + '.' + document.activeElement?.className, api: typeof window.api })`)
await page.send('Page.reload')
await sleep(600)
await page.waitFor(READY, { timeoutMs: 20000, label: 'the page to be ready after the reload' })

const key = 'test-' + randomBytes(24).toString('hex')
if (mockPort) await fetch(`http://127.0.0.1:${mockPort}/__expect-key`, { method: 'POST', body: JSON.stringify({ key }) })

let opened = false
let firstLook = null
for (let attempt = 1; attempt <= 2 && !opened; attempt++) {
  await page.click('.header-button@Settings')
  try {
    await page.waitFor(`!!document.querySelector('dialog.settings')?.open`, { timeoutMs: 4000 })
    opened = true
    if (attempt > 1) console.log('!! setup-key: the first click on Settings did NOT open the dialog; the second did. Page at the time of the first: ' + firstLook)
  } catch {
    firstLook = await snapshot()
    console.log(`!! setup-key: attempt ${attempt}: Settings did not open. Page: ${firstLook}`)
  }
}
if (!opened) throw new Error('Settings did not open after two clicks')
await page.evaluate(`document.getElementById('api-key-anthropic').select()`)
await page.type(key)
await page.click('.settings button[type=submit]')
await page.waitFor(`document.querySelector('.settings-status').innerText === 'A key is saved.'`)
await page.press('Escape')
await sleep(200)
await page.send('Page.reload') // start the test scripts from a clean page that already knows a key is saved
await sleep(600)
await page.waitFor(READY, { timeoutMs: 20000, label: 'the page to be ready after the second reload' })
console.log('setup-key: a test key is saved in the scratch profile' + (mockPort ? ' and registered with the mock' : ''))
page.close()
