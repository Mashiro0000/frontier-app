// Slice 12.2 (D-042): THE CORE LEARNS THE WORKSPACE. What changed in the one place that decides (toolCore.ts), in the registry, in the reply's budget and in
// the record, proved with stand-in tools (nothing in the app has a workspace tool yet: 12.3 adds them), under plain Node, Windows only (the real workspace
// guard runs on a scratch folder with a junction in it).
//
//  - a tool may take a path in the WORKSPACE (judged by the workspace guard, which asks the data-folder guard as well) and a long text (`body`);
//  - a tool may be asked about by the REPLY: the first call opens one box for the whole reply, the calls after it run on that yes and are recorded as
//    covered, a no is kept for the rest of the reply, a file that is hidden or looks like it holds secrets is still asked about one at a time;
//  - file calls have their own count (30) and their own total of characters (200,000) beside the tool steps (5) of a web search, and the reply ends when one
//    is used up; the working time is shared;
//  - the new refusal codes and the "covered" answer are in the record, the log's reader, the audit view and the chat's notes;
//  - a call to web search is decided and recorded exactly as it was.
//
// Run: node tools/verify-12-2.mjs
import './ts-resolve.mjs'
import { checker } from './cdp.mjs'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import { win32 } from 'node:path'
import { REPO, REPO_URL } from './paths.mjs'

const check = checker()
const guard = async (name, fn) => { try { await fn() } catch (error) { check(`${name} did not run to its end: ${String(error?.stack ?? error).slice(0, 400)}`, false) } }
const show = (v) => JSON.stringify(v)?.slice(0, 300)
const SRC = `${REPO_URL}/src`
const regMod = await import(`${SRC}/main/toolRegistry.ts`)
const coreMod = await import(`${SRC}/main/toolCore.ts`)
const gateMod = await import(`${SRC}/main/systemQuestion.ts`)
const budgetMod = await import(`${SRC}/main/replyBudget.ts`)
const dataMod = await import(`${SRC}/main/dataFolderGuard.ts`)
const wsGuardMod = await import(`${SRC}/main/workspaceGuard.ts`)
const questionMod = await import(`${SRC}/main/toolQuestion.ts`)
const logMod = await import(`${SRC}/main/auditLog.ts`)
const sharedTools = await import(`${SRC}/shared/tools.ts`)
const sharedAudit = await import(`${SRC}/shared/audit.ts`)
const notesMod = await import(`${SRC}/shared/toolNotes.ts`)
const sharedWs = await import(`${SRC}/shared/workspace.ts`)
const J = win32.join
const logged = []
const realError = console.error
console.error = (...args) => { logged.push(args.map(String).join(' ')) }
const KEY = 'sk-ant-FAKE-KEY-for-the-checks-0123456789'

// ----- the scratch world -----
const ROOT = fs.realpathSync.native(fs.mkdtempSync(J(os.tmpdir(), 'frontier-122-')))
const DATA = J(ROOT, 'frontier-app')
const WS = J(ROOT, 'ws')
const OUT = J(ROOT, 'out')
const put = (base, rel, body) => { const full = J(base, rel); fs.mkdirSync(win32.dirname(full), { recursive: true }); fs.writeFileSync(full, body) }
put(DATA, 'memory.json', 'DATA-CANARY')
put(OUT, 'secret.txt', 'OUTSIDE-CANARY')
put(WS, 'notes.txt', 'POSITIVE-notes\nline two')
put(WS, 'src\\index.ts', 'POSITIVE-index')
put(WS, 'src\\other.ts', 'POSITIVE-other')
put(WS, '.env', 'SECRET-CANARY')
put(WS, 'secrets\\db.txt', 'SECRET-CANARY db')
put(WS, '.git\\config', 'GIT-CANARY')
put(WS, 'big.txt', 'y'.repeat(300 * 1024))
let hasLink = true
try { fs.symlinkSync(OUT, J(WS, 'link-out'), 'junction') } catch { hasLink = false }
let workspaceAtStart = null
process.on('exit', () => { try { fs.rmdirSync(J(WS, 'link-out')) } catch { /* not made */ } try { fs.rmSync(ROOT, { recursive: true, force: true }) } catch { /* left for the system */ } })
const treeHash = (dir) => {
  const h = createHash('sha256')
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) { const full = J(d, e.name); if (e.isDirectory()) { h.update(`D ${full}\n`); walk(full) } else if (e.isFile()) { h.update(`F ${full} ${fs.statSync(full).size}\n`); h.update(fs.readFileSync(full)) } else h.update(`? ${full}\n`) } }
  walk(dir)
  return h.digest('hex')
}
workspaceAtStart = treeHash(WS)

// ----- the stand-in tools (they do real work, but never write) -----
const P = (op) => ({ kind: 'workspace_path', label: 'Path', describe: 'a path in the workspace', op })
const BODY = (max) => ({ kind: 'body', label: 'Text', describe: 'some text', max })
const def = (id, args, extra = {}) => ({ id, title: id, noun: id, describe: `${id}.`, effect: `Does ${id}.`, yes: 'Do it', args, ask: 'reply', counts: 'file', ...extra })
const DEFS = [
  regMod.WEB_SEARCH,
  def('ws_list', { path: P('list') }),
  def('ws_read', { path: P('read') }),
  def('ws_edit', { path: P('edit'), find: BODY(20000), replace: BODY(20000) }),
  def('ws_create', { path: P('create'), content: BODY(100000) }),
  def('ws_each', { path: P('read') }, { ask: 'each' })
]
const tools = regMod.createToolRegistry(DEFS)

function makeRig(options = {}) {
  const clock = options.clock ?? { t: 1_000_000, mono: 0 }
  const asked = []
  const events = []
  const seen = { maxChars: [], args: [], again: [], affordable: 0 }
  const script = [...(options.script ?? [])]
  const gate = gateMod.createQuestionGate(async (owner, question, signal) => {
    asked.push(question)
    const next = script.length === 0 ? true : script.shift()
    return typeof next === 'function' ? next(question, signal) : next
  }, () => clock.t)
  const executors = {
    web_search: async () => ({ text: 'found', sources: [], searched: null, searches: 1 }),
    ws_list: async (args, ctx) => { seen.maxChars.push(ctx.maxChars); seen.args.push({ ...args }); return { text: fs.readdirSync(args.path).join('\n') } },
    ws_read: async (args, ctx) => { seen.maxChars.push(ctx.maxChars); seen.args.push({ ...args }); return { text: fs.readFileSync(args.path, 'utf8').slice(0, ctx.maxChars) } },
    ws_each: async (args, ctx) => { seen.maxChars.push(ctx.maxChars); seen.args.push({ ...args }); return { text: fs.readFileSync(args.path, 'utf8').slice(0, ctx.maxChars) } },
    ws_edit: async (args, ctx) => { seen.maxChars.push(ctx.maxChars); seen.args.push({ ...args }); seen.again.push(await ctx.again('path')); return { text: 'recorded' } },
    ws_create: async (args, ctx) => { seen.maxChars.push(ctx.maxChars); seen.args.push({ ...args }); return { text: 'recorded' } },
    ...(options.executors ?? {})
  }
  const questions = options.questions ?? {
    grant: (c) => ({ title: 'Files', message: 'Allow file access for this reply?', detail: `GRANT root=${questionMod.shown(c.root)} first=${c.paths.map((p) => questionMod.shown(p.verdict.rel.join('/'))).join(',')} tool=${c.tool.id}`, yes: 'Allow', no: "Don't allow" }),
    oneByOne: (c) => ({ title: 'One file', message: 'Allow this one file?', detail: `ONE file=${c.paths.map((p) => questionMod.shown(p.verdict.rel.join('/'))).join(',')} class=${c.paths.map((p) => p.verdict.fileClass).join(',')}`, yes: 'Allow', no: "Don't allow" })
  }
  const dataGuard = dataMod.createDataFolderGuard({ roots: () => [DATA] })
  const wsGuard = options.wsGuard ?? wsGuardMod.createWorkspaceGuard({ root: () => (options.root === undefined ? WS : options.root), dataGuard })
  const core = coreMod.createToolCore({
    tools,
    settings: () => ({ enabled: Object.fromEntries(tools.ids().filter((id) => !(options.off ?? []).includes(id)).map((id) => [id, true])), caps: { steps: 5, seconds: 60 } }),
    gate, guard: dataGuard,
    record: options.record ?? (async (event) => { events.push(structuredClone(event)) }),
    holdsSavedKey: options.holdsSavedKey ?? (async (text) => text.includes(KEY)),
    executors,
    ...(options.noWorkspace === true ? {} : { workspace: { guard: wsGuard, questions } }),
    now: () => clock.t,
    newId: (() => { let n = 0; return () => `c${++n}` })()
  })
  const budget = options.budget ?? budgetMod.createReplyBudget(options.caps, () => clock.mono)
  const ctl = new AbortController()
  const go = (tool, args, extra = {}) => core.run({ tool, args: { ...args, why: 'because' } }, { owner: null, signal: extra.signal ?? ctl.signal, budget, ...(extra.affordable === undefined ? {} : { affordable: extra.affordable }) })
  return { go, asked, events, seen, core, budget, ctl, clock, gate, wsGuard }
}
const kinds = (events, call) => events.filter((e) => e.call === call).map((e) => e.type === 'answered' ? `answered:${e.answer}` : e.type === 'refused' ? `refused:${e.code}` : e.type)

