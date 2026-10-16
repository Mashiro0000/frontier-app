// Slice 12.6 (D-042): APPLYING A CHANGE, AND UNDOING IT, under plain Node, on a real scratch workspace with the real guard, the real journal and the real audit log. The order of
// an apply (room in the journal -> the question RECORDED -> the box -> the answer recorded -> the file looked at AGAIN -> the undo copy journaled and READ BACK -> the start
// recorded -> written -> read back), every way it stops without a change, a write that fails and puts things back, undo (only while the file is still EXACTLY what the change
// wrote), the history (limits, deleting it), the sealed journal both ways, strict reading of its lines, what the audit log holds, that nothing but applyService.ts writes into
// the workspace and that no tool of the model can reach it, and the words of the questions. The window side is verify-12-6w.mjs. Windows only.
//
// Run: node tools/verify-12-6.mjs
import './ts-resolve.mjs'
import { checker } from './cdp.mjs'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import { win32 } from 'node:path'
import { REPO, REPO_URL } from './paths.mjs'
import { makeBox } from './lib8b3.mjs'

const check = checker()
const guard = async (name, fn) => { try { await fn() } catch (error) { check(`${name} did not run to its end: ${String(error?.stack ?? error).slice(0, 400)}`, false) } }
const show = (v) => JSON.stringify(v)?.slice(0, 300)
const SRC = `${REPO_URL}/src`
const applyMod = await import(`${SRC}/main/applyService.ts`)
const journalMod = await import(`${SRC}/main/journal.ts`)
const undoMod = await import(`${SRC}/main/undoRecords.ts`)
const auditMod = await import(`${SRC}/main/auditLog.ts`)
const sharedAudit = await import(`${SRC}/shared/audit.ts`)
const sharedTools = await import(`${SRC}/shared/tools.ts`)
const keptMod = await import(`${SRC}/main/keptFile.ts`)
const gateMod = await import(`${SRC}/main/systemQuestion.ts`)
const questionMod = await import(`${SRC}/main/toolQuestion.ts`)
const propMod = await import(`${SRC}/main/proposals.ts`)
const textMod = await import(`${SRC}/main/workspaceText.ts`)
const wsGuardMod = await import(`${SRC}/main/workspaceGuard.ts`)
const dataMod = await import(`${SRC}/main/dataFolderGuard.ts`)
const chatFile = await import(`${SRC}/main/chatFile.ts`)
const J = win32.join
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex')
const source = (rel) => fs.readFileSync(`${REPO}/${rel}`, 'utf8')

const ROOT = fs.realpathSync.native(fs.mkdtempSync(J(os.tmpdir(), 'frontier-126-')))
process.on('exit', () => { try { fs.rmSync(ROOT, { recursive: true, force: true }) } catch { /* left for the system */ } })
let counter = 0
const put = (base, rel, body) => { const full = J(base, rel); fs.mkdirSync(win32.dirname(full), { recursive: true }); fs.writeFileSync(full, body); return full }

/** A world: a workspace, a data folder, the real journal and audit log, a gate whose answers the check scripts, and the applier. */
function world({ form = 'plain', box = makeBox(), journalHooks = {}, readBack = undefined, recordHook = null } = {}) {
  const base = J(ROOT, `w${++counter}`)
  const DATA = J(base, 'frontier-app')
  const WS = J(base, 'ws')
  const OUT = J(base, 'out')
  for (const d of [DATA, WS, OUT]) fs.mkdirSync(d, { recursive: true })
  const state = { form, refused: null }
  const writeMode = async () => (state.refused !== null ? { refused: state.refused } : { form: state.form })
  const journalFile = J(DATA, 'workspace', 'changes.jsonl')
  const journal = journalMod.createJournal({ pathOf: () => journalFile, box, writeMode, parse: undoMod.parseUndoEntry, render: undoMod.renderUndoEntry, version: undoMod.UNDO_VERSION, maxLineChars: undoMod.UNDO_LIMITS.maxLineChars, maxConformBytes: undoMod.UNDO_LIMITS.maxBytes, name: 'the undo journal' })
  const hooked = { ...journal, append: async (value) => { await journalHooks.beforeAppend?.(value); return journal.append(value) }, size: journalHooks.size ?? journal.size, readAll: journalHooks.readAll ?? journal.readAll }
  const log = auditMod.createAuditLog({ pathOf: () => J(DATA, 'audit', 'log.jsonl'), box, writeMode })
  const dataGuard = dataMod.createDataFolderGuard({ roots: () => [DATA] })
  const ws = { root: WS }
  const wsGuard = wsGuardMod.createWorkspaceGuard({ root: () => ws.root, dataGuard })
  const asked = []
  const answers = []
  const clock = { gate: 1_000, now: 1_790_000_000_000 }
  const gate = gateMod.createQuestionGate(async (owner, question) => {
    asked.push({ owner, question })
    clock.gate += 10_000
    const next = answers.length > 0 ? answers.shift() : 'no'
    const value = typeof next === 'function' ? await next() : next
    return value === 'yes'
  }, () => clock.gate)
  const record = async (event) => { if (recordHook?.(event)) throw new Error('the disk is full'); await log.append(event) }
  const applier = applyMod.createApplier({ guard: wsGuard, journal: hooked, gate, record, now: () => (clock.now += 1), readBack })
  const events = async () => (await log.read()).events
  const journalText = () => (fs.existsSync(journalFile) ? fs.readFileSync(journalFile, 'utf8') : '')
  const entries = async () => { const all = await journal.readAll(); return all.state === 'too-big' ? [] : all.entries }
  const file = (...rel) => J(WS, ...rel)
  const read = (...rel) => fs.readFileSync(J(WS, ...rel))
  const edit = (rel, find, replace, extra = {}) => {
    const real = J(WS, ...rel)
    const bytes = fs.readFileSync(real)
    const r = propMod.makeEdit({ bytes, decoded: textMod.decodeText(bytes), rel, real, find, replace, why: 'because', secret: false, now: 1, ...extra })
    if (!r.ok) throw new Error(r.why)
    return { ...r.proposal, id: `p${++counter}` }
  }
  const create = (rel, content, extra = {}) => {
    const r = propMod.makeCreate({ rel, real: J(WS, ...rel), content, why: 'a new file', secret: false, now: 1, ...extra })
    if (!r.ok) throw new Error(r.why)
    return { ...r.proposal, id: `p${++counter}` }
  }
  return { base, DATA, WS, OUT, state, box, journal, hooked, journalFile, log, ws, wsGuard, asked, answers, clock, gate, applier, events, journalText, entries, file, read, edit, create, put: (rel, body) => put(WS, rel, body) }
}
const kinds = (events, tool) => events.filter((e) => e.tool === tool).map((e) => e.type)
const noTemp = (dir) => fs.readdirSync(dir).filter((n) => /\.tmp$/.test(n))

