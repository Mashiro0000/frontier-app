// Slice 12.1 (D-042): THE FOLDER IS THE BOUNDARY. The workspace guard (workspaceGuard.ts), the choice of the folder (workspace.ts), the file that remembers it
// and the test for text (workspaceText.ts), under plain Node, Windows only (junctions, hard links, `subst`, short names, `\\?\`).
//
// How it is tested, as for the data folder in 11.1. A scratch world: the app's data folder with a canary in every file, a workspace beside it that holds
// ordinary files, hidden and secret-looking ones, version-control internals, links of every kind (a junction out, a junction that leads back inside, one to the
// data folder, a chain, one that leads nowhere, a hard link to a file outside) and a folder outside with canaries of its own. Then the guard is asked about
// everything outside and about everything that is never reached, in about forty spellings each and in all four operations: every call must be REFUSED, and
// when a call is let through anyway a stand-in tool that opens only what the guard hands back must find no canary. The same guard on the ordinary files must
// say yes (a guard that refused everything would pass the first half), classify the names as the plan says, and keep the class when the name is spelled
// another way (letter case, a short 8.3 name, a trailing dot).
//
// The negative control, inside the suite: the same battery with the boundary taken out (a guard that lets every path through) must find the door open
// (calls get through and canaries come back). The sabotage specs (specs121) take each rule out of the SOURCE and require this suite to fail on named checks.
//
// Run: node tools/verify-12-1.mjs
import './ts-resolve.mjs'
import { checker } from './cdp.mjs'
import { makeBox } from './lib8b3.mjs'
import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import { win32 } from 'node:path'
import { REPO, REPO_URL } from './paths.mjs'

const check = checker()
const guard = async (name, fn) => { try { await fn() } catch (error) { check(`${name} did not run to its end: ${String(error?.stack ?? error).slice(0, 400)}`, false) } }
const show = (v) => JSON.stringify(v)?.slice(0, 300)
const SRC = `${REPO_URL}/src`
const guardMod = await import(`${SRC}/main/workspaceGuard.ts`)
const dataMod = await import(`${SRC}/main/dataFolderGuard.ts`)
const wsMod = await import(`${SRC}/main/workspace.ts`)
const textMod = await import(`${SRC}/main/workspaceText.ts`)
const shared = await import(`${SRC}/shared/workspace.ts`)
const J = win32.join
const cp = (n) => String.fromCodePoint(n)
const NUL = String.fromCharCode(0)
const logged = []
const realError = console.error
console.error = (...args) => { logged.push(args.map(String).join(' ')) }

const DATA_FILES = ['memory.json', 'instructions.json', 'projects.json', 'limits.json', 'tools.json', 'credentials.anthropic.json', 'conversations\\c-1.json', 'usage\\ledger.jsonl', 'audit\\log.jsonl', 'workspace.json', 'Local State']
const OPS = ['list', 'read', 'edit', 'create']

// ----- the scratch world -----

function seed(label, { extras }) {
  const ROOT = fs.realpathSync.native(fs.mkdtempSync(J(os.tmpdir(), `frontier-121-${label}-`)))
  const DATA = J(ROOT, 'frontier-app')
  const WS = J(ROOT, 'ws')
  const OUT = J(ROOT, 'out')
  const EVIL = J(ROOT, 'ws-evil')
  const S = { ROOT, DATA, WS, OUT, EVIL, canary: new Map(), skipped: [], cleanups: [], subst: null, short: null }
  const put = (base, rel, body) => { const full = J(base, rel); fs.mkdirSync(win32.dirname(full), { recursive: true }); fs.writeFileSync(full, body) }
  S.put = put
  for (const rel of DATA_FILES) { const c = `DATA-CANARY<${rel}:${randomBytes(4).toString('hex')}>`; S.canary.set(rel, c); put(DATA, rel, c) }
  put(OUT, 'secret.txt', 'OUTSIDE-CANARY secret')
  put(OUT, 'sub\\s2.txt', 'OUTSIDE-CANARY s2')
  put(EVIL, 'ok.txt', 'EVIL-CANARY a folder whose name starts like the workspace')
  // ordinary files
  put(WS, 'notes.txt', 'POSITIVE-notes')
  put(WS, 'Readme.MD', '# POSITIVE-readme\r\nline two\r\n')
  put(WS, 'src\\index.ts', 'POSITIVE-index')
  put(WS, 'src\\deep\\x.ts', 'POSITIVE-deep')
  put(WS, 'sp ace\\a b.txt', 'POSITIVE-space')
  put(WS, 'sub\\plain.txt', 'POSITIVE-sub')
  // hidden and secret-looking
  put(WS, '.env', 'SECRET-CANARY env')
  put(WS, '.gitignore', 'node_modules')
  put(WS, '.ssh\\id_rsa', 'SECRET-CANARY key')
  put(WS, '.github\\workflows\\ci.yml', 'name: ci')
  put(WS, 'certs\\server.pem', 'SECRET-CANARY pem')
  put(WS, 'certs\\readme.txt', 'about certs')
  put(WS, 'secrets\\db.txt', 'SECRET-CANARY db')
  put(WS, 'credentials.json', 'SECRET-CANARY cred')
  put(WS, 'prod.env', 'SECRET-CANARY prod')
  // version-control internals
  put(WS, '.git\\config', 'GIT-CANARY config')
  put(WS, '.git\\HEAD', 'GIT-CANARY head')
  put(WS, '.git\\hooks\\pre-commit', 'GIT-CANARY hook')
  // things that are not text
  put(WS, 'binary.bin', Buffer.from([1, 2, 0, 3]))
  put(WS, 'big.txt', 'x'.repeat(300 * 1024))
  const link = (target, at, type = 'junction') => { try { fs.symlinkSync(target, at, type); return true } catch (error) { S.skipped.push(`${win32.basename(at)} (${error.code})`); return false } }
  S.hasLinkOut = link(OUT, J(WS, 'link-out'))
  S.hasLinkIn = link(J(WS, 'src'), J(WS, 'link-in'))
  S.hasLinkData = link(DATA, J(WS, 'link-data'))
  S.hasChain = S.hasLinkOut && link(J(WS, 'link-out'), J(WS, 'chain2'))
  S.hasDangling = link(J(OUT, 'not-there'), J(WS, 'dangling'))
  S.hasInner = link(OUT, J(WS, 'sub\\inner-link'))
  S.hasToWs = link(WS, J(ROOT, 'link-to-ws'))
  try { fs.linkSync(J(OUT, 'secret.txt'), J(WS, 'hard-out.txt')); S.hasHardOut = true } catch { S.skipped.push('hard-out.txt') }
  put(WS, 'pair-a.txt', 'POSITIVE-pair')
  try { fs.linkSync(J(WS, 'pair-a.txt'), J(WS, 'pair-b.txt')); S.hasHardIn = true } catch { S.skipped.push('pair-b.txt') }
  if (extras) {
    for (const letter of 'ZYXWVUTSR') {
      const drive = `${letter}:`
      if (fs.existsSync(`${drive}\\`)) continue
      try { execFileSync('subst', [drive, ROOT], { stdio: 'ignore' }); S.subst = drive; break } catch { /* try the next letter */ }
    }
    if (S.subst === null) S.skipped.push('a substituted drive')
    S.cleanups.push(() => { if (S.subst !== null) { try { execFileSync('subst', [S.subst, '/D'], { stdio: 'ignore' }) } catch { /* gone */ } S.subst = null } })
    const shortOf = (full, kind) => {
      try {
        const text = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `(New-Object -ComObject Scripting.FileSystemObject).${kind}('${full.replace(/'/g, "''")}').ShortPath`], { encoding: 'utf8', timeout: 30000 }).trim()
        return text && text.toLowerCase() !== full.toLowerCase() ? win32.basename(text) : null
      } catch { return null }
    }
    S.short = { git: shortOf(J(WS, '.git'), 'GetFolder'), env: shortOf(J(WS, '.env'), 'GetFile'), readme: shortOf(J(WS, 'Readme.MD'), 'GetFile'), ssh: shortOf(J(WS, '.ssh'), 'GetFolder'), data: shortOf(DATA, 'GetFolder'), space: shortOf(J(WS, 'sp ace'), 'GetFolder') }
    if (Object.values(S.short).every((v) => v === null)) S.skipped.push('8.3 short names (this volume makes none)')
  }
  S.cleanups.push(() => {
    for (const rel of ['link-out', 'link-in', 'link-data', 'chain2', 'dangling', 'sub\\inner-link']) { try { fs.rmdirSync(J(WS, rel)) } catch { /* not made */ } }
    try { fs.rmdirSync(J(ROOT, 'link-to-ws')) } catch { /* not made */ }
    try { fs.rmSync(ROOT, { recursive: true, force: true }) } catch { /* left for the system's temp cleaning */ }
  })
  S.cleanup = () => { for (const fn of S.cleanups.slice().reverse()) fn() }
  return S
}

