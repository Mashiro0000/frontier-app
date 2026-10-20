// Slice 16.5 (D-048) in the real window, against the mock: a made picture in the chat. A chat that holds a request for pictures is saved through the bridge (the dialog that
// makes one comes in 16.6) and opened from History. What it shows:
//   A. (setup) two pictures made through the bridge, and a chat saved with a picture message that names them;
//   B. the chat opened from History shows the request: the description as typed, the two pictures (asked of main by id), the model and the cost; no Edit on it;
//   C. "Use in chat" by a real click puts the picture on the next message as an attachment; sending tells the model the person's messages and the picture, and NOT the
//      request for pictures; the chat is saved as version 7 with the note;
//   D. a picture deleted from the gallery: the chat says so in its place;
//   E. at 420 and 280 px the pictures fit (no sideways scroll); the page logged nothing.
// Needs: USER_DATA_DIR (scratch), INSPECT_PORT, MOCK_PORT.
import './temp-on-a.mjs'
import './ts-resolve.mjs'
import { connect, checker, sleep } from './cdp.mjs'
import { assertScratchProfile } from './profile-guard.mjs'
import { mainInspector, h4 } from './lib4.mjs'
import { installQuestions } from './lib10.mjs'
import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const port = Number(process.argv[3] ?? 9222)
const userData = process.env.USER_DATA_DIR
const inspectPort = Number(process.env.INSPECT_PORT)
const mockUrl = `http://127.0.0.1:${process.env.MOCK_PORT}`
if (!userData || !inspectPort || !process.env.MOCK_PORT) throw new Error('USER_DATA_DIR, INSPECT_PORT and MOCK_PORT must be set')
const check = checker()
const STOP_AFTER = process.env.STOP_AFTER ?? null
let stopped = false
const part = async (name, fn) => { if (stopped) return; try { await fn() } catch (error) { check(`${name} did not run to its end: ${String(error?.stack ?? error).slice(0, 500)}`, false) } if (STOP_AFTER === name) stopped = true }
const show = (v) => JSON.stringify(v)?.slice(0, 600)
const page = await connect(port)
await assertScratchProfile()
const main = await mainInspector(inspectPort)
const Q = await installQuestions(main, { fallback: 'yes' })
const H = h4(page, { userData, mockUrl })
const ev = (expression) => page.evaluate(expression)
const KEY_O = 'sk-proj-' + randomBytes(24).toString('hex')
const KEY_A = 'sk-ant-api03-' + randomBytes(24).toString('hex')
const DESC = 'A lighthouse at dusk,\n  in watercolour'
const CHAT = crypto.randomUUID()
let ids = []
const clickMarked = async (expr) => {
  const ok = await ev(`(() => { const el = ${expr}; if (!el) return false; el.scrollIntoView({ block: 'center' }); el.setAttribute('data-click', '1'); return true })()`)
  if (!ok) throw new Error(`nothing to click: ${expr}`)
  await page.click('[data-click="1"]')
  await ev(`document.querySelector('[data-click="1"]')?.removeAttribute('data-click')`)
}
const pictureMessage = () => ev(`(() => { const m = document.querySelector('.bubble-picture'); if (!m) return null; const art = m.closest('.message'); return { text: m.innerText, description: m.querySelector('.picture-description')?.textContent ?? null, images: [...m.querySelectorAll('img.picture-image')].map((i) => ({ w: i.naturalWidth, done: i.complete, alt: i.alt })), missing: [...m.querySelectorAll('.picture-missing')].map((x) => x.textContent), use: [...m.querySelectorAll('button')].filter((b) => b.textContent === 'Use in chat').map((b) => b.disabled), save: [...m.querySelectorAll('button')].filter((b) => b.textContent === 'Save a copy...').length, actions: [...(art?.querySelectorAll('.message-actions button') ?? [])].map((b) => b.textContent), user: art?.classList.contains('message-user') } })()`)

