// Slice 3.3, second launch on the SAME scratch profile that verify-3-4.mjs left behind (key saved, Fable chosen; Haiku until D-036):
// does the choice survive a real restart, does reading it leave the file alone, and does removing the key forget it?
// Needs: MOCK_PORT, USER_DATA_DIR, EXPECT_MODEL (the id chosen last time), PREFS_MTIME_MS (the file's mtime after launch 1).
import './ts-resolve.mjs'
import { connect, checker, sleep } from './cdp.mjs'
import { assertScratchProfile } from './profile-guard.mjs'
import { helpers, readRegistry } from './lib3.mjs'
import { statSync } from 'node:fs'

const port = Number(process.argv[3] ?? 9222)
const mockUrl = `http://127.0.0.1:${process.env.MOCK_PORT}`
const userData = process.env.USER_DATA_DIR
const EXPECT = process.env.EXPECT_MODEL
const MTIME = Number(process.env.PREFS_MTIME_MS)
if (!process.env.MOCK_PORT || !userData || !EXPECT || !MTIME) throw new Error('MOCK_PORT, USER_DATA_DIR, EXPECT_MODEL and PREFS_MTIME_MS must be set')
const check = checker()
const page = await connect(port)
await assertScratchProfile()
const H = helpers(page, { userData, mockUrl })
const { ev } = H
await page.waitFor(`!!document.querySelector('.header-select')`, { timeoutMs: 10000 })
await fetch(`${mockUrl}/__reset`, { method: 'POST' })

const text0 = H.prefs()
const menu = await H.menu()
const status = await H.status()
check('a new process: the menu shows the model chosen in the previous run', menu.value === EXPECT, JSON.stringify([menu.value, EXPECT]))
check('...main reports it as selected, and the registry list is complete', status.selectedModelId === EXPECT && status.models.length === readRegistry().models.length)
check('...the file holds exactly what the first run saved', text0 === `{"version":1,"modelId":"${EXPECT}"}`, text0)
check('starting up and reading the choice did NOT rewrite the file (same modification time as at the end of run 1)', statSync(H.prefFile).mtimeMs === MTIME, `${statSync(H.prefFile).mtimeMs} vs ${MTIME}`)
check('the saved API key survived too, and the choice is independent of it', status.providers[0].hasKey === true)

// the saved choice is what the next message uses
await H.sendAndWait('hello again')
const req = (await H.mockReqs()).at(-1)
check('the next chat message is sent to that model', req?.body.model === EXPECT && req.problems.length === 0, JSON.stringify([req?.body.model, req?.problems]))
check('...and it came back as a normal reply', (await H.bubbleText()) === 'Echo: hello again')
check('the chat did not touch the file either', statSync(H.prefFile).mtimeMs === MTIME)

// removing the key must not forget the model (they are separate files)
await page.click('.header-button@Settings')
await page.waitFor(`!!document.querySelector('dialog.settings')?.open`)
await ev(`[...document.querySelectorAll('.settings button')].find((b) => b.innerText === 'Remove key').click(); 0`)
await page.waitFor(`document.querySelector('.settings-status').innerText === 'No key is saved yet.'`)
await page.press('Escape')
await sleep(300)
check('Remove key: the preferences file is untouched and the menu still shows the model', H.prefs() === text0 && (await H.menu()).value === EXPECT && statSync(H.prefFile).mtimeMs === MTIME)
check('...and the warning badge is back, beside the model menu', JSON.stringify((await H.badges()).map((b) => b.text)) === '["No API key"]')
const afterRemove = await H.status()
check('...the status says no key but still the same model', afterRemove.providers[0].hasKey === false && afterRemove.selectedModelId === EXPECT)
await H.sendAndWait('no key now')
check('with no key, a message is explained and no request is made, whatever the model', (await H.noteText()) === 'No API key is saved yet. Open Settings and add your Anthropic API key.' && (await H.mockReqs()).length === 1)

check('no console errors, warnings or exceptions', page.problems.length === 0, page.problems.join(' | '))
const passed = check.summary()
page.close()
process.exit(passed ? 0 : 1)
