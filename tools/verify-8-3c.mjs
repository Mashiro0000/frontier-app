// Stage 8.3 (D-032), an ask-first.json that is damaged, on a profile that has a saved key and Claude Fable 5.1 chosen. CASE says which the launcher wrote
// before the launch: "garbage" (text that is not JSON), "capital" ({"version":1,"above":"Never"}: the word, spelled so that this app never wrote it), "dir"
// (a FOLDER where the file should be, so it cannot be read at all). In each the file holds no choice, so the DEFAULT applies and the question is still asked:
// damage is never read as "Never ask". Saving a choice repairs the file, except "dir", where it cannot be written and the page is told so.
import './ts-resolve.mjs'
import { connect, checker, sleep } from './cdp.mjs'
import { assertScratchProfile } from './profile-guard.mjs'
import { h4, readRetry } from './lib4.mjs'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const port = Number(process.argv[3] ?? 9222)
const mockUrl = `http://127.0.0.1:${process.env.MOCK_PORT}`
const userData = process.env.USER_DATA_DIR
const CASE = process.env.CASE
if (!process.env.MOCK_PORT || !userData || !['garbage', 'capital', 'dir'].includes(CASE)) throw new Error('MOCK_PORT, USER_DATA_DIR and CASE (garbage | capital | dir) must be set')
const check = checker()
const page = await connect(port)
await assertScratchProfile()
const H = h4(page, { userData, mockUrl })
const { ev } = H
const askFile = join(userData, 'ask-first.json')
const reqCount = async () => (await H.mockReqs()).length
const FILLER = 'lorem ipsum dolor sit amet '
const bigText = (chars, tag) => `[[mock:count]] ${tag} ${FILLER.repeat(Math.ceil(chars / FILLER.length))}`.slice(0, chars)
const asked = () => ev(`!!document.querySelector('dialog.large-request')?.open`)
const waitAsking = () => page.waitFor(`!!document.querySelector('dialog.large-request')?.open`, { timeoutMs: 20000, label: 'the question about a large request' })
const logText = () => (process.env.APP_LOG && existsSync(process.env.APP_LOG) ? readFileSync(process.env.APP_LOG, 'utf8') : '')

