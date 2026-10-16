// Slice 16.5 under plain Node (no window): a made picture in the chat (D-048). What it shows:
//   A. the note a chat keeps of a request for pictures (ids into the gallery, never the picture) and the message it rides on, as main checks them;
//   B. the chat file: version 7 for a chat with pictures (and with files, tool calls or a project too), read back exactly; older versions never carry a note;
//      every chat without pictures is written as before;
//   C. a backup carries the note and NOT the pictures (the owner's pick); read back, the note comes back; a picture not in this gallery is said to be missing;
//   D. the page's side as plain functions: the picture message is never told to the model, cannot be edited, and survives a save and a load;
//   E. what the source must keep true.
// Run: node tools/guarded.mjs tools/verify-16-5.mjs      (ONLY=A,C runs some parts)
import './ts-resolve.mjs'
import { checker } from './cdp.mjs'
import { randomBytes } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { REPO, REPO_URL } from './paths.mjs'

const check = checker()
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(',')) : null
const guard = async (name, fn) => { if (ONLY && !ONLY.has(name)) return; try { await fn() } catch (error) { check(`${name} did not run to its end: ${String(error?.stack ?? error).slice(0, 500)}`, false) } }
const show = (v) => JSON.stringify(v)?.slice(0, 500)
const SRC = `${REPO_URL}/src`
const I = await import(`${SRC}/shared/images.ts`)
const V = await import(`${SRC}/shared/validate.ts`)
const CS = await import(`${SRC}/main/conversationStore.ts`)
const B = await import(`${SRC}/main/backup.ts`)
const H = await import(`${SRC}/renderer/src/chat/history.ts`)
const RW = await import(`${SRC}/renderer/src/chat/rewrite.ts`)
const CV = await import(`${SRC}/renderer/src/history/convert.ts`)
const source = (rel) => readFileSync(join(REPO, rel), 'utf8')
const root = mkdtempSync(join(tmpdir(), 'frontier-165-'))
let dirs = 0
const tempDir = () => { const d = join(root, `d${++dirs}`); mkdirSync(d, { recursive: true }); return d }
globalThis.crypto ??= (await import('node:crypto')).webcrypto

const ID1 = 'a'.repeat(32)
const ID2 = 'b'.repeat(32)
const NOTE = { ids: [ID1, ID2], model: 'gpt-image-2', shape: 'portrait', quality: 'high', costUsd: 0.33, estimate: false }
const DESC = 'A red bicycle\n  leaning on a blue wall  '
const PIC = { role: 'user', content: DESC, status: 'done', picture: NOTE }
const FILE = { id: 'c'.repeat(64), name: 'x.png', kind: 'image', mediaType: 'image/png', bytes: 10, width: 1, height: 1, changes: { metadataRemoved: false, shrunkFrom: null, turned: false, convertedFrom: null } }
const CHAT = [{ role: 'user', content: 'hello', status: 'done' }, { role: 'assistant', content: 'hi', status: 'done', provider: 'anthropic', model: 'claude-opus-5-5' }, PIC, { role: 'user', content: 'what do you think?', status: 'done' }]

