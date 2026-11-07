// Slice 16.7 under plain Node (no window): WHAT IS KEPT, ENCRYPTED AND BACKED UP of the pictures (D-048). The REAL store, index, encryption service and usage ledger, with the
// played secure storage of lib8b3 (a key that can be lost, a storage that lies, a computer without one). What it shows:
//   A. the gallery's pictures are rewritten with the chats both ways (after the chats, the files and the documents), proved by reading them back; images.json is one of the
//      documents; a second pass has nothing to do; a picture still plain when every chat is sealed is not "nothing to do"; with the key lost a picture cannot be opened and is
//      left exactly as it is; without pictures the report is what it was;
//   B. what the person is told (and without pictures, word for word what it was);
//   C. a backup carries no picture, and no code of backing up or restoring names the gallery;
//   D. the scan: with encryption on, no file under the data folder holds a picture's header or the description; with it off, the pictures are the only PNGs, under images/;
//   E. cost: a picture's fee is in the sums of this chat, today and this month (a request that was stopped counts what was reserved, as "about");
//   F. the wiring.
// Run: node tools/guarded.mjs tools/verify-16-7.mjs      (ONLY=A,C runs some parts; it makes its own folders in the temp folder and removes nothing)
import './ts-resolve.mjs'
import { checker } from './cdp.mjs'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { REPO, REPO_URL } from './paths.mjs'
import { makeBox } from './lib8b3.mjs'
import { solidPng } from './mock-images.mjs'

const check = checker()
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(',')) : null
const guard = async (name, fn) => { if (ONLY && !ONLY.has(name)) return; try { await fn() } catch (error) { check(`${name} did not run to its end: ${String(error?.stack ?? error).slice(0, 500)}`, false) } }
const show = (v) => JSON.stringify(v)?.slice(0, 500)
const SRC = `${REPO_URL}/src`
const enc = await import(`${SRC}/main/chatEncryptionService.ts`)
const indexMod = await import(`${SRC}/main/imageIndex.ts`)
const storeMod = await import(`${SRC}/main/imageStore.ts`)
const keptMod = await import(`${SRC}/main/keptFile.ts`)
const ledgerMod = await import(`${SRC}/main/usageLedger.ts`)
const { describeEncrypted, describePlain } = await import(`${SRC}/renderer/src/settings/useChatStorage.ts`)
const source = (rel) => readFileSync(join(REPO, rel), 'utf8')
const root = mkdtempSync(join(tmpdir(), 'frontier-167-'))
let n = 0
const tempDir = () => { const d = join(root, `d${++n}`); mkdirSync(d, { recursive: true }); return d }
const sha = (b) => createHash('sha256').update(b).digest('hex')
const PNG_HEAD = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const DESC = 'A lighthouse at dusk, painted in teal'
const UUID = '0b8f0e2a-6c1d-4e8b-9a77-2f4d5c6b7a81'
const FACTS = { prompt: DESC, model: 'gpt-image-2', shape: 'square', quality: 'medium', chat: UUID, costEach: 0.053, estimate: false }
const pics = () => [solidPng(64, 64), solidPng(64, 64, [200, 30, 30])].map((bytes) => ({ bytes, type: 'image/png', width: 64, height: 64 }))
const THUMB = 'data:image/png;base64,VEhVTUI='
const every = (dir) => readdirSync(dir, { recursive: true }).map((name) => join(dir, name)).filter((p) => statSync(p).isFile())

