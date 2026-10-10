// 13.7: "three runs at once", over and over, to see how often one of them fails and WHY (the 13.2 suite's check of three parallel runs failed once in a full run: a run
// that did not write its file). It uses the app's own runner with the real launcher, container and job; it prints, for every round, the outcome of each of the three.
//   FRONTIER_MAY_REMOVE=1 TEMP=C:\frontier-tmp node tools/par-13-7.mjs [rounds=6] [parallel=3]
// Like the suites: it removes only what it made itself inside C:\frontier-tmp (the guard under the real file system, tools/fsguard.mjs, refuses anything else).
import './ts-resolve.mjs'
import fs from 'node:fs'
import os from 'node:os'
import { win32 } from 'node:path'
import { installFsGuard } from './fsguard.mjs'
import { REPO_URL } from './paths.mjs'

if (process.env.FRONTIER_MAY_REMOVE !== '1') {
  console.log('NOT RUN: this script removes the folder it made itself; set FRONTIER_MAY_REMOVE=1 only when the owner has allowed removing in words.')
  process.exit(3)
}
if (os.tmpdir().toLowerCase() !== 'c:\\frontier-tmp') {
  console.log(`NOT RUN: the temp folder is ${os.tmpdir()}; it may only work in C:\\frontier-tmp.`)
  process.exit(3)
}
const J = win32.join
const ROUNDS = Number(process.argv[2] || 6)
const PARALLEL = Number(process.argv[3] || 3)
const ROOT = fs.realpathSync.native(fs.mkdtempSync(J(os.tmpdir(), 'frontier-par-')))
installFsGuard({ write: [ROOT], remove: [ROOT] })
process.chdir(ROOT)
const { createCommandRunner, sweepMounts } = await import(`${REPO_URL}/src/main/commandRunner.ts`)
process.on('exit', () => {
  try {
    sweepMounts(ROOT)
    process.chdir(os.tmpdir())
    fs.rmSync(ROOT, { recursive: true, force: true })
  } catch {
    /* left for the system */
  }
})
const runRoot = J(ROOT, 'run')
fs.mkdirSync(runRoot, { recursive: true })
const NODE = J(process.env.ProgramFiles ?? 'C:\\Program Files', 'nodejs', 'node.exe')
const runner = createCommandRunner({ runRoot })
let n = 0
let bad = 0
if (process.env.WARM !== '0') {
  // the first run makes the private copy of node.exe and the container: three runs that start at the same moment on a PC where none of it exists yet race for them
  const d = J(runRoot, 'scratch', 'warm')
  fs.mkdirSync(d, { recursive: true })
  const w = await runner.run({ program: NODE, args: ['-e', 'process.exit(0)'], scratchDir: d })
  console.log(`warm-up: ${w.kind === 'ran' ? `ran, exit ${w.exitCode}` : `NOT-RUN ${w.why}: ${w.message}`}`)
}
for (let round = 1; round <= ROUNDS; round++) {
  const ds = []
  for (let i = 0; i < PARALLEL; i++) {
    const d = J(runRoot, 'scratch', `par-${++n}`)
    fs.mkdirSync(d, { recursive: true })
    fs.writeFileSync(J(d, 'p.cjs'), "require('fs').writeFileSync('who.txt', process.cwd()); setTimeout(() => process.exit(0), 2500)")
    ds.push(d)
  }
  const t0 = Date.now()
  const outs = await Promise.all(ds.map((d) => runner.run({ program: NODE, args: ['p.cjs'], scratchDir: d })))
  const line = outs.map((o, i) => {
    const wrote = fs.existsSync(J(ds[i], 'who.txt'))
    if (o.kind === 'ran' && o.exitCode === 0 && wrote) return 'ok'
    bad++
    return o.kind === 'ran' ? `RAN exit=${o.exitCode} wrote=${wrote} stderr=${JSON.stringify(o.stderr.slice(0, 200))} stdout=${JSON.stringify(o.stdout.slice(0, 100))}` : `NOT-RUN ${o.why}: ${o.message}`
  })
  console.log(`round ${round} (${Date.now() - t0} ms): ${line.join(' | ')}`)
}
console.log(`${bad === 0 ? 'ALL OK' : `${bad} run(s) failed`} in ${ROUNDS} rounds of ${PARALLEL}`)
process.exit(bad === 0 ? 0 : 1)
