// Runs one of the plain-Node checks CONFINED (D-043, after the A: incident of 2026-10-09): the owner's rule is that nothing is deleted from any drive; the one thing he has allowed is
// that a check removes the folders it made itself in the same run, inside C:\frontier-tmp. This makes that true in code, for a check that was written before the rule:
//   1. makes ONE fresh folder, C:\frontier-tmp\guarded-<random> (the run's own),
//   2. starts the check in a child process whose TEMP and TMP are that folder (so every temp folder the check makes lies in it) and which is confined to it by tools/fsguard.mjs
//      (loaded first, with --import): it can write and remove only inside that folder, whatever it tries,
//   3. when the check is over, removes that folder (this process is confined to it as well).
// It will not run a check whose result needs the real system temp folder, or the real profile (a window check): those are not plain-Node checks. Programs the check starts are not
// watched by the guard (a check that starts programs that remove things is not one to run this way).
//
// usage: node tools/guarded.mjs tools/verify-12-3.mjs [args...]      (the exit code is the check's)
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import { win32 } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { installFsGuard } from './fsguard.mjs'

const BASE = 'C:\\frontier-tmp'
const target = process.argv[2]
if (target === undefined) {
  console.error('usage: node tools/guarded.mjs <check.mjs> [args...]')
  process.exit(2)
}
const suite = win32.resolve(target)
if (!fs.existsSync(suite) || !/\.mjs$/.test(suite)) {
  console.error(`guarded.mjs: ${suite} is not a check (.mjs) that is there.`)
  process.exit(2)
}
fs.mkdirSync(BASE, { recursive: true })
const run = fs.realpathSync.native(fs.mkdtempSync(win32.join(BASE, 'guarded-')))
installFsGuard({ write: [run], remove: [run] })
const preload = pathToFileURL(win32.join(win32.dirname(fileURLToPath(import.meta.url)), 'guard-preload.mjs')).href
const child = spawn(process.execPath, ['--import', preload, suite, ...process.argv.slice(3)], {
  stdio: 'inherit',
  // the check's working folder is the run's folder: a file it (or a module it sabotages) writes to a relative path lands there, never in the repo
  cwd: run,
  env: {
    ...process.env,
    TEMP: run,
    TMP: run,
    FRONTIER_KEEP_TEMP: '1',
    FRONTIER_SYSTEM_TEMP: run,
    FRONTIER_GUARD_ROOT: run,
    // the check removes what it made, inside the run's folder, and the guard does not let it remove anything else
    FRONTIER_MAY_REMOVE: '1'
  }
})
child.on('exit', (code) => {
  try {
    fs.rmSync(run, { recursive: true, force: true })
  } catch (error) {
    console.error(`guarded.mjs: the run's folder ${run} could not be removed (${error.code ?? error.message}); it is left in place.`)
  }
  process.exit(code ?? 1)
})
