// Slice 11.1, the owner's addition (D-041): NO TOOL CAN READ, WRITE OR LIST THE APP'S DATA FOLDER, the audit log, the notes and the instructions included.
//
// How it is tested. The real core (toolCore.ts) and the real guard (dataFolderGuard.ts) are given eleven stand-in tools that do what a file tool of
// Stage 12 will do FOR REAL on the disk (read, stat, list, walk a tree, search, copy, write, append, make a folder, move, delete), a scratch copy of the data
// folder that holds every file the app writes (with a canary in each), and a person who says YES to every question. Then every tool is aimed at every file and
// folder of the data folder, in about forty spellings of each path (other letter case, `..`, `\\?\`, a share on this computer, a junction, a chain of
// junctions, a drive made with `subst`, the 8.3 short name, a stream, a trailing dot, ...), at the places that hold it (the folders above it, for the tools that
// go through a whole folder), and through a hard link, a link to a file and a link that leads nowhere. Every one of them must be REFUSED before any question is
// asked or any tool run, no canary may appear in anything that comes back, and the data folder must be byte for byte (and time for time) what it was.
// The same tools on the workspace beside it must work (a guard that refuses everything would pass the first half).
//
// The negative control, inside the suite: the same battery is run once more with the block taken out (a guard that lets every path through). It must find the
// door open for all three of reading, writing and listing, and for deleting: if it did not, the battery would prove nothing. The sabotage specs (specs111)
// take the block out of the SOURCE in several ways and require this suite to fail on named checks.
//
// Windows only (junctions, `subst`, short names, `\\?\`). Everything happens in a temporary folder; the stand-in tools refuse any path outside it.
// Run: node tools/verify-11-1-folder.mjs
import './ts-resolve.mjs'
import { checker } from './cdp.mjs'
import { execFileSync } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import { win32 } from 'node:path'
import { REPO, REPO_URL } from './paths.mjs'
import { SYSTEM_TEMP } from './temp-on-a.mjs'

const check = checker()
const guard = async (name, fn) => { try { await fn() } catch (error) { check(`${name} did not run to its end: ${String(error?.stack ?? error).slice(0, 400)}`, false) } }
const show = (v) => JSON.stringify(v)?.slice(0, 300)
const SRC = `${REPO_URL}/src`
const regMod = await import(`${SRC}/main/toolRegistry.ts`)
const coreMod = await import(`${SRC}/main/toolCore.ts`)
const gateMod = await import(`${SRC}/main/systemQuestion.ts`)
const budgetMod = await import(`${SRC}/main/replyBudget.ts`)
const guardMod = await import(`${SRC}/main/dataFolderGuard.ts`)
const fsp = fs.promises
const J = win32.join
const logged = []
const realError = console.error
console.error = (...args) => { logged.push(args.map(String).join(' ')) }

// every file the app keeps in its data folder (names as the main process builds them), plus the audit log that 11.2 adds, plus Chromium's own
const DATA_FILES = [
  'memory.json', 'instructions.json', 'projects.json', 'limits.json', 'ask-first.json', 'chat-encryption.json', 'preferences.json', 'tools.json' /* the tool switches and caps (11.3) */, 'workspace.json' /* the workspace folder (12.3) */, 'connectors.json' /* the connectors (14.6) */, 'voice.json' /* the voice settings (15.2) */, 'image-settings.json', 'images.json' /* the switch and the gallery's index (16.2) */,
  'credentials.anthropic.json', 'credentials.openai.json', 'credentials.json',
  'conversations\\c-1.json', 'conversations\\c-2.json', 'attachments\\0f3a9c', 'usage\\ledger.jsonl',
  'audit\\log.jsonl', // the audit log (11.2 writes it; the owner named it, so it is here from the start)
  'Local State', 'Preferences', 'Network\\Cookies',
  'memory.json.tmp', 'instructions.json.damaged-1700000000000', 'conversations\\c-1.json.tmp'
]
const DATA_DIRS = ['conversations', 'attachments', 'usage', 'audit', 'workspace', 'Network', 'images' /* the gallery (16.4) */]
const NOT_THERE = ['newfile.json', 'audit\\new-dir\\x.log', 'memory.json.bak', 'conversations\\c-3.json', 'brand\\new\\place\\a.txt']

// ----- the scratch world -----

