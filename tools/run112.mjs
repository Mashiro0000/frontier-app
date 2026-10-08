// usage: node tools/run112.mjs [mode=dev]
// Slice 11.2 (D-041): the audit log in the real window (verify-11-2w.mjs, a fresh scratch profile; the system's message box and save dialog are replaced
// from the main inspector). Run `npx electron-vite build` first for preview.
// Do not edit src/ while this runs: the launch builds from the tree.
import { mkdirSync, rmSync } from 'node:fs'
import { runApp, scratch } from './drive.mjs'

const mode = process.argv[2] ?? 'dev'
const tag = mode === 'preview' ? 'p-' : 'd-'
const FILES = scratch('s112-files')
rmSync(FILES, { recursive: true, force: true })
mkdirSync(FILES, { recursive: true })
const r = runApp({ label: `${tag}w112`, mode, scripts: 'setup-key.mjs,verify-11-2w.mjs', env: { USER_DATA_DIR: scratch('s112'), WIPE_USER_DATA: '1', FILES_DIR: FILES, INSPECT_PORT: '9230', MOCK_PORT: '8802' }, timeoutMs: 600000 })
console.log(`${r.passed}/${r.total} checks passed`)
for (const f of r.fails) console.log(String(f).trim())
process.exit(r.ok ? 0 : 1)
