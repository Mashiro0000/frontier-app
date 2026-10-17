// usage: node tools/guarded-window-copy.mjs tools/run173.mjs [dev|preview]
// Slice 17.3 (D-049), the Gemini adapter in the real window against the mock's Gemini stand-in (verify-17-3w.mjs); the system's box answered from the main inspector.
// It must be started through tools/guarded-window-copy.mjs. For the built app: node tools/guarded-window-copy.mjs tools/with-build.mjs tools/run173.mjs preview
import { runApp, scratch } from './drive.mjs'

const mode = process.argv[2] ?? 'dev'
const tag = mode === 'preview' ? 'p-' : 'd-'
const run = process.env.FRONTIER_GUARD_ROOT
if (!run || !/^C:\\frontier-tmp\\guarded-w-[^\\]+$/i.test(run)) {
  console.error('run173.mjs must be started as: node tools/guarded-window-copy.mjs tools/run173.mjs (the run needs its own folder in C:\\frontier-tmp)')
  process.exit(2)
}
const result = runApp({
  label: `${tag}w173`,
  mode,
  scripts: 'verify-17-3w.mjs',
  env: { USER_DATA_DIR: scratch('s173'), WIPE_USER_DATA: '1', INSPECT_PORT: '9241', MOCK_PORT: '8831' },
  timeoutMs: 900000
})
console.log(`${result.passed}/${result.total} checks passed`)
for (const f of result.fails) console.log(String(f).trim())
process.exit(result.ok ? 0 : 1)