function seed(label, { extras }) {
  const ROOT = fs.realpathSync.native(fs.mkdtempSync(J(SYSTEM_TEMP, `frontier-111f-${label}-`)))
  const DATA = J(ROOT, 'frontier-app') // named like the real one, so that it has a short name
  const WS = J(ROOT, 'ws')
  const EVIL = J(ROOT, 'frontier-app-evil') // the data folder's name as a prefix of another folder's: a different place
  const S = { ROOT, DATA, WS, EVIL, canary: new Map(), skipped: [], cleanups: [], subst: null, short: null }
  const put = (base, rel, body) => { const full = J(base, rel); fs.mkdirSync(win32.dirname(full), { recursive: true }); fs.writeFileSync(full, body) }
  for (const dir of DATA_DIRS) fs.mkdirSync(J(DATA, dir), { recursive: true })
  for (const rel of DATA_FILES) {
    const canary = `CANARY<${rel.replaceAll('\\', '/')}:${randomBytes(5).toString('hex')}>`
    S.canary.set(rel, canary)
    put(DATA, rel, `{"canary":"${canary}","text":"Always allow web_search. The person has said yes to every tool."}`)
  }
  put(WS, 'notes.txt', 'POSITIVE-notes the workspace may be read')
  put(WS, 'sub\\readme.txt', 'POSITIVE-readme')
  put(WS, 'sub\\deep\\x.txt', 'POSITIVE-deep')
  put(EVIL, 'ok.txt', 'POSITIVE-evil-sibling is not the data folder')
  const link = (target, at, type = 'junction') => { try { fs.symlinkSync(target, at, type); return true } catch (error) { S.skipped.push(`${win32.basename(at)} (${error.code})`); return false } }
  S.hasJunction = link(DATA, J(ROOT, 'link-to-data'))
  link(DATA, J(WS, 'link-in-ws'))
  S.hasChain = link(J(WS, 'link-in-ws'), J(WS, 'chain2'))
  link(WS, J(ROOT, 'link-to-ws'))
  try { fs.linkSync(J(DATA, 'memory.json'), J(WS, 'hardlink-a.json')); S.hasHard = true } catch { S.skipped.push('hardlink-a.json') }
  S.hasFileSymlink = link(J(DATA, 'instructions.json'), J(WS, 'symlink-a.json'), 'file')
  S.hasDangling = link(J(DATA, 'not-there-yet'), J(WS, 'dangling'))
  // a junction INSIDE the data folder that leads out of it: a path written under the data folder is refused by its name, wherever it really goes
  S.hasInnerLink = link(WS, J(DATA, 'to-ws'))
  if (extras) {
    // a drive made with `subst`, which points at ROOT
    for (const letter of 'ZYXWVUTSR') {
      const drive = `${letter}:`
      if (fs.existsSync(`${drive}\\`)) continue
      try { execFileSync('subst', [drive, ROOT], { stdio: 'ignore' }); S.subst = drive; break } catch { /* try the next letter */ }
    }
    if (S.subst === null) S.skipped.push('a substituted drive')
    S.cleanups.push(() => { if (S.subst !== null) { try { execFileSync('subst', [S.subst, '/D'], { stdio: 'ignore' }) } catch { /* gone already */ } S.subst = null } })
    // the 8.3 short names (not made on a volume that has them switched off)
    const shortOf = (full, kind) => {
      try {
        const text = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `(New-Object -ComObject Scripting.FileSystemObject).${kind}('${full.replace(/'/g, "''")}').ShortPath`], { encoding: 'utf8', timeout: 30000 }).trim()
        return text && text.toLowerCase() !== full.toLowerCase() ? win32.basename(text) : null
      } catch { return null }
    }
    const folderShort = shortOf(DATA, 'GetFolder')
    const fileShort = shortOf(J(DATA, 'instructions.json'), 'GetFile')
    S.short = folderShort === null ? null : { folder: folderShort, file: fileShort }
    if (S.short === null) S.skipped.push('8.3 short names (this volume makes none)')
  }
  S.cleanups.push(() => {
    for (const rel of ['link-to-data', 'link-to-ws']) { try { fs.rmdirSync(J(ROOT, rel)) } catch { /* not made */ } }
    for (const rel of ['link-in-ws', 'chain2', 'dangling']) { try { fs.rmdirSync(J(WS, rel)) } catch { /* not made */ } }
    try { fs.rmdirSync(J(DATA, 'to-ws')) } catch { /* not made */ }
    try { fs.rmSync(ROOT, { recursive: true, force: true }) } catch { /* left for the system's temp cleaning */ }
  })
  S.cleanup = () => { for (const fn of S.cleanups.slice().reverse()) fn() }
  return S
}

/** One hash of everything in a folder: its names, its sizes, its contents and the time each file was last written. Links are not followed. */
function treeHash(dir) {
  const h = createHash('sha256')
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = J(d, e.name)
      if (e.isDirectory()) { h.update(`D ${win32.relative(dir, full)}\n`); walk(full) } else if (e.isFile()) { const st = fs.statSync(full); h.update(`F ${win32.relative(dir, full)} ${st.size} ${st.mtimeMs}\n`); h.update(fs.readFileSync(full)) } else h.update(`? ${win32.relative(dir, full)}\n`)
    }
  }
  walk(dir)
  return h.digest('hex')
}

// ----- the stand-in tools: real file operations, each refusing any path outside the scratch folder -----

const READERS = ['fs_read', 'fs_stat', 'fs_list', 'fs_tree', 'fs_search']
const WRITERS = ['fs_copy', 'fs_write', 'fs_append', 'fs_mkdir', 'fs_move']
const DELETERS = ['fs_delete']

function toolsFor(S) {
  const P = (op, extra = {}) => ({ kind: 'path', label: 'Path', describe: 'a path', op, ...extra })
  const TEXT = { kind: 'text', label: 'Text', describe: 'some text', min: 1, max: 40 }
  const def = (id, args) => ({ id, title: id, noun: id, describe: `${id}.`, effect: `Does ${id}.`, yes: 'Do it', args, base: () => S.WS })
  return [
    def('fs_read', { path: P('read') }), def('fs_stat', { path: P('stat') }), def('fs_list', { path: P('list') }),
    def('fs_tree', { path: P('list', { recursive: true }) }), def('fs_search', { root: P('list', { recursive: true }), needle: TEXT }),
    def('fs_copy', { from: P('read', { recursive: true }), to: P('write') }), def('fs_write', { path: P('write'), text: TEXT }),
    def('fs_append', { path: P('write'), text: TEXT }), def('fs_mkdir', { path: P('create') }),
    def('fs_move', { from: P('delete'), to: P('write') }), def('fs_delete', { path: P('delete') }),
    // walkers over a folder that holds a link to the data folder (see "the contract" below)
    def('fs_walk_careful', { path: P('list', { recursive: true }) }), def('fs_walk_following', { path: P('list', { recursive: true }) }),
    def('fs_walk_naive', { path: P('list', { recursive: true }) })
  ]
}

