import { runApp, scratch } from './drive.mjs'
const r = runApp({ label: (process.env.PFX ?? '') + 'w45', mode: process.env.MODE ?? 'dev', scripts: 'setup-key.mjs,verify-4-5.mjs', env: { USER_DATA_DIR: scratch('s4fail'), WIPE_USER_DATA: '1', MOCK_PORT: '8796', INSPECT_PORT: '9234' }, timeoutMs: 250000 })
process.exit(r.ok ? 0 : 1)
