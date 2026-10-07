// Slice 9.3 (D-037), in the real window against the fake providers: sending and saving files. The system's dialogs are replaced from the main process's
// inspector (an open dialog answered with the suite's paths, a save dialog for the backup that encryption asks for first, a message box). What is checked:
// files sent with a message, in each provider's own form, made from main's copies (the photo without its metadata, the PDF as it is, the text word for word);
// the reply; the files on the sent message; the chat saved as version 4 with each file's description and no picture; the files sent again with a later
// message; a message that is only files; the same chat sent to OpenAI; a new chat that starts with files and is titled by them; a chat opened from History
// shows its files with pictures made again by main, without being saved again; a copy that is gone (shown, and nothing is sent); deleting a chat deletes
// the copies no other chat uses; encryption seals the copies and they are still sent as they were; going back to plain files; what the page cannot do
// through the bridge; the layout down to 280 px; no console errors. Needs USER_DATA_DIR (scratch), FILES_DIR (made by run93.mjs), INSPECT_PORT, MOCK_PORT
// and a saved Anthropic key (setup-key.mjs).
import { start } from './lib8b3w.mjs'
import { createHash, randomBytes } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const W = await start()
const { page, H, ev, check, main, FILES, shots, sleep, userData } = W
const mockPort = process.env.MOCK_PORT
if (!mockPort) throw new Error('MOCK_PORT must be set')
const mockUrl = `http://127.0.0.1:${mockPort}`
const ATT = join(userData, 'attachments')
const SEALED = Buffer.from('FRONTIER-SEALED-ATTACHMENT-1\n', 'latin1')
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex')
const copies = () => (existsSync(ATT) ? readdirSync(ATT).filter((n) => /^[0-9a-f]{64}$/.test(n)).sort() : [])
const copyBytes = (id) => readFileSync(join(ATT, id))
const F = (name) => join(FILES, name)
const show = (v) => JSON.stringify(v)?.slice(0, 400)
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const OPUS = 'claude-opus-5-5'
const SOL = 'gpt-6.1-sol'
const NOTES = readFileSync(F('notes.md'), 'utf8')

// ---- the system's dialogs, played from here ----
await main.inMain(`(() => {
  const { dialog } = process.mainModule.require('electron')
  globalThis.__d = { open: [], save: [], box: [], calls: [] }
  const answer = async (kind, args) => {
    const d = globalThis.__d
    d.calls.push({ kind, options: args[args.length - 1] })
    const next = d[kind].shift()
    if (kind === 'box') return { response: next === undefined ? 1 : next, checkboxChecked: false }
    if (next === undefined || next === null) return kind === 'save' ? { canceled: true } : { canceled: true, filePaths: [] }
    return kind === 'save' ? { canceled: false, filePath: next } : { canceled: false, filePaths: next }
  }
  dialog.showOpenDialog = (...args) => answer('open', args)
  dialog.showSaveDialog = (...args) => answer('save', args)
  dialog.showMessageBox = (...args) => answer('box', args)
  return true
})()`)
const queue = (kind, value) => main.inMain(`globalThis.__d.${kind}.push(${JSON.stringify(value)}); true`)

