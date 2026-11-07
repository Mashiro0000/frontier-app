// usage: node tools/guarded-window-copy.mjs tools/run223.mjs [dev|preview]
// Stage 22.3 (D-054), Image Studio in the real window against the mock (verify-22-3w.mjs), the system's box and save dialog stood in for from main.
// For the built app: node tools/guarded-window-copy.mjs tools/with-build.mjs tools/run223.mjs preview
import { runApp, scratch } from './drive.mjs'

const mode = process.argv[2] ?? 'dev'
const tag = mode === 'preview' ? 'p-' : 'd-'
const run = process.env.FRONTIER_GUARD_ROOT
if (!run || !/^C:\\frontier-tmp\\guarded-w-[^\\]+$/i.test(run)) {
  console.error('run223.mjs must be started as: node tools/guarded-window-copy.mjs tools/run223.mjs (the run needs its own folder in C:\\frontier-tmp)')
  process.exit(2)
}
const result = runApp({
  label: `${tag}w166`,
  mode,
  scripts: 'verify-22-3w.mjs',
  env: { USER_DATA_DIR: scratch('s223'), WIPE_USER_DATA: '1', INSPECT_PORT: '9246', MOCK_PORT: '8862' },
  timeoutMs: 1200000
})
console.log(`${result.passed}/${result.total} checks passed`)
for (const f of result.fails) console.log(String(f).trim())
process.exit(result.ok ? 0 : 1)
