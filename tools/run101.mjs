// usage: node tools/run101.mjs [mode=dev]
// Slice 10.1 (D-039): the system's question before a change that lets the app spend more, in the real window (verify-10-1w.mjs, a fresh scratch profile with
// NO limits, so the first-run question is asked; the message box is replaced from the main inspector). Run `npx electron-vite build` first for preview.
// The REAL message box is answered once by verify-10-1-real.mjs (see tools/README.md), not here.
// Do not edit src/ while this runs: the launch builds from the tree.
import { runApp, scratch } from './drive.mjs'

const mode = process.argv[2] ?? 'dev'
const tag = mode === 'preview' ? 'p-' : 'd-'
const r = runApp({ label: `${tag}w101`, mode, scripts: 'setup-key.mjs,verify-10-1w.mjs', env: { USER_DATA_DIR: scratch('s101'), WIPE_USER_DATA: '1', PRESEED_LIMITS: 'off', INSPECT_PORT: '9230', MOCK_PORT: '8794' }, timeoutMs: 400000 })
console.log(`${r.passed}/${r.total} checks passed`)
for (const f of r.fails) console.log(String(f).trim())
process.exit(r.ok ? 0 : 1)
