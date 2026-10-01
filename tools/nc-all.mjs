// Runs a list of negative-control specs one after another (waiting for the debug port to be free between runs),
// printing only: the sabotage, the suite's verdict with it, the failing checks, and the proof the file was restored.
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
const here = dirname(fileURLToPath(import.meta.url))
const dir = process.argv[2]
const names = process.argv.slice(3)
const free = async () => { for (let i = 0; i < 120; i++) { try { await fetch('http://127.0.0.1:9222/json') } catch { return } await new Promise((r) => setTimeout(r, 250)) } }
for (const name of names) {
  await free()
  const r = spawnSync(process.execPath, [join(here, 'nc.mjs'), join(here, dir, `${name}.json`)], { encoding: 'utf8', timeout: 400000, maxBuffer: 64 * 1024 * 1024 })
  const out = (r.stdout ?? '') + (r.stderr ?? '')
  const lines = out.split('\n')
  console.log(`--- ${name}`)
  for (const l of lines) {
    if (/ABORT|WITH the sabotage|restored:/.test(l)) console.log('  ' + l.replace(/^\[[^\]]+\] /, '').slice(0, 220))
    else if (/^    FAIL/.test(l)) console.log('  ' + l.trim().slice(0, 200))
  }
}