// ============ A. the note and its message ============
await guard('A', async () => {
  const n = I.checkPictureNote(NOTE)
  check('A: a note as the page sends it is taken, field for field, frozen', n !== null && show(n) === show(NOTE) && Object.isFrozen(n) && Object.isFrozen(n.ids))
  const wrong = {
    'a field more (the picture itself)': { ...NOTE, data: 'iVBORw0KGgo=' }, 'a field more (an address)': { ...NOTE, url: 'https://x' }, 'a field less': (() => { const { estimate, ...r } = NOTE; return r })(),
    'no ids': { ...NOTE, ids: [] }, 'five ids': { ...NOTE, ids: ['1', '2', '3', '4', '5'].map((c) => c.repeat(32)) }, 'an id used twice': { ...NOTE, ids: [ID1, ID1] }, 'an id that is a path': { ...NOTE, ids: ['..\\images.json'] },
    'an id in capitals': { ...NOTE, ids: ['A'.repeat(32)] }, 'ids as text': { ...NOTE, ids: ID1 }, 'a model id that is not one': { ...NOTE, model: 'GPT Image' }, 'a shape not known': { ...NOTE, shape: 'banner' },
    'a quality not known': { ...NOTE, quality: 'max' }, 'a negative cost': { ...NOTE, costUsd: -1 }, 'a cost above $100': { ...NOTE, costUsd: 101 }, 'a cost as text': { ...NOTE, costUsd: '0.3' }, 'estimate as text': { ...NOTE, estimate: 'no' }
  }
  let all = true
  for (const [what, note] of Object.entries(wrong)) if (I.checkPictureNote(note) !== null) { all = false; check(`A: refused: ${what}`, false) }
  check(`A: each of ${Object.keys(wrong).length} wrong notes is refused`, all)
  const ok = V.checkSavedMessages(CHAT)
  check('A: a chat with a picture message is taken from the page; the message keeps its description exactly and its note', ok.ok && ok.messages[2].content === DESC && show(ok.messages[2].picture) === show(NOTE) && ok.messages[2].role === 'user')
  const refusedOn = {
    'a reply': { ...PIC, role: 'assistant', provider: 'openai', model: 'gpt-6' },
    'a message with files': { ...PIC, attachments: [FILE] },
    'a message that was stopped': { ...PIC, status: 'stopped' },
    'a message with no description': { ...PIC, content: '   ' },
    'a description longer than 4,000 characters': { ...PIC, content: 'x'.repeat(4001) },
    'a description with a reversing mark': { ...PIC, content: 'a cat \u202e' }
  }
  for (const [what, message] of Object.entries(refusedOn)) {
    const out = V.checkSavedMessages([{ role: 'user', content: 'hello', status: 'done' }, message])
    if (out.ok) check(`A: a note on ${what} is refused`, false, show(out.messages[1]))
  }
  check(`A: a note is refused on each of ${Object.keys(refusedOn).length} wrong messages (a reply, files, stopped, blank, too long, hiding marks)`, Object.values(refusedOn).every((m) => !V.checkSavedMessages([{ role: 'user', content: 'hello', status: 'done' }, m]).ok))
  check('A: (the file description of that test is one the checker takes on an ordinary message)', V.checkSavedMessages([{ role: 'user', content: 'x', status: 'done', attachments: [FILE] }]).ok)
  const first = V.checkSavedMessages([PIC])
  check('A: a chat may begin with a request for pictures (it is the person\'s message)', first.ok)
  const fromOldFile = V.checkSavedMessages(CHAT, 'file', true, true, false)
  check('A: from a file that knows no pictures, the note is not read (the message is kept as text, the note dropped)', fromOldFile.ok && fromOldFile.messages[2].picture === undefined && fromOldFile.messages[2].content === DESC)
})

