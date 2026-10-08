// usage: node tools/run111.mjs [mode=dev]
// Slice 11.1 (D-041): the tool registry and the permission core, in the real window (verify-11-1w.mjs, a fresh scratch profile): nothing new is reachable
// from the page, a request carries no tools, a model that asks for a tool gets nothing. Run `npx electron-vite build` first for preview.
// Do not edit src/ while this runs: the launch builds from the tree.
import { runApp, scratch } from './drive.mjs'

const mode = process.argv[2] ?? 'dev'
const tag = mode === 'preview' ? 'p-' : 'd-'
const r = runApp({ label: `${tag}w111`, mode, scripts: 'setup-key.mjs,verify-11-1w.mjs', env: { USER_DATA_DIR: scratch('s111'), WIPE_USER_DATA: '1', INSPECT_PORT: '9230', MOCK_PORT: '8801' }, timeoutMs: 600000 })
console.log(`${r.passed}/${r.total} checks passed`)
for (const f of r.fails) console.log(String(f).trim())
process.exit(r.ok ? 0 : 1)