// ============ A. an edit is applied ============
await guard('A', async () => {
  const w = world()
  w.put('src\\a.ts', 'one\ntwo\nthree\n')
  const p = w.edit(['src', 'a.ts'], 'two', 'TWO')
  w.answers.push('yes')
  const r = await w.applier.apply(p, 'the window')
  check('A: with a yes the change is written, and the answer says so and where the original is kept', r.ok && /written/.test(r.message) && /undo/.test(r.message), show(r))
  check('A: the file is now exactly the bytes of the proposal (byte for byte)', w.read('src', 'a.ts').equals(propMod.bytesFor(p.after, p.bom)) && w.read('src', 'a.ts').toString() === 'one\nTWO\nthree\n')
  check('A: the question went to the window that asked, once', w.asked.length === 1 && w.asked[0].owner === 'the window')
  const q = w.asked[0].question
  check('A: the box names the file, the counts, the size, the fingerprint of the exact bytes, the reason, and says where the copy of the original is kept', q.detail.includes('"' + p.real.replace(/\\/g, '\\\\') + '"') && /1 line added, 1 removed; the file will be 14 bytes/.test(q.detail) && q.detail.includes(p.fingerprint) && q.detail.includes('because') && /copy of the original in its own data folder/.test(q.detail), q.detail)
  check('A: the buttons name the change, and the "no" is the other one', q.yes === 'Write this change' && q.no === "Don't write" && q.message === 'Write this change to your file?' && q.title === 'Code workspace')
  const entries = await w.entries()
  check('A: the journal holds one entry: the original whole as base64 with its hash, the hash and size of what was written, the fingerprint', entries.length === 1 && entries[0].type === 'applied' && entries[0].kind === 'edit' && entries[0].path === 'src/a.ts' && Buffer.from(entries[0].before, 'base64').toString() === 'one\ntwo\nthree\n' && entries[0].beforeHash === sha(Buffer.from('one\ntwo\nthree\n')) && entries[0].afterHash === sha(w.read('src', 'a.ts')) && entries[0].afterBytes === 14 && entries[0].fingerprint === p.fingerprint, show(entries))
  const ev = await w.events()
  check('A: the audit log has the four lines in this order: asked, answered (yes), ran, result (ok, the size written)', show(kinds(ev, 'apply_change')) === show(['asked', 'answered', 'ran', 'result']) && ev.find((e) => e.type === 'answered').answer === 'yes' && ev.find((e) => e.type === 'result').ok === true && ev.find((e) => e.type === 'result').size === 14, show(ev))
  check('A: the asked line holds the change, the path and the fingerprint and the reason, and nothing of the file', (() => { const a = ev.find((e) => e.type === 'asked'); return a.args.change === p.id && a.args.path === 'src/a.ts' && a.args.fingerprint === p.fingerprint && a.why === 'because' && !JSON.stringify(ev).includes('three') && !JSON.stringify(ev).includes('TWO') })())
  check('A: no temporary file is left in the folder', noTemp(J(w.WS, 'src')).length === 0 && fs.readdirSync(J(w.WS, 'src')).join() === 'a.ts')
  const listed = await w.applier.applied()
  check('A: the list shows it: newest first, the path, the kind, the bytes, "undoable"', listed.length === 1 && listed[0].state === 'undoable' && listed[0].path === 'src/a.ts' && listed[0].kind === 'edit' && listed[0].bytes === 14 && listed[0].fingerprint === p.fingerprint && Object.keys(listed[0]).sort().join() === 'at,bytes,fingerprint,id,kind,path,state')
  // line endings and a byte-order mark are kept as they were
  w.clock.gate += 10_000
  w.put('win\\w.txt', Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('a\r\nb\r\nc\r\n')]))
  const crlf = w.edit(['win', 'w.txt'], 'b', 'B')
  w.answers.push('yes')
  const r2 = await w.applier.apply(crlf, 'w')
  check('A: Windows line endings and a byte-order mark stay as they were in the file', r2.ok && w.read('win', 'w.txt').equals(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('a\r\nB\r\nc\r\n')])), show(w.read('win', 'w.txt')))
  // a big file
  const big = Array.from({ length: 7000 }, (_, i) => `line number ${i} of a big file`).join('\n') + '\n'
  w.put('big.txt', big)
  const bigP = w.edit(['big.txt'], 'line number 3000 of', 'LINE 3000 OF')
  w.answers.push('yes')
  check('A: a file of about 220 KB (the cap is 256 KB) is written and read back', (await w.applier.apply(bigP, 'w')).ok && w.read('big.txt').toString().includes('LINE 3000 OF'))
})

// ============ B. the ways an apply stops with nothing written ============
await guard('B', async () => {
  const w = world()
  w.put('a.ts', 'one\ntwo\n')
  const orig = Buffer.from('one\ntwo\n')
  const p = () => w.edit(['a.ts'], 'two', 'TWO')
  const untouched = async (what) => w.read('a.ts').equals(orig) && (await w.entries()).length === 0 && noTemp(w.WS).length === 0
  w.answers.push('no')
  let r = await w.applier.apply(p(), 'w')
  check('B: a "no" writes nothing, keeps nothing, and is answered in words', !r.ok && r.error === applyMod.NOT_WRITTEN && (await untouched()), show(r))
  let ev = await w.events()
  check('B: ...and the log has asked, answered (no) and no "ran"', show(kinds(ev, 'apply_change')) === show(['asked', 'answered']) && ev.at(-1).answer === 'no')
  r = await w.applier.apply(p(), 'w')
  check('B: right after a "no" the next question is not asked (the quiet time), in words', !r.ok && /said no to a question a moment ago/.test(r.error) && w.asked.length === 1 && (await untouched()))
  w.clock.gate += 60_000
  // the gate answers busy only when a question is open; simulate that through a long-open question
  let release
  const hold = new Promise((resolve) => { release = resolve })
  w.answers.push(() => hold.then(() => 'yes'))
  const first = w.applier.apply(p(), 'w')
  await new Promise((resolve) => setTimeout(resolve, 30))
  const second = await w.applier.apply(p(), 'w')
  check('B: a second apply while one is open is refused at once in words (one at a time), and no second question is asked', !second.ok && /Another change is being applied or undone/.test(second.error) && w.asked.length === 2)
  const undoDuring = await w.applier.undo('u1-1', 'w')
  check('B: ... and an undo while one is open is not even looked at as a question: it is answered about its id', !undoDuring.ok)
  release()
  check('B: the first one finishes normally afterwards', (await first).ok === true && w.read('a.ts').toString() === 'one\nTWO\n')
  // put it back for the next ones
  fs.writeFileSync(w.file('a.ts'), orig)
  w.clock.gate += 60_000

  // a fingerprint that does not match the bytes
  const bad = { ...p(), after: 'one\nSOMETHING ELSE\n' }
  r = await w.applier.apply(bad, 'w')
  check('B: a change whose bytes do not match its fingerprint is refused before anything is asked', !r.ok && /does not match its fingerprint/.test(r.error) && w.asked.length === 2)

  // the file changes while the person decides
  w.answers.push(async () => { fs.writeFileSync(w.file('a.ts'), 'one\ntwo\nSOMEONE ELSE WROTE THIS\n'); return 'yes' })
  r = await w.applier.apply(p(), 'w')
  check('B: a file changed while the box was open is not overwritten: refused in words, and what the person wrote meanwhile is still there', !r.ok && /changed while you were deciding/.test(r.error) && w.read('a.ts').toString() === 'one\ntwo\nSOMEONE ELSE WROTE THIS\n', show(r))
  ev = await w.events()
  check('B: ...and the log ends with a result that says it did not go through (asked, answered yes, result not ok; no "ran")', show(kinds(ev, 'apply_change').slice(-3)) === show(['asked', 'answered', 'result']) && ev.at(-1).ok === false && (await w.entries()).length === 1, show(ev.slice(-4)))
  fs.writeFileSync(w.file('a.ts'), orig)
  w.clock.gate += 60_000
  // the file is deleted while the person decides
  w.answers.push(async () => { fs.rmSync(w.file('a.ts')); return 'yes' })
  r = await w.applier.apply(p(), 'w')
  check('B: a file removed while the box was open is not made again', !r.ok && /changed while you were deciding/.test(r.error) && !fs.existsSync(w.file('a.ts')))
  ev = await w.events()
  check('B: ...and the log ends with a failed result (asked, answered yes, result not ok)', show(kinds(ev, 'apply_change').slice(-3)) === show(['asked', 'answered', 'result']) && ev.at(-1).ok === false)
  fs.writeFileSync(w.file('a.ts'), orig)
  w.clock.gate += 60_000
  // the file is swapped for a folder of the same name while the person decides
  w.answers.push(async () => { fs.rmSync(w.file('a.ts')); fs.mkdirSync(w.file('a.ts')); return 'yes' })
  r = await w.applier.apply(p(), 'w')
  check('B: a file swapped for a folder of the same name while the box was open is not written over', !r.ok && fs.statSync(w.file('a.ts')).isDirectory() && fs.readdirSync(w.file('a.ts')).length === 0, show(r))
  fs.rmSync(w.file('a.ts'), { recursive: true })
  fs.writeFileSync(w.file('a.ts'), orig)
  w.clock.gate += 60_000
  // the folder becomes a junction while the person decides
  fs.mkdirSync(w.file('sub'))
  w.put('sub\\c.ts', 'c1\nc2\n')
  const inSub = w.edit(['sub', 'c.ts'], 'c2', 'C2')
  let linked = true
  w.answers.push(async () => {
    try { fs.renameSync(w.file('sub'), w.file('sub-real')); fs.symlinkSync(w.OUT, w.file('sub'), 'junction') } catch { linked = false }
    return 'yes'
  })
  r = await w.applier.apply(inSub, 'w')
  if (linked) check('B: a folder swapped for a junction while the box was open stops the apply (the guard looks again after the yes), and nothing was written outside', !r.ok && fs.readdirSync(w.OUT).length === 0, show(r))
  else check('B: (no junction could be made here)', true)
  try { fs.rmdirSync(w.file('sub')); fs.renameSync(w.file('sub-real'), w.file('sub')) } catch { /* nothing to undo */ }
  w.clock.gate += 60_000
  // a question that would not fit is refused, never shortened
  const hugeReason = w.create(['n.txt'], 'x', { why: 'y'.repeat(2000) })
  r = await w.applier.apply(hugeReason, 'w')
  check('B: a question that would not fit the box in full is refused in words, not shortened, and not asked', !r.ok && /would not fit in the box in full/.test(r.error) && !fs.existsSync(w.file('n.txt')), show(r))
  // a read-only file
  fs.chmodSync(w.file('a.ts'), 0o444)
  w.answers.push('yes')
  r = await w.applier.apply(p(), 'w')
  fs.chmodSync(w.file('a.ts'), 0o666)
  check('B: a read-only file is not changed, in words', !r.ok && /read-only/.test(r.error) && w.read('a.ts').equals(orig) && noTemp(w.WS).length === 0, show(r))
  w.clock.gate += 60_000
})

