import { connect, checker, sleep } from './cdp.mjs'

const shots = process.argv[2]
const port = Number(process.argv[3] ?? 9222)
const check = checker()
const page = await connect(port)
console.log('connected to', page.url)
await page.send('Page.reload')
await sleep(1500)

const q = (sel, prop) => page.evaluate(`document.querySelector(${JSON.stringify(sel)})?.${prop}`)

check('window title is "Frontier App"', (await page.evaluate('document.title')) === 'Frontier App')
check('h1 says "Frontier App"', (await q('.app-title', 'textContent')) === 'Frontier App')
check('the model menu shows the default model once a key is saved', (await page.evaluate(`document.querySelector('.header-select')?.selectedOptions[0]?.textContent`)) === 'Claude Opus 5.5')
check('empty-state hint visible', (await q('.empty-state', 'textContent')) === 'Type a message to start.')
check('textarea is focused on start', (await page.evaluate('document.activeElement?.className')) === 'composer-input')

const layout = await page.evaluate(`(() => {
  const r = (s) => { const b = document.querySelector(s).getBoundingClientRect(); return { top: b.top, bottom: b.bottom, left: b.left, right: b.right, height: b.height } }
  return { vh: innerHeight, vw: innerWidth, header: r('.app-header'), list: r('.message-list'), composer: r('.composer'), inner: r('.composer-inner'), bar: r('.chat-bar'), main: r('.app-main'),
           docScroll: document.documentElement.scrollHeight > innerHeight || document.body.scrollHeight > innerHeight }
})()`)
check('header sits at top', layout.header.top === 0)
check('the composer sits at the very bottom (since D-051 the chat bar is inside it, under the text)', Math.abs(layout.composer.bottom - layout.vh) < 1 && layout.bar.top >= layout.inner.top && layout.bar.bottom <= layout.inner.bottom, `composer.bottom=${layout.composer.bottom} vh=${layout.vh} bar=${JSON.stringify(layout.bar)}`)
check('message list fills the space between', Math.abs(layout.list.top - layout.header.bottom) < 1 && Math.abs(layout.list.bottom - layout.composer.top) < 1)
check('page itself does not scroll', !layout.docScroll)
check('input column is centred in the chat area (beside the sidebar since D-051)', Math.abs((layout.inner.left + layout.inner.right) / 2 - (layout.main.left + layout.main.right) / 2) < 1)

// Send button is disabled until there is non-blank text
check('Send disabled when empty', (await q('.composer-button', 'disabled')) === true)
await page.type('   ')
check('Send still disabled for whitespace only', (await q('.composer-button', 'disabled')) === true)
// select-all then type replaces the whitespace
await page.evaluate(`document.querySelector('.composer-input').select()`)
await page.type('hello')
check('Send enabled after typing', (await q('.composer-button', 'disabled')) === false)

// Textarea grows with its content, then caps and scrolls
const h1 = await q('.composer-input', 'offsetHeight')
await page.type('\nline 2\nline 3\nline 4')
await sleep(100)
const h4 = await q('.composer-input', 'offsetHeight')
check('textarea grows with more lines', h4 > h1, `1 line=${h1}px, 4 lines=${h4}px`)
await page.type('\n'.repeat(30) + 'end')
await sleep(100)
const hMax = await q('.composer-input', 'offsetHeight')
const scrolls = await page.evaluate(`(() => { const t = document.querySelector('.composer-input'); return t.scrollHeight > t.clientHeight })()`)
check('textarea stops growing at its max height and scrolls', hMax <= 200 + 2 && scrolls, `height=${hMax}px`)
await page.screenshot(`${shots}/1-1-typing.png`)

// Clear and take a clean screenshot
await page.evaluate(`(() => { const t = document.querySelector('.composer-input'); t.select() })()`)
await page.type('Hello there')
await sleep(100)
await page.screenshot(`${shots}/1-1-layout.png`)

// Narrow window
await page.send('Emulation.setDeviceMetricsOverride', { width: 420, height: 600, deviceScaleFactor: 1, mobile: false })
await sleep(200)
const narrow = await page.evaluate(`({ over: document.documentElement.scrollWidth > innerWidth, inner: document.querySelector('.composer-inner').getBoundingClientRect().width })`)
check('no horizontal overflow at 420px wide', !narrow.over, `composer width=${narrow.inner}`)
await page.screenshot(`${shots}/1-1-narrow.png`)
await page.send('Emulation.clearDeviceMetricsOverride')

check('no console errors / warnings / exceptions', page.problems.length === 0, page.problems.join(' | '))
const ok = check.summary()
page.close()
process.exit(ok ? 0 : 1)
