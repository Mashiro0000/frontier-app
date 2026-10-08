// Slice 11.2 under plain Node (no window): the audit log of tool calls (D-041). The events (what a line may hold, and nothing else), the file (appended and
// proved, never rewritten; sealed like the chats when encryption is on; a cut-off line skipped and not joined; the newest part only), the rewrite when
// encryption is turned on or off (and the mending of a rewrite that was cut off), the service (calls put together, the view, the export, the deletion that
// asks in the system's box), the core writing into the real log, and source checks on what must not reach it.
// Run: node tools/verify-11-2.mjs
import './ts-resolve.mjs'
import { checker } from './cdp.mjs'
import { createHash } from 'node:crypto'
import fsSync, { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { REPO, REPO_URL } from './paths.mjs'
import { makeBox } from './lib8b3.mjs'

const check = checker()
const guard = async (name, fn) => { try { await fn() } catch (error) { check(`${name} did not run to its end: ${String(error?.stack ?? error).slice(0, 300)}`, false) } }
const show = (v) => JSON.stringify(v)?.slice(0, 300)
const SRC = `${REPO_URL}/src`
const sharedTools = await import(`${SRC}/shared/tools.ts`)
const sharedAudit = await import(`${SRC}/shared/audit.ts`)
const logMod = await import(`${SRC}/main/auditLog.ts`)
const svcMod = await import(`${SRC}/main/auditService.ts`)
const coreMod = await import(`${SRC}/main/toolCore.ts`)
const registryMod = await import(`${SRC}/main/toolRegistry.ts`)
const budgetMod = await import(`${SRC}/main/replyBudget.ts`)
const gateMod = await import(`${SRC}/main/systemQuestion.ts`)
const keptMod = await import(`${SRC}/main/keptFile.ts`)
const source = (rel) => readFileSync(join(REPO, rel), 'utf8')
const within = (promise, ms, what) => Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error(`no answer within ${ms} ms: ${what}`)), ms))])
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const cp = (n) => String.fromCodePoint(n)
const ZWSP = cp(0x200b)
const RLO = cp(0x202e)
const LSEP = cp(0x2028)
const PRIVATE = cp(0xe000)
const NUL = String.fromCharCode(0)
const sha = (text) => createHash('sha256').update(text).digest('hex')

const logged = []
const realError = console.error
console.error = (...args) => { logged.push(args.map(String).join(' ')) }

const root = mkdtempSync(join(tmpdir(), 'frontier-112-'))
let dirCount = 0
const tempDir = () => { const d = join(root, `d${++dirCount}`); mkdirSync(d, { recursive: true }); return d }

const T0 = 1_700_000_000_000
const SOURCES = [
  { title: 'Rust 1.90 released', url: 'https://blog.rust-lang.org/2026/09/10/Rust-1.90.html' },
  { title: 'Release notes', url: 'https://doc.rust-lang.org/stable/releases.html' }
]
/** The events of one allowed and finished call. */
const callEvents = (call = 'c1', over = {}) => [
  { type: 'asked', at: T0, call, tool: 'web_search', step: 1, args: { query: 'rust release notes' }, why: 'The person asked for the newest release.' },
  { type: 'answered', at: T0 + 1000, call, tool: 'web_search', step: 1, answer: 'yes' },
  { type: 'ran', at: T0 + 1001, call, tool: 'web_search', step: 1 },
  { type: 'result', at: T0 + 2500, call, tool: 'web_search', step: 1, ok: true, size: 5123, sources: SOURCES.map((s) => ({ ...s })), searched: 'rust release notes', searches: 1, ...over }
]
const refusedEvent = (code = 'tool-off', call = 'r1') => ({ type: 'refused', at: T0 + 5000, call, tool: 'web_search', step: 2, code })
const ALL_KINDS = [refusedEvent(), ...callEvents()]
const lineOf = (event) => logMod.auditLine(event)

const plainMode = async () => ({ form: 'plain' })
const sealedMode = async () => ({ form: 'encrypted' })
/** A log in its own folder; `mode` is what the one rule for writing says (it can be changed while the test runs). */
function makeLog(options = {}) {
  const dir = options.dir ?? tempDir()
  const state = { mode: options.mode ?? 'plain', refused: options.refused ?? null }
  const box = options.box
  const log = logMod.createAuditLog({
    pathOf: () => join(dir, 'audit', 'log.jsonl'),
    box,
    writeMode: async () => (state.refused !== null ? { refused: state.refused } : { form: state.mode })
  })
  return { log, dir, state, file: join(dir, 'audit', 'log.jsonl'), box }
}
const fileText = (l) => readFileSync(l.file, 'utf8')
const linesOf = (text) => text.split('\n').filter((line) => line !== '')
const rejects = async (promise) => { try { await promise; return null } catch (error) { return error } }
const eventsText = (events) => show(events)

