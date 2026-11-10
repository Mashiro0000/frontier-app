// Stage 23.1 (D-055), names, pins and days under plain Node: a name as it is kept (one line, 100 characters, no control or direction marks), chat-names.json
// read strictly, titles without Markdown's marks, the sidebar's groups (Pinned, Today, Yesterday, Previous 7 / 30 days, months) worked out here from fixed
// dates, the service on a real folder (rename, pin, forget, one change at a time, an unreadable file never written over), version 4 backups (marks written
// only for marked chats, read back, refused when damaged or after the chats, a restore that adds the marks of the chats it added and changes none already
// here), and the wiring.
// usage: node tools/guarded.mjs tools/verify-23-1.mjs   (writes only in its own temp folder)
import './ts-resolve.mjs'
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { checker } from './cdp.mjs'
import { REPO_URL } from './paths.mjs'
import { backup, service as serviceMod, createConversationStore, fakePickers, makeChat, NOW, sha256, sourceOf } from './lib8b.mjs'

const check = checker()
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const { checkChatTitle, checkChatMarks, plainTitle, CHAT_NAME_LIMITS } = await import(`${REPO_URL}/src/shared/chatNames.ts`)
const { createChatNames, parseChatNamesFile, chatNamesFileText } = await import(`${REPO_URL}/src/main/chatNames.ts`)
const { groupChats } = await import(`${REPO_URL}/src/renderer/src/sidebar/groups.ts`)
const { titleFor } = await import(`${REPO_URL}/src/main/conversationStore.ts`)
const ID1 = '00000000-0000-4000-8000-000000000001'
const ID2 = '00000000-0000-4000-8000-000000000002'
const ID3 = '00000000-0000-4000-8000-0000000000ff' // not one of makeChat's ids (idOf(n))