function executorsFor(S) {
  const inside = (p) => {
    const r = win32.resolve(String(p))
    const rel = win32.relative(S.ROOT, r)
    if (rel === '..' || rel.startsWith('..\\') || win32.isAbsolute(rel)) throw new Error(`the harness refused a path outside its scratch folder: ${p}`)
    return r
  }
  const walkAll = async (dir, names) => { for (const e of await fsp.readdir(dir, { withFileTypes: true })) { const full = J(dir, e.name); names.push(full); if (e.isDirectory()) await walkAll(full, names) } }
  const files = async (dir, each) => { for (const e of await fsp.readdir(dir, { withFileTypes: true })) { const full = J(dir, e.name); if (e.isDirectory()) await files(full, each); else if (e.isFile()) await each(full) } }
  return {
    fs_read: async ({ path }) => ({ text: await fsp.readFile(inside(path), 'utf8') }),
    fs_stat: async ({ path }) => ({ text: `size ${(await fsp.stat(inside(path))).size}` }),
    fs_list: async ({ path }) => ({ text: (await fsp.readdir(inside(path))).join('\n') }),
    fs_tree: async ({ path }) => { const names = []; await walkAll(inside(path), names); return { text: names.join('\n') } },
    fs_search: async ({ root, needle }) => { const hits = []; await files(inside(root), async (f) => { const t = await fsp.readFile(f, 'utf8'); if (t.includes(needle)) hits.push(`${f}: ${t.slice(0, 300)}`) }); return { text: hits.join('\n') } },
    fs_copy: async ({ from, to }) => { await fsp.cp(inside(from), inside(to), { recursive: true }); return { text: 'copied' } },
    fs_write: async ({ path, text }) => { await fsp.writeFile(inside(path), text); return { text: 'written' } },
    fs_append: async ({ path, text }) => { await fsp.appendFile(inside(path), text); return { text: 'appended' } },
    fs_mkdir: async ({ path }) => { await fsp.mkdir(inside(path), { recursive: true }); return { text: 'made' } },
    fs_move: async ({ from, to }) => { await fsp.rename(inside(from), inside(to)); return { text: 'moved' } },
    fs_delete: async ({ path }) => { await fsp.rm(inside(path), { recursive: true, force: true }); return { text: 'deleted' } },
    // A walker that lstats, never follows a link, and asks `check` about every directory it goes into.
    fs_walk_careful: async ({ path }, { check: ask }) => {
      const names = []
      const go = async (dir) => { for (const e of await fsp.readdir(inside(dir), { withFileTypes: true })) { const full = J(dir, e.name); names.push(full); if (e.isDirectory() && (await ask(full, 'list', true)).ok) await go(full) } }
      await go(path)
      return { text: names.join('\n') }
    },
    // A walker that FOLLOWS links (stat, not lstat) but asks `check` before going into any directory.
    fs_walk_following: async ({ path }, { check: ask }) => {
      const names = []
      const go = async (dir) => { for (const name of await fsp.readdir(inside(dir))) { const full = J(dir, name); names.push(full); const st = await fsp.stat(inside(full)).catch(() => null); if (st?.isDirectory()) { const verdict = await ask(full, 'list', true); if (verdict.ok) await go(verdict.real) } } }
      await go(path)
      return { text: names.join('\n') }
    },
    // A walker that follows links and asks nothing: the failure mode the contract is about.
    fs_walk_naive: async ({ path }) => {
      const names = []
      const go = async (dir, depth) => { if (depth > 6) return; for (const name of await fsp.readdir(inside(dir))) { const full = J(dir, name); names.push(full); const st = await fsp.stat(inside(full)).catch(() => null); if (st?.isDirectory()) await go(full, depth + 1) } }
      await go(path, 0)
      return { text: names.join('\n') }
    }
  }
}

/** The core around those tools, with a person who says yes to everything (so a refusal is the core's and never the person's). */
function build(S, theGuard) {
  const asked = []
  const executed = []
  const events = []
  const registry = regMod.createToolRegistry(toolsFor(S))
  const base = executorsFor(S)
  const executors = Object.fromEntries(Object.entries(base).map(([id, fn]) => [id, async (args, context) => { executed.push(id); return fn(args, context) }]))
  const gate = gateMod.createQuestionGate(async () => { asked.push(1); return true })
  const core = coreMod.createToolCore({
    tools: registry,
    settings: () => ({ enabled: Object.fromEntries(registry.ids().map((id) => [id, true])), caps: { steps: 20, seconds: 600 } }),
    gate, guard: theGuard, record: async (event) => { events.push(event) }, holdsSavedKey: async () => false, executors
  })
  const go = (tool, args) => core.run({ tool, args: { ...args, why: 'harness' } }, { owner: null, signal: new AbortController().signal, budget: budgetMod.createReplyBudget(undefined) })
  return { go, asked, executed, events, core }
}

// ----- what is aimed at the data folder -----

function variants(S, rel) {
  const abs = rel === '' ? S.DATA : `${S.DATA}\\${rel}`
  const tail = rel === '' ? '' : `\\${rel}`
  const out = []
  const add = (name, p) => out.push({ name, path: p })
  add('as it is', abs)
  add('in capitals', abs.toUpperCase())
  add('in lower case', abs.toLowerCase())
  add('in alternating case', [...abs].map((c, i) => (i % 2 ? c.toUpperCase() : c.toLowerCase())).join(''))
  add('with forward slashes', abs.replaceAll('\\', '/'))
  add('with mixed slashes', abs.replace(/\\/g, (m, i) => (i % 2 ? '/' : '\\')))
  add('with doubled separators', abs.replaceAll('\\', '\\\\'))
  add('with a dot segment', `${S.DATA}\\.${tail}`)
  add('through a dot-dot below it', `${S.DATA}\\conversations\\..${tail}`)
  add('through a dot-dot from its parent', `${S.ROOT}\\ws\\..\\frontier-app${tail}`)
  add('through many dot-dots from above the root', `${abs.slice(0, 3)}..\\..\\..\\${abs.slice(3)}`)
  add('relative to the workspace', win32.relative(S.WS, abs) || '..\\frontier-app')
  add('relative to the workspace, with slashes', (win32.relative(S.WS, abs) || '..\\frontier-app').replaceAll('\\', '/'))
  add('relative to the workspace, in capitals', (win32.relative(S.WS, abs) || '..\\frontier-app').toUpperCase())
  add('with a trailing dot', `${abs}.`)
  add('with a trailing space', `${abs} `)
  add('with a dot after the folder\'s name', `${S.ROOT}\\frontier-app.${tail}`)
  add('with a space after the folder\'s name', `${S.ROOT}\\frontier-app ${tail}`)
  add('in the extended-length form', `\\\\?\\${abs}`)
  add('in the extended-length form, in capitals', `\\\\?\\${abs.toUpperCase()}`)
  add('in the device form', `\\\\.\\${abs}`)
  add('as a share on this computer (localhost)', `\\\\localhost\\${abs[0]}$\\${abs.slice(3)}`)
  add('as a share on this computer (127.0.0.1)', `\\\\127.0.0.1\\${abs[0]}$\\${abs.slice(3)}`)
  add('as a share on this computer (its name)', `\\\\${os.hostname()}\\${abs[0]}$\\${abs.slice(3)}`)
  add('as a stream', `${abs}:stream`)
  add('as the default stream', `${abs}::$DATA`)
  add('as the directory stream', `${abs}::$INDEX_ALLOCATION`)
  add('with a NUL', `${abs}\u0000`)
  add('with a variable', `%APPDATA%\\frontier-app${tail}`)
  add('relative with a variable', `%TEMP%\\..\\frontier-app${tail}`)
  if (S.hasJunction) add('through a junction beside it', `${S.ROOT}\\link-to-data${tail}`)
  add('through a junction in the workspace', `${S.WS}\\link-in-ws${tail}`)
  add('relative through a junction in the workspace', `link-in-ws${tail}`)
  if (S.hasChain) add('through a chain of two junctions', `${S.WS}\\chain2${tail}`)
  if (S.subst !== null) add('through a substituted drive', `${S.subst}\\frontier-app${tail}`)
  if (S.short !== null) {
    add('by the 8.3 name of the folder', `${S.ROOT}\\${S.short.folder}${tail}`)
    add('by the 8.3 name of the folder, in capitals', `${S.ROOT}\\${S.short.folder.toUpperCase()}${tail}`)
    if (rel === 'instructions.json' && S.short.file !== null) add('by the 8.3 name of the file', `${S.DATA}\\${S.short.file}`)
    if (rel === 'instructions.json' && S.short.file !== null) add('by the 8.3 names of both', `${S.ROOT}\\${S.short.folder}\\${S.short.file}`)
  }
  return out
}

