// The file-system guard (tools/fsguard.mjs, D-043) under plain Node, Windows only. It is the safety net under every check that runs code which writes, renames or removes,
// so it is tested FIRST and by itself:
//   A. the decision: what is allowed and what is refused (drive roots, the user's folder, the repo, a sibling with the same start, `..`, case, forward slashes, the long-path
//      prefix, a relative path, a junction that leads out, names Windows reads differently, wildcards, streams, NUL, empty, UNC), and removing is refused everywhere;
//   B. the hooks: every function of fs that makes, writes, renames, copies to, links or removes, in its three forms (sync, callback, promise), is refused outside the allowed
//      folder with error.code EFSGUARD, and the outside is exactly as it was; named imports taken before the guard was installed are guarded too;
//   C. what is allowed still works (inside the folder: every form), and reading works anywhere;
//   D. uninstalling puts every function back; installing twice is refused; a folder near the top of a drive, or a remove folder outside the write folder, cannot be named;
//   E. completeness: every function of fs and fs.promises is either guarded, or on the reviewed list of harmless ones (readers, file-handle calls, classes), or on the list
//      of known holes: a Node version that brings a new function fails here until someone has decided which it is.
//
// NOTHING IS REMOVED HERE, by design (the owner's rule of 2026-10-09: nothing is deleted from any drive): every call that would remove is aimed at a name that does not
// exist, so even a broken guard cannot remove anything while it is being tested. The folder this makes in the temp folder is left in place.
//
//   F. the wrapper tools/guarded.mjs, which runs an older check confined to one fresh folder of the run in C:\frontier-tmp and removes that folder afterwards: what such a check can do
//      (make, rename, remove its own things), what it cannot (anything beside a decoy file), that the exit code is the check's, and that the scope is fixed in the wrapper.
//
// Run: node tools/verify-fsguard.mjs
import './paths.mjs'
import { checker } from './cdp.mjs'
import fs, { rmSync as namedRmSync, writeFileSync as namedWriteFileSync } from 'node:fs'
import { rm as namedPromisesRm } from 'node:fs/promises'
import os from 'node:os'
import { win32 } from 'node:path'
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { GUARDED, REFUSED, currentGuard, installFsGuard } from './fsguard.mjs'
import { REPO_WIN, TOOLS } from './paths.mjs'

const check = checker()
const J = win32.join
const show = (v) => JSON.stringify(v)?.slice(0, 300)

// every guarded name in its three forms, as they were before the guard
const ORIGINAL = []
for (const base of Object.keys(GUARDED)) {
  ORIGINAL.push([fs, base], [fs, base + 'Sync'], [fs.promises, base])
}
ORIGINAL.push([fs, 'createWriteStream'])
const before = ORIGINAL.map(([target, name]) => [target, name, target[name]])

const BASE = fs.realpathSync.native(fs.mkdtempSync(J(os.tmpdir(), 'frontier-fsguard-')))
const ALLOWED = J(BASE, 'allowed')
const OUTSIDE = J(BASE, 'outside')
const EVIL = J(BASE, 'allowed-evil') // starts like ALLOWED
for (const d of [ALLOWED, OUTSIDE, EVIL]) fs.mkdirSync(d)
fs.writeFileSync(J(OUTSIDE, 'keep.txt'), 'KEEP')
fs.writeFileSync(J(EVIL, 'keep2.txt'), 'KEEP2')
fs.writeFileSync(J(ALLOWED, 'a.txt'), 'A')
fs.symlinkSync(OUTSIDE, J(ALLOWED, 'jn'), 'junction') // a junction that leads out of the allowed folder
const keepTime = fs.statSync(J(OUTSIDE, 'keep.txt')).mtimeMs
console.log(`(the guard's test folder, left in place: ${BASE})`)

// ============================ D (first part). roots that cannot be named ======================
// done before the guard is installed for good: these only make a decision, nothing is patched, nothing touches a file
const refusedRoot = (opts) => {
  try {
    installFsGuard({ ...opts, watch: false })
    currentGuard()?.uninstall()
    return false
  } catch (error) {
    return /fsguard/.test(String(error.message))
  }
}
check('D: a drive root cannot be named as the folder to write in', refusedRoot({ write: ['A:\\'] }) && refusedRoot({ write: ['C:\\'] }))
check('D: a folder one level below a drive cannot be named either (C:\\Users, a bare C:\\frontier-tmp)', refusedRoot({ write: ['C:\\Users'] }) && refusedRoot({ write: ['C:\\frontier-tmp'] }))
check('D: no folder to write in is refused', refusedRoot({ write: [] }) && refusedRoot({}))
check('D: a remove folder outside the write folder is refused', refusedRoot({ write: [ALLOWED], remove: [OUTSIDE] }))
check('D: a write folder given as a wildcard or a stream name is refused', refusedRoot({ write: [J(BASE, 'a*')] }) && refusedRoot({ write: [J(BASE, 'a:b')] }))

