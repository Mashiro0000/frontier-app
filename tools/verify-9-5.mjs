// Slice 9.5 under plain Node (no window): backups that hold the attached files (D-037, the owner's answer 5). The file (backup.ts): version 1 is written, byte
// for byte as before, when no chat in it has files; version 2 when one does, with one line per file after the chats (its id and its PLAIN bytes, even when
// the copy is sealed) and the trailer counting them; a copy that cannot be read is left out and counted; every line is read back before the backup counts.
// Reading: a file line is checked (its id, base64, its size, its bytes hashing to its id) and a bad one is set aside without touching the chats; version 1
// files still read; a file line in a version 1 file is not a file. The store's `adopt` (a copy put back: the hash, a file the app would keep, the folder's
// caps, the form encryption asks for). The service: what a backup and a restore say about files, and that a restore puts back only the files of chats it
// has (added, copied or already here), each once.
// Run: node tools/verify-9-5.mjs
import './temp-on-a.mjs'
import { checker } from './cdp.mjs'
import { promises as fsp, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SRC, storeMod as attachMod, standInTools, fixture, makePdf } from './lib9.mjs'
import { backup, service, createConversationStore, fakePickers, makeChat, msg, NOW, same, sourceOf } from './lib8b.mjs'
import { makeBox } from './lib8b3.mjs'

const check = checker()
const guard = async (name, fn) => { try { await fn() } catch (error) { check(`${name} did not run to its end: ${String(error?.stack ?? error).slice(0, 300)}`, false) } }
const show = (v) => JSON.stringify(v)?.slice(0, 260)
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex')
// A program's first bytes: not an image, a PDF or text (it holds a NUL), so not a file the app keeps.
const JUNK = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00])
const lines = (path) => readFileSync(path, 'utf8').split('\n').filter((l) => l !== '').map((l) => JSON.parse(l))
const base = join(tmpdir(), `frontier-v95-${randomUUID()}`)
mkdirSync(base, { recursive: true })
const owner = { window: 1 }

// A store of files and a store of chats that use them.
const att = attachMod.createAttachmentStore(join(base, 'attachments'), { images: standInTools() })
const kept = {}
for (const [name, bytes] of [['photo.jpg', fixture('q.jpg')], ['report.pdf', makePdf(3)], ['notes.txt', Buffer.from('my notes\n', 'utf8')]]) {
  const r = await att.add({ bytes, name })
  if (!r.ok) throw new Error(`could not keep ${name}: ${r.error}`)
  kept[name] = r.file.info
}
const files = { read: async (id) => { const r = await att.read(id); return r.ok ? r.bytes : null }, adopt: (id, bytes) => att.adopt(id, bytes) }
const chats = createConversationStore(join(base, 'conversations'))
const plainChat = makeChat(1)
const filesChat = { ...makeChat(2), messages: [{ ...msg('user', ''), attachments: [kept['photo.jpg'], kept['report.pdf']] }, { ...msg('assistant', 'seen'), provider: 'anthropic', model: 'claude-opus-5-5' }, { ...msg('user', 'and this'), attachments: [kept['notes.txt'], kept['photo.jpg']] }] }
for (const c of [plainChat, filesChat]) { const r = await chats.save(c); if (!r.ok) throw new Error(`could not save: ${r.error}`) }
const load = async (id) => { const r = await chats.load(id); return r.ok ? r.conversation : null }

