// Slice 8b.2 under plain Node (no window): restoring from a backup (D-034). The store's `add` (keeps dates, never replaces anything) and `inspect`; the flow
// around the dialogs (backup of all or one chat; what the page may ask; a place inside the app's data folder is refused; looking at a file adds nothing; the
// token; a file that changed; a restore never replaces a chat; a chat that shares an id becomes a copy); 1000 chats out and back in, byte for byte; and what
// the source must keep true. The two system dialogs are played by `fakePickers`.
// Every file check runs in a normal folder and in the EFS-encrypted %APPDATA% (D-010).
// Run: node tools/verify-8b-2.mjs      (QUICK=1: the normal folder only and a profile of 40 chats instead of 1000, for the negative controls)
import { checker } from './cdp.mjs'
import { promises as fsp, readFileSync, readdirSync, utimesSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join, basename } from 'node:path'
import { REPO } from './paths.mjs'
import { scratch } from './drive.mjs'
import {
  backup, service, HISTORY_LIMITS, NOW, same, msg, idOf, makeChat, fileText, seedFile, everything, sourceOf, lineFor, headerLine, trailerLine, readAll, snapshot, fakePickers, withFaults,
  createConversationStore, titleFor
} from './lib8b.mjs'

const check = checker()
const { readBackup, writeBackup, contentKey, BACKUP_LIMITS } = backup
const { createBackupService, isInside, TOKEN_LIFETIME_MS } = service
// A sabotaged module can make a block throw; that must show as a failed check and a summary line, not as a crashed run (tools/README.md).
const guard = async (name, fn) => { try { await fn() } catch (error) { check(`${name} did not run to its end: ${String(error?.stack ?? error).slice(0, 300)}`, false) } }
const text = (path) => fsp.readFile(path, 'utf8')
const exists = (path) => fsp.access(path).then(() => true, () => false)
const throws = async (fn) => { try { await fn(); return false } catch { return true } }
const within = (promise, ms = 8000) => Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error(`no answer in ${ms} ms`)), ms))])

