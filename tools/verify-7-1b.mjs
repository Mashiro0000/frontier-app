// Stage 7.1, second launch on the SAME scratch profile that verify-7-1w.mjs left behind (keys saved, Opus chosen, efforts Opus max,
// Sonnet low, Astra xhigh, Luna none): do the choices survive a real restart, does reading them leave the file alone, and does the
// next reply carry them?
// Needs: MOCK_PORT, USER_DATA_DIR, PREFS_SHA and PREFS_MTIME_MS (the file's hash and modification time at the end of launch 1).
import './ts-resolve.mjs'
import { connect, checker, sleep } from './cdp.mjs'
import { assertScratchProfile } from './profile-guard.mjs'
import { helpers } from './lib3.mjs'
import { createHash } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'

const port = Number(process.argv[3] ?? 9222)
const mockUrl = `http://127.0.0.1:${process.env.MOCK_PORT}`
const userData = process.env.USER_DATA_DIR
const { PREFS_SHA } = process.env
const MTIME = Number(process.env.PREFS_MTIME_MS)
if (!process.env.MOCK_PORT || !userData || !PREFS_SHA || !MTIME) throw new Error('MOCK_PORT, USER_DATA_DIR, PREFS_SHA and PREFS_MTIME_MS must be set')
const check = checker()
const page = await connect(port)
await assertScratchProfile()
const H = helpers(page, { userData, mockUrl })
const { ev } = H
const OPUS = 'claude-opus-5-5', SONNET = 'claude-sonnet-5-5', HAIKU = 'claude-haiku-4-5-20251001', ASTRA = 'gpt-6-astra', LUNA = 'gpt-6-luna'
const sha = () => createHash('sha256').update(readFileSync(H.prefFile)).digest('hex').slice(0, 16)
const effortMenu = () => ev(`(() => { const s = document.querySelector('.effort-select'); return s && { values: [...s.options].map((o) => o.value), value: s.value, disabled: s.disabled } })()`)
const effortSent = (req) => (req.provider === 'openai' ? req.body.reasoning?.effort : req.body.output_config?.effort) ?? null
// Everything below runs inside this try, so a wait that times out or a page that goes away ends the run as a FAILED CHECK with a summary
// line, not as a crash (see verify-7-1w.mjs).
try {
await page.waitFor(`!!document.querySelector('.header-select') && !!document.querySelector('.effort-select')`, { timeoutMs: 15000 })
await fetch(`${mockUrl}/__reset`, { method: 'POST' })

const status = await H.status()
check('a new process: the model menu shows Opus, as chosen last time', (await H.menu()).value === OPUS && status.selectedModelId === OPUS)
check('...and the Effort menu shows MAX, the level chosen for Opus last time', (await effortMenu()).value === 'max' && status.effort.selected === 'max' && status.effort.default === 'medium', JSON.stringify(status.effort))
check('starting up and reading the choices did NOT rewrite the file: same bytes and same modification time as at the end of launch 1', sha() === PREFS_SHA && statSync(H.prefFile).mtimeMs === MTIME, `${sha()} vs ${PREFS_SHA}; ${statSync(H.prefFile).mtimeMs} vs ${MTIME}`)
check('the saved API keys survived too', status.providers.every((p) => p.hasKey === true))

const req = (await H.askMock('hello after restart')) ?? { body: {}, problems: ['no request reached the mock'] }
check('the first reply after the restart asks for Max (output_config { effort: "max" }) and the mock accepts it', req.body.model === OPUS && JSON.stringify(req.body.output_config) === '{"effort":"max"}' && req.problems.length === 0, JSON.stringify(req.body.output_config))
check('...and the chat did not touch the file either', sha() === PREFS_SHA && statSync(H.prefFile).mtimeMs === MTIME)

// each model remembers its own level across the restart
await H.chooseInPage(SONNET); await H.settle(SONNET)
check('Sonnet shows Low (its own level)', (await effortMenu()).value === 'low')
await H.chooseInPage(ASTRA); await H.settle(ASTRA)
check('GPT-6 Astra shows Extra high', (await effortMenu()).value === 'xhigh')
await fetch(`${mockUrl}/__reset`, { method: 'POST' })
const rA = (await H.askMock('hello astra after restart')) ?? { provider: null, body: {}, problems: ['no request reached the mock'] }
check('...and its reply asks reasoning { effort: "xhigh" }', rA.provider === 'openai' && effortSent(rA) === 'xhigh' && rA.problems.length === 0)
await H.chooseInPage(LUNA); await H.settle(LUNA)
check('GPT-6 Luna shows None', (await effortMenu()).value === 'none')
await H.chooseInPage(HAIKU); await H.settle(HAIKU)
check('Haiku still has no Effort menu', (await ev(`document.querySelector('.effort-select') === null`)) === true)
const file = JSON.parse(H.prefs())
check('the file still holds every level (choosing models rewrote it, and kept them): Opus max, Sonnet low, Astra xhigh, Luna none; the model is Haiku', file.modelId === HAIKU && file.efforts[OPUS] === 'max' && file.efforts[SONNET] === 'low' && file.efforts[ASTRA] === 'xhigh' && file.efforts[LUNA] === 'none', H.prefs())

// removing a key must not forget the choices (they are separate files)
await H.chooseInPage(OPUS); await H.settle(OPUS)
const text0 = H.prefs()
await page.click('.header-button@Settings')
await page.waitFor(`!!document.querySelector('dialog.settings')?.open`)
await ev(`[...document.querySelectorAll('.settings button')].find((b) => b.innerText === 'Remove key')?.click(); 0`)
await sleep(400)
await page.press('Escape')
await sleep(300)
check('Remove key: the preferences file is untouched and the Effort menu still shows Max', H.prefs() === text0 && (await effortMenu()).value === 'max')
check('no console errors, warnings or exceptions', page.problems.length === 0, page.problems.join(' | '))
} catch (error) {
  check(`the suite ran to its end (it stopped: ${String(error?.message ?? error).slice(0, 220)})`, false)
}
const passed = check.summary()
page.close()
process.exit(passed ? 0 : 1)
