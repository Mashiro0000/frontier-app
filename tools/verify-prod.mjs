// Checks what differs in the BUILT app (loaded from file://, not the dev server).
import { connect, checker, sleep } from './cdp.mjs'

const shots = process.argv[2]
const port = Number(process.argv[3] ?? 9222)
const check = checker()
const page = await connect(port)
console.log('page url:', page.url)
await page.send('Page.reload')
await sleep(1500)
const ev = (expr) => page.evaluate(expr)

check('built app is loaded from file:// (not the dev server)', page.url.startsWith('file://') && (await ev('location.protocol')) === 'file:')
check('window title is "Frontier App"', (await ev('document.title')) === 'Frontier App')
check('crypto.randomUUID works under file://', await ev(`typeof crypto.randomUUID === 'function' && crypto.randomUUID().length === 36`), `isSecureContext=${await ev('isSecureContext')}`)
check('CSP meta tag is present', /default-src 'self'/.test(await ev(`document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.content ?? ''`)))
check('stylesheet applied (dark colour scheme)', (await ev(`getComputedStyle(document.documentElement).colorScheme`)) === 'dark')
check('field-sizing survived the CSS build (textarea auto-grows)', (await ev(`getComputedStyle(document.querySelector('.composer-input')).fieldSizing`)) === 'content')
// (D-051) the theme's tokens: the violet accent, and the dark theme the app starts with, put on the page before the first render
check('accent colour is the updated token', (await ev(`getComputedStyle(document.documentElement).getPropertyValue('--color-accent').trim()`)) === '#6a4dff')
check('the built app starts dark: the theme is on the page and its background is the dark one', (await ev(`document.documentElement.dataset.theme`)) === 'dark' && (await ev(`getComputedStyle(document.body).backgroundColor`)) === 'rgb(13, 14, 19)')
check('textarea focused on start', (await ev('document.activeElement?.className')) === 'composer-input')

const h1 = await ev(`document.querySelector('.composer-input').offsetHeight`)
await page.type('one\ntwo\nthree\nfour')
await sleep(100)
const h4 = await ev(`document.querySelector('.composer-input').offsetHeight`)
check('textarea grows with content in the built app', h4 > h1, `${h1}px -> ${h4}px`)
await ev(`document.querySelector('.composer-input').select()`)

await page.type('built app says hi')
await page.press('Enter')
await page.waitFor(`!!document.querySelector('.composer-button[type=submit]')`, { timeoutMs: 6000 })
const bubbles = await ev(`[...document.querySelectorAll('.bubble')].map((b) => b.textContent)`)
check('send + streamed echo work in the built app', JSON.stringify(bubbles) === JSON.stringify(['built app says hi', 'Echo: built app says hi']), JSON.stringify(bubbles))
await page.screenshot(`${shots}/prod-final.png`)

check('no console errors / warnings / CSP violations', page.problems.length === 0, page.problems.join(' | '))
const ok = check.summary()
page.close()
process.exit(ok ? 0 : 1)
