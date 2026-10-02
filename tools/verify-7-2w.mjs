// Stage 7.2 (D-025), in the real window against the mock: a reply shown as Markdown, and what it can and cannot do. The mock's `say`
// directive makes the reply the message's own text, word for word (`say-chars` streams it two characters at a time, so markers arrive
// cut in half). Checked here: the elements made; that no HTML, image, script or handler can come out of a reply; that a link asks first
// and only Open reaches the browser (main's shell.openExternal is replaced by a recorder, so the real browser is never opened); Copy on
// a code block; streaming; the saved chat; narrow widths. Needs: MOCK_PORT, USER_DATA_DIR (scratch), INSPECT_PORT (main's inspector).
import './ts-resolve.mjs'
import { connect, checker, sleep } from './cdp.mjs'
import { assertScratchProfile } from './profile-guard.mjs'
import { helpers } from './lib3.mjs'
import { mainInspector } from './lib4.mjs'
import { randomBytes } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const shots = process.argv[2]
const port = Number(process.argv[3] ?? 9222)
const mockUrl = `http://127.0.0.1:${process.env.MOCK_PORT}`
const userData = process.env.USER_DATA_DIR
if (!process.env.MOCK_PORT || !userData || !process.env.INSPECT_PORT) throw new Error('MOCK_PORT, USER_DATA_DIR and INSPECT_PORT must be set')
const check = checker()
const page = await connect(port)
await assertScratchProfile()
const H = helpers(page, { userData, mockUrl })
const { ev } = H
const main = await mainInspector(Number(process.env.INSPECT_PORT))
const READY = `document.readyState === 'complete' && !!document.querySelector('.header-select, .app-badge')`
const fakeKey = () => 'test-' + randomBytes(24).toString('hex')
const reset = () => fetch(`${mockUrl}/__reset`, { method: 'POST' })
const bubble = `(([...document.querySelectorAll('.message-assistant .bubble')]).at(-1))`
const html = () => ev(`${bubble}?.innerHTML ?? null`)
const q = (selector) => ev(`${bubble}?.querySelectorAll(${JSON.stringify(selector)}).length ?? -1`)
const text1 = (selector) => ev(`${bubble}?.querySelector(${JSON.stringify(selector)})?.textContent ?? null`)
/** Says `markdown` to the mock (the reply is that text, word for word) and waits until the reply is over. */
const say = async (markdown, directive = 'say') => {
  await reset()
  const req = await H.askMock(`[[mock:${directive}]] ${markdown}`)
  await sleep(150) // the page renders the last piece
  return req
}
const ALLOWED_ATTRS = ['class', 'title', 'type', 'start']
// (the three dots shown while the first words are awaited are the app's own, not the reply's)
const attrsOk = `[...(${bubble}?.querySelectorAll('*') ?? [])].filter((e) => !e.closest('.typing')).every((e) => [...e.attributes].every((a) => ${JSON.stringify(ALLOWED_ATTRS)}.includes(a.name)))`
const FORBIDDEN = 'img, script, iframe, style, a, svg, object, embed, link, form, input, video, audio, canvas, base, meta'

const DOC = [
  '# Title here', '',
  'Some **bold**, *italic*, `inline code`, ~~struck~~ and a [link](https://example.com/page?x=1).', '',
  '- first item', '- second item', '  - nested item', '',
  '1. one', '2. two', '',
  '> a quote', '',
  '| Name | Qty |', '|:-----|----:|', '| apples | 3 |', '| pears | 12 |', '',
  '---', '',
  '```python', 'def f(x):', '    return x < 2 && y > 3', '```'
].join('\n')
const CODE1 = 'def f(x):\n    return x < 2 && y > 3'

