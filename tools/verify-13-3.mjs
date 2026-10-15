// Slice 13.3 (D-043): THE SCRATCH COPY, under plain Node, Windows only, with the real guard rules, the real launcher and the real box where a run is needed.
//   A. what is copied and what is left out, by reason, in a workspace that holds every awkward kind of entry (hidden and secret-looking names, version-control internals,
//      a junction out and one in, files with two names, the launcher's reserved folder, a file that holds a saved key in four looks, a path that is too long); every
//      copied file is byte for byte what it was, and the real folder is not changed by being copied;
//   B. the caps: more files or more bytes than a run may copy copies nothing, and says so in words (also with the real 20,000);
//   C. a file that changes while it is being copied;
//   D. a real run in the copy: what the comparison reports afterwards (changed, new, deleted, left out and why), a junction the program makes is not followed, and the real
//      folder cannot be read or written by the program and is not changed;
//   E. removing a scratch folder (links not followed, read-only files, deep paths, a held file, nothing but a folder directly below scratch/) and the start-up sweep;
//   F. where the run root lives (the workspace's drive first; a folder that cannot rename a file, which is what an encrypted one does, is skipped);
//   G. nothing outside the run root is ever written, made, renamed or removed (every call to the file system is watched), and the source.
//
// Run: FRONTIER_MAY_REMOVE=1 node tools/verify-13-3.mjs      (ONLY=A,D runs some parts)
//   It REMOVES things (the scratch folders of its own temp folder, and it tests the code that removes), so it will not start unless FRONTIER_MAY_REMOVE=1 is set, and that
//   is set only when the owner has allowed removing in words (his rule of 2026-10-09 after the A: incident: nothing is deleted from any drive otherwise). Even then the guard
//   under the real file system (tools/fsguard.mjs, tested first by verify-fsguard.mjs) lets this process write and remove ONLY inside its own temp folder, whatever the module under
//   test (or a negative control's sabotage of it) tries; the last check says the guard refused nothing in a correct run.
import './ts-resolve.mjs'
import { checker } from './cdp.mjs'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import { win32 } from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { installFsGuard } from './fsguard.mjs'
import { REPO, REPO_URL } from './paths.mjs'

if (process.env.FRONTIER_MAY_REMOVE !== '1') {
  console.log('NOT RUN: this suite removes folders it made itself and tests code that removes. Nothing is removed from any drive unless the owner has allowed it in words; set FRONTIER_MAY_REMOVE=1 only then.')
  process.exit(3)
}
if (os.tmpdir().toLowerCase() !== 'c:\\frontier-tmp') {
  // the owner's scope of 2026-10-09: what a check removes lies in C:\frontier-tmp (paths.mjs puts TEMP there when the repo is on C:), made by the same run
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
    check(`${name} did not run to its end: ${String(error?.stack ?? error).slice(0, 500)}`, false)
  }
}
const show = (v) => JSON.stringify(v)?.slice(0, 400)
const SRC = `${REPO_URL}/src`
const scratchMod = await import(`${SRC}/main/scratchCopy.ts`)
const { makeScratch, compareScratch, removeScratch, sweepStartup, chooseRunRoot, runRootCandidates } = scratchMod
const { createCommandRunner, listMounts, sweepMounts } = await import(`${SRC}/main/commandRunner.ts`)
const { SCRATCH, RUN_LIMITS } = await import(`${SRC}/shared/run.ts`)
const J = win32.join
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex')
const source = (rel) => fs.readFileSync(`${REPO}/${rel}`, 'utf8')
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const cp = (...c) => String.fromCodePoint(...c)

const ROOT = fs.realpathSync.native(fs.mkdtempSync(J(os.tmpdir(), 'frontier-133-')))
// from here on this process can write and remove only inside ROOT, which is a new folder in C:\frontier-tmp made by this run (the owner's scope of 2026-10-09)
const fsGuard = installFsGuard({ write: [ROOT], remove: [ROOT] })
process.on('exit', () => {
  try {
    // a drive letter into ROOT that a part (or a sabotaged sweep) left behind goes before the folder does: an alias only, no file is touched
    sweepMounts(ROOT)
  } catch {
    /* none */
  }
  try {
    for (const d of fs.readdirSync(ROOT)) {
      // a junction made by a check must go before the tree does
      for (const sub of ['jn', 'link-out', 'link-in']) {
        const l = J(ROOT, d, sub)
        try {
          if (fs.lstatSync(l).isSymbolicLink()) fs.rmdirSync(l)
        } catch {
          /* not there */
        }
      }
    }
    fs.rmSync(ROOT, { recursive: true, force: true })
  } catch {
    /* left for the system */
  }
})
const runRoot = J(ROOT, 'run')
// (scratch/ exists before any part runs, so that a part can be run alone (ONLY=B) and its counts of folders are not a crash)
fs.mkdirSync(J(runRoot, 'scratch'), { recursive: true })
const put = (base, rel, body) => {
  const full = J(base, rel)
  fs.mkdirSync(win32.dirname(full), { recursive: true })
  fs.writeFileSync(full, body)
  return full
}
const treeHash = (dir) => {
  // names, sizes, mtimes and contents, links not followed
  const h = crypto.createHash('sha256')
  const walk = (d, rel) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const p = J(d, e.name)
      const r = rel + '/' + e.name
      const st = fs.lstatSync(p)
      h.update(`${r}|${st.size}|${st.mtimeMs}|${e.isSymbolicLink() ? 'L' : e.isDirectory() ? 'D' : 'F'}\n`)
      if (e.isDirectory() && !e.isSymbolicLink()) walk(p, r)
      else if (e.isFile()) h.update(fs.readFileSync(p))
    }
  }
  walk(dir, '')
  return h.digest('hex')
}
const KEY = 'sk-ant-api03-' + crypto.randomBytes(30).toString('base64url')
const KEYS = [{ provider: 'anthropic', key: KEY }]

