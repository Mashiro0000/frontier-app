// Stage 7.3 (D-026), in the real window against the mock: Copy on every message, Regenerate on the last reply (Try again after a failure),
// Edit and send again on the person's own messages, what each one sends, what it replaces on screen and in the saved chat, what it asks
// first, and that it all waits for a reply that is arriving. The mock's `count` directive answers "Reply N" (N = requests received), so a
// reply asked for again is visibly a new one. Needs: MOCK_PORT, USER_DATA_DIR (scratch), INSPECT_PORT (main's inspector, for the clipboard).
import './ts-resolve.mjs'
import { connect, checker, sleep } from './cdp.mjs'
import { assertScratchProfile } from './profile-guard.mjs'
import { helpers } from './lib3.mjs'
import { mainInspector } from './lib4.mjs'
import { randomBytes } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const shots = process.argv[2]
const port = Number(process.argv[3] ?? 9222)
const mockUrl = `http://127.0.0.1:${process.env.MOCK_PORT}`
const userData = process.env.USER_DATA_DIR
if (!process.env.MOCK_PORT || !userData || !process.env.INSPECT_PORT) throw new Error('MOCK_PORT, USER_DATA_DIR and INSPECT_PORT must be set')
const check = checker()
const page = await connect(port)
await assertScratchProfile()
const H = helpers(page, { userData, mockUrl })
const { ev } = H
const main = await mainInspector(Number(process.env.INSPECT_PORT))
const READY = `document.readyState === 'complete' && !!document.querySelector('.header-select, .app-badge')`
const SEND_READY = `!!document.querySelector('.composer-button[type=submit]')`
const OPUS = 'claude-opus-5-5', SONNET = 'claude-sonnet-5-5'
const fakeKey = () => 'test-' + randomBytes(24).toString('hex')
const reset = () => fetch(`${mockUrl}/__reset`, { method: 'POST' })
const reqs = () => H.mockReqs()

// ---- the clipboard, in main (this Electron may answer a Promise: settle it there) ----
const clipboard = async () => {
  await main.inMain(`(globalThis.__clip = undefined, Promise.resolve(process.mainModule.require('electron').clipboard.readText()).then((t) => { globalThis.__clip = t }), true)`)
  for (let i = 0; i < 60; i++) { const t = await main.inMain(`globalThis.__clip`); if (typeof t === 'string') return t; await sleep(50) }
  return null
}
const setClipboard = async (t) => {
  await main.inMain(`(globalThis.__clipSet = false, Promise.resolve(process.mainModule.require('electron').clipboard.writeText(${JSON.stringify(t)})).then(() => { globalThis.__clipSet = true }), true)`)
  for (let i = 0; i < 60; i++) { if (await main.inMain(`globalThis.__clipSet`)) return true; await sleep(50) }
  return false
}

