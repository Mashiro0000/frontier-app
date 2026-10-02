// Slices 4.2 + 4.3 in the real window: saving conversations, the New chat button, the History dialog, and what the
// page must not be able to do. FIRST launch on a fresh scratch profile (setup-key.mjs runs before this and saves an
// invented key). Needs: MOCK_PORT, USER_DATA_DIR (a scratch profile inside the real %APPDATA%, to exercise EFS), APP_LOG.
// It leaves two saved conversations behind for verify-4-2b.mjs (second launch).
import './ts-resolve.mjs'
import { connect, checker, sleep } from './cdp.mjs'
import { assertScratchProfile } from './profile-guard.mjs'
import { h4, UUID_FILE } from './lib4.mjs'
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const shots = process.argv[2]
const port = Number(process.argv[3] ?? 9222)
const { MOCK_PORT, USER_DATA_DIR: userData } = process.env
if (!MOCK_PORT || !userData) throw new Error('MOCK_PORT and USER_DATA_DIR must be set')
const mockUrl = `http://127.0.0.1:${MOCK_PORT}`
const check = checker()
const page = await connect(port)
await assertScratchProfile()
const H = h4(page, { userData, mockUrl })
const ev = H.ev
const resetMock = () => fetch(`${mockUrl}/__reset`, { method: 'POST' })
await page.send('Page.reload')
await sleep(1800)
const folder = join(userData, 'conversations')
const samePath = (a, b) => String(a).replaceAll('\\', '/').toLowerCase() === String(b).replaceAll('\\', '/').toLowerCase()

// ===================== A. a fresh start writes nothing =====================
check('a fresh profile has no conversations folder (starting up and looking wrote nothing)', H.files() === null, JSON.stringify(H.files()))
const buttons = await H.headerButtons()
check('the header has New chat, History, Instructions (7.4) and Settings, in that order', JSON.stringify(buttons.map((b) => b.text)) === JSON.stringify(['New chat', 'History', 'Instructions', 'Settings']), JSON.stringify(buttons.map((b) => b.text)))
check('New chat is disabled while the chat is empty, and says why', buttons[0].disabled && /empty/i.test(buttons[0].title), buttons[0].title)
check('History and Settings are enabled', !buttons[1].disabled && !buttons[2].disabled)
const api = await ev(`({ top: Object.keys(window.api).sort(), history: Object.keys(window.api.history ?? {}).sort(), settings: Object.keys(window.api.settings).sort(), chat: Object.keys(window.api.chat).sort() })`)
check('window.api gained exactly `history` { list, load, remove, save }; nothing else changed', JSON.stringify(api) === JSON.stringify({ top: ['chat', 'history', 'settings'], history: ['list', 'load', 'remove', 'save'], settings: ['clearApiKey', 'getStatus', 'setApiKey', 'setEffort', 'setModel', 'testApiKey'], chat: ['cancel', 'onEvent', 'start'] }), JSON.stringify(api))
const list0 = await ev(`window.api.history.list()`)
check('list() on a fresh profile: no conversations, none unreadable, and it names the folder', list0.conversations.length === 0 && list0.unreadable === 0 && samePath(list0.folder, folder), JSON.stringify(list0))
check('...and asking did not create the folder', H.files() === null)
check('no empty-conversation file is written by opening the app, however long it sits', (await sleep(1500), H.files() === null))

await H.openHistory()
let text = await H.historyText()
check('History on a fresh profile says nothing is saved yet', /Nothing is saved yet/.test(text), text.slice(0, 120))
check('...and tells the person where the files are and that the app does not encrypt them', text.includes(list0.folder) && /plain files/.test(text) && /does not encrypt/.test(text), text.slice(-260))
await page.screenshot(`${shots}/4-2-history-empty.png`)
await H.closeHistory()
check('Escape closes it and focus goes back to the History button', !(await H.historyOpen()) && (await H.focusedText()) === 'History', await H.focusedText())

