// usage: node tools/run93.mjs [mode=dev]
// Slice 9.3 (D-037): sending and saving files, in the real window against the fake providers. Launch 1 (verify-9-3w.mjs, a fresh scratch profile) sends
// files to both providers, saves, reopens, deletes, encrypts. Then two copies no chat uses are put in its attachments folder (one two hours old, one new)
// and the copy a chat uses is made two hours old, and launch 2 (verify-9-3b.mjs) restarts on the same profile: the start-up sweep. Launch 3
// (verify-9-3c.mjs, from source only) runs with registry/models.json changed so that GPT-6 Luna reads neither images nor PDFs, and ALWAYS puts the
// good file back (checked by hash before and after). Do not edit src/ or registry/ while this runs: the launches build from the tree.
// RUN93_ONLY (for the negative controls): 'w' launch 1 only, 'wb' launches 1 and 2, 'c' launch 3 only; unset, all three.
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { runApp, scratch } from './drive.mjs'
import { OUT, REPO_WIN } from './paths.mjs'
import { APP, fixture, jpegWith } from './lib9.mjs'

const mode = process.argv[2] ?? 'dev'
const tag = mode === 'preview' ? 'p-' : 'd-'
const P = scratch('s93')
const FILES = scratch('s93-files')
const MOCK = '8797'
const INSPECT = '9231'
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex')
const only = process.env.RUN93_ONLY ?? 'wbc'
rmSync(FILES, { recursive: true, force: true })
mkdirSync(join(FILES, 'out'), { recursive: true })
writeFileSync(join(FILES, 'holiday.jpg'), jpegWith([APP.exif(6, { secret: 'GPS-HOME-51.5N' }), APP.comment('taken by SECRET-CAMERA-OWNER')]))
writeFileSync(join(FILES, 'diagram.png'), fixture('alpha.png'))
writeFileSync(join(FILES, 'report.pdf'), fixture('three-pages.pdf'))
writeFileSync(join(FILES, 'notes.md'), '# Notes\n\nFirst line of my notes\nSecond line\nThird line\nFourth line\nFifth line\nSixth line, not on the chip\n')
console.log(`made the files in ${FILES}`)
const results = []

// 1. a fresh profile
if (only.includes('w')) results.push(runApp({ label: `${tag}w93`, mode, scripts: 'setup-key.mjs,verify-9-3w.mjs', env: { USER_DATA_DIR: P, WIPE_USER_DATA: '1', FILES_DIR: FILES, INSPECT_PORT: INSPECT, MOCK_PORT: MOCK }, timeoutMs: 600000 }))

// 2. what an earlier run can leave behind, then a restart on the same profile
const ATT = join(P, 'attachments')
const stateFile = join(FILES, 'w93.json')
if (!only.includes('b')) {
  // not asked for
} else if (existsSync(stateFile)) {
  const { pngId } = JSON.parse(readFileSync(stateFile, 'utf8'))
  const old = Buffer.from('a copy no chat uses, left two hours ago\n', 'utf8')
  const fresh = Buffer.from('a copy no chat uses, left a moment ago\n', 'utf8')
  writeFileSync(join(ATT, sha(old)), old)
  writeFileSync(join(ATT, sha(fresh)), fresh)
  const twoHoursAgo = new Date(Date.now() - 2 * 3600_000)
  utimesSync(join(ATT, sha(old)), twoHoursAgo, twoHoursAgo)
  if (existsSync(join(ATT, pngId))) utimesSync(join(ATT, pngId), twoHoursAgo, twoHoursAgo)
  results.push(runApp({ label: `${tag}w93b`, mode, scripts: 'verify-9-3b.mjs', env: { USER_DATA_DIR: P, FILES_DIR: FILES, INSPECT_PORT: INSPECT, MOCK_PORT: MOCK, ORPHAN_OLD: sha(old), ORPHAN_NEW: sha(fresh) }, timeoutMs: 300000 }))
} else {
  console.log('launch 1 left no state (it stopped early): the restart is not run')
  results.push({ ok: false, passed: 0, total: 1, fails: ['the restart was not run: launch 1 stopped before it saved its state'] })
}

// 3. (from source only) a model that reads neither images nor PDFs
if (mode === 'dev' && only.includes('c')) {
  const REGISTRY = `${REPO_WIN}\\registry\\models.json`
  const SAVED = join(OUT, 'models-saved-93.json')
  copyFileSync(REGISTRY, SAVED)
  const goodSha = sha(readFileSync(SAVED))
  try {
    const good = JSON.parse(readFileSync(SAVED, 'utf8'))
    const blind = { ...good, models: good.models.map((m) => (m.id === 'gpt-6-luna' ? { ...m, capabilities: { ...m.capabilities, imageInput: false, documentInput: false } } : m)) }
    writeFileSync(REGISTRY, JSON.stringify(blind, null, 2) + '\n')
    results.push(runApp({ label: `${tag}w93c`, mode, scripts: 'setup-key.mjs,verify-9-3c.mjs', env: { USER_DATA_DIR: scratch('s93c'), WIPE_USER_DATA: '1', FILES_DIR: FILES, INSPECT_PORT: INSPECT, MOCK_PORT: MOCK }, timeoutMs: 300000 }))
  } finally {
    copyFileSync(SAVED, REGISTRY)
  }
  const restored = sha(readFileSync(REGISTRY)) === goodSha
  console.log(restored ? 'registry/models.json is the good file again (same hash as before the run)' : '!! registry/models.json is NOT the good file: restore it from git')
  if (!restored) results.push({ ok: false, passed: 0, total: 1, fails: ['registry/models.json was not restored'] })
}

let passed = 0
let total = 0
for (const r of results) {
  passed += r.passed
  total += r.total
  for (const f of r.fails) console.log(String(f).trim())
}
console.log(`${passed}/${total} checks passed`)
process.exit(results.every((r) => r.ok) ? 0 : 1)
