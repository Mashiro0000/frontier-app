// usage: node run53.mjs [mode=dev]   -- one launch of the Stage 5.3 window suite (keys per provider, Settings) on its own scratch profile
import { runApp, scratch } from './drive.mjs'
const mode = process.argv[2] ?? 'dev'
const r = runApp({
  label: (mode === 'preview' ? 'p-' : 'd-') + 'w53',
  mode,
  scripts: 'verify-5-3.mjs',
  env: { USER_DATA_DIR: scratch('s53'), WIPE_USER_DATA: '1', MOCK_PORT: '8797', INSPECT_PORT: '9230', MOCK_SCRIPT: 'mock-providers.mjs' },
  timeoutMs: 300000
})
process.exit(r.ok ? 0 : 1)