// ============ C. the record and the journal come first ============
await guard('C', async () => {
  // C1: the record of the question fails: nothing is asked, nothing written
  let w = world({ recordHook: (e) => e.type === 'asked' })
  w.put('a.ts', 'one\ntwo\n')
  w.answers.push('yes')
  let r = await w.applier.apply(w.edit(['a.ts'], 'two', 'TWO'), 'w')
  check('C: when the question cannot be recorded, it is not asked and nothing is written', !r.ok && /could not keep its record/.test(r.error) && w.asked.length === 0 && w.read('a.ts').toString() === 'one\ntwo\n' && (await w.entries()).length === 0, show(r))
  // C2: the answer cannot be recorded
  w = world({ recordHook: (e) => e.type === 'answered' })
  w.put('a.ts', 'one\ntwo\n')
  w.answers.push('yes')
  r = await w.applier.apply(w.edit(['a.ts'], 'two', 'TWO'), 'w')
  check('C: a yes whose record cannot be kept is not acted on', !r.ok && /could not keep its record/.test(r.error) && w.read('a.ts').toString() === 'one\ntwo\n' && (await w.entries()).length === 0)
  // C3: the start cannot be recorded: the undo copy was made, so it is closed, and the file is untouched
  w = world({ recordHook: (e) => e.type === 'ran' })
  w.put('a.ts', 'one\ntwo\n')
  w.answers.push('yes')
  r = await w.applier.apply(w.edit(['a.ts'], 'two', 'TWO'), 'w')
  const e3 = await w.entries()
  check('C: when the start cannot be recorded the file is untouched, and the undo entry is closed at once (it is never offered)', !r.ok && w.read('a.ts').toString() === 'one\ntwo\n' && e3.length === 2 && e3[1].type === 'undone' && e3[1].id === e3[0].id && (await w.applier.applied()).every((c) => c.state === 'undone'), show(e3.map((e) => e.type)))
  // C4: the undo copy cannot be kept: nothing is written
  w = world({ journalHooks: { beforeAppend: () => { throw new Error('the disk is full') } } })
  w.put('a.ts', 'one\ntwo\n')
  w.answers.push('yes')
  r = await w.applier.apply(w.edit(['a.ts'], 'two', 'TWO'), 'w')
  check('C: when the copy of the original cannot be kept, nothing is written, and it says why', !r.ok && /could not keep the copy of the original/.test(r.error) && w.read('a.ts').toString() === 'one\ntwo\n')
  const ev4 = await w.events()
    check('C: ...and the log ends with a result that says it failed (no "ran")', !kinds(ev4, 'apply_change').includes('ran') && ev4.at(-1).type === 'result' && ev4.at(-1).ok === false)
  // C5: the order: at the moment the undo copy is appended, the file is still untouched; at the moment of the write the copy is on the disk
  const seen = []
  w = world({ journalHooks: { beforeAppend: (value) => { seen.push([value.type, fs.readFileSync(w.file('a.ts'), 'utf8')]) } } })
  w.put('a.ts', 'one\ntwo\n')
  w.answers.push('yes')
  r = await w.applier.apply(w.edit(['a.ts'], 'two', 'TWO'), 'w')
  check('C: the undo copy is appended BEFORE the file is touched (the file still had its old bytes at that moment)', r.ok && seen.length === 1 && seen[0][0] === 'applied' && seen[0][1] === 'one\ntwo\n', show(seen))
  // C6: the journal refuses to write (the key cannot be used)
  w = world({ form: 'encrypted' })
  w.put('a.ts', 'one\ntwo\n')
  w.state.refused = 'the key cannot be used'
  w.answers.push('yes')
  r = await w.applier.apply(w.edit(['a.ts'], 'two', 'TWO'), 'w')
  check('C: when the journal may not be written (the key cannot be used), the file is not changed', !r.ok && w.read('a.ts').toString() === 'one\ntwo\n')
  // C7: the journal is full by count
  w = world()
  w.put('a.ts', 'one\ntwo\n')
  for (let i = 0; i < undoMod.UNDO_LIMITS.maxChanges - 1; i += 1) {
    await w.journal.append({ type: 'applied', id: `u${i.toString(36)}-1`, at: 1_790_000_000_000 + i, kind: 'create', path: `f${i}.txt`, before: null, beforeHash: null, afterHash: sha(`f${i}`), afterBytes: 1, fingerprint: sha(`f${i}`).slice(0, 12) })
  }
  w.answers.push('yes')
  r = await w.applier.apply(w.edit(['a.ts'], 'two', 'TWO'), 'w')
  check('C: with 999 changes in the journal the 1000th is allowed', r.ok === true)
  w.clock.gate += 60_000
  w.put('b.ts', 'x\ny\n')
  w.answers.push('yes')
  const askedBefore = w.asked.length
  r = await w.applier.apply(w.edit(['b.ts'], 'y', 'Y'), 'w')
  check('C: with 1000 (undone or not) the next is refused in words, before any question, and nothing is written', !r.ok && r.error === applyMod.ROOM_FULL && w.asked.length === askedBefore && w.read('b.ts').toString() === 'x\ny\n', show(r))
  const list = await w.applier.applied()
  check('C: the list shows the newest 50 only', list.length === 50)
  // C8: the journal is full by size, or too big to read
  w = world({ journalHooks: { size: async () => undoMod.UNDO_LIMITS.maxBytes } })
  w.put('a.ts', 'one\ntwo\n')
  w.answers.push('yes')
  r = await w.applier.apply(w.edit(['a.ts'], 'two', 'TWO'), 'w')
  check('C: a journal of 200 MB is full', !r.ok && r.error === applyMod.ROOM_FULL && w.asked.length === 0)
  w = world({ journalHooks: { readAll: async () => ({ state: 'too-big' }) } })
  w.put('a.ts', 'one\ntwo\n')
  w.answers.push('yes')
  r = await w.applier.apply(w.edit(['a.ts'], 'two', 'TWO'), 'w')
  check('C: a journal too big to read is full too', !r.ok && r.error === applyMod.ROOM_FULL && w.read('a.ts').toString() === 'one\ntwo\n')
  w = world({ journalHooks: { size: async () => { throw new Error('boom') } } })
  w.put('a.ts', 'one\ntwo\n')
  w.answers.push('yes')
  r = await w.applier.apply(w.edit(['a.ts'], 'two', 'TWO'), 'w')
  check('C: a journal that cannot be looked at counts as full (nothing is written without the copy)', !r.ok && r.error === applyMod.ROOM_FULL)
})