const QUICK = process.env.QUICK === '1'
const BIG = QUICK ? 40 : 1000
for (const [where, base] of [['tmp', join(tmpdir(), `frontier-v8b2-${randomUUID()}`)], ['EFS', join(scratch('v8b2'), randomUUID())]].slice(0, QUICK ? 1 : 2)) {
  const T = (name) => `[${where}] ${name}`

  // ============ A. the store: add and inspect ============
  await guard(`A ${where}`, async () => {
    const dir = join(base, 'a-store')
    const store = createConversationStore(dir)
    check(T('inspect: nothing is saved under an id in a folder that is not there yet'), (await store.inspect(idOf(1))).kind === 'free')
    const c1 = makeChat(1)
    const added = await store.add({ ...c1, title: 'a forged title' })
    check(T('add: a chat is added and answered with its summary, dates kept (not "now")'), added.ok && added.summary.updatedAt === c1.updatedAt && added.summary.messageCount === c1.messages.length, JSON.stringify(added))
    check(T('add: its title is worked out from its messages, not taken from the file'), added.ok && added.summary.title === titleFor(c1.messages) && added.summary.title !== 'a forged title')
    check(T('add: loaded back it is the chat as it was: dates, instructions, failed and stopped replies'), same((await store.load(c1.id)).conversation, c1))
    check(T('add: the file on disk is exactly what the app writes for any chat (version 3), and no ".tmp" is left'), (await text(join(dir, `${c1.id}.json`))) === fileText(c1) && !(await exists(join(dir, `${c1.id}.json.tmp`))))
    check(T('add: the chat is in the list at the place its own date gives'), (await store.list()).conversations.length === 1)
    const order = [4, 2, 5, 3]
    for (const i of order) await store.add(makeChat(i))
    const listed = (await store.list()).conversations
    check(T('add: several chats are listed newest first by their own dates, whatever order they were added in'), same(listed.map((c) => c.id), [5, 4, 3, 2, 1].map(idOf)), JSON.stringify(listed.map((c) => c.id.slice(-2))))
    const saved = await store.save({ id: c1.id, messages: [...c1.messages, msg('user', 'later')], instructions: c1.instructions })
    check(T('an added chat can be saved to again like any other, and keeps the date it was created'), saved.ok && (await store.load(c1.id)).conversation.createdAt === c1.createdAt && (await store.load(c1.id)).conversation.messages.length === c1.messages.length + 1)

    const there = await store.inspect(idOf(2))
    check(T('inspect: a saved chat is "here", with the chat'), there.kind === 'here' && same(there.conversation, makeChat(2)))
    check(T('inspect: an id with nothing saved is "free"'), (await store.inspect(idOf(77))).kind === 'free')
    check(T('inspect and add refuse an id that is not an id (it becomes part of a file name)'), (await throws(() => store.inspect('../x'))) && (await throws(() => store.add({ ...makeChat(1), id: '../../x' }))) && (await throws(() => store.inspect(idOf(1).toUpperCase().replace(/[0-9]/g, 'A')))))

    // never replaces anything
    const before = await snapshot(dir)
    const again = await store.add({ ...makeChat(2), messages: [msg('user', 'different')] })
    check(T('add: an id that is already saved is "occupied" and nothing is written'), !again.ok && again.why === 'occupied' && before === (await snapshot(dir)), JSON.stringify(again))

    await fsp.writeFile(join(dir, `${idOf(20)}.json`), 'this is not json')
    await fsp.writeFile(join(dir, `${idOf(21)}.json`), fileText(makeChat(21)).slice(0, 80)) // torn
    const store2 = createConversationStore(dir)
    await store2.list()
    check(T('inspect: a file that cannot be read is "damaged" (two kinds)'), (await store2.inspect(idOf(20))).kind === 'damaged' && (await store2.inspect(idOf(21))).kind === 'damaged')
    const snap2 = await snapshot(dir)
    const overDamaged = await store2.add(makeChat(20))
    check(T('add: an id with a damaged file under it is "occupied": the damaged file is not written over'), !overDamaged.ok && overDamaged.why === 'occupied' && snap2 === (await snapshot(dir)))

    await fsp.writeFile(join(dir, `${idOf(30)}.json`), fileText(makeChat(30))) // appears after the scan, as another program could make it
    const lateFile = await store2.add({ ...makeChat(30), messages: [msg('user', 'mine')] })
    check(T('add: a file that appeared after the list was made is found on disk and not written over'), !lateFile.ok && lateFile.why === 'occupied' && (await text(join(dir, `${idOf(30)}.json`))) === fileText(makeChat(30)))
    await fsp.writeFile(join(dir, `${idOf(31)}.json.tmp`), fileText(makeChat(31)))
    const lateTmp = await store2.add(makeChat(31))
    check(T('add: a half-saved ".tmp" under the id counts too (reading would use it)'), !lateTmp.ok && lateTmp.why === 'occupied' && !(await exists(join(dir, `${idOf(31)}.json`))))

    await store2.remove(idOf(5))
    const afterRemove = await store2.add(makeChat(5))
    check(T('add: an id whose chat was deleted is free again'), afterRemove.ok)

    // limits
    const oldMax = HISTORY_LIMITS.maxConversations
    try {
      const small = createConversationStore(join(base, 'a-small'))
      HISTORY_LIMITS.maxConversations = 2
      const one = await small.add(makeChat(1))
      const two = await small.add(makeChat(2))
      const three = await small.add(makeChat(3))
      check(T('add: when the saved chats are at the limit the next one is "full", with a sentence, and not written'), one.ok && two.ok && !three.ok && three.why === 'full' && /Delete some/.test(three.error) && !(await exists(join(base, 'a-small', `${idOf(3)}.json`))), JSON.stringify(three))
    } finally { HISTORY_LIMITS.maxConversations = oldMax }
    const oldBytes = HISTORY_LIMITS.maxFileBytes
    try {
      const tiny = createConversationStore(join(base, 'a-tiny'))
      HISTORY_LIMITS.maxFileBytes = 300
      const big = await tiny.add(makeChat(7))
      check(T('add: a chat whose file would be over the size limit is "too-large" and not written (what is written must be readable again)'), !big.ok && big.why === 'too-large' && !(await exists(join(base, 'a-tiny', `${idOf(7)}.json`))), JSON.stringify(big))
    } finally { HISTORY_LIMITS.maxFileBytes = oldBytes }

    // a disk fault in the copy step: like a save, the whole ".tmp" is kept, and the next start reads it
    const fdir = join(base, 'a-fault')
    const fstore = createConversationStore(fdir)
    await fstore.list()
    await withFaults(() => ({ copyFile: async () => { throw Object.assign(new Error('access denied'), { code: 'EPERM' }) } }), async () => {
      check(T('add: a copy that fails throws (the caller says so)'), await throws(() => fstore.add(makeChat(9))))
    })
    check(T('...the whole ".tmp" is there, the chat is not listed yet, and adding it again is "occupied" (never written over)'), (await exists(join(fdir, `${idOf(9)}.json.tmp`))) && (await fstore.list()).conversations.length === 0 && (await fstore.add(makeChat(9))).why === 'occupied')
    check(T('...and after a restart the ".tmp" is read as the chat (the rule of D-016)'), same((await createConversationStore(fdir).list()).conversations.map((c) => c.id), [idOf(9)]))
  })

  // ============ B. the flow around the dialogs ============
  await guard(`B ${where}`, async () => {
    const userData = join(base, 'userData')
    const convDir = join(userData, 'conversations')
    const docs = join(base, 'Documents')
    await fsp.mkdir(docs, { recursive: true })
    await fsp.mkdir(userData, { recursive: true })
    await fsp.writeFile(join(userData, 'credentials.anthropic.json'), 'SECRET-KEY-FILE')
    await fsp.writeFile(join(userData, 'limits.json'), '{"version":1}')
    const chats = Array.from({ length: 8 }, (_, i) => makeChat(i))
    for (const chat of chats) await seedFile(convDir, chat)
    await fsp.writeFile(join(convDir, `${idOf(90)}.json`), 'damaged, not json') // one saved file that cannot be read
    const store = createConversationStore(convDir)
    const fake = fakePickers()
    let clock = NOW
    const owner = { window: 'the window that asked' }
    const svc = createBackupService({ store, dataDir: userData, pickers: fake.pickers, now: () => clock })
    const dest = join(docs, 'my-backup.jsonl')

    // --- backing up
    fake.answers.save.push(dest)
    const exported = await svc.exportChats({ scope: 'all' }, owner)
    check(T('export all: ok, 8 chats, 1 saved file left out (the damaged one), and where it went'), exported.ok && exported.count === 8 && exported.leftOut === 1 && exported.where === dest, JSON.stringify(exported))
    check(T('...the save dialog was opened once, for the window that asked, with a suggested name of the date'), fake.calls.length === 1 && fake.calls[0].kind === 'save' && fake.calls[0].owner === owner && /^frontier-chats-2026-10-05\.jsonl$/.test(fake.calls[0].suggestedName), JSON.stringify(fake.calls[0]))
    const written = await readAll(dest)
    check(T('...the file is whole, has the 8 chats, and its last line says 1 left out'), written.read.complete && written.chats.length === 8 && written.read.trailer.leftOut === 1)
    check(T('...the damaged saved file was left exactly as it was'), (await text(join(convDir, `${idOf(90)}.json`))) === 'damaged, not json')

    fake.calls.length = 0
    fake.answers.save.push(join(docs, 'one.jsonl'))
    const one = await svc.exportChats({ scope: 'one', id: chats[3].id }, owner)
    check(T('export one: ok, 1 chat, nothing left out, a name with the date and the first 8 characters of the id'), one.ok && one.count === 1 && one.leftOut === 0 && fake.calls[0].suggestedName === `frontier-chat-2026-10-05-${chats[3].id.slice(0, 8)}.jsonl`, JSON.stringify(one))

    fake.calls.length = 0
    const cancelled = await svc.exportChats({ scope: 'all' }, owner)
    check(T('the person closes the dialog: "cancelled", not an error, and nothing is written'), !cancelled.ok && cancelled.cancelled === true && !(await exists(`${dest}.part`)))

    // what the page may ask: junk is refused before any dialog opens
    fake.calls.length = 0
    for (const [name, request] of [['nothing', undefined], ['null', null], ['a string', 'all'], ['a number', 5], ['a list', ['all']], ['an empty object', {}], ['another scope', { scope: 'everything' }], ['"ALL" in capitals', { scope: 'ALL' }], ['"one" with no id', { scope: 'one' }], ['"one" with a path as the id', { scope: 'one', id: '../x' }], ['"one" with an upper-case id', { scope: 'one', id: 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA' }], ['"one" with a number as the id', { scope: 'one', id: 5 }], ['"one" with a list as the id', { scope: 'one', id: [chats[0].id] }]]) {
      const result = await svc.exportChats(request, owner)
      check(T(`export asked for ${name}: refused with a sentence`), !result.ok && !result.cancelled && typeof result.error === 'string' && result.error.length > 8, JSON.stringify(result))
    }
    check(T('...and no dialog was opened for any of them'), fake.calls.length === 0)
    const unknown = await svc.exportChats({ scope: 'one', id: idOf(555) }, owner)
    check(T('export of a chat that is not saved (a good id): "not found", no dialog'), !unknown.ok && /not found/.test(unknown.error) && fake.calls.length === 0)
    const damagedOne = await svc.exportChats({ scope: 'one', id: idOf(90) }, owner)
    check(T('export of the id of the damaged file: "not found" too (it is not a chat that can be backed up), no dialog'), !damagedOne.ok && fake.calls.length === 0)

    // the page cannot name a place
    fake.answers.save.push(join(docs, 'chosen-by-the-person.jsonl'))
    const sneaky = await svc.exportChats({ scope: 'all', path: join(docs, 'chosen-by-the-page.jsonl'), dest: join(docs, 'chosen-by-the-page.jsonl'), where: join(docs, 'chosen-by-the-page.jsonl') }, owner)
    check(T('a request with a path in it: the path is ignored, the file goes where the PERSON chose'), sneaky.ok && sneaky.where === join(docs, 'chosen-by-the-person.jsonl') && (await exists(join(docs, 'chosen-by-the-person.jsonl'))) && !(await exists(join(docs, 'chosen-by-the-page.jsonl'))))

    // places the person may not choose
    const beforeData = await snapshot(userData)
    const secretPath = join(userData, 'credentials.anthropic.json')
    await fsp.mkdir(join(base, 'links'), { recursive: true })
    const junction = join(base, 'links', 'into-data')
    await fsp.symlink(await fsp.realpath(userData), junction, 'junction') // the target as the system spells it (this PC maps %APPDATA% into a package folder for some programs)
    const refusedPlaces = [
      ['an existing key file in the data folder', secretPath],
      ['a new file in the data folder', join(userData, 'new.jsonl')],
      ['a file in the folder of the saved chats', join(convDir, 'x.jsonl')],
      ['a file in a folder under the data folder that is not there', join(userData, 'nothing', 'deeper', 'x.jsonl')],
      ['a path that climbs out and back in (..)', `${docs}/../userData/x.jsonl`],
      ['a path through a junction that points into the data folder', join(junction, 'x.jsonl')],
      ['the data folder in other capitals', join(userData.toUpperCase(), 'x.jsonl')]
    ]
    for (const [name, place] of refusedPlaces) {
      fake.answers.save.push(place)
      const result = await svc.exportChats({ scope: 'all' }, owner)
      check(T(`a backup to ${name}: refused with a sentence, nothing written`), !result.ok && !result.cancelled && /own data folder/.test(result.error), JSON.stringify(result))
    }
    check(T('...the data folder (the key file, limits, the chats) is byte for byte as it was, and no ".part" or new file is in it'), beforeData === (await snapshot(userData)) && (await text(secretPath)) === 'SECRET-KEY-FILE')
    check(T('isInside: a sibling folder with a similar name is not inside (userData2 is not userData)'), !(await isInside(userData, join(base, 'userData2', 'x'))) && (await isInside(userData, join(userData, 'x'))) && (await isInside(userData, userData)))
    for (const [name, place] of [['a relative path', 'backup.jsonl'], ['an empty path', ''], ['a path with only a name and a drive', 'C:backup.jsonl']]) {
      fake.answers.save.push(place)
      const result = await svc.exportChats({ scope: 'all' }, owner)
      check(T(`a backup to ${name}: refused`), !result.ok && !result.cancelled, JSON.stringify(result))
    }
    fake.answers.save.push(join(base, 'no-such-folder', 'x.jsonl'))
    const nowhere = await svc.exportChats({ scope: 'all' }, owner)
    check(T('a backup to a folder that is not there: "could not be written there", and the sentence names no path'), !nowhere.ok && nowhere.error === 'The backup could not be written there.' && !nowhere.error.includes(base), JSON.stringify(nowhere))

    // the empty store
    const emptySvc = createBackupService({ store: createConversationStore(join(base, 'empty')), dataDir: userData, pickers: fake.pickers, now: () => clock })
    fake.calls.length = 0
    const nothing = await emptySvc.exportChats({ scope: 'all' }, owner)
    check(T('export with no saved chats: "nothing to back up", no dialog'), !nothing.ok && /no saved chats/.test(nothing.error) && fake.calls.length === 0)

    // one at a time
    fake.calls.length = 0
    const release = fake.holdNext()
    fake.answers.save.push(join(docs, 'slow.jsonl'))
    const slow = svc.exportChats({ scope: 'all' }, owner)
    await new Promise((resolve) => setTimeout(resolve, 30))
    const second = await svc.exportChats({ scope: 'all' }, owner)
    const secondLook = await svc.restoreLook(owner)
    const secondApply = await svc.restoreApply('whatever')
    check(T('while a dialog is open, another backup, look or apply is told to wait and opens no second dialog'), !second.ok && /Another backup or restore/.test(second.error) && !secondLook.ok && /Another backup or restore/.test(secondLook.error) && !secondApply.ok && /Another backup or restore/.test(secondApply.error) && fake.calls.length === 1, `${fake.calls.length} dialogs asked for`)
    release()
    const slowDone = await within(slow)
    check(T('...and the first one then finishes normally'), slowDone.ok && slowDone.count === 8)
    check(T('whenIdle resolves once nothing is running'), await within(svc.whenIdle().then(() => true)))
  })

  // ============ C. restoring ============
  await guard(`C ${where}`, async () => {
    const userData = join(base, 'userDataC')
    const docs = join(base, 'DocumentsC')
    await fsp.mkdir(docs, { recursive: true })
    const srcDir = join(userData, 'source')
    const chats = Array.from({ length: 9 }, (_, i) => makeChat(i))
    for (const chat of chats) await seedFile(srcDir, chat)
    const source = createConversationStore(srcDir)
    const fake = fakePickers()
    let clock = NOW
    const makeService = (dir) => {
      const s = createConversationStore(dir)
      return { store: s, svc: createBackupService({ store: s, dataDir: userData, pickers: fake.pickers, now: () => clock }), dir }
    }
    const sourceSvc = createBackupService({ store: source, dataDir: userData, pickers: fake.pickers, now: () => clock })
    const file = join(docs, 'all.jsonl')
    fake.answers.save.push(file)
    await sourceSvc.exportChats({ scope: 'all' }, null)
    const original = await everything(source)

    // --- an empty profile
    const t1 = makeService(join(base, 'targetC1'))
    const beforeLook = await snapshot(t1.dir)
    fake.answers.open.push(file)
    const look = await t1.svc.restoreLook(null)
    check(T('look at a whole backup in an empty profile: 9 new, none here, no copies, whole'), look.ok && look.preview.fresh === 9 && look.preview.same === 0 && look.preview.copies === 0 && look.preview.complete && look.preview.refusedCount === 0, JSON.stringify(look.preview ?? look))
    const p = look.preview
    check(T('...it says which file (the name only, never the folder), when it was made, and how many have instructions of their own'), p.fileName === 'all.jsonl' && !JSON.stringify(p).includes(base) && p.exportedAt === NOW && p.withInstructions === chats.filter((c) => c.instructions !== '').length && p.leftOutAtExport === 0)
    check(T('...the first ten titles, as the list will show them, and room for 1000'), same(p.titles, (await source.list()).conversations.slice(0, 10).map((c) => c.title)) && p.room === 1000 && typeof p.token === 'string' && p.token.length >= 32)
    check(T('looking at the file wrote nothing in the profile'), beforeLook === (await snapshot(t1.dir)))
    const apply = await t1.svc.restoreApply(p.token)
    check(T('apply: 9 added as they were, nothing skipped, copied, refused, or failed'), apply.ok && apply.added === 9 && apply.copies === 0 && apply.same === 0 && apply.refused === 0 && apply.noRoom === 0 && apply.failed === 0, JSON.stringify(apply))
    check(T('...every chat is exactly the original: dates, instructions, failed and stopped replies, every kind of text'), same(await everything(t1.store), original))
    check(T('...the list order is the originals\' (their own dates)'), same((await t1.store.list()).conversations.map((c) => c.id), (await source.list()).conversations.map((c) => c.id)))

    // --- the same file again: nothing new, nothing changed
    const filesBefore = await snapshot(t1.dir)
    fake.answers.open.push(file)
    const look2 = await t1.svc.restoreLook(null)
    check(T('look again at the same file now: all 9 are already here'), look2.ok && look2.preview.same === 9 && look2.preview.fresh === 0 && look2.preview.copies === 0)
    const apply2 = await t1.svc.restoreApply(look2.preview.token)
    check(T('apply again: nothing added, 9 skipped, and the saved files are byte for byte as they were'), apply2.ok && apply2.added === 0 && apply2.copies === 0 && apply2.same === 9 && filesBefore === (await snapshot(t1.dir)), JSON.stringify(apply2))

    // --- a different chat under the same id, and a damaged file under another
    const t2 = makeService(join(base, 'targetC2'))
    const mine = { ...chats[2], messages: [msg('user', 'MY OWN chat that has this id'), msg('assistant', 'yes', 'done', { provider: 'anthropic', model: 'claude-opus-5-5' })], title: 'x', updatedAt: chats[2].updatedAt + 99999 }
    await seedFile(join(base, 'targetC2'), { ...mine, title: titleFor(mine.messages) })
    await fsp.writeFile(join(base, 'targetC2', `${chats[4].id}.json`), 'damaged, not json')
    await seedFile(join(base, 'targetC2'), chats[5]) // the same chat as in the backup
    const mineBytes = await text(join(base, 'targetC2', `${chats[2].id}.json`))
    const damagedBytes = await text(join(base, 'targetC2', `${chats[4].id}.json`))
    const snapBefore = await snapshot(join(base, 'targetC2'))
    fake.answers.open.push(file)
    const look3 = await t2.svc.restoreLook(null)
    check(T('look when one saved chat has the same id but is a different chat, one id has a damaged file, one is the same chat: 2 copies, 1 skipped, 6 new'), look3.ok && look3.preview.copies === 2 && look3.preview.same === 1 && look3.preview.fresh === 6, JSON.stringify(look3.preview ?? look3))
    const apply3 = await t2.svc.restoreApply(look3.preview.token)
    check(T('apply: 6 added, 2 as copies, 1 skipped'), apply3.ok && apply3.added === 6 && apply3.copies === 2 && apply3.same === 1 && apply3.failed === 0, JSON.stringify(apply3))
    check(T('...MY chat under the shared id is byte for byte as it was, and so is the damaged file: nothing was replaced'), (await text(join(base, 'targetC2', `${chats[2].id}.json`))) === mineBytes && (await text(join(base, 'targetC2', `${chats[4].id}.json`))) === damagedBytes)
    const afterAll = await everything(t2.store)
    const copiesMade = afterAll.filter((c) => (c.id !== chats[2].id && contentKey(c) === contentKey(chats[2])) || (c.id !== chats[4].id && contentKey(c) === contentKey(chats[4])))
    check(T('...the two copies hold the backup\'s chats (dates, instructions, messages) under fresh valid ids'), copiesMade.length === 2 && copiesMade.every((c) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(c.id) && c.id !== chats[2].id && c.id !== chats[4].id))
    check(T('...the profile then lists 10 chats: its own 2 readable ones, 6 new, 2 copies (the damaged file is not listed)'), afterAll.length === 10 && (await t2.store.list()).conversations.length === 10, `${afterAll.length}`) // mine + chats[5] + 6 new + 2 copies = 10 readable
    check(T('...and the saved files that were there before are all unchanged'), (await text(join(base, 'targetC2', `${chats[5].id}.json`))) === fileText(chats[5]) && (await text(join(base, 'targetC2', `${chats[2].id}.json`))) === mineBytes && snapBefore !== (await snapshot(join(base, 'targetC2'))))

    // --- the token: once, the right one, in time, for the file that was looked at
    const t3 = makeService(join(base, 'targetC3'))
    const lookAt = async (path = file) => { fake.answers.open.push(path); const r = await t3.svc.restoreLook(null); return r.ok ? r.preview : r }
    const NOTHING = /Nothing is waiting/
    check(T('apply with no look first: nothing is waiting'), NOTHING.test((await t3.svc.restoreApply(randomUUID())).error ?? ''))
    let pv = await lookAt()
    for (const [name, token] of [['another token', randomUUID()], ['no token', undefined], ['null', null], ['a number', 5], ['an object', { token: pv.token }], ['a list holding it', [pv.token]], ['an empty string', ''], ['the token in capitals', pv.token.toUpperCase()]]) {
      const r = await t3.svc.restoreApply(token)
      check(T(`apply with ${name}: refused, nothing added`), !r.ok && NOTHING.test(r.error) && (await t3.store.list()).conversations.length === 0, JSON.stringify(r))
    }
    check(T('...and the real token still works after those (a stray call does not spoil the person\'s flow), once'), (await t3.svc.restoreApply(pv.token)).ok && NOTHING.test((await t3.svc.restoreApply(pv.token)).error ?? ''))
    {
      const t4 = makeService(join(base, 'targetC4'))
      fake.answers.open.push(file)
      const look = await t4.svc.restoreLook(null)
      clock += TOKEN_LIFETIME_MS + 1
      const r = await t4.svc.restoreApply(look.preview.token)
      check(T('apply after ten minutes: refused (the look is too old), nothing added'), !r.ok && NOTHING.test(r.error) && (await t4.store.list()).conversations.length === 0, JSON.stringify(r))
      clock = NOW
      fake.answers.open.push(file)
      const look2 = await t4.svc.restoreLook(null)
      clock += TOKEN_LIFETIME_MS - 1000
      check(T('...just inside ten minutes it works'), (await t4.svc.restoreApply(look2.preview.token)).ok)
      clock = NOW
    }
    {
      const t5 = makeService(join(base, 'targetC5'))
      fake.answers.open.push(file)
      const first = (await t5.svc.restoreLook(null)).preview
      t5.svc.restoreCancel('not the token')
      const stillThere = await t5.svc.restoreApply(first.token)
      check(T('cancel with another token drops nothing'), stillThere.ok)
      fake.answers.open.push(file)
      const second = (await t5.svc.restoreLook(null)).preview
      t5.svc.restoreCancel(second.token)
      const cancelled = await t5.svc.restoreApply(second.token)
      check(T('cancel with the token: it can no longer be used'), !cancelled.ok && NOTHING.test(cancelled.error))
      fake.answers.open.push(file)
      const third = (await t5.svc.restoreLook(null)).preview
      fake.answers.open.push(file)
      const fourth = (await t5.svc.restoreLook(null)).preview
      check(T('a new look replaces the last one: the first token is dead, the new one works'), NOTHING.test((await t5.svc.restoreApply(third.token)).error ?? '') && (await t5.svc.restoreApply(fourth.token)).ok)
      fake.answers.open.push(file)
      const fifth = (await t5.svc.restoreLook(null)).preview
      fake.answers.open.push(null) // the person closes the next dialog
      const closed = await t5.svc.restoreLook(null)
      check(T('a look that is cancelled in the dialog also drops the one before it'), !closed.ok && closed.cancelled === true && NOTHING.test((await t5.svc.restoreApply(fifth.token)).error ?? ''))
    }
    {
      // the file changes between the look and the apply
      const t6 = makeService(join(base, 'targetC6'))
      const copyOfFile = join(docs, 'changing.jsonl')
      for (const [name, change] of [
        ['gets longer', async () => fsp.appendFile(copyOfFile, '\n')],
        ['is replaced by another file of the same size at another time', async () => { const bytes = await fsp.readFile(copyOfFile); await fsp.writeFile(copyOfFile, bytes); utimesSync(copyOfFile, new Date(Date.now() + 60_000), new Date(Date.now() + 60_000)) }],
        ['is deleted', async () => fsp.rm(copyOfFile)]
      ]) {
        await fsp.copyFile(file, copyOfFile)
        fake.answers.open.push(copyOfFile)
        const look = await t6.svc.restoreLook(null)
        await change()
        const r = await t6.svc.restoreApply(look.preview.token)
        check(T(`the file ${name} after it was looked at: apply refused, nothing added`), !r.ok && /changed after it was looked at/.test(r.error) && (await t6.store.list()).conversations.length === 0, JSON.stringify(r))
        await fsp.rm(copyOfFile, { force: true })
      }
    }

    // --- room
    {
      const old = HISTORY_LIMITS.maxConversations
      const t7 = makeService(join(base, 'targetC7'))
      try {
        for (const i of [100, 101, 102]) await seedFile(join(base, 'targetC7'), makeChat(i))
        HISTORY_LIMITS.maxConversations = 5
        fake.answers.open.push(file)
        const look = await t7.svc.restoreLook(null)
        check(T('with 3 chats saved and room for 5: the look says there is room for 2'), look.ok && look.preview.room === 2 && look.preview.fresh === 9, JSON.stringify(look.preview?.room))
        const r = await t7.svc.restoreApply(look.preview.token)
        check(T('apply: 2 are added and the other 7 are counted as "no room"; the limit holds'), r.ok && r.added === 2 && r.noRoom === 7 && (await t7.store.list()).conversations.length === 5, JSON.stringify(r))
      } finally { HISTORY_LIMITS.maxConversations = old }
    }

    // --- files that are not backups, and damage
    {
      const t8 = makeService(join(base, 'targetC8'))
      const secret = join(userData, 'key-like-file.json')
      await fsp.mkdir(userData, { recursive: true })
      await fsp.writeFile(secret, '{"version":2,"provider":"anthropic","key":"SECRET-ENCRYPTED-KEY-BYTES"}')
      const stray = join(docs, 'a-letter.txt')
      await fsp.writeFile(stray, 'Dear Sam, this is not a backup.\n')
      for (const [name, place, expect] of [
        ['a key file', secret, /not a Frontier chat backup/], ['a letter', stray, /not a Frontier chat backup/], ['a folder', docs, /could not be opened/], ['a file that is not there', join(docs, 'gone.jsonl'), /could not be opened/]
      ]) {
        fake.answers.open.push(place)
        const r = await t8.svc.restoreLook(null)
        check(T(`look at ${name}: refused with a sentence, and the sentence does not contain the file's text or the folder`), !r.ok && !r.cancelled && expect.test(r.error) && !r.error.includes('SECRET') && !r.error.includes('Sam') && !r.error.includes(base), JSON.stringify(r))
      }
      fake.answers.open.push(null)
      const cancelled = await t8.svc.restoreLook(null)
      check(T('look when the person closes the dialog: "cancelled"'), !cancelled.ok && cancelled.cancelled === true)
      for (const relative of ['backup.jsonl', '']) { fake.answers.open.push(relative); const r = await t8.svc.restoreLook(null); check(T(`look at ${relative === '' ? 'an empty path' : 'a relative path'}: refused`), !r.ok && !r.cancelled) }
      check(T('...nothing was added by any of them'), (await t8.store.list()).conversations.length === 0)

      // a backup with a changed line, a cut-off end, and a line that cannot be used
      const lines = (await text(file)).split('\n')
      const tampered = lines.map((line, k) => (k === 3 ? line.replace(/Question [0-9]+/, 'Question X') : line)).join('\n')
      const damagedFile = join(docs, 'tampered.jsonl')
      await fsp.writeFile(damagedFile, tampered)
      fake.answers.open.push(damagedFile)
      const look = await t8.svc.restoreLook(null)
      check(T('look at a backup with one changed chat: 8 usable, 1 cannot be used and why (its line), the file is still counted whole'), look.ok && look.preview.fresh === 8 && look.preview.refusedCount === 1 && look.preview.refused[0].line === 4 && /checksum/.test(look.preview.refused[0].why) && look.preview.complete, JSON.stringify(look.preview))
      const r = await t8.svc.restoreApply(look.preview.token)
      check(T('apply: the 8 are added, the changed one is counted as refused and not added'), r.ok && r.added === 8 && r.refused === 1 && (await t8.store.list()).conversations.length === 8, JSON.stringify(r))
      const cutFile = join(docs, 'cut.jsonl')
      const whole = await fsp.readFile(file)
      await fsp.writeFile(cutFile, whole.subarray(0, Math.floor(whole.length * 0.6)))
      const t9 = makeService(join(base, 'targetC9'))
      fake.answers.open.push(cutFile)
      const cut = await t9.svc.restoreLook(null)
      check(T('look at a backup cut off at 60%: NOT whole, the chats before the cut are counted, the cut one is refused'), cut.ok && !cut.preview.complete && cut.preview.fresh >= 3 && cut.preview.fresh < 9 && cut.preview.refusedCount === 1 && cut.preview.leftOutAtExport === null, JSON.stringify(cut.preview))
      const cutApply = await t9.svc.restoreApply(cut.preview.token)
      const got = await everything(t9.store)
      check(T('apply: exactly the whole chats before the cut are added, each exactly as it was'), cutApply.ok && cutApply.added === cut.preview.fresh && got.every((c) => same(c, original.find((o) => o.id === c.id))), JSON.stringify(cutApply))
    }

    // --- a file that repeats an id
    {
      const t10 = makeService(join(base, 'targetC10'))
      const a = chats[1]
      const b = { ...chats[1], messages: [msg('user', 'a different chat with the same id')], updatedAt: chats[1].updatedAt + 5 }
      b.title = titleFor(b.messages)
      const dup = join(docs, 'dup.jsonl')
      const body = [headerLine(), lineFor(1, { version: 3, ...a }), lineFor(2, { version: 3, ...a }), lineFor(3, { version: 3, ...b }), trailerLine(3), ''].join('\n')
      await fsp.writeFile(dup, body)
      fake.answers.open.push(dup)
      const look = await t10.svc.restoreLook(null)
      check(T('a backup with the same chat twice and a different chat under the same id: 1 new, 1 skipped, 1 copy'), look.ok && look.preview.fresh === 1 && look.preview.same === 1 && look.preview.copies === 1, JSON.stringify(look.preview))
      const r = await t10.svc.restoreApply(look.preview.token)
      check(T('...and apply does exactly that: 2 chats in the profile, the first as it was, the other a copy'), r.ok && r.added === 1 && r.copies === 1 && r.same === 1 && (await t10.store.list()).conversations.length === 2 && same((await t10.store.load(a.id)).conversation, a), JSON.stringify(r))
      // the copy of a chat that was also found as a copy: not copied twice
      const t11 = makeService(join(base, 'targetC11'))
      await seedFile(join(base, 'targetC11'), { ...b, id: a.id })
      const dup2 = join(docs, 'dup2.jsonl')
      await fsp.writeFile(dup2, [headerLine(), lineFor(1, { version: 3, ...a }), lineFor(2, { version: 3, ...a }), trailerLine(2), ''].join('\n'))
      fake.answers.open.push(dup2)
      const look2 = await t11.svc.restoreLook(null)
      const r2 = await t11.svc.restoreApply(look2.preview.token)
      check(T('the same chat twice in a file whose id is taken by a different chat here: ONE copy, not two (the look and the apply agree)'), look2.preview.copies === 1 && look2.preview.same === 1 && r2.ok && r2.copies === 1 && r2.same === 1 && (await t11.store.list()).conversations.length === 2, JSON.stringify(r2))
    }

    // --- an old version inside a backup, and instructions
    {
      const t12 = makeService(join(base, 'targetC12'))
      const withInstructions = { ...makeChat(33), instructions: 'Always answer in French.' }
      const without = makeChat(34, { instructions: '' })
      const f = join(docs, 'instr.jsonl')
      await fsp.writeFile(f, [headerLine(), lineFor(1, { version: 3, ...withInstructions }), lineFor(2, { version: 3, ...without }), trailerLine(2), ''].join('\n'))
      fake.answers.open.push(f)
      const look = await t12.svc.restoreLook(null)
      check(T('the look counts the chats that carry instructions of their own (they go out with every message of that chat)'), look.ok && look.preview.withInstructions === 1 && look.preview.fresh === 2)
      await t12.svc.restoreApply(look.preview.token)
      check(T('...and they are restored with those instructions, exactly'), (await t12.store.load(withInstructions.id)).conversation.instructions === 'Always answer in French.' && (await t12.store.load(without.id)).conversation.instructions === '')
    }
  })

  // ============ D. a thousand chats out and back in ============
  await guard(`D ${where}`, async () => {
    const srcDir = join(base, 'big-source')
    const oldMax = HISTORY_LIMITS.maxConversations
    HISTORY_LIMITS.maxConversations = BIG // the real limit unless QUICK
    try {
    const chats = Array.from({ length: BIG }, (_, i) => makeChat(i))
    for (const chat of chats) await seedFile(srcDir, chat)
    const source = createConversationStore(srcDir)
    const fake = fakePickers()
    const docs = join(base, 'big-docs')
    await fsp.mkdir(docs, { recursive: true })
    const sourceSvc = createBackupService({ store: source, dataDir: join(base, 'big-data'), pickers: fake.pickers, now: () => NOW })
    const first = join(docs, 'first.jsonl')
    fake.answers.save.push(first)
    const t0 = performance.now()
    const out = await sourceSvc.exportChats({ scope: 'all' }, null)
    const exportMs = Math.round(performance.now() - t0)
    check(T(`export of ${BIG} chats: ok, ${BIG} in the file (${exportMs} ms)`), out.ok && out.count === BIG, JSON.stringify(out))
    const targetDir = join(base, 'big-target')
    const target = createConversationStore(targetDir)
    const targetSvc = createBackupService({ store: target, dataDir: join(base, 'big-data'), pickers: fake.pickers, now: () => NOW })
    fake.answers.open.push(first)
    const t1 = performance.now()
    const look = await targetSvc.restoreLook(null)
    const lookMs = Math.round(performance.now() - t1)
    check(T(`look at ${BIG} chats in an empty profile: all new, whole (${lookMs} ms)`), look.ok && look.preview.fresh === BIG && look.preview.complete && look.preview.titles.length === 10)
    const t2 = performance.now()
    const applied = await targetSvc.restoreApply(look.preview.token)
    const applyMs = Math.round(performance.now() - t2)
    check(T(`restore of ${BIG} chats: all added (${applyMs} ms)`), applied.ok && applied.added === BIG && applied.failed === 0 && applied.refused === 0, JSON.stringify(applied))
    check(T(`every one of the ${BIG} is exactly the original`), same(await everything(target), await everything(source)))
    const second = join(docs, 'second.jsonl')
    fake.answers.save.push(second)
    await targetSvc.exportChats({ scope: 'all' }, null)
    check(T('a backup of the restored profile is BYTE FOR BYTE the first backup (out, back in, out again changes nothing)'), Buffer.compare(await fsp.readFile(first), await fsp.readFile(second)) === 0)
    // the profile is full: one more is not added
    fake.answers.open.push(first)
    const full = await targetSvc.restoreLook(null)
    check(T('looking at the same backup again: all already here, nothing to add'), full.ok && full.preview.same === BIG && full.preview.fresh === 0 && full.preview.copies === 0)
    const extra = join(docs, 'extra.jsonl')
    await fsp.writeFile(extra, [headerLine(), lineFor(1, { version: 3, ...makeChat(5000) }), trailerLine(1), ''].join('\n'))
    fake.answers.open.push(extra)
    const room = await targetSvc.restoreLook(null)
    check(T('with the profile full there is no room: the look says room 0'), room.ok && room.preview.room === 0 && room.preview.fresh === 1)
    const noRoom = await targetSvc.restoreApply(room.preview.token)
    check(T('...and apply adds nothing: "no room"'), noRoom.ok && noRoom.added === 0 && noRoom.noRoom === 1 && (await target.list()).conversations.length === BIG, JSON.stringify(noRoom))
    } finally { HISTORY_LIMITS.maxConversations = oldMax }
  })

  await fsp.rm(base, { recursive: true, force: true })
}

// ============ E. what the source must keep true ============
await guard('E', async () => {
  const read = (path) => readFileSync(join(REPO, path), 'utf8')
  const walk = (dir) => readdirSync(join(REPO, dir), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(`${dir}/${e.name}`) : [`${dir}/${e.name}`]))
  const mainFiles = walk('src/main').filter((f) => /\.ts$/.test(f))
  check('source: the backup file, the flow and the store import nothing from Electron (so they are checked here, under plain Node)', ['src/main/backup.ts', 'src/main/backupService.ts', 'src/main/conversationStore.ts'].every((f) => !/from 'electron'/.test(read(f))))
  check('source: the system\'s dialogs are used from exactly one file in main (backupDialogs.ts)', mainFiles.filter((f) => /\bdialog\.show(Save|Open|Message)/.test(read(f))).join() === 'src/main/backupDialogs.ts')
  const preload = read('src/preload/index.ts')
  check('source: the page\'s four backup functions take no path: a request, nothing, a token, a token', /exportChats: \(request\) =>/.test(preload) && /restoreLook: \(\) =>/.test(preload) && /restoreApply: \(token\) =>/.test(preload) && /restoreCancel: \(token\) =>/.test(preload))
  const shared = read('src/shared/ipc.ts')
  check('source: what the page may ask to back up (BackupRequest) has no field for a path', /export type BackupRequest = \{ scope: 'all' \} \| \{ scope: 'one'; id: string \}/.test(shared))
  const ipcMain = read('src/main/ipc.ts')
  const handlerOf = (channel) => { const start = ipcMain.indexOf(`CHANNELS.${channel}`); const end = ipcMain.indexOf('ipcMain.', start + 10); return ipcMain.slice(start, end === -1 ? undefined : end) }
  check('source: each backup message from the page is checked to come from the app window before anything is done', ['historyExport', 'historyRestoreLook'].every((c) => /guardedForWindow\(/.test(handlerOf(c))) && /guarded\(/.test(handlerOf('historyRestoreApply')) && /isTrustedSender\(event, appUrl\)/.test(handlerOf('historyRestoreCancel')) && /guarded\(\(\.\.\.rest: A\) =>/.test(ipcMain))
  check('source: the window handed to a dialog is the one that asked (BrowserWindow.fromWebContents(event.sender), in the one wrapper the four dialog handlers use: the two of 8b.1/8b.2 and, since 8b.3, encrypting and going back to plain files), never something the page sent', (ipcMain.match(/BrowserWindow\.fromWebContents\(event\.sender\)/g) ?? []).length === 1 && (ipcMain.match(/guardedForWindow\(/g) ?? []).length === 12 /* five since 9.2: attaching files opens the open dialog too (D-037); seven since 10.1: the limits and the amount to ask above open the system's message box (D-039); eight since 10.2: the instructions for every chat too; twelve since 10.4: a note made or changed, memory turned on, and the notes' export */ && /backups\.exportChats\(input, window\)/.test(ipcMain) && /backups\.restoreLook\(window\)/.test(ipcMain) && /encryption\.encrypt\(window\)/.test(ipcMain) && /encryption\.decrypt\(window\)/.test(ipcMain))
  check('source: quitting waits for a backup or restore that is running', /backups\.whenIdle\(\)/.test(ipcMain))
  const svcSrc = read('src/main/backupService.ts')
  check('source: the service refuses a place inside the data folder BEFORE it writes, and never reads a path from the request', svcSrc.indexOf('isInside(dataDir, dest)') > 0 && svcSrc.indexOf('isInside(dataDir, dest)') < svcSrc.indexOf('writeBackup(') && !/request\.(path|dest|where)/.test(svcSrc))
})

const passed = check.summary()
process.exit(passed ? 0 : 1)
