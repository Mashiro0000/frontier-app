// Stage 8.3 (D-032), the RESTART: the same scratch profile as verify-8-3w.mjs, a new run of the app. The amount the person chose ($0.25, which is NOT the
// default) is read back from ask-first.json and honoured: a request of about $0.37 to send asks, which the default of $0.50 would not. Needs: MOCK_PORT,
// USER_DATA_DIR (the same profile; its saved model is Claude Fable 5.1).
import './ts-resolve.mjs'
import { connect, checker, sleep } from './cdp.mjs'
import { assertScratchProfile } from './profile-guard.mjs'
import { h4, readRetry } from './lib4.mjs'
import { existsSync } from 'node:fs'
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
const askFile = join(userData, 'ask-first.json')
const ledgerFile = join(userData, 'usage', 'ledger.jsonl')
const ledgerLines = () => (existsSync(ledgerFile) ? readRetry(ledgerFile, 'utf8').split('\n').filter((l) => l !== '').length : 0)
const reqCount = async () => (await H.mockReqs()).length
const FILLER = 'lorem ipsum dolor sit amet '
const bigText = (chars, tag) => `[[mock:count]] ${tag} ${FILLER.repeat(Math.ceil(chars / FILLER.length))}`.slice(0, chars)

try {
  await page.waitFor(`document.readyState === 'complete' && !!document.querySelector('.header-select, .app-badge')`, { timeoutMs: 15000 })
  await sleep(500)
  await ev(`(() => { window.__ev = []; window.api.chat.onEvent((e) => window.__ev.push(e)); return true })()`)
  const status = await H.status()
  check('after a restart the choice is $0.25, in the file and in what main tells the page', readRetry(askFile, 'utf8') === '{"version":1,"above":0.25}' && JSON.stringify(status.askFirst) === '{"kind":"usd","usd":0.25}', JSON.stringify(status.askFirst))
  check('...and the saved model is still Claude Fable 5.1', status.selectedModelId === 'claude-fable-5-1')
  await page.click('.header-button@Settings')
  await page.waitFor(`!!document.querySelector('dialog.settings')?.open && !!document.getElementById('ask-first-amount')`, { timeoutMs: 8000 })
  await sleep(150)
  const shown = await ev(`({ value: document.getElementById('ask-first-amount').value, inForce: document.getElementById('ask-first-amount').closest('section').querySelector('.settings-status').textContent, saveOff: document.getElementById('ask-first-amount').closest('form').querySelector('button[type=submit]').disabled })`)
  check('Settings shows 0.25, says "The app asks above $0.25.", and Save is off', shown.value === '0.25' && shown.inForce === 'The app asks above $0.25.' && shown.saveOff, JSON.stringify(shown))
  await page.press('Escape')
  await page.waitFor(`!document.querySelector('dialog.settings')?.open`, { timeoutMs: 4000 })
  await sleep(150)

  const mock0 = await reqCount()
  const lines0 = ledgerLines()
  await H.send(bigText(90_000, 'R1'))
  await page.waitFor(`!!document.querySelector('dialog.large-request')?.open`, { timeoutMs: 20000, label: 'the question about a large request' })
  await sleep(700)
  const confirm = (await ev(`window.__ev.slice()`)).filter((e) => e.type === 'confirm').at(-1)
  check('a 90,000-character request on Fable (about $0.38 to send) asks, because $0.25 is in force: main says it asks above $0.25 (the default $0.50 would not have asked)', confirm.askAboveUsd === 0.25 && confirm.estimate.inputUsd > 0.25 && confirm.estimate.inputUsd < 0.5, JSON.stringify(confirm))
  check('...and nothing has been sent or written while it asks', (await reqCount()) === mock0 && ledgerLines() === lines0)
  if (shots) await page.screenshot(`${shots}/8-3-restart-question.png`)
  await page.click('dialog.large-request .settings-actions button@Send')
  await page.waitFor(`!document.querySelector('dialog.large-request')?.open`, { timeoutMs: 8000 })
  await H.waitReady()
  await sleep(300)
  check('Send sends it (the mock got the request)', (await reqCount()) === mock0 + 1)
  check('no console errors, warnings or exceptions in the page', page.problems.length === 0, page.problems.join(' | '))
  await sleep(300)
} finally {
  page.close()
}
process.exit(check.summary() ? 0 : 1)