// ===================== B. a first conversation is saved =====================
await resetMock()
await H.sendAndWait('first question')
const first = await H.waitFirst('first question', (c) => c.messages.length === 2 && c.messages[1].status === 'done')
await sleep(500) // a save copies the file over and THEN deletes its .tmp: look after that, not between the two
check('after the first reply there is exactly one file, <uuid>.json, and no leftover temp file', H.convFiles().length === 1 && H.strays().length === 0, JSON.stringify(H.files()))
check('it is the documented shape: version 3, id equal to the file name, title, dates, instructions (none), messages', first.conv.version === 3 && first.conv.instructions === '' && first.conv.id === first.id && first.conv.title === 'first question' && Number.isSafeInteger(first.conv.createdAt) && first.conv.updatedAt >= first.conv.createdAt, JSON.stringify(Object.keys(first.conv)))
check('the messages are the ones on screen: the question and "Echo: first question", both done, the reply naming the model that answered (D-021)', JSON.stringify(first.conv.messages) === JSON.stringify([{ role: 'user', content: 'first question', status: 'done' }, { role: 'assistant', content: 'Echo: first question', status: 'done', provider: 'anthropic', model: 'claude-opus-5-5' }]), JSON.stringify(first.conv.messages))
check('...and what is on screen equals what is saved', JSON.stringify((await H.screen()).map((m) => [m.role, m.text])) === JSON.stringify(first.conv.messages.map((m) => [m.role, m.content])))
const FIRST = first.id
const listB = await ev(`window.api.history.list()`)
check('list(): one conversation with the same title and 2 messages', listB.conversations.length === 1 && listB.conversations[0].id === FIRST && listB.conversations[0].title === 'first question' && listB.conversations[0].messageCount === 2, JSON.stringify(listB.conversations))
check('New chat is enabled now', !(await H.headerButton('New chat')).disabled)
await H.openHistory()
let rows = await H.rows()
check('History shows that conversation: its title, "2 messages", marked as the one open now', rows.length === 1 && rows[0].title === 'first question' && /2 messages/.test(rows[0].meta) && /open now/.test(rows[0].meta) && rows[0].current, JSON.stringify(rows))
await page.screenshot(`${shots}/4-2-history-one.png`)
await H.closeHistory()

// ===================== C. while a reply streams, it is saved about once a second =====================
await resetMock()
const seen = []
let torn = 0
const t0 = Date.now()
await H.send('[[mock:slow]] second')
while (Date.now() - t0 < 3600) {
  try {
    const c = H.readConv(FIRST)
    const last = c.messages.at(-1)
    seen.push({ t: Date.now() - t0, count: c.messages.length, status: last.status, len: last.content.length, updatedAt: c.updatedAt })
  } catch { torn++ } // a read that landed in the middle of the app's own copy; the app itself never reads then
  await sleep(40)
}
const statuses = [...new Set(seen.map((s) => s.status))]
const lens = [...new Set(seen.filter((s) => s.count === 4).map((s) => s.len))].sort((a, b) => a - b)
const writes = new Set(seen.map((s) => s.updatedAt)).size
const firstWithQuestion = seen.find((s) => s.count === 4)
check('the question was saved straight away, not after the reply (within 700 ms of pressing Enter)', !!firstWithQuestion && firstWithQuestion.t < 700, JSON.stringify(firstWithQuestion))
check('a file is never saved with the status "streaming" (it is stopped, because a cut-off reply never finishes)', !statuses.includes('streaming') && statuses.every((s) => ['done', 'stopped'].includes(s)), JSON.stringify(statuses))
check('the partial reply grows in the file while it streams (at least 3 different lengths seen)', lens.length >= 3, JSON.stringify(lens))
check('...but it is not rewritten for every piece: about once a second (between 2 and 6 writes in 3.6 s)', writes >= 2 && writes <= 6, `${writes} distinct updatedAt values (${seen.length} samples, ${torn} torn reads)`)
check('the folder still holds just the one file (no .tmp piling up)', H.strays().length <= 1 && H.convFiles().length === 1, JSON.stringify(H.files()))
await page.click('.composer-button')
await H.waitReady()
await sleep(300)
const afterStop = await H.waitConv(FIRST, (c) => c.messages.length === 4 && c.messages[3].status === 'stopped')
const lastScreen = (await H.screen()).at(-1)
check('Stop: the file ends with the partial reply and the status "stopped"', afterStop.messages.length === 4 && afterStop.messages[3].status === 'stopped' && afterStop.messages[3].content.startsWith('tick0 '), JSON.stringify(afterStop.messages[3]).slice(0, 100))
check('...exactly the text that is on screen, which says "Stopped"', afterStop.messages[3].content === lastScreen.text && lastScreen.note === 'Stopped', JSON.stringify(lastScreen).slice(0, 100))
check('...and no temp file is left', H.strays().length === 0, JSON.stringify(H.files()))