// ============ A. the registry ============
await guard('A', async () => {
  const wsDef = (extra = {}, args = { path: P('read') }) => ({ ...def('t_one', args), ...extra })
  const mk = (d) => () => regMod.createToolRegistry([d])
  const throwsWith = (fn, pattern) => { try { fn(); return false } catch (error) { return pattern.test(error.message) } }
  check('A: the stand-in workspace tools register, frozen, with their kinds', tools.ids().length === 6 && Object.isFrozen(tools.get('ws_edit')) && tools.get('ws_edit').args.find === undefined === false && tools.get('ws_edit').args.find.kind === 'body' && tools.get('ws_read').args.path.kind === 'workspace_path' && tools.get('ws_read').args.path.op === 'read')
  check('A: a tool says how it is asked about and what it counts as; web search keeps the defaults: asked each time, counted as a step', tools.get('web_search').ask === 'each' && tools.get('web_search').counts === 'step' && tools.get('ws_read').ask === 'reply' && tools.get('ws_read').counts === 'file' && tools.get('ws_each').ask === 'each' && tools.get('ws_each').counts === 'file')
  check('A: the built-in tool list is still only web search (12.3 adds the real workspace tools)', regMod.BUILT_IN_TOOLS.length === 1 && regMod.BUILT_IN_TOOLS[0].id === 'web_search')
  check('A: ask must be "each" or "reply"', throwsWith(mk(wsDef({ ask: 'sometimes' })), /ask must be/) && throwsWith(mk(wsDef({ ask: 1 })), /ask must be/) && throwsWith(mk(wsDef({ ask: null })), /ask must be/))
  check('A: counts must be "step" or "file"', throwsWith(mk(wsDef({ counts: 'many' })), /counts must be/) && throwsWith(mk(wsDef({ counts: 2 })), /counts must be/))
  check('A: only a tool with a workspace path may be asked about by the reply', throwsWith(mk({ ...regMod.WEB_SEARCH, ask: 'reply' }), /only a tool with a workspace path/))
  check('A: ...or counted as a file call', throwsWith(mk({ ...regMod.WEB_SEARCH, counts: 'file' }), /only a tool with a workspace path/))
  check('A: a long text can never be asked about in the box: a tool that takes one must be asked about by the reply', throwsWith(mk(wsDef({ ask: 'each' }, { path: P('edit'), text: BODY(500) })), /long text/))
  check('A: a long text with no workspace path is refused too (it is never asked about by the reply without one)', throwsWith(mk({ ...regMod.WEB_SEARCH, id: 'with_body', args: { text: BODY(100) } }), /long text|only a tool/))
  for (const [what, max] of [['0 characters', 0], ['100,001 characters', 100001], ['a fraction', 1.5], ['NaN', NaN], ['text', '5']]) check(`A: a long text of ${what} is refused`, throwsWith(mk(wsDef({}, { path: P('edit'), text: BODY(max) })), /limits that do not fit/))
  check('A: 100,000 characters is the most a long text may be, and it is registered (it is never shown in the box)', (() => { try { regMod.createToolRegistry([wsDef({}, { path: P('create'), text: BODY(100000) })]); return true } catch { return false } })())
  for (const op of ['delete', 'stat', 'write', 'x', undefined, 5]) check(`A: a workspace path with the operation ${show(op)} is refused`, throwsWith(mk(wsDef({}, { path: { ...P('read'), op } })), /what it does with the path/))
  check('A: a kind that does not exist is still refused', throwsWith(mk(wsDef({}, { path: { kind: 'secret_path', label: 'P', describe: 'x' } })), /does not exist/))
  check('A: a tool asked about call by call with a workspace path still has to fit the box (the worst case: a path of 300 characters)', (() => { try { regMod.createToolRegistry([wsDef({ ask: 'each' })]); return true } catch { return false } })())
  check('A: a tool asked about by the reply is not held to the box\'s size (its questions are made per call, and checked then)', (() => { try { regMod.createToolRegistry([wsDef({}, { path: P('edit'), a: BODY(100000), b: BODY(100000) })]); return true } catch { return false } })())
  check('A: the definition cannot carry ask or counts as anything but the two words (copied field by field, frozen)', Object.isFrozen(tools.get('ws_read')) && Object.keys(tools.get('ws_read')).sort().join() === 'args,ask,counts,describe,effect,id,noun,title,yes')
  const offered = Object.fromEntries(tools.ids().map((id) => [id, regMod.offeredTool(tools.get(id))]))
  check('A: a workspace path is offered to the model as a string of at most 300 characters; a long text as a string with its limits', offered.ws_read.parameters.properties.path.type === 'string' && offered.ws_read.parameters.properties.path.maxLength === 300 && offered.ws_edit.parameters.properties.find.maxLength === 20000 && offered.ws_edit.parameters.properties.find.minLength === 1 && offered.ws_edit.parameters.required.join() === 'path,find,replace,why' && offered.ws_edit.parameters.additionalProperties === false)
  const chk = (id, input) => regMod.checkArguments(tools.get(id), input)
  const okEdit = { path: 'src/index.ts', find: 'a\nb\r\n\tc', replace: 'x', why: 'w' }
  check('A: long text with line breaks and tabs is accepted as it is (nothing is changed in it)', chk('ws_edit', okEdit).ok && chk('ws_edit', okEdit).args.find === 'a\nb\r\n\tc')
  for (const [what, text] of [['a NUL', 'a\u0000b'], ['a bell', 'a\u0007'], ['an escape', '\u001b[31m'], ['a delete', 'a\u007f'], ['a form feed', 'a\u000c'], ['a lone high surrogate', 'a\ud800'], ['a lone low surrogate', '\udc00b'], ['nothing', ''], ['100,001 characters', 'x'.repeat(100001)]]) {
    check(`A: long text with ${what} is refused`, !chk('ws_edit', { ...okEdit, find: text }).ok && !chk('ws_create', { path: 'a', content: text, why: 'w' }).ok)
  }
  check('A: a long text of exactly its limit is accepted for the tool that allows 20,000 and refused one over', chk('ws_edit', { ...okEdit, find: 'x'.repeat(20000) }).ok && !chk('ws_edit', { ...okEdit, find: 'x'.repeat(20001) }).ok)
  check('A: Unicode in a long text is kept (accents, Devanagari, an emoji, a line separator that is not a control)', chk('ws_edit', { ...okEdit, find: 'café नमस्ते 😀  ' }).ok)
  check('A: a workspace path: text of 1 to 300 characters; nothing else', chk('ws_read', { path: 'a', why: 'w' }).ok && chk('ws_read', { path: 'a'.repeat(300), why: 'w' }).ok && !chk('ws_read', { path: 'a'.repeat(301), why: 'w' }).ok && !chk('ws_read', { path: '', why: 'w' }).ok && !chk('ws_read', { path: 5, why: 'w' }).ok && !chk('ws_read', { path: ['a'], why: 'w' }).ok && !chk('ws_read', { path: null, why: 'w' }).ok)
  check('A: an extra argument, a missing one, __proto__ are refused for the workspace tools too', !chk('ws_read', { path: 'a', why: 'w', extra: 1 }).ok && !chk('ws_edit', { path: 'a', find: 'b', why: 'w' }).ok && !chk('ws_read', JSON.parse('{"path":"a","why":"w","__proto__":{"x":1}}')).ok)
})