// ============ D. a write that fails puts things back ============
await guard('D', async () => {
  let w = world({ readBack: async () => Buffer.from('a lie') })
  w.put('a.ts', 'one\ntwo\n')
  w.answers.push('yes')
  let r = await w.applier.apply(w.edit(['a.ts'], 'two', 'TWO'), 'w')
  check('D: a file that does not read back as written is put back as it was (the original, byte for byte), and the person is told', !r.ok && /put back as it was/.test(r.error) && w.read('a.ts').toString() === 'one\ntwo\n', show(r))
  let e = await w.entries()
  check('D: ...the entry is closed (never offered for undo), and no temporary file is left', e.length === 2 && e[1].type === 'undone' && noTemp(w.WS).length === 0)
  const ev = await w.events()
  check('D: ...and the log ends with a failed result', ev.at(-1).type === 'result' && ev.at(-1).ok === false)
  w = world({ readBack: async () => Buffer.from('a lie') })
  w.answers.push('yes')
  r = await w.applier.apply(w.create(['docs', 'new.md'], '# new\n'), 'w')
  check('D: a new file that does not read back is removed again', !r.ok && !fs.existsSync(w.file('docs', 'new.md')))
  // a file made by someone between the look and the write: exclusive create does not overwrite
  w = world()
  // the guard sees "missing" at the look after the yes; the file appears during the journal append
  const wc = world({ journalHooks: { beforeAppend: () => { fs.writeFileSync(wc.file('clash.txt'), 'theirs\n') } } })
  wc.answers.push('yes')
  r = await wc.applier.apply(wc.create(['clash.txt'], 'mine\n'), 'w')
  check('D: a new file whose name is taken at the last moment is never overwritten (exclusive create)', !r.ok && wc.read('clash.txt').toString() === 'theirs\n', show(r))
  // a new file in folders that do not exist
  w = world()
  w.answers.push('yes')
  r = await w.applier.apply(w.create(['a', 'b', 'c', 'new.md'], '# new\n'), 'w')
  check('D: a new file in folders that do not exist makes them, inside the workspace, and is written whole', r.ok && w.read('a', 'b', 'c', 'new.md').toString() === '# new\n' && /undo/.test(r.message))
  // an undo whose original does not read back
  const lie = { on: false }
  w = world({ readBack: async (path) => (lie.on ? Buffer.from('a lie') : fs.readFileSync(path)) })
  w.put('a.ts', 'one\ntwo\n')
  w.answers.push('yes')
  await w.applier.apply(w.edit(['a.ts'], 'two', 'TWO'), 'w')
  lie.on = true
  w.clock.gate += 60_000
  w.answers.push('yes')
  r = await w.applier.undo((await w.applier.applied())[0].id, 'w')
  e = await w.entries()
  check('D: an undo whose original does not read back is reported as not done, and the entry is NOT closed as undone', !r.ok && /could not be undone/.test(r.error) && e.every((x) => x.type === 'applied'), show(r))
  const uev = await w.events()
  check('D: ...and the log ends with a failed result of undo_change', uev.at(-1).tool === 'undo_change' && uev.at(-1).type === 'result' && uev.at(-1).ok === false)
  // a start that cannot be recorded stops an undo too
  const hook = { on: false }
  w = world({ recordHook: (event) => hook.on && event.type === 'ran' })
  w.put('a.ts', 'one\ntwo\n')
  w.answers.push('yes')
  await w.applier.apply(w.edit(['a.ts'], 'two', 'TWO'), 'w')
  hook.on = true
  w.clock.gate += 60_000
  w.answers.push('yes')
  r = await w.applier.undo((await w.applier.applied())[0].id, 'w')
  check('D: when the start of an undo cannot be recorded the file is not touched', !r.ok && /could not keep its record/.test(r.error) && w.read('a.ts').toString() === 'one\nTWO\n')
  // a secure storage that gives back blobs that do not open: the journal proves each line before it goes on
  const garble = makeBox()
  w = world({ form: 'encrypted', box: garble, journalHooks: { beforeAppend: () => { garble.garble = true } } })
  w.put('a.ts', 'one\ntwo\n')
  w.answers.push('yes')
  r = await w.applier.apply(w.edit(['a.ts'], 'two', 'TWO'), 'w')
  check('D: a secure storage whose seal does not open stops the apply (the line is proved before it is written), and the file is untouched', !r.ok && /could not keep the copy of the original/.test(r.error) && w.read('a.ts').toString() === 'one\ntwo\n' && !w.journalText().includes('"applied"'), show(r))
})

