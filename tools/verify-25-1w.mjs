// The side panel (D-057) in the real window against the mock, as a person sees it: every block of code in a reply has a button that shows it
// beside the chat; a page (HTML) is DRAWN there in a locked frame (its script does not run, its picture is not fetched), with a Preview / Code
// switch; a document (Markdown) is drawn as a document; any other block is read there as code; Esc and Close give the keyboard back to the
// button that opened it; a new chat has no panel; in a narrow window the panel takes the chat's place. Screenshots in shots25.
// Needs: MOCK_PORT, USER_DATA_DIR (scratch) and setup-key.mjs.
import './ts-resolve.mjs'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { connect, checker, sleep } from './cdp.mjs'
import { assertScratchProfile } from './profile-guard.mjs'
import { helpers } from './lib3.mjs'

const shots = join(process.argv[2], '..', 'shots25')
mkdirSync(shots, { recursive: true })
const port = Number(process.argv[3] ?? 9222)
const mockUrl = `http://127.0.0.1:${process.env.MOCK_PORT}`
const userData = process.env.USER_DATA_DIR
if (!process.env.MOCK_PORT || !userData) throw new Error('MOCK_PORT and USER_DATA_DIR must be set')

const check = checker()
const page = await connect(port, { plain: true })
await assertScratchProfile()
const H = helpers(page, { userData, mockUrl })
const { ev } = H
const READY = `document.readyState === 'complete' && !!document.querySelector('.composer-input')`
const F = '```'
// A page that tries both things the frame must stop: a script that reports to the window around it, and a picture from the network (the mock).
const HTML = `<!doctype html><html><body><h1 id="t">Hello page</h1><img src="${mockUrl}/v1/models"><script>parent.postMessage('canvas-script-ran', '*'); document.getElementById('t').textContent = 'changed by script'</script></body></html>`
const MD = '# A plan\n\n- first\n- second'
const JS = 'const n = 42'
const panel = () => ev(`(() => { const c = document.querySelector('.canvas'); if (!c) return null; const r = c.getBoundingClientRect(); const m = document.querySelector('.app-main').getBoundingClientRect(); const f = c.querySelector('iframe'); return { title: c.querySelector('.canvas-title').textContent, left: Math.round(r.left), right: Math.round(r.right - innerWidth), w: Math.round(r.width), chatW: Math.round(m.width), chatRight: Math.round(m.right), views: [...c.querySelectorAll('.canvas-view')].map((b) => b.textContent + ':' + b.getAttribute('aria-pressed')), frame: f ? { sandbox: f.getAttribute('sandbox'), srcdoc: f.getAttribute('srcdoc'), h: Math.round(f.getBoundingClientRect().height) } : null, code: c.querySelector('.md-pre code')?.textContent ?? null, opens: c.querySelectorAll('.md-open').length, doc: c.querySelector('.canvas-document')?.innerText ?? null, focus: document.activeElement.className } })()`)
const openers = () => ev(`[...document.querySelectorAll('.message-assistant .md-codeblock')].map((b) => b.querySelector('.md-codeblock-lang').textContent + ':' + (b.querySelector('.md-open')?.textContent ?? 'none'))`)
const clickOpener = (i) => ev(`(() => { const b = document.querySelectorAll('.message-assistant .md-open')[${i}]; b.focus(); b.click(); return true })()`)