// ---- the conversation on screen ----
const MSG = '.message-list-inner > .message'
const screen = () => ev(`[...document.querySelectorAll('${MSG}')].map((m) => ({
  role: m.classList.contains('message-user') ? 'user' : 'assistant',
  text: m.querySelector('.bubble')?.innerText ?? null,
  editing: m.classList.contains('message-editing'),
  actions: [...m.querySelectorAll('.message-action')].map((b) => b.textContent),
  disabled: [...m.querySelectorAll('.message-action')].filter((b) => b.disabled).map((b) => b.textContent),
  opacity: m.querySelector('.message-actions') ? getComputedStyle(m.querySelector('.message-actions')).opacity : null,
  caption: m.querySelector('.message-model')?.textContent ?? null,
  note: m.querySelector('.message-note')?.textContent ?? null
}))`)
// Since 7.4 the header is two rows high at the default window size, so an early message of a long chat can be scrolled out of sight: bring it in
// first (a click or a hover at a point above the window lands on nothing).
const intoView = async (index) => { await ev(`document.querySelector('${MSG}:nth-child(${index + 1})')?.scrollIntoView({ block: 'center' })`); await sleep(100) }
const act = async (index, label) => { await intoView(index); return page.click(`${MSG}:nth-child(${index + 1}) .message-action@${label}`) }
const titleOf = (index, label) => ev(`[...document.querySelectorAll('${MSG}:nth-child(${index + 1}) .message-action')].find((b) => b.textContent === ${JSON.stringify(label)})?.title ?? null`)
const editor = () => ev(`(() => { const f = document.querySelector('.message-edit'); if (!f) return null; const t = f.querySelector('textarea'); const b = [...f.querySelectorAll('button')]; return { value: t.value, focused: document.activeElement === t, caret: [t.selectionStart, t.selectionEnd], note: f.querySelector('.message-edit-note')?.textContent ?? null, warning: f.querySelector('.message-edit-warning')?.textContent ?? null, send: b.find((x) => x.type === 'submit')?.textContent, sendDisabled: b.find((x) => x.type === 'submit')?.disabled, buttons: b.map((x) => x.textContent) } })()`)
const setEditor = (text) => ev(`(() => { const t = document.querySelector('.message-edit textarea'); const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; set.call(t, ${JSON.stringify(text)}); t.dispatchEvent(new Event('input', { bubbles: true })); return t.value })()`)
const newChat = async () => { await page.click('.chat-button@New chat'); await page.waitFor(`document.querySelectorAll('${MSG}').length === 0`, { timeoutMs: 6000 }); await sleep(150) }
/** Sends text from the box and waits for the reply to be over; returns the request the mock received. */
const say = async (text) => H.askMock(text)
/** After a click that asks again: waits for the mock to receive a request, then for the reply to be over. */
const afterAsking = async (before) => {
  for (let i = 0; i < 160 && (await reqs()).length === before; i++) await sleep(50)
  await page.waitFor(SEND_READY, { timeoutMs: 15000 })
  await sleep(200)
  const all = await reqs()
  return all.length > before ? all.at(-1) : null
}
const hover = async (index) => {
  await intoView(index)
  const box = await ev(`(() => { const r = document.querySelector('${MSG}:nth-child(${index + 1}) .bubble, ${MSG}:nth-child(${index + 1})').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })()`)
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y })
  await sleep(120)
}
const savedChats = () => {
  const dir = join(userData, 'conversations')
  if (!existsSync(dir)) return []
  return readdirSync(dir).filter((n) => n.endsWith('.json')).map((n) => { try { return JSON.parse(readFileSync(join(dir, n), 'utf8')) } catch { return null } }).filter(Boolean)
}
const savedWhen = async (ok, timeoutMs = 6000) => {
  const t0 = Date.now()
  for (;;) {
    const hit = savedChats().find(ok)
    if (hit || Date.now() - t0 > timeoutMs) return hit ?? null
    await sleep(100)
  }
}
const contents = (conv) => conv.messages.map((m) => m.content)

let savedClipboard = null
try {
await page.waitFor(READY, { timeoutMs: 20000 })
await page.send('Emulation.setFocusEmulationEnabled', { enabled: true })
await ev(`window.api.settings.setApiKey('anthropic', ${JSON.stringify(fakeKey())}).then((r) => r.ok)`)
await page.send('Page.reload')
await sleep(600)
await page.waitFor(READY, { timeoutMs: 20000 })
savedClipboard = await clipboard()
await reset()

// ============ A. three exchanges, and what is offered under each message ============
await say('[[mock:count]] one')
await say('[[mock:count]] two')
await say('[[mock:count]] three')
await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 5 }) // the pointer is over no message
await sleep(150)
let s = await screen()
check('three exchanges are on screen: u1 a1 u2 a2 u3 a3, the replies counting "Reply 1/2/3"', s.length === 6 && s.map((m) => m.text).join('|') === '[[mock:count]] one|Reply 1|[[mock:count]] two|Reply 2|[[mock:count]] three|Reply 3', JSON.stringify(s.map((m) => m.text)))
check('every message has Copy; the person\'s three messages have Edit; only the LAST reply has Regenerate', s.every((m) => m.actions.includes('Copy')) && s.filter((m) => m.actions.includes('Edit')).length === 3 && s.every((m, i) => (m.role === 'user') === m.actions.includes('Edit')) && s.map((m, i) => (m.actions.includes('Regenerate') ? i : -1)).filter((i) => i >= 0).join() === '5', JSON.stringify(s.map((m) => m.actions)))
check('nothing is disabled while no reply is arriving', s.every((m) => m.disabled.length === 0))
check('the buttons of an older message are hidden until the pointer is over it, and always shown under the last one', s[0].opacity === '0' && s[5].opacity === '1', JSON.stringify([s[0].opacity, s[5].opacity]))
await hover(0)
check('...and the pointer over a message shows them', (await screen())[0].opacity === '1')
await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 5 })
await ev(`document.querySelector('${MSG}:nth-child(3) .message-action').focus()`)
check('...so does the keyboard being in it (focus within)', (await screen())[2].opacity === '1')
await ev(`document.activeElement.blur()`)
const tipRegen = await titleOf(5, 'Regenerate'), tipEdit = await titleOf(0, 'Edit')
check('the tooltips say the conversation is billed again, and that Regenerate replaces the reply and Edit what came after', /billed again/.test(tipRegen) && /replaced/.test(tipRegen) && /billed again/.test(tipEdit) && /replaced/.test(tipEdit), `${tipRegen} || ${tipEdit}`)
await page.screenshot(`${shots}/7-3-actions.png`)

