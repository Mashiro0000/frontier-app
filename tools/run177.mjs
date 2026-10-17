// usage: node tools/guarded-window-copy.mjs tools/run177.mjs [dev|preview]
// Slice 17.7 (D-049), kept, sealed and backed up, on this PC's real secure storage (verify-17-7w.mjs).
// It must be started through tools/guarded-window-copy.mjs. For the built app: node tools/guarded-window-copy.mjs tools/with-build.mjs tools/run177.mjs preview
import { runApp, scratch } from './drive.mjs'

const mode = process.argv[2] ?? 'dev'
const tag = mode === 'preview' ? 'p-' : 'd-'
const run = process.env.FRONTIER_GUARD_ROOT
if (!run || !/^C:\\frontier-tmp\\guarded-w-[^\\]+$/i.test(run)) {
  console.error('run177.mjs must be started as: node tools/guarded-window-copy.mjs tools/run177.mjs (the run needs its own folder in C:\\frontier-tmp)')
  process.exit(2)
}
const result = runApp({
  label: `${tag}w177`,
  mode,
  scripts: 'verify-17-7w.mjs',
  env: { USER_DATA_DIR: scratch('s177'), WIPE_USER_DATA: '1', INSPECT_PORT: '9245', MOCK_PORT: '8835' },
  timeoutMs: 900000
})
console.log(`${result.passed}/${result.total} checks passed`)
for (const f of result.fails) console.log(String(f).trim())
process.exit(result.ok ? 0 : 1)
