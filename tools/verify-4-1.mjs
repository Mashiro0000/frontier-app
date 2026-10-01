// Slice 4.1: the conversation validators and the conversation store, straight under Node (no window).
// Runs every store check twice: in a normal temp folder, and in a scratch folder inside the real %APPDATA%,
// which is EFS-encrypted on this PC (so rename fails with EXDEV there: D-010). Run: node verify-4-1.mjs
import { REPO_URL } from './paths.mjs'
import './ts-resolve.mjs'
import { checker } from './cdp.mjs'
import { promises as fsp } from 'node:fs'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { scratch } from './drive.mjs'

const check = checker()
const SRC = `${REPO_URL}/src`
const ipc = await import(`${SRC}/shared/ipc.ts`)
const validate = await import(`${SRC}/shared/validate.ts`)
const storeMod = await import(`${SRC}/main/conversationStore.ts`)
const { HISTORY_LIMITS } = ipc
const { checkConversationId, checkConversationSave, checkSavedMessages, isConversationId } = validate
const { createConversationStore, titleFor, parseSavedFile } = storeMod

const sha = (text) => createHash('sha256').update(text).digest('hex').slice(0, 12)
const msg = (role, content, status = 'done', extra = {}) => ({ role, content, status, ...extra })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const timed = async (fn) => { const t0 = performance.now(); const value = await fn(); return [value, Math.round(performance.now() - t0)] }

// =================================================================================================
// A. The id
// =================================================================================================
{
  const good = randomUUID()
  check('isConversationId: a UUID from crypto.randomUUID() is accepted', isConversationId(good), good)
  const bad = [
    ['upper case', good.toUpperCase()], ['no dashes', good.replaceAll('-', '')], ['one char short', good.slice(1)], ['one char long', good + '0'],
    ['trailing newline', good + '\n'], ['leading space', ' ' + good], ['path traversal', '../../etc/passwd'], ['traversal after a good id', good + '/../x'],
    ['absolute path', 'C:\\Windows\\win.ini'], ['device name', 'con'], ['empty', ''], ['__proto__', '__proto__'], ['non-hex letters', 'zzzzzzzz-zzzz-zzzz-zzzz-zzzzzzzzzzzz'],
    ['a dot at the end', good + '.'], ['with extension', good + '.json'], ['unicode digits', '\u0660'.repeat(8) + good.slice(8)], ['500 chars', 'a'.repeat(500)]
  ]
  for (const [name, value] of bad) check(`isConversationId: ${name} is refused`, !isConversationId(value))
  for (const [name, value] of [['number', 5], ['null', null], ['undefined', undefined], ['object', {}], ['array', [good]], ['boolean', true]]) {
    check(`isConversationId: ${name} is refused`, !isConversationId(value))
    check(`checkConversationId: ${name} is refused`, !checkConversationId(value).ok)
  }
  check('checkConversationId: a good id comes back as exactly that id', checkConversationId(good).ok && checkConversationId(good).id === good)
  check('the limits are what D-016 says', HISTORY_LIMITS.maxConversations === 1000 && HISTORY_LIMITS.maxMessages === 2000 && HISTORY_LIMITS.maxMessageChars === 400_000 && HISTORY_LIMITS.maxTotalChars === 1_500_000)
  check('the file limit covers the worst case of the text limit (every character escaped to 6 bytes) plus overhead', HISTORY_LIMITS.maxFileBytes >= HISTORY_LIMITS.maxTotalChars * 6 + HISTORY_LIMITS.maxMessages * 100)
}