// ============ A. the events: what a line may hold, and nothing else ============
await guard('A', async () => {
  for (const event of ALL_KINDS) {
    const text = lineOf(event)
    check(`A: a ${event.type} event is one line of JSON that reads back as itself`, !text.includes('\n') && JSON.stringify(logMod.parseAuditEvent(JSON.parse(text))) === JSON.stringify(event), text.slice(0, 120))
  }
  check('A: a line begins with the format version and the type, in a fixed order', lineOf(callEvents()[0]).startsWith('{"v":1,"type":"asked","at":1700000000000,"call":"c1","tool":"web_search","step":1,"args":'))
  check('A: an event of a tool this version does not know still reads (the log may come from another version), and so does "(unknown)"', logMod.parseAuditEvent(JSON.parse(lineOf({ ...refusedEvent(), tool: 'other_tool' }))) !== null && logMod.parseAuditEvent(JSON.parse(lineOf({ ...refusedEvent('unknown-tool'), tool: '(unknown)' }))) !== null)
  check('A: every refusal code and every answer the core can give is accepted', sharedTools.REFUSAL_CODES.every((code) => logMod.parseAuditEvent(JSON.parse(lineOf(refusedEvent(code)))) !== null) && sharedTools.ANSWER_CODES.every((answer) => logMod.parseAuditEvent(JSON.parse(lineOf({ ...callEvents()[1], answer }))) !== null) && sharedTools.REFUSAL_CODES.length === 13 && sharedTools.ANSWER_CODES.length === 6)
  check('A: a search with letters of other languages, quotes and a backslash is kept as typed', (() => {
    const e = callEvents('c9')[0]
    e.args = { query: 'caf\u00e9 "quoted" \\ \u65e5\u672c\u8a9e \ud83d\ude00' }
    const back = logMod.parseAuditEvent(JSON.parse(lineOf(e)))
    return back !== null && back.args.query === e.args.query
  })())

  const parse = (obj) => logMod.parseAuditEvent(JSON.parse(JSON.stringify(obj)))
  const raw = (event) => JSON.parse(lineOf(event))
  const refuse = (what, obj) => check(`A: refused: ${what}`, parse(obj) === null)
  for (const [what, value] of [['null', null], ['a list', []], ['text', 'x'], ['a number', 5], ['true', true]]) refuse(`a line that is ${what}`, value)
  for (const event of ALL_KINDS) {
    const r = raw(event)
    refuse(`a ${event.type} event with a field more`, { ...r, extra: 1 })
    for (const key of Object.keys(r)) {
      const { [key]: _gone, ...rest } = r
      refuse(`a ${event.type} event without "${key}"`, rest)
    }
    refuse(`a ${event.type} event of version 2`, { ...r, v: 2 })
    refuse(`a ${event.type} event with the version as text`, { ...r, v: '1' })
    refuse(`a ${event.type} event with no time (0)`, { ...r, at: 0 })
    refuse(`a ${event.type} event with a fractional time`, { ...r, at: 1.5 })
    refuse(`a ${event.type} event with a time as text`, { ...r, at: '1700000000000' })
    refuse(`a ${event.type} event with an unsafe number for a time`, { ...r, at: 2 ** 60 })
    for (const call of ['', 'UPPER', 'a b', 'x'.repeat(41), '-lead', 5, null]) refuse(`a ${event.type} event with the call id ${show(call)}`, { ...r, call })
    for (const tool of ['Upper', 'a', 'x'.repeat(33), '', '(unknown', 'web search', 5, null]) refuse(`a ${event.type} event with the tool ${show(tool)}`, { ...r, tool })
    for (const step of [-1, 1.5, 100_001, '1', null]) refuse(`a ${event.type} event with the step ${show(step)}`, { ...r, step })
  }
  check('A: ...a step of 0 (Stop everything before any step) and of 100,000 are fine', parse({ ...raw(refusedEvent('stopped')), step: 0 }) !== null && parse({ ...raw(refusedEvent('stopped')), step: 100_000 }) !== null)
  refuse('a type that this version does not know', { ...raw(refusedEvent()), type: 'stopped' })
  refuse('the closing line of a rewrite, as if it were an event', { v: 1, type: 'commit', lines: 3 })
  refuse('no type', (() => { const { type: _t, ...rest } = raw(refusedEvent()); return rest })())
  refuse('a refusal code that does not exist', { ...raw(refusedEvent()), code: 'nope' })
  refuse('a refusal code as a number', { ...raw(refusedEvent()), code: 5 })
  refuse('an answer that does not exist', { ...raw(callEvents()[1]), answer: 'maybe' })
  const asked = raw(callEvents()[0])
  for (const [what, args] of [['a list', []], ['null', null], ['text', 'query'], ['nine arguments', Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`a${i}`, 'x']))], ['a name in capitals', { Query: 'x' }], ['a name with a dash', { 'a-b': 'x' }], ['a value that is true', { query: true }], ['a value that is null', { query: null }], ['a value that is an object', { query: {} }], ['a value that is a list', { query: ['x'] }], ['a value with a line break', { query: 'a\nb' }], ['a value with a tab', { query: 'a\tb' }], ['a value with a null character', { query: `a${NUL}b` }], ['a value with an invisible character', { query: `a${ZWSP}b` }], ['a value with a reversing character', { query: `a${RLO}b` }], ['a value with a line separator', { query: `a${LSEP}b` }], ['a value with a private-use character', { query: `a${PRIVATE}b` }], ['a value over 2,000 characters', { query: 'x'.repeat(2001) }]]) {
    refuse(`arguments that are ${what}`, { ...asked, args })
  }
  check('A: ...no arguments at all, and a number or an empty text as one, are fine', parse({ ...asked, args: {} }) !== null && parse({ ...asked, args: { count: 5 } }) !== null && parse({ ...asked, args: { query: '' } }) !== null)
  for (const why of ['', 'x'.repeat(1001), 'a\nb', `a${RLO}b`, `a${ZWSP}b`, 5, null]) refuse(`a reason of ${show(why)?.slice(0, 20)}`, { ...asked, why })
  const result = raw(callEvents()[3])
  for (const [what, patch] of [['ok as text', { ok: 'true' }], ['ok as 1', { ok: 1 }], ['a negative size', { size: -1 }], ['a size over the cap', { size: 60_201 }], ['a fractional size', { size: 1.5 }], ['sources that are not a list', { sources: 'https://example.com/' }], ['sources that are null', { sources: null }], ['21 sources', { sources: Array.from({ length: 21 }, (_, i) => ({ title: `S${i}`, url: `https://example.com/${i}` })) }], ['searched words that are empty', { searched: '' }], ['searched words of 301 characters', { searched: 'x'.repeat(301) }], ['searched words with a line break', { searched: 'a\nb' }], ['searched words with a reversing character', { searched: `a${RLO}b` }], ['searched words that are a number', { searched: 5 }], ['searched words that are missing (undefined)', { searched: undefined }], ['a negative number of searches', { searches: -1 }], ['21 searches', { searches: 21 }], ['1.5 searches', { searches: 1.5 }], ['searches as text', { searches: '1' }], ['searches that are null', { searches: null }]]) {
    refuse(`a result with ${what}`, { ...result, ...patch })
  }
  check('A: ...searched words may be none (null) or 300 characters, and up to 20 searches', parse({ ...result, searched: null }) !== null && parse({ ...result, searched: 'x'.repeat(300) }) !== null && parse({ ...result, searches: 0 }) !== null && parse({ ...result, searches: 20 }) !== null)
  check('A: ...20 sources are fine, and so is none', parse({ ...result, sources: Array.from({ length: 20 }, (_, i) => ({ title: `S${i}`, url: `https://example.com/${i}` })) }) !== null && parse({ ...result, sources: [] }) !== null && parse({ ...result, size: 60_200 }) !== null)
  for (const [what, source] of [['a field more', { ...SOURCES[0], x: 1 }], ['no title', { url: SOURCES[0].url }], ['an empty title', { title: '', url: SOURCES[0].url }], ['a title of 201 characters', { title: 'x'.repeat(201), url: SOURCES[0].url }], ['a title with a reversing character', { title: `a${RLO}b`, url: SOURCES[0].url }], ['a title with a line break', { title: 'a\nb', url: SOURCES[0].url }], ['a title that is not text', { title: 5, url: SOURCES[0].url }], ['an http address', { title: 't', url: 'http://example.com/' }], ['a javascript address', { title: 't', url: 'javascript:alert(1)' }], ['a file address', { title: 't', url: 'file:///C:/x' }], ['an address with a name and password', { title: 't', url: 'https://user:pass@example.com/' }], ['an address with a space', { title: 't', url: 'https://example.com/a b' }], ['an address with a letter of another language', { title: 't', url: 'https://example.com/caf\u00e9' }], ['an address with a reversing character', { title: 't', url: `https://example.com/${RLO}` }], ['an address over 2,000 characters', { title: 't', url: `https://example.com/${'a'.repeat(2000)}` }], ['only the scheme', { title: 't', url: 'https://' }], ['an address that is not text', { title: 't', url: 5 }], ['a source that is null', null], ['a source that is text', 'https://example.com/']]) {
    refuse(`a source with ${what}`, { ...result, sources: [source] })
  }
  check('A: ...a title of exactly 200 characters, and of 200 letters from outside the first plane, are fine', parse({ ...result, sources: [{ title: 'x'.repeat(200), url: SOURCES[0].url }] }) !== null && parse({ ...result, sources: [{ title: cp(0x1f600).repeat(200), url: SOURCES[0].url }] }) !== null)
  check('A: an own key called __proto__ makes a line unreadable (it is a field more)', logMod.parseAuditEvent(JSON.parse(`{"__proto__":{"x":1},"v":1,"type":"ran","at":1700000000000,"call":"c","tool":"web_search","step":1}`)) === null)

  for (const [what, event] of [['a tool id that is not one', { ...refusedEvent(), tool: 'Not A Tool' }], ['a code that does not exist', { ...refusedEvent(), code: 'nope' }], ['a time of 0', { ...refusedEvent(), at: 0 }], ['an event with a field missing', { type: 'ran', at: T0, call: 'c', tool: 'web_search' }], ['a source that is not https', { ...callEvents()[3], sources: [{ title: 't', url: 'http://example.com/' }] }], ['something that is no event', { type: 'weird' }], ['null', null]]) {
    let thrown = null
    try { lineOf(event) } catch (error) { thrown = error }
    check(`A: a line is never made for ${what}`, thrown !== null)
  }
})

