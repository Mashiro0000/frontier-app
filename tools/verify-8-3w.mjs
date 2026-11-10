// Stage 8.3 (D-032), in the real window against the mock: the question before a very large request. A request that SENDS more than the person's amount
// could cost (here 150,000 characters on Claude Fable 5.1, at $12.50 a million tokens, against the default of $0.50) is NOT sent: main works out the most it
// could cost, holds it, and the page shows it with Send and Don't send. While the question is open nothing reaches the provider and nothing is written
// to the ledger. Send sends exactly that request; Don't send (and Escape) ends the reply as "Not sent", with Try again; Regenerate and Edit ask too. The
// limits come first (a request they refuse is not asked about). The amount is changed in Settings (an amount, "Never ask"), and the file holds it. What
// the page cannot do is checked: a yes ahead of the question, twice, for another stream, or a field on the request that claims approval, none of which sends
// anything. Needs: MOCK_PORT, USER_DATA_DIR (scratch; the harness gives it "No limit" for both limits) and a saved key (setup-key.mjs).
import './ts-resolve.mjs'
import { connect, checker, sleep } from './cdp.mjs'
import { assertScratchProfile } from './profile-guard.mjs'
import { h4, readRetry } from './lib4.mjs'
import { sayYesFromMain } from './lib10.mjs'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const shots = process.argv[2]
const port = Number(process.argv[3] ?? 9222)
const mockUrl = `http://127.0.0.1:${process.env.MOCK_PORT}`
const userData = process.env.USER_DATA_DIR
if (!process.env.MOCK_PORT || !userData) throw new Error('MOCK_PORT and USER_DATA_DIR must be set')
const check = checker()
const page = await connect(port)
await assertScratchProfile()
// Since 10.1 (D-039) a change that lets the app spend more is asked about in the system's own message box: this suite stands in for the person from
// main and says yes to every such question (it tests the limits, not the question; verify-10-1w.mjs tests the question).
const standIn = await sayYesFromMain()
const H = h4(page, { userData, mockUrl })
const { ev } = H
const MSG = '.message-list-inner > .message'
const FABLE = 'claude-fable-5-1'
const askFile = join(userData, 'ask-first.json')
const ledgerFile = join(userData, 'usage', 'ledger.jsonl')
const NOT_SENT = 'Not sent: you chose not to send this request.'

const ledger = () => (existsSync(ledgerFile) ? readRetry(ledgerFile, 'utf8').split('\n').filter((l) => l !== '').map((l) => JSON.parse(l)) : [])
const ledgerLines = () => ledger().length
const askText = () => (existsSync(askFile) ? readRetry(askFile, 'utf8') : null)
const reqCount = async () => (await H.mockReqs()).length
const status = () => ev('window.api.settings.getStatus()')
const asked = () => ev(`!!document.querySelector('dialog.large-request')?.open`)
const waitAsking = () => page.waitFor(`!!document.querySelector('dialog.large-request')?.open`, { timeoutMs: 20000, label: 'the question about a large request' })
const waitNoQuestion = () => page.waitFor(`!document.querySelector('dialog.large-request')?.open`, { timeoutMs: 8000, label: 'the question to close' })
const stray = () => readdirSync(userData).filter((n) => /ask-first/i.test(n))

// The text of a request, `chars` long, that the mock answers with a short "Reply N" (the directive is at the start, and stays whole).
const FILLER = 'lorem ipsum dolor sit amet '
const bigText = (chars, tag) => `[[mock:count]] ${tag} ${FILLER.repeat(Math.ceil(chars / FILLER.length))}`.slice(0, chars)

// What the question should say, worked out here, apart from the app: tokens from what was really sent, money at Fable's prices.
const contentText = (c) => (typeof c === 'string' ? c : c.map((b) => b.text ?? '').join(''))
const tokensOfBody = (body) => Math.ceil((Buffer.byteLength(body.system) + body.messages.reduce((n, m) => n + Buffer.byteLength(contentText(m.content)), 0)) / 3) + 4 * body.messages.length
const ceilCents = (usd) => Math.max(0, Math.ceil(usd * 100 - 1e-7))
const money = (cents) => `$${(cents / 100).toFixed(2)}`
const kTokens = (n) => (n >= 1_000_000 ? `${Math.round(n / 100_000) / 10}M` : n >= 1000 ? `${Math.round(n / 100) / 10}K` : String(n))
const figures = (tokens, pricePerM = 12.5, ceiling = 16_000, outPerM = 50) => {
  const input = ceilCents((tokens * pricePerM) / 1e6)
  const output = ceilCents((ceiling * outPerM) / 1e6)
  return { input: money(input), output: money(output), total: money(input + output) }
}

