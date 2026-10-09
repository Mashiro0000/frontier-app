// Runs a WINDOW run (the regression driver, a launcher such as run135.mjs) CONFINED (D-044), under the owner's two permissions of 2026-10-09: what a run removes is (1) what lies in the
// run's own folder in C:\frontier-tmp, (2) the throwaway profile folders frontier-app-test-scratch-<name> in the Roaming folder, (3) the generated `out` folder of the repo. This
//   1. makes ONE fresh folder, C:\frontier-tmp\guarded-w-<random>,
//   2. starts the command with TEMP and TMP there (so every temp folder of the run lies in it) and with NODE_OPTIONS=--import=harness-guard-preload.mjs, which confines every Node process
//      of the run (this one's children, theirs...) to those removals (tools/harness-guard-preload.mjs says exactly what, and what is refused),
//   3. when the command is over, removes that folder (this process is confined to it as well).
// What it cannot watch: Electron's own processes (they ignore --import; they run in a throwaway profile permission (2) covers) and programs a check starts.
//
// usage: node tools/guarded-window.mjs tools/run135.mjs [args...]      (any .mjs of tools/; the exit code is the command's)
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import { win32 } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { installFsGuard } from './fsguard.mjs'

const BASE = 'C:\\frontier-tmp'
const target = process.argv[2]
if (target === undefined) {
  console.error('usage: node tools/guarded-window.mjs <script.mjs> [args...]')
  process.exit(2)
}
const script = win32.resolve(target)
if (!fs.existsSync(script) || !/\.mjs$/.test(script)) {
  console.error(`guarded-window.mjs: ${script} is not a script (.mjs) that is there.`)
  process.exit(2)
}
const here = win32.dirname(fileURLToPath(import.meta.url))
const repo = win32.dirname(here)
fs.mkdirSync(BASE, { recursive: true })
const run = fs.realpathSync.native(fs.mkdtempSync(win32.join(BASE, 'guarded-w-')))
// this process may write and remove inside the run's folder only (it makes nothing else and removes nothing else)
installFsGuard({ write: [run], remove: [run] })
const preload = pathToFileURL(win32.join(here, 'harness-guard-preload.mjs')).href
const child = spawn(process.execPath, [script, ...process.argv.slice(3)], {
  stdio: 'inherit',
  cwd: repo,
  env: {
    ...process.env,
    TEMP: run,
    TMP: run,
    FRONTIER_KEEP_TEMP: '1',
    FRONTIER_SYSTEM_TEMP: run,
    FRONTIER_GUARD_ROOT: run,
    // the run removes what it made in its folder, its own throwaway profiles and the build folder, and the guard of every Node process of it refuses the rest
    FRONTIER_MAY_REMOVE: '1',
    NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --import=${preload}`.trim()
  }
})
child.on('exit', (code) => {
  try {
    fs.rmSync(run, { recursive: true, force: true })
  } catch (error) {
    console.error(`guarded-window.mjs: the run's folder ${run} could not be removed (${error.code ?? error.message}); it is left in place.`)
  }
  process.exit(code ?? 1)
})
