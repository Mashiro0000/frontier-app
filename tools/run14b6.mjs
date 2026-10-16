// usage: node tools/guarded-window-copy.mjs tools/run14b6.mjs [mode=dev]
// Slice 14b.6 (D-046): the sign-in of a web connector, in the real window (verify-14b-6w.mjs, a fresh scratch profile; the system's message box and the browser are replaced from the
// main inspector; the provider is the reference one, in the checking process). It must be started through tools/guarded-window-copy.mjs, as run146.mjs is.
import { runApp, scratch } from './drive.mjs'

const mode = process.argv[2] ?? 'dev'
const tag = mode === 'preview' ? 'p-' : 'd-'
const run = process.env.FRONTIER_GUARD_ROOT
if (!run || !/^C:\\frontier-tmp\\guarded-w-[^\\]+$/i.test(run)) {
  console.error('run14b6.mjs must be started as: node tools/guarded-window-copy.mjs tools/run14b6.mjs (the run needs its own folder in C:\\frontier-tmp)')
  process.exit(2)
}
const result = runApp({
  label: `${tag}w14b6`,
  mode,
  scripts: 'setup-key.mjs,verify-14b-6w.mjs',
  env: {
    USER_DATA_DIR: scratch('s14b6'),
    WIPE_USER_DATA: '1',
    INSPECT_PORT: '9237',
    MOCK_PORT: '8813'
  },
  timeoutMs: 900000
})
console.log(`${result.passed}/${result.total} checks passed`)
for (const f of result.fails) console.log(String(f).trim())
process.exit(result.ok ? 0 : 1)
