// Negative control, general form: back up the project files named in the spec, apply the sabotage edits, run a
// command, ALWAYS restore every file from its backup and prove by hash that each is back to exactly what it was.
// usage: node nc.mjs <spec.json>
//   spec: { label, edits: [{ file, from, to }], argv: [<args for node>], env: {...} }
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { basename, join } from 'node:path'
import { OUT, REPO, TOOLS } from './paths.mjs'

// the committed specs name paths as {{REPO}} / {{TOOLS}} / {{OUT}} so they work wherever the repo is
const spec = JSON.parse(readFileSync(process.argv[2], 'utf8').replaceAll('{{REPO}}', REPO).replaceAll('{{TOOLS}}', TOOLS.replaceAll('\\', '/')).replaceAll('{{OUT}}', OUT.replaceAll('\\', '/')))
const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex').slice(0, 16)
const dir = join(process.env.TEMP ?? '.', 'frontier-negative-control')
mkdirSync(dir, { recursive: true })
const label = spec.label
const files = [...new Set(spec.edits.map((e) => e.file))]
const before = Object.fromEntries(files.map((f) => [f, sha(f)]))
const backups = Object.fromEntries(files.map((f) => [f, join(dir, `${label}-${basename(f)}.bak`)]))

// every sabotage text must exist exactly once, or nothing is touched
for (const e of spec.edits) {
  const n = readFileSync(e.file, 'utf8').split(e.from).length - 1
  if (n !== 1) { console.error(`ABORT [${label}]: ${n} matches (need exactly 1) in ${e.file} for: ${e.from.slice(0, 70)}`); process.exit(2) }
}
for (const f of files) copyFileSync(f, backups[f])
console.log(`[${label}] backed up: ${files.map((f) => basename(f) + ' ' + before[f]).join(', ')}`)
let exit = 1
try {
  for (const f of files) {
    let text = readFileSync(f, 'utf8')
    for (const e of spec.edits.filter((x) => x.file === f)) text = text.replace(e.from, e.to)
    writeFileSync(f, text)
  }
  console.log(`[${label}] sabotaged: ${spec.edits.length} edit(s) in ${files.length} file(s): ${spec.edits.map((e) => e.to.slice(0, 60).replace(/\s+/g, ' ')).join('  ||  ')}`)
  const run = spawnSync(process.execPath, spec.argv, { encoding: 'utf8', env: { ...process.env, ...(spec.env ?? {}), NODE_NO_WARNINGS: '1' }, timeout: 280000, maxBuffer: 64 * 1024 * 1024 })
  const out = (run.stdout ?? '') + (run.stderr ?? '')
  writeFileSync(join(dir, `${label}.out.txt`), out)
  const fails = out.split('\n').filter((l) => l.startsWith('FAIL'))
  const summary = out.split('\n').filter((l) => /\d+\/\d+ checks passed/.test(l)).at(-1) ?? '(no summary line: the run crashed or timed out)'
  console.log(`[${label}] WITH the sabotage: ${summary.trim()}`)
  for (const f of fails) console.log('    ' + f.slice(0, 200))
  exit = 0
} finally {
  for (const f of files) copyFileSync(backups[f], f)
  const ok = files.every((f) => sha(f) === before[f])
  console.log(`[${label}] restored: ${files.map((f) => basename(f) + ' ' + sha(f)).join(', ')} -> ${ok ? 'ALL IDENTICAL to before' : '!!! SOME FILE DIFFERS FROM BEFORE'}`)
  if (!ok) exit = 3
}
process.exit(exit)
