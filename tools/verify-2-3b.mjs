// Slice 2.3, second launch of the same profile: was the key really persisted, and can this new
// process decrypt it? Then clean up (Remove) so nothing is left behind.
import { connect, checker, sleep } from './cdp.mjs'
import { assertScratchProfile } from './profile-guard.mjs'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const port = Number(process.argv[3] ?? 9222)
const userData = process.env.USER_DATA_DIR
if (!userData) throw new Error('USER_DATA_DIR must be set')
const credFile = join(userData, 'credentials.anthropic.json')
const check = checker()

check('the credentials file from the previous launch is still there', existsSync(credFile))
const before = existsSync(credFile) ? readFileSync(credFile, 'utf8') : null

const page = await connect(port)
await assertScratchProfile() // abort before writing anything if the scratch profile is not in use
await page.send('Page.reload')
await sleep(1800)
// (wait for the header to be drawn again: on this PC a reload of the dev page has taken longer than the 1.8 s above, 2026-10-17)
await page.waitFor(`[...document.querySelectorAll('.header-button')].some((b) => b.textContent.trim() === 'Settings')`, { timeoutMs: 20000 })
await page.click('.header-button@Settings')
await page.waitFor(`!!document.querySelector('dialog.settings')?.open`)
const status = await page.evaluate(`document.querySelector('.settings-status').innerText`)
check('a fresh process reads it back: "A key is saved."', status === 'A key is saved.', status)
check('opening Settings did not rewrite the file', existsSync(credFile) && readFileSync(credFile, 'utf8') === before)

await page.evaluate(`[...document.querySelectorAll('.settings button')].find((b) => b.innerText === 'Remove key').click(); 0`)
await page.waitFor(`document.querySelector('.settings-status').innerText === 'No key is saved yet.'`)
check('cleanup: Remove deletes the file', !existsSync(credFile))
check('no console errors, warnings or exceptions', page.problems.length === 0, page.problems.join(' | '))
const passed = check.summary()
page.close()
process.exit(passed ? 0 : 1)
