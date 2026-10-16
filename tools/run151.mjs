// usage: node tools/guarded-window-copy.mjs tools/run151.mjs [mode=dev]
// Slice 15.1 (D-047), the probe: the real window with Chromium's FAKE microphone (a file of a tone that plays in a loop; no real microphone is opened) and the voices of this PC.
// It must be started through tools/guarded-window-copy.mjs (the run needs its own folder in C:\frontier-tmp, where the tone file is made).
import { runApp, scratch } from './drive.mjs'
import { fakeMicrophoneFlags } from './lib15.mjs'

const mode = process.argv[2] ?? 'dev'
const tag = mode === 'preview' ? 'p-' : 'd-'
const run = process.env.FRONTIER_GUARD_ROOT
if (!run || !/^C:\\frontier-tmp\\guarded-w-[^\\]+$/i.test(run)) {
  console.error('run151.mjs must be started as: node tools/guarded-window-copy.mjs tools/run151.mjs (the run needs its own folder in C:\\frontier-tmp)')
  process.exit(2)
}

const HZ = 440
const FLAGS = fakeMicrophoneFlags(run, HZ)

const result = runApp({
  label: `${tag}w151`,
  mode,
  scripts: 'probe-15-1.mjs',
  env: {
    USER_DATA_DIR: scratch('s151'),
    WIPE_USER_DATA: '1',
    INSPECT_PORT: '9237',
    FAKE_TONE_HZ: String(HZ),
    EXTRA_ELECTRON_ARGS: FLAGS
  },
  timeoutMs: 300000
})
console.log(`${result.passed}/${result.total} checks passed`)
for (const f of result.fails) console.log(String(f).trim())
process.exit(result.ok ? 0 : 1)