// ===================== D. what the person sent is saved even if the reply never comes =====================
await resetMock()
await H.send('[[mock:hang-before]] hold on')
await page.waitFor(`!!document.querySelector('.typing')`)
await sleep(500)
const held = await H.waitConv(FIRST, (c) => c.messages.length === 6)
check('the mock never answers: the file still has the new question, then an empty reply saved as stopped', held.messages.length === 6 && held.messages[4].content === '[[mock:hang-before]] hold on' && held.messages[5].content === '' && held.messages[5].status === 'stopped', JSON.stringify(held.messages.slice(4)))
check('...saved within about half a second of sending (the typing dots are still showing)', await ev(`!!document.querySelector('.typing')`))
await page.click('.composer-button')
await H.waitReady()
await sleep(300)

// ===================== E. a failed reply is saved with its reason =====================
await resetMock()
await H.sendAndWait('[[mock:500]] fail')
let conv = await H.waitConv(FIRST, (c) => c.messages.length === 8 && c.messages.at(-1).status === 'error')
let note = (await H.screen()).at(-1).note
check('a failed reply is saved as status "error" with the very text the person saw', conv.messages.at(-1).status === 'error' && conv.messages.at(-1).error === note && conv.messages.at(-1).content === '' && /problem on its side \(500\)/.test(note), `${note} | ${JSON.stringify(conv.messages.at(-1))}`)
await resetMock()
await H.sendAndWait('[[mock:midstream-error]] partway')
conv = await H.waitConv(FIRST, (c) => c.messages.length === 10 && c.messages.at(-1).status === 'error')
check('a reply that broke off in the middle keeps its partial text and its error', conv.messages.at(-1).status === 'error' && conv.messages.at(-1).content === 'Partial ' && /Overloaded/.test(conv.messages.at(-1).error ?? ''), JSON.stringify(conv.messages.at(-1)))
const beforeNew = { sha: H.sha(FIRST), count: conv.messages.length, mtime: H.mtime(FIRST) }

// ===================== F. New chat =====================
await H.clickHeader('New chat')
await sleep(300)
check('New chat clears the screen and shows the empty hint', (await H.screen()).length === 0 && /Type a message to start/.test(await H.emptyHint()), await H.emptyHint())
check('...New chat is disabled again (nothing to start over)', (await H.headerButton('New chat')).disabled)
check('...and keyboard focus is in the input box, so the person can just start typing', await ev(`document.activeElement?.classList.contains('composer-input')`), await ev(`document.activeElement?.className`))
check('...the old conversation is still on disk, byte for byte, and no file was created by pressing it', H.sha(FIRST) === beforeNew.sha && H.convFiles().length === 1)
await resetMock()
await H.sendAndWait('second chat')
const second = await H.waitFirst('second chat', (c) => c.messages.length === 2 && c.messages[1].status === 'done')
const SECOND = second.id
const secondShaBefore = H.sha(SECOND)
check('typing in the new chat creates a second file (a different id), the first is untouched', H.convFiles().length === 2 && SECOND !== FIRST && H.sha(FIRST) === beforeNew.sha && second.conv.messages.length === 2)
const listF = (await ev(`window.api.history.list()`)).conversations
check('list(): newest first', listF.length === 2 && listF[0].id === SECOND && listF[1].id === FIRST, JSON.stringify(listF.map((c) => c.title)))