// ============================ install ======================================================
const guard = installFsGuard({ write: [ALLOWED] })
check('the guard is installed, and says which functions it watches', currentGuard() === guard && guard.patched.length > 50, `${guard.patched.length} functions`)
check('B: installing it a second time is refused', (() => { try { installFsGuard({ write: [ALLOWED] }); return false } catch (error) { return /installed already/.test(error.message) } })())

// ============================ A. the decision ==============================================
const allowed = (op, p, base) => guard.check(op, p, base) === null
const refused = (op, p, base) => typeof guard.check(op, p, base) === 'string'
const drive = win32.parse(BASE).root
const homeDir = os.homedir()
const cwd0 = process.cwd()
const okPaths = {
  'the folder itself': ALLOWED,
  'a file in it': J(ALLOWED, 'x'),
  'a deep path': J(ALLOWED, 'x', 'y', 'z.txt'),
  'with a trailing separator': ALLOWED + '\\',
  'in capitals': ALLOWED.toUpperCase() + '\\X',
  'with forward slashes': ALLOWED.replaceAll('\\', '/') + '/x/y',
  'with the long-path prefix': '\\\\?\\' + ALLOWED + '\\x',
  'with the device prefix': '\\\\.\\' + ALLOWED + '\\x',
  'going down and back up inside it': ALLOWED + '\\sub\\..\\x',
  'as a Buffer': Buffer.from(J(ALLOWED, 'x')),
  'as a file URL': pathToFileURL(J(ALLOWED, 'x')),
  'the junction itself (its folder is inside)': J(ALLOWED, 'jn')
}
for (const [what, p] of Object.entries(okPaths)) check(`A: writing is allowed: ${what}`, allowed('write', p), String(guard.check('write', p)))
const badPaths = {
  'the folder above': BASE,
  'a sibling folder': OUTSIDE,
  'a file in the sibling': J(OUTSIDE, 'keep.txt'),
  'a sibling whose name starts like the allowed one': EVIL,
  'a file in it': J(EVIL, 'keep2.txt'),
  'a longer name with the same start': ALLOWED + 'x',
  'out through ..': ALLOWED + '\\..\\outside\\keep.txt',
  'out through .. in capitals': ALLOWED.toUpperCase() + '\\..\\OUTSIDE\\keep.txt',
  'the drive root of the test folder': drive,
  'drive A:': 'A:\\',
  'drive C:': 'C:\\',
  'a file at the root of a drive': 'A:\\UserFiles\\x.txt',
  'the Windows folder': 'C:\\Windows',
  'the system root': process.env.SystemRoot ?? 'C:\\Windows',
  "the user's folder": homeDir,
  'the repo': REPO_WIN,
  'the repo through forward slashes': REPO_WIN.replaceAll('\\', '/') + '/src',
  'a share on the network': '\\\\server\\share\\x',
  'the long-path prefix on a network name': '\\\\?\\UNC\\server\\share\\x',
  'a name that ends in a dot': J(ALLOWED, 'x.'),
  'a name that ends in a space': J(ALLOWED, 'x '),
  'a stream name': J(ALLOWED, 'x:stream'),
  'a wildcard star': J(ALLOWED, 'a*'),
  'a wildcard question mark': J(ALLOWED, 'a?'),
  'a bar': J(ALLOWED, 'a|b'),
  'an empty path': '',
  'a NUL character': J(ALLOWED, 'x\0y'),
  'a path through a junction that leads out': J(ALLOWED, 'jn', 'new.txt'),
  'a deeper path through that junction': J(ALLOWED, 'jn', 'a', 'b.txt')
}
for (const [what, p] of Object.entries(badPaths)) check(`A: writing is refused: ${what}`, refused('write', p), String(guard.check('write', p)))
for (const p of [J(ALLOWED, 'x'), ALLOWED, J(ALLOWED, 'x', 'y'), J(OUTSIDE, 'keep.txt'), 'A:\\', drive]) {
  check(`A: removing is refused while no remove folder has been named (${p.length > 40 ? '...' + p.slice(-36) : p})`, refused('remove', p))
}
check('A: a file descriptor or a handle is not a path: the guard leaves it to the call that opened it', guard.check('write', 5) === null && guard.check('write', { fd: 5 }) === null)
{
  process.chdir(ALLOWED)
  const rel = [allowed('write', 'x.txt'), allowed('write', '.\\sub\\y.txt'), refused('write', '..\\outside\\keep.txt'), refused('write', '..'), refused('write', '..\\allowed-evil\\keep2.txt')]
  process.chdir(cwd0)
  check('A: a relative path is judged against the working folder (inside: allowed; out through ..: refused)', rel.every(Boolean), show(rel))
}
check('A: a relative symlink target is judged against the folder of the link', allowed('write', '..\\a.txt', J(ALLOWED, 'sub')) && refused('write', '..\\..\\outside\\keep.txt', J(ALLOWED, 'sub')))

