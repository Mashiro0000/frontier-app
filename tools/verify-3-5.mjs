// Slice 3.3: how the app reads a SAVED CHOICE that is stale, corrupt or hostile (one launch per seed file).
// Needs: USER_DATA_DIR (scratch, pre-seeded by the runner via PRESEED_FILE), EXPECT_MODEL, SEED_SHA, WARN_ABOUT ('' for none), APP_LOG.
import './ts-resolve.mjs'
import { connect, checker, sleep } from './cdp.mjs'
import { assertScratchProfile } from './profile-guard.mjs'
import { helpers } from './lib3.mjs'
import { readFileSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'

const port = Number(process.argv[3] ?? 9222)
const userData = process.env.USER_DATA_DIR
const { EXPECT_MODEL: EXPECT, SEED_SHA, WARN_ABOUT = '', SEED_NAME = '?' } = process.env
if (!userData || !EXPECT || !SEED_SHA) throw new Error('USER_DATA_DIR, EXPECT_MODEL and SEED_SHA must be set')
const check = checker()
const page = await connect(port)
await assertScratchProfile()
const H = helpers(page, { userData })
const fileSha = () => createHash('sha256').update(readFileSync(H.prefFile)).digest('hex').slice(0, 16)
const t0 = Date.now()
await page.waitFor(`!!document.querySelector('.header-select')`, { timeoutMs: 15000 })
const shown = Date.now() - t0

check(`[${SEED_NAME}] the seed file really is in place before the app read it`, existsSync(H.prefFile) && fileSha() === SEED_SHA)
let menu = await H.menu()
let status = await H.status()
check(`[${SEED_NAME}] the menu shows ${EXPECT}`, menu.value === EXPECT, menu.value)
check(`[${SEED_NAME}] main reports the same, with no registry error`, status.selectedModelId === EXPECT && status.modelsError === null)
for (let i = 0; i < 4; i++) await H.status() // several reads: a warning must still be logged only once
check(`[${SEED_NAME}] reading it did not rewrite the file: byte-identical to the seed`, fileSha() === SEED_SHA)
check(`[${SEED_NAME}] the window was usable quickly (${shown} ms), whatever the file was`, shown < 12000)

const log = readFileSync(process.env.APP_LOG, 'utf8')
const warnLines = log.split('\n').filter((l) => /is not in the registry any more/.test(l))
if (WARN_ABOUT) {
  check(`[${SEED_NAME}] exactly one warning in the log, naming the missing model`, warnLines.length === 1 && warnLines[0].includes(JSON.stringify(WARN_ABOUT)), JSON.stringify(warnLines))
} else {
  check(`[${SEED_NAME}] no warning in the log (nothing was ever saved, or it was fine)`, warnLines.length === 0, JSON.stringify(warnLines))
}

// Whatever was there, choosing from the menu must replace it with a valid file.
const target = EXPECT === 'claude-sonnet-5-5' ? 'claude-haiku-4-5-20251001' : 'claude-sonnet-5-5'
await H.chooseInPage(target)
await H.settle(target)
check(`[${SEED_NAME}] choosing ${target} from the menu replaces the file with a valid one`, H.prefs() === `{"version":1,"modelId":"${target}"}`, String(H.prefs()).slice(0, 80))
check(`[${SEED_NAME}] ...no temporary file left, no error badge`, H.strayFiles().length === 0 && !(await H.badges()).some((b) => b.alert), JSON.stringify({ stray: H.strayFiles(), badges: await H.badges(), dir: (await import('node:fs')).readdirSync(userData).filter((n) => /prefer/i.test(n)) }))
check(`[${SEED_NAME}] no console errors, warnings or exceptions`, page.problems.length === 0, page.problems.join(' | '))
const passed = check.summary()
page.close()
process.exit(passed ? 0 : 1)