// ============ B. the reply's budget ============
await guard('B', async () => {
  const clock = { now: 0 }
  const make = (caps, files) => budgetMod.createReplyBudget(caps, () => clock.now, files)
  let b = make({ steps: 5, seconds: 60 })
  check('B: the defaults: 30 file calls and 200,000 characters of file text', b.fileCaps.calls === 30 && b.fileCaps.chars === 200000 && budgetMod.FILE_CAPS_DEFAULT.calls === sharedWs.WORKSPACE_LIMITS.maxFileCalls && Object.isFrozen(b.fileCaps))
  let answers = Array.from({ length: 31 }, () => b.takeFile())
  check('B: 30 file calls are allowed and the 31st is "file-cap", and it stays so', answers.slice(0, 30).every((a) => a === 'ok') && answers[30] === 'file-cap' && b.takeFile() === 'file-cap' && b.used().fileCalls === 30)
  check('B: file calls leave the tool steps alone, and the steps leave the file calls alone', b.take() === 'ok' && b.used().steps === 1 && (() => { const c = make({ steps: 1, seconds: 60 }); c.take(); return c.take() === 'step-cap' && c.takeFile() === 'ok' })())
  check('B: `calls` counts both kinds, in the order the calls came', (() => { const c = make({ steps: 5, seconds: 60 }); c.take(); c.takeFile(); c.takeFile(); c.take(); return c.used().calls === 4 && c.used().steps === 2 && c.used().fileCalls === 2 })())
  b = make({ steps: 5, seconds: 60 })
  check('B: characters are counted: all of them are left at the start, a use takes them away, and they never go below none', b.charsLeft() === 200000 && (b.useChars(150000), b.charsLeft() === 50000) && (b.useChars(100000), b.charsLeft() === 0) && b.used().chars === 250000)
  b = make({ steps: 5, seconds: 60 })
  b.useChars(-5); b.useChars(NaN); b.useChars(Infinity); b.useChars(2.9)
  check('B: a negative number, NaN and infinity count for nothing; a fraction is rounded down', b.used().chars === 2)
  check('B: other caps can be handed in (the checks use small ones)', (() => { const c = make({ steps: 5, seconds: 60 }, { calls: 2, chars: 10 }); return c.takeFile() === 'ok' && c.takeFile() === 'ok' && c.takeFile() === 'file-cap' && c.charsLeft() === 10 })())
  clock.now = 0
  b = make({ steps: 5, seconds: 10 })
  clock.now = 10_001
  check('B: the working time is shared: a file call is "time-cap" once the time is used', b.takeFile() === 'time-cap' && b.used().fileCalls === 0)
  clock.now = 0
  b = make({ steps: 5, seconds: 10 })
  b.pause(); clock.now = 60_000; b.resume()
  check('B: ...and the time the person spends in a box does not count for file calls either', b.takeFile() === 'ok')
  check('B: a reply\'s budget holds nothing about files in what the person can set (the caps are the tool caps only)', Object.keys(b.caps).sort().join() === 'seconds,steps')
})

// ============ C. the core: the reply's grant ============
await guard('C1', async () => {
  const r = makeRig()
  const first = await r.go('ws_list', { path: '.' })
  check('C: the first file call of a reply opens ONE box, the reply\'s, and the tool runs on the yes', first.kind === 'ran' && r.asked.length === 1 && /^GRANT root=/.test(r.asked[0].detail) && first.result.text.includes('notes.txt'), show(first))
  check('C: the box was made from the workspace as it really is, and the call as it was asked (the real root; the names below it)', r.asked[0].detail.includes(questionMod.shown(WS)) && r.asked[0].detail.includes('first=""') && r.asked[0].detail.includes('tool=ws_list'), r.asked[0].detail)
  check('C: its record: asked, answered yes, ran, result (the same four as for any call)', show(kinds(r.events, 'c1')) === show(['asked', 'answered:yes', 'ran', 'result']))
  const second = await r.go('ws_read', { path: 'notes.txt' })
  check('C: the next call runs with no question', second.kind === 'ran' && r.asked.length === 1 && second.result.text.startsWith('POSITIVE-notes'))
  check('C: ...and is recorded as shown and COVERED: asked (what it was), answered "covered", ran, result', show(kinds(r.events, 'c2')) === show(['asked', 'answered:covered', 'ran', 'result']))
  const asked2 = r.events.find((e) => e.call === 'c2' && e.type === 'asked')
  check('C: the record of the covered call holds its real arguments and its reason, as for any call', asked2.args.path.toLowerCase() === J(WS, 'notes.txt').toLowerCase() && asked2.why === 'because' && asked2.step === 2)
  check('C: the calls have their own ids and their own numbers (1, 2) in the reply\'s record', r.events.filter((e) => e.call === 'c1').every((e) => e.step === 1) && r.events.filter((e) => e.call === 'c2').every((e) => e.step === 2))
  const third = await r.go('ws_read', { path: 'src/index.ts' })
  check('C: a third call: still no question', third.kind === 'ran' && r.asked.length === 1 && show(kinds(r.events, 'c3')) === show(['asked', 'answered:covered', 'ran', 'result']))
  check('C: the tool is given the REAL path the guard handed back, never the words the model wrote', r.seen.args[1].path.toLowerCase() === J(WS, 'notes.txt').toLowerCase() && r.seen.args[2].path.toLowerCase() === J(WS, 'src', 'index.ts').toLowerCase() && r.seen.args[0].path.toLowerCase() === WS.toLowerCase())
  const r2 = makeRig()
  await r2.go('ws_read', { path: 'notes.txt' })
  check('C: a new reply (a new core) asks again: the grant ends with the reply', r2.asked.length === 1 && r.asked.length === 1)
  check('C: every event the core wrote is accepted by the log\'s own strict reader (the "covered" answer and the codes are in it)', [...r.events, ...r2.events].every((e) => logMod.parseAuditEvent(JSON.parse(logMod.auditLine(e))) !== null))
})

await guard('C2', async () => {
  // a no: kept for the rest of the reply
  const r = makeRig({ script: [false] })
  const first = await r.go('ws_list', { path: '.' })
  check('C: a no to the reply\'s file access: the call is "declined" with the fixed sentence, and nothing ran', first.kind === 'declined' && first.answer === 'no' && first.text === coreMod.DECLINED_TEXT.no && r.seen.args.length === 0)
  const second = await r.go('ws_read', { path: 'notes.txt' })
  check('C: ...and the next file call is refused as "grant-declined" with NO question (the person is not asked again and again)', second.kind === 'refused' && second.code === 'grant-declined' && second.text === coreMod.GRANT_DECLINED_TEXT && r.asked.length === 1)
  check('C: ...with its record: refused:grant-declined, and the first call asked and answered no', show(kinds(r.events, 'c2')) === show(['refused:grant-declined']) && show(kinds(r.events, 'c1')) === show(['asked', 'answered:no']))
  const third = await r.go('ws_edit', { path: 'notes.txt', find: 'a', replace: 'b' })
  check('C: ...also for a proposal, and for a file that is hidden (the person said no to all file access)', third.code === 'grant-declined' && (await r.go('ws_read', { path: '.env' })).code === 'grant-declined' && r.asked.length === 1)
  r.clock.t += 5000
  check('C: ...even after the quiet time (it is the reply\'s answer)', (await r.go('ws_read', { path: 'notes.txt' })).code === 'grant-declined' && r.asked.length === 1)
  check('C: a no to file access does not touch web search (a different kind of question): it is asked and runs', (await r.go('web_search', { query: 'rust news' })).kind === 'ran' && r.asked.length === 2)
  check('C: ...and a new reply may be asked again', await (async () => { const n = makeRig(); return (await n.go('ws_list', { path: '.' })).kind === 'ran' })())
})