// ---- the composer's chips (9.2) ----
const chips = () => ev(`[...document.querySelectorAll('.attachment-chip')].map((c) => c.querySelector('.attachment-name')?.textContent)`)
const waitChips = (n) => page.waitFor(`document.querySelectorAll('.attachment-chip').length === ${n}`, { timeoutMs: 20000, label: `${n} chips` })
const waitIdle = () => page.waitFor(`(() => { const b = [...document.querySelectorAll('.chat-bar .chat-button')].find((x) => x.textContent === 'Attach...'); return b && b.title !== 'Files are being attached.' })()`, { timeoutMs: 20000, label: 'attaching finished' })
const attach = async (names) => {
  const before = (await chips()).length
  await queue('open', names.map(F))
  await H.clickChat('Attach...')
  await sleep(150)
  await waitIdle()
  await waitChips(before + names.length)
}
const b64 = (path) => readFileSync(path).toString('base64')
const paste = (path, name, type) => ev(`(() => { const t = document.querySelector('.composer-input'); const dt = new DataTransfer(); dt.items.add(new File([Uint8Array.from(atob(${JSON.stringify(b64(path))}), (c) => c.charCodeAt(0))], ${JSON.stringify(name)}, { type: ${JSON.stringify(type)} })); t.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); return true })()`)
const sendButton = () => ev(`(() => { const b = document.querySelector('.composer-button[type=submit]'); return b ? { disabled: b.disabled, title: b.title } : null })()`)
const blockedLine = () => ev(`document.querySelector('.composer-blocked')?.innerText ?? null`)

// ---- the files on the messages on screen ----
const shownFiles = () => ev(`[...document.querySelectorAll('.message-list-inner > .message')].map((m) => [...m.querySelectorAll('.message-file')].map((f) => ({ name: f.querySelector('.attachment-name')?.textContent, facts: f.querySelector('.attachment-facts')?.textContent, thumb: f.querySelector('img.attachment-thumb')?.getAttribute('src')?.slice(0, 30) ?? null, icon: f.querySelector('.attachment-icon')?.textContent ?? null, title: f.getAttribute('title'), missing: f.classList.contains('message-file-missing') })))`)

// ---- sending ----
const reqs = async () => (await fetch(`${mockUrl}/__requests`)).json()
/** Types `text` (nothing for a message of only files) and presses Enter; waits for the mock to receive a request and the reply to end. Returns that request, or null. */
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
const lastReply = () => ev(`(() => { const a = [...document.querySelectorAll('.message-assistant')].at(-1); return a ? { text: a.querySelector('.bubble')?.innerText ?? '', note: a.querySelector('.message-note')?.textContent ?? null, error: !!a.querySelector('.message-note-error') } : null })()`)
/** The saved chat file whose first message starts with `text`, once `pred` holds. */
const saved = (text, pred) => H.waitFirst(text, pred, 8000)

// the same key-saving the Stage 5 suite does, for OpenAI
const sectionOf = (provider) => `[...document.querySelectorAll('dialog.settings form.settings-section')].find((f) => f.querySelector('#api-key-${provider}'))`
const saveOpenAIKey = async (key) => {
  await page.click('.header-button@Settings')
  await page.waitFor(`!!document.querySelector('dialog.settings')?.open`)
  await ev(`document.getElementById('api-key-openai').select()`)
  await page.type(key)
  await ev(`(() => { const b = ${sectionOf('openai')}.querySelector('button[type=submit]'); b.setAttribute('data-click', '1'); b.scrollIntoView({ block: 'center' }) })()`)
  await sleep(150)
  await page.click('[data-click="1"]')
  await page.waitFor(`${sectionOf('openai')}.querySelector('.settings-notice')?.innerText === 'Saved.'`, { timeoutMs: 8000 })
  await ev(`document.querySelector('[data-click="1"]')?.removeAttribute('data-click'); 0`)
  await page.press('Escape')
  await sleep(250)
}