// =================================================================================================
// B. What the page may send to be saved
// =================================================================================================
{
  const id = randomUUID()
  const ok = (input) => checkConversationSave(input)
  const one = ok({ id, messages: [msg('user', 'hello')] })
  check('checkConversationSave: a minimal conversation passes', one.ok && one.conversation.id === id && one.conversation.messages.length === 1)
  check('...and the copy has only the known fields', JSON.stringify(Object.keys(one.conversation.messages[0])) === JSON.stringify(['role', 'content', 'status']))
  const rich = ok({ id, messages: [msg('user', 'q'), msg('assistant', 'partial', 'streaming'), msg('user', 'again'), msg('assistant', '', 'error', { error: 'boom' }), msg('assistant', 'x', 'stopped'), msg('assistant', '', 'done')] })
  check('a message that is still streaming is saved as stopped (it will never finish)', rich.ok && rich.conversation.messages[1].status === 'stopped')
  check('an error keeps its text', rich.ok && rich.conversation.messages[3].status === 'error' && rich.conversation.messages[3].error === 'boom')
  check('an assistant message may be empty (a failed or stopped reply)', rich.ok && rich.conversation.messages[3].content === '' && rich.conversation.messages[5].content === '')
  const extra = ok({ id, messages: [msg('user', 'q', 'done', { error: 'not an error status', id: 'm1', evil: { a: 1 } })], title: 'forged', createdAt: 1, version: 9 })
  check('extra fields (a forged title, dates, a version, an id per message) are dropped', extra.ok && !('title' in extra.conversation) && !('createdAt' in extra.conversation) && JSON.stringify(Object.keys(extra.conversation.messages[0])) === JSON.stringify(['role', 'content', 'status']))
  const proto = JSON.parse(`{"id":"${id}","messages":[{"role":"user","content":"x","status":"done","__proto__":{"role":"assistant"}}]}`)
  const protoResult = ok(proto)
  check('a "__proto__" key in the input changes nothing', protoResult.ok && protoResult.conversation.messages[0].role === 'user' && Object.getPrototypeOf(protoResult.conversation.messages[0]) === Object.prototype)

  const refused = [
    ['null', null], ['a string', 'x'], ['an array', []], ['no id', { messages: [msg('user', 'q')] }], ['no messages', { id }], ['messages is not an array', { id, messages: 'x' }],
    ['no message at all', { id, messages: [] }], ['a bad id', { id: '../x', messages: [msg('user', 'q')] }],
    ['an unknown role', { id, messages: [msg('system', 'q')] }], ['content is a number', { id, messages: [msg('user', 5)] }], ['content is missing', { id, messages: [{ role: 'user', status: 'done' }] }],
    ['an unknown status', { id, messages: [msg('user', 'q', 'weird')] }], ['status missing', { id, messages: [{ role: 'user', content: 'q' }] }],
    ['an item that is null', { id, messages: [msg('user', 'q'), null] }], ['an item that is an array', { id, messages: [msg('user', 'q'), []] }], ['an item that is a string', { id, messages: ['x'] }],
    ['the first message is from the assistant', { id, messages: [msg('assistant', 'a'), msg('user', 'q')] }],
    ['a user message with no text', { id, messages: [msg('user', '')] }], ['a user message of only spaces', { id, messages: [msg('user', '  \n\t ')] }],
    ['an error that is not text', { id, messages: [msg('user', 'q'), msg('assistant', '', 'error', { error: { x: 1 } })] }],
    ['an error that is too long', { id, messages: [msg('user', 'q'), msg('assistant', '', 'error', { error: 'e'.repeat(HISTORY_LIMITS.maxErrorChars + 1) })] }]
  ]
  for (const [name, input] of refused) check(`checkConversationSave: ${name} is refused`, !ok(input).ok)
  check('exactly maxMessages messages pass, one more does not', ok({ id, messages: Array.from({ length: HISTORY_LIMITS.maxMessages }, () => msg('user', 'q')) }).ok && !ok({ id, messages: Array.from({ length: HISTORY_LIMITS.maxMessages + 1 }, () => msg('user', 'q')) }).ok)
  check('a message of exactly maxMessageChars passes, one more does not', ok({ id, messages: [msg('user', 'x'.repeat(HISTORY_LIMITS.maxMessageChars))] }).ok && !ok({ id, messages: [msg('user', 'x'.repeat(HISTORY_LIMITS.maxMessageChars + 1))] }).ok)
  const quarter = HISTORY_LIMITS.maxTotalChars / 4 // 375 000: under the limit for one message, so only the total can refuse
  const four = (extra) => ({ id, messages: [msg('user', 'w'.repeat(quarter)), msg('assistant', 'x'.repeat(quarter)), msg('user', 'y'.repeat(quarter)), msg('assistant', 'z'.repeat(quarter + extra))] })
  check('exactly maxTotalChars in total passes, one more does not', ok(four(0)).ok && !ok(four(1)).ok)
  // The count is looked at before the items, so a huge array costs nothing to refuse.
  // 50 million items, every one a perfectly good message (served by a Proxy, so no memory is spent): only an
  // up-front look at the length can refuse this at once; walking the items would take seconds.
  const hugeList = new Proxy([], { get: (target, key) => (key === 'length' ? 50_000_000 : typeof key === 'string' && /^\d+$/.test(key) ? msg('user', 'q') : Reflect.get(target, key)) })
  check('precondition: the Proxy is a real array of 50 million good-looking messages', Array.isArray(hugeList) && hugeList.length === 50_000_000 && hugeList[49_999_999].content === 'q')
  const [hugeResult, hugeMs] = await timed(async () => ok({ id, messages: hugeList }))
  check('a list of 50 million good messages is refused at once (the length is checked before the items)', !hugeResult.ok && hugeMs < 50, `${hugeMs} ms`)
  const secret = 'sekret-' + 'k'.repeat(20)
  check('a refusal never echoes the input back', !JSON.stringify(ok({ id, messages: [msg('user', 'q'), msg('weird-role-' + secret, 'x')] })).includes(secret))
  check('checkSavedMessages (used on files) behaves the same on a minimal list', checkSavedMessages([msg('user', 'q')]).ok && !checkSavedMessages([]).ok && !checkSavedMessages('x').ok)
}

