// Stage 8.1 (D-030), the RESTART: a second launch on the profile verify-8-1w.mjs left behind, after run81.mjs has added what a crash leaves in the
// ledger (a request that was begun and never ended, and a last line cut off in the middle). The new process reads the file for itself: the sums in
// Settings are the ones a second count made from the file gives, reading changes nothing in the file, the unfinished request counts as a guess
// ("about"), the cut-off line is said (one line of the usage file could not be read) and costs nothing, a chat opened from History has its own sum
// from the file, and the next request is written on a line of its own (it does not join the cut-off one). Needs: MOCK_PORT, USER_DATA_DIR (the same
// profile), LEDGER_SHA (the file's hash before this launch), ARTIFACT_ID (the id of the unfinished request run81.mjs appended) and its input guess
// ARTIFACT_INPUT.
import './ts-resolve.mjs'
import { connect, checker, sleep } from './cdp.mjs'
import { assertScratchProfile } from './profile-guard.mjs'
import { h4, readRetry, shaFile } from './lib4.mjs'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const port = Number(process.argv[3] ?? 9222)
const mockUrl = `http://127.0.0.1:${process.env.MOCK_PORT}`
const userData = process.env.USER_DATA_DIR
const { LEDGER_SHA, ARTIFACT_ID, ARTIFACT_INPUT } = process.env
if (!process.env.MOCK_PORT || !userData || !LEDGER_SHA || !ARTIFACT_ID || !ARTIFACT_INPUT) throw new Error('MOCK_PORT, USER_DATA_DIR, LEDGER_SHA, ARTIFACT_ID and ARTIFACT_INPUT must be set')
const check = checker()
const page = await connect(port)
await assertScratchProfile()
const H = h4(page, { userData, mockUrl })
const { ev } = H
const OPUS = { inputPerMTok: 4, cacheReadPerMTok: 0.2, cacheWritePerMTok: 5, outputPerMTok: 20 }
const ledgerFile = join(userData, 'usage', 'ledger.jsonl')
const text = () => readRetry(ledgerFile, 'utf8')
const parsed = () => text().split('\n').filter((l) => l !== '').flatMap((l) => { try { return [JSON.parse(l)] } catch { return [] } })
const records = () => { const m = new Map(); for (const r of parsed()) m.set(r.id, r); return [...m.values()] }
const costOf = (t, p = OPUS) => (t.input * p.inputPerMTok + t.cacheRead * p.cacheReadPerMTok + t.cacheWrite * p.cacheWritePerMTok + t.output * p.outputPerMTok) / 1e6
const money = (d) => (d === 0 ? '$0.00' : d < 0.0001 ? 'less than $0.0001' : d < 0.01 ? `$${d.toFixed(4)}` : `$${d.toFixed(2)}`)
const expected = (recs) => {
  const owed = recs.filter((r) => r.state !== 'rejected')
  const t = { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 }
  let cost = 0, about = false
  for (const r of owed) { for (const k of Object.keys(t)) t[k] += r.tokens[k]; cost += costOf(r.tokens, r.prices); if (r.estimate || r.state === 'sent') about = true }
  const n = (x) => x.toLocaleString('en-US')
  return { detail: `${n(t.input + t.cacheRead + t.cacheWrite)} in, ${n(t.output)} out, ${owed.length === 1 ? '1 request' : n(owed.length) + ' requests'}`, cost: `${about ? 'about ' : ''}${money(cost)}`, requests: owed.length }
}
const settingsView = async () => {
  await page.click('.header-button@Settings')
  await page.waitFor(`!!document.querySelector('dialog.settings')?.open && !!document.querySelector('.settings-usage tbody tr')`, { timeoutMs: 8000, label: 'the Usage table' })
  const view = await ev(`({ rows: [...document.querySelectorAll('.settings-usage tbody tr')].map((tr) => ({ label: tr.querySelector('th').textContent, detail: tr.children[1].textContent, cost: tr.children[2].textContent })), notice: [...document.querySelectorAll('dialog.settings .settings-notice')].map((n) => n.textContent) })`)
  await page.press('Escape')
  await sleep(200)
  return view
}
const row = (rows, start) => rows.find((r) => r.label.startsWith(start))