try {
  await page.waitFor(`!!document.querySelector('.chat-bar')`, { timeoutMs: 20000, label: 'the app' })
  await sleep(400)
  const openaiKey = 'test-' + randomBytes(24).toString('hex')
  await fetch(`${mockUrl}/__expect-key`, { method: 'POST', body: JSON.stringify({ key: openaiKey, provider: 'openai' }) })
  await saveOpenAIKey(openaiKey)
  const pdfSha = sha(readFileSync(F('report.pdf')))

  // ============ 1. a message with three files, to Anthropic ============
  await attach(['holiday.jpg', 'report.pdf', 'notes.md'])
  const kept = copies()
  const s0 = await sendButton()
  check('with files on the message Send is on (9.2 kept it off), even before anything is typed; nothing is in the way', s0 && !s0.disabled && (await blockedLine()) === null, show(s0))
  const Q1 = '[[mock:files]] What are these?'
  const r1 = await sendNow(Q1)
  const m1 = r1?.body?.messages?.[0]
  check('the request reached the fake Anthropic API, which found nothing wrong with it (its reading of the documentation)', r1 && r1.url.startsWith('/v1/messages') && r1.problems.length === 0, show(r1?.problems))
  check('the message is a list of blocks in order: the image, the PDF, the text file, then the words', Array.isArray(m1?.content) && same(m1.content.map((b) => b.type), ['image', 'document', 'document', 'text']) && m1.content[3].text === Q1, show(m1?.content?.map((b) => ({ ...b, source: b.source ? { ...b.source, data: String(b.source.data).slice(0, 20) } : undefined }))))
  const imgBytes = m1 ? Buffer.from(m1.content[0].source.data, 'base64') : Buffer.alloc(0)
  check('the image is main\'s copy (its bytes hash to a copy\'s name), a JPEG, and holds none of the photo\'s metadata (no EXIF, no place, no comment)', m1?.content[0].source.media_type === 'image/jpeg' && kept.includes(sha(imgBytes)) && !imgBytes.includes(Buffer.from('GPS-HOME')) && !imgBytes.includes(Buffer.from('Exif')) && !imgBytes.includes(Buffer.from('SECRET-CAMERA')))
  check('the PDF goes as it is (byte for byte the original), base64, titled with its name', m1?.content[1].source.type === 'base64' && m1.content[1].source.media_type === 'application/pdf' && m1.content[1].title === 'report.pdf' && sha(Buffer.from(m1.content[1].source.data, 'base64')) === pdfSha)
  check('the text file goes as a text document, word for word, titled with its name', m1?.content[2].source.type === 'text' && m1.content[2].source.media_type === 'text/plain' && m1.content[2].source.data === NOTES && m1.content[2].title === 'notes.md')
  const rep1 = await lastReply()
  const want1 = new RegExp(`^Files: image image/jpeg 32x64 ${imgBytes.length} bytes \\| pdf "report\\.pdf" ${readFileSync(F('report.pdf')).length} bytes \\| text "notes\\.md" ${NOTES.length} chars \\| words ${Q1.length} chars$`)
  check('the reply (the mock says what it received) names the upright photo (32 x 64), the PDF, the text and the words', rep1 && want1.test(rep1.text.trim()) && !rep1.error, show(rep1))
  check('the chips left the message box with the message (the files belong to the message now), and the copies are kept for the chat', (await chips()).length === 0 && same(copies(), kept), show(copies()))
  const sf1 = await shownFiles()
  check('the sent message shows its three files above its words: the photo\'s small picture, then the PDF and the text by their type', sf1[0]?.length === 3 && same(sf1[0].map((f) => f.name), ['holiday.jpg', 'report.pdf', 'notes.md']) && sf1[0][0].thumb === 'data:image/png;base64,iVBORw0K' && sf1[0][1].icon === 'PDF' && sf1[0][2].icon === 'TXT' && /^JPEG image, 32 x 64/.test(sf1[0][0].facts) && /^PDF, 3 pages/.test(sf1[0][1].facts) && sf1[1]?.length === 0, show(sf1))
  const c1 = await saved(Q1, (c) => c.messages.length === 2 && c.messages[1].status === 'done')
  const raw1 = H.rawConv(c1.id)
  check('the chat is saved as version 4; its first message carries the three files\' descriptions (ids of the copies, names, what they are)', c1.conv.version === 4 && same(c1.conv.messages[0].attachments.map((a) => a.name), ['holiday.jpg', 'report.pdf', 'notes.md']) && same(c1.conv.messages[0].attachments.map((a) => a.id).sort(), kept) && c1.conv.messages[1].attachments === undefined, show(c1.conv.messages[0]))
  check('...and no picture, no path and nothing of the files themselves is in the chat file', !raw1.includes('data:image') && !raw1.includes(FILES.replaceAll('\\', '\\\\')) && !raw1.includes('First line of my notes') && !raw1.includes('s93-files'))
  await page.screenshot(join(shots, 'v93-sent.png'))

  // ============ 2. a later message: the files are sent again ============
  const Q2 = '[[mock:files]] once more, without files'
  const r2 = await sendNow(Q2)
  check('a later message without files: the first message is sent again with its files, block for block the same', r2 && r2.problems.length === 0 && same(r2.body.messages[0], m1) && r2.body.messages.at(-1).content === Q2, show(r2?.body?.messages?.map((m) => typeof m.content)))
  check('...and the reply says the last message carried none', (await lastReply())?.text.trim() === 'Files: none')

  // ============ 3. a message that is only files ============
  await paste(F('diagram.png'), 'diagram.png', 'image/png')
  await waitChips(1)
  const r3 = await sendNow('')
  const last3 = r3?.body?.messages?.at(-1)
  check('a message of only files (nothing typed) is sent: its content is the image alone, no empty text block', r3 && r3.problems.length === 0 && Array.isArray(last3?.content) && same(last3.content.map((b) => b.type), ['image']) && last3.content[0].source.media_type === 'image/png', show(last3?.content?.map((b) => b.type)))
  const pngId = sha(Buffer.from(last3?.content?.[0]?.source?.data ?? '', 'base64'))
  const sf3 = await shownFiles()
  check('...the message on screen is the file alone (no text), and the copy is kept', sf3.at(-2)?.length === 1 && sf3.at(-2)[0].name === 'diagram.png' && copies().includes(pngId) && (await ev(`[...document.querySelectorAll('.message-user')].at(-1).querySelector('.bubble')?.textContent ?? ''`)) === '', show(sf3.at(-2)))
  const c3 = await saved(Q1, (c) => c.messages.length === 6 && c.messages[5].status === 'done')
  check('...and saved as a message with an empty text and its file', c3.conv.messages[4].content === '' && c3.conv.messages[4].attachments?.[0]?.id === pngId, show(c3.conv.messages[4]))

  // ============ 4. the same chat, to OpenAI ============
  await H.chooseInPage(SOL)
  await H.settle(SOL)
  const Q4 = '[[mock:files]] and to OpenAI'
  const r4 = await sendNow(Q4)
  const in0 = r4?.body?.input?.find((x) => x.role === 'user')
  check('to OpenAI the request is a Responses request the fake API finds nothing wrong with', r4 && r4.url.startsWith('/v1/responses') && r4.problems.length === 0, show(r4?.problems))
  check('the first message is a list of parts in order: the image (a data URL), the PDF (a file with its name), the text file, the words', Array.isArray(in0?.content) && same(in0.content.map((p) => p.type), ['input_image', 'input_file', 'input_text', 'input_text']) && in0.content[0].image_url.startsWith('data:image/jpeg;base64,') && in0.content[1].filename === 'report.pdf' && in0.content[1].file_data.startsWith('data:application/pdf;base64,') && in0.content[3].text === Q1, show(in0?.content?.map((p) => p.type)))
  check('...the image and the PDF are the same bytes as sent to Anthropic, and the text file is led by a line that names it', in0 && sha(Buffer.from(in0.content[0].image_url.split(',')[1], 'base64')) === sha(imgBytes) && sha(Buffer.from(in0.content[1].file_data.split(',')[1], 'base64')) === pdfSha && in0.content[2].text === `The person attached a text file named "notes.md". Its text follows.\n\n${NOTES}`)
  const onlyPng = r4?.body?.input?.filter((x) => x.role === 'user')?.[2]
  check('...and the message of only files is one input_image part', onlyPng && same(onlyPng.content.map((p) => p.type), ['input_image']) && onlyPng.content[0].image_url.startsWith('data:image/png;base64,'), show(onlyPng))
  await H.chooseInPage(OPUS)
  await H.settle(OPUS)

  // ============ 5. a new chat that starts with a file ============
  await H.clickChat('New chat')
  await sleep(300)
  await paste(F('diagram.png'), 'diagram.png', 'image/png')
  await waitChips(1)
  const r5 = await sendNow('')
  check('a new chat whose first message is only a file is sent (the same diagram: the same copy, no second one)', r5 && r5.problems.length === 0 && same(r5.body.messages[0].content.map((b) => b.type), ['image']) && copies().filter((n) => n === pngId).length === 1, show(r5?.problems))
  await H.openHistory()
  let rows = await H.rows()
  check('History lists it titled by the file\'s name ("diagram.png"), beside the first chat', rows.some((r) => r.title === 'diagram.png') && rows.some((r) => r.title.startsWith('[[mock:files]] What are these')), show(rows.map((r) => r.title)))

  // ============ 6. the first chat opened from History ============
  const before6 = H.mtime(c1.id)
  await H.clickRow(rows.find((r) => r.title.startsWith('[[mock:files]] What are these')).title)
  await page.waitFor(`!document.querySelector('dialog.history')?.open`, { timeoutMs: 8000, label: 'History to close' })
  await page.waitFor(`document.querySelectorAll('.message-file img.attachment-thumb').length >= 2`, { timeoutMs: 10000, label: 'the pictures of the files' })
  const sf6 = await shownFiles()
  check('opened from History, the chat shows its files: the photo and the diagram with small pictures main made again from its copies (none was saved)', sf6[0]?.length === 3 && sf6[0][0].thumb === 'data:image/png;base64,iVBORw0K' && sf6[4]?.[0]?.thumb === 'data:image/png;base64,iVBORw0K' && sf6[0][1].icon === 'PDF', show(sf6))
  check('...the text file\'s tooltip holds its first lines again (made by main), not the sixth', sf6[0]?.[2]?.title.includes('First line of my notes') && !sf6[0][2].title.includes('Sixth line'), show(sf6[0]?.[2]))
  await sleep(1500)
  check('...and opening it did not save it again (the pictures are not a change to the chat)', H.mtime(c1.id) === before6)

  // ============ 7. a copy that is gone ============
  const notesId = c1.conv.messages[0].attachments[2].id
  rmSync(join(ATT, notesId))
  await H.clickChat('New chat')
  await sleep(300)
  await H.openHistory()
  await H.clickRow((await H.rows()).find((r) => r.title.startsWith('[[mock:files]] What are these')).title)
  await page.waitFor(`!!document.querySelector('.message-file-missing')`, { timeoutMs: 10000, label: 'the missing file to be shown' })
  const sf7 = await shownFiles()
  check('opened again after its copy was deleted, the text file is shown as "cannot be read any more", the others as before (the view asked main again)', sf7[0]?.[2]?.missing && sf7[0][2].facts === 'cannot be read any more' && !sf7[0][0].missing && sf7[0][0].thumb !== null, show(sf7[0]))
  const before7 = (await reqs()).length
  await ev(`(() => { const t = document.querySelector('.composer-input'); t.focus(); t.select() })()`)
  await page.type('[[mock:files]] after the loss')
  await page.press('Enter')
  await page.waitFor(`(() => { const a = [...document.querySelectorAll('.message-assistant')].at(-1); return !!a?.querySelector('.message-note-error') })()`, { timeoutMs: 10000, label: 'the reply to fail' })
  const rep7 = await lastReply()
  check('sending in that chat sends NOTHING and says why, naming the file', (await reqs()).length === before7 && rep7.note === 'Nothing was sent: the file "notes.md" in this chat is no longer in the app\'s data folder.', show(rep7))
  await H.waitReady()

  // ============ 8. deleting the chat ============
  await H.openHistory()
  const title1 = (await H.rows()).find((r) => r.title.startsWith('[[mock:files]] What are these')).title
  await H.clickRowButton(title1, 'Delete')
  await sleep(200)
  await H.clickRowButton(title1, 'Delete')
  await page.waitFor(`![...document.querySelectorAll('dialog.history .history-title')].some((t) => t.textContent === ${JSON.stringify(title1)})`, { timeoutMs: 8000, label: 'the row to go' })
  await sleep(500)
  check('deleting the first chat deletes the copies only it used (the photo, the PDF); the diagram, which the other chat uses, is kept', same(copies(), [pngId]), show(copies()))
  await H.closeHistory()

  // ============ 9. encryption ============
  await H.clickChat('New chat')
  await sleep(300)
  await H.openHistory()
  await H.clickRow('diagram.png')
  await page.waitFor(`!document.querySelector('dialog.history')?.open`, { timeoutMs: 8000 })
  await queue('save', join(FILES, 'out', 'before-encrypting.jsonl'))
  await W.openSettings()
  const sec9 = await W.section()
  await W.clickSection('Encrypt my saved chats...')
  try {
    await W.waitNote(/Encrypted 1 chat/)
  } catch (error) {
    throw new Error(`${error.message}; the section before the click: ${show(sec9)}; after: ${show(await W.section())}; dialogs asked: ${await main.inMain('JSON.stringify(globalThis.__d.calls.map((c) => c.kind))')}`)
  }
  const note9 = (await W.section()).notes[0] ?? ''
  check('turning encryption on says it encrypted the attached file too ("Encrypted 1 attached file too.")', /Encrypted 1 chat\./.test(note9) && /Encrypted 1 attached file too\./.test(note9), note9)
  await W.closeSettings()
  const sealed = copyBytes(pngId)
  check('the diagram\'s copy is sealed (it starts with the sealed mark; no PNG can be seen in it) and keeps its name (the hash of what it holds)', sealed.subarray(0, SEALED.length).equals(SEALED) && !sealed.includes(Buffer.from('IHDR')) && same(copies(), [pngId]))
  const r9 = await sendNow('[[mock:files]] sealed now')
  const img9 = r9?.body?.messages?.[0]?.content?.[0]
  check('a message in the sealed chat sends the diagram as it was (opened with this PC\'s secure storage: its bytes hash to its name)', r9 && r9.problems.length === 0 && img9?.type === 'image' && sha(Buffer.from(img9.source.data, 'base64')) === pngId, show(r9?.problems))
  await attach(['notes.md'])
  check('a file attached while encryption is on is written sealed at once', copies().includes(notesId) && copyBytes(notesId).subarray(0, SEALED.length).equals(SEALED) && !copyBytes(notesId).includes(Buffer.from('First line')))
  await ev(`[...document.querySelectorAll('.attachment-remove')].find((b) => b.getAttribute('aria-label') === 'Remove notes.md')?.setAttribute('data-click', '1')`)
  await page.click('[data-click="1"]')
  await waitChips(0)
  await sleep(300)
  check('...and taking it off again deletes its copy', !copies().includes(notesId), show(copies()))
  await W.openSettings()
  await queue('box', 0)
  await W.clickSection('Go back to plain files...')
  await W.waitNote(/Rewrote 1 chat as a plain file/)
  const note9b = (await W.section()).notes[0] ?? ''
  check('going back to plain files rewrites the attached file too, and says so', /Rewrote 1 attached file as a plain file too\./.test(note9b), note9b)
  await W.closeSettings()
  check('...the copy is the plain PNG again, byte for byte what its name says', sha(copyBytes(pngId)) === pngId)

  // ============ 10. what the page cannot do through the bridge ============
  const before10 = (await reqs()).length
  const bridge = await ev(`(async () => {
    const run = (request) => new Promise((resolve) => {
      const events = []
      const stop = window.api.chat.onEvent((e) => { if (e.streamId !== request.streamId) return; events.push(e.type === 'error' ? 'error: ' + e.message : e.type); if (e.type === 'error' || e.type === 'done') { stop(); resolve(events) } })
      window.api.chat.start(request)
      setTimeout(() => { stop(); resolve(events.concat('(no end)')) }, 6000)
    })
    const out = {}
    out.notKept = await run({ streamId: 'bridge-0001', messages: [{ role: 'user', content: 'x', attachments: [{ id: '${'e'.repeat(64)}', name: 'x.png' }] }] })
    out.onReply = await run({ streamId: 'bridge-0002', messages: [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b', attachments: [{ id: '${pngId}', name: 'd.png' }] }, { role: 'user', content: 'c' }] })
    out.path = await run({ streamId: 'bridge-0003', messages: [{ role: 'user', content: 'x', attachments: [{ id: 'C:\\\\Windows\\\\win.ini', name: 'win.ini' }] }] })
    out.describeJunk = [await window.api.attachments.describe('x'), await window.api.attachments.describe([1, 2]), await window.api.attachments.describe(['../conversations']), await window.api.attachments.describe(Array.from({ length: 51 }, () => '${pngId}'))]
    out.describeOne = await window.api.attachments.describe(['${pngId}', '${pngId}', '${'e'.repeat(64)}'])
    return out
  })()`)
  check('a request naming a file main does not keep sends nothing and says the file is not in the data folder', bridge.notKept.length >= 1 && bridge.notKept.at(-1) === 'error: Nothing was sent: the file "x.png" in this chat is no longer in the app\'s data folder.', show(bridge.notKept))
  check('a request with files on a reply, or a path for an id, is refused before anything is read', /^error: /.test(bridge.onReply.at(-1)) && /^error: /.test(bridge.path.at(-1)), show({ a: bridge.onReply, b: bridge.path }))
  check('...none of the three reached the provider', (await reqs()).length === before10)
  check('describe() gives nothing for junk (not a list, numbers, a path, 51 ids), and for real ids each once (a picture for the kept one, "missing" for the other)', bridge.describeJunk.every((x) => Array.isArray(x) && x.length === 0) && bridge.describeOne.length === 2 && bridge.describeOne[0].thumbnail?.startsWith('data:image/png;base64,') && typeof bridge.describeOne[1].missing === 'string', show(bridge.describeOne?.map((p) => ({ ...p, thumbnail: p.thumbnail?.slice(0, 30) }))))

  // ============ 11. the layout ============
  for (const [width, height] of [[320, 634], [280, 634]]) {
    await page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })
    await sleep(300)
    const lay = await ev(`(() => { const root = document.documentElement; const files = [...document.querySelectorAll('.message-file')].map((c) => c.getBoundingClientRect()); return { scrollX: root.scrollWidth > root.clientWidth + 1, inside: files.length > 0 && files.every((r) => r.left >= 0 && r.right <= ${width} + 0.5) } })()`)
    check(`at ${width} px: no sideways scroll, and the files on the messages inside the window`, !lay.scrollX && lay.inside, show(lay))
    await page.screenshot(join(shots, `v93-${width}.png`))
  }
  await page.send('Emulation.clearDeviceMetricsOverride')
  await sleep(200)
  const problems = page.problems.filter((p) => !/Autofill|Electron Security Warning|DevTools/.test(p))
  check('no console errors, warnings or CSP violations in the page', problems.length === 0, show(problems))
  W.saveState('w93.json', { pngId, chats: H.convFiles() })
} catch (error) {
  check(`the suite stopped before its end: ${String(error?.stack ?? error).slice(0, 500)}`, false)
}

main.close()
page.close()
process.exit(check.summary() ? 0 : 1)
