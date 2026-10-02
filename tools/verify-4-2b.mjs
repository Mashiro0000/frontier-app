// Slice 4.2, SECOND launch on the same scratch profile that verify-4-2.mjs left behind (a key saved, three
// conversations saved). Does history survive a real restart, does starting up leave the files alone, and is history
// independent of the API key? Needs: MOCK_PORT, USER_DATA_DIR, APP_LOG.
import './ts-resolve.mjs'
import { connect, checker, sleep } from './cdp.mjs'
import { assertScratchProfile } from './profile-guard.mjs'
import { h4, shown } from './lib4.mjs'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const shots = process.argv[2]
const port = Number(process.argv[3] ?? 9222)
const { MOCK_PORT, USER_DATA_DIR: userData } = process.env
if (!MOCK_PORT || !userData) throw new Error('MOCK_PORT and USER_DATA_DIR must be set')
const state = JSON.parse(readFileSync(join(process.env.TEMP ?? '.', 'frontier-4-2-state.json'), 'utf8'))
const check = checker()
const page = await connect(port)
await assertScratchProfile()
const H = h4(page, { userData, mockUrl: `http://127.0.0.1:${MOCK_PORT}` })
const ev = H.ev
await page.waitFor(`!!document.querySelector('.header-select, .app-badge')`, { timeoutMs: 20000 })
await sleep(800)

// ===================== A. a restart finds everything, and starting up writes nothing =====================
check('the previous launch left three conversation files', state.ids.length === 3 && H.convFiles().length === 3, JSON.stringify(H.files()))
check('starting up changed no file: every one has the same content and modification time as when the last launch ended', state.ids.every((id, i) => H.sha(id) === state.hashes[i] && H.mtime(id) === state.mtimes[i]))
check('...and no stray file appeared (no .tmp, no backup)', H.strays().length === 0, JSON.stringify(H.files()))
check('the app starts on an empty new chat, not on the last conversation', (await H.screen()).length === 0 && /Type a message to start/.test(await H.emptyHint()) && (await H.chatButton('New chat')).disabled)
const list = await ev(`window.api.history.list()`)
check('list(): the same three conversations, newest first', list.conversations.length === 3 && list.unreadable === 0 && JSON.stringify(list.conversations.map((c) => c.id)) === JSON.stringify([...list.conversations].sort((a, b) => b.updatedAt - a.updatedAt).map((c) => c.id)) && state.ids.every((id) => list.conversations.some((c) => c.id === id)), JSON.stringify(list.conversations.map((c) => c.title)))
check('...titles are the ones from before the restart', JSON.stringify(list.conversations.map((c) => c.title).sort()) === JSON.stringify([...state.titles].sort()), JSON.stringify(list.conversations.map((c) => c.title)))
await H.openHistory()
let rows = await H.rows()
check('History shows all three, none of them marked "open now" (nothing is open)', rows.length === 3 && rows.every((r) => !r.current && !/open now/.test(r.meta)), JSON.stringify(rows.map((r) => [r.title, r.current])))
await page.screenshot(`${shots}/4-2b-history.png`)

// ===================== B. open one after a restart =====================
const target = list.conversations.find((c) => c.title === 'short one') ?? list.conversations[0]
const saved = H.readConv(target.id)
await H.clickRow(target.title)
await page.waitFor(`!document.querySelector('dialog.history')?.open`)
await sleep(300)
const screen = await H.screen()
check('opening it shows exactly its saved messages', screen.length === saved.messages.length && screen.every((m, i) => m.role === saved.messages[i].role && m.text === shown(m.role, saved.messages[i].content)), JSON.stringify(screen.map((m) => m.text.slice(0, 20))))
check('...and opening it, in a fresh process, changed nothing on disk', H.sha(target.id) === state.hashes[state.ids.indexOf(target.id)] && H.mtime(target.id) === state.mtimes[state.ids.indexOf(target.id)])
await H.sendAndWait('after the restart')
const cont = await H.waitConv(target.id, (c) => c.messages.length === saved.messages.length + 2 && c.messages.at(-1).status === 'done')
check('continuing it appends to the same file (old messages unchanged, new question and reply added)', JSON.stringify(cont.messages.slice(0, saved.messages.length)) === JSON.stringify(saved.messages) && cont.messages.at(-2).content === 'after the restart' && cont.messages.at(-1).content === 'Echo: after the restart' && cont.createdAt === saved.createdAt)
check('...and the other two conversations are byte-for-byte untouched', state.ids.filter((id) => id !== target.id).every((id) => H.sha(id) === state.hashes[state.ids.indexOf(id)]))

// ===================== C. history does not depend on the API key =====================
await H.clickHeader('Settings')
await page.waitFor(`!!document.querySelector('dialog.settings')?.open`)
await sleep(150)
const removeBtn = await ev(`[...document.querySelectorAll('dialog.settings button')].some((b) => b.textContent === 'Remove key')`)
check('precondition: Settings offers "Remove key" (a key is saved)', removeBtn)
await ev(`[...document.querySelectorAll('dialog.settings button')].find((b) => b.textContent === 'Remove key').setAttribute('data-click', '1')`)
await page.click('dialog.settings button[data-click="1"]')
await page.waitFor(`document.querySelector('dialog.settings .settings-status').innerText === 'No key is saved yet.'`)
await page.press('Escape')
await sleep(300)
const afterRemove = await ev(`window.api.history.list()`)
check('removing the API key leaves every saved conversation in place', afterRemove.conversations.length === 3 && H.convFiles().length === 3)
check('...and the chat on screen is still there and still saved', (await H.screen()).length === cont.messages.length)
await H.openHistory()
rows = await H.rows()
check('...History still lists all three, with the open one marked', rows.length === 3 && rows.filter((r) => r.current).length === 1, JSON.stringify(rows.map((r) => [r.title, r.current])))
await H.closeHistory()

// ===================== D. nothing leaked =====================
const appLog = readFileSync(process.env.APP_LOG, 'utf8')
check('the app logged no history problems on this launch either', !/saved conversation|could not be saved|conversation.*could not be read/i.test(appLog), appLog.split('\n').filter((l) => /conversation/i.test(l)).join(' | '))
check('no console errors, warnings or exceptions in the page', page.problems.length === 0, page.problems.join(' | '))
const passed = check.summary()
page.close()
process.exit(passed ? 0 : 1)
