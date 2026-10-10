// Slice 13.5 (D-043): THE SWITCH, THE SELF-TEST AND WHAT A RUN BRINGS BACK, under plain Node, Windows only. The real service, self-test, box, guards, scratch copy and runner where
// a real run is needed (13.2's launcher and container); a played person and played settings where they are not. What it shows:
//   A. `makeReplace`: a program's whole new text for an existing file becomes a Stage 12 proposal (and what is refused);
//   B. what a run brings back: changed and new text files become proposals past the workspace guard, a stale or vanished file does not, the reply's and the store's limits hold;
//   C. a run through the reply's runtime brings its proposals back, and the model is told in words; the reply's proposals are counted once;
//   D. the judge of the self-test: twelve lines, each flips on its own evidence, and the box's own words are never believed alone;
//   E. the self-test in the REAL box passes; a runner with NO box fails it where it must; Stop ends it; nothing is left behind;
//   F. the service: the switch needs a folder, Node and a passing test and the person's yes; off needs nothing; the tool is offered only while available;
//   G. the box's folder, the page's words for a run, the generic switch that must not turn it on, and the source.
//
// Run: FRONTIER_MAY_REMOVE=1 node tools/verify-13-5.mjs      (ONLY=A,B runs some parts; part E takes about 40 seconds)
//   It removes the scratch copies and its own temp folder, so it will not start without FRONTIER_MAY_REMOVE=1 (set only when the owner has allowed removing in words, D-043), and
//   it works under the guard of tools/fsguard.mjs: this process can write and remove only inside its own new folder in C:\frontier-tmp.
import './ts-resolve.mjs'
import { checker } from './cdp.mjs'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import { win32 } from 'node:path'
import { spawnSync } from 'node:child_process'
import { installFsGuard } from './fsguard.mjs'
import { REPO, REPO_URL } from './paths.mjs'

if (process.env.FRONTIER_MAY_REMOVE !== '1') {
  console.log('NOT RUN: this suite removes folders it made itself and tests code that removes. Nothing is removed from any drive unless the owner has allowed it in words; set FRONTIER_MAY_REMOVE=1 only then.')
  process.exit(3)
}
if (os.tmpdir().toLowerCase() !== 'c:\\frontier-tmp') {
  console.log(`NOT RUN: the temp folder is ${os.tmpdir()}; a check that removes may only work in C:\\frontier-tmp (run it from a copy of the repo on C:).`)
  process.exit(3)
}
const check = checker()
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(',')) : null
const guard = async (name, fn) => {
  if (ONLY && !ONLY.has(name)) return
  try {
    await fn()
  } catch (error) {
    check(`${name} did not run to its end: ${String(error?.stack ?? error).slice(0, 700)}`, false)
  }
}
const show = (v) => JSON.stringify(v)?.slice(0, 500)
const SRC = `${REPO_URL}/src`
const propMod = await import(`${SRC}/main/proposals.ts`)
const textMod = await import(`${SRC}/main/workspaceText.ts`)
const bringMod = await import(`${SRC}/main/runProposals.ts`)
const scratchMod = await import(`${SRC}/main/scratchCopy.ts`)
const wsGuardMod = await import(`${SRC}/main/workspaceGuard.ts`)
const dataMod = await import(`${SRC}/main/dataFolderGuard.ts`)
const gateMod = await import(`${SRC}/main/systemQuestion.ts`)
const replyMod = await import(`${SRC}/main/replyTools.ts`)
const regMod = await import(`${SRC}/main/toolRegistry.ts`)
const progMod = await import(`${SRC}/main/programTools.ts`)
const proposalToolsMod = await import(`${SRC}/main/proposalTools.ts`)
const selfMod = await import(`${SRC}/main/selfTest.ts`)
const svcMod = await import(`${SRC}/main/programService.ts`)
const boxMod = await import(`${SRC}/main/programBox.ts`)
const runnerMod = await import(`${SRC}/main/commandRunner.ts`)
const toolSvcMod = await import(`${SRC}/main/toolSettingsService.ts`)
const notesMod = await import(`${SRC}/shared/toolNotes.ts`)
const sharedPrograms = await import(`${SRC}/shared/programs.ts`)
const runMod = await import(`${SRC}/shared/run.ts`)
const questionMod = await import(`${SRC}/main/toolQuestion.ts`)
const J = win32.join
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex')
const cp = (n) => String.fromCodePoint(n)
const RLO = cp(0x202e)
const KEY = 'sk-ant-FAKE-KEY-for-the-checks-0123456789'

// ----- the scratch world: everything below lies in ROOT, and the guard lets this process write and remove nowhere else -----
const ROOT = fs.realpathSync.native(fs.mkdtempSync(J(os.tmpdir(), 'frontier-135-')))
const fsGuard = installFsGuard({ write: [ROOT], remove: [ROOT] })
process.on('exit', () => {
  try {
    runnerMod.sweepMounts(ROOT) // a drive letter into ROOT that a part left behind goes first (an alias only)
  } catch {
    /* none */
  }
  for (const link of [J(ROOT, 'ws', 'link-out')]) {
    try {
      if (fs.lstatSync(link).isSymbolicLink()) fs.rmdirSync(link)
    } catch {
      /* not made */
    }
  }
  try {
    process.chdir(os.tmpdir())
    fs.rmSync(ROOT, { recursive: true, force: true })
  } catch {
    /* left for the system */
  }
})
const DATA = J(ROOT, 'data')
const TMPD = J(ROOT, 'temp')
const HOME = J(ROOT, 'home')
const WS = J(ROOT, 'ws')
const OUT = J(ROOT, 'out')
const RUNROOT = J(ROOT, 'run')
const put = (base, rel, body) => {
  const full = J(base, rel)
  fs.mkdirSync(win32.dirname(full), { recursive: true })
  fs.writeFileSync(full, body)
  return full
}
for (const d of [DATA, TMPD, HOME, OUT, J(RUNROOT, 'scratch')]) fs.mkdirSync(d, { recursive: true })
put(HOME, 'diary.txt', 'HOME-CANARY')
put(OUT, 'secret.txt', 'OUTSIDE-CANARY')
put(WS, 'a.txt', 'one\n')
put(WS, 'keep.txt', 'keep\n')
put(WS, 'src\\b.js', 'b\n')
put(WS, 'crlf.txt', 'x\r\ny\r\n')
put(WS, 'bin.dat', Buffer.from([0, 1, 2, 3]))
put(WS, '.env', 'SECRET-CANARY')
let hasLink = true
try {
  fs.symlinkSync(OUT, J(WS, 'link-out'), 'junction')
} catch {
  hasLink = false
}
const dataGuard = dataMod.createDataFolderGuard({ roots: () => [DATA] })
const wsGuard = (root = WS) => wsGuardMod.createWorkspaceGuard({ root: () => root, dataGuard })
const treeHash = (dir) => {
  const h = crypto.createHash('sha256')
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const p = J(d, e.name)
      const st = fs.lstatSync(p)
      h.update(`${p}|${st.size}|${st.mtimeMs}|${e.isSymbolicLink() ? 'L' : e.isDirectory() ? 'D' : 'F'}\n`)
      if (e.isDirectory() && !e.isSymbolicLink()) walk(p)
      else if (e.isFile()) h.update(fs.readFileSync(p))
    }
  }
  walk(dir)
  return h.digest('hex')
}
const scratchLeft = () => fs.readdirSync(J(RUNROOT, 'scratch')).length

