// Stage 10.2 (D-039), in the real window against the mock: the person's instructions for EVERY chat. The Instructions dialog with every part in the order
// it is sent (every chat, this chat), one box that "Change..." moves; saving new text for every chat asks in the system's own message box (replaced from
// the main inspector, lib10.mjs), a no saves nothing, Escape cannot close the dialog while the box is open; what each request carries (the rules, every
// chat's, then this chat's, each after its own line) and what the cost guess counts; secrets (a saved key refused, a lookalike warned about and saved only
// with "Save anyway", for both parts; a key in either part refused again when a request is made); a damaged file (marked, every request refused, the way
// out keeps a copy); encryption on and off converting the file; the bridge; 420 and 280 px; no console errors.
// Needs: USER_DATA_DIR (scratch), FILES_DIR (outside it, for the backup), INSPECT_PORT, MOCK_PORT, a saved key (setup-key.mjs).
import './ts-resolve.mjs'
import { connect, checker, sleep } from './cdp.mjs'
import { assertScratchProfile } from './profile-guard.mjs'
import { h4, mainInspector, readRetry } from './lib4.mjs'
import { installQuestions } from './lib10.mjs'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { REPO_URL } from './paths.mjs'

const shots = process.argv[2]
const port = Number(process.argv[3] ?? 9222)
const userData = process.env.USER_DATA_DIR
const FILES = process.env.FILES_DIR
const inspectPort = Number(process.env.INSPECT_PORT)
const mockUrl = `http://127.0.0.1:${process.env.MOCK_PORT}`
if (!userData || !FILES || !inspectPort || !process.env.MOCK_PORT) throw new Error('USER_DATA_DIR, FILES_DIR, INSPECT_PORT and MOCK_PORT must be set')
const check = checker()
const page = await connect(port)
await assertScratchProfile()
const H = h4(page, { userData, mockUrl })
const { ev } = H
const main = await mainInspector(inspectPort)
const Q = await installQuestions(main, { fallback: 'no' })
const { estimateInputTokens } = await import(`${REPO_URL}/src/shared/usage.ts`)
const show = (v) => JSON.stringify(v)?.slice(0, 400)
const instrFile = join(userData, 'instructions.json')
const fileText = () => (existsSync(instrFile) ? readRetry(instrFile, 'utf8') : null)
const asideFiles = () => readdirSync(userData).filter((n) => n.startsWith('instructions.json.damaged-'))
const sent = (r) => (r?.provider === 'openai' ? r.body.instructions : r?.body.system)
const EVERY = 'The person has given these instructions for every chat:'
const LEAD = 'The person has given these instructions for this chat:'
const AFTER = 'The person has given these instructions for this chat; where they differ from the instructions above, follow these:'
const EVERY_TEXT = 'I am a nurse in Leeds. Use British spelling and metric units.'
const CHAT_TEXT = 'Answer in one short paragraph.'
// An OpenAI key made here (nothing in this file is a real key), saved through the page's own bridge so that the look for secrets knows it.
const OPENAI_KEY = 'sk-proj-' + 'T4kq9Vw2Lr7Xm3Jc8Hn1Pd6Bs0Gf5Uy2Ze7Wa4Ro9Mi3Vt8Qk1Hx6Nb0Dl5Pj2Cf8Sy3Lu7Ev4Rw9Mq1Ka6Gz0Cn5Hd'
const KEY_PIECE = OPENAI_KEY.slice(20, 48)
const fmt = (n) => n.toLocaleString('en-US')