// ============ B. the chat file ============
await guard('B', async () => {
  check('B: a chat with a picture message is version 7', CS.fileVersion({ messages: V.checkSavedMessages(CHAT).messages }) === 7)
  check('B: one with pictures and a project, or tool calls, is still version 7', CS.fileVersion({ messages: V.checkSavedMessages(CHAT).messages, project: 'p'.repeat(8) }) === 7)
  check('B: without pictures nothing changes (3, 4, 5, 6 as before)', CS.fileVersion({ messages: [{ role: 'user', content: 'x', status: 'done' }] }) === 3 && CS.fileVersion({ messages: [{ role: 'user', content: 'x', status: 'done' }], project: 'p' }) === 5)
  const dir = tempDir()
  const store = CS.createConversationStore(dir)
  const id = crypto.randomUUID()
  const saved = await store.save({ id, messages: V.checkSavedMessages(CHAT).messages, instructions: '' })
  const text = readFileSync(join(dir, `${id}.json`), 'utf8')
  const file = JSON.parse(text)
  check('B: saved as version 7, with the note on the message and no picture in the file', saved.ok !== false && file.version === 7 && show(file.messages[2].picture) === show(NOTE) && !/iVBOR|b64|base64|data:image/.test(text), show(file.version))
  check('B: the title is the first message of the person\'s ("hello"), as before', file.title === 'hello')
  const loaded = await store.load(id)
  check('B: read back exactly (the description with its spaces and line break, the note)', loaded.ok && loaded.conversation.messages[2].content === DESC && show(loaded.conversation.messages[2].picture) === show(NOTE), show(loaded.ok ? loaded.conversation.messages[2] : loaded))
  const parse = (f) => CS.parseSavedFile(f, f.id)
  const base = { ...file }
  check('B: a version 7 file with no picture message is refused ("says it holds pictures and holds none")', /holds pictures and holds none/.test(parse({ ...base, messages: base.messages.map(({ picture, ...m }) => m) })))
  check('B: a version 6 file whose message says it has a picture: the note is not read (6 knows none), and the file says it has tool calls and has none', typeof parse({ ...base, version: 6 }) === 'string')
  const v3 = parse({ ...base, version: 3 })
  check('B: a version 3 file with a "picture" on a message: read, and the note is dropped (only 7 carries one)', typeof v3 !== 'string' && v3.messages[2].picture === undefined && v3.messages[2].content === DESC)
  check('B: a version 7 file in a project is read with its project', (() => { const r = parse({ ...base, project: '12345678-1234-4123-8123-123456789abc' }); return typeof r !== 'string' && r.project === '12345678-1234-4123-8123-123456789abc' })())
  check('B: a version 7 file whose project is not one is refused', typeof parse({ ...base, project: '../x' }) === 'string')
  check('B: a version 7 file whose note has a field more is refused', typeof parse({ ...base, messages: base.messages.map((m) => (m.picture ? { ...m, picture: { ...m.picture, bytes: 'iVBORw0KGgo=' } } : m)) }) === 'string')
  check('B: version 8 is "another version"', /another version/.test(parse({ ...base, version: 8 })))
  // a chat without pictures is written byte for byte as before
  const id2 = crypto.randomUUID()
  await store.save({ id: id2, messages: V.checkSavedMessages([{ role: 'user', content: 'plain', status: 'done' }]).messages, instructions: '' })
  const plain = JSON.parse(readFileSync(join(dir, `${id2}.json`), 'utf8'))
  check('B: a chat without pictures is still version 3, with no picture field anywhere', plain.version === 3 && !JSON.stringify(plain).includes('picture'))
})

// ============ C. a backup ============
await guard('C', async () => {
  const dir = tempDir()
  const store = CS.createConversationStore(join(dir, 'conversations'))
  const id = crypto.randomUUID()
  await store.save({ id, messages: V.checkSavedMessages(CHAT).messages, instructions: '' })
  const dest = join(dir, 'backup.jsonl')
  const written = await B.writeBackup(dest, { ids: [id], load: async (x) => { const r = await store.load(x); return r.ok ? r.conversation : null }, leftOut: 0, readFile: async () => null }, Date.now())
  const text = readFileSync(dest, 'utf8')
  check('C: the backup is written (version 1: no attached files)', written.ok && JSON.parse(text.split('\n')[0]).version === 1, show(written))
  check('C: it carries the note (the ids, the description) and NOT the pictures (no PNG, no base64 of one, no data: address)', text.includes(ID1) && text.includes('A red bicycle') && !/iVBOR|data:image|b64_json/.test(text))
  const back = []
  const read = await B.readBackup(dest, (chat) => { back.push(chat) })
  check('C: read back, the chat comes back with its picture message and note', read.complete && back.length === 1 && show(back[0].messages[2].picture) === show(NOTE) && back[0].messages[2].content === DESC, show(read.problem))
  const svc = await import(`${SRC}/main/imageStore.ts`)
  const idx = await import(`${SRC}/main/imageIndex.ts`)
  const other = tempDir()
  const index = idx.createImageIndexFile({ pathOf: () => join(other, 'images.json'), writeMode: async () => ({ form: 'plain' }) })
  const gallery = svc.createImageStore({ dir: join(other, 'images'), index, images: { thumbnail: () => null }, writeMode: async () => ({ form: 'plain' }) })
  const missing = await gallery.read(ID1)
  check('C: on a computer whose gallery does not hold the picture, it is "no longer in the gallery" (a restore never brings pictures)', !missing.ok && /no longer in the gallery/.test(missing.error))
  check('C: no code of backing up or restoring names the gallery or a picture', !/imageStore|imageIndex|images\.json|picture/i.test(source('src/main/backup.ts') + source('src/main/backupService.ts')))
})