await guard('C3', async () => {
  // answers that are not a yes and not a no are not remembered
  const hold = {}
  const r = makeRig({ script: [() => new Promise((resolve) => { hold.release = resolve })] })
  const first = r.go('ws_list', { path: '.' })
  await new Promise((resolve) => setTimeout(resolve, 20))
  const second = await r.go('ws_read', { path: 'notes.txt' })
  check('C: a call while the reply\'s question is open is "busy": not asked, not remembered, the call is "declined"', second.kind === 'declined' && second.answer === 'busy' && second.text === coreMod.DECLINED_TEXT.busy && r.asked.length === 1)
  hold.release(true)
  check('C: ...and the first call goes on to run on its yes', (await first).kind === 'ran')
  check('C: ...after which the next call is covered (the busy one did not spoil the grant)', (await r.go('ws_read', { path: 'notes.txt' })).kind === 'ran' && r.asked.length === 1)

  const q = makeRig({ script: [false, true] })
  await q.go('web_search', { query: 'something' }) // a no, to a different question: the box rests for 3 seconds
  const resting = await q.go('ws_list', { path: '.' })
  check('C: a file call within the quiet time after a NO to another question is "resting": not asked, not remembered', resting.kind === 'declined' && resting.answer === 'resting' && q.asked.length === 1)
  q.clock.t += 3500
  const later = await q.go('ws_list', { path: '.' })
  check('C: ...and asked again afterwards, and the yes then holds', later.kind === 'ran' && q.asked.length === 2 && (await q.go('ws_read', { path: 'notes.txt' })).kind === 'ran' && q.asked.length === 2)

  const f = makeRig({ script: [() => { throw new Error('the box could not be shown') }, true] })
  const failed = await f.go('ws_list', { path: '.' })
  check('C: a box that could not be shown is "failed": nothing ran, nothing remembered', failed.kind === 'declined' && failed.answer === 'failed' && f.seen.args.length === 0)
  check('C: ...and the next call asks again', (await f.go('ws_list', { path: '.' })).kind === 'ran' && f.asked.length === 2)

  const s = makeRig({ script: [(question, signal) => new Promise((resolve) => signal.addEventListener('abort', () => resolve(false), { once: true })), true] })
  const stopper = new AbortController()
  const stopped = s.go('ws_list', { path: '.' }, { signal: stopper.signal })
  await new Promise((resolve) => setTimeout(resolve, 20))
  stopper.abort()
  const stoppedOut = await stopped
  check('C: Stop everything while the reply\'s box is open: "declined", answer "stopped", the reply ends, nothing ran', stoppedOut.kind === 'declined' && stoppedOut.answer === 'stopped' && stoppedOut.endsReply === true && s.seen.args.length === 0 && show(kinds(s.events, 'c1')) === show(['asked', 'answered:stopped']))
  check('C: ...and a stop is not a no: nothing is kept, nothing rests (the next question can be asked at once)', (await s.go('ws_list', { path: '.' })).kind === 'ran' && s.asked.length === 2)

  const both = makeRig({ script: [(question, signal) => new Promise((resolve) => { setTimeout(() => { sControl.abort(); resolve(true) }, 10) })] })
  const sControl = new AbortController()
  const out = await both.go('ws_list', { path: '.' }, { signal: sControl.signal })
  check('C: a yes and a Stop at the same moment: Stop wins, and the grant is not kept', out.kind === 'declined' && out.answer === 'stopped' && both.seen.args.length === 0 && show(kinds(both.events, 'c1')) === show(['asked', 'answered:stopped']))
  const already = makeRig()
  already.ctl.abort()
  const before = await already.go('ws_list', { path: '.' })
  check('C: a call after Stop everything is refused as "stopped" before anything is looked at or asked', before.kind === 'refused' && before.code === 'stopped' && already.asked.length === 0 && before.endsReply === true)
})

await guard('C4', async () => {
  // one by one
  const r = makeRig()
  await r.go('ws_list', { path: '.' })
  const env = await r.go('ws_read', { path: '.env' })
  check('C: a hidden file is asked about ON ITS OWN even after the reply\'s yes, naming the file and its class, and runs on the yes', env.kind === 'ran' && r.asked.length === 2 && /^ONE file=".env" class=one-by-one/.test(r.asked[1].detail) && env.result.text.startsWith('SECRET-CANARY'), show(r.asked.map((a) => a.detail)))
  check('C: ...recorded as an ordinary yes (asked, answered yes), never as covered', show(kinds(r.events, 'c2')) === show(['asked', 'answered:yes', 'ran', 'result']))
  const again = await r.go('ws_read', { path: '.env' })
  check('C: ...and asked again for the same file the next time (nothing is remembered, there is no list)', again.kind === 'ran' && r.asked.length === 3)
  const dbf = await r.go('ws_read', { path: 'secrets/db.txt' })
  check('C: a file in a folder that looks like it holds secrets is one-by-one too', dbf.kind === 'ran' && r.asked.length === 4 && /file="secrets\/db.txt"/.test(r.asked[3].detail))
  const listSecrets = await r.go('ws_list', { path: 'secrets' })
  check('C: listing such a folder is one-by-one', listSecrets.kind === 'ran' && r.asked.length === 5 && /file="secrets"/.test(r.asked[4].detail))
  const plain = await r.go('ws_read', { path: 'notes.txt' })
  check('C: an ordinary file is still covered', plain.kind === 'ran' && r.asked.length === 5 && show(kinds(r.events, 'c6')) === show(['asked', 'answered:covered', 'ran', 'result']))

  const no = makeRig({ script: [true, false] })
  await no.go('ws_list', { path: '.' })
  const refusedEnv = await no.go('ws_read', { path: '.env' })
  check('C: a no to ONE file: the call is declined with the fixed sentence, nothing ran', refusedEnv.kind === 'declined' && refusedEnv.answer === 'no' && refusedEnv.text === coreMod.DECLINED_TEXT.no && !no.seen.args.some((a) => /\.env$/i.test(a.path)))
  no.clock.t += 3500
  check('C: ...and the reply\'s grant is untouched: the next ordinary file is covered', (await no.go('ws_read', { path: 'notes.txt' })).kind === 'ran' && no.asked.length === 2)

  const first = makeRig()
  const firstEnv = await first.go('ws_read', { path: '.env' })
  check('C: a hidden file as the FIRST call of a reply: two boxes in a row, the reply\'s and then the file\'s', firstEnv.kind === 'ran' && first.asked.length === 2 && /^GRANT/.test(first.asked[0].detail) && /^ONE/.test(first.asked[1].detail))
  check('C: ...its record: asked, yes, asked, yes, ran, result', show(kinds(first.events, 'c1')) === show(['asked', 'answered:yes', 'asked', 'answered:yes', 'ran', 'result']))
  const firstNo = makeRig({ script: [true, false] })
  const out = await firstNo.go('ws_read', { path: '.env' })
  check('C: ...and with a yes then a no the call is declined but the grant was given (the next ordinary file is covered)', out.kind === 'declined' && (await firstNo.go('ws_read', { path: 'notes.txt' })).kind === 'ran' && firstNo.asked.length === 2)
  const declinedAll = makeRig({ script: [false] })
  await declinedAll.go('ws_list', { path: '.' })
  const noFile = await declinedAll.go('ws_read', { path: '.env' })
  check('C: a hidden file after a no to file access is "grant-declined", not asked', noFile.code === 'grant-declined' && declinedAll.asked.length === 1)

  const proposal = makeRig()
  await proposal.go('ws_list', { path: '.' })
  const prop = await proposal.go('ws_create', { path: '.env.local', content: 'A=1' })
  check('C: a new hidden file (a proposal for one) is one-by-one too', prop.kind === 'ran' && proposal.asked.length === 2 && /file=".env.local"/.test(proposal.asked[1].detail))
  const never = makeRig()
  const gitFile = await never.go('ws_read', { path: '.git/config' })
  check('C: version-control internals are refused as "never" with no question at all (not even the reply\'s)', gitFile.kind === 'refused' && gitFile.code === 'never' && never.asked.length === 0 && gitFile.text === coreMod.DATA_FOLDER_TEXT && !JSON.stringify(gitFile).includes('git'))
  check('C: ...also for a new file there, and for listing it', (await never.go('ws_create', { path: '.git/hooks/pre-commit', content: 'x' })).code === 'never' && (await never.go('ws_list', { path: '.git' })).code === 'never' && never.asked.length === 0)
})