// ============ B. Copy ============
await setClipboard('SENTINEL-BEFORE')
check('showing messages does not touch the clipboard', (await clipboard()) === 'SENTINEL-BEFORE')
await act(1, 'Copy')
await page.waitFor(`document.querySelector('${MSG}:nth-child(2) .message-action').textContent === 'Copied'`, { timeoutMs: 4000, label: 'the button to say Copied' })
check('Copy on a reply puts exactly its text on the clipboard, and the button says Copied', (await clipboard()) === 'Reply 1', JSON.stringify(await clipboard()))
await act(2, 'Copy')
await page.waitFor(`document.querySelector('${MSG}:nth-child(3) .message-action').textContent === 'Copied'`, { timeoutMs: 4000, label: 'the button on the person\'s message to say Copied' })
check('Copy on the person\'s own message puts it there exactly as typed', (await clipboard()) === '[[mock:count]] two', JSON.stringify(await clipboard()))
await page.waitFor(`document.querySelector('${MSG}:nth-child(2) .message-action').textContent === 'Copy'`, { timeoutMs: 4000, label: 'the first button to say Copy again' })
await reset()
const mdSource = '# Title\n\nSome **bold** and `code` and a [link](https://example.com/).\n\n```py\nprint(1)\n```'
await say(`[[mock:say]] ${mdSource}`)
s = await screen()
await act(s.length - 1, 'Copy')
await page.waitFor(`document.querySelector('${MSG}:last-child .message-action').textContent === 'Copied'`, { timeoutMs: 4000, label: 'Copied on the Markdown reply' })
check('Copy on a Markdown reply copies the Markdown as written (the ** and the fence), not the drawn text', (await clipboard()).replace(/\r\n/g, '\n') === mdSource, JSON.stringify(await clipboard()))

// ============ C. nothing that asks again while a reply is arriving ============
await newChat()
await say('[[mock:count]] before')
await reset()
const nBefore = (await reqs()).length
await H.send('[[mock:slow]] hold on')
for (let i = 0; i < 100 && (await reqs()).length === nBefore; i++) await sleep(50)
await page.waitFor(`document.querySelectorAll('${MSG}').length === 4 && !!document.querySelector('.composer-button-stop')`, { timeoutMs: 8000 })
await page.waitFor(`(document.querySelector('${MSG}:last-child .bubble')?.innerText ?? '').includes('tick1')`, { timeoutMs: 8000 })
s = await screen()
check('while a reply arrives, Edit is disabled on the person\'s messages and says why', s[0].disabled.includes('Edit') && s[2].disabled.includes('Edit') && /when the reply has finished/.test(await titleOf(0, 'Edit')), JSON.stringify([s[0].disabled, s[2].disabled]))
check('...the reply that is arriving has no Copy and no Regenerate yet', s[3].actions.length === 0, JSON.stringify(s[3].actions))
check('...the earlier reply\'s Regenerate is gone (only the last reply has one), and Copy still works on finished messages', !s[1].actions.includes('Regenerate') && s[1].actions.includes('Copy') && !s[1].disabled.includes('Copy'))
const nMid = (await reqs()).length
await page.click(`${MSG}:nth-child(1) .message-action@Edit`).catch(() => {})
await sleep(300)
check('...clicking a disabled Edit opens nothing and sends nothing', (await editor()) === null && (await reqs()).length === nMid)
await setClipboard('SENTINEL-DURING')
await act(1, 'Copy')
await sleep(300)
check('...Copy on a finished message works meanwhile (it asks nothing of the model)', (await clipboard()) === s[1].text && /^Reply \d+$/.test(s[1].text), JSON.stringify([await clipboard(), s[1].text]))
await page.click('.composer-button-stop')
await page.waitFor(SEND_READY, { timeoutMs: 6000 })
await sleep(200)
s = await screen()
check('after Stop the stopped reply can be asked for again, and Edit is back', s[3].note === 'Stopped' && s[3].actions.includes('Regenerate') && s[0].disabled.length === 0 && s[0].actions.includes('Edit'), JSON.stringify(s[3]))

