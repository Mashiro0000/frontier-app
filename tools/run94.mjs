// usage: node tools/run94.mjs [mode=dev]
// Slice 9.4 (D-037): what attached files are guessed to cost, in the real window (verify-9-4w.mjs, a fresh scratch profile): the question before a large
// request and a limit's refusal for a chat with a 30-page PDF, and the ledger's guess. Run `npx electron-vite build` first for preview.
// Do not edit src/ while this runs: the launch builds from the tree.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { runApp, scratch } from './drive.mjs'
import { fixture, makePdf } from './lib9.mjs'

const mode = process.argv[2] ?? 'dev'
const tag = mode === 'preview' ? 'p-' : 'd-'
const FILES = scratch('s94-files')
rmSync(FILES, { recursive: true, force: true })
mkdirSync(FILES, { recursive: true })
writeFileSync(join(FILES, 'photo.jpg'), fixture('q.jpg'))
writeFileSync(join(FILES, 'long.pdf'), makePdf(30))
console.log(`made the files in ${FILES}`)

const r = runApp({ label: `${tag}w94`, mode, scripts: 'setup-key.mjs,verify-9-4w.mjs', env: { USER_DATA_DIR: scratch('s94'), WIPE_USER_DATA: '1', FILES_DIR: FILES, INSPECT_PORT: '9231', MOCK_PORT: '8797' }, timeoutMs: 400000 })
console.log(`${r.passed}/${r.total} checks passed`)
for (const f of r.fails) console.log(String(f).trim())
process.exit(r.ok ? 0 : 1)