// Main's side: a recorder in place of shell.openExternal, and the clipboard (read and written in main, so it is what any program would see).
const installRecorder = () => main.inMain(`(() => {
  const { shell } = process.mainModule.require('electron')
  globalThis.__opened = []
  shell.openExternal = function __stub72(url) { globalThis.__opened.push(String(url)); return Promise.resolve() }
  return shell.openExternal.name
})()`)
const recorderIsIn = () => main.inMain(`process.mainModule.require('electron').shell.openExternal.name === '__stub72'`)
const opened = async () => JSON.parse(await main.inMain(`JSON.stringify(globalThis.__opened ?? null)`))
// This Electron's clipboard may answer with a Promise (the inspector would then show {}): settle it in main, then read the result.
const clipboard = async () => {
  await main.inMain(`(globalThis.__clip = undefined, Promise.resolve(process.mainModule.require('electron').clipboard.readText()).then((t) => { globalThis.__clip = t }), true)`)
  for (let i = 0; i < 60; i++) { const t = await main.inMain(`globalThis.__clip`); if (typeof t === 'string') return t; await sleep(50) }
  return null
}
const setClipboard = async (t) => {
  await main.inMain(`(globalThis.__clipSet = false, Promise.resolve(process.mainModule.require('electron').clipboard.writeText(${JSON.stringify(t)})).then(() => { globalThis.__clipSet = true }), true)`)
  for (let i = 0; i < 60; i++) { if (await main.inMain(`globalThis.__clipSet`)) return true; await sleep(50) }
  return false
}
const dialog = () => ev(`(() => { const d = document.querySelector('dialog.link-confirm'); return d && { open: d.open, address: d.querySelector('.link-confirm-address')?.textContent, note: d.querySelector('.link-confirm-note')?.textContent, focus: document.activeElement?.textContent ?? null, buttons: [...d.querySelectorAll('button')].map((b) => b.textContent) } })()`)
const clickLink = async (label) => { await page.click(`.message-assistant .md-link@${label}`); await page.waitFor(`document.querySelector('dialog.link-confirm')?.open === true`, { timeoutMs: 4000 }) }
const closed = () => page.waitFor(`document.querySelector('dialog.link-confirm')?.open === false`, { timeoutMs: 4000 })