// ============ D. Regenerate ============
await newChat()
await reset()
await say('[[mock:count]] one')
await say('[[mock:count]] two')
s = await screen()
check('a fresh chat: four messages, the last reply is "Reply 2"', s.length === 4 && s[3].text === 'Reply 2', JSON.stringify(s.map((m) => m.text)))
await ev(`(window.__oldReply = document.querySelector('${MSG}:last-child'), true)`)
let before = (await reqs()).length
await act(3, 'Regenerate')
let r = await afterAsking(before)
s = await screen()
check('Regenerate sends the conversation up to the last question, WITHOUT the reply it replaces', r !== null && r.body.messages.length === 3 && r.body.messages.map((m) => m.role).join() === 'user,assistant,user' && !JSON.stringify(r.body.messages).includes('Reply 2'), JSON.stringify(r?.body?.messages))
check('...and the reply is replaced, not added: still four messages, the last one now "Reply 3", the old element gone', s.length === 4 && s[3].text === 'Reply 3' && (await ev(`window.__oldReply.isConnected`)) === false, JSON.stringify(s.map((m) => m.text)))
check('...the question before it and everything earlier are untouched', s[0].text === '[[mock:count]] one' && s[1].text === 'Reply 1' && s[2].text === '[[mock:count]] two')
check('...it is billed as a request like any other: exactly one request for the click, and the request is a normal one (the strict mock accepts it)', r?.problems.length === 0 && (await reqs()).length === before + 1)
const saved1 = await savedWhen((c) => c.messages.length === 4 && c.messages[3].content === 'Reply 3')
check('...the saved chat has the new reply and still four messages', saved1 !== null && contents(saved1).join('|') === '[[mock:count]] one|Reply 1|[[mock:count]] two|Reply 3', JSON.stringify(saved1 && contents(saved1)))
before = (await reqs()).length
await act(3, 'Regenerate')
r = await afterAsking(before)
check('...and again: "Reply 4"', (await screen()).at(-1).text === 'Reply 4')
// another model, asked again: the reply says who wrote it
await H.chooseInPage(SONNET)
await H.settle(SONNET)
before = (await reqs()).length
await act(3, 'Regenerate')
r = await afterAsking(before)
s = await screen()
check('Regenerate uses the model chosen now (Sonnet), and the new reply says who wrote it', r?.body.model === SONNET && s[3].caption === 'Claude Sonnet 5.5' && s.length === 4, JSON.stringify([r.body.model, s[3].caption]))
await H.chooseInPage(OPUS)
await H.settle(OPUS)

// ============ E. a failed reply: Try again ============
await newChat()
await reset()
await H.askMock('[[mock:500]] boom')
s = await screen()
check('a reply that failed offers "Try again" (the same button), not "Regenerate"', s.length === 2 && s[1].note !== null && s[1].actions.includes('Try again') && !s[1].actions.includes('Regenerate'), JSON.stringify(s[1]))
before = (await reqs()).length
await act(1, 'Try again')
r = await afterAsking(before)
check('Try again asks for it again: the same question goes out once more (and fails the same way, as the mock is told to)', r !== null && r.body.messages.length === 1 && /boom/.test(r.body.messages[0].content) && (await screen()).length === 2)
// the way out of it: edit the question
await act(0, 'Edit')
await setEditor('[[mock:count]] fixed')
before = (await reqs()).length
await page.click('.message-edit button@Send')
r = await afterAsking(before)
s = await screen()
check('...and editing the question (no confirmation: only its reply follows) gives a good reply in place of the failed one', s.length === 2 && s[0].text === '[[mock:count]] fixed' && /^Reply \d+$/.test(s[1].text ?? '') && s[1].note === null, JSON.stringify(s.map((m) => m.text)))