/** A data folder with the real gallery, the played storage, a mode the test turns, and the service with stand-ins for the chats (their own suites prove those). */
function rig({ box = makeBox(), chats = { plain: 0, encrypted: 0 }, files = null } = {}) {
  const dir = tempDir()
  const mode = { form: 'plain' }
  const writeMode = async () => ({ form: mode.form })
  const index = indexMod.createImageIndexFile({ pathOf: () => join(dir, 'images.json'), box, writeMode })
  const store = storeMod.createImageStore({ dir: join(dir, 'images'), index, images: { thumbnail: () => THUMB }, box, writeMode })
  let choice = 'off'
  const calls = []
  const chatStore = { counts: async () => ({ ...chats, unreadable: 0, unopened: 0 }), conform: async () => { calls.push('chats'); return { changed: 0, already: chats.plain + chats.encrypted, failed: 0 } } }
  const protection = {
    state: async () => ({ choice, canEncrypt: true, keyUsable: choice === 'on' ? true : null, blocked: null }),
    turnOn: async () => { choice = 'on'; mode.form = 'encrypted' },
    turnOff: async () => { choice = 'off'; mode.form = 'plain' }
  }
  const backups = { backUpAllBeforeEncrypting: async () => { calls.push('backup'); return { ok: true, count: chats.plain + chats.encrypted, leftOut: 0, where: 'C:\\b.jsonl' } }, exclusive: (_busy, task) => task() }
  const docs = keptMod.keptDocuments([index])
  const documents = { counts: () => docs.counts(), conform: async () => { calls.push('documents'); return docs.conform() } }
  const pictures = { counts: () => store.counts(), conform: async () => { calls.push('pictures'); return store.conform() } }
  const service = enc.createChatEncryptionService({ store: chatStore, protection, backups, asks: { confirmPlain: async () => true }, documents, pictures, ...(files ? { files: { counts: async () => files, conform: async () => { calls.push('files'); return { changed: files.plain, already: 0, failed: 0 } } } } : {}) })
  return { dir, box, mode, index, store, service, calls, setChoice: (c) => { choice = c } }
}