await guard('C5', async () => {
  const text = (path) => path
  const r = makeRig()
  const code = async (tool, args) => { const out = await r.go(tool, args); return out.kind === 'refused' ? out : null }
  const outside = await code('ws_read', { path: '..\\out\\secret.txt' })
  check('C: a path that leaves the workspace is refused as "outside" with a fixed sentence, no question', outside.code === 'outside' && outside.text === coreMod.DATA_FOLDER_TEXT && r.asked.length === 0 && !outside.text.includes('secret'))
  const absolute = await code('ws_read', { path: J(WS, 'notes.txt') })
  check('C: an absolute path is "bad-path", even one that points inside', absolute.code === 'bad-path' && absolute.text === coreMod.BAD_PATH_TEXT && r.asked.length === 0)
  if (hasLink) {
    const link = await code('ws_read', { path: 'link-out\\secret.txt' })
    check('C: a path through a junction is "link"', link.code === 'link' && link.text === coreMod.DATA_FOLDER_TEXT && r.asked.length === 0)
  }
  const missing = await code('ws_read', { path: 'nothing-here.txt' })
  check('C: a file that is not there is "wrong-path" (the same sentence for a file where a folder was needed, and for a folder where a file was needed)', missing.code === 'wrong-path' && missing.text === coreMod.WRONG_PATH_TEXT && (await code('ws_read', { path: 'src' })).code === 'wrong-path' && (await code('ws_list', { path: 'notes.txt' })).code === 'wrong-path' && (await code('ws_create', { path: 'notes.txt', content: 'x' })).code === 'wrong-path')
  check('C: nothing the model wrote comes back in any refusal sentence', [outside, absolute, missing].every((o) => !o.text.includes('nothing-here') && !o.text.includes('out') && !o.text.includes(WS)))
  check('C: a path in the data folder named from the workspace is refused as "outside" (it is not below the workspace)', (await code('ws_read', { path: '..\\frontier-app\\memory.json' })).code === 'outside')
  check('C: each of these was recorded as a refusal, with its code, and never asked', r.events.filter((e) => e.type === 'refused').length >= 5 && r.events.every((e) => e.type === 'refused'))
  const none = makeRig({ root: null })
  const noWs = await none.go('ws_read', { path: 'notes.txt' })
  check('C: with no workspace chosen: "no-workspace", no question', noWs.kind === 'refused' && noWs.code === 'no-workspace' && noWs.text === coreMod.NO_WORKSPACE_TEXT && none.asked.length === 0)
  const gone = makeRig({ root: J(ROOT, 'was-here') })
  check('C: a workspace that has gone: the same', (await gone.go('ws_read', { path: 'notes.txt' })).code === 'no-workspace')
  const absent = makeRig({ noWorkspace: true })
  check('C: a core with no workspace given: a call with a workspace path is "no-workspace" (nothing is guessed)', (await absent.go('ws_read', { path: 'notes.txt' })).code === 'no-workspace' && absent.asked.length === 0)
  const off = makeRig({ off: ['ws_read'] })
  check('C: a tool that is switched off is refused as "tool-off" before any path is looked at', (await off.go('ws_read', { path: '.git/config' })).code === 'tool-off' && off.asked.length === 0)
  const spy = { calls: 0 }
  const spied = makeRig({ wsGuard: { check: async () => { spy.calls++; return { ok: false, code: 'outside', why: 'x' } }, root: async () => ({ ok: true, real: WS, name: 'ws' }) }, off: ['ws_read'] })
  await spied.go('ws_read', { path: 'a' })
  check('C: ...and the workspace guard was not even asked', spy.calls === 0)
  check('C: a guard that THROWS is a refusal ("internal"), the core never throws', await (async () => { const t = makeRig({ wsGuard: { check: async () => { throw new Error('boom') }, root: async () => ({ ok: true, real: WS, name: 'ws' }) } }); const out = await t.go('ws_read', { path: 'notes.txt' }); return out.kind === 'refused' && out.code === 'internal' })())
  check('C: a guard that answers with a code this version does not know is "bad-path"', await (async () => { const t = makeRig({ wsGuard: { check: async () => ({ ok: false, code: 'something-new', why: 'x' }), root: async () => ({ ok: true, real: WS, name: 'ws' }) } }); return (await t.go('ws_read', { path: 'notes.txt' })).code === 'bad-path' })())
  void text
})

await guard('C6', async () => {
  // the saved key, the long text, nothing written
  const r = makeRig()
  const before = treeHash(WS)
  const ok = await r.go('ws_edit', { path: 'notes.txt', find: 'line one\nline "two"\r\n\tthree', replace: 'new\ntext' })
  check('C: a long text reaches the tool exactly as sent, line breaks and tabs and quotes in it', ok.kind === 'ran' && r.seen.args[0].find === 'line one\nline "two"\r\n\tthree' && r.seen.args[0].replace === 'new\ntext' && r.seen.args[0].path.toLowerCase() === J(WS, 'notes.txt').toLowerCase())
  check('C: ...a proposal is covered by the reply\'s yes like a read, and recorded as such', r.asked.length === 1 && /^GRANT/.test(r.asked[0].detail) && /tool=ws_edit/.test(r.asked[0].detail))
  const created = await r.go('ws_create', { path: 'src/new/file.ts', content: 'x'.repeat(100000) })
  check('C: a new file of 100,000 characters in folders that are not there yet: runs (the stand-in only records it)', created.kind === 'ran' && r.seen.args[1].content.length === 100000 && r.seen.args[1].path.toLowerCase() === J(WS, 'src', 'new', 'file.ts').toLowerCase())
  check('C: the long text is NOT in the record: for a long text the log holds only how long it is, beside the path and the reason (never the text of a file or of a change)', (() => { const asked = r.events.filter((e) => e.type === 'asked'); const findText = 'line one\nline "two"\r\n\tthree'; return asked[0].args.find === `(${findText.length} characters)` && asked[0].args.replace === '(8 characters)' && asked[1].args.content === '(100000 characters)' && typeof asked[0].args.path === 'string' && !JSON.stringify(r.events).includes('line one') && !JSON.stringify(r.events).includes('xxxxxxxx') })())
  check('C: nothing was written to the workspace by any of it', treeHash(WS) === before)
  const key1 = await r.go('ws_edit', { path: 'notes.txt', find: `a ${KEY} b`, replace: 'x' })
  const key2 = await r.go('ws_edit', { path: 'notes.txt', find: 'a', replace: `has ${KEY}` })
  const key3 = await r.go('ws_read', { path: `${KEY}.txt` })
  check('C: a saved API key in a long text or in a path is refused as "secret" before anything is asked', key1.code === 'secret' && key2.code === 'secret' && key3.code === 'secret' && r.asked.length === 1)
  const broken = makeRig({ holdsSavedKey: async () => { throw new Error('no look') } })
  check('C: if the look for a key cannot be made, the call is refused', (await broken.go('ws_read', { path: 'notes.txt' })).code === 'secret' && broken.asked.length === 0)
  check('C: the hidden-file box and the reply\'s box are not built for a refused call (the question hooks were not asked)', await (async () => { let calls = 0; const q = makeRig({ questions: { grant: () => { calls++; return { title: 't', message: 'm', detail: 'd', yes: 'y', no: 'n' } }, oneByOne: () => { calls++; return { title: 't', message: 'm', detail: 'd', yes: 'y', no: 'n' } } } }); await q.go('ws_read', { path: '..\\x' }); await q.go('ws_read', { path: `${KEY}` }); return calls === 0 })())
})

