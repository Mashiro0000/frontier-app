// usage: node tools/guarded-window-copy.mjs tools/run156.mjs [dev|preview]
// Slice 15.6 (D-047), the page of voice in the real window against the fake speech endpoint, with Chromium's FAKE microphone (a file with a tone, made in the run's own folder) and the
// system's message box stood in for from the main inspector (verify-15-6w.mjs). It must be started through tools/guarded-window-copy.mjs. For the built app run `npx electron-vite build` first.
import { runApp, scratch } from './drive.mjs'
import { fakeMicrophoneFlags } from './lib15.mjs'

const mode = process.argv[2] ?? 'dev'
const tag = mode === 'preview' ? 'p-' : 'd-'
const run = process.env.FRONTIER_GUARD_ROOT
if (!run || !/^C:\\frontier-tmp\\guarded-w-[^\\]+$/i.test(run)) {
  console.error('run156.mjs must be started as: node tools/guarded-window-copy.mjs tools/run156.mjs (the run needs its own folder in C:\\frontier-tmp)')
  process.exit(2)
}
const FLAGS = fakeMicrophoneFlags(run)
const result = runApp({
  label: `${tag}w156`,
  mode,
  scripts: 'verify-15-6w.mjs',
  env: { USER_DATA_DIR: scratch('s156'), WIPE_USER_DATA: '1', INSPECT_PORT: '9239', MOCK_PORT: '8814', EXTRA_ELECTRON_ARGS: FLAGS },
  timeoutMs: 1800000
})
console.log(`${result.passed}/${result.total} checks passed`)
for (const f of result.fails) console.log(String(f).trim())
process.exit(result.ok ? 0 : 1)