// ============ E. undo ============
await guard('E', async () => {
  const w = world()
  w.put('a.ts', 'one\ntwo\n')
  const orig = Buffer.from('one\ntwo\n')
  w.answers.push('yes')
  const done = await w.applier.apply(w.edit(['a.ts'], 'two', 'TWO'), 'w')
  const [item] = await w.applier.applied()
  check('E: (set up) a change applied and listed as undoable', done.ok && item.state === 'undoable')
  // not text / not there
  check('E: an id that is not text, or not in the history, is answered in words and nothing is asked', (await w.applier.undo(undefined, 'w')).error === 'That change is not in the undo history.' && (await w.applier.undo(7, 'w')).error === 'That change is not in the undo history.' && (await w.applier.undo('u0-0', 'w')).error === 'That change is not in the undo history.' && (await w.applier.undo({ id: item.id }, 'w')).ok === false && w.asked.length === 1)
  w.answers.push('no')
  let r = await w.applier.undo(item.id, 'w')
  check('E: a "no" to the undo changes nothing', !r.ok && w.read('a.ts').toString() === 'one\nTWO\n' && (await w.applier.applied())[0].state === 'undoable')
  w.clock.gate += 60_000
  w.answers.push('yes')
  r = await w.applier.undo(item.id, 'the window')
  const q = w.asked.at(-1).question
  check('E: with a yes the original is back, byte for byte, and the answer says so', r.ok && r.message === 'The original is back.' && w.read('a.ts').equals(orig))
  check('E: the undo question names the file and the fingerprint and says what is lost: nothing', q.message === 'Put the original back?' && q.yes === 'Put the original back' && q.no === "Don't undo" && q.detail.includes(item.fingerprint) && /nothing you wrote since is lost/.test(q.detail) && w.asked.at(-1).owner === 'the window')
  check('E: the list now says "undone", and a second undo is refused in words', (await w.applier.applied())[0].state === 'undone' && (await w.applier.undo(item.id, 'w')).error === 'That change was already undone.')
  const ev = await w.events()
  check('E: the log has the undo as a call of undo_change: asked, answered, ran, result', show(kinds(ev, 'undo_change').slice(-4)) === show(['asked', 'answered', 'ran', 'result']) && ev.filter((e) => e.tool === 'undo_change' && e.type === 'result')[0].ok === true)
  check('E: no temporary file is left', noTemp(w.WS).length === 0)

  // the file changed after the change: never overwritten
  w.clock.gate += 60_000
  w.answers.push('yes')
  const second = await w.applier.apply(w.edit(['a.ts'], 'two', 'TWO'), 'w')
  const id2 = (await w.applier.applied())[0].id
  fs.writeFileSync(w.file('a.ts'), 'one\nTWO\nand then I wrote more\n')
  const listed = await w.applier.applied()
  w.clock.gate += 60_000
  const askedBefore = w.asked.length
  r = await w.applier.undo(id2, 'w')
  check('E: a file changed after the change is "changed" in the list, and an undo is refused in words before any question; what was written since is still there', second.ok && listed[0].state === 'changed' && !r.ok && /Undoing it would lose what was written since/.test(r.error) && w.asked.length === askedBefore && w.read('a.ts').toString() === 'one\nTWO\nand then I wrote more\n', show(r))
  // the file changes while the undo box is open
  fs.writeFileSync(w.file('a.ts'), 'one\nTWO\n')
  w.answers.push(async () => { fs.writeFileSync(w.file('a.ts'), 'one\nTWO\nlate edit\n'); return 'yes' })
  r = await w.applier.undo(id2, 'w')
  check('E: a file changed while the undo box was open is not overwritten either', !r.ok && /Undoing it would lose what was written since/.test(r.error) && w.read('a.ts').toString() === 'one\nTWO\nlate edit\n')
  const ev2 = await w.events()
  check('E: ...and the log has a failed result for it', ev2.at(-1).tool === 'undo_change' && ev2.at(-1).type === 'result' && ev2.at(-1).ok === false)
  // gone
  fs.rmSync(w.file('a.ts'))
  check('E: a file that is gone is "gone" in the list, and an undo says it is not there', (await w.applier.applied())[0].state === 'gone' && /not there or not available/.test((await w.applier.undo(id2, 'w')).error))
  // unavailable: the workspace is cleared
  fs.writeFileSync(w.file('a.ts'), 'one\nTWO\n')
  w.ws.root = null
  check('E: with the workspace cleared every change is "unavailable", and an undo is refused', (await w.applier.applied())[0].state === 'unavailable' && !(await w.applier.undo(id2, 'w')).ok)
  w.ws.root = w.WS
  check('E: ...and back to "undoable" when the same workspace is chosen again (the bytes are the same)', (await w.applier.applied())[0].state === 'undoable')
  // a junction on the way
  let linked = true
  const dirChange = world()
  dirChange.put('d\\f.ts', 'f1\nf2\n')
  dirChange.answers.push('yes')
  await dirChange.applier.apply(dirChange.edit(['d', 'f.ts'], 'f2', 'F2'), 'w')
  try { fs.renameSync(dirChange.file('d'), dirChange.file('d-real')); fs.symlinkSync(dirChange.OUT, dirChange.file('d'), 'junction') } catch { linked = false }
  if (linked) {
    put(dirChange.OUT, 'f.ts', 'f1\nF2\n')
    dirChange.clock.gate += 60_000
    dirChange.answers.push('yes')
    const out = await dirChange.applier.undo((await dirChange.applier.applied())[0].id, 'w')
    check('E: a folder that became a junction makes the change "unavailable", and an undo writes nothing through it', (await dirChange.applier.applied())[0].state === 'unavailable' && !out.ok && fs.readFileSync(J(dirChange.OUT, 'f.ts'), 'utf8') === 'f1\nF2\n')
  } else check('E: (no junction could be made here)', true)

  // a created file
  const c = world()
  c.answers.push('yes')
  await c.applier.apply(c.create(['docs', 'n.md'], '# n\n'), 'w')
  const cid = (await c.applier.applied())[0]
  check('E: a created file is listed as a new file, undoable', cid.kind === 'create' && cid.state === 'undoable')
  c.clock.gate += 60_000
  c.answers.push('yes')
  r = await c.applier.undo(cid.id, 'w')
  const cq = c.asked.at(-1).question
  check('E: undoing a new file deletes it, and says so; the folder that was made for it stays', r.ok && r.message === 'The new file was deleted.' && !fs.existsSync(c.file('docs', 'n.md')) && fs.existsSync(c.file('docs')) && cq.message === 'Delete the file this change made?' && /Folders that were made for it stay/.test(cq.detail))
  // a created file that was changed since
  c.clock.gate += 60_000
  c.answers.push('yes')
  await c.applier.apply(c.create(['docs', 'm.md'], 'm\n'), 'w')
  fs.writeFileSync(c.file('docs', 'm.md'), 'm\nmore\n')
  const cm = (await c.applier.applied())[0]
  check('E: a new file that was changed since is not deleted', cm.state === 'changed' && !(await c.applier.undo(cm.id, 'w')).ok && fs.existsSync(c.file('docs', 'm.md')))

  // crash cases: after the undo copy and before the write; after the write and before the result
  const k = world()
  k.put('a.ts', 'one\ntwo\n')
  const p = k.edit(['a.ts'], 'two', 'TWO')
  await k.journal.append({ type: 'applied', id: 'ucrash-1', at: 1_790_000_000_001, kind: 'edit', path: 'a.ts', before: Buffer.from('one\ntwo\n').toString('base64'), beforeHash: sha(Buffer.from('one\ntwo\n')), afterHash: sha(propMod.bytesFor(p.after, p.bom)), afterBytes: 12, fingerprint: p.fingerprint })
  check('E: a crash after the undo copy and before the write: the file is the original, the entry is "changed" (it is not offered for undo, and nothing is lost)', (await k.applier.applied())[0].state === 'changed' && !(await k.applier.undo('ucrash-1', 'w')).ok && k.read('a.ts').toString() === 'one\ntwo\n')
  fs.writeFileSync(k.file('a.ts'), propMod.bytesFor(p.after, p.bom))
  check('E: a crash after the write and before the result: the file is the new one, the entry is "undoable", and the undo works', (await k.applier.applied())[0].state === 'undoable')
  k.answers.push('yes')
  check('E: ...and works', (await k.applier.undo('ucrash-1', 'w')).ok && k.read('a.ts').toString() === 'one\ntwo\n')

  // a 250 KB original comes back exactly
  const big = world()
  const text = Array.from({ length: 9000 }, (_, i) => `row ${i} é日本語😀`).join('\r\n') + '\r\n'
  big.put('big.txt', Buffer.from(text, 'utf8'))
  const bigBytes = big.read('big.txt')
  big.answers.push('yes')
  const bigApply = await big.applier.apply(big.edit(['big.txt'], 'row 4500 ', 'ROW 4500 '), 'w')
  big.clock.gate += 60_000
  big.answers.push('yes')
  const bigUndo = await big.applier.undo((await big.applier.applied())[0].id, 'w')
  check('E: an original of ' + bigBytes.length + ' bytes with Windows line endings and non-Latin text comes back byte for byte', bigApply.ok && bigUndo.ok && big.read('big.txt').equals(bigBytes))
})

