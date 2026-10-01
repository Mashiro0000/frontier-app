// Slice 4.3: QUITTING WITH SAVES STILL IN PROGRESS. main.ts holds the quit until every save main has accepted has
// finished (D-016). A backlog is made on purpose: 60 saves of a ~1.5 MB conversation fired at once (the page gets them
// to main faster than main can write them), then the app is told to quit. Afterwards the file must be the LAST save,
// whole, with no leftover temp file. Needs INSPECT_PORT, MOCK_PORT, USER_DATA_DIR.
import { connect, checker, sleep } from './cdp.mjs'
import { assertScratchProfile } from './profile-guard.mjs'
import { h4, mainInspector, waitForExit } from './lib4.mjs'

const port = Number(process.argv[3] ?? 9222)
const { MOCK_PORT, USER_DATA_DIR: userData, INSPECT_PORT } = process.env
const N = Number(process.env.SAVES ?? 30) // 60 sat right at the 5 s grace: it failed on a baseline run before any Stage 5 change
const check = checker()
const page = await connect(port)
await assertScratchProfile()
const H = h4(page, { userData, mockUrl: `http://127.0.0.1:${MOCK_PORT}` })
const main = await mainInspector(Number(INSPECT_PORT))
await page.waitFor(`!!document.querySelector('.header-select, .app-badge')`, { timeoutMs: 20000 })

const id = await H.ev(`crypto.randomUUID()`)
// fire them all, do not wait for any answer; report how many were accepted before the quit (informational)
await H.ev(`(() => {
  const big = 'x'.repeat(370000)
  window.__saves = []
  for (let i = 1; i <= ${N}; i++) {
    window.__saves.push(window.api.history.save({ id: ${JSON.stringify(id)}, messages: [{ role: 'user', content: 'save ' + i, status: 'done' }, { role: 'assistant', content: big, status: 'done' }, { role: 'user', content: big, status: 'done' }, { role: 'assistant', content: big, status: 'done' }] }).then((r) => r.ok, () => false))
  }
  return true
})()`)
await sleep(500) // let them all arrive in main's queue
const t0 = Date.now()
void main.inMain(`process.mainModule.require('electron').app.quit()`).catch(() => {})
await sleep(300)
main.close() // Node keeps a process alive while an inspector client is attached
const gone = await waitForExit(port, 30000)
const quitMs = Date.now() - t0
check('the app quit by itself after being told to', gone !== null, `${quitMs} ms`)
console.log(`  (info) the quit took ${quitMs} ms with ${N} saves of about 1.4 MB queued`)
check('...within the 5 s it is allowed to wait for saves (a stuck disk can never keep the app open)', quitMs < 9000, `${quitMs} ms`)
const files = H.files()
check('exactly one file is left, <id>.json: no temp file, nothing half-written', JSON.stringify(files) === JSON.stringify([`${id}.json`]), JSON.stringify(files))
const conv = H.readConv(id)
check(`the file parses and is the LAST save asked for (title "save ${N}"): every save main had accepted was finished before the app quit`, conv.messages.length === 4 && conv.title === `save ${N}` && conv.messages[1].content.length === 370000 && conv.messages[3].content.length === 370000, `${conv.title}, ${conv.messages.length} messages`)
const passed = check.summary()
process.exit(passed ? 0 : 1)