// ---- the fixture
const OUTSIDE = J(ROOT, 'outside')
put(OUTSIDE, 'canary.txt', 'CANARY-' + crypto.randomBytes(6).toString('hex'))
const WS = J(ROOT, 'ws')
const longDir = Array.from({ length: 9 }, (_, i) => 'long-folder-name-' + i + '-'.repeat(10)).join('/')
const BIG = crypto.randomBytes(3 * 1024 * 1024)
const FILES = {
  'README.md': Buffer.from('hello\r\nworld\r\n'),
  'src/a.js': Buffer.from("console.log('a')\n"),
  'src/deep/deeper/b.txt': Buffer.from('deep\n'),
  'data.bin': Buffer.concat([Buffer.from([0, 1, 2, 3, 255, 254]), crypto.randomBytes(5000)]),
  'big.bin': BIG,
  'bom.txt': Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('with a bom\n')]),
  'utf16.txt': Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('u\0t\0f\0\n\0')]),
  'name with spaces.txt': Buffer.from('spaces\n'),
  [cp(0x65e5, 0x672c, 0x8a9e) + '.txt']: Buffer.from('nihongo\n'),
  'node_modules/pkg/index.js': Buffer.from('module.exports = 1\n'),
  'sub/ok.txt': Buffer.from('ok\n'),
  'empty.txt': Buffer.alloc(0)
}
const LEFT = {
  '.env': 'hidden-or-secret',
  '.gitignore': 'hidden-or-secret',
  '.github': 'hidden-or-secret',
  '.git': 'never',
  id_rsa: 'hidden-or-secret',
  'secrets.json': 'hidden-or-secret',
  'server.pem': 'hidden-or-secret',
  'credentials.txt': 'hidden-or-secret',
  'sub/.hidden': 'hidden-or-secret',
  'link-out': 'link',
  'link-in': 'link',
  'twin-a.txt': 'hard-link',
  'twin-b.txt': 'hard-link',
  '.frontier-box': 'reserved',
  'with-key.txt': 'holds-a-key',
  'key-squeezed.txt': 'holds-a-key',
  'key-piece.txt': 'holds-a-key',
  'key-big.bin': 'holds-a-key'
}
function buildWorkspace(dir) {
  fs.mkdirSync(dir, { recursive: true })
  for (const [rel, body] of Object.entries(FILES)) put(dir, rel, body)
  fs.mkdirSync(J(dir, 'src', 'empty-dir'), { recursive: true })
  put(dir, '.env', 'SECRET=1\n')
  put(dir, '.gitignore', 'x\n')
  put(dir, '.github/workflows/ci.yml', 'on: push\n')
  put(dir, '.git/config', '[core]\n')
  put(dir, '.git/HEAD', 'ref: refs/heads/main\n')
  put(dir, 'id_rsa', 'PRIVATE\n')
  put(dir, 'secrets.json', '{}\n')
  put(dir, 'server.pem', 'PEM\n')
  put(dir, 'credentials.txt', 'c\n')
  put(dir, 'sub/.hidden/inner.txt', 'inner\n')
  put(dir, 'twin-a.txt', 'twins\n')
  fs.linkSync(J(dir, 'twin-a.txt'), J(dir, 'twin-b.txt'))
  put(dir, '.frontier-box/x.txt', 'reserved\n')
  put(dir, 'with-key.txt', 'my key is ' + KEY + ' ok\n')
  put(dir, 'key-squeezed.txt', KEY.slice(0, 30) + '\n  ' + KEY.slice(30) + '\n')
  put(dir, 'key-piece.txt', 'a piece: ' + KEY.slice(5, 45) + '\n')
  put(dir, 'key-big.bin', Buffer.concat([crypto.randomBytes(3 * 1024 * 1024), Buffer.from(KEY)]))
  put(dir, longDir + '/deep.txt', 'too long\n')
  fs.symlinkSync(OUTSIDE, J(dir, 'link-out'), 'junction')
  fs.symlinkSync(J(dir, 'src'), J(dir, 'link-in'), 'junction')
}
const rd = (dir, rel) => fs.readFileSync(J(dir, ...rel.split('/')))