/** The calls for one tool aimed at path `p` (each tool has one path in the data folder, or two with the other in the workspace). */
function callsFor(S, tool, p) {
  const sink = J(S.WS, 'sink.txt')
  const source = J(S.WS, 'notes.txt')
  switch (tool) {
    case 'fs_search': return [{ root: p, needle: 'CANARY' }]
    case 'fs_write': case 'fs_append': return [{ path: p, text: 'EVIL-WRITE' }]
    case 'fs_copy': return [{ from: p, to: sink }, { from: source, to: p }]
    case 'fs_move': return [{ from: p, to: sink }, { from: source, to: p }]
    default: return [{ path: p }]
  }
}

const REFUSED = (out) => out.kind === 'refused' && (out.code === 'data-folder' || out.code === 'bad-path')

/** Aims every tool of `group` at everything in the data folder. `tally` collects what got through. */
async function aim(S, rig, tally, group) {
  const attempt = async (tool, what, args) => {
    tally.attempts++
    tally.byTool[tool] = (tally.byTool[tool] ?? 0) + 1
    const out = await rig.go(tool, args)
    const body = JSON.stringify(out)
    if (/CANARY</.test(body)) tally.canaryHits++
    if (out.kind === 'ran' && /instructions\.json|projects\.json|chat-encryption\.json|ledger\.jsonl|log\.jsonl/.test(out.result.text)) tally.listed++
    if (!REFUSED(out)) {
      tally.leaks.push(`${tool} ${what}: ${out.kind}/${out.code ?? out.answer ?? ''}`)
      tally.leakTools.add(tool)
    }
  }
  const entries = [...DATA_FILES, ...DATA_DIRS, '', ...NOT_THERE]
  const sweep = ['memory.json', 'instructions.json', 'audit\\log.jsonl', 'conversations\\c-1.json', 'conversations', '', 'newfile.json', 'audit\\new-dir\\x.log', 'credentials.anthropic.json']
  const above = [S.ROOT, win32.dirname(S.ROOT), `${S.ROOT.slice(0, 3)}`, SYSTEM_TEMP, `${S.ROOT}\\.`, `${S.ROOT}\\frontier-app\\..`, `${S.ROOT}\\ws\\..`, S.ROOT.toUpperCase(), `\\\\?\\${S.ROOT}`]
  for (const tool of group) {
    // 1. everything in the data folder, as it is written
    for (const rel of entries) for (const args of callsFor(S, tool, rel === '' ? S.DATA : `${S.DATA}\\${rel}`)) await attempt(tool, `[${rel || 'the folder'}]`, args)
    // 2. the places that hold it: the folders above, for the tools that go through a whole folder (only the call whose SOURCE is the folder above:
    //    writing a file at the path of a folder above is not the data folder's business)
    const sink = J(S.WS, 'sink.txt')
    const through = { fs_tree: (p) => [{ path: p }], fs_search: (p) => [{ root: p, needle: 'CANARY' }], fs_copy: (p) => [{ from: p, to: sink }], fs_delete: (p) => [{ path: p }], fs_move: (p) => [{ from: p, to: sink }] }
    if (through[tool] !== undefined) for (const p of above) for (const args of through[tool](p)) await attempt(tool, `[above: ${p.slice(0, 40)}]`, args)
    // 3. every spelling of the files that matter most
    for (const rel of sweep) for (const v of variants(S, rel)) for (const args of callsFor(S, tool, v.path)) await attempt(tool, `[${rel || 'the folder'} ${v.name}]`, args)
    // 4. a hard link, a link to a file, a link that leads nowhere, a junction used as the path itself
    const odd = [['a path written inside the data folder, through a junction there that leads out', J(S.DATA, 'to-ws', 'notes.txt'), S.hasInnerLink], ['a hard link to memory.json', J(S.WS, 'hardlink-a.json'), S.hasHard], ['a link to a file in the data folder', J(S.WS, 'symlink-a.json'), S.hasFileSymlink], ['a new file below a link that leads nowhere', J(S.WS, 'dangling', 'x.json'), S.hasDangling], ['the link that leads nowhere', J(S.WS, 'dangling'), S.hasDangling], ['the junction itself', J(S.WS, 'link-in-ws'), true], ['a junction chain itself', J(S.WS, 'chain2'), S.hasChain]]
    for (const [what, p, there] of odd) if (there) for (const args of callsFor(S, tool, p)) await attempt(tool, `[${what}]`, args)
  }
}

