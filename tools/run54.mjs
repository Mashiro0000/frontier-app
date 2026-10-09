// usage: node run54.mjs [mode=dev]
// Stage 5.4 launch: puts a conversation file written by Stages 2-4 (VERSION 1, no record of which model answered) into a fresh scratch profile's
// `conversations` folder BEFORE the app starts, then runs setup-key.mjs and verify-5-4.mjs against the real window.
import './temp-on-a.mjs'
import { mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { runApp, scratch } from './drive.mjs'

const mode = process.argv[2] ?? 'dev'
const P = scratch('s54')
rmSync(P, { recursive: true, force: true })
const dir = join(P, 'conversations')
mkdirSync(dir, { recursive: true })

const id = randomUUID()
const T = 1_790_000_000_000
const messages = [
  { role: 'user', content: 'an old question' },
  { role: 'assistant', content: 'an old answer', status: 'done' },
  { role: 'user', content: 'an old question that failed' },
  { role: 'assistant', content: '', status: 'error', error: 'The service had a problem. (request req_old)' },
  { role: 'user', content: 'an old question that was stopped' },
  { role: 'assistant', content: 'half an ans', status: 'stopped' }
].map((m) => (m.role === 'user' ? { ...m, status: 'done' } : m))
const text = JSON.stringify({ version: 1, id, title: 'an old question', createdAt: T, updatedAt: T + 5000, messages })
writeFileSync(join(dir, `${id}.json`), text)
const seedMtime = statSync(join(dir, `${id}.json`)).mtimeMs // taken before the app starts, so a rewrite during its first scan shows
const seed = { id, title: 'an old question', mtime: seedMtime, messages: messages.length, sha: createHash('sha256').update(text).digest('hex').slice(0, 16), bytes: Buffer.byteLength(text), original: messages }
writeFileSync(join(process.env.TEMP ?? '.', 'frontier-5-4-seed.json'), JSON.stringify(seed))
console.log(`seeded one version 1 conversation (${id}) in ${dir}`)

const r = runApp({
  label: (mode === 'preview' ? 'p-' : 'd-') + 'w54',
  mode,
  scripts: 'setup-key.mjs,verify-5-4.mjs',
  env: { USER_DATA_DIR: P, MOCK_PORT: '8798', MOCK_SCRIPT: 'mock-providers.mjs' },
  timeoutMs: 300000
})
// the negative controls (nc.mjs) read these two things from the output: the totals line, and the FAIL lines
if (r.total > 0) console.log(`${r.passed}/${r.total} checks passed`)
for (const f of r.fails) console.log(f.trim())
process.exit(r.ok ? 0 : 1)
