// usage: node tools/guarded-window-copy.mjs tools/run172.mjs [dev|preview]
// Slice 17.2 (D-049), in the real window against the mock (verify-17-2w.mjs): three providers, the Gemini models and their dated prices, a Google model with no key.
// It must be started through tools/guarded-window-copy.mjs. For the built app run `npx electron-vite build` first.
import { runApp, scratch } from './drive.mjs'

const mode = process.argv[2] ?? 'dev'
const tag = mode === 'preview' ? 'p-' : 'd-'
const run = process.env.FRONTIER_GUARD_ROOT
if (!run || !/^C:\\frontier-tmp\\guarded-w-[^\\]+$/i.test(run)) {
  console.error('run172.mjs must be started as: node tools/guarded-window-copy.mjs tools/run172.mjs (the run needs its own folder in C:\\frontier-tmp)')
  process.exit(2)
}
const result = runApp({
  label: `${tag}w172`,
  mode,
  scripts: 'verify-17-2w.mjs',
  env: { USER_DATA_DIR: scratch('s172'), WIPE_USER_DATA: '1', MOCK_PORT: '8830' },
  timeoutMs: 600000
})
console.log(`${result.passed}/${result.total} checks passed`)
for (const f of result.fails) console.log(String(f).trim())
process.exit(result.ok ? 0 : 1)