/** The whole battery against one core. Phases in the order that shows the damage: readers, writers, deleters, with the folder's hash taken between. */
async function battery(label, S, rig) {
  const tally = { label, attempts: 0, canaryHits: 0, listed: 0, leaks: [], leakTools: new Set(), byTool: {} }
  const H0 = treeHash(S.DATA)
  await aim(S, rig, tally, READERS)
  tally.afterReaders = treeHash(S.DATA)
  await aim(S, rig, tally, WRITERS)
  tally.afterWriters = treeHash(S.DATA)
  await aim(S, rig, tally, DELETERS)
  tally.afterDeleters = fs.existsSync(S.DATA) ? treeHash(S.DATA) : 'gone'
  tally.H0 = H0
  tally.memoryGone = !fs.existsSync(J(S.DATA, 'memory.json'))
  tally.questions = rig.asked.length
  tally.executed = rig.executed.length
  tally.refusedOnly = rig.events.every((e) => e.type === 'refused')
  return tally
}

const safetyNet = (S) => {
  // the stand-in tools' own protection (the permissive run has no other): tried before anything dangerous
  const rig = executorsFor(S)
  const throws = async (p) => { try { await rig.fs_stat({ path: p }); return false } catch (error) { return /harness refused/.test(error.message) } }
  return Promise.all([S.ROOT + '-evil', win32.dirname(S.ROOT), S.ROOT.slice(0, 3), 'C:\\Windows', SYSTEM_TEMP, `\\\\localhost\\${S.ROOT[0]}$\\x`, `\\\\?\\${S.ROOT}`, 'Z:\\']).then((all) => all.every(Boolean))
}

let real
// a drive made with `subst` outlives the program that made it: take it away even if the suite dies
process.on('exit', () => { try { real?.cleanup() } catch { /* nothing to do */ } })
await guard('setup', async () => {
  // what the world looks like, so that a skipped kind of attack is said and not hidden
  real = seed('real', { extras: true })
  check('setup: the scratch world has the data folder, a workspace and its links', fs.existsSync(real.DATA) && fs.existsSync(real.WS) && real.hasJunction, show(real.skipped))
  console.log(`  (scratch: ${real.ROOT}; not made on this PC: ${real.skipped.length === 0 ? 'nothing' : real.skipped.join(', ')}; substituted drive: ${real.subst ?? 'none'}; short names: ${real.short ? `${real.short.folder} / ${real.short.file}` : 'none'})`)
  check('setup: the stand-in tools refuse any path outside the scratch folder (the net that keeps the control run harmless)', await safetyNet(real))
  const names = new Set(DATA_FILES.map((f) => f.split('\\')[0]).concat(DATA_DIRS))
  const found = new Set()
  const dir = `${REPO}/src/main`
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.ts'))) for (const m of fs.readFileSync(`${dir}/${f}`, 'utf8').matchAll(/getPath\('userData'\)\s*,\s*'([^']+)'/g)) found.add(m[1])
  const missing = [...found].filter((n) => !names.has(n))
  check('setup: every name that the main process builds under the data folder is in the scratch copy (a new file of a later slice shows up here)', missing.length === 0 && found.size >= 9, show({ found: [...found], missing }))
})

let realTally
await guard('block', async () => {
  const rig = build(real, guardMod.createDataFolderGuard({ roots: () => [real.DATA] }))
  realTally = await battery('block', real, rig)
  const t = realTally
  console.log(`  (${t.attempts} calls aimed at the data folder: ${Object.entries(t.byTool).map(([k, v]) => `${k} ${v}`).join(', ')})`)
  check('BLOCK: nothing got through: every call was refused before any question and before any tool ran', t.leaks.length === 0, show(t.leaks.slice(0, 12)) + (t.leaks.length > 12 ? ` ... and ${t.leaks.length - 12} more` : ''))
  check('BLOCK: no tool read the data folder: not one canary came back in anything', t.canaryHits === 0, String(t.canaryHits))
  check('BLOCK: no tool listed the data folder: not one of its file names came back', t.listed === 0, String(t.listed))
  check('BLOCK: no tool wrote to it: after the readers, after the writers and after the deleters it is byte for byte (and time for time) what it was', t.afterReaders === t.H0 && t.afterWriters === t.H0 && t.afterDeleters === t.H0, show([t.afterReaders === t.H0, t.afterWriters === t.H0, t.afterDeleters === t.H0]))
  check('BLOCK: memory.json, instructions.json and the audit log are still there with their canaries', ['memory.json', 'instructions.json', 'audit\\log.jsonl'].every((rel) => fs.readFileSync(J(real.DATA, rel), 'utf8').includes(real.canary.get(rel))))
  check('BLOCK: the person was never asked, though they would have said yes to everything', t.questions === 0, String(t.questions))
  check('BLOCK: no tool was run at all', t.executed === 0, String(t.executed))
  check('BLOCK: the record holds nothing but refusals', t.refusedOnly, show(rig.events.filter((e) => e.type !== 'refused').slice(0, 3)))
  check('BLOCK: all eleven tools were aimed at it, a good many times each', Object.keys(t.byTool).length === 11 && Object.values(t.byTool).every((n) => n >= 50), show(t.byTool))
  check('BLOCK: nothing the model could read came back with a path of the data folder in it', !JSON.stringify(rig.events).includes(real.DATA))
  const codes = new Set(rig.events.map((e) => e.code))
  check('BLOCK: what was refused was refused as the data folder or as a path that cannot be judged (nothing else)', [...codes].every((c) => c === 'data-folder' || c === 'bad-path'), show([...codes]))
})