try {
  await page.waitFor(`document.readyState === 'complete' && !!document.querySelector('.header-select, .app-badge')`, { timeoutMs: 15000 })
  await sleep(500)
  await ev(`(() => { window.__ev = []; window.api.chat.onEvent((e) => window.__ev.push(e)); return true })()`)
  const status = await H.status()
  check(`[${CASE}] main says nothing is chosen (the default applies), and NOT "Never ask"`, JSON.stringify(status.askFirst) === '{"kind":"default"}', JSON.stringify(status.askFirst))
  check(`[${CASE}] the model is still Claude Fable 5.1`, status.selectedModelId === 'claude-fable-5-1')
  await page.click('.header-button@Settings')
  await page.waitFor(`!!document.querySelector('dialog.settings')?.open && !!document.getElementById('ask-first-amount')`, { timeoutMs: 8000 })
  await sleep(150)
  const shown = await ev(`({ value: document.getElementById('ask-first-amount').value, placeholder: document.getElementById('ask-first-amount').placeholder, never: document.getElementById('ask-first-amount').closest('.limit-field').querySelector('.limit-none input').checked, inForce: document.getElementById('ask-first-amount').closest('section').querySelector('.settings-status').textContent })`)
  check(`[${CASE}] Settings shows an empty box ("0.50 (the default)"), "Never ask" not ticked, and "You have not chosen an amount, so the app asks above $0.50."`, shown.value === '' && shown.placeholder === '0.50 (the default)' && !shown.never && shown.inForce === 'You have not chosen an amount, so the app asks above $0.50.', JSON.stringify(shown))
  await page.press('Escape')
  await page.waitFor(`!document.querySelector('dialog.settings')?.open`, { timeoutMs: 4000 })
  await sleep(150)

  const mock0 = await reqCount()
  await H.send(bigText(150_000, 'X1'))
  await waitAsking()
  await sleep(500)
  const confirm = (await ev(`window.__ev.slice()`)).filter((e) => e.type === 'confirm').at(-1)
  check(`[${CASE}] a 150,000-character request on Fable STILL asks: main asks above the default $0.50 (damage cannot turn the question off)`, confirm?.askAboveUsd === 0.5 && (await reqCount()) === mock0, JSON.stringify(confirm))
  await page.click('dialog.large-request .settings-actions button@Don\'t send')
  await page.waitFor(`!document.querySelector('dialog.large-request')?.open`, { timeoutMs: 8000 })
  await H.waitReady()
  await sleep(300)
  check(`[${CASE}] "Don't send" sends nothing`, (await reqCount()) === mock0 && (await H.noteText()) === 'Not sent: you chose not to send this request.')
  const log = logText()
  if (process.env.APP_LOG) {
    if (CASE === 'dir') check('[dir] the app log says the file could not be read and that the default applies', /Reading ask-first\.json failed, so the default applies/.test(log))
    else check(`[${CASE}] the app log says the file is damaged and that the default applies`, /ask-first\.json is damaged/.test(log))
  }

  // saving a choice
  await page.click('.header-button@Settings')
  await page.waitFor(`!!document.querySelector('dialog.settings')?.open && !!document.getElementById('ask-first-amount')`, { timeoutMs: 8000 })
  await sleep(150)
  await ev(`(() => { const i = document.getElementById('ask-first-amount'); i.scrollIntoView({ block: 'center' }); i.focus(); i.select() })()`)
  await page.type('2')
  await ev(`document.getElementById('ask-first-amount').closest('form').querySelector('button[type=submit]').setAttribute('data-click', '1')`)
  await page.click('[data-click="1"]')
  await page.waitFor(`document.getElementById('ask-first-amount').closest('form').querySelector('p[role=status]')?.textContent?.length > 0`, { timeoutMs: 6000, label: 'a notice under Save' })
  const notice = await ev(`document.getElementById('ask-first-amount').closest('form').querySelector('p[role=status]').textContent`)
  if (CASE === 'dir') {
    check('[dir] Save cannot write the file, and says so ("The choice could not be saved on this computer.")', notice === 'The choice could not be saved on this computer.', notice)
    check("[dir] the folder in the file's place is untouched, and main still says nothing is chosen", existsSync(askFile) && statSync(askFile).isDirectory() && JSON.stringify((await H.status()).askFirst) === '{"kind":"default"}')
  } else {
    check(`[${CASE}] choosing 2 repairs the file: it holds exactly {"version":1,"above":2}`, notice === 'Saved.' && readRetry(askFile, 'utf8') === '{"version":1,"above":2}', String(notice))
  }
  await page.press('Escape')
  await page.waitFor(`!document.querySelector('dialog.settings')?.open`, { timeoutMs: 4000 })
  await sleep(150)
  const mock1 = await reqCount()
  if (CASE === 'dir') {
    await page.click(`.message-list-inner > .message:last-child .message-action@Try again`)
    await waitAsking()
    check('[dir] the question is still asked afterwards (nothing could be saved)', await asked())
    await page.press('Escape')
    await page.waitFor(`!document.querySelector('dialog.large-request')?.open`, { timeoutMs: 8000 })
  } else {
    await page.click(`.message-list-inner > .message:last-child .message-action@Try again`)
    await page.waitFor(`!document.querySelector('.message-assistant:last-child .message-note-error') && !!document.querySelector('.message-assistant:last-child .message-usage')`, { timeoutMs: 20000, label: 'the retried reply' })
    check(`[${CASE}] with 2 chosen, the same request ($0.63) now goes without a question`, (await reqCount()) === mock1 + 1 && !(await asked()))
  }
  check(`[${CASE}] no console errors, warnings or exceptions in the page`, page.problems.length === 0, page.problems.join(' | '))
  await sleep(300)
} finally {
  page.close()
}
process.exit(check.summary() ? 0 : 1)