let savedClipboard = null
try {
await page.waitFor(READY, { timeoutMs: 20000 })
await page.send('Emulation.setFocusEmulationEnabled', { enabled: true }) // the clipboard API wants a focused document
await ev(`window.api.settings.setApiKey('anthropic', ${JSON.stringify(fakeKey())}).then((r) => r.ok)`)
await page.send('Page.reload')
await sleep(600)
await page.waitFor(READY, { timeoutMs: 20000 })
await page.send('Network.enable')
const requested = []
page.on('Network.requestWillBeSent', (p) => requested.push(p.request.url))
savedClipboard = await clipboard()

// ============ A. what a reply of every kind becomes ============
const reqA = await say(DOC)
check('the reply reached the page', reqA !== null && (await ev(`document.querySelectorAll('.message-assistant').length`)) === 1)
check('the system prompt tells the model the window renders Markdown (and no longer asks for plain text)', /renders Markdown/.test(reqA?.body?.system ?? '') && !/plain text/.test(reqA?.body?.system ?? ''), reqA?.body?.system)
check('a heading: <h1> "Title here"', (await text1('h1.md-heading')) === 'Title here')
check('bold, italic, inline code, strike-through are elements', (await text1('strong')) === 'bold' && (await text1('em')) === 'italic' && (await text1('code.md-code')) === 'inline code' && (await text1('del')) === 'struck')
check('a bulleted list with a nested one, and a numbered list', (await q('ul > li')) === 3 && (await q('ul ul > li')) === 1 && (await q('ol > li')) === 2)
check('a quote and a rule', (await q('blockquote')) === 1 && (await q('hr')) === 1)
check('a table: two header cells, two rows, the right-aligned column carries its class', (await q('table.md-table thead th')) === 2 && (await q('tbody tr')) === 2 && (await ev(`${bubble}.querySelector('tbody tr td:nth-child(2)').classList.contains('md-align-right')`)))
check('a code block: its language above it, a Copy button, and exactly the code in <pre><code>', (await text1('.md-codeblock-lang')) === 'python' && (await text1('.md-copy')) === 'Copy' && (await text1('pre.md-pre > code')) === CODE1, await text1('pre.md-pre > code'))
check('the link is a button with the address as its tooltip, and has no href', (await ev(`(() => { const b = ${bubble}.querySelector('button.md-link'); return b && b.textContent === 'link' && b.title === 'https://example.com/page?x=1' && !b.hasAttribute('href') })()`)))
check('NOTHING in the reply is an <a>, <img>, <script>, <iframe>, <style> or similar, and no element has an attribute other than class, title, type or start', (await q(FORBIDDEN)) === 0 && (await ev(attrsOk)) === true)
const userBubble = await ev(`(() => { const b = document.querySelector('.message-user .bubble'); return { text: b.textContent, children: b.children.length } })()`)
check('what the person typed is shown exactly as typed: no elements, the Markdown characters still there', userBubble.children === 0 && userBubble.text === `[[mock:say]] ${DOC}`, JSON.stringify(userBubble).slice(0, 200))
const bubbleLayout = await ev(`(() => { const b = ${bubble}; const s = getComputedStyle(b); const p = getComputedStyle(b.querySelector('p')); return { ws: s.whiteSpace, pws: p.whiteSpace } })()`)
check('paragraphs keep the line breaks a model wrote (white-space: pre-line); the bubble itself is normal', bubbleLayout.pws === 'pre-line' && bubbleLayout.ws === 'normal', JSON.stringify(bubbleLayout))
await page.screenshot(`${shots}/7-2-reply.png`)
const reqA2 = await (async () => { await reset(); return H.askMock('and again') })()
const sent = reqA2?.body?.messages ?? []
check('the next request sends the reply back as the model wrote it (the Markdown source, not HTML)', sent.length === 3 && sent[1].role === 'assistant' && sent[1].content === DOC, JSON.stringify(sent[1]?.content).slice(0, 200))

// ============ B. a reply that tries to be something else ============
const ATTACK = '<img src=x onerror="window.__pwned=1"> <script>window.__pwned=2</script> [click](javascript:window.__pwned=3) ![pic](https://example.com/p.png) [ok](https://example.com/) <a href="https://evil.example/">x</a> <iframe src="https://evil.example/"></iframe> <style>body{display:none}</style> <svg onload="window.__pwned=4"> [bad](http://example.com/) [cred](https://user:pw@example.com/)'
const before = requested.length
await say(ATTACK)
await sleep(800)
check('nothing in the reply ran: window.__pwned is still unset', (await ev(`typeof window.__pwned`)) === 'undefined')
check('no <img>, <script>, <iframe>, <style>, <a>, <svg> ... exists in the reply, and no attribute outside the four allowed', (await q(FORBIDDEN)) === 0 && (await ev(attrsOk)) === true)
check('the markup is on screen as text', /<img src=x onerror="window\.__pwned=1">/.test(await text1('p') ?? '') && /<script>window\.__pwned=2<\/script>/.test(await text1('p') ?? '') && /<iframe src="https:\/\/evil\.example\/"><\/iframe>/.test(await text1('p') ?? ''))
check('the image is text (its address shown, nothing loaded), and the javascript:, http: and credential links are text, not buttons', /!\[pic\]\(https:\/\/example\.com\/p\.png\)/.test(await text1('p') ?? '') && (await q('button.md-link')) === 1 && /\[click\]\(javascript:/.test(await text1('p') ?? '') && /\[bad\]\(http:\/\/example\.com\/\)/.test(await text1('p') ?? ''))
check('the page was not hidden by the <style> in the reply', (await ev(`getComputedStyle(document.body).display`)) !== 'none')
check('no request left the page for anything but the app itself (nothing for example.com or evil.example)', requested.slice(before).every((u) => /^(http:\/\/localhost:\d+|http:\/\/127\.0\.0\.1:\d+|file:|data:|ws:)/.test(u)) && !requested.some((u) => /example\.com|evil\.example/.test(u)), requested.slice(before).filter((u) => !/localhost|127\.0\.0\.1/.test(u)).join(' '))
await page.screenshot(`${shots}/7-2-attack.png`)

// ============ C. a link asks first ============
await say('Go to [the page](https://example.com/page?x=1) or [https://paypal.com](https://example.org/login).')
const stubName = await installRecorder()
check('the recorder is in place of shell.openExternal (so the real browser is never opened by this suite)', stubName === '__stub72' && (await recorderIsIn()) === true && (await opened()).length === 0, stubName)
const navsBefore = page.navs.length
await clickLink('the page')
const d1 = await dialog()
check('a click on the link opens a dialog with the WHOLE address and the real host, and nothing has been opened', d1.open === true && d1.address === 'https://example.com/page?x=1' && /example\.com/.test(d1.note) && (await opened()).length === 0, JSON.stringify(d1))
check('...Cancel has the focus, so Enter alone does not open anything', d1.focus === 'Cancel' && d1.buttons.join() === 'Cancel,Open', JSON.stringify(d1))
await page.click('dialog.link-confirm button@Cancel')
await closed()
check('Cancel closes it, opens nothing, and the focus goes back to the link', (await opened()).length === 0 && (await ev(`document.activeElement?.classList.contains('md-link')`)) === true)
await clickLink('the page')
await page.press('Escape')
await closed()
check('Escape closes it and opens nothing', (await opened()).length === 0)
await clickLink('the page')
await page.press('Enter') // the focus is on Cancel
await closed()
check('Enter on the focused Cancel opens nothing', (await opened()).length === 0)
await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 10, y: 10 })
const box = await ev(`(() => { const r = [...document.querySelectorAll('.message-assistant .md-link')].find((e) => e.textContent === 'the page').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })()`)
await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'middle', clickCount: 1 })
await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x, y: box.y, button: 'middle', clickCount: 1 })
await sleep(300)
const d2 = await dialog()
check('a middle click opens nothing (no address of its own to follow): no dialog, nothing opened', (await opened()).length === 0 && d2.open === false, JSON.stringify(d2))
await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', clickCount: 1, modifiers: 2 }) // Ctrl
await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x, y: box.y, button: 'left', clickCount: 1, modifiers: 2 })
await sleep(300)
check('Ctrl+click is an ordinary click: it can only ask (a dialog or nothing), and still nothing is opened', (await opened()).length === 0)
if ((await dialog()).open) { await page.press('Escape'); await closed() }
await clickLink('the page')
await page.click('dialog.link-confirm button@Open')
await closed()
const o1 = await opened()
check('Open hands exactly that address to the browser, once', JSON.stringify(o1) === '["https://example.com/page?x=1"]', JSON.stringify(o1))
check('...and the app window itself did not navigate', page.navs.length === navsBefore, JSON.stringify(page.navs.slice(navsBefore)))
await main.inMain(`(globalThis.__opened.length = 0, true)`)
await clickLink('https://paypal.com')
const d3 = await dialog()
check('a link whose words are another address: the dialog shows the real address and host, not the words', d3.address === 'https://example.org/login' && /example\.org/.test(d3.note) && !/paypal/.test(d3.note ?? '') && !/paypal/.test(d3.address ?? ''), JSON.stringify(d3))
await page.screenshot(`${shots}/7-2-link-dialog.png`)
await page.press('Escape')
await closed()
// what main lets through when the PAGE asks (window.open), whatever a reply says
await main.inMain(`(globalThis.__opened.length = 0, true)`)
const problemsBeforeProbes = page.problems.length
for (const url of ['http://example.com/', 'file:///c:/windows/system32/calc.exe', 'javascript:alert(1)', 'ms-msdt:/id', 'https://user:pw@example.com/', 'about:blank', 'data:text/html,x']) {
  await ev(`(window.open(${JSON.stringify(url)}), true)`)
}
await sleep(500)
check('window.open from the page: http, file, javascript, ms-msdt, credentials, about and data addresses reach nothing', (await opened()).length === 0, JSON.stringify(await opened()))
const probeNoise = page.problems.slice(problemsBeforeProbes) // Chromium says it refused the file: and javascript: addresses: that is the probe, not the app
await ev(`(window.open('https://example.com/direct'), true)`)
await sleep(400)
check('...an https address still does (main\'s rule is about the scheme; the dialog is what stands between a reply and the browser)', JSON.stringify(await opened()) === '["https://example.com/direct"]', JSON.stringify(await opened()))
check('the page is still the app (no navigation happened)', (await ev(`document.querySelectorAll('.composer-input').length`)) === 1)

