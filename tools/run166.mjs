// usage: node tools/guarded-window-copy.mjs tools/run166.mjs [dev|preview]
// Slice 16.6 (D-048), the page of image generation in the real window against the mock (verify-16-6w.mjs), the system's box and save dialog stood in for from main.
// For the built app: node tools/guarded-window-copy.mjs tools/with-build.mjs tools/run166.mjs preview
import { runApp, scratch } from './drive.mjs'

const mode = process.argv[2] ?? 'dev'
const tag = mode === 'preview' ? 'p-' : 'd-'
const run = process.env.FRONTIER_GUARD_ROOT
if (!run || !/^C:\\frontier-tmp\\guarded-w-[^\\]+$/i.test(run)) {
  console.error('run166.mjs must be started as: node tools/guarded-window-copy.mjs tools/run166.mjs (the run needs its own folder in C:\\frontier-tmp)')
  process.exit(2)
}
const result = runApp({
  label: `${tag}w166`,
  mode,
  scripts: 'verify-16-6w.mjs',
  env: { USER_DATA_DIR: scratch('s166'), WIPE_USER_DATA: '1', INSPECT_PORT: '9241', MOCK_PORT: '8816' },
  timeoutMs: 1200000
})
console.log(`${result.passed}/${result.total} checks passed`)
for (const f of result.fails) console.log(String(f).trim())
process.exit(result.ok ? 0 : 1)