// ===================== G. opening an old conversation, and continuing it =====================
await H.openHistory()
rows = await H.rows()
check('History: two rows, the new chat first and marked as open now', rows.length === 2 && rows[0].title === 'second chat' && rows[0].current && !rows[1].current && rows[1].title === 'first question', JSON.stringify(rows.map((r) => [r.title, r.current])))
check('...the old one says how many messages it holds', new RegExp(`${beforeNew.count} messages`).test(rows[1].meta), rows[1].meta)
await page.screenshot(`${shots}/4-2-history-two.png`)
await H.clickRow('first question')
await page.waitFor(`!document.querySelector('dialog.history')?.open`)
await sleep(300)
const screenG = await H.screen()
const wantG = H.readConv(FIRST).messages
check('opening it closes the dialog and shows the whole conversation, in order', screenG.length === wantG.length && screenG.every((m, i) => m.role === wantG[i].role && m.text === wantG[i].content), JSON.stringify(screenG.map((m) => m.text.slice(0, 14))))
const wantNotes = wantG.map((m) => (m.status === 'stopped' ? 'Stopped' : m.status === 'error' ? m.error : m.status === 'done' && m.content === '' ? 'The reply was empty.' : null))
check('...with exactly the notes the saved statuses call for ("Stopped" for stopped, the saved error text for failed ones)', JSON.stringify(screenG.map((m) => m.note)) === JSON.stringify(wantNotes) && wantNotes.filter((n) => n === 'Stopped').length >= 2 && wantNotes.filter((n) => n && n !== 'Stopped').length >= 2, JSON.stringify(wantNotes))
check('...and opening wrote nothing (the file is identical, same modification time)', H.sha(FIRST) === beforeNew.sha && H.mtime(FIRST) === beforeNew.mtime && H.convFiles().length === 2)
await sleep(1500)
check('...not even a second later (an opened conversation is not saved again until something changes)', H.sha(FIRST) === beforeNew.sha && H.mtime(FIRST) === beforeNew.mtime)
check('New chat is enabled (there is a conversation on screen)', !(await H.headerButton('New chat')).disabled)

await resetMock()
const savedBefore = H.readConv(FIRST).messages
await H.sendAndWait('third in the first')
const req = await H.lastRequest()
const wantWire = H.wireFrom([...savedBefore, { role: 'user', content: 'third in the first' }])
check('continuing it sends the model the WHOLE saved conversation plus the new message (D-013: empty replies left out, same-side messages joined)', JSON.stringify(req.body.messages) === JSON.stringify(wantWire), `${req.body.messages.length} messages sent, ${wantWire.length} expected`)
conv = await H.waitConv(FIRST, (c) => c.messages.length === savedBefore.length + 2 && c.messages.at(-1).status === 'done')
check('...and the same file now holds the old messages plus the new question and its reply', conv.messages.length === savedBefore.length + 2 && JSON.stringify(conv.messages.slice(0, savedBefore.length)) === JSON.stringify(savedBefore) && conv.messages.at(-1).content === 'Echo: third in the first', conv.messages.length)
const secondSha = H.sha(SECOND)
check('...createdAt kept, updatedAt moved on past it, and the other conversation is byte-for-byte untouched', conv.createdAt === first.conv.createdAt && conv.updatedAt > conv.createdAt && secondSha === secondShaBefore && H.convFiles().length === 2, `${conv.createdAt} ${first.conv.createdAt} ${conv.updatedAt}`)
const listG = (await ev(`window.api.history.list()`)).conversations
check('...so it is now the newest in the list', listG[0].id === FIRST && listG[1].id === SECOND, JSON.stringify(listG.map((c) => c.title)))