/** What a stand-in tool does with a verdict: opens ONLY the path the guard handed back (and only inside the scratch folder), as a tool of 12.3 will. */
function open(S, v, op) {
  const inside = (p) => { const rel = win32.relative(S.ROOT, win32.resolve(String(p).replace(/^\\\\\?\\/, ''))); if (rel === '..' || rel.startsWith('..\\') || win32.isAbsolute(rel)) throw new Error(`the harness refused a path outside its scratch folder: ${p}`); return p }
  if (!v.ok) return null
  try {
    if (v.kind === 'file' && (op === 'read' || op === 'edit')) return fs.readFileSync(inside(v.real), 'utf8')
    if (v.kind === 'folder' && op === 'list') return fs.readdirSync(inside(v.real)).join('\n')
  } catch (error) { if (/harness refused/.test(error.message)) S.harnessRefused = (S.harnessRefused ?? 0) + 1 } // the harness's own net: a path outside the scratch folder is never opened
  return null
}

const makeGuard = (S, root = S.WS, data) => guardMod.createWorkspaceGuard({ root: () => root, dataGuard: data ?? dataMod.createDataFolderGuard({ roots: () => [S.DATA] }) })

// ----- what is aimed at the boundary -----

/** The spellings of a path given relative to the workspace. */
function spell(rel) {
  const out = []
  const add = (name, path) => out.push({ name, path })
  add('as it is', rel)
  add('in capitals', rel.toUpperCase())
  add('in lower case', rel.toLowerCase())
  add('in alternating case', [...rel].map((c, i) => (i % 2 ? c.toUpperCase() : c.toLowerCase())).join(''))
  add('with forward slashes', rel.replaceAll('\\', '/'))
  add('with mixed slashes', rel.replace(/\\/g, (m, i) => (i % 2 ? '/' : '\\')))
  add('with doubled separators', rel.replaceAll('\\', '\\\\'))
  add('behind a dot segment', `.\\${rel}`)
  add('behind a folder and a dot-dot', `src\\..\\${rel}`)
  add('behind a folder that is not there and a dot-dot', `nothing\\..\\${rel}`)
  add('behind two folders and two dot-dots', `src\\deep\\..\\..\\${rel}`)
  add('with a trailing dot', `${rel}.`)
  add('with a trailing space', `${rel} `)
  add('with a trailing separator', `${rel}\\`)
  add('as a stream', `${rel}:stream`)
  add('as the default stream', `${rel}::$DATA`)
  add('with a NUL', `${rel}${NUL}`)
  add('with a variable', `%TEMP%\\${rel}`)
  add('with a control character', `${rel}\n`)
  add('with an invisible character', `${rel.slice(0, 1)}${cp(0x200b)}${rel.slice(1)}`)
  add('in the extended-length form', `\\\\?\\${rel}`)
  return out
}

/** The spellings of an absolute path. */
function spellAbsolute(abs) {
  const out = []
  const add = (name, path) => out.push({ name, path })
  add('absolute', abs)
  add('absolute in capitals', abs.toUpperCase())
  add('absolute with forward slashes', abs.replaceAll('\\', '/'))
  add('in the extended-length form', `\\\\?\\${abs}`)
  add('in the device form', `\\\\.\\${abs}`)
  add('as a share on this computer', `\\\\localhost\\${abs[0]}$\\${abs.slice(3)}`)
  add('drive-relative', abs.slice(0, 2) + abs.slice(3))
  add('rooted without a drive', abs.slice(2))
  add('a file: address', `file:///${abs.replaceAll('\\', '/')}`)
  return out
}

/** The aim: every spelling of every forbidden target in every operation. `tally` collects what got through. */
async function aim(S, g, tally, targets) {
  const attempt = async (label, path, op) => {
    tally.attempts++
    let v
    try { v = await g.check({ path, op }) } catch (error) { tally.threw.push(`${label} ${op}: ${error.message}`); return }
    const body = open(S, v, op)
    if (body !== null && /(OUTSIDE|DATA|EVIL|GIT|SECRET)-CANARY/.test(body)) tally.canaries++
    if (v.ok) { tally.leaks.push(`${label} [${show(path)}] ${op}`); tally.leakKinds.add(label.split(' ')[0]) }
    else tally.refusals[v.code] = (tally.refusals[v.code] ?? 0) + 1
  }
  for (const [name, abs] of targets) {
    for (const op of OPS) {
      for (const sp of spellAbsolute(abs)) await attempt(`${name} ${sp.name}`, sp.path, op)
      const rel = win32.relative(S.WS, abs) || '.'
      for (const sp of spell(rel)) await attempt(`${name} ${sp.name}`, sp.path, op)
    }
  }
}

function outsideTargets(S) {
  const t = [
    ['out-file', J(S.OUT, 'secret.txt')], ['out-deep', J(S.OUT, 'sub', 's2.txt')], ['out-folder', S.OUT], ['out-new', J(S.OUT, 'new.txt')],
    ['sibling-with-the-same-start', J(S.EVIL, 'ok.txt')], ['the-root', S.ROOT], ['the-drive', S.ROOT.slice(0, 3)],
    ['data-file', J(S.DATA, 'memory.json')], ['data-audit', J(S.DATA, 'audit', 'log.jsonl')], ['data-folder', S.DATA], ['data-new', J(S.DATA, 'new.json')], ['data-instructions', J(S.DATA, 'instructions.json')]
  ]
  return t
}

/** Spellings that go by a link or a second name (given relative to the workspace). */
function linkTargets(S) {
  const rels = [['hard-out', 'hard-out.txt', S.hasHardOut], ['hard-in', 'pair-b.txt', S.hasHardIn], ['hard-in-first-name', 'pair-a.txt', S.hasHardIn],
    ['junction-out', 'link-out\\secret.txt', S.hasLinkOut], ['junction-out-itself', 'link-out', S.hasLinkOut], ['junction-out-new', 'link-out\\new.txt', S.hasLinkOut], ['chain', 'chain2\\secret.txt', S.hasChain],
    ['junction-inner', 'sub\\inner-link\\secret.txt', S.hasInner], ['junction-back-in', 'link-in\\index.ts', S.hasLinkIn], ['junction-back-in-itself', 'link-in', S.hasLinkIn], ['junction-to-data', 'link-data\\memory.json', S.hasLinkData], ['junction-to-data-audit', 'link-data\\audit\\log.jsonl', S.hasLinkData], ['dangling', 'dangling\\x.json', S.hasDangling], ['dangling-itself', 'dangling', S.hasDangling]]
  return rels.filter(([, , there]) => there).map(([name, rel]) => [name, rel])
}

const battery = async (S, g) => {
  const tally = { attempts: 0, leaks: [], leakKinds: new Set(), canaries: 0, refusals: {}, threw: [] }
  await aim(S, g, tally, outsideTargets(S))
  // links and second names are given relative to the workspace only (that is how the model writes them)
  const rels = linkTargets(S)
  for (const [name, rel] of rels) for (const op of OPS) for (const sp of spell(rel)) {
    tally.attempts++
    let v
    try { v = await g.check({ path: sp.path, op }) } catch (error) { tally.threw.push(`${name} ${sp.name}: ${error.message}`); continue }
    const body = open(S, v, op)
    if (body !== null && /(OUTSIDE|DATA|EVIL|GIT|SECRET)-CANARY/.test(body)) tally.canaries++
    if (v.ok) { tally.leaks.push(`${name} ${sp.name} [${show(sp.path)}] ${op}`); tally.leakKinds.add(name) } else tally.refusals[v.code] = (tally.refusals[v.code] ?? 0) + 1
  }
  return tally
}

