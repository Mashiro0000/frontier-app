// Slice 9.2 under plain Node (no window): getting files in (D-037).
//  A. the service (attachmentService.ts) with a played open dialog and a real store: what is kept and what is refused, ten at a time, a closed dialog, one
//     dialog at a time, no path in any answer; a pasted or dropped file (checkAttachmentBytes: only a name and bytes, the size looked at first); discard.
//  B. the words on a chip (attachmentText.ts): the type, the size in pixels, pages or lines, the weight, and the notes about what was done.
//  C. what the source must keep true: the bridge, the handlers behind the sender check, the dialog in the one file that opens dialogs, nothing that gives the
//     page a path.
// Run: node tools/verify-9-2.mjs
import './temp-on-a.mjs'
import { checker } from './cdp.mjs'
import { mkdirSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SRC, storeMod, standInTools, fixture, makeGif, jpegWith, APP, sha256, source } from './lib9.mjs'

const check = checker()
const guard = async (name, fn) => { try { await fn() } catch (error) { check(`${name} did not run to its end: ${String(error?.stack ?? error).slice(0, 300)}`, false) } }
const show = (v) => JSON.stringify(v)?.slice(0, 260)
const { createAttachmentService } = await import(`${SRC}/main/attachmentService.ts`)
const { checkAttachmentBytes } = await import(`${SRC}/shared/validate.ts`)
const text = await import(`${SRC}/renderer/src/chat/attachmentText.ts`)
const MB = 1024 * 1024