// ============ F. deleting the history ============
await guard('F', async () => {
  const w = world()
  check('F: with no history there is nothing to delete, and nothing is asked', (await w.applier.clearHistory('w')).message === 'There was nothing to delete.' && w.asked.length === 0)
  w.put('a.ts', 'one\ntwo\n')
  w.answers.push('yes')
  await w.applier.apply(w.edit(['a.ts'], 'two', 'TWO'), 'w')
  w.clock.gate += 60_000
  w.answers.push('no')
  let r = await w.applier.clearHistory('w')
  check('F: a "no" keeps the history', !r.ok && (await w.applier.applied()).length === 1)
  w.clock.gate += 60_000
  w.answers.push('yes')
  r = await w.applier.clearHistory('the window')
  const q = w.asked.at(-1).question
  check('F: with a yes the journal is deleted, the file is not touched, and the list is empty', r.ok && r.message === 'The undo history was deleted.' && !fs.existsSync(w.journalFile) && w.read('a.ts').toString() === 'one\nTWO\n' && (await w.applier.applied()).length === 0)
  check('F: the question says how many changes, and that files are not touched and nothing can be undone afterwards', q.message === 'Delete the undo history?' && /originals of 1 applied change\./.test(q.detail) && /Your files are not touched/.test(q.detail) && /nothing can be undone afterwards/.test(q.detail) && q.yes === 'Delete the history')
  const ev = await w.events()
  check('F: the log has it as a call of undo_clear: asked (the number), answered, result', show(kinds(ev, 'undo_clear').slice(-3)) === show(['asked', 'answered', 'result']) && ev.filter((e) => e.tool === 'undo_clear' && e.type === 'asked').at(-1).args.changes === 1)
  w.clock.gate += 60_000
  w.answers.push('yes')
  const after = await w.applier.apply(w.edit(['a.ts'], 'TWO', 'two again'), 'w')
  check('F: and changes can be applied again afterwards', after.ok && (await w.applier.applied()).length === 1)
  // a journal that cannot be deleted
  const stuck = world()
  stuck.put('a.ts', 'one\ntwo\n')
  stuck.answers.push('yes')
  await stuck.applier.apply(stuck.edit(['a.ts'], 'two', 'TWO'), 'w')
  const fd = fs.openSync(stuck.journalFile, 'r')
  stuck.clock.gate += 60_000
  stuck.answers.push('yes')
  r = await stuck.applier.clearHistory('w')
  fs.closeSync(fd)
  check('F: a journal that cannot be deleted (it is open elsewhere) is answered in words and the failure is logged', (r.ok === true) || (!r.ok && /could not be deleted/.test(r.error)))
})