await guard('A', async () => {
  const v1 = join(base, 'no-files.jsonl')
  const w1 = await backup.writeBackup(v1, { ...sourceOf(chats, [plainChat.id]), readFile: files.read }, NOW)
  const l1 = lines(v1)
  check('A: a backup of chats without files is version 1, as before: header, one chat line, the old trailer; no file line, no file counts', w1.ok && l1[0].version === 1 && l1.length === 3 && same(Object.keys(l1[2]), ['end', 'count', 'leftOut']) && w1.files === undefined, show({ w1, keys: Object.keys(l1[2]) }))
  const v2 = join(base, 'with-files.jsonl')
  const w2 = await backup.writeBackup(v2, { ...sourceOf(chats, [plainChat.id, filesChat.id]), readFile: files.read }, NOW)
  const l2 = lines(v2)
  const fileLines = l2.filter((l) => typeof l.file === 'string')
  check('A: with a chat that has files: version 2; the two chats, then one line per file (three: the photo named twice is written once), then the trailer counting them', w2.ok && l2[0].version === 2 && l2[1].n === 1 && l2[2].n === 2 && fileLines.length === 3 && l2.indexOf(fileLines[0]) === 3 && same(l2.at(-1), { end: true, count: 2, leftOut: 0, files: 3, filesLeftOut: 0 }) && same(w2.files, { count: 3, leftOut: 0 }), show({ w2, last: l2.at(-1) }))
  check('A: a file line is exactly its id and its bytes in base64, and the bytes hash to the id', fileLines.every((l) => same(Object.keys(l), ['file', 'data']) && sha(Buffer.from(l.data, 'base64')) === l.file) && same(fileLines.map((l) => l.file).sort(), [kept['photo.jpg'].id, kept['report.pdf'].id, kept['notes.txt'].id].sort()))
  const got = []
  const gotFiles = []
  const read = await backup.readBackup(v2, (chat) => { got.push(chat.id) }, (id, bytes) => { gotFiles.push([id, sha(bytes)]) })
  check('A: it reads back whole: two chats, three files, each handed over with its bytes', read.complete && read.problem === null && got.length === 2 && gotFiles.length === 3 && gotFiles.every(([id, h]) => id === h) && same(read.files, { seen: 3, good: 3, refusedCount: 0, refused: [] }), show(read))
  // a copy that cannot be read when the backup is made
  const gone = { ...makeChat(3), messages: [{ ...msg('user', 'x'), attachments: [{ ...kept['notes.txt'], id: 'a'.repeat(64), name: 'gone.txt' }] }] }
  await chats.save(gone)
  const v3 = join(base, 'one-gone.jsonl')
  const w3 = await backup.writeBackup(v3, { ...sourceOf(chats, [gone.id]), readFile: files.read }, NOW)
  check('A: a file whose copy cannot be read is left out and counted ("filesLeftOut"); the chat is still in, and the backup still counts', w3.ok && w3.count === 1 && same(w3.files, { count: 0, leftOut: 1 }) && same(lines(v3).at(-1), { end: true, count: 1, leftOut: 0, files: 0, filesLeftOut: 1 }), show(w3))
  await chats.remove(gone.id)
  // sealed copies go into the backup as their plain bytes
  const box = makeBox()
  const sealedAtt = attachMod.createAttachmentStore(join(base, 'sealed'), { images: standInTools(), box, writeMode: async () => ({ form: 'encrypted' }) })
  const s = await sealedAtt.add({ bytes: fixture('q.jpg'), name: 'photo.jpg' })
  const v4 = join(base, 'sealed.jsonl')
  const w4 = await backup.writeBackup(v4, { ...sourceOf(chats, [filesChat.id]), readFile: async (id) => { const r = await sealedAtt.read(id); return r.ok ? r.bytes : null } }, NOW)
  const photoLine = lines(v4).find((l) => l.file === s.file.info.id)
  check('A: a sealed copy is written as its PLAIN bytes (a backup is a plain file, D-035), the bytes its id names', w4.ok && photoLine && sha(Buffer.from(photoLine.data, 'base64')) === s.file.info.id && !photoLine.data.startsWith(Buffer.from('FRONTIER-SEALED').toString('base64').slice(0, 12)), show(w4))
})

