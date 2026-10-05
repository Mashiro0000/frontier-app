// Slices 8b.3 and 8b.4 under plain Node (no window): encrypting the saved chats, and what happens when the key cannot be read (D-035).
//  A. the envelope an encrypted file holds (chatFile.ts): nothing readable in it, what opens and what does not, the sizes.
//  B. the choice and its rule for writing (chatProtection.ts): the file, every kind of damage (never "plain", never "encrypted": a refusal), a lost key, a computer with no
//     secure storage, turning on with a storage that does not work, and that NOTHING is ever encrypted while writing is refused (no new key behind the owner's back).
//  C. the store (conversationStore.ts): turning it on and off rewrites every chat, byte for byte back to what it was; saves, restores and conversions obey the rule;
//     files that cannot be opened are left exactly as they are and counted; crashes and disk faults in the middle; a plain copy never hides behind an encrypted ".tmp".
//  D. the flow (chatEncryptionService.ts): the backup first, made and checked before anything changes; cancel; a backup that cannot be made; one thing at a time; the
//     question before going back to plain files; the lost key end to end (nothing written, nothing changed, the way out through the backup, and the key coming back).
//  E. what the source must keep true.
// The operating system's secure storage is a stand-in that behaves like the real one where it matters (lib8b3.mjs: a blob made under another key does not open, and it
// can lose its key). Every file check runs in a normal folder and in the EFS-encrypted %APPDATA% (D-010).
// Run: node tools/verify-8b-3.mjs      (QUICK=1: the normal folder only, for the negative controls)
import { checker } from './cdp.mjs'
import { promises as fsp, readFileSync, readdirSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { REPO } from './paths.mjs'
import { scratch } from './drive.mjs'
import {
  backup, service, chatFile, protectionMod, encMod, makeBox, flipInData, HISTORY_LIMITS, NOW, same, msg, idOf, makeChat, fileText, seedFile, readAll, snapshot, sleep, withFaults,
  createConversationStore
} from './lib8b3.mjs'

const check = checker()
const { BLOCKED, CHECK_TEXT, createChatProtection, parseSettingFile } = protectionMod
const { createChatEncryptionService, plainQuestion, NO_SECURE_STORAGE } = encMod
const { createBackupService, BEFORE_ENCRYPTING_TITLE } = service
// A sabotaged module can make a block throw; that must show as a failed check and a summary line, not as a crashed run (tools/README.md).
const guard = async (name, fn) => { try { await fn() } catch (error) { check(`${name} did not run to its end: ${String(error?.stack ?? error).slice(0, 300)}`, false) } }
const text = (path) => fsp.readFile(path, 'utf8')
const exists = (path) => fsp.access(path).then(() => true, () => false)
const throws = async (fn) => { try { await fn(); return false } catch { return true } }
const src = (name) => readFileSync(join(REPO, 'src', name), 'utf8')
const isEnv = (path) => { try { return chatFile.isEnvelope(JSON.parse(readFileSync(path, 'utf8'))) } catch { return false } }
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/
// A reply the way the app saves one: it says who wrote it (a version 3 file whose reply does not is not readable).
const reply = (content) => msg('assistant', content, 'done', { provider: 'anthropic', model: 'claude-opus-5-5' })

// ============ A. the envelope ============
await guard('A', async () => {
  const box = makeBox()
  const chat = makeChat(3)
  const plain = fileText(chat)
  const sealed = chatFile.sealChat(plain, box)
  const env = JSON.parse(sealed)
  check('A: a sealed chat is one JSON object with a format, a v and base64 data, and nothing else', same(Object.keys(env), ['format', 'v', 'data']) && env.format === 'frontier-chat-encrypted' && env.v === 1 && BASE64.test(env.data), sealed.slice(0, 80))
  check('A: nothing of the chat is readable in it: not the title, a message, the instructions, the id, a date or the word "version"', ![chat.title, chat.messages[0].content.slice(0, 12), 'Be brief', chat.id, String(chat.createdAt), 'Question', 'version'].some((s) => sealed.includes(s)))
  check('A: every sealed file begins with SEALED_PREFIX (what the store looks at before it reads a file bigger than a plain one may be)', sealed.startsWith(chatFile.SEALED_PREFIX) && chatFile.SEALED_PREFIX === '{"format":"frontier-chat-encrypted"')
  const opened = chatFile.openChat(env, box)
  check('A: it opens to exactly the text it was made from', opened.ok && opened.text === plain)
  check('A: sealing the same chat twice gives two different texts (a fresh nonce each time), and both open', chatFile.sealChat(plain, box) !== sealed && chatFile.openChat(JSON.parse(chatFile.sealChat(plain, box)), box).text === plain)
  const other = makeBox()
  const wrong = chatFile.openChat(env, other)
  check('A: under another key it does NOT open: a result with a reason, never an exception and never wrong text', !wrong.ok && /could not be opened with the key/.test(wrong.why), JSON.stringify(wrong))
  box.available = false
  const nostore = chatFile.openChat(env, box)
  box.available = true
  check('A: with no secure storage it does not open, and says why', !nostore.ok && /no secure storage/.test(nostore.why), JSON.stringify(nostore))
  check('A: a store with no box at all cannot open it either', !chatFile.openChat(env, undefined).ok)
  const bad = [['v 2', { ...env, v: 2 }], ['no v', { format: env.format, data: env.data }], ['no data', { format: env.format, v: 1 }], ['empty data', { ...env, data: '' }], ['data that is not base64', { ...env, data: 'not base64 !!' }],
    ['data that is a number', { ...env, data: 5 }], ['data too long', { ...env, data: 'A'.repeat(chatFile.MAX_DATA_CHARS + 4) }], ['data with a space', { ...env, data: env.data.slice(0, 10) + ' ' + env.data.slice(10) }]]
  for (const [name, value] of bad) {
    const r = chatFile.openChat(value, box)
    check(`A: an envelope with ${name} is refused as a FORMAT this version cannot read (not "the key does not open it", and not an exception)`, !r.ok && /cannot read/.test(r.why), JSON.stringify(r))
  }
  const flipped = chatFile.openChat(JSON.parse(flipInData(sealed)), box)
  check('A: a flipped character inside the data is refused too, as a file the key does not open (it is still valid JSON and valid base64: only the secure storage can tell)', !flipped.ok && /could not be opened with the key/.test(flipped.why), JSON.stringify(flipped))
  check('A: isEnvelope: an object with the format is one; a list, null, text, another format and {} are not', chatFile.isEnvelope(env) && chatFile.isEnvelope({ format: 'frontier-chat-encrypted' }) && ![[], null, 'x', 5, { format: 'other' }, {}, { version: 3, id: 'x' }].some((v) => chatFile.isEnvelope(v)))
  check('A: opensTo is true only for the text it was made from, under the key it was made with', chatFile.opensTo(sealed, plain, box) && !chatFile.opensTo(sealed, plain + ' ', box) && !chatFile.opensTo('garbage', plain, box) && !chatFile.opensTo(sealed, plain, other) && !chatFile.opensTo(plain, plain, box))
  const biggest = chatFile.sealChat('a'.repeat(HISTORY_LIMITS.maxFileBytes), box)
  check('A: a chat of the largest size a file may hold seals to a file within the limit for encrypted files, which is bigger than the limit for plain ones', biggest.length <= chatFile.MAX_ENCRYPTED_FILE_BYTES && chatFile.MAX_ENCRYPTED_FILE_BYTES > HISTORY_LIMITS.maxFileBytes && chatFile.openChat(JSON.parse(biggest), box).ok, `${biggest.length} <= ${chatFile.MAX_ENCRYPTED_FILE_BYTES}`)
})

for (const [where, base] of [['tmp', join(tmpdir(), `frontier-v8b3-${randomUUID()}`)], ['EFS', join(scratch('v8b3'), randomUUID())]].slice(0, process.env.QUICK === '1' ? 1 : 2)) {
  const T = (name) => `[${where}] ${name}`

  // ============ B. the choice and its rule ============
  await guard(`B ${where}`, async () => {
    const dir = join(base, 'b-setting')
    await fsp.mkdir(dir, { recursive: true })
    const file = join(dir, 'chat-encryption.json')
    const box = makeBox()
    const mk = (b = box) => createChatProtection({ box: b, pathOf: () => file })
    const p = mk()
    let s = await p.state()
    check(T('B: no file: the choice is "off", plain files, saving is not blocked, and writes are plain'), s.choice === 'off' && s.keyUsable === null && s.blocked === null && s.canEncrypt && same(await p.writeMode(), { form: 'plain' }), JSON.stringify(s))
    await p.turnOn()
    const onText = await text(file)
    const parsed = JSON.parse(onText)
    check(T('B: turning it on writes {"version":1,"encrypt":true,"check":...} and nothing else'), same(Object.keys(parsed), ['version', 'encrypt', 'check']) && parsed.version === 1 && parsed.encrypt === true && BASE64.test(parsed.check), onText)
    check(T('B: the check is the secure storage\'s blob of a known text: it opens to that text, and the text is not readable in the file'), box.decrypt(Buffer.from(parsed.check, 'base64')) === CHECK_TEXT && !onText.includes(CHECK_TEXT))
    s = await p.state()
    check(T('B: the state is "on", the key usable, nothing blocked, and writes are encrypted'), s.choice === 'on' && s.keyUsable === true && s.blocked === null && same(await p.writeMode(), { form: 'encrypted' }), JSON.stringify(s))
    check(T('B: a new protection over the same file (a restart) says the same'), same(await mk().state(), s))
    await p.turnOff()
    check(T('B: turning it off writes {"version":1,"encrypt":false}, and writes are plain again'), (await text(file)) === '{"version":1,"encrypt":false}' && same(await p.writeMode(), { form: 'plain' }) && (await p.state()).choice === 'off')
    check(T('B: parseSettingFile and settingFileText agree on both shapes, and a byte-order mark is tolerated'), same(parseSettingFile(protectionMod.settingFileText({ choice: 'off' })), { choice: 'off' }) && same(parseSettingFile(protectionMod.settingFileText({ choice: 'on', check: parsed.check })), { choice: 'on', check: parsed.check }) && parseSettingFile(String.fromCharCode(0xfeff) + '{"version":1,"encrypt":false}').choice === 'off')

    // damage never means "plain" and never means "encrypted": it means "ask"
    const damaged = [['not JSON', 'this is not json'], ['empty', ''], ['a list', '[]'], ['null', 'null'], ['an empty object', '{}'], ['another version', '{"version":2,"encrypt":false}'], ['encrypt spelled as text', '{"version":1,"encrypt":"yes"}'],
      ['encrypt: 1', '{"version":1,"encrypt":1}'], ['on with no check', '{"version":1,"encrypt":true}'], ['a check that is not base64', '{"version":1,"encrypt":true,"check":"not base64!!"}'], ['an empty check', '{"version":1,"encrypt":true,"check":""}'],
      ['a check that is a number', '{"version":1,"encrypt":true,"check":5}'], ['a check far too long', JSON.stringify({ version: 1, encrypt: true, check: 'A'.repeat(5000) })], ['a file far too big', ' '.repeat(9000) + '{"version":1,"encrypt":false}'], ['a file cut off', onText.slice(0, 30)]]
    for (const [name, content] of damaged) {
      await fsp.writeFile(file, content)
      const q = mk()
      const st = await q.state()
      const wm = await q.writeMode()
      check(T(`B: damage (${name}): "unreadable", saving blocked with the sentence, and the write mode is a REFUSAL: not "plain", not "encrypted"`), st.choice === 'unreadable' && st.blocked === BLOCKED.setting && st.keyUsable === null && 'refused' in wm && wm.refused === BLOCKED.setting && !('form' in wm), JSON.stringify({ st, wm }))
    }
    // the person's own choice replaces a damaged file, in either direction
    const healer = mk()
    await healer.turnOn()
    check(T('B: turning it on over a damaged file works (the person chooses again): the file is a good one, the state is "on" and usable, and a restart agrees'), (await healer.state()).choice === 'on' && (await mk().state()).keyUsable === true && JSON.parse(await text(file)).encrypt === true)
    await fsp.writeFile(file, 'this is not json')
    const quitter = mk()
    await quitter.turnOff()
    check(T('B: turning it off over a damaged file works too, with no secure storage involved'), (await quitter.state()).choice === 'off' && (await text(file)) === '{"version":1,"encrypt":false}')
    await fsp.writeFile(file, 'this is not json')
    const callsNow = box.calls.encrypt
    await fsp.rm(file, { force: true })
    await fsp.mkdir(file) // a FOLDER where the file should be
    const fq = mk()
    check(T('B: a folder where the file should be: "unreadable" (never "off"), and turning it on fails and says so'), (await fq.state()).choice === 'unreadable' && 'refused' in (await fq.writeMode()) && (await throws(() => fq.turnOn())) && (await mk().state()).choice === 'unreadable')
    await fsp.rm(file, { recursive: true, force: true })
    check(T('B: nothing was asked of the secure storage to encrypt while the setting was damaged (only turnOn does)'), box.calls.encrypt === callsNow + 1) // the one turnOn in the line above that threw AFTER encrypting the check
    // a read that fails once (the file is locked by another program) is not kept
    await mk().turnOff()
    const flaky = mk()
    await withFaults((saved) => ({ readFile: async (path, ...rest) => { if (String(path).endsWith('chat-encryption.json')) throw Object.assign(new Error('locked'), { code: 'EBUSY' }); return saved.readFile(path, ...rest) } }), async () => {
      check(T('B: a file that cannot be read right now (locked) is "unreadable" and saving is refused'), (await flaky.state()).choice === 'unreadable')
    })
    check(T('B: ...and that is not kept: the next look reads the real file ("off")'), (await flaky.state()).choice === 'off')

    // the key is lost (a reset profile, another account)
    await fsp.rm(file, { force: true })
    const kp = mk()
    await kp.turnOn()
    const e0 = box.calls.encrypt
    const key = box.exportKey()
    box.lose()
    const lost = await kp.state()
    check(T('B: the key is lost: "on", the key NOT usable, saving blocked with the key sentence, the write mode a refusal'), lost.choice === 'on' && lost.keyUsable === false && lost.blocked === BLOCKED.key && lost.canEncrypt && 'refused' in (await kp.writeMode()), JSON.stringify(lost))
    const modes = await Promise.all(Array.from({ length: 20 }, () => kp.writeMode()))
    check(T('B: ...and looking at the state and asking for the write mode twenty times never asked the secure storage to ENCRYPT anything: no new key is made or used behind the owner\'s back'), modes.every((m) => 'refused' in m) && box.calls.encrypt === e0, `${box.calls.encrypt} vs ${e0}`)
    check(T('B: the sentence says that a new key is never made, that nothing was changed, and where to look'), /new key is never made/.test(BLOCKED.key) && /Nothing was changed/.test(BLOCKED.key) && /Settings/.test(BLOCKED.key))
    box.importKey(key)
    check(T('B: the key comes back (the same account again): the check opens, and writing is allowed again, encrypted'), (await kp.state()).keyUsable === true && same(await kp.writeMode(), { form: 'encrypted' }))
    box.available = false
    const none = await kp.state()
    check(T('B: with the choice on and no secure storage: blocked with its own sentence'), none.choice === 'on' && none.canEncrypt === false && none.keyUsable === false && none.blocked === BLOCKED.noStorage && 'refused' in (await kp.writeMode()))
    await kp.turnOff()
    check(T('B: ...and with the choice off, a computer with no secure storage still saves plain files (nothing needs the key)'), same(await kp.writeMode(), { form: 'plain' }) && (await kp.state()).canEncrypt === false)
    const before = await text(file)
    check(T('B: turning it on with no secure storage throws, and the file is exactly as it was'), (await throws(() => kp.turnOn())) && (await text(file)) === before)
    box.available = true
    box.lie = true
    check(T('B: turning it on with a secure storage that gives the wrong text back throws, and the file is exactly as it was'), (await throws(() => kp.turnOn())) && (await text(file)) === before)
    box.lie = false
    await withFaults(() => ({ writeFile: async () => { throw Object.assign(new Error('no space'), { code: 'ENOSPC' }) } }), async () => {
      check(T('B: turning it on when the file cannot be written throws'), await throws(() => kp.turnOn()))
    })
    check(T('B: ...and the state is what the disk says (still "off")'), (await kp.state()).choice === 'off' && (await text(file)) === before)
    await withFaults((saved) => ({ readFile: async (path, ...rest) => { const got = await saved.readFile(path, ...rest); return String(path).endsWith('chat-encryption.json') ? got.replace('true', 'false') : got } }), async () => {
      check(T('B: turning it on when the file does not read back as written throws (it is not "saved" on the word of the write)'), await throws(() => kp.turnOn()))
    })
    check(T('B: ...and after that failure the state is what the DISK says now ("on": the write did happen), not what was believed before: a failed save never leaves a stale belief'), (await kp.state()).choice === 'on')
    // a restart in the middle: a second protection sees the choice made by the first
    await kp.turnOn()
    check(T('B: after all that, turning it on works again'), (await mk().state()).choice === 'on' && (await kp.state()).keyUsable === true)
  })

  // ============ C. the store ============
  await guard(`C ${where}`, async () => {
    const dir = join(base, 'c-store')
    const settingFile = join(base, 'c-setting.json')
    const box = makeBox()
    const prot = createChatProtection({ box, pathOf: () => settingFile })
    const open = () => createConversationStore(dir, { box, writeMode: prot.writeMode })
    const N = 12
    const chats = Array.from({ length: N }, (_, i) => makeChat(i))
    for (const c of chats) await seedFile(dir, c)
    let store = open()
    check(T('C: plain files, choice off: 12 plain, 0 encrypted, nothing unreadable; blocked() is null'), same(await store.counts(), { plain: N, encrypted: 0, unreadable: 0, unopened: 0 }) && (await store.blocked()) === null)
    const plainSnap = await snapshot(dir)
    check(T('C: conform with the choice off and plain files changes nothing (all "already"), not one byte'), same(await store.conform(), { changed: 0, already: N, failed: 0 }) && plainSnap === (await snapshot(dir)))
    await prot.turnOn()
    check(T('C: turned on, conform rewrites all 12 and fails none'), same(await store.conform(), { changed: N, already: 0, failed: 0 }))
    check(T('C: every file is still "<id>.json", an envelope, and no ".tmp" or other file is left'), same(readdirSync(dir).sort(), chats.map((c) => `${c.id}.json`).sort()) && chats.every((c) => isEnv(join(dir, `${c.id}.json`))))
    const texts = chats.map((c) => readFileSync(join(dir, `${c.id}.json`), 'utf8'))
    const marks = chats.flatMap((c) => [c.title, c.instructions, ...c.messages.map((m) => m.content.slice(0, 20))]).filter((s) => s && s.length > 5)
    check(T('C: nothing of any chat is readable in any file: no title, no start of a message, no instructions'), marks.every((m) => !texts.some((t) => t.includes(m))), JSON.stringify(marks.filter((m) => texts.some((t) => t.includes(m))).slice(0, 3)))
    check(T('C: the list is built by opening them: 12 listed with the same titles, and every chat loads exactly as it was (dates, instructions, failed and stopped replies)'), same((await store.list()).conversations.map((c) => c.title).sort(), chats.map((c) => c.title).sort()) && (await Promise.all(chats.map(async (c) => same((await store.load(c.id)).conversation, c)))).every(Boolean))
    check(T('C: counts: 0 plain, 12 encrypted'), same(await store.counts(), { plain: 0, encrypted: N, unreadable: 0, unopened: 0 }))
    store = open()
    check(T('C: a fresh store over the folder (a restart) lists the same 12 and counts the same'), (await store.list()).conversations.length === N && same(await store.counts(), { plain: 0, encrypted: N, unreadable: 0, unopened: 0 }))
    const encSnap = await snapshot(dir)
    check(T('C: conform again: all "already", and not one file changed, byte for byte'), same(await store.conform(), { changed: 0, already: N, failed: 0 }) && encSnap === (await snapshot(dir)))

    const target = chats[4]
    const saved = await store.save({ id: target.id, messages: [...target.messages, msg('user', 'a later message LATER-MARK')], instructions: target.instructions })
    const savedText = readFileSync(join(dir, `${target.id}.json`), 'utf8')
    const reloaded = (await store.load(target.id)).conversation
    check(T('C: a save while on writes an envelope (the new words are not readable in it), keeps createdAt, and reads back with the new message'), saved.ok && chatFile.isEnvelope(JSON.parse(savedText)) && !savedText.includes('LATER-MARK') && reloaded.createdAt === target.createdAt && reloaded.messages.length === target.messages.length + 1)
    const brandNew = randomUUID()
    const fresh = await store.save({ id: brandNew, messages: [msg('user', 'brand new SECRET-MARK'), reply('fine')], instructions: 'only for me' })
    const freshText = readFileSync(join(dir, `${brandNew}.json`), 'utf8')
    check(T('C: a new chat saved while on is an envelope too: no SECRET-MARK and no instructions can be read in the file'), fresh.ok && chatFile.isEnvelope(JSON.parse(freshText)) && !freshText.includes('SECRET-MARK') && !freshText.includes('only for me'))
    const addedChat = makeChat(40)
    const added = await store.add(addedChat)
    check(T('C: a chat added from a backup while on is an envelope, keeps its own dates and instructions, and loads back as it was'), added.ok && isEnv(join(dir, `${addedChat.id}.json`)) && same((await store.load(addedChat.id)).conversation, addedChat))
    check(T('C: after the leftovers of a save (the ".tmp" of every write is removed) no ".tmp" is anywhere'), readdirSync(dir).every((n) => !n.endsWith('.tmp')))
    const garbleBefore = await snapshot(dir)
    box.garble = true
    const garbled = await store.save({ id: chats[5].id, messages: [...chats[5].messages, msg('user', 'garbled')], instructions: chats[5].instructions }).then(() => 'saved', () => 'threw')
    const garbledNew = await store.save({ id: randomUUID(), messages: [msg('user', 'garbled new')], instructions: '' }).then(() => 'saved', () => 'threw')
    box.garble = false
    check(T('C: when the secure storage hands back something that does NOT open again, a save THROWS (a sealed copy is proved by opening it before it counts) and the folder is exactly as it was: no half-sealed chat, no ".tmp"'), garbled === 'threw' && garbledNew === 'threw' && garbleBefore === (await snapshot(dir)), JSON.stringify({ garbled, garbledNew }))

    const late = makeChat(41)
    await seedFile(dir, late) // a plain file appears among the encrypted ones (another program, a copy)
    store = open()
    check(T('C: a plain file among encrypted ones is listed (reading takes both) and counted as plain'), (await store.counts()).plain === 1 && (await store.list()).conversations.some((c) => c.id === late.id))
    const fin = await store.conform()
    check(T('C: conform encrypts it and only it (changed 1)'), fin.changed === 1 && fin.failed === 0 && isEnv(join(dir, `${late.id}.json`)))

    // the way back
    await prot.turnOff()
    const total = (await store.list()).conversations.length
    const back = await store.conform()
    check(T('C: going back: every chat is rewritten as a plain file, none failed'), back.changed === total && back.failed === 0 && readdirSync(dir).every((n) => /^[0-9a-f-]{36}\.json$/.test(n)) && readdirSync(dir).every((n) => !isEnv(join(dir, n))), JSON.stringify(back))
    check(T('C: the chats that were never changed in between are BYTE FOR BYTE what they were before encryption (plain, encrypted, plain again)'), chats.filter((c) => c.id !== target.id).every((c) => readFileSync(join(dir, `${c.id}.json`), 'utf8') === fileText(c)) && readFileSync(join(dir, `${late.id}.json`), 'utf8') === fileText(late) && readFileSync(join(dir, `${addedChat.id}.json`), 'utf8') === fileText(addedChat))
    check(T('C: and plain again means counts say so'), same(await store.counts(), { plain: total, encrypted: 0, unreadable: 0, unopened: 0 }))

    // old versions come through encryption and back (as version 3)
    const odir = join(base, 'c-old')
    const v1 = randomUUID()
    const v2 = randomUUID()
    const v1Plain = { version: 1, id: v1, title: 'oldest', createdAt: 4000, updatedAt: 8000, messages: [msg('user', 'oldest'), msg('assistant', 'oldest answer')] }
    const v2Plain = { version: 2, id: v2, title: 'older', createdAt: 5000, updatedAt: 9000, messages: [msg('user', 'older'), msg('assistant', 'older answer', 'done', { provider: 'openai', model: 'gpt-6.1-sol' })] }
    await fsp.mkdir(odir, { recursive: true })
    await fsp.writeFile(join(odir, `${v1}.json`), JSON.stringify(v1Plain))
    await fsp.writeFile(join(odir, `${v2}.json`), JSON.stringify(v2Plain))
    const op = createChatProtection({ box, pathOf: () => join(base, 'c-old-setting.json') })
    const ostore = createConversationStore(odir, { box, writeMode: op.writeMode })
    const l1 = (await ostore.load(v1)).conversation
    const l2 = (await ostore.load(v2)).conversation
    await op.turnOn()
    const oc = await ostore.conform()
    check(T('C: version 1 and version 2 files are encrypted too, and open to the very same chats (as version 3, with no instructions)'), oc.changed === 2 && same((await ostore.load(v1)).conversation, l1) && same((await ostore.load(v2)).conversation, l2) && l1.instructions === '' && isEnv(join(odir, `${v1}.json`)))
    await op.turnOff()
    await ostore.conform()
    check(T('C: and back to plain they are version 3 files of the same chats'), JSON.parse(await text(join(odir, `${v2}.json`))).version === 3 && same((await createConversationStore(odir).load(v2)).conversation, l2) && same((await createConversationStore(odir).load(v1)).conversation, l1))

    // a chat deleted while encrypted
    const rdir = join(base, 'c-remove')
    const rp = createChatProtection({ box, pathOf: () => join(base, 'c-remove-setting.json') })
    await rp.turnOn()
    const rstore = createConversationStore(rdir, { box, writeMode: rp.writeMode })
    await rstore.save({ id: idOf(1), messages: [msg('user', 'to delete')], instructions: '' })
    check(T('C: an encrypted chat can be deleted: the file is gone'), (await rstore.remove(idOf(1))).ok && !(await exists(join(rdir, `${idOf(1)}.json`))) && (await rstore.counts()).encrypted === 0)

    // sizes: an encrypted file is bigger than the chat in it
    const sdir = join(base, 'c-size')
    const sp = createChatProtection({ box, pathOf: () => join(base, 'c-size-setting.json') })
    await sp.turnOn()
    const sstore = createConversationStore(sdir, { box, writeMode: sp.writeMode })
    const keep = HISTORY_LIMITS.maxFileBytes
    try {
      HISTORY_LIMITS.maxFileBytes = 2000
      const wide = [msg('user', 'w'.repeat(1500)), reply('ok')]
      const wideSaved = await sstore.save({ id: idOf(2), messages: wide, instructions: '' })
      const wideSize = (await fsp.stat(join(sdir, `${idOf(2)}.json`))).size
      check(T('C: a chat that fits the limit as text is saved encrypted even though its FILE is then bigger than that limit, and it reads back'), wideSaved.ok && wideSize > 2000 && same((await createConversationStore(sdir, { box, writeMode: sp.writeMode }).load(idOf(2))).conversation?.messages, wide), String(wideSize))
      const tooBig = await sstore.save({ id: idOf(3), messages: [msg('user', 'w'.repeat(2100))], instructions: '' })
      check(T('C: a chat whose TEXT is over the limit is still refused ("too large"), whatever its form: what is written must be readable again'), !tooBig.ok && /too large/.test(tooBig.error) && !(await exists(join(sdir, `${idOf(3)}.json`))))
      await fsp.writeFile(join(sdir, `${idOf(4)}.json`), fileText(makeChat(4)) + ' '.repeat(2100))
      const reads = []
      const sread = createConversationStore(sdir, { box, writeMode: sp.writeMode })
      const realRead = fsp.readFile
      fsp.readFile = async (path, ...rest) => { reads.push(String(path)); return realRead(path, ...rest) }
      let sc
      try { sc = await sread.counts() } finally { fsp.readFile = realRead }
      check(T('C: a PLAIN file over the limit is refused as too large even though it is smaller than an encrypted one may be (counted unreadable, not "unopened"), and its content was NEVER READ (only its first bytes were looked at)'), sc.unreadable === 1 && sc.unopened === 0 && !reads.some((p) => p.includes(idOf(4))), JSON.stringify({ sc, reads: reads.filter((p) => p.includes(idOf(4))).length }))
      await fsp.writeFile(join(sdir, `${idOf(6)}.json`), chatFile.SEALED_PREFIX + ' garbage that is not a sealed chat '.repeat(80))
      const sdirty = createConversationStore(sdir, { box, writeMode: sp.writeMode })
      const sd = await sdirty.counts()
      check(T('C: a file that merely BEGINS like a sealed chat, is over the plain limit and is garbage, is refused as unreadable (not read as a chat, no crash)'), sd.unreadable === 2 && sd.encrypted === 1 && (await sdirty.list()).conversations.length === 1, JSON.stringify(sd))
      await fsp.rm(join(sdir, `${idOf(6)}.json`), { force: true })
    } finally { HISTORY_LIMITS.maxFileBytes = keep }
    await fsp.writeFile(join(sdir, `${idOf(5)}.json`), 'x'.repeat(chatFile.MAX_ENCRYPTED_FILE_BYTES + 1))
    const sfinal = await createConversationStore(sdir, { box, writeMode: sp.writeMode }).counts()
    check(T('C: a file over even the limit for encrypted files is refused without being read as a chat (unreadable); the others, back under the normal limit, are readable'), sfinal.unreadable === 1 && sfinal.encrypted === 1 && sfinal.plain === 1, JSON.stringify(sfinal))
  })

  // ---- C2: files that cannot be opened are left exactly as they are
  await guard(`C2 ${where}`, async () => {
    const dir = join(base, 'c2-unopened')
    const settingFile = join(base, 'c2-setting.json')
    const box = makeBox()
    const prot = createChatProtection({ box, pathOf: () => settingFile })
    const open = () => createConversationStore(dir, { box, writeMode: prot.writeMode })
    const chats = Array.from({ length: 8 }, (_, i) => makeChat(i))
    for (const c of chats) await seedFile(dir, c)
    await prot.turnOn()
    let store = open()
    await store.conform()
    // damage, one kind each
    const ids = chats.map((c) => c.id)
    const p = (id) => join(dir, `${id}.json`)
    await fsp.writeFile(p(ids[0]), flipInData(await text(p(ids[0])))) // a character flipped inside the data
    await fsp.writeFile(p(ids[1]), (await text(p(ids[1]))).slice(0, 60)) // cut off
    await fsp.writeFile(p(ids[2]), JSON.stringify({ ...JSON.parse(await text(p(ids[2]))), v: 2 })) // an envelope of another version
    await fsp.writeFile(p(ids[3]), await text(p(ids[4]))) // chat 4's envelope under chat 3's name
    await fsp.writeFile(p(ids[5]), 'not a chat at all')
    const snap = await snapshot(dir)
    store = open()
    const list = await store.list()
    const counts = await store.counts()
    const readable = [4, 6, 7].map((i) => chats[i].title).sort()
    check(T('C2: eight encrypted files, five damaged in five ways: the three good ones are listed, and chat 4\'s envelope under chat 3\'s name is NOT read as chat 3 (the id inside does not match the name)'), same(list.conversations.map((c) => c.title).sort(), readable), JSON.stringify(list.conversations.map((c) => c.title)))
    check(T('C2: counted exactly: 3 encrypted, 5 unreadable, and of those 2 are encrypted files that could not be opened (data changed, another version); a cut-off file, a file that is not a chat and a chat under another name are unreadable but not "unopened"'), same(counts, { plain: 0, encrypted: 3, unreadable: 5, unopened: 2 }), JSON.stringify(counts))
    const missing = await store.load(ids[0])
    check(T('C2: listing, counting and loading one touched nothing: every file byte for byte as it was, and loading one answers "not found" (it is not listed)'), !missing.ok && snap === (await snapshot(dir)))
    const kept = await store.inspect(ids[0])
    check(T('C2: a restore sees such a file as "damaged" (so a chat in a backup under that id becomes a copy and the file is never written over)'), kept.kind === 'damaged' && (await store.inspect(ids[3])).kind === 'damaged' && (await store.inspect(ids[1])).kind === 'damaged')
    const result = await store.conform()
    check(T('C2: conform changes nothing (the three good ones are encrypted already) and fails nothing, and the damaged files are exactly as they were'), same(result, { changed: 0, already: 3, failed: 0 }) && snap === (await snapshot(dir)), JSON.stringify(result))
    const damagedText = () => Promise.all([0, 1, 2, 3, 5].map(async (i) => `${i}:${await text(p(ids[i]))}`))
    const damagedBefore = await damagedText()
    await prot.turnOff()
    const toPlain = await store.conform()
    check(T('C2: going back to plain: the three good ones become plain files, and the five that could not be opened are STILL exactly as they were (not converted, not deleted)'), same(toPlain, { changed: 3, already: 0, failed: 0 }) && [4, 6, 7].every((i) => readFileSync(p(ids[i]), 'utf8') === fileText(chats[i])) && same(await damagedText(), damagedBefore) && !isEnv(p(ids[4])) && isEnv(p(ids[0])) && isEnv(p(ids[2])) && (await text(p(ids[5]))) === 'not a chat at all', JSON.stringify(toPlain))
    check(T('C2: and they are still counted (5 unreadable, 2 unopened), not forgotten'), same(await store.counts(), { plain: 3, encrypted: 0, unreadable: 5, unopened: 2 }), JSON.stringify(await store.counts()))
  })

  // ---- C3: a disk fault or a crash in the middle of a conversion
  await guard(`C3 ${where}`, async () => {
    const dir = join(base, 'c3-fault')
    const settingFile = join(base, 'c3-setting.json')
    const box = makeBox()
    const prot = createChatProtection({ box, pathOf: () => settingFile })
    const open = () => createConversationStore(dir, { box, writeMode: prot.writeMode })
    const chats = Array.from({ length: 6 }, (_, i) => makeChat(i))
    for (const c of chats) await seedFile(dir, c)
    // a cut-off ".tmp" of a plain save, left by a crash before encryption was turned on: it holds part of a chat as text
    const stray = fileText(chats[2]).slice(0, 200)
    await fsp.writeFile(join(dir, `${chats[2].id}.json.tmp`), stray)
    await prot.turnOn()
    let store = open()
    const bad = [chats[1].id, chats[3].id]
    const result = await withFaults((saved) => ({ copyFile: async (from, to, ...rest) => { if (bad.some((id) => String(to).endsWith(`${id}.json`))) throw Object.assign(new Error('access denied'), { code: 'EPERM' }); return saved.copyFile(from, to, ...rest) } }), () => store.conform())
    check(T('C3: two copies fail in the middle of a conversion: 4 changed, 2 failed, nobody threw'), result.changed === 4 && result.failed === 2 && result.already === 0, JSON.stringify(result))
    check(T('C3: the four that worked are envelopes; the two that failed still have their plain real file AND an encrypted ".tmp" beside it'), [0, 2, 4, 5].every((i) => isEnv(join(dir, `${chats[i].id}.json`))) && bad.every((id) => !isEnv(join(dir, `${id}.json`)) && isEnv(join(dir, `${id}.json.tmp`))))
    store = open() // a restart
    const c3 = await store.counts()
    check(T('C3: after a restart the two are counted as PLAIN (a plain copy does not hide behind the newer encrypted ".tmp"), the other four as encrypted, and all six are readable'), c3.plain === 2 && c3.encrypted === 4 && c3.unreadable === 0 && (await store.list()).conversations.length === 6, JSON.stringify(c3))
    check(T('C3: and the six chats read back as they were (the ".tmp" is the newer copy; it is the same chat)'), (await Promise.all(chats.map(async (c) => same((await store.load(c.id)).conversation, c)))).every(Boolean))
    const second = await store.conform()
    check(T('C3: conform again, the fault gone: the two are rewritten (changed 2, the rest already), and the cut-off plain ".tmp" of chat 2 was rewritten too'), second.changed === 2 && second.already === 4 && second.failed === 0, JSON.stringify(second))
    check(T('C3: now no ".tmp" is left anywhere, every file is an envelope, and no file holds any chat as text'), readdirSync(dir).every((n) => /^[0-9a-f-]{36}\.json$/.test(n)) && readdirSync(dir).every((n) => isEnv(join(dir, n))) && readdirSync(dir).every((n) => !readFileSync(join(dir, n), 'utf8').includes('Question')))
    check(T('C3: the cut-off plain ".tmp" that held part of a chat as text is gone, not left lying beside the encrypted file'), !(await exists(join(dir, `${chats[2].id}.json.tmp`))))
    await fsp.copyFile(join(dir, `${chats[0].id}.json`), join(dir, `${chats[0].id}.json.tmp`)) // a leftover that merely repeats an encrypted file
    store = open()
    const tidied = await store.conform()
    check(T('C3: a leftover ".tmp" that repeats an encrypted file is tidied by conform (rewritten, then removed), although the form is right already: a half-finished copy is never left beside a chat'), tidied.changed === 1 && tidied.already === 5 && !(await exists(join(dir, `${chats[0].id}.json.tmp`))) && same((await store.load(chats[0].id)).conversation, chats[0]), JSON.stringify(tidied))

    // a chat saved WHILE a conversion runs is encrypted, and the save is not kept waiting for the whole conversion
    const dir2 = join(base, 'c3-parallel')
    const p2 = createChatProtection({ box, pathOf: () => join(base, 'c3-parallel-setting.json') })
    const many = Array.from({ length: 80 }, (_, i) => makeChat(i + 100))
    for (const c of many) await seedFile(dir2, c)
    const s2 = createConversationStore(dir2, { box, writeMode: p2.writeMode })
    await s2.list()
    await p2.turnOn()
    let finished = false
    const running = s2.conform().then((r) => { finished = true; return r })
    // The save must be asked for while the conversion is UNDER WAY (a few chats are already sealed on disk): a save queued before the first chat is converted would pass
    // even if the whole conversion held the queue.
    const sealedCount = () => readdirSync(dir2).filter((n) => isEnv(join(dir2, n))).length
    for (let t0 = Date.now(); sealedCount() < 3 && Date.now() - t0 < 8000;) await sleep(1)
    const sealedAtAsk = sealedCount()
    const mid = await s2.save({ id: idOf(900), messages: [msg('user', 'saved during the conversion')], instructions: '' })
    const wasRunning = !finished
    const total = await running
    check(T('C3: a save asked for while the conversion of 80 chats is under way (3 or more already sealed) comes back BEFORE the conversion ends (one chat per turn, not the whole folder), and it was written encrypted'), mid.ok && wasRunning && sealedAtAsk >= 3 && sealedAtAsk < 80 && isEnv(join(dir2, `${idOf(900)}.json`)) && total.changed === 80 && total.failed === 0, JSON.stringify({ wasRunning, sealedAtAsk, total }))
  })

  // ============ D. the flow ============
  await guard(`D ${where}`, async () => {
    const answers = { save: [], open: [] }
    const asked = []
    let hold = null
    const pickers = {
      savePath: async (owner, suggestedName, title) => { asked.push({ kind: 'save', owner, suggestedName, title, at: await snapshot(w.convDir), settingThere: await exists(w.settingFile) }); if (hold) { const h = hold; hold = null; await h } return answers.save.length ? answers.save.shift() : null },
      openPath: async (owner) => { asked.push({ kind: 'open', owner }); return answers.open.length ? answers.open.shift() : null }
    }
    const questions = []
    const yes = []
    const asks = { confirmPlain: async (owner, facts) => { questions.push({ owner, facts }); return yes.length ? yes.shift() : false } }
    const owner = { window: 'the window that asked' }
    const w = {}
    async function world(name, chatCount = 6) {
      w.userData = join(base, `d-${name}`)
      w.convDir = join(w.userData, 'conversations')
      w.settingFile = join(w.userData, 'chat-encryption.json')
      w.docs = join(base, `d-${name}-docs`)
      await fsp.mkdir(w.docs, { recursive: true })
      await fsp.mkdir(w.userData, { recursive: true })
      w.box = makeBox()
      w.chats = Array.from({ length: chatCount }, (_, i) => makeChat(i))
      for (const c of w.chats) await seedFile(w.convDir, c)
      rebuild()
      asked.length = 0
      questions.length = 0
    }
    function rebuild() { // a restart: every object is new, the folders and the secure storage are the same
      w.prot = createChatProtection({ box: w.box, pathOf: () => w.settingFile })
      w.store = createConversationStore(w.convDir, { box: w.box, writeMode: w.prot.writeMode })
      w.backups = createBackupService({ store: w.store, dataDir: w.userData, pickers, now: () => NOW })
      w.svc = createChatEncryptionService({ store: w.store, protection: w.prot, backups: w.backups, asks })
    }
    const convFiles = () => readdirSync(w.convDir).filter((n) => /^[0-9a-f-]{36}\.json$/.test(n))

    // ---- the backup comes first, and the person can say no
    await world('first')
    const snap0 = await snapshot(w.convDir)
    answers.save.push(null)
    const r0 = await w.svc.encrypt(owner)
    check(T('D: the person closes the backup dialog: nothing is encrypted ("Cancelled", not an error), no file changed, no setting written'), !r0.ok && r0.cancelled === true && /Nothing was encrypted/.test(r0.error) && snap0 === (await snapshot(w.convDir)) && !(await exists(w.settingFile)) && w.box.calls.encrypt === 0)
    answers.save.push(join(w.userData, 'inside.jsonl'))
    const r1 = await w.svc.encrypt(owner)
    check(T('D: a backup place inside the app\'s data folder is refused, so nothing is encrypted, and the sentence says why'), !r1.ok && !r1.cancelled && /Nothing was encrypted/.test(r1.error) && /own data folder/.test(r1.error) && snap0 === (await snapshot(w.convDir)) && !(await exists(w.settingFile)), r1.error)
    const dest0 = join(w.docs, 'a.jsonl')
    answers.save.push(dest0)
    const r2 = await withFaults((saved) => ({ copyFile: async (from, to, ...rest) => { if (to === dest0) throw Object.assign(new Error('disk full'), { code: 'ENOSPC' }); return saved.copyFile(from, to, ...rest) } }), () => w.svc.encrypt(owner))
    check(T('D: a backup that cannot be written where the person chose: nothing is encrypted, nothing changed, the sentence says the backup could not be made'), !r2.ok && /backup could not be made/.test(r2.error) && snap0 === (await snapshot(w.convDir)) && !(await exists(w.settingFile)) && w.box.calls.encrypt === 0, r2.error)
    // turning it on for real
    const dest = join(w.docs, 'before.jsonl')
    asked.length = 0
    answers.save.push(dest)
    const ok = await w.svc.encrypt(owner)
    check(T('D: with a backup the person chose: ok, 6 chats encrypted, 0 failed, the backup reported (6 chats, where)'), ok.ok && ok.report.changed === 6 && ok.report.failed === 0 && same(ok.report.backup, { count: 6, leftOut: 0, where: dest }), JSON.stringify(ok.ok ? ok.report : ok))
    check(T('D: the save dialog was asked once, for the window, with the title and the name that say why ("before they are encrypted")'), asked.length === 1 && asked[0].owner === owner && asked[0].title === BEFORE_ENCRYPTING_TITLE && asked[0].suggestedName === 'frontier-chats-before-encrypting-2026-10-05.jsonl', JSON.stringify(asked.map((a) => ({ ...a, at: undefined }))))
    check(T('D: when that dialog was asked NOTHING had changed yet: the chat files were as they were and there was no setting file (the backup comes first)'), asked[0].at === snap0 && asked[0].settingThere === false)
    const made = await readAll(dest)
    check(T('D: the backup is a whole backup of the six chats AS THEY WERE (plain, the originals), read back and checked'), made.read.complete && made.chats.length === 6 && made.chats.every((c) => same(c, w.chats.find((x) => x.id === c.id))))
    check(T('D: the backup is a plain file (that is its nature, and the dialogs say so): the words of a chat can be read in it'), (await text(dest)).includes('Question 0'))
    check(T('D: after it, every chat file is an envelope; the setting is "on" with a check; the status says 6 encrypted, 0 plain, key usable'), convFiles().length === 6 && convFiles().every((n) => isEnv(join(w.convDir, n))) && JSON.parse(await text(w.settingFile)).encrypt === true && same(ok.status, { choice: 'on', canEncrypt: true, keyUsable: true, plain: 0, encrypted: 6, unreadable: 0, unopened: 0, blocked: null }), JSON.stringify(ok.status))
    asked.length = 0
    const noop = await w.svc.encrypt(owner)
    check(T('D: turning it on again when everything is encrypted: ok, nothing changed, and NO second backup is asked for'), noop.ok && noop.report.changed === 0 && noop.report.already === 6 && noop.report.backup === null && asked.length === 0)

    // ---- the person says no to going back
    const beforeNo = await snapshot(w.convDir)
    const declined = await w.svc.decrypt(owner) // nobody answers: no
    check(T('D: going back to plain files and the person answering no: nothing changed (cancelled), the choice is still on, and the question was told the facts (6 chats, none that cannot be opened, key usable)'), !declined.ok && declined.cancelled === true && (await snapshot(w.convDir)) === beforeNo && (await w.svc.status()).choice === 'on' && questions.length === 1 && same(questions[0].facts, { encrypted: 6, unopened: 0, keyUsable: true }), JSON.stringify(questions))

    // ---- one thing at a time: a plain chat appears, so that turning it on again has something to do, and the backup dialog is held open
    const extra = makeChat(70)
    await seedFile(w.convDir, extra)
    rebuild()
    let release = () => undefined
    hold = new Promise((resolve) => { release = resolve })
    answers.save.push(join(w.docs, 'held.jsonl'))
    asked.length = 0
    const first = w.svc.encrypt(owner)
    await sleep(80)
    const second = await w.svc.encrypt(owner)
    const third = await w.backups.exportChats({ scope: 'all' }, owner)
    const fourth = await w.svc.decrypt(owner)
    check(T('D: while the backup dialog is open a second encrypt, a backup and a "go back to plain files" are told to wait, and no second dialog opens (and nobody is asked)'), !second.ok && /Another backup/.test(second.error) && !third.ok && /Another backup/.test(third.error) && !fourth.ok && /Another backup/.test(fourth.error) && asked.length === 1 && questions.length === 1)
    release()
    const firstDone = await first
    check(T('D: ...then the first one finishes normally: 1 chat encrypted (the plain one that appeared), and a fresh backup of all 7 was made'), firstDone.ok && firstDone.report.changed === 1 && firstDone.report.backup.count === 7 && isEnv(join(w.convDir, `${extra.id}.json`)))

    // ---- going back
    yes.push(true)
    const plainBefore = convFiles().length
    const gone = await w.svc.decrypt(owner)
    check(T('D: going back to plain files: the system asks (once, with the counts), and on a yes every chat is rewritten as a plain file'), gone.ok && gone.report.changed === plainBefore && gone.report.failed === 0 && questions.at(-1).facts.encrypted === 7 && questions.at(-1).facts.keyUsable === true && questions.at(-1).owner === owner && convFiles().every((n) => !isEnv(join(w.convDir, n))), JSON.stringify(gone.ok ? gone.report : gone))
    check(T('D: ...the setting is written plain ({"version":1,"encrypt":false}) and the chats that were never changed are byte for byte what they were'), (await text(w.settingFile)) === '{"version":1,"encrypt":false}' && w.chats.every((c) => readFileSync(join(w.convDir, `${c.id}.json`), 'utf8') === fileText(c)))
    const nq = questions.length
    const noask = await w.svc.decrypt(owner)
    check(T('D: going back when it is plain already and nothing is encrypted: ok, and the person is NOT asked (nothing is weakened)'), noask.ok && noask.report.changed === 0 && questions.length === nq)
    check(T('D: the question that is asked says how many chats, that anyone who can read the data folder can read them, that API keys stay encrypted and a backup is not changed'), (() => { const q = plainQuestion({ encrypted: 7, unopened: 0, keyUsable: true }); return /7 chats/.test(q.message) && /Anyone who can read/.test(q.detail) && /API keys stay encrypted/.test(q.detail) && /backup/.test(q.detail) })())
    check(T('D: the question differs when no chat is encrypted, when one cannot be opened, and when the key cannot be read (it says the chats stay as they are and how to get them back)'), (() => { const a = plainQuestion({ encrypted: 0, unopened: 0, keyUsable: true }); const b = plainQuestion({ encrypted: 3, unopened: 1, keyUsable: true }); const c = plainQuestion({ encrypted: 0, unopened: 4, keyUsable: false }); return /No saved chat is encrypted/.test(a.detail) && /1 encrypted file cannot be opened/.test(b.detail) && /cannot be read/.test(c.message) && /stay exactly as they are/.test(c.detail) && /Restore from a backup/.test(c.detail) && /4 encrypted files cannot be opened/.test(c.detail) })())

    // ---- the lost key, end to end
    await world('keylost')
    const keyDest = join(w.docs, 'safe.jsonl')
    answers.save.push(keyDest)
    await w.svc.encrypt(owner)
    const oldKey = w.box.exportKey()
    w.box.lose() // another account, a reset profile
    await seedFile(w.convDir, makeChat(81)) // a plain chat file turns up meanwhile (a copy, another program): it is readable, and nothing may be done to it either
    rebuild() // a restart
    asked.length = 0
    const E1 = w.box.calls.encrypt
    const S1 = await snapshot(w.convDir)
    const lost = await w.svc.status()
    check(T('D: the key is lost: the status says "on", key NOT usable, six sealed files that cannot be opened (all encrypted), one plain chat that can, and the sentence'), lost.choice === 'on' && lost.keyUsable === false && lost.encrypted === 0 && lost.plain === 1 && lost.unreadable === 6 && lost.unopened === 6 && lost.blocked === BLOCKED.key, JSON.stringify(lost))
    const writes = [] // every file write the chat folder sees while writing is refused: there must be none, not even a ".tmp"
    let refusedSave, refusedNew, refusedAdd, refusedEncrypt, conformed
    await withFaults((saved) => ({ writeFile: async (path, ...rest) => { writes.push(String(path)); return saved.writeFile(path, ...rest) }, copyFile: async (from, to, ...rest) => { writes.push(String(to)); return saved.copyFile(from, to, ...rest) } }), async () => {
      refusedSave = await w.store.save({ id: w.chats[0].id, messages: [msg('user', 'new words')], instructions: '' })
      refusedNew = await w.store.save({ id: randomUUID(), messages: [msg('user', 'a brand new chat')], instructions: '' })
      refusedAdd = await w.store.add(makeChat(80))
      refusedEncrypt = await w.svc.encrypt(owner)
      conformed = await w.store.conform()
    })
    const inChats = writes.filter((p) => p.startsWith(w.convDir))
    check(T('D: while writing is refused NO FILE IS WRITTEN in the chat folder at all (not a chat, not a ".tmp"): a save, a new chat, an add, a turn-on and a conversion were all attempted'), inChats.length === 0, JSON.stringify(inChats.slice(0, 3)))
    check(T('D: saving (over an old chat, and a new chat), adding from a backup and turning it on again are all REFUSED with the key sentence, and nothing is written'), !refusedSave.ok && refusedSave.error === BLOCKED.key && !refusedNew.ok && refusedNew.error === BLOCKED.key && !refusedAdd.ok && refusedAdd.why === 'blocked' && !refusedEncrypt.ok && /Nothing was encrypted/.test(refusedEncrypt.error) && S1 === (await snapshot(w.convDir)), JSON.stringify([refusedSave, refusedAdd, refusedEncrypt]).slice(0, 400))
    check(T('D: ...no dialog was opened for it, conform touched nothing (the one plain chat is counted as FAILED, not rewritten: writing is refused), and the secure storage was NEVER asked to encrypt: no new key was made or used'), asked.length === 0 && same(conformed, { changed: 0, already: 0, failed: 1 }) && w.box.calls.encrypt === E1 && S1 === (await snapshot(w.convDir)), `${w.box.calls.encrypt} vs ${E1} ${JSON.stringify(conformed)}`)
    answers.open.push(keyDest)
    const look = await w.backups.restoreLook(owner)
    check(T('D: looking at the backup while the key is lost adds nothing, and shows six chats that would be added as copies (their own files cannot be opened)'), look.ok && look.preview.copies === 6 && look.preview.fresh === 0 && look.preview.same === 0 && S1 === (await snapshot(w.convDir)), JSON.stringify(look.ok ? look.preview : look))
    const applied = await w.backups.restoreApply(look.ok ? look.preview.token : 'x')
    check(T('D: ...but adding is refused with the sentence ("Nothing was added. Chats are not being saved..."), and every file is untouched'), !applied.ok && /^Nothing was added\. Chats are not being saved/.test(applied.error) && S1 === (await snapshot(w.convDir)), JSON.stringify(applied))
    yes.push(true)
    const off = await w.svc.decrypt(owner)
    check(T('D: turning encryption off while the key is lost: the system is asked with the facts (nothing can be turned back, 6 cannot be opened), and on a yes ONLY the choice changes: every file is untouched'), off.ok && questions.at(-1).facts.keyUsable === false && questions.at(-1).facts.unopened === 6 && off.report.changed === 0 && S1 === (await snapshot(w.convDir)) && (await text(w.settingFile)) === '{"version":1,"encrypt":false}', JSON.stringify(off.ok ? off.status : off))
    const plainSave = await w.store.save({ id: randomUUID(), messages: [msg('user', 'saved plain after the key was lost')], instructions: '' })
    check(T('D: and now chats can be saved again, as plain files, still without asking the secure storage to encrypt anything'), plainSave.ok && w.box.calls.encrypt === E1 && !isEnv(join(w.convDir, `${plainSave.ok ? plainSave.summary.id : 'x'}.json`)))
    answers.open.push(keyDest)
    const look2 = await w.backups.restoreLook(owner)
    const added = await w.backups.restoreApply(look2.ok ? look2.preview.token : 'x')
    const restored = (await w.store.list()).conversations
    const loaded = await Promise.all(restored.map(async (r) => (await w.store.load(r.id)).conversation))
    check(T('D: the way out: restoring the backup made when encryption was turned on adds the six chats as COPIES (new ids), and each is the chat as it was (messages, instructions, dates)'), added.ok && added.copies === 6 && added.added === 0 && restored.length === 8 && w.chats.every((c) => loaded.some((l) => l && l.id !== c.id && same(l.messages, c.messages) && l.instructions === c.instructions && l.createdAt === c.createdAt && l.updatedAt === c.updatedAt)), JSON.stringify(added))
    check(T('D: ...and the six undecryptable files are still there, untouched (counted, never deleted, never written over)'), (await w.store.counts()).unreadable === 6 && w.chats.every((c) => isEnv(join(w.convDir, `${c.id}.json`))))
    // the key comes back
    w.box.importKey(oldKey)
    rebuild()
    const back = await w.svc.status()
    check(T('D: the key comes back (the same account again): the six old files open again, nothing was lost; the status says so (choice off, 6 encrypted from before)'), back.choice === 'off' && back.encrypted === 6 && back.unreadable === 0 && back.unopened === 0 && back.blocked === null, JSON.stringify(back))
    yes.push(true)
    const done = await w.svc.decrypt(owner)
    check(T('D: ...and going back turns those six into plain files, byte for byte the originals'), done.ok && done.report.changed === 6 && w.chats.every((c) => readFileSync(join(w.convDir, `${c.id}.json`), 'utf8') === fileText(c)), JSON.stringify(done.ok ? done.report : done))

    // ---- no secure storage
    await world('nostore')
    w.box.available = false
    const rNo = await w.svc.encrypt(owner)
    check(T('D: a computer with no secure storage: turning encryption on says so, opens no dialog, writes nothing'), !rNo.ok && rNo.error === NO_SECURE_STORAGE && asked.length === 0 && !(await exists(w.settingFile)) && w.box.calls.encrypt === 0)
    check(T('D: ...and chats are still saved, as plain files (the choice is off)'), (await w.store.save({ id: randomUUID(), messages: [msg('user', 'plain, no storage')], instructions: '' })).ok)

    // ---- a conversion cut short, finished by turning it on again
    await world('cut')
    const faulty = [w.chats[1].id, w.chats[3].id]
    answers.save.push(join(w.docs, 'one.jsonl'))
    const cut = await withFaults((saved) => ({ copyFile: async (from, to, ...rest) => { if (faulty.some((id) => String(to).endsWith(`${id}.json`))) throw Object.assign(new Error('access denied'), { code: 'EPERM' }); return saved.copyFile(from, to, ...rest) } }), () => w.svc.encrypt(owner))
    check(T('D: a conversion with two failing copies reports 4 changed and 2 failed, and says the two are as before'), cut.ok && cut.report.changed === 4 && cut.report.failed === 2 && cut.status.choice === 'on' && cut.status.plain === 2, JSON.stringify(cut.ok ? cut.report : cut))
    rebuild()
    check(T('D: after a restart the status still says 2 chats are plain (they are not hidden behind the encrypted ".tmp")'), (await w.svc.status()).plain === 2)
    asked.length = 0
    answers.save.push(join(w.docs, 'two.jsonl'))
    const finish = await w.svc.encrypt(owner)
    check(T('D: turning it on again finishes it: a fresh backup is asked for first, 2 chats are encrypted, none failed'), finish.ok && finish.report.changed === 2 && finish.report.failed === 0 && finish.report.backup?.count === 6 && asked.length === 1)
    check(T('D: and then every file is an envelope and no ".tmp" is left anywhere'), readdirSync(w.convDir).every((n) => /^[0-9a-f-]{36}\.json$/.test(n) && isEnv(join(w.convDir, n))))

    // ---- a restore while on writes encrypted files
    await world('restore')
    const rdest = join(w.docs, 'r.jsonl')
    answers.save.push(rdest)
    await w.svc.encrypt(owner)
    for (const c of w.chats.slice(0, 2)) await w.store.remove(c.id)
    answers.open.push(rdest)
    const lk = await w.backups.restoreLook(owner)
    const ap = await w.backups.restoreApply(lk.ok ? lk.preview.token : 'x')
    check(T('D: restoring a backup while encryption is on adds the two missing chats as encrypted files, and the four that are here are skipped'), ap.ok && ap.added === 2 && ap.same === 4 && convFiles().length === 6 && convFiles().every((n) => isEnv(join(w.convDir, n))), JSON.stringify(ap))

    // ---- no chats at all
    await world('empty', 0)
    const e = await w.svc.encrypt(owner)
    check(T('D: with no saved chats there is nothing to back up: it is turned on with no dialog, and the first chat saved is encrypted'), e.ok && e.report.backup === null && asked.length === 0 && (await w.store.save({ id: idOf(1), messages: [msg('user', 'first')], instructions: '' })).ok && isEnv(join(w.convDir, `${idOf(1)}.json`)))
  })
}

// ============ E. what the source must keep true ============
await guard('E', async () => {
  const store = src('main/conversationStore.ts')
  const prot = src('main/chatProtection.ts')
  const ipc = src('main/ipc.ts')
  const pre = src('preload/index.ts')
  const dialogs = src('main/backupDialogs.ts')
  const count = (haystack, needle) => haystack.split(needle).length - 1
  const writes = [...store.matchAll(/writeConversation\([\s\S]*?mode\.form\s*\)/g)].length
  check('E: the store asks how to write before EVERY write (save, add, each conversion, and the question "is writing refused?"), and every write takes its form from that answer (mode.form), never from the caller', count(store, 'await writeMode()') === 4 && writes === 3, `${count(store, 'await writeMode()')} asks, ${writes} writes`)
  check('E: the store seals a chat in one place only (writeConversation), and never calls the secure storage to encrypt anywhere else', count(store, 'sealChat(') === 1 && count(store, '.encrypt(') === 0)
  check('E: the choice file calls the secure storage to encrypt in one place only: turnOn (no new key anywhere else)', count(prot, 'box.encrypt(') === 1 && /turnOn:[\s\S]{0,400}box\.encrypt\(/.test(prot))
  check('E: an unreadable choice, a lost key and a missing storage each REFUSE with their own sentence, and no branch of the rule returns plain for damage', ['BLOCKED.setting', 'BLOCKED.noStorage', 'BLOCKED.key'].every((s) => prot.includes(s)) && /if \(now\.blocked !== null\) return \{ refused: now\.blocked \}/.test(prot) && !/unreadable[^\n]*form: 'plain'/.test(prot))
  check('E: the three new handlers are behind the sender check (guarded or guardedForWindow), and the two that open a dialog use the window the call came from', /CHANNELS\.historyStorage,\s*guarded\(/.test(ipc) && /CHANNELS\.historyEncrypt,\s*guardedForWindow\(/.test(ipc) && /CHANNELS\.historyDecrypt,\s*guardedForWindow\(/.test(ipc))
  check('E: the bridge sends NO argument with encryptChats and decryptChats (the page cannot name a path or answer the question)', /encryptChats: \(\) => ipcRenderer\.invoke\(CHANNELS\.historyEncrypt\)/.test(pre) && /decryptChats: \(\) => ipcRenderer\.invoke\(CHANNELS\.historyDecrypt\)/.test(pre))
  check('E: the message box is the only new dialog and it lives in backupDialogs.ts: no other file in src/main opens a dialog', /dialog\.showMessageBox/.test(dialogs) && readdirSync(join(REPO, 'src/main')).filter((n) => n.endsWith('.ts') && n !== 'backupDialogs.ts').every((n) => !/dialog\.show/.test(src(`main/${n}`))))
  check('E: the message box has "Keep encryption" as its default and its Escape answer (the safe one), and only the first button is a yes', /defaultId: 1/.test(dialogs) && /cancelId: 1/.test(dialogs) && /response === 0/.test(dialogs))
  check('E: the service asks the person before it changes the choice to plain, and asks nothing when it is plain already with nothing encrypted', /confirmPlain\(/.test(src('main/chatEncryptionService.ts')) && /choice === 'off' && counts\.encrypted === 0/.test(src('main/chatEncryptionService.ts')))
  check('E: turning on makes the backup BEFORE it writes the choice, in that order in the source', (() => { const s = src('main/chatEncryptionService.ts'); return s.indexOf('backUpAllBeforeEncrypting(owner)') > 0 && s.indexOf('backUpAllBeforeEncrypting(owner)') < s.indexOf('protection.turnOn()') && s.indexOf('protection.turnOn()') < s.indexOf('store.conform()') })())
  check('E: both flows run inside the backup service\'s lock, and quitting waits for it (the same whenIdle)', /backups\.exclusive<ChatStorageResult>/.test(src('main/chatEncryptionService.ts')) && /backups\.whenIdle\(\)/.test(ipc))
  const statusType = /export interface ChatStorageStatus \{([\s\S]*?)\n\}/.exec(src('shared/ipc.ts'))?.[1] ?? ''
  const fields = [...statusType.matchAll(/^ {2}(\w+): /gm)].map((m) => m[1])
  check('E: the history list tells the page how the chats are kept, and the page is given exactly eight facts about it: no key, no check, no path', /storage: await encryption\.status\(\)/.test(ipc) && same(fields, ['choice', 'canEncrypt', 'keyUsable', 'plain', 'encrypted', 'unreadable', 'unopened', 'blocked']), JSON.stringify(fields))
})

const passed = check.summary()
process.exit(passed ? 0 : 1)
