// Negative control for the harness itself: a suite that dies in a controlled way. CRASH_MODE=throw | close | summary-fail
// throw: two PASS lines, then an uncaught error (the old driver showed 0/0)
// close: connects to the page, then closes the whole app from outside, as a user closing the window would; the next wait must
//        fail with "the page connection closed", not hang until Node gives up with "unsettled top-level await"
import { connect, checker, sleep } from './cdp.mjs'

const port = Number(process.argv[3] ?? 9222)
const check = checker()
const mode = process.env.CRASH_MODE
const page = await connect(port)
check('connected to the page', true)
check('the page answers', (await page.evaluate('1 + 1')) === 2)
if (mode === 'throw') throw new Error('boom: a deliberate crash after two passing checks')
if (mode === 'close') {
  const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()
  const browser = new WebSocket(version.webSocketDebuggerUrl)
  await new Promise((resolve) => { browser.onopen = resolve })
  browser.send(JSON.stringify({ id: 1, method: 'Browser.close' }))
  await sleep(300)
  await page.waitFor('false', { timeoutMs: 20000 }) // must reject, quickly
}
if (mode === 'summary-fail') check('a check that fails on purpose', false)
check.summary()
process.exit(0)
