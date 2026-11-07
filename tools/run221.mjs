// usage: node tools/guarded-window-copy.mjs tools/run221.mjs [dev|preview]
// Stage 22.1-22.2 (D-054), the Library and Experts, in the real window against the mock (verify-22-1w.mjs, after setup-key.mjs saves a test key). It must be
// started through tools/guarded-window-copy.mjs. For the built app use tools/with-build.mjs.
import { runApp, scratch } from './drive.mjs'

const mode = process.argv[2] ?? 'dev'
const tag = mode === 'preview' ? 'p-' : 'd-'
const run = process.env.FRONTIER_GUARD_ROOT
if (!run || !/^C:\\frontier-tmp\\guarded-w-[^\\]+$/i.test(run)) {
  console.error('run221.mjs must be started as: node tools/guarded-window-copy.mjs tools/run221.mjs (the run needs its own folder in C:\\frontier-tmp)')
  process.exit(2)
}
const result = runApp({
  label: `${tag}w221`,
  mode,
  scripts: 'setup-key.mjs,verify-22-1w.mjs',
  env: { USER_DATA_DIR: scratch('s221'), WIPE_USER_DATA: '1', MOCK_PORT: '8859' },
  timeoutMs: 600000
})
console.log(`${result.passed}/${result.total} checks passed`)
for (const f of result.fails) console.log(String(f).trim())
process.exit(result.ok ? 0 : 1)