// ============================ A. what is copied ===========================
let madeA = null
await guard('A', async () => {
  buildWorkspace(WS)
  const before = treeHash(WS)
  const t0 = Date.now()
  const r = await makeScratch({ runRoot, source: WS, savedKeys: async () => KEYS })
  const ms = Date.now() - t0
  check('A: the copy was made', r.ok === true, show(r))
  if (!r.ok) return
  madeA = r
  const m = r.manifest
  check('A: the scratch folder is directly below <run root>/scratch, named by a random id', win32.dirname(r.dir).toLowerCase() === J(runRoot, 'scratch').toLowerCase() && /^[0-9a-f]{12}$/.test(r.id) && win32.basename(r.dir) === r.id)
  const want = Object.keys(FILES).sort()
  const got = [...m.files.keys()].sort()
  check('A: exactly the ordinary files were copied (and node_modules is ordinary)', JSON.stringify(got) === JSON.stringify(want), `${show(got.filter((x) => !want.includes(x)))} extra, ${show(want.filter((x) => !got.includes(x)))} missing`)
  check('A: every copied file is byte for byte what it was (including a binary, a 3 MB file, a BOM, UTF-16, CRLF, an empty file, spaces and Japanese in names)', want.every((rel) => Buffer.compare(rd(r.dir, rel), FILES[rel]) === 0 && m.files.get(rel).sha256 === sha(FILES[rel]) && m.files.get(rel).size === FILES[rel].length))
  const dirsWant = ['src', 'src/deep', 'src/deep/deeper', 'src/empty-dir', 'node_modules', 'node_modules/pkg', 'sub']
  check('A: the folders were made, an empty one too', dirsWant.every((d) => fs.statSync(J(r.dir, ...d.split('/'))).isDirectory() && m.dirs.has(d)), show([...m.dirs]))
  const leftWhy = Object.fromEntries(m.leftOut.map((l) => [l.path, l.why]))
  for (const [rel, why] of Object.entries(LEFT)) check(`A: ${rel} is left out because: ${why}`, leftWhy[rel] === why, `${leftWhy[rel]}`)
  const longTop = longDir.split('/').reduce((acc, part) => (acc.ok ? acc : { ok: (acc.path + '/' + part).replace(/^\//, '').length > SCRATCH.maxPathChars ? 1 : 0, path: (acc.path + '/' + part).replace(/^\//, '') }), { ok: 0, path: '' })
  check('A: a path longer than the limit is left out (with the folder it lies in)', Object.values(leftWhy).includes('path-too-long') && longTop.ok === 1, show(Object.entries(leftWhy).filter(([, w]) => w === 'path-too-long')))
  check('A: nothing else was left out', m.leftOut.length === Object.keys(LEFT).length + 1, `${m.leftOut.length}: ${show(m.leftOut.map((l) => l.path))}`)
  check('A: the counts say the same, by reason', m.leftOutCounts['hidden-or-secret'] === 8 && m.leftOutCounts.never === 1 && m.leftOutCounts.link === 2 && m.leftOutCounts['hard-link'] === 2 && m.leftOutCounts['holds-a-key'] === 4 && m.leftOutCounts.reserved === 1 && m.leftOutCounts['path-too-long'] === 1, show(m.leftOutCounts))
  const present = Object.keys(LEFT).filter((rel) => fs.existsSync(J(r.dir, ...rel.split('/'))))
  check('A: none of the left-out things is in the scratch folder', present.length === 0 && !fs.existsSync(J(r.dir, 'canary.txt')) && !fs.existsSync(J(r.dir, ...longDir.split('/'), 'deep.txt')), show(present))
  check('A: the junction that leads out was not followed: its canary is not in the copy and is untouched', !fs.readdirSync(r.dir, { recursive: true }).some((f) => String(f).includes('canary')) && fs.readFileSync(J(OUTSIDE, 'canary.txt'), 'utf8').startsWith('CANARY-'))
  check('A: the real folder is exactly as it was (names, sizes, times, contents)', treeHash(WS) === before)
  check('A: the copied/left-out totals add up', m.copiedFiles === want.length && m.copiedBytes === want.reduce((s, k) => s + FILES[k].length, 0), `${m.copiedFiles} files ${m.copiedBytes} bytes in ${ms} ms`)

  // ---- a subfolder: only that is copied; the names of the way down count for the class
  const sub = await makeScratch({ runRoot, source: J(WS, 'src'), prefix: ['src'], savedKeys: async () => KEYS })
  check('A: a subfolder is copied alone, its files at the root of the scratch folder', sub.ok && JSON.stringify([...sub.manifest.files.keys()].sort()) === JSON.stringify(['a.js', 'deep/deeper/b.txt']) && sub.manifest.prefix.join('/') === 'src', show(sub.ok ? [...sub.manifest.files.keys()] : sub))
  const hid = await makeScratch({ runRoot, source: J(WS, 'sub', '.hidden'), prefix: ['sub', '.hidden'] })
  check('A: a folder whose way down passes a hidden name copies nothing of it (the model could not have asked for it without a question)', hid.ok && hid.manifest.files.size === 0 && hid.manifest.leftOutCounts['hidden-or-secret'] === 1, show(hid.ok ? hid.manifest.leftOutCounts : hid))
  const gone = await makeScratch({ runRoot, source: J(ROOT, 'does-not-exist') })
  check('A: a folder that is not there is refused in words', gone.ok === false && gone.code === 'source' && /not there/.test(gone.message))
  const aFile = await makeScratch({ runRoot, source: J(WS, 'README.md') })
  check('A: a file given as the folder is refused', aFile.ok === false && aFile.code === 'source')
  const aLink = await makeScratch({ runRoot, source: J(WS, 'link-in') })
  check('A: a junction given as the folder is refused', aLink.ok === false && aLink.code === 'source')
  for (const x of [sub, hid]) if (x.ok) await removeScratch(x.dir, runRoot)
  const noKeys = await makeScratch({ runRoot, source: WS })
  check('A: with no saved keys given, the files that hold one are copied (it is the keys that decide)', noKeys.ok && noKeys.manifest.files.has('with-key.txt') && noKeys.manifest.leftOutCounts['holds-a-key'] === 0)
  // looking only (the question before a run, 13.4): the same counts as a copy would have, and nothing is made
  const scratchBefore = fs.readdirSync(J(runRoot, 'scratch')).length
  const look = await makeScratch({ runRoot, source: WS, lookOnly: true })
  check('A: looking only answers with the counts of a copy and no folder: nothing is made, nothing is read into a manifest, the real folder is as it was', look.ok === true && look.dir === '' && look.id === '' && noKeys.ok && look.manifest.copiedFiles === noKeys.manifest.copiedFiles && look.manifest.copiedBytes === noKeys.manifest.copiedBytes && look.manifest.files.size === 0 && look.manifest.dirs.size === 0 && JSON.stringify(look.manifest.leftOutCounts) === JSON.stringify(noKeys.manifest.leftOutCounts) && fs.readdirSync(J(runRoot, 'scratch')).length === scratchBefore && treeHash(WS) === before, show(look.ok ? { dir: look.dir, files: look.manifest.copiedFiles, want: noKeys.ok ? noKeys.manifest.copiedFiles : null } : look))
  const lookOver = await makeScratch({ runRoot, source: WS, lookOnly: true, limits: { files: 3 } })
  check('A: looking only refuses a folder that is too big or holds too many files, in words, as a copy would', lookOver.ok === false && lookOver.code === 'too-many-files' && /more than 3 files/.test(lookOver.message))
  if (noKeys.ok) await removeScratch(noKeys.dir, runRoot)
  check('A: the main copy is removed when done', (await removeScratch(r.dir, runRoot)) === true && !fs.existsSync(r.dir))
})

// ============================ B. the caps ================================
await guard('B', async () => {
  const w = J(ROOT, 'caps')
  for (let i = 0; i < 49; i++) put(w, `f${i}.txt`, 'x')
  const before = fs.readdirSync(J(runRoot, 'scratch')).length
  const at = await makeScratch({ runRoot, source: w, limits: { files: 49 } })
  check('B: exactly the limit of files (49 of 49) is copied', at.ok === true && at.manifest.copiedFiles === 49, show(at.ok))
  if (at.ok) await removeScratch(at.dir, runRoot)
  put(w, 'f49.txt', 'x')
  const over = await makeScratch({ runRoot, source: w, limits: { files: 49 } })
  check('B: one file more copies nothing, and says so in words with the number and the way out', over.ok === false && over.code === 'too-many-files' && /more than 49 files/.test(over.message) && /subfolder/.test(over.message), show(over))
  check('B: and no scratch folder is left behind by it', fs.readdirSync(J(runRoot, 'scratch')).length === before)
  const dirs = J(ROOT, 'caps-dirs')
  for (let i = 0; i < 10; i++) fs.mkdirSync(J(dirs, `d${i}`), { recursive: true })
  const dirOver = await makeScratch({ runRoot, source: dirs, limits: { files: 9 } })
  check('B: folders count toward the limit too', dirOver.ok === false && dirOver.code === 'too-many-files')
  const big = J(ROOT, 'caps-big')
  put(big, 'a.bin', Buffer.alloc(600 * 1024))
  put(big, 'b.bin', Buffer.alloc(600 * 1024))
  const bytesOver = await makeScratch({ runRoot, source: big, limits: { bytes: 1024 * 1024 } })
  check('B: more bytes than the limit copies nothing, and says so in MB', bytesOver.ok === false && bytesOver.code === 'too-big' && /more than 1 MB/.test(bytesOver.message) && /subfolder/.test(bytesOver.message), show(bytesOver))
  // the refusal is made while LOOKING, before a folder is made or a byte is copied (the hook between looking and copying is never reached)
  let reachedBytes = false
  let reachedFiles = false
  const earlyBytes = await makeScratch({ runRoot, source: big, limits: { bytes: 1024 * 1024 }, afterLook: async () => { reachedBytes = true } })
  const earlyFiles = await makeScratch({ runRoot, source: w, limits: { files: 49 }, afterLook: async () => { reachedFiles = true } })
  check('B: a folder that is too big, or holds too many files, is refused while looking: nothing is made, nothing is copied and thrown away again', earlyBytes.ok === false && earlyFiles.ok === false && reachedBytes === false && reachedFiles === false, show({ reachedBytes, reachedFiles }))
  const bytesAt = await makeScratch({ runRoot, source: big, limits: { bytes: 1200 * 1024 } })
  check('B: exactly the limit of bytes is copied', bytesAt.ok === true, show(bytesAt))
  if (bytesAt.ok) await removeScratch(bytesAt.dir, runRoot)
  check('B: the real limits are the plan\'s (20,000 files, 100 MB)', RUN_LIMITS.copyFiles === 20000 && RUN_LIMITS.copyBytes === 100 * 1024 * 1024)
  // the real number of files, once
  const many = J(ROOT, 'caps-many')
  fs.mkdirSync(many, { recursive: true })
  for (let i = 0; i < 20001; i++) fs.writeFileSync(J(many, `m${i}.txt`), '')
  const t0 = Date.now()
  const real = await makeScratch({ runRoot, source: many })
  check('B: 20,001 files with the real limit copies nothing and says "more than 20,000"', real.ok === false && real.code === 'too-many-files' && /more than 20,000 files/.test(real.message), `${show(real)} in ${Date.now() - t0} ms`)
  check('B: and left nothing behind', fs.readdirSync(J(runRoot, 'scratch')).length === before)
  fs.rmSync(J(many, 'm20000.txt'))
  const t1 = Date.now()
  const exactly = await makeScratch({ runRoot, source: many })
  check('B: 20,000 files are copied', exactly.ok === true && exactly.manifest.copiedFiles === 20000, `${show(exactly.ok)} in ${Date.now() - t1} ms`)
  if (exactly.ok) await removeScratch(exactly.dir, runRoot)
})

// ============================ C. a file that changes while it is copied ====
await guard('C', async () => {
  const w = J(ROOT, 'race')
  put(w, 'steady.txt', 'steady\n')
  put(w, 'grows.txt', 'short\n')
  put(w, 'gone.txt', 'here\n')
  const r = await makeScratch({
    runRoot,
    source: w,
    afterLook: async () => {
      fs.appendFileSync(J(w, 'grows.txt'), 'and now it is longer\n')
      fs.rmSync(J(w, 'gone.txt'))
    }
  })
  const lw = r.ok ? Object.fromEntries(r.manifest.leftOut.map((l) => [l.path, l.why])) : {}
  check('C: a file that grew after it was looked at is left out as changed while copying, not copied half', r.ok && lw['grows.txt'] === 'changed-while-copying' && !r.manifest.files.has('grows.txt') && !fs.existsSync(J(r.dir, 'grows.txt')), show(lw))
  check('C: a file that vanished is left out as unreadable', r.ok && lw['gone.txt'] === 'unreadable', show(lw))
  check('C: the steady file was copied', r.ok && r.manifest.files.has('steady.txt'))
  if (r.ok) await removeScratch(r.dir, runRoot)
})

// ============================ D. a real run in the copy ===================
await guard('D', async () => {
  const w = J(ROOT, 'runws')
  const same = 'AAAA'
  put(w, 'a.txt', 'one\n')
  put(w, 'keep.txt', 'keep\n')
  put(w, 'rm-me.txt', 'delete me\n')
  put(w, 'same-size.txt', same)
  put(w, 'touch.txt', 'touch\n')
  put(w, 'data.bin', Buffer.from([0, 1, 2]))
  put(w, 'dir/d.txt', 'd\n')
  put(w, 'real-path.txt', J(w, 'a.txt'))
  put(w, 'real-ws-path.json', JSON.stringify({ ws: w, canary: J(OUTSIDE, 'canary.txt') }))
  put(w, 'act.cjs', `
const fs = require('fs'), cp = require('child_process')
const r = {}
const t = (n, f) => { try { r[n] = f() ?? 'done' } catch (e) { r[n] = e.code || String(e.message).slice(0, 60) } }
const real = JSON.parse(fs.readFileSync('real-ws-path.json', 'utf8'))
fs.appendFileSync('a.txt', 'two\\n')
fs.writeFileSync('new.txt', 'brand new\\n')
fs.writeFileSync('new.bin', Buffer.from([0, 255, 0, 255, 1]))
fs.writeFileSync('big.txt', 'x'.repeat(300 * 1024))
fs.writeFileSync('.env', 'MADE=1\\n')
fs.mkdirSync('.git/hooks', { recursive: true }); fs.writeFileSync('.git/hooks/pre-commit', '#!/bin/sh\\n')
fs.writeFileSync('id_rsa', 'KEY\\n')
fs.mkdirSync('.frontier-box/mine', { recursive: true }); fs.writeFileSync('.frontier-box/mine/x.txt', 'inside the launcher folder\\n')
fs.rmSync('rm-me.txt')
fs.writeFileSync('same-size.txt', 'BBBB')
const old = fs.statSync('touch.txt'); fs.utimesSync('touch.txt', new Date(2000, 0, 1), new Date(2000, 0, 1))
fs.mkdirSync('nested/new', { recursive: true }); fs.writeFileSync('nested/new/deep.txt', 'deep new\\n')
fs.writeFileSync('bom.txt', Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('with bom\\n')]))
fs.writeFileSync('crlf.txt', 'a\\r\\nb\\r\\n')
fs.writeFileSync('utf16.txt', Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('h\\0i\\0')]))
fs.writeFileSync('invalid.txt', Buffer.from([0x68, 0x80, 0x81, 0x0a]))
fs.linkSync('keep.txt', 'keep-again.txt')
t('symlink', () => fs.symlinkSync('dir', 'sym', 'dir'))
fs.mkdirSync('jn')
t('junction', () => { const p = cp.spawnSync('C:\\\\Windows\\\\System32\\\\cmd.exe', ['/c', 'rmdir jn & mklink /J jn ' + real.ws], { stdio: 'ignore', windowsHide: true }); return 'status ' + p.status })
t('read-real-file', () => fs.readFileSync(real.ws + '\\\\keep.txt', 'utf8'))
t('write-real-file', () => fs.writeFileSync(real.ws + '\\\\HACKED.txt', 'x'))
t('append-real-a', () => fs.appendFileSync(real.ws + '\\\\a.txt', 'HACK'))
t('delete-real-a', () => fs.unlinkSync(real.ws + '\\\\rm-me.txt'))
t('read-canary', () => fs.readFileSync(real.canary, 'utf8'))
fs.writeFileSync('act.json', JSON.stringify(r))
`)
  const realBefore = treeHash(w)
  const runner = createCommandRunner({ runRoot })
  const made = await makeScratch({ runRoot, source: w })
  check('D: the copy was made', made.ok === true, show(made))
  if (!made.ok) return
  const NODE = J(process.env.ProgramFiles, 'nodejs', 'node.exe')
  const out = await runner.run({ program: NODE, args: ['act.cjs'], scratchDir: made.dir, timeoutMs: 30000 })
  check('D: the program ran in the copy and finished', out.kind === 'ran' && out.exitCode === 0, show(out))
  const act = JSON.parse(fs.readFileSync(J(made.dir, 'act.json'), 'utf8'))
  check('D: it could not read, write, append to or delete the real folder, nor read a canary outside', ['read-real-file', 'write-real-file', 'append-real-a', 'delete-real-a', 'read-canary'].every((k) => act[k] === 'EPERM' || act[k] === 'ENOENT'), show(act))
  check('D: the real folder is exactly as it was after the run', treeHash(w) === realBefore && !fs.existsSync(J(w, 'HACKED.txt')))
  const acl = (p) => spawnSync('icacls.exe', [p], { encoding: 'utf8', windowsHide: true }).stdout
  const sidRe = /S-1-15-2-\d+(-\d+){6}/
  check('D: while the copy exists, the box container holds modify rights on that folder and on nothing above it (the run root, scratch/ and the real folder have none)', /S-1-15-2-[\d-]+:\(OI\)\(CI\)\(M\)/.test(acl(made.dir)) && !sidRe.test(acl(runRoot)) && !sidRe.test(acl(J(runRoot, 'scratch'))) && !sidRe.test(acl(w)), show({ root: sidRe.test(acl(runRoot)), real: sidRe.test(acl(w)) }))
  check('D: the private tools folder holds read-and-execute rights for it and no write right', /S-1-15-2-[\d-]+:\(OI\)\(CI\)\(RX\)/.test(acl(J(runRoot, 'tools'))))
  const cmp = await compareScratch(made.dir, made.manifest)
  const cand = Object.fromEntries(cmp.candidates.map((c) => [c.path, c]))
  const left = Object.fromEntries(cmp.leftOut.map((l) => [l.path, l]))
  check('D: a changed text file is a candidate, with its new text and the fingerprint of what was copied', cand['a.txt']?.kind === 'changed' && cand['a.txt'].text === 'one\ntwo\n' && cand['a.txt'].baseSha256 === sha(Buffer.from('one\n')), show(cand['a.txt']))
  check('D: a new text file is a candidate, with no base', cand['new.txt']?.kind === 'created' && cand['new.txt'].text === 'brand new\n' && cand['new.txt'].baseSha256 === null)
  check('D: a file of the same size and other content is found (compared by content, not by size)', cand['same-size.txt']?.kind === 'changed' && cand['same-size.txt'].text === 'BBBB', show(cand['same-size.txt']))
  check('D: a file whose time alone changed is not reported', !cand['touch.txt'] && !left['touch.txt'] && cmp.counts.unchanged >= 3)
  check('D: a new file in a new folder is a candidate with its whole path', cand['nested/new/deep.txt']?.kind === 'created' && cand['nested/new/deep.txt'].rel.join('/') === 'nested/new/deep.txt')
  check('D: a text file with a byte-order mark and one with Windows line ends are read as such', cand['bom.txt']?.bom === true && cand['bom.txt'].text === 'with bom\n' && cand['crlf.txt']?.eol === 'crlf')
  check('D: a new binary file is listed, not brought back', left['new.bin']?.why === 'not-text' && left['new.bin'].kind === 'created' && !cand['new.bin'])
  check('D: UTF-16 and text that is not valid UTF-8 are listed as not text', left['utf16.txt']?.why === 'not-text' && left['invalid.txt']?.why === 'not-text')
  check('D: a new 300 KB text file is listed as too big (the Stage 12 file cap)', left['big.txt']?.why === 'too-big' && !cand['big.txt'])
  check('D: a new .env and id_rsa are listed as hidden or secret, never brought back', left['.env']?.why === 'hidden-or-secret' && left['id_rsa']?.why === 'hidden-or-secret' && !cand['.env'] && !cand['id_rsa'])
  check('D: a new file in .git is listed as never', left['.git/hooks/pre-commit']?.why === 'never')
  check('D: what the program put in the launcher\'s own folder is not looked at at all', !JSON.stringify(cmp).includes('.frontier-box') && !JSON.stringify(cmp).includes('inside the launcher'))
  check('D: a file the program deleted is only listed', cmp.deleted.includes('rm-me.txt') && cmp.counts.deleted === 1 && fs.existsSync(J(w, 'rm-me.txt')))
  check('D: a second name made for a file is an ordinary new file', cand['keep-again.txt']?.kind === 'created')
  const jnMade = fs.existsSync(J(made.dir, 'jn')) && fs.lstatSync(J(made.dir, 'jn')).isSymbolicLink()
  if (jnMade) {
    check('D: a junction the program made (pointing at the REAL folder) is listed as a link and not followed', left['jn']?.why === 'link' && left['jn'].kind === 'link' && !cmp.candidates.some((c) => c.path.startsWith('jn/')), show({ jn: left['jn'], act: act.junction }))
  } else {
    console.log('info  the box could not make a junction here (' + show(act.junction) + '); the junction case of the comparison is checked from outside below')
  }
  check('D: the counts say: changed, new, deleted', cmp.counts.changed === 2 && cmp.counts.deleted === 1 && cmp.counts.created >= 10, show(cmp.counts))
  // a junction made from OUTSIDE, in the copy, pointing at the real folder: the comparison and the removal must not touch the real folder
  const jn2 = J(made.dir, 'outer-link')
  fs.symlinkSync(w, jn2, 'junction')
  const cmp2 = await compareScratch(made.dir, made.manifest)
  check('D: a junction in the scratch folder is listed as a link and what it leads to is not read as part of the copy', cmp2.leftOut.some((l) => l.path === 'outer-link' && l.why === 'link') && !cmp2.candidates.some((c) => c.path.startsWith('outer-link')))
  const removed = await removeScratch(made.dir, runRoot)
  check('D: the scratch folder is removed (with a junction inside it) and the real folder it led to is untouched', removed && !fs.existsSync(made.dir) && treeHash(w) === realBefore)
  check('D: no drive letter is left', listMounts(runRoot).length === 0)
})

// ============================ E. removing, and the sweep at start-up ======
await guard('E', async () => {
  const mk = (name) => {
    const d = J(runRoot, 'scratch', name)
    fs.mkdirSync(d, { recursive: true })
    return d
  }
  // a read-only file and a deep path and a junction to a canary folder
  const d1 = mk('rm1')
  put(d1, 'ro.txt', 'read only')
  fs.chmodSync(J(d1, 'ro.txt'), 0o444)
  put(d1, Array.from({ length: 30 }, (_, i) => 'segment-number-' + i).join('/') + '/deep.txt', 'deep')
  fs.symlinkSync(OUTSIDE, J(d1, 'jn'), 'junction')
  check('E: a read-only file, a path of over 600 characters and a junction to a folder outside are removed, and the folder outside is not touched', (await removeScratch(d1, runRoot)) === true && !fs.existsSync(d1) && fs.readFileSync(J(OUTSIDE, 'canary.txt'), 'utf8').startsWith('CANARY-'))
  check('E: removing what is not there is fine', (await removeScratch(J(runRoot, 'scratch', 'never-was'), runRoot)) === true)
  // refusals
  const keep = J(ROOT, 'keepme')
  put(keep, 'x.txt', 'keep')
  const nested = mk('rm2')
  put(nested, 'inner/x.txt', 'x')
  // a drive root that is only a STRING: a letter nothing is mounted on, so that even a module that lost its check could remove nothing with it (the guard is under this too)
  const NO_DRIVE = [...'QPONMLKJ'].find((l) => !fs.existsSync(l + ':\\'))
  for (const [name, target] of [
    ['a folder outside the run root', keep],
    ['the run root', runRoot],
    ['the scratch folder itself', J(runRoot, 'scratch')],
    ['a folder two levels down', J(nested, 'inner')],
    ['a sibling of scratch with the same start', J(runRoot, 'scratch-evil', 'x')],
    ['the tools folder', J(runRoot, 'tools')],
    ['a drive root (of a letter nothing is mounted on)', NO_DRIVE + ':\\'],
    ['an empty path', '']
  ]) {
    const before = fs.existsSync(keep) ? treeHash(keep) : ''
    const r = await removeScratch(target, runRoot)
    check(`E: removing ${name} is refused and removes nothing`, r === false && fs.existsSync(J(nested, 'inner', 'x.txt')) && fs.readFileSync(J(keep, 'x.txt'), 'utf8') === 'keep' && treeHash(keep) === before)
  }
  await removeScratch(nested, runRoot)
  // a folder that is a running program's working folder cannot be removed by Windows: the answer is false after trying, then true when the program ends
  const held = mk('held')
  put(held, 'open.txt', 'held')
  const holder = spawnSync === null ? null : (await import('node:child_process')).spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { cwd: held, stdio: 'ignore', windowsHide: true })
  await wait(700)
  const t0 = Date.now()
  const whileHeld = await removeScratch(held, runRoot)
  check('E: a folder that a program is working in is not claimed removed (false after trying for a few seconds)', whileHeld === false && Date.now() - t0 > 1000 && fs.existsSync(held), `${whileHeld} ${Date.now() - t0} ms`)
  holder.kill()
  await wait(700)
  check('E: and is removed when the program is gone', (await removeScratch(held, runRoot)) === true && !fs.existsSync(held))

  // ---- the sweep
  // letters that are free: no drive there, and no alias (subst) either, even one that points at a folder that is gone
  const aliased = new Set([...(spawnSync('subst.exe', { encoding: 'utf8' }).stdout ?? '').matchAll(/^([A-Z]):\\: =>/gim)].map((m) => m[1].toUpperCase()))
  const free = [...'YXWVUTSR'].filter((l) => !fs.existsSync(l + ':\\') && !aliased.has(l))
  const inside = mk('stale1')
  put(inside, 'stale.txt', 'stale')
  const stale2 = mk('stale2')
  put(stale2, 'ro.txt', 'ro')
  fs.chmodSync(J(stale2, 'ro.txt'), 0o444)
  fs.symlinkSync(OUTSIDE, J(stale2, 'jn'), 'junction')
  fs.mkdirSync(J(runRoot, 'specs'), { recursive: true })
  fs.writeFileSync(J(runRoot, 'specs', 'old.json'), '{}')
  fs.writeFileSync(J(runRoot, 'specs', 'old.result.json'), '{}')
  fs.mkdirSync(J(runRoot, 'launcher'), { recursive: true })
  fs.mkdirSync(J(runRoot, 'tools'), { recursive: true })
  fs.writeFileSync(J(runRoot, 'launcher', 'keep.ps1'), 'x')
  fs.writeFileSync(J(runRoot, 'tools', 'keep.txt'), 'x')
  const outsideMount = J(ROOT, 'outside-mount')
  fs.mkdirSync(outsideMount, { recursive: true })
  spawnSync('subst.exe', [free[0] + ':', inside])
  spawnSync('subst.exe', [free[1] + ':', outsideMount])
  check('E: before the sweep: a stale letter into the run root and one outside it', fs.existsSync(free[0] + ':\\') && fs.existsSync(free[1] + ':\\'))
  const heldSweep = mk('held-sweep')
  put(heldSweep, 'x.txt', 'x')
  const holder2 = (await import('node:child_process')).spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { cwd: heldSweep, stdio: 'ignore', windowsHide: true })
  await wait(700)
  const sw1 = await sweepStartup(runRoot)
  check('E: a folder that cannot be removed yet is counted as left (and its rights stay with it, nowhere else), the others are removed', sw1.scratchLeft === 1 && fs.existsSync(heldSweep) && sw1.scratchRemoved >= 2, show(sw1))
  holder2.kill()
  await wait(700)
  const sw = await sweepStartup(runRoot)
  check('E: the sweep removes every scratch folder (a junction and a read-only file in them too), every spec and result file, and the letter into the run root', sw.scratchRemoved === 1 && sw.scratchLeft === 0 && sw.specsRemoved === 0 && fs.readdirSync(J(runRoot, 'scratch')).length === 0 && sw1.specsRemoved === 2 && sw1.lettersRemoved.join() === free[0] && fs.readdirSync(J(runRoot, 'scratch')).length === 0 && fs.readdirSync(J(runRoot, 'specs')).length === 0 && !fs.existsSync(free[0] + ':\\'), show(sw))
  check('E: the letter that points elsewhere is not touched, the canary is, and the launcher and tools folders stay', fs.existsSync(free[1] + ':\\') && fs.readFileSync(J(OUTSIDE, 'canary.txt'), 'utf8').startsWith('CANARY-') && fs.existsSync(J(runRoot, 'launcher', 'keep.ps1')) && fs.existsSync(J(runRoot, 'tools', 'keep.txt')))
  spawnSync('subst.exe', [free[1] + ':', '/d'])
  const again = await sweepStartup(runRoot)
  check('E: a second sweep finds nothing to do', again.scratchRemoved === 0 && again.specsRemoved === 0 && again.lettersRemoved.length === 0)
  const fresh = await sweepStartup(J(ROOT, 'no-run-root-yet'))
  check('E: a run root that does not exist yet is fine', fresh.scratchRemoved === 0 && fresh.scratchLeft === 0)
})

// ============================ F. where the run root lives =================
await guard('F', async () => {
  check('F: the candidates are the workspace drive\'s root, then the system temp folder', JSON.stringify(runRootCandidates('A:\\x\\y', 'C:\\Users\\u\\AppData\\Local\\Temp')) === JSON.stringify(['A:\\FrontierRun', 'C:\\Users\\u\\AppData\\Local\\Temp\\FrontierRun']), show(runRootCandidates('A:\\x\\y', 'C:\\Temp')))
  check('F: the folder name can be chosen', runRootCandidates('D:\\p', 'C:\\t', 'X')[0] === 'D:\\X')
  const good1 = J(ROOT, 'rr', 'first')
  const good2 = J(ROOT, 'rr', 'second')
  const a = await chooseRunRoot([good1, good2])
  check('F: the first candidate that works is chosen (its parents are made)', a.ok && a.root === good1 && a.index === 0 && fs.existsSync(good1) && fs.readdirSync(good1).length === 0, show(a))
  // a candidate that cannot be made: inside a FILE
  put(ROOT, 'afile.txt', 'x')
  const b = await chooseRunRoot([J(ROOT, 'afile.txt', 'inside'), good2])
  check('F: a candidate that cannot be made is skipped', b.ok && b.index === 1 && b.root === good2, show(b))
  // an encrypted folder: the rename fails (EXDEV), so it is skipped. The folder is made INSIDE ROOT and encrypted with cipher (EFS), so that nothing outside the check's own temp folder
  // is made or removed (the owner's scope of 2026-10-09; before that the check used a folder in the encrypted Roaming folder). Where EFS is not available the case is not tried.
  const efsDir = J(ROOT, 'efs-dir')
  fs.mkdirSync(efsDir, { recursive: true })
  const cipher = spawnSync('cipher.exe', ['/e', efsDir], { encoding: 'utf8', windowsHide: true })
  const encrypted = cipher.status === 0 && spawnSync('powershell.exe', ['-NoProfile', '-Command', `((Get-Item -LiteralPath '${efsDir}').Attributes -band [IO.FileAttributes]::Encrypted) -ne 0`], { encoding: 'utf8' }).stdout.trim() === 'True'
  const efs = J(efsDir, 'FrontierRun')
  const c = await chooseRunRoot([efs, good2])
  if (encrypted) check('F: a folder inside an encrypted folder is skipped (a file cannot be renamed there)', c.ok && c.index === 1, show(c))
  else check('F: (EFS is not available here, so that case is not tried) the first candidate is used', c.ok && c.index === 0, show({ cipher: cipher.status, c }))
  check('F: and the skipped folder is cleared away', !fs.existsSync(efs) || fs.readdirSync(efs).length === 0)
  const none = await chooseRunRoot([J(ROOT, 'afile.txt', 'x')])
  check('F: when none works, it says so in words', none.ok === false && /no folder on this PC/.test(none.message))
  const empty = await chooseRunRoot([])
  check('F: no candidates is an answer too', empty.ok === false)
})

// ============================ G. what it writes, and the source ============
await guard('G', async () => {
  const writes = []
  const names = ['writeFile', 'appendFile', 'mkdir', 'rm', 'rmdir', 'rename', 'copyFile', 'unlink', 'utimes', 'truncate', 'symlink', 'link', 'chmod', 'cp', 'mkdtemp', 'open']
  const originals = {}
  for (const n of names) {
    originals[n] = fs.promises[n]
    fs.promises[n] = function (...args) {
      if (n !== 'open' || /[wa+]/.test(String(args[1] ?? 'r'))) writes.push({ n, target: String(args[0]), second: n === 'rename' || n === 'copyFile' || n === 'symlink' || n === 'link' ? String(args[1]) : null })
      return originals[n].apply(this, args)
    }
  }
  try {
    const w = J(ROOT, 'spyws')
    put(w, 'a.txt', 'a')
    put(w, '.env', 'x')
    put(w, 'dir/b.txt', 'b')
    const before = treeHash(w)
    const made = await makeScratch({ runRoot, source: w, savedKeys: async () => KEYS })
    put(made.dir, 'new.txt', 'n')
    const cmp = await compareScratch(made.dir, made.manifest)
    await removeScratch(made.dir, runRoot)
    await sweepStartup(runRoot)
    await chooseRunRoot([J(ROOT, 'spy-rr')])
    void cmp
    const inRoot = (p) => p.toLowerCase().startsWith(runRoot.toLowerCase() + '\\') || p.toLowerCase().startsWith(J(ROOT, 'spy-rr').toLowerCase())
    const outside = writes.filter((x) => !inRoot(x.target) || (x.second && !inRoot(x.second)))
    check('G: every write, make, rename and removal of the module was inside the run root (watched: ' + writes.length + ' calls)', writes.length > 10 && outside.length === 0, show(outside.slice(0, 5)))
    check('G: the workspace was only read: it is exactly as it was', treeHash(w) === before)
    check('G: none of the calls named the workspace', !writes.some((x) => x.target.toLowerCase().startsWith(w.toLowerCase())))
  } finally {
    for (const n of names) fs.promises[n] = originals[n]
  }
  const src = source('src/main/scratchCopy.ts')
  const code = src.replace(/^\s*\/\/.*$/gm, '')
  const writers = [...code.matchAll(/fs\.(writeFile|mkdir|rm|rename|copyFile|unlink|rmdir|appendFile|utimes)\(\s*([^,)]+)/g)].map((m) => `${m[1]}(${m[2].trim()}`)
  const allowed = /^(writeFile\((win32\.join\(dir|win32\.join\(probe)|mkdir\((dir|win32\.join\(dir|win32\.join\(probe)|rm\((target|win32\.join\(specs|probe|win32\.join\(probe)|rename\(win32\.join\(probe)/
  const bad = writers.filter((x) => !allowed.test(x))
  check('G: in the source, every call that writes names the scratch folder, the probe folder or the run root\'s own folders, never the source', writers.length >= 6 && bad.length === 0, show({ writers, bad }))
  check('G: it starts no program and uses no shell', !/child_process|spawn|exec\(/.test(code))
  const users = []
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = `${dir}/${e.name}`
      if (e.isDirectory()) walk(p)
      else if (/\.(ts|tsx)$/.test(e.name) && /from ['"][^'"]*scratchCopy['"]/.test(fs.readFileSync(p, 'utf8'))) users.push(p)
    }
  }
  walk(`${REPO}/src`)
  // (13.4, on purpose: the run tool, programTools.ts, makes the copy; 13.5 wires that tool into the app; 14.6, on purpose: a boxed connector gets a copy of its folder, and of the workspace when granted)
  check('G: no file of the app imports scratchCopy but the run tool (programTools.ts, 13.4), the box, the self-test, what a run brings back (13.5) and the connectors (14.6)', users.map((u) => u.replace(`${REPO}/`, '')).sort().join() === 'src/main/connectorService.ts,src/main/programBox.ts,src/main/programTools.ts,src/main/runProposals.ts,src/main/selfTest.ts', users.join(', '))
})

check('the guard under the real file system refused nothing during the run (the module under test touched nothing outside the folders it was given)', fsGuard.refusals.length === 0, show(fsGuard.refusals.slice(0, 3)))
const ok = check.summary()
process.exit(ok ? 0 : 1)