// ============================ A. makeReplace ============================
await guard('A', async () => {
  const dec = (text, bom = false) => {
    const bytes = Buffer.concat([bom ? Buffer.from([0xef, 0xbb, 0xbf]) : Buffer.alloc(0), Buffer.from(text, 'utf8')])
    return { bytes, decoded: textMod.decodeText(bytes) }
  }
  const base = (over = {}) => {
    const { bytes, decoded } = dec(over.before ?? 'one\ntwo\n', over.bom === true)
    return { bytes, decoded, rel: ['a.txt'], real: J(WS, 'a.txt'), after: 'one\ntwo\nthree\n', bom: over.bom === true, why: 'because', secret: false, now: 7, ...over.input }
  }
  const ok = propMod.makeReplace(base())
  check('A: a whole new text for an existing file is a proposal of kind "edit" with the file as it was, the file as it would be, and what changed', ok.ok && ok.proposal.kind === 'edit' && ok.proposal.before === 'one\ntwo\n' && ok.proposal.after === 'one\ntwo\nthree\n' && ok.proposal.added === 1 && ok.proposal.removed === 0 && ok.proposal.path === 'a.txt', show(ok))
  check('A: it carries the fingerprint of the file as it was (so that a file that is not these bytes any more is not changed) and of the bytes that would be written', ok.ok && ok.proposal.baseHash === sha(Buffer.from('one\ntwo\n')) && ok.proposal.fingerprint === sha(Buffer.from('one\ntwo\nthree\n')).slice(0, 12) && ok.proposal.bytes === 14)
  check('A: nothing changed is refused in words', propMod.makeReplace(base({ input: { after: 'one\ntwo\n' } })).ok === false && /as it is|nothing/i.test(propMod.makeReplace(base({ input: { after: 'one\ntwo\n' } })).why))
  const bomOn = propMod.makeReplace(base({ input: { after: 'one\ntwo\n', bom: true } }))
  const bomOff = propMod.makeReplace(base({ bom: true, input: { after: 'one\ntwo\n', bom: false } }))
  check('A: only a byte-order mark added or taken away is a change, and the mark is in the bytes that would be written (3 more, or 3 fewer)', bomOn.ok === true && bomOn.proposal.bom === true && bomOn.proposal.bytes === 11 && bomOn.proposal.added === 0 && bomOn.proposal.removed === 0 && bomOff.ok === true && bomOff.proposal.bom === false && bomOff.proposal.bytes === 8, show([bomOn, bomOff]))
  const hidden = propMod.makeReplace(base({ input: { after: `one\ntwo\n${RLO}x\n` } }))
  check('A: a hidden or reversing character that the file did not have is refused, with its code', hidden.ok === false && /U\+202E/.test(hidden.why), show(hidden))
  const zwj = '\u{1F468}\u200d\u{1F469}'
  check('A: but a hidden character the file already had, in the same number, is not a reason to refuse (an emoji joined with ZWJ stays)', propMod.makeReplace(base({ before: `${zwj}\n`, input: { after: `${zwj}\nmore\n` } })).ok === true)
  check('A: more of them than the file had is refused', propMod.makeReplace(base({ before: `${zwj}\n`, input: { after: `${zwj}${zwj}\n` } })).ok === false)
  check('A: a file that would be bigger than a file may be is refused in words', propMod.makeReplace(base({ input: { after: 'x'.repeat(300 * 1024) } })).ok === false)
  const crlf = propMod.makeReplace(base({ before: 'x\r\ny\r\n', input: { after: 'x\r\ny\r\nz\r\n' } }))
  check('A: the line ends are those of the new text (a program that wrote Windows line ends gets them kept, and the diff counts lines, not the ends)', crlf.ok && crlf.proposal.eol === 'crlf' && crlf.proposal.added === 1, show(crlf))
  const mixed = propMod.makeReplace(base({ input: { after: 'one\r\ntwo\nthree\n' } }))
  check('A: mixed line ends in the new text are kept as they are and called mixed', mixed.ok && mixed.proposal.eol === 'mixed')
  check('A: the flags of the Review window are the same as for an edit: secret passes through, and a file that runs commands is flagged', propMod.makeReplace(base({ input: { secret: true } })).proposal.flags.secret === true && propMod.makeReplace(base({ input: { rel: ['package.json'], real: J(WS, 'package.json') } })).proposal.flags.runsCommands === true)
  check('A: the store takes it like any proposal', (() => { const store = propMod.createProposalStore(); const added = store.add(ok.proposal); return added.ok && store.count() === 1 && store.get(added.proposal.id)?.path === 'a.txt' })())
})

// ============================ B. what a run brings back ============================
async function copyAndChange(change) {
  const made = await scratchMod.makeScratch({ runRoot: RUNROOT, source: WS, savedKeys: async () => [{ provider: 'anthropic', key: KEY }] })
  if (!made.ok) throw new Error('the copy was not made: ' + made.message)
  change(made.dir)
  const comparison = await scratchMod.compareScratch(made.dir, made.manifest)
  await scratchMod.removeScratch(made.dir, RUNROOT)
  return comparison
}
await guard('B', async () => {
  const before = treeHash(WS)
  const comparison = await copyAndChange((dir) => {
    fs.appendFileSync(J(dir, 'a.txt'), 'two\n')
    put(dir, 'new.txt', 'brand new\n')
    put(dir, 'nested\\deep\\n.txt', 'deep\n')
    put(dir, 'new.bin', Buffer.from([0, 255, 0, 255]))
    put(dir, 'src\\b.js', 'b changed\n')
    fs.writeFileSync(J(dir, 'crlf.txt'), 'x\r\ny\r\nz\r\n')
  })
  const store = propMod.createProposalStore()
  const counter = { made: 0 }
  const bring = bringMod.createBringBack({ guard: wsGuard(), store, counter, now: () => 5 })
  const r = await bring(comparison, { why: 'to try it' })
  const list = store.list().sort((a, b) => (a.path < b.path ? -1 : 1))
  check('B: the changed and new TEXT files become proposals (a binary file is not a candidate), one for each', r.made === 5 && r.notMade.length === 0 && list.map((p) => `${p.kind}:${p.path}`).join() === 'edit:a.txt,edit:crlf.txt,create:nested/deep/n.txt,create:new.txt,edit:src/b.js', show({ r, list: list.map((p) => `${p.kind}:${p.path}`) }))
  const a = list.find((p) => p.path === 'a.txt')
  check('B: a changed file is an edit with its text before and after, the fingerprint of the real file, and the real path in the workspace', a.before === 'one\n' && a.after === 'one\ntwo\n' && a.baseHash === sha(fs.readFileSync(J(WS, 'a.txt'))) && a.real.toLowerCase() === J(WS, 'a.txt').toLowerCase(), show(a))
  const n = list.find((p) => p.path === 'nested/deep/n.txt')
  check('B: a new file in a new folder is a create with the whole text and no base', n.kind === 'create' && n.before === null && n.baseHash === null && n.after === 'deep\n')
  check('B: the line ends of a changed file are kept as the program wrote them', list.find((p) => p.path === 'crlf.txt').eol === 'crlf')
  check('B: the reason says where the change came from, and carries the model\'s own', a.why.startsWith('Made by a program that was run: ') && a.why.endsWith('to try it'))
  check('B: the reply\'s count is the number made', counter.made === 5)
  check('B: NOTHING was written to the real folder: it is exactly as it was', treeHash(WS) === before)
  const stale = await copyAndChange((dir) => fs.appendFileSync(J(dir, 'keep.txt'), 'by the program\n'))
  fs.appendFileSync(J(WS, 'keep.txt'), 'by the person meanwhile\n')
  const s1 = propMod.createProposalStore()
  const rs = await bringMod.createBringBack({ guard: wsGuard(), store: s1, counter: { made: 0 } })(stale, { why: 'w' })
  fs.writeFileSync(J(WS, 'keep.txt'), 'keep\n')
  check('B: a file that is not the one that was copied any more is NOT proposed over (the person\'s later change is not lost)', rs.made === 0 && rs.notMade.length === 1 && rs.notMade[0].why === bringMod.WHY_STALE && s1.count() === 0, show(rs))
  const gone = await copyAndChange((dir) => fs.appendFileSync(J(dir, 'keep.txt'), 'x\n'))
  fs.renameSync(J(WS, 'keep.txt'), J(WS, 'keep-moved.txt'))
  const s2 = propMod.createProposalStore()
  const rg = await bringMod.createBringBack({ guard: wsGuard(), store: s2, counter: { made: 0 } })(gone, { why: 'w' })
  fs.renameSync(J(WS, 'keep-moved.txt'), J(WS, 'keep.txt'))
  check('B: a changed file that is gone from the workspace is not proposed', rg.made === 0 && rg.notMade[0]?.why === bringMod.WHY_NOT_THERE, show(rg))
  const exists = await copyAndChange((dir) => put(dir, 'appears.txt', 'from the program\n'))
  put(WS, 'appears.txt', 'the person made it\n')
  const s3 = propMod.createProposalStore()
  const re = await bringMod.createBringBack({ guard: wsGuard(), store: s3, counter: { made: 0 } })(exists, { why: 'w' })
  fs.rmSync(J(WS, 'appears.txt'))
  check('B: a new file whose name is now taken in the workspace is not proposed', re.made === 0 && re.notMade[0]?.why === bringMod.WHY_EXISTS, show(re))
  const hid = await copyAndChange((dir) => put(dir, 'hidden.txt', `visible${RLO}hidden\n`))
  const s4 = propMod.createProposalStore()
  const rh = await bringMod.createBringBack({ guard: wsGuard(), store: s4, counter: { made: 0 } })(hid, { why: 'w' })
  check('B: a new text with a hidden or reversing character is not proposed', rh.made === 0 && rh.notMade[0]?.why === bringMod.WHY_REFUSED && s4.count() === 0, show(rh))
  const many = await copyAndChange((dir) => { for (let i = 0; i < 14; i++) put(dir, `many\\f${i}.txt`, `file ${i}\n`) })
  const counter9 = { made: 8 }
  const s5 = propMod.createProposalStore()
  const rm = await bringMod.createBringBack({ guard: wsGuard(), store: s5, counter: counter9 })(many, { why: 'w' })
  check('B: a reply makes at most ten proposals in all: with eight made already, two more are made and the rest are said not to be', rm.made === 2 && counter9.made === 10 && rm.notMade.length === 12 && rm.notMade.every((x) => x.why === bringMod.WHY_REPLY_FULL), show({ made: rm.made, notMade: rm.notMade.length }))
  const s6 = propMod.createProposalStore()
  for (let i = 0; i < propMod.PROPOSAL_LIMITS.waiting; i++) s6.add({ ...a, id: undefined, path: `p${i}.txt`, rel: [`p${i}.txt`] })
  const rf = await bringMod.createBringBack({ guard: wsGuard(), store: s6, counter: { made: 0 } })(many, { why: 'w' })
  check('B: a store that holds all the proposals it may refuses more, in words, and the run is not told they were made', rf.made === 0 && rf.notMade.length === 14 && rf.notMade[0].why === bringMod.WHY_STORE_FULL, show({ made: rf.made, first: rf.notMade[0] }))
  if (hasLink) {
    const inLink = { candidates: [{ kind: 'created', rel: ['link-out', 'x.txt'], path: 'link-out/x.txt', text: 'x\n', bom: false, eol: 'lf', bytes: 2, baseSha256: null }], leftOut: [], deleted: [], counts: {}, truncated: false }
    const s7 = propMod.createProposalStore()
    const rl = await bringMod.createBringBack({ guard: wsGuard(), store: s7, counter: { made: 0 } })(inLink, { why: 'w' })
    check('B: a candidate whose path goes through a link (it could only be a path the program made up) is refused by the workspace guard', rl.made === 0 && rl.notMade[0]?.why === bringMod.WHY_NOT_THERE && !fs.existsSync(J(OUT, 'x.txt')))
  }
  const fab = (...candidates) => ({ candidates, leftOut: [], deleted: [], counts: {}, truncated: false })
  const cand = (over) => ({ kind: 'changed', rel: ['x'], path: 'x', text: 'x', bom: false, eol: 'lf', bytes: 1, baseSha256: null, ...over })
  const bringOne = async (comparison) => { const store = propMod.createProposalStore(); const r = await bringMod.createBringBack({ guard: wsGuard(), store, counter: { made: 0 } })(comparison, { why: 'w' }); return { r, store } }
  const outside = await bringOne(fab(cand({ kind: 'created', rel: ['..', 'out', 'y.txt'], path: '../out/y.txt', text: 'y\n' })))
  check('B: a candidate outside the workspace is refused by the guard, and nothing is made there', outside.r.made === 0 && outside.r.notMade[0]?.why === bringMod.WHY_NOT_THERE && !fs.existsSync(J(OUT, 'y.txt')), show(outside.r))
  const hidden = await bringOne(fab(cand({ rel: ['.env'], path: '.env', text: 'NEW-SECRET', baseSha256: sha(Buffer.from('SECRET-CANARY')) })))
  check('B: a hidden file is proposed only with the proposal flagged as secret (the Review window shows it as such; never silently)', hidden.r.made === 1 && hidden.store.list()[0].path === '.env' && hidden.store.list()[0].flags.secret === true, show(hidden.r))
  put(WS, 'big.txt', 'x'.repeat(300 * 1024))
  const big = await bringOne(fab(cand({ rel: ['big.txt'], path: 'big.txt', text: 'y', baseSha256: sha(fs.readFileSync(J(WS, 'big.txt'))) })))
  fs.rmSync(J(WS, 'big.txt'))
  check('B: a file that has grown past what a file may be here is not proposed over (its size is looked at before it is read)', big.r.made === 0 && big.r.notMade[0]?.why === bringMod.WHY_BIG, show(big.r))
  const binary = await bringOne(fab(cand({ rel: ['bin.dat'], path: 'bin.dat', text: 'x', baseSha256: sha(fs.readFileSync(J(WS, 'bin.dat'))) })))
  check('B: nor one that cannot be read as text now (a binary file)', binary.r.made === 0 && binary.r.notMade[0]?.why === bringMod.WHY_NOT_TEXT, show(binary.r))
  const folderGone = await bringOne(fab(cand({ rel: ['src'], path: 'src', text: 'x', baseSha256: null })))
  check('B: a changed "file" that is a folder in the workspace is not proposed', folderGone.r.made === 0 && folderGone.r.notMade[0]?.why === bringMod.WHY_NOT_THERE, show(folderGone.r))
})

