// usage: node run43.mjs <close>   -- the close-mid-reply scenario: launch 1 (window closed by the script), launch 2 (reopen)
import './temp-on-a.mjs'
import { runApp, scratch } from './drive.mjs'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
rmSync(join(process.env.TEMP ?? '.', 'frontier-4-3b-state.json'), { force: true })
const P = scratch('s4close')
const common = { USER_DATA_DIR: P, MOCK_PORT: '8792', INSPECT_PORT: '9230' }
const a = runApp({ label: (process.env.PFX ?? '') + 'w43b', mode: process.env.MODE ?? 'dev', scripts: 'setup-key.mjs,verify-4-3b.mjs', env: { ...common, WIPE_USER_DATA: '1' }, timeoutMs: 200000 })
const b = runApp({ label: (process.env.PFX ?? '') + 'w43d', mode: process.env.MODE ?? 'dev', scripts: 'verify-4-3d.mjs', env: common, timeoutMs: 200000 })
// launch 1 ENDS with the app quitting by itself (that is the test), which the runner reports as a notice, not a failure
const okA = a.total > 0 && a.passed === a.total && a.fails.every((f) => /^!! the app exited by itself/.test(f))
console.log(`close-mid-reply: launch 1 ${okA ? 'OK' : 'BAD'} (${a.passed}/${a.total}), launch 2 ${b.ok ? 'OK' : 'BAD'} (${b.passed}/${b.total})`)
process.exit(okA && b.ok ? 0 : 1)
