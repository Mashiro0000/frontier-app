// Stage 12.7 (D-042), in the real window against the mock: WHAT A FILE READ COSTS. A reply reads a big file (about 150 KB); the next request of that reply sends it again.
// The text of the file counts in the ledger and in the limits, and, when it has made the next request cost more than the person's amount more than the one they
// agreed to, the app asks AGAIN in the middle of the reply (the dialog says the reply is not finished). A yes goes on; a no stops the reply and nothing more is sent;
// "Never ask" asks nothing; a limit refuses the next request, with nothing more sent. Needs: USER_DATA_DIR (scratch), INSPECT_PORT, MOCK_PORT, a saved key.
import './temp-on-a.mjs'
import './ts-resolve.mjs'
import { connect, checker, sleep } from './cdp.mjs'
import { assertScratchProfile } from './profile-guard.mjs'
import { h4, mainInspector } from './lib4.mjs'
import { installQuestions } from './lib10.mjs'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const port = Number(process.argv[3] ?? 9222)
const userData = process.env.USER_DATA_DIR
const inspectPort = Number(process.env.INSPECT_PORT)
const mockUrl = `http://127.0.0.1:${process.env.MOCK_PORT}`
if (!userData || !inspectPort || !process.env.MOCK_PORT) throw new Error('USER_DATA_DIR, INSPECT_PORT and MOCK_PORT must be set')
const check = checker()
const page = await connect(port)
await assertScratchProfile()
const H = h4(page, { userData, mockUrl })
const { ev } = H
const main = await mainInspector(inspectPort)
const Q = await installQuestions(main, { fallback: 'yes' })
const show = (v) => JSON.stringify(v)?.slice(0, 500)
const control = (body) => fetch(`${mockUrl}/__tools`, { method: 'POST', body: JSON.stringify(body) })
const THREE_READS = { calls: [1, 601, 1201].map((from) => ({ name: 'read_file', input: { path: 'big.txt', start_line: from, max_lines: 600 } })) }
const requests = async () => (await (await fetch(`${mockUrl}/__requests`)).json()).filter((r) => r.url === '/v1/messages')

const base = mkdtempSync(join(tmpdir(), 'frontier-127w-'))
const WS = join(realpathSync.native(base), 'project')
mkdirSync(WS, { recursive: true })
// about 155 KB of text in 1,700 lines: the cap of one file is 256 KB, and one read gives back at most 60,000 characters, so the model reads it in three parts
const BIG = Array.from({ length: 1700 }, (_, i) => `line ${String(i).padStart(4, '0')} of a file that is read by the model, with some words to fill it up to fifty bytes`).join('\n') + '\n'
writeFileSync(join(WS, 'big.txt'), BIG)
await main.inMain(`(() => { const { dialog } = process.mainModule.require('electron'); const p = globalThis.__pick = { next: null }; dialog.showOpenDialog = async () => (p.next === null ? { canceled: true, filePaths: [] } : { canceled: false, filePaths: [p.next] }); return true })()`)
const pick = (path) => main.inMain(`globalThis.__pick.next = ${JSON.stringify(path)}; true`)

const openTools = async () => { await H.clickChat('Tools'); await page.waitFor(`!!document.querySelector('dialog.tools')?.open`, { timeoutMs: 8000, label: 'Tools' }); await sleep(600) }
const closeTools = async () => { await page.press('Escape'); await sleep(300) }
const wsClick = (text) => ev(`(() => { const s = [...document.querySelectorAll('dialog.tools .tools-section')].find((x) => x.querySelector('#tools-workspace-title')); [...s.querySelectorAll('button')].find((x) => x.textContent === ${JSON.stringify(text)}).click(); return true })()`)
const wsToggle = () => ev(`(() => { const s = [...document.querySelectorAll('dialog.tools .tools-section')].find((x) => x.querySelector('#tools-workspace-title')); s.querySelector('.tools-toggle').click(); return true })()`)
const asking = () => ev(`(() => {
  const d = document.querySelector('dialog.large-request')
  if (!d || !d.open) return null
  return { intro: d.querySelector('.large-request-intro')?.textContent ?? null, rows: [...d.querySelectorAll('tbody tr')].map((tr) => [tr.querySelector('th').firstChild.textContent.trim(), tr.querySelector('.large-request-tokens')?.textContent ?? '', tr.querySelector('td').textContent]), buttons: [...d.querySelectorAll('.settings-actions button')].map((b) => b.textContent), replying: !!document.querySelector('.composer-button-stop') }
})()`)
const waitAsking = () => page.waitFor(`!!document.querySelector('dialog.large-request')?.open`, { timeoutMs: 40000, label: 'the question in the middle of the reply' })
const waitDone = () => page.waitFor(`!!document.querySelector('.composer-button[type=submit]')`, { timeoutMs: 40000, label: 'the reply to end' })
const clickAnswer = async (text) => { await page.click(`dialog.large-request .settings-actions button@${text}`) }
const lastReply = () => ev(`(() => { const m = [...document.querySelectorAll('.message-assistant')].at(-1); return m ? m.innerText : null })()`)
const ledger = async () => { const s = await ev(`window.api.usage.summary(null)`); return s.today }
const newChat = async () => { await H.clickChat('New chat'); await sleep(300) }

