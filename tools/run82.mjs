// usage: node tools/run82.mjs [mode=dev]
// Stage 8.2 (D-031): the spending limits in the real window. 1) a fresh profile with NO limits (PRESEED_LIMITS=off): the first-run question, the refusals,
// Settings, the file (verify-8-2w.mjs); 2) a RESTART on the same profile (verify-8-2b.mjs); 3) three launches on the same profile (its key is saved) with a
// limits.json that is not a pair of limits: one limit missing, text that is not JSON, a folder where the file should be (verify-8-2c.mjs).
// Do not edit src/ or registry/ while this runs: the launches build from the tree.
import { runApp, scratch } from './drive.mjs'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const mode = process.argv[2] ?? 'dev'
const tag = mode === 'preview' ? 'p-' : 'd-'
const P = scratch('s82')
const MOCK = '8793'
const results = []

results.push(runApp({ label: `${tag}w82`, mode, scripts: 'setup-key.mjs,verify-8-2w.mjs', env: { USER_DATA_DIR: P, WIPE_USER_DATA: '1', MOCK_PORT: MOCK, PRESEED_LIMITS: 'off', INSPECT_PORT: '9230' }, timeoutMs: 600000 }))
results.push(runApp({ label: `${tag}w82b`, mode, scripts: 'verify-8-2b.mjs', env: { USER_DATA_DIR: P, MOCK_PORT: MOCK, INSPECT_PORT: '9230' }, timeoutMs: 400000 }))

const limits = join(P, 'limits.json')
const cases = [
  ['half', () => writeFileSync(limits, '{"version":1,"daily":"none"}')],
  ['garbage', () => writeFileSync(limits, 'this is not json')],
  ['dir', () => { rmSync(limits, { force: true, recursive: true }); mkdirSync(limits) }]
]
for (const [name, seed] of cases) {
  seed()
  results.push(runApp({ label: `${tag}w82c-${name}`, mode, scripts: 'verify-8-2c.mjs', env: { USER_DATA_DIR: P, MOCK_PORT: MOCK, CASE: name, INSPECT_PORT: '9230' }, timeoutMs: 400000 }))
}

const passed = results.reduce((n, r) => n + r.passed, 0)
const total = results.reduce((n, r) => n + r.total, 0)
if (total > 0) console.log(`${passed}/${total} checks passed`)
for (const r of results) for (const f of r.fails) console.log(String(f).trim())
process.exit(results.every((r) => r.ok) ? 0 : 1)
