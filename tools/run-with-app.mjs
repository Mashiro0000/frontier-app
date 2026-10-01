// Start the app, run ONE verification script against it, then stop exactly the process tree we started.
// usage: node run-with-app.mjs <dev|preview> <script.mjs> <screenshot-dir> [port]
import { REPO_WIN } from './paths.mjs'
import { spawn, spawnSync } from 'node:child_process'
import { copyFileSync, createWriteStream, mkdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { OUT } from './paths.mjs'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const [mode, script, shots, port = '9222'] = process.argv.slice(2)
if (!['dev', 'preview'].includes(mode) || !script || !shots) {
  console.error('usage: node run-with-app.mjs <dev|preview> <script.mjs> <screenshot-dir> [port]')
  process.exit(2)
}

// `npm run dev` -> electron-vite dev ; `npm run start` -> electron-vite preview (runs the BUILT app from out/)
// dev has its own --remoteDebuggingPort option; preview instead forwards whatever follows a second `--`
// to Electron itself. --skipBuild: use the out/ folder that `npm run build` just made.
// INSPECT_PORT (optional): also open Node's inspector on the MAIN process, so a check can ask the
// running app what Electron thinks its window settings are. dev reads V8_INSPECTOR_PORT; preview
// needs --inspect passed to Electron itself.
const inspect = process.env.INSPECT_PORT
// USER_DATA_DIR (optional): run with a scratch profile instead of the real one in %APPDATA%, so a test
// key (or anything else the app saves) never lands in the user's own app data. WIPE_USER_DATA=1 empties
// it first. Both modes pass it as an Electron argument after a second `--`. (Setting ELECTRON_CLI_ARGS
// in the environment does NOT work for dev: the electron-vite CLI overwrites it with its own list.
// That mistake once sent a test run to the real profile, so every test script also checks, before it
// writes anything, that the app really is using this directory.)
const userData = process.env.USER_DATA_DIR
if (userData && process.env.WIPE_USER_DATA === '1') rmSync(userData, { recursive: true, force: true })
if (userData) mkdirSync(userData, { recursive: true })
// PRESEED_FILE (optional): copied into the scratch profile as preferences.json before the app starts, to test how the app
// reads a saved model choice that is stale, corrupt or hostile.
if (userData && process.env.PRESEED_FILE) copyFileSync(process.env.PRESEED_FILE, join(userData, 'preferences.json'))
// EXTRA_ELECTRON_ARGS (optional): more Chromium flags for the app, e.g. to switch off occlusion detection (Stage 4)
// Default: the flags automation tools use so that a window covered by other windows is not treated as hidden (a hidden window
// acknowledges mouse events only after ~5 s, which made a few launches misbehave: see the Stage 4 notes). Set it to '' to turn off.
const DEFAULT_FLAGS = '--disable-features=CalculateNativeWinOcclusion --disable-backgrounding-occluded-windows --disable-renderer-backgrounding'
const extraFlags = process.env.EXTRA_ELECTRON_ARGS ?? DEFAULT_FLAGS
const extraArgs = extraFlags ? ` ${extraFlags}` : ''
const userDataArg = (userData ? ` --user-data-dir=${userData}` : '') + extraArgs
const command =
  mode === 'dev'
    ? `npm run dev -- --remoteDebuggingPort ${port}${process.env.DEV_WATCH === '1' ? ' --watch' : ''}${userDataArg ? ` --${userDataArg}` : ''}`
    : `npm run start -- --skipBuild -- --remote-debugging-port=${port}${inspect ? ` --inspect=${inspect}` : ''}${userDataArg}`
const label = process.env.LOG_LABEL ?? 'run'
const logPath = join(OUT, `app-${mode}-${label}.log`)
process.env.APP_LOG = logPath // child scripts can grep the app's own output (for leaked secrets)
const log = createWriteStream(logPath)

// MOCK_PORT (optional): start the fake provider API (mock-providers.mjs; MOCK_SCRIPT overrides) on this port first, and point
// the app at it through FRONTIER_API_BASE_URL (honoured only when the app runs from source).
const mockPort = process.env.MOCK_PORT
let mock = null
if (mockPort) {
  mock = spawn(process.execPath, [join(here, process.env.MOCK_SCRIPT ?? 'mock-providers.mjs'), mockPort], { stdio: 'ignore', windowsHide: true })
  for (let i = 0; i < 40; i++) {
    try { await fetch(`http://127.0.0.1:${mockPort}/__requests`); break } catch { await new Promise((r) => setTimeout(r, 100)) }
  }
  console.log(`mock API on port ${mockPort} (pid ${mock.pid})`)
}
const app = spawn('cmd.exe', ['/c', command], {
  cwd: REPO_WIN,
  windowsHide: true,
  stdio: ['ignore', 'pipe', 'pipe'],
  env: {
    ...process.env,
    // Chromium's own log lines (renderer/GPU process gone, etc.) go to the app log, which is otherwise silent about a crash
    ELECTRON_ENABLE_LOGGING: process.env.ELECTRON_ENABLE_LOGGING ?? '1',
    ...(inspect && mode === 'dev' ? { V8_INSPECTOR_PORT: inspect } : {}),
    ...(mockPort ? { FRONTIER_API_BASE_URL: `http://127.0.0.1:${mockPort}` } : {})
  }
})
app.stdout.pipe(log)
app.stderr.pipe(log)
console.log(`started ${mode} app (tree root PID ${app.pid})`)

let stopped = false
const startedAt = Date.now()
function stopApp() {
  if (stopped) return
  // Say what state the app was in BEFORE we kill it. A suite that dies early shows up as "0/0" in the driver, and the first
  // question is always "was the app still running?" (the 'exit' event below is async and can lose the race with this).
  if (app.exitCode !== null || app.signalCode !== null) {
    console.log(`!! the app had ALREADY EXITED by itself (code ${app.exitCode}${app.signalCode ? ', signal ' + app.signalCode : ''}) before the checks ended; ${Date.now() - startedAt} ms after it was started`)
  } else {
    const t = spawnSync('tasklist', ['/FI', 'IMAGENAME eq electron.exe', '/FO', 'CSV', '/NH'], { encoding: 'utf8' })
    const count = (t.stdout ?? '').split('\n').filter((l) => /electron\.exe/i.test(l)).length
    // the launcher (cmd/npm/electron-vite) can outlive the app by a few seconds: what matters is whether electron.exe is there
    console.log(count === 0 ? `!! the app is GONE: no electron.exe process is running (the launcher is still there), ${Date.now() - startedAt} ms after it was started` : `app state at the end: running (${count} electron.exe processes), ${Date.now() - startedAt} ms after it was started`)
  }
  stopped = true
  // /T = the whole tree we started (cmd -> npm -> node -> electron), /F = force. Only this PID tree.
  const r = spawnSync('taskkill', ['/PID', String(app.pid), '/T', '/F'], { encoding: 'utf8' })
  console.log(`stopped app tree ${app.pid}: ${(r.stdout || r.stderr || '').trim().split('\n')[0]}`)
  if (mock) {
    spawnSync('taskkill', ['/PID', String(mock.pid), '/T', '/F'], { encoding: 'utf8' })
    console.log(`stopped mock API ${mock.pid}`)
  }
}
process.on('exit', stopApp)
process.on('SIGINT', () => process.exit(130))
app.on('exit', (code, signal) => {
  if (!stopped) console.log(`!! the app exited by itself (code ${code}${signal ? ', signal ' + signal : ''}) ${Date.now() - startedAt} ms after it was started, before the checks finished`)
})

// `script` may be a comma-separated list; they run one after another against the same app launch.
let worst = 0
for (const name of script.split(',')) {
  console.log(`\n===== ${name} =====`)
  const code = await new Promise((resolve) => {
    const run = spawn(process.execPath, [join(here, name), shots, port], { stdio: 'inherit' })
    run.on('exit', (c) => resolve(c ?? 1))
  })
  console.log(`-- ${name} exit code ${code}`) // the driver tells "failed checks" (a summary was printed) from "died" (no summary) with this
  worst = Math.max(worst, code)
}
stopApp()
process.exit(worst)