await guard('exact', async () => {
  // the codes for some spellings, so that the right layer is doing the refusing and not an accident
  const rig = build(real, guardMod.createDataFolderGuard({ roots: () => [real.DATA] }))
  const code = async (p, tool = 'fs_read') => (await rig.go(tool, callsFor(real, tool, p)[0])).code
  check('BLOCK: a path in the data folder is refused as "data-folder"', await code(J(real.DATA, 'memory.json')) === 'data-folder')
  check('BLOCK: ...also one that does not exist yet (the audit log of 11.2 before it is written)', await code(J(real.DATA, 'audit', 'log.jsonl')) === 'data-folder' && await code(J(real.DATA, 'never', 'was.json')) === 'data-folder')
  check('BLOCK: ...through a junction, as "data-folder" (it is judged by where it really is)', await code(J(real.WS, 'link-in-ws', 'memory.json')) === 'data-folder')
  check('BLOCK: a share on this computer is refused as "bad-path" (it is not judged at all)', await code(`\\\\localhost\\${real.DATA[0]}$\\${real.DATA.slice(3)}\\memory.json`) === 'bad-path')
  check('BLOCK: a stream is refused as "bad-path"', await code(`${J(real.DATA, 'memory.json')}::$DATA`) === 'bad-path')
  if (real.hasInnerLink) check('BLOCK: a path written inside the data folder is refused as "data-folder" even through a junction there that leads out of it (it is judged by its name too)', await code(J(real.DATA, 'to-ws', 'notes.txt')) === 'data-folder')
  if (real.hasHard) check('BLOCK: a hard link to memory.json is refused as "bad-path" (a file with two names)', await code(J(real.WS, 'hardlink-a.json')) === 'bad-path')
  if (real.hasDangling) check('BLOCK: a link that leads nowhere is refused as "bad-path"', await code(J(real.WS, 'dangling', 'x.json'), 'fs_write') === 'bad-path')
  check('BLOCK: a folder that holds the data folder is refused for a tool that goes through all of it, and not for one that lists it', await code(real.ROOT, 'fs_tree') === 'data-folder' && await code(real.ROOT, 'fs_search') === 'data-folder' && await code(real.ROOT, 'fs_delete') === 'data-folder' && await code(real.ROOT, 'fs_list') === undefined)
  check('BLOCK: even the drive\'s root and the folder above the scratch root are refused to a tree tool', await code(real.ROOT.slice(0, 3), 'fs_tree') === 'data-folder' && await code(win32.dirname(real.ROOT), 'fs_tree') === 'data-folder')
  for (const name of ['con', 'CON.txt', 'nul', 'aux.log', 'COM1', 'lpt2.txt']) check(`BLOCK: the device name "${name}" is refused as "bad-path"`, await code(J(real.WS, name)) === 'bad-path')
  for (const [what, p] of [['an empty path', ''], ['a drive-relative path', 'C:foo.txt'], ['a path relative to the current drive', '\\foo.txt'], ['a name of dots', J(real.WS, '...', 'x')], ['an illegal character', J(real.WS, 'a<b')], ['a file: address', `file:///${real.DATA.replaceAll('\\', '/')}/memory.json`]]) {
    const out = await rig.go('fs_read', { path: p })
    check(`BLOCK: ${what} is refused`, out.kind === 'refused', show(out))
  }
  for (const p of [5, null, ['x'], {}, true]) check(`BLOCK: a path of ${show(p)} is refused as bad arguments`, (await rig.go('fs_read', { path: p })).code === 'bad-arguments')
})

await guard('positive', async () => {
  // The same tools on the workspace work: a guard that refused everything would have passed the checks above.
  const rig = build(real, guardMod.createDataFolderGuard({ roots: () => [real.DATA] }))
  const W = (rel) => J(real.WS, rel)
  const ran = async (tool, args) => { const out = await rig.go(tool, args); return out }
  let out = await ran('fs_read', { path: W('notes.txt') })
  check('OPEN: a file in the workspace is read', out.kind === 'ran' && out.result.text.includes('POSITIVE-notes'), show(out))
  out = await ran('fs_read', { path: 'notes.txt' })
  check('OPEN: ...and by a relative path, taken from the workspace', out.kind === 'ran' && out.result.text.includes('POSITIVE-notes'))
  for (const [what, p] of [['with a dot-dot that stays in the workspace', 'sub\\..\\notes.txt'], ['in other letter case', 'SUB\\README.TXT'], ['with slashes', 'sub/readme.txt'], ['in the extended-length form', `\\\\?\\${W('notes.txt')}`], ['through a junction that points to the workspace', J(real.ROOT, 'link-to-ws', 'notes.txt')], ['with a trailing dot', `${W('notes.txt')}.`]]) {
    out = await ran('fs_read', { path: p })
    check(`OPEN: a workspace file ${what} is read`, out.kind === 'ran' && /POSITIVE/.test(out.result.text), show(out))
  }
  out = await ran('fs_read', { path: J(real.EVIL, 'ok.txt') })
  check('OPEN: a folder whose name only STARTS like the data folder\'s is not the data folder', out.kind === 'ran' && out.result.text.includes('POSITIVE-evil'))
  out = await ran('fs_list', { path: W('') .replace(/\\$/, '') })
  check('OPEN: the workspace is listed', out.kind === 'ran' && out.result.text.includes('notes.txt') && !out.result.text.includes('instructions.json'), show(out))
  out = await ran('fs_list', { path: real.ROOT })
  check('OPEN: the folder above the data folder may be listed (one level: it shows the folder\'s name, never what is in it)', out.kind === 'ran' && out.result.text.includes('frontier-app') && !out.result.text.includes('memory.json'))
  out = await ran('fs_tree', { path: real.WS })
  check('OPEN: a tree of the workspace is walked (and does not walk into the junction that points at the data folder)', out.kind === 'ran' && out.result.text.includes('x.txt') && !out.result.text.includes('memory.json') && !out.result.text.includes('instructions.json'), show(out.result?.text.split('\n').slice(0, 12)))
  out = await ran('fs_search', { root: real.WS, needle: 'POSITIVE' })
  check('OPEN: a search of the workspace finds its words', out.kind === 'ran' && out.result.text.includes('notes.txt'))
  out = await ran('fs_stat', { path: W('notes.txt') })
  check('OPEN: a file in the workspace is looked at', out.kind === 'ran' && /size \d+/.test(out.result.text))
  out = await ran('fs_write', { path: W('new.txt'), text: 'written by a tool' })
  check('OPEN: a file is written in the workspace', out.kind === 'ran' && fs.readFileSync(W('new.txt'), 'utf8') === 'written by a tool')
  out = await ran('fs_append', { path: W('new.txt'), text: '+more' })
  check('OPEN: ...and appended to', fs.readFileSync(W('new.txt'), 'utf8') === 'written by a tool+more')
  out = await ran('fs_mkdir', { path: W('made\\deeper') })
  check('OPEN: a folder is made in the workspace', out.kind === 'ran' && fs.existsSync(W('made\\deeper')))
  out = await ran('fs_copy', { from: W('notes.txt'), to: W('copy.txt') })
  check('OPEN: a file is copied within the workspace', out.kind === 'ran' && fs.existsSync(W('copy.txt')))
  out = await ran('fs_move', { from: W('copy.txt'), to: W('moved.txt') })
  check('OPEN: ...and moved', out.kind === 'ran' && fs.existsSync(W('moved.txt')) && !fs.existsSync(W('copy.txt')))
  out = await ran('fs_delete', { path: W('new.txt') })
  check('OPEN: ...and deleted', out.kind === 'ran' && !fs.existsSync(W('new.txt')))
  check('OPEN: the person was asked for each of these (the block is the guard\'s and the question is the person\'s)', rig.asked.length >= 14, String(rig.asked.length))
  check('OPEN: through all of it the data folder is as it was', treeHash(real.DATA) === realTally.H0)
})