// ============ D. the page's side ============
await guard('D', async () => {
  const msgs = CHAT.map((m) => ({ ...m, id: crypto.randomUUID() }))
  const wire = H.toWireMessages(msgs)
  check('D: the picture message is NEVER told to the model (the wire has hello, hi, and the next question)', show(wire.map((w) => w.content)) === show(['hello', 'hi', 'what do you think?']) && !JSON.stringify(wire).includes('bicycle'), show(wire))
  const onlyPic = H.toWireMessages([{ ...PIC, id: 'x' }, { role: 'user', content: 'and now?', status: 'done', id: 'y' }])
  check('D: a chat that began with pictures tells the model only the person\'s next message', onlyPic.length === 1 && onlyPic[0].content === 'and now?')
  check('D: a picture message cannot be edited and sent again', RW.withEditedMessage(msgs, msgs[2].id, 'a blue bicycle') === null && RW.laterMessages(msgs, msgs[2].id) === null)
  check('D: an ordinary message of the person\'s still can', RW.withEditedMessage(msgs, msgs[3].id, 'changed') !== null)
  check('D: Regenerate after a picture message has nothing to replace', RW.withoutLastReply(msgs.slice(0, 3)) === null)
  const toSave = CV.toMessagesToSave(msgs)
  check('D: what the page saves carries the note on the person\'s message', show(toSave[2].picture) === show(NOTE) && toSave[2].role === 'user' && toSave[2].content === DESC)
  const checked = V.checkSavedMessages(toSave)
  const shownAgain = CV.fromSavedMessages(checked.messages)
  check('D: saved and loaded again it is the same picture message', checked.ok && show(shownAgain[2].picture) === show(NOTE) && shownAgain[2].content === DESC)
})

// ============ E. the source ============
await guard('E', async () => {
  const pm = source('src/renderer/src/images/PictureMessage.tsx')
  check('E: the picture message asks main for each picture by its id, and nothing else (no fetch, no path, no address)', /window\.api\.images\s*\.picture\(id\)/.test(pm) && !/fetch\(|file:|https?:|localStorage|createObjectURL/.test(pm))
  check('E: "Use in chat" asks main to make it an attachment (useInChat), and is off when the model cannot read pictures', /useInChat\(id\)/.test(source('src/renderer/src/chat/ChatView.tsx')) && /canAttachPictures=\{chosen\?\.imageInput === true\}/.test(source('src/renderer/src/chat/ChatView.tsx')) && /disabled=\{!canAttach\}/.test(pm))
  check('E: the description is shown as text (no Markdown, no HTML)', !/Markdown|dangerouslySetInnerHTML/.test(pm))
  check('E: Edit is not offered on a picture message', /canEdit = message\.role === 'user' && message\.picture === undefined/.test(source('src/renderer/src/chat/MessageActions.tsx')))
  check('E: the wire filter is the first step of toWireMessages', /\.filter\(\(message\) => message\.picture === undefined\)/.test(source('src/renderer/src/chat/history.ts')))
  check("E: the page's policy is unchanged (img-src 'self' data:)", /img-src 'self' data:"/.test(source('src/renderer/index.html')))
})

const ok = check.summary()
process.exit(ok ? 0 : 1)
