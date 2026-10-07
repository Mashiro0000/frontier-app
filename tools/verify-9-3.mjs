// Slice 9.3 under plain Node (no window): sending and saving files (D-037).
//  A. what the page may send and save: files named on a request ({ id, name }), a file's description on a saved message, the caps of a message and a chat,
//     a message that is only files.
//  B. the chat file: version 4 only for a chat with files (a chat without any is written byte for byte as before), read back, the title of a chat that
//     starts with files, which files the chats use (and when that is not known), a damaged version 4 file.
//  C. the files of a request (attachmentRequest.ts): read from the store and checked; a message without files is exactly { role, content }; a copy that is
//     missing, damaged or cannot be opened; a model that cannot read a kind of file; the caps of one request; a file named twice is counted twice.
//  D. both adapters through the mock: the provider's own form, in order (files, then the text); a message that is only files; joined turns keep their files;
//     what the mock (my reading of each provider's documentation) refuses; and the golden: every request without files byte for byte what it was before 9.3.
//  E. the registry at schema 0.5 (documentInput), and what the page is told about a model.
//  F. encryption (chatEncryptionService) rewrites the attached files with the chats, and says so only when there are any.
//  G. what the source must keep true.
//  H. the page's side, as plain functions: what it tells main about a conversation, what it saves and reads back, and why Send waits.
// Run: node tools/verify-9-3.mjs
import { checker } from './cdp.mjs'
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { REPO_URL, TOOLS } from './paths.mjs'
import { startMock } from './mock-providers.mjs'
import { SRC, storeMod, standInTools, fixture, makeGif, makePdf, jpegSized, sha256, same, source, LIMITS } from './lib9.mjs'
import { makeBox } from './lib8b3.mjs'

const check = checker()
const guard = async (name, fn) => { try { await fn() } catch (error) { check(`${name} did not run to its end: ${String(error?.stack ?? error).slice(0, 300)}`, false) } }
const show = (v) => JSON.stringify(v)?.slice(0, 260)
const validate = await import(`${SRC}/shared/validate.ts`)
const conv = await import(`${SRC}/main/conversationStore.ts`)
const req = await import(`${SRC}/main/attachmentRequest.ts`)
const { adapterFor } = await import(`${SRC}/main/providers/index.ts`)
const { buildStreamRequest, mergeAdjacent } = await import(`${SRC}/main/providers/request.ts`)
const { parseRegistry, toModelOption, REGISTRY_SCHEMA_VERSION } = await import(`${SRC}/shared/registry.ts`)
const enc = await import(`${SRC}/main/chatEncryptionService.ts`)
const reg = parseRegistry(JSON.parse(readFileSync(join(TOOLS, 'registry-good.json'), 'utf8')))
const opus = reg.registry.models.find((m) => m.id === 'claude-opus-5-5')
const sol = reg.registry.models.find((m) => m.id === 'gpt-6.1-sol')
const blind = (m, flags) => ({ ...m, label: `${m.label} (blind)`, capabilities: { ...m.capabilities, ...flags } })
const base = join(tmpdir(), `frontier-v93-${randomUUID()}`)
mkdirSync(base, { recursive: true })
const id = (n) => n.toString(16).padStart(64, '0')
const msg = (role, content, extra = {}) => ({ role, content, status: 'done', ...extra })

// A real store with a photo, a PDF and a text, kept the way 9.1 keeps them.
const store = storeMod.createAttachmentStore(join(base, 'attachments'), { images: standInTools() })
const kept = {}
for (const [name, bytes] of [['photo.jpg', fixture('q.jpg')], ['report.pdf', fixture('three-pages.pdf')], ['main.ts', Buffer.from('export const a = 1\n', 'utf8')], ['anim-free.gif', makeGif()]]) {
  const r = await store.add({ bytes, name })
  if (!r.ok) throw new Error(`could not keep ${name}: ${r.error}`)
  kept[name] = r.file.info
}
const info = (name) => kept[name]