// ============================ B. the hooks refuse ==========================================
let n = 0
const fresh = (dir) => J(dir, `new-${++n}.txt`)
const calls = (outside, inside) => ({
  writeFile: [[fresh(outside), 'x']],
  appendFile: [[fresh(outside), 'x']],
  mkdir: [[fresh(outside), { recursive: true }]],
  mkdtemp: [[fresh(outside) + '-']],
  mkdtempDisposable: [[fresh(outside) + '-'], [fresh(inside) + '-']], // needs the right to remove too
  truncate: [[J(OUTSIDE, 'keep.txt'), 0]],
  utimes: [[J(OUTSIDE, 'keep.txt'), new Date(0), new Date(0)]],
  lutimes: [[J(OUTSIDE, 'keep.txt'), new Date(0), new Date(0)]],
  chmod: [[J(OUTSIDE, 'keep.txt'), 0o444]],
  lchmod: [[J(OUTSIDE, 'keep.txt'), 0o444]],
  chown: [[fresh(outside), 0, 0]],
  lchown: [[fresh(outside), 0, 0]],
  // removing: every target is a name that does not exist
  rm: [[fresh(inside), { recursive: true, force: true }], [fresh(outside), { recursive: true, force: true }], [fresh(drive.replace(/\\$/, '') + '\\frontier-absent-'.concat(Date.now())), { recursive: true, force: true }]],
  rmdir: [[fresh(inside)], [fresh(outside)]],
  unlink: [[fresh(inside)], [fresh(outside)]],
  rename: [[J(ALLOWED, 'a.txt'), fresh(outside)], [J(OUTSIDE, 'keep.txt'), fresh(inside)], [fresh(outside), fresh(outside)]],
  copyFile: [[J(ALLOWED, 'a.txt'), fresh(outside)]],
  cp: [[J(ALLOWED, 'a.txt'), fresh(outside)]],
  link: [[J(ALLOWED, 'a.txt'), fresh(outside)], [J(OUTSIDE, 'keep.txt'), fresh(inside)]],
  symlink: [[J(ALLOWED, 'a.txt'), fresh(outside), 'file'], [OUTSIDE, fresh(inside), 'junction'], ['..\\outside', fresh(inside), 'junction']],
  open: [[fresh(outside), 'w'], [J(OUTSIDE, 'keep.txt'), 'r+'], [fresh(outside), 'a'], [fresh(outside), fs.constants.O_WRONLY | fs.constants.O_CREAT]]
})

function attempt(style, base, args) {
  return new Promise((resolve) => {
    const finish = (error, result) => {
      if (!error && typeof result === 'number') fs.closeSync(result)
      else if (!error && result && typeof result.fd === 'number' && typeof result.close === 'function') result.close().catch(() => undefined) // a file handle; never a disposable (it would remove)
      resolve(error ? (error.code ?? String(error.message).slice(0, 60)) : 'OK')
    }
    try {
      if (style === 'sync') {
        const f = fs[base + 'Sync']
        if (typeof f !== 'function') return resolve('MISSING')
        return finish(null, f(...args))
      }
      if (style === 'callback') {
        const f = fs[base]
        if (typeof f !== 'function') return resolve('MISSING')
        return void f(...args, (error, result) => finish(error, result))
      }
      const f = fs.promises[base]
      if (typeof f !== 'function') return resolve('MISSING')
      return void Promise.resolve(f(...args)).then((result) => finish(null, result), (error) => finish(error))
    } catch (error) {
      finish(error)
    }
  })
}

const refusedWhere = []
let tried = 0
for (const style of ['sync', 'callback', 'promise']) {
  for (const [base, list] of Object.entries(calls(OUTSIDE, ALLOWED))) {
    for (const args of list) {
      const code = await attempt(style, base, args)
      if (code === 'MISSING') continue
      tried++
      if (code !== REFUSED) refusedWhere.push(`${style} ${base} ${show(args[0]).slice(-40)} -> ${code}`)
    }
  }
}
check(`B: every function that makes, writes, renames, copies to, links or removes is refused outside the folder, in all three forms (${tried} calls)`, tried > 60 && refusedWhere.length === 0, refusedWhere.slice(0, 6).join(' | '))
{
  let stream = 'no error'
  try {
    fs.createWriteStream(fresh(OUTSIDE))
  } catch (error) {
    stream = error.code
  }
  check('B: a write stream outside the folder is refused', stream === REFUSED, stream)
}
check('B: a named import taken before the guard was installed is guarded too (rmSync, writeFileSync)', (() => {
  const codes = []
  for (const f of [() => namedRmSync(fresh(ALLOWED), { force: true }), () => namedWriteFileSync(fresh(OUTSIDE), 'x')]) {
    try {
      f()
      codes.push('no error')
    } catch (error) {
      codes.push(error.code)
    }
  }
  return codes.every((c) => c === REFUSED)
})())
check('B: a named import of fs/promises is guarded too (rm)', await namedPromisesRm(fresh(ALLOWED), { force: true }).then(() => 'no error', (error) => error.code) === REFUSED)
check('B: a read-only open is not in the way (r, rs, and the number O_RDONLY)', (() => {
  const fds = [fs.openSync(J(OUTSIDE, 'keep.txt'), 'r'), fs.openSync(J(OUTSIDE, 'keep.txt'), 'rs'), fs.openSync(J(OUTSIDE, 'keep.txt'), fs.constants.O_RDONLY)]
  for (const fd of fds) fs.closeSync(fd)
  return true
})())
check('B: a refusal says what and why', guard.refusals.length > 50 && guard.refusals.every((r) => typeof r.name === 'string' && /not inside a folder this check may (write in|remove from)|NUL|dot|wildcard|colon|empty/.test(r.reason)), show(guard.refusals[0]))
{
  const names = fs.readdirSync(OUTSIDE).sort()
  check('B: nothing was made outside the folder, and nothing was changed there (names, content, time)', JSON.stringify(names) === '["keep.txt"]' && fs.readFileSync(J(OUTSIDE, 'keep.txt'), 'utf8') === 'KEEP' && fs.statSync(J(OUTSIDE, 'keep.txt')).mtimeMs === keepTime && JSON.stringify(fs.readdirSync(EVIL)) === '["keep2.txt"]' && fs.readFileSync(J(EVIL, 'keep2.txt'), 'utf8') === 'KEEP2', show(names))
  const inside = fs.readdirSync(ALLOWED).sort()
  check('B: and nothing was made or moved inside it by a refused call', JSON.stringify(inside) === '["a.txt","jn"]' && fs.readFileSync(J(ALLOWED, 'a.txt'), 'utf8') === 'A', show(inside))
}

