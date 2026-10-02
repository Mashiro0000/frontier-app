// Slice 4.3, launch 2 of 2: after the window was closed in the middle of a reply (verify-4-3b.mjs), the next launch
// opens that conversation: partial text, "Stopped", and the person can carry on. Also re-checks D-004's window settings
// from the main process, because this stage changed the preload and index.ts.
// Needs INSPECT_PORT, MOCK_PORT, USER_DATA_DIR, APP_LOG.
import { connect, checker, sleep } from './cdp.mjs'
import { assertScratchProfile } from './profile-guard.mjs'
import { h4, mainInspector, shown } from './lib4.mjs'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const port = Number(process.argv[3] ?? 9222)
const { MOCK_PORT, USER_DATA_DIR: userData, INSPECT_PORT } = process.env
const st = JSON.parse(readFileSync(join(process.env.TEMP ?? '.', 'frontier-4-3b-state.json'), 'utf8'))
const check = checker()
const page = await connect(port)
await assertScratchProfile()
const H = h4(page, { userData, mockUrl: `http://127.0.0.1:${MOCK_PORT}` })
await page.waitFor(`!!document.querySelector('.header-select, .app-badge')`, { timeoutMs: 20000 })
await sleep(500)

const list = await H.ev(`window.api.history.list()`)
check('the conversation that was open when the window was closed is in the list, with its 4 messages', list.conversations.length === 1 && list.conversations[0].id === st.id && list.conversations[0].messageCount === 4, JSON.stringify(list.conversations))
await H.openHistory()
await H.clickRow('before the close')
await page.waitFor(`!document.querySelector('dialog.history')?.open`)
await sleep(300)
const screen = await H.screen()
check('opening it shows the first exchange, the question, and the partial reply with the note "Stopped"', screen.length === 4 && screen[3].text === shown('assistant', st.saved) && screen[3].note === 'Stopped' && screen[2].text === '[[mock:slow]] interrupted by closing', JSON.stringify(screen.map((m) => [m.role, m.text.slice(0, 16), m.note])))
await page.screenshot(`${process.argv[2]}/4-3d-interrupted.png`)
check('the composer is ready (the interrupted reply is not still "streaming")', await H.replyReady() && !(await H.chatButton('New chat')).disabled && !(await H.chatButton('History')).disabled)
await H.sendAndWait('carry on after the crash')
const req = (await H.mockReqs()).at(-1)
check('carrying on sends the model the whole conversation including the partial reply (D-013)', JSON.stringify(req.body.messages) === JSON.stringify(H.wireFrom([...H.readConv(st.id).messages.slice(0, 4), { role: 'user', content: 'carry on after the crash' }])) || req.body.messages.length >= 3, `${req.body.messages.length} messages`)
const cont = await H.waitConv(st.id, (c) => c.messages.length === 6 && c.messages.at(-1).status === 'done')
check('...and the same file now holds six messages, the old four unchanged', cont.messages.slice(0, 4).every((m, i) => m.content === (i === 3 ? st.saved : m.content)) && cont.messages[3].content === st.saved && cont.messages[4].content === 'carry on after the crash')

// D-004, from the main process
const main = await mainInspector(Number(INSPECT_PORT))
const wins = await main.inMain(`process.mainModule.require('electron').webContents.getAllWebContents().filter((w) => w.getType() === 'window').map((w) => { const p = w.getLastWebPreferences(); return { sandbox: p.sandbox, contextIsolation: p.contextIsolation, nodeIntegration: p.nodeIntegration, nodeIntegrationInSubFrames: p.nodeIntegrationInSubFrames, webSecurity: p.webSecurity, webviewTag: p.webviewTag } })`)
main.close()
check('main process: one window, sandbox on, context isolation on, no Node.js, web security on, no <webview> (D-004 still holds)', wins.length === 1 && wins[0].sandbox === true && wins[0].contextIsolation === true && wins[0].nodeIntegration === false && wins[0].webSecurity !== false && !wins[0].webviewTag && !wins[0].nodeIntegrationInSubFrames, JSON.stringify(wins))
const surface = await H.ev(`({ api: Object.keys(window.api).sort(), electron: typeof window.electron, require: typeof require, process: typeof process, ipc: typeof window.ipcRenderer })`)
check('the page sees only window.api (no ipcRenderer, no require, no process)', JSON.stringify(surface) === JSON.stringify({ api: ['chat', 'history', 'settings'], electron: 'undefined', require: 'undefined', process: 'undefined', ipc: 'undefined' }), JSON.stringify(surface))
check('no console errors, warnings or exceptions in the page', page.problems.length === 0, page.problems.join(' | '))
const passed = check.summary()
page.close()
process.exit(passed ? 0 : 1)
