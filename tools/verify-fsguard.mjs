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
// Run: node tools/verify-fsguard.mjs
import './paths.mjs'
import { checker } from './cdp.mjs'
import fs, { rmSync as namedRmSync, writeFileSync as namedWriteFileSync } from 'node:fs'
import { rm as namedPromisesRm } from 'node:fs/promises'
import os from 'node:os'
import { win32 } from 'node:path'
import { pathToFileURL } from 'node:url'
import { GUARDED, REFUSED, currentGuard, installFsGuard } from './fsguard.mjs'
import { REPO_WIN } from './paths.mjs'

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

process.exit(check.summary() ? 0 : 1)