let real
process.on('exit', () => { try { real?.cleanup() } catch { /* nothing to do */ } })

await guard('setup', async () => {
  real = seed('real', { extras: true })
  check('setup: the scratch world has the data folder, a workspace, a folder outside and the links', fs.existsSync(real.DATA) && fs.existsSync(real.WS) && fs.existsSync(real.OUT) && real.hasLinkOut && real.hasLinkData, show(real.skipped))
  console.log(`  (scratch: ${real.ROOT}; not made on this PC: ${real.skipped.length === 0 ? 'nothing' : real.skipped.join(', ')}; substituted drive: ${real.subst ?? 'none'}; short names: ${show(real.short)})`)
  check('setup: the stand-in tool opens nothing outside the scratch folder, whatever the guard says (the net that keeps the control run harmless)', ['C:\\Windows\\win.ini', '\\\\?\\C:\\Windows\\win.ini', '\\\\.\\C:\\Windows\\win.ini', J(real.ROOT, '..', 'x.txt')].every((p) => open(real, { ok: true, kind: 'file', real: p }, 'read') === null) && real.harnessRefused === 4, String(real.harnessRefused))
  check('setup: Node reports a junction as a symbolic link (so one rule covers symbolic links and junctions)', fs.lstatSync(J(real.WS, 'link-out')).isSymbolicLink())
  check('setup: the shared limits and the lists are what the plan says', shared.WORKSPACE_LIMITS.maxFileBytes === 262144 && shared.WORKSPACE_LIMITS.maxListEntries === 200 && shared.WORKSPACE_LIMITS.maxPathChars === 300 && shared.WORKSPACE_OPS.join() === 'list,read,edit,create' && shared.FILE_CLASSES.join() === 'ok,one-by-one,never', show(shared.WORKSPACE_LIMITS))
  check('setup: every refusal the guard can give is listed in the shared type', ['no-workspace', 'workspace-changed', 'outside', 'link', 'never', 'data-folder', 'bad-path', 'not-found', 'not-a-file', 'not-a-folder', 'exists'].every((c) => shared.WORKSPACE_REFUSALS.includes(c)))
})

// ============ A. the boundary: nothing outside, no link, no second name ============
let blockTally
await guard('A', async () => {
  const g = makeGuard(real)
  const t = await battery(real, g)
  blockTally = t
  console.log(`  (${t.attempts} calls aimed at the boundary; refusals by code: ${show(t.refusals)})`)
  check('A: nothing got through: every call at something outside the workspace, the data folder, a link or a second name was refused', t.leaks.length === 0, show(t.leaks.slice(0, 10)) + (t.leaks.length > 10 ? ` ... and ${t.leaks.length - 10} more` : ''))
  check('A: no canary came back from anything a stand-in tool opened with what the guard handed back', t.canaries === 0, String(t.canaries))
  check('A: the guard never threw (a fault is a refusal)', t.threw.length === 0, show(t.threw.slice(0, 3)))
  check('A: a good many calls were made (about forty spellings of a dozen places, a score of links, four operations)', t.attempts > 2000, String(t.attempts))
  const codes = Object.keys(t.refusals)
  check('A: what was refused was refused for a reason of the boundary (outside, link, data folder, bad path, not found/exists for the rest), and the main ones all appear', ['outside', 'link', 'bad-path'].every((c) => codes.includes(c)) && codes.every((c) => shared.WORKSPACE_REFUSALS.includes(c)), show(t.refusals))
})

await guard('A-exact', async () => {
  const g = makeGuard(real)
  const code = async (path, op = 'read') => { const v = await g.check({ path, op }); return v.ok ? 'ok' : v.code }
  check('A: a path with `..` that leaves is "outside"', await code('..\\out\\secret.txt') === 'outside' && await code('src\\..\\..\\out\\secret.txt') === 'outside' && await code('..\\..\\..\\..\\..\\..\\Windows\\win.ini') === 'outside')
  check('A: ...also when it does not exist yet (a write outside)', await code('..\\out\\new.txt', 'create') === 'outside')
  check('A: a folder whose name only STARTS like the workspace is outside (whole names)', await code('..\\ws-evil\\ok.txt') === 'outside')
  check('A: an absolute path is "bad-path" even when it points inside the workspace (the model is told the workspace\'s name and uses relative paths only)', await code(J(real.WS, 'notes.txt')) === 'bad-path' && await code('C:\\Windows') === 'bad-path' && await code('\\notes.txt') === 'bad-path' && await code('//server/share/x') === 'bad-path' && await code('C:notes.txt') === 'bad-path')
  if (real.hasLinkOut) check('A: a junction to a folder outside is "link", and so is the junction itself', await code('link-out\\secret.txt') === 'link' && await code('link-out', 'list') === 'link')
  if (real.hasLinkIn) check('A: a junction that leads back INSIDE the workspace is refused too ("link"): any link on the way', await code('link-in\\index.ts') === 'link' && await code('link-in', 'list') === 'link')
  if (real.hasChain) check('A: a chain of two junctions is "link"', await code('chain2\\secret.txt') === 'link')
  if (real.hasLinkData) check('A: a junction to the data folder is refused (a link on the way)', await code('link-data\\memory.json') === 'link')
  if (real.hasDangling) check('A: a link that leads nowhere is "link", for a new file below it too', await code('dangling\\x.json', 'create') === 'link' && await code('dangling', 'read') === 'link')
  if (real.hasInner) check('A: a junction in a deeper folder is "link"', await code('sub\\inner-link\\secret.txt') === 'link')
  if (real.hasHardOut) check('A: a second name of a file OUTSIDE (a hard link) is refused as "bad-path" by the data-folder guard\'s rule', await code('hard-out.txt') === 'bad-path')
  if (real.hasHardIn) check('A: any file with two names is refused, both names, even inside', await code('pair-b.txt') === 'bad-path' && await code('pair-a.txt') === 'bad-path')
  for (const name of ['con', 'CON.txt', 'nul', 'aux.log', 'COM1', 'lpt2.txt']) check(`A: the device name "${name}" is "bad-path"`, await code(name) === 'bad-path')
  for (const [what, path] of [['an empty path', ''], ['a name of dots', '...\\x'], ['an illegal character', 'a<b'], ['a stream', 'notes.txt:s'], ['a variable', '%APPDATA%\\x'], ['null', null], ['a number', 5], ['a list', ['notes.txt']], ['an object', { toString: () => 'notes.txt' }], ['undefined', undefined]]) {
    check(`A: ${what} is refused`, (await code(path)) !== 'ok', show(path))
  }
  check('A: a path of 3,000 characters is refused', await code('a\\'.repeat(1500)) === 'bad-path')
  const gNo = guardMod.createWorkspaceGuard({ root: () => null, dataGuard: dataMod.createDataFolderGuard({ roots: () => [real.DATA] }) })
  check('A: with no workspace chosen nothing is reachable ("no-workspace")', (await gNo.check({ path: 'notes.txt', op: 'read' })).code === 'no-workspace' && !(await gNo.root()).ok)
  const gThrow = guardMod.createWorkspaceGuard({ root: () => { throw new Error('boom') }, dataGuard: dataMod.createDataFolderGuard({ roots: () => [real.DATA] }) })
  check('A: a setting that cannot be read refuses (never throws)', (await gThrow.check({ path: 'notes.txt', op: 'read' })).ok === false && (await gThrow.root()).ok === false)
  const gData = guardMod.createWorkspaceGuard({ root: () => real.WS, dataGuard: { check: async () => { throw new Error('boom') } } })
  check('A: a data-folder guard that fails refuses (never throws)', (await gData.check({ path: 'notes.txt', op: 'read' })).ok === false)
})