// ============ F. Edit and send again ============
await newChat()
await reset()
await say('[[mock:count]] first question')
await say('[[mock:count]] second question')
await say('[[mock:count]] third question')
const convBefore = await savedWhen((c) => c.messages.length === 6)
check('three exchanges saved', convBefore !== null)
await act(0, 'Edit')
let ed = await editor()
s = await screen()
check('Edit opens the message in place: a text box with the message, the caret at its end, focus in it; the bubble is gone', ed !== null && ed.value === '[[mock:count]] first question' && ed.focused && ed.caret[0] === ed.value.length && s[0].editing && s[0].text === null, JSON.stringify(ed))
check('...nothing can be sent yet (the text is unchanged), and the note says what sending does: asks again, billed again, 5 messages replaced, asked first', ed.sendDisabled === true && /billed again/.test(ed.note) && /5 messages/.test(ed.note) && /asked first/.test(ed.note), JSON.stringify(ed))
check('...the message\'s own buttons are gone while it is open', s[0].actions.length === 0)
await page.screenshot(`${shots}/7-3-edit.png`)
await setEditor('   ')
ed = await editor()
check('empty or blank text cannot be sent', ed.sendDisabled === true)
await setEditor('[[mock:count]] first question, edited\nwith a second line')
ed = await editor()
check('changed text can be sent', ed.sendDisabled === false && ed.send === 'Send')
const n0 = (await reqs()).length
await page.click('.message-edit button@Send')
await sleep(300)
ed = await editor()
check('sending asks FIRST, because five messages would go: the warning names them, says they are gone from the saved chat, and nothing was sent', ed !== null && /5 messages/.test(ed.warning ?? '') && /saved chat/.test(ed.warning) && ed.send === 'Send anyway' && (await reqs()).length === n0, JSON.stringify(ed))
await page.screenshot(`${shots}/7-3-confirm.png`)
await setEditor('[[mock:count]] first question, edited again')
ed = await editor()
check('changing the text takes the question back (the warning goes, the button says Send again)', ed.warning === null && ed.send === 'Send')
await page.click('.message-edit button@Send')
await sleep(250)
check('...and it asks again for the new text', /5 messages/.test((await editor())?.warning ?? '') && (await reqs()).length === n0)
await page.click('.message-edit button@Send anyway')
r = await afterAsking(n0)
s = await screen()
check('Send anyway sends the conversation up to the edited message only: ONE message, the new text, nothing of the old replies', r !== null && r.body.messages.length === 1 && r.body.messages[0].content === '[[mock:count]] first question, edited again' && r.problems.length === 0, JSON.stringify(r?.body?.messages))
check('...the screen has two messages now: the edited question and the new reply; the five later ones are gone', s.length === 2 && s[0].text === '[[mock:count]] first question, edited again' && /^Reply \d+$/.test(s[1].text) && !s.some((m) => /second|third/.test(m.text ?? '')), JSON.stringify(s.map((m) => m.text)))
check('...the keyboard is back in the box at the bottom, ready for the next message', await ev(`document.activeElement?.classList.contains('composer-input')`))
const convAfter = await savedWhen((c) => c.messages.length === 2 && /edited again/.test(c.messages[0].content))
check('...the saved chat has the two messages (the removed ones are gone from the file), and its title follows the first message', convAfter !== null && convAfter.messages.length === 2 && /edited again/.test(convAfter.title ?? ''), JSON.stringify(convAfter && { title: convAfter.title, n: convAfter.messages.length }))
check('...and no file for the old, longer version is left beside it (one chat, one file)', savedChats().filter((c) => c.messages.some((m) => /third question/.test(m.content))).length === 0)

// editing the LAST question: only its reply follows, so no question is asked
await say('[[mock:count]] another one')
await say('[[mock:count]] and the last')
await act(4, 'Edit')
ed = await editor()
check('editing the last question: the note says one reply is replaced, and there is no "asked first"', /reply after this message is replaced/.test(ed.note) && !/asked first/.test(ed.note), JSON.stringify(ed.note))
await setEditor('[[mock:count]] and the last, changed   ') // trailing spaces: the text that goes out is trimmed, as when it is typed in the box
const n1 = (await reqs()).length
await page.click('.message-edit button@Send')
r = await afterAsking(n1)
s = await screen()
check('...Send goes straight out (no confirmation): the earlier conversation plus the changed question, its old reply replaced', r !== null && r.body.messages.length === 5 && r.body.messages.at(-1).content === '[[mock:count]] and the last, changed' && s.length === 6 && s[4].text === '[[mock:count]] and the last, changed', JSON.stringify(r?.body?.messages?.map((m) => m.content)))

