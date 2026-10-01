// usage: node run4.mjs <label> <scripts> [wipe=1] [mock=1] [mode=dev]   -- one launch on the shared Stage 4 scratch profile
import { runApp, scratch } from './drive.mjs'
const [label, scripts, wipe = '1', mock = '1', mode = 'dev'] = process.argv.slice(2)
const env = { USER_DATA_DIR: scratch('s4main'), ...(wipe === '1' ? { WIPE_USER_DATA: '1' } : {}), ...(mock === '1' ? { MOCK_PORT: '8791' } : {}) }
const r = runApp({ label, mode, scripts, env })
process.exit(r.ok ? 0 : 1)