// ============ B. the file ============
await guard('B', async () => {
  let l = makeLog()
  let snap = await l.log.read()
  check('B: before anything is written there is no file, and reading says so without making one', snap.state === 'none' && snap.events.length === 0 && !existsSync(join(l.dir, 'audit')))
  for (const event of callEvents()) await l.log.append(event)
  snap = await l.log.read()
  check('B: four events appended, read back equal and in the order they were kept', snap.state === 'ok' && eventsText(snap.events) === eventsText(callEvents()) && snap.skipped === 0 && snap.older === false && snap.form === 'plain', show(snap).slice(0, 200))
  const text = fileText(l)
  check('B: the file is one line for each, each ending in a line break; the audit folder was made', linesOf(text).length === 4 && text.endsWith('\n') && !text.includes('\r') && existsSync(join(l.dir, 'audit')))
  check('B: it is plain text a person can open: the search words are in it', text.includes('rust release notes'))
  check('B: no temporary file is left in the folder', readdirSync(join(l.dir, 'audit')).join() === 'log.jsonl')

  // many at once: kept in the order asked
  l = makeLog()
  const many = Array.from({ length: 40 }, (_, i) => ({ type: 'ran', at: T0 + i, call: `c${i}`, tool: 'web_search', step: 1 }))
  await Promise.all(many.map((event) => l.log.append(event)))
  snap = await l.log.read()
  check('B: 40 appends asked at once are all kept, in the order they were asked', snap.events.length === 40 && snap.events.every((e, i) => e.call === `c${i}`) && snap.skipped === 0)

  // refused writes: nothing is written, and the caller is told
  l = makeLog({ refused: 'Nothing was saved: the key that protects your chats cannot be used.' })
  let error = await rejects(l.log.append(refusedEvent()))
  check('B: when the one rule for writing says no, the append is REJECTED with that sentence, and nothing (not even the folder) is made', error instanceof keptMod.KeptRefused && /cannot be used/.test(error.message) && !existsSync(join(l.dir, 'audit')), String(error))
  l = makeLog()
  error = await rejects(l.log.append({ ...refusedEvent(), code: 'nope' }))
  check('B: an event that would not read back is REJECTED and nothing is written', error !== null && !existsSync(l.file), String(error))
  mkdirSync(join(l.dir, 'audit'), { recursive: true })
  rmSync(join(l.dir, 'audit'), { recursive: true })
  writeFileSync(join(l.dir, 'audit'), 'a file where the folder should be')
  error = await rejects(l.log.append(refusedEvent()))
  check('B: a disk that cannot take the line (the folder is a file) REJECTS the append', error !== null, String(error))
  rmSync(join(l.dir, 'audit'))

  // a disk that says yes and does not do it
  l = makeLog()
  await l.log.append(refusedEvent('tool-off', 'first'))
  const before = fileText(l)
  const realAppend = fsSync.promises.appendFile
  fsSync.promises.appendFile = async () => undefined
  error = await rejects(l.log.append(refusedEvent('tool-off', 'second')))
  fsSync.promises.appendFile = realAppend
  check('B: an append that reports success and writes nothing is REJECTED (the file did not grow)', error !== null && /did not grow/.test(String(error.message)) && fileText(l) === before, String(error))
  fsSync.promises.appendFile = async (file, data, opt) => realAppend(file, Buffer.from(String(data).replace('second', 'secoXd')), opt)
  error = await rejects(l.log.append(refusedEvent('tool-off', 'second')))
  fsSync.promises.appendFile = realAppend
  check('B: an append that writes other bytes than it was given is REJECTED (read back from the disk)', error !== null && /did not reach the disk/.test(String(error.message)), String(error))
  await l.log.append(refusedEvent('tool-off', 'third'))
  snap = await l.log.read()
  check('B: ...and the log goes on: the next event is kept after the failed ones', snap.events.at(-1).call === 'third', show(snap.events.map((e) => e.call)))

  // a line cut off by a crash is never joined by the next
  l = makeLog()
  mkdirSync(join(l.dir, 'audit'))
  const whole = lineOf(refusedEvent('tool-off', 'whole'))
  writeFileSync(l.file, `${whole}\n${lineOf(refusedEvent('tool-off', 'cut')).slice(0, 40)}`)
  await l.log.append(refusedEvent('tool-off', 'after'))
  snap = await l.log.read()
  check('B: after a crash that cut the last line off, the next event starts on a line of its own; the cut one is counted and left in the file', snap.events.map((e) => e.call).join() === 'whole,after' && snap.skipped === 1 && fileText(l).split('\n').length === 4, show(snap).slice(0, 200))

  // reading is forgiving of how an editor may have changed the file, and strict about what is in it
  l = makeLog()
  mkdirSync(join(l.dir, 'audit'))
  const bom = String.fromCharCode(0xfeff)
  writeFileSync(l.file, `${bom}${lineOf(refusedEvent('tool-off', 'a'))}\r\n\r\n   \n${lineOf(refusedEvent('tool-off', 'b'))}\r\n${'x'.repeat(70_000)}\nnot json\n{"v":1}\n[]\n${lineOf(refusedEvent('tool-off', 'c'))}`)
  snap = await l.log.read()
  check('B: a byte-order mark, line breaks of the Windows kind and blank lines are read through; junk, a line over 64 KB, and a line of the wrong shape are counted, never guessed at', snap.events.map((e) => e.call).join() === 'a,b,c' && snap.skipped === 4, show(snap).slice(0, 200))
  const edited = fileText(l)
  await l.log.read()
  check('B: reading changes nothing in the file', fileText(l) === edited)

  // only the newest part is read
  l = makeLog()
  for (let i = 0; i < 50; i++) await l.log.append({ type: 'ran', at: T0 + i, call: `n${i}`, tool: 'web_search', step: 1 })
  const size = Buffer.byteLength(fileText(l))
  snap = await l.log.read({ maxBytes: 900 })
  const calls = snap.events.map((e) => e.call)
  check('B: with a read smaller than the file, only the newest whole lines come back, and "older" says there is more', snap.older === true && calls.length > 3 && calls.length < 50 && calls.at(-1) === 'n49' && calls.every((c, i) => c === `n${50 - calls.length + i}`) && snap.skipped === 0, show(calls))
  snap = await l.log.read({ maxBytes: size })
  check('B: a read exactly as big as the file is the whole file (not "older")', snap.older === false && snap.events.length === 50)
  snap = await l.log.read({ maxBytes: 20 })
  check('B: a read smaller than one line gives no events and no guess', snap.events.length === 0 && snap.older === true && snap.skipped === 0)

  // delete all
  l = makeLog()
  await l.log.append(refusedEvent())
  writeFileSync(`${l.file}.tmp`, 'leftover')
  await l.log.removeAll()
  check('B: "delete all" removes the log and a leftover rewrite; reading then says there is none', !existsSync(l.file) && !existsSync(`${l.file}.tmp`) && (await l.log.read()).state === 'none')
  await l.log.removeAll()
  check('B: ...and deleting what is not there is fine', true)
  await l.log.append(refusedEvent('tool-off', 'again'))
  check('B: ...and the log starts again from nothing', (await l.log.read()).events.map((e) => e.call).join() === 'again' && linesOf(fileText(l)).length === 1)
})

