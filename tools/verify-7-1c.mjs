// Stage 7.1: how the app reads a SAVED EFFORT that is stale, damaged or hostile (one launch per seed file, make-seeds-71.mjs).
// Needs: MOCK_PORT, USER_DATA_DIR (scratch, pre-seeded by the runner via PRESEED_FILE), SEED_NAME, SEED_SHA, EXPECT_MODEL,
// EXPECT_EFFORT ('null': the Effort menu must be absent), WARN_LEVEL ('' for no warning), SAVED_MODEL (the model the seed saved and that
// must still be saved after a choice, '' for none), KEYS_AFTER (JSON: the model ids that must be in `efforts` after a choice), APP_LOG.
import './ts-resolve.mjs'
import { connect, checker, sleep } from './cdp.mjs'
import { assertScratchProfile } from './profile-guard.mjs'
import { helpers } from './lib3.mjs'
import { randomBytes, createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'

const port = Number(process.argv[3] ?? 9222)
const mockUrl = `http://127.0.0.1:${process.env.MOCK_PORT}`
const userData = process.env.USER_DATA_DIR
const { EXPECT_MODEL, EXPECT_EFFORT, SEED_SHA, WARN_LEVEL = '', SEED_NAME = '?', SAVED_MODEL = '' } = process.env
const KEYS_AFTER = JSON.parse(process.env.KEYS_AFTER ?? 'null') ?? []
if (!process.env.MOCK_PORT || !userData || !EXPECT_MODEL || !EXPECT_EFFORT || !SEED_SHA) throw new Error('MOCK_PORT, USER_DATA_DIR, EXPECT_MODEL, EXPECT_EFFORT and SEED_SHA must be set')
const check = checker()
const page = await connect(port)
await assertScratchProfile()
const H = helpers(page, { userData, mockUrl })
const { ev } = H
const T = `[${SEED_NAME}]`
const fileSha = () => createHash('sha256').update(readFileSync(H.prefFile)).digest('hex').slice(0, 16)
const wantEffort = EXPECT_EFFORT === 'null' ? null : EXPECT_EFFORT
const t0 = Date.now()
// Everything below runs inside this try, so a wait that times out or a page that goes away ends the run as a FAILED CHECK with a summary
// line, not as a crash (see verify-7-1w.mjs).
try {
await page.waitFor(`!!document.querySelector('.header-select')`, { timeoutMs: 15000 })
const shown = Date.now() - t0
await fetch(`${mockUrl}/__reset`, { method: 'POST' })

check(`${T} the seed file really is in place before the app read it`, existsSync(H.prefFile) && fileSha() === SEED_SHA)
let status = await H.status()
check(`${T} the model menu shows ${EXPECT_MODEL}, with no registry error`, (await H.menu()).value === EXPECT_MODEL && status.selectedModelId === EXPECT_MODEL && status.modelsError === null, (await H.menu()).value)
if (wantEffort === null) {
  check(`${T} the model takes no effort: main says null and the Effort menu is not in the page`, status.effort === null && (await ev(`document.querySelector('.effort-select') === null`)) === true, JSON.stringify(status.effort))
} else {
  check(`${T} the Effort menu shows ${wantEffort}, and main says the same`, status.effort?.selected === wantEffort && (await ev(`document.querySelector('.effort-select')?.value`)) === wantEffort, JSON.stringify(status.effort))
}
for (let i = 0; i < 4; i++) await H.status() // several reads: a warning must still be logged only once
check(`${T} reading it did not rewrite the file: byte-identical to the seed`, fileSha() === SEED_SHA)
check(`${T} the window was usable quickly (${shown} ms), whatever the file was`, shown < 12000)
const log = readFileSync(process.env.APP_LOG, 'utf8')
const warnLines = log.split('\n').filter((l) => /saved effort level/.test(l))
if (WARN_LEVEL) check(`${T} exactly one warning in the log, naming the level that is not offered`, warnLines.length === 1 && warnLines[0].includes(JSON.stringify(WARN_LEVEL)), JSON.stringify(warnLines))
else check(`${T} no warning about effort in the log`, warnLines.length === 0, JSON.stringify(warnLines))

// the next reply asks what the app decided (a key is invented and saved: that writes credentials.json, not preferences.json)
const provider = EXPECT_MODEL.startsWith('gpt-') ? 'openai' : 'anthropic'
await ev(`window.api.settings.setApiKey(${JSON.stringify(provider)}, ${JSON.stringify('test-' + randomBytes(24).toString('hex'))}).then((r) => r.ok)`)
const req = await H.askMock('hello seeded')
const sent = (req?.provider === 'openai' ? req.body.reasoning?.effort : req?.body.output_config?.effort) ?? null
check(`${T} the reply asks ${wantEffort === null ? 'for no effort at all' : `for ${wantEffort}`}, and the strict mock accepts it`, req && sent === wantEffort && req.problems.length === 0, JSON.stringify({ sent, problems: req?.problems }))
check(`${T} the chat did not rewrite the file either`, fileSha() === SEED_SHA)

// whatever was there, choosing replaces it with a valid file that holds only usable entries
if (wantEffort !== null) {
  const next = status.effort.levels.find((l) => l !== wantEffort)
  await ev(`(() => { const s = document.querySelector('.effort-select'); s.value = ${JSON.stringify(next)}; s.dispatchEvent(new Event('change', { bubbles: true })) })()`)
  const t1 = Date.now()
  while (Date.now() - t1 < 6000 && (await H.status()).effort?.selected !== next) await sleep(50)
  const file = JSON.parse(H.prefs())
  const levels = ['none', 'low', 'medium', 'high', 'xhigh', 'max']
  check(`${T} choosing ${next} replaces the file with a valid one: version 1, this model at ${next}, and only usable entries`, file.version === 1 && file.efforts[EXPECT_MODEL] === next && Object.values(file.efforts).every((l) => levels.includes(l)) && Object.keys(file).every((k) => ['version', 'modelId', 'efforts'].includes(k)), H.prefs().slice(0, 200))
  const keys = Object.keys(file.efforts).sort().join()
  check(`${T} ...and exactly the entries that were usable are in it (${KEYS_AFTER.length}): the damaged ones are gone, nothing is invented`, keys === [...KEYS_AFTER].sort().join(), `${Object.keys(file.efforts).length} keys: ${keys.slice(0, 160)}`)
  check(`${T} ...the saved model is ${SAVED_MODEL ? 'kept: ' + SAVED_MODEL : 'still none (the seed saved no usable one)'}, and no "__proto__" key is written back`, (file.modelId ?? null) === (SAVED_MODEL || null) && !Object.prototype.hasOwnProperty.call(file.efforts, '__proto__'), H.prefs().slice(0, 120))
  check(`${T} ...no temporary file left, no error badge`, H.strayFiles().length === 0 && !(await H.badges()).some((b) => b.alert), JSON.stringify({ stray: H.strayFiles(), badges: await H.badges() }))
}
check(`${T} no console errors, warnings or exceptions`, page.problems.length === 0, page.problems.join(' | '))
} catch (error) {
  check(`${T} the suite ran to its end (it stopped: ${String(error?.message ?? error).slice(0, 220)})`, false)
}
const passed = check.summary()
page.close()
process.exit(passed ? 0 : 1)