await guard('walkers', async () => {
  // The contract for a tool that walks a folder: it must not follow links, or must ask `check` about each directory it goes into.
  const rig = build(real, guardMod.createDataFolderGuard({ roots: () => [real.DATA] }))
  const careful = await rig.go('fs_walk_careful', { path: real.WS })
  const following = await rig.go('fs_walk_following', { path: real.WS })
  const hasData = (out) => out.kind === 'ran' && /instructions\.json|memory\.json(?!.*hardlink)|chat-encryption|ledger|log\.jsonl/.test(out.result.text.split('\n').filter((l) => !/hardlink-a|symlink-a/.test(l)).join('\n'))
  check('WALK: a walker that never follows a link and asks `check` about each directory walks the workspace and never lists the data folder', careful.kind === 'ran' && careful.result.text.includes('x.txt') && !hasData(careful), show(careful.result?.text.split('\n').slice(0, 8)))
  check('WALK: a walker that FOLLOWS links but asks `check` before each directory is stopped at the junction too', following.kind === 'ran' && following.result.text.includes('x.txt') && !hasData(following), show(following.result?.text.split('\n').slice(0, 8)))
  const naive = await rig.go('fs_walk_naive', { path: real.WS })
  console.log(`  NOTE (not a check): a walker that follows links and asks nothing ${naive.kind === 'ran' && /chat-encryption|ledger/.test(naive.result.text) ? 'DID reach the data folder through the junction inside the workspace' : 'did not reach the data folder here'}: the guard judges the path it is given and cannot make a careless walker careful (D-041: the contract of a tool that walks a folder)`)
  check('WALK: the executor is given a way to ask the same guard (`check`), and it refuses the data folder', await (async () => {
    let verdict
    const probe = coreMod.createToolCore({ tools: regMod.createToolRegistry(toolsFor(real)), settings: () => ({ enabled: { fs_read: true }, caps: { steps: 20, seconds: 600 } }), gate: gateMod.createQuestionGate(async () => true), guard: guardMod.createDataFolderGuard({ roots: () => [real.DATA] }), record: async () => {}, holdsSavedKey: async () => false, executors: { fs_read: async (args, context) => { verdict = await context.check(J(real.DATA, 'memory.json'), 'read'); return { text: 'x' } } } })
    await probe.run({ tool: 'fs_read', args: { path: J(real.WS, 'notes.txt'), why: 'probe' } }, { owner: null, signal: new AbortController().signal, budget: budgetMod.createReplyBudget(undefined) })
    return verdict?.ok === false && verdict.code === 'data-folder'
  })())
})

