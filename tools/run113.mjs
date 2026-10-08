// usage: node tools/run113.mjs [mode=dev]
// Slice 11.3 (D-041): the provider loop in the real window (verify-11-3w.mjs, a fresh scratch profile; the system's message box is replaced from the main
// inspector). Run `npx electron-vite build` first for preview.
// Do not edit src/ while this runs: the launch builds from the tree.
import { runApp, scratch } from './drive.mjs'

const mode = process.argv[2] ?? 'dev'
const tag = mode === 'preview' ? 'p-' : 'd-'
const r = runApp({ label: `${tag}w113`, mode, scripts: 'setup-key.mjs,verify-11-3w.mjs', env: { USER_DATA_DIR: scratch('s113'), WIPE_USER_DATA: '1', INSPECT_PORT: '9230', MOCK_PORT: '8803' }, timeoutMs: 900000 })
console.log(`${r.passed}/${r.total} checks passed`)
for (const f of r.fails) console.log(String(f).trim())
process.exit(r.ok ? 0 : 1)