// ============ A. sealed and unsealed with the chats ============
await guard('A', async () => {
  const r = rig({ files: { plain: 1, encrypted: 0 }, chats: { plain: 1, encrypted: 0 } })
  const made = await r.store.add(pics(), FACTS)
  const originals = pics().map((p) => sha(p.bytes))
  const fileOf = (id) => join(r.dir, 'images', id)
  check('A: (set up) two pictures kept plain: each file is the PNG itself', made.length === 2 && made.every((p) => readFileSync(fileOf(p.id)).subarray(0, 8).equals(PNG_HEAD)))
  check('A: (set up) the store counts them as plain', show(await r.store.counts()).includes('"plain":2,"encrypted":0'), show(await r.store.counts()))
  const on = await r.service.encrypt({})
  check('A: turning encryption on rewrites the chats, then the files, then the documents (images.json among them), then the pictures, after the backup', on.ok && show(r.calls) === show(['backup', 'chats', 'files', 'documents', 'pictures']), show([on, r.calls]))
  check('A: the report says two pictures were rewritten and none failed', show(on.report.pictures) === '{"changed":2,"failed":0}', show(on.report))
  const sealed = made.map((p) => readFileSync(fileOf(p.id)))
  check('A: each picture file is now sealed (the marker, no PNG header anywhere in it)', sealed.every((b) => b.subarray(0, storeMod.SEALED_PICTURE.length).equals(storeMod.SEALED_PICTURE) && b.indexOf(PNG_HEAD) === -1))
  const indexText = readFileSync(join(r.dir, 'images.json'), 'utf8')
  check('A: images.json is sealed too: neither the description nor a model name nor an id is readable in it', !indexText.includes('lighthouse') && !indexText.includes('gpt-image') && !made.some((p) => indexText.includes(p.id)), indexText.slice(0, 80))
  const back = await Promise.all(made.map((p) => r.store.read(p.id)))
  check('A: ...and every picture reads back byte for byte (its hash checked), in the encrypted form', back.every((b, i) => b.ok && sha(b.bytes) === originals[i] && b.form === 'encrypted'), show(back.map((b) => b.ok ? b.form : b.why)))
  const listed = await r.store.list()
  check('A: the gallery lists them with the description, from the sealed index', listed.problem === null && listed.pictures.length === 2 && listed.pictures[0].prompt === DESC)
  r.calls.length = 0
  const again = await r.store.conform()
  check('A: a second pass has nothing to do', again.changed === 0 && again.already === 2 && again.failed === 0, show(again))
  const more = await r.store.add(pics().slice(0, 1), { ...FACTS, prompt: 'A second lighthouse' })
  check('A: a picture made while encryption is on is written sealed', readFileSync(fileOf(more[0].id)).subarray(0, storeMod.SEALED_PICTURE.length).equals(storeMod.SEALED_PICTURE))
  const off = await r.service.decrypt({})
  check('A: turning it off rewrites all three pictures plain, and says so', off.ok && show(off.report.pictures) === '{"changed":3,"failed":0}' && [...made, ...more].every((p) => readFileSync(fileOf(p.id)).subarray(0, 8).equals(PNG_HEAD)), show(off.report))
  check('A: ...byte for byte the pictures that were made', sha(readFileSync(fileOf(made[0].id))) === originals[0] && sha(readFileSync(fileOf(made[1].id))) === originals[1])
  check('A: images.json is plain again, with the description', readFileSync(join(r.dir, 'images.json'), 'utf8').includes('lighthouse'))

  // every chat sealed, a picture still plain: "Encrypt the rest" is not "nothing to do"
  const s = rig({ chats: { plain: 0, encrypted: 2 } })
  const one = await s.store.add(pics().slice(0, 1), FACTS)
  s.setChoice('on')
  s.mode.form = 'encrypted'
  await keptMod.keptDocuments([s.index]).conform() // the index sealed already (a picture's rewrite failed last time): only the picture is left plain
  check('A: (set up) the index is sealed and the picture plain', !readFileSync(join(s.dir, 'images.json'), 'utf8').includes('lighthouse') && readFileSync(join(s.dir, 'images', one[0].id)).subarray(0, 8).equals(PNG_HEAD))
  const rest = await s.service.encrypt({})
  check('A: every chat sealed but a picture still plain: encrypting again rewrites the picture (not "nothing to do")', rest.ok && rest.report.pictures?.changed === 1 && readFileSync(join(s.dir, 'images', one[0].id)).subarray(0, storeMod.SEALED_PICTURE.length).equals(storeMod.SEALED_PICTURE), show(rest.report))
  const sealedChoiceOff = rig({ chats: { plain: 0, encrypted: 0 } })
  const two = await sealedChoiceOff.store.add(pics().slice(0, 1), FACTS)
  sealedChoiceOff.setChoice('on')
  sealedChoiceOff.mode.form = 'encrypted'
  await sealedChoiceOff.service.encrypt({})
  sealedChoiceOff.setChoice('off')
  sealedChoiceOff.mode.form = 'plain'
  await keptMod.keptDocuments([sealedChoiceOff.index]).conform() // the index plain already: only the picture is left sealed
  check('A: (set up) the index is plain and the picture sealed', readFileSync(join(sealedChoiceOff.dir, 'images.json'), 'utf8').includes('lighthouse') && readFileSync(join(sealedChoiceOff.dir, 'images', two[0].id)).subarray(0, storeMod.SEALED_PICTURE.length).equals(storeMod.SEALED_PICTURE))
  const dec = await sealedChoiceOff.service.decrypt({})
  check('A: no chat at all but a sealed picture: going back to plain is not "nothing to do" either', dec.ok && dec.report.pictures?.changed === 1 && readFileSync(join(sealedChoiceOff.dir, 'images', two[0].id)).subarray(0, 8).equals(PNG_HEAD), show(dec.report))

  // the key lost
  const k = rig({ chats: { plain: 1, encrypted: 0 } })
  const lost = await k.store.add(pics().slice(0, 1), FACTS)
  await k.service.encrypt({})
  const keyBefore = k.box.exportKey()
  const before = readFileSync(join(k.dir, 'images', lost[0].id))
  k.box.lose()
  const unread = await k.store.read(lost[0].id)
  check('A: with the key LOST, a sealed picture cannot be opened, and says why', !unread.ok && typeof unread.error === 'string', show(unread))
  const tried = await k.store.conform()
  check('A: ...rewriting fails for it and leaves the file exactly as it is', tried.changed === 0 && readFileSync(join(k.dir, 'images', lost[0].id)).equals(before), show(tried))
  const offLost = await k.service.decrypt({})
  // with the key lost images.json cannot be opened either, so no picture is listed or counted, and the index is not counted among the documents
  check('A: ...going back to plain with the key lost: nothing of the gallery is rewritten or told (a kept file that cannot be opened is not counted, as for every kept document since D-039), and its file is left exactly as it is', offLost.ok && offLost.report.documents === undefined && offLost.report.pictures === undefined && readFileSync(join(k.dir, 'images', lost[0].id)).equals(before), show(offLost.report))
  k.box.importKey(keyBefore)
  check('A: ...and with the same key again it opens', (await k.store.read(lost[0].id)).ok === true)
  k.box.lie = true
  check('A: a secure storage that answers with the wrong text: the picture is not shown', (await k.store.read(lost[0].id)).ok === false)
  k.box.lie = false

  const none = rig({ chats: { plain: 1, encrypted: 0 } })
  const noneOn = await none.service.encrypt({})
  check('A: with no pictures at all the report has no pictures field (its shape is what it was), and the pictures are not even rewritten', noneOn.ok && !('pictures' in noneOn.report) && !none.calls.includes('pictures'), show([noneOn.report, none.calls]))
})