// ============ D. Copy ============
await setClipboard('SENTINEL-BEFORE')
await say('First:\n\n```js\nconst a = "<b>&amp;</b>"\n\tconst b = 2   \n```\n\nSecond:\n\n```\nplain  code\n```')
check('showing a reply with code does not touch the clipboard', (await clipboard()) === 'SENTINEL-BEFORE', await clipboard())
check('two code blocks, each with a Copy button', (await q('.md-codeblock')) === 2 && (await q('button.md-copy')) === 2)
await ev(`${bubble}.querySelectorAll('button.md-copy')[0].scrollIntoView({ block: 'center' })`)
await page.click('.message-assistant:last-child .md-copy')
await page.waitFor(`${bubble}.querySelector('.md-copy').textContent !== 'Copy'`, { timeoutMs: 4000, label: 'the Copy button to answer' }).catch(() => {})
const copyAnswer = await text1('.md-copy')
check('the button answers "Copied" (not "Could not copy")', copyAnswer === 'Copied', copyAnswer)
// (Windows itself writes line ends to the clipboard as CR LF; the characters are otherwise exactly the block's)
check('Copy puts exactly the characters of that block on the clipboard (markup characters, tab and trailing spaces included)', (await clipboard())?.replace(/\r\n/g, '\n') === 'const a = "<b>&amp;</b>"\n\tconst b = 2   ', JSON.stringify(await clipboard()))
await page.waitFor(`${bubble}.querySelector('.md-copy').textContent === 'Copy'`, { timeoutMs: 4000, label: 'the button to say Copy again' })
await ev(`${bubble}.querySelectorAll('button.md-copy')[1].scrollIntoView({ block: 'center' })`)
await ev(`(() => { const b = ${bubble}.querySelectorAll('button.md-copy')[1]; b.focus(); })()`)
await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, text: '\r' })
await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 })
await page.waitFor(`${bubble}.querySelectorAll('.md-copy')[1].textContent === 'Copied'`, { timeoutMs: 4000, label: 'the second button to say Copied' })
check('the second block copies its own text, by keyboard too', (await clipboard()) === 'plain  code', JSON.stringify(await clipboard()))
await page.screenshot(`${shots}/7-2-code.png`)