// ============================ C. what is allowed still works ===============================
const bad = []
for (const style of ['sync', 'callback', 'promise']) {
  const dir = J(ALLOWED, `ok-${style}`)
  const run = async (what, base, args, verify) => {
    const code = await attempt(style, base, args)
    let ok = code === 'OK'
    if (ok && verify) ok = await verify()
    if (!ok) bad.push(`${style} ${what}: ${code}`)
  }
  await run('mkdir', 'mkdir', [J(dir, 'sub', 'deep'), { recursive: true }], () => fs.statSync(J(dir, 'sub', 'deep')).isDirectory())
  await run('writeFile', 'writeFile', [J(dir, 'f.txt'), 'hello'], () => fs.readFileSync(J(dir, 'f.txt'), 'utf8') === 'hello')
  await run('appendFile', 'appendFile', [J(dir, 'f.txt'), '!'], () => fs.readFileSync(J(dir, 'f.txt'), 'utf8') === 'hello!')
  await run('copyFile', 'copyFile', [J(dir, 'f.txt'), J(dir, 'g.txt')], () => fs.readFileSync(J(dir, 'g.txt'), 'utf8') === 'hello!')
  await run('cp', 'cp', [J(dir, 'f.txt'), J(dir, 'h.txt')], () => fs.readFileSync(J(dir, 'h.txt'), 'utf8') === 'hello!')
  await run('rename', 'rename', [J(dir, 'g.txt'), J(dir, 'g2.txt')], () => fs.existsSync(J(dir, 'g2.txt')) && !fs.existsSync(J(dir, 'g.txt')))
  await run('link', 'link', [J(dir, 'f.txt'), J(dir, 'f-twin.txt')], () => fs.statSync(J(dir, 'f.txt')).nlink === 2)
  await run('symlink (a junction to a folder inside)', 'symlink', [J(dir, 'sub'), J(dir, 'jn-in'), 'junction'], () => fs.lstatSync(J(dir, 'jn-in')).isSymbolicLink())
  await run('symlink (a relative target is read from the folder of the link, as the guard assumes)', 'symlink', ['sub', J(dir, 'jn-rel'), 'junction'], () => fs.realpathSync.native(J(dir, 'jn-rel')).toLowerCase() === J(dir, 'sub').toLowerCase())
  await run('truncate', 'truncate', [J(dir, 'h.txt'), 2], () => fs.readFileSync(J(dir, 'h.txt'), 'utf8') === 'he')
  await run('utimes', 'utimes', [J(dir, 'h.txt'), new Date(1e12), new Date(1e12)], () => Math.abs(fs.statSync(J(dir, 'h.txt')).mtimeMs - 1e12) < 2000)
  await run('chmod', 'chmod', [J(dir, 'h.txt'), 0o666])
  await run('open for writing', 'open', [J(dir, 'o.txt'), 'w'], () => fs.existsSync(J(dir, 'o.txt')))
  await run('open with the numbers', 'open', [J(dir, 'o2.txt'), fs.constants.O_WRONLY | fs.constants.O_CREAT], () => fs.existsSync(J(dir, 'o2.txt')))
  await run('mkdtemp', 'mkdtemp', [J(dir, 'tmp-')], () => fs.readdirSync(dir).some((x) => x.startsWith('tmp-')))
}
check('C: inside the folder every kind of write works, in all three forms (the folder is made, written, appended to, copied, renamed, linked, truncated, touched, opened)', bad.length === 0, bad.slice(0, 5).join(' | '))
{
  const w = fs.createWriteStream(J(ALLOWED, 'stream.txt'))
  await new Promise((resolve) => w.end('streamed', resolve))
  check('C: a write stream inside the folder works', fs.readFileSync(J(ALLOWED, 'stream.txt'), 'utf8') === 'streamed')
}
check('C: reading works anywhere (the repo, the user folder, the system folder, a sibling)', fs.readdirSync(REPO_WIN).length > 3 && fs.existsSync(homeDir) && fs.statSync('C:\\Windows').isDirectory() && fs.readFileSync(J(OUTSIDE, 'keep.txt'), 'utf8') === 'KEEP' && (await fs.promises.readFile(J(OUTSIDE, 'keep.txt'), 'utf8')) === 'KEEP')
check('C: nothing was refused in the allowed calls (the refusals are all from section B)', !guard.refusals.some((r) => /ok-(sync|callback|promise)/.test(r.reason)), show(guard.refusals.filter((r) => /ok-(sync|callback|promise)/.test(r.reason)).slice(0, 3)))
check('C: a second write folder can be named later, only by name and only below the depth rule', (() => {
  const extra = J(BASE, 'extra', 'deeper')
  guard.allowWrite(extra)
  return allowed('write', J(extra, 'x')) && refused('write', J(BASE, 'extra', 'x')) && (() => { try { guard.allowWrite('C:\\Users'); return false } catch { return true } })()
})())
{
  // naming a remove folder (what a later, owner-approved suite will do) makes removal possible there and only there; nothing is removed here
  guard.allowRemove(J(ALLOWED, 'ok-sync'))
  check('C: a remove folder, once named, allows removing inside it and nowhere else (decided only; nothing is removed)', allowed('remove', J(ALLOWED, 'ok-sync', 'f.txt')) && allowed('remove', J(ALLOWED, 'ok-sync')) && refused('remove', ALLOWED) && refused('remove', J(ALLOWED, 'ok-promise', 'f.txt')) && refused('remove', J(OUTSIDE, 'keep.txt')))
}