try {
  await page.waitFor(`document.readyState === 'complete' && !!document.querySelector('.header-select, .app-badge')`, { timeoutMs: 15000 })
  await sleep(400)

  const before = records()
  const artifact = before.find((r) => r.id === ARTIFACT_ID)
  check('the file is as run81.mjs left it: the unfinished request is in it ("sent", a guess of its input), and the last line is cut off', existsSync(ledgerFile) && artifact?.state === 'sent' && artifact.tokens.input === Number(ARTIFACT_INPUT) && !text().endsWith('\n') && shaFile(ledgerFile) === LEDGER_SHA)
  const idsBefore = new Set(before.map((r) => r.id))

  // ---- the new process reads it ----
  let view = await settingsView()
  const want = expected(before)
  check('Settings (a new process, an empty chat): today and this month are the sums a second count made from the file gives, with the unfinished request in them', row(view.rows, 'Today').detail === want.detail && row(view.rows, 'This month').detail === want.detail && row(view.rows, 'Today').cost === want.cost, JSON.stringify([view.rows, want]))
  check('...the unfinished request counts as a guess: the sums say "about"', want.cost.startsWith('about') && row(view.rows, 'Today').cost.startsWith('about '))
  check('...a new chat has nothing of its own: "This chat" is 0 requests', row(view.rows, 'This chat').detail === '0 in, 0 out, 0 requests' && row(view.rows, 'This chat').cost === '$0.00')
  check('...and the cut-off line is said, as one line that could not be read, and "what they cost is not in these sums"', view.notice.some((n) => /^1 line of the usage file could not be read, so what they cost is not in these sums\.$/.test(n)), JSON.stringify(view.notice))
  check('reading did not change the file: it is byte for byte what it was before this launch', shaFile(ledgerFile) === LEDGER_SHA)

  // ---- a chat from History has its own sum, from the file ----
  const { id: chatId } = await H.waitFirst('hello again')
  await H.openHistory()
  await H.clickRow('hello again')
  await page.waitFor(`!document.querySelector('dialog.history')?.open && document.querySelectorAll('.message-list-inner > .message').length > 0`, { timeoutMs: 8000, label: 'the chat to open' })
  await sleep(300)
  view = await settingsView()
  const mine = expected(before.filter((r) => r.chat === chatId))
  check('a chat opened from History: "This chat" is that chat\'s sum from the file (the new process knows nothing else about it)', row(view.rows, 'This chat').detail === mine.detail && row(view.rows, 'This chat').cost === mine.cost && mine.requests > 3, JSON.stringify([row(view.rows, 'This chat'), mine]))

  // ---- the next request is written whole, on a line of its own ----
  const req = await H.askMock('after the restart')
  let after = records()
  for (let i = 0; i < 100 && (after.length < before.length + 1 || after.at(-1).state === 'sent'); i++) { await sleep(60); after = records() }
  const added = after.filter((r) => !idsBefore.has(r.id))
  check('the next request is counted: one new record, done, from the provider\'s report, under the chat that is on screen', added.length === 1 && added[0].state === 'done' && added[0].estimate === false && added[0].tokens.input === 25 && added[0].tokens.output === 12 && added[0].chat === chatId, JSON.stringify(added))
  const lines = text().split('\n')
  const cutAt = lines.findIndex((l) => { try { JSON.parse(l); return false } catch { return l !== '' } })
  check('...it did not join the cut-off line: the cut-off fragment is a line of its own, the new lines are whole, and the file ends with a newline', cutAt >= 0 && text().endsWith('\n') && lines.slice(cutAt + 1).filter((l) => l !== '').every((l) => { try { JSON.parse(l); return true } catch { return false } }) && lines.filter((l) => l !== '').length - 1 >= before.length)
  check('...and the unfinished request is still unfinished (nothing rewrote it: it is a line of the file like any other), and still counts', records().find((r) => r.id === ARTIFACT_ID)?.state === 'sent')
  view = await settingsView()
  const now = expected(after)
  check('Settings after it: one more request in today and this month, equal to a second count from the file; the cut-off line is still reported once', row(view.rows, 'Today').detail === now.detail && now.requests === want.requests + 1 && view.notice.some((n) => /^1 line of the usage file could not be read/.test(n)), JSON.stringify([view.rows, now]))
  check('the mock saw that one request and no other (the restart sent nothing by itself)', (await H.mockReqs()).length === 1 && req !== null)
} catch (error) {
  console.log('SUITE DIED: ' + (error instanceof Error ? error.stack : error))
  check('the suite ran to the end', false, String(error))
}

const passed = check.summary()
process.exit(passed ? 0 : 1)