// ============ E. streaming: markers arrive cut in half ============
const htmlWhole = await (async () => { await say(DOC, 'say'); return html() })()
await reset()
const samples = []
let sampling = true
const sampler = (async () => {
  while (sampling) {
    samples.push(await ev(`(() => { const b = ${bubble}; return b ? { n: b.querySelectorAll('*').length, bad: b.querySelectorAll(${JSON.stringify(FORBIDDEN)}).length, attrs: ${attrsOk}, pwned: typeof window.__pwned } : null })()`))
    await sleep(20)
  }
})()
await H.askMock(`[[mock:say-chars]] ${DOC}`)
await sleep(200)
sampling = false
await sampler
const htmlChars = await html()
check(`streamed two characters at a time (${samples.length} snapshots on the way), the finished reply is the same DOM as when it arrives in words`, htmlChars === htmlWhole, htmlChars === htmlWhole ? '' : `${htmlChars.length} vs ${htmlWhole.length}`)
const seen = samples.filter(Boolean)
check('...and at no snapshot on the way was there a forbidden element, an attribute outside the allowed four, or anything run', seen.length > 5 && seen.every((s) => s.bad === 0 && s.attrs === true && s.pwned === 'undefined'), `${seen.length} snapshots, ${seen.filter((s) => s.bad !== 0).length} with a forbidden element, ${seen.filter((s) => s.attrs !== true).length} with a bad attribute, ${seen.filter((s) => s.pwned !== 'undefined').length} with __pwned set; first: ${JSON.stringify(seen[0])}`)
await reset()
const samples2 = []
sampling = true
const sampler2 = (async () => { while (sampling) { samples2.push(await ev(`(() => { const b = ${bubble}; return b ? { bad: b.querySelectorAll(${JSON.stringify(FORBIDDEN)}).length, pwned: typeof window.__pwned } : null })()`)); await sleep(10) } })()
await H.askMock(`[[mock:say-chars]] <img src=x onerror="window.__pwned=5"><scr` + `ipt>window.__pwned=6</scr` + `ipt>`)
await sleep(200)
sampling = false
await sampler2
check('markup arriving in halves ("<scr" then "ipt>") never becomes an element and never runs', samples2.filter(Boolean).every((s) => s.bad === 0 && s.pwned === 'undefined') && (await ev(`typeof window.__pwned`)) === 'undefined')
// speed: a long reply, one long task at most
await reset()
await ev(`(() => { window.__long = []; new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__long.push(Math.round(e.duration)) }).observe({ entryTypes: ['longtask'] }); return true })()`)
const LONG = Array.from({ length: 150 }, (_, i) => `## Part ${i}\n\nParagraph **${i}** with \`code\` and a [link](https://example.com/${i}) and some words to fill the line a bit more.\n\n- item a\n- item b\n`).join('\n')
await reset()
const nBefore = (await H.mockReqs()).length
await H.send(`[[mock:say]] ${LONG}`)
for (let i = 0; i < 200 && (await H.mockReqs()).length === nBefore; i++) await sleep(50)
const typingStalls = await ev(`window.__long.splice(0)`) // typing 21 KB into the box and showing it as the person's own message
await page.waitFor(`!!document.querySelector('.composer-button[type=submit]')`, { timeoutMs: 20000 })
await sleep(300)
const replyStalls = await ev(`window.__long.splice(0)`) // the reply arriving and being drawn
check(`a long reply (${LONG.length} characters, 150 headings, 300 list items) is shown whole`, (await q('h2.md-heading')) === 150 && (await q('ul > li')) === 300)
console.log(`   (page stalls over 50 ms while the person's message went in: ${JSON.stringify(typingStalls)}; while the reply arrived and was drawn: ${JSON.stringify(replyStalls)})`)
check(`...and while it arrived no stall of the page was longer than 500 ms (longest: ${Math.max(0, ...replyStalls)} ms)`, Math.max(0, ...replyStalls) < 500, JSON.stringify(replyStalls))

