// usage: node tools/guarded-window-copy.mjs tools/run146.mjs [mode=dev]
// Slice 14.6 (D-045): connectors, in the real window with the REAL box (verify-14-6w.mjs, a fresh scratch profile; the file dialog and the system's message box are replaced from the
// main inspector). It must be started through tools/guarded-window-copy.mjs: that makes this run's own folder in C:\frontier-tmp (FRONTIER_GUARD_ROOT), runs from a COPY of the tree
// there, and confines every Node process of the run to removing only what lies in that folder and its throwaway profile.
// The app keeps its connectors' folders in a folder of runs of their own (at the root of the drive of the user's folder); from source it takes FRONTIER_CONNECTOR_ROOT instead (never in
// an installed app), and this launcher names a folder inside the run's own folder, so that nothing the app makes or removes lies outside it.
import { runApp, scratch } from './drive.mjs'
import { win32 } from 'node:path'

const mode = process.argv[2] ?? 'dev'
const tag = mode === 'preview' ? 'p-' : 'd-'
const run = process.env.FRONTIER_GUARD_ROOT
if (!run || !/^C:\\frontier-tmp\\guarded-w-[^\\]+$/i.test(run)) {
  console.error('run146.mjs must be started as: node tools/guarded-window-copy.mjs tools/run146.mjs (the run needs its own folder in C:\\frontier-tmp)')
  process.exit(2)
}
const result = runApp({
  label: `${tag}w146`,
  mode,
  scripts: 'setup-key.mjs,verify-14-6w.mjs',
  env: {
    USER_DATA_DIR: scratch('s146'),
    WIPE_USER_DATA: '1',
    INSPECT_PORT: '9236',
    MOCK_PORT: '8812',
    FRONTIER_RUN_ROOT: win32.join(run, 'FrontierRun'),
    FRONTIER_CONNECTOR_ROOT: win32.join(run, 'FrontierConnectors')
  },
  timeoutMs: 900000
})
console.log(`${result.passed}/${result.total} checks passed`)
for (const f of result.fails) console.log(String(f).trim())
process.exit(result.ok ? 0 : 1)