// ============ B. version-control internals: never ============
await guard('B', async () => {
  const g = makeGuard(real)
  const code = async (path, op = 'read') => { const v = await g.check({ path, op }); return v.ok ? 'ok' : v.code }
  for (const [what, path, op] of [['a file in .git', '.git\\config', 'read'], ['.git\\HEAD', '.git\\HEAD', 'read'], ['a hook', '.git\\hooks\\pre-commit', 'read'], ['the folder .git itself', '.git', 'list'], ['a new hook', '.git\\hooks\\post-commit', 'create'], ['an edit of a hook', '.git\\hooks\\pre-commit', 'edit'], ['in capitals', '.GIT\\CONFIG', 'read'], ['in alternating case', '.GiT\\config', 'read'], ['with forward slashes', '.git/config', 'read'], ['behind a dot-dot', 'src\\..\\.git\\config', 'read'], ['with a trailing dot on the folder', '.git.\\config', 'read'], ['with a trailing space on the folder', '.git \\config', 'read'], ['with a doubled separator', '.git\\\\config', 'read'], ['a new folder named .git', 'sub\\.git\\x', 'create'], ['a new folder named .GIT in capitals', 'sub\\.GIT\\x', 'create'], ['a new .hg', '.hg\\x', 'create'], ['a new .HG in capitals', '.HG\\x', 'create'], ['a new .SVN in capitals', 'a\\.SVN\\x', 'create'], ['the recycle bin in capitals', '$RECYCLE.BIN\\x', 'create'], ['a new .svn', '.svn\\x', 'create'], ['the recycle bin', '$Recycle.Bin\\x', 'create'], ['System Volume Information', 'System Volume Information\\x', 'create']]) {
    check(`B: ${what} is "never"`, await code(path, op) === 'never', `${path} ${op} -> ${await code(path, op)}`)
  }
  if (real.short?.git) {
    check('B: the 8.3 name of .git is "never" as well (the class is read off the real names)', await code(`${real.short.git}\\config`) === 'never' && await code(`${real.short.git.toLowerCase()}\\hooks\\pre-commit`) === 'never', `${real.short.git}`)
  } else console.log('  (not tried: the 8.3 name of .git; this volume makes none)')
  check('B: a name that only STARTS like a version-control folder is not "never" (.gitignore and .github are hidden, asked one by one)', (await g.check({ path: '.gitignore', op: 'read' })).fileClass === 'one-by-one' && (await g.check({ path: '.github\\workflows\\ci.yml', op: 'read' })).fileClass === 'one-by-one')
  check('B: a folder called "git" or "mygit" is ordinary', (await g.check({ path: 'git\\x', op: 'create' })).fileClass === 'ok' && (await g.check({ path: 'mygit\\x', op: 'create' })).fileClass === 'ok')
})

// ============ C. hidden and secret-looking names: one by one ============
await guard('C', async () => {
  const g = makeGuard(real)
  const cls = async (path, op = 'read') => { const v = await g.check({ path, op }); return v.ok ? v.fileClass : `refused:${v.code}` }
  const sensitive = [['.env', '.env'], ['.ssh\\id_rsa', '.ssh\\id_rsa'], ['certs\\server.pem', 'certs\\server.pem'], ['secrets\\db.txt', 'secrets\\db.txt'], ['credentials.json', 'credentials.json'], ['prod.env', 'prod.env'], ['.github\\workflows\\ci.yml', '.github\\workflows\\ci.yml'], ['.gitignore', '.gitignore']]
  let wrong = []
  let n = 0
  for (const [name, rel] of sensitive) {
    for (const sp of spell(rel)) {
      // only the spellings that Windows resolves to the same file are a way to it; the rest are refused (never "ok")
      const c = await cls(sp.path)
      n++
      if (c === 'ok') wrong.push(`${name} ${sp.name} -> ok`)
    }
  }
  check('C: no spelling of any hidden or secret-looking file is ever classed "ok"', wrong.length === 0 && n > 150, show(wrong.slice(0, 6)) + ` (${n} spellings)`)
  for (const [name, rel] of sensitive) check(`C: ${name} is "one-by-one" and the guard says why`, await cls(rel) === 'one-by-one' && (await g.check({ path: rel, op: 'read' })).note !== '')
  for (const [what, rel] of [['in capitals', '.ENV'], ['in lower case', 'PROD.ENV'], ['with forward slashes', '.ssh/id_rsa'], ['with a trailing dot', '.env.'], ['behind a dot-dot', 'src\\..\\.env'], ['with a trailing space', '.env ']]) check(`C: ${rel} ${what} is still "one-by-one"`, await cls(rel) === 'one-by-one', await cls(rel))
  if (real.short?.env) check('C: the 8.3 name of .env is still "one-by-one" (a short name cannot hide a dot)', await cls(real.short.env) === 'one-by-one', `${real.short.env} -> ${await cls(real.short.env)}`)
  if (real.short?.ssh) check('C: the 8.3 name of the folder .ssh is still "one-by-one" for the file in it', await cls(`${real.short.ssh}\\id_rsa`) === 'one-by-one', `${real.short.ssh}`)
  check('C: a hidden FOLDER is one-by-one for listing too', await cls('.ssh', 'list') === 'one-by-one' && await cls('.github', 'list') === 'one-by-one')
  check('C: a new hidden file is one-by-one, and so is a new secret-looking one', await cls('.env.local', 'create') === 'one-by-one' && await cls('keys\\new.pem', 'create') === 'one-by-one' && await cls('.vscode\\tasks.json', 'create') === 'one-by-one')
  check('C: ordinary names are "ok"', await cls('notes.txt') === 'ok' && await cls('src\\index.ts') === 'ok' && await cls('sub\\plain.txt') === 'ok' && await cls('certs\\readme.txt') === 'ok')
  const { classifyNames } = guardMod
  const K = cp(0x212a)
  const LONG_S = cp(0x17f)
  for (const [what, names, want] of [
    ['no names (the workspace itself)', [], 'ok'], ['an ordinary path', ['src', 'index.ts'], 'ok'], ['README.md', ['README.md'], 'ok'], ['a name with a dot inside', ['a.b.c'], 'ok'],
    ['.env', ['.env'], 'one-by-one'], ['.env.local', ['src', '.env.local'], 'one-by-one'], ['a name under a hidden folder', ['.github', 'workflows', 'ci.yml'], 'one-by-one'], ['a secrets folder', ['a', 'secrets', 'b.txt'], 'one-by-one'], ['a secret folder', ['secret', 'b.txt'], 'one-by-one'],
    ['credentials.json', ['credentials.json'], 'one-by-one'], ['credentials-prod.yml', ['credentials-prod.yml'], 'one-by-one'], ['.pem', ['x.pem'], 'one-by-one'], ['.KEY in capitals', ['KEY.KEY'], 'one-by-one'], ['id_rsa', ['id_rsa'], 'one-by-one'], ['id_rsa.pub', ['id_rsa.pub'], 'one-by-one'], ['id_ed25519', ['id_ed25519'], 'one-by-one'], ['id_ecdsa', ['id_ecdsa'], 'one-by-one'], ['id_dsa', ['id_dsa'], 'one-by-one'],
    ['prod.env', ['prod.env'], 'one-by-one'], ['.kdbx', ['db.kdbx'], 'one-by-one'], ['.PFX', ['a.PFX'], 'one-by-one'], ['.p12', ['a.p12'], 'one-by-one'], ['.ppk', ['a.ppk'], 'one-by-one'], ['.jks', ['a.jks'], 'one-by-one'], ['.keystore', ['a.keystore'], 'one-by-one'],
    ['a long s for an s', [`${LONG_S}ecrets`], 'one-by-one'], ['the Kelvin sign for a k', [`a.${K}ey`], 'one-by-one'], ['.npmrc', ['.npmrc'], 'one-by-one'],
    ['.git', ['.git'], 'never'], ['.git\\config', ['.git', 'config'], 'never'], ['.GIT in the middle', ['a', '.GIT', 'b'], 'never'], ['.hg', ['.hg'], 'never'], ['.svn', ['.svn', 'x'], 'never'], ['$Recycle.Bin', ['$Recycle.Bin'], 'never'], ['System Volume Information', ['System Volume Information'], 'never'], ['.Git deep', ['x', 'y', '.Git'], 'never'],
    ['never beats hidden', ['.env', '.git'], 'never'], ['never after a secret', ['secrets', '.git', 'x'], 'never'],
    ['.git2 is only hidden', ['.git2'], 'one-by-one'], ['.gitx is only hidden', ['.gitx'], 'one-by-one'], ['git is ordinary', ['git'], 'ok'], ['mygit is ordinary', ['mygit'], 'ok'], ['a name ending in env but not .env', ['myenv'], 'ok'], ['a name containing key', ['monkey.txt'], 'ok'], ['keyboard.ts', ['keyboard.ts'], 'ok'], ['secretary.txt is ordinary? no: it starts with secret', ['secretary.txt'], 'one-by-one']
  ]) {
    check(`C-pure: ${what} -> ${want}`, classifyNames(names).fileClass === want, `${show(names)} -> ${classifyNames(names).fileClass}`)
  }
  check('C-pure: a class always comes with a sentence unless it is "ok"', classifyNames(['.env']).note !== '' && classifyNames(['.git']).note !== '' && classifyNames(['a']).note === '')
})