// ===================== H. deleting =====================
await H.openHistory()
rows = await H.rows()
check('the list is re-ordered: the conversation just continued is first', rows[0].title === 'first question' && rows[0].current, JSON.stringify(rows.map((r) => r.title)))
await H.clickRowButton('second chat', 'Delete')
await sleep(200)
rows = await H.rows()
check('pressing Delete asks first: "Delete?" with Delete and Keep, and the file is still there', rows[1].asking && JSON.stringify(rows[1].buttons).includes('Keep') && existsSync(join(folder, `${SECOND}.json`)), JSON.stringify(rows[1]))
check('...focus is on Keep, the safe choice', (await H.focusedText()) === 'Keep', await H.focusedText())
await page.screenshot(`${shots}/4-2-history-asking.png`)
await H.clickRowButton('second chat', 'Keep')
await sleep(200)
rows = await H.rows()
check('Keep puts it back: no question showing, file still there', !rows[1].asking && existsSync(join(folder, `${SECOND}.json`)) && rows.length === 2)
await H.clickRowButton('second chat', 'Delete')
await sleep(150)
await H.closeHistory() // Escape in the middle of a question...
await H.openHistory()
rows = await H.rows()
check('closing the dialog in the middle of a question forgets the question (nothing is deleted)', rows.length === 2 && !rows[1].asking && existsSync(join(folder, `${SECOND}.json`)))
await H.clickRowButton('second chat', 'Delete')
await sleep(150)
await H.clickRowButton('second chat', 'Delete') // the confirming one (the group's own Delete button)
await page.waitFor(`document.querySelectorAll('dialog.history .history-row').length === 1`)
check('confirming deletes the file at once and the row disappears; the dialog stays open', !existsSync(join(folder, `${SECOND}.json`)) && H.convFiles().length === 1 && (await H.historyOpen()), JSON.stringify(H.files()))
check('...the conversation on screen (the other one) is not affected', (await H.screen()).length === conv.messages.length)
check('...a delete leaves no temp file behind', H.strays().length === 0)
await H.clickRowButton('first question', 'Delete')
await sleep(150)
await H.clickRowButton('first question', 'Delete')
await page.waitFor(`document.querySelectorAll('dialog.history .history-row').length === 0`)
check('deleting the conversation that is open: the file is gone, the screen is a new empty chat', H.convFiles().length === 0 && (await H.screen()).length === 0, JSON.stringify(H.files()))
check('...and the dialog now says nothing is saved', /Nothing is saved yet/.test(await H.historyText()))
await H.closeHistory()
check('...New chat is disabled (an empty chat), and nothing re-created the deleted file', (await H.headerButton('New chat')).disabled && (await sleep(1500), H.convFiles().length === 0))

// ===================== H2. a message sent right after a reply is saved at once, not up to a second later =====================
// The throttle (one save a second while a reply streams) must not delay the person's own message: a message sent
// a few milliseconds after the previous save used to wait for the rest of that second.
await resetMock()
await H.sendAndWait('quick one')
await H.waitFirst('quick one', (c) => c.messages.length === 2 && c.messages[1].status === 'done')
const quickT0 = Date.now()
await H.send('quick two')
const quick = await H.waitFirst('quick one', (c) => c.messages.some((m) => m.content === 'quick two'), 3000)
const quickDelay = Date.now() - quickT0
check('a message sent right after a reply (within a second of the previous save) is on disk within 500 ms, not after the rest of the second', quickDelay < 500 && quick.conv.messages.at(-2).content === 'quick two', `${quickDelay} ms`)
await H.waitReady()
await H.clickHeader('New chat')
await sleep(200)
check('(cleanup) the quick conversation is removed through the API, leaving the others as they were', (await ev(`window.api.history.remove(${JSON.stringify(quick.id)})`)).ok && H.byFirst('quick one') === null)