// ----- a played person, a played runner, and the reply's runtime (as in 13.4) -----
const registry = regMod.createToolRegistry([...regMod.BUILT_IN_TOOLS, ...proposalToolsMod.WORKSPACE_PROPOSE_TOOLS, progMod.RUN_PROGRAM])
function playedRunner(script = []) {
  const calls = []
  return {
    folders: { launcher: J(RUNROOT, 'launcher'), tools: J(RUNROOT, 'tools'), specs: J(RUNROOT, 'specs') },
    live: () => 0,
    stopAll: () => {},
    calls,
    async run(request, options) {
      calls.push({ request: structuredClone(request) })
      const step = script.shift() ?? {}
      if (step.before) await step.before(request, options)
      return { kind: 'ran', exitCode: 0, timedOut: false, elapsedMs: 1200, stdout: 'ok\n', stderr: '', stdoutBytes: 3, stderrBytes: 0, peakMemoryBytes: 1, leftoverKilled: 0, diskExceeded: false, scratchBytes: 1, leftoverAfter: 0, ...(step.outcome ?? {}) }
    }
  }
}
const PLACES = (() => {
  const SYS = J(ROOT, 'windows')
  const PF = J(ROOT, 'pf')
  put(SYS, 'System32\\whoami.exe', 'MZ')
  put(PF, 'nodejs\\node.exe', 'MZ')
  return { systemRoot: SYS, programFilesDirs: [PF] }
})()
const ON = { enabled: { run_program: true, propose_new_file: true }, caps: { steps: 20, seconds: 600 } }
function makeReply(options = {}) {
  const asked = []
  const events = []
  const clock = { t: 1_000_000 }
  const gate = gateMod.createQuestionGate(async (owner, question) => { asked.push(question); return true }, () => clock.t)
  const store = options.store ?? propMod.createProposalStore()
  const runner = options.runner ?? playedRunner(options.runs ?? [])
  const env = { box: async () => ({ ok: true, runner, runRoot: RUNROOT }), savedKeys: async () => [], holdsSavedKey: async (t) => t.includes(KEY), places: PLACES, ...(options.env ?? {}) }
  const runtime = replyMod.createToolRuntime({
    tools: registry, gate, guard: dataGuard,
    workspace: { guard: wsGuard(), ...(options.noStore ? {} : { proposals: store }) },
    programs: env,
    record: async (e) => { events.push(structuredClone(e)) },
    holdsSavedKey: env.holdsSavedKey,
    clock: () => clock.t,
    now: () => 1_700_000_000_000
  })
  const reply = runtime.forReply({ owner: null, signal: new AbortController().signal, settings: options.settings ?? ON, provider: 'Anthropic', search: async () => { throw new Error('no search here') } })
  let n = 0
  const call = (name, input) => ({ id: `t${++n}`, name, input: { why: 'to try', ...input } })
  const run = async (input) => (await reply.runTurn([call('run_program', { program: 'node', args: ['go.js'], folder: '.', ...input })])).results[0]
  const propose = async (path, content) => (await reply.runTurn([call('propose_new_file', { path, content })])).results[0]
  return { run, propose, asked, events, reply, store, runner }
}

