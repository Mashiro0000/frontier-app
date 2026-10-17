// Slice 17.6 (D-049) in the real window, against the mock's Gemini stand-in: files, instructions, a project's words and notes in a Gemini request, as the running app
// sends them. Files are kept through the bridge (addBytes, as a paste does) and the requests sent through the bridge (chat.start), so the suite reads exactly what
// main sends. The system's box answered yes from the main inspector. What it shows:
//   A. a PNG, a JPEG, a PDF and a text file on one message to Gemini 3.8 Flash: inline with their types, the text file led by its name, the person's words last; the
//      stand-in takes it;
//   B. a GIF: nothing is sent, and the sentence names the model and the file; the same chat sent to Claude goes;
//   C. instructions for every chat and for this chat go in the system instruction, the app's rules first; a saved Google key in the chat's instructions refuses
//      the request in words that name Google, and nothing is sent;
//   D. the page logged nothing.
// Needs: USER_DATA_DIR (scratch), INSPECT_PORT, MOCK_PORT.
import './temp-on-a.mjs'
import './ts-resolve.mjs'
import { connect, checker } from './cdp.mjs'
import { assertScratchProfile } from './profile-guard.mjs'
import { mainInspector, h4 } from './lib4.mjs'
import { installQuestions } from './lib10.mjs'
import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { TOOLS } from './paths.mjs'

const port = Number(process.argv[3] ?? 9222)
const userData = process.env.USER_DATA_DIR
const inspectPort = Number(process.env.INSPECT_PORT)
const mockUrl = `http://127.0.0.1:${process.env.MOCK_PORT}`
if (!userData || !inspectPort || !process.env.MOCK_PORT) throw new Error('USER_DATA_DIR, INSPECT_PORT and MOCK_PORT must be set')
const check = checker()
const part = async (name, fn) => { try { await fn() } catch (error) { check(`${name} did not run to its end: ${String(error?.stack ?? error).slice(0, 500)}`, false) } }
const show = (v) => JSON.stringify(v)?.slice(0, 700)
const page = await connect(port)
await assertScratchProfile()
const main = await mainInspector(inspectPort)
await installQuestions(main, { fallback: 'yes' })
const H = h4(page, { userData, mockUrl })
const ev = (expression) => page.evaluate(expression)
const KEY_G = 'AIza' + randomBytes(27).toString('base64url').slice(0, 35)
const KEY_A = 'sk-ant-api03-' + randomBytes(24).toString('hex')
const GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64')
const fixture = (name) => readFileSync(join(TOOLS, 'fixtures9', name))
const reqs = async () => (await H.mockReqs()).filter((r) => !r.listing)
/** Keeps a file through the bridge (as a paste does) and answers with its id and name. */
const keep = async (name, bytes) => { const r = await ev(`window.api.attachments.addBytes(${JSON.stringify(name)}, new Uint8Array(${JSON.stringify([...bytes])}))`); if (!r.ok) throw new Error(`not kept: ${show(r)}`); return { id: r.file.info.id, name: r.file.info.name } }
/** Sends a request through the bridge and answers with its events ("error: ..." for an error). */
const run = (request) => ev(`new Promise((resolve) => {
  const request = ${JSON.stringify(request)}
  const events = []
  const stop = window.api.chat.onEvent((e) => { if (e.streamId !== request.streamId) return; events.push(e.type === 'error' ? 'error: ' + e.message : e.type === 'text' ? 'text: ' + e.text : e.type); if (e.type === 'error' || e.type === 'done') { stop(); resolve(events) } })
  window.api.chat.start(request)
  setTimeout(() => { stop(); resolve(events.concat('(no end)')) }, 15000)
})`)
let n = 0
const streamId = () => `gem-${String(++n).padStart(4, '0')}`

