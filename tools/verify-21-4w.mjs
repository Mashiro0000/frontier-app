// Stage 21.4 (D-053), the box, in the real window against the mock (Anthropic's key only): the chips under the box of an empty chat (Web search, Projects,
// Instructions; Make an image only while images are on) open what their buttons open, and go with the first message; the empty box shows examples, one after
// another; the sizes taken from AI Fiesta (an 800 px box, 28 px corners, a 34 px greeting); Enhance: off with nothing typed, ONE request to the cheapest model
// with a key, carrying only the draft (no tools, no other message), the rewrite put in the box with who wrote it and Undo, nothing sent to the chat and no chat
// saved; the question before a large request, and a "no"; a stop. Screenshots in shots21. Needs: MOCK_PORT, USER_DATA_DIR (scratch) and setup-key.mjs.
import './ts-resolve.mjs'
import { existsSync, mkdirSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { connect, checker, sleep } from './cdp.mjs'
import { assertScratchProfile } from './profile-guard.mjs'
import { helpers } from './lib3.mjs'

const shots = join(process.argv[2], '..', 'shots21')
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
const chatFiles = () => { const d = join(userData, 'conversations'); return existsSync(d) ? readdirSync(d).filter((n) => n.endsWith('.json')).length : 0 }
const chips = () => ev(`[...document.querySelectorAll('.empty-chips .chip-start')].map((c) => c.textContent.trim())`)
const openDialogs = () => ev(`[...document.querySelectorAll('dialog')].filter((d) => d.open).map((d) => d.className.split(' ')[0])`)
const typeDraft = async (text) => { await ev(`(() => { const t = document.querySelector('.composer-input'); t.focus(); t.select() })()`); await page.type(text); await sleep(150) }
const boxText = () => ev(`document.querySelector('.composer-input').value`)
const note = () => ev(`document.querySelector('.composer-enhance-note')?.textContent ?? null`)
const enhanceBtn = () => ev(`(() => { const b = document.querySelector('.composer-enhance'); return b ? { disabled: b.disabled, label: b.getAttribute('aria-label'), busy: b.classList.contains('composer-enhance-busy') } : null })()`)
const sent = async () => (await H.mockReqs()).filter((r) => !r.listing)

try {
  await page.waitFor(READY, { timeoutMs: 20000 })
  await sleep(400)
  const filesAtStart = chatFiles()

  // ============ A. chips ============
  check('A: an empty chat has the chips Web search, Projects, Instructions under the box (images are off: no "Make an image")', JSON.stringify(await chips()) === '["Web search","Projects","Instructions"]', JSON.stringify(await chips()))
  const place = await ev(`(() => { const c = document.querySelector('.empty-chips').getBoundingClientRect(); const b = document.querySelector('.composer-inner').getBoundingClientRect(); return { below: c.top >= b.bottom, centred: Math.abs((c.left + c.right) / 2 - (b.left + b.right) / 2) < 30 } })()`)
  check('A: they sit under the box, centred on it', place.below && place.centred, JSON.stringify(place))
  for (const [chip, dialog] of [['Web search', 'tools'], ['Projects', 'projects'], ['Instructions', 'instructions']]) {
    await page.click(`.empty-chips .chip-start@${chip}`)
    await sleep(500)
    check(`A: "${chip}" opens the ${dialog} page`, (await openDialogs()).includes(dialog), JSON.stringify(await openDialogs()))
    await page.press('Escape'); await sleep(300)
  }

  // ============ B. examples in the empty box ============
  const p1 = await ev(`document.querySelector('.composer-input').placeholder`)
  await sleep(4400)
  const p2 = await ev(`document.querySelector('.composer-input').placeholder`)
  check('B: the empty box shows an example ("Try: ..."), and the next one four seconds later', /^Try: .{8,}/.test(p1) && /^Try: .{8,}/.test(p2) && p1 !== p2, JSON.stringify([p1, p2]))

  // ============ C. the sizes ============
  await page.send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false }); await sleep(400)
  const size = await ev(`(() => { const b = document.querySelector('.composer-inner'); const h = document.querySelector('.empty-heading'); return { w: Math.round(b.getBoundingClientRect().width), r: getComputedStyle(b).borderTopLeftRadius, g: getComputedStyle(h).fontSize, col: getComputedStyle(document.documentElement).getPropertyValue('--chat-width').trim() } })()`)
  check('C: the box is 800 px wide (AI Fiesta\'s), with 28 px corners; the greeting is 34 px', size.w === 800 && size.r === '28px' && size.g === '34px' && size.col === '800px', JSON.stringify(size))
  await page.screenshot(join(shots, '21-4-empty-chat.png'))
  await page.send('Emulation.clearDeviceMetricsOverride'); await sleep(400)

  // ============ D. Enhance ============
  check('D: the Enhance button is there and off while the box is empty', (await enhanceBtn())?.disabled === true && (await enhanceBtn()).label === 'Enhance')
  await typeDraft('make the bug fix faster')
  check('D: on once something is typed', (await enhanceBtn()).disabled === false)
  await fetch(`${mockUrl}/__reset`, { method: 'POST' })
  await page.click('.composer-enhance')
  await page.waitFor(`!!document.querySelector('.composer-enhance-note')`, { timeoutMs: 15000 })
  await sleep(300)
  const reqs = await sent()
  check('D: ONE request, to the cheapest model with a key (Anthropic\'s only: Claude Sonnet 5.5)', reqs.length === 1 && reqs[0].body?.model === 'claude-sonnet-5-5', JSON.stringify(reqs.map((r) => r.body?.model)))
  const body = reqs[0]?.body ?? {}
  check('D: it carries only the draft, asked to be rewritten: one message, no tools', body.messages?.length === 1 && JSON.stringify(body.messages[0]).includes('Rewrite the message below') && JSON.stringify(body.messages[0]).includes('make the bug fix faster') && (body.tools === undefined || body.tools.length === 0), JSON.stringify(body.messages)?.slice(0, 300))
  const after = await boxText()
  check('D: the rewrite is in the box (the mock echoes what it was asked)', /^Echo: Rewrite the message below/.test(after), after.slice(0, 80))
  check('D: a line says who rewrote it, to read it first, with Undo', /^Rewritten by Claude Sonnet 5\.5\. Read it before you send it\.\s*Undo$/.test(await note()), await note())
  check('D: nothing was sent to the chat (still empty, chips still there) and no chat was saved', (await ev(`document.querySelectorAll('.message').length`)) === 0 && (await chips()).length === 3 && chatFiles() === filesAtStart)
  await page.screenshot(join(shots, '21-4-enhanced.png'))
  await page.click('.composer-enhance-note .link-button@Undo'); await sleep(200)
  check('D: Undo puts the draft back', (await boxText()) === 'make the bug fix faster' && (await note()) === null)

  // ============ E. a stop ============
  await typeDraft('[[mock:hang-before]] a draft that waits')
  await page.click('.composer-enhance'); await sleep(800)
  check('E: while it works the button says "Stop enhancing"', (await enhanceBtn()).label === 'Stop enhancing' && (await enhanceBtn()).busy)
  await page.click('.composer-enhance'); await sleep(500)
  check('E: a click stops it: the draft is as it was, no line under the box', (await boxText()) === '[[mock:hang-before]] a draft that waits' && (await note()) === null && (await enhanceBtn()).label === 'Enhance')

  // ============ F. the question before a large request ============
  // Not driven here: the smallest amount it can be set to is $0.01, and an Enhance request costs a small part of a cent. verify-21-4.mjs checks that Enhance
  // hands the chat's own question to the request and that main asks it as for any request.

  // ============ G. the first message: chips and examples go ============
  await H.send('[[mock:say]] hi'); await sleep(300)
  await page.waitFor(`document.querySelectorAll('.message').length >= 2 && !!document.querySelector('.composer-button[type=submit]')`, { timeoutMs: 15000 })
  check('G: after the first message the chips are gone and the box says "Type a message"', (await ev(`!!document.querySelector('.empty-chips')`)) === false && (await ev(`document.querySelector('.composer-input').placeholder`)) === 'Type a message')
} catch (error) {
  check('the suite ran to the end', false, error?.stack ?? String(error))
}
process.exit(check.summary() ? 0 : 1)