await guard('B', async () => {
  const good = join(base, 'with-files.jsonl')
  const text = readFileSync(good, 'utf8').split('\n')
  const at = text.findIndex((l) => l.startsWith('{"file":'))
  const variant = async (name, change) => {
    const path = join(base, `${name}.jsonl`)
    const copy = [...text]
    change(copy)
    writeFileSync(path, copy.join('\n'))
    const handed = []
    const chatsSeen = []
    const read = await backup.readBackup(path, (chat) => { chatsSeen.push(chat.id) }, (id) => { handed.push(id) })
    return { read, handed, chatsSeen }
  }
  const lineOf = (i) => JSON.parse(text[i])
  const damaged = await variant('file-byte', (c) => { const l = lineOf(at); const b = Buffer.from(l.data, 'base64'); b[b.length - 1] ^= 1; c[at] = JSON.stringify({ file: l.file, data: b.toString('base64') }) })
  check('B: a file line whose bytes do not hash to its id is set aside (counted, with why); the chats and the other files are read as before', damaged.read.files.refusedCount === 1 && damaged.handed.length === 2 && damaged.chatsSeen.length === 2 && damaged.read.refusedCount === 0 && /does not match/.test(damaged.read.files.refused[0]?.why ?? ''), show(damaged.read.files))
  const badId = await variant('file-id', (c) => { const l = lineOf(at); c[at] = JSON.stringify({ file: 'C:\\x', data: l.data }) })
  const notB64 = await variant('file-b64', (c) => { const l = lineOf(at); c[at] = JSON.stringify({ file: l.file, data: '!!' + l.data }) })
  const extra = await variant('file-extra', (c) => { const l = lineOf(at); c[at] = JSON.stringify({ ...l, path: 'C:\\x' }) })
  const notFile = await variant('file-junk', (c) => { c[at] = JSON.stringify({ file: sha(JUNK), data: JUNK.toString('base64') }) })
  check('B: also set aside: an id that is not one, data that is not base64, a line with a field more, and bytes that hash to the id but are no file the app keeps', [badId, notB64, extra].every((v) => v.read.files.refusedCount === 1 && v.handed.length === 2) && notFile.read.files.refusedCount === 1 && notFile.read.files.refused[0]?.why === 'it is not a file the app keeps', show([badId, notB64, extra, notFile].map((v) => v.read.files)))
  const v1 = text.map((l, i) => (i === 0 ? l.replace('"version":2', '"version":1') : l))
  writeFileSync(join(base, 'v1-with-file-lines.jsonl'), v1.join('\n'))
  const handed1 = []
  const read1 = await backup.readBackup(join(base, 'v1-with-file-lines.jsonl'), () => undefined, (id) => { handed1.push(id) })
  check('B: in a version 1 file a file line is not a file: nothing is handed over, and the line is counted as one that cannot be used', handed1.length === 0 && read1.files === undefined && read1.refusedCount >= 3, show(read1))
  const cut = await variant('no-trailer-files', (c) => { const i = c.findIndex((l) => l.startsWith('{"end":')); c[i] = JSON.stringify({ end: true, count: 2, leftOut: 0 }) })
  check('B: a version 2 trailer without its file counts is not understood (the file is not whole)', !cut.read.complete, show(cut.read.trailer))
  const fewer = await variant('missing-file-line', (c) => { c.splice(at, 1) })
  check('B: a version 2 file with a file line missing is not whole (the trailer counts three)', !fewer.read.complete && fewer.handed.length === 2, show(fewer.read))
  const old = await variant('v4', (c) => { c[0] = c[0].replace('"version":2', '"version":4') })
  check('B: version 4 is another version of the app: not read (3 holds projects and notes since 10.7)', old.read.problem === 'That backup was made by another version of the app, and this one cannot read it.')
})

await guard('C', async () => {
  const fresh = attachMod.createAttachmentStore(join(base, 'fresh'), { images: standInTools() })
  const stripped = (await att.read(kept['photo.jpg'].id)).bytes
  check('C: adopt puts back a copy whose bytes hash to its id, and reads it back', (await fresh.adopt(kept['photo.jpg'].id, stripped)) === 'added' && (await fresh.read(kept['photo.jpg'].id)).ok)
  check('C: ...a second time it is "already" (nothing written)', (await fresh.adopt(kept['photo.jpg'].id, stripped)) === 'already')
  check('C: refused: bytes that do not hash to the id, an id that is not one, bytes that hash but are no file the app keeps, bytes over the largest copy', (await fresh.adopt(kept['report.pdf'].id, stripped)) === 'refused' && (await fresh.adopt('x', stripped)) === 'refused' && (await fresh.adopt(sha(JUNK), JUNK)) === 'refused' && (await fresh.adopt(sha(Buffer.alloc(11 * 1024 * 1024)), Buffer.alloc(11 * 1024 * 1024))) === 'refused')
  const full = attachMod.createAttachmentStore(join(base, 'full'), { images: standInTools(), folderCaps: { files: 1, bytes: 10_000_000 } })
  await full.adopt(kept['photo.jpg'].id, stripped)
  const pdf = (await att.read(kept['report.pdf'].id)).bytes
  check('C: the folder\'s caps hold: a full folder answers "full", and nothing is deleted to make room', (await full.adopt(kept['report.pdf'].id, pdf)) === 'full' && (await full.read(kept['photo.jpg'].id)).ok)
  const refusedWrites = attachMod.createAttachmentStore(join(base, 'blocked'), { images: standInTools(), writeMode: async () => ({ refused: 'The key cannot be used.' }) })
  // Nothing at all: not even the folder is made (a write that is begun and then fails its read-back still leaves nothing, but it must not begin).
  check('C: while writing is refused (a lost key, D-035) nothing is written, not even the folder: "failed"', (await refusedWrites.adopt(kept['report.pdf'].id, pdf)) === 'failed' && !existsSync(join(base, 'blocked')))
  const box = makeBox()
  const sealed = attachMod.createAttachmentStore(join(base, 'sealed-adopt'), { images: standInTools(), box, writeMode: async () => ({ form: 'encrypted' }) })
  await sealed.adopt(kept['report.pdf'].id, pdf)
  const onDisk = readFileSync(join(base, 'sealed-adopt', kept['report.pdf'].id))
  check('C: with encryption on, a copy put back is written sealed, and opens to the same bytes', onDisk.subarray(0, 29).toString('latin1') === 'FRONTIER-SEALED-ATTACHMENT-1\n' && (await sealed.read(kept['report.pdf'].id)).bytes.equals(pdf))
})