// ===================== I. while a reply is arriving, the buttons that would leave it are disabled =====================
await resetMock()
await H.send('[[mock:slow]] busy')
await page.waitFor(`!!document.querySelector('.message-assistant')`)
await sleep(300)
const busyBtns = await H.headerButtons()
const menu = await H.menu()
check('while a reply arrives, New chat and History are disabled and say why', busyBtns[0].disabled && busyBtns[1].disabled && /reply/.test(busyBtns[0].title) && /reply/.test(busyBtns[1].title), JSON.stringify(busyBtns))
check('...Settings stays available, and so does the model menu rule (disabled)', !busyBtns.find((b) => b.text === 'Settings').disabled && menu.disabled)
check('...and the Instructions button is off too, saying when it comes back (7.4)', busyBtns.find((b) => b.text.startsWith('Instructions')).disabled && /reply has finished/.test(busyBtns.find((b) => b.text.startsWith('Instructions')).title))
check('...a click on History does nothing', (await H.clickHeader('History'), await sleep(300), !(await H.historyOpen())))
await page.click('.composer-button')
await H.waitReady()
await sleep(300)
const afterBusy = await H.headerButtons()
check('after Stop they are enabled again', !afterBusy[0].disabled && !afterBusy[1].disabled, JSON.stringify(afterBusy))
check('the stopped chat was saved (stopped, with its partial text)', (await H.waitFirst('[[mock:slow]] busy', (c) => c.messages.at(-1).status === 'stopped')).conv.messages.at(-1).content.length > 0)

