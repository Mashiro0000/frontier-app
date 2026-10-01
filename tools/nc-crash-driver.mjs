// Runs nc-crash.mjs in three modes through the real driver and prints what the driver says about each.
import { runApp, scratch } from './drive.mjs'

for (const mode of ['throw', 'close', 'summary-fail']) {
  const r = runApp({ label: `nc-crash-${mode}`, mode: 'dev', scripts: 'nc-crash.mjs', env: { CRASH_MODE: mode, USER_DATA_DIR: scratch('s5nc'), WIPE_USER_DATA: '1' } })
  console.log(`   -> ok=${r.ok} crashes=${r.crashes.length} passed=${r.passed} total=${r.total}`)
}