try {
  await fetch(`${mockUrl}/__reset`, { method: 'POST' })
  await part('A', async () => {
    check('A: (setup) Google and Anthropic keys saved', (await ev(`window.api.settings.setApiKey('google', ${JSON.stringify(KEY_G)})`)).ok && (await ev(`window.api.settings.setApiKey('anthropic', ${JSON.stringify(KEY_A)})`)).ok)
    await H.chooseInPage('gemini-3.8-flash')
    await H.settle('gemini-3.8-flash')
    const files = [await keep('q.png', fixture('q.png')), await keep('q.jpg', fixture('q.jpg')), await keep('three-pages.pdf', fixture('three-pages.pdf')), await keep('notes.md', Buffer.from('# Notes\n\nline one\n'))]
    const before = (await reqs()).length
    const events = await run({ streamId: streamId(), messages: [{ role: 'user', content: 'what are these? [[mock:files]]', attachments: files }] })
    const r = (await reqs()).slice(before).find((x) => x.provider === 'google')
    const parts = r?.body.contents[0].parts ?? []
    check('A: one request to Google; the stand-in takes it and the reply says what came', r !== undefined && r.problems.length === 0 && /\[image\/png \d+ bytes\] \[image\/jpeg \d+ bytes\] \[application\/pdf \d+ bytes\]/.test(events.filter((e) => e.startsWith('text: ')).map((e) => e.slice(6)).join('')) && events.at(-1) === 'done', show([r?.problems, events.slice(-3)]))
    check('A: the parts: PNG, JPEG, PDF inline (each its own type), the text file as text led by its name, then the person\'s words', JSON.stringify(parts.map((p) => p.inlineData?.mimeType ?? (p.text?.startsWith('The person attached a text file named "notes.md".') ? 'textfile' : p.text))) === JSON.stringify(['image/png', 'image/jpeg', 'application/pdf', 'textfile', 'what are these? [[mock:files]]']), show(parts.map((p) => Object.keys(p))))
    check('A: the PDF\'s bytes are the file\'s own, as base64 (nothing by reference)', parts[2]?.inlineData?.data === fixture('three-pages.pdf').toString('base64') && !r.raw.includes('fileData'))
  })

  await part('B', async () => {
    const gif = await keep('moving.gif', GIF)
    const before = (await reqs()).length
    const events = await run({ streamId: streamId(), messages: [{ role: 'user', content: 'and this?', attachments: [gif] }] })
    check('B: a GIF for Gemini: nothing is sent, and the sentence names the model and the file', events.some((e) => e === 'error: Nothing was sent: Gemini 3.8 Flash cannot read GIF pictures, and this chat has one ("moving.gif"). Choose another model, or start a new chat without it.') && (await reqs()).length === before, show(events))
    await H.chooseInPage('claude-opus-5-5')
    await H.settle('claude-opus-5-5')
    const sent = await run({ streamId: streamId(), messages: [{ role: 'user', content: 'and this?', attachments: [gif] }] })
    const r = (await reqs()).at(-1)
    check('B: the same GIF to Claude goes, as before', sent.at(-1) === 'done' && r?.provider === 'anthropic' && JSON.stringify(r.body.messages[0].content).includes('image/gif'), show(sent.slice(-2)))
    await H.chooseInPage('gemini-3.8-flash')
    await H.settle('gemini-3.8-flash')
  })

  await part('C', async () => {
    const every = await ev(`window.api.instructions.setEveryChat('I live in Lisbon.', false)`)
    check('C: (setup) instructions for every chat kept (the box answered yes)', every?.ok === true, show(every))
    const before = (await reqs()).length
    await run({ streamId: streamId(), instructions: 'Answer in French.', messages: [{ role: 'user', content: 'hello' }] })
    const r = (await reqs()).slice(before).find((x) => x.provider === 'google')
    const system = r?.body.systemInstruction.parts[0].text ?? ''
    check('C: the system instruction: the app\'s rules first, then the instructions for every chat, then the chat\'s own (they win)', system.startsWith('You are an AI assistant, chatting with someone in Frontier App') && system.indexOf('I live in Lisbon.') > 0 && system.indexOf('Answer in French.') > system.indexOf('I live in Lisbon.') && /follow these:\n\nAnswer in French\.$/.test(system), show(system.slice(-300)))
    check('C: none of it is in the conversation', JSON.stringify(r.body.contents) === JSON.stringify([{ role: 'user', parts: [{ text: 'hello' }] }]))
    const before2 = (await reqs()).length
    const refused = await run({ streamId: streamId(), instructions: `use ${KEY_G} please`, messages: [{ role: 'user', content: 'hello' }] })
    check('C: the saved Google key in the chat\'s instructions: nothing sent, and the sentence names Google', refused.some((e) => e === 'error: Nothing was sent: your instructions for this chat hold your Google API key, which is saved in this app. Open Instructions and take it out.') && (await reqs()).length === before2, show(refused))
  })

  await part('D', async () => {
    check('D: the page logged no error or warning', page.problems.length === 0, show(page.problems))
  })
} finally {
  const ok = check.summary()
  process.exit(ok ? 0 : 1)
}