// ============ C. sealed like the chats ============
await guard('C', async () => {
  const CANARY = 'canary-search-words-4711'
  const secret = (call) => ({ type: 'asked', at: T0, call, tool: 'web_search', step: 1, args: { query: CANARY }, why: 'a reason with the canary-search-words-4711 in it' })
  let box = makeBox()
  let l = makeLog({ box, mode: 'encrypted' })
  await l.log.append(secret('s1'))
  for (const event of callEvents('s2').slice(1)) await l.log.append(event)
  let text = fileText(l)
  check('C: with encryption on, every line is the chats\' envelope and nothing of what was asked is readable in the file', linesOf(text).length === 4 && linesOf(text).every((line) => line.startsWith('{"format":"frontier-chat-encrypted"')) && !text.includes(CANARY) && !text.includes('rust release') && !text.includes('blog.rust-lang.org'))
  let snap = await l.log.read()
  check('C: ...and it reads back, in the form "encrypted"', snap.form === 'encrypted' && snap.events.length === 4 && snap.events[0].args.query === CANARY && snap.skipped === 0)

  // mixed
  l.state.mode = 'plain'
  await l.log.append(secret('s3'))
  snap = await l.log.read()
  check('C: a plain line after sealed ones: the file reads as "mixed", in order', snap.form === 'mixed' && snap.events.length === 5 && snap.events.at(-1).call === 's3')

  // a key that cannot be used
  l.state.mode = 'encrypted'
  box.available = false
  let error = await rejects(l.log.append(secret('s4')))
  const sealedBefore = fileText(l)
  check('C: with no secure storage, a sealed line is REJECTED (never written as plain instead)', error !== null && /no secure storage/.test(String(error.message)) && fileText(l) === sealedBefore, String(error))
  box.available = true
  box.garble = true
  error = await rejects(l.log.append(secret('s4')))
  check('C: a secure storage that makes junk is REJECTED before anything is written', error !== null && fileText(l) === sealedBefore, String(error))
  box.garble = false
  box.lie = true
  error = await rejects(l.log.append(secret('s4')))
  check('C: ...and one that opens a line to something else is too', error !== null && fileText(l) === sealedBefore, String(error))
  box.lie = false
  box.lose()
  snap = await l.log.read()
  check('C: with the key lost, the sealed lines are counted ("sealed, cannot be opened") and the plain one still reads', snap.sealedClosed === 4 && snap.skipped === 4 && snap.events.length === 1 && snap.events[0].call === 's3', show(snap).slice(0, 200))
  check('C: ...and nothing in the file changed', fileText(l) === sealedBefore + '' || fileText(l).length === sealedBefore.length)

  // turning encryption on and off rewrites the lines
  box = makeBox()
  l = makeLog({ box, mode: 'plain' })
  for (const event of [secret('t1'), ...callEvents('t2'), refusedEvent('tool-off', 't3')]) await l.log.append(event)
  const plainText = fileText(l)
  let form = await l.log.document.read()
  check('C: the encryption flow sees a plain log as one plain document', form.state === 'ok' && form.form === 'plain')
  l.state.mode = 'encrypted'
  check('C: ...and a conform with the rule saying "encrypted" rewrites every line', (await l.log.document.conform()) === 'changed')
  text = fileText(l)
  snap = await l.log.read()
  check('C: ...all sealed, nothing readable, the same events in the same order', linesOf(text).every((line) => line.startsWith('{"format":"frontier-chat-encrypted"')) && !text.includes(CANARY) && snap.form === 'encrypted' && snap.events.length === 6 && snap.events[0].args.query === CANARY && snap.events.at(-1).call === 't3')
  check('C: ...no rewrite is left behind', readdirSync(join(l.dir, 'audit')).join() === 'log.jsonl')
  form = await l.log.document.read()
  check('C: the flow now sees one encrypted document, and a second conform has nothing to do', form.form === 'encrypted' && (await l.log.document.conform()) === 'already')
  l.state.mode = 'plain'
  check('C: turning it off rewrites every line back', (await l.log.document.conform()) === 'changed')
  check('C: ...to exactly the text it had before (byte for byte)', fileText(l) === plainText)
  check('C: nothing at all to do for a log that is not there', (await makeLog({ box }).log.document.conform()) === 'none' && (await makeLog({ box }).log.document.read()).state === 'none')

  // a damaged line in the middle is kept where it is
  l = makeLog({ box, mode: 'plain' })
  mkdirSync(join(l.dir, 'audit'))
  writeFileSync(l.file, `${lineOf(secret('u1'))}\nthis line is damaged {{\n${lineOf(secret('u2'))}\n`)
  l.state.mode = 'encrypted'
  check('C: a log with a damaged line is still rewritten...', (await l.log.document.conform()) === 'changed')
  const parts = fileText(l).split('\n')
  check('C: ...and the damaged line is kept as it is, in its place', parts.length === 4 && parts[1] === 'this line is damaged {{' && parts[0].startsWith('{"format"') && parts[2].startsWith('{"format"'))

  // a sealed line that cannot be opened stops the rewrite, and nothing is touched
  l = makeLog({ box, mode: 'encrypted' })
  await l.log.append(secret('v1'))
  box.lose()
  l.state.mode = 'plain'
  const fixed = fileText(l)
  check('C: a sealed line that cannot be opened stops the rewrite: "unreadable"', (await l.log.document.conform()) === 'unreadable')
  check('C: ...and the file is exactly as it was', fileText(l) === fixed && !existsSync(`${l.file}.tmp`))

  // refused / no storage / odd states
  box = makeBox()
  l = makeLog({ box, mode: 'plain' })
  await l.log.append(secret('w1'))
  const kept = fileText(l)
  l.state.refused = 'Nothing was saved: the key cannot be used.'
  check('C: a conform while the rule refuses is "refused", nothing touched', (await l.log.document.conform()) === 'refused' && fileText(l) === kept)
  l.state.refused = null
  l.state.mode = 'encrypted'
  box.available = false
  check('C: a conform with no secure storage is "failed", nothing touched', (await l.log.document.conform()) === 'failed' && fileText(l) === kept && !existsSync(`${l.file}.tmp`))
  box.available = true
  form = await l.log.document.read()
  check('C: a file with no event in it (empty) is reported in the form the rule says, so that it is never work to do', (() => { writeFileSync(l.file, ''); return true })() && (await l.log.document.read()).form === 'encrypted' && (await l.log.document.conform()) === 'already')

  // mixed files are reported in the form that is NOT the target
  box = makeBox()
  l = makeLog({ box, mode: 'plain' })
  await l.log.append(secret('x1'))
  l.state.mode = 'encrypted'
  await l.log.append(secret('x2'))
  check('C: a mixed file is reported "plain" while the rule says encrypted (so turning encryption on finishes the job)', (await l.log.document.read()).form === 'plain')
  l.state.mode = 'plain'
  check('C: ...and "encrypted" while the rule says plain (so turning it off finishes the job)', (await l.log.document.read()).form === 'encrypted')

  // the flow's own document helper sees it with the other kept files
  const docs = keptMod.keptDocuments([l.log.document])
  l.state.mode = 'encrypted'
  const counts = await docs.counts()
  const done = await docs.conform()
  check('C: through the flow\'s helper: counted as one plain document, then rewritten (1 changed, 0 failed)', counts.plain === 1 && counts.encrypted === 0 && done.changed === 1 && done.failed === 0 && (await docs.counts()).encrypted === 1, show([counts, done]))
})

// ============ D. a rewrite that is cut off is mended ============
await guard('D', async () => {
  const box = makeBox()
  const events = [...callEvents('m1'), refusedEvent('tool-off', 'm2')]
  /** The converted body of a log of `events` (what a rewrite to the sealed form writes), and the plain text it started from. */
  async function convertedBody() {
    const l = makeLog({ box, mode: 'plain' })
    for (const event of events) await l.log.append(event)
    const plainText = fileText(l)
    l.state.mode = 'encrypted'
    await l.log.document.conform()
    return { plainText, body: fileText(l) }
  }
  const commit = (n) => JSON.stringify({ v: 1, type: 'commit', lines: n })
  const { plainText, body } = await convertedBody()
  const n = linesOf(body).length
  const tmpWhole = `${body}${commit(n)}\n`
  const stage = (fileContent, tmpContent) => {
    const l = makeLog({ box, mode: 'encrypted' })
    mkdirSync(join(l.dir, 'audit'))
    if (fileContent !== null) writeFileSync(l.file, fileContent)
    if (tmpContent !== null) writeFileSync(`${l.file}.tmp`, tmpContent)
    return l
  }
  let l = stage(plainText, tmpWhole.slice(0, Math.floor(tmpWhole.length / 2)))
  let snap = await l.log.read().catch((error) => ({ events: [], error: String(error) }))
  check('D: a rewrite cut off while it was being written: the half-made file is thrown away, the log is exactly as it was', fileText(l) === plainText && !existsSync(`${l.file}.tmp`) && snap.events.length === 5 && snap.form === 'plain')
  l = stage(plainText, body + commit(n + 1) + '\n')
  await l.log.read().catch((error) => ({ events: [], error: String(error) }))
  check('D: a closing line that does not count the lines before it is not trusted: thrown away, nothing changed', fileText(l) === plainText && !existsSync(`${l.file}.tmp`))
  l = stage(plainText, body)
  await l.log.read().catch((error) => ({ events: [], error: String(error) }))
  check('D: a file with no closing line at all is not trusted either', fileText(l) === plainText && !existsSync(`${l.file}.tmp`))
  l = stage(plainText, tmpWhole)
  snap = await l.log.read().catch((error) => ({ events: [], error: String(error) }))
  check('D: a whole rewrite whose copy never began is finished: the log is the sealed text, the leftover is gone', fileText(l) === body && !existsSync(`${l.file}.tmp`) && snap.form === 'encrypted' && snap.events.length === 5)
  l = stage(body.slice(0, Math.floor(body.length * 0.4)), tmpWhole)
  await l.log.read().catch((error) => ({ events: [], error: String(error) }))
  check('D: ...also when the copy was cut off half way (the file is the start of the rewrite)', fileText(l) === body && !existsSync(`${l.file}.tmp`))
  const extra = `${lineOf(refusedEvent('tool-off', 'later1'))}\n${lineOf(refusedEvent('tool-off', 'later2'))}\n`
  l = stage(body + extra, tmpWhole)
  await l.log.read().catch((error) => ({ events: [], error: String(error) }))
  check('D: a rewrite that was finished (only its leftover was not removed) never undoes the lines kept after it', fileText(l) === body + extra && !existsSync(`${l.file}.tmp`))
  l = stage(null, tmpWhole)
  await l.log.read().catch((error) => ({ events: [], error: String(error) }))
  check('D: a leftover when the log has been deleted brings nothing back', !existsSync(l.file) && !existsSync(`${l.file}.tmp`))
  l = stage(plainText, tmpWhole)
  await l.log.append(refusedEvent('tool-off', 'next'))
  check('D: mending comes before an append: the new line goes after the finished rewrite', fileText(l).startsWith(body) && linesOf(fileText(l)).length === n + 1 && !existsSync(`${l.file}.tmp`))

  // a real rewrite that fails half way (the disk refuses the second write)
  l = makeLog({ box, mode: 'plain' })
  for (const event of events) await l.log.append(event)
  const original = fileText(l)
  l.state.mode = 'encrypted'
  const realWrite = fsSync.promises.writeFile
  let writes = 0
  fsSync.promises.writeFile = async (...args) => { writes += 1; if (writes === 2) throw new Error('disk full'); return realWrite(...args) }
  const result = await l.log.document.conform()
  fsSync.promises.writeFile = realWrite
  check('D: a rewrite whose second write fails is "failed", and the finished copy is left for mending', result === 'failed' && existsSync(`${l.file}.tmp`) && fileText(l) === original)
  const second = makeLog({ dir: l.dir, box, mode: 'encrypted' })
  snap = await second.log.read()
  check('D: ...the next use of the log (a new run of the app) finishes it', snap.form === 'encrypted' && snap.events.length === 5 && !existsSync(`${l.file}.tmp`))

  // a rewrite whose copy silently writes only half of it
  l = makeLog({ box, mode: 'plain' })
  for (const event of events) await l.log.append(event)
  l.state.mode = 'encrypted'
  writes = 0
  fsSync.promises.writeFile = async (path, data, opt) => { writes += 1; return realWrite(path, writes === 2 ? String(data).slice(0, Math.floor(String(data).length / 2)) : data, opt) }
  const half = await l.log.document.conform()
  fsSync.promises.writeFile = realWrite
  check('D: a rewrite whose copy wrote only half of it is "failed" (it is read back and compared), and the finished copy is left for mending', half === 'failed' && existsSync(`${l.file}.tmp`))
  snap = await makeLog({ dir: l.dir, box, mode: 'encrypted' }).log.read()
  check('D: ...and the next use finishes it', snap.form === 'encrypted' && snap.events.length === 5 && !existsSync(`${l.file}.tmp`))
})