// ============================ C. a run through the reply's runtime ============================
await guard('C', async () => {
  const r = makeReply({ runs: [{ before: (req) => { fs.appendFileSync(J(req.scratchDir, 'a.txt'), 'two\n'); put(req.scratchDir, 'made.txt', 'made\n'); put(req.scratchDir, 'made.bin', Buffer.from([0, 9, 0])) } }] })
  const before = treeHash(WS)
  const res = await r.run({})
  check('C: a run that changed a text file and made another and a binary one: two proposals wait, and the model is told so in words', res.isError === false && r.store.count() === 2 && /2 text files were made into proposals for the person to review; nothing is changed until they apply it/.test(res.text), res.text.slice(-500))
  check('C: the names are listed (changed or new), the binary file among those not brought back', /Changed or new: .*a\.txt/.test(res.text) && /made\.txt/.test(res.text) && /made\.bin/.test(res.text), res.text.slice(-500))
  check('C: nothing was written to the real folder, and the copy is gone', treeHash(WS) === before && scratchLeft() === 0)
  const ids = r.store.list().map((p) => `${p.kind}:${p.path}`).sort().join()
  check('C: the proposals are those of the Review window: an edit of a.txt and a new made.txt', ids === 'create:made.txt,edit:a.txt', ids)
  const none = makeReply({ runs: [{}] })
  const noneRes = await none.run({})
  check('C: a run that changed nothing says there is nothing to review', /No text file was changed or made, so there is nothing to review/.test(noneRes.text) && none.store.count() === 0, noneRes.text.slice(-300))
  const noStore = makeReply({ noStore: true, runs: [{ before: (req) => put(req.scratchDir, 'made.txt', 'made\n') }] })
  const noStoreRes = await noStore.run({})
  check('C: without a store of proposals (a build that has none) nothing is brought back and the model is told that', /nothing was brought back/.test(noStoreRes.text) && noStore.store.count() === 0, noStoreRes.text.slice(-300))
  // the reply's ten proposals are counted once, whoever makes them
  const shared = makeReply({ runs: [{ before: (req) => { for (let i = 0; i < 6; i++) put(req.scratchDir, `run\\r${i}.txt`, `r${i}\n`) } }] })
  const own = []
  for (let i = 0; i < 7; i++) own.push(await shared.propose(`own\\p${i}.txt`, `p${i}\n`))
  const sharedRes = await shared.run({})
  check('C: the model made seven proposals itself; the run brings back only three more, because a reply makes ten in all', shared.store.count() === 10 && /3 text files were made into proposals/.test(sharedRes.text) && /3 text files could not be made into proposals \(this reply has made all the proposals it may\)/.test(sharedRes.text), show({ own: own.map((x) => x.text.slice(0, 120)), tail: sharedRes.text.slice(-500) }))
  const stale = makeReply({ runs: [{ before: (req) => { fs.appendFileSync(J(req.scratchDir, 'a.txt'), 'prog\n'); fs.appendFileSync(J(WS, 'a.txt'), 'person\n') } }] })
  const staleRes = await stale.run({})
  fs.writeFileSync(J(WS, 'a.txt'), 'one\n')
  check('C: a file the person changed while the program ran is not proposed over, and the model is told which and why', stale.store.count() === 0 && /No text file could be brought back as a proposal./.test(staleRes.text) && /could not be made into proposals \(the file in the workspace is no longer the one that was copied\)/.test(staleRes.text), staleRes.text.slice(-400))
  for (const [name, env] of [['throws', { box: async () => { throw new Error('disk gone') } }], ['says no', { box: async () => ({ ok: false, why: 'no folder' }) }]]) {
    const faulty = makeReply({ env })
    const fres = await faulty.run({})
    check(`C: a box that ${name} is "a program cannot be run just now" for the model: nobody is asked, nothing is copied or run`, fres.isError === true && /a program cannot be run on this PC just now/.test(fres.text) && faulty.runner.calls.length === 0 && faulty.asked.length === 0 && scratchLeft() === 0, fres.text.slice(0, 200))
  }
  const hostileName = makeReply({ runs: [{ before: (req) => { put(req.scratchDir, `evil${RLO}name.txt`, 'x\n'); put(req.scratchDir, 'fine.txt', 'ok\n') } }] })
  const hres = await hostileName.run({})
  check('C: the name of a file that could not be made into a proposal is shown with nothing the eye cannot see (the reversing mark is written as a code), and the other file still comes back', /1 text file could not be made into proposals \(the file is not available in the workspace now\)/.test(hres.text) && hres.text.includes('\\u{202e}') && !hres.text.includes(RLO) && hostileName.store.count() === 1, hres.text.slice(-500))
  check('C: the event of the run counts the changes (changed 1, new 1), not the proposals', (() => { const p = r.events.find((e) => e.type === 'program'); return p?.changed === 1 && p.created === 2 })(), show(r.events.find((e) => e.type === 'program')))
})

// ============================ D. the judge of the self-test ============================
await guard('D', async () => {
  const ENV = ['comspec', 'home', 'localappdata', 'path', 'pathext', 'systemroot', 'temp', 'tmp', 'userprofile', 'windir']
  const inner = { hello: 'in the box', env: [...ENV], own: 'DONE:own', readData: 'ERR:EPERM', readTemp: 'ERR:EPERM', listHome: 'ERR:EPERM', writeData: 'ERR:EPERM', writeLauncher: 'ERR:EPERM', writeTools: 'ERR:EPERM', appendNode: 'ERR:EPERM', net: 'ERR:EACCES' }
  const ran = (extra = {}) => ({ kind: 'ran', exitCode: 0, timedOut: false, elapsedMs: 900, stdout: '', stderr: '', stdoutBytes: 0, stderrBytes: 0, peakMemoryBytes: 1, leftoverKilled: 0, diskExceeded: false, scratchBytes: 1, leftoverAfter: 0, ...extra })
  const ev = (over = {}) => {
    const innerNow = over.inner === undefined ? inner : over.inner
    return {
      first: over.first ?? ran({ stdout: JSON.stringify(innerNow) + '\n' }), inner: innerNow, secrets: ['S-ONE', 'S-TWO'], canariesIntact: true, wroteSomething: false, nodeSizes: { before: 100, after: 100 }, listenerHits: 0,
      time: ran({ timedOut: true, elapsedMs: 3100, exitCode: 1 }), memory: ran({ exitCode: 3221225477, elapsedMs: 800 }), leftovers: { processes: 0, mounts: 0, live: 0 }, timing: selfMod.SELFTEST_TIMING, ...over
    }
  }
  const ids = sharedPrograms.SELFTEST_PROBES.map((p) => p.id)
  const bad = (e) => selfMod.judgeSelfTest(e).filter((l) => !l.good).map((l) => l.id).join()
  const all = selfMod.judgeSelfTest(ev())
  check('D: twelve lines, in the order of the list, each with the words the person reads, and every one good for a box that does what it must', all.length === 12 && all.map((l) => l.id).join() === ids.join() && all.every((l) => l.good && l.label === sharedPrograms.SELFTEST_PROBES.find((p) => p.id === l.id).label && l.detail.length > 0), show(all.filter((l) => !l.good)))
  check('D: a program that did not start fails "ran" and everything that depends on it (it could not have been stopped from anything)', (() => { const e = ev({ first: { kind: 'not-run', why: 'isolation-unavailable', message: 'no box' }, inner: null }); const b = bad(e).split(','); return b.includes('ran') && b.includes('own') && b.includes('read-data') && b.includes('network') && b.includes('environment') })())
  check('D: a program that printed its answer and then exited with an error did not "run well": "ran" and what rests on it fail', (() => { const b = bad(ev({ first: ran({ stdout: JSON.stringify(inner) + '\n', exitCode: 1 }) })).split(','); return b.includes('ran') && b.includes('read-data') && b.includes('network') })())
  check('D: a program that started and exited well but did not say what it was told to say fails "ran" (and what rests on it)', (() => { const b = bad(ev({ inner: { ...inner, hello: 'something else' } })).split(','); return b.includes('ran') && !b.includes('own') })())
  check('D: a program that started but cannot use its own folder fails "own"', bad(ev({ inner: { ...inner, own: 'ERR:EPERM' } })) === 'own')
  for (const [name, patch, want, extra] of [
    ['reading the data folder', { readData: 'DONE:SELFTEST' }, 'read-data'],
    ['reading the temp folder', { readTemp: 'DONE:SELFTEST' }, 'read-temp'],
    ['listing the user folder', { listHome: 'DONE:3' }, 'list-home'],
    ['writing in the data folder', { writeData: 'DONE:undefined' }, 'write-data'],
    ['writing in the launcher folder', { writeLauncher: 'DONE:undefined' }, 'write-launcher'],
    ['writing in the tools folder', { writeTools: 'DONE:undefined' }, 'write-launcher'],
    ['changing the program copy', { appendNode: 'DONE:undefined' }, 'write-launcher'],
    ['connecting out', { net: 'CONNECTED' }, 'network']
  ]) {
    check(`D: if the box did not stop ${name}, exactly the line "${want}" fails`, bad(ev({ inner: { ...inner, ...patch } })) === want, bad(ev({ inner: { ...inner, ...patch } })) + extra)
  }
  check('D: the box saying "refused" is not believed when the program\'s own words leak a canary (read-data, read-temp)', bad(ev({ first: ran({ stdout: JSON.stringify(inner) + '\nS-ONE' }) })) === 'read-data,read-temp')
  check('D: nor when the files it was refused are there (a file made, a canary changed): write-data and write-launcher fail', bad(ev({ wroteSomething: true })) === 'write-data,write-launcher' && bad(ev({ canariesIntact: false })) === 'write-data')
  check('D: nor when the program copy changed size, whatever the program said', bad(ev({ nodeSizes: { before: 100, after: 101 } })) === 'write-launcher' && bad(ev({ nodeSizes: { before: null, after: null } })) === 'write-launcher')
  check('D: nor when the listener on this computer heard somebody, whatever the program said it saw', bad(ev({ listenerHits: 1 })) === 'network')
  check('D: a timeout that is only an error is not "net refused": "TIMEOUT" is accepted (nothing came back), a missing answer is not', bad(ev({ inner: { ...inner, net: 'TIMEOUT' } })) === '' && bad(ev({ inner: { ...inner, net: undefined } })) === 'network')
  check('D: an environment with one name more or less fails "environment" (APPDATA, a key, a name that is missing)', bad(ev({ inner: { ...inner, env: [...ENV, 'APPDATA'] } })) === 'environment' && bad(ev({ inner: { ...inner, env: [...ENV, 'ANTHROPIC_API_KEY'] } })) === 'environment' && bad(ev({ inner: { ...inner, env: ENV.slice(1) } })) === 'environment')
  check('D: the case of the names does not matter (Windows keeps them as it likes)', bad(ev({ inner: { ...inner, env: ENV.map((n) => n.toUpperCase()) } })) === '')
  check('D: a program that is not ended by its clock, or is ended much too late, fails "time"', bad(ev({ time: ran({ timedOut: false, elapsedMs: 3000 }) })) === 'time' && bad(ev({ time: ran({ timedOut: true, elapsedMs: 60_000 }) })) === 'time' && bad(ev({ time: { kind: 'not-run', why: 'aborted', message: 'x' } })) === 'time')
  check('D: a greedy program that runs to the end of its time, or exits well, fails "memory"', bad(ev({ memory: ran({ timedOut: true, exitCode: 1, elapsedMs: 20_000 }) })) === 'memory' && bad(ev({ memory: ran({ exitCode: 0 }) })) === 'memory')
  check('D: anything left running, mounted or going on fails "clean"', bad(ev({ leftovers: { processes: 1, mounts: 0, live: 0 } })) === 'clean' && bad(ev({ leftovers: { processes: 0, mounts: 1, live: 0 } })) === 'clean' && bad(ev({ leftovers: { processes: 0, mounts: 0, live: 1 } })) === 'clean')
  check('D: output that is not JSON, or JSON that is not an object, is no answer: the lines that rest on it fail', (() => { const e = ev({ first: ran({ stdout: 'not json' }), inner: null }); return bad(e).includes('ran') && bad(e).includes('read-data') })())
  check('D: no detail of any line holds a path or a secret', all.every((l) => !/[A-Za-z]:\\|S-ONE|S-TWO/.test(l.detail)))
  check('D: the script that runs in the box is plain ASCII, prints one line of JSON, and names no path of its own', /^[\x20-\x7e\n]+$/.test(selfMod.SELFTEST_SCRIPT) && /console\.log\(JSON\.stringify\(out\)\)/.test(selfMod.SELFTEST_SCRIPT) && !/[A-Za-z]:\\\\/.test(selfMod.SELFTEST_SCRIPT))
})

