// Runs a WINDOW check, the window negative controls or the regression driver CONFINED and FROM A DISPOSABLE COPY OF THE TREE (D-044, 2026-10-10). Why a copy: the dev server and the build
// tool the window checks start (electron-vite, vite, npm) remove files of their own while they work: a temporary config file next to the project's config, vite's cache folder
// `node_modules/.vite/deps`, npm's old log files. The owner's rule is that nothing is removed from any drive, and the one thing he allowed is what a run made itself inside
// `C:\frontier-tmp`, so the tree they work in is made INSIDE this run's own folder, and everything they remove lies in it. This
//   1. makes ONE fresh folder, C:\frontier-tmp\guarded-w-<random> (this process is confined to writing and removing there, tools/fsguard.mjs),
//   2. copies the repo into <run>\app (not .git, not out, not tools\.out, not the plan PDFs) and its node_modules into <run>\app\node_modules (robocopy: it copies, it removes nothing; the
//      source is only read; node_modules of the repo must be a real folder on this drive, not a junction to another one),
//   3. starts the script (a .mjs of this repo's tools folder, run from the COPY) with TEMP, TMP and npm's cache and logs in the run's folder, FRONTIER_GUARD_ROOT, FRONTIER_MAY_REMOVE=1 and
//      NODE_OPTIONS=--import=<copy>\tools\harness-guard-preload.mjs, which confines every Node process of the run to removing only what lies in the run's folder, the throwaway profiles
//      %APPDATA%\frontier-app-test-scratch-<name> and the copy's own `out` folder,
//   4. when the script is over, copies its outputs (tools\.out) to C:\frontier-work\window-runs\<run>\ and removes the run's folder (confined as well).
// Everything a sabotage of a negative control changes is changed in the COPY: the working tree is never touched by a window run.
// What it cannot watch: Electron's own processes (they ignore --import; they work in a throwaway profile) and programs a check starts.
//
// usage: node tools/guarded-window-copy.mjs tools/run135.mjs [args...]      (any .mjs of tools/; the exit code is the script's)
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import { win32 } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { installFsGuard } from './fsguard.mjs'

const BASE = 'C:\\frontier-tmp'
const OUTPUTS = 'C:\\frontier-work\\window-runs'
const target = process.argv[2]
if (target === undefined) {
  console.error('usage: node tools/guarded-window-copy.mjs <script.mjs of tools/> [args...]')
  process.exit(2)
}
const here = win32.dirname(fileURLToPath(import.meta.url))
const repo = win32.dirname(here)
const scriptAbs = win32.resolve(target)
const rel = win32.relative(here, scriptAbs)
if (rel.startsWith('..') || win32.isAbsolute(rel) || rel.includes('\\') || !/\.mjs$/.test(rel) || !fs.existsSync(scriptAbs)) {
  console.error(`guarded-window-copy.mjs: ${scriptAbs} is not a script (.mjs) in ${here}.`)
  process.exit(2)
}
const copyModules = process.env.FRONTIER_COPY_NODE_MODULES !== '0' // only the wrapper's own self-test leaves it out
if (copyModules) {
  let info
  try {
    info = fs.lstatSync(win32.join(repo, 'node_modules'))
  } catch {
    info = null
  }
  if (info === null || info.isSymbolicLink() || !info.isDirectory()) {
    console.error('guarded-window-copy.mjs: node_modules is missing or is a link (a junction to another drive would let the dev server write there). Make a real copy on this drive first: rename the junction, never delete it.')
    process.exit(2)
  }
}
fs.mkdirSync(BASE, { recursive: true })
const run = fs.realpathSync.native(fs.mkdtempSync(win32.join(BASE, 'guarded-w-')))
// this process may write and remove inside the run's folder only (it makes nothing else and removes nothing else)
installFsGuard({ write: [run], remove: [run] })
const app = win32.join(run, 'app')