// ============ E. calls, the view, the export, the deletion ============
function service(options = {}) {
  const l = options.l ?? makeLog()
  const answers = [...(options.answers ?? [])]
  const asked = []
  const picks = []
  const askPerson = async (owner, question) => { asked.push({ owner, question }); const next = answers.length > 0 ? answers.shift() : 'unexpected'; if (next === 'throw') throw new Error('no box'); return next === 'yes' }
  const clock = { gate: 1_000_000 }
  const gate = gateMod.createQuestionGate(askPerson, () => clock.gate)
  const svc = svcMod.createAuditService({
    log: options.log ?? l.log,
    gate,
    pickExportPath: async (owner, name) => { picks.push({ owner, name }); return options.exportTo === undefined ? null : options.exportTo },
    dataDir: l.dir,
    now: () => new Date(2026, 9, 8, 14, 5, 12).getTime()
  })
  return { svc, l, asked, picks, clock }
}
const OWNER = { window: 'the window' }

await guard('E', async () => {
  // putting events together
  const all = [
    ...callEvents('done'),
    { type: 'asked', at: T0 + 10, call: 'no', tool: 'web_search', step: 2, args: { query: 'q2' }, why: 'w2' },
    { type: 'answered', at: T0 + 11, call: 'no', tool: 'web_search', step: 2, answer: 'no' },
    { ...refusedEvent('step-cap', 'cap'), step: 6 },
    { type: 'asked', at: T0 + 20, call: 'open', tool: 'web_search', step: 3, args: { query: 'q3' }, why: 'w3' },
    { type: 'asked', at: T0 + 30, call: 'ran', tool: 'web_search', step: 4, args: { query: 'q4' }, why: 'w4' },
    { type: 'answered', at: T0 + 31, call: 'ran', tool: 'web_search', step: 4, answer: 'yes' },
    { type: 'ran', at: T0 + 32, call: 'ran', tool: 'web_search', step: 4 },
    { type: 'asked', at: T0 + 40, call: 'bad', tool: 'web_search', step: 5, args: { query: 'q5' }, why: 'w5' },
    { type: 'answered', at: T0 + 41, call: 'bad', tool: 'web_search', step: 5, answer: 'yes' },
    { type: 'ran', at: T0 + 42, call: 'bad', tool: 'web_search', step: 5 },
    { type: 'result', at: T0 + 43, call: 'bad', tool: 'web_search', step: 5, ok: false, size: 0, sources: [], searched: null, searches: 0 },
    { type: 'asked', at: T0 + 50, call: 'yes-only', tool: 'web_search', step: 6, args: { query: 'q6' }, why: 'w6' },
    { type: 'answered', at: T0 + 51, call: 'yes-only', tool: 'web_search', step: 6, answer: 'yes' },
    { ...refusedEvent('not-recorded', 'unrec'), tool: 'web_search', step: 7 },
    { type: 'refused', at: T0 + 60, call: 'other', tool: 'other_tool', step: 1, code: 'tool-off' }
  ]
  const calls = svcMod.groupCalls(all)
  const by = Object.fromEntries(calls.map((c) => [c.id, c]))
  check('E: the events of a log are put together by call id, in the order the calls began', calls.map((c) => c.id).join() === 'done,no,cap,open,ran,bad,yes-only,unrec,other', calls.map((c) => c.id).join())
  check('E: an allowed call that finished is "done" with its size and its sources (title and address)', by.done.outcome.kind === 'done' && by.done.outcome.size === 5123 && show(by.done.outcome.sources) === show(SOURCES) && by.done.title === 'Search the web' && by.done.step === 1 && by.done.at === T0 && by.done.args.query === 'rust release notes' && by.done.why === 'The person asked for the newest release.')
  check('E: a no is "declined" with the answer', show(by.no.outcome) === '{"kind":"declined","answer":"no"}' && by.no.args.query === 'q2')
  check('E: a refusal is "refused" with its code, and has no arguments (nothing was shown)', show(by.cap.outcome) === '{"kind":"refused","code":"step-cap"}' && by.cap.args === null && by.cap.why === null)
  check('E: asked and never answered is "unanswered"', by.open.outcome.kind === 'unanswered')
  check('E: started and never finished is "running"; allowed and nothing more is too', by.ran.outcome.kind === 'running' && by['yes-only'].outcome.kind === 'running')
  check('E: an allowed call that failed or was stopped is "failed"', by.bad.outcome.kind === 'failed')
  check('E: a tool this version does not know is shown by its id', by.other.title === 'other_tool')
  const interleaved = svcMod.groupCalls([callEvents('p')[0], callEvents('q')[0], callEvents('q')[1], callEvents('p')[1], ...callEvents('p').slice(2), ...callEvents('q').slice(2)])
  check('E: calls that overlap in time are kept apart by their ids', interleaved.length === 2 && interleaved.every((c) => c.outcome.kind === 'done'))
  check('E: the words of every outcome are sentences for the person, and each kind has its own', (() => {
    const words = new Set(calls.map((c) => sharedAudit.outcomeText(c.outcome)))
    return words.size === calls.length - 0 || words.size >= 7
  })() && sharedTools.REFUSAL_CODES.every((code) => /^Refused: .+\.$/.test(sharedAudit.outcomeText({ kind: 'refused', code }))) && sharedTools.ANSWER_CODES.filter((a) => a !== 'yes').every((answer) => sharedAudit.outcomeText({ kind: 'declined', answer }).length > 10))
  check('E: the sentence of a finished call has the size and the number of sources', sharedAudit.outcomeText(by.done.outcome) === 'You said yes. It ran: 5,123 characters came back, from 2 sources.')
  check('E: the titles shown agree with the registry\'s', sharedTools.toolTitle('web_search') === registryMod.WEB_SEARCH.title && sharedTools.toolTitle('constructor') === 'constructor' && sharedTools.toolTitle('__proto__') === '__proto__')

  // the view
  let s = service()
  let view = await s.svc.view()
  check('E: the view of a log that is not there is empty, not an error', view.ok && view.calls.length === 0 && view.total === 0 && view.form === null)
  for (const event of all) await s.l.log.append(event)
  view = await s.svc.view()
  check('E: the view has the newest call first and counts them all', view.ok && view.calls[0].id === 'other' && view.calls.at(-1).id === 'done' && view.total === 9 && view.older === false && view.skipped === 0 && view.form === 'plain', show(view).slice(0, 200))
  s = service()
  for (let i = 0; i < 350; i++) await s.l.log.append({ type: 'ran', at: T0 + i, call: `v${i}`, tool: 'web_search', step: 1 })
  view = await s.svc.view()
  check('E: only the newest 300 calls are in the view (the rest is counted in "total")', view.ok && view.calls.length === 300 && view.total === 350 && view.calls[0].id === 'v349' && view.calls.at(-1).id === 'v50', show([view.calls?.length, view.total]))
  const broken = service({ log: { read: async () => { throw new Error('the disk is gone') } } })
  view = await broken.svc.view()
  check('E: a log that cannot be read is an error in words (no path, no stack), logged here only', !view.ok && view.error === 'The audit log could not be read.' && logged.some((m) => /disk is gone/.test(m)))

  // the export
  const out = tempDir()
  s = service()
  for (const event of all) await s.l.log.append(event)
  let r = await service({ l: makeLog() }).svc.exportAll(OWNER)
  check('E: an empty log has nothing to export, and no dialog opens', !r.ok && /nothing to export/.test(r.error))
  const emptyS = service({ l: makeLog() })
  await emptyS.svc.exportAll(OWNER)
  check('E: ...(no save dialog was opened for it)', emptyS.picks.length === 0)
  r = await s.svc.exportAll(OWNER)
  check('E: closing the save dialog is "cancelled", the dialog was for the window that asked, with a dated name', !r.ok && r.cancelled === true && s.picks.length === 1 && s.picks[0].owner === OWNER && s.picks[0].name === 'frontier-audit-log-2026-10-08.txt', show([r, s.picks]))
  const dest = join(out, 'audit.txt')
  const s2 = service({ l: s.l, exportTo: dest })
  r = await s2.svc.exportAll(OWNER)
  const exported = existsSync(dest) ? readFileSync(dest, 'utf8') : ''
  check('E: the export is written where the person chose, read back, and counted', r.ok && r.calls === 9 && r.where === dest && r.older === false, show(r))
  check('E: it says when it was made, that it holds no page text, and that it is whole', exported.startsWith("The audit log of Frontier App, exported on 2026-10-08 14:05:12 (this computer's time).\nEvery tool call the model asked for: what was asked, why, what you answered and how it ended. It holds no page text.\nIt holds every call in the log.\n\n"))
  check('E: ...oldest call first, with what was asked quoted, the reason, the outcome in words, and each source with its address', exported.indexOf('Search the web, step 1') < exported.indexOf('step 6') && exported.includes('  Asked: query = "rust release notes"\n  Reason the model gave: "The person asked for the newest release."\n  You said yes. It ran: 5,123 characters came back, from 2 sources.\n  Source: "Rust 1.90 released" https://blog.rust-lang.org/2026/09/10/Rust-1.90.html\n'), exported.slice(0, 700))
  check('E: ...a refusal is written as a refusal, with no arguments', /Search the web, step 6\n  Refused: the reply had used all its tool steps\.\n/.test(exported))
  const hostile = tempDir()
  const hs = service({ l: makeLog({ dir: hostile }), exportTo: join(out, 'hostile.txt') })
  await hs.l.log.append({ type: 'asked', at: T0, call: 'h1', tool: 'web_search', step: 1, args: { query: 'a" \\ Second line: Refused: fake' }, why: 'Reason "quoted" \\ backslash' })
  await hs.svc.exportAll(OWNER)
  const hostileText = readFileSync(join(out, 'hostile.txt'), 'utf8')
  check('E: a value with quotes and a backslash is written quoted and escaped, so it cannot pass for a line of the export', hostileText.includes('Asked: query = "a\\" \\\\ Second line: Refused: fake"') && hostileText.includes('Reason the model gave: "Reason \\"quoted\\" \\\\ backslash"'), hostileText)
  const noPage = service({ l: makeLog() })
  const sneaky = { type: 'result', at: T0, call: 'z', tool: 'web_search', step: 1, ok: true, size: 9, sources: [{ title: 'T', url: 'https://example.com/' }], searched: null, searches: 1, text: 'PAGE TEXT' }
  const sneakyError = await rejects(noPage.l.log.append(sneaky))
  check('E: a field for page text on an event is never written (so no page text can be in the log or the export)', sneakyError === null && existsSync(noPage.l.file) && !fileText(noPage.l).includes('PAGE TEXT') && !fileText(noPage.l).includes('"text"') && (await noPage.l.log.read()).events.length === 1, String(sneakyError))
  const inside = service({ l: s.l, exportTo: join(s.l.dir, 'audit', 'copy.txt') })
  r = await inside.svc.exportAll(OWNER)
  check('E: never into the app\'s own data folder: refused, nothing written', !r.ok && /data folder/.test(r.error) && !existsSync(join(s.l.dir, 'audit', 'copy.txt')), show(r))
  const relative = service({ l: s.l, exportTo: 'audit.txt' })
  r = await relative.svc.exportAll(OWNER)
  check('E: a place that is not a full path is refused', !r.ok && /could not be used/.test(r.error))
  rmSync(join(process.cwd(), 'audit.txt'), { force: true }) // (what a sabotage of that rule would have written beside the program)
  const unwritable = service({ l: s.l, exportTo: join(out, 'no-such-folder', 'audit.txt') })
  r = await unwritable.svc.exportAll(OWNER)
  check('E: a place that cannot be written is an error in words', !r.ok && /could not be written there/.test(r.error))
  const bigS = service({ l: makeLog() })
  for (let i = 0; i < 60; i++) await bigS.l.log.append({ type: 'ran', at: T0 + i, call: `b${i}`, tool: 'web_search', step: 1 })
  const olderText = svcMod.exportText(svcMod.groupCalls([]), T0, { state: 'ok', events: [], skipped: 3, sealedClosed: 0, older: true, form: 'plain' })
  check('E: an export of a log that is bigger than the read says so, and says how many lines could not be read', olderText.includes('The log also holds older calls than these; they are not in this file.') && olderText.includes('3 lines of the log could not be read and are not in this file.'))

  // the deletion asks in the system's box
  s = service({ answers: ['no'] })
  for (const event of all) await s.l.log.append(event)
  const filed = fileText(s.l)
  r = await s.svc.deleteAll(OWNER)
  check('E: "delete all" asks once in the system\'s box, for the window that asked; a no leaves the log exactly as it is', !r.ok && r.cancelled === true && s.asked.length === 1 && s.asked[0].owner === OWNER && fileText(s.l) === filed, show(r))
  const q = s.asked[0].question
  check('E: the question names what goes (the number of calls and the oldest), says that nothing else goes, and that the page cannot answer it', q.title === 'Audit log' && q.message === 'Delete the whole audit log?' && q.detail.includes('9 calls will be deleted for good, the oldest from ') && q.detail.includes('Nothing else is deleted.') && q.detail.includes("which the app's page cannot answer") && q.yes === 'Delete the log' && q.no === 'Keep it', q.detail)
  s.clock.gate += 3_500
  s.asked.length = 0
  const yesGate = service({ l: s.l, answers: ['yes'] })
  r = await yesGate.svc.deleteAll(OWNER)
  check('E: a yes deletes the log; reading says there is none', r.ok && !existsSync(s.l.file) && (await yesGate.svc.view()).total === 0)
  r = await yesGate.svc.deleteAll(OWNER)
  check('E: deleting a log that is not there asks nothing', r.ok && yesGate.asked.length === 1)
  for (const [answer, pattern] of [['busy', /Another question/], ['resting', /no to a question a moment ago/], ['throw', /could not be shown/]]) {
    const t = service({ answers: [answer] })
    await t.l.log.append(refusedEvent())
    const keep = fileText(t.l)
    if (answer === 'busy') {
      // a second question while one is open
      const hold = {}
      const gate2 = gateMod.createQuestionGate(async () => new Promise((resolve) => { hold.release = resolve }), () => 1)
      const svc2 = svcMod.createAuditService({ log: t.l.log, gate: gate2, pickExportPath: async () => null, dataDir: t.l.dir })
      const first = svc2.deleteAll(OWNER)
      await wait(20)
      r = await svc2.deleteAll(OWNER)
      hold.release(false)
      await first
      check('E: a question already open: "busy", nothing deleted', !r.ok && pattern.test(r.error) && fileText(t.l) === keep, show(r))
    } else if (answer === 'resting') {
      const gate3 = gateMod.createQuestionGate(async () => false, () => 1)
      const svc3 = svcMod.createAuditService({ log: t.l.log, gate: gate3, pickExportPath: async () => null, dataDir: t.l.dir })
      await svc3.deleteAll(OWNER)
      r = await svc3.deleteAll(OWNER)
      check('E: right after a no: "resting", nothing deleted', !r.ok && pattern.test(r.error) && fileText(t.l) === keep, show(r))
    } else {
      r = await t.svc.deleteAll(OWNER)
      check('E: a box that cannot be shown: nothing deleted, and the sentence says so', !r.ok && pattern.test(r.error) && fileText(t.l) === keep, show(r))
    }
  }
  const failing = service({ answers: ['yes'], log: { read: async () => ({ state: 'ok', events: [], skipped: 0, sealedClosed: 0, older: false, form: 'plain' }), removeAll: async () => { throw new Error('locked') } } })
  r = await failing.svc.deleteAll(OWNER)
  check('E: a yes and a file that cannot be deleted: an error in words, logged here only', !r.ok && r.error === 'The audit log could not be deleted.' && logged.some((m) => /locked/.test(m)))
  const unreadable = service({ answers: ['yes'], log: { read: async () => { throw new Error('cannot read') }, removeAll: async () => undefined } })
  r = await unreadable.svc.deleteAll(OWNER)
  check('E: a log that cannot be read can still be deleted: the question then only says the file will go', r.ok && unreadable.asked[0].question.detail.startsWith('The audit log will be deleted for good.'))
  const olderQ = svcMod.deleteQuestion({ calls: 40, older: true, oldest: T0 })
  check('E: a log bigger than the part read says "at least"', olderQ.detail.startsWith('At least 40 calls will be deleted for good'))
  const oneQ = svcMod.deleteQuestion({ calls: 1, older: false, oldest: null })
  check('E: one call is "1 call"', oneQ.detail.startsWith('1 call will be deleted for good.'))
})