// the ways out, and the keys
await act(2, 'Edit')
await page.press('Escape')
await sleep(200)
s = await screen()
check('Escape closes the editor and changes nothing', (await editor()) === null && s.length === 6 && s[2].text === '[[mock:count]] another one' && !s[2].editing)
await act(2, 'Edit')
await setEditor('typed but cancelled')
await page.click('.message-edit button@Cancel')
await sleep(200)
check('Cancel closes it, the message is as before, and nothing was sent', (await editor()) === null && (await screen())[2].text === '[[mock:count]] another one' && (await reqs()).length === n1 + 1)
await act(2, 'Edit')
await ev(`(() => { const t = document.querySelector('.message-edit textarea'); t.focus(); t.setSelectionRange(t.value.length, t.value.length) })()`)
await page.send('Input.insertText', { text: ' more' })
await page.press('Enter', { shift: true })
await page.send('Input.insertText', { text: 'next line' })
ed = await editor()
check('Shift+Enter makes a new line in the editor instead of sending', ed !== null && ed.value.endsWith(' more\nnext line') && (await reqs()).length === n1 + 1, JSON.stringify(ed?.value))
await page.press('Escape')
await act(2, 'Edit')
await setEditor('[[mock:count]] sent with the Enter key')
const n2 = (await reqs()).length
await ev(`document.querySelector('.message-edit textarea').focus()`)
await page.press('Enter')
await sleep(300)
ed = await editor()
check('Enter in the editor sends (here it first asks, because later messages would go)', ed !== null && ed.send === 'Send anyway' && (await reqs()).length === n2, JSON.stringify(ed))
await page.press('Enter')
r = await afterAsking(n2)
s = await screen()
check('...and Enter again confirms: the conversation up to that question goes, with the new text', r !== null && r.body.messages.at(-1).content === '[[mock:count]] sent with the Enter key' && r.body.messages.length === 3 && s.length === 4, JSON.stringify(r?.body?.messages?.map((m) => m.content)))

// ============ G. a saved chat can be asked again too ============
await page.send('Page.reload')
await sleep(600)
await page.waitFor(READY, { timeoutMs: 20000 })
await page.click('.chat-button@History')
await page.waitFor(`!!document.querySelector('dialog.history')?.open && document.querySelectorAll('.history-open').length > 0`, { timeoutMs: 8000 })
await page.click('.history-open')
await page.waitFor(`document.querySelectorAll('${MSG}').length > 0 && !document.querySelector('dialog.history')?.open`, { timeoutMs: 8000 })
await sleep(300)
s = await screen()
const nChat = s.length
before = (await reqs()).length
await act(nChat - 1, 'Regenerate')
r = await afterAsking(before)
check('a chat opened from History: its last reply can be asked for again, and the request is that chat\'s conversation without the last reply', r !== null && r.body.messages.length === nChat - 1 && r.body.messages.at(-1).role === 'user' && (await screen()).length === nChat, `${nChat} messages, sent ${r?.body?.messages?.length}`)

// ============ H. narrow, and the whole run ============
for (const width of [420, 320]) {
  await page.send('Emulation.setDeviceMetricsOverride', { width, height: 700, deviceScaleFactor: 1, mobile: false })
  await sleep(200)
  await act(0, 'Edit')
  await setEditor('[[mock:count]] a longer text to edit in a narrow window, with a verylongwordwithoutanyspacesinit'.repeat(2))
  const fit = await ev(`(() => { const f = document.querySelector('.message-edit').getBoundingClientRect(); return { page: document.documentElement.scrollWidth, inner: window.innerWidth, right: Math.round(f.right) } })()`)
  check(`at ${width}px: the editor and the buttons fit, the page does not scroll sideways`, fit.page <= fit.inner && fit.right <= fit.inner, JSON.stringify(fit))
  await page.screenshot(`${shots}/7-3-narrow-${width}.png`)
  await page.press('Escape')
  await sleep(150)
}
await page.send('Emulation.clearDeviceMetricsOverride')
check('no console errors, warnings, exceptions or CSP violations in the whole run', page.problems.length === 0, page.problems.join(' | '))
} catch (error) {
  check(`the suite ran to its end (it stopped: ${String(error?.message ?? error).slice(0, 240)})`, false)
} finally {
  try { if (savedClipboard !== null) await setClipboard(savedClipboard) } catch { /* the app is gone */ }
  main.close()
}
process.exit(check.summary() ? 0 : 1)