function copyTree(from, to, extra) {
  // robocopy copies and never removes (no /MIR, no /PURGE); exit codes 0 to 7 are success
  const result = spawnSync('robocopy', [from, to, '/E', '/COPY:DAT', '/DCOPY:DAT', '/R:1', '/W:1', '/NFL', '/NDL', '/NP', '/NJH', '/NJS', ...extra], { encoding: 'utf8', windowsHide: true })
  return result.status !== null && result.status < 8
}
const skipDirs = [win32.join(repo, '.git'), win32.join(repo, 'out'), win32.join(repo, 'node_modules'), win32.join(repo, 'tools', '.out')]
// the plan PDFs of the repo's root are left out; the fixtures that are PDFs (tools\fixtures9) are not
const rootPdfs = fs.readdirSync(repo).filter((n) => /\.pdf$/i.test(n)).map((n) => win32.join(repo, n))
let ok = copyTree(repo, app, ['/XD', ...skipDirs, ...(rootPdfs.length > 0 ? ['/XF', ...rootPdfs] : [])])
if (ok && copyModules) ok = copyTree(win32.join(repo, 'node_modules'), win32.join(app, 'node_modules'), [])
if (!ok) {
  console.error(`guarded-window-copy.mjs: the copy of the tree into ${app} failed.`)
  try {
    fs.rmSync(run, { recursive: true, force: true })
  } catch (error) {
    console.error(`the run's folder ${run} could not be removed (${error.code ?? error.message}); it is left in place.`)
  }
  process.exit(2)
}
// The run's own AppData (D-044, 2026-10-10). The Claude desktop app is a packaged app installed on drive A:, and Windows redirects what its processes write under the real AppData
// (Roaming and Local) to the package's own data folder on A: (A:\WpSystem\...\LocalCache): the throwaway profiles of every window run were being written there, and the real path of a
// file in one is not the path it is called by (so a guard that compares real paths refused to remove it). The run's profiles are made in the run's own folders, on C:, which is also
// where the rule allows a run to remove what it made. Roaming is EFS-encrypted like the real one (the checks of this PC's EFS conditions, D-010, still test them).
const roaming = win32.join(run, 'roaming')
const local = win32.join(run, 'local')
fs.mkdirSync(roaming)
fs.mkdirSync(local)
const efs = spawnSync('cipher', ['/E', roaming], { encoding: 'utf8', windowsHide: true })
if (efs.status !== 0) console.error(`guarded-window-copy.mjs: the Roaming folder of the run could not be EFS-encrypted (${String(efs.stdout).trim().slice(0, 120)}): the checks of the EFS conditions will say so.`)
const preload = pathToFileURL(win32.join(app, 'tools', 'harness-guard-preload.mjs')).href
const child = spawn(process.execPath, [win32.join(app, 'tools', rel), ...process.argv.slice(3)], {
  stdio: 'inherit',
  cwd: app,
  env: {
    ...process.env,
    TEMP: run,
    TMP: run,
    // the real AppData folders, for the few older plain-Node suites that test this PC's EFS conditions in them (tools/regress.mjs hands them to those)
    FRONTIER_REAL_APPDATA: process.env.APPDATA ?? '',
    APPDATA: roaming,
    LOCALAPPDATA: local,
    // npm writes its logs and removes the old ones in its cache folder: here it is the run's own
    npm_config_cache: win32.join(run, 'npm-cache'),
    FRONTIER_KEEP_TEMP: '1',
    FRONTIER_SYSTEM_TEMP: run,
    FRONTIER_GUARD_ROOT: run,
    FRONTIER_MAY_REMOVE: '1',
    FRONTIER_WINDOW_COPY: app,
    NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --import=${preload}`.trim()
  }
})
child.on('exit', (code) => {
  // the outputs of the run (logs, results) go out before the folder does
  const kept = win32.join(OUTPUTS, win32.basename(run))
  const outputs = win32.join(app, 'tools', '.out')
  if (fs.existsSync(outputs)) {
    // (robocopy makes the folders of the destination itself: this process may write only in the run's folder)
    spawnSync('robocopy', [outputs, kept, '/E', '/R:1', '/W:1', '/NFL', '/NDL', '/NP', '/NJH', '/NJS', '/XD', win32.join(outputs, 'shots')], { encoding: 'utf8', windowsHide: true })
    console.error(`guarded-window-copy.mjs: the outputs of the run are in ${kept}`)
  }
  try {
    fs.rmSync(run, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 })
  } catch (error) {
    console.error(`guarded-window-copy.mjs: the run's folder ${run} could not be removed (${error.code ?? error.message}); it is left in place.`)
  }
  process.exit(code ?? 1)
})