// ============ B. what the person is told ============
await guard('B', async () => {
  const said = describeEncrypted({ changed: 2, already: 0, failed: 0, backup: null, pictures: { changed: 3, failed: 1 } })
  check('B: "Encrypted 3 pictures in the gallery too." and the one that could not be', /Encrypted 3 pictures in the gallery too\. 1 picture in the gallery could not be rewritten and is as before\./.test(said), said)
  check('B: one picture is "1 picture in the gallery"', /Encrypted 1 picture in the gallery too\./.test(describeEncrypted({ changed: 0, already: 0, failed: 0, backup: null, pictures: { changed: 1, failed: 0 } })))
  check('B: without pictures it is word for word what it was', describeEncrypted({ changed: 2, already: 0, failed: 0, backup: null }) === 'Encrypted 2 chats. Chats you save from now on are encrypted too.')
  const status = { choice: 'off', canEncrypt: true, keyUsable: null, plain: 1, encrypted: 0, unreadable: 0, unopened: 0, blocked: null }
  const plain = describePlain({ changed: 1, already: 0, failed: 0, backup: null, pictures: { changed: 2, failed: 1 } }, status)
  check('B: going back: "Rewrote 2 pictures in the gallery as plain files too." and the one still encrypted', /Rewrote 2 pictures in the gallery as plain files too\. 1 picture in the gallery could not be rewritten and is still encrypted\./.test(plain), plain)
  check('B: "1 picture in the gallery as a plain file"', /Rewrote 1 picture in the gallery as a plain file too\./.test(describePlain({ changed: 0, already: 0, failed: 0, backup: null, pictures: { changed: 1, failed: 0 } }, status)))
  check('B: going back without pictures is word for word what it was', describePlain({ changed: 1, already: 0, failed: 0, backup: null }, status) === 'Rewrote 1 chat as a plain file. Chats you save from now on are plain files too.')
})

