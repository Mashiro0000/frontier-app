// Stage 8.2 (D-031), the RESTART: the same scratch profile as verify-8-2w.mjs, a new run of the app. The limits survived (10 a day, 50 a month), the
// first-run question does not come back, and the money spent in the first run (about $12 today) is counted from the file, so the daily limit is
// still reached and a request is still refused; raising the limit in Settings lets it through. Needs: MOCK_PORT, USER_DATA_DIR (the same profile).
import './ts-resolve.mjs'
import { connect, checker, sleep } from './cdp.mjs'
import { assertScratchProfile } from './profile-guard.mjs'
import { h4, readRetry } from './lib4.mjs'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const port = Number(process.argv[3] ?? 9222)
const mockUrl = `http://127.0.0.1:${process.env.MOCK_PORT}`
const userData = process.env.USER_DATA_DIR
if (!process.env.MOCK_PORT || !userData) throw new Error('MOCK_PORT and USER_DATA_DIR must be set')
const check = checker()
const page = await connect(port)
await assertScratchProfile()
const H = h4(page, { userData, mockUrl })
const { ev } = H
const limitsFile = join(userData, 'limits.json')
const ledgerFile = join(userData, 'usage', 'ledger.jsonl')
const ledgerLines = () => (existsSync(ledgerFile) ? readRetry(ledgerFile, 'utf8').split('\n').filter((l) => l !== '').length : 0)
const reqCount = async () => (await H.mockReqs()).length

try {
  await page.waitFor(`document.readyState === 'complete' && !!document.querySelector('.header-select, .app-badge')`, { timeoutMs: 15000 })
  await sleep(500)
  check('after a restart the limits are still 10 a day and 50 a month, in the file and in what main tells the page', readRetry(limitsFile, 'utf8') === '{"version":1,"daily":10,"monthly":50}' && JSON.stringify((await H.status()).limits) === JSON.stringify({ daily: { kind: 'usd', usd: 10 }, monthly: { kind: 'usd', usd: 50 } }))
  check('the first-run question does not come back (the limits were chosen)', !(await ev(`!!document.querySelector('dialog.limits-dialog')?.open`)))
  check('...and the empty chat says "Type a message to start."', await ev(`document.querySelector('.empty-state')?.innerText === 'Type a message to start.'`))
  const lines0 = ledgerLines()
  const mock0 = await reqCount()
  await H.send('first message after the restart')
  await page.waitFor(`!!document.querySelector('.message-assistant:last-child .message-note-error')`, { timeoutMs: 8000, label: 'a refusal' })
  await H.waitReady()
  await sleep(150)
  const note = await H.noteText()
  check('the spending of the first run is counted from the file: a request is refused naming the daily limit of $10.00, with $12.00 so far today', /^Nothing was sent: you have reached your daily limit of \$10\.00 \(\$12\.00 so far today\)\. You can raise the limit in Settings/.test(note ?? ''), note)
  check('...nothing reached the mock, and nothing was written to the ledger', (await reqCount()) === mock0 && ledgerLines() === lines0)
  await page.click('.header-button@Settings')
  await page.waitFor(`!!document.querySelector('dialog.settings')?.open && document.querySelectorAll('.settings-usage tbody tr').length === 3`, { timeoutMs: 8000 })
  const rows = await ev(`[...document.querySelectorAll('.settings-usage tbody tr')].map((tr) => tr.children[2].textContent)`)
  check('Settings shows Usage as "$12.00 of $10.00" for the day and "$12.00 of $50.00" for the month, and the limits 10.00 and 50.00', rows[1] === '$12.00 of $10.00' && rows[2] === '$12.00 of $50.00' && (await ev(`document.getElementById('limits-settings-daily').value + '/' + document.getElementById('limits-settings-monthly').value`)) === '10.00/50.00', JSON.stringify(rows))
  await ev(`(() => { const i = document.getElementById('limits-settings-daily'); i.focus(); i.select() })()`)
  await page.type('20')
  await ev(`document.querySelector('dialog.settings .limits-form button[type=submit]').scrollIntoView({ block: 'center' })`)
  await sleep(80)
  await page.click('dialog.settings .limits-form button[type=submit]')
  await page.waitFor(`document.querySelector('dialog.settings .limits-form p[role=status]')?.textContent === 'Saved.'`, { timeoutMs: 6000 })
  await page.press('Escape')
  await page.waitFor(`!document.querySelector('dialog.settings')?.open`, { timeoutMs: 4000 })
  await sleep(150)
  await page.click(`.message-list-inner > .message:last-child .message-action@Try again`)
  await page.waitFor(`!document.querySelector('.message-assistant:last-child .message-note-error') && !!document.querySelector('.message-assistant:last-child .message-usage')`, { timeoutMs: 15000, label: 'the reply after the limit was raised' })
  check('raised to 20 a day in Settings, "Try again" goes through: the mock got the request', (await reqCount()) === mock0 + 1 && ledgerLines() === lines0 + 2)
  check('limits.json holds 20 and 50', readRetry(limitsFile, 'utf8') === '{"version":1,"daily":20,"monthly":50}')
  await sleep(300)
} finally {
  page.close()
}
process.exit(check.summary() ? 0 : 1)
