// Stage 7.4 (D-027), in the real window against the mock: the person's instructions for a chat. The chat-bar button and its "on" mark, the dialog (a
// draft that Escape and Cancel throw away, the count, the limit, trimming), what is sent (the app's rules first, then the instructions, with EVERY
// message, to either provider, and the same bytes as Stage 7.3 when there are none), what is saved (version 3, at once, with the messages), what
// comes back from History, what a script in the page cannot do (replace the app's rules, send too much), and four files seeded before the
// launch (versions 1, 2, 3 and a damaged 3: reading never writes them). Run through run74.mjs, which seeds them.
// Needs: MOCK_PORT, USER_DATA_DIR (scratch), TEMP (the seed's manifest).
import './temp-on-a.mjs'
import './ts-resolve.mjs'
import { connect, checker, sleep } from './cdp.mjs'
import { assertScratchProfile } from './profile-guard.mjs'
import { h4 } from './lib4.mjs'
import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const shots = process.argv[2]
const port = Number(process.argv[3] ?? 9222)
const { MOCK_PORT, USER_DATA_DIR: userData } = process.env
if (!MOCK_PORT || !userData) throw new Error('MOCK_PORT and USER_DATA_DIR must be set')
const mockUrl = `http://127.0.0.1:${MOCK_PORT}`
const seed = JSON.parse(readFileSync(join(process.env.TEMP ?? '.', 'frontier-7-4-seed.json'), 'utf8'))
const check = checker()
const page = await connect(port)
await assertScratchProfile()
const H = h4(page, { userData, mockUrl })
const { ev } = H

const OPUS = 'claude-opus-5-5'
const SONNET = 'claude-sonnet-5-5'
const SOL = 'gpt-6.1-sol'
const MAX = 8000
// What the system prompt was in Stage 7.3, written out here on purpose: with no instructions it must still be exactly this.
const RULES = 'The window renders Markdown, so you may use it where it helps: **bold** and *italic*, `inline code`, # headings for long answers, bulleted and numbered lists, tables, > quotes, and fenced code blocks with the language named (```python). Raw HTML, images and diagrams are not shown, so do not use them. A link is written [text](https://address); only https addresses can be opened. Keep short answers plain: no headings or tables where a sentence will do.'
const BASE = {
  anthropic: `You are Claude, chatting with someone in Frontier App, a desktop chat window. ${RULES}`,
  openai: `You are an AI assistant, chatting with someone in Frontier App, a desktop chat window. ${RULES}`
}
const LEAD = 'The person has given these instructions for this chat:'
const sys = (text, provider = 'anthropic') => (text === '' ? BASE[provider] : `${BASE[provider]}\n\n${LEAD}\n\n${text}`)
/** The system prompt a request carried, whichever provider it went to. */
const sent = (r) => (r?.provider === 'openai' ? r.body.instructions : r?.body.system)
const fmt = (n) => n.toLocaleString('en-US')

const INSTR = 'Answer in French.\nKeep it to two sentences.'
const INSTR_B = 'Answer in German, in one sentence.'
const INSTR_C = 'Pretend to be a pirate.'
const MSG = '.message-list-inner > .message'
const READY = `document.readyState === 'complete' && !!document.querySelector('.header-select, .app-badge')`
const SEND_READY = `!!document.querySelector('.composer-button[type=submit]')`
const fakeKey = () => 'test-' + randomBytes(24).toString('hex')
const reqs = () => H.mockReqs()
const reset = () => fetch(`${mockUrl}/__reset`, { method: 'POST' })