// ============ C. backups ============
await guard('C', async () => {
  const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '')
  for (const rel of ['src/main/backup.ts', 'src/main/backupService.ts']) {
    let text
    try { text = strip(source(rel)) } catch { check(`C: ${rel} could not be read`, false); continue }
    check(`C: ${rel} names no part of the gallery (no images folder, index, store or picture bytes)`, !/imageStore|imageIndex|images\.json|createImage|SEALED_PICTURE|['"`]images['"`/\\]/.test(text), (text.match(/imageStore|imageIndex|images\.json|createImage|SEALED_PICTURE/) ?? [])[0])
  }
  const svc = strip(source('src/main/chatEncryptionService.ts'))
  check('C: the backup made before encrypting is asked before the pictures are touched, and it is the chats\' backup (the pictures are not in it: the owner\'s pick 4)', svc.indexOf('backUpAllBeforeEncrypting(owner)') > 0 && svc.indexOf('backUpAllBeforeEncrypting(owner)') < svc.indexOf('await conformPictures()'))
})

// ============ D. the scan ============
await guard('D', async () => {
  const r = rig({ chats: { plain: 1, encrypted: 0 } })
  await r.store.add(pics(), FACTS)
  await r.service.encrypt({})
  const files = every(r.dir)
  const holding = files.filter((p) => { const b = readFileSync(p); return b.indexOf(PNG_HEAD) !== -1 || b.indexOf(Buffer.from('lighthouse')) !== -1 || b.indexOf(Buffer.from('IHDR')) !== -1 })
  check(`D: with encryption on, none of the ${files.length} files in the data folder holds a PNG header, a PNG chunk or the description`, files.length >= 3 && holding.length === 0, show(holding))
  check('D: nothing is left over: no .tmp, and every picture file is named by an index line', files.every((p) => !p.endsWith('.tmp')) && (await r.store.counts()).unlisted === 0, show(files))
  await r.service.decrypt({})
  const plainFiles = every(r.dir)
  const pngs = plainFiles.filter((p) => readFileSync(p).indexOf(PNG_HEAD) !== -1)
  check('D: with it off, the only files holding a PNG are the two pictures, under images/, named by random 32-letter ids', pngs.length === 2 && pngs.every((p) => /[\\/]images[\\/][0-9a-f]{32}$/.test(p)), show(pngs))
  check('D: no file is named by the description', !plainFiles.some((p) => /lighthouse/i.test(p)))
})

// ============ E. cost in the sums ============
await guard('E', async () => {
  const dir = tempDir()
  const now = new Date(2026, 9, 16, 12).getTime()
  const ledger = ledgerMod.createUsageLedger(join(dir, 'ledger.jsonl'), { now: () => now })
  const zero = { inputPerMTok: 0, cacheReadPerMTok: 0, cacheWritePerMTok: 0, outputPerMTok: 0 }
  const begin = (usd, count) => ledger.begin({ chat: UUID, provider: 'openai', model: 'gpt-image-2', effort: null, prices: zero, inputTokens: 0, image: { kind: 'generate', count, usd } })
  const a = await begin(0.21, 1)
  await ledger.finish(a.id, { state: 'done', tokens: { input: 40, cacheRead: 0, cacheWrite: 0, output: 4160 }, estimate: false, image: { kind: 'generate', count: 1, usd: 0.17 } })
  let s = await ledger.summary(UUID)
  check('E: a picture of $0.17 is in this chat, today and this month, exactly, and as one request', [s.chat, s.today, s.month].every((t) => t !== null && Math.abs(t.costUsd - 0.17) < 1e-9 && t.requests === 1 && t.about === false), show(s))
  const b = await begin(0.84, 4)
  await ledger.finish(b.id, { state: 'stopped', tokens: { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 }, estimate: true, image: { kind: 'generate', count: 4, usd: 0.84 } })
  s = await ledger.summary(UUID)
  check('E: a request that was stopped counts what was reserved ($0.84), and the sum is "about"', Math.abs(s.today.costUsd - 1.01) < 1e-9 && s.today.about === true && s.chat.requests === 2, show(s.today))
  const other = await ledger.summary(null)
  check('E: with no chat asked for, the day and month still hold them', other.chat === null && Math.abs(other.month.costUsd - 1.01) < 1e-9)
})

// ============ F. the wiring ============
await guard('F', async () => {
  const ipc = source('src/main/ipc.ts')
  check('F: the encryption service is given the gallery\'s store (pictures), and images.json is among its documents', /files: attachments,\s*pictures: imageStore,/.test(ipc) && /imageSettings\.file,\s*imageIndex,\s*library\.file,\s*myExperts\.file\s*\]\)/.test(ipc))
  const md = source('src/renderer/src/images/MakeImageDialog.tsx')
  check('F: the dialog tells main the description\'s length in UTF-8 bytes for the figure it shows, and asks again when it changes', /const bytes = Math\.min\(promptBytes\(full\), IMAGE_LIMITS\.maxPromptBytes\)/.test(md) && /\.estimate\(\{ model: modelId, shape, quality, count, promptBytes: bytes \}\)/.test(md) && /\}, \[modelId, shape, quality, count, bytes\]\)/.test(md))
  check('F: the request itself is counted from the description it sends, not from what the page said', /maximumCost\(\s*ask\.model,\s*ask\.shape,\s*ask\.quality,\s*ask\.count,\s*promptBytes\(ask\.prompt\)\s*\)/.test(source('src/main/imageService.ts')))
  check('F: the report type has the pictures field', /pictures\?: \{ changed: number; failed: number \}/.test(source('src/shared/ipc.ts')))
  void writeFileSync
})

const ok = check.summary()
process.exit(ok ? 0 : 1)