// ============ F. the core writes into the real log ============
await guard('F', async () => {
  const registry = registryMod.createToolRegistry(registryMod.BUILT_IN_TOOLS)
  const l = makeLog()
  const clock = { gate: 1_000_000, mono: 0, wall: 1_700_000_000_000 }
  const answers = []
  const asked = []
  const gate = gateMod.createQuestionGate(async (owner, question) => { asked.push(question); const next = answers.length > 0 ? answers.shift() : 'no'; return typeof next === 'function' ? next() : next === 'yes' }, () => clock.gate)
  let record = (event) => l.log.append(event)
  const ran = []
  const core = coreMod.createToolCore({
    tools: registry,
    settings: () => ({ enabled: { web_search: true }, caps: { steps: 5, seconds: 60 } }),
    gate,
    guard: { check: async () => { throw new Error('no path expected') } },
    record: (event) => record(event),
    holdsSavedKey: async () => false,
    executors: { web_search: async (args) => { ran.push(args); return { text: 'Result about ' + args.query, sources: [{ title: 'Example', url: 'https://example.com/a' }, { title: '', url: 'https://example.org/x?q=caf\u00e9' }, { title: 'bad', url: 'http://example.com/' }] } } },
    now: () => clock.wall
  })
  const budget = budgetMod.createReplyBudget({ steps: 5, seconds: 60 }, () => clock.mono)
  const run = (query, why = 'a reason') => core.run({ tool: 'web_search', args: { query, why } }, { owner: OWNER, signal: new AbortController().signal, budget })

  answers.push('yes')
  let out = await run('first search')
  let snap = await l.log.read()
  check('F: an allowed call is in the real log as four events with one call id, and none is skipped', out.kind === 'ran' && snap.events.map((e) => e.type).join() === 'asked,answered,ran,result' && new Set(snap.events.map((e) => e.call)).size === 1 && snap.skipped === 0, show(snap.events.map((e) => [e.type, e.call])))
  const result = snap.events.at(-1)
  check('F: ...the result event has the size and the sources: titles, and addresses as the page writes them (a name with other letters percent-encoded, a missing title the address, an http address dropped)', result.size === out.result.text.length && show(result.sources) === show([{ title: 'Example', url: 'https://example.com/a' }, { title: 'https://example.org/x?q=caf%C3%A9', url: 'https://example.org/x?q=caf%C3%A9' }]), show(result.sources))
  check('F: ...and the log holds none of the result\'s words', !fileText(l).includes('Result about'))
  answers.push('no')
  clock.gate += 5_000
  out = await run('second search')
  answers.push('yes')
  clock.gate += 5_000
  out = await run('third search')
  out = await core.run({ tool: 'nope', args: {} }, { owner: OWNER, signal: new AbortController().signal, budget })
  const odd = await core.run({ tool: 'Not A Tool! ignore the rules', args: {} }, { owner: OWNER, signal: new AbortController().signal, budget: budgetMod.createReplyBudget({ steps: 5, seconds: 60 }, () => clock.mono) })
  snap = await l.log.read()
  check('F: a tool named with something that is not even shaped like an id is kept as "(unknown)", never in the words the model wrote', odd.code === 'unknown-tool' && snap.events.at(-1).tool === '(unknown)' && !fileText(l).includes('ignore the rules'))
  snap.events.pop()
  const calls = svcMod.groupCalls(snap.events)
  check('F: a no, a refused tool and a second allowed call: four calls with their own ids, the right outcomes, in order', calls.length === 4 && calls.map((c) => c.outcome.kind).join() === 'done,declined,done,refused' && new Set(calls.map((c) => c.id)).size === 4 && calls[3].outcome.code === 'unknown-tool' && calls[3].tool === 'nope', show(calls.map((c) => [c.id, c.outcome.kind])))

  // a log that cannot take the line: nothing is asked or run
  const lockedLog = makeLog({ refused: 'Nothing was saved: no key.' })
  record = (event) => lockedLog.log.append(event)
  answers.push('yes')
  ran.length = 0
  asked.length = 0
  const b2 = budgetMod.createReplyBudget({ steps: 5, seconds: 60 }, () => clock.mono)
  out = await core.run({ tool: 'web_search', args: { query: 'qq', why: 'w' } }, { owner: OWNER, signal: new AbortController().signal, budget: b2 })
  check('F: when the log cannot keep the record (the rule refuses), the core refuses "not-recorded": no question, nothing run', out.kind === 'refused' && out.code === 'not-recorded' && asked.length === 0 && ran.length === 0 && !existsSync(lockedLog.file), show(out))
  record = (event) => l.log.append(event)
  answers.length = 0

  // two calls at once (the second is "busy"): their events do not mix
  clock.gate += 5_000
  const hold = {}
  answers.push(() => new Promise((resolve) => { hold.release = resolve }))
  const before = (await l.log.read()).events.length
  const roomy = budgetMod.createReplyBudget({ steps: 5, seconds: 60 }, () => clock.mono)
  const runRoomy = (query) => core.run({ tool: 'web_search', args: { query, why: 'a reason' } }, { owner: OWNER, signal: new AbortController().signal, budget: roomy })
  const first = runRoomy('overlap one')
  await wait(30)
  const second = await runRoomy('overlap two')
  hold.release(true)
  const firstOut = await first
  snap = await l.log.read()
  const mine = svcMod.groupCalls(snap.events.slice(before))
  check('F: two calls at once (one waits for the person, the other is "busy"): two calls in the log, each with its own events', mine.length === 2 && firstOut.kind === 'ran' && second.kind === 'declined' && second.answer === 'busy' && mine.map((c) => c.outcome.kind).sort().join() === 'declined,done', show(mine.map((c) => [c.id, c.outcome.kind])))

  // the budget's own refusals are in the log too
  const tiny = budgetMod.createReplyBudget({ steps: 1, seconds: 60 }, () => clock.mono)
  answers.push('no')
  clock.gate += 5_000
  await core.run({ tool: 'web_search', args: { query: 'x', why: 'y' } }, { owner: OWNER, signal: new AbortController().signal, budget: tiny })
  out = await core.run({ tool: 'web_search', args: { query: 'x', why: 'y' } }, { owner: OWNER, signal: new AbortController().signal, budget: tiny })
  snap = await l.log.read()
  check('F: a call past the step cap is in the log as "step-cap"', out.code === 'step-cap' && snap.events.at(-1).type === 'refused' && snap.events.at(-1).code === 'step-cap' && snap.events.at(-1).step === 1)
  const stopper = new AbortController()
  stopper.abort()
  out = await core.run({ tool: 'web_search', args: { query: 'x', why: 'y' } }, { owner: OWNER, signal: stopper.signal, budget: budgetMod.createReplyBudget({ steps: 5, seconds: 60 }, () => clock.mono) })
  snap = await l.log.read()
  check('F: ...and a call after Stop everything is "stopped", at step 0', out.code === 'stopped' && snap.events.at(-1).code === 'stopped' && snap.events.at(-1).step === 0)
  check('F: the whole log reads clean: nothing the core wrote was refused by the reader', snap.skipped === 0)

  // a call id of its own for every call even when the clock does not move; ids that the reader accepts
  const ids = new Set(snap.events.map((e) => e.call))
  check('F: every call id is made of lower-case letters, digits and hyphens, and no two calls share one', [...ids].every((id) => /^[a-z0-9][a-z0-9-]{0,39}$/.test(id)) && ids.size === svcMod.groupCalls(snap.events).length)
  const custom = coreMod.createToolCore({ tools: registry, settings: () => ({ enabled: { web_search: true }, caps: { steps: 5, seconds: 60 } }), gate, guard: { check: async () => { throw new Error('x') } }, record: async (event) => { record2.push(event) }, holdsSavedKey: async () => false, executors: { web_search: async () => ({ text: 't' }) }, now: () => clock.wall, newId: () => 'fixed-id' })
  const record2 = []
  await custom.run({ tool: 'web_search', args: { query: 'x', why: 'y' } }, { owner: OWNER, signal: new AbortController().signal, budget: budgetMod.createReplyBudget({ steps: 5, seconds: 60 }, () => clock.mono) })
  check('F: the core takes its call ids from the id maker it is given', record2.length > 0 && record2.every((e) => e.call === 'fixed-id'))
  const throwingId = coreMod.createToolCore({ tools: registry, settings: () => ({ enabled: {}, caps: { steps: 5, seconds: 60 } }), gate, guard: { check: async () => { throw new Error('x') } }, record: async (event) => { record2.push(event) }, holdsSavedKey: async () => false, executors: { web_search: async () => ({ text: 't' }) }, now: () => clock.wall, newId: () => { throw new Error('no ids') } })
  record2.length = 0
  out = await throwingId.run({ tool: 'web_search', args: { query: 'x', why: 'y' } }, { owner: OWNER, signal: new AbortController().signal, budget: budgetMod.createReplyBudget({ steps: 5, seconds: 60 }, () => clock.mono) })
  check('F: an id maker that fails does not stop the record: a fixed id is used, and run() does not reject', out.kind === 'refused' && record2.length === 1 && record2[0].call === 'call')
})