// =================================================================================================
// C. Titles
// =================================================================================================
{
  check('titleFor: the first message the person wrote', titleFor([msg('user', 'Hello there')]) === 'Hello there')
  check('titleFor: line breaks and runs of spaces become single spaces', titleFor([msg('user', '  a\n\n b\t\tc  ')]) === 'a b c')
  check('titleFor: 60 characters are kept whole', titleFor([msg('user', 'a'.repeat(60))]) === 'a'.repeat(60))
  check('titleFor: 61 are cut to 60 and "..." is added', titleFor([msg('user', 'a'.repeat(61))]) === 'a'.repeat(60) + '...')
  const emoji = titleFor([msg('user', 'a'.repeat(59) + '😀😀😀')])
  check('titleFor: an emoji is never cut in half', emoji.isWellFormed() && emoji === 'a'.repeat(59) + '😀...', JSON.stringify(emoji))
  check('titleFor: the title is the first USER message, not an assistant one', titleFor([msg('assistant', 'zzz'), msg('user', 'mine')]) === 'mine')
  check('titleFor: never longer than the limit on a title', titleFor([msg('user', 'x'.repeat(100_000))]).length <= HISTORY_LIMITS.maxTitleChars)
}

// =================================================================================================
// D. What is accepted from a file
// =================================================================================================
{
  const id = randomUUID()
  const good = { version: 1, id, title: 'T', createdAt: 1000, updatedAt: 2000, messages: [msg('user', 'q'), msg('assistant', 'a')] }
  const parsed = parseSavedFile(good, id)
  check('parseSavedFile: a good file is accepted', typeof parsed === 'object' && parsed.title === 'T' && parsed.messages.length === 2)
  const bad = [
    ['another version', { ...good, version: 3 }], ['no version', { ...good, version: undefined }], ['a version written as a string', { ...good, version: '1' }],
    ['an id that is not the file name', { ...good, id: randomUUID() }], ['no id', { ...good, id: undefined }],
    ['a title that is a number', { ...good, title: 5 }], ['a title that is too long', { ...good, title: 'x'.repeat(HISTORY_LIMITS.maxTitleChars + 1) }],
    ['a negative date', { ...good, createdAt: -1 }], ['a fractional date', { ...good, updatedAt: 1.5 }], ['a date as text', { ...good, createdAt: '1000' }], ['an unsafe integer date', { ...good, updatedAt: 2 ** 60 }], ['NaN as a date', { ...good, updatedAt: NaN }],
    ['messages that are not a list', { ...good, messages: {} }], ['no messages', { ...good, messages: [] }], ['a bad message', { ...good, messages: [msg('user', 'q'), { role: 'x' }] }],
    ['null', null], ['an array', []], ['a number', 5], ['a string', 'x']
  ]
  for (const [name, value] of bad) check(`parseSavedFile: ${name} is refused`, typeof parseSavedFile(value, id) === 'string', String(parseSavedFile(value, id)).slice(0, 60))
  check('parseSavedFile: a file with "streaming" in it opens as stopped', parseSavedFile({ ...good, messages: [msg('user', 'q'), msg('assistant', 'p', 'streaming')] }, id).messages[1].status === 'stopped')
  check('parseSavedFile: extra top-level fields are ignored, not carried along', !('evil' in parseSavedFile({ ...good, evil: 1 }, id)))
}