await guard('C7', async () => {
  // looked at again just before use
  const r = makeRig()
  await r.go('ws_list', { path: '.' })
  fs.mkdirSync(J(WS, 'swap'), { recursive: true }); put(WS, 'swap\\victim.txt', 'ORIGINAL')
  const out = await r.go('ws_edit', { path: 'swap/victim.txt', find: 'a', replace: 'b' })
  check('C: the executor can look at a workspace argument AGAIN, and the answer is the guard\'s: ok for an unchanged file', out.kind === 'ran' && r.seen.again[0].ok === true && r.seen.again[0].fileClass === 'ok')
  const swapped = makeRig({ executors: { ws_edit: async (args, ctx) => {
    // another program swaps the folder for a junction between the first look and the use
    fs.rmSync(J(WS, 'swap'), { recursive: true, force: true })
    if (hasLink) fs.symlinkSync(OUT, J(WS, 'swap'), 'junction')
    const verdict = await ctx.again('path')
    return { text: hasLink ? (verdict.ok ? 'NOT-CAUGHT' : `refused:${verdict.code}`) : 'no-link' }
  } } })
  put(WS, 'swap\\victim.txt', 'ORIGINAL')
  await swapped.go('ws_list', { path: '.' })
  const res = await swapped.go('ws_edit', { path: 'swap/victim.txt', find: 'a', replace: 'b' })
  try { fs.rmdirSync(J(WS, 'swap')) } catch { /* removed below */ }
  fs.rmSync(J(WS, 'swap'), { recursive: true, force: true })
  if (hasLink) check('C: a folder swapped for a junction after the first look is refused by the second look ("link")', res.kind === 'ran' && res.result.text === 'refused:link', show(res))
  check('C: `again` refuses an argument that is not a workspace path, and a name that is not an argument', await (async () => { let v1, v2; const t = makeRig({ executors: { ws_read: async (args, ctx) => { v1 = await ctx.again('nothing'); v2 = await ctx.again('__proto__'); return { text: 'x' } } } }); await t.go('ws_read', { path: 'notes.txt' }); return v1.ok === false && v2.ok === false })())
  check('C: the data was never reached (the canary of the data folder is where it was)', fs.readFileSync(J(DATA, 'memory.json'), 'utf8') === 'DATA-CANARY' && fs.readFileSync(J(OUT, 'secret.txt'), 'utf8') === 'OUTSIDE-CANARY')
})

await guard('C8', async () => {
  // asked about call by call
  const r = makeRig()
  const a = await r.go('ws_each', { path: 'notes.txt' })
  const b = await r.go('ws_each', { path: 'src/index.ts' })
  check('C: a tool that is asked about call by call (ask "each") still asks every time, and never uses the reply\'s box', a.kind === 'ran' && b.kind === 'ran' && r.asked.length === 2 && r.asked.every((q) => q.title === 'ws_each' && q.message === 'Allow this ws_each?'))
  check('C: ...in the old words (approvalQuestion), with the real path in quotes', r.asked[0].detail.includes(`Path: ${questionMod.shown(J(WS, 'notes.txt').replace(/^(.)/, (m) => m))}`) || r.asked[0].detail.toLowerCase().includes(questionMod.shown(J(WS, 'notes.txt')).toLowerCase()), r.asked[0].detail.slice(0, 200))
  check('C: ...recorded as asked, answered yes, ran, result: no "covered" anywhere', kinds(r.events, 'c1').join() === 'asked,answered:yes,ran,result' && !r.events.some((e) => e.answer === 'covered'))
  check('C: ...and a hidden file asked about call by call is asked once (the call\'s own box, not two)', await (async () => { const t = makeRig(); const o = await t.go('ws_each', { path: '.env' }); return o.kind === 'ran' && t.asked.length === 1 })())
  const web = makeRig()
  const out = await web.go('web_search', { query: 'rust news' }, { affordable: async () => { web.seen.affordable++; return true } })
  const direct = questionMod.approvalQuestion(tools.get('web_search'), { query: 'rust news' }, 'because', { step: 1, steps: 5 })
  check('C: web search is decided exactly as it was: the same question, the same four events, step 1', out.kind === 'ran' && web.asked.length === 1 && show(web.asked[0]) === show(direct) && kinds(web.events, 'c1').join() === 'asked,answered:yes,ran,result' && web.events.every((e) => e.step === 1))
  check('C: ...and the spending look is made for a search and not for a file call', web.seen.affordable === 1 && await (async () => { const t = makeRig(); let looked = 0; await t.go('ws_read', { path: 'notes.txt' }, { affordable: async () => { looked++; return false } }); return looked === 0 })())
})