try {
  await page.waitFor(`document.readyState === 'complete' && !!document.querySelector('.header-select, .app-badge')`, { timeoutMs: 15000 })
  await sleep(300)
  await ev(`window.api.settings.setModel('claude-opus-5-5')`)

  // ============ A. set up: a folder, the switch, the amount, a reply that reads the big file ============
  await openTools()
  await pick(WS)
  await Q.reset(); await Q.queue('yes')
  await wsClick('Choose a folder...')
  await sleep(900)
  await sleep(3300)
  await Q.reset(); await Q.queue('yes')
  await wsToggle()
  await sleep(900)
  await closeTools()
  const lowered = await ev(`window.api.settings.setAskFirst({ kind: 'usd', usd: 0.15 })`)
  check('A: the amount is lowered to $0.15 (lowering asks nothing)', lowered.ok === true, show(lowered))
  await control(THREE_READS)
  await Q.reset()

  // ============ B. the big file is read, and the next request asks again ============
  await newChat()
  const before = await ledger()
  await Q.queue('yes')
  await H.send('[[mock:tool-use]] read the big file')
  await waitAsking()
  const q = await asking()
  check('B: in the middle of the reply the large-request dialog opens, and says the reply is not finished and that what it read goes with the next request', q !== null && /^The reply is not finished\. It has read files, and what it read goes with the next request\. Nothing of that request has been sent yet\./.test(q.intro) && q.replying === true, show(q))
  const shownTokens = /about ([\d.,]+)(K?) tokens/.exec(q.rows[0][1])
  const tokens = shownTokens === null ? 0 : Number(shownTokens[1].replace(/,/g, '')) * (shownTokens[2] === 'K' ? 1000 : 1)
  check('B: the figures include what was read: about 37,000 tokens (two parts of 55,000 characters each, one token to three bytes)', tokens > 30000 && tokens < 48000, show(q.rows))
  check('B: the buttons are Don\'t send and Send', show(q.buttons) === show(["Don't send", 'Send']))
  const asked1 = (await requests()).length
  check('B: only the first two requests of the reply have been sent while the question is open (the question comes before the third)', asked1 === 2, String(asked1))
  await clickAnswer('Send')
  await waitDone()
  const reqs = await requests()
  check('B: after the yes the third request goes, then the fourth, and the reply ends; the requests really carry the file, part by part', reqs.length === 4 && reqs[2].raw.includes('line 1199 of a file') && !reqs[2].raw.includes('line 1699') && reqs[3].raw.includes('line 1699 of a file') && !reqs[0].raw.includes('line 0000'), show([reqs.length, reqs[1]?.raw.length]))
  const after = await ledger()
  check('B: the ledger counted the four requests of the reply (what the provider reports for each is what it keeps; the estimate is what the question and the limits use)', after.requests - before.requests === 4, show([before, after].map((x) => [x.requests, x.tokens])))
  check('B: the person was asked once (the third part did not pass the amount again): the dialog is closed and the box for the reading was asked once', (await asking()) === null && (await Q.count()) === 1)

  // ============ C. a no stops the reply ============
  await newChat()
  const count0 = (await requests()).length
  const ledgerC = await ledger()
  await Q.reset(); await Q.queue('yes')
  await H.send('[[mock:tool-use]] read the big file again')
  await waitAsking()
  await clickAnswer("Don't send")
  await waitDone()
  const reply = await lastReply()
  check('C: a no ends the reply with a sentence of its own, and nothing more is sent (only the first two requests of this chat)', (await requests()).length === count0 + 2 && /The reply stopped here: you chose not to send what it has read so far with the next request\./.test(reply ?? ''), show([(await requests()).length - count0, reply]))

  check('C: ...and the ledger counted only the requests that were sent (two), not the one that was not', (await ledger()).requests - ledgerC.requests === 2, show([ledgerC.requests, (await ledger()).requests]))

  // ============ C2. a proposed file is text that goes with the next request too ============
  await newChat()
  const bigProposal = Array.from({ length: 1500 }, (_, i) => `row ${i} of a proposed new file, with words enough to make it long`).join('\n') + '\n'
  await control({ calls: [{ name: 'propose_new_file', input: { path: 'docs/proposed.md', content: bigProposal } }] })
  await Q.reset(); await Q.queue('yes')
  await H.send('[[mock:tool-use]] propose a big file')
  await waitAsking()
  const qp = await asking()
  const shownP = /about ([\d.,]+)(K?) tokens/.exec(qp?.rows[0][1] ?? '')
  const tokensP = shownP === null ? 0 : Number(shownP[1].replace(/,/g, '')) * (shownP[2] === 'K' ? 1000 : 1)
  check('C2: the text the model asked FOR counts: a proposal of about 95,000 characters makes the next request about 36,000 tokens and the reply is asked about', qp !== null && /^The reply is not finished/.test(qp.intro) && tokensP > 22000 && tokensP < 40000, show(qp?.rows))
  await clickAnswer("Don't send")
  await waitDone()

  // ============ C3. a reply that is already large is not asked about at every step ============
  const lowered2 = await ev(`window.api.settings.setAskFirst({ kind: 'usd', usd: 0.01 })`)
  check('C3: the amount is lowered to $0.01', lowered2.ok === true && lowered2.status.askFirst.kind === 'usd' && lowered2.status.askFirst.usd === 0.01, show(lowered2.status?.askFirst))
  await sleep(300)
  writeFileSync(join(WS, 'small.txt'), 'just a few words\n')
  await control({ calls: [{ name: 'read_file', input: { path: 'small.txt', start_line: 1, max_lines: 10 } }, { name: 'read_file', input: { path: 'small.txt', start_line: 1, max_lines: 10 } }] })
  await newChat()
  const count4 = (await requests()).length
  await Q.reset(); await Q.queue('yes')
  const padding = 'a few words to make the first request longer. '.repeat(120)
  await H.send(`[[mock:tool-use]] two small reads in a conversation that is already over the amount. ${padding}`)
  await waitAsking()
  const first = await asking()
  check('C3: with an amount of $0.01 the first request is already over it: it is asked about before it goes (the usual question, not the one for later)', first !== null && /^Nothing has been sent yet/.test(first.intro), show(first))
  await clickAnswer('Send')
  await waitDone()
  check('C3: ...and the two small reads after it are NOT asked about again (they grew the request by far less than the amount since the yes): three requests, no second dialog', (await requests()).length === count4 + 3 && (await asking()) === null)
  await ev(`window.api.settings.setAskFirst({ kind: 'usd', usd: 0.15 })`)
  await sleep(300)

  // ============ D. a small file does not ask ============
  await newChat()
  writeFileSync(join(WS, 'small.txt'), 'just a few words\n')
  await control({ calls: [{ name: 'read_file', input: { path: 'small.txt', start_line: 1, max_lines: 10 } }] })
  const count1 = (await requests()).length
  await Q.reset(); await Q.queue('yes')
  await H.send('[[mock:tool-use]] read the small file')
  await waitDone()
  check('D: a small file asks nothing in the middle of the reply: two requests, no dialog', (await requests()).length === count1 + 2 && (await asking()) === null)

  // ============ E. "Never ask" asks nothing ============
  await Q.reset(); await Q.queue('yes')
  const never = await ev(`window.api.settings.setAskFirst({ kind: 'never' })`)
  await sleep(900)
  check('E: "Never ask" is chosen (that is the system\'s box, answered yes)', never.ok === true, show(never))
  await control(THREE_READS)
  await newChat()
  const count2 = (await requests()).length
  await Q.reset(); await Q.queue('yes')
  await H.send('[[mock:tool-use]] read the big file with never ask')
  await waitDone()
  check('E: with "Never ask" the big file is read and sent without a question: four requests, no dialog', (await requests()).length === count2 + 4 && (await asking()) === null)

  // ============ F. a limit refuses the next request ============
  const limited = await ev(`window.api.settings.setLimits({ daily: { kind: 'usd', usd: 5 }, monthly: { kind: 'none' } })`)
  check('F: a daily limit of $5 is chosen', limited.ok === true, show(limited))
  const spent = await ledger()
  const room = Math.ceil((spent.costUsd + 0.05) * 100) / 100
  // a limit just above what has been spent: the first request fits, the next (with the file) does not
  await Q.reset(); await Q.queue('yes')
  const tighter = await ev(`window.api.settings.setLimits({ daily: { kind: 'usd', usd: ${room} }, monthly: { kind: 'none' } })`)
  await sleep(500)
  check('F: the limit is lowered to just above what was spent today', tighter.ok === true, show([tighter, room, spent.costUsd]))
  await newChat()
  const count3 = (await requests()).length
  await Q.reset(); await Q.queue('yes')
  await H.send('[[mock:tool-use]] read the big file under a limit')
  await waitDone()
  const refused = await lastReply()
  check('F: a request after a part was read is refused by the limit before anything is sent: fewer than four requests, and a sentence that names the limit', (await requests()).length > count3 && (await requests()).length < count3 + 4 && /limit/i.test(refused ?? ''), show([(await requests()).length - count3, refused]))
  check('F: the page logged no errors and no warnings in the whole run', page.problems.length === 0, show(page.problems))
} catch (error) {
  check(`the suite stopped before its end: ${String(error?.stack ?? error).slice(0, 400)}`, false)
} finally {
  try { rmSync(base, { recursive: true, force: true }) } catch { /* left for the system */ }
}
const ok = check.summary()
process.exit(ok ? 0 : 1)
