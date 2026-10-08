// Slice 8b.1 under plain Node (no window): the backup file (D-034). Its format; reading it back (every chat checked, a torn file gives back what it can
// and says it is not whole, a changed byte is never restored as a changed chat, nothing fills the memory); writing it (the new file is read back
// before it replaces anything; every disk fault leaves the old file as it was or a whole copy beside it).
// File checks run in a normal folder and in the EFS-encrypted %APPDATA% (D-010); the exhaustive ones (every cut, every changed byte) in the normal one.
// Run: node tools/verify-8b-1.mjs
import { checker } from './cdp.mjs'
import { promises as fsp, statSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { scratch } from './drive.mjs'
import {
  backup, storeMod, HISTORY_LIMITS, NOW, same, sha256, msg, idOf, makeChat, fileText, seedFile, everything, sourceOf, lineFor, headerLine, trailerLine, readAll, snapshot, withFaults, breakHandle,
  createConversationStore, titleFor, TEXTS
} from './lib8b.mjs'

const check = checker()
const { BACKUP_FORMAT, BACKUP_VERSION, BACKUP_LIMITS, readBackup, writeBackup, chatText, contentKey } = backup
// A sabotaged module can make a block throw; that must show as a failed check and a summary line, not as a crashed run (tools/README.md).
const guard = async (name, fn) => { try { await fn() } catch (error) { check(`${name} did not run to its end: ${String(error?.stack ?? error).slice(0, 300)}`, false) } }
const text = (path) => fsp.readFile(path, 'utf8')
const exists = (path) => fsp.access(path).then(() => true, () => false)

// ============ A. what the file looks like ============
const base0 = join(tmpdir(), `frontier-v8b1-${randomUUID()}`)
await guard('A', async () => {
  const dir = join(base0, 'a', 'conversations')
  const chats = Array.from({ length: 12 }, (_, i) => makeChat(i))
  for (const chat of chats) await seedFile(dir, chat)
  const store = createConversationStore(dir)
  const file = join(base0, 'a', 'out', 'all.jsonl')
  await fsp.mkdir(join(base0, 'a', 'out'), { recursive: true })
  const written = await writeBackup(file, sourceOf(store, chats.map((c) => c.id)), NOW)
  check('writeBackup: 12 chats written, none left out', written.ok && written.count === 12 && written.leftOut === 0, JSON.stringify(written))
  check('writeBackup: no ".part" is left behind', !(await exists(`${file}.part`)))
  const raw = await text(file)
  const lines = raw.split('\n')
  check('the file is one line per chat between a header and a trailer, ends with a line break, and has nothing else', lines.length === 12 + 2 + 1 && lines[lines.length - 1] === '', `${lines.length} lines`)
  const header = JSON.parse(lines[0])
  check('line 1 is the header: format, version, the time it was made', same(header, { format: 'frontier-chats', version: 1, exportedAt: NOW }) && BACKUP_FORMAT === 'frontier-chats' && BACKUP_VERSION === 1)
  const parsed = lines.slice(1, 13).map((line) => JSON.parse(line))
  check('chat lines are numbered 1 to 12 and each has its own checksum, which is the SHA-256 of the chat as written', parsed.every((line, k) => line.n === k + 1 && line.sha256 === sha256(JSON.stringify(line.chat)) && /^[0-9a-f]{64}$/.test(line.sha256)))
  check('each chat is exactly its own file: version 3 and every field (id, title, dates, instructions, messages)', parsed.every((line) => same(Object.keys(line.chat), ['version', 'id', 'title', 'createdAt', 'updatedAt', 'instructions', 'messages']) && line.chat.version === 3))
  check('the last line says how many chats there are and how many saved files were left out', same(JSON.parse(lines[13]), { end: true, count: 12, leftOut: 0 }))
  check('it is plain text a person can read: every line is JSON and the messages are in it as written', raw.includes('Question 3:') && raw.includes('"role":"assistant"'))

  const { read, chats: got } = await readAll(file)
  check('readBackup: whole, 12 chats, none refused, header and last line understood', read.problem === null && read.complete && read.good === 12 && read.seen === 12 && read.refusedCount === 0 && read.header.exportedAt === NOW && same(read.trailer, { count: 12, leftOut: 0 }), JSON.stringify(read))
  const original = await everything(store)
  const gotSorted = [...got].sort((a, b) => (a.id < b.id ? -1 : 1))
  check('every chat comes back exactly as the store has it: dates, instructions, the failed and stopped replies, who answered, every kind of text', same(gotSorted, original))
  check('...in the order they were handed over', same(got.map((c) => c.id), chats.map((c) => c.id)))

  // one chat, and the left-out count
  const one = join(base0, 'a', 'out', 'one.jsonl')
  const w1 = await writeBackup(one, sourceOf(store, [chats[5].id], 0), NOW)
  const r1 = await readAll(one)
  check('a backup of one chat is the same format with one chat line', w1.ok && w1.count === 1 && r1.read.complete && r1.chats.length === 1 && same(r1.chats[0], original.find((c) => c.id === chats[5].id)))
  const withGone = join(base0, 'a', 'out', 'gone.jsonl')
  const w2 = await writeBackup(withGone, { ids: [chats[0].id, idOf(999), chats[1].id], leftOut: 2, load: async (id) => { const r = await store.load(id); return r.ok ? r.conversation : null } }, NOW)
  const r2 = await readAll(withGone)
  check('a chat that has gone by the time it is read is counted as left out, with the files that could not be read when the list was made', w2.ok && w2.count === 2 && w2.leftOut === 3 && r2.read.trailer.count === 2 && r2.read.trailer.leftOut === 3 && r2.read.complete)
  check('contentKey: the same chat gives the same key, a changed message, date or instruction does not', contentKey(chats[0]) === contentKey(structuredClone(chats[0])) && contentKey(chats[0]) !== contentKey({ ...chats[0], updatedAt: chats[0].updatedAt + 1 }) && contentKey(chats[0]) !== contentKey({ ...chats[0], instructions: 'x' }) && contentKey(chats[0]) !== contentKey({ ...chats[0], messages: [msg('user', 'other')] }) && contentKey(chats[0]) === contentKey({ ...chats[0], title: 'a different title' }))

  // the biggest chat the app can save, and a big one: the line limit is above them
  const heavy = Array.from({ length: 4 }, (_, k) => msg(k % 2 === 0 ? 'user' : 'assistant', String.fromCharCode(1).repeat(375_000), 'done', k % 2 ? { provider: 'anthropic', model: 'claude-opus-5-5' } : {}))
  const worst = { ...makeChat(50), messages: heavy, title: titleFor(heavy) }
  check('the worst case of what a chat can be (1.5 million control characters, 9 MB as a file) is under the line limit', Buffer.byteLength(fileText(worst)) < BACKUP_LIMITS.maxLineBytes && Buffer.byteLength(fileText(worst)) <= HISTORY_LIMITS.maxFileBytes, String(Buffer.byteLength(fileText(worst))))
  const worstDir = join(base0, 'a', 'worst')
  await seedFile(worstDir, worst)
  const worstStore = createConversationStore(worstDir)
  const worstFile = join(base0, 'a', 'out', 'worst.jsonl')
  const w3 = await writeBackup(worstFile, sourceOf(worstStore, [worst.id]), NOW)
  const r3 = await readAll(worstFile)
  check('the worst-case chat goes through a backup and comes back identical', w3.ok && r3.read.complete && r3.chats.length === 1 && same(r3.chats[0], (await worstStore.load(worst.id)).conversation), JSON.stringify(w3))
})

// ============ B. a damaged or partly written file ============
await guard('B', async () => {
  const dir = join(base0, 'b')
  await fsp.mkdir(dir, { recursive: true })
  const three = [makeChat(0), makeChat(3), makeChat(7)]
  const seedDir = join(dir, 'conversations')
  for (const chat of three) await seedFile(seedDir, chat)
  const store = createConversationStore(seedDir)
  const goodFile = join(dir, 'good.jsonl')
  await writeBackup(goodFile, sourceOf(store, three.map((c) => c.id)), NOW)
  const good = await fsp.readFile(goodFile)
  const originals = await everything(store)
  const byId = new Map(originals.map((c) => [c.id, c]))
  const cutFile = join(dir, 'cut.jsonl')
  const run = async (bytes) => { await fsp.writeFile(cutFile, bytes); return readAll(cutFile) }
  check('the small backup used below is whole and has three chats (and a non-ASCII one)', good.length > 1000 && good.length < 20_000 && (await readAll(goodFile)).read.complete && /[^\x00-\x7f]/.test(good.toString('utf8')), String(good.length))

  // 1. cut at EVERY byte: it never throws, what comes out is the first chats exactly as they were, and it says so unless the cut is at the very end
  let thrown = 0, notPrefix = 0, wrongClaim = 0, notMonotone = 0, previous = 0
  for (let length = 0; length <= good.length; length += 1) {
    let result
    try { result = await run(good.subarray(0, length)) } catch { thrown += 1; continue }
    const { read, chats } = result
    if (!chats.every((chat, k) => same(chat, three.map((c) => byId.get(c.id))[k]))) notPrefix += 1
    const wholeEnough = length >= good.length - 1 // the final line break is not part of the last line
    if (wholeEnough ? !(read.complete && read.problem === null) : read.complete) wrongClaim += 1
    if (chats.length < previous) notMonotone += 1
    previous = chats.length
  }
  check(`cut at each of the ${good.length + 1} lengths: never an exception`, thrown === 0, `${thrown}`)
  check('...what comes out is always the first chats, exactly as they were (never a half chat)', notPrefix === 0, `${notPrefix} cuts`)
  check('...it says "whole" only when nothing but the last line break is missing, and a cut before the header is "not a backup"', wrongClaim === 0, `${wrongClaim} cuts`)
  check('...a longer cut never gives back fewer chats than a shorter one', notMonotone === 0)

  // 2. change EVERY byte: no changed chat ever comes out; a change is noticed unless it is in a number that carries no chat
  const headerEnd = good.indexOf(0x0a)
  const stamp = String(NOW)
  const stampAt = good.toString('latin1').indexOf(stamp)
  const lastStart = good.lastIndexOf(0x0a, good.length - 2) + 1
  const leftOutAt = good.toString('latin1').indexOf('"leftOut":', lastStart) + '"leftOut":'.length
  let thrown2 = 0, changed = 0
  const silent = []
  for (let at = 0; at < good.length; at += 1) {
    const copy = Buffer.from(good)
    copy[at] ^= 0x01
    let result
    try { result = await run(copy) } catch { thrown2 += 1; continue }
    const { read, chats } = result
    if (chats.some((chat) => !same(chat, byId.get(chat.id)))) changed += 1
    const noticed = read.problem !== null || !read.complete || read.refusedCount > 0 || chats.length < 3
    if (!noticed) silent.push(at)
  }
  check(`one changed byte at each of ${good.length} places: never an exception`, thrown2 === 0, `${thrown2}`)
  check('...never gives back a chat that is not exactly one of the originals (a changed message cannot be restored)', changed === 0, `${changed} places`)
  // The places a change can pass unnoticed because they carry no chat: the time it was made, the left-out count, and the line break that ends the file.
  const harmless = (at) => (at >= stampAt && at < stampAt + stamp.length) || (at >= leftOutAt && at < leftOutAt + 1) || at === good.length - 1
  check('...every change is noticed (refused chat, not whole, not a backup) except in the time the backup says it was made, the left-out count and the last line break, which carry no chat', silent.every(harmless), `silent at ${silent.filter((at) => !harmless(at)).join(',')}`)
  check('...and that harmless place is real: changing the time still gives a whole backup (the check above is not just blind)', silent.length > 0 && silent.every(harmless))

  // 3. things that are not backups, and whole-file problems
  const notBackup = async (name, bytes, expect = /not a Frontier chat backup/) => {
    const { read, chats } = await run(bytes)
    check(`${name}: not a backup, with a sentence, and nothing comes out`, read.problem !== null && expect.test(read.problem) && chats.length === 0 && read.header === null, JSON.stringify(read.problem))
  }
  await notBackup('an empty file', Buffer.alloc(0), /empty/)
  await notBackup('a file of one line break', Buffer.from('\n'))
  await notBackup('random bytes (5 MB)', (await import('node:crypto')).randomBytes(5 * 1024 * 1024))
  await notBackup('plain words', Buffer.from('hello, this is a letter, not a backup\n'))
  await notBackup('a PNG header', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]))
  await notBackup('a chat file of the app (one JSON object)', Buffer.from(fileText(three[0])))
  await notBackup('a usage ledger line', Buffer.from('{"v":1,"type":"begin","id":"x"}\n'))
  await notBackup('a JSON array', Buffer.from('[1,2,3]\n'))
  await notBackup('JSON null', Buffer.from('null\n'))
  await notBackup('another format name', Buffer.from(`${JSON.stringify({ format: 'something-else', version: 1, exportedAt: NOW })}\n`))
  for (const [name, exportedAt] of [['a text time', 'now'], ['a negative time', -1], ['a fractional time', 1.5], ['a missing time', undefined], ['a huge time', 1e300]]) {
    await notBackup(`a header with ${name}`, Buffer.from(`${JSON.stringify({ format: BACKUP_FORMAT, version: 1, exportedAt })}\n`))
  }
  // version 2 is a backup with attached files since 9.5 (D-037); version 3 is a newer app's
  await notBackup('a header of version 4 (made by a newer app; 2 holds files since 9.5, 3 projects and notes since 10.7)', Buffer.from(`${JSON.stringify({ format: BACKUP_FORMAT, version: 4, exportedAt: NOW })}\n`), /another version of the app/)
  await notBackup('a header of version "1" as text', Buffer.from(`${JSON.stringify({ format: BACKUP_FORMAT, version: '1', exportedAt: NOW })}\n`), /another version of the app/)
  check('a header and nothing else: a backup with no chats and no end, so not whole', await (async () => { const { read } = await run(Buffer.from(`${headerLine()}\n`)); return read.problem === null && read.header !== null && read.good === 0 && !read.complete && read.trailer === null })())
  check('a header and an end line: a whole backup of nothing', await (async () => { const { read } = await run(Buffer.from(`${headerLine()}\n${trailerLine(0)}\n`)); return read.problem === null && read.complete && read.good === 0 })())
  const missing = await readBackup(join(dir, 'nope.jsonl'), () => undefined)
  check('a file that is not there: "That file is not there."', missing.problem === 'That file is not there.', JSON.stringify(missing.problem))
  const folder = await readBackup(dir, () => undefined)
  check('a folder is not a file', folder.problem !== null && folder.header === null, JSON.stringify(folder.problem))

  // 4. well-formed but altered or odd
  const goodLines = good.toString('utf8').split('\n')
  const lineOf = (k) => goodLines[k] // 0 header, 1..3 chats, 4 trailer
  const files = {
    crlf: goodLines.join('\r\n'),
    bom: String.fromCharCode(0xfeff) + goodLines.join('\n')
  }
  for (const [name, content] of Object.entries(files)) {
    const { read, chats } = await run(Buffer.from(content, 'utf8'))
    check(`${name === 'crlf' ? 'Windows line breaks (CR LF)' : 'a byte-order mark at the start'} are tolerated: whole, three chats`, read.complete && chats.length === 3 && read.problem === null)
  }
  {
    const { read, chats } = await run(Buffer.from([lineOf(0), lineOf(1), lineOf(3), lineOf(4), ''].join('\n')))
    check('a chat line deleted from the middle: the other chats come out and the file is NOT whole (the numbering and the count say so)', read.problem === null && chats.length === 2 && !read.complete && read.trailer.count === 3)
  }
  {
    const { read, chats } = await run(Buffer.from([lineOf(0), lineOf(1), lineOf(1), lineOf(2), lineOf(3), lineOf(4), ''].join('\n')))
    check('a chat line repeated: not whole', chats.length === 4 && !read.complete)
  }
  {
    const { read, chats } = await run(Buffer.from([lineOf(0), lineOf(2), lineOf(1), lineOf(3), lineOf(4), ''].join('\n')))
    check('chat lines out of order: the chats still come out, but the file is not whole', chats.length === 3 && !read.complete)
  }
  {
    const { read, chats } = await run(Buffer.from([lineOf(0), lineOf(1), lineOf(2), lineOf(3), lineOf(4), lineOf(1), ''].join('\n')))
    check('a chat line after the end line is not read (two backups joined, or something appended): not whole', chats.length === 3 && !read.complete && read.refusedCount === 1 && /after the end/.test(read.refused[0].why), JSON.stringify(read.refused))
  }
  {
    const { read, chats } = await run(Buffer.from([lineOf(0), lineOf(1), lineOf(2), lineOf(3), lineOf(4), 'garbage', ''].join('\n')))
    check('garbage after the end line: not whole, and the garbage is not counted as a chat', chats.length === 3 && !read.complete && read.seen === 3)
  }
  {
    const tampered = lineOf(2).replace('Question 3', 'Question 4')
    const { read, chats } = await run(Buffer.from([lineOf(0), lineOf(1), tampered, lineOf(3), lineOf(4), ''].join('\n')))
    check('a message edited by hand (the checksum no longer fits): that chat is refused, named by its line, the others are fine', chats.length === 2 && read.refusedCount === 1 && read.refused[0].line === 3 && /checksum/.test(read.refused[0].why), JSON.stringify(read.refused))
  }
  {
    const { read, chats } = await run(Buffer.from([lineOf(0), lineOf(1), lineOf(2).replace(/"sha256":"[0-9a-f]{64}"/, `"sha256":"${'0'.repeat(64)}"`), lineOf(3), lineOf(4), ''].join('\n')))
    check('a wrong checksum with the right chat: refused too (the chat is trusted only with its checksum)', chats.length === 2 && read.refusedCount === 1)
  }
  for (const [name, replacement] of [['upper-case hex', (h) => h.toUpperCase()], ['a short one', (h) => h.slice(0, 63)], ['a number', () => '5'], ['missing', null]]) {
    const edited = lineOf(2).replace(/"sha256":"([0-9a-f]{64})"/, (_m, h) => (replacement === null ? '"x":0' : `"sha256":${name === 'a number' ? '5' : `"${replacement(h)}"`}`))
    const { read, chats } = await run(Buffer.from([lineOf(0), lineOf(1), edited, lineOf(3), lineOf(4), ''].join('\n')))
    check(`a checksum that is ${name}: the chat is refused`, chats.length === 2 && read.refusedCount === 1)
  }
  {
    const broken = Buffer.from(lineOf(2))
    const at = broken.indexOf(Buffer.from('Question'))
    broken[at] = 0xff // not UTF-8
    const { read, chats } = await run(Buffer.concat([Buffer.from([lineOf(0), lineOf(1), ''].join('\n')), broken, Buffer.from(['', lineOf(3), lineOf(4), ''].join('\n'))]))
    check('a line that is not valid UTF-8 is refused as unreadable text; the lines either side are read', chats.length === 2 && read.refusedCount === 1 && /not readable text/.test(read.refused[0].why), JSON.stringify(read.refused))
  }

  // 5. well-formed lines holding something the app would never save: only the strict reader can refuse these (the checksum is right)
  const base3 = makeChat(2)
  const refusedChat = async (name, chat) => {
    const { read, chats } = await run(Buffer.from([headerLine(), lineFor(1, chat), trailerLine(1), ''].join('\n')))
    check(`a chat with ${name}: refused with a reason, not added, the rest of the file unaffected`, chats.length === 0 && read.refusedCount === 1 && typeof read.refused[0].why === 'string' && read.refused[0].why.length > 5, JSON.stringify(read.refused))
  }
  const v3 = (extra) => ({ version: 3, ...base3, ...extra })
  await refusedChat('a version of 9', v3({ version: 9 }))
  await refusedChat('no version', (({ version, ...rest }) => rest)(v3({})))
  await refusedChat('a title that is not text', v3({ title: 5 }))
  await refusedChat('a title of 201 characters', v3({ title: 'x'.repeat(201) }))
  await refusedChat('a negative date', v3({ createdAt: -1 }))
  await refusedChat('a fractional date', v3({ updatedAt: 1.5 }))
  await refusedChat('a date as text', v3({ createdAt: '2026' }))
  await refusedChat('instructions of 8001 characters', v3({ instructions: 'x'.repeat(8001) }))
  await refusedChat('no instructions field in a version 3 file', (({ instructions, ...rest }) => rest)(v3({})))
  await refusedChat('no messages', v3({ messages: [] }))
  await refusedChat('messages that are not a list', v3({ messages: 'x' }))
  await refusedChat('a reply first', v3({ messages: [msg('assistant', 'hi', 'done', { provider: 'anthropic', model: 'x' })] }))
  await refusedChat('a message of a made-up role', v3({ messages: [msg('system', 'hi')] }))
  await refusedChat('a message with a made-up status', v3({ messages: [msg('user', 'hi', 'weird')] }))
  await refusedChat('a message of only spaces from the person', v3({ messages: [msg('user', '   ')] }))
  await refusedChat('a message of 400,001 characters', v3({ messages: [msg('user', 'x'.repeat(400_001))] }))
  await refusedChat('2001 messages', v3({ messages: Array.from({ length: 2001 }, (_, k) => msg(k % 2 ? 'assistant' : 'user', 'x')) }))
  await refusedChat('an error text of 2001 characters', v3({ messages: [msg('user', 'q'), msg('assistant', '', 'error', { error: 'e'.repeat(2001) })] }))
  await refusedChat('an upper-case id', v3({ id: 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA' }))
  await refusedChat('an id that climbs out of a folder', v3({ id: '../../x' }))
  await refusedChat('an id of a number', v3({ id: 5 }))
  for (const [name, chat] of [['a string', 'x'], ['null', null], ['a number', 5], ['a list', [1]]]) {
    const { read, chats } = await run(Buffer.from([headerLine(), `{"n":1,"sha256":"${sha256(JSON.stringify(chat))}","chat":${JSON.stringify(chat)}}`, trailerLine(1), ''].join('\n')))
    check(`a chat line whose chat is ${name}: refused`, chats.length === 0 && read.refusedCount === 1)
  }
  check('a line that is not an object (a number, a list, null, text) is refused as a chat line', await (async () => { const { read } = await run(Buffer.from([headerLine(), '5', '[1]', 'null', '"x"', trailerLine(4), ''].join('\n'))); return read.refusedCount === 4 && read.good === 0 && read.complete })())
  {
    // a chat of version 1 and 2 inside a backup is read as the app reads such a file
    const old1 = { version: 1, id: idOf(61), title: 'old', createdAt: 5, updatedAt: 6, messages: [msg('user', 'hello'), msg('assistant', 'hi')] }
    const old2 = { version: 2, id: idOf(62), title: 'old2', createdAt: 5, updatedAt: 6, messages: [msg('user', 'hello'), msg('assistant', 'hi', 'done', { provider: 'openai', model: 'gpt-6.1-sol' })] }
    const { read, chats } = await run(Buffer.from([headerLine(), lineFor(1, old1), lineFor(2, old2), trailerLine(2), ''].join('\n')))
    check('chats of version 1 and 2 are read as the app reads its own old files (no instructions; a version 1 reply is Anthropic\'s)', read.complete && chats.length === 2 && chats[0].instructions === '' && chats[0].messages[1].provider === 'anthropic' && chats[0].messages[1].model === null && chats[1].messages[1].model === 'gpt-6.1-sol')
  }
  {
    // hostile keys and extra fields: only what the app knows is kept
    const hostile = `{"version":3,"id":"${idOf(63)}","title":"t","createdAt":1,"updatedAt":2,"instructions":"","messages":[{"role":"user","content":"hi","status":"done","__proto__":{"role":"assistant"},"evil":{"a":1}}],"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}},"extra":[1,2,3]}`
    const { read, chats } = await run(Buffer.from([headerLine(), lineFor(1, hostile), trailerLine(1), ''].join('\n')))
    check('"__proto__", "constructor" and extra fields in a chat change nothing and are not kept', read.complete && chats.length === 1 && !('polluted' in {}) && !Object.hasOwn(chats[0], 'extra') && !Object.hasOwn(chats[0], '__proto__') && same(Object.keys(chats[0].messages[0]), ['role', 'content', 'status']) && chats[0].messages[0].role === 'user', JSON.stringify(chats[0]))
  }
  {
    // the caps
    const old = { ...BACKUP_LIMITS }
    try {
      const body = [makeChat(1), makeChat(2), makeChat(3), makeChat(4), makeChat(5)].map((c, k) => lineFor(k + 1, { version: 3, ...c }))
      BACKUP_LIMITS.maxChats = 3
      const r = await run(Buffer.from([headerLine(), ...body, trailerLine(5), ''].join('\n')))
      check('more chat lines than the cap: reading stops at the cap, says so, and the file is not whole', r.chats.length === 3 && r.read.tooMany && !r.read.complete && r.read.seen === 3)
      BACKUP_LIMITS.maxChats = 5
      const r5 = await run(Buffer.from([headerLine(), ...body, trailerLine(5), ''].join('\n')))
      check('exactly the cap is fine: the end line is not mistaken for one chat too many', r5.chats.length === 5 && !r5.read.tooMany && r5.read.complete)
      BACKUP_LIMITS.maxChats = old.maxChats
      BACKUP_LIMITS.maxFileBytes = 500
      const big = await run(Buffer.from([headerLine(), ...body, trailerLine(5), ''].join('\n')))
      check('a file over the size cap is not read at all', big.read.problem !== null && /too large/.test(big.read.problem) && big.chats.length === 0)
    } finally {
      Object.assign(BACKUP_LIMITS, old)
    }
    const thousand = Array.from({ length: 1001 }, (_, k) => lineFor(k + 1, { version: 3, ...makeChat(k, { id: idOf(1000 + k) }) }))
    const r = await run(Buffer.from([headerLine(), ...thousand, trailerLine(1001), ''].join('\n')))
    check('the real cap: 1001 chat lines give 1000 chats, "too many", not whole', r.chats.length === 1000 && r.read.tooMany && !r.read.complete, `${r.chats.length}`)
    const exact = await run(Buffer.from([headerLine(), ...thousand.slice(0, 1000), trailerLine(1000), ''].join('\n')))
    check('and 1000 chat lines are whole', exact.chats.length === 1000 && exact.read.complete && !exact.read.tooMany)
  }
})

// ============ C. nothing fills the memory ============
await guard('C', async () => {
  const dir = join(base0, 'c')
  await fsp.mkdir(dir, { recursive: true })
  const file = join(dir, 'junk.jsonl')
  const first = lineFor(1, { version: 3, ...makeChat(1) })
  const last = lineFor(2, { version: 3, ...makeChat(2) })
  const handle = await fsp.open(file, 'w')
  await handle.write(`${headerLine()}\n${first}\n`)
  const piece = Buffer.alloc(1024 * 1024, 0x61) // "a"
  for (let k = 0; k < 160; k += 1) await handle.write(piece) // one line of 160 MB with no line break in it
  await handle.write(`\n${last}\n${trailerLine(3)}\n`)
  await handle.close()
  const size = statSync(file).size
  let peak = 0
  const baseline = process.memoryUsage().rss
  const timer = setInterval(() => { peak = Math.max(peak, process.memoryUsage().rss) }, 10)
  const t0 = performance.now()
  const { read, chats } = await readAll(file)
  clearInterval(timer)
  const grew = Math.max(peak, process.memoryUsage().rss) - baseline
  check(`a ${Math.round(size / 1048576)} MB file with one line of 160 MB is read in ${Math.round(performance.now() - t0)} ms: the huge line is refused as larger than any chat, the chats either side are read, and it is not whole`, read.problem === null && chats.length === 2 && read.refusedCount === 1 && /larger than any chat/.test(read.refused[0].why) && !read.complete, JSON.stringify(read.refused))
  check(`...and the memory used grew by ${Math.round(grew / 1048576)} MB, not by the size of the line (limit 80 MB)`, grew < 80 * 1048576, `${Math.round(grew / 1048576)} MB`)
  await fsp.rm(file, { force: true })
})

// ============ D. writing, in a normal folder and in the EFS one ============
for (const [where, base] of [['tmp', join(tmpdir(), `frontier-v8b1w-${randomUUID()}`)], ['EFS', join(scratch('v8b1'), randomUUID())]]) {
  const T = (name) => `[${where}] ${name}`
  await guard(`D ${where}`, async () => {
    const seedDir = join(base, 'conversations')
    const chats = Array.from({ length: 6 }, (_, i) => makeChat(i))
    for (const chat of chats) await seedFile(seedDir, chat)
    const store = createConversationStore(seedDir)
    const out = join(base, 'out')
    await fsp.mkdir(out, { recursive: true })
    const ids = chats.map((c) => c.id)
    const OLD = 'THE OLD BACKUP, which must not be lost unless a whole new one is there'
    const target = join(out, 'backup.jsonl')
    const fresh = async () => { await fsp.writeFile(target, OLD); await fsp.rm(`${target}.part`, { force: true }) }
    const untouched = async () => (await text(target)) === OLD

    await fresh()
    const ok = await writeBackup(target, sourceOf(store, ids), NOW)
    const back = await readAll(target)
    check(T('a backup replaces the old file at the place chosen, and reads back whole'), ok.ok && back.read.complete && back.chats.length === 6 && !(await exists(`${target}.part`)))

    await fresh()
    await withFaults(() => ({ open: async () => { throw Object.assign(new Error('no space left on device'), { code: 'ENOSPC' }) } }), async () => {
      let threw = false
      try { await writeBackup(target, sourceOf(store, ids), NOW) } catch { threw = true }
      check(T('the new file cannot be made (disk full): it throws, the old file is exactly as it was'), threw && (await untouched()))
    })
    check(T('...and no ".part" is left'), !(await exists(`${target}.part`)))

    await fresh()
    let calls = 0
    await withFaults((saved) => breakHandle(saved, '.part', 'write', async (original, ...args) => { calls += 1; if (calls === 3) throw Object.assign(new Error('the disk went away'), { code: 'EIO' }); return original(...args) }), async () => {
      let threw = false
      try { await writeBackup(target, sourceOf(store, ids), NOW) } catch { threw = true }
      check(T('a write that fails half way: it throws, and the old file is exactly as it was'), threw && (await untouched()))
    })
    check(T('...the half-written ".part" is removed'), !(await exists(`${target}.part`)))

    await fresh()
    await withFaults((saved) => breakHandle(saved, '.part', 'sync', async () => { throw Object.assign(new Error('flush failed'), { code: 'EIO' }) }), async () => {
      let threw = false
      try { await writeBackup(target, sourceOf(store, ids), NOW) } catch { threw = true }
      check(T('a flush that fails: it throws, old file intact, no ".part"'), threw && (await untouched()) && !(await exists(`${target}.part`)))
    })

    await fresh()
    calls = 0
    await withFaults((saved) => breakHandle(saved, '.part', 'write', async (original, line, ...rest) => { calls += 1; return original(calls === 3 ? String(line).replace('Question', 'Questi0n') : line, ...rest) }), async () => {
      const result = await writeBackup(target, sourceOf(store, ids), NOW)
      check(T('a write that silently changes a byte: found by reading the new file back, refused, "not kept"'), !result.ok && /read back correctly/.test(result.error), JSON.stringify(result))
    })
    check(T('...the old file is exactly as it was and no ".part" is left'), (await untouched()) && !(await exists(`${target}.part`)))

    await fresh()
    await withFaults(() => ({ copyFile: async () => { throw Object.assign(new Error('access denied'), { code: 'EPERM' }) } }), async () => {
      const result = await writeBackup(target, sourceOf(store, ids), NOW)
      check(T('the copy over the old file fails: not ok, and the error names the whole ".part"'), !result.ok && result.error.includes(`${target}.part`), JSON.stringify(result))
    })
    check(T('...the old file is as it was and the ".part" is a whole backup (6 chats)'), (await untouched()) && (await readAll(`${target}.part`)).read.complete)

    await fresh()
    await withFaults((saved) => ({ copyFile: async (from, to) => { const bytes = await saved.readFile(from); await saved.writeFile(to, bytes.subarray(0, bytes.length - 700)) } }), async () => {
      const result = await writeBackup(target, sourceOf(store, ids), NOW)
      check(T('a copy that comes out short: found by reading it back; the error names the whole ".part"'), !result.ok && result.error.includes(`${target}.part`) && /could not be read back/.test(result.error), JSON.stringify(result))
    })
    check(T('...the ".part" is whole'), (await readAll(`${target}.part`)).read.complete)

    await fresh()
    await withFaults((saved) => ({ rm: async (path, ...rest) => { if (String(path).endsWith('.part')) throw new Error('locked'); return saved.rm(path, ...rest) } }), async () => {
      const result = await writeBackup(target, sourceOf(store, ids), NOW)
      check(T('a ".part" that cannot be removed afterwards: still a success (it only repeats the file)'), result.ok && (await readAll(target)).read.complete)
    })

    await fresh()
    {
      let threw = false
      try { await writeBackup(target, { ids, leftOut: 0, load: async (id) => { if (id === ids[3]) throw new Error('the store failed'); return (await store.load(id)).conversation } }, NOW) } catch { threw = true }
      check(T('a chat that cannot be read in the middle of the backup (the store throws): it throws, old file intact, no ".part"'), threw && (await untouched()) && !(await exists(`${target}.part`)))
    }

    await fresh()
    {
      const old = BACKUP_LIMITS.maxFileBytes
      BACKUP_LIMITS.maxFileBytes = 3000
      try {
        const result = await writeBackup(target, sourceOf(store, ids), NOW)
        check(T('more chats than one file may hold: refused with a sentence, nothing written'), !result.ok && /too large for one backup/.test(result.error) && (await untouched()) && !(await exists(`${target}.part`)), JSON.stringify(result))
      } finally {
        BACKUP_LIMITS.maxFileBytes = old
      }
    }

    {
      const missingFolder = join(base, 'no-such-folder', 'backup.jsonl')
      let threw = false
      try { await writeBackup(missingFolder, sourceOf(store, ids), NOW) } catch { threw = true }
      check(T('a folder that is not there: it throws (the caller says so), and nothing is made'), threw && !(await exists(missingFolder)) && !(await exists(`${missingFolder}.part`)))
    }

    {
      // a crash in the middle of a write (the process dies): the old file is untouched by anything before the copy, and a whole ".part" is there once the copy began
      const before = await snapshot(seedDir)
      await fresh()
      await writeBackup(target, sourceOf(store, ids), NOW)
      check(T('writing a backup never changes the saved chats it reads'), before === (await snapshot(seedDir)))
    }
  })
  await fsp.rm(base, { recursive: true, force: true })
}

await fsp.rm(base0, { recursive: true, force: true })
const passed = check.summary()
process.exit(passed ? 0 : 1)