// ============ G. what must not reach it ============
await guard('G', async () => {
  const expected = {
    'src/main/auditLog.ts': ["'fs'", "'fs/promises'", "'path'", "'../shared/tools'", "'./chatFile'", "'./credentialStore'", "'./keptFile'", "'./security'"],
    'src/main/auditService.ts': ["'fs'", "'path'", "'../shared/audit'", "'./auditLog'", "'./backupService'", "'./systemQuestion'"],
    'src/shared/audit.ts': ["'./tools'"]
  }
  const importsOf = (rel) => [...source(rel).matchAll(/^\s*(?:import|export)[^'"]*?from\s+('[^']+')/gm)].map((m) => m[1])
  for (const [rel, list] of Object.entries(expected)) check(`G: ${rel} imports exactly ${list.join(', ')}`, show(importsOf(rel).sort()) === show([...list].sort()), show(importsOf(rel)))
  const noNetwork = /\b(fetch\s*\(|XMLHttpRequest|WebSocket|child_process|worker_threads|node:net|node:http|node:https|node:dns|from 'net'|from 'http'|from 'https'|require\s*\(|import\s*\(|eval\s*\(|new Function|openExternal|shell\.|electron)/
  for (const rel of ['src/main/auditLog.ts', 'src/main/auditService.ts', 'src/shared/audit.ts']) check(`G: ${rel} has no network, process, shell, Electron or dynamic-code call in it`, !noNetwork.test(source(rel).split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')))

  const walk = (d) => readdirSync(join(REPO, d), { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(`${d}/${e.name}`) : [`${d}/${e.name}`])
  const files = ['src/main', 'src/shared', 'src/preload', 'src/renderer'].flatMap(walk).filter((f) => /\.(ts|tsx)$/.test(f))
  const importers = (pattern) => files.filter((f) => pattern.test(readFileSync(join(REPO, f), 'utf8').split('\n').filter((l) => /^\s*import\b|^\s*}\s*from\b/.test(l)).join('\n')))
  check('G: only the app\'s wiring (ipc.ts) and the service import the log', show(importers(/auditLog'/).sort()) === show(['src/main/auditService.ts', 'src/main/ipc.ts']), show(importers(/auditLog'/)))
  check('G: only the wiring imports the service', show(importers(/auditService'/)) === show(['src/main/ipc.ts']), show(importers(/auditService'/)))
  check('G: no request, no provider, no chat, no store of notes, instructions or projects imports the log, the service or the audit types', files.filter((f) => /src\/main\/(chat|memory|everyChat|projects|limits|askFirst|usageLedger|keptFile|attachment\w*)\.ts|src\/main\/providers\//.test(f)).every((f) => !/audit/i.test(readFileSync(join(REPO, f), 'utf8'))))
  check('G: the model-facing side (the system prompt, the request builder, the chat) never names the audit log', ['src/main/chat.ts', 'src/main/providers/request.ts', 'src/main/providers/types.ts', 'src/main/providers/anthropic.ts', 'src/main/providers/openai.ts'].every((f) => !/audit/i.test(source(f))))
  check('G: the registry and the question words do not import the log (a tool cannot reach it)', ['src/main/toolRegistry.ts', 'src/main/toolQuestion.ts', 'src/main/replyBudget.ts', 'src/main/dataFolderGuard.ts', 'src/main/toolCore.ts'].every((f) => !/audit/i.test(source(f).replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, ''))))

  // the page's side: three functions, three channels, none of which writes
  const ipcMod = await import(`${SRC}/shared/ipc.ts`)
  const auditChannels = Object.entries(ipcMod.CHANNELS).filter(([k, v]) => /audit/i.test(k) || /audit/i.test(v))
  check('G: the bridge has exactly three audit channels: read, export, delete all', show(auditChannels.map(([k]) => k).sort()) === show(['auditDeleteAll', 'auditExport', 'auditRead']) && auditChannels.every(([, v]) => /^audit:(read|export|delete-all)$/.test(v)), show(auditChannels))
  const preload = source('src/preload/index.ts')
  const group = preload.match(/audit: \{([\s\S]*?)\n  \}/)
  check('G: the preload gives the page exactly read, exportAll and deleteAll for the audit log (no way to add, change or remove a line)', group !== null && show([...group[1].matchAll(/^\s*(\w+):/gm)].map((m) => m[1])) === show(['read', 'exportAll', 'deleteAll']), group?.[1])
  const ipcMain = source('src/main/ipc.ts')
  const handlers = [...ipcMain.matchAll(/ipcMain\.handle\(\s*CHANNELS\.(audit\w+),\s*(guarded\w*)\(/g)].map((m) => [m[1], m[2]])
  check('G: each of the three has a handler in main, and each is behind the check of who is asking', show(handlers) === show([['auditRead', 'guarded'], ['auditExport', 'guardedForWindow'], ['auditDeleteAll', 'guardedForWindow']]), show(handlers))
  const everyHandler = [...ipcMain.matchAll(/ipcMain\.(?:handle|on)\(\s*([^,\s]+),/g)].map((m) => m[1].trim())
  check('G: every message handler of main is registered under a name from the bridge list (none under a name written in place)', everyHandler.length >= 40 && everyHandler.every((name) => /^CHANNELS\.\w+$/.test(name)), show(everyHandler.filter((name) => !/^CHANNELS\.\w+$/.test(name))))
  check('G: the deletion and the export are for the window that asked (the page names no window, no path and no answer)', /audit\.exportAll\(window\)/.test(ipcMain) && /audit\.deleteAll\(window\)/.test(ipcMain))
  const bridge = source('src/shared/ipc.ts')
  const api = bridge.match(/audit: \{([\s\S]*?)\n  \}/)
  check('G: the bridge\'s types give each of the three no argument at all', api !== null && /read\(\): Promise<AuditView>/.test(api[1]) && /exportAll\(\): Promise<AuditExportResult>/.test(api[1]) && /deleteAll\(\): Promise<AuditDeleteResult>/.test(api[1]))

  // the data folder: the log is where the folder suite expects it, and nothing else is new at the top of the folder
  const topNames = [...ipcMain.matchAll(/join\(app\.getPath\('userData'\), '([^']+)'/g)].map((m) => m[1])
  check('G: main builds one new place under the data folder, "audit" (where the data-folder test already has the log)', topNames.includes('audit') && ipcMain.includes("join(app.getPath('userData'), 'audit', 'log.jsonl')"), show(topNames))

  // the words
  const asked = svcMod.deleteQuestion({ calls: 3, older: false, oldest: T0 })
  check('G: the words of the deletion question offer no "always", no "don\'t ask again" and no "remember"', !/always|ask again|remember/i.test(JSON.stringify(asked)))
  const pkg = JSON.parse(source('package.json'))
  check('G: the build adds no package', show(Object.keys(pkg.dependencies).sort()) === '["@anthropic-ai/sdk","@electron-toolkit/utils","openai"]', show(pkg.dependencies))
})

console.error = realError
rmSync(root, { recursive: true, force: true })
if (logged.length > 0) console.log(`(${logged.length} lines the app logs on faults were collected)`)
const ok = check.summary()
process.exit(ok ? 0 : 1)
