// usage: node tools/run106.mjs [mode=dev]
// Slice 10.6 (D-039): a project's parts in every request of its chats, in the real window (verify-10-6w.mjs).
// The system's box and open dialog are replaced from the main inspector. Run `npx electron-vite build` first for preview.
// Do not edit src/ while this runs: the launch builds from the tree.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { runApp, scratch } from './drive.mjs'
import { fixture } from './lib9.mjs'

const mode = process.argv[2] ?? 'dev'
const tag = mode === 'preview' ? 'p-' : 'd-'
const FILES = scratch('s106-files')
rmSync(FILES, { recursive: true, force: true })
mkdirSync(FILES, { recursive: true })
writeFileSync(join(FILES, 'report.pdf'), fixture('three-pages.pdf'))
writeFileSync(join(FILES, 'photo.jpg'), fixture('q.jpg'))
writeFileSync(join(FILES, 'notes.txt'), 'Chapter notes\n'.repeat(40))
const r = runApp({ label: `${tag}w106`, mode, scripts: 'setup-key.mjs,verify-10-6w.mjs', env: { USER_DATA_DIR: scratch('s106'), WIPE_USER_DATA: '1', FILES_DIR: FILES, INSPECT_PORT: '9230', MOCK_PORT: '8799' }, timeoutMs: 600000 })
console.log(`${r.passed}/${r.total} checks passed`)
for (const f of r.fails) console.log(String(f).trim())
process.exit(r.ok ? 0 : 1)