// ===================== J. what the page must not be able to do =====================
const FILES_J = JSON.stringify(H.files())
const shaJ = Object.fromEntries(H.convFiles().map((n) => [n, H.sha(n.replace('.json', ''))]))
const abuse = await ev(`(async () => {
  const out = []
  const ids = [['number', 5], ['null', null], ['undefined', undefined], ['object', {}], ['array', []], ['empty', ''], ['relative path', '../x'], ['backslash path', '..\\\\x'], ['absolute path', 'C:\\\\Windows\\\\win.ini'], ['upper-case uuid', crypto.randomUUID().toUpperCase()], ['uuid + .json', crypto.randomUUID() + '.json'], ['__proto__', '__proto__'], ['device name', 'con'], ['2 MB string', 'x'.repeat(2000000)]]
  for (const fn of ['load', 'remove']) for (const [name, value] of ids) {
    try { const r = await window.api.history[fn](value); out.push([fn + ' ' + name, r.ok ? 'ACCEPTED' : 'refused: ' + r.error]) } catch (e) { out.push([fn + ' ' + name, 'threw: ' + String(e.message).slice(0, 80)]) }
  }
  return out
})()`)
check('load and remove with 14 kinds of bad id each (28 calls): every one refused, none accepted', abuse.length === 28 && abuse.every(([, v]) => !v.startsWith('ACCEPTED')), JSON.stringify(abuse.filter(([, v]) => v.startsWith('ACCEPTED'))))
check('...with plain sentences, not echoes of the input', abuse.every(([, v]) => v.length < 120 && !v.includes('xxxxxxxx')), JSON.stringify([...new Set(abuse.map(([, v]) => v))]).slice(0, 200))
const goodMsg = `{ role: 'user', content: 'x', status: 'done' }`
const saves = await ev(`(async () => {
  const id = crypto.randomUUID(), m = ${goodMsg}
  const cases = [['no id', { messages: [m] }], ['bad id', { id: '../x', messages: [m] }], ['no messages', { id }], ['empty messages', { id, messages: [] }], ['messages not an array', { id, messages: 'x' }], ['null', null], ['a string', 'x'], ['assistant first', { id, messages: [{ role: 'assistant', content: 'x', status: 'done' }] }], ['system role', { id, messages: [{ role: 'system', content: 'x', status: 'done' }] }], ['status unknown', { id, messages: [{ role: 'user', content: 'x', status: 'zzz' }] }], ['content a number', { id, messages: [{ role: 'user', content: 5, status: 'done' }] }], ['user message empty', { id, messages: [{ role: 'user', content: '', status: 'done' }] }], ['2001 messages', { id, messages: Array.from({ length: 2001 }, () => m) }], ['one 400001-char message', { id, messages: [{ role: 'user', content: 'x'.repeat(400001), status: 'done' }] }], ['1.6M chars in total', { id, messages: Array.from({ length: 4 }, () => ({ role: 'user', content: 'x'.repeat(400000), status: 'done' })) }], ['error text 2001 chars', { id, messages: [m, { role: 'assistant', content: '', status: 'error', error: 'e'.repeat(2001) }] }]]
  const out = []
  for (const [name, value] of cases) { try { const r = await window.api.history.save(value); out.push([name, r.ok ? 'ACCEPTED' : 'refused: ' + r.error]) } catch (e) { out.push([name, 'threw: ' + String(e.message).slice(0, 80)]) } }
  return out
})()`)
check('save with 16 kinds of bad input (missing parts, wrong types, oversize): every one refused', saves.length === 16 && saves.every(([, v]) => !v.startsWith('ACCEPTED')), JSON.stringify(saves.filter(([, v]) => v.startsWith('ACCEPTED'))))
check('...and none of it created, changed or removed a file', JSON.stringify(H.files()) === FILES_J && H.convFiles().every((n) => H.sha(n.replace('.json', '')) === shaJ[n]))
const forgedId = await ev(`crypto.randomUUID()`)
const forged = await ev(`window.api.history.save({ id: ${JSON.stringify(forgedId)}, title: 'FORGED', createdAt: 5, updatedAt: 5, version: 99, messages: [{ role: 'user', content: 'a real question', status: 'done', id: 'm1', evil: 1 }, { role: 'assistant', content: 'half', status: 'streaming' }] })`)
const forgedFile = H.readConv(forgedId)
check('a valid save from the page works, and the page cannot forge the title, the dates or the version', forged.ok && forgedFile.title === 'a real question' && forgedFile.version === 3 && forgedFile.createdAt > 1_000_000_000_000 && JSON.stringify(Object.keys(forgedFile.messages[0])) === JSON.stringify(['role', 'content', 'status']), JSON.stringify(forgedFile).slice(0, 160))
check('...and a message sent as "streaming" is stored as "stopped"', forgedFile.messages[1].status === 'stopped')
check('...the new conversation appears in the list', (await ev(`window.api.history.list()`)).conversations.some((c) => c.id === forgedId && c.title === 'a real question'))
const gone = await ev(`window.api.history.remove(${JSON.stringify(forgedId)})`)
check('...and remove works for it (cleanup), leaving no file', gone.ok && !existsSync(join(folder, `${forgedId}.json`)) && H.strays().length === 0)

const appUrl = await ev('location.href')
const FILES_K = JSON.stringify(H.files())
await ev(`setTimeout(() => { location.href = 'about:blank' }, 0); 0`)
await sleep(1200)
const blank = await ev(`(async () => {
  const settle = (p) => p.then((r) => 'RESOLVED ' + JSON.stringify(r).slice(0, 60), (e) => 'rejected: ' + String(e.message).slice(0, 120))
  const id = crypto.randomUUID()
  return { where: location.href, api: typeof window.api, list: await settle(window.api.history.list()), load: await settle(window.api.history.load(${JSON.stringify(FIRST)})), save: await settle(window.api.history.save({ id, messages: [{ role: 'user', content: 'x', status: 'done' }] })), remove: await settle(window.api.history.remove(${JSON.stringify(FIRST)})) }
})()`)
check('precondition: the page really is about:blank and still has window.api', blank.where === 'about:blank' && blank.api === 'object', JSON.stringify(blank))
for (const fn of ['list', 'load', 'save', 'remove']) check(`${fn} from about:blank is rejected by main ("Blocked")`, /^rejected: .*Blocked/.test(blank[fn]), blank[fn])
check('...and nothing on disk changed', JSON.stringify(H.files()) === FILES_K)
await page.send('Page.navigate', { url: appUrl })
await sleep(1800)

