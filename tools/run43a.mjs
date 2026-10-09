// Seeded launch: puts conversation files in every state a crash or a hand edit could leave into a fresh scratch
// profile's `conversations` folder, BEFORE the app starts, then runs verify-4-3a.mjs against the real window.
// (run-with-app.mjs only knows how to seed preferences.json, so the seeding is done here, after a wipe of our own.)
import './temp-on-a.mjs'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { randomBytes, randomUUID, createHash } from 'node:crypto'
import { join } from 'node:path'
import { runApp, scratch } from './drive.mjs'

const P = scratch('s4seed43')
rmSync(P, { recursive: true, force: true })
const dir = join(P, 'conversations')
mkdirSync(dir, { recursive: true })

const msg = (role, content, status = 'done', extra = {}) => ({ role, content, status, ...extra })
const file = (id, title, updatedAt, messages) => JSON.stringify({ version: 1, id, title, createdAt: updatedAt - 1000, updatedAt, messages })
const sha = (b) => createHash('sha256').update(b).digest('hex').slice(0, 16)
const seeds = [] // { id, name, files: { name: content }, listed: title|null, ... }
const add = (name, files, expect) => { const id = expect.id; seeds.push({ name, id, files, ...expect }); for (const [n, c] of Object.entries(files)) writeFileSync(join(dir, n), c) }
const T = 1_790_000_000_000

let id = randomUUID()
add('good, older', { [`${id}.json`]: file(id, 'good a', T + 1000, [msg('user', 'good a'), msg('assistant', 'answer a')]) }, { id, listed: 'good a', messages: 2 })
id = randomUUID()
add('good, newer, saved by an older build with "streaming" in it', { [`${id}.json`]: file(id, 'good b', T + 5000, [msg('user', 'good b'), msg('assistant', 'half an ans', 'streaming')]) }, { id, listed: 'good b', messages: 2, lastNote: 'Stopped' })
id = randomUUID()
add('crash during the copy: torn real file + whole .tmp', { [`${id}.json`]: file(id, 'old title', T + 2000, [msg('user', 'old title'), msg('assistant', 'old')]).slice(0, 70), [`${id}.json.tmp`]: file(id, 'recovered from tmp', T + 3000, [msg('user', 'recovered from tmp'), msg('assistant', 'new answer')]) }, { id, listed: 'recovered from tmp', messages: 2, heal: true })
id = randomUUID()
add('crash during the first write: whole real file + cut-off .tmp', { [`${id}.json`]: file(id, 'kept final', T + 2500, [msg('user', 'kept final'), msg('assistant', 'fine')]), [`${id}.json.tmp`]: file(id, 'never finished', T + 9000, [msg('user', 'never finished')]).slice(0, 60) }, { id, listed: 'kept final', messages: 2 })
id = randomUUID()
add('a good file an editor saved with a byte-order mark', { [`${id}.json`]: '﻿' + file(id, 'with bom', T + 1500, [msg('user', 'with bom'), msg('assistant', 'ok')]) }, { id, listed: 'with bom', messages: 2 })
id = randomUUID()
add('a failed reply and a stopped reply, saved normally', { [`${id}.json`]: file(id, 'notes', T + 4000, [msg('user', 'notes'), msg('assistant', '', 'error', { error: 'The service had a problem. (request req_x)' }), msg('user', 'again'), msg('assistant', 'part', 'stopped')]) }, { id, listed: 'notes', messages: 4, notes: [null, 'The service had a problem. (request req_x)', null, 'Stopped'] })
// unreadable ones
id = randomUUID(); add('torn real file only', { [`${id}.json`]: file(id, 'torn', T, [msg('user', 'torn')]).slice(0, 55) }, { id, listed: null, unreadable: true })
id = randomUUID(); add('5 MB of random bytes', { [`${id}.json`]: randomBytes(5 * 1024 * 1024) }, { id, listed: null, unreadable: true })
id = randomUUID(); add('another version', { [`${id}.json`]: file(id, 'v4', T, [msg('user', 'v4')]).replace('"version":1', '"version":4') }, { id, listed: null, unreadable: true })
// not conversations at all: ignored, never counted
const foreign = { 'notes.txt': 'my own notes', [`${randomUUID().toUpperCase()}.json`]: '{"not":"ours"}', 'README.json': '{}' }
for (const [n, c] of Object.entries(foreign)) writeFileSync(join(dir, n), c)

const manifest = { dir, seeds, hashes: {} }
for (const s of seeds) for (const [n, c] of Object.entries(s.files)) manifest.hashes[n] = sha(typeof c === 'string' ? Buffer.from(c) : c)
for (const [n, c] of Object.entries(foreign)) manifest.hashes[n] = sha(Buffer.from(c))
writeFileSync(join(process.env.TEMP ?? '.', 'frontier-4-3a-seeds.json'), JSON.stringify(manifest))
console.log(`seeded ${seeds.length} cases (${Object.keys(manifest.hashes).length} files) in ${dir}`)

const r = runApp({ label: (process.env.PFX ?? '') + 'w43a', mode: process.env.MODE ?? 'dev', scripts: 'verify-4-3a.mjs', env: { USER_DATA_DIR: P, MOCK_PORT: '8794' }, timeoutMs: 250000 })
process.exit(r.ok ? 0 : 1)
