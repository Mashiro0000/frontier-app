// Stage 8.1 (D-030), in the real window against the mock: what every request is counted as. The ledger file (a line when a request is about
// to be sent, a line when it ends, the later one replacing the earlier), the line under a reply ("25 in, 12 out, $0.0003"), the sums in
// Settings (this chat, today, this month) checked against the file by a second, independent count, a guess marked "about" when there is no
// report (a reply stopped, dropped or cut by a server error, or a provider that reports nothing), nothing owed when the provider turns a
// request away at once (a key, a credit, a rate, a model), Regenerate and Edit each counted, chats kept apart and a chat's sum still there
// after it is opened again from History, a request that cannot be written down is not sent, and what the page cannot do (give a chat id that
// is not one, supply its own usage, read or write the ledger). Needs: MOCK_PORT, USER_DATA_DIR (scratch) and a saved key (setup-key.mjs).
import './ts-resolve.mjs'
import { connect, checker, sleep } from './cdp.mjs'
import { assertScratchProfile } from './profile-guard.mjs'
import { h4, readRetry } from './lib4.mjs'
import { chmodSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const shots = process.argv[2]
const port = Number(process.argv[3] ?? 9222)
const mockUrl = `http://127.0.0.1:${process.env.MOCK_PORT}`
const userData = process.env.USER_DATA_DIR
if (!process.env.MOCK_PORT || !userData) throw new Error('MOCK_PORT and USER_DATA_DIR must be set')
const check = checker()
const page = await connect(port)
await assertScratchProfile()
const H = h4(page, { userData, mockUrl })
const { ev } = H
const MSG = '.message-list-inner > .message'
const OPUS = { inputPerMTok: 4, cacheReadPerMTok: 0.2, cacheWritePerMTok: 5, outputPerMTok: 20 }
const ledgerFile = join(userData, 'usage', 'ledger.jsonl')

// ---- the ledger file, read independently of the app's own reader ----
const lines = () => (existsSync(ledgerFile) ? readRetry(ledgerFile, 'utf8').split('\n').filter((l) => l !== '').map((l) => JSON.parse(l)) : [])
/** The records as they stand: the LAST line of each id (a Map keeps the first position of a key and the last value). */
const records = () => { const m = new Map(); for (const r of lines()) m.set(r.id, r); return [...m.values()] }
const settled = async (count, timeoutMs = 6000) => {
  const t0 = Date.now()
  for (;;) {
    const r = records()
    if (r.length >= count && r.at(-1).state !== 'sent') return r
    if (Date.now() - t0 > timeoutMs) return r
    await sleep(60)
  }
}
const costOf = (t, p = OPUS) => (t.input * p.inputPerMTok + t.cacheRead * p.cacheReadPerMTok + t.cacheWrite * p.cacheWritePerMTok + t.output * p.outputPerMTok) / 1e6
const money = (d) => (d === 0 ? '$0.00' : d < 0.0001 ? 'less than $0.0001' : d < 0.01 ? `$${d.toFixed(4)}` : `$${d.toFixed(2)}`)
const bodyText = (m) => (typeof m.content === 'string' ? m.content : m.content.map((b) => b.text ?? '').join(''))
/** What the app should have guessed for a request's input: the system prompt and every message, bytes / 3, plus 4 a message. */
const guessIn = (body) => Math.ceil((Buffer.byteLength(body.system) + body.messages.reduce((n, m) => n + Buffer.byteLength(bodyText(m)), 0)) / 3) + 4 * body.messages.length
/** The sum the page should show for a list of records (a refused request is not counted), in the page's own words. */
const expected = (recs) => {
  const owed = recs.filter((r) => r.state !== 'rejected')
  const t = { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 }
  let cost = 0, about = false
  for (const r of owed) { for (const k of Object.keys(t)) t[k] += r.tokens[k]; cost += costOf(r.tokens, r.prices); if (r.estimate || r.state === 'sent') about = true }
  const n = (x) => x.toLocaleString('en-US')
  return { detail: `${n(t.input + t.cacheRead + t.cacheWrite)} in, ${n(t.output)} out, ${owed.length === 1 ? '1 request' : n(owed.length) + ' requests'}`, cost: `${about ? 'about ' : ''}${money(cost)}` }
}

// The same sums as numbers, asked of main through the bridge (no dialog to open: the Settings table itself is looked at in a few places only,
// because every click on a window that is covered by another is a chance for the known 5 s stall, tools/README.md).
const numbers = (recs) => {
  const owed = recs.filter((r) => r.state !== 'rejected')
  const t = { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 }
  let cost = 0, about = false
  for (const r of owed) { for (const k of Object.keys(t)) t[k] += r.tokens[k]; cost += costOf(r.tokens, r.prices); if (r.estimate || r.state === 'sent') about = true }
  return { requests: owed.length, tokens: t, cost, about }
}
const sumsNow = (chat = null) => ev(`window.api.usage.summary(${JSON.stringify(chat)})`)
const agrees = (totals, recs) => { const e = numbers(recs); return totals.requests === e.requests && JSON.stringify(totals.tokens) === JSON.stringify(e.tokens) && Math.abs(totals.costUsd - e.cost) < 1e-9 && totals.about === e.about }

// ---- the page ----
const usageRows = async (shotName) => {
  await page.click('.header-button@Settings')
  await page.waitFor(`!!document.querySelector('dialog.settings')?.open && !!document.querySelector('.settings-usage tbody tr')`, { timeoutMs: 8000, label: 'the Usage table' })
  const rows = await ev(`[...document.querySelectorAll('.settings-usage tbody tr')].map((tr) => ({ label: tr.querySelector('th').textContent, detail: tr.children[1].textContent, cost: tr.children[2].textContent }))`)
  if (shotName && shots) {
    await ev(`document.querySelector('.settings-usage')?.scrollIntoView({ block: 'center' })`)
    await sleep(150)
    await page.screenshot(`${shots}/${shotName}.png`)
  }
  await page.press('Escape')
  await sleep(200)
  return rows
}
const row = (rows, start) => rows.find((r) => r.label.startsWith(start))
const usageLine = () => H.lastAssistant(`a.querySelector('.message-usage') ? { text: a.querySelector('.message-usage').textContent, title: a.querySelector('.message-usage').title } : null`)
const lastNote = () => H.noteText()
const reqCount = async () => (await H.mockReqs()).length
const savedId = async (firstText) => (await H.waitFirst(firstText)).id
const newChat = async () => { await page.click('.chat-button@New chat'); await page.waitFor(`document.querySelectorAll('${MSG}').length === 0`, { timeoutMs: 6000 }); await sleep(150) }
const openFromHistory = async (title) => {
  await H.openHistory()
  await H.clickRow(title)
  await page.waitFor(`!document.querySelector('dialog.history')?.open && document.querySelectorAll('${MSG}').length > 0`, { timeoutMs: 8000, label: `"${title}" to open` })
  await sleep(300)
}
/** Sends, waits for the reply to end and the ledger to be settled, and answers { req, recs, last }. */
const ask = async (text, expectCount) => {
  const req = await H.askMock(text)
  const recs = await settled(expectCount)
  await sleep(150)
  return { req, recs, last: recs.at(-1) }
}

try {
  await page.waitFor(`document.readyState === 'complete' && !!document.querySelector('.header-select, .app-badge')`, { timeoutMs: 15000 })
  await sleep(400)

  // ============ A. nothing spent yet ============
  check('before anything is sent there is no ledger file (looking at it does not make one)', !existsSync(ledgerFile))
  let rows = await usageRows()
  check('Settings has a Usage section with three rows: this chat, today (a date) and this month (a month and a year)', rows.length === 3 && /^This chat$/.test(rows[0].label) && /^Today \(\w{3} \d{1,2}\)$/.test(rows[1].label) && /^This month \(\w+ \d{4}\)$/.test(rows[2].label), JSON.stringify(rows.map((r) => r.label)))
  check('...each at 0 in, 0 out, 0 requests and $0.00, and none "about"', rows.every((r) => r.detail === '0 in, 0 out, 0 requests' && r.cost === '$0.00'), JSON.stringify(rows))
  check('...and looking did not make a ledger file either', !existsSync(ledgerFile))
  check('the page can ask for the sums and for nothing else: window.api.usage has one function, summary', (await ev(`JSON.stringify(Object.keys(window.api.usage))`)) === '["summary"]')

  // ============ B. one reply, with the provider's own report (25 in, 12 out) ============
  let r = await ask('hello', 1)
  const first = r.recs[0]
  const idA = await savedId('hello')
  check('the ledger has the record of that request: done, from the provider\'s report (not a guess), 25 in / 12 out, no cache tokens', r.recs.length === 1 && first.state === 'done' && first.estimate === false && JSON.stringify(first.tokens) === JSON.stringify({ input: 25, cacheRead: 0, cacheWrite: 0, output: 12 }), JSON.stringify(first))
  check('...with the model, the effort and the four prices it was counted at (Opus: 4 / 0.2 / 5 / 20, medium)', first.model === 'claude-opus-5-5' && first.provider === 'anthropic' && first.effort === 'medium' && JSON.stringify(first.prices) === JSON.stringify(OPUS), JSON.stringify([first.model, first.effort, first.prices]))
  check('...under the chat that is on screen: the id the conversation is saved under (the page said it, main kept it)', first.chat === idA, `${first.chat} vs ${idA}`)
  check('...with an id and a time that main made (a lower-case uuid, within a minute of now)', /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(first.id) && Math.abs(Date.now() - first.at) < 60_000)
  const all = lines()
  check('the file has two lines for it: one written BEFORE the request went out (sent, a guess of its input only) and one when it ended', all.length === 2 && all[0].state === 'sent' && all[0].estimate === true && all[0].tokens.output === 0 && all[1].state === 'done' && all[0].id === all[1].id, JSON.stringify(all.map((l) => l.state)))
  check('...the first line\'s input guess is what the app really sent: (system prompt + messages) / 3 bytes + 4 a message, by a count of the request the mock received', all[0].tokens.input === guessIn(r.req.body), `${all[0].tokens.input} vs ${guessIn(r.req.body)}`)
  check('...each line carries its cost beside it for a person reading the file', Math.abs(all[1].costUsd - costOf(first.tokens)) < 1e-12 && Math.abs(all[0].costUsd - costOf(all[0].tokens)) < 1e-12)
  const line1 = await usageLine()
  check('under the reply: "25 in, 12 out, $0.0003" (4 dollars a million in, 20 a million out: 0.00034)', line1?.text === '25 in, 12 out, $0.0003', JSON.stringify(line1))
  check('...and what it says when hovered: the four buckets, "the thinking counts as writing", and that the provider\'s invoice decides', /Read 25 tokens, 0 from the provider's cache, and put 0 into it\. Wrote 12 tokens \(the thinking counts as writing\)\. At list prices; your provider's invoice decides\.$/.test(line1?.title ?? ''), line1?.title)
  // 9.6: Settings opened again after a reply must not show the sums of its last opening (0 requests here) while it waits for main: the click and the
  // first look at the table happen in one turn of the page, before main's answer can arrive (it comes as a later task).
  const atOnce = await ev(`(async () => {
    const button = [...document.querySelectorAll('.header-button')].find((b) => b.textContent === 'Settings')
    button.click()
    for (let i = 0; i < 100 && !document.querySelector('dialog.settings')?.open; i++) await Promise.resolve()
    const d = document.querySelector('dialog.settings')
    return { open: !!d?.open, rows: [...(d?.querySelectorAll('.settings-usage tbody tr') ?? [])].map((tr) => tr.textContent), checking: [...(d?.querySelectorAll('.settings-status') ?? [])].some((p) => p.textContent === 'Checking...') }
  })()`)
  check('Settings opened again does not show the sums of its last opening while it waits for main: "Checking..." and no rows, at the moment it opens', atOnce.open && atOnce.rows.length === 0 && atOnce.checking, JSON.stringify(atOnce))
  await page.waitFor(`!!document.querySelector('.settings-usage tbody tr')`, { timeoutMs: 8000, label: 'the new sums' })
  await page.press('Escape')
  await sleep(200)
  rows = await usageRows()
  check('Settings: this chat, today and this month each show 1 request, 25 in, 12 out and $0.0003', rows.every((x) => x.detail === '25 in, 12 out, 1 request' && x.cost === '$0.0003'), JSON.stringify(rows))

  // ============ C. a reply that used the cache ============
  r = await ask('[[mock:cached]] with the cache', 2)
  check('cache tokens are kept in their own buckets: 25 in, 800 read from the cache, 40 written to it, 300 out', JSON.stringify(r.last.tokens) === JSON.stringify({ input: 25, cacheRead: 800, cacheWrite: 40, output: 300 }) && r.last.estimate === false, JSON.stringify(r.last.tokens))
  const line2 = await usageLine()
  check('the line adds the input side up (865 in) and prices each bucket by its own price: (25*4 + 800*0.2 + 40*5 + 300*20) / 1e6 = $0.00646', line2?.text === '865 in, 300 out, $0.0065' && Math.abs(costOf(r.last.tokens) - 0.00646) < 1e-12, JSON.stringify(line2))
  check('...the hover names them: 25 read, 800 from the cache, 40 into it, 300 written', /Read 25 tokens, 800 from the provider's cache, and put 40 into it\. Wrote 300 tokens/.test(line2?.title ?? ''), line2?.title)
  rows = await usageRows()
  const e2 = expected(r.recs)
  check('Settings now: 2 requests, 890 in, 312 out, $0.0068, equal to a second count made from the file', rows.every((x) => x.detail === e2.detail && x.cost === e2.cost) && e2.detail === '890 in, 312 out, 2 requests' && e2.cost === '$0.0068', JSON.stringify([rows, e2]))

  // ============ D. a provider that reports nothing: a guess, marked "about" ============
  r = await ask('[[mock:no-usage]] hi', 3)
  const guess = r.last
  check('a reply with an empty usage report is counted as a guess: done, estimate true, the input guessed from what was sent and the output from the text that arrived ("Echo: hi" = 8 bytes = 3 tokens)', guess.state === 'done' && guess.estimate === true && guess.tokens.input === guessIn(r.req.body) && guess.tokens.output === 3 && guess.tokens.cacheRead === 0 && guess.tokens.cacheWrite === 0, JSON.stringify([guess.state, guess.estimate, guess.tokens, guessIn(r.req.body)]))
  const line3 = await usageLine()
  check('under the reply the cost says "about", and the hover says it is the app\'s own guess', /^\d+ in, 3 out, about \$0\.\d{4}$/.test(line3?.text ?? '') && /This is the app's own guess: the provider gave no report\.$/.test(line3?.title ?? ''), JSON.stringify(line3))
  rows = await usageRows('8-1-settings-about')
  const e3 = expected(r.recs)
  check('Settings marks every sum that holds a guess as "about"', rows.every((x) => x.cost.startsWith('about ') && x.detail === e3.detail && x.cost === e3.cost), JSON.stringify([rows, e3]))

  // ============ E. Stop: no report, so a guess ============
  const before = await reqCount()
  await H.send('[[mock:slow]] go on')
  for (let i = 0; i < 100 && (await reqCount()) === before; i++) await sleep(50)
  await page.waitFor(`(document.querySelector('${MSG}:last-child .bubble')?.innerText ?? '').includes('tick2')`, { timeoutMs: 10000, label: 'a few ticks' })
  await page.click('.composer-button-stop')
  await H.waitReady()
  r = { recs: await settled(4), req: (await H.mockReqs()).at(-1) }
  r.last = r.recs.at(-1)
  const shown = await H.lastAssistant(`a.querySelector('.bubble').innerText`)
  const shownTokens = Math.ceil(Buffer.byteLength(shown) / 3)
  check('a reply the person stopped is counted as stopped: estimate true, the input guessed from what was sent, the output from the text that had arrived (at least what the page shows, and not much more)', r.last.state === 'stopped' && r.last.estimate === true && r.last.tokens.input === guessIn(r.req.body) && r.last.tokens.output >= shownTokens && r.last.tokens.output <= shownTokens + 12, JSON.stringify([r.last.state, r.last.tokens, shownTokens]))
  check('...no line is shown under a stopped reply (the page was told nothing), it says "Stopped", and the guess is in the sums', (await usageLine()) === null && (await lastNote()) === 'Stopped')
  rows = await usageRows()
  const e4 = expected(r.recs)
  check('...Settings counts it (4 requests) and says "about"', rows.every((x) => x.detail === e4.detail && x.cost === e4.cost) && /4 requests$/.test(e4.detail) && e4.cost.startsWith('about'), JSON.stringify([rows, e4]))

  // ============ F. how each failure is counted ============
  const failures = [
    ['401', 'rejected', 'the key is not accepted'], ['403', 'rejected', 'no permission'], ['404', 'rejected', 'no such model'], ['400-credit', 'rejected', 'no credit'],
    ['429', 'rejected', 'a rate limit'], ['529', 'rejected', 'a provider too busy to start'],
    ['500', 'failed', 'a server error (it may have started work)'], ['midstream-error', 'failed', 'an error after some text had arrived'], ['drop', 'failed', 'a connection dropped in the middle'],
    ['max-tokens', 'done', 'cut off at the length limit, with the provider\'s report'], ['refusal', 'done', 'the model declined, with the provider\'s report']
  ]
  let count = 4
  for (const [directive, state, what] of failures) {
    const sumsBefore = await sumsNow(idA)
    count += 1
    const res = await ask(`[[mock:${directive}]] go`, count)
    const rec = res.recs.at(-1)
    const line = await usageLine()
    const bytes = state === 'failed' && ['midstream-error', 'drop'].includes(directive) ? 3 : 0
    const ok = rec.state === state && (state === 'rejected'
      ? rec.estimate === false && JSON.stringify(rec.tokens) === JSON.stringify({ input: 0, cacheRead: 0, cacheWrite: 0, output: 0 })
      : state === 'failed'
        ? rec.estimate === true && rec.tokens.input === guessIn(res.req.body) && rec.tokens.output === bytes
        : rec.estimate === false && rec.tokens.input === 25 && rec.tokens.output === 12)
    check(`${directive}: ${what} -> "${state}" (${state === 'rejected' ? 'nothing owed, not counted' : state === 'failed' ? 'a guess is counted' : 'the real report is counted'})`, ok, JSON.stringify(rec))
    check(`${directive}: ${state === 'rejected' ? 'no line is shown under it' : state === 'failed' ? 'the line says "about"' : 'the line shows the real cost'}`, state === 'rejected' ? line === null : state === 'failed' ? /about \$/.test(line?.text ?? '') : /^25 in, 12 out, \$0\.0003$/.test(line?.text ?? ''), JSON.stringify(line))
    const sumsAfter = await sumsNow(idA)
    check(`${directive}: the sums (chat, today, month) ${state === 'rejected' ? 'are the same as before' : 'have one more request'}, and agree with a count made from the file`, agrees(sumsAfter.chat, res.recs.filter((x) => x.chat === idA)) && agrees(sumsAfter.today, res.recs) && agrees(sumsAfter.month, res.recs) && (state !== 'rejected' ? sumsAfter.today.requests === sumsBefore.today.requests + 1 : JSON.stringify(sumsAfter.today) === JSON.stringify(sumsBefore.today)), JSON.stringify([sumsBefore.today, sumsAfter.today]))
  }

  // ============ G. Regenerate and Edit are requests too ============
  const nA = records().length
  let reqs0 = await reqCount()
  const again = await ev(`[...document.querySelectorAll('${MSG}:last-child .message-action')].map((b) => b.textContent).find((t) => t === 'Regenerate' || t === 'Try again')`)
  await page.click(`${MSG}:last-child .message-action@${again}`)
  for (let i = 0; i < 160 && (await reqCount()) === reqs0; i++) await sleep(50)
  await H.waitReady()
  let recs = await settled(nA + 1)
  check('Regenerate is counted as a request of its own (one more record, the same chat)', recs.length === nA + 1 && recs.at(-1).chat === recs.at(-2).chat && recs.at(-1).state !== 'sent', JSON.stringify(recs.at(-1)))
  // Edit the first message of the chat (what follows it is replaced) and send it again
  reqs0 = await reqCount()
  await ev(`document.querySelector('${MSG}:nth-child(1)')?.scrollIntoView({ block: 'center' })`)
  await sleep(100)
  await page.click(`${MSG}:nth-child(1) .message-action@Edit`)
  await page.waitFor(`!!document.querySelector('.message-edit textarea')`, { timeoutMs: 6000 })
  await ev(`(() => { const t = document.querySelector('.message-edit textarea'); const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; set.call(t, 'hello again'); t.dispatchEvent(new Event('input', { bubbles: true })) })()`)
  await page.click('.message-edit button@Send') // more than the last exchange would go, so it asks first (D-026)
  await page.waitFor(`document.querySelector('.message-edit button[type=submit]')?.textContent === 'Send anyway'`, { timeoutMs: 6000 })
  await page.click('.message-edit button@Send anyway')
  for (let i = 0; i < 160 && (await reqCount()) === reqs0; i++) await sleep(50)
  await H.waitReady()
  recs = await settled(nA + 2)
  check('Edit is counted as a request of its own too (another record; the replaced replies stay counted: they were billed)', recs.length === nA + 2 && recs.at(-1).state !== 'sent', JSON.stringify(recs.at(-1)))
  const chatA = records().filter((x) => x.chat === idA)
  rows = await usageRows()
  check('this chat\'s sum counts every one of them, the replaced ones included, and equals a second count made from the file', JSON.stringify(row(rows, 'This chat')) === JSON.stringify({ label: 'This chat', ...expected(chatA) }) && chatA.length === records().length, JSON.stringify([row(rows, 'This chat'), expected(chatA)]))

  // ============ H. chats are kept apart, and a chat's sum is still there when it is opened again ============
  await newChat()
  rows = await usageRows()
  check('a new chat starts at 0 requests in "This chat", while today and this month keep what has been used', row(rows, 'This chat').detail === '0 in, 0 out, 0 requests' && row(rows, 'This chat').cost === '$0.00' && /requests$/.test(row(rows, 'Today').detail) && !/^0 in/.test(row(rows, 'Today').detail), JSON.stringify(rows))
  const nB = records().length
  r = await ask('second chat', nB + 1)
  const idB = await savedId('second chat')
  check('its request is under its own id (not the first chat\'s)', r.last.chat === idB && idB !== idA && r.last.chat !== idA, `${r.last.chat} / ${idB} / ${idA}`)
  rows = await usageRows()
  check('"This chat" is now just that one request', row(rows, 'This chat').detail === '25 in, 12 out, 1 request' && row(rows, 'This chat').cost === '$0.0003', JSON.stringify(row(rows, 'This chat')))
  check('...today and this month have all of them, equal to a count made from the file', row(rows, 'Today').detail === expected(records()).detail && row(rows, 'This month').detail === expected(records()).detail && row(rows, 'Today').cost === expected(records()).cost, JSON.stringify([rows, expected(records())]))
  await openFromHistory('hello again')
  rows = await usageRows()
  check('opening the first chat again from History: "This chat" is that chat\'s sum from the file again (it is not kept on the page)', JSON.stringify(row(rows, 'This chat')) === JSON.stringify({ label: 'This chat', ...expected(records().filter((x) => x.chat === idA)) }), JSON.stringify(row(rows, 'This chat')))
  check('...and no reply on screen has a usage line (it is not saved with the messages)', (await ev(`document.querySelectorAll('.message-usage').length`)) === 0)
  const nC = records().length
  r = await ask('back in the first chat', nC + 1)
  check('a message sent there is counted under the FIRST chat\'s id again (the page told main which chat is on screen)', r.last.chat === idA, `${r.last.chat} vs ${idA}`)
  check('the saved chat files do not hold any usage or cost (the ledger is the only record, so a chat file keeps its version 3 format)', H.allConvs().every((c) => !/usage|costUsd|cost/i.test(JSON.stringify(c).replace(/"content":"[^"]*"/g, ''))))

  // ============ I. what a page cannot do ============
  const nD = records().length
  const mockBefore = await reqCount()
  const hostile = await ev(`new Promise((resolve) => { const off = window.api.chat.onEvent((e) => { if (e.streamId === 'hostile01') { off(); resolve(e) } }); window.api.chat.start({ streamId: 'hostile01', messages: [{ role: 'user', content: 'x' }], conversationId: 'not-a-chat-id' }) })`)
  check('a request whose conversationId is not an id is refused, with the reason, and nothing reaches the provider or the ledger', hostile.type === 'error' && hostile.message === 'The request was not understood.' && (await reqCount()) === mockBefore && records().length === nD, JSON.stringify(hostile))
  const asNumber = await ev(`window.api.usage.summary(5)`)
  const asText = await ev(`window.api.usage.summary('../../etc/passwd')`)
  const asNull = await ev(`window.api.usage.summary(null)`)
  const real = await ev(`window.api.usage.summary(${JSON.stringify(idA)})`)
  check('asking for the sums of something that is not a chat id gives no chat sum, and the same day and month sums as asking for none', asNumber.chat === null && asText.chat === null && asNull.chat === null && JSON.stringify(asNumber.today) === JSON.stringify(asNull.today) && JSON.stringify(asText.month) === JSON.stringify(asNull.month) && real.chat.requests === records().filter((x) => x.chat === idA && x.state !== 'rejected').length)
  check('the summary has exactly the fields the page needs: chat, today, month, unreadable, at (and no path, no record, no id)', JSON.stringify(Object.keys(real)) === '["chat","today","month","unreadable","at"]' && !/ledger|jsonl|\\\\|usage[\\\\/]/.test(JSON.stringify(real)))
  const nE = records().length
  // the page may add what it likes to a request; none of it is read
  const extra = await ev(`new Promise((resolve) => { let done = false; const off = window.api.chat.onEvent((e) => { if (e.streamId === 'hostile02' && (e.type === 'done' || e.type === 'error')) { off(); resolve(e.type) } }); window.api.chat.start({ streamId: 'hostile02', messages: [{ role: 'user', content: 'with extras' }], usage: { input: 0, output: 0 }, costUsd: 0, estimate: false, ledgerId: 'x', state: 'rejected', prices: { inputPerMTok: 0 }, tokens: { input: 0 } }) })`)
  const recsE = await settled(nE + 1)
  const last = recsE.at(-1)
  check('a request with a usage, a cost, prices, a state and a token count of its own added is answered, and none of it is read: the record has the real report (25 in, 12 out), the registry\'s prices and state "done"', extra === 'done' && last.state === 'done' && last.estimate === false && last.tokens.input === 25 && last.tokens.output === 12 && JSON.stringify(last.prices) === JSON.stringify(OPUS) && last.chat === null, JSON.stringify([extra, last]))
  check('...and it is under no chat (a request that names none), but counted in today and this month', last.chat === null && (await ev(`window.api.usage.summary(null)`)).today.requests === records().filter((x) => x.state !== 'rejected').length)

  // ============ J. a request that cannot be written down is not sent ============
  const nF = records().length
  const mockBeforeBlock = await reqCount()
  chmodSync(ledgerFile, 0o444) // read-only: the next append fails
  await H.send('this one must not go out')
  await page.waitFor(`(document.querySelector('${MSG}:last-child .message-note')?.textContent ?? '').startsWith('Nothing was sent')`, { timeoutMs: 8000, label: 'the refusal' }).catch(() => {})
  await H.waitReady()
  const blocked = await lastNote()
  chmodSync(ledgerFile, 0o666)
  check('with the ledger unwritable the request is NOT sent: the provider received nothing, the reply says "Nothing was sent: what this request would use could not be recorded on this computer."', (await reqCount()) === mockBeforeBlock && blocked === 'Nothing was sent: what this request would use could not be recorded on this computer.', JSON.stringify([blocked, (await reqCount()) - mockBeforeBlock]))
  check('...and nothing was added to the ledger', records().length === nF)
  rows = await usageRows()
  check('...and Settings still shows the sums it showed (nothing is owed for a request that was not made)', JSON.stringify(row(rows, 'Today').detail) === JSON.stringify(expected(records()).detail))
  r = await ask('after the file is writable again', nF + 1)
  check('when the file can be written again the next request is made and counted', r.last.state === 'done' && records().length === nF + 1)
  // the claim of D-030: the file holds counts, times and ids, and no message text and no key
  const raw = readRetry(ledgerFile, 'utf8')
  const sent = await H.mockReqs()
  const texts = sent.flatMap((q) => (q.body?.messages ?? []).map(bodyText)).concat(sent.map((q) => q.body?.system).filter(Boolean)).filter((t) => t.length >= 4)
  const keys = [...new Set(sent.map((q) => q.headers?.['x-api-key']).filter(Boolean))]
  check('the ledger holds no message text and no system prompt: none of the ' + texts.length + ' texts the provider was sent is in the file', texts.length > 10 && texts.every((t) => !raw.includes(t)) && !raw.includes('Frontier App'))
  check('...and no API key (the key the provider was sent is not in the file)', keys.length === 1 && keys[0].length > 20 && !raw.includes(keys[0]))
  check('every record in the file, from the first run of this suite to now, is one the strict reader accepts (a second look at the whole file)', lines().every((l) => l.version === 1 && /^[0-9a-f-]{36}$/.test(l.id) && Number.isSafeInteger(l.at) && ['sent', 'done', 'stopped', 'failed', 'rejected'].includes(l.state)))
  if (shots) await page.screenshot(`${shots}/8-1-after.png`)
} catch (error) {
  console.log('SUITE DIED: ' + (error instanceof Error ? error.stack : error))
  check('the suite ran to the end', false, String(error))
}

const passed = check.summary()
process.exit(passed ? 0 : 1)