try {
  // ============ A. setup ============
  await part('A', async () => {
    check('A: (setup) an OpenAI and an Anthropic key are saved', (await ev(`window.api.settings.setApiKey('openai', ${JSON.stringify(KEY_O)})`)).ok && (await ev(`window.api.settings.setApiKey('anthropic', ${JSON.stringify(KEY_A)})`)).ok)
    const on = await ev(`window.api.images.setOn(true)`)
    const made = await ev(`window.api.images.generate({ prompt: ${JSON.stringify(DESC)}, model: 'gpt-image-2', shape: 'square', quality: 'medium', count: 2, chat: ${JSON.stringify(CHAT)} })`)
    ids = made.ok ? made.pictures.map((p) => p.id) : []
    check('A: (setup) "Make images" on through the box, two pictures made', on.ok && made.ok && ids.length === 2, show(made.ok ? ids : made))
    const note = { ids, model: 'gpt-image-2', shape: 'square', quality: 'medium', costUsd: made.costUsd, estimate: made.estimate }
    const saved = await ev(`window.api.history.save({ id: ${JSON.stringify(CHAT)}, messages: [
      { role: 'user', content: 'hello', status: 'done' },
      { role: 'assistant', content: 'Hi there.', status: 'done', provider: 'anthropic', model: 'claude-opus-5-5' },
      { role: 'user', content: ${JSON.stringify(DESC)}, status: 'done', picture: ${JSON.stringify(note)} }
    ] })`)
    const file = H.readConv(CHAT)
    check('A: the chat with a picture message is saved as version 7, with the note and no picture in it', saved.ok !== false && file.version === 7 && JSON.stringify(file.messages[2].picture.ids) === JSON.stringify(ids) && !H.rawConv(CHAT).includes('iVBOR'), show([saved, file.version]))
    // the page reads the list of chats at start and after its own saves: a chat saved through the bridge is listed after a reload
    await ev('location.reload()')
    await sleep(500)
    await page.waitFor(`!!document.querySelector('.composer-input')`, { timeoutMs: 15000 })
  })

  // ============ B. shown from History ============
  await part('B', async () => {
    await H.openHistory()
    await page.waitFor(`[...document.querySelectorAll('dialog.history .history-title')].some((t) => t.textContent === 'hello')`, { timeoutMs: 8000 })
    await H.clickRow('hello')
    await page.waitFor(`!!document.querySelector('.bubble-picture')`, { timeoutMs: 8000 })
    await page.waitFor(`[...document.querySelectorAll('img.picture-image')].length === 2 && [...document.querySelectorAll('img.picture-image')].every((i) => i.complete && i.naturalWidth > 0)`, { timeoutMs: 8000 })
    const m = await pictureMessage()
    check('B: the request is on the person\'s side, with the description exactly as typed', m.user === true && m.description === DESC, show(m))
    check('B: both pictures show, asked of main by id (1024 px), with words for a screen reader', m.images.length === 2 && m.images.every((i) => i.w === 1024 && /^Picture [12] of 2: A lighthouse/.test(i.alt)), show(m.images))
    check('B: the model and the cost are said, and that it was not sent to the model you chat with', /GPT Image 2, square, standard: \$0\.1\d/.test(m.text) && /not sent to the model you chat with/.test(m.text), m.text)
    check('B: "Use in chat" (on: Claude Opus reads pictures) and "Save a copy..." under each picture', m.use.length === 2 && m.use.every((d) => d === false) && m.save === 2, show(m))
    check('B: no Edit on a request for pictures (Copy and Remember are still there)', !m.actions.includes('Edit') && m.actions.includes('Copy'), show(m.actions))
  })

  // ============ C. Use in chat, and sending ============
  await part('C', async () => {
    await clickMarked(`[...document.querySelectorAll('.bubble-picture button')].find((b) => b.textContent === 'Use in chat')`)
    await page.waitFor(`document.querySelectorAll('.attachment-chip, .chip').length > 0`, { timeoutMs: 8000 })
    const chips = await ev(`[...document.querySelectorAll('.attachment-chip, .chip')].map((c) => c.innerText)`)
    check('C: the picture is on the next message as an attachment (named by its id)', chips.length === 1 && /picture-[0-9a-f]{8}\.png/.test(chips[0]), show(chips))
    const before = (await H.mockReqs()).length
    const req = await H.askMock('What do you see?')
    const body = req?.body ?? {}
    const text = JSON.stringify(body.messages ?? [])
    check('C: one request to the chat\'s model', req !== null && (await H.mockReqs()).length === before + 1)
    check('C: it carries the person\'s messages and the picture, as an image block', /hello/.test(text) && /Hi there\./.test(text) && /What do you see\?/.test(text) && /"type":"image"/.test(text), text.slice(0, 300))
    check('C: and NOT the request for pictures (its description is nowhere in it)', !/lighthouse/i.test(JSON.stringify(body)))
    const file = await H.waitConv(CHAT, (c) => c.messages.length >= 5)
    check('C: the chat is saved as version 7: the note kept, the new message with its attachment', file.version === 7 && file.messages[2].picture !== undefined && file.messages[3].attachments?.length === 1 && file.messages[3].content === 'What do you see?', show(file.messages.map((x) => [x.role, x.content.slice(0, 20), !!x.picture, x.attachments?.length])))
  })

  // ============ D. a picture deleted from the gallery ============
  await part('D', async () => {
    await Q.queue('yes')
    const d = await ev(`window.api.images.remove(${JSON.stringify(ids[1])})`)
    check('D: (setup) the second picture is deleted from the gallery through the box', d.ok === true, show(d))
    await ev(`(() => { const b = [...document.querySelectorAll('.chat-button')].find((x) => x.textContent === 'New chat'); b.click() })()`)
    await sleep(300)
    await H.openHistory()
    await page.waitFor(`[...document.querySelectorAll('dialog.history .history-title')].some((t) => t.textContent === 'hello')`, { timeoutMs: 8000 })
    await H.clickRow('hello')
    await page.waitFor(`document.querySelectorAll('.bubble-picture .picture-missing').length === 1`, { timeoutMs: 8000 })
    const m = await pictureMessage()
    check('D: the chat says so in its place, and the other picture still shows', m.missing.length === 1 && /no longer in the gallery/.test(m.missing[0]) && m.images.length === 1, show(m))
  })

  // ============ E. layout ============
  await part('E', async () => {
    for (const width of [420, 280]) {
      await page.send('Emulation.setDeviceMetricsOverride', { width, height: 700, deviceScaleFactor: 1, mobile: false })
      await sleep(400)
      const fit = await ev(`(() => { const list = document.querySelector('.message-list'); const pic = document.querySelector('.bubble-picture'); const img = document.querySelector('img.picture-image'); return { sideways: document.documentElement.scrollWidth - document.documentElement.clientWidth, list: list.scrollWidth - list.clientWidth, bubble: pic.getBoundingClientRect().right <= list.getBoundingClientRect().right + 1, img: img.getBoundingClientRect().width <= pic.getBoundingClientRect().width } })()`)
      check(`E: at ${width} px the request and its pictures fit (no sideways scroll)`, fit.sideways <= 0 && fit.list <= 0 && fit.bubble && fit.img, show(fit))
    }
    await page.send('Emulation.clearDeviceMetricsOverride')
    check('E: the page logged no errors and no warnings', page.problems.length === 0, show(page.problems))
  })
} finally {
  const ok = check.summary()
  process.exit(ok ? 0 : 1)
}