await guard('A', async () => {
  const ok = validate.checkWireAttachments([{ id: info('photo.jpg').id, name: 'C:\\Users\\me\\photo.jpg' }])
  check('A: a file on a request is { id, name }: the name comes back cleaned (no folder)', same(ok, [{ id: info('photo.jpg').id, name: 'photo.jpg' }]), show(ok))
  const badWire = [null, 'x', [{ id: 'nope', name: 'a' }], [{ id: info('photo.jpg').id }], [{ id: info('photo.jpg').id, name: 5 }], [{ id: info('photo.jpg').id, name: 'a' }, { id: info('photo.jpg').id, name: 'b' }], Array.from({ length: 11 }, (_, i) => ({ id: id(i + 1), name: 'f' })), [{ id: info('photo.jpg').id, name: 'n'.repeat(1001) }]]
  check('A: refused: not a list, a bad id, no name, a name that is not text, the same file twice on a message, eleven files on a message, a name over 1,000 characters', badWire.every((x) => validate.checkWireAttachments(x) === null))
  const request = (messages) => validate.checkChatRequest({ streamId: 'stream-1234', messages })
  const onlyFiles = request([{ role: 'user', content: '', attachments: [{ id: info('photo.jpg').id, name: 'photo.jpg' }] }])
  check('A: a message of the person\'s may be only files (no text)', onlyFiles.ok && same(onlyFiles.request.messages, [{ role: 'user', content: '', attachments: [{ id: info('photo.jpg').id, name: 'photo.jpg' }] }]), show(onlyFiles))
  check('A: an empty message with no files is still refused, and so is an empty list of files with no text', !request([{ role: 'user', content: '' }]).ok && !request([{ role: 'user', content: '', attachments: [] }]).ok)
  const plain = request([{ role: 'user', content: 'hi', attachments: [] }])
  check('A: an empty list of files is the same as none: the clean request has no attachments field', plain.ok && same(plain.request.messages, [{ role: 'user', content: 'hi' }]))
  check('A: files on a reply are refused (only the person\'s messages carry files)', !request([{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b', attachments: [{ id: info('photo.jpg').id, name: 'x' }] }, { role: 'user', content: 'c' }]).ok)
  const fiftyOne = []
  for (let m = 0; m < 6; m++) fiftyOne.push({ role: 'user', content: `m${m}`, attachments: Array.from({ length: m === 5 ? 1 : 10 }, (_, k) => ({ id: id(m * 10 + k + 1), name: 'f' })) }, { role: 'assistant', content: 'ok' })
  fiftyOne.pop()
  const over = request(fiftyOne)
  check('A: a conversation that names 51 different files is refused ("more than 50 files"); 50 pass', !over.ok && /more than 50 files/.test(over.error) && request(fiftyOne.slice(0, -2).concat([{ role: 'user', content: 'end' }])).ok, show(over))
  // descriptions on saved messages
  check('A: what 9.1 says about a photo, a PDF and a text passes checkAttachmentInfo unchanged', ['photo.jpg', 'report.pdf', 'main.ts', 'anim-free.gif'].every((n) => same(validate.checkAttachmentInfo(info(n)), info(n))), show(info('photo.jpg')))
  const p = info('photo.jpg')
  const broken = [['an extra field', { ...p, path: 'C:\\x' }], ['no id', { ...p, id: undefined }], ['a name with a folder', { ...p, name: 'a\\b.jpg' }], ['an empty name', { ...p, name: '' }], ['a kind that does not match the type', { ...p, kind: 'pdf' }], ['an unknown type', { ...p, mediaType: 'image/bmp' }], ['no width', { ...p, width: undefined }], ['a width over 8,000', { ...p, width: 8001 }], ['bytes as text', { ...p, bytes: '501' }], ['changes missing', { ...p, changes: undefined }], ['a shrunk size that is not one', { ...p, changes: { ...p.changes, shrunkFrom: { width: 0, height: 5 } } }], ['converted from an unknown type', { ...p, changes: { ...p.changes, convertedFrom: 'image/tiff' } }], ['a PDF with no pages', { ...info('report.pdf'), pages: 0 }], ['a PDF with 101 pages', { ...info('report.pdf'), pages: 101 }], ['a text with no lines', { ...info('main.ts'), lines: undefined }], ['a list', [p]]]
  const passed = broken.filter(([, x]) => validate.checkAttachmentInfo(x) !== null).map(([n]) => n)
  check('A: a description is refused for each of sixteen faults (an extra field, a folder in the name, a kind that does not match, sizes, notes, ...)', passed.length === 0, passed.join(', '))
  const saved = validate.checkSavedMessages([{ role: 'user', content: '', status: 'done', attachments: [p] }, { role: 'assistant', content: 'seen', status: 'done', provider: 'anthropic', model: 'claude-opus-5-5' }])
  check('A: a saved conversation from the page may start with a message that is only files; the description is kept', saved.ok && same(saved.messages[0].attachments, [p]))
  check('A: files on a reply, an empty list, the same file twice on a message: each refuses the save', !validate.checkSavedMessages([msg('user', 'a'), { ...msg('assistant', 'b'), provider: 'anthropic', model: null, attachments: [p] }]).ok && !validate.checkSavedMessages([{ ...msg('user', 'a'), attachments: [] }]).ok && !validate.checkSavedMessages([{ ...msg('user', 'a'), attachments: [p, p] }]).ok)
  const old = validate.checkSavedMessages([{ ...msg('user', 'a'), attachments: [p] }], 'file', false)
  check('A: an older file\'s messages are read WITHOUT files (a field a version 3 build never wrote is not read)', old.ok && old.messages[0].attachments === undefined)
})

await guard('B', async () => {
  const dir = join(base, 'conversations')
  const s = conv.createConversationStore(dir)
  const noFiles = { id: randomUUID(), messages: [msg('user', 'plain chat'), { ...msg('assistant', 'answer'), provider: 'anthropic', model: 'claude-opus-5-5' }], instructions: '' }
  await s.save(noFiles)
  const text0 = readFileSync(join(dir, `${noFiles.id}.json`), 'utf8')
  const parsed0 = JSON.parse(text0)
  check('B: a chat without files is written as version 3, exactly the text the code before 9.3 wrote (version, id, title, dates, instructions, messages; no attachments field)', parsed0.version === 3 && text0 === JSON.stringify({ version: 3, id: noFiles.id, title: 'plain chat', createdAt: parsed0.createdAt, updatedAt: parsed0.updatedAt, instructions: '', messages: [{ role: 'user', content: 'plain chat', status: 'done' }, { role: 'assistant', content: 'answer', status: 'done', provider: 'anthropic', model: 'claude-opus-5-5' }] }) && !text0.includes('attachments'))
  const withFiles = { id: randomUUID(), messages: [{ ...msg('user', ''), attachments: [info('photo.jpg'), info('report.pdf')] }, { ...msg('assistant', 'nice'), provider: 'anthropic', model: 'claude-opus-5-5' }, { ...msg('user', 'and this'), attachments: [info('main.ts')] }], instructions: '' }
  const r = await s.save(withFiles)
  const parsed = JSON.parse(readFileSync(join(dir, `${withFiles.id}.json`), 'utf8'))
  check('B: a chat with files is written as version 4, each message with its files\' descriptions', r.ok && parsed.version === 4 && same(parsed.messages[0].attachments, [info('photo.jpg'), info('report.pdf')]) && same(parsed.messages[2].attachments, [info('main.ts')]))
  check('B: a chat that starts with a message of only files is titled by their names', r.ok && r.summary.title === 'photo.jpg, report.pdf', r.summary?.title)
  const back = await s.load(withFiles.id)
  check('B: it reads back with every description', back.ok && same(back.conversation.messages[0].attachments, [info('photo.jpg'), info('report.pdf')]) && back.conversation.messages[1].attachments === undefined)
  const refs = await s.attachmentRefs()
  check('B: attachmentRefs: the files every chat uses, and "complete" while every chat could be read', refs.complete && same([...refs.ids].sort(), [info('photo.jpg').id, info('report.pdf').id, info('main.ts').id].sort()))
  check('B: attachmentsOf: one chat\'s files; [] for a chat without any', same((await s.attachmentsOf(withFiles.id)).sort(), [info('photo.jpg').id, info('report.pdf').id, info('main.ts').id].sort()) && same(await s.attachmentsOf(noFiles.id), []))
  // a damaged chat makes the list incomplete
  const damaged = randomUUID()
  writeFileSync(join(dir, `${damaged}.json`), '{"version":4,"id":"' + damaged + '"')
  const s2 = conv.createConversationStore(dir)
  const refs2 = await s2.attachmentRefs()
  check('B: with a chat that cannot be read, the list is NOT complete (its files are not known)', refs2.complete === false && refs2.ids.size === 3)
  // version 4 files that are not right
  const v4 = (messages) => JSON.stringify({ version: 4, id: damaged, title: 't', createdAt: 1, updatedAt: 2, instructions: '', messages })
  const bad4 = [
    ['no files at all', v4([msg('user', 'x')])],
    ['a description with an extra field', v4([{ ...msg('user', 'x'), attachments: [{ ...info('photo.jpg'), secret: 1 }] }])],
    ['files on a reply', v4([{ ...msg('user', 'x'), attachments: [info('photo.jpg')] }, { ...msg('assistant', 'y'), provider: 'anthropic', model: null, attachments: [info('main.ts')] }])],
    ['no instructions field', JSON.stringify({ version: 4, id: damaged, title: 't', createdAt: 1, updatedAt: 2, messages: [{ ...msg('user', 'x'), attachments: [info('photo.jpg')] }] })]
  ]
  const readable = []
  for (const [name, text] of bad4) {
    writeFileSync(join(dir, `${damaged}.json`), text)
    const fresh = conv.createConversationStore(dir)
    const list = await fresh.list()
    if (list.conversations.some((c) => c.id === damaged)) readable.push(name)
  }
  check('B: a version 4 file is unreadable (left alone, counted) when it holds no file, a bad description, files on a reply, or no instructions', readable.length === 0, readable.join(', '))
  writeFileSync(join(dir, `${damaged}.json`), JSON.stringify({ version: 3, id: damaged, title: 't', createdAt: 1, updatedAt: 2, instructions: '', messages: [{ ...msg('user', 'x'), attachments: [info('photo.jpg')] }] }))
  const v3 = conv.createConversationStore(dir)
  const v3load = await v3.load(damaged)
  check('B: a version 3 file with an attachments field is read without it (only version 4 carries files)', v3load.ok && v3load.conversation.messages[0].attachments === undefined)
  check('B: version 5 is left alone (another version of the app)', (() => { writeFileSync(join(dir, `${damaged}.json`), v4([{ ...msg('user', 'x'), attachments: [info('photo.jpg')] }]).replace('"version":4', '"version":5')); return true })() && !(await conv.createConversationStore(dir).list()).conversations.some((c) => c.id === damaged))
  // A backup (D-034) holds each chat as its own file holds it: a chat with files as version 4, with its files' descriptions (the files themselves come in 9.5).
  const backup = await import(`${SRC}/main/backup.ts`)
  const dest = join(base, 'backup-93.jsonl')
  const wrote = await backup.writeBackup(dest, { ids: [noFiles.id, withFiles.id], leftOut: 0, load: async (cid) => { const l = await s.load(cid); return l.ok ? l.conversation : null } }, 1_700_000_000_000)
  const got = []
  const read = await backup.readBackup(dest, (chat) => { got.push(chat) })
  const lines = readFileSync(dest, 'utf8').split('\n').filter((l) => l !== '').map((l) => JSON.parse(l))
  check('B: a backup of a chat with files and one without is written and checked; the chat with files is a version 4 line, the other version 3 as before', wrote.ok && wrote.count === 2 && lines[1].chat.version === 3 && lines[2].chat.version === 4, show(wrote))
  check('B: ...and reads back whole, the files\' descriptions with it', read.complete && got.length === 2 && same(got.find((c) => c.id === withFiles.id)?.messages[0].attachments, [info('photo.jpg'), info('report.pdf')]), show(read))
})

await guard('C', async () => {
  const read = (fileId) => store.read(fileId)
  const wire = [{ role: 'user', content: 'look', attachments: [{ id: info('photo.jpg').id, name: 'photo.jpg' }, { id: info('report.pdf').id, name: 'Annual report' }, { id: info('main.ts').id, name: 'main.ts' }] }, { role: 'assistant', content: 'seen' }, { role: 'user', content: 'again' }]
  const r = await req.resolveAttachments(wire, opus, read)
  check('C: the files of a request are read and come out in the neutral form: an image as base64 of its bytes, a PDF (its name made to end in .pdf), a text as its text', r.ok && same(r.messages[0].attachments.map((a) => a.kind), ['image', 'pdf', 'text']) && Buffer.from(r.messages[0].attachments[0].data, 'base64').equals(fixture('q.jpg')) && r.messages[0].attachments[1].name === 'Annual report.pdf' && r.messages[0].attachments[2].text === 'export const a = 1\n', show(r.ok ? r.messages[0].attachments.map((a) => ({ ...a, data: a.data?.length })) : r))
  check('C: a message without files is exactly { role, content } (no attachments field at all)', r.ok && same(Object.keys(r.messages[1]), ['role', 'content']) && same(Object.keys(r.messages[2]), ['role', 'content']))
  check('C: what the files come to: one image (64 x 32), one PDF of 3 pages, a text of 19 characters, the bytes of all three', r.ok && same(r.files.images, [{ width: 64, height: 32 }]) && r.files.pdfs === 1 && r.files.pdfPages === 3 && r.files.textChars === 19 && r.files.bytes === fixture('q.jpg').length + fixture('three-pages.pdf').length + 19)
  const twice = await req.resolveAttachments([{ role: 'user', content: 'a', attachments: [{ id: info('photo.jpg').id, name: 'p' }] }, { role: 'assistant', content: 'b' }, { role: 'user', content: 'c', attachments: [{ id: info('photo.jpg').id, name: 'p' }] }], opus, read)
  check('C: a file on two messages is sent twice and counted twice', twice.ok && twice.files.images.length === 2 && twice.files.bytes === 2 * fixture('q.jpg').length)
  const missing = await req.resolveAttachments([{ role: 'user', content: 'x', attachments: [{ id: id(77), name: 'gone.png' }] }], opus, read)
  check('C: a copy that is not there: "Nothing was sent: the file "gone.png" in this chat is no longer in the app\'s data folder."', !missing.ok && missing.error === 'Nothing was sent: the file "gone.png" in this chat is no longer in the app\'s data folder.', show(missing))
  const damaged = await req.resolveAttachments([{ role: 'user', content: 'x', attachments: [{ id: info('main.ts').id, name: 'main.ts' }] }], opus, async () => ({ ok: false, why: 'damaged', error: 'x' }))
  const unopened = await req.resolveAttachments([{ role: 'user', content: 'x', attachments: [{ id: info('main.ts').id, name: 'main.ts' }] }], opus, async () => ({ ok: false, why: 'unopened', error: 'x' }))
  check('C: a damaged copy, and one that cannot be opened with this computer\'s key, each say so and send nothing', !damaged.ok && /is damaged in the app's data folder/.test(damaged.error) && !unopened.ok && /cannot be opened with the key this computer has/.test(unopened.error))
  const noImages = await req.resolveAttachments(wire, blind(opus, { imageInput: false }), read)
  const noPdf = await req.resolveAttachments(wire, blind(opus, { documentInput: false }), read)
  check('C: a model that cannot read images, or PDFs, is not sent them: the sentence names the model and the file', !noImages.ok && noImages.error === 'Nothing was sent: Claude Opus 5.5 (blind) cannot read images, and this chat has one ("photo.jpg"). Choose a model that can.' && !noPdf.ok && /cannot read PDFs, and this chat has one \("Annual report"\)/.test(noPdf.error), show([noImages, noPdf]))
  const textOnly = await req.resolveAttachments([{ role: 'user', content: 'x', attachments: [{ id: info('main.ts').id, name: 'main.ts' }] }], blind(opus, { imageInput: false, documentInput: false }), read)
  check('C: a text file goes to any model (it is text)', textOnly.ok)
  // the caps of one request, with stand-in copies of the sizes that matter
  const fake = (facts, bytes) => async () => ({ ok: true, bytes: Buffer.alloc(bytes, 1), facts, form: 'plain' })
  const files = (n) => Array.from({ length: n }, (_, i) => ({ id: id(i + 1), name: `f${i}` }))
  const big = await req.resolveAttachments([{ role: 'user', content: 'x', attachments: files(5) }], opus, fake({ kind: 'image', mediaType: 'image/png', width: 10, height: 10 }, 4.5 * 1024 * 1024))
  check('C: files over 20 MB in one request are refused, saying how much and why (each file is sent again with every message)', !big.ok && /come to 22\.5 MB, and one request may carry at most 20\.0 MB/.test(big.error) && /sent again with each message/.test(big.error), show(big))
  const atCap = await req.resolveAttachments([{ role: 'user', content: 'x', attachments: files(4) }], opus, fake({ kind: 'image', mediaType: 'image/png', width: 10, height: 10 }, 5 * 1024 * 1024))
  check('C: exactly 20 MB passes', atCap.ok)
  const pages = await req.resolveAttachments([{ role: 'user', content: 'x', attachments: files(2) }], opus, fake({ kind: 'pdf', mediaType: 'application/pdf', pages: 51 }, 1000))
  check('C: PDFs of 102 pages in one request are refused; 100 pass', !pages.ok && /102 pages, and one request may carry at most 100/.test(pages.error) && (await req.resolveAttachments([{ role: 'user', content: 'x', attachments: files(2) }], opus, fake({ kind: 'pdf', mediaType: 'application/pdf', pages: 50 }, 1000))).ok)
  const texts = await req.resolveAttachments([{ role: 'user', content: 'x', attachments: files(4) }], opus, fake({ kind: 'text', mediaType: 'text/plain', text: 'a', chars: 150_001, lines: 1 }, 10))
  check('C: text files of more than 600,000 characters in one request are refused', !texts.ok && /600,004 characters, and one request may carry at most 600,000/.test(texts.error), show(texts))
  check('C: pdfName adds ".pdf" only when the name does not end in it (any case)', req.pdfName('a') === 'a.pdf' && req.pdfName('A.PDF') === 'A.PDF' && req.pdfName('x.pdf.txt') === 'x.pdf.txt.pdf')
  // joined turns
  const merged = mergeAdjacent([{ role: 'user', content: 'one', attachments: [{ kind: 'text', name: 'a', text: 'A' }] }, { role: 'user', content: '', attachments: [{ kind: 'text', name: 'b', text: 'B' }] }, { role: 'user', content: 'three' }])
  check('C: joining the person\'s messages keeps every file in order, and a message of only files adds no blank lines', merged.length === 1 && merged[0].content === 'one\n\nthree' && same(merged[0].attachments.map((a) => a.name), ['a', 'b']))
  check('C: joining messages without files is what it always was ("a\\n\\nb", no attachments field)', same(mergeAdjacent([{ role: 'user', content: 'a' }, { role: 'user', content: 'b' }]), [{ role: 'user', content: 'a\n\nb' }]))
})

await guard('D', async () => {
  const PORT = 8898
  const mock = await startMock(PORT)
  const origin = `http://127.0.0.1:${PORT}`
  const creds = { apiKey: 'test-v93-key-0123456789abcdef0123456789', baseURL: origin }
  const reset = () => fetch(`${origin}/__reset`, { method: 'POST' })
  const last = async () => (await (await fetch(`${origin}/__requests`)).json()).filter((r) => !r.listing).at(-1)
  const run = async (model, messages) => {
    const request = buildStreamRequest({ credentials: creds, model, messages, signal: new AbortController().signal })
    let text = ''
    let error = null
    try { for await (const e of adapterFor(model.provider).stream(request)) if (e.type === 'text') text += e.text } catch (e) { error = e }
    return { text, error, sent: await last() }
  }
  const read = (fileId) => store.read(fileId)
  const wire = [{ role: 'user', content: '[[mock:files]] what are these?', attachments: [{ id: info('photo.jpg').id, name: 'photo.jpg' }, { id: info('report.pdf').id, name: 'report.pdf' }, { id: info('main.ts').id, name: 'main.ts' }] }]
  const resolved = await req.resolveAttachments(wire, opus, read)
  await reset()
  const a = await run(opus, resolved.messages)
  const blocks = a.sent.body.messages[0].content
  check('D: Anthropic: the files come first, in order (an image block, a base64 PDF document titled with its name, a text document titled with its name), then the text', same(blocks.map((b) => `${b.type}:${b.source?.type ?? ''}`), ['image:base64', 'document:base64', 'document:text', 'text:']) && blocks[0].source.media_type === 'image/jpeg' && blocks[1].title === 'report.pdf' && blocks[1].source.media_type === 'application/pdf' && blocks[2].title === 'main.ts' && blocks[2].source.data === 'export const a = 1\n' && blocks[3].text === '[[mock:files]] what are these?', show(blocks.map((b) => ({ ...b, source: b.source ? { ...b.source, data: b.source.data.length } : undefined }))))
  check('D: Anthropic: the mock accepts it (no problem found), and its reply lists what arrived', a.error === null && a.sent.problems.length === 0 && a.text === `Files: image image/jpeg 64x32 ${fixture('q.jpg').length} bytes | pdf "report.pdf" ${fixture('three-pages.pdf').length} bytes | text "main.ts" 19 chars | words 30 chars`, `${a.text} ${show(a.sent.problems)} ${a.error}`)
  await reset()
  const o = await run(sol, resolved.messages)
  const parts = o.sent.body.input[0].content
  check('D: OpenAI: an input_image (a data URL, detail auto), an input_file (a data URL of the PDF and its file name), the text file as input_text led by a line naming it, then the text', same(parts.map((p) => p.type), ['input_image', 'input_file', 'input_text', 'input_text']) && parts[0].image_url.startsWith('data:image/jpeg;base64,') && parts[0].detail === 'auto' && parts[1].filename === 'report.pdf' && parts[1].file_data.startsWith('data:application/pdf;base64,JVBERi0') && parts[2].text === 'The person attached a text file named "main.ts". Its text follows.\n\nexport const a = 1\n' && parts[3].text === '[[mock:files]] what are these?', show(parts.map((p) => ({ ...p, image_url: p.image_url?.slice(0, 30), file_data: p.file_data?.slice(0, 40) }))))
  check('D: OpenAI: the mock accepts it, and its reply lists what arrived', o.error === null && o.sent.problems.length === 0 && o.text.startsWith(`Files: image image/jpeg 64x32 ${fixture('q.jpg').length} bytes | pdf "report.pdf"`), `${o.text} ${show(o.sent.problems)}`)
  // only files, no text
  const only = await req.resolveAttachments([{ role: 'user', content: '', attachments: [{ id: info('anim-free.gif').id, name: 'g.gif' }] }], opus, read)
  await reset()
  const ao = await run(opus, only.messages)
  await reset()
  const oo = await run(sol, only.messages)
  check('D: a message that is only a file: no text block at all (Anthropic: one image block; OpenAI: one input_image), and both mocks accept it', same(ao.sent.body.messages[0].content.map((b) => b.type), ['image']) && ao.sent.problems.length === 0 && same(oo.sent.body.input[0].content.map((p) => p.type), ['input_image']) && oo.sent.problems.length === 0, show([ao.sent.problems, oo.sent.problems]))
  // the mock refuses what the documentation refuses (so that its "accepted" means something)
  await reset()
  const lie = [{ role: 'user', content: 'x', attachments: [{ kind: 'image', mediaType: 'image/png', data: fixture('q.jpg').toString('base64') }] }]
  const al = await run(opus, lie)
  await reset()
  const ol = await run(sol, lie)
  check('D: the mocks refuse an image whose type does not match its bytes (as both providers document)', al.error !== null && /does not match the provided media type/.test(al.sent.problems.join()) && ol.error !== null && /Invalid image data/.test(ol.sent.problems.join()), show([al.sent.problems, ol.sent.problems]))
  await reset()
  const huge = [{ role: 'user', content: 'x', attachments: [{ kind: 'image', mediaType: 'image/jpeg', data: jpegSized(9000, 10).toString('base64') }] }]
  const ah = await run(opus, huge)
  check('D: the Anthropic mock refuses an image over 8,000 px a side', ah.error !== null && /exceed max allowed size: 8000/.test(ah.sent.problems.join()), show(ah.sent.problems))
  await reset()
  const many = [{ role: 'user', content: 'x', attachments: Array.from({ length: 21 }, (_, i) => ({ kind: 'image', mediaType: 'image/jpeg', data: jpegSized(i === 0 ? 2001 : 100, 50).toString('base64') })) }]
  const am = await run(opus, many)
  check('D: the Anthropic mock refuses 21 images when one is over 2,000 px ("many-image requests"), which is why the app sends none over 2,000', am.error !== null && /many-image requests: 2000 pixels/.test(am.sent.problems.join()), show(am.sent.problems))
  await mock.close?.()
  // the golden: every request without files, byte for byte what it was before 9.3
  const out = join(base, 'golden-now.json')
  const cap = spawnSync(process.execPath, [join(TOOLS, 'capture-golden-9.mjs'), out], { encoding: 'utf8', timeout: 300000, env: { ...process.env, NODE_NO_WARNINGS: '1' } })
  const cmp = spawnSync(process.execPath, [join(TOOLS, 'capture-golden-9.mjs'), '--compare', join(TOOLS, 'golden-9.json'), out], { encoding: 'utf8' })
  check('D: the golden: all 70 requests without files (seven models, five shapes, with and without instructions) are byte for byte what they were before 9.3 (tools/golden-9.json)', cap.status === 0 && cmp.status === 0 && /70 requests compared, 0 differ/.test(cmp.stdout), `${cap.stdout.trim()} ${cmp.stdout.trim()}`)
})

await guard('E', async () => {
  const live = parseRegistry(JSON.parse(readFileSync(new URL('../registry/models.json', import.meta.url), 'utf8')))
  check('E: the registry is schema 0.5, and every model says whether it reads PDFs (documentInput); all six do (the providers\' pages, read on 6 October 2026)', REGISTRY_SCHEMA_VERSION === '0.5' && live.ok && live.problems.length === 0 && live.registry.models.length === 6 && live.registry.models.every((m) => m.capabilities.documentInput === true && m.capabilities.imageInput === true))
  const without = JSON.parse(readFileSync(new URL('../registry/models.json', import.meta.url), 'utf8'))
  delete without.models[0].capabilities.documentInput
  const r = parseRegistry(without)
  check('E: an entry without documentInput is left out, and the problem names the field', r.ok && r.registry.models.length === 5 && r.problems.some((p) => /documentInput/.test(p)), show(r.problems))
  check('E: the page is told whether the chosen model reads images and PDFs (and still nothing about how it is called)', same(Object.keys(toModelOption(opus)).sort(), ['contextWindow', 'description', 'documentInput', 'id', 'imageInput', 'label', 'pricing', 'provider']))
  const told = toModelOption(blind(opus, { imageInput: false, documentInput: false }))
  check('E: ...as the registry says it: a model that reads neither is told as false and false, one that reads both as true and true', told.imageInput === false && told.documentInput === false && toModelOption(opus).imageInput === true && toModelOption(opus).documentInput === true, show(told))
})

await guard('F', async () => {
  const box = makeBox()
  let choice = 'off'
  const calls = []
  const chats = { counts: async () => ({ plain: 2, encrypted: 0, unreadable: 0, unopened: 0 }), conform: async () => { calls.push('chats'); return { changed: 2, already: 0, failed: 0 } } }
  const protection = { state: async () => ({ choice, canEncrypt: true, keyUsable: choice === 'on' ? true : null, blocked: null }), turnOn: async () => { choice = 'on' }, turnOff: async () => { choice = 'off' } }
  const backups = { backUpAllBeforeEncrypting: async () => ({ ok: true, count: 2, leftOut: 0, where: 'C:\\b.jsonl' }), exclusive: (busy, task) => task() }
  const filesStore = { counts: async () => ({ plain: 3, encrypted: 0 }), conform: async () => { calls.push('files'); return { changed: 3, already: 0, failed: 0 } } }
  const svc = enc.createChatEncryptionService({ store: chats, protection, backups, asks: { confirmPlain: async () => true }, files: filesStore })
  const on = await svc.encrypt({})
  check('F: turning encryption on rewrites the chats, then the attached files, and the report says how many files', on.ok && same(calls, ['chats', 'files']) && same(on.report.files, { changed: 3, failed: 0 }), show(on))
  const none = enc.createChatEncryptionService({ store: chats, protection: { ...protection, state: async () => ({ choice: 'off', canEncrypt: true, keyUsable: null, blocked: null }) }, backups, asks: { confirmPlain: async () => true }, files: { counts: async () => ({ plain: 0, encrypted: 0 }), conform: async () => { throw new Error('not called') } } })
  const noneOn = await none.encrypt({})
  check('F: with no attached files at all, the report has no files field (its shape is what it was before 9.3)', noneOn.ok && !('files' in noneOn.report), show(noneOn.report))
  const { describeEncrypted, describePlain } = await import(`${SRC}/renderer/src/settings/useChatStorage.ts`)
  const said = describeEncrypted({ changed: 2, already: 0, failed: 0, backup: null, files: { changed: 3, failed: 1 } })
  check('F: the notice says "Encrypted 3 attached files too." and names the one that could not be rewritten; without files it is word for word what it was', /Encrypted 3 attached files too\. 1 attached file could not be rewritten and is as before\./.test(said) && describeEncrypted({ changed: 2, already: 0, failed: 0, backup: null }) === 'Encrypted 2 chats. Chats you save from now on are encrypted too.', said)
  const plainSaid = describePlain({ changed: 1, already: 0, failed: 0, backup: null, files: { changed: 1, failed: 0 } }, { choice: 'off', canEncrypt: true, keyUsable: null, plain: 1, encrypted: 0, unreadable: 0, unopened: 0, blocked: null })
  const plainTwo = describePlain({ changed: 1, already: 0, failed: 0, backup: null, files: { changed: 2, failed: 0 } }, { choice: 'off', canEncrypt: true, keyUsable: null, plain: 1, encrypted: 0, unreadable: 0, unopened: 0, blocked: null })
  check('F: going back to plain says "Rewrote 1 attached file as a plain file too." ("2 attached files as plain files" for two)', /Rewrote 1 attached file as a plain file too\./.test(plainSaid) && /Rewrote 2 attached files as plain files too\./.test(plainTwo), `${plainSaid} / ${plainTwo}`)
  // the shortcut: everything already sealed, chats AND files
  choice = 'on'
  const sealedChats = { ...chats, counts: async () => ({ plain: 0, encrypted: 2, unreadable: 0, unopened: 0 }) }
  const svc2 = enc.createChatEncryptionService({ store: sealedChats, protection, backups, asks: { confirmPlain: async () => true }, files: { counts: async () => ({ plain: 1, encrypted: 2 }), conform: async () => { calls.push('files2'); return { changed: 1, already: 2, failed: 0 } } } })
  const finish = await svc2.encrypt({})
  check('F: "Encrypt the rest" with every chat sealed but a file still plain rewrites the file (it is not "nothing to do")', finish.ok && calls.includes('files2') && finish.report.files?.changed === 1, show(finish))
  void box
})

await guard('G', async () => {
  const chat = source('main/chat.ts')
  const ipc = source('main/ipc.ts')
  const at = (s, a) => s.indexOf(a)
  check('G: the reply reads and checks the files before the request is built, and sends nothing when that fails', at(chat, 'resolveAttachments(request.messages') > 0 && at(chat, 'resolveAttachments(request.messages') < at(chat, 'buildStreamRequest({') && /if \(!resolved\.ok\) \{\s*send\(\{ streamId, type: 'error', message: resolved\.error \}\)\s*return/.test(chat) && /messages: resolved\.messages/.test(chat))
  check('G: deleting a chat deletes its files only if every chat could be read, and only those no other chat uses', /const files = await history\.attachmentsOf\(check\.id\)/.test(ipc) && /if \(refs\.complete\) await attachments\.deleteUnused\(files, refs\.ids\)/.test(ipc))
  check('G: at start the unused copies are swept only if every chat could be read, and only those over an hour old', /refs\.complete \? attachments\.sweep\(refs\.ids, 3_600_000\) : undefined/.test(ipc))
  check('G: once a chat is saved, the files it names are let go of (the chat keeps them now), so deleting the chat can delete them', /const saved = await history\.save\(check\.conversation\)[\s\S]{0,400}?if \(saved\.ok\) \{\s*for \(const message of check\.conversation\.messages\) \{\s*for \(const file of message\.attachments \?\? \[\]\) attachments\.release\(file\.id\)/.test(ipc))
  check('G: a discarded file is deleted only when the chats\' files are known (null otherwise)', /return refs\.complete \? refs\.ids : null/.test(ipc))
  check('G: the encryption service is given the attachments, and the describe handler is behind the sender check', /asks: systemAskers,\s*files: attachments/.test(ipc) && /CHANNELS\.attachmentsDescribe,\s*guarded\(/.test(ipc))
  check('G: neither adapter sends a field it does not mean to: a message without files is built as { role, content }', /if \(message\.attachments === undefined\) return \{ role: message\.role, content: message\.content \}/.test(source('main/providers/anthropic.ts')) && /if \(message\.attachments === undefined\) return \{ role: message\.role, content: message\.content \}/.test(source('main/providers/openai.ts')))
})

await guard('H', async () => {
  const { toWireMessages } = await import(`${SRC}/renderer/src/chat/history.ts`)
  const { toMessagesToSave, fromSavedMessages } = await import(`${SRC}/renderer/src/history/convert.ts`)
  const { chatFiles, filesBlock } = await import(`${SRC}/renderer/src/chat/attachmentText.ts`)
  const attached = (name) => ({ info: info(name), thumbnail: 'data:image/png;base64,AAAA', firstLines: null })
  const page = [
    { id: 'a', role: 'user', content: '', status: 'done', files: [attached('photo.jpg'), attached('report.pdf')] },
    { id: 'b', role: 'assistant', content: 'seen', status: 'done', provider: 'anthropic', model: 'claude-opus-5-5' },
    { id: 'c', role: 'user', content: 'and this', status: 'done', files: [attached('main.ts')] },
    { id: 'd', role: 'assistant', content: '', status: 'error', error: 'x', provider: 'anthropic', model: 'claude-opus-5-5' },
    { id: 'e', role: 'user', content: 'plain', status: 'done' },
    { id: 'f', role: 'user', content: 'empty list', status: 'done', files: [] }
  ]
  const wire = toWireMessages(page)
  check('H: toWireMessages: a message of only files is told (its files by id and name, no picture, no description); an empty reply is left out; a message without files is exactly { role, content }; an empty list of files is none', same(wire, [
    { role: 'user', content: '', attachments: [{ id: info('photo.jpg').id, name: 'photo.jpg' }, { id: info('report.pdf').id, name: 'report.pdf' }] },
    { role: 'assistant', content: 'seen' },
    { role: 'user', content: 'and this', attachments: [{ id: info('main.ts').id, name: 'main.ts' }] },
    { role: 'user', content: 'plain' },
    { role: 'user', content: 'empty list' }
  ]), show(wire))
  const toSave = toMessagesToSave(page)
  check('H: toMessagesToSave: the person\'s messages keep their files\' descriptions (not the small pictures); replies and messages without files have no attachments field', same(toSave[0].attachments, [info('photo.jpg'), info('report.pdf')]) && !JSON.stringify(toSave).includes('data:image') && toSave[1].attachments === undefined && !('attachments' in toSave[4]) && !('attachments' in toSave[5]), show(toSave))
  const back = fromSavedMessages(toSave)
  check('H: fromSavedMessages: the files come back with their descriptions and no picture yet (main makes it again), each message with a fresh id', same(back[0].files, [{ info: info('photo.jpg'), thumbnail: null, firstLines: null }, { info: info('report.pdf'), thumbnail: null, firstLines: null }]) && back[1].files === undefined && back[4].files === undefined && new Set(back.map((m) => m.id)).size === back.length, show(back[0]))
  const all = chatFiles(page, [attached('main.ts'), attached('anim-free.gif')])
  check('H: chatFiles: every file the next message would send, each once (main.ts on an earlier message and on the draft counts once)', same(all.map((f) => f.info.name), ['photo.jpg', 'report.pdf', 'main.ts', 'anim-free.gif']))
  const model = (imageInput, documentInput) => ({ label: 'Model X', imageInput, documentInput })
  check('H: filesBlock: nothing in the way when the model reads images and PDFs', filesBlock(page, [], model(true, true)) === null)
  check('H: filesBlock: a model that cannot read images is named, even when the image is on an EARLIER message (it is sent again)', filesBlock(page, [], model(false, true)) === 'Model X cannot read images, and this chat has one. Choose a model that can.')
  check('H: filesBlock: a model that cannot read PDFs is named', filesBlock(page, [], model(true, false)) === 'Model X cannot read PDFs, and this chat has one. Choose a model that can.')
  check('H: filesBlock: a chat of text files only goes to a model that reads neither images nor PDFs (text is read by every model)', filesBlock([page[2]], [], model(false, false)) === null)
  const fifty = Array.from({ length: 50 }, (_, k) => ({ info: { ...info('main.ts'), id: id(k + 100) }, thumbnail: null, firstLines: null }))
  check('H: filesBlock: 50 files in a chat pass; a 51st on the draft is refused ("at most 50 files"), even with no model known', filesBlock([], fifty, model(true, true)) === null && filesBlock([], [...fifty, attached('main.ts')], null) === 'A chat can hold at most 50 files. Start a new chat for more.')
  check('H: filesBlock: with no model known (no list of models yet) only the cap is checked', filesBlock(page, [], null) === null)
})

process.exit(check.summary() ? 0 : 1)