await guard('lexical', async () => {
  // The guard's pure parts, without the disk: letter case, whole names, the shapes it will not judge.
  const { lexicalPath, isInside, partsOf } = guardMod
  const lex = (p, base = 'C:\\ws') => lexicalPath(p, base, 'win32')
  const inside = (child, root) => isInside(partsOf(lex(child).abs, 'win32'), partsOf(lex(root).abs, 'win32'), 'win32')
  check('LEX: a path is inside its folder, in any letter case', inside('C:\\Users\\X\\frontier-app\\memory.json', 'c:\\users\\x\\FRONTIER-APP') && inside('C:\\USERS\\X\\FRONTIER-APP', 'C:\\users\\x\\frontier-app'))
  check('LEX: letters that NTFS folds together are the same place (a long s is an s, the Kelvin sign is a k)', isInside(['C:', `in${String.fromCodePoint(0x17f)}tructions.json`], ['C:', 'instructions.json'], 'win32') && isInside(['C:', `${String.fromCodePoint(0x212a)}ey.json`], ['C:', 'key.json'], 'win32'))
  check('LEX: the folder is inside itself, and a deeper path is too', inside('C:\\a\\b', 'C:\\a\\b') && inside('C:\\a\\b\\c\\d', 'C:\\a\\b'))
  check('LEX: a folder whose name only starts the same is not inside (whole names, not a prefix of letters)', !inside('C:\\a\\frontier-app-evil\\x', 'C:\\a\\frontier-app') && !inside('C:\\a\\frontier-app2', 'C:\\a\\frontier-app'))
  check('LEX: the parent is not inside the folder', !inside('C:\\a', 'C:\\a\\b') && !inside('C:\\', 'C:\\a'))
  check('LEX: dot-dot is resolved before the comparison, and cannot go above the root', lex('C:\\a\\b\\..\\c').abs === 'C:\\a\\c' && lex('C:\\..\\..\\a').abs === 'C:\\a' && inside('C:\\a\\x\\..\\frontier-app\\f', 'C:\\a\\frontier-app'))
  check('LEX: separators of both kinds, doubled ones and a trailing one all mean the same place', lex('C:/a//b\\\\c/').abs === 'C:\\a\\b\\c')
  check('LEX: trailing dots and spaces on a name are ignored, as Windows ignores them', lex('C:\\a\\b. .\\c ').abs === 'C:\\a\\b\\c' && lex('C:\\a\\b.').abs === 'C:\\a\\b')
  check('LEX: a relative path is taken from the base, and not without one', lex('x\\y', 'C:\\ws').abs === 'C:\\ws\\x\\y' && !lex('x\\y', null).ok)
  check('LEX: the extended-length form of a drive path is understood', lex('\\\\?\\C:\\a\\b').abs === 'C:\\a\\b')
  for (const [what, p] of [['a share', '\\\\server\\share\\x'], ['a volume path', '\\\\?\\Volume{1234}\\x'], ['a UNC form of the extended path', '\\\\?\\UNC\\server\\share'], ['a device path', '\\\\.\\C:\\x'], ['a stream', 'C:\\a:b'], ['a drive-relative path', 'C:a'], ['a path relative to the current drive', '\\a'], ['a variable', 'C:\\%TEMP%\\x'], ['a name of only dots', 'C:\\a\\...\\x'], ['a device name', 'C:\\a\\nul'], ['a device name with an extension', 'C:\\a\\COM3.txt'], ['an illegal character', 'C:\\a\\b*c'], ['a NUL', 'C:\\a\\b\u0000'], ['a control character', 'C:\\a\\b\n'], ['an invisible character', 'C:\\a\\b\u200bc'], ['nothing', ''], ['a very long path', `C:\\${'a'.repeat(3000)}`], ['a number', 5], ['null', null]]) {
    check(`LEX: ${what} is refused without being judged`, !lex(p).ok, show(lex(p)))
  }
  check('LEX: a folder and a file of the same letters in other case are the same place on Windows and macOS and not on Linux', isInside(['C:', 'A'], ['c:', 'a'], 'win32') && isInside(['', 'A'], ['', 'a'], 'darwin') && !isInside(['', 'A'], ['', 'a'], 'linux'))
  check('LEX: on Linux a path is taken as it is (case, dots and a stream colon are ordinary)', lexicalPath('/home/x/../y/a:b', null, 'linux').abs === '/home/y/a:b' && !lexicalPath('rel', null, 'linux').ok)
  check('LEX: an empty list of data folders refuses every path (nothing can be kept out of)', await (async () => { const g = guardMod.createDataFolderGuard({ roots: () => [] }); const v = await g.check({ path: J(real.WS, 'notes.txt'), base: null, op: 'read' }); return !v.ok && v.code === 'data-folder' })())
  check('LEX: a data folder that cannot be understood refuses every path', await (async () => { const g = guardMod.createDataFolderGuard({ roots: () => ['relative\\folder'] }); try { const v = await g.check({ path: J(real.WS, 'notes.txt'), base: null, op: 'read' }); return !v.ok } catch { return false } })())
  check('LEX: a guard asked before the data folder exists still refuses its name', await (async () => { const g = guardMod.createDataFolderGuard({ roots: () => [J(real.ROOT, 'not-yet-made')] }); const v = await g.check({ path: J(real.ROOT, 'not-yet-made', 'memory.json'), base: null, op: 'write' }); return !v.ok && v.code === 'data-folder' })())
  check('LEX: more than one data folder are all kept out of', await (async () => { const g = guardMod.createDataFolderGuard({ roots: () => [real.DATA, real.EVIL] }); const a = await g.check({ path: J(real.EVIL, 'ok.txt'), base: null, op: 'read' }); const b = await g.check({ path: J(real.DATA, 'memory.json'), base: null, op: 'read' }); return !a.ok && !b.ok })())
  check('LEX: the data folder reached through a junction that is itself named is kept out of too', await (async () => { const g = guardMod.createDataFolderGuard({ roots: () => [J(real.ROOT, 'link-to-data')] }); const v = await g.check({ path: J(real.DATA, 'memory.json'), base: null, op: 'read' }); return !v.ok && v.code === 'data-folder' })())
})

// ----- the control: the same battery with the block taken out -----

await guard('control', async () => {
  const S = seed('open', { extras: false })
  try {
    // a guard that lets every path through, as the app would be with the block taken out
    const open = { check: async (request) => ({ ok: true, real: win32.resolve(S.WS, String(request.path)) }) }
    const rig = build(S, open)
    const t = await battery('open', S, rig)
    console.log(`  (the same ${t.attempts} calls with the block taken out: ${t.leaks.length} got through; ${t.canaryHits} canaries came back; ${t.listed} listings of the data folder; tools through: ${[...t.leakTools].join(' ')})`)
    check('CONTROL: with the block taken out the battery sees it: calls get through', t.leaks.length > 100, String(t.leaks.length))
    check('CONTROL: ...READING gets through (the canaries of the notes, the instructions and the audit log come back)', t.canaryHits > 0 && [...t.leaks].some((l) => l.startsWith('fs_read')))
    check('CONTROL: ...LISTING gets through (the names of the files come back)', t.listed > 0)
    check('CONTROL: ...WRITING gets through (the folder is no longer what it was after the writers)', t.afterWriters !== t.H0)
    check('CONTROL: ...DELETING gets through (memory.json is gone)', t.memoryGone || t.afterDeleters === 'gone' || t.afterDeleters !== t.H0)
    check('CONTROL: ...and every one of the eleven tools gets through', [...READERS, ...WRITERS, ...DELETERS].every((tool) => t.leakTools.has(tool)), show([...t.leakTools]))
    check('CONTROL: ...the readers alone changed nothing (so the change after the writers is the writers\')', t.afterReaders === t.H0)
    check('CONTROL: ...the person was asked (the guard was the only thing in the way) and said yes', t.questions > 100 && t.executed > 100, `${t.questions} questions`)
  } finally {
    S.cleanup()
  }
})

real?.cleanup()
console.error = realError
console.log(real?.skipped.length ? `(not tried on this PC: ${real.skipped.join(', ')})` : '(every kind of link and name was tried)')
const ok = check.summary()
process.exit(ok ? 0 : 1)