const bar = () => ev(`(() => { const b = document.querySelector('.chat-bar .chat-instructions'); if (!b) return null; const r = b.getBoundingClientRect(); return { text: b.textContent, title: b.title, mark: b.querySelector('.chat-mark')?.textContent ?? null, warn: !!b.querySelector('.chat-mark-warn'), height: r.height } })()`)
const dlg = () => ev(`(() => {
  const d = document.querySelector('dialog.instructions')
  if (!d) return null
  const parts = [...d.querySelectorAll('.instructions-part')].map((p) => ({ title: p.querySelector('.instructions-part-title')?.textContent ?? null, editing: p.classList.contains('instructions-part-editing'), text: p.querySelector('.instructions-part-text')?.innerText ?? null, change: (() => { const c = p.querySelector('.instructions-change'); return c ? { disabled: c.disabled, title: c.title } : null })(), hasBox: !!p.querySelector('textarea') }))
  const t = d.querySelector('textarea')
  const submit = d.querySelector('button[type=submit]')
  const notice = d.querySelector('.instructions-notice')
  return { open: d.open, heading: d.querySelector('h2')?.textContent ?? null, parts, value: t ? t.value : null, focused: !!t && document.activeElement === t, readOnly: t ? t.readOnly : null, save: submit?.textContent ?? null, saveDisabled: submit ? submit.disabled : null, cancelDisabled: [...d.querySelectorAll('.instructions-footer button')].find((b) => b.textContent === 'Cancel')?.disabled ?? null, buttons: [...d.querySelectorAll('button')].map((b) => b.textContent), notice: notice ? { text: notice.textContent, error: notice.classList.contains('instructions-notice-error'), role: notice.getAttribute('role') } : null, secrets: [...d.querySelectorAll('.instructions-secrets li')].map((li) => li.textContent), text: d.innerText, sideways: d.scrollWidth > d.clientWidth + 1, pageSideways: document.documentElement.scrollWidth > window.innerWidth + 1 }
})()`)
const openDialog = async () => {
  await ev(`document.querySelector('.chat-instructions').scrollIntoView({ block: 'center' })`)
  await page.click('.chat-instructions')
  await page.waitFor(`document.querySelector('dialog.instructions')?.open === true && !!document.querySelector('dialog.instructions textarea')`, { timeoutMs: 6000, label: 'the Instructions dialog to open' })
  await sleep(300) // the window asks main again for the instructions for every chat when the dialog opens
}
const closed = () => page.waitFor(`!document.querySelector('dialog.instructions')?.open`, { timeoutMs: 8000, label: 'the Instructions dialog to close' })
const clickMarked = async (selectorJs) => {
  await ev(`(() => { const b = ${selectorJs}; b.scrollIntoView({ block: 'center' }); b.setAttribute('data-click', '1') })()`)
  await sleep(80)
  await page.click('[data-click="1"]')
  await ev(`document.querySelector('[data-click="1"]')?.removeAttribute('data-click')`)
  await sleep(150)
}
const changeTo = (title) => clickMarked(`[...document.querySelectorAll('dialog.instructions .instructions-part')].find((p) => p.querySelector('.instructions-part-title')?.textContent === ${JSON.stringify(title)}).querySelector('.instructions-change')`)
const footer = (label) => clickMarked(`[...document.querySelectorAll('dialog.instructions .instructions-footer button')].find((b) => b.textContent === ${JSON.stringify(label)})`)
const replaceText = async (text) => {
  await ev(`(() => { const t = document.querySelector('dialog.instructions textarea'); t.focus(); t.select() })()`)
  await sleep(60)
  if (text === '') await page.press('Delete')
  else await page.send('Input.insertText', { text })
  await sleep(120)
}
// A notice, or the dialog gone: a sabotage that saves where it should refuse closes the dialog, and the named check that follows must say so (a wait
// that only times out would leave the control caught by the suite stopping).
const waitNotice = (re) => page.waitFor(`!document.querySelector('dialog.instructions')?.open || ${re}.test(document.querySelector('dialog.instructions .instructions-notice')?.textContent ?? '')`, { timeoutMs: 8000, label: `a notice like ${re} (or the dialog closed)` })
const waitCount = (n) => page.waitFor(`true`, { timeoutMs: 100 }).then(async () => { for (let i = 0; i < 60; i++) { if ((await Q.count()) >= n) return true; await sleep(100) } return false })
const ledgerSent = () => { const f = join(userData, 'usage', 'ledger.jsonl'); return existsSync(f) ? readRetry(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((r) => r.state === 'sent') : [] }
const newChat = async () => { await H.clickChat('New chat'); await sleep(300) }
await ev(`window.__ev = []; window.api.chat.onEvent((e) => window.__ev.push(e)); true`)
const rawChat = async (request) => {
  await ev(`window.__ev.length = 0; window.api.chat.start(${JSON.stringify(request)}); true`)
  for (let i = 0; i < 40; i++) { const evs = await ev(`window.__ev.filter((e) => e.streamId === ${JSON.stringify(request.streamId)})`); if (evs.some((e) => e.type === 'error' || e.type === 'done')) return evs; await sleep(100) }
  return await ev(`window.__ev.filter((e) => e.streamId === ${JSON.stringify(request.streamId)})`)
}

let r
let d
try {
  await page.waitFor(`document.readyState === 'complete' && !!document.querySelector('.header-select, .app-badge')`, { timeoutMs: 15000 })
  await sleep(300)

  // ============ 0. the rules alone, before anything is set ============
  r = await H.askMock('[[mock:count]] before anything is set')
  const BASE = sent(r)
  check('0: with nothing set, the request carries the app\'s rules alone', typeof BASE === 'string' && /^You are Claude, chatting with someone in Frontier App/.test(BASE) && !BASE.includes('The person has given'), show(BASE?.slice(-80)))

  // ============ A. the dialog ============
  let b = await bar()
  check('A: the Instructions button has no mark while nothing is set, and its tooltip offers both kinds', b.text === 'Instructions' && b.mark === null && /for this chat or for every chat/.test(b.title), show(b))
  await openDialog()
  d = await dlg()
  check('A: the dialog is "Instructions", with the parts in the order they are sent: every chat, then this chat', d.heading === 'Instructions' && show(d.parts.map((p) => p.title)) === show(['For every chat', 'For this chat']), show(d.parts))
  check('A: ...the box starts on this chat\'s part (as in 7.4): empty, with the keyboard in it, Save off; every chat\'s says "None." with "Change..."', d.parts[1].editing && d.parts[1].hasBox && !d.parts[0].editing && d.parts[0].text === 'None.' && d.parts[0].change?.disabled === false && d.focused && d.value === '' && d.saveDisabled === true && d.buttons.join() === 'Change...,Cancel,Save', show(d))
  check('A: ...it says the parts are sent after the app\'s rules, in that order', /Sent with every message of this chat, after the app.s own short rules, in this order/.test(d.text))
  await changeTo('For every chat')
  d = await dlg()
  check('A: "Change..." moves the box to every chat\'s part (empty, focused); this chat\'s part now says "None." with its own "Change..."', d.parts[0].editing && d.parts[0].hasBox && d.parts[1].text === 'None.' && d.parts[1].change?.disabled === false && d.focused && d.value === '', show(d.parts))
  check('A: ...and says what this text does: every message of every chat, the company, billed, kept in the data folder (encrypted with the chats), no keys, and the system\'s question', ['every message of every chat', 'company that runs the model', 'billed', "app's data folder", 'encrypted when your chats are', 'Do not put passwords or keys here', 'Windows asks you once more'].every((x) => d.text.includes(x)), d.text.slice(0, 600))
  await replaceText(EVERY_TEXT)
  d = await dlg()
  check('A: typing turns Save on and counts the characters; the other part\'s "Change..." is off until the change is saved or cancelled', d.saveDisabled === false && d.text.includes(`${EVERY_TEXT.length} of 8,000 characters`) && d.parts[1].change?.disabled === true && /Save or cancel/.test(d.parts[1].change.title), show(d.parts[1]))
  check('A: nothing is asked or written by typing', (await Q.count()) === 0 && fileText() === null)
  await Q.hold()
  await footer('Save')
  const asked1 = await waitCount(1)
  d = await dlg()
  check('A: Save asks in the system\'s message box; meanwhile the dialog waits: it says so, the box is read-only, Save and Cancel are off', asked1 && d.notice?.text === 'Waiting for your answer in the Windows message box...' && d.readOnly === true && d.saveDisabled === true && d.cancelDisabled === true, show(d))
  await page.press('Escape')
  await sleep(300)
  check('A: ...and Escape does not close it while the question is open', (await dlg()).open === true)
  const q1 = (await Q.asked())[0]
  check('A: the question: for this window, a warning, "Save these instructions for every chat?", the text and its length, Save first, Cancel the default and the Escape answer', q1.withWindow && q1.options.type === 'warning' && q1.options.title === 'Instructions for every chat' && q1.options.message === 'Save these instructions for every chat?' && q1.options.detail.startsWith(`"${EVERY_TEXT}"`) && q1.options.detail.includes(`${EVERY_TEXT.length} characters. They go to the company that runs the model with every message of every chat`) && show(q1.options.buttons) === show(['Save the instructions', 'Cancel']) && q1.options.defaultId === 1 && q1.options.cancelId === 1 && q1.options.noLink === true, show(q1))
  await Q.queue('no')
  await Q.release()
  await waitNotice(/Not saved/)
  d = await dlg()
  check('A: a no: "Not saved: your instructions for every chat are as they were." (not shown as an error); the dialog stays, with the draft', d.open && d.notice?.text === 'Not saved: your instructions for every chat are as they were.' && d.notice.error === false && d.value === EVERY_TEXT && d.readOnly === false, show(d.notice))
  check('A: ...nothing was written, and the button has no mark', fileText() === null && (await bar()).mark === null)
  await sleep(3300) // the app rests 3 s after a no (10.1)
  await Q.queue('yes')
  await footer('Save')
  await closed()
  check('A: a yes: the dialog closes, and main has written the file: {"version":1,"text":...}', fileText() === JSON.stringify({ version: 1, text: EVERY_TEXT }), fileText())
  b = await bar()
  check('A: the button says "on", and its tooltip says the instructions for every chat are on, how long, and sent with every message', b.mark === 'on' && b.text === 'Instructions on' && b.title.includes(`for every chat are on (${EVERY_TEXT.length} characters)`) && /every message/.test(b.title), show(b))
  await page.screenshot(`${shots}/10-2-on.png`)

  // ============ B. what is sent, and what the guess counts ============
  r = await H.askMock('[[mock:count]] with every chat set')
  check('B: the next request carries the rules, then the line for every chat, then the text, and the (strict) mock accepts it', r !== null && r.problems.length === 0 && sent(r) === `${BASE}\n\n${EVERY}\n\n${EVERY_TEXT}`, show(sent(r)?.slice(-140)))
  check('B: ...the text is in the system prompt only, never among the messages', !JSON.stringify(r.body.messages).includes('nurse in Leeds'))
  const guessed = ledgerSent().at(-1)
  const expected = estimateInputTokens(`${BASE}\n\n${EVERY}\n\n${EVERY_TEXT}`, r.body.messages.map((m) => ({ content: typeof m.content === 'string' ? m.content : m.content.map((x) => x.text ?? '').join('') })))
  check('B: the guess written to the ledger before the request counts the instructions (it is the guess of exactly that system prompt and those messages)', guessed?.tokens?.input === expected, show([guessed?.tokens, expected]))
  check('B: no chat file holds the text for every chat (it is main\'s own, in instructions.json)', H.allConvs().every((c) => !JSON.stringify(c).includes('nurse in Leeds')))
  await openDialog()
  d = await dlg()
  check('B: opened again: every chat\'s part shows its text and "Change..."; the box is on this chat\'s part', d.parts[0].text === EVERY_TEXT && d.parts[0].change?.disabled === false && d.parts[1].editing && d.value === '', show(d.parts))
  await replaceText(CHAT_TEXT)
  await footer('Save')
  await closed()
  b = await bar()
  check('B: this chat\'s own instructions saved too: the tooltip names both parts and their lengths', b.mark === 'on' && b.title.includes(`for every chat (${EVERY_TEXT.length} characters) and for this chat (${CHAT_TEXT.length} characters)`), show(b))
  check('B: ...saving this chat\'s part asked nothing in the system\'s box (it is the page\'s, saved with the chat)', (await Q.count()) === 2)
  r = await H.askMock('[[mock:count]] with both parts')
  check('B: the request: the rules, every chat\'s, then this chat\'s after the line that says these win where they differ', sent(r) === `${BASE}\n\n${EVERY}\n\n${EVERY_TEXT}\n\n${AFTER}\n\n${CHAT_TEXT}`, show(sent(r)?.slice(-220)))
  const withBoth = await H.waitFirst('[[mock:count]] before anything is set', (c) => c.instructions === CHAT_TEXT)
  check('B: the chat\'s file holds only its own instructions', withBoth?.conv.instructions === CHAT_TEXT && !JSON.stringify(withBoth.conv).includes('nurse in Leeds'), show(withBoth?.conv.instructions))
  await newChat()
  b = await bar()
  check('B: New chat: the instructions for every chat still apply (the mark stays, the tooltip names them alone)', b.mark === 'on' && /for every chat are on/.test(b.title), show(b))
  r = await H.askMock('[[mock:count]] a new chat')
  check('B: ...and its request carries every chat\'s part alone', sent(r) === `${BASE}\n\n${EVERY}\n\n${EVERY_TEXT}`, show(sent(r)?.slice(-120)))

  // ============ C. secrets ============
  const saved = await ev(`window.api.settings.setApiKey('openai', ${JSON.stringify(OPENAI_KEY)})`)
  check('C: (an OpenAI key is saved through the bridge, so the look for secrets knows it)', saved.ok === true, show(saved))
  await openDialog()
  await changeTo('For every chat')
  await replaceText(`${EVERY_TEXT} My key is ${KEY_PIECE}.`)
  const before = await Q.count()
  await footer('Save')
  await waitNotice(/API key/)
  d = await dlg()
  check('C: a piece of a saved key in the text for every chat is refused at once: the sentence names OpenAI, no question is asked, the file is as it was', d.open && d.notice?.error === true && /holds your OpenAI API key, which is saved in this app/.test(d.notice.text) && (await Q.count()) === before && fileText() === JSON.stringify({ version: 1, text: EVERY_TEXT }), show(d.notice))
  check('C: ...nothing in the dialog shows the key (the sentence names whose it is)', !d.text.includes(OPENAI_KEY.slice(8, 20)) || d.value.includes(KEY_PIECE), show(d.notice))
  await replaceText(`${EVERY_TEXT} My password: hunter22`)
  await footer('Save')
  await waitNotice(/looks like a key or a password/)
  d = await dlg()
  check('C: text that looks like a password: a warning with the part masked ("password: h•••••••" looks like a password), "Save anyway", no question', d.secrets.length === 1 && d.secrets[0] === 'password: h••••••• looks like a password.' && d.save === 'Save anyway' && (await Q.count()) === before && !d.text.replace(d.value, '').includes('hunter22'), show([d.secrets, d.save]))
  await replaceText(`${EVERY_TEXT} My password: hunter23`)
  d = await dlg()
  check('C: changing the text takes the warning away: the button is "Save" again', d.save === 'Save' && d.secrets.length === 0 && d.notice === null, show([d.save, d.secrets]))
  await footer('Save')
  await waitNotice(/looks like a key or a password/)
  check('C: ...saving the changed text warns again, and asks nothing yet', (await dlg()).save === 'Save anyway' && (await Q.count()) === before)
  await Q.queue('yes')
  await footer('Save anyway')
  await closed()
  const q2 = (await Q.asked()).at(-1)
  check('C: "Save anyway" asks in the system\'s box, which says the person chose to save it anyway; on a yes it is saved', /you chose to save it anyway/.test(q2.options.detail) && fileText() === JSON.stringify({ version: 1, text: `${EVERY_TEXT} My password: hunter23` }), show(q2.options.detail))
  // This chat's part, the same look (main's), no system question.
  await openDialog()
  await replaceText(`Use ${KEY_PIECE} for the API.`)
  await footer('Save')
  await waitNotice(/API key/)
  d = await dlg()
  check('C: this chat\'s part: a piece of a saved key is refused too (named, not shown), and the dialog stays', d.open && /holds your OpenAI API key/.test(d.notice?.text ?? '') && d.notice.error === true, show(d.notice))
  await replaceText('pin: 4321 for the door')
  await footer('Save')
  await waitNotice(/looks like a key or a password/)
  d = await dlg()
  check('C: ...a lookalike gets the warning and "Save anyway"', d.secrets.length === 1 && /looks like a pin/.test(d.secrets[0]) && d.save === 'Save anyway', show(d.secrets))
  const askedBeforeChat = await Q.count()
  await footer('Save anyway')
  await closed()
  check('C: ...and "Save anyway" keeps it with the chat, asking nothing in the system\'s box', (await Q.count()) === askedBeforeChat && (await bar()).title.includes('for this chat (22 characters)'), show(await bar()))
  // Again when a request is made: a key saved AFTER the text was kept, or a page that skips the look.
  const evs1 = await rawChat({ streamId: 'hostile-0101', messages: [{ role: 'user', content: 'hi' }], instructions: `see ${KEY_PIECE}` })
  check('C: a request whose own instructions hold a saved key is refused by main and nothing is sent', evs1.some((e) => e.type === 'error' && /instructions for this chat hold your OpenAI API key/.test(e.message)) && !evs1.some((e) => e.type === 'text'), show(evs1))
  const reqsBefore = (await H.mockReqs()).length
  writeFileSync(instrFile, JSON.stringify({ version: 1, text: `Old note with ${KEY_PIECE} inside` }))
  const evs2 = await rawChat({ streamId: 'hostile-0102', messages: [{ role: 'user', content: 'hi' }] })
  check('C: instructions for every chat that hold a saved key (the file read for every request) refuse it too, naming the part; nothing reaches the provider', evs2.some((e) => e.type === 'error' && /instructions for every chat hold your OpenAI API key/.test(e.message)) && (await H.mockReqs()).length === reqsBefore, show(evs2))
  writeFileSync(instrFile, JSON.stringify({ version: 1, text: EVERY_TEXT }))
  const evs3 = await rawChat({ streamId: 'hostile-0103', messages: [{ role: 'user', content: 'hi' }], everyChat: 'EVIL EVERY', system: 'EVIL SYSTEM' })
  r = (await H.mockReqs()).at(-1)
  check('C: a request from the page that names its own "everyChat" or "system" gets main\'s text and nothing of its own', evs3.some((e) => e.type === 'done') && sent(r) === `${BASE}\n\n${EVERY}\n\n${EVERY_TEXT}` && !JSON.stringify(r.body).includes('EVIL'), show(sent(r)?.slice(-80)))

  // ============ D. a file that cannot be read ============
  writeFileSync(instrFile, '{"version":1,"text":"cut o')
  await openDialog()
  d = await dlg()
  check('D: a damaged file: every chat\'s part says it could not be read, why, and that nothing is sent until it is replaced or turned off', /could not be read \(.*not a file this app wrote.*\)\. Nothing is sent until you replace them or turn them off\./.test(d.parts[0].text ?? ''), show(d.parts[0]))
  await page.press('Escape')
  await closed()
  b = await bar()
  check('D: the button is marked "!" and its tooltip says nothing can be sent', b.mark === '!' && b.warn && /could not be read, so nothing can be sent/.test(b.title), show(b))
  const reqs0 = (await H.mockReqs()).length
  await H.sendAndWait('[[mock:count]] while the file is damaged')
  await sleep(300)
  const shown = await H.screen()
  check('D: sending is refused with what, why and the way out, and nothing reaches the provider', /Nothing was sent: your instructions for every chat could not be read \(.+\)\. Open Instructions to replace them or turn them off\./.test(shown.at(-1)?.note ?? shown.at(-1)?.text ?? '') && (await H.mockReqs()).length === reqs0, show(shown.at(-1)))
  await openDialog()
  await changeTo('For every chat')
  d = await dlg()
  check('D: "Change..." on the damaged part: the box is empty and the button says "Turn off" (there is something to do even with nothing typed)', d.value === '' && d.save === 'Turn off' && d.saveDisabled === false, show([d.value, d.save, d.saveDisabled]))
  const qBefore = await Q.count()
  await footer('Turn off')
  await closed()
  check('D: "Turn off" asks nothing, keeps a copy of the damaged file beside it (byte for byte) and removes it', (await Q.count()) === qBefore && fileText() === null && asideFiles().length === 1 && readFileSync(join(userData, asideFiles()[0]), 'utf8') === '{"version":1,"text":"cut o', show(asideFiles()))
  b = await bar()
  check('D: the mark is gone with them (this chat has its own: "on")', b.mark === 'on' && !b.warn, show(b))
  r = await H.askMock('[[mock:count]] after turning them off')
  check('D: requests go again, with this chat\'s own instructions alone (the 7.4 form)', sent(r) === `${BASE}\n\n${LEAD}\n\npin: 4321 for the door`, show(sent(r)?.slice(-80)))

  // ============ E. encryption on and off converts the file ============
  await openDialog()
  await changeTo('For every chat')
  await replaceText(EVERY_TEXT)
  await Q.queue('yes')
  await footer('Save')
  await closed()
  const backupPath = join(FILES, 'backup-10-2.jsonl')
  await main.inMain(`(() => { const { dialog } = process.mainModule.require('electron'); globalThis.__saves = 0; dialog.showSaveDialog = async () => { globalThis.__saves++; return { canceled: false, filePath: ${JSON.stringify(backupPath)} } }; return true })()`)
  await page.click('.header-button@Settings')
  await page.waitFor(`!!document.querySelector('dialog.settings')?.open`)
  await page.waitFor(`(() => { const s = document.getElementById('settings-storage-heading')?.closest('section')?.querySelector('.settings-status'); return !!s && s.innerText !== 'Checking...' })()`, { timeoutMs: 15000, label: 'the Saved chats section' })
  await clickMarked(`[...document.getElementById('settings-storage-heading').closest('section').querySelectorAll('button')].find((b) => b.textContent.trim() === 'Encrypt my saved chats...')`)
  await page.waitFor(`/encrypted too/.test(document.getElementById('settings-storage-heading').closest('section').innerText)`, { timeoutMs: 30000, label: 'the encryption report' })
  const onText = await ev(`document.getElementById('settings-storage-heading').closest('section').innerText`)
  check('E: turning encryption on says the instructions for every chat are encrypted too', onText.includes('Your instructions for every chat, your notes, your projects, your tool settings and the audit log of tool calls are encrypted too.') /* the notes since 10.4 */, onText.slice(0, 500))
  check('E: ...the file is now the chats\' envelope, and the text is nowhere in it', (fileText() ?? '').startsWith('{"format":"frontier-chat-encrypted"') && !(fileText() ?? '').includes('nurse'), (fileText() ?? '').slice(0, 60))
  await page.press('Escape')
  await sleep(300)
  r = await H.askMock('[[mock:count]] with the file sealed')
  check('E: ...and requests still carry the text, opened by main', sent(r)?.includes(`${EVERY}\n\n${EVERY_TEXT}`), show(sent(r)?.slice(-140)))
  await page.click('.header-button@Settings')
  await page.waitFor(`!!document.querySelector('dialog.settings')?.open`)
  await page.waitFor(`(() => { const s = document.getElementById('settings-storage-heading')?.closest('section')?.querySelector('.settings-status'); return !!s && s.innerText !== 'Checking...' })()`, { timeoutMs: 15000, label: 'the Saved chats section' })
  await Q.queue('yes')
  await clickMarked(`[...document.getElementById('settings-storage-heading').closest('section').querySelectorAll('button')].find((b) => /plain files/.test(b.textContent))`)
  await page.waitFor(`/plain files again too/.test(document.getElementById('settings-storage-heading').closest('section').innerText)`, { timeoutMs: 30000, label: 'the report of going back' })
  check('E: going back to plain files rewrites it as a plain file again, and says so', fileText() === JSON.stringify({ version: 1, text: EVERY_TEXT }), fileText())
  await page.press('Escape')
  await sleep(300)

  // ============ F. the bridge ============
  const api = await ev(`({ top: Object.keys(window.api).sort(), instructions: Object.keys(window.api.instructions).sort() })`)
  check('F: window.api has instructions (since 10.2) with exactly checkForChat, getEveryChat and setEveryChat; nothing that writes the prompt or answers a question', show(api) === show({ top: ['attachments', 'audit', 'changes', 'chat', 'connectors', 'history', 'images', 'instructions', 'memory', 'programs', 'projects', 'settings', 'tools', 'usage', 'voice', 'workspace'], instructions: ['checkForChat', 'getEveryChat', 'setEveryChat'] }), show(api))
  const bad = await ev(`Promise.all([window.api.instructions.setEveryChat(12345), window.api.instructions.setEveryChat({ text: 'x' }), window.api.instructions.checkForChat(null)])`)
  check('F: text that is not text is "not understood" by main, and changes nothing', bad.every((x) => x.ok === false && /not understood/.test(x.error)) && fileText() === JSON.stringify({ version: 1, text: EVERY_TEXT }), show(bad))

  // ============ G. narrow windows ============
  for (const width of [420, 280]) {
    await page.send('Emulation.setDeviceMetricsOverride', { width, height: 700, deviceScaleFactor: 1, mobile: false })
    await sleep(300)
    await openDialog()
    d = await dlg()
    b = await bar()
    check(`G: at ${width} px the dialog has no sideways scroll, nor the page, and the button's label stays on one line`, !d.sideways && !d.pageSideways && b.height <= 30, show([d.sideways, d.pageSideways, b.height]))
    await page.screenshot(`${shots}/10-2-${width}.png`)
    await page.press('Escape')
    await closed()
  }
  await page.send('Emulation.clearDeviceMetricsOverride')
  await sleep(200)
} catch (error) {
  check(`the suite stopped before its end: ${String(error?.stack ?? error).slice(0, 400)}`, false)
}

check('the page logged no errors and no warnings', page.problems.length === 0, show(page.problems))
main.close()
page.close()
process.exit(check.summary() ? 0 : 1)