await guard('A', async () => {
  const base = join(tmpdir(), `frontier-v92-${randomUUID()}`)
  const files = join(base, 'files')
  mkdirSync(join(files, 'many'), { recursive: true })
  mkdirSync(join(files, 'real'), { recursive: true })
  writeFileSync(join(files, 'photo.jpg'), jpegWith([APP.exif(1, { secret: 'GPS-HOME' })]))
  writeFileSync(join(files, 'doc.pdf'), fixture('three-pages.pdf'))
  writeFileSync(join(files, 'anim.gif'), makeGif({ frames: 2 }))
  writeFileSync(join(files, 'big.bin'), Buffer.alloc(21 * MB, 1))
  writeFileSync(join(files, 'real', 'x.png'), fixture('q.png'))
  symlinkSync(join(files, 'real'), join(files, 'link'), 'junction')
  for (let i = 0; i < 12; i++) writeFileSync(join(files, 'many', `n${i}.txt`), `note ${i}\n`)
  const store = storeMod.createAttachmentStore(join(base, 'profile', 'attachments'), { images: standInTools() })
  const asked = []
  let answers = []
  let used = new Set()
  let gate = null
  const svc = createAttachmentService({
    store,
    pickPaths: async (owner) => { asked.push(owner); if (gate) await gate; return answers.shift() ?? null },
    referenced: async () => used
  })
  const owner = { window: 1 }
  answers = [[join(files, 'photo.jpg'), join(files, 'doc.pdf'), join(files, 'anim.gif'), join(files, 'big.bin'), join(files, 'link'), '\\\\server\\share\\x.png', join(files, 'gone.png')]]
  const r = await svc.pick(owner)
  check('A: pick asks the dialog once, for the window that asked', asked.length === 1 && asked[0] === owner)
  check('A: two files kept (a photo without its EXIF, a PDF), in the order chosen', r.ok && r.files.length === 2 && r.files[0].info.name === 'photo.jpg' && r.files[0].info.changes.metadataRemoved && r.files[1].info.pages === 3, show(r))
  check('A: five refused, each with a sentence that names the file (never its folder) and says why', r.ok && r.refused.length === 5 && r.refused[0] === 'anim.gif was not attached: it is animated, and only still images can be sent.' && r.refused[1] === 'big.bin was not attached: it is larger than 20 MB.' && r.refused[2] === 'link was not attached: it is a link to another file.' && r.refused[3] === 'x.png was not attached: only a file on a drive of this computer can be attached.' && r.refused[4] === 'gone.png was not attached: it is not there any more.', show(r.ok && r.refused))
  check('A: no path anywhere in the answer the page gets', !JSON.stringify(r).includes(files.replaceAll('\\', '\\\\')) && !JSON.stringify(r).includes('frontier-v92') && !JSON.stringify(r).includes('server'), show(r))
  answers = [readdirSync(join(files, 'many')).sort().map((n) => join(files, 'many', n))]
  const many = await svc.pick(owner)
  check('A: twelve chosen: ten kept, and a sentence for the two left out', many.ok && many.files.length === 10 && many.refused.at(-1) === 'At most 10 files can be attached at a time: 2 were left out.', show(many.ok && many.refused))
  answers = [null]
  const closed = await svc.pick(owner)
  check('A: a closed dialog is "cancelled", not an error', !closed.ok && closed.cancelled === true)
  answers = [[]]
  check('A: a dialog that answers no file is "cancelled" too', (await svc.pick(owner)).cancelled === true)
  let release
  gate = new Promise((resolve) => { release = resolve })
  answers = [[join(files, 'photo.jpg')]]
  const first = svc.pick(owner)
  // Raced against a second: without the lock, a second pick would wait on the same closed gate for ever (a hang is a FAIL here, not a stuck run).
  const second = await Promise.race([svc.pick(owner), new Promise((resolve) => setTimeout(() => resolve({ ok: false, error: 'stuck: a second dialog was opened' }), 1500))])
  release()
  gate = null
  const firstDone = await first
  check('A: while the dialog is open, a second pick is told so and opens no second dialog', !second.ok && /already open/.test(second.error) && firstDone.ok && asked.length === 5, `${asked.length} asked`)

  // pasted or dropped bytes
  const png = fixture('q.png')
  const ok = await svc.addBytes({ name: 'pasted.png', bytes: new Uint8Array(png) })
  check('A: addBytes keeps a pasted file by its bytes, under its name', ok.ok && ok.file.info.name === 'pasted.png' && ok.file.info.id === sha256(png))
  const bigger = new Uint8Array(png.length + 16)
  bigger.set(png, 7)
  const slice = bigger.subarray(7, 7 + png.length)
  const viaSlice = await svc.addBytes({ name: 'part.png', bytes: slice })
  check('A: a Uint8Array that is a view into a bigger buffer is read exactly (offset and length), not the whole buffer', viaSlice.ok && viaSlice.file.info.id === sha256(png))
  const junk = [null, 'x', 5, {}, { name: 'a.png' }, { bytes: new Uint8Array(png) }, { name: 5, bytes: new Uint8Array(png) }, { name: 'a', bytes: 'C:\\Windows\\win.ini' }, { name: 'a', bytes: [1, 2, 3] }, { name: 'a', bytes: png.buffer }, { name: 'n'.repeat(1001), bytes: new Uint8Array(png) }, { name: 'a', path: 'C:\\x.png', bytes: new Uint8Array(0).subarray(0, 0) }]
  const junkResults = await Promise.all(junk.map((j) => svc.addBytes(j)))
  check('A: addBytes refuses everything but { name: text, bytes: Uint8Array } ("not understood"); a path field is never read', junkResults.slice(0, 11).every((x) => !x.ok && x.error === 'The file was not understood.') && !junkResults[11].ok, show(junkResults.map((x) => x.error)))
  const huge = await svc.addBytes({ name: 'huge.bin', bytes: new Uint8Array(20 * MB + 1) })
  check('A: bytes over 20 MB are refused before anything is copied', !huge.ok && huge.error === 'The file was not attached: it is larger than 20 MB.', show(huge))
  check('A: checkAttachmentBytes: the size is looked at against the cap given (at the cap passes, one over fails)', checkAttachmentBytes({ name: 'a', bytes: new Uint8Array(10) }, 10).ok && !checkAttachmentBytes({ name: 'a', bytes: new Uint8Array(11) }, 10).ok)

  // discard
  const pid = r.files[0].info.id
  const dir = join(base, 'profile', 'attachments')
  used = new Set([pid])
  await svc.discard(pid)
  check('A: discard of a file a saved chat uses keeps its copy', readdirSync(dir).includes(pid))
  used = new Set()
  await svc.discard(pid)
  check('A: discard of a file no chat uses deletes its copy', !readdirSync(dir).includes(pid))
  const before = readdirSync(dir).sort().join()
  for (const j of [42, null, '../profile', { id: 'x' }, 'f'.repeat(64)]) await svc.discard(j)
  check('A: discard with junk deletes nothing', readdirSync(dir).sort().join() === before)
  const nullRefs = createAttachmentService({ store, pickPaths: async () => null, referenced: async () => null })
  const docId = r.files[1].info.id
  store.release(docId)
  await nullRefs.discard(docId)
  check('A: when the chats that use files cannot be known (a chat that cannot be read), discard deletes nothing', readdirSync(dir).includes(docId))
})

