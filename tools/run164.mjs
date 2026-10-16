// usage: node tools/guarded-window-copy.mjs tools/run164.mjs [dev|preview]
// Slice 16.4 (D-048), in the real window against the fake image endpoint, the system's message box and save dialog stood in for from the main inspector (verify-16-4w.mjs).
// It must be started through tools/guarded-window-copy.mjs (the saved copy goes in the run's own folder). For the built app run `npx electron-vite build` first.
import { runApp, scratch } from './drive.mjs'

const mode = process.argv[2] ?? 'dev'
const tag = mode === 'preview' ? 'p-' : 'd-'
const run = process.env.FRONTIER_GUARD_ROOT
if (!run || !/^C:\\frontier-tmp\\guarded-w-[^\\]+$/i.test(run)) {
  console.error('run164.mjs must be started as: node tools/guarded-window-copy.mjs tools/run164.mjs (the run needs its own folder in C:\\frontier-tmp)')
  process.exit(2)
}
const result = runApp({
  label: `${tag}w164`,
  mode,
  scripts: 'verify-16-4w.mjs',
  env: { USER_DATA_DIR: scratch('s164'), WIPE_USER_DATA: '1', INSPECT_PORT: '9239', MOCK_PORT: '8814' },
  timeoutMs: 900000
})
console.log(`${result.passed}/${result.total} checks passed`)
for (const f of result.fails) console.log(String(f).trim())
process.exit(result.ok ? 0 : 1)