await guard('D', async () => {
  // the caps
  const files = makeRig()
  await files.go('ws_list', { path: '.' })
  let last
  for (let i = 0; i < 29; i++) last = await files.go('ws_read', { path: 'notes.txt' })
  check('D: 30 file calls are allowed in a reply (the first was the list)', last.kind === 'ran' && files.budget.used().fileCalls === 30)
  const cap = await files.go('ws_read', { path: 'notes.txt' })
  check('D: the 31st is refused as "file-cap", with its sentence, and it ENDS the reply', cap.kind === 'refused' && cap.code === 'file-cap' && cap.text === coreMod.fileCapText(30) && cap.endsReply === true)
  check('D: ...web search is still allowed (its five tool steps are untouched by 30 file calls)', (await files.go('web_search', { query: 'still allowed' })).kind === 'ran' && files.budget.used().steps === 1)
  const web = makeRig()
  for (let i = 0; i < 5; i++) await web.go('web_search', { query: `search ${i}` })
  const stepCap = await web.go('web_search', { query: 'one more' })
  check('D: five searches use up the five tool steps and the sixth is "step-cap", which ends the reply, as before', stepCap.code === 'step-cap' && stepCap.endsReply === true && stepCap.text === coreMod.stepCapText(5))
  check('D: ...and file calls are still allowed after that (the steps are not theirs)', (await web.go('ws_list', { path: '.' })).kind === 'ran')
  check('D: the call numbers in the record run on across both kinds (search 1..5, the refused one shows the cap, 5, as it always did, the list 6)', web.events.filter((e) => e.type === 'asked').map((e) => e.step).join() === '1,2,3,4,5,6' && web.events.find((e) => e.type === 'refused').step === 5)
  const bad = makeRig()
  for (let i = 0; i < 30; i++) await bad.go('ws_read', { path: `..\\out${i}` })
  const stopped = await bad.go('ws_read', { path: 'notes.txt' })
  check('D: calls that are REFUSED count as file calls: a model that keeps asking for something that is not allowed is stopped by the same cap', stopped.code === 'file-cap' && bad.asked.length === 0)
  check('D: a call to a tool that does not exist is a tool step, not a file call', await (async () => { const t = makeRig(); const o = await t.go('no_such_tool', {}); return o.code === 'unknown-tool' && t.budget.used().steps === 1 && t.budget.used().fileCalls === 0 })())

  // characters
  const c = makeRig()
  const got = []
  for (let i = 0; i < 4; i++) { const o = await c.go('ws_read', { path: 'big.txt' }); got.push(o.kind === 'ran' ? o.result.text.length : o.code) }
  check('D: the file text of a reply is counted: each read is given what is left (60,000 at most), so the total is 200,000 and no more', show(c.seen.maxChars) === show([60000, 60000, 60000, 20000]) && show(got) === show([60000, 60000, 60000, 20000]) && c.budget.used().chars === 200000, show([c.seen.maxChars, got]))
  const over = await c.go('ws_read', { path: 'notes.txt' })
  check('D: when it is all used, the next read is "chars-cap" and ends the reply', over.code === 'chars-cap' && over.endsReply === true && over.text === coreMod.CHARS_CAP_TEXT && (await c.go('ws_list', { path: '.' })).code === 'chars-cap')
  check('D: ...but a proposal, which brings no file text back, is still allowed', (await c.go('ws_edit', { path: 'notes.txt', find: 'a', replace: 'b' })).kind === 'ran')
  check('D: a result is cut at 60,000 characters by the core whatever the tool brought (the core\'s own cap)', await (async () => { const t = makeRig({ executors: { ws_read: async () => ({ text: 'z'.repeat(150000) }) } }); const o = await t.go('ws_read', { path: 'notes.txt' }); return o.kind === 'ran' && o.result.text.length < 60200 && o.result.text.includes('cut') })())
  check('D: a call that returns less counts only what it returned', await (async () => { const t = makeRig(); await t.go('ws_read', { path: 'notes.txt' }); return t.budget.used().chars === 'POSITIVE-notes\nline two'.length })())
  check('D: the characters a tool is told it may return are never more than the core would pass on', makeRig().seen.maxChars.length === 0 && (await (async () => { const t = makeRig(); await t.go('ws_read', { path: 'notes.txt' }); return t.seen.maxChars[0] === 60000 })()))

  // time and stop
  const clock = { t: 1_000_000, mono: 0 }
  const timed = makeRig({ clock, caps: { steps: 5, seconds: 10 } })
  await timed.go('ws_list', { path: '.' })
  clock.mono = 10_001
  const late = await timed.go('ws_read', { path: 'notes.txt' })
  check('D: the working time is shared: a file call after the time is used is "time-cap" and ends the reply', late.code === 'time-cap' && late.endsReply === true)
  const running = makeRig({ executors: { ws_read: (args, ctx) => new Promise((resolve, reject) => ctx.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })) } })
  await running.go('ws_list', { path: '.' })
  const long = running.go('ws_read', { path: 'notes.txt' })
  await new Promise((resolve) => setTimeout(resolve, 20))
  running.ctl.abort()
  const stoppedRun = await long
  check('D: Stop everything while a file call runs ends it: "failed" with the code "stopped", and the reply ends', stoppedRun.kind === 'failed' && stoppedRun.code === 'stopped' && stoppedRun.endsReply === true)
})

await guard('E', async () => {
  // the record
  const failing = { n: 0 }
  const askedFirst = makeRig({ record: async () => { throw new Error('disk full') } })
  const refused = await askedFirst.go('ws_list', { path: '.' })
  check('E: if the record cannot be kept, the reply\'s question is not asked and nothing runs ("not-recorded")', refused.code === 'not-recorded' && askedFirst.asked.length === 0 && askedFirst.seen.args.length === 0)
  let n = 0
  const half = makeRig({ record: async (event) => { n++; if (event.type === 'answered' && event.answer === 'yes') throw new Error('disk full'); half.events.push(event) } })
  const out = await half.go('ws_list', { path: '.' })
  check('E: if the yes cannot be recorded, nothing runs, and the grant is NOT kept (the next call asks again)', out.code === 'not-recorded' && half.seen.args.length === 0)
  const again = await half.go('ws_list', { path: '.' })
  check('E: ...(asked again, and refused again for the same reason)', again.code === 'not-recorded' && half.asked.length === 2)
  const coveredFails = makeRig({ record: async (event) => { if (event.type === 'answered' && event.answer === 'covered') throw new Error('disk full'); coveredFails.events.push(event) } })
  await coveredFails.go('ws_list', { path: '.' })
  const covered = await coveredFails.go('ws_read', { path: 'notes.txt' })
  check('E: if a covered call cannot be recorded as covered, it does not run', covered.code === 'not-recorded' && coveredFails.seen.args.length === 1 && coveredFails.asked.length === 1)
  const tooLong = makeRig({ questions: { grant: () => ({ title: 't', message: 'm', detail: 'x'.repeat(2001), yes: 'y', no: 'n' }), oneByOne: () => ({ title: 't', message: 'm', detail: 'x'.repeat(2001), yes: 'y', no: 'n' }) } })
  const long = await tooLong.go('ws_list', { path: '.' })
  check('E: a question that would not fit the box is never shortened: the call is refused ("bad-arguments"), nothing is asked or recorded as asked', long.code === 'bad-arguments' && long.text === coreMod.TOO_LONG_TEXT && tooLong.asked.length === 0 && tooLong.events.every((e) => e.type === 'refused'))
  const exactly = makeRig({ questions: { grant: () => ({ title: 't', message: 'm', detail: 'x'.repeat(2000), yes: 'y', no: 'n' }), oneByOne: () => ({ title: 't', message: 'm', detail: 'x', yes: 'y', no: 'n' }) } })
  check('E: ...2,000 characters exactly is the most that fits', (await exactly.go('ws_list', { path: '.' })).kind === 'ran')
  const longOne = makeRig({ questions: { grant: () => ({ title: 't', message: 'm', detail: 'g', yes: 'y', no: 'n' }), oneByOne: () => ({ title: 't', message: 'm', detail: 'x'.repeat(2001), yes: 'y', no: 'n' }) } })
  check('E: the same for the question about one file', (await longOne.go('ws_read', { path: '.env' })).code === 'bad-arguments')
  const throwing = makeRig({ questions: { grant: () => { throw new Error('words failed') }, oneByOne: () => { throw new Error('words failed') } } })
  const thrown = await throwing.go('ws_list', { path: '.' })
  check('E: words that cannot be made are a refusal ("internal"), never a thrown error, and nothing was asked', thrown.kind === 'refused' && thrown.code === 'internal' && throwing.asked.length === 0)
  const frozen = makeRig({ questions: { grant: (c) => { try { c.args.path = 'x' } catch { /* frozen */ } return { title: 't', message: 'm', detail: Object.isFrozen(c.args) ? 'frozen' : 'not frozen', yes: 'y', no: 'n' } }, oneByOne: () => ({ title: 't', message: 'm', detail: 'x', yes: 'y', no: 'n' }) } })
  await frozen.go('ws_list', { path: '.' })
  check('E: the call as the question hooks see it cannot be changed by them (the arguments are frozen)', frozen.asked[0]?.detail === 'frozen')
  void failing; void n
})