// making sure a folder is there: the one call outside the folder that changes nothing, and so is not refused
{
  const forms = ['sync', 'callback', 'promise']
  const there = []
  for (const style of forms) there.push(await attempt(style, 'mkdir', [OUTSIDE, { recursive: true }]))
  check('C: making sure a folder is there (mkdir with recursive) is not refused when it is already there, even outside the folder; nothing changes', there.every((x) => x === 'OK') && JSON.stringify(fs.readdirSync(OUTSIDE)) === '["keep.txt"]', show(there))
  const not = []
  for (const style of forms) not.push(await attempt(style, 'mkdir', [J(OUTSIDE, 'not-yet'), { recursive: true }]))
  check('C: but a folder that is not there yet is a write, and is refused outside the folder', not.every((x) => x === REFUSED) && !fs.existsSync(J(OUTSIDE, 'not-yet')), show(not))
  check('C: and so is making the folder that is there without `recursive` (it would fail anyway), or one that is a FILE', (await attempt('sync', 'mkdir', [OUTSIDE])) === REFUSED && (await attempt('sync', 'mkdir', [J(OUTSIDE, 'keep.txt'), { recursive: true }])) === REFUSED && (await attempt('sync', 'mkdir', [OUTSIDE, { recursive: false }])) === REFUSED)
}

// ============================ D. uninstalling ==============================================
guard.uninstall()
check('D: uninstalling puts every function back exactly as it was (all forms)', before.every(([target, name, original]) => target[name] === original), before.filter(([target, name, original]) => target[name] !== original).map((x) => x[1]).join(','))
check('D: and no guard is current afterwards', currentGuard() === null)
check('D: a named import is back to the original too', namedRmSync === fs.rmSync && namedWriteFileSync === fs.writeFileSync)
{
  const again = installFsGuard({ write: [ALLOWED] })
  check('D: it can be installed again, and works again', await attempt('sync', 'writeFile', [fresh(OUTSIDE), 'x']) === REFUSED && await attempt('sync', 'writeFile', [fresh(ALLOWED), 'x']) === 'OK')
  again.uninstall()
}