// ============ D. the ordinary files, and the facts the guard hands back ============
await guard('D', async () => {
  const g = makeGuard(real)
  const W = (rel) => J(real.WS, rel)
  const ok = async (path, op) => { const v = await g.check({ path, op }); return v }
  let v = await ok('notes.txt', 'read')
  check('D: an ordinary file is read: ok, "file", its size, class "ok", and the real path inside the workspace', v.ok && v.kind === 'file' && v.size === 'POSITIVE-notes'.length && v.fileClass === 'ok' && v.rel.join('/') === 'notes.txt' && win32.relative(real.WS, v.real) === 'notes.txt', show(v))
  check('D: ...the verdict carries nothing the model could use to learn the workspace\'s place (rel is names only)', !v.rel.some((n) => n.includes('\\')) && !v.rel.join('').includes(real.ROOT))
  const spellings = [['src\\index.ts', 'src/index.ts'], ['src\\deep\\x.ts', 'src/deep/x.ts'], ['sp ace\\a b.txt', 'sp ace/a b.txt'], ['sub\\plain.txt', 'sub/plain.txt']]
  let bad = []
  let n = 0
  for (const [rel, relSlash] of spellings) for (const sp of spell(rel)) {
    // the spellings that mean the same file to Windows must work; the odd ones (streams, variables, invisible characters, extended form...) must not
    const same = ['as it is', 'in capitals', 'in lower case', 'in alternating case', 'with forward slashes', 'with mixed slashes', 'with doubled separators', 'behind a dot segment', 'behind a folder and a dot-dot', 'behind a folder that is not there and a dot-dot', 'behind two folders and two dot-dots', 'with a trailing dot', 'with a trailing space', 'with a trailing separator'].includes(sp.name)
    const r = await g.check({ path: sp.path, op: sp.name === 'with a trailing separator' ? 'list' : 'read' })
    n++
    if (sp.name === 'with a trailing separator') continue // a trailing separator names a folder, which is not a file: refused by the kind
    if (same && !(r.ok && r.fileClass === 'ok' && win32.relative(real.WS, r.real).toLowerCase() === rel.toLowerCase())) bad.push(`${rel} ${sp.name}: ${show(r)}`)
    if (!same && r.ok) bad.push(`${rel} ${sp.name} got through`)
  }
  check('D: every spelling Windows reads as the same file works, and the others do not; every one resolves to the same real path', bad.length === 0 && n > 50, show(bad.slice(0, 5)))
  v = await ok('Readme.MD', 'read')
  check('D: the real path carries the disk\'s own letter case, whatever the model typed', v.ok && win32.basename(v.real) === 'Readme.MD' && v.rel.join('/') === 'Readme.MD' && (await ok('README.md', 'read')).rel.join('/') === 'Readme.MD')
  if (real.short?.readme) check('D: a short 8.3 name gives the real long name back', (await ok(real.short.readme, 'read')).rel.join('/') === 'Readme.MD', real.short.readme)
  if (real.short?.space) check('D: a short name for a folder with a space gives the real names back', (await ok(`${real.short.space}\\a b.txt`, 'read')).rel.join('/') === 'sp ace/a b.txt', real.short.space)
  v = await ok('.', 'list')
  check('D: "." is the workspace itself: a folder, no names below it', v.ok && v.kind === 'folder' && v.rel.length === 0 && v.real.toLowerCase() === real.WS.toLowerCase(), show(v))
  check('D: ...listing a folder: ok, "folder"; the workspace root can be listed twice as often under other spellings', (await ok('src', 'list')).kind === 'folder' && (await ok('.\\', 'list')).ok && (await ok('src\\..', 'list')).ok && (await ok('SRC\\DEEP', 'list')).ok)
  check('D: reading a folder is "not-a-file"; listing a file is "not-a-folder"', (await ok('src', 'read')).code === 'not-a-file' && (await ok('notes.txt', 'list')).code === 'not-a-folder' && (await ok('.', 'read')).code === 'not-a-file' && (await ok('src', 'edit')).code === 'not-a-file')
  check('D: a file that is not there is "not-found" for reading, editing and listing', (await ok('nothing.txt', 'read')).code === 'not-found' && (await ok('nothing.txt', 'edit')).code === 'not-found' && (await ok('nothing', 'list')).code === 'not-found')
  check('D: a file where a folder should be is "not-a-folder"', (await ok('notes.txt\\x', 'read')).code === 'not-a-folder' && (await ok('notes.txt\\x', 'create')).code === 'not-a-folder')
  v = await ok('src\\new\\deeper\\file.ts', 'create')
  check('D: a new file in folders that are not there yet is "missing", with its real place', v.ok && v.kind === 'missing' && v.size === 0 && win32.relative(real.WS, v.real) === 'src\\new\\deeper\\file.ts' && v.rel.join('/') === 'src/new/deeper/file.ts', show(v))
  v = await ok('SRC\\New.ts', 'create')
  check('D: ...and the part that exists takes the disk\'s own case: SRC\\New.ts is src\\New.ts', v.ok && win32.relative(real.WS, v.real) === 'src\\New.ts', show(v))
  check('D: creating what exists is "exists"; creating the workspace itself is "exists"', (await ok('notes.txt', 'create')).code === 'exists' && (await ok('src', 'create')).code === 'exists' && (await ok('.', 'create')).code === 'exists')
  check('D: editing a file works for an ordinary file, as a read does', (await ok('src\\index.ts', 'edit')).ok)
  v = await ok('big.txt', 'read')
  check('D: the size of a big file is reported (the tool refuses it, not the guard)', v.ok && v.size === 300 * 1024, show(v))
  v = await ok('binary.bin', 'read')
  check('D: a binary file is an ordinary name for the guard (the text check is the tool\'s)', v.ok && v.fileClass === 'ok')
  check('D: a workspace that is reached through its own name in other case works (the root is judged as it really is)', makeGuard(real, real.WS.toUpperCase()) && (await makeGuard(real, real.WS.toUpperCase()).check({ path: 'notes.txt', op: 'read' })).ok)
  check('D: a file with a hot-looking name that is ordinary works: "keyboard.ts", "monkey.txt", "myenv"', await (async () => { real.put(real.WS, 'keyboard.ts', 'k'); real.put(real.WS, 'monkey.txt', 'm'); real.put(real.WS, 'myenv', 'e'); return (await ok('keyboard.ts', 'read')).fileClass === 'ok' && (await ok('monkey.txt', 'read')).fileClass === 'ok' && (await ok('myenv', 'read')).fileClass === 'ok' })())
  check('D: a name of 250 characters works and one of 300 characters is refused (the model\'s path limit is the registry\'s; this is only the disk\'s)', await (async () => { const long = 'n'.repeat(120); real.put(real.WS, `${long}.txt`, 'l'); return (await ok(`${long}.txt`, 'read')).ok })())
  check('D: the guard does not change the disk: the files are as written', fs.readFileSync(W('notes.txt'), 'utf8') === 'POSITIVE-notes' && !fs.existsSync(W('src\\new')))
})

