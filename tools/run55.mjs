// usage: node tools/run55.mjs [mode=dev]   -- one launch of the Stage 5.5 window suite (two providers) on its own scratch profile, no key saved
import { runApp, scratch } from './drive.mjs'

const mode = process.argv[2] ?? 'dev'
const r = runApp({
  label: (mode === 'preview' ? 'p-' : 'd-') + 'w55',
  mode,
  scripts: 'verify-5-5.mjs',
  env: { USER_DATA_DIR: scratch('s55'), WIPE_USER_DATA: '1', MOCK_PORT: '8799' },
  timeoutMs: 300000
})
// the negative controls (nc.mjs) read these two things from the output: the totals line, and the FAIL lines
if (r.total > 0) console.log(`${r.passed}/${r.total} checks passed`)
for (const f of r.fails) console.log(f.trim())
process.exit(r.ok ? 0 : 1)
