// usage: node tools/run74.mjs [mode=dev]
// Stage 7.4 (D-027): the person's instructions for a chat, in the real window (verify-7-4w.mjs). Before the app starts it puts FOUR conversation
// files into a fresh scratch profile: one written by Stages 2-4 (version 1), one by Stages 5.4-7.3 (version 2), one of version 3 that holds
// instructions, and one of version 3 whose instructions are damaged (a number). The suite proves that reading never writes any of them, that
// what is readable opens (with the instructions it was saved with), and that the damaged one is counted and left alone to the end.
// Do not edit src/ while this runs: the launch builds from the tree.
import { mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { runApp, scratch } from './drive.mjs'

const mode = process.argv[2] ?? 'dev'
const P = scratch('s74')
rmSync(P, { recursive: true, force: true })
const dir = join(P, 'conversations')
mkdirSync(dir, { recursive: true })

const T = 1_790_000_000_000
const OPUS = 'claude-opus-5-5'
const user = (content) => ({ role: 'user', content, status: 'done' })
const reply = (content, extra = {}) => ({ role: 'assistant', content, status: 'done', provider: 'anthropic', model: OPUS, ...extra })

const make = (name, file, extra) => {
  const id = randomUUID()
  const text = JSON.stringify(file(id))
  writeFileSync(join(dir, `${id}.json`), text)
  // taken before the app starts, so a rewrite during its first scan shows
  return { name, id, text, mtime: statSync(join(dir, `${id}.json`)).mtimeMs, sha: createHash('sha256').update(text).digest('hex').slice(0, 16), ...extra }
}

const v1Messages = [user('v1 first question'), { role: 'assistant', content: 'v1 answer', status: 'done' }]
const v2Messages = [user('v2 first question'), reply('v2 answer'), user('v2 second question'), reply('v2 second answer')]
const v3Messages = [user('v3 first question'), reply('v3 answer')]
const SEEDED_INSTRUCTIONS = 'Seeded: always answer in rhyme.'

const seed = {
  v1: make('v1', (id) => ({ version: 1, id, title: 'v1 first question', createdAt: T, updatedAt: T + 1000, messages: v1Messages }), { title: 'v1 first question', messages: v1Messages }),
  v2: make('v2', (id) => ({ version: 2, id, title: 'v2 first question', createdAt: T + 10, updatedAt: T + 2000, messages: v2Messages }), { title: 'v2 first question', messages: v2Messages, createdAt: T + 10 }),
  v3: make('v3', (id) => ({ version: 3, id, title: 'v3 first question', createdAt: T + 20, updatedAt: T + 3000, instructions: SEEDED_INSTRUCTIONS, messages: v3Messages }), { title: 'v3 first question', messages: v3Messages, instructions: SEEDED_INSTRUCTIONS }),
  bad: make('bad', (id) => ({ version: 3, id, title: 'v3 damaged instructions', createdAt: T + 30, updatedAt: T + 4000, instructions: 12345, messages: v3Messages }), { title: 'v3 damaged instructions' })
}
writeFileSync(join(process.env.TEMP ?? '.', 'frontier-7-4-seed.json'), JSON.stringify(seed))
console.log(`seeded four conversations (versions 1, 2, 3 and a damaged 3) in ${dir}`)

const r = runApp({
  label: (mode === 'preview' ? 'p-' : 'd-') + 'w74',
  mode,
  scripts: 'verify-7-4w.mjs',
  env: { USER_DATA_DIR: P, MOCK_PORT: '8794', MOCK_SCRIPT: 'mock-providers.mjs' },
  timeoutMs: 600000
})
// the negative controls (nc.mjs) read these two things from the output: the totals line, and the FAIL lines
if (r.total > 0) console.log(`${r.passed}/${r.total} checks passed`)
for (const f of r.fails) console.log(f.trim())
process.exit(r.ok ? 0 : 1)