await guard('B', async () => {
  const info = (extra) => ({ id: 'a'.repeat(64), name: 'x', kind: 'image', mediaType: 'image/jpeg', bytes: 2048, width: 4032, height: 3024, changes: { metadataRemoved: false, shrunkFrom: null, turned: false, convertedFrom: null }, ...extra })
  check('B: sizes: bytes, KB (one decimal under 10), MB', text.sizeOf(1) === '1 byte' && text.sizeOf(1023) === '1023 bytes' && text.sizeOf(2048) === '2.0 KB' && text.sizeOf(20 * 1024) === '20 KB' && text.sizeOf(5 * MB) === '5.0 MB')
  check('B: an image: "JPEG image, 4,032 x 3,024, 2.0 KB"', text.factsOf(info()) === 'JPEG image, 4,032 x 3,024, 2.0 KB', text.factsOf(info()))
  check('B: a PDF of one page and of 3: "PDF, 1 page" / "PDF, 3 pages"', text.factsOf(info({ kind: 'pdf', mediaType: 'application/pdf', pages: 1, width: undefined, height: undefined })).startsWith('PDF, 1 page, ') && text.factsOf(info({ kind: 'pdf', mediaType: 'application/pdf', pages: 3 })).startsWith('PDF, 3 pages, '))
  check('B: a text: "Text, 1 line" / "Text, 1,200 lines"', text.factsOf(info({ kind: 'text', mediaType: 'text/plain', lines: 1 })).startsWith('Text, 1 line, ') && text.factsOf(info({ kind: 'text', mediaType: 'text/plain', lines: 1200 })).startsWith('Text, 1,200 lines, '))
  const notes = text.notesOf(info({ changes: { metadataRemoved: true, shrunkFrom: { width: 4032, height: 3024 }, turned: true, convertedFrom: 'image/png' } }))
  check('B: the notes say everything that was done: metadata removed, made smaller from (with its size), turned upright, a JPEG made from a PNG', JSON.stringify(notes) === JSON.stringify(['metadata removed', 'made smaller from 4,032 x 3,024', 'turned upright', 'a JPEG image made from a PNG image']), show(notes))
  check('B: nothing done, no notes; a PDF always says it goes as it is', text.notesOf(info()).length === 0 && JSON.stringify(text.notesOf(info({ kind: 'pdf', mediaType: 'application/pdf', pages: 2 }))) === JSON.stringify(['sent as it is, with any metadata it holds']))
})

await guard('C', async () => {
  const ipc = source('main/ipc.ts')
  const pre = source('preload/index.ts')
  const handlerOf = (channel) => { const at = ipc.indexOf(`CHANNELS.${channel}`); return ipc.slice(at, at + 400) }
  check('C: the pick handler is behind the sender check and is given the window the call came from', /CHANNELS\.attachmentsPick,\s*guardedForWindow\(/.test(ipc))
  check('C: the bytes handler is behind the sender check', /CHANNELS\.attachmentsAddBytes,\s*guarded\(/.test(ipc))
  check('C: discard listens only to the app\'s own page', /ipcMain\.on\(CHANNELS\.attachmentsDiscard, \(event, id: unknown\) => \{\s*if \(!isTrustedSender\(event, appUrl\)\) return/.test(ipc))
  check('C: the bridge gives the page pick (no argument), addBytes (a name and bytes) and discard (an id), and nothing that takes a path', /pick: \(\) => ipcRenderer\.invoke\(CHANNELS\.attachmentsPick\)/.test(pre) && /addBytes: \(name, bytes\) => ipcRenderer\.invoke\(CHANNELS\.attachmentsAddBytes, \{ name, bytes \}\)/.test(pre) && /discard: \(id\) => ipcRenderer\.send\(CHANNELS\.attachmentsDiscard, id\)/.test(pre) && !/getPathForFile|webUtils/.test(pre))
  const dialogs = readdirSync(join(SRC.replace('file:///', ''), 'main')).filter((n) => n.endsWith('.ts') && /dialog\.show(Save|Open|Message)/.test(source(`main/${n}`)))
  check('C: the attach dialog lives in the one file that opens dialogs (backupDialogs.ts)', dialogs.join() === 'backupDialogs.ts' && /pickAttachmentPaths/.test(source('main/backupDialogs.ts')) && /'multiSelections'/.test(source('main/backupDialogs.ts')) && /filters: \[ANY_FILTER\],\s*properties: \['openFile' as const, 'multiSelections'/.test(source('main/backupDialogs.ts')), dialogs.join())
  const renderer = ['chat/useAttachments.ts', 'chat/AttachmentChips.tsx', 'chat/ChatView.tsx', 'chat/Composer.tsx'].map((f) => source(`renderer/src/${f}`)).join('\n')
  check('C: the page reads a dropped or pasted file\'s bytes and never its place on disk (no .path, no webUtils)', !/\.path\b|webUtils|getPathForFile/.test(renderer) && /arrayBuffer\(\)/.test(renderer))
  check('C: the service reads a chosen file with readLocalFile and the cap, and discards only through the store', /readLocalFile\(path, MAX_INPUT_BYTES\)/.test(source('main/attachmentService.ts')) && /store\.deleteUnused\(\[id\], used\)/.test(source('main/attachmentService.ts')))
  void handlerOf
})

process.exit(check.summary() ? 0 : 1)