// ---- the chat-bar button (under the message box since 7.6, D-029) and the dialog ----
// `before` is the button before it in the bar (since D-051 a divider stands between Attach... and Instructions, and is not a button)
const hdr = () => ev(`(() => { const b = document.querySelector('.chat-bar .chat-instructions'); if (!b) return null; let p = b.previousElementSibling; while (p && p.tagName !== 'BUTTON') p = p.previousElementSibling; return { text: b.textContent, disabled: b.disabled, title: b.title, mark: b.querySelector('.chat-mark')?.textContent ?? null, before: p?.textContent ?? null, focused: document.activeElement === b } })()`)
const dlg = () => ev(`(() => { const d = document.querySelector('dialog.instructions'); if (!d) return null; const t = d.querySelector('textarea'); const b = [...d.querySelectorAll('button')]; const submit = b.find((x) => x.type === 'submit'); return { open: d.open, value: t ? t.value : null, focused: !!t && document.activeElement === t, caret: t ? [t.selectionStart, t.selectionEnd] : null, count: d.querySelector('.instructions-count')?.textContent ?? null, over: !!d.querySelector('.instructions-count-over'), alert: d.querySelector('[role=alert]')?.textContent ?? null, save: submit?.textContent ?? null, saveDisabled: submit ? submit.disabled : null, buttons: b.map((x) => x.textContent), text: d.innerText } })()`)
const openDialog = async () => {
  await page.click('.chat-instructions')
  await page.waitFor(`document.querySelector('dialog.instructions')?.open === true && !!document.querySelector('dialog.instructions textarea')`, { timeoutMs: 6000, label: 'the instructions dialog to open' })
  await sleep(120)
}
// Only "the dialog is not open": whether its form is still mounted is not what a person sees, and is checked where it matters (a draft that
// Escape or Cancel threw away must not come back).
const closed = () => page.waitFor(`!document.querySelector('dialog.instructions')?.open`, { timeoutMs: 6000, label: 'the instructions dialog to close' })
const setText = (text) => ev(`(() => { const t = document.querySelector('dialog.instructions textarea'); const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; set.call(t, ${JSON.stringify(text)}); t.dispatchEvent(new Event('input', { bubbles: true })); return t.value.length })()`)
const footer = (label) => page.click(`.instructions-footer button@${label}`)
/** Opens the dialog, replaces the text, saves (or turns off), and waits for it to close. */
const setInstructions = async (text) => {
  await openDialog()
  await setText(text)
  await footer(text.trim() === '' ? 'Turn off' : 'Save')
  await closed()
}

// ---- the conversation ----
const screen = () => ev(`[...document.querySelectorAll('${MSG}')].map((m) => ({ role: m.classList.contains('message-user') ? 'user' : 'assistant', text: m.querySelector('.bubble')?.innerText ?? null }))`)
const newChat = async () => { await page.click('.chat-button@New chat'); await page.waitFor(`document.querySelectorAll('${MSG}').length === 0`, { timeoutMs: 6000 }); await sleep(150) }
const openFromHistory = async (title) => {
  await H.openHistory()
  await H.clickRow(title)
  await page.waitFor(`!document.querySelector('dialog.history')?.open && document.querySelectorAll('${MSG}').length > 0`, { timeoutMs: 8000, label: `"${title}" to open` })
  await sleep(300)
}
// An early message of a long chat may be scrolled out of sight: bring it in first.
const act = async (index, label) => {
  await ev(`document.querySelector('${MSG}:nth-child(${index + 1})')?.scrollIntoView({ block: 'center' })`)
  await sleep(100)
  return page.click(`${MSG}:nth-child(${index + 1}) .message-action@${label}`)
}
const afterAsking = async (before) => {
  for (let i = 0; i < 160 && (await reqs()).length === before; i++) await sleep(50)
  await page.waitFor(SEND_READY, { timeoutMs: 15000 })
  await sleep(200)
  const all = await reqs()
  return all.length > before ? all.at(-1) : null
}
/** What the box holds, looked at and put away: opens the dialog, reads it, presses Cancel. */
const peek = async () => {
  await openDialog()
  const { value } = await dlg()
  await footer('Cancel')
  await closed()
  return value
}
const seededUntouched = (names) => names.every((n) => H.sha(seed[n].id) === seed[n].sha && H.mtime(seed[n].id) === seed[n].mtime)

