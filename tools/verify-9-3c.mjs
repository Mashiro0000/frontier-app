// Slice 9.3 (D-037), launch 3 of run93.mjs (from source only: the built app has the registry inside it): the registry changed for this run so that
// GPT-6 Luna reads neither images nor PDFs. What is checked: with an image in the chat, choosing Luna turns Send off and says why on screen (and in the
// button's tooltip), naming the model; the same for a PDF on the message; a text file still goes to Luna (every model reads text); a page that sends
// anyway through the bridge gets "Nothing was sent", and nothing reaches the provider; a new chat without files sends again. Needs USER_DATA_DIR
// (a fresh scratch profile), FILES_DIR, INSPECT_PORT, MOCK_PORT and a saved Anthropic key (setup-key.mjs).
import { start } from './lib8b3w.mjs'
import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const W = await start()
const { page, H, ev, check, main, FILES, sleep } = W
const mockUrl = `http://127.0.0.1:${process.env.MOCK_PORT}`
const F = (name) => join(FILES, name)
const show = (v) => JSON.stringify(v)?.slice(0, 300)
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const OPUS = 'claude-opus-5-5'
const LUNA = 'gpt-6-luna'
const reqs = async () => (await fetch(`${mockUrl}/__requests`)).json()
const b64 = (path) => readFileSync(path).toString('base64')
const paste = (path, name, type) => ev(`(() => { const t = document.querySelector('.composer-input'); const dt = new DataTransfer(); dt.items.add(new File([Uint8Array.from(atob(${JSON.stringify(b64(path))}), (c) => c.charCodeAt(0))], ${JSON.stringify(name)}, { type: ${JSON.stringify(type)} })); t.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); return true })()`)
const waitChips = (n) => page.waitFor(`document.querySelectorAll('.attachment-chip').length === ${n}`, { timeoutMs: 20000, label: `${n} chips` })
const removeChip = async (name) => {
  await ev(`[...document.querySelectorAll('.attachment-remove')].find((b) => b.getAttribute('aria-label') === ${JSON.stringify(`Remove ${name}`)})?.setAttribute('data-click', '1')`)
  await page.click('[data-click="1"]')
  await ev(`document.querySelector('[data-click="1"]')?.removeAttribute('data-click')`)
}
const state = () => ev(`(() => { const b = document.querySelector('.composer-button[type=submit]'); const l = document.querySelector('.composer-blocked'); return { disabled: b?.disabled ?? null, title: b?.title ?? null, line: l ? l.innerText : null, role: l?.getAttribute('role') ?? null } })()`)
const sendNow = async (text) => {
  const before = (await reqs()).length
  await ev(`(() => { const t = document.querySelector('.composer-input'); t.focus(); t.select() })()`)
  if (text !== '') await page.type(text)
  await page.press('Enter')
  const t0 = Date.now()
  while (Date.now() - t0 < 10000 && (await reqs()).length === before) await sleep(60)
  await H.waitReady(20000)
  await sleep(200)
  const all = await reqs()
  return all.length > before ? all.at(-1) : null
}
const typeOnly = async (text) => { await ev(`(() => { const t = document.querySelector('.composer-input'); t.focus(); t.select() })()`); await page.type(text); await sleep(150) }
const sectionOf = `[...document.querySelectorAll('dialog.settings form.settings-section')].find((f) => f.querySelector('#api-key-openai'))`

