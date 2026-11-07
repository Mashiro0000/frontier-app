// usage: node tools/guarded-window-copy.mjs tools/run224.mjs [dev|preview]
// Stage 22.4 (D-054), the look, in the real window against the mock (verify-22-4w.mjs, after setup-key.mjs saves a test key). It must be
// started through tools/guarded-window-copy.mjs. For the built app use tools/with-build.mjs.
import { runApp, scratch } from './drive.mjs'

const mode = process.argv[2] ?? 'dev'
const tag = mode === 'preview' ? 'p-' : 'd-'
const run = process.env.FRONTIER_GUARD_ROOT
if (!run || !/^C:\\frontier-tmp\\guarded-w-[^\\]+$/i.test(run)) {
  console.error('run224.mjs must be started as: node tools/guarded-window-copy.mjs tools/run224.mjs (the run needs its own folder in C:\\frontier-tmp)')
  process.exit(2)
}
const result = runApp({
  label: `${tag}w224`,
  mode,
  scripts: 'setup-key.mjs,verify-22-4w.mjs',
  env: { USER_DATA_DIR: scratch('s224'), WIPE_USER_DATA: '1', MOCK_PORT: '8865' },
  timeoutMs: 600000
})
console.log(`${result.passed}/${result.total} checks passed`)
for (const f of result.fails) console.log(String(f).trim())
process.exit(result.ok ? 0 : 1)
