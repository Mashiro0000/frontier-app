// usage: node tools/run72.mjs [mode=dev]
// Stage 7.2 (D-025): the Markdown reply in the real window (verify-7-2w.mjs) on a fresh scratch profile. The suite replaces main's
// shell.openExternal with a recorder, so the real browser is never opened, and puts the clipboard back as it found it. It needs the
// main process's inspector (INSPECT_PORT). Do not edit src/ while this runs: the launch builds from the tree.
import { runApp, scratch } from './drive.mjs'

const mode = process.argv[2] ?? 'dev'
const tag = mode === 'preview' ? 'p-' : 'd-'
const r = runApp({
  label: `${tag}w72`,
  mode,
  scripts: 'verify-7-2w.mjs',
  env: { USER_DATA_DIR: scratch('s72'), WIPE_USER_DATA: '1', MOCK_PORT: '8792', INSPECT_PORT: '9230' },
  timeoutMs: 400000
})
process.exit(r.ok ? 0 : 1)