await guard('F', async () => {
  // the view of the log and the chat's notes
  const r = makeRig()
  await r.go('ws_list', { path: '.' })
  await r.go('ws_read', { path: 'notes.txt' })
  await r.go('ws_read', { path: '.env' })
  await r.go('ws_read', { path: '.git/config' })
  const calls = sharedAudit.groupCalls(r.events)
  check('F: the log\'s calls: the first is an ordinary yes, the second is covered, the hidden file is an ordinary yes again, the refusal is a refusal', calls.length === 4 && calls[0].outcome.kind === 'done' && calls[0].outcome.covered === undefined && calls[1].outcome.kind === 'done' && calls[1].outcome.covered === true && calls[2].outcome.kind === 'done' && calls[2].outcome.covered === undefined && calls[3].outcome.kind === 'refused' && calls[3].outcome.code === 'never', show(calls.map((c) => c.outcome)))
  const failing = makeRig({ executors: { ws_read: async () => { throw new Error('disk error') } } })
  await failing.go('ws_list', { path: '.' })
  const failedOut = await failing.go('ws_read', { path: 'notes.txt' })
  const failedCalls = sharedAudit.groupCalls(failing.events)
  check('F: a covered call whose tool failed is "failed" with the covered mark, and the first (asked) call that ran is not covered', failedOut.kind === 'failed' && failedCalls[1].outcome.kind === 'failed' && failedCalls[1].outcome.covered === true && failedCalls[0].outcome.covered === undefined, show(failedCalls.map((c) => c.outcome)))
  check('F: the sentence of a covered call says who allowed it, and a refusal has its own', sharedAudit.outcomeText(calls[1].outcome) === `Allowed by your yes for this reply. It ran: ${calls[1].outcome.size} characters came back.` && /^Refused: .+\.$/.test(sharedAudit.outcomeText(calls[3].outcome)) && sharedAudit.outcomeText(calls[0].outcome).startsWith('You said yes. It ran'))
  check('F: every refusal code, new ones included, has a sentence of the form "Refused: ...", and the covered ones of the three open states do too', sharedTools.REFUSAL_CODES.every((code) => /^Refused: .+\.$/.test(sharedAudit.outcomeText({ kind: 'refused', code }))) && ['failed', 'running'].every((kind) => /^Allowed by your yes for this reply\./.test(sharedAudit.outcomeText({ kind, covered: true }))))
  // (13.4 added six codes after these eight, on purpose: no-program, no-box, run-cap, run-time-cap, run-declined, copy-refused)
  check('F: the codes of 12.2 are all there, in this order, followed by the six of 13.4 at the end', sharedTools.REFUSAL_CODES.slice(-14, -6).join() === 'no-workspace,outside,link,never,wrong-path,file-cap,chars-cap,grant-declined' && sharedTools.REFUSAL_CODES.slice(-6).join() === 'no-program,no-box,run-cap,run-time-cap,run-declined,copy-refused' && sharedTools.ANSWER_CODES.at(-1) === 'covered')
  check('F: a call asked about and a covered call that never ran is "running", with the covered mark', (() => { const ev = r.events.filter((e) => e.call === 'c2' && e.type !== 'result' && e.type !== 'ran'); return sharedAudit.groupCalls(ev)[0].outcome.kind === 'running' && sharedAudit.groupCalls(ev)[0].outcome.covered === true })())
  const notes = notesMod.notesOf(r.events, new Map([['c1', 0], ['c2', 1], ['c3', 2], ['c4', 3]]))
  check('F: the chat\'s words for a covered call', notesMod.noteOutcomeText(notes[1].outcome, false).startsWith('Allowed for this reply.') && notesMod.noteOutcomeText({ kind: 'failed', covered: true }, false).startsWith('Allowed for this reply.') && notesMod.noteOutcomeText({ kind: 'running', covered: true }, true) === 'Working on it...' && /^Allowed for this reply\. No end/.test(notesMod.noteOutcomeText({ kind: 'running', covered: true }, false)))
  const settled = notesMod.settleNotes([{ ...notes[0], outcome: { kind: 'running', covered: true } }, { ...notes[0], outcome: { kind: 'running' } }], true)
  check('F: a stopped reply settles an open covered call as failed, keeping the covered mark', show(settled[0].outcome) === '{"kind":"failed","covered":true}' && show(settled[1].outcome) === '{"kind":"failed"}')
  const kept = (outcome) => notesMod.checkToolNotes([{ id: 'c1', tool: 'ws_read', title: 'ws_read', step: 1, at: 1, args: { path: 'a' }, why: 'w', outcome, offset: 0 }], 10)
  check('F: a saved note with a covered outcome is accepted (done, failed, running), and read back as itself', kept({ kind: 'done', size: 5, sources: [], covered: true })?.[0].outcome.covered === true && kept({ kind: 'failed', covered: true })?.[0].outcome.covered === true && kept({ kind: 'running', covered: true }) !== null && kept({ kind: 'done', size: 5, sources: [] })?.[0].outcome.covered === undefined)
  check('F: ...and a covered mark that is not exactly true, or on any other outcome, makes the note unreadable', kept({ kind: 'done', size: 5, sources: [], covered: false }) === null && kept({ kind: 'done', size: 5, sources: [], covered: 'yes' }) === null && kept({ kind: 'refused', code: 'never', covered: true }) === null && kept({ kind: 'declined', answer: 'no', covered: true }) === null && kept({ kind: 'unanswered', covered: true }) === null && kept({ kind: 'failed', covered: 1 }) === null)
  check('F: a saved note that says it was declined with the answer "covered" is unreadable (covered is a yes)', kept({ kind: 'declined', answer: 'covered' }) === null)
  check('F: a saved refusal with each new code is accepted', ['no-workspace', 'outside', 'link', 'never', 'wrong-path', 'file-cap', 'chars-cap', 'grant-declined'].every((code) => kept({ kind: 'refused', code }) !== null))
})

await guard('G', async () => {
  const dir = `${REPO}/src/main`
  const source = (f) => fs.readFileSync(`${dir}/${f}`, 'utf8')
  const code = (s) => s.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')
  check('G: the core imports the workspace guard as a TYPE only (it is handed one; it makes none and opens no file)', /import type \{ WorkspaceGuard, WorkspaceVerdict \} from '\.\/workspaceGuard'/.test(source('toolCore.ts')) && !/from 'fs'/.test(source('toolCore.ts')))
  check('G: the core has no file, network, process or shell call in it', !/\b(fetch\s*\(|child_process|node:fs|readFile|writeFile|openExternal|electron)/.test(code(source('toolCore.ts'))))
  const users = fs.readdirSync(dir).filter((f) => f.endsWith('.ts') && !['workspaceGuard.ts', 'workspace.ts', 'toolCore.ts'].includes(f) && /from '\.\/workspace(Guard)?'/.test(source(f)))
  // 13.3 again, on purpose: the scratch copy takes the guard's classification of NAMES (classifyNames), so that a copy for a run leaves out what the Stage 12 tools would not show.
  check("G: only the wiring, the reply's tools, the workspace service, the read tools and (13.3) the scratch copy and (13.5) what a run brings back import the workspace guard or the choice of the folder (12.3 wired them in)", users.sort().join() === 'applyService.ts,ipc.ts,replyTools.ts,reviewService.ts,runProposals.ts,scratchCopy.ts,workspaceService.ts,workspaceTools.ts', show(users))
  const preload = fs.readFileSync(`${REPO}/src/preload/index.ts`, 'utf8') + fs.readFileSync(`${REPO}/src/shared/ipc.ts`, 'utf8')
  check("G: the page's bridge has no function that reads a file, lists a folder or takes a path", !/readFile|listFiles|readWorkspace|listWorkspace|workspacePath/i.test(preload))
  check('G: the registry\'s built-in tools are still only web search, and the settings service lists only what is built in', /BUILT_IN_TOOLS: readonly ToolDefinition\[\] = \[WEB_SEARCH\]/.test(source('toolRegistry.ts')))
  check('G: the loop of a reply ends the reply for a file cap and a characters cap, and says so (replyTools.ts `endOf`, chat.ts `capMessage`)', /outcome\.code === 'file-cap'/.test(source('replyTools.ts')) && /outcome\.code === 'chars-cap'/.test(source('replyTools.ts')) && /export type TurnEnd = 'step-cap' \| 'time-cap' \| 'stopped' \| 'file-cap' \| 'chars-cap' \| null/.test(source('replyTools.ts')) && /case 'file-cap':\s*return `Stopped: this reply used all \$\{fileCaps\.calls\} of its file calls\.`/.test(source('chat.ts')) && /case 'chars-cap':/.test(source('chat.ts')))
  check('G: no tool of this stage writes: the stand-ins of this suite only read, and the workspace was byte for byte as it was at the end', treeHash(WS) === workspaceAtStart)
})

console.error = realError
const ok = check.summary()
process.exit(ok ? 0 : 1)