// =================================================================================================
// E. The store, in a normal folder and in the EFS-encrypted one
// =================================================================================================
async function storeChecks(baseDir, where) {
  const T = (name) => `[${where}] ${name}`
  const mk = () => join(baseDir, randomBytes(4).toString('hex'))
  const wipe = (dir) => fsp.rm(dir, { recursive: true, force: true })
  const read = (dir, name) => fsp.readFile(join(dir, name), 'utf8')
  const names = async (dir) => (await fsp.readdir(dir).catch(() => [])).sort()
  const snapshot = async (dir) => Object.fromEntries(await Promise.all((await names(dir)).map(async (n) => [n, (await fsp.stat(join(dir, n))).isDirectory() ? 'directory' : sha(await fsp.readFile(join(dir, n)))])))
  const U = (q = 'hello', a = 'hi') => [msg('user', q), msg('assistant', a)]

  // ---- environment: is this really the hostile folder? ----
  {
    const dir = mk(); await fsp.mkdir(dir, { recursive: true })
    await fsp.writeFile(join(dir, 'a'), 'x')
    const code = await fsp.rename(join(dir, 'a'), join(dir, 'b')).then(() => 'works', (e) => e.code)
    console.log(`  (info) [${where}] fs.rename inside ${baseDir} -> ${code}`)
    await wipe(dir)
  }

  // ---- first use: nothing is created by looking ----
  {
    const dir = mk()
    const store = createConversationStore(dir)
    const listed = await store.list()
    check(T('a folder that does not exist yet lists as empty'), listed.conversations.length === 0 && listed.unreadable === 0)
    check(T('...and looking at it does not create the folder'), (await names(dir)).length === 0 && !(await fsp.stat(dir).then(() => true, () => false)))
    check(T('loading an id that was never saved says "not found"'), (await store.load(randomUUID())).ok === false)
    check(T('removing an id that was never saved is fine (nothing to remove)'), (await store.remove(randomUUID())).ok === true)
    check(T('...and does not create the folder either'), !(await fsp.stat(dir).then(() => true, () => false)))
    await wipe(dir)
  }

  // ---- save, list, load, remove ----
  {
    const dir = mk()
    const store = createConversationStore(dir)
    const id = randomUUID()
    const saved = await store.save({ id, messages: U('first question', 'first answer') })
    check(T('save answers with a summary'), saved.ok && saved.summary.id === id && saved.summary.title === 'first question' && saved.summary.messageCount === 2)
    check(T('the folder holds exactly one file, named <id>.json (no leftover .tmp)'), JSON.stringify(await names(dir)) === JSON.stringify([`${id}.json`]), JSON.stringify(await names(dir)))
    const onDisk = JSON.parse(await read(dir, `${id}.json`))
    check(T('the file is the documented shape (version 2, id, title, dates, messages)'), onDisk.version === 2 && onDisk.id === id && onDisk.title === 'first question' && Number.isSafeInteger(onDisk.createdAt) && onDisk.updatedAt >= onDisk.createdAt && onDisk.messages.length === 2, JSON.stringify(Object.keys(onDisk)))
    check(T('no message carries an id or a "streaming" status in the file'), onDisk.messages.every((m) => JSON.stringify(Object.keys(m)) === JSON.stringify(['role', 'content', 'status']) && m.status !== 'streaming'))
    check(T('the file is one line of compact JSON'), !(await read(dir, `${id}.json`)).includes('\n'))
    const loaded = await store.load(id)
    check(T('load returns what was saved (a reply saved with no model comes back with provider and model null, D-021)'), loaded.ok && JSON.stringify(loaded.conversation.messages) === JSON.stringify(U('first question', 'first answer').map((m) => (m.role === 'assistant' ? { ...m, provider: null, model: null } : m))))
    const created = onDisk.createdAt
    await sleep(15)
    const again = await store.save({ id, messages: [...U('first question', 'first answer'), msg('user', 'second')] })
    const onDisk2 = JSON.parse(await read(dir, `${id}.json`))
    check(T('saving again replaces the whole conversation and keeps createdAt'), again.ok && onDisk2.createdAt === created && onDisk2.updatedAt > created && onDisk2.messages.length === 3)
    check(T('...and still leaves no .tmp'), JSON.stringify(await names(dir)) === JSON.stringify([`${id}.json`]))
    check(T('a fresh store (as after a restart) lists it with the same summary'), JSON.stringify((await createConversationStore(dir).list()).conversations) === JSON.stringify([again.summary]))
    check(T('remove deletes the file, and the list forgets it'), (await store.remove(id)).ok && (await names(dir)).length === 0 && (await store.list()).conversations.length === 0)
    check(T('...and a removed conversation cannot be loaded any more'), !(await store.load(id)).ok)
    check(T('removing it again is fine'), (await store.remove(id)).ok)
    await wipe(dir)
  }

  // ---- ordering and the cap ----
  {
    const dir = mk()
    const store = createConversationStore(dir)
    const realNow = Date.now
    const ids = [randomUUID(), randomUUID(), randomUUID()]
    let clock = 1_000_000
    Date.now = () => clock
    try {
      for (const [i, id] of ids.entries()) { clock += 1000; await store.save({ id, messages: U(`conv ${i}`) }) }
      clock += 1000; await store.save({ id: ids[0], messages: U('conv 0 again') }) // the oldest becomes the newest
    } finally { Date.now = realNow }
    const order = (await store.list()).conversations.map((c) => c.title)
    check(T('the list is newest first, by last save'), JSON.stringify(order) === JSON.stringify(['conv 0 again', 'conv 2', 'conv 1']), JSON.stringify(order))
    check(T('...and a restart gives the same order'), JSON.stringify((await createConversationStore(dir).list()).conversations.map((c) => c.title)) === JSON.stringify(order))
    // cap: lowered for the test (the object is the one the store reads)
    const real = HISTORY_LIMITS.maxConversations
    HISTORY_LIMITS.maxConversations = 3
    try {
      const refused = await store.save({ id: randomUUID(), messages: U('one too many') })
      check(T('with the cap reached, a NEW conversation is refused with an explanation'), refused.ok === false && /already 3 saved/.test(refused.error), refused.error)
      check(T('...an existing one can still be saved'), (await store.save({ id: ids[1], messages: U('conv 1 edited') })).ok)
      check(T('...and the refused one left nothing on disk'), (await names(dir)).length === 3)
      await store.remove(ids[2])
      check(T('...removing one makes room again'), (await store.save({ id: randomUUID(), messages: U('now fits') })).ok)
    } finally { HISTORY_LIMITS.maxConversations = real }
    await wipe(dir)
  }

  // ---- too large to write (so too large to read back) ----
  {
    const dir = mk()
    const store = createConversationStore(dir)
    // Control characters escape to 6 bytes each in JSON: 2 million of them is about 12 MB, over the 10 MB limit.
    const refused = await store.save({ id: randomUUID(), messages: [msg('user', '\u0001'.repeat(2_000_000))] })
    check(T('a conversation whose JSON would be over the file limit is refused, not written'), refused.ok === false && /too large/.test(refused.error), refused.error)
    check(T('...and nothing was created'), (await names(dir)).length === 0)
    await wipe(dir)
  }

  // ---- text that must survive the round trip ----
  {
    const dir = mk()
    const store = createConversationStore(dir)
    const id = randomUUID()
    const tricky = ['emoji 😀👨‍👩‍👧', 'RTL שלום مرحبا', 'NUL \u0000 and \u0001 and \u001f', 'lone surrogate \ud800 here', 'CRLF\r\nline\r\n', 'quotes "x" \\ backslash \' </script>', 'tab\tseparated', '\u2028\u2029 line separators', 'x'.repeat(100_000)]
    await store.save({ id, messages: tricky.flatMap((t) => [msg('user', t), msg('assistant', t)]) })
    const back = await createConversationStore(dir).load(id)
    check(T('emoji, RTL, control characters, a lone surrogate, CRLF, quotes and 100 000 characters round-trip exactly'), back.ok && back.conversation.messages.every((m, i) => m.content === tricky[Math.floor(i / 2)]))
    await wipe(dir)
  }

  // ---- crash states, built by hand, read by a fresh store ----
  {
    const make = (title, extra = {}) => JSON.stringify({ version: 1, id: extra.id, title, createdAt: 1000, updatedAt: extra.updatedAt ?? 2000, messages: [msg('user', title), msg('assistant', 'a')] })
    const cases = []
    const add = (name, build, expectTitles, expectUnreadable, expectLoad) => cases.push({ name, build, expectTitles, expectUnreadable, expectLoad })
    add('only a good file', async (d, id) => { await fsp.writeFile(join(d, `${id}.json`), make('final', { id })) }, ['final'], 0, 'final')
    add('a torn real file + a whole .tmp: the .tmp wins (crash during step 2)', async (d, id) => { await fsp.writeFile(join(d, `${id}.json`), make('final', { id }).slice(0, 40)); await fsp.writeFile(join(d, `${id}.json.tmp`), make('newer', { id })) }, ['newer'], 0, 'newer')
    add('a whole real file + a cut-off .tmp: the real file wins (crash during step 1)', async (d, id) => { await fsp.writeFile(join(d, `${id}.json`), make('final', { id })); await fsp.writeFile(join(d, `${id}.json.tmp`), make('newer', { id }).slice(0, 70)) }, ['final'], 0, 'final')
    add('a whole real file + a whole .tmp (crash before step 3): the .tmp wins', async (d, id) => { await fsp.writeFile(join(d, `${id}.json`), make('final', { id })); await fsp.writeFile(join(d, `${id}.json.tmp`), make('newer', { id })) }, ['newer'], 0, 'newer')
    add('only a whole .tmp (crash before the first copy)', async (d, id) => { await fsp.writeFile(join(d, `${id}.json.tmp`), make('only-tmp', { id })) }, ['only-tmp'], 0, 'only-tmp')
    add('only a cut-off .tmp (the very first save died in step 1)', async (d, id) => { await fsp.writeFile(join(d, `${id}.json.tmp`), make('x', { id }).slice(0, 50)) }, [], 1, null)
    add('only a torn real file', async (d, id) => { await fsp.writeFile(join(d, `${id}.json`), make('final', { id }).slice(0, 60)) }, [], 1, null)
    add('a real file that is empty', async (d, id) => { await fsp.writeFile(join(d, `${id}.json`), '') }, [], 1, null)
    add('5 MB of random bytes', async (d, id) => { await fsp.writeFile(join(d, `${id}.json`), randomBytes(5 * 1024 * 1024)) }, [], 1, null)
    add('a file over the size limit (a sparse 11 MB file; never read)', async (d, id) => { const h = await fsp.open(join(d, `${id}.json`), 'w'); await h.truncate(11 * 1024 * 1024); await h.close() }, [], 1, null)
    add('JSON null', async (d, id) => { await fsp.writeFile(join(d, `${id}.json`), 'null') }, [], 1, null)
    add('a JSON array', async (d, id) => { await fsp.writeFile(join(d, `${id}.json`), '[]') }, [], 1, null)
    add('another version', async (d, id) => { await fsp.writeFile(join(d, `${id}.json`), make('v3', { id }).replace('"version":1', '"version":3')) }, [], 1, null)
    add('an id inside that is not the file name', async (d, id) => { await fsp.writeFile(join(d, `${id}.json`), make('other', { id: randomUUID() })) }, [], 1, null)
    add('a "__proto__" key inside', async (d, id) => { await fsp.writeFile(join(d, `${id}.json`), make('proto', { id }).replace('{"version"', '{"__proto__":{"version":2},"version"')) }, ['proto'], 0, 'proto')
    add('a good file that starts with a byte-order mark (an editor added it)', async (d, id) => { await fsp.writeFile(join(d, `${id}.json`), '\ufeff' + make('bom', { id })) }, ['bom'], 0, 'bom')
    add('a file saved with "streaming" in it', async (d, id) => { await fsp.writeFile(join(d, `${id}.json`), make('s', { id }).replace('"status":"done"', '"status":"streaming"')) }, ['s'], 0, 's')
    add('a directory with the name of a conversation file', async (d, id) => { await fsp.mkdir(join(d, `${id}.json`)) }, [], 1, null)
    for (const c of cases) {
      const dir = mk(); await fsp.mkdir(dir, { recursive: true })
      const id = randomUUID()
      await c.build(dir, id)
      // files that are NOT conversations must be ignored without a fuss
      await fsp.writeFile(join(dir, 'notes.txt'), 'hello'); await fsp.writeFile(join(dir, 'README.json'), '{}'); await fsp.writeFile(join(dir, `${randomUUID().toUpperCase()}.json`), '{}'); await fsp.writeFile(join(dir, `${id}.json.bak`), 'x')
      const before = await snapshot(dir)
      const warned = []; const realWarn = console.warn; console.warn = (...a) => warned.push(a.join(' '))
      const readPaths = []; const realRead = fsp.readFile
      fsp.readFile = async (p, ...rest) => { readPaths.push(String(p)); return realRead(p, ...rest) }
      let listed, loaded, crashed = null
      try { const store = createConversationStore(dir); listed = await store.list(); loaded = c.expectLoad === null ? await store.load(id) : await store.load(id) } catch (e) { crashed = e } finally { console.warn = realWarn; fsp.readFile = realRead }
      if (c.name.startsWith('a file over the size limit')) check(T(`state "${c.name}": its content was never read (the size is looked at first, so no file can fill the memory)`), !readPaths.some((p) => p.includes(id)), JSON.stringify(readPaths.filter((p) => p.includes(id)).length))
      const titles = listed?.conversations.map((x) => x.title) ?? []
      check(T(`state "${c.name}": listing does not throw`), crashed === null, crashed?.message)
      check(T(`state "${c.name}": lists ${JSON.stringify(c.expectTitles)} and counts ${c.expectUnreadable} unreadable`), JSON.stringify(titles) === JSON.stringify(c.expectTitles) && listed?.unreadable === c.expectUnreadable, `${JSON.stringify(titles)} / ${listed?.unreadable}`)
      if (c.expectLoad !== null) check(T(`state "${c.name}": load gives the "${c.expectLoad}" conversation`), loaded?.ok && loaded.conversation.title === c.expectLoad, JSON.stringify(loaded).slice(0, 80))
      else check(T(`state "${c.name}": load refuses it`), loaded?.ok === false)
      check(T(`state "${c.name}": reading wrote nothing (every file byte-identical, none added or removed)`), JSON.stringify(await snapshot(dir)) === JSON.stringify(before))
      if (c.expectUnreadable) check(T(`state "${c.name}": the problem is named in the log by id, with no path`), warned.some((w) => w.includes(id)) && !warned.some((w) => w.includes(baseDir)), warned.join(' | ').slice(0, 100))
      await wipe(dir)
    }
  }

  // ---- disk trouble during a save (faults injected into fs.promises) ----
  {
    const faults = [
      { name: 'copying the new file over the old one fails (step 2)', patch: (f) => { f.copyFile = async () => { throw Object.assign(new Error('EIO: simulated'), { code: 'EIO' }) } }, expect: 'tmp-newer' },
      { name: 'the first write is cut off halfway (step 1)', patch: (f, real) => { f.writeFile = async (p, t, o) => { await real.writeFile(p, String(t).slice(0, Math.floor(String(t).length / 2)), o); throw Object.assign(new Error('ENOSPC: simulated'), { code: 'ENOSPC' }) } }, expect: 'old' },
      { name: 'the new copy reads back different (disk corruption)', patch: (f, real) => { let first = true; f.readFile = async (p, enc) => { const t = await real.readFile(p, enc); if (first && String(p).endsWith('.tmp')) { first = false; return String(t).replace('NEW', 'new') } return t } }, expect: 'old' },
      { name: 'the real file reads back different after the copy', patch: (f, real) => { f.readFile = async (p, enc) => { const t = await real.readFile(p, enc); return String(p).endsWith('.json') ? String(t).replace('NEW', 'new') : t } }, expect: 'tmp-newer' },
      { name: 'deleting the .tmp fails afterwards (an antivirus holds it)', patch: (f) => { f.rm = async (p, o) => { if (String(p).endsWith('.tmp')) throw Object.assign(new Error('EBUSY: simulated'), { code: 'EBUSY' }); return realRm(p, o) } }, expect: 'new-ok' }
    ]
    const realRm = fsp.rm
    for (const fault of faults) {
      const dir = mk()
      const store = createConversationStore(dir)
      const id = randomUUID()
      await store.save({ id, messages: U('OLD question', 'old answer') })
      const real = { copyFile: fsp.copyFile, writeFile: fsp.writeFile, readFile: fsp.readFile, rm: fsp.rm }
      let error = null, outcome
      fault.patch(fsp, real)
      try { outcome = await store.save({ id, messages: U('NEW question', 'new answer') }) } catch (e) { error = e } finally { Object.assign(fsp, real) }
      if (fault.expect === 'new-ok') check(T(`fault "${fault.name}": the save still succeeds`), error === null && outcome.ok)
      else check(T(`fault "${fault.name}": the save fails loudly (the page is told)`), error !== null, error?.message)
      const after = await createConversationStore(dir).load(id)
      const title = after.ok ? after.conversation.title : '(unreadable)'
      const want = fault.expect === 'old' ? 'OLD question' : 'NEW question'
      check(T(`fault "${fault.name}": a restart then finds the ${fault.expect === 'old' ? 'OLD (untouched)' : 'NEW (complete)'} conversation`), title === want, title)
      // and the system heals: the next save works and leaves a clean folder
      const healed = await store.save({ id, messages: U('NEW question', 'newer answer') })
      const files = await names(dir)
      check(T(`fault "${fault.name}": the next save works and leaves only <id>.json`), healed.ok && JSON.stringify(files) === JSON.stringify([`${id}.json`]), JSON.stringify(files))
      await wipe(dir)
    }
  }

  // ---- the folder cannot be listed (permissions): an error, never a silently empty list; and it recovers ----
  {
    const dir = mk(); await fsp.mkdir(dir, { recursive: true })
    const id = randomUUID()
    await fsp.writeFile(join(dir, `${id}.json`), JSON.stringify({ version: 1, id, title: 'kept', createdAt: 1000, updatedAt: 2000, messages: [msg('user', 'kept'), msg('assistant', 'a')] }))
    const store = createConversationStore(dir)
    const realReaddir = fsp.readdir
    fsp.readdir = async () => { throw Object.assign(new Error('EACCES: permission denied, scandir ' + dir), { code: 'EACCES' }) }
    let listError = null, saveError = null
    try { await store.list() } catch (e) { listError = e }
    try { await store.save({ id: randomUUID(), messages: U('cannot be saved either') }) } catch (e) { saveError = e }
    fsp.readdir = realReaddir
    check(T('a folder that cannot be listed makes list() REJECT (it is not reported as empty)'), listError?.code === 'EACCES', String(listError?.code))
    check(T('...and makes save() reject too (it cannot know whether the folder is full), without writing anything'), saveError?.code === 'EACCES' && (await names(dir)).length === 1, String(saveError?.code))
    const after = await store.list()
    check(T('...and once the fault is gone, the same store lists the conversation (the failure was not remembered)'), after.conversations.length === 1 && after.conversations[0].title === 'kept')
    await wipe(dir)
  }

  // ---- ordering under pressure ----
  {
    const dir = mk()
    const store = createConversationStore(dir)
    const id = randomUUID()
    const results = await Promise.all(Array.from({ length: 60 }, (_, i) => store.save({ id, messages: U(`question ${i}`, 'x'.repeat(i * 50)) })))
    const final = await createConversationStore(dir).load(id)
    check(T('60 saves of one conversation fired at once: all succeed'), results.every((r) => r.ok))
    check(T('...the LAST one asked for is what is on disk'), final.ok && final.conversation.title === 'question 59' && final.conversation.messages[1].content.length === 59 * 50)
    check(T('...and nothing else is left in the folder'), JSON.stringify(await names(dir)) === JSON.stringify([`${id}.json`]))
    const ids = Array.from({ length: 40 }, () => randomUUID())
    await Promise.all(ids.map((x, i) => store.save({ id: x, messages: U(`parallel ${i}`) })))
    const listed = (await createConversationStore(dir).list()).conversations
    check(T('40 different conversations saved at once: all 41 are there'), listed.length === 41)
    const raceId = randomUUID()
    const ops = [store.save({ id: raceId, messages: U('v1') }), store.remove(raceId), store.save({ id: raceId, messages: U('v3') }), store.load(raceId)]
    const [, , , seen] = await Promise.all(ops)
    check(T('save, remove, save, load in a burst: they run in that order (the load sees v3)'), seen.ok && seen.conversation.title === 'v3')
    const raceId2 = randomUUID()
    await Promise.all([store.save({ id: raceId2, messages: U('x') }), store.remove(raceId2)])
    check(T('a save followed at once by a remove leaves nothing behind'), !(await names(dir)).some((n) => n.startsWith(raceId2)))
    let idle = false
    const pending = Promise.all(Array.from({ length: 10 }, (_, i) => store.save({ id: randomUUID(), messages: U(`bulk ${i}`, 'y'.repeat(50_000)) })))
    await store.whenIdle(); idle = true
    const countAfterIdle = (await names(dir)).filter((n) => n.endsWith('.json')).length
    await pending
    // 1 + 40 + the re-saved race conversation = 42 files before the ten bulk saves, so 52 once they have all landed
    check(T('whenIdle() resolves only after every save asked for before it has finished (all 10 are on disk at that moment)'), idle && countAfterIdle === 52 && (await names(dir)).filter((n) => n.endsWith('.json')).length === 52, `${countAfterIdle}`)
    await wipe(dir)
  }

  // ---- the store does not trust an id, either (defence in depth) ----
  {
    const dir = mk()
    const outside = join(baseDir, 'outside-' + randomBytes(3).toString('hex'))
    const store = createConversationStore(dir)
    for (const bad of ['../outside', '..\\outside', '/etc/passwd', 'C:\\x', '', 'con', '__proto__', randomUUID().toUpperCase()]) {
      const results = await Promise.allSettled([store.load(bad), store.save({ id: bad, messages: U() }), store.remove(bad)])
      check(T(`the store itself refuses the id ${JSON.stringify(bad).slice(0, 30)} (load, save and remove)`), results.every((r) => r.status === 'rejected' || (r.status === 'fulfilled' && r.value.ok === false)) && (await names(dir)).length === 0)
    }
    check(T('...and nothing was written outside the folder'), !(await fsp.stat(outside).then(() => true, () => false)) && !(await fsp.stat(join(dir, '..', 'outside.json')).then(() => true, () => false)))
    await wipe(dir)
  }

  // ---- speed of the first look ----
  {
    const dir = mk(); await fsp.mkdir(dir, { recursive: true })
    const body = (id, i) => JSON.stringify({ version: 1, id, title: `conversation ${i}`, createdAt: 1000 + i, updatedAt: 2000 + i, messages: Array.from({ length: 20 }, (_, k) => msg(k % 2 ? 'assistant' : 'user', 'lorem ipsum dolor sit amet '.repeat(40) + k)) })
    for (let i = 0; i < 1000; i++) { const id = randomUUID(); await fsp.writeFile(join(dir, `${id}.json`), body(id, i)) }
    const size = (await fsp.stat(join(dir, (await names(dir))[0]))).size
    const [listed, ms] = await timed(() => createConversationStore(dir).list())
    check(T(`1000 saved conversations of about ${Math.round(size / 1024)} KB each: the first list() reads them all`), listed.conversations.length === 1000 && listed.unreadable === 0, `${ms} ms`)
    console.log(`  (info) [${where}] first list() of 1000 conversations (${Math.round(size / 1024)} KB each, ${Math.round((size * 1000) / 1024 / 1024)} MB in all): ${ms} ms`)
    check(T('...in a time nobody would wait for (under 10 s)'), ms < 10_000, `${ms} ms`)
    const [, ms2] = await timed(() => createConversationStore(dir).list())
    console.log(`  (info) [${where}] second, warm: ${ms2} ms`)
    const same = createConversationStore(dir); await same.list()
    const [, ms3] = await timed(() => same.list())
    check(T('a second list() on the same store is served from memory (under 100 ms)'), ms3 < 100, `${ms3} ms`)
    await wipe(dir)
  }
}

const normal = join(tmpdir(), 'frontier-s4-store-' + randomBytes(3).toString('hex'))
await fsp.mkdir(normal, { recursive: true })
const efs = scratch('s4store')
await fsp.rm(efs, { recursive: true, force: true })
await fsp.mkdir(efs, { recursive: true })
try {
  await storeChecks(normal, 'temp')
  await storeChecks(efs, 'EFS')
} finally {
  await fsp.rm(normal, { recursive: true, force: true })
  await fsp.rm(efs, { recursive: true, force: true })
}
process.exit(check.summary() ? 0 : 1)
