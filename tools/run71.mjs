// usage: node tools/run71.mjs [mode=dev]
// Stage 7.1 (D-024): the Effort menu in the real window (verify-7-1w.mjs, a fresh scratch profile), then a RESTART on the same
// profile (verify-7-1b.mjs), then one launch per seeded preferences.json whose `efforts` is stale, damaged or hostile
// (verify-7-1c.mjs, make-seeds-71.mjs). Do not edit src/ or registry/ while this runs: the launches build from the tree.
import { runApp, scratch, OUT } from './drive.mjs'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const mode = process.argv[2] ?? 'dev'
const tag = mode === 'preview' ? 'p-' : 'd-'
const P = scratch('s71')
const MOCK = '8791'
const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex').slice(0, 16)
const results = []

// 1. a fresh profile, then 2. the restart on the same profile
results.push(runApp({ label: `${tag}w71`, mode, scripts: 'verify-7-1w.mjs', env: { USER_DATA_DIR: P, WIPE_USER_DATA: '1', MOCK_PORT: MOCK }, timeoutMs: 400000 }))
const prefs = join(P, 'preferences.json')
if (existsSync(prefs)) {
  results.push(runApp({ label: `${tag}w71b`, mode, scripts: 'verify-7-1b.mjs', env: { USER_DATA_DIR: P, MOCK_PORT: MOCK, PREFS_SHA: sha(prefs), PREFS_MTIME_MS: String(statSync(prefs).mtimeMs) }, timeoutMs: 300000 }))
} else {
  console.log('BAD  verify-7-1b skipped: launch 1 left no preferences.json')
  results.push({ ok: false, passed: 0, total: 0, fails: ['launch 1 left no preferences.json'] })
}

// 3. the seeds
// Always rewritten, never reused: a manifest left over from an older make-seeds-71.mjs once carried no `keysAfter`, and every seed
// then "failed" the check that compares against it (a wrong detection in a negative control, found 2026-10-02).
const manifestFile = join(OUT, 'seeds71', 'manifest.json')
{
  const r = spawnSync(process.execPath, [fileURLToPath(new URL('./make-seeds-71.mjs', import.meta.url))], { encoding: 'utf8' })
  if (r.status !== 0) throw new Error('make-seeds-71.mjs failed: ' + (r.stderr || r.stdout))
}
for (const m of JSON.parse(readFileSync(manifestFile, 'utf8'))) {
  results.push(runApp({ label: `${tag}w71c-${m.name}`.slice(0, 40), mode, scripts: 'verify-7-1c.mjs', env: { USER_DATA_DIR: scratch('s71seed'), WIPE_USER_DATA: '1', MOCK_PORT: MOCK, PRESEED_FILE: m.file, SEED_NAME: m.name, SEED_SHA: m.sha, EXPECT_MODEL: m.expectModel, EXPECT_EFFORT: String(m.expectEffort), WARN_LEVEL: m.warn ?? '', SAVED_MODEL: m.savedModel ?? '', KEYS_AFTER: JSON.stringify(m.keysAfter) }, timeoutMs: 200000 }))
}

const passed = results.reduce((n, r) => n + r.passed, 0)
const total = results.reduce((n, r) => n + r.total, 0)
if (total > 0) console.log(`${passed}/${total} checks passed`)
for (const r of results) for (const f of r.fails) console.log(String(f).trim())
process.exit(results.every((r) => r.ok) ? 0 : 1)