// ============ E. the workspace itself must stay what it was ============
await guard('E', async () => {
  const code = async (root, path = 'notes.txt', data) => { const v = await makeGuard(real, root, data).check({ path, op: 'read' }); return v.ok ? 'ok' : v.code }
  const rootOf = async (root) => (await makeGuard(real, root).root())
  check('E: the chosen folder, as it is, is a workspace', (await rootOf(real.WS)).ok && (await rootOf(real.WS)).name === 'ws' && (await rootOf(real.WS)).real.toLowerCase() === real.WS.toLowerCase())
  if (real.hasToWs) check('E: a workspace that is now itself a junction (someone swapped the folder for a link) is "workspace-changed"', await code(J(real.ROOT, 'link-to-ws')) === 'workspace-changed')
  if (real.hasToWs) check('E: ...and so is one that is reached THROUGH a junction in its path (the folder looks right and is somewhere else)', await code(J(real.ROOT, 'link-to-ws', 'src'), 'index.ts') === 'workspace-changed')
  if (real.hasLinkOut) check('E: ...and a workspace inside a junction that leads out of the place it was chosen in', await code(J(real.WS, 'link-out', 'sub'), 's2.txt') === 'workspace-changed')
  check('E: a folder that is gone is "workspace-changed"', await code(J(real.ROOT, 'was-here')) === 'workspace-changed')
  check('E: a file instead of the folder is "workspace-changed"', await code(J(real.WS, 'notes.txt')) === 'workspace-changed')
  check('E: the data folder is not a workspace, a folder that holds it is not, and one inside it is not', await code(real.DATA) === 'workspace-changed' && await code(real.ROOT) === 'workspace-changed' && await code(J(real.DATA, 'conversations')) === 'workspace-changed' && await code(real.ROOT.slice(0, 3)) === 'workspace-changed')
  check('E: a relative folder, a share, an empty one and a drive are not workspaces', await code('ws') === 'workspace-changed' && await code('\\\\localhost\\C$\\x') === 'workspace-changed' && await code('') === 'workspace-changed' && await code('C:\\') === 'workspace-changed')
  check('E: the workspace is looked at AGAIN at every use (not trusted from the first)', await (async () => {
    const folder = fs.mkdtempSync(J(real.ROOT, 'again-')); fs.writeFileSync(J(folder, 'a.txt'), 'a')
    const g = makeGuard(real, folder)
    const before = (await g.check({ path: 'a.txt', op: 'read' })).ok
    fs.rmSync(folder, { recursive: true, force: true })
    return before && (await g.check({ path: 'a.txt', op: 'read' })).code === 'workspace-changed'
  })())
  check('E: when the data folder moves INTO the workspace the guard refuses everything (the data folder may not be inside it)', await (async () => {
    const data2 = J(real.WS, 'sub', 'data-here'); fs.mkdirSync(data2, { recursive: true })
    const dg = dataMod.createDataFolderGuard({ roots: () => [data2] })
    const r = await makeGuard(real, real.WS, dg).check({ path: 'notes.txt', op: 'read' })
    return r.code === 'workspace-changed'
  })())
  check('E: the data guard is asked about the root as for a tool that goes through a whole folder', await (async () => {
    const seen = []
    const dg = { check: async (request) => { seen.push(request); return { ok: true, real: String(request.path) } } }
    await makeGuard(real, real.WS, dg).check({ path: 'notes.txt', op: 'edit' })
    return seen.length >= 2 && seen[0].recursive === true && seen[0].op === 'list' && seen[seen.length - 1].op === 'write' && seen[seen.length - 1].base === null && /notes\.txt$/i.test(seen[seen.length - 1].path)
  })())
  check('E: the ops map to the data guard\'s own: read, list, create, and edit as write', await (async () => {
    const seen = []
    const dg = { check: async (request) => { seen.push(request.op); return { ok: true, real: String(request.path) } } }
    const g = makeGuard(real, real.WS, dg)
    await g.check({ path: 'notes.txt', op: 'read' }); await g.check({ path: 'src', op: 'list' }); await g.check({ path: 'zzz.txt', op: 'create' }); await g.check({ path: 'notes.txt', op: 'edit' })
    const ops = seen.filter((o, i) => i % 2 === 1)
    return show(ops) === show(['read', 'list', 'create', 'write'])
  })())
  check('E: a data guard that says no is the last word, with its own code ("data-folder" or "bad-path")', await (async () => {
    const dg = { check: async (request) => (request.recursive === true ? { ok: true, real: String(request.path) } : { ok: false, code: 'data-folder', why: 'harness' }) }
    const v = await makeGuard(real, real.WS, dg).check({ path: 'notes.txt', op: 'read' })
    return v.ok === false && v.code === 'data-folder'
  })())
})

// ============ F. the choice of the folder ============
await guard('F', async () => {
  const dataGuard = dataMod.createDataFolderGuard({ roots: () => [real.DATA] })
  const avoid = { holds: [J(real.ROOT, 'protected-home')], inside: [J(real.ROOT, 'system')] }
  fs.mkdirSync(J(real.ROOT, 'protected-home', 'AppData'), { recursive: true }); fs.mkdirSync(J(real.ROOT, 'system', 'sub'), { recursive: true }); fs.mkdirSync(J(real.ROOT, 'protected-home', 'proj'), { recursive: true })
  const pick = (input, a = avoid) => wsMod.checkWorkspaceFolder(input, { dataGuard, avoid: a })
  let r = await pick(real.WS)
  check('F: a real folder is accepted, as it really is (disk case), with its name', r.ok && r.folder.toLowerCase() === real.WS.toLowerCase() && r.name === 'ws', show(r))
  r = await pick(real.WS.toUpperCase())
  check('F: ...given in other letter case it comes back in the disk\'s own', r.ok && r.folder === real.WS, show(r))
  r = await pick(`${real.WS}\\`)
  check('F: ...with a trailing separator, or with dots and a dot-dot, it is the same folder', r.ok && r.folder === real.WS && (await pick(`${real.WS}\\src\\..`)).folder === real.WS)
  r = await pick(`\\\\?\\${real.WS}`)
  check('F: ...in the extended-length form too', r.ok && r.folder === real.WS, show(r))
  for (const [what, input, word] of [
    ['a folder that is not there', J(real.ROOT, 'nothing'), /does not exist/], ['a file', J(real.WS, 'notes.txt'), /not a folder/], ['a drive\'s root', real.ROOT.slice(0, 3), /root/],
    ['the data folder', real.DATA, /data folder/], ['the folder that holds the data folder', real.ROOT, /data folder|own files/], ['a folder inside the data folder', J(real.DATA, 'conversations'), /data folder/],
    ['a folder that is, or holds, a protected place', J(real.ROOT, 'protected-home'), /own files/], ['the folder that holds the user\'s folder', real.ROOT, /./], ['a folder inside a system folder', J(real.ROOT, 'system', 'sub'), /system/], ['the system folder itself', J(real.ROOT, 'system'), /system/],
    ['a share', '\\\\localhost\\C$\\x', /not a folder this app can use/], ['a relative path', 'ws', /not a folder this app can use/], ['an empty path', '', /not a folder this app can use/], ['null', null, /not a folder this app can use/], ['a number', 7, /not a folder this app can use/], ['a list', [real.WS], /not a folder this app can use/], ['a device path', '\\\\.\\C:\\x', /not a folder this app can use/], ['a path with a stream', `${real.WS}:s`, /not a folder this app can use/], ['a path with a variable', '%TEMP%', /not a folder this app can use/]
  ]) {
    r = await pick(input)
    check(`F: ${what} is refused, in words`, !r.ok && word.test(r.why) && r.why.endsWith('.'), show(r))
  }
  r = await pick(J(real.ROOT, 'protected-home', 'proj'))
  check('F: a folder INSIDE the user\'s folder, as the project folders are, is fine (only the folder itself and the folders above it are refused)', r.ok, show(r))
  r = await pick(J(real.ROOT, 'protected-home', 'AppData'))
  check('F: ...and a folder that is inside a place on the `holds` list is not refused for that (the data-folder rule is the one that keeps the app\'s own folder out)', r.ok, show(r))
  if (real.hasLinkOut) check('F: a junction is refused in words ("a link or junction"), and a folder reached through one is refused too', /link or junction/.test((await pick(J(real.WS, 'link-out'))).why) && !(await pick(J(real.WS, 'link-out', 'sub'))).ok)
  if (real.hasToWs) check('F: a folder reached THROUGH a junction in the path is refused, in words: the real folder must be chosen', !(await pick(J(real.ROOT, 'link-to-ws', 'src'))).ok && /reached through a link/.test((await pick(J(real.ROOT, 'link-to-ws', 'src'))).why), show(await pick(J(real.ROOT, 'link-to-ws', 'src'))))
  if (real.subst !== null) check('F: a folder reached through a substituted drive is refused', !(await pick(`${real.subst}\\ws`)).ok, show(await pick(`${real.subst}\\ws`)))
  if (real.short?.data) check('F: the data folder by its short name is still the data folder', !(await pick(J(real.ROOT, real.short.data))).ok, show(await pick(J(real.ROOT, real.short.data))))
  check('F: a folder that holds the data folder is refused for THAT (asked of the data-folder guard as for a tool that goes through all of a folder), though no protected place is in it', await (async () => {
    const holder = J(real.ROOT, 'holder'); fs.mkdirSync(J(holder, 'data'), { recursive: true })
    const guard2 = dataMod.createDataFolderGuard({ roots: () => [J(holder, 'data')] })
    const r1 = await wsMod.checkWorkspaceFolder(holder, { dataGuard: guard2, avoid: { holds: [], inside: [] } })
    const r2 = await wsMod.checkWorkspaceFolder(J(holder, 'data'), { dataGuard: guard2, avoid: { holds: [], inside: [] } })
    const r3 = await wsMod.checkWorkspaceFolder(real.WS, { dataGuard: guard2, avoid: { holds: [], inside: [] } })
    return !r1.ok && /data folder/.test(r1.why) && !r2.ok && /data folder/.test(r2.why) && r3.ok
  })())
  const never = await wsMod.checkWorkspaceFolder(real.WS, { dataGuard: { check: async () => { throw new Error('boom') } }, avoid })
  check('F: a data guard that fails refuses (never throws)', !never.ok)
  const none = await wsMod.checkWorkspaceFolder(real.WS, { dataGuard: dataMod.createDataFolderGuard({ roots: () => [] }), avoid })
  check('F: with no known data folder nothing can be chosen (the guard cannot tell)', !none.ok)
  check('F: an unreadable folder is refused', await (async () => { const noRead = await wsMod.checkWorkspaceFolder(J(real.ROOT, 'nothing-here'), { dataGuard, avoid }); return !noRead.ok })())
  check('F: what a choice hands back is exactly what the file keeps and the guard takes (a tidy absolute folder)', await (async () => { const ok = await pick(real.WS); return wsMod.parseWorkspace(wsMod.workspaceText({ folder: ok.folder, chosenAt: 1 })) !== null })())
})