// ============ F. old replies, and the saved chat ============
await say('Here is code:\n\n    function f() {\n      return 1\n    }\n\nAnd a list:\n- one\n- two\nDone.')
check('a reply written the old way (code indented by four spaces, hyphen lists) is a code block and a list', (await q('.md-codeblock')) === 1 && (await text1('pre.md-pre code')) === 'function f() {\n  return 1\n}' && (await q('ul > li')) === 2, await text1('pre.md-pre code'))
await say('Plain words only.\nA second line.')
check('a plain reply is one paragraph, the line break kept', (await q('p')) === 1 && (await text1('p')) === 'Plain words only.\nA second line.')
const convDir = join(userData, 'conversations')
const files = existsSync(convDir) ? readdirSync(convDir).filter((n) => n.endsWith('.json')) : []
const fileText = files.map((n) => readFileSync(join(convDir, n), 'utf8')).join('\n')
check('the saved chat holds the Markdown as the model wrote it (the characters **, ``` and #), never rendered HTML', files.length === 1 && fileText.includes('**bold**') && fileText.includes('```python') && !/<h1|<strong|<table|md-codeblock/.test(fileText), `${files.length} files`)
await page.send('Page.reload')
await sleep(600)
await page.waitFor(READY, { timeoutMs: 20000 })
await page.click('.chat-button@History')
await page.waitFor(`!!document.querySelector('dialog.history')?.open && document.querySelectorAll('.history-open').length > 0`, { timeoutMs: 8000 })
await page.click('.history-open')
await page.waitFor(`document.querySelectorAll('.message-assistant').length > 0 && !document.querySelector('dialog.history')?.open`, { timeoutMs: 8000 })
await sleep(300)
check('opened again from History, the first reply is drawn as Markdown again (heading, table, code block)', (await ev(`document.querySelectorAll('.message-assistant')[0].querySelectorAll('h1.md-heading, table.md-table, .md-codeblock').length`)) === 3)

