// usage: node tools/run81.mjs [mode=dev]
// Stage 8.1 (D-030): the usage ledger in the real window (verify-8-1w.mjs, a fresh scratch profile), then what a crash leaves in the ledger is added
// to the file (a request that was begun and never ended, and a last line cut off in the middle), then a RESTART on the same profile (verify-8-1b.mjs).
// Do not edit src/ or registry/ while this runs: the launches build from the tree.
import { runApp, scratch } from './drive.mjs'
import { createHash, randomUUID } from 'node:crypto'
import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const mode = process.argv[2] ?? 'dev'
const tag = mode === 'preview' ? 'p-' : 'd-'
const P = scratch('s81')
const MOCK = '8792'
const results = []

// 1. a fresh profile
results.push(runApp({ label: `${tag}w81`, mode, scripts: 'setup-key.mjs,verify-8-1w.mjs', env: { USER_DATA_DIR: P, WIPE_USER_DATA: '1', MOCK_PORT: MOCK }, timeoutMs: 600000 }))

// 2. what a crash leaves behind: a request that was begun and never ended (the app was killed while a reply was arriving), and a last line cut
// off in the middle (the power went in the middle of a write). The first has the id and the prices of a real request, in a chat that exists.
const ledger = join(P, 'usage', 'ledger.jsonl')
if (existsSync(ledger)) {
  const lines = readFileSync(ledger, 'utf8').split('\n').filter((l) => l !== '')
  const template = JSON.parse(lines.at(-1))
  const artifactId = randomUUID()
  const artifactInput = 777
  const unfinished = { ...template, id: artifactId, at: Date.now(), state: 'sent', estimate: true, tokens: { input: artifactInput, cacheRead: 0, cacheWrite: 0, output: 0 }, costUsd: undefined }
  appendFileSync(ledger, JSON.stringify(unfinished) + '\n' + '{"version":1,"id":"' + randomUUID().slice(0, 13))
  const sha = createHash('sha256').update(readFileSync(ledger)).digest('hex').slice(0, 16)
  results.push(runApp({ label: `${tag}w81b`, mode, scripts: 'verify-8-1b.mjs', env: { USER_DATA_DIR: P, MOCK_PORT: MOCK, LEDGER_SHA: sha, ARTIFACT_ID: artifactId, ARTIFACT_INPUT: String(artifactInput) }, timeoutMs: 400000 }))
} else {
  console.log('BAD  verify-8-1b skipped: launch 1 left no ledger')
  results.push({ ok: false, passed: 0, total: 0, fails: ['launch 1 left no ledger'] })
}

const passed = results.reduce((n, r) => n + r.passed, 0)
const total = results.reduce((n, r) => n + r.total, 0)
if (total > 0) console.log(`${passed}/${total} checks passed`)
for (const r of results) for (const f of r.fails) console.log(String(f).trim())
process.exit(results.every((r) => r.ok) ? 0 : 1)
