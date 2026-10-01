// usage: node tools/run62.mjs [mode=dev]
// Stage 6 (D-023): the window suite verify-6-2.mjs on its own scratch profile, then the same app with registry/rankings.json
// deliberately wrong (verify-6-3.mjs), and ALWAYS the good file back (checked by hash before and after). Do not edit registry/
// while this runs: the launches build from the tree.
import { runApp, scratch } from './drive.mjs'
import { REPO_WIN, OUT } from './paths.mjs'
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'

const mode = process.argv[2] ?? 'dev'
const tag = mode === 'preview' ? 'p-' : 'd-'
const RANKINGS = `${REPO_WIN}\\registry\\rankings.json`
const SAVED = join(OUT, 'rankings-saved.json')
const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex').slice(0, 16)

const results = []
const note = (r) => { results.push(r) }

// 1. the good file
note(runApp({ label: `${tag}w62`, mode, scripts: 'verify-6-2.mjs', env: { USER_DATA_DIR: scratch('s62'), WIPE_USER_DATA: '1' }, timeoutMs: 300000 }))

// 2. (dev only: the built app has the file embedded at build time, so changing it changes nothing there) the file wrong in two ways: as a whole (an old version), and in one row (the rest must stay usable)
copyFileSync(RANKINGS, SAVED)
const goodSha = sha(SAVED)
const good = JSON.parse(readFileSync(SAVED, 'utf8'))
const variants = [
  ['whole', { ...good, schemaVersion: '0.1' }, 'EXPECT_SUGGESTIONS=0'],
  ['row', { ...good, rankings: good.rankings.map((r, i) => (i === 0 ? { ...r, source: 'http://not-https.example/x' } : r)) }, `EXPECT_SUGGESTIONS=${good.rankings.length - 1}`]
]
try {
  for (const [name, content, expect] of mode === 'dev' ? variants : []) {
    writeFileSync(RANKINGS, JSON.stringify(content, null, 2) + '\n')
    const [k, v] = expect.split('=')
    note(runApp({ label: `${tag}w63-${name}`, mode, scripts: 'verify-6-3.mjs', env: { USER_DATA_DIR: scratch('s63'), WIPE_USER_DATA: '1', VARIANT: name, [k]: v }, timeoutMs: 300000 }))
  }
} finally {
  copyFileSync(SAVED, RANKINGS)
}
const restored = existsSync(RANKINGS) && sha(RANKINGS) === goodSha
console.log(`registry/rankings.json restored: ${restored ? 'yes, identical (' + goodSha + ')' : 'NO!! check git diff registry/rankings.json'}`)

const passed = results.reduce((n, r) => n + r.passed, 0)
const total = results.reduce((n, r) => n + r.total, 0)
if (total > 0) console.log(`${passed}/${total} checks passed`)
for (const r of results) for (const f of r.fails) console.log(f.trim())
process.exit(results.every((r) => r.ok) && restored ? 0 : 1)