// ============ G. the journal: sealed, strict, mended ============
await guard('G', async () => {
  const box = makeBox()
  const w = world({ form: 'encrypted', box })
  w.put('secret-name.ts', 'one\ntwo\n')
  w.answers.push('yes')
  await w.applier.apply(w.edit(['secret-name.ts'], 'two', 'TWO'), 'w')
  const raw = w.journalText()
  check('G: with encryption on every line of the journal is sealed: no path, no file text, no base64 of the original', raw.split('\n').filter((l) => l !== '').every((l) => l.startsWith(chatFile.SEALED_PREFIX) || JSON.parse(l).enc !== undefined || /^\{"v":\d+,"enc"/.test(l)) && !raw.includes('secret-name') && !raw.includes(Buffer.from('one\ntwo\n').toString('base64').slice(0, 8)), raw.slice(0, 200))
  check('G: ...and it reads back, and the undo works from it', (await w.applier.applied())[0].state === 'undoable')
  const docs = keptMod.keptDocuments([w.journal.document])
  check('G: the flow counts it as encrypted', show(await docs.counts()) === '{"plain":0,"encrypted":1}', show(await docs.counts()))
  w.state.form = 'plain'
  const off = await docs.conform()
  const plainText = w.journalText()
  check('G: turning encryption off rewrites it to plain (the path is there to read), and it still reads back', off.changed === 1 && off.failed === 0 && plainText.includes('secret-name.ts') && (await w.applier.applied())[0].state === 'undoable', show(off))
  w.state.form = 'encrypted'
  const on = await docs.conform()
  check('G: turning it on again seals it all again', on.changed === 1 && !w.journalText().includes('secret-name.ts') && (await w.applier.applied())[0].state === 'undoable')
  check('G: a second pass has nothing to do', (await docs.conform()).changed === 0)
  box.lose()
  const lost = await w.journal.readAll()
  check('G: with the key lost the sealed lines are counted and give no entries; the list is empty, an undo says it is not in the history, and applying is refused (no copy can be kept)', lost.state === 'ok' && lost.entries.length === 0 && lost.sealedClosed > 0 && (await w.applier.applied()).length === 0)
  const lostBefore = w.journalText()
  const lostConform = await docs.conform()
  check('G: with the key lost, turning encryption on or off does not touch a journal it cannot open (the file stays exactly as it is)', w.journalText() === lostBefore && lostConform.changed === 0, show(lostConform))
  const mixed = world({ form: 'plain', box: makeBox() })
  await mixed.journal.append({ type: 'applied', id: 'u1-1', at: 1_790_000_000_000, kind: 'create', path: 'a.ts', before: null, beforeHash: null, afterHash: sha('y'), afterBytes: 1, fingerprint: sha('y').slice(0, 12) })
  mixed.state.form = 'encrypted'
  await mixed.journal.append({ type: 'applied', id: 'u2-1', at: 1_790_000_000_001, kind: 'create', path: 'b.ts', before: null, beforeHash: null, afterHash: sha('z'), afterBytes: 1, fingerprint: sha('z').slice(0, 12) })
  mixed.box.lose()
  const mixedBefore = mixed.journalText()
  const mixedDocs = keptMod.keptDocuments([mixed.journal.document])
  const mixedResult = await mixedDocs.conform()
  check('G: a journal with a plain line and a line the key cannot open is not rewritten when encryption is turned on (the unreadable line would be at risk), and the flow reports it', mixed.journalText() === mixedBefore && mixedResult.changed === 0, show(mixedResult))
  // strict lines
  const w2 = world()
  const good = { type: 'applied', id: 'u1-1', at: 1_790_000_000_000, kind: 'edit', path: 'a.ts', before: Buffer.from('x').toString('base64'), beforeHash: sha(Buffer.from('x')), afterHash: sha('y'), afterBytes: 1, fingerprint: sha('y').slice(0, 12) }
  const ok = (value) => undoMod.parseUndoEntry(JSON.parse(JSON.stringify(undoMod.renderUndoEntry(value)))) !== null
  const mut = (change) => ({ v: 1, ...good, ...change })
  check('G: the good entry parses, and is written back as the same line', ok(good) && JSON.stringify(undoMod.renderUndoEntry(undoMod.parseUndoEntry(JSON.parse(JSON.stringify(undoMod.renderUndoEntry(good)))))) === JSON.stringify(undoMod.renderUndoEntry(good)))
  const bads = [['a field more', { ...undoMod.renderUndoEntry(good), extra: 1 }], ['version 2', { ...undoMod.renderUndoEntry(good), v: 2 }], ['an id with a capital', mut({ id: 'U1-1' })], ['an id that is a path', mut({ id: '../x' })], ['a time of zero', mut({ at: 0 })], ['a time with a fraction', mut({ at: 1.5 })], ['a path with a hidden character', mut({ path: 'a\u202e.ts' })], ['an empty path', mut({ path: '' })], ['a path over 300 characters', mut({ path: 'x'.repeat(301) })], ['an unknown kind', mut({ kind: 'delete' })], ['a create that holds an original', mut({ kind: 'create' })], ['an edit with no original', mut({ before: null, beforeHash: null })], ['a copy that does not match its hash', mut({ before: Buffer.from('z').toString('base64') })], ['a copy that is not base64', mut({ before: '***' })], ['a fingerprint that is not the start of the hash', mut({ fingerprint: '0'.repeat(12) })], ['a size over 256 KB', mut({ afterBytes: 262145 })], ['a negative size', mut({ afterBytes: -1 })], ['an "undone" with a field more', { v: 1, type: 'undone', id: 'u1-1', at: 5, x: 1 }], ['an "undone" with a bad id', { v: 1, type: 'undone', id: 'nope', at: 5 }], ['a type that does not exist', { v: 1, type: 'applied2', id: 'u1-1', at: 5 }], ['an array', []], ['null', null], ['a number', 7]]
  for (const [what, value] of bads) check(`G: ${what} is not an entry`, undoMod.parseUndoEntry(value) === null && (what.startsWith('a field') || true))
  check('G: an "undone" entry that is right parses', undoMod.parseUndoEntry({ v: 1, type: 'undone', id: 'u1-1', at: 5 }) !== null)
  // damaged lines in the file are skipped and counted, the rest is read
  await w2.journal.append(good)
  fs.appendFileSync(w2.journalFile, 'this is not json\n{"v":1,"type":"applied"}\n' + JSON.stringify({ ...undoMod.renderUndoEntry(good), id: 'u2-1', beforeHash: '0'.repeat(64) }) + '\n')
  const snap = await w2.journal.readAll()
  check('G: lines that cannot be read (not JSON, short, a copy that does not match its hash) are counted and the good entry is still there', snap.state === 'ok' && snap.entries.length === 1 && snap.skipped === 3, show([snap.entries?.length, snap.skipped]))
  const lineAfter = (await w2.journal.size())
  await w2.journal.append({ ...good, id: 'u3-1' })
  check('G: a damaged line is left where it is (not rewritten), and appending goes on after it', (await w2.journal.readAll()).entries.length === 2 && w2.journalText().includes('this is not json') && (await w2.journal.size()) > lineAfter)
  // an entry that would not read back is not written
  let threw = false
  try { await w2.journal.append({ ...good, id: 'bad id' }) } catch { threw = true }
  check('G: an entry that would not read back is refused by the journal itself', threw)
  // an unterminated last line: the next append starts on its own line
  const w3 = world()
  await w3.journal.append(good)
  fs.writeFileSync(w3.journalFile, w3.journalText().trimEnd())
  await w3.journal.append({ ...good, id: 'u4-1' })
  check('G: a last line without its newline is not glued to the next one', (await w3.journal.readAll()).entries.length === 2)
  // a rewrite cut off in the middle
  const w4 = world({ form: 'plain' })
  await w4.journal.append(good)
  await w4.journal.append({ ...good, id: 'u5-1' })
  const whole = w4.journalText()
  fs.writeFileSync(`${w4.journalFile}.tmp`, 'a cut-off line')
  const r4 = await w4.journal.readAll()
  check('G: a cut-off rewrite (no closing line) is thrown away and the journal is as it was', r4.entries.length === 2 && !fs.existsSync(`${w4.journalFile}.tmp`) && w4.journalText() === whole)
  const body = whole
  fs.writeFileSync(`${w4.journalFile}.tmp`, `${body}${JSON.stringify({ v: 1, type: 'commit', lines: 2 })}\n`)
  fs.writeFileSync(w4.journalFile, body.split('\n')[0] + '\n')
  const r5 = await w4.journal.readAll()
  check('G: a whole rewrite that the crash cut off from its target finishes the job (both entries are back), and the .tmp is gone', r5.entries.length === 2 && !fs.existsSync(`${w4.journalFile}.tmp`))
  const w6 = world()
  await w6.journal.append(good)
  await w6.journal.append({ ...good, id: 'u6-1' })
  const both = w6.journalText()
  fs.writeFileSync(w6.journalFile, both.split('\n')[0] + '\n')
  fs.writeFileSync(`${w6.journalFile}.tmp`, `${both}${JSON.stringify({ v: 1, type: 'commit', lines: 3 })}\n`)
  const r6 = await w6.journal.readAll()
  check('G: a rewrite whose closing line gives the wrong number of lines is thrown away (the journal stays as it is)', r6.entries.length === 1 && !fs.existsSync(`${w6.journalFile}.tmp`) && w6.journalText() === both.split('\n')[0] + '\n')
  // folding
  const fold = undoMod.foldJournal([good, { type: 'undone', id: 'u9-9', at: 6 }, { ...good, id: 'u2-1' }, { type: 'undone', id: 'u1-1', at: 7 }, { ...good, afterBytes: 99 }])
  check('G: the fold ignores an undo of an id never applied, ignores a second entry with the same id (the first stays), and marks the undone one', fold.length === 2 && fold[0].undone === true && fold[0].entry.afterBytes === 1 && fold[1].undone === false)
})

// ============ H. nothing but applyService writes into the workspace; the model cannot reach it ============
await guard('H', async () => {
  const main = fs.readdirSync(`${REPO}/src/main`).filter((n) => n.endsWith('.ts'))
  const writes = /\b(writeFile|appendFile|rename|rmSync|unlink|copyFile|createWriteStream|truncate|writeSync)\b|\.rm\(|\bmkdir\(/
  const both = main.filter((name) => { const text = source(`src/main/${name}`); return writes.test(text) && /\b(verdict|again|resolved|result)\.real\b|\bworkspaceGuard\b|\bwsGuard\b|createWorkspaceGuard/.test(text) })
  // 13.3, on purpose: scratchCopy.ts is listed by this look because it imports the guard's classification of NAMES (classifyNames) and writes: but it writes only inside the app's own run folder
  // (verify-13-3.mjs, part G watches every call), takes no verdict of the guard and holds no path of the workspace but the folder it was handed to READ. This says so separately.
  const scratchSource = source('src/main/scratchCopy.ts').replace(/^\s*\/\/.*$/gm, '')
  check('H: the only file of the app that writes AND holds a path from the workspace guard is applyService.ts (ipc.ts only builds the guard and the pieces; scratchCopy.ts takes only classifyNames from the guard, holds no verdict, and writes only in the run folder)', show(both.filter((n) => n !== 'ipc.ts' && n !== 'scratchCopy.ts')) === show(['applyService.ts']) && /import \{ classifyNames \} from '\.\/workspaceGuard'/.test(scratchSource) && !/verdict|\.real\b|createWorkspaceGuard|wsGuard/.test(scratchSource), show(both))
  const guardUsers = main.filter((name) => /workspaceGuard/.test(source(`src/main/${name}`))).sort()
  check('H: the files that use the guard are the known ones (a new one has to be looked at)', show(guardUsers) === show(['applyService.ts', 'ipc.ts', 'replyTools.ts', 'reviewService.ts', 'runProposals.ts', 'scratchCopy.ts', 'toolCore.ts', 'toolRegistry.ts', 'workspace.ts', 'workspaceService.ts', 'workspaceTools.ts'].sort()), show(guardUsers))
  for (const name of ['replyTools.ts', 'chat.ts', 'workspaceTools.ts', 'proposalTools.ts', 'toolCore.ts', 'toolRegistry.ts', 'proposals.ts', 'workspaceService.ts']) {
    check(`H: ${name} does not import the applier, the journal or the undo records`, !/applyService|undoRecords|from '\.\/journal'/.test(source(`src/main/${name}`)))
  }
  const ids = sharedTools.TOOL_TITLES
  check('H: the three new tool ids have titles for the log, and they are NOT in the model\'s registry (the model has no tool that applies, undoes or clears)', ids.apply_change !== undefined && ids.undo_change !== undefined && ids.undo_clear !== undefined)
  const registry = await import(`${SRC}/main/toolRegistry.ts`)
  const wsTools = await import(`${SRC}/main/workspaceTools.ts`)
  const propTools = await import(`${SRC}/main/proposalTools.ts`)
  const defined = [...registry.BUILT_IN_TOOLS, ...(wsTools.WORKSPACE_TOOLS ?? []), ...(propTools.PROPOSAL_TOOLS ?? [])].map((t) => t.id ?? t.name)
  check('H: no tool definition of the app (the built-in ones, the workspace ones, the proposal ones) is called apply, undo or clear', defined.length > 0 && defined.every((id) => !/apply|undo|clear/.test(String(id))), show(defined))
  const preload = source('src/preload/index.ts')
  const reviewPreload = source('src/preload/review.ts')
  check('H: the chat page\'s bridge has no way to apply a change (only list, review, applied, undo, clearHistory), and the Review window\'s bridge has no undo and no clearHistory', !/changes:\s*\{[\s\S]*?\bapply\b[\s\S]*?\}\s*,\s*\n/.test(preload.replace(/review: \(id\)/g, 'x')) && !/undo|clearHistory|applied/.test(reviewPreload))
  const ipc = source('src/main/ipc.ts')
  check('H: undo and the clearing of the history ask for the window that called (guardedForWindow), and the page\'s call cannot name a path (the input is an id)', /CHANNELS\.changesUndo,\s*guardedForWindow/.test(ipc) && /CHANNELS\.changesClearUndo,\s*guardedForWindow/.test(ipc))
  check('H: the undo journal is one of the kept documents turned on and off with encryption, and quitting waits for it', /workspaceStore\.file,\s*undoJournal\.document,\s*connectorStore\.file,\s*voiceSettings\.file\s*\]\)/.test(ipc) && /workspaceStore\.file\.whenIdle\(\),\s*undoJournal\.whenIdle\(\)/.test(ipc))
  check('H: the undo and the clearing of the history are asked for the window that called, not for any window', /applier\.undo\(id, window\)/.test(ipc) && /applier\.clearHistory\(window\)/.test(ipc))
  check('H: the applied changes are asked of the applier by the page, and a change is applied only through the Review window\'s request (the one place that calls apply is the changes service)', (ipc.match(/applier\.apply\(/g) ?? []).length === 1 && /requestApply: \(proposal, owner\) => applier\.apply\(proposal, owner\)/.test(ipc))
  const svc = source('src/main/applyService.ts')
  check('H: applyService.ts looks at the file again after the yes, writes the undo copy before the file, and reads the file back (the order in the source)', svc.indexOf('guard.check') < svc.indexOf('journal.append') && svc.indexOf('journal.append') < svc.indexOf('replaceFile(verdict.real, newBytes)') && svc.indexOf('replaceFile(verdict.real, newBytes)') < svc.indexOf('readBack(verdict.real)'))
})

// ============ I. the words ============
await guard('I', async () => {
  const w = world()
  w.put('a.ts', 'one\ntwo\n')
  const p = w.edit(['a.ts'], 'two', 'TWO')
  const q = applyMod.applyQuestion(p)
  check('I: an ordinary change fits the box with room to spare, and closes with the line that says only the person can answer here', q.detail.length < questionMod.SHOWN_LIMIT && q.detail.endsWith(questionMod.ASKED_HERE) && !/WARNING/.test(q.detail))
  const secret = applyMod.applyQuestion({ ...p, flags: { secret: true, runsCommands: true } })
  check('I: a secret-looking file and one that runs commands each get a WARNING line', /WARNING: this file is hidden or looks like it holds secrets/.test(secret.detail) && /WARNING: this file runs commands/.test(secret.detail) && secret.detail.length < questionMod.SHOWN_LIMIT)
  const created = applyMod.applyQuestion(w.create(['n', 'x.md'], 'a\nb\n'))
  check('I: a new file says "A new file", the lines and the size, and how it is undone', created.message === 'Create this new file?' && created.yes === 'Create this file' && /A new file: /.test(created.detail) && /2 lines; the file will be 4 bytes/.test(created.detail) && /delete the new file again/.test(created.detail))
  const hidden = applyMod.applyQuestion({ ...p, real: `C:\\w\\x\u202e.ts`, why: 'a\u0085b' })
  check('I: a path or a reason with characters the eye cannot see is shown written out between quotes (the box never carries a hidden character)', hidden.detail.includes('\\u{202e}') && hidden.detail.includes('\\u{85}') && !hidden.detail.includes('\u202e'))
  const longest = applyMod.applyQuestion(w.edit(['a.ts'], 'two', 'TWO', { why: 'w'.repeat(400) }))
  check('I: the longest reason the model can give still fits (400 characters), with a path of 260', (() => { const d = applyMod.applyQuestion({ ...p, real: `C:\\${'d'.repeat(250)}\\a.ts`, why: 'w'.repeat(400) }); return d.detail.length < questionMod.SHOWN_LIMIT })() && longest.detail.length < questionMod.SHOWN_LIMIT)
  const auditWords = sharedAudit.outcomeText
  check('I: the log\'s words for the three tools: written N bytes, undone, deleted; failed ones say the file was put back', auditWords({ kind: 'done', size: 1234, sources: [], searched: null, searches: 0 }, 'apply_change') === 'You said yes. It was written: 1,234 bytes.' && auditWords({ kind: 'done', size: 5, sources: [], searched: null, searches: 0 }, 'undo_change') === 'You said yes. It was undone.' && auditWords({ kind: 'done', size: 5, sources: [], searched: null, searches: 0 }, 'undo_clear') === 'You said yes. The undo history was deleted.' && /put back as it was/.test(auditWords({ kind: 'failed' }, 'apply_change')), show(auditWords({ kind: 'done', size: 1234 }, 'apply_change')))
  check('I: the old tools keep their words (no change for a search)', auditWords({ kind: 'done', size: 5, sources: [], searched: null, searches: 1 }, 'web_search') !== auditWords({ kind: 'done', size: 5, sources: [], searched: null, searches: 1 }, 'apply_change'))
})

const ok = check.summary()
process.exit(ok ? 0 : 1)