// ===================== K. a narrow window =====================
// two conversations again, so the dialog has something to show
await resetMock()
await H.sendAndWait('a conversation with a rather long first message that needs to be cut off somewhere sensible in the list')
await H.clickHeader('New chat')
await sleep(200)
await H.sendAndWait('short one')
await H.waitFirst('short one', (c) => c.messages.length === 2 && c.messages[1].status === 'done')
await H.waitFirst('a conversation with a rather long first message', (c) => c.messages.length === 2 && c.messages[1].status === 'done')
for (const width of [420, 320]) {
  await page.send('Emulation.setDeviceMetricsOverride', { width, height: 700, deviceScaleFactor: 1, mobile: false })
  await sleep(300)
  const fit = await ev(`(() => { const bs = [...document.querySelectorAll('.app-header .header-button, .app-header .header-select')]; const r = bs.map((b) => b.getBoundingClientRect()); return { overflowX: document.documentElement.scrollWidth > window.innerWidth, allInside: r.every((x) => x.left >= 0 && x.right <= window.innerWidth), count: bs.length } })()`)
  check(`at ${width}px wide the header has no sideways scroll and every control is fully on screen`, !fit.overflowX && fit.allInside && fit.count === 5, JSON.stringify(fit)) // New chat, History, Instructions, Settings and the model menu
  await page.screenshot(`${shots}/4-2-header-${width}.png`)
  await H.openHistory()
  const dlg = await ev(`(() => { const d = document.querySelector('dialog.history').getBoundingClientRect(); const c = [...document.querySelectorAll('dialog.history .history-footer button')].pop().getBoundingClientRect(); return { left: d.left, right: d.right, top: d.top, bottom: d.bottom, closeInside: c.left >= 0 && c.right <= window.innerWidth && c.bottom <= window.innerHeight, w: window.innerWidth, h: window.innerHeight } })()`)
  check(`at ${width}px the History dialog fits the window and its Close button is reachable`, dlg.left >= 0 && dlg.right <= dlg.w && dlg.top >= 0 && dlg.bottom <= dlg.h && dlg.closeInside, JSON.stringify(dlg))
  const clipped = await ev(`[...document.querySelectorAll('dialog.history .history-title')].map((t) => ({ over: t.scrollWidth > t.clientWidth, style: getComputedStyle(t).textOverflow }))`)
  check(`at ${width}px a long title is cut with an ellipsis instead of widening the dialog`, clipped.some((c) => c.over && c.style === 'ellipsis'), JSON.stringify(clipped))
  await page.screenshot(`${shots}/4-2-history-${width}.png`)
  await H.closeHistory()
}
await page.send('Emulation.clearDeviceMetricsOverride')
await sleep(300)

// ===================== L. the end state, and nothing leaked =====================
const left = H.allConvs()
check('left behind for the restart test: three conversations saved (the stopped "busy" one and the two from the narrow-window part), none unreadable, no stray files', left.length === 3 && H.strays().length === 0 && left.map((c) => c.title).sort().join('|').includes('short one'), JSON.stringify(left.map((c) => c.title)))
const appLog = readFileSync(process.env.APP_LOG, 'utf8')
check('no history file contains anything that looks like the test key', left.every((c) => !/test-[0-9a-f]{48}/.test(JSON.stringify(c))))
check('the app logged no history problems', !/saved conversation|could not be saved|conversation.*could not be read/i.test(appLog), appLog.split('\n').filter((l) => /conversation/i.test(l)).join(' | '))
check('no console errors, warnings or exceptions in the page', page.problems.length === 0, page.problems.join(' | '))
writeFileSync(join(process.env.TEMP ?? '.', 'frontier-4-2-state.json'), JSON.stringify({ ids: left.map((c) => c.id), titles: left.map((c) => c.title), hashes: left.map((c) => H.sha(c.id)), mtimes: left.map((c) => H.mtime(c.id)) }))
const passed = check.summary()
page.close()
process.exit(passed ? 0 : 1)