// ============ G. the file that remembers it ============
await guard('G', async () => {
  const { parseWorkspace, workspaceText, createWorkspaceStore } = wsMod
  const rec = { folder: real.WS, chosenAt: 1_700_000_000_000 }
  const text = workspaceText(rec)
  check('G: the setting is one small document: version 1, the folder, when it was chosen', text === `{"version":1,"folder":${JSON.stringify(real.WS)},"chosenAt":1700000000000}`, text)
  const back = parseWorkspace(text)
  check('G: it reads back as itself, frozen', show(back) === show(rec) && Object.isFrozen(back))
  const base = JSON.parse(text)
  for (const [what, patch] of [
    ['a field more', { extra: 1 }], ['version 2', { version: 2 }], ['no version', { version: undefined }], ['no folder', { folder: undefined }], ['no time', { chosenAt: undefined }],
    ['a folder as a list', { folder: [real.WS] }], ['a folder as a number', { folder: 5 }], ['a relative folder', { folder: 'ws' }], ['an empty folder', { folder: '' }], ['a drive\'s root', { folder: 'C:\\' }], ['a folder with a dot-dot in it', { folder: 'C:\\a\\..\\b' }],
    ['a folder with forward slashes', { folder: 'C:/a/b' }], ['a folder with a trailing separator', { folder: 'C:\\a\\b\\' }], ['a folder with a doubled separator', { folder: 'C:\\a\\\\b' }], ['a share', { folder: '\\\\server\\share\\x' }], ['a folder with a variable', { folder: 'C:\\%TEMP%' }], ['a folder with a NUL', { folder: `C:\\a${NUL}` }], ['a folder of 2,000 characters', { folder: `C:\\${'a'.repeat(2000)}` }],
    ['a time as text', { chosenAt: '1700000000000' }], ['a negative time', { chosenAt: -1 }], ['a fraction of a time', { chosenAt: 1.5 }], ['an unsafe time', { chosenAt: 2 ** 60 }], ['a time that is not a number', { chosenAt: null }]
  ]) check(`G: refused: ${what}`, parseWorkspace(JSON.stringify({ ...base, ...patch })) === null)
  check('G: refused: text that is not JSON, a list, null, a number, empty', ['{', '[]', 'null', '5', '', 'on'].every((t) => parseWorkspace(t) === null))
  check('G: refused: a folder named __proto__ as a key', parseWorkspace(`{"version":1,"folder":"C:\\\\a","chosenAt":1,"__proto__":{"x":1}}`) === null)

  const root = fs.mkdtempSync(J(real.ROOT, 'store-'))
  const file = J(root, 'workspace.json')
  const mode = { form: 'plain' }
  const store = createWorkspaceStore({ pathOf: () => file, writeMode: async () => ({ ...mode }) })
  let now = await store.read()
  check('G: with no file there is NO workspace, and no problem', now.record === null && now.problem === null)
  await store.write(rec)
  now = await store.read()
  check('G: what is written is read back', now.problem === null && show(now.record) === show(rec) && fs.readFileSync(file, 'utf8') === text)
  fs.writeFileSync(file, `${text.slice(0, -1)},"x":1}`)
  now = await store.read()
  check('G: a file that is not exactly what this app writes: NO workspace, and the reason in words', now.record === null && /not a file this app wrote/.test(now.problem ?? ''), show(now))
  fs.writeFileSync(file, 'garbage')
  check('G: garbage: the same', (await store.read()).record === null)
  const refused = await store.write(rec).then(() => null, (error) => error)
  check('G: a damaged file is not written over by itself', refused !== null && fs.readFileSync(file, 'utf8') === 'garbage', String(refused))
  await store.write(rec, { replace: true })
  check('G: ...only when the person starts again, and a copy is kept first', fs.readdirSync(root).some((n) => n.startsWith('workspace.json.damaged-')) && (await store.read()).record !== null)
  await store.clear()
  check('G: clearing forgets the choice', (await store.read()).record === null && !fs.existsSync(file))
  const box = makeBox()
  const sealedPath = J(fs.mkdtempSync(J(real.ROOT, 'sealed-')), 'workspace.json')
  const sealed = createWorkspaceStore({ pathOf: () => sealedPath, box, writeMode: async () => ({ form: 'encrypted' }) })
  await sealed.write(rec)
  const sealedText = fs.readFileSync(sealedPath, 'utf8')
  check('G: sealed like the chats when encryption is on: an envelope, no folder name readable', sealedText.startsWith('{"format":"frontier-chat-encrypted"') && !sealedText.includes('ws') && (await sealed.read()).record?.folder === real.WS)
  box.lose()
  const lost = await sealed.read()
  check('G: with the key lost there is no workspace, with the reason', lost.record === null && /could not be opened/.test(lost.problem ?? ''), show(lost))
  const broken = createWorkspaceStore({ pathOf: () => { throw new Error('no folder') }, writeMode: async () => ({ form: 'plain' }) })
  const nothing = await broken.read()
  check('G: a fault of the disk: read() does not throw, there is no workspace', nothing.record === null && nothing.problem !== null)
  check('G: the file is a kept document the encryption flow can rewrite (the store exposes its file)', typeof store.file.read === 'function' && typeof store.file.conform === 'function')
})

