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
// A spec whose code is gone is marked "retired" with the reason (the owner's rule keeps files: none is deleted, D-051); it is never run.
if (spec.retired) {
  console.log(`RETIRED ${spec.label}: ${spec.retired} (nothing changed, nothing run)`)
  process.exit(2)
}
// A spec written before the window runs had their own AppData (D-044) names its throwaway profile in the REAL Roaming folder; inside a window run (tools/guarded-window-copy.mjs) the
// profiles are the run's own, so the real folder in the spec's environment is put for the run's.
if (process.env.FRONTIER_REAL_APPDATA && process.env.APPDATA && process.env.FRONTIER_REAL_APPDATA.toLowerCase() !== process.env.APPDATA.toLowerCase()) {
  for (const [key, value] of Object.entries(spec.env ?? {})) {
    if (typeof value === 'string') spec.env[key] = value.split(process.env.FRONTIER_REAL_APPDATA).join(process.env.APPDATA)
  }
}
const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex').slice(0, 16)
const dir = join(process.env.TEMP ?? '.', 'frontier-negative-control')
mkdirSync(dir, { recursive: true })
const label = spec.label
const files = [...new Set(spec.edits.map((e) => e.file))]
const before = Object.fromEntries(files.map((f) => [f, sha(f)]))
const backups = Object.fromEntries(files.map((f) => [f, join(dir, `${label}-${basename(f)}.bak`)]))

// every sabotage text must exist exactly once, or nothing is touched. (Stage 14: an edit may say `count`, the exact number of times its text is in the file, and `nth`, the one it
// sabotages: the launcher's serve mode repeats lines of its run mode, and the older controls target the run mode's.)
const nthIndex = (text, from, nth) => {
  let at = -1
  for (let i = 0; i < nth; i++) at = text.indexOf(from, at + 1)
  return at
}
for (const e of spec.edits) {
  const n = readFileSync(e.file, 'utf8').split(e.from).length - 1
  const want = e.count ?? 1
  if (n !== want || (e.nth ?? 1) < 1 || (e.nth ?? 1) > want) { console.error(`ABORT [${label}]: ${n} matches (need exactly ${want}) in ${e.file} for: ${e.from.slice(0, 70)}`); process.exit(2) }
}
for (const f of files) copyFileSync(f, backups[f])
console.log(`[${label}] backed up: ${files.map((f) => basename(f) + ' ' + before[f]).join(', ')}`)
let exit = 1
try {
  for (const f of files) {
    let text = readFileSync(f, 'utf8')
    for (const e of spec.edits.filter((x) => x.file === f)) {
      const at = nthIndex(text, e.from, e.nth ?? 1)
      text = text.slice(0, at) + e.to + text.slice(at + e.from.length)
    }
    writeFileSync(f, text)
  }
  console.log(`[${label}] sabotaged: ${spec.edits.length} edit(s) in ${files.length} file(s): ${spec.edits.map((e) => e.to.slice(0, 60).replace(/\s+/g, ' ')).join('  ||  ')}`)
  // NC_GUARDED=1: the suite is started through tools/guarded.mjs, which confines it to one fresh folder in C:\frontier-tmp (D-043: nothing is removed from any drive but what a run made itself there)
  const argv = process.env.NC_GUARDED === '1' ? [join(TOOLS, 'guarded.mjs'), ...spec.argv] : spec.argv
  const run = spawnSync(process.execPath, argv, { encoding: 'utf8', env: { ...process.env, ...(spec.env ?? {}), NODE_NO_WARNINGS: '1' }, timeout: spec.timeoutMs ?? 280000, maxBuffer: 64 * 1024 * 1024 })
  const out = (run.stdout ?? '') + (run.stderr ?? '')
  writeFileSync(join(dir, `${label}.out.txt`), out)
  const fails = out.split('\n').filter((l) => l.startsWith('FAIL'))
  const summary = out.split('\n').filter((l) => /\d+\/\d+ checks passed/.test(l)).at(-1) ?? '(no summary line: the run crashed or timed out)'
  console.log(`[${label}] WITH the sabotage: ${summary.trim()}`)
  for (const f of fails) console.log('    ' + f.slice(0, 200))
  exit = 0
} finally {
  // Putting a file back must not depend on luck: Windows can hold a file for a moment (an indexer, an editor, a watcher), and one failed copy here once
  // left a sabotage in the tree with no word about it (slice 8.3: caught only because the whole tree was hashed before and after the batch). So try
  // again for a few seconds, prove each file by hash, and if one cannot be put back say so in a line that nc-all.mjs shows.
  const failed = []
  for (const f of files) {
    let done = false
    let last = null
    for (let attempt = 1; attempt <= 30 && !done; attempt++) {
      try {
        copyFileSync(backups[f], f)
        done = sha(f) === before[f]
      } catch (error) {
        last = error
      }
      if (!done) await new Promise((resolve) => setTimeout(resolve, 300))
    }
    if (!done) failed.push(`${basename(f)} (${last ? (last.code ?? last.message) : 'the hash differs'}; the original is ${backups[f]})`)
  }
  const ok = failed.length === 0
  console.log(`[${label}] restored: ${files.map((f) => { try { return basename(f) + ' ' + sha(f) } catch { return basename(f) + ' (unreadable)' } }).join(', ')} -> ${ok ? 'ALL IDENTICAL to before' : '!!! SOME FILE DIFFERS FROM BEFORE'}`)
  if (!ok) {
    console.log(`[${label}] RESTORE FAILED for ${failed.join('; ')}: copy the original back by hand BEFORE anything else is run`)
    exit = 3
  }
}
process.exit(exit)