await guard('D', async () => {
  const fake = fakePickers()
  const svc = service.createBackupService({ store: chats, dataDir: join(base, 'data'), pickers: fake.pickers, now: () => NOW, files })
  const dest = join(base, 'docs', 'all.jsonl')
  await fsp.mkdir(join(base, 'docs'), { recursive: true })
  fake.answers.save.push(dest)
  const exported = await svc.exportChats({ scope: 'all' }, owner)
  check('D: "Back up all chats" with a chat that has files: ok, two chats, and the files counted (three, none left out)', exported.ok && exported.count === 2 && same(exported.files, { count: 3, leftOut: 0 }), show(exported))
  fake.answers.save.push(join(base, 'docs', 'one.jsonl'))
  const one = await svc.exportChats({ scope: 'one', id: plainChat.id }, owner)
  check('D: a backup of one chat without files says nothing about files (version 1)', one.ok && one.files === undefined && lines(join(base, 'docs', 'one.jsonl'))[0].version === 1, show(one))
  // restore into an empty profile
  const att2 = attachMod.createAttachmentStore(join(base, 'p2', 'attachments'), { images: standInTools() })
  const chats2 = createConversationStore(join(base, 'p2', 'conversations'))
  const files2 = { read: async (id) => { const r = await att2.read(id); return r.ok ? r.bytes : null }, adopt: (id, bytes) => att2.adopt(id, bytes) }
  const svc2 = service.createBackupService({ store: chats2, dataDir: join(base, 'p2'), pickers: fake.pickers, now: () => NOW, files: files2 })
  fake.answers.open.push(dest)
  const look = await svc2.restoreLook(owner)
  check('D: the look before a restore says how many files the backup holds (three), how many are not here yet (three) and that none is unusable', look.ok && same(look.preview.files, { count: 3, missing: 3, refused: 0 }), show(look.ok ? look.preview : look))
  const applied = await svc2.restoreApply(look.preview.token)
  check('D: restoring adds the two chats and puts back the three files', applied.ok && applied.added === 2 && same(applied.files, { added: 3, already: 0, noRoom: 0, failed: 0, refused: 0 }), show(applied))
  check('D: ...each copy in the new folder, named by its hash, reading back as the file it was', (await Promise.all(Object.values(kept).map(async (k) => (await att2.read(k.id)).ok))).every(Boolean))
  fake.answers.open.push(dest)
  const again = await svc2.restoreLook(owner)
  check('D: looked at again, the files are all here (none missing)', again.ok && same(again.preview.files, { count: 3, missing: 0, refused: 0 }), show(again.ok ? again.preview.files : again))
  const applied2 = await svc2.restoreApply(again.preview.token)
  check('D: restoring the same backup again: the chats are already here, and the files "already" (nothing written twice)', applied2.ok && applied2.same === 2 && same(applied2.files, { added: 0, already: 3, noRoom: 0, failed: 0, refused: 0 }), show(applied2))
  // a file line that no chat in the backup names is not put back
  const extraPath = join(base, 'docs', 'extra-file.jsonl')
  const text = readFileSync(dest, 'utf8').split('\n')
  const endAt = text.findIndex((l) => l.startsWith('{"end":'))
  const stray = Buffer.from('a text no chat names\n', 'utf8')
  text.splice(endAt, 1, JSON.stringify({ file: sha(stray), data: stray.toString('base64') }), JSON.stringify({ end: true, count: 2, leftOut: 0, files: 4, filesLeftOut: 0 }))
  writeFileSync(extraPath, text.join('\n'))
  const att3 = attachMod.createAttachmentStore(join(base, 'p3', 'attachments'), { images: standInTools() })
  const svc3 = service.createBackupService({ store: createConversationStore(join(base, 'p3', 'conversations')), dataDir: join(base, 'p3'), pickers: fake.pickers, now: () => NOW, files: { read: async () => null, adopt: (id, bytes) => att3.adopt(id, bytes) } })
  fake.answers.open.push(extraPath)
  const look3 = await svc3.restoreLook(owner)
  const applied3 = await svc3.restoreApply(look3.preview.token)
  check('D: a file that no chat in the backup names is not counted as one to put back, and is not put back (counted as not usable)', look3.ok && same(look3.preview.files, { count: 3, missing: 3, refused: 1 }) && applied3.ok && applied3.files.added === 3 && applied3.files.refused === 1 && !(await att3.read(sha(stray))).ok, show(applied3))
  // the chat is here, its copies are lost: a restore puts them back
  for (const k of Object.values(kept)) await fsp.rm(join(base, 'p2', 'attachments', k.id), { force: true })
  const svc2b = service.createBackupService({ store: chats2, dataDir: join(base, 'p2'), pickers: fake.pickers, now: () => NOW, files: { read: files2.read, adopt: (id, bytes) => attachMod.createAttachmentStore(join(base, 'p2', 'attachments'), { images: standInTools() }).adopt(id, bytes) } })
  fake.answers.open.push(dest)
  const lost = await svc2b.restoreLook(owner)
  const putBack = await svc2b.restoreApply(lost.preview.token)
  check('D: with the chats here and their copies lost, the look counts nothing to add but three files missing, and the restore puts them back', lost.ok && lost.preview.fresh === 0 && lost.preview.same === 2 && same(lost.preview.files, { count: 3, missing: 3, refused: 0 }) && putBack.ok && putBack.added === 0 && putBack.files.added === 3, show({ lost: lost.ok && lost.preview.files, putBack }))
  // a version 1 backup restores as before
  const svc4 = service.createBackupService({ store: createConversationStore(join(base, 'p4', 'conversations')), dataDir: join(base, 'p4'), pickers: fake.pickers, now: () => NOW, files: files2 })
  fake.answers.open.push(join(base, 'docs', 'one.jsonl'))
  const look4 = await svc4.restoreLook(owner)
  const applied4 = await svc4.restoreApply(look4.preview.token)
  check('D: a version 1 backup still restores, and neither the look nor the result says anything about files', look4.ok && look4.preview.files === undefined && applied4.ok && applied4.added === 1 && applied4.files === undefined, show(applied4))
})