// ============ A. a name, the file, plain titles ============
check('A: the limits: 100 characters, 5,000 chats', CHAT_NAME_LIMITS.maxTitleChars === 100 && CHAT_NAME_LIMITS.maxEntries === 5000)
check('A: a name is put on one line and trimmed', checkChatTitle('  My\n trip   plan ') === 'My trip plan')
check("A: '' (and only spaces) means the worked-out title again", checkChatTitle('') === '' && checkChatTitle('   ') === '')
check('A: 100 characters is a name, 101 is not (an emoji counts once)', checkChatTitle('x'.repeat(100)) === 'x'.repeat(100) && checkChatTitle('x'.repeat(101)) === null && checkChatTitle('😀'.repeat(100)) !== null)
for (const [what, bad] of [['a control character', 'a\u0007b'], ['a direction override', 'abc\u202edef'], ['an isolate', 'a\u2066b'], ['a number', 42], ['null', null], ['a list', ['a']]]) {
  check(`A: not a name: ${what}`, checkChatTitle(bad) === null)
}
const good = { [ID1]: { title: 'Trip' }, [ID2]: { pinned: true }, [ID3]: { title: 'Both', pinned: true } }
check('A: chat-names.json is read back exactly as written', same(parseChatNamesFile(chatNamesFileText(good)), good))
for (const [what, marks] of [
  ['an id that is not a chat id', { 'nope': { title: 'x' } }],
  ['an entry with neither', { [ID1]: {} }],
  ['a field more', { [ID1]: { title: 'x', colour: 'red' } }],
  ['pinned false', { [ID1]: { pinned: false } }],
  ['an empty name', { [ID1]: { title: '' } }],
  ['a name not as kept (untrimmed)', { [ID1]: { title: ' x' } }],
  ['a name too long', { [ID1]: { title: 'x'.repeat(101) } }]
]) check(`A: chat-names.json refused: ${what}`, checkChatMarks(marks) === null && parseChatNamesFile(chatNamesFileText(marks)) === null)
for (const [what, text] of [['not JSON', '{'], ['another version', JSON.stringify({ version: 2, chats: {} })], ['a field more', JSON.stringify({ version: 1, chats: {}, x: 1 })], ['a list', '[]']]) {
  check(`A: chat-names.json refused: ${what}`, parseChatNamesFile(text) === null)
}
const many = Object.fromEntries(Array.from({ length: 5001 }, (_, i) => [`00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, { pinned: true }]))
check('A: at most 5,000 marks in the file', checkChatMarks(many) === null)
for (const [from, to] of [
  ['**Bold** question', 'Bold question'],
  ['# A heading', 'A heading'],
  ['> quoted words', 'quoted words'],
  ['Explain `map()` in JS', 'Explain map() in JS'],
  ['See [the docs](https://example.com) now', 'See the docs now'],
  ['*Why* is the _sky_ blue?', 'Why is the sky blue?'],
  ['my_var_name stays', 'my_var_name stays'],
  ['2 * 3 = 6', '2 * 3 = 6'],
  ['- a list item', 'a list item'],
  ['2024. Budget review', '2024. Budget review'],
  ['1. First step', 'First step'],
  ['**', '**'],
  ['', 'New chat']
]) check(`A: a plain title: ${JSON.stringify(from)} -> ${JSON.stringify(to)}`, plainTitle(from) === to, JSON.stringify(plainTitle(from)))
const msg = (content) => ({ role: 'user', content, status: 'done' })
check('A: a new title is worked out plain, then cut at 60 characters', titleFor([msg('**Hello** there')]) === 'Hello there' && titleFor([msg('**' + 'y'.repeat(80) + '**')]) === 'y'.repeat(60) + '...')

// ============ B. the groups, from fixed dates in this computer's time ============
{
  const now = new Date(2026, 10, 8, 15, 0, 0).getTime() // 8 November 2026, 15:00 here
  const at = (y, m, d, h = 12) => new Date(y, m, d, h).getTime()
  const chats = [
    { id: 'p', updatedAt: at(2026, 7, 1), pinned: true },
    { id: 't1', updatedAt: at(2026, 10, 8, 14) },
    { id: 't2', updatedAt: at(2026, 10, 8, 0) },
    { id: 'y', updatedAt: at(2026, 10, 7, 23) },
    { id: 'w', updatedAt: at(2026, 10, 1) },
    { id: 'm30', updatedAt: at(2026, 9, 10) },
    { id: 'oct', updatedAt: at(2026, 9, 2) },
    { id: 'p2', updatedAt: at(2026, 10, 8), pinned: true },
    { id: 'sep', updatedAt: at(2026, 8, 1) },
    { id: 'aug', updatedAt: at(2026, 7, 20) }
  ]
  const groups = groupChats(chats, now)
  const shape = groups.map((g) => `${g.label}:${g.chats.map((c) => c.id).join(',')}`)
  check('B: Pinned first (in the list\'s order), then Today, Yesterday, Previous 7 days, Previous 30 days (10 Oct), then by month (2 Oct is 37 days back)', same(shape, ['Pinned:p,p2', 'Today:t1,t2', 'Yesterday:y', 'Previous 7 days:w', 'Previous 30 days:m30', 'October 2026:oct', 'September 2026:sep', 'August 2026:aug']), JSON.stringify(shape))
  check('B: midnight today is today, a minute before is yesterday', groupChats([{ id: 'a', updatedAt: at(2026, 10, 8, 0) }], now)[0].label === 'Today' && groupChats([{ id: 'b', updatedAt: new Date(2026, 10, 7, 23, 59).getTime() }], now)[0].label === 'Yesterday')
  check('B: no chats, no groups', groupChats([], now).length === 0)
}

// ============ C. the service on a real folder ============
const temps = []
const tempDir = (tag) => { const dir = mkdtempSync(join(tmpdir(), `frontier-231${tag}-`)); temps.push(dir); return dir }
const plain = async () => ({ form: 'plain' })
{
  const dir = tempDir('c')
  const names = createChatNames({ folder: () => dir, writeMode: plain })
  check('C: no file: no marks, no problem', same(await names.read(), { marks: {}, problem: null }))
  const [r1, r2] = await Promise.all([names.rename(ID1, '  Trip  plan '), names.pin(ID1, true)])
  check('C: a rename and a pin made together are both kept (one change at a time)', r1.ok && r2.ok && same((await names.read()).marks, { [ID1]: { title: 'Trip plan', pinned: true } }))
  check('C: chat-names.json holds exactly that', readFileSync(join(dir, 'chat-names.json'), 'utf8') === chatNamesFileText({ [ID1]: { title: 'Trip plan', pinned: true } }))
  await names.rename(ID1, '')
  check("C: '' takes the name off and keeps the pin", same((await names.read()).marks, { [ID1]: { pinned: true } }))
  await names.pin(ID1, false)
  check('C: unpinned with no name: the entry is gone', same((await names.read()).marks, {}))
  for (const [what, call] of [['an id that is not a chat id', () => names.rename('../x', 'a')], ['a name that is not one', () => names.rename(ID1, 'a\u202eb')], ['pin not true or false', () => names.pin(ID1, 'yes')]]) {
    check(`C: refused: ${what}`, (await call()).ok === false)
  }
  await names.rename(ID2, 'Kept')
  const before = statSync(join(dir, 'chat-names.json')).mtimeMs
  await new Promise((resolve) => setTimeout(resolve, 60)) // a write after this would carry a later time
  await names.forget(ID3)
  check('C: forgetting a chat with no mark writes nothing (the file\'s time is unchanged)', statSync(join(dir, 'chat-names.json')).mtimeMs === before)
  await names.forget(ID2)
  check('C: forgetting a marked chat drops its entry', same((await names.read()).marks, {}))
  await names.rename(ID1, 'Here')
  const added = await names.addMissing({ [ID1]: { title: 'From a backup' }, [ID3]: { pinned: true } })
  check('C: addMissing adds a new chat\'s mark and never changes one already here', added.ok && same((await names.read()).marks, { [ID1]: { title: 'Here' }, [ID3]: { pinned: true } }))
  const damaged = '{"version":1,"chats":"x"}'
  writeFileSync(join(dir, 'chat-names.json'), damaged)
  const read = await names.read()
  check('C: an unreadable file: no marks shown, and why', same(read.marks, {}) && typeof read.problem === 'string')
  const blocked = await names.rename(ID1, 'New')
  check('C: and no change is written over it; the person is told', !blocked.ok && /could not be read/.test(blocked.error) && readFileSync(join(dir, 'chat-names.json'), 'utf8') === damaged)
}

// ============ D. version 4 backups ============
{
  const dir = tempDir('d')
  const store = createConversationStore(join(dir, 'conversations'))
  const chats = [makeChat(1), makeChat(2), makeChat(3)]
  for (const chat of chats) await store.add(chat)
  const ids = chats.map((c) => c.id)
  const marks = { [ids[0]]: { title: 'Named', pinned: true }, [ids[2]]: { pinned: true }, [ID3]: { title: 'Not in the backup' } }
  const readAll = async (path) => {
    const seen = { chats: [], marks: [] }
    const read = await backup.readBackup(path, (chat) => { seen.chats.push(chat.id) }, () => undefined, { mark: (id, mark) => { seen.marks.push([id, mark]) } })
    return { read, ...seen }
  }
  const header = (path) => JSON.parse(readFileSync(path, 'utf8').split('\n')[0])
  const p4 = join(dir, 'with-marks.jsonl')
  const w = await backup.writeBackup(p4, { ...sourceOf(store, ids), marks }, NOW)
  const r4 = await readAll(p4)
  check('D: a backup of marked chats is version 4 and says how many marks it wrote', w.ok && w.marks === 2 && header(p4).version === backup.BACKUP_VERSION_MARKS && header(p4).version === 4)
  check('D: it reads back whole: the chats, and the marks of the chats in it only', r4.read.complete && r4.read.refusedCount === 0 && same(r4.chats, ids) && same(r4.marks, [[ids[0], { title: 'Named', pinned: true }], [ids[2], { pinned: true }]]) && r4.read.trailer?.marks === 2, JSON.stringify(r4.read.trailer))
  check('D: with no projects and notes, none are shown (a version 4 of chats only)', r4.read.kept?.projects.seen === 0 && r4.read.kept?.notes.seen === 0)
  const p1 = join(dir, 'no-marks.jsonl')
  await backup.writeBackup(p1, { ...sourceOf(store, ids), marks: { [ID3]: { pinned: true } } }, NOW)
  check('D: a backup whose chats have no mark is written as before (version 1)', header(p1).version === 1 && (await readAll(p1)).read.complete)
  const pOne = join(dir, 'one.jsonl')
  await backup.writeBackup(pOne, { ...sourceOf(store, [ids[0]]), marks }, NOW)
  check('D: a backup of one marked chat carries its mark too', header(pOne).version === 4 && same((await readAll(pOne)).marks, [[ids[0], { title: 'Named', pinned: true }]]))

  const lines = readFileSync(p4, 'utf8').split('\n')
  const markAt = lines.findIndex((l) => l.startsWith('{"mark":'))
  const firstChat = lines.findIndex((l) => l.startsWith('{"n":'))
  check('D: the marks come before the chats', markAt > 0 && markAt < firstChat)
  const variant = (name, edit) => { const copy = [...lines]; edit(copy); const p = join(dir, name); writeFileSync(p, copy.join('\n')); return p }
  const changed = await readAll(variant('changed.jsonl', (l) => { l[markAt] = l[markAt].replace('Named', 'Other') }))
  check('D: a mark changed after the backup was made is refused (its checksum); the other is still used (a refused line still counts, as a chat line does)', changed.read.kept.marks.refusedCount === 1 && changed.marks.length === 1 && changed.read.kept.marks.seen === 2)
  const badText = JSON.stringify({ id: ids[0], title: 'a\u202eb' })
  const hostile = await readAll(variant('hostile.jsonl', (l) => { l[markAt] = `{"mark":${badText},"sha256":"${sha256(badText)}"}` }))
  check('D: a mark this app would not keep is refused even with a good checksum', hostile.read.kept.marks.refusedCount === 1 && !hostile.marks.some(([, m]) => m.title === 'a\u202eb'))
  const late = await readAll(variant('late.jsonl', (l) => { const [m] = l.splice(markAt, 1); l.splice(l.length - 2, 0, m) }))
  check('D: a mark after the chats is not used', late.read.kept.marks.refusedCount === 1 && late.marks.length === 1)
  const v3 = await readAll(variant('v3.jsonl', (l) => { l[0] = l[0].replace('"version":4', '"version":3') }))
  check('D: in a version 3 file a mark line is not a mark (refused as a chat line)', v3.marks.length === 0 && v3.read.refusedCount >= 2 && !v3.read.complete)
  const v5 = await readAll(variant('v5.jsonl', (l) => { l[0] = l[0].replace('"version":4', '"version":5') }))
  check('D: a later version is not read', v5.read.problem !== null && /another version/.test(v5.read.problem))

  // The service: a backup carries the marks; a restore into an empty app adds them, by the id each chat was added with.
  const there = tempDir('e')
  const thereStore = createConversationStore(join(there, 'conversations'))
  const thereNames = createChatNames({ folder: () => there, writeMode: plain })
  const pick = fakePickers()
  const out = join(dir, 'service.jsonl')
  pick.answers.save.push(out)
  const hereNames = createChatNames({ folder: () => dir, writeMode: plain })
  await hereNames.rename(ids[1], 'Second')
  await hereNames.pin(ids[1], true)
  const hereService = serviceMod.createBackupService({ store, dataDir: join(dir, 'data'), pickers: pick.pickers, marks: hereNames, now: () => NOW })
  const exported = await hereService.exportChats({ scope: 'all' }, null)
  check('D: the service writes the marks of the chats it backs up', exported.ok && header(out).version === 4 && same((await readAll(out)).marks, [[ids[1], { title: 'Second', pinned: true }]]))
  await thereStore.add(chats[1]) // the same chat is already there: kept as it is, its mark not added
  await thereNames.rename(ID3, 'Unrelated')
  const restorePick = fakePickers()
  restorePick.answers.open.push(out)
  const thereService = serviceMod.createBackupService({ store: thereStore, dataDir: join(there, 'data'), pickers: restorePick.pickers, marks: thereNames, now: () => NOW })
  const look = await thereService.restoreLook(null)
  check('D: a backup of chats only shows no projects or notes', look.ok && look.preview.kept === undefined)
  await hereNames.rename(ids[0], 'First')
  const restoreAgain = fakePickers()
  const out2 = join(dir, 'service2.jsonl')
  pick.answers.save.push(out2)
  await hereService.exportChats({ scope: 'all' }, null)
  restoreAgain.answers.open.push(out2)
  const thereService2 = serviceMod.createBackupService({ store: thereStore, dataDir: join(there, 'data'), pickers: restoreAgain.pickers, marks: thereNames, now: () => NOW })
  const look2 = await thereService2.restoreLook(null)
  const applied = look2.ok ? await thereService2.restoreApply(look2.preview.token, null) : look2
  const after = (await thereNames.read()).marks
  check('D: a restore adds the chats it can and the marks of those it added', applied.ok && applied.added === 2 && applied.same === 1 && after[ids[0]]?.title === 'First', JSON.stringify({ applied, after }))
  check('D: ...and not the mark of a chat already here, and changes no mark it had', after[ids[1]] === undefined && after[ID3]?.title === 'Unrelated')
}

// ============ F. the wiring ============
{
  const read = (path) => readFileSync(fileURLToPath(`${REPO_URL}/${path}`), 'utf8')
  const ipc = read('src/main/ipc.ts')
  const pre = read('src/preload/index.ts')
  for (const ch of ['historyRename', 'historyPin']) {
    check(`F: ${ch} is handled behind the sender check`, new RegExp(`ipcMain\\.handle\\(\\s*CHANNELS\\.${ch},\\s*guarded\\(`).test(ipc))
    check(`F: ${ch} is bridged in the preload`, pre.includes(`CHANNELS.${ch}`))
  }
  const start = ipc.indexOf('documents: keptDocuments([')
  check('F: chat-names.json is sealed and opened with the chats', ipc.slice(start, ipc.indexOf('])', start)).includes('chatNames.file'))
  check('F: quitting waits for a name or a pin on its way to the disk', /chatNames\.file\.whenIdle\(\)/.test(ipc))
  check('F: only a saved chat gets a mark', /if \(!\(await isSaved\(fields\.id\)\)\) return NOT_SAVED\s*return chatNames\.rename/.test(ipc) && /if \(!\(await isSaved\(fields\.id\)\)\) return NOT_SAVED\s*return chatNames\.pin/.test(ipc))
  check('F: a deleted chat\'s mark is dropped', /await chatNames\.forget\(check\.id\)/.test(ipc))
  check('F: the list and the search show the names (titleWith)', /title: titleWith\(marks, c\)/.test(ipc) && /title: titleWith\(marks, loaded\.conversation\)/.test(ipc))
  check('F: the backups get the marks', /marks: chatNames\n/.test(ipc))
}

console.log(`temp folders (left in place): ${temps.join(', ')}`)
process.exit(check.summary() ? 0 : 1)