/** What the open question says: title, introduction, rows (label, tokens, money), hints, buttons, and what has the keyboard. */
const asking = () => ev(`(() => {
  const d = document.querySelector('dialog.large-request')
  if (!d || !d.open) return null
  return {
    title: d.querySelector('h2')?.textContent ?? null,
    intro: d.querySelector('.large-request-intro')?.textContent ?? null,
    rows: [...d.querySelectorAll('tbody tr')].map((tr) => [tr.querySelector('th').firstChild.textContent.trim(), tr.querySelector('.large-request-tokens')?.textContent ?? '', tr.querySelector('td').textContent]),
    hints: [...d.querySelectorAll('.settings-hint:not(.large-request-intro)')].map((p) => p.textContent),
    buttons: [...d.querySelectorAll('.settings-actions button')].map((b) => b.textContent),
    focused: document.activeElement?.textContent ?? null,
    modal: d.matches(':modal'),
    replying: !!document.querySelector('.composer-button-stop')
  }
})()`)
const events = () => ev(`window.__ev.slice()`)
const install = () => ev(`(() => { window.__ev = []; window.api.chat.onEvent((e) => window.__ev.push(e)); return true })()`)
const lastConfirm = async () => (await events()).filter((e) => e.type === 'confirm').at(-1)
const clickAnswer = async (text) => { await page.click(`dialog.large-request .settings-actions button@${text}`) }
const noteText = () => H.noteText()
const action = (text) => `${MSG}:last-child .message-action@${text}`
const newChat = async () => {
  await page.click('.chat-button@New chat')
  await page.waitFor(`document.querySelectorAll('${MSG}').length === 0`, { timeoutMs: 6000 })
  await sleep(200)
}
/** A request made straight through the bridge: starts it, and answers what main said so far (events), after a short wait. */
const bridge = (messages, extra = {}, waitMs = 1500, id = null) => ev(`new Promise((resolve) => {
  const id = ${id === null ? 'crypto.randomUUID()' : JSON.stringify(id)}
  const seen = []
  const off = window.api.chat.onEvent((e) => { if (e.streamId === id) seen.push(e) })
  window.api.chat.start({ streamId: id, messages: ${JSON.stringify(messages)}, ...${JSON.stringify(extra)} })
  setTimeout(() => { off(); resolve({ id, seen }) }, ${waitMs})
})`)
const fill = async (id, text) => {
  if (text === '') {
    await ev(`(() => { const i = document.getElementById(${JSON.stringify(id)}); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, ''); i.dispatchEvent(new Event('input', { bubbles: true })) })()`)
    return
  }
  await ev(`(() => { const i = document.getElementById(${JSON.stringify(id)}); i.focus(); i.select() })()`)
  await page.type(text)
}
const reveal = async (selector) => { await ev(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({ block: 'center' })`); await sleep(80) }
const openSettings = async () => {
  await page.click('.header-button@Settings')
  await page.waitFor(`!!document.querySelector('dialog.settings')?.open && !!document.getElementById('ask-first-amount')`, { timeoutMs: 8000, label: 'Settings with the large-request section' })
  await sleep(150)
}
const closeSettings = async () => { await page.press('Escape'); await page.waitFor(`!document.querySelector('dialog.settings')?.open`, { timeoutMs: 4000 }); await sleep(150) }
/** What the large-request form in Settings shows. */
const form = () => ev(`(() => {
  const i = document.getElementById('ask-first-amount')
  const w = i.closest('.limit-field')
  const root = i.closest('form')
  const section = i.closest('section')
  return { value: i.value, placeholder: i.placeholder, disabled: i.disabled, never: w.querySelector('.limit-none input').checked, neverLabel: w.querySelector('.limit-none').textContent.trim(), error: w.querySelector('.settings-notice-error')?.textContent ?? null, saveOff: root.querySelector('button[type=submit]').disabled, warning: root.querySelector('.limits-warning')?.textContent ?? null, notice: root.querySelector('p[role=status]')?.textContent ?? null, inForce: section.querySelector('.settings-status')?.textContent ?? null, text: section.innerText }
})()`)
const clickNever = async () => {
  await ev(`(() => { const l = document.getElementById('ask-first-amount').closest('.limit-field').querySelector('.limit-none'); l.scrollIntoView({ block: 'center' }); l.setAttribute('data-click', '1') })()`)
  await sleep(80)
  await page.click('[data-click="1"]')
  await ev(`document.querySelector('[data-click="1"]')?.removeAttribute('data-click')`)
  await sleep(80)
}
const saveForm = async () => {
  await reveal('dialog.settings #ask-first-amount')
  await ev(`document.getElementById('ask-first-amount').closest('form').querySelector('button[type=submit]').setAttribute('data-click', '1')`)
  await page.click('[data-click="1"]')
  await ev(`document.querySelector('[data-click="1"]')?.removeAttribute('data-click')`)
  await page.waitFor(`document.getElementById('ask-first-amount').closest('form').querySelector('p[role=status]')?.textContent === 'Saved.'`, { timeoutMs: 6000, label: 'the choice to be saved' })
}
/** Sets the amount in Settings, saves it, closes Settings. */
const setAmount = async (text) => { await openSettings(); const f = await form(); if (f.never) await clickNever(); await fill('ask-first-amount', text); await saveForm(); await closeSettings() }
const setNever = async () => { await openSettings(); const f = await form(); if (!f.never) await clickNever(); await saveForm(); await closeSettings() }

try {
  await page.waitFor(`document.readyState === 'complete' && !!document.querySelector('.header-select, .app-badge')`, { timeoutMs: 15000 })
  await sleep(400)
  await install()

  // ============ A. the default, and the bridge as the page has it ============
  check('a profile that has never chosen has no ask-first.json', askText() === null)
  check('the status main gives says nothing is chosen (the default amount applies)', JSON.stringify((await status()).askFirst) === '{"kind":"default"}', JSON.stringify((await status()).askFirst))
  check('window.api.chat is exactly cancel / confirm / onEvent / start (confirm is new in 8.3)', (await ev(`JSON.stringify(Object.keys(window.api.chat).sort())`)) === '["cancel","confirm","onEvent","start"]')
  check('window.api.settings has setAskFirst (and nothing that reads the file or the ledger)', (await ev(`JSON.stringify(Object.keys(window.api.settings).sort())`)) === JSON.stringify(['clearApiKey', 'getStatus', 'setApiKey', 'setAskFirst', 'setEffort', 'setLimits', 'setModel', 'testApiKey'].sort()))

  // ============ B. a small request goes without a question ============
  const small = await H.askMock('hello, a small one')
  check('a small request is sent at once: the mock got it, and no question was shown', !!small && !(await asked()) && !(await events()).some((e) => e.type === 'confirm'))
  const smallBody = small.body
  await H.chooseInPage(FABLE)
  await H.settle(FABLE)
  const modelLabel = (await status()).models.find((m) => m.id === FABLE).label
  check('the model is now Claude Fable 5.1 ($10 in, $12.50 to write to the cache, $50 out a million tokens)', modelLabel === 'Claude Fable 5.1')
  await newChat()

  // ============ C. a large request asks, and nothing is sent while it asks ============
  let mock0 = await reqCount()
  let lines0 = ledgerLines()
  await H.send(bigText(150_000, 'C1'))
  await waitAsking()
  let q = await asking()
  await sleep(900) // long enough for a request to have reached the mock if one were going to
  check('a 150,000-character request on Fable 5.1 (about $0.63 to send, over the default $0.50) opens the question, a modal dialog', !!q && q.modal && q.title === 'Send this large request?', JSON.stringify(q))
  check('...and while the question is open NOTHING reached the provider, and nothing was written to the ledger', (await reqCount()) === mock0 && ledgerLines() === lines0)
  const c1 = await lastConfirm()
  check('...main said which model would answer (Fable 5.1), the amount it asked above ($0.50), and the reply ceiling (16,000 tokens at $50 a million = $0.80)', c1.model === FABLE && c1.askAboveUsd === 0.5 && c1.estimate.outputTokens === 16_000 && Math.abs(c1.estimate.outputUsd - 0.8) < 1e-9, JSON.stringify(c1))
  check('...and the input at the DEARER of the two input prices: the cache-write price $12.50, not the $10 input price', Math.abs(c1.estimate.inputUsd - (c1.estimate.inputTokens * 12.5) / 1e6) < 1e-9 && Math.abs(c1.estimate.totalUsd - (c1.estimate.inputUsd + 0.8)) < 1e-9)
  const want = figures(c1.estimate.inputTokens)
  check('the dialog\'s rows say what main said, rounded UP to the cent, the rows adding up', JSON.stringify(q.rows) === JSON.stringify([['Sending the conversation', `about ${kTokens(c1.estimate.inputTokens)} tokens`, `up to ${want.input}`], ['The reply', 'at most 16K tokens', `up to ${want.output}`], ['The most it could cost', '', want.total]]), JSON.stringify(q.rows) + ' / ' + JSON.stringify(want))
  check('...the introduction says nothing has been sent yet and names the model', /^Nothing has been sent yet\. Claude Fable 5\.1 would read the whole conversation again/.test(q.intro ?? ''), q.intro)
  check('...one hint says these are guesses at list prices, that a cached conversation costs less, and that the provider\'s invoice decides; the other says it asks above $0.50 and that Settings changes it', q.hints.length === 2 && /guesses at list prices/.test(q.hints[0]) && /cache/.test(q.hints[0]) && /invoice decides/.test(q.hints[0]) && q.hints[1] === 'The app asks when sending the conversation could cost more than $0.50. You can change that in Settings.', JSON.stringify(q.hints))
  check('...two buttons, "Don\'t send" first, and the keyboard is on it (Enter alone cannot send a large request)', JSON.stringify(q.buttons) === JSON.stringify(["Don't send", 'Send']) && q.focused === "Don't send", JSON.stringify([q.buttons, q.focused]))
  check('...and the reply is waiting behind it (the Stop button is showing)', q.replying)
  check('...to a screen reader it is an alert dialog, labelled by its title and described by its introduction', await ev(`(() => { const d = document.querySelector('dialog.large-request'); const by = (attr) => document.getElementById(d.getAttribute(attr))?.textContent ?? null; return d.getAttribute('role') === 'alertdialog' && by('aria-labelledby') === 'Send this large request?' && /^Nothing has been sent yet/.test(by('aria-describedby') ?? '') })()`))
  if (shots) await page.screenshot(`${shots}/8-3-question.png`)

  await clickAnswer('Send')
  await waitNoQuestion()
  await H.waitReady()
  await sleep(300)
  const sentReqs = await H.mockReqs()
  const sentBody = sentReqs.at(-1).body
  check('Send: the dialog closes, the request goes, and the reply arrives (the mock saw exactly one more request)', sentReqs.length === mock0 + 1 && /^Reply \d+$/.test((await H.bubbleText()) ?? ''), String(await H.bubbleText()))
  const lines1 = ledger().slice(lines0)
  check('...and the ledger has its two lines (sent, then done) only now', lines1.length === 2 && lines1[0].state === 'sent' && lines1[1].state === 'done' && lines1[0].id === lines1[1].id, JSON.stringify(lines1.map((l) => l.state)))
  const independent = tokensOfBody(sentBody)
  check('THE SAME NUMBER three times: the tokens the question showed, the ledger\'s first line, and a count made here from the request the mock received are equal', c1.estimate.inputTokens === lines1[0].tokens.input && lines1[0].tokens.input === independent, JSON.stringify([c1.estimate.inputTokens, lines1[0].tokens.input, independent]))
  check('...and what was sent is the conversation that was asked about (the 150,000-character message, last)', contentText(sentBody.messages.at(-1).content).startsWith('[[mock:count]] C1 lorem') && contentText(sentBody.messages.at(-1).content).length === 150_000 && sentBody.model === FABLE && sentBody.max_tokens === 16_000)
  check('...the reply shows its cost line from the provider\'s own report (25 in, 12 out)', /^25 in, 12 out, \$/.test((await H.lastAssistant(`a.querySelector('.message-usage')?.textContent`)) ?? ''))

  // ============ D. "Don't send", Escape, Try again, Edit ============
  await newChat()
  mock0 = await reqCount()
  lines0 = ledgerLines()
  await H.send(bigText(150_000, 'D1'))
  await waitAsking()
  await clickAnswer("Don't send")
  await waitNoQuestion()
  await H.waitReady()
  await sleep(500)
  check('"Don\'t send": the dialog closes, and the reply is the error line "Not sent: you chose not to send this request."', (await noteText()) === NOT_SENT && (await H.lastAssistant(`!!a.querySelector('.message-note-error')`)), String(await noteText()))
  check('...nothing reached the provider and nothing was written to the ledger (not even a "rejected" line: it was never begun)', (await reqCount()) === mock0 && ledgerLines() === lines0)
  check('...the composer is ready again (not replying), and the reply offers "Try again"', (await H.replyReady()) && (await ev(`[...document.querySelectorAll('${MSG}:last-child .message-action')].some((b) => b.textContent === 'Try again')`)))
  await ev(`window.api.chat.confirm(${JSON.stringify((await lastConfirm()).streamId)})`)
  await sleep(800)
  check('...and a yes sent afterwards for that very question (by a script) sends nothing: the declined question is gone from main, not left waiting', (await reqCount()) === mock0 && ledgerLines() === lines0)
  const saved = await H.waitFirst('[[mock:count]] D1', (c) => c.messages.at(-1)?.status === 'error')
  check('...and the chat saved on disk holds the failed reply with that sentence (so a chat opened later says why it has no answer)', saved.conv.messages.at(-1).error === NOT_SENT && saved.conv.messages.at(-1).content === '', JSON.stringify(saved.conv.messages.at(-1)))

  await page.click(action('Try again'))
  await waitAsking()
  q = await asking()
  check('"Try again" asks the question again (it is a request like any other)', !!q && q.title === 'Send this large request?' && (await reqCount()) === mock0)
  await page.press('Escape')
  await waitNoQuestion()
  await H.waitReady()
  await sleep(500)
  check('Escape answers no: "Not sent" again, and nothing was sent or written', (await noteText()) === NOT_SENT && (await reqCount()) === mock0 && ledgerLines() === lines0)
  await ev(`window.api.chat.confirm(${JSON.stringify((await lastConfirm()).streamId)})`)
  await sleep(800)
  check('...and a yes sent afterwards for the question Escape declined sends nothing either', (await reqCount()) === mock0 && ledgerLines() === lines0)

  await page.click(action('Try again'))
  await waitAsking()
  await clickAnswer('Send')
  await waitNoQuestion()
  await H.waitReady()
  await sleep(300)
  check('"Try again" then Send: the request goes this time, and the reply replaces the failure', (await reqCount()) === mock0 + 1 && /^Reply \d+$/.test((await H.bubbleText()) ?? '') && (await noteText()) === null, String(await noteText()))

  // Edit the big message and send it again: asks again
  await ev(`(() => { const m = document.querySelector('${MSG}.message-user'); const b = [...m.querySelectorAll('.message-action')].find((x) => x.textContent === 'Edit'); b.setAttribute('data-click', '1') })()`)
  await page.click('[data-click="1"]')
  await ev(`document.querySelector('[data-click="1"]')?.removeAttribute('data-click')`)
  await page.waitFor(`!!document.querySelector('.message-edit textarea')`, { timeoutMs: 6000 })
  await ev(`(() => { const t = document.querySelector('.message-edit textarea'); const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; set.call(t, ${JSON.stringify(bigText(150_000, 'D2'))}); t.dispatchEvent(new Event('input', { bubbles: true })) })()`)
  await ev(`(() => { const b = [...document.querySelectorAll('.message-edit button')].find((x) => x.type === 'submit'); b.setAttribute('data-click', '1'); b.scrollIntoView({ block: 'center' }) })()`)
  await sleep(200)
  console.log('the edit\'s Send before the click: ' + JSON.stringify(await ev(`(() => { const b = document.querySelector('[data-click="1"]'); const r = b.getBoundingClientRect(); const u = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), vh: innerHeight, disabled: b.disabled, under: u ? u.tagName + '.' + u.className : null } })()`)))
  await page.click('[data-click="1"]')
  await ev(`document.querySelector('[data-click="1"]')?.removeAttribute('data-click')`)
  await waitAsking()
  check('an edited message sent again asks the question too, and nothing is sent while it is open', !!(await asking()) && (await reqCount()) === mock0 + 1)
  await clickAnswer("Don't send")
  await waitNoQuestion()
  await H.waitReady()
  await sleep(400)
  check('...and "Don\'t send" there leaves the edited message in the chat with "Not sent" under it, nothing sent', (await noteText()) === NOT_SENT && (await reqCount()) === mock0 + 1)

  // ============ E. the keyboard ============
  await newChat()
  mock0 = await reqCount()
  await H.send(bigText(150_000, 'E1'))
  await waitAsking()
  check('the question opens with the keyboard on "Don\'t send"', (await asking()).focused === "Don't send")
  await page.press('Enter')
  await waitNoQuestion()
  await H.waitReady()
  await sleep(400)
  check('Enter on the first button (Don\'t send) answers no: "Not sent", nothing sent', (await noteText()) === NOT_SENT && (await reqCount()) === mock0)
  await page.click(action('Try again'))
  await waitAsking()
  await page.press('Tab')
  check('Tab moves the keyboard to "Send", and only there', (await asking()).focused === 'Send')
  await page.press('Enter')
  await waitNoQuestion()
  await H.waitReady()
  await sleep(300)
  check('...Enter on Send sends it', (await reqCount()) === mock0 + 1)

  // a Stop while the question is open (the dialog covers the Stop button, so the script clicks it)
  await newChat()
  mock0 = await reqCount()
  lines0 = ledgerLines()
  await H.send(bigText(150_000, 'E2'))
  await waitAsking()
  await ev(`document.querySelector('.composer-button-stop').click()`)
  await waitNoQuestion()
  await H.waitReady()
  await sleep(500)
  check('a Stop while the question is open closes it, sends nothing, writes nothing, and the reply says "Stopped" (not "Not sent")', (await noteText()) === 'Stopped' && (await reqCount()) === mock0 && ledgerLines() === lines0, String(await noteText()))
  await ev(`window.api.chat.confirm(${JSON.stringify((await lastConfirm()).streamId)})`)
  await sleep(800)
  check('...and a yes sent afterwards for the question that was stopped sends nothing', (await reqCount()) === mock0 && ledgerLines() === lines0)

  // ============ F. the limits come first ============
  await newChat()
  await ev(`window.api.settings.setLimits({ daily: { kind: 'usd', usd: 0.01 }, monthly: { kind: 'none' } })`)
  mock0 = await reqCount()
  lines0 = ledgerLines()
  const eventsBefore = (await events()).length
  await H.send(bigText(150_000, 'F1'))
  await page.waitFor(`!!document.querySelector('.message-assistant:last-child .message-note-error')`, { timeoutMs: 15000, label: 'the limit to refuse the large request' })
  await H.waitReady()
  await sleep(300)
  const refusedNote = (await noteText()) ?? ''
  check('a large request that the daily limit would refuse is NOT asked about: it is refused at once with the limit\'s own sentence', /^Nothing was sent: .*daily limit of \$0\.01/.test(refusedNote) && !(await asked()) && !(await events()).slice(eventsBefore).some((e) => e.type === 'confirm'), refusedNote)
  check('...nothing reached the provider and nothing was written', (await reqCount()) === mock0 && ledgerLines() === lines0)
  await ev(`window.api.settings.setLimits({ daily: { kind: 'none' }, monthly: { kind: 'none' } })`)

  // ============ G. the amount, in Settings ============
  await openSettings()
  let f = await form()
  check('Settings > Large requests: the box is empty with "0.50 (the default)" as its hint, "Never ask" is not ticked, and Save is off', f.value === '' && f.placeholder === '0.50 (the default)' && !f.never && f.saveOff && f.neverLabel === 'Never ask', JSON.stringify(f))
  check('...it says what is in force: "You have not chosen an amount, so the app asks above $0.50."', f.inForce === 'You have not chosen an amount, so the app asks above $0.50.', f.inForce)
  check('...and explains: a large request is one whose sending (the whole conversation, again with every message) could cost more than the amount at list prices; the reply is not part of it; the question shows the most it could cost too', /whole conversation so far/.test(f.text) && /list prices/.test(f.text) && /reply is not part of that/.test(f.text) && /the most it could cost too/.test(f.text), f.text.slice(0, 600))
  if (shots) { await ev(`document.getElementById('settings-ask-first-heading').scrollIntoView({ block: 'start' })`); await sleep(150); await page.screenshot(`${shots}/8-3-settings.png`) }
  await fill('ask-first-amount', 'abc')
  check('a box with text that is not an amount says what to type (and does not call it a limit), and Save stays off', /Type an amount in dollars/.test((await form()).error ?? '') && !/limit/i.test((await form()).error ?? '') && (await form()).saveOff)
  await fill('ask-first-amount', '0')
  check('zero is refused in the box ("more than $0")', /more than \$0/.test((await form()).error ?? ''))
  await fill('ask-first-amount', '20000')
  check('more than $10,000 is refused, pointing to "Never ask"', /\$10,000/.test((await form()).error ?? '') && /Never ask/.test((await form()).error ?? ''))
  await fill('ask-first-amount', '5')
  check('a good amount turns Save on', !(await form()).saveOff && (await form()).error === null)
  await saveForm()
  f = await form()
  check('Save says "Saved.", Save goes off again, and the sentence says "The app asks above $5.00."', f.notice === 'Saved.' && f.saveOff && f.inForce === 'The app asks above $5.00.', JSON.stringify(f))
  check('...main and the file have 5 (ask-first.json is exactly {"version":1,"above":5}, with nothing else by that name)', JSON.stringify((await status()).askFirst) === '{"kind":"usd","usd":5}' && askText() === '{"version":1,"above":5}' && JSON.stringify(stray()) === '["ask-first.json"]', JSON.stringify([askText(), stray()]))
  await closeSettings()
  await newChat()
  mock0 = await reqCount()
  const g1 = await H.askMock(bigText(150_000, 'G1'))
  check('with $5.00 chosen, the same 150,000-character request ($0.63) is sent WITHOUT a question', !!g1 && (await reqCount()) === mock0 + 1 && !(await asked()))

  await setAmount('0.10')
  check('Settings: 0.10 is saved (the file holds {"version":1,"above":0.1})', askText() === '{"version":1,"above":0.1}' && JSON.stringify((await status()).askFirst) === '{"kind":"usd","usd":0.1}', String(askText()))
  await newChat()
  mock0 = await reqCount()
  await H.send(bigText(30_000, 'G2'))
  await waitAsking()
  q = await asking()
  const g2 = await lastConfirm()
  check('with $0.10 chosen, a 30,000-character request (about $0.13 to send) asks, and the question says it asks above $0.10', g2.askAboveUsd === 0.1 && g2.estimate.inputUsd > 0.1 && g2.estimate.inputUsd < 0.2 && q.hints[1] === 'The app asks when sending the conversation could cost more than $0.10. You can change that in Settings.' && (await reqCount()) === mock0, JSON.stringify([g2.askAboveUsd, g2.estimate.inputUsd, q.hints[1]]))
  await clickAnswer('Send')
  await waitNoQuestion()
  await H.waitReady()
  check('...Send sends it', (await reqCount()) === mock0 + 1)
  mock0 = await reqCount()
  await H.send(bigText(8_000, 'G3'))
  await waitAsking()
  check('...and a small new message (8,000 characters, about $0.03 alone) in a chat that is already 30,000 characters long asks too: the WHOLE conversation is what is sent again', (await asked()) && (await lastConfirm()).estimate.inputUsd > 0.1)
  await clickAnswer("Don't send")
  await waitNoQuestion()
  await H.waitReady()

  // "Never ask"
  await setNever()
  check('Settings: "Never ask" is saved: the file holds {"version":1,"above":"never"} and main says never', askText() === '{"version":1,"above":"never"}' && JSON.stringify((await status()).askFirst) === '{"kind":"never"}', String(askText()))
  await openSettings()
  f = await form()
  check('...Settings shows the box off, "Never ask" ticked, a warning that a request is then sent without this question however large (and that the limits still apply), and "The question is off"', f.never && f.disabled && /sent without this question, however large it is/.test(f.warning ?? '') && /spending limits above still stop/.test(f.warning ?? '') && /^The question is off/.test(f.inForce ?? ''), JSON.stringify(f))
  await closeSettings()
  await newChat()
  mock0 = await reqCount()
  const g4 = await H.askMock(bigText(150_000, 'G4'))
  check('with "Never ask" the 150,000-character request goes without a question', !!g4 && (await reqCount()) === mock0 + 1 && !(await asked()))
  await openSettings()
  await clickNever()
  await fill('ask-first-amount', '0.5')
  await saveForm()
  await closeSettings()
  check('...and choosing an amount again turns the question back on (the file holds 0.5)', askText() === '{"version":1,"above":0.5}')

  // ============ H. what the page cannot do ============
  const before = askText()
  const tries = [
    ['the kind "default" (a choice cannot be taken back)', { kind: 'default' }],
    ['an amount of zero', { kind: 'usd', usd: 0 }],
    ['a negative amount', { kind: 'usd', usd: -5 }],
    ['an amount as text', { kind: 'usd', usd: '5' }],
    ['a fraction of a cent', { kind: 'usd', usd: 0.001 }],
    ['more than the most', { kind: 'usd', usd: 10001 }],
    ['no amount', { kind: 'usd' }],
    ['"NEVER" in capitals', { kind: 'NEVER' }],
    ['nothing', null],
    ['a text', 'never']
  ]
  for (const [name, input] of tries) {
    const result = await ev(`window.api.settings.setAskFirst(${JSON.stringify(input)})`)
    check(`setAskFirst with ${name} is refused with a sentence, and nothing changes`, result.ok === false && typeof result.error === 'string' && askText() === before && JSON.stringify((await status()).askFirst) === '{"kind":"usd","usd":0.5}', JSON.stringify(result))
  }
  const clean = await ev(`window.api.settings.setAskFirst({ kind: 'usd', usd: 3, evil: '<b>x</b>', other: 1 })`)
  check('fields the page adds are not kept: the file holds exactly {"version":1,"above":3}', clean.ok === true && askText() === '{"version":1,"above":3}', String(askText()))
  await ev(`window.api.settings.setAskFirst({ kind: 'usd', usd: 0.5 })`)

  // a yes ahead of the question is not remembered
  await newChat()
  mock0 = await reqCount()
  lines0 = ledgerLines()
  const bigMessages = [{ role: 'user', content: bigText(150_000, 'H1') }]
  const early = await ev(`new Promise((resolve) => {
    const id = crypto.randomUUID()
    const seen = []
    const off = window.api.chat.onEvent((e) => { if (e.streamId === id) seen.push(e) })
    window.api.chat.start({ streamId: id, messages: ${JSON.stringify(bigMessages)} })
    window.api.chat.confirm(id) // a yes sent at once, ahead of any question
    window.api.chat.confirm(id)
    setTimeout(() => { off(); resolve({ id, seen }) }, 2000)
  })`)
  check('a yes sent ahead of the question (twice, the moment the request starts) does not approve it: main still asks (a "confirm" event), and sends no text', early.seen.some((e) => e.type === 'confirm') && !early.seen.some((e) => ['text', 'usage', 'done'].includes(e.type)), JSON.stringify(early.seen.map((e) => e.type)))
  check('...nothing reached the provider and nothing was written', (await reqCount()) === mock0 && ledgerLines() === lines0)
  // while it waits: another stream\'s yes, an unknown stream\'s yes, a malformed yes: nothing
  await ev(`window.api.chat.confirm('streamNotAskingZZZ'); window.api.chat.confirm(''); window.api.chat.confirm(5); window.api.chat.confirm(null); window.api.chat.confirm({ id: ${JSON.stringify(early.id)} })`)
  await sleep(700)
  check('while it waits, a yes for another stream, an empty one, a number, null and an object do not approve it', (await reqCount()) === mock0 && ledgerLines() === lines0)
  // a stop (cancel) drops the question; a yes after it is dropped
  await ev(`window.api.chat.cancel(${JSON.stringify(early.id)})`)
  await sleep(400)
  await ev(`window.api.chat.confirm(${JSON.stringify(early.id)})`)
  await sleep(900)
  check('a cancel drops the waiting question, and a yes that comes after it is dropped: still nothing sent, nothing written', (await reqCount()) === mock0 && ledgerLines() === lines0)

  // a field on the request that claims approval is not read
  const claimed = await bridge(bigMessages, { confirmed: true, confirm: true, approved: true, askFirst: 'never', skipConfirmation: true }, 1500)
  check('a request that carries fields claiming approval (confirmed, approved, askFirst "never"...) is still asked about, and nothing is sent', claimed.seen.some((e) => e.type === 'confirm') && !claimed.seen.some((e) => ['text', 'usage', 'done'].includes(e.type)) && (await reqCount()) === mock0, JSON.stringify(claimed.seen.map((e) => e.type)))
  await ev(`window.api.chat.cancel(${JSON.stringify(claimed.id)})`)

  // a yes for the question that IS waiting sends it, once; a second yes after it does nothing
  const real = await ev(`new Promise((resolve) => {
    const id = crypto.randomUUID()
    const seen = []
    const off = window.api.chat.onEvent((e) => {
      if (e.streamId !== id) return
      seen.push(e)
      if (e.type === 'confirm') window.api.chat.confirm(id)
      if (e.type === 'done' || e.type === 'error') {
        window.api.chat.confirm(id) // a yes after the end
        window.api.chat.confirm(id)
        setTimeout(() => { off(); resolve({ id, seen }) }, 700)
      }
    })
    window.api.chat.start({ streamId: id, messages: ${JSON.stringify(bigMessages)} })
    setTimeout(() => { off(); resolve({ id, seen, timedOut: true }) }, 20000)
  })`)
  check('a yes given to the question that is waiting sends the request (confirm, then text, usage and done)', !real.timedOut && real.seen.map((e) => e.type)[0] === 'start' && real.seen.some((e) => e.type === 'confirm') && real.seen.some((e) => e.type === 'text') && real.seen.at(-1).type === 'done', JSON.stringify(real.seen.map((e) => e.type)))
  check('...exactly one request reached the provider, and yes twice more after the end sent no second one', (await reqCount()) === mock0 + 1 && ledgerLines() === lines0 + 2)

  // the question is not asked for a small request through the bridge either
  const smallBridge = await bridge([{ role: 'user', content: '[[mock:count]] small through the bridge' }], {}, 4000)
  check('a small request through the bridge is sent without a question', !smallBridge.seen.some((e) => e.type === 'confirm') && smallBridge.seen.some((e) => e.type === 'done') && (await reqCount()) === mock0 + 2)

  // ============ I. narrow windows ============
  await newChat()
  await H.send(bigText(150_000, 'I1'))
  await waitAsking()
  for (const width of [420, 320, 280]) {
    await page.send('Emulation.setDeviceMetricsOverride', { width, height: 700, deviceScaleFactor: 1, mobile: false })
    await sleep(300)
    const fit = await ev(`(() => { const d = document.querySelector('dialog.large-request'); const r = d.getBoundingClientRect(); const bs = [...d.querySelectorAll('.settings-actions button')].map((b) => b.getBoundingClientRect()); return { dialog: [Math.round(r.left), Math.round(r.right)], overflowX: d.scrollWidth > d.clientWidth, buttonsInside: bs.every((b) => b.left >= r.left - 1 && b.right <= r.right + 1 && b.width > 20), count: bs.length, tableInside: (() => { const t = d.querySelector('table').getBoundingClientRect(); return t.left >= r.left - 1 && t.right <= r.right + 1 })() } })()`)
    check(`at ${width} px wide: the question has no sideways scroll, its table and both buttons stay inside the dialog`, !fit.overflowX && fit.buttonsInside && fit.count === 2 && fit.tableInside, JSON.stringify(fit))
    if (shots) await page.screenshot(`${shots}/8-3-narrow-${width}.png`)
  }
  await page.send('Emulation.clearDeviceMetricsOverride')
  await sleep(200)

  // ============ J. the window reloads while the question is open ============
  mock0 = await reqCount()
  lines0 = ledgerLines()
  await page.send('Page.reload')
  await sleep(800)
  await page.waitFor(`document.readyState === 'complete' && !!document.querySelector('.header-select, .app-badge')`, { timeoutMs: 20000 })
  await sleep(1200)
  check('a reload while the question is open drops it: no dialog after it, and nothing was sent or written (main declined it when the page went away)', !(await asked()) && (await reqCount()) === mock0 && ledgerLines() === lines0)
  await install()
  const afterReload = await H.askMock('[[mock:count]] after the reload')
  check('...and the app still answers normally afterwards', !!afterReload)

  // ============ K. the page is clean ============
  check('no console errors, warnings or exceptions in the page', page.problems.length === 0, page.problems.join(' | '))

  // leave it as the restart suite expects: an amount that is NOT the default, so that reading it back from the file is visible ($0.25: a 90,000-character
  // request on Fable, about $0.37 to send, asks under it and not under the default $0.50)
  await ev(`window.api.settings.setAskFirst({ kind: 'usd', usd: 0.25 })`)
  check('left at $0.25 for the restart', askText() === '{"version":1,"above":0.25}', String(askText()))
  await sleep(300)
} catch (error) {
  // A step that waits for something that never comes (a question that never opens, a reply that never ends) throws here. It is recorded as a failed check
  // that says where, so the summary still prints and a negative control shows as a detection with a name rather than as a crash.
  check(`the suite stopped before its end: ${String(error?.message ?? error).split('\n')[0].slice(0, 240)}`, false)
} finally {
  standIn.main.close()
  page.close()
}
const ok = check.summary()
process.exit(ok ? 0 : 1)
