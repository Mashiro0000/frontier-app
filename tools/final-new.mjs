// Runs every NEW (Stage 4) window suite for one mode (dev or preview) and prints one line each.
// usage: node final-new.mjs <dev|preview>
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { OUT, here, runApp, scratch } from './drive.mjs'
const mode = process.argv[2] ?? 'dev'
const pfx = mode === 'preview' ? 'p-' : 'd-'
const results = []
const total = (label) => { try { return [...readFileSync(join(OUT, `${label}.out.txt`), 'utf8').matchAll(/^(\d+)\/(\d+) checks passed/gm)].map((m) => `${m[1]}/${m[2]}`).join(' + ') } catch { return '(no output)' } }
const sub = (script, label, extra = {}) => {
  const r = spawnSync(process.execPath, [join(here, script)], { env: { ...process.env, MODE: mode, PFX: pfx, NODE_NO_WARNINGS: '1', ...extra }, encoding: 'utf8', timeout: 900000 })
  console.log(`${r.status === 0 ? 'OK  ' : 'BAD '} ${label.padEnd(36)} ${total(pfx + label.split(' ')[0])}`)
  results.push(r.status === 0)
}
const mock = '8791'
const main = { USER_DATA_DIR: scratch('s4main'), MOCK_PORT: mock }
const r1 = runApp({ label: pfx + 'w42', mode, scripts: 'setup-key.mjs,verify-4-2.mjs', env: { ...main, WIPE_USER_DATA: '1' } }); results.push(r1.ok)
const r2 = runApp({ label: pfx + 'w42b', mode, scripts: 'verify-4-2b.mjs', env: main }); results.push(r2.ok)
sub('run43.mjs', 'w43b (close the window mid-reply, reopen: two launches)')
sub('run43c.mjs', 'w43c (quit with 30 big saves queued)')
sub('run43a.mjs', 'w43a (folder in every damaged state)')
const r3 = runApp({ label: pfx + 'w44', mode, scripts: 'verify-4-4.mjs', env: { ...main, WIPE_USER_DATA: '1' } }); results.push(r3.ok)
sub('run45.mjs', 'w45 (saves fail: injected disk fault)')
console.log(`\n${results.filter(Boolean).length}/${results.length} runs clean (${mode})`)
process.exit(results.every(Boolean) ? 0 : 1)