// ============================ E. completeness ==============================================
const guardedNames = new Set()
for (const base of Object.keys(GUARDED)) for (const n2 of [base, base + 'Sync']) guardedNames.add(n2)
guardedNames.add('createWriteStream')
// reviewed on Node 24.21 (2026-10-09): everything else in fs and fs.promises
const HARMLESS = new Set(
  (
    'access accessSync close closeSync createReadStream exists existsSync fchmod fchmodSync fchown fchownSync fdatasync fdatasyncSync fstat fstatSync fsync fsyncSync ' +
    'ftruncate ftruncateSync futimes futimesSync glob globSync lstat lstatSync openAsBlob opendir opendirSync read readFile readFileSync readSync readdir readdirSync ' +
    'readlink readlinkSync readv readvSync realpath realpathSync stat statSync statfs statfsSync unwatchFile watch watchFile write writeSync writev writevSync ' +
    'Dir Dirent FileReadStream ReadStream Stats _toUnixTimestamp'
  ).split(' ')
)
// functions that can write and are NOT guarded: stream classes made with `new` (the guard cannot see the path in a constructor it did not wrap)
const KNOWN_HOLES = new Set(['WriteStream', 'FileWriteStream', 'Utf8Stream'])
const fnNames = (o) => Object.keys(o).filter((k) => typeof o[k] === 'function')
const unknown = [...new Set([...fnNames(fs), ...fnNames(fs.promises)])].filter((k) => !guardedNames.has(k) && !HARMLESS.has(k) && !KNOWN_HOLES.has(k))
check('E: every function of fs and fs.promises is guarded, reviewed as harmless, or listed as a known hole', unknown.length === 0, `NEW AND UNREVIEWED: ${unknown.join(', ')}`)
check('E: every name on the guarded and the harmless lists still exists (the lists are not stale)', [...Object.keys(GUARDED)].every((b) => typeof fs[b] === 'function' || typeof fs[b + 'Sync'] === 'function' || typeof fs.promises[b] === 'function') && [...HARMLESS].every((k) => k in fs || k in fs.promises), [...HARMLESS].filter((k) => !(k in fs || k in fs.promises)).join(','))
console.log(`(known holes, not guarded: ${[...KNOWN_HOLES].join(', ')}; child processes and worker threads are not watched either)`)

// ============================ F. the wrapper that confines an older check ==================
{
  const decoy = J(BASE, 'wrapper-decoy.txt')
  fs.writeFileSync(decoy, 'DECOY')
  const guardedMjs = J(TOOLS, 'guarded.mjs')
  const listRuns = () => fs.readdirSync('C:\\frontier-tmp').filter((n) => /^guarded-/.test(n))
  const beforeRuns = new Set(listRuns())
  const run = spawnSync(process.execPath, [guardedMjs, J(TOOLS, 'guarded-selftest.mjs')], { encoding: 'utf8', env: { ...process.env, GUARDED_DECOY: decoy } })
  const line = /RESULT (\{.*\})/.exec(run.stdout ?? '')
  const res = line === null ? null : JSON.parse(line[1])
  check('F: a check run through guarded.mjs runs, and its exit code is the wrapper\'s', run.status === 0 && res !== null, show({ status: run.status, out: (run.stdout ?? '').slice(0, 200), err: (run.stderr ?? '').slice(0, 300) }))
  check('F: it can make, rename and remove its own things (its temp folder is a fresh one of the run)', res?.ownWrite === 'DONE' && res.ownRename === 'DONE' && res.ownRemove === 'DONE' && res.ownGone === true && /^C:\\frontier-tmp\\guarded-[A-Za-z0-9]+$/.test(res.tmp ?? '') && res.keepTemp === '1', show(res))
  check('F: and nothing beside it: removing the decoy and writing or making things next to it are refused, and the decoy is untouched', res?.removeDecoy === REFUSED && res.writeBeside === REFUSED && res.mkdirBeside === REFUSED && fs.readFileSync(decoy, 'utf8') === 'DECOY' && !fs.existsSync(`${decoy}.new`) && !fs.existsSync(`${decoy}.dir`), show(res))
  check('F: making sure that a folder that is there is there is not refused (the checks\' paths.mjs does it at import)', res?.mkdirThere === 'DONE', show(res))
  check('F: the run\'s own folder is removed when the check is over, and no other folder of C:\\frontier-tmp is', listRuns().every((n) => beforeRuns.has(n)) && fs.existsSync(decoy))
  const exit7 = spawnSync(process.execPath, [guardedMjs, J(TOOLS, 'guarded-selftest.mjs')], { encoding: 'utf8', env: { ...process.env, GUARDED_DECOY: decoy, GUARDED_EXIT: '7' } })
  check('F: the exit code of the check is the wrapper\'s', exit7.status === 7)
  const nothing = spawnSync(process.execPath, [guardedMjs, J(TOOLS, 'no-such-check.mjs')], { encoding: 'utf8' })
  const notMjs = spawnSync(process.execPath, [guardedMjs, J(TOOLS, 'README.md')], { encoding: 'utf8' })
  check('F: a check that is not there, or is not a .mjs, is not run (exit code 2) and no folder is made for it', nothing.status === 2 && notMjs.status === 2 && listRuns().every((n) => beforeRuns.has(n)))
  const text = fs.readFileSync(guardedMjs, 'utf8')
  check('F: the wrapper hard-codes the scope: C:\\frontier-tmp, one fresh folder, the guard on the wrapper and on the check', /BASE = 'C:\\\\frontier-tmp'/.test(text) && /installFsGuard\(\{ write: \[run\], remove: \[run\] \}\)/.test(text) && /--import/.test(text) && /guard-preload\.mjs/.test(text))
}