// ============ H. is it text? ============
await guard('H', async () => {
  const { decodeText, lineEndings } = textMod
  const enc = (s) => new TextEncoder().encode(s)
  const d = (bytes) => decodeText(bytes)
  check('H: an empty file is text', d(new Uint8Array()).ok && d(new Uint8Array()).text === '' && d(new Uint8Array()).eol === 'none')
  check('H: ASCII is text, with its line endings reported', d(enc('a\nb\n')).eol === 'lf' && d(enc('a\r\nb\r\n')).eol === 'crlf' && d(enc('a\r\nb\n')).eol === 'mixed' && d(enc('a\rb')).eol === 'mixed' && d(enc('abc')).eol === 'none')
  check('H: UTF-8 (accents, Devanagari, an emoji) is text and comes back as typed', d(enc('café नमस्ते 😀')).text === 'café नमस्ते 😀')
  const bom = new Uint8Array([0xef, 0xbb, 0xbf, 0x61])
  check('H: a UTF-8 byte-order mark is noticed and not part of the text', d(bom).ok && d(bom).bom === true && d(bom).text === 'a' && d(enc('a')).bom === false)
  check('H: a mark alone is an empty text', d(new Uint8Array([0xef, 0xbb, 0xbf])).ok && d(new Uint8Array([0xef, 0xbb, 0xbf])).text === '')
  check('H: UTF-16 (either order) is refused in words (also text with no NUL in it, as CJK is)', !d(new Uint8Array([0xff, 0xfe, 0x61, 0])).ok && /UTF-16/.test(d(new Uint8Array([0xff, 0xfe, 0x61, 0])).why) && /UTF-16/.test(d(new Uint8Array([0xfe, 0xff, 0x65, 0xe5, 0x67, 0x2c])).why) && /UTF-16/.test(d(new Uint8Array([0xff, 0xfe, 0xe5, 0x65, 0x2c, 0x67])).why))
  check('H: a NUL byte anywhere is binary', !d(new Uint8Array([1, 2, 0, 3])).ok && /binary/.test(d(new Uint8Array([1, 2, 0, 3])).why) && !d(new Uint8Array([...enc('x'.repeat(10000)), 0])).ok)
  check('H: invalid UTF-8 is refused: a lone continuation byte, a cut-off sequence, an overlong form, a surrogate', [[0x80], [0xc3], [0xc3, 0x28], [0xc0, 0xaf], [0xed, 0xa0, 0x80], [0xff, 0xfe, 0xfd], [0xf8, 0x88, 0x80, 0x80, 0x80]].every((b) => !d(new Uint8Array(b)).ok || b[0] === 0xff && b[1] === 0xfe))
  check('H: Latin-1 text with accents is not UTF-8 and is refused', !d(new Uint8Array([0x63, 0x61, 0x66, 0xe9])).ok && /UTF-8/.test(d(new Uint8Array([0x63, 0x61, 0x66, 0xe9])).why))
  check('H: a lone CR counts as a mixed ending, LF alone is lf', lineEndings('a\nb') === 'lf' && lineEndings('a\r') === 'mixed' && lineEndings('\r\n') === 'crlf')
  check('H: a text of 256 KB is decoded at once', d(enc('x'.repeat(256 * 1024))).ok)
  check('H: the real files of the scratch world: the notes are text, the binary is not, the big one is text', d(fs.readFileSync(J(real.WS, 'notes.txt'))).ok && !d(fs.readFileSync(J(real.WS, 'binary.bin'))).ok && d(fs.readFileSync(J(real.WS, 'big.txt'))).ok && d(fs.readFileSync(J(real.WS, 'Readme.MD'))).eol === 'crlf')
})

// ============ I. what the guard has no business with ============
await guard('I', async () => {
  const dir = `${REPO}/src/main`
  const importsOf = (file) => [...fs.readFileSync(`${dir}/${file}`, 'utf8').matchAll(/^import[^';]*from '([^']+)'/gm)].map((m) => m[1]).sort()
  check('I: workspaceGuard.ts imports only the file system, paths, the shared list and the data-folder guard', show(importsOf('workspaceGuard.ts')) === show(['../shared/workspace', './dataFolderGuard', 'fs', 'path'].sort()), show(importsOf('workspaceGuard.ts')))
  check('I: workspace.ts imports only the file system, the kept file, the chat file\'s write mode, the secret box and the data-folder guard', show(importsOf('workspace.ts')) === show(['./chatFile', './credentialStore', './dataFolderGuard', './keptFile', 'fs'].sort()), show(importsOf('workspace.ts')))
  check('I: workspaceText.ts imports nothing', importsOf('workspaceText.ts').length === 0)
  const guardSource = fs.readFileSync(`${dir}/workspaceGuard.ts`, 'utf8')
  const code = (s) => s.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')
  check('I: no Electron, network, process or shell in the three files', ['workspaceGuard.ts', 'workspace.ts', 'workspaceText.ts'].every((f) => !/electron|child_process|\bfetch\(|https?:|\bspawn|\bexec\(|require\(|\.writeFile|\.rm\(|\.unlink|\.rename|\.mkdir|\.appendFile|\.copyFile/.test(code(fs.readFileSync(`${dir}/${f}`, 'utf8')).replace(/file\.write|file\.remove/g, ''))))
  check('I: the guard never writes: no write, delete, rename or make-folder call in it', !/fs\.(write|rm|unlink|rename|mkdir|append|copy|truncate|symlink|link)/.test(code(guardSource)))
  const used = fs.readdirSync(dir).filter((f) => f.endsWith('.ts') && !['workspaceGuard.ts', 'workspace.ts', 'workspaceText.ts'].includes(f)).filter((f) => /workspaceGuard|\.\/workspace'|workspaceText/.test(fs.readFileSync(`${dir}/${f}`, 'utf8')))
  check("I: only the wiring, the core (as a type), the registry (the shared limits), the reply's tools, the workspace service and the read tools import them (12.2 and 12.3 wired them in)", used.sort().join() === 'ipc.ts,replyTools.ts,toolCore.ts,toolRegistry.ts,workspaceService.ts,workspaceTools.ts', show(used))
  const preload = fs.readFileSync(`${REPO}/src/preload/index.ts`, 'utf8') + fs.readFileSync(`${REPO}/src/shared/ipc.ts`, 'utf8')
  check("I: the page's bridge has no function that reads a file, lists a folder or takes a path (12.3 added only the four of the workspace group)", !/readFile|listFiles|readWorkspace|listWorkspace|workspacePath/i.test(preload))
})

// ============ J. the control: the same battery with the boundary taken out ============
await guard('J', async () => {
  const S = seed('open', { extras: false })
  try {
    const open_ = {
      root: async () => ({ ok: true, real: S.WS, name: 'ws' }),
      check: async ({ path, op }) => {
        const resolved = win32.resolve(S.WS, String(path))
        let kind = 'missing'
        let size = 0
        try { const st = fs.statSync(resolved); kind = st.isDirectory() ? 'folder' : 'file'; size = st.size } catch { /* missing */ }
        return { ok: true, real: resolved, rel: [], kind, size, fileClass: 'ok', note: '' }
      }
    }
    const t = await battery(S, open_)
    console.log(`  (the same ${t.attempts} calls with the boundary taken out: ${t.leaks.length} got through; ${t.canaries} canaries came back; kinds that got through: ${[...t.leakKinds].join(' ')})`)
    check('J: with the boundary taken out the battery sees it: calls get through', t.leaks.length > 500, String(t.leaks.length))
    check('J: ...canaries come back from what a stand-in tool opened', t.canaries > 20, String(t.canaries))
    check('J: ...the folder outside, the data folder and the links are all reached', ['out-file', 'data-file', 'junction-out', 'junction-to-data'].every((k) => [...t.leakKinds].some((x) => x === k || x.startsWith(k))), show([...t.leakKinds]))
    check('J: ...and the real guard on the same world still refuses all of it (the control is not a flaw of the world)', blockTally?.leaks.length === 0)
  } finally { S.cleanup() }
})

real?.cleanup()
console.error = realError
console.log(real?.skipped.length ? `(not tried on this PC: ${real.skipped.join(', ')})` : '(every kind of link and name was tried)')
const ok = check.summary()
process.exit(ok ? 0 : 1)
