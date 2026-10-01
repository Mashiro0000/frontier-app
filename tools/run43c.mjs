import { runApp, scratch } from './drive.mjs'
const env = { USER_DATA_DIR: scratch('s4quit'), MOCK_PORT: '8793', INSPECT_PORT: '9231', WIPE_USER_DATA: '1', ...(process.env.SAVES ? { SAVES: process.env.SAVES } : {}) }
const r = runApp({ label: (process.env.PFX ?? '') + 'w43c', mode: process.env.MODE ?? 'dev', scripts: 'verify-4-3c.mjs', env, timeoutMs: 200000 })
process.exit(r.ok ? 0 : 1)
