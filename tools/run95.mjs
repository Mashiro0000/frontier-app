// usage: node tools/run95.mjs [mode=dev]
// Slice 9.5 (D-037): backups that hold the attached files, in the real window (verify-9-5w.mjs, a fresh scratch profile): back up, delete, restore, the files
// put back and sent again; with encryption on, lost copies put back sealed. Run `npx electron-vite build` first for preview.
// Do not edit src/ while this runs: the launch builds from the tree.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { runApp, scratch } from './drive.mjs'
import { fixture } from './lib9.mjs'

const mode = process.argv[2] ?? 'dev'
const tag = mode === 'preview' ? 'p-' : 'd-'
const FILES = scratch('s95-files')
rmSync(FILES, { recursive: true, force: true })
mkdirSync(join(FILES, 'out'), { recursive: true })
writeFileSync(join(FILES, 'photo.jpg'), fixture('q.jpg'))
writeFileSync(join(FILES, 'report.pdf'), fixture('three-pages.pdf'))
console.log(`made the files in ${FILES}`)

const r = runApp({ label: `${tag}w95`, mode, scripts: 'setup-key.mjs,verify-9-5w.mjs', env: { USER_DATA_DIR: scratch('s95'), WIPE_USER_DATA: '1', FILES_DIR: FILES, INSPECT_PORT: '9231', MOCK_PORT: '8797' }, timeoutMs: 500000 })
console.log(`${r.passed}/${r.total} checks passed`)
for (const f of r.fails) console.log(String(f).trim())
process.exit(r.ok ? 0 : 1)
