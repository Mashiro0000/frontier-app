// Slice 4.3, launch 1 of 2 (needs INSPECT_PORT, MOCK_PORT, USER_DATA_DIR, APP_LOG and a saved key from setup-key.mjs):
// the person CLOSES THE WINDOW while a reply is still arriving. What is on disk afterwards? The app quits by itself
// here, so this script ends by looking at the files of a process that is gone. verify-4-3d.mjs reopens them.
import './temp-on-a.mjs'
import { connect, checker, sleep } from './cdp.mjs'
import { assertScratchProfile } from './profile-guard.mjs'
import { h4, mainInspector, waitForExit } from './lib4.mjs'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

const port = Number(process.argv[3] ?? 9222)
const { MOCK_PORT, USER_DATA_DIR: userData, INSPECT_PORT } = process.env
if (!MOCK_PORT || !userData || !INSPECT_PORT) throw new Error('MOCK_PORT, USER_DATA_DIR and INSPECT_PORT must be set')
const check = checker()
const page = await connect(port)
await assertScratchProfile()
const H = h4(page, { userData, mockUrl: `http://127.0.0.1:${MOCK_PORT}` })
const main = await mainInspector(Number(INSPECT_PORT))
await page.waitFor(`!!document.querySelector('.header-select, .app-badge')`, { timeoutMs: 20000 })

// a finished conversation first, so the close happens in the middle of a SECOND exchange in a saved conversation
await H.sendAndWait('before the close')
const done = await H.waitFirst('before the close', (c) => c.messages.length === 2 && c.messages[1].status === 'done')
check('precondition: a first exchange is saved', done.conv.messages.length === 2)

await H.send('[[mock:slow]] interrupted by closing')
await page.waitFor(`document.querySelector('.message-assistant:last-child .bubble')?.textContent.length > 40`, { timeoutMs: 8000 })
await sleep(2300) // two throttled checkpoints go by
const onScreen = await H.screen()
const screenLen = onScreen.at(-1).text.length
const mid = await H.waitConv(done.id, (c) => c.messages.length === 4)
check('while the reply streams, the file already holds the question and a partial reply (status stopped)', mid.messages[2].content.startsWith('[[mock:slow]]') && mid.messages[3].status === 'stopped' && mid.messages[3].content.length > 0, JSON.stringify(mid.messages[3]).slice(0, 80))
const t0 = Date.now()
void main.inMain(`process.mainModule.require('electron').BrowserWindow.getAllWindows()[0].close()`).catch(() => {}) // not awaited: the app ends before it could answer
await sleep(300)
main.close() // Node keeps a process alive while an inspector client is attached ("Waiting for the debugger to disconnect")
const gone = await waitForExit(port)
check('closing the window ends the app (the debug port stops answering)', gone !== null, `${gone} ms`)
await sleep(300)

const after = H.readConv(done.id)
const savedLen = after.messages[3].content.length
check('after the app is gone the file is complete and readable: the first exchange, the question and a partial reply', after.messages.length === 4 && after.messages[0].content === 'before the close' && after.messages[1].status === 'done' && after.messages[2].content === '[[mock:slow]] interrupted by closing', JSON.stringify(after.messages.map((m) => [m.role, m.status, m.content.length])))
check('...the interrupted reply is saved as stopped, never as streaming', after.messages[3].status === 'stopped')
check('...what was saved is a prefix of the reply (nothing garbled)', /^(tick\d+ )+$/.test(after.messages[3].content) && after.messages[3].content.split(' ').filter(Boolean).every((t, i) => t === `tick${i}`), after.messages[3].content.slice(-30))
check('...and it has at least as much as the last checkpoint (the reply had been streaming for 2.3 s)', savedLen >= mid.messages[3].content.length, `${savedLen} vs ${mid.messages[3].content.length}`)
check('...and nothing that was on screen when the window was closed is missing from the file (the page\'s last send, on pagehide, got through; the last once-a-second checkpoint alone would have lost a few ticks)', savedLen >= screenLen, `saved ${savedLen} vs on screen ${screenLen}`)
console.log(`  (info) on screen when the window was closed: ${screenLen} characters; saved: ${savedLen}; lost: ${Math.max(0, screenLen - savedLen)}`)
check('no temp file is left behind', H.strays().length === 0, JSON.stringify(H.files()))
writeFileSync(join(process.env.TEMP ?? '.', 'frontier-4-3b-state.json'), JSON.stringify({ id: done.id, saved: after.messages[3].content, screenLen, savedLen }))
const passed = check.summary()
process.exit(passed ? 0 : 1)
