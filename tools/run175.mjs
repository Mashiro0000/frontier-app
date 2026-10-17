// usage: node tools/guarded-window-copy.mjs tools/run175.mjs [dev|preview]
// Slice 17.5 (D-049), Settings and the window for Google (verify-17-5w.mjs); the system's box stood in for from the main inspector.
// It must be started through tools/guarded-window-copy.mjs. For the built app: node tools/guarded-window-copy.mjs tools/with-build.mjs tools/run175.mjs preview
import { runApp, scratch } from './drive.mjs'

const mode = process.argv[2] ?? 'dev'
const tag = mode === 'preview' ? 'p-' : 'd-'
const run = process.env.FRONTIER_GUARD_ROOT
if (!run || !/^C:\\frontier-tmp\\guarded-w-[^\\]+$/i.test(run)) {
  console.error('run175.mjs must be started as: node tools/guarded-window-copy.mjs tools/run175.mjs (the run needs its own folder in C:\\frontier-tmp)')
  process.exit(2)
}
const result = runApp({
  label: `${tag}w175`,
  mode,
  scripts: 'verify-17-5w.mjs',
  env: { USER_DATA_DIR: scratch('s175'), WIPE_USER_DATA: '1', INSPECT_PORT: '9243', MOCK_PORT: '8833' },
  timeoutMs: 900000
})
console.log(`${result.passed}/${result.total} checks passed`)
for (const f of result.fails) console.log(String(f).trim())
process.exit(result.ok ? 0 : 1)
