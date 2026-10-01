// Safety guard for any test that makes the app WRITE something (a saved key, settings...).
// Call assertScratchProfile() before the first such action. It aborts the whole run unless the app
// has really created its browser profile inside USER_DATA_DIR, i.e. unless --user-data-dir took effect.
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { sleep } from './cdp.mjs'

export async function assertScratchProfile() {
  const dir = process.env.USER_DATA_DIR
  if (!dir) {
    console.error('ABORT: USER_DATA_DIR is not set. This test writes app data and must not run on the real profile.')
    process.exit(3)
  }
  const real = join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'frontier-app').toLowerCase()
  if (dir.replaceAll('\\', '/').toLowerCase() === real.replaceAll('\\', '/')) {
    console.error('ABORT: USER_DATA_DIR is the real profile.')
    process.exit(3)
  }
  for (let i = 0; i < 40; i++) {
    // Chromium creates these in whatever directory it really uses as its profile.
    if (existsSync(join(dir, 'Local State')) || existsSync(join(dir, 'Preferences'))) return
    await sleep(250)
  }
  console.error(`ABORT: the app did not create its profile in ${dir}. --user-data-dir is NOT in effect, so the app is using the real profile. Nothing was written.`)
  process.exit(3)
}
