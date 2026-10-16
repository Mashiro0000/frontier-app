// usage: node tools/guarded-window-copy.mjs tools/run155.mjs [dev|preview]
// Slice 15.5 (D-047), in the real window against the fake speech endpoint, with Chromium's FAKE microphone (a file with a tone, made in the run's own folder) and the system's message box
// stood in for from the main inspector (verify-15-5w.mjs). It must be started through tools/guarded-window-copy.mjs. For the built app run `npx electron-vite build` first.
import { runApp, scratch } from './drive.mjs'
import { fakeMicrophoneFlags } from './lib15.mjs'

const mode = process.argv[2] ?? 'dev'
const tag = mode === 'preview' ? 'p-' : 'd-'
const run = process.env.FRONTIER_GUARD_ROOT
if (!run || !/^C:\\frontier-tmp\\guarded-w-[^\\]+$/i.test(run)) {
  console.error('run155.mjs must be started as: node tools/guarded-window-copy.mjs tools/run155.mjs (the run needs its own folder in C:\\frontier-tmp)')
  process.exit(2)
}
const FLAGS = fakeMicrophoneFlags(run)
const result = runApp({
  label: `${tag}w155`,
  mode,
  scripts: 'verify-15-5w.mjs',
  env: { USER_DATA_DIR: scratch('s155'), WIPE_USER_DATA: '1', INSPECT_PORT: '9238', MOCK_PORT: '8813', EXTRA_ELECTRON_ARGS: FLAGS },
  timeoutMs: 600000
})
console.log(`${result.passed}/${result.total} checks passed`)
for (const f of result.fails) console.log(String(f).trim())
process.exit(result.ok ? 0 : 1)