try {
await page.waitFor(READY, { timeoutMs: 20000 })
await sleep(500)

// ============ 0. four files seeded before the launch ============
check('the four seeded files (versions 1, 2, 3 and a damaged 3) are the only files, byte for byte as written, with their original modification times (the app scanned the folder at startup)', H.convFiles().length === 4 && seededUntouched(['v1', 'v2', 'v3', 'bad']))
await ev(`window.api.settings.setApiKey('anthropic', ${JSON.stringify(fakeKey())}).then((r) => r.ok)`)
await ev(`window.api.settings.setApiKey('openai', ${JSON.stringify(fakeKey())}).then((r) => r.ok)`)
await page.send('Page.reload')
await sleep(600)
await page.waitFor(READY, { timeoutMs: 20000 })
await reset()
await H.openHistory()
const rows0 = await H.rows()
check('History lists the chats of versions 1, 2 and 3 (not the damaged one) and says one saved file could not be read', ['v1 first question', 'v2 first question', 'v3 first question'].every((t) => rows0.some((r) => r.title === t)) && !rows0.some((r) => r.title === seed.bad.title) && /1 saved file could not be read/.test(await H.historyText()), JSON.stringify(rows0.map((r) => r.title)))
await H.closeHistory()

await openFromHistory('v2 first question')
let s = await screen()
check('a chat saved by Stages 5.4-7.3 (version 2) opens as it was: four messages, and the Instructions button has no mark', s.length === 4 && s[3].text === 'v2 second answer' && (await hdr()).mark === null, JSON.stringify(s.map((m) => m.text)))
await sleep(1500)
check('...opening it wrote nothing: same bytes, same modification time (reading never writes), and the other seeded files are untouched too', seededUntouched(['v1', 'v2', 'v3', 'bad']))
await openDialog()
check('its instructions box is empty', (await dlg()).value === '')
await setText(`  ${INSTR_B}  `)
// Named before Save (10.2): a box that applied what is typed at once would leave Save off here and the suite would only stop at the next wait.
check('typing alone saves nothing: no mark on the button yet, and Save is on', (await hdr()).mark === null && (await dlg()).saveDisabled === false)
await footer('Save')
await closed()
const up = await H.waitConv(seed.v2.id, (c) => c.instructions === INSTR_B)
check('giving it instructions saves it at once as version 3: the four messages exactly as they were, its title and creation date kept, the instructions trimmed', up.version === 3 && JSON.stringify(up.messages) === JSON.stringify(seed.v2.messages) && up.title === 'v2 first question' && up.createdAt === seed.v2.createdAt, JSON.stringify(up).slice(0, 200))
check('...and no other file changed (the version 1, the version 3 and the damaged file are still byte for byte as seeded)', seededUntouched(['v1', 'v3', 'bad']) && H.convFiles().length === 4)
let r = await H.askMock('[[mock:count]] a question in the old chat')
check('the next message in it carries them, after the app\'s rules, with the four old messages and the new one', r !== null && r.problems.length === 0 && sent(r) === sys(INSTR_B) && r.body.messages.length === 5, JSON.stringify(sent(r)?.slice(-60)))

await openFromHistory('v3 first question')
check('a chat saved with instructions (version 3) opens with the button marked "on"', (await hdr()).mark === 'on')
await openDialog()
let d = await dlg()
check('...and its box holds the seeded text, with the cursor at the end', d.value === seed.v3.instructions && d.caret[0] === seed.v3.instructions.length && d.caret[1] === seed.v3.instructions.length, JSON.stringify(d.value))
check('...Save is off (nothing has changed)', d.saveDisabled === true && d.save === 'Save')
await footer('Cancel')
await closed()
await sleep(1500)
check('...looking at them wrote nothing: the file is still byte for byte as seeded', seededUntouched(['v3']))
r = await H.askMock('[[mock:count]] a question in the chat that has instructions')
check('...and the next message carries them', sent(r) === sys(seed.v3.instructions) && r.body.messages.length === 3, JSON.stringify(sent(r)?.slice(-60)))
const v3after = await H.waitConv(seed.v3.id, (c) => c.messages.length === 4 && c.messages[3].status === 'done')
check('...and the chat is saved with them still in it (version 3, the same text)', v3after.version === 3 && v3after.instructions === seed.v3.instructions)

await openFromHistory('v1 first question')
check('a chat saved by Stages 2-4 (version 1) opens with no instructions', (await hdr()).mark === null && (await screen()).length === 2)
r = await H.askMock('[[mock:count]] a question in the oldest chat')
check('...and sends the app\'s rules alone, byte for byte what Stage 7.3 sent', sent(r) === BASE.anthropic)
const v1after = await H.waitConv(seed.v1.id, (c) => c.messages.length === 4 && c.messages[3].status === 'done')
check('...the next save of it is version 3, with an empty string in the instructions field', v1after.version === 3 && v1after.instructions === '')
check('the damaged file has been counted and left alone through all of this', seededUntouched(['bad']))

// ============ A. the button and the dialog ============
await newChat()
await reset()
let hb = await hdr()
check('the chat bar has an Instructions button (after Attach... since D-051: History is in the sidebar), with no "on" mark while the chat has none', hb !== null && hb.text === 'Instructions' && hb.mark === null && hb.before === 'Attach...' && !hb.disabled && /Give the model instructions/.test(hb.title), JSON.stringify(hb))
await openDialog()
d = await dlg()
check('clicking it opens a modal dialog with a box: empty, with the keyboard in it, and Save is off because there is nothing to save', d.open && d.value === '' && d.focused && d.saveDisabled === true && d.save === 'Save' && d.buttons.join() === 'Change...,Cancel,Save', JSON.stringify(d)) // since 10.2 (D-039) the dialog also shows the instructions for every chat, with their own "Change..."
check('...it says what the text does: sent with every message, to the company that runs the model (and to another company if the model changes), billed, saved as plain text on this computer, not for passwords, a new chat starts without', ['every message', 'company that runs the model', 'if you change the model', 'billed', 'plain text', 'Do not put passwords or keys here', 'A new chat starts without instructions'].every((x) => d.text.includes(x)), d.text)
check('...and how to turn them off', /empty the box/.test(d.text))
check('...the count starts at 0 of 8,000 characters', d.count === '0 of 8,000 characters', d.count)
await page.screenshot(`${shots}/7-4-dialog.png`)
await page.send('Input.insertText', { text: 'Answer in short sentences.' })
d = await dlg()
check('real typing puts the text in the box, the count follows, and Save turns on', d.value === 'Answer in short sentences.' && d.count === '26 of 8,000 characters' && d.saveDisabled === false, JSON.stringify([d.value, d.count, d.saveDisabled]))
await page.press('Enter')
d = await dlg()
check('Enter in the box makes a new line: it does not save, and the dialog stays open', d.open && d.value === 'Answer in short sentences.\n', JSON.stringify(d.value))
check('typing alone changes nothing: no mark on the button, no request, no new file', (await hdr()).mark === null && (await reqs()).length === 0 && H.convFiles().length === 4)
await page.press('Escape')
await closed()
check('Escape closes it, and the draft is thrown away: no mark, and opening it again shows an empty box', (await hdr()).mark === null && (await openDialog(), (await dlg()).value === ''))
await page.send('Input.insertText', { text: 'a draft that is cancelled' })
await footer('Cancel')
await closed()
check('Cancel closes it too: no mark, nothing saved, and again an empty box next time', (await hdr()).mark === null && (await openDialog(), (await dlg()).value === '') && H.convFiles().length === 4)
await setText(`  ${INSTR}  \n`)
d = await dlg()
check('the count is of the trimmed text, which is the text that is kept (spaces and line breaks at the ends do not count)', d.count === `${fmt(INSTR.length)} of 8,000 characters`, d.count)
await footer('Save')
await closed()
await page.waitFor(`document.querySelector('.chat-bar .chat-instructions .chat-mark')?.textContent === 'on'`, { timeoutMs: 4000, label: 'the on mark' }).catch(() => undefined) // (the mark follows main's answer to the save, a moment after the dialog closes: it flaked in 2 of 4 runs of the 15.8 regression when it was read at once)
hb = await hdr()
check('Save closes the dialog and the button now says "on", with a tooltip that says the instructions are sent with every message and how long they are', hb.mark === 'on' && hb.text === 'Instructions on' && hb.title.includes(`${fmt(INSTR.length)} characters`) && /every message/.test(hb.title), JSON.stringify(hb))
check('...the keyboard goes back to the button that opened the dialog', hb.focused)
check('...saving instructions alone creates no chat file (a chat is saved when it has a message) and sends no request', H.convFiles().length === 4 && (await reqs()).length === 0)
await page.screenshot(`${shots}/7-4-on.png`)

// ============ B. what is sent, and what is saved ============
r = await H.askMock('[[mock:count]] first message')
check('the first message goes out with the app\'s rules and then, after them, the instructions: nothing else about the request changed, and the (strict) mock accepts it', r !== null && r.problems.length === 0 && sent(r) === sys(INSTR) && r.body.messages.length === 1 && r.body.messages[0].content === '[[mock:count]] first message', JSON.stringify(sent(r)?.slice(-80)))
check('...the instructions are in the system prompt only, never among the messages', !JSON.stringify(r.body.messages).includes('French'))
const first = await H.waitFirst('[[mock:count]] first message', (c) => c.messages.length === 2 && c.messages[1].status === 'done')
check('the saved chat is version 3, holds the instructions (trimmed, line break kept) and has them before the messages', first.conv.version === 3 && first.conv.instructions === INSTR && JSON.stringify(Object.keys(first.conv)) === '["version","id","title","createdAt","updatedAt","instructions","messages"]', JSON.stringify(Object.keys(first.conv)))
r = await H.askMock('[[mock:count]] second message')
check('every message carries them: the second request has the same system prompt, and the conversation has grown', sent(r) === sys(INSTR) && r.body.messages.length === 3)
const chatA = first.id

// ============ C. changing them in a chat that has messages ============
const before = await H.waitConv(chatA, (c) => c.messages.length === 4 && c.messages[3].status === 'done') // the last reply's own save is the final one
await sleep(400)
await openDialog()
d = await dlg()
check('the dialog opens with the chat\'s instructions in the box, the cursor at the end, and Save off until something changes', d.value === INSTR && d.caret[0] === INSTR.length && d.saveDisabled === true, JSON.stringify([d.value, d.caret, d.saveDisabled]))
await setText(INSTR_B)
await footer('Save')
await closed()
const changed = await H.waitConv(chatA, (c) => c.instructions === INSTR_B)
check('changing them saves the chat at once: the same four messages, the same title and creation date, a newer update time, still one file for it', changed.messages.length === 4 && JSON.stringify(changed.messages) === JSON.stringify(before.messages) && changed.title === before.title && changed.createdAt === before.createdAt && changed.updatedAt > before.updatedAt && H.convFiles().length === 5, JSON.stringify([changed.messages.length, H.convFiles().length]))
r = await H.askMock('[[mock:count]] third message')
check('the next request has the new instructions and not the old ones', sent(r) === sys(INSTR_B) && !sent(r).includes('French'))

// ============ D. turning them off ============
await openDialog()
await setText('')
d = await dlg()
check('emptying the box turns the button into "Turn off" (and the count says 0)', d.save === 'Turn off' && d.saveDisabled === false && d.count === '0 of 8,000 characters', JSON.stringify([d.save, d.count]))
await footer('Turn off')
await closed()
check('...the mark goes, and the saved chat has an empty string', (await hdr()).mark === null && (await H.waitConv(chatA, (c) => c.instructions === '')).messages.length === 6)
r = await H.askMock('[[mock:count]] fourth message')
check('...and the next request is the app\'s rules alone, byte for byte what Stage 7.3 sent', sent(r) === BASE.anthropic)

// ============ E. a new chat starts without ============
await setInstructions(INSTR_C)
await page.waitFor(`document.querySelector('.chat-bar .chat-instructions .chat-mark')?.textContent === 'on'`, { timeoutMs: 4000, label: 'the on mark' }).catch(() => undefined) // (the mark follows main's answer to the save, a moment after the dialog closes: it flaked in 2 of 4 runs of the 15.8 regression when it was read at once)
check('(instructions set again on the chat that is open)', (await hdr()).mark === 'on')
await newChat()
check('New chat starts without instructions: no mark', (await hdr()).mark === null)
await openDialog()
check('...and the box is empty', (await dlg()).value === '')
await footer('Cancel')
await closed()
r = await H.askMock('[[mock:count]] a fresh chat')
check('...its first request is the app\'s rules alone', sent(r) === BASE.anthropic)
const fresh = await H.waitFirst('[[mock:count]] a fresh chat', (c) => c.messages.length === 2 && c.messages[1].status === 'done')
check('...and its file has an empty instructions field', fresh.conv.instructions === '' && fresh.conv.version === 3)
const old = await H.waitConv(chatA, (c) => c.instructions === INSTR_C)
check('the chat that was left kept its own instructions (saved when they were set)', old.instructions === INSTR_C)

// ============ F. back from History ============
await newChat()
await setInstructions(INSTR_B)
r = await H.askMock('[[mock:count]] chat with german')
const chatG = (await H.waitFirst('[[mock:count]] chat with german', (c) => c.messages.length === 2 && c.messages[1].status === 'done')).id
await newChat()
r = await H.askMock('[[mock:count]] chat with nothing')
await H.waitFirst('[[mock:count]] chat with nothing', (c) => c.messages.length === 2 && c.messages[1].status === 'done')
await openFromHistory('[[mock:count]] chat with german')
check('opening a chat from History brings its instructions back: the mark is on and the box holds the text', (await hdr()).mark === 'on' && (await peek()) === INSTR_B)
r = await H.askMock('[[mock:count]] more german')
check('...and its next request carries them', sent(r) === sys(INSTR_B))
await openFromHistory('[[mock:count]] chat with nothing')
check('opening a chat that has none clears the mark', (await hdr()).mark === null)
r = await H.askMock('[[mock:count]] more nothing')
check('...and its request is the rules alone (the instructions of the chat just left do not follow)', sent(r) === BASE.anthropic)
await page.send('Page.reload')
await sleep(600)
await page.waitFor(READY, { timeoutMs: 20000 })
await openFromHistory('[[mock:count]] chat with german')
check('after the window is reloaded (a new start of the page) the chat still brings its instructions back from the file', (await hdr()).mark === 'on' && (await peek()) === INSTR_B)

// ============ G. asking again uses the instructions the chat has THEN ============
await reset()
r = await H.askMock('[[mock:count]] to be asked again')
let n = (await reqs()).length
await act((await screen()).length - 1, 'Regenerate')
r = await afterAsking(n)
check('Regenerate sends the chat\'s instructions', sent(r) === sys(INSTR_B), JSON.stringify(sent(r)?.slice(-50)))
await setInstructions(INSTR_C)
n = (await reqs()).length
const lastIndex = (await screen()).length - 1
await act(lastIndex, 'Regenerate')
r = await afterAsking(n)
check('...after they are changed, Regenerate sends the new ones, not the old', sent(r) === sys(INSTR_C) && !sent(r).includes('German'))
n = (await reqs()).length
await act(0, 'Edit')
await page.waitFor(`!!document.querySelector('.message-edit textarea')`, { timeoutMs: 4000, label: 'the edit box of the first message to open' })
await ev(`(() => { const t = document.querySelector('.message-edit textarea'); const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; set.call(t, '[[mock:count]] chat with german, edited'); t.dispatchEvent(new Event('input', { bubbles: true })) })()`)
await page.click('.message-edit button@Send')
await sleep(250)
if (await ev(`!!document.querySelector('.message-edit-warning')`)) await page.click('.message-edit button@Send anyway')
r = await afterAsking(n)
check('...and so does an edited message that is sent again', sent(r) === sys(INSTR_C) && r.body.messages.length === 1)

// ============ H. while a reply is arriving ============
n = (await reqs()).length
await H.send('[[mock:slow]] hold on')
for (let i = 0; i < 100 && (await reqs()).length === n; i++) await sleep(50)
await page.waitFor(`!!document.querySelector('.composer-button-stop')`, { timeoutMs: 8000 })
hb = await hdr()
check('while a reply is arriving the button is off and says when it comes back; the mark stays', hb.disabled === true && /when the reply has finished/.test(hb.title) && hb.mark === 'on', JSON.stringify(hb))
await page.click('.chat-instructions').catch(() => {})
await sleep(300)
check('...clicking it opens nothing', (await dlg())?.open !== true)
await page.click('.composer-button-stop')
await page.waitFor(SEND_READY, { timeoutMs: 6000 })
await sleep(200)
hb = await hdr()
check('after Stop the button is back, with its mark', hb.disabled === false && hb.mark === 'on')

// ============ I. the limit, and what the dialog does at it ============
await newChat()
await openDialog()
await setText('x'.repeat(MAX))
d = await dlg()
check('exactly 8,000 characters: the count says 8,000 of 8,000, there is no complaint, and Save is on', d.count === '8,000 of 8,000 characters' && d.over === false && d.alert === null && d.saveDisabled === false, JSON.stringify([d.count, d.alert, d.saveDisabled]))
await setText('x'.repeat(MAX + 1))
d = await dlg()
check('8,001: the count turns into a warning that says 1 too many, and Save is off', d.over === true && /8,001 of 8,000 characters: 1 too many/.test(d.alert ?? '') && d.saveDisabled === true, JSON.stringify([d.count, d.alert, d.saveDisabled]))
await page.screenshot(`${shots}/7-4-too-long.png`)
await setText(`${' '.repeat(10)}${'x'.repeat(MAX)}${' '.repeat(10)}`)
d = await dlg()
check('8,000 characters with ten spaces on each side is fine (the limit is on the trimmed text)', d.over === false && d.saveDisabled === false && d.count === '8,000 of 8,000 characters')
// A real paste: everything in the box selected, then 9,000 characters put in as an edit. (Setting .value from a script would never meet a
// maxlength attribute, so a check made that way cannot see one added: the negative control for it said so.)
await ev(`document.querySelector('dialog.instructions textarea').select()`)
await page.send('Input.insertText', { text: 'y'.repeat(9000) })
d = await dlg()
check('a long text pasted in is NOT cut: the box keeps all 9,000 characters and the warning says 1,000 too many', d.value.length === 9000 && /1,000 too many/.test(d.alert ?? '') && d.saveDisabled === true, JSON.stringify([d.value.length, d.alert]))
await setText(' \n\t ')
d = await dlg()
check('white space alone counts as nothing: 0 characters, and Save is off while the chat has none', d.count === '0 of 8,000 characters' && d.saveDisabled === true)
await setText('z'.repeat(MAX))
await footer('Save')
await closed()
r = await H.askMock('[[mock:count]] with the longest instructions')
check('the longest instructions (8,000 characters) go out whole, and the strict mock accepts the request', r !== null && r.problems.length === 0 && sent(r) === sys('z'.repeat(MAX)) && sent(r).length === BASE.anthropic.length + `\n\n${LEAD}\n\n`.length + MAX)
const longChat = await H.waitFirst('[[mock:count]] with the longest', (c) => c.messages.length === 2 && c.messages[1].status === 'done')
check('...and the chat is saved with all of them, and reads back whole after a reload', longChat.conv.instructions === 'z'.repeat(MAX))
await page.send('Page.reload')
await sleep(600)
await page.waitFor(READY, { timeoutMs: 20000 })
await openFromHistory('[[mock:count]] with the longest instructions')
check('...(the 8,000 characters come back from the file)', (await hdr()).mark === 'on' && (await peek()).length === MAX)

// ============ J. the other provider ============
await newChat()
await setInstructions(INSTR)
await H.chooseInPage(SOL)
await H.settle(SOL)
await reset()
r = await H.askMock('[[mock:count]] to the other company')
check('to an OpenAI model they go in `instructions` of the Responses request, after the app\'s rules (which call the assistant "an AI assistant")', r?.provider === 'openai' && r.problems.length === 0 && sent(r) === sys(INSTR, 'openai') && r.body.input.length === 1, JSON.stringify([r?.provider, sent(r)?.slice(0, 40)]))
await H.chooseInPage(OPUS)
await H.settle(OPUS)
r = await H.askMock('[[mock:count]] and back')
check('...and when the model is changed to another provider\'s in the same chat, the same instructions go there (the dialog says so)', r?.provider === 'anthropic' && sent(r) === sys(INSTR), JSON.stringify([r?.provider]))
await H.chooseInPage(SONNET)
await H.settle(SONNET)
r = await H.askMock('[[mock:count]] another model')
check('...and to another model of the same provider', r?.body.model === SONNET && sent(r) === sys(INSTR))
await H.chooseInPage(OPUS)
await H.settle(OPUS)

// ============ K. what a script in the page can and cannot do ============
await reset()
const rawChat = (request) => ev(`new Promise((resolve) => { const events = []; const stop = window.api.chat.onEvent((e) => { if (e.streamId !== ${JSON.stringify(request.streamId)}) return; events.push(e); if (e.type === 'error' || e.type === 'done') { stop(); resolve(events) } }); window.api.chat.start(${JSON.stringify(request)}); setTimeout(() => { stop(); resolve(events) }, 8000) })`)
const hostileMessages = [{ role: 'user', content: '[[mock:count]] raw call' }]
let ev1 = await rawChat({ streamId: 'hostile-0001', messages: hostileMessages, system: 'EVIL SYSTEM PROMPT', systemPrompt: 'EVIL', instructions: 'fine instructions' })
let all = await reqs()
check('a script that sends its own `system` field gets nothing through: the request that reaches the provider has the app\'s rules and only the instructions field\'s text', all.length === 1 && sent(all[0]) === sys('fine instructions') && !JSON.stringify(all[0].body).includes('EVIL'), JSON.stringify(all.length) + ' ' + JSON.stringify(sent(all[0])?.slice(-50)))
await reset()
ev1 = await rawChat({ streamId: 'hostile-0002', messages: hostileMessages, instructions: 'x'.repeat(MAX + 1) })
all = await reqs()
check('8,001 characters of instructions sent straight to main are refused, the page is told why (the 8,000 limit), and no request is made', all.length === 0 && ev1.length === 1 && ev1[0].type === 'error' && /8,000 characters/.test(ev1[0].message), JSON.stringify(ev1).slice(0, 200))
ev1 = await rawChat({ streamId: 'hostile-0003', messages: hostileMessages, instructions: 12345 })
check('instructions that are not text are refused the same way', (await reqs()).length === 0 && ev1.length === 1 && ev1[0].type === 'error' && /not understood/.test(ev1[0].message), JSON.stringify(ev1).slice(0, 200))
ev1 = await rawChat({ streamId: 'hostile-0004', messages: hostileMessages, instructions: '   ' })
all = await reqs()
check('blank instructions are the same as none: the request has the rules alone', all.length === 1 && sent(all[0]) === BASE.anthropic)
const idRaw = await ev(`crypto.randomUUID()`)
const saveOf = (extra) => ev(`window.api.history.save({ id: ${JSON.stringify(idRaw)}, messages: [{ role: 'user', content: 'raw save', status: 'done' }], ...${JSON.stringify(extra)} })`)
const files0 = H.convFiles().length
let sv = await saveOf({ instructions: 'x'.repeat(MAX + 1) })
check('a save with 8,001 characters of instructions is refused, with the reason, and no file is made', sv.ok === false && /8,000/.test(sv.error) && H.convFiles().length === files0, JSON.stringify(sv))
sv = await saveOf({ instructions: { text: 'x' } })
check('...and so is a save whose instructions are an object', sv.ok === false && H.convFiles().length === files0)
sv = await saveOf({})
const rawFile = await H.waitConv(idRaw, (c) => c.messages.length === 1)
check('a save from a caller that knows nothing of instructions still works, and the file has an empty field (absent means none)', sv.ok === true && rawFile.version === 3 && rawFile.instructions === '')
sv = await saveOf({ instructions: '  kept, trimmed  ', title: 'FORGED', version: 99 })
const rawFile2 = await H.waitConv(idRaw, (c) => c.instructions === 'kept, trimmed')
check('a save with instructions keeps them trimmed, and the page still cannot choose the title or the version', sv.ok === true && rawFile2.title === 'raw save' && rawFile2.version === 3)

// ============ L. narrow windows, and the whole run ============
await newChat()
await setInstructions(INSTR)
for (const width of [420, 320]) {
  await page.send('Emulation.setDeviceMetricsOverride', { width, height: 700, deviceScaleFactor: 1, mobile: false })
  await sleep(250)
  const header = await ev(`(() => { const bs = [...document.querySelectorAll('.app-header .header-button, .app-header .header-select, .app-header .task-select, .app-header .effort-select, .chat-bar .chat-button')]; const r = bs.map((b) => b.getBoundingClientRect()); return { overflowX: document.documentElement.scrollWidth > window.innerWidth, allInside: r.every((x) => x.left >= 0 && x.right <= window.innerWidth), count: bs.length } })()`)
  check(`at ${width}px the header and the chat bar, with the "on" mark on the Instructions button, still fit: no sideways scroll, every control inside`, header.overflowX === false && header.allInside === true, JSON.stringify(header))
  await openDialog()
  await setText('w'.repeat(MAX))
  const fit = await ev(`(() => { const dlg = document.querySelector('dialog.instructions').getBoundingClientRect(); const bs = [...document.querySelectorAll('dialog.instructions button')].map((b) => b.getBoundingClientRect()); return { page: document.documentElement.scrollWidth, inner: window.innerWidth, left: Math.round(dlg.left), right: Math.round(dlg.right), height: Math.round(dlg.height), innerHeight: window.innerHeight, buttonsInside: bs.every((b) => b.left >= dlg.left && b.right <= dlg.right + 1) } })()`)
  check(`at ${width}px the dialog fits: no sideways scroll, inside the window both ways, its buttons inside it`, fit.page <= fit.inner && fit.left >= 0 && fit.right <= fit.inner && fit.height <= fit.innerHeight && fit.buttonsInside, JSON.stringify(fit))
  await page.screenshot(`${shots}/7-4-narrow-${width}.png`)
  await page.press('Escape')
  await closed()
}
await page.send('Emulation.clearDeviceMetricsOverride')
check('the damaged seeded file is still byte for byte as it was written, at the end of the whole run', seededUntouched(['bad']))
check('no console errors, warnings, exceptions or CSP violations in the whole run', page.problems.length === 0, page.problems.join(' | '))
} catch (error) {
  check(`the suite ran to its end (it stopped: ${String(error?.message ?? error).slice(0, 240)})`, false)
  try {
    console.log('page at the stop: ' + JSON.stringify(await ev(`({ messages: document.querySelectorAll('${MSG}').length, editing: !!document.querySelector('.message-edit'), dialogs: [...document.querySelectorAll('dialog')].map((d) => d.className + ':' + d.open), active: document.activeElement?.tagName + '.' + document.activeElement?.className, disabledActions: [...document.querySelectorAll('.message-action')].filter((b) => b.disabled).map((b) => b.textContent), replying: !document.querySelector('.composer-button[type=submit]') })`)))
  } catch { /* the page is gone */ }
}
process.exit(check.summary() ? 0 : 1)
