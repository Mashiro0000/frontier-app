// usage: node tools/run83.mjs [mode=dev]
// Stage 8.3 (D-032): the question before a very large request, in the real window. 1) a fresh profile (the harness gives it "No limit" for both limits, so only
// the question is under test): the question, Send / Don't send / Escape / Try again / Edit, the limits first, Settings, what the page cannot do, narrow windows, a
// reload while it asks (verify-8-3w.mjs); 2) a RESTART on the same profile (verify-8-3b.mjs): the choice is read back from the file and still honoured; 3) three
// launches on the same profile (its key is saved) with an ask-first.json that is damaged: text that is not JSON, "Never" in capitals, a folder where the file
// should be (verify-8-3c.mjs): damage is read as nothing chosen, so the default asks, and is never read as "Never ask".
// Do not edit src/ or registry/ while this runs: the launches build from the tree.
import { runApp, scratch } from './drive.mjs'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const mode = process.argv[2] ?? 'dev'
const tag = mode === 'preview' ? 'p-' : 'd-'
const P = scratch('s83')
const MOCK = '8794'
const results = []

results.push(runApp({ label: `${tag}w83`, mode, scripts: 'setup-key.mjs,verify-8-3w.mjs', env: { USER_DATA_DIR: P, WIPE_USER_DATA: '1', MOCK_PORT: MOCK }, timeoutMs: 900000 }))
results.push(runApp({ label: `${tag}w83b`, mode, scripts: 'verify-8-3b.mjs', env: { USER_DATA_DIR: P, MOCK_PORT: MOCK }, timeoutMs: 400000 }))

const file = join(P, 'ask-first.json')
const cases = [
  ['garbage', () => writeFileSync(file, 'this is not json')],
  ['capital', () => writeFileSync(file, '{"version":1,"above":"Never"}')],
  ['dir', () => { rmSync(file, { force: true, recursive: true }); mkdirSync(file) }]
]
for (const [name, seed] of cases) {
  seed()
  results.push(runApp({ label: `${tag}w83c-${name}`, mode, scripts: 'verify-8-3c.mjs', env: { USER_DATA_DIR: P, MOCK_PORT: MOCK, CASE: name }, timeoutMs: 400000 }))
}

const passed = results.reduce((n, r) => n + r.passed, 0)
const total = results.reduce((n, r) => n + r.total, 0)
if (total > 0) console.log(`${passed}/${total} checks passed`)
for (const r of results) for (const f of r.fails) console.log(String(f).trim())
process.exit(results.every((r) => r.ok) ? 0 : 1)