try {
  await page.waitFor(`!!document.querySelector('.chat-bar')`, { timeoutMs: 20000, label: 'the app' })
  await sleep(400)
  const status = await H.status()
  const luna = status.models.find((m) => m.id === LUNA)
  check('(this run\'s registry: GPT-6 Luna reads neither images nor PDFs; Claude Opus 5.5 reads both)', luna && luna.imageInput === false && luna.documentInput === false && status.models.find((m) => m.id === OPUS)?.imageInput === true, show(luna))
  const key = 'test-' + randomBytes(24).toString('hex')
  await fetch(`${mockUrl}/__expect-key`, { method: 'POST', body: JSON.stringify({ key, provider: 'openai' }) })
  await page.click('.header-button@Settings')
  await page.waitFor(`!!document.querySelector('dialog.settings')?.open`)
  await ev(`document.getElementById('api-key-openai').select()`)
  await page.type(key)
  await ev(`(() => { const b = ${sectionOf}.querySelector('button[type=submit]'); b.setAttribute('data-click', '1'); b.scrollIntoView({ block: 'center' }) })()`)
  await sleep(150)
  await page.click('[data-click="1"]')
  await page.waitFor(`${sectionOf}.querySelector('.settings-notice')?.innerText === 'Saved.'`, { timeoutMs: 8000 })
  await ev(`document.querySelector('[data-click="1"]')?.removeAttribute('data-click'); 0`)
  await page.press('Escape')
  await sleep(250)

  // an image sent to Claude
  await paste(F('diagram.png'), 'diagram.png', 'image/png')
  await waitChips(1)
  const r1 = await sendNow('[[mock:files]] to Claude')
  check('with Claude Opus 5.5 the image is sent', r1 && r1.problems.length === 0 && r1.body.messages[0].content[0].type === 'image')

  // Luna, with that image earlier in the chat
  await H.chooseInPage(LUNA)
  await H.settle(LUNA)
  await typeOnly('a question for Luna')
  const s1 = await state()
  const why1 = 'GPT-6 Luna cannot read images, and this chat has one. Choose a model that can.'
  check('choosing a model that cannot read images turns Send off, and says why under the message box (and in Send\'s tooltip), naming the model', s1.disabled === true && s1.line === why1 && s1.title === why1 && s1.role === 'status', show(s1))
  const before = (await reqs()).length
  await page.press('Enter')
  await sleep(600)
  check('...Enter sends nothing either', (await reqs()).length === before && (await ev(`document.querySelectorAll('.message-user').length`)) === 1)
  const bridged = await ev(`(async () => {
    const list = await window.api.history.list()
    const id = list.conversations[0].id
    const chat = await window.api.history.load(id)
    const file = chat.conversation.messages[0].attachments[0]
    return await new Promise((resolve) => {
      const events = []
      const stop = window.api.chat.onEvent((e) => { if (e.streamId !== 'bridge-luna-1') return; events.push(e.type === 'error' ? 'error: ' + e.message : e.type); if (e.type === 'error' || e.type === 'done') { stop(); resolve(events) } })
      window.api.chat.start({ streamId: 'bridge-luna-1', messages: [{ role: 'user', content: '', attachments: [{ id: file.id, name: file.name }] }, { role: 'assistant', content: 'seen' }, { role: 'user', content: 'and now?' }] })
      setTimeout(() => { stop(); resolve(events.concat('(no end)')) }, 6000)
    })
  })()`)
  check('a page that sends anyway through the bridge is told "Nothing was sent", naming the model and the file, and nothing reaches the provider', bridged.at(-1) === 'error: Nothing was sent: GPT-6 Luna cannot read images, and this chat has one ("diagram.png"). Choose a model that can.' && (await reqs()).length === before, show(bridged))

  // a new chat: a PDF on the message, then a text file
  await H.clickChat('New chat')
  await sleep(300)
  check('a new chat (no files in it) clears the line', (await state()).line === null)
  await paste(F('report.pdf'), 'report.pdf', 'application/pdf')
  await waitChips(1)
  const s2 = await state()
  check('a PDF on the message with Luna chosen: Send off, and the line says Luna cannot read PDFs', s2.disabled === true && s2.line === 'GPT-6 Luna cannot read PDFs, and this chat has one. Choose a model that can.', show(s2))
  await removeChip('report.pdf')
  await waitChips(0)
  await paste(F('notes.md'), 'notes.md', 'text/markdown')
  await waitChips(1)
  const s3 = await state()
  check('...taken off, and a text file put on instead: nothing in the way (every model reads text)', s3.disabled === false && s3.line === null, show(s3))
  const r3 = await sendNow('[[mock:files]] text for Luna')
  const in3 = r3?.body?.input?.find((x) => x.role === 'user')
  check('the text file goes to Luna as an input_text led by its name, then the words', r3 && r3.url.startsWith('/v1/responses') && r3.problems.length === 0 && same(in3?.content?.map((p) => p.type), ['input_text', 'input_text']) && in3.content[0].text.startsWith('The person attached a text file named "notes.md".'), show(in3?.content?.map((p) => p.type)))
  const problems = page.problems.filter((p) => !/Autofill|Electron Security Warning|DevTools/.test(p))
  check('no console errors, warnings or CSP violations in the page', problems.length === 0, show(problems))
} catch (error) {
  check(`the suite stopped before its end: ${String(error?.stack ?? error).slice(0, 500)}`, false)
}

main.close()
page.close()
process.exit(check.summary() ? 0 : 1)
