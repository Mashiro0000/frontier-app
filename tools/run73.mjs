// usage: node tools/run73.mjs [mode=dev]
// Stage 7.3 (D-026): Copy, Regenerate and Edit-and-send-again in the real window (verify-7-3w.mjs) on a fresh scratch profile. Like 7.2's
// suite it needs main's inspector (INSPECT_PORT) for the clipboard and puts the clipboard back as it found it. Do not edit src/ while this
// runs: the launch builds from the tree.
import { runApp, scratch } from './drive.mjs'

const mode = process.argv[2] ?? 'dev'
const tag = mode === 'preview' ? 'p-' : 'd-'
const r = runApp({
  label: `${tag}w73`,
  mode,
  scripts: 'verify-7-3w.mjs',
  env: { USER_DATA_DIR: scratch('s73'), WIPE_USER_DATA: '1', MOCK_PORT: '8793', INSPECT_PORT: '9230' },
  timeoutMs: 400000
})
process.exit(r.ok ? 0 : 1)