try {
  await page.waitFor(READY, { timeoutMs: 20000 })
  await page.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false })
  await sleep(400)
  await ev(`(() => { window.__canvasRan = 0; addEventListener('message', (e) => { if (e.data === 'canvas-script-ran') window.__canvasRan++ }) })()`)

  await H.askMock(`[[mock:say]] Three things:\n\n${F}html\n${HTML}\n${F}\n\n${F}md\n${MD}\n${F}\n\n${F}js\n${JS}\n${F}`)
  await sleep(600)
  const reqs = (await H.mockReqs()).length

  // ============ A. the buttons ============
  check('A: each block of the reply has its button: "Preview" for a page and a document, "Open" for other code; no panel is open', JSON.stringify(await openers()) === JSON.stringify(['html:Preview', 'md:Preview', 'js:Open']) && (await panel()) === null, JSON.stringify(await openers()))

  // ============ B. a page, drawn in a locked frame ============
  await clickOpener(0); await sleep(1500)
  const p = await panel()
  check('B: "Preview" opens the panel at the right, beside the chat (the chat keeps its place, narrower), named "Page", on Preview', p !== null && p.title === 'Page' && p.right === 0 && p.w >= 360 && p.chatW >= 300 && p.chatRight <= p.left + 1 && JSON.stringify(p.views) === '["Preview:true","Code:false"]', JSON.stringify({ ...p, frame: undefined }))
  check('B: the page is in a frame with every permission off (sandbox=""), holding exactly the text of the block', p?.frame?.sandbox === '' && p.frame.srcdoc === HTML && p.frame.h > 200, JSON.stringify(p?.frame?.sandbox))
  check('B: the page\'s script did not run (it reports to the window around it: nothing arrived)', (await ev('window.__canvasRan')) === 0, String(await ev('window.__canvasRan')))
  check('B: the page\'s picture was not fetched: the mock saw no new request', (await H.mockReqs()).length === reqs, `${(await H.mockReqs()).length} vs ${reqs}`)
  check('B: the keyboard is in the panel (on its title)', p?.focus === 'canvas-title', p?.focus)
  await page.screenshot(join(shots, '25-page.png'))
  await page.click('.canvas-view@Code'); await sleep(300)
  const c = await panel()
  check('B: "Code" shows the block\'s exact text, with no button to open it again', c.frame === null && c.code === HTML && c.opens === 0 && JSON.stringify(c.views) === '["Preview:false","Code:true"]', JSON.stringify(c.views))
  await ev(`document.querySelector('.canvas-view').focus()`)
  await page.press('Escape'); await sleep(300)
  check('B: Esc closes the panel, the chat has its width back, and the keyboard is on the button that opened it', (await panel()) === null && (await ev(`document.activeElement === document.querySelectorAll('.message-assistant .md-open')[0] && document.querySelector('.app-main').getBoundingClientRect().right === innerWidth`)))

  // ============ C. a document, and plain code ============
  await clickOpener(1); await sleep(500)
  const d = await panel()
  check('C: a Markdown block opens as "Document", drawn as a document (a heading, a list), not as its marks', d?.title === 'Document' && d.frame === null && /^A plan/.test(d.doc ?? '') && !/#/.test(d.doc ?? '') && (await ev(`!!document.querySelector('.canvas-document h1, .canvas-document h2, .canvas-document h3') && document.querySelectorAll('.canvas-document li').length === 2 && getComputedStyle(document.querySelector('.canvas-document ul')).listStyleType === 'disc'`)), JSON.stringify(d?.doc))
  await page.screenshot(join(shots, '25-document.png'))
  await clickOpener(2); await sleep(500)
  const j = await panel()
  check('C: another block takes its place: "js" as code, with no Preview / Code switch', j?.title === 'js' && j.code === JS && j.views.length === 0 && j.frame === null, JSON.stringify(j))
  await page.click('.canvas-close'); await sleep(300)
  check('C: Close closes it', (await panel()) === null)

  // ============ D. the panel belongs to its chat; a narrow window ============
  await clickOpener(0); await sleep(500)
  await page.send('Emulation.setDeviceMetricsOverride', { width: 800, height: 700, deviceScaleFactor: 1, mobile: false })
  await sleep(400)
  const n = await ev(`(() => { const c = document.querySelector('.canvas').getBoundingClientRect(); return { left: Math.round(c.left), right: Math.round(c.right - innerWidth), side: Math.round(document.querySelector('.sidebar').getBoundingClientRect().right), chat: document.querySelector('.app-main').getClientRects().length, sideways: document.documentElement.scrollWidth > innerWidth } })()`)
  check('D: at 800 px the panel takes the chat\'s place, from the sidebar to the window\'s edge, nothing scrolling sideways', n.left === n.side && n.right === 0 && n.chat === 0 && !n.sideways, JSON.stringify(n))
  await page.screenshot(join(shots, '25-narrow.png'))
  await page.click('.canvas-close'); await sleep(300)
  check('D: ...and Close brings the chat back', (await ev(`document.querySelector('.app-main').getClientRects().length > 0 && !!document.querySelector('.composer-input')`)) && (await panel()) === null)
  await page.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false })
  await sleep(300)
  await clickOpener(0); await sleep(500)
  await ev(`[...document.querySelectorAll('.sidebar button')].find((b) => b.textContent.trim() === 'New chat').click()`)
  await sleep(600)
  check('D: a new chat has no panel', (await panel()) === null && (await ev(`document.querySelectorAll('.message').length`)) === 0)

  await fetch(`${mockUrl}/v1/models`).catch(() => undefined)
  check('(the mock does count a fetch of the picture\'s address: the "not fetched" check above could have failed)', (await H.mockReqs()).length === reqs + 1, `${(await H.mockReqs()).length} vs ${reqs}`)
  await page.send('Emulation.clearDeviceMetricsOverride')
  // The browser says in the console that it stopped the page's script and its picture: that is the frame doing its work, not a fault.
  const problems = page.problems.filter((x) => !/sandboxed|Content Security Policy|about:srcdoc/.test(x))
  check('no console errors / warnings / exceptions (but the browser\'s own lines about what the frame stopped)', problems.length === 0, problems.join(' | ').slice(0, 1500))
} catch (error) {
  check(`the run did not stop: ${error?.stack ?? error}`, false, page.problems.join(' | ').slice(0, 1500))
}
const ok = check.summary()
page.close()
process.exit(ok ? 0 : 1)