// ============================ H. the remove-only guard of window runs ======================
{
  const ROAM = J(BASE, 'roam')
  const PROFILE = J(ROAM, 'frontier-app-test-scratch-s1')
  const RUN = J(BASE, 'run-h')
  const OUTD = J(BASE, 'out-h')
  for (const d of [J(PROFILE, 'deep'), J(ROAM, 'frontier-app'), J(ROAM, 'other-app'), RUN, OUTD]) fs.mkdirSync(d, { recursive: true })
  fs.writeFileSync(J(ROAM, 'frontier-app', 'keep.txt'), 'REAL-PROFILE')
  fs.writeFileSync(J(ROAM, 'other-app', 'keep.txt'), 'OTHER')
  fs.writeFileSync(J(ROAM, 'FIXTURE-ONLY.txt'), 'FSGUARD-FIXTURE') // the mark that lets guarded-window-selftest.mjs try its removals: it does nothing against a folder without it
  fs.symlinkSync(OUTSIDE, J(PROFILE, 'link'), 'junction')
  let win
  try {
    win = installFsGuard({ writeAnywhere: true, remove: [RUN, OUTD], removePatterns: [{ base: ROAM, name: /^frontier-app-test-scratch-[A-Za-z0-9._-]+$/i }], watch: false })
  } catch (error) {
    check('H: a window-run guard can be made (writeAnywhere, remove folders that lie in no write folder, a pattern)', false, String(error.message))
    process.exit(check.summary() ? 0 : 1)
  }
  check('H: a window-run guard can be made (writeAnywhere, remove folders that lie in no write folder, a pattern)', true)
  const may = (p) => win.check('remove', p) === null
  const mayNot = (p) => typeof win.check('remove', p) === 'string'
  check('H: in a window run writing is not restricted, anywhere (A:\\, the repo, a share)', ['A:\\x\\y.txt', 'C:\\Windows\\x.txt', REPO_WIN + '\\x', '\\\\server\\share\\x'].every((p) => win.check('write', p) === null), show(['A:\\x'].map((p) => win.check('write', p))))
  check('H: but a name the file system reads differently from how it is written is refused all the same (NUL, a wildcard, a stream, a trailing dot)', ['', J(BASE, 'x\0y'), J(BASE, 'a*'), J(BASE, 'a:b'), J(BASE, 'x.')].every((p) => typeof win.check('write', p) === 'string'))
  check('H: the run\'s own folder and the build folder may be removed, with everything in them', may(RUN) && may(J(RUN, 'a', 'b.txt')) && may(OUTD) && may(J(OUTD, 'x', 'y')) && may(RUN.toUpperCase() + '\\X'))
  check('H: but nothing beside them (a sibling that starts like the run\'s folder, their parent, drive roots, the Windows folder, the user\'s folder, the repo)', [BASE, RUN + '-evil', J(BASE, 'run-h-evil', 'x'), 'A:\\', 'C:\\', 'C:\\Windows', os.homedir(), REPO_WIN, J(REPO_WIN, 'src')].every(mayNot))
  check('H: a throwaway profile folder in the Roaming folder may be removed, with everything in it (also in capitals and with forward slashes)', may(PROFILE) && may(J(PROFILE, 'deep', 'f.txt')) && may(PROFILE.toUpperCase()) && may(PROFILE.replaceAll('\\', '/') + '/deep'))
  check('H: the real profile folder, the Roaming folder itself, another app\'s folder, a profile name with nothing after the dash, and a name that only starts like it are refused', [ROAM, J(ROAM, 'frontier-app'), J(ROAM, 'frontier-app', 'keep.txt'), J(ROAM, 'other-app'), J(ROAM, 'frontier-app-test-scratch-'), J(ROAM, 'frontier-app-test-scratchX')].every(mayNot))
  check('H: the pattern is the FIRST name below the Roaming folder: a folder with that name deeper down is refused, and so is a way out through ..', mayNot(J(ROAM, 'other-app', 'frontier-app-test-scratch-s1')) && mayNot(J(ROAM, '..', 'frontier-app-test-scratch-s1')) && mayNot(J(ROAM, 'frontier-app-test-scratch-s1', '..', 'frontier-app', 'keep.txt')))
  check('H: a junction inside a throwaway profile that leads OUT is no way out: what is behind it is refused, the junction itself may go', mayNot(J(PROFILE, 'link', 'keep.txt')) && mayNot(J(PROFILE, 'link', 'deep', 'x')) && may(J(PROFILE, 'link')))
  const badPattern = (pattern) => { try { installFsGuard({ writeAnywhere: true, removePatterns: [pattern], watch: false }); currentGuard()?.uninstall(); return false } catch (error) { return /fsguard/.test(String(error.message)) } }
  win.uninstall()
  check('H: a pattern needs a regular expression, and its base cannot be a drive root or one level below a drive', badPattern({ base: ROAM, name: 'frontier-app-test-scratch-' }) && badPattern({ base: 'C:\\', name: /x/ }) && badPattern({ base: 'C:\\Users', name: /x/ }) && badPattern({ base: ROAM }))
  check('H: without writeAnywhere a write folder is still needed', (() => { try { installFsGuard({ removePatterns: [{ base: ROAM, name: /x/ }], watch: false }); currentGuard()?.uninstall(); return false } catch { return true } })())
  check('H: with writeAnywhere nothing needs naming, and a remove folder need not lie in a write folder', (() => { try { const g = installFsGuard({ writeAnywhere: true, remove: [RUN], watch: false }); const ok = g.check('remove', J(RUN, 'a')) === null; g.uninstall(); return ok } catch { return false } })())
  check('H: a pattern is for REMOVING only: a guard that restricts writing too still refuses a write in a throwaway profile (and still allows the removal there)', (() => { try { const g = installFsGuard({ write: [RUN], removePatterns: [{ base: ROAM, name: /^frontier-app-test-scratch-[A-Za-z0-9._-]+$/i }], watch: false }); const ok = typeof g.check('write', J(PROFILE, 'deep', 'f.txt')) === 'string' && g.check('remove', J(PROFILE, 'deep', 'f.txt')) === null; g.uninstall(); return ok } catch { return false } })())
  check('H: without writeAnywhere a remove folder must still lie in a write folder', (() => { try { installFsGuard({ write: [RUN], remove: [OUTD], watch: false }); currentGuard()?.uninstall(); return false } catch (error) { return /not inside a write folder/.test(String(error.message)) } })())

  // the real thing: guarded-window.mjs runs a script with the preload loaded, against a FAKE Roaming folder
  const decoy = J(BASE, 'win-decoy.txt')
  fs.writeFileSync(decoy, 'DECOY')
  const listRuns = () => fs.readdirSync('C:\\frontier-tmp').filter((n) => /^guarded-w-/.test(n))
  const beforeRuns = new Set(listRuns())
  const run = spawnSync(process.execPath, [J(TOOLS, 'guarded-window.mjs'), J(TOOLS, 'guarded-window-selftest.mjs')], { encoding: 'utf8', env: { ...process.env, APPDATA: ROAM, GUARDED_DECOY: decoy } })
  const line = /RESULT (\{.*\})/.exec(run.stdout ?? '')
  const res = line === null ? null : JSON.parse(line[1])
  check('H: a window run through guarded-window.mjs runs, with its temp folder a fresh one of the run', run.status === 0 && res !== null && /^C:\\frontier-tmp\\guarded-w-[A-Za-z0-9]+$/.test(res.tmp ?? ''), show({ status: run.status, out: (run.stdout ?? '').slice(0, 200), err: (run.stderr ?? '').slice(0, 400) }))
  check('H: it may write beside the decoy (but not remove what it wrote there: that is outside its folders), and remove what it made in its own folder, in a throwaway profile and in the repo\'s out folder', res?.writeBeside === 'DONE' && res.removeBeside === REFUSED && fs.existsSync(`${decoy}.beside`) && res.ownRun === 'DONE' && res.profile === 'DONE' && res.profileGone === true && (res.outFile === 'DONE' || res.outFile === 'NO-OUT'), show(res))
  check('H: and may NOT remove the decoy, a file in the folder called like the real profile, another app\'s folder, or the Roaming folder; they are untouched', res?.removeDecoy === REFUSED && res.removeRealProfile === REFUSED && res.removeOtherInRoaming === REFUSED && res.removeRoaming === REFUSED && fs.readFileSync(decoy, 'utf8') === 'DECOY' && fs.readFileSync(J(ROAM, 'frontier-app', 'keep.txt'), 'utf8') === 'REAL-PROFILE' && fs.readFileSync(J(ROAM, 'other-app', 'keep.txt'), 'utf8') === 'OTHER', show(res))
  check('H: every refusal is named on stderr when the process ends (so a run that was refused something shows it)', /\[harness-guard\] refused \d+ call/.test(run.stderr ?? '') && /remove of /.test(run.stderr ?? ''), (run.stderr ?? '').slice(0, 300))
  check('H: the run\'s own folder is removed when the run is over, and no other guarded-w folder', listRuns().every((n) => beforeRuns.has(n)))
  const missing = spawnSync(process.execPath, [J(TOOLS, 'guarded-window.mjs'), J(TOOLS, 'no-such-script.mjs')], { encoding: 'utf8' })
  check('H: a script that is not there is not run (exit code 2) and no folder is made for it', missing.status === 2 && listRuns().every((n) => beforeRuns.has(n)))
  const wtext = fs.readFileSync(J(TOOLS, 'guarded-window.mjs'), 'utf8')
  const ptext = fs.readFileSync(J(TOOLS, 'harness-guard-preload.mjs'), 'utf8')
  check('H: the scope is fixed in the two files: C:\\frontier-tmp, the run\'s folder, the throwaway profiles and `out`; nothing is read from the environment but where the run\'s folder is', /BASE = 'C:\\\\frontier-tmp'/.test(wtext) && /frontier-app-test-scratch-\[A-Za-z0-9\._-\]\+/.test(ptext) && /join\(repo, 'out'\)/.test(ptext) && /FRONTIER_GUARD_ROOT/.test(ptext) && /writeAnywhere: true/.test(ptext))
}

process.exit(check.summary() ? 0 : 1)
