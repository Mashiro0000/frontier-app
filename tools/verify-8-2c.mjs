// Stage 8.2 (D-031), a limits.json that is not a pair of limits, on a profile that has a saved key. CASE says which the launcher wrote before the
// launch: "half" ({"version":1,"daily":"none"}: one limit chosen, one not), "garbage" (text that is not JSON), "dir" (a FOLDER where the file
// should be, so it cannot be read at all). In each, nothing is let through: the question is asked (with what is known filled in), the bridge is
// refused, and choosing limits repairs it, except "dir", where the file cannot be written either and the page is told so.
import './ts-resolve.mjs'
import { connect, checker, sleep } from './cdp.mjs'
import { assertScratchProfile } from './profile-guard.mjs'
import { h4, readRetry } from './lib4.mjs'
import { existsSync, statSync } from 'node:fs'
import { join } from 'node:path'

const port = Number(process.argv[3] ?? 9222)
const mockUrl = `http://127.0.0.1:${process.env.MOCK_PORT}`
const userData = process.env.USER_DATA_DIR
const CASE = process.env.CASE
if (!process.env.MOCK_PORT || !userData || !['half', 'garbage', 'dir'].includes(CASE)) throw new Error('MOCK_PORT, USER_DATA_DIR and CASE (half | garbage | dir) must be set')
const check = checker()
const page = await connect(port)
await assertScratchProfile()
const H = h4(page, { userData, mockUrl })
const { ev } = H
const limitsFile = join(userData, 'limits.json')
const UNSET_SENTENCE = 'Nothing was sent: no spending limits are set yet. Open Settings, set a daily and a monthly limit (or choose No limit), and try again.'
const READ_SENTENCE = 'Nothing was sent: the spending limits could not be read on this computer.'
const reqCount = async () => (await H.mockReqs()).length
const rawAsk = (text) => ev(`new Promise((resolve) => {
  const id = crypto.randomUUID()
  const events = []
  const off = window.api.chat.onEvent((e) => { if (e.streamId !== id) return; events.push(e); if (e.type === 'done' || e.type === 'error') { off(); resolve(events) } })
  window.api.chat.start({ streamId: id, messages: [{ role: 'user', content: ${JSON.stringify(text)} }] })
  setTimeout(() => { off(); resolve(events) }, 20000)
})`)
const fill = async (id, text) => { await ev(`(() => { const i = document.getElementById(${JSON.stringify(id)}); i.focus(); i.select() })()`); await page.type(text) }
const form = () => ev(`(() => {
  const g = (n) => { const i = document.getElementById('limits-first-' + n); const w = i.closest('.limit-field'); return { value: i.value, disabled: i.disabled, none: w.querySelector('.limit-none input').checked } }
  const root = document.getElementById('limits-first-daily').closest('form')
  return { daily: g('daily'), monthly: g('monthly'), saveOff: root.querySelector('button[type=submit]').disabled, notice: root.querySelector('p[role=status]')?.textContent ?? null }
})()`)
const dialogOpen = () => ev(`!!document.querySelector('dialog.limits-dialog')?.open`)

try {
  await page.waitFor(`document.readyState === 'complete' && !!document.querySelector('.header-select, .app-badge')`, { timeoutMs: 15000 })
  await sleep(500)
  check(`[${CASE}] the question about limits is asked at the start`, await dialogOpen())
  let f = await form()
  const status = await H.status()
  if (CASE === 'half') {
    check('[half] the daily limit that WAS chosen ("No limit") is filled in: its box is ticked and off; the monthly one is empty; Save is off', f.daily.none && f.daily.disabled && f.monthly.value === '' && !f.monthly.none && f.saveOff, JSON.stringify(f))
    check('[half] main says daily "none", monthly not chosen', JSON.stringify(status.limits) === JSON.stringify({ daily: { kind: 'none' }, monthly: { kind: 'unset' } }), JSON.stringify(status.limits))
  } else {
    check(`[${CASE}] both boxes are empty and Save is off`, f.daily.value === '' && f.monthly.value === '' && !f.daily.none && !f.monthly.none && f.saveOff, JSON.stringify(f))
    check(`[${CASE}] main says neither limit is chosen`, JSON.stringify(status.limits) === JSON.stringify({ daily: { kind: 'unset' }, monthly: { kind: 'unset' } }), JSON.stringify(status.limits))
  }
  const mock0 = await reqCount()
  const events = await rawAsk('a request that must be refused')
  const refusal = events.find((e) => e.type === 'error')
  const expected = CASE === 'dir' ? READ_SENTENCE : UNSET_SENTENCE
  check(`[${CASE}] a request through the bridge is refused: "${expected.slice(0, 60)}..."`, refusal?.message === expected && !events.some((e) => ['text', 'usage', 'done'].includes(e.type)), JSON.stringify(events))
  check(`[${CASE}] ...nothing reached the mock`, (await reqCount()) === mock0)

  if (CASE === 'half') {
    await fill('limits-first-monthly', '100') // not 7: the first launches of this profile spent about $12 this month, which a limit of 7 would (rightly) refuse
    check('[half] with the monthly amount typed, Save turns on', !(await form()).saveOff)
    await page.click('dialog.limits-dialog button[type=submit]')
    await page.waitFor(`!document.querySelector('dialog.limits-dialog')?.open`, { timeoutMs: 6000 })
    check('[half] saved: the file holds both now ({"daily":"none","monthly":100}) and the question closed', readRetry(limitsFile, 'utf8') === '{"version":1,"daily":"none","monthly":100}')
    const after = await rawAsk('now it may go')
    check('[half] a request through the bridge now goes (done, with usage)', after.some((e) => e.type === 'done') && after.some((e) => e.type === 'usage') && (await reqCount()) === mock0 + 1, JSON.stringify(after.map((e) => e.type)))
  } else if (CASE === 'garbage') {
    await fill('limits-first-daily', '4')
    await fill('limits-first-monthly', '40')
    await page.click('dialog.limits-dialog button[type=submit]')
    await page.waitFor(`!document.querySelector('dialog.limits-dialog')?.open`, { timeoutMs: 6000 })
    check('[garbage] choosing limits repairs the file: it holds exactly {"version":1,"daily":4,"monthly":40}', readRetry(limitsFile, 'utf8') === '{"version":1,"daily":4,"monthly":40}')
  } else {
    await fill('limits-first-daily', '5')
    await fill('limits-first-monthly', '50')
    await page.click('dialog.limits-dialog button[type=submit]')
    await page.waitFor(`document.querySelector('dialog.limits-dialog form p[role=status]')?.textContent?.length > 0`, { timeoutMs: 6000, label: 'a notice under Save' })
    f = await form()
    check('[dir] Save cannot write the file, and says so ("The limits could not be saved on this computer."), with the question still open', f.notice === 'The limits could not be saved on this computer.' && (await dialogOpen()), JSON.stringify(f))
    check("[dir] the folder in the file's place is untouched, and the limits are still not chosen", existsSync(limitsFile) && statSync(limitsFile).isDirectory() && JSON.stringify((await H.status()).limits) === JSON.stringify({ daily: { kind: 'unset' }, monthly: { kind: 'unset' } }))
  }
  await sleep(300)
} finally {
  page.close()
}
process.exit(check.summary() ? 0 : 1)