// ============================ E. the self-test in the real box ============================
const nodeReal = await progMod.resolveProgram('node', progMod.defaultPlaces())
await guard('E', async () => {
  if (nodeReal === null) {
    check('E: Node.js is installed here (the self-test needs it)', false, 'no node.exe under Program Files')
    return
  }
  const runner = runnerMod.createCommandRunner({ runRoot: RUNROOT })
  const filesBefore = new Set([...fs.readdirSync(DATA), ...fs.readdirSync(TMPD)])
  const report = await selfMod.runSelfTest({ runner, runRoot: RUNROOT, nodePath: nodeReal, dataDir: DATA, tempDir: TMPD, homeDir: HOME })
  check('E: in the REAL box, all twelve lines are good: the report is ok, with no message', report.ok === true && report.message === null && report.lines.length === 12 && report.lines.every((l) => l.good), show(report.lines.filter((l) => !l.good)))
  check('E: it took a few seconds, not minutes', report.ms > 1000 && report.ms < 120_000, `${report.ms} ms`)
  check('E: what the test made is gone: the canaries, the scratch folder, the listener; nothing else was left in the data and temp folders', scratchLeft() === 0 && JSON.stringify([...fs.readdirSync(DATA), ...fs.readdirSync(TMPD)].sort()) === JSON.stringify([...filesBefore].sort()) && runnerMod.listMounts(RUNROOT).length === 0 && runner.live() === 0, show({ left: scratchLeft(), data: fs.readdirSync(DATA), tmp: fs.readdirSync(TMPD) }))
  check('E: the canaries were never read: the home canary and the outside canary are as they were', fs.readFileSync(J(HOME, 'diary.txt'), 'utf8') === 'HOME-CANARY' && fs.readFileSync(J(OUT, 'secret.txt'), 'utf8') === 'OUTSIDE-CANARY')
  check('E: the launcher\'s folder and the tools folder hold nothing the program made', !fs.readdirSync(J(RUNROOT, 'launcher')).some((f) => /selftest/i.test(f)) && !fs.readdirSync(J(RUNROOT, 'tools')).some((f) => /selftest/i.test(f)))
  const again = await selfMod.runSelfTest({ runner, runRoot: RUNROOT, nodePath: nodeReal, dataDir: DATA, tempDir: TMPD, homeDir: HOME })
  check('E: a second test passes too (nothing from the first is in the way)', again.ok === true, show(again.lines.filter((l) => !l.good)))
  const none = await selfMod.runSelfTest({ runner, runRoot: RUNROOT, nodePath: null, dataDir: DATA, tempDir: TMPD, homeDir: HOME })
  check('E: without Node.js the test cannot be made, says why in words, and is not ok', none.ok === false && none.lines.length === 0 && /Node\.js is not installed/.test(none.message ?? ''))
  const ctl = new AbortController()
  const pending = selfMod.runSelfTest({ runner, runRoot: RUNROOT, nodePath: nodeReal, dataDir: DATA, tempDir: TMPD, homeDir: HOME, signal: ctl.signal })
  await new Promise((resolve) => setTimeout(resolve, 1500))
  ctl.abort()
  const stopped = await pending
  check('E: Stop ends the test: it is not ok, says it was stopped, and leaves nothing behind', stopped.ok === false && /stopped/i.test(stopped.message ?? '') && scratchLeft() === 0 && runnerMod.listMounts(RUNROOT).length === 0 && JSON.stringify([...fs.readdirSync(DATA), ...fs.readdirSync(TMPD)].sort()) === JSON.stringify([...filesBefore].sort()), show({ ok: stopped.ok, message: stopped.message }))
  // a runner with NO box: it runs the very same program as an ordinary process, on a COPY of node.exe (so that nothing but this world can be touched by it)
  const fakeNode = J(ROOT, 'fake', 'node.exe')
  fs.mkdirSync(win32.dirname(fakeNode), { recursive: true })
  fs.copyFileSync(nodeReal, fakeNode)
  const unboxed = {
    folders: { launcher: J(RUNROOT, 'launcher'), tools: J(RUNROOT, 'tools'), specs: J(RUNROOT, 'specs') },
    live: () => 0,
    stopAll: () => {},
    async run(request) {
      if (request.args[0] === 'selftest.cjs') {
        const t0 = Date.now()
        const p = spawnSync(fakeNode, request.args, { cwd: request.scratchDir, encoding: 'utf8', timeout: 30_000, env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot }, windowsHide: true })
        return { kind: 'ran', exitCode: p.status ?? 1, timedOut: false, elapsedMs: Date.now() - t0, stdout: p.stdout ?? '', stderr: p.stderr ?? '', stdoutBytes: 1, stderrBytes: 0, peakMemoryBytes: 0, leftoverKilled: 0, diskExceeded: false, scratchBytes: 0, leftoverAfter: 0 }
      }
      // (the for-ever and the greedy program are NOT run without a box: they would eat this PC; they are answered as a box that does not stop them would)
      return { kind: 'ran', exitCode: 0, timedOut: false, elapsedMs: 100, stdout: '', stderr: '', stdoutBytes: 0, stderrBytes: 0, peakMemoryBytes: 0, leftoverKilled: 0, diskExceeded: false, scratchBytes: 0, leftoverAfter: 0 }
    }
  }
  fs.mkdirSync(J(RUNROOT, 'launcher'), { recursive: true })
  fs.mkdirSync(J(RUNROOT, 'tools'), { recursive: true })
  const naked = await selfMod.runSelfTest({ runner: unboxed, runRoot: RUNROOT, nodePath: fakeNode, dataDir: DATA, tempDir: TMPD, homeDir: HOME })
  const failing = naked.lines.filter((l) => !l.good).map((l) => l.id)
  check('E: the SAME test with no box fails where it must: the program reads the canaries and lists the folder, writes in the data and launcher folders, reaches this computer, sees the environment, is not ended', naked.ok === false && ['read-data', 'read-temp', 'list-home', 'write-data', 'write-launcher', 'network', 'environment', 'time', 'memory'].every((id) => failing.includes(id)) && naked.lines.find((l) => l.id === 'ran').good && naked.lines.find((l) => l.id === 'own').good, show(failing))
  check('E: and the unboxed program really did what the judge says (it wrote in the data folder: the test removed it itself afterwards)', !fs.readdirSync(DATA).some((f) => /selftest/.test(f)) && !fs.readdirSync(J(RUNROOT, 'launcher')).some((f) => /selftest/.test(f)))
})

