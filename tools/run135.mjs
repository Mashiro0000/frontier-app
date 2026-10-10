// usage: node tools/guarded-window-copy.mjs tools/run135.mjs [mode=dev]
// Slice 13.5 (D-043): running programs, in the real window with the REAL box (verify-13-5w.mjs, a fresh scratch profile; the folder dialog and the system's message box are replaced
// from the main inspector). It must be started through tools/guarded-window-copy.mjs: that makes this run's own folder in C:\frontier-tmp (FRONTIER_GUARD_ROOT), runs from a COPY of the
// tree there, and confines every Node process of the run to removing only what lies in that folder and its throwaway profile.
// The app makes its folder of runs (FrontierRun) at the ROOT of the workspace's drive; from source it takes FRONTIER_RUN_ROOT instead (never in an installed app), and this launcher
// names a folder inside the run's own folder, so that nothing the app makes or removes lies outside it. (A workspace on a substituted drive was tried first: the app refuses one, on
// purpose, which is the right answer.)
// For preview, `npx electron-vite build` is run first by the regression driver. Do not edit src/ while this runs in a place the launch builds from.
import { runApp, scratch } from './drive.mjs'
import { win32 } from 'node:path'

const mode = process.argv[2] ?? 'dev'
const tag = mode === 'preview' ? 'p-' : 'd-'
const run = process.env.FRONTIER_GUARD_ROOT
if (!run || !/^C:\\frontier-tmp\\guarded-w-[^\\]+$/i.test(run)) {
  console.error('run135.mjs must be started as: node tools/guarded-window-copy.mjs tools/run135.mjs (the run needs its own folder in C:\\frontier-tmp)')
  process.exit(2)
}
const result = runApp({
  label: `${tag}w135`,
  mode,
  scripts: 'setup-key.mjs,verify-13-5w.mjs',
  env: { USER_DATA_DIR: scratch('s135'), WIPE_USER_DATA: '1', INSPECT_PORT: '9235', MOCK_PORT: '8811', FRONTIER_RUN_ROOT: win32.join(run, 'FrontierRun') },
  timeoutMs: 900000
})
console.log(`${result.passed}/${result.total} checks passed`)
for (const f of result.fails) console.log(String(f).trim())
process.exit(result.ok ? 0 : 1)
