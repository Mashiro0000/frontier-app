// usage: node tools/run127.mjs [mode=dev]
// Slice 12.7 (D-042): what a file read costs, in the real window (verify-12-7w.mjs, a fresh scratch profile; the folder dialog and the system's message box are
// replaced from the main inspector). Run `npx electron-vite build` first for preview.
// Do not edit src/ while this runs: the launch builds from the tree.
import { runApp, scratch } from './drive.mjs'

const mode = process.argv[2] ?? 'dev'
const tag = mode === 'preview' ? 'p-' : 'd-'
const r = runApp({ label: `${tag}w127`, mode, scripts: 'setup-key.mjs,verify-12-7w.mjs', env: { USER_DATA_DIR: scratch('s127'), WIPE_USER_DATA: '1', INSPECT_PORT: '9232', MOCK_PORT: '8808' }, timeoutMs: 600000 })
console.log(`${r.passed}/${r.total} checks passed`)
for (const f of r.fails) console.log(String(f).trim())
process.exit(r.ok ? 0 : 1)