// ============================ F. the service ============================
function makeService(options = {}) {
  const asked = []
  const answers = [...(options.answers ?? [])]
  const gate = gateMod.createQuestionGate(async (owner, question) => { asked.push(question); options.onAsk?.(store); return answers.length === 0 ? true : answers.shift() }, () => 1_000_000 + asked.length * 10_000)
  const store = {
    settings: { enabled: {}, caps: { steps: 5, seconds: 60 }, ...(options.settings ?? {}) },
    problem: options.problem ?? null,
    writes: [],
    reads: 0,
    async read() { this.reads++; return { settings: this.settings, problem: this.problem } },
    async write(settings, opts) { if (options.writeFails) throw new Error('disk full'); this.writes.push({ settings: structuredClone(settings), replace: opts?.replace === true }); this.settings = settings; this.problem = null }
  }
  let reports = 0
  const tests = []
  const goodReport = () => ({ at: 1, ok: true, lines: sharedPrograms.SELFTEST_PROBES.map((p) => ({ id: p.id, label: p.label, good: true, detail: 'Fine.' })), ms: 10, message: null })
  const workspace = options.workspace ?? { folder: WS, name: 'ws', on: true, problem: null, unusable: null }
  const service = svcMod.createProgramService({
    toolSettings: store, gate,
    workspace: { status: async () => workspace },
    box: options.box ?? (async () => ({ ok: true, runner: playedRunner(), runRoot: RUNROOT })),
    dataDir: DATA, tempDir: TMPD, homeDir: HOME, places: options.places ?? PLACES,
    selfTest: async (o) => { reports++; tests.push(o); if (options.selfTestThrows) throw new Error('boom'); if (options.delay) await new Promise((r) => setTimeout(r, options.delay)); if (options.waitForSignal) { await new Promise((resolve) => o.signal.addEventListener('abort', resolve, { once: true })); return { at: 1, ok: false, lines: sharedPrograms.SELFTEST_PROBES.map((p) => ({ id: p.id, label: p.label, good: false, detail: 'x' })), ms: 1, message: 'The test was stopped before it finished.' } } return options.report ?? goodReport() },
    now: () => 1_700_000_000_000
  })
  return { service, store, asked, tests, reports: () => reports, goodReport }
}
await guard('F', async () => {
  const s = makeService()
  const st0 = await s.service.status()
  check('F: the status says: off, a folder is ready, Node is found, no test yet, nothing wrong', st0.on === false && st0.workspaceReady === true && st0.nodeInstalled === true && st0.testing === false && st0.test === null && st0.problem === null, show(st0))
  check('F: nothing is available before anything is switched on', (await s.service.available()) === false)
  const on = await s.service.setOn('w', { on: true })
  check('F: switching on makes the self-test, asks ONE question, and writes the one setting', on.ok === true && s.reports() === 1 && s.asked.length === 1 && s.store.writes.length === 1 && s.store.writes[0].settings.enabled.run_program === true, show(on))
  check('F: the question is in the system\'s words: tested just now, all twelve checks, one program on a copy, every run asks, "Don\'t turn on" is the other button', /tested just now on this PC and passed all 12 checks/.test(s.asked[0].detail) && /Every run asks you first/.test(s.asked[0].detail) && s.asked[0].no === "Don't turn on" && s.asked[0].yes === 'Turn on' && s.asked[0].detail.endsWith(questionMod.ASKED_HERE), s.asked[0].detail)
  check('F: the question fits the box with room to spare', s.asked[0].detail.length < 1900, String(s.asked[0].detail.length))
  check('F: the answer carries the report, the status is on, and a run may be made now (a test of this session passed)', on.ok && on.test?.ok === true && on.status.on === true && (await s.service.available()) === true)
  check('F: the other settings were kept as they were (the caps)', s.store.settings.caps.steps === 5 && s.store.settings.caps.seconds === 60)
  const twice = await s.service.setOn('w', { on: true })
  check('F: switching on again, when it is on, changes nothing and asks nothing', twice.ok && s.asked.length === 1 && s.reports() === 1 && s.store.writes.length === 1)
  const off = await s.service.setOn('w', { on: false })
  check('F: switching off needs no test and no question, and writes the setting', off.ok && s.asked.length === 1 && s.reports() === 1 && s.store.writes.at(-1).settings.enabled.run_program === false && off.status.on === false)
  check('F: once off, no run is available (the test of this session does not matter)', (await s.service.available()) === false)
  const offAgain = await s.service.setOn('w', { on: false })
  check('F: off when it is off changes nothing', offAgain.ok && s.store.writes.length === 2)

  // refusals before any test
  const noFolder = makeService({ workspace: { folder: null, name: null, on: false, problem: null, unusable: null } })
  const nf = await noFolder.service.setOn('w', { on: true })
  check('F: with no workspace folder the answer is "choose one first", no test is made and nobody is asked', nf.ok === false && nf.error === svcMod.NO_FOLDER && noFolder.reports() === 0 && noFolder.asked.length === 0 && noFolder.store.writes.length === 0)
  const unusable = makeService({ workspace: { folder: WS, name: 'ws', on: true, problem: null, unusable: 'it is a link now' } })
  check('F: nor with a folder that cannot be used just now', (await unusable.service.setOn('w', { on: true })).ok === false && unusable.reports() === 0)
  const noNode = makeService({ places: { systemRoot: J(ROOT, 'nowhere'), programFilesDirs: [] } })
  const nn = await noNode.service.setOn('w', { on: true })
  check('F: without Node.js the answer says so in words, no test is made, nobody is asked', nn.ok === false && nn.error === svcMod.NO_NODE && noNode.reports() === 0 && noNode.asked.length === 0 && (await noNode.service.status()).nodeInstalled === false)
  const noBox = makeService({ box: async () => ({ ok: false, why: 'no folder where a program can be run' }) })
  const nb = await noBox.service.setOn('w', { on: true })
  check('F: a box that cannot be made is said in words with the reason; nothing is asked or written', nb.ok === false && /could not be made on this PC/.test(nb.error) && /no folder where a program can be run/.test(nb.error) && noBox.reports() === 0 && noBox.store.writes.length === 0)
  const unreadable = makeService({ problem: 'the file is damaged' })
  const ur = await unreadable.service.setOn('w', { on: true })
  check('F: tool settings that cannot be read stop it: nothing is tested, asked or written', ur.ok === false && /could not be read/.test(ur.error) && unreadable.reports() === 0 && unreadable.asked.length === 0 && unreadable.store.writes.length === 0)
  const urOff = await unreadable.service.setOn('w', { on: false })
  check('F: but off starts the settings again (every tool off, the old file kept as a copy: replace)', urOff.ok === true && unreadable.store.writes.at(-1).replace === true && unreadable.store.writes.at(-1).settings.enabled.run_program === false)

  // a test that does not pass
  const failedReport = { at: 1, ok: false, lines: sharedPrograms.SELFTEST_PROBES.map((p, i) => ({ id: p.id, label: p.label, good: i !== 2 && i !== 7, detail: i === 2 ? 'It was NOT stopped from reading it.' : 'x' })), ms: 10, message: null }
  const failing = makeService({ report: failedReport })
  const fl = await failing.service.setOn('w', { on: true })
  check('F: a test that does not pass keeps it off: the error names what was not as it must be, the report comes back, nobody is asked, nothing is written', fl.ok === false && /did not pass, so running programs stays off/.test(fl.error) && /cannot read a file in this app's data folder/.test(fl.error) && /cannot reach the network/.test(fl.error) && fl.test?.ok === false && failing.asked.length === 0 && failing.store.writes.length === 0, show(fl))
  check('F: and nothing is available', (await failing.service.available()) === false)
  const noLines = makeService({ report: { at: 1, ok: false, lines: [], ms: 1, message: 'The self-test could not be made on this PC.' } })
  const nl = await noLines.service.setOn('w', { on: true })
  check('F: a test that could not be made at all says so', nl.ok === false && /could not be made, so running programs stays off/.test(nl.error))
  const throws = makeService({ selfTestThrows: true })
  check('F: a test that throws is an error the page can show (the page is told it could not be changed), nothing written', await throws.service.setOn('w', { on: true }).then((x) => x.ok === false, () => true) && throws.store.writes.length === 0)

  // settings that become unreadable while the box is open
  const midway = makeService({ onAsk: (st) => { st.problem = 'the file is damaged' } })
  const mw = await midway.service.setOn('w', { on: true })
  check('F: tool settings that become unreadable while the box is open: nothing is written (what is written is the file as it is after the wait)', mw.ok === false && /could not be read/.test(mw.error) && midway.store.writes.length === 0, show(mw))

  // the person says no
  const no = makeService({ answers: [false] })
  const nr = await no.service.setOn('w', { on: true })
  check('F: the person\'s no leaves it off: cancelled, the report comes back, nothing is written, nothing is available', nr.ok === false && nr.cancelled === true && nr.test?.ok === true && no.store.writes.length === 0 && (await no.service.available()) === false)
  const failedBox = makeService({ answers: [() => { throw new Error('no box') }] })
  const fb = await failedBox.service.setOn('w', { on: true })
  check('F: a box that could not be shown is not a yes', fb.ok === false && failedBox.store.writes.length === 0)
  check('F: nothing but {on: true} is a switch-on (a text, a number, a missing field, a null, an extra field with on missing)', await Promise.all([{ on: 'yes' }, { on: 1 }, {}, null, 'on', undefined, { enable: true }].map((x) => makeService().service.setOn('w', x))).then((all) => all.every((r) => r.ok === false && r.error === 'That change was not understood.')))

  // one at a time
  const slow = makeService({ delay: 150 })
  const first = slow.service.setOn('w', { on: true })
  await new Promise((r) => setTimeout(r, 30))
  const second = await slow.service.setOn('w', { on: true })
  const third = await slow.service.setOn('w', { on: false })
  await first
  check('F: while one change is going on a second is refused at once, on and off alike', second.ok === false && /still being changed/.test(second.error) && third.ok === false && slow.store.writes.length === 1)
  check('F: the status says it is testing while a test is going on', await (async () => { const t = makeService({ delay: 150 }); const p = t.service.setOn('w', { on: true }); await new Promise((r) => setTimeout(r, 30)); const st = await t.service.status(); await p; return st.testing === true && (await t.service.status()).testing === false })())

  // the person's Stop ends the test that is going on
  const stoppable = makeService({ waitForSignal: true })
  const stopping = stoppable.service.setOn('w', { on: true }).then((r) => r, (e) => ({ ok: false, error: `it threw: ${String(e)}` }))
  await new Promise((r) => setTimeout(r, 40))
  stoppable.service.stopTest()
  const stopped = await stopping
  check('F: Stop ends the self-test: the test was given a signal that was aborted, the answer is cancelled (not a fault of the box) with the report, nobody is asked, nothing is written or available', stoppable.tests[0]?.signal?.aborted === true && stopped.ok === false && stopped.cancelled === true && stopped.test?.ok === false && stoppable.asked.length === 0 && stoppable.store.writes.length === 0 && (await stoppable.service.available()) === false, show(stopped))
  check('F: Stop with no test going on does nothing', (() => { const idle = makeService(); idle.service.stopTest(); return true })())
  const afterStop = await stoppable.service.status()
  check('F: and the status is no longer "testing"', afterStop.testing === false)

  // the test counts as going on while the box is still being made
  const slowBox = makeService({ box: async () => { await new Promise((r) => setTimeout(r, 150)); return { ok: true, runner: playedRunner(), runRoot: RUNROOT } } })
  const slowOn = slowBox.service.setOn('w', { on: true })
  await new Promise((r) => setTimeout(r, 30))
  const duringBox = await slowBox.service.status()
  slowBox.service.stopTest()
  const slowResult = await slowOn
  check('F: the test counts as going on from the start, while the box is still being made, and a Stop then ends it before it starts (cancelled, nothing was tested, nothing written)', duringBox.testing === true && slowResult.ok === false && slowResult.cancelled === true && slowBox.reports() === 0 && slowBox.store.writes.length === 0, show([duringBox.testing, slowResult]))

  // start-up
  const quiet = makeService()
  await quiet.service.startUp()
  check('F: at start-up, with the switch off, nothing is tested', quiet.reports() === 0 && (await quiet.service.available()) === false)
  const restarted = makeService({ settings: { enabled: { run_program: true } } })
  check('F: a switch that is on in the file is NOT available until a test of this session has passed (a settings file on its own does not open the box)', (await restarted.service.available()) === false)
  await restarted.service.startUp()
  check('F: at start-up with the switch on the box is tested again, and a pass makes it available', restarted.reports() === 1 && (await restarted.service.available()) === true && restarted.store.writes.length === 0)
  const broken = makeService({ settings: { enabled: { run_program: true } }, report: failedReport })
  await broken.service.startUp()
  const brokenStatus = await broken.service.status()
  check('F: if the test no longer passes at start-up the switch is taken off (less needs no question), nothing is available, and the page is told why', broken.store.writes.length === 1 && broken.store.settings.enabled.run_program === false && (await broken.service.available()) === false && /switched off at start-up/.test(brokenStatus.problem ?? '') && broken.asked.length === 0, show(brokenStatus))
  const startThrows = makeService({ settings: { enabled: { run_program: true } }, selfTestThrows: true })
  check('F: a start-up test that throws is not an error of the app', await startThrows.service.startUp().then(() => true, () => false))
  const thrownStatus = await startThrows.service.status()
  check('F: and then nothing is available, the switch is off in the file, and the page is told why (it is not tried again at every reply)', (await startThrows.service.available()) === false && startThrows.store.settings.enabled.run_program === false && /could not be made/.test(thrownStatus.problem ?? '') && startThrows.reports() === 1, show(thrownStatus))
  const sniff = makeService({ settings: { enabled: { run_program: true } }, problem: 'damaged' })
  await sniff.service.startUp()
  check('F: with unreadable settings nothing is tested at start-up', sniff.reports() === 0)
  const lazy = makeService({ settings: { enabled: { run_program: true } } })
  const lazyFirst = await lazy.service.available()
  await new Promise((r) => setTimeout(r, 80))
  check('F: asking whether a run is possible, with the switch on in the file and no test of this session yet, starts the test in the background: the answer is no at once and yes once it has passed, and nobody is asked', lazyFirst === false && lazy.reports() === 1 && (await lazy.service.available()) === true && lazy.reports() === 1 && lazy.asked.length === 0, show({ lazyFirst, reports: lazy.reports() }))
  const noFolderStart = makeService({ settings: { enabled: { run_program: true } }, workspace: { folder: null, name: null, on: false, problem: null, unusable: null } })
  await noFolderStart.service.startUp()
  check('F: at start-up with the switch on and no folder chosen nothing is tested (a run needs a folder, and the box lives on its drive), nothing is available and nothing is written', noFolderStart.reports() === 0 && (await noFolderStart.service.available()) === false && noFolderStart.store.writes.length === 0)
  const saveFail = makeService({ writeFails: true })
  const sf = await saveFail.service.setOn('w', { on: true })
  check('F: settings that cannot be saved are an error in words, and nothing is available', sf.ok === false && /could not be saved/.test(sf.error) && (await saveFail.service.available()) === false)

  // what a reply sees
  const base = { enabled: { run_program: true, web_search: true }, caps: { steps: 5, seconds: 60 } }
  check('F: the reply sees the run tool only while it is available and a folder is chosen', svcMod.withPrograms(base, true).enabled.run_program === true && svcMod.withPrograms(base, false).enabled.run_program === undefined && svcMod.withPrograms(base, false).enabled.web_search === true && base.enabled.run_program === true)
  check('F: the question\'s words say the number of checks of the report it is given', svcMod.runOnQuestion({ ...s.goodReport(), lines: s.goodReport().lines.slice(0, 5) }, null).detail.includes('passed all 5 checks') && svcMod.runOnQuestion(s.goodReport(), '"x"').detail.includes('("x")'))
})

// ============================ G. the box's folder, the page\'s words, the generic switch, the source ============================
await guard('G', async () => {
  // the folder of runs
  const made = []
  const makeRunner = (deps) => { const r = { ...playedRunner(), deps, stopped: 0, stopAll() { this.stopped++ } }; made.push(r); return r }
  const noWs = boxMod.createProgramBox({ workspaceRoot: () => null, tempDir: TMPD, makeRunner })
  const one = await noWs.get()
  const two = await noWs.get()
  check('G: with no workspace the folder of runs is FrontierRun in the temp folder, made once, and the same runner answers again', one.ok && one.runRoot.toLowerCase() === J(TMPD, 'FrontierRun').toLowerCase() && two.ok && one.runner === two.runner && made.length === 1, show({ one: one.ok && one.runRoot }))
  const thrower = boxMod.createProgramBox({ workspaceRoot: () => null, tempDir: J(TMPD, 'other'), makeRunner: () => { throw new Error('no runner') } })
  const th = await thrower.get()
  check('G: a runner that cannot be made is an answer "no", with the reason', th.ok === false && /no runner/.test(th.why))
  const stoppers = boxMod.createProgramBox({ workspaceRoot: () => null, tempDir: J(TMPD, 'two'), makeRunner: () => ({ ...playedRunner(), stopAll() { throw new Error('x') } }) })
  await stoppers.get()
  noWs.stopAll()
  check('G: stopAll ends every runner, and one that throws does not stop the others', made[0].stopped === 1 && (() => { try { stoppers.stopAll(); return true } catch { return false } })())
  put(J(TMPD, 'FrontierRun'), 'scratch\\stale1\\x.txt', 'stale')
  put(J(TMPD, 'FrontierRun'), 'specs\\old.json', '{}')
  await noWs.sweep()
  check('G: the sweep at start-up takes away a stale scratch folder and a stale spec file in a folder of runs that exists', !fs.existsSync(J(TMPD, 'FrontierRun', 'scratch', 'stale1')) && !fs.existsSync(J(TMPD, 'FrontierRun', 'specs', 'old.json')))
  await boxMod.createProgramBox({ workspaceRoot: () => null, tempDir: J(TMPD, 'never-made'), makeRunner }).sweep()
  check('G: and does nothing, and makes nothing, where there is no folder of runs', !fs.existsSync(J(TMPD, 'never-made')))

  // a fixed folder of runs (the window checks name one through FRONTIER_RUN_ROOT, which ipc.ts reads only when the app is not installed)
  const fixedDir = J(TMPD, 'fixed-runs')
  const fixedBox = boxMod.createProgramBox({ workspaceRoot: () => WS, tempDir: TMPD, fixedRunRoot: () => fixedDir, makeRunner })
  const fx = await fixedBox.get()
  check('G: a fixed folder of runs is used instead of the drive root and the temp folder, and is made', fx.ok && fx.runRoot.toLowerCase() === fixedDir.toLowerCase() && fs.existsSync(fixedDir), show(fx.ok ? fx.runRoot : fx))
  for (const [what, value] of [['a relative path', 'runs\\here'], ['a drive root', 'Q:\\'], ['a network path', '\\\\server\\share\\x'], ['an empty value', ''], ['a text with a NUL', `${fixedDir}\0x`], ['nothing', null]]) {
    const plainBox = boxMod.createProgramBox({ workspaceRoot: () => null, tempDir: J(TMPD, 'unfixed'), fixedRunRoot: () => value, makeRunner })
    const answer = await plainBox.get()
    check(`G: ${what} is not a fixed folder of runs: the usual choice is made (the temp folder here)`, answer.ok && answer.runRoot.toLowerCase() === J(TMPD, 'unfixed', 'FrontierRun').toLowerCase(), show(answer.ok ? answer.runRoot : answer))
  }
  const wiring = fs.readFileSync(`${REPO}/src/main/ipc.ts`, 'utf8')
  check('G: the wiring takes the folder from FRONTIER_RUN_ROOT only when the app is not installed', /FRONTIER_RUN_ROOT/.test(wiring) && /return value && !app\.isPackaged \? value : null/.test(wiring))

  // the sweep of a self-test that was cut off: its own files by their exact pattern, in the folders it is given, and nothing else
  const sweepDir = J(ROOT, 'sweep')
  fs.mkdirSync(sweepDir, { recursive: true })
  const ownFiles = ['selftest-canary-0123456789.txt', 'frontier-selftest-abcdef0123.txt', 'selftest-write-a1b2c3d4e5.txt']
  const decoys = ['selftest-canary-xyz.txt', 'my-selftest-canary-0123456789.txt', 'selftest-canary-0123456789.txt.bak', 'frontier-selftest-FEDCBA9876.txt', 'notes.txt']
  for (const f of [...ownFiles, ...decoys]) put(sweepDir, f, 'x')
  fs.mkdirSync(J(sweepDir, 'selftest-write-ffffffffff.txt'))
  const swept = await selfMod.sweepSelfTest([sweepDir, J(ROOT, 'no-such-folder')])
  check('G: the sweep of a test that was cut off removes the files the test names by its exact pattern, in the folders it is given, and nothing else (not a decoy, not a folder with such a name, nothing in a folder that is not there)', swept === 3 && ownFiles.every((f) => !fs.existsSync(J(sweepDir, f))) && decoys.every((f) => fs.existsSync(J(sweepDir, f))) && fs.statSync(J(sweepDir, 'selftest-write-ffffffffff.txt')).isDirectory() && !fs.existsSync(J(ROOT, 'no-such-folder')), show({ swept, left: fs.readdirSync(sweepDir) }))

  // the page's words
  const note = (args) => ({ tool: 'run_program', args })
  check('G: the chat shows a run as the program\'s file name, its arguments and the folder', notesMod.noteAbout(note({ program: 'C:\\Program Files\\nodejs\\node.exe', arguments: '["test.js","--name","two words"]', folder: 'src', copy: '3 files, 1 bytes' })) === 'node.exe test.js --name “two words” in “src”', notesMod.noteAbout(note({ program: 'C:\\Program Files\\nodejs\\node.exe', arguments: '["test.js","--name","two words"]', folder: 'src', copy: '3 files' })))
  const ranNote = (program) => notesMod.noteOutcomeText({ kind: 'ran-program', size: 10, program: { end: 'exited', exitCode: 0, ms: 1000, copied: 1, changed: 0, created: 0, deleted: 0, ...program } }, false, 'run_program')
  check('G: the chat says where what a run changed waits: for review in Tools, nothing changed until it is applied; and says nothing of it when nothing changed', /wait for you to review in Tools; nothing is changed until you apply them\./.test(ranNote({ changed: 1 })) && /wait for you to review in Tools/.test(ranNote({ created: 2 })) && !/review/.test(ranNote({})) && /wait for you to review/.test(notesMod.noteOutcomeText({ kind: 'ran-program', size: 0, program: { end: 'timed-out', exitCode: null, ms: 120000, copied: 1, changed: 1, created: 0, deleted: 0 } }, false, 'run_program')), ranNote({ changed: 1 }))
  check('G: no arguments, and arguments that are not JSON, still show something sensible', notesMod.noteAbout(note({ program: 'whoami.exe', arguments: '[]', folder: '.' })) === 'whoami.exe in “.”' && notesMod.noteAbout(note({ program: 'x.exe', arguments: 'not json', folder: '.' })) === 'x.exe in “.”' && notesMod.noteAbout({ tool: 'web_search', args: { query: 'hello' } }) === '“hello”' && notesMod.noteAbout({ tool: 'run_program', args: null }) === '')

  // the generic switch must not turn it on
  const enabled = []
  const store = { async read() { return { settings: { enabled: {}, caps: { steps: 5, seconds: 60 } }, problem: null } }, async write(s) { enabled.push(structuredClone(s)) } }
  const askedGeneric = []
  const gate = gateMod.createQuestionGate(async (o, q) => { askedGeneric.push(q); return true })
  const generic = toolSvcMod.createToolSettingsService({ store, registry, gate })
  const listed = (await generic.status()).tools.map((t) => t.id)
  check('G: the generic list of tools on the Tools page does not list the run tool (it has its own switch, with the self-test)', !listed.includes('run_program') && listed.includes('web_search'), listed.join())
  const tried = await generic.setEnabled('w', { tool: 'run_program', on: true })
  check('G: and the generic switch cannot turn it on: refused, nobody asked, nothing written', tried.ok === false && askedGeneric.length === 0 && enabled.length === 0, show(tried))
  const triedOff = await generic.setEnabled('w', { tool: 'run_program', on: false })
  check('G: nor does it handle switching it off (that is the run switch\'s too)', triedOff.ok === false && enabled.length === 0)

  // the source
  const src = (rel) => fs.readFileSync(`${REPO}/${rel}`, 'utf8')
  const code = (rel) => src(rel).replace(/^\s*\/\/.*$/gm, '')
  check('G: the self-test starts no program of its own (everything it runs goes through the runner) and has no Electron import', !/child_process|spawn\(|exec\(|execFile/.test(code('src/main/selfTest.ts')) && !/from ['"]electron['"]/.test(code('src/main/selfTest.ts')))
  check('G: the self-test\'s only network code is the listener on this computer\'s loopback, closed afterwards', /listen\(0, '127\.0\.0\.1'/.test(code('src/main/selfTest.ts')) && !/fetch\(|https?:\/\//.test(code('src/main/selfTest.ts')) && /server\.close\(\)/.test(code('src/main/selfTest.ts')))
  check('G: the service and the folder of runs have no Electron import and no process start', ['src/main/programService.ts', 'src/main/programBox.ts', 'src/main/runProposals.ts'].every((f) => !/from ['"]electron['"]|child_process/.test(code(f))))
  check('G: bringing back writes nothing: the only file call is a read (readFile)', [...code('src/main/runProposals.ts').matchAll(/fs\.(\w+)\(/g)].every((m) => m[1] === 'readFile'))
  check('G: there is no way to switch it on that skips the test: the service writes the setting `true` in one place, after the test and the question', (code('src/main/programService.ts').match(/write\(true, false\)/g) ?? []).length === 1 && code('src/main/programService.ts').indexOf('write(true, false)') > code('src/main/programService.ts').indexOf('gate.ask(') && code('src/main/programService.ts').indexOf('gate.ask(') > code('src/main/programService.ts').indexOf('testNow()'))
  check('G: the run tool is offered to a reply only through withPrograms (available, with a folder chosen): ipc.ts uses it', /withPrograms\(/.test(src('src/main/ipc.ts')) && /programService\.available\(\)/.test(src('src/main/ipc.ts')))
})

check('the guard under the real file system refused nothing during the run (the code under test touched nothing outside the folders it was given)', fsGuard.refusals.length === 0, show(fsGuard.refusals.slice(0, 3)))
const ok = check.summary()
process.exit(ok ? 0 : 1)
