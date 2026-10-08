// usage: node tools/run114.mjs [mode=dev]
// Slice 11.4 (D-041): the window for tools in the real window (verify-11-4w.mjs, a fresh scratch profile; the system's message box is replaced from the main
// inspector). Run `npx electron-vite build` first for preview.
// Do not edit src/ while this runs: the launch builds from the tree.
import { runApp, scratch } from './drive.mjs'

const mode = process.argv[2] ?? 'dev'
const tag = mode === 'preview' ? 'p-' : 'd-'
const r = runApp({ label: `${tag}w114`, mode, scripts: 'setup-key.mjs,verify-11-4w.mjs', env: { USER_DATA_DIR: scratch('s114'), WIPE_USER_DATA: '1', INSPECT_PORT: '9230', MOCK_PORT: '8804' }, timeoutMs: 600000 })
console.log(`${r.passed}/${r.total} checks passed`)
for (const f of r.fails) console.log(String(f).trim())
process.exit(r.ok ? 0 : 1)