await guard('E', async () => {
  const { describeExport, describeRestore } = await import(`${SRC}/renderer/src/history/useBackup.ts`)
  const plain = describeExport({ ok: true, count: 2, leftOut: 0, where: 'D:\\b.jsonl' })
  check('E: without files the backup notice is word for word what it was', plain === 'Backed up 2 chats to D:\\b.jsonl. The file was read back and every chat matched.', plain)
  const withFiles = describeExport({ ok: true, count: 2, leftOut: 0, where: 'D:\\b.jsonl', files: { count: 3, leftOut: 1 } })
  check('E: with files it says how many it holds, and the one that could not be read', withFiles === 'Backed up 2 chats to D:\\b.jsonl. The file was read back and every chat matched. It holds their 3 attached files too; 1 attached file could not be read and is not in it.', withFiles)
  const r = describeRestore({ ok: true, added: 2, copies: 0, same: 0, refused: 0, noRoom: 0, failed: 0, files: { added: 3, already: 1, noRoom: 1, failed: 0, refused: 0 } })
  check('E: after a restore: the files put back, those already here, and those that could not be', r === 'Added 2 chats. Put back 3 attached files (1 already here). 1 attached file could not be put back: the attachments folder is full.', r)
  check('E: without files the restore notice is word for word what it was', describeRestore({ ok: true, added: 1, copies: 0, same: 0, refused: 0, noRoom: 0, failed: 0 }) === 'Added 1 chat.')
  const onlyFiles = describeRestore({ ok: true, added: 0, copies: 0, same: 1, refused: 0, noRoom: 0, failed: 0, files: { added: 2, already: 0, noRoom: 0, failed: 0, refused: 0 } })
  check('E: a restore that only put files back does not say "Added 0 chats"', onlyFiles === '1 chat already here, left as it is. Put back 2 attached files.', onlyFiles)
})

process.exit(check.summary() ? 0 : 1)
