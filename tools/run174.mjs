// usage: node tools/guarded-window-copy.mjs tools/run174.mjs [dev|preview]
// Slice 17.4 (D-049), the app's tools with a Gemini model in the real window (verify-17-4w.mjs); the folder dialog and the system's box answered from the main inspector.
// It must be started through tools/guarded-window-copy.mjs. For the built app: node tools/guarded-window-copy.mjs tools/with-build.mjs tools/run174.mjs preview
import { runApp, scratch } from './drive.mjs'

const mode = process.argv[2] ?? 'dev'
const tag = mode === 'preview' ? 'p-' : 'd-'
const run = process.env.FRONTIER_GUARD_ROOT
if (!run || !/^C:\\frontier-tmp\\guarded-w-[^\\]+$/i.test(run)) {
  console.error('run174.mjs must be started as: node tools/guarded-window-copy.mjs tools/run174.mjs (the run needs its own folder in C:\\frontier-tmp)')
  process.exit(2)
}
const result = runApp({
  label: `${tag}w174`,
  mode,
  scripts: 'verify-17-4w.mjs',
  env: { USER_DATA_DIR: scratch('s174'), WIPE_USER_DATA: '1', INSPECT_PORT: '9242', MOCK_PORT: '8832' },
  timeoutMs: 900000
})
console.log(`${result.passed}/${result.total} checks passed`)
for (const f of result.fails) console.log(String(f).trim())
process.exit(result.ok ? 0 : 1)