// ============ G. other endings, and narrow widths ============
await say('', 'empty')
check('an empty reply says so, with no bubble', (await ev(`document.querySelector('.message-assistant:last-child .message-note')?.textContent`)) === 'The reply was empty.')
await reset()
await H.askMock('[[mock:midstream-error]] x')
await sleep(300)
check('a reply that fails half way keeps what arrived, as text, and says it failed', (await text1('p')) === 'Partial' && /Overloaded|failed|stopped/i.test((await ev(`document.querySelector('.message-assistant:last-child .message-note')?.textContent ?? ''`))))
const WIDE = '| ' + Array.from({ length: 12 }, (_, i) => `column number ${i}`).join(' | ') + ' |\n|' + '---|'.repeat(12) + '\n| ' + Array.from({ length: 12 }, (_, i) => `value ${i} is long`).join(' | ') + ' |\n\n```\n' + 'x'.repeat(300) + '\n```\n\nhttps://example.com/' + 'a'.repeat(200) + ' and ' + 'W'.repeat(120) + '\n'
for (const width of [420, 320]) {
  await page.send('Emulation.setDeviceMetricsOverride', { width, height: 700, deviceScaleFactor: 1, mobile: false })
  await sleep(200)
  await say(WIDE)
  const fit = await ev(`(() => { const b = ${bubble}; const w = b.querySelector('.md-table-wrap'); const pre = b.querySelector('.md-pre'); return { page: document.documentElement.scrollWidth, inner: window.innerWidth, bubbleRight: Math.round(b.getBoundingClientRect().right), tableScrolls: w.scrollWidth > w.clientWidth, preScrolls: pre.scrollWidth > pre.clientWidth, wrapRight: Math.round(w.getBoundingClientRect().right) } })()`)
  check(`at ${width}px: the page does not scroll sideways, the wide table and the long code line scroll inside their own boxes`, fit.page <= fit.inner && fit.bubbleRight <= fit.inner && fit.tableScrolls && fit.preScrolls && fit.wrapRight <= fit.inner, JSON.stringify(fit))
  await page.screenshot(`${shots}/7-2-narrow-${width}.png`)
}
await page.send('Emulation.clearDeviceMetricsOverride')

// ============ H. the whole run ============
check('no console errors, warnings, exceptions or CSP violations (but the two Chromium refused while probing window.open with file: and javascript:)', page.problems.length - probeNoise.length === 0 && probeNoise.every((p) => /calc\.exe|JavaScript URL/.test(p)), page.problems.join(' | '))
check('the Content-Security-Policy of the page is unchanged: no remote image, script or frame source', await ev(`(() => { const c = document.querySelector('meta[http-equiv="Content-Security-Policy"]').content; return /default-src 'self'/.test(c) && !/https?:\\/\\//.test(c) && /img-src 'self' data:/.test(c) })()`), await ev(`document.querySelector('meta[http-equiv="Content-Security-Policy"]').content`))
} catch (error) {
  check(`the suite ran to its end (it stopped: ${String(error?.message ?? error).slice(0, 220)})`, false)
} finally {
  try { if (savedClipboard !== null) await setClipboard(savedClipboard) } catch { /* the app is gone */ }
  main.close()
}
process.exit(check.summary() ? 0 : 1)
