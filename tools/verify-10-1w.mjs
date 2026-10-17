// Stage 10.1 (D-039), in the real window: a change that lets the app spend more is saved only after the person's yes in the system's own message box,
// which the page cannot answer. The box is replaced from the main process's inspector (lib10.mjs: each question recorded with its options, answered from
// a queue), since a suite cannot click what the operating system draws; tools/verify-10-1-real.mjs answers the REAL box once.
// What is checked: the first-run limits (asked; a no saves nothing and the question stays; a yes saves and closes it); in Settings, a lower limit is saved
// with no question, a higher one and "No limit" are asked about, and the form says so before Save; the amount the app asks above likewise ("Never ask",
// higher: asked; lower: not); the box's options (modal to the window, the warning icon, yes first and named, "Cancel" the default and the Escape answer);
// the page's own bridge cannot avoid the question, a second change while one is open is refused at once, fifty at once give one question; the bridge has
// no way to answer; the hint at 280 and 420 px; no console errors.
// Needs: USER_DATA_DIR (scratch, PRESEED_LIMITS=off), INSPECT_PORT, MOCK_PORT, a saved key (setup-key.mjs).
import './ts-resolve.mjs'
import { connect, checker, sleep } from './cdp.mjs'
import { assertScratchProfile } from './profile-guard.mjs'
import { h4, mainInspector, readRetry } from './lib4.mjs'
import { installQuestions, linesOf } from './lib10.mjs'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const shots = process.argv[2]
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
const Q = await installQuestions(main, { fallback: 'no' })
const limitsFile = join(userData, 'limits.json')
const askFile = join(userData, 'ask-first.json')
const limitsText = () => (existsSync(limitsFile) ? readRetry(limitsFile, 'utf8') : null)
const askText = () => (existsSync(askFile) ? readRetry(askFile, 'utf8') : null)
const BUSY = 'Another question is waiting for your answer in a window of its own. Answer it first.'
const show = (v) => JSON.stringify(v)?.slice(0, 400)

const fill = async (id, text) => {
  await ev(`(() => { const i = document.getElementById(${JSON.stringify(id)}); i.scrollIntoView({ block: 'center' }); i.focus(); i.select() })()`)
  await sleep(60)
  await page.type(text)
  await sleep(80)
}
const clickNone = async (id) => {
  await ev(`(() => { const l = document.getElementById(${JSON.stringify(id)}).closest('.limit-field').querySelector('.limit-none'); l.scrollIntoView({ block: 'center' }); l.setAttribute('data-click', '1') })()`)
  await sleep(80)
  await page.click('[data-click="1"]')
  await ev(`document.querySelector('[data-click="1"]')?.removeAttribute('data-click')`)
  await sleep(100)
}
// A form that is gone (a sabotage that saved without asking closes the first-run question) reads as null, so the checks that follow say what they saw.
const formOf = (id) => ev(`(() => {
  const root = document.getElementById(${JSON.stringify(id)})?.closest('form')
  if (!root) return { gone: true }
  const notice = root.querySelector('p[role=status]')
  return { saveOff: root.querySelector('button[type=submit]').disabled, asksAgain: root.querySelector('.limits-asks-again')?.textContent ?? null, notice: notice?.textContent ?? null, noticeError: notice ? notice.classList.contains('settings-notice-error') : null }
})()`)
const submit = async (id) => {
  await ev(`(() => { const b = document.getElementById(${JSON.stringify(id)}).closest('form').querySelector('button[type=submit]'); b.scrollIntoView({ block: 'center' }); b.setAttribute('data-click', '1') })()`)
  await sleep(80)
  await page.click('[data-click="1"]')
  await ev(`document.querySelector('[data-click="1"]')?.removeAttribute('data-click')`)
  await page.waitFor(`!document.getElementById(${JSON.stringify(id)}) || (document.getElementById(${JSON.stringify(id)}).closest('form').querySelector('p[role=status]')?.textContent ?? '').length > 0`, { timeoutMs: 8000, label: 'a notice under Save (or the form gone)' })
  await sleep(120)
}
const openSettings = async () => {
  await page.click('.header-button@Settings')
  await page.waitFor(`!!document.querySelector('dialog.settings')?.open && !!document.getElementById('limits-settings-daily') && !!document.getElementById('ask-first-amount')`, { timeoutMs: 8000, label: 'Settings' })
  await sleep(150)
}
const closeSettings = async () => { await page.press('Escape'); await page.waitFor(`!document.querySelector('dialog.settings')?.open`, { timeoutMs: 4000 }); await sleep(150) }
const lastAsked = async () => (await Q.asked()).at(-1)

try {
  await page.waitFor(`document.readyState === 'complete' && !!document.querySelector('.header-select, .app-badge')`, { timeoutMs: 15000 })
  // setup-key.mjs put the first-run question off; a reload brings it back (the profile still has no limits).
  await ev('location.reload()')
  await sleep(500)
  await page.waitFor(`!!document.querySelector('dialog.limits-dialog')?.open && !!document.getElementById('limits-first-daily')`, { timeoutMs: 15000, label: 'the first-run limits question' })
  await sleep(300)

  // ============ A. the first choice is asked about in the system's box ============
  check('A: the profile has no limits.json', limitsText() === null)
  await fill('limits-first-daily', '5')
  await fill('limits-first-monthly', '50')
  let f = await formOf('limits-first-daily')
  check('A: with 5 and 50 typed, the form says the system will ask once more ("This lets the app spend more, so when you save, the system asks you once more in a window of its own.")', f.asksAgain === 'This lets the app spend more, so when you save, the system asks you once more in a window of its own.' && !f.saveOff, show(f))
  await Q.queue('no')
  await submit('limits-first-daily')
  const firstQ = (await lastAsked()) ?? { withWindow: null, options: {} }
  check('A: Save asked ONE question, modal to the app\'s window', (await Q.count()) === 1 && firstQ.withWindow === true, show(firstQ))
  const o = firstQ.options
  check('A: ...the system\'s warning box: title "Spending limits", "Save these spending limits?", buttons "Save the limits" then "Cancel"; Cancel has the focus and is the Escape answer; no command links', o.type === 'warning' && o.title === 'Spending limits' && o.message === 'Save these spending limits?' && show(o.buttons) === '["Save the limits","Cancel"]' && o.defaultId === 1 && o.cancelId === 1 && o.noLink === true, show(o))
  check('A: ...its lines name both limits and why it is asked here', linesOf(firstQ)[1] === 'Daily limit: $5.00 (not chosen until now)' && linesOf(firstQ)[2] === 'Monthly limit: $50.00 (not chosen until now)' && /page cannot answer/.test(o.detail), show(linesOf(firstQ)))
  check('A: a no saves NOTHING: no limits.json, and the first-run question is still open', limitsText() === null && (await ev(`!!document.querySelector('dialog.limits-dialog')?.open`)), show(limitsText()))
  f = await formOf('limits-first-daily')
  check('A: ...and says so: "Not saved: the limits are as they were." (not an error)', f.notice === 'Not saved: the limits are as they were.' && f.noticeError === false, show(f))
  if (f.gone) throw new Error('the first-run question closed after a no: the checks above say why')
  check('A: main still says neither limit is chosen', show((await ev('window.api.settings.getStatus()')).limits) === '{"daily":{"kind":"unset"},"monthly":{"kind":"unset"}}')
  await sleep(3200)
  await Q.queue('yes')
  await ev(`document.getElementById('limits-first-daily').closest('form').querySelector('button[type=submit]').click()`)
  await page.waitFor(`!document.querySelector('dialog.limits-dialog')?.open`, { timeoutMs: 8000, label: 'the first-run question to close' })
  await sleep(200)
  check('A: a yes: saved exactly what was shown (5 and 50), and the first-run question closes', limitsText() === '{"version":1,"daily":5,"monthly":50}' && (await Q.count()) === 2, limitsText())

  // ============ B. Settings: lower = no question; higher, No limit = asked ============
  await Q.reset()
  await openSettings()
  await fill('limits-settings-daily', '3')
  f = await formOf('limits-settings-daily')
  check('B: lowering the daily limit to 3: no "asks once more" line', f.asksAgain === null && !f.saveOff, show(f))
  await submit('limits-settings-daily')
  f = await formOf('limits-settings-daily')
  check('B: ...saved with NO question', f.notice === 'Saved.' && (await Q.count()) === 0 && limitsText() === '{"version":1,"daily":3,"monthly":50}', show({ f, n: await Q.count(), file: limitsText() }))
  await fill('limits-settings-daily', '20')
  f = await formOf('limits-settings-daily')
  check('B: raising it to 20: the form says the system will ask once more', /the system asks you once more/.test(f.asksAgain ?? ''), show(f))
  await Q.queue('no')
  await submit('limits-settings-daily')
  let q = await lastAsked()
  f = await formOf('limits-settings-daily')
  check('B: ...asked: "Raise your daily spending limit to $20.00?", "Raise the limit" / "Cancel", "Daily limit: $20.00 (now $3.00)", "Monthly limit: $50.00 (as now)"', (await Q.count()) === 1 && q.options.message === 'Raise your daily spending limit to $20.00?' && show(q.options.buttons) === '["Raise the limit","Cancel"]' && linesOf(q)[1] === 'Daily limit: $20.00 (now $3.00)' && linesOf(q)[2] === 'Monthly limit: $50.00 (as now)', show(linesOf(q)))
  check('B: ...a no: not saved, the file as it was, the notice says so', f.notice === 'Not saved: the limits are as they were.' && limitsText() === '{"version":1,"daily":3,"monthly":50}', show(f))
  await submit('limits-settings-daily')
  f = await formOf('limits-settings-daily')
  check('B: Save again at once: NOT asked (the app rests three seconds after a no), and the form says to wait', (await Q.count()) === 1 && f.notice === 'You said no to a question a moment ago. Wait a few seconds, then try again.' && f.noticeError === true && limitsText() === '{"version":1,"daily":3,"monthly":50}', show(f))
  await sleep(3200)
  await Q.queue('yes')
  await submit('limits-settings-daily')
  check('B: ...asked again, a yes: saved 20', (await Q.count()) === 2 && (await formOf('limits-settings-daily')).notice === 'Saved.' && limitsText() === '{"version":1,"daily":20,"monthly":50}', limitsText())
  await clickNone('limits-settings-monthly')
  f = await formOf('limits-settings-daily')
  check('B: ticking No limit for the month: the form says the system will ask once more', /the system asks you once more/.test(f.asksAgain ?? ''), show(f))
  await Q.queue('yes')
  await submit('limits-settings-daily')
  q = await lastAsked()
  check('B: ...asked "Remove your monthly spending limit?" ("Remove the limit"), with the warning that nothing in the app stops spending then; a yes saves it', (await Q.count()) === 3 && q.options.message === 'Remove your monthly spending limit?' && q.options.buttons[0] === 'Remove the limit' && /nothing in this app stops spending in that period/.test(q.options.detail) && limitsText() === '{"version":1,"daily":20,"monthly":"none"}', show({ m: q.options.message, file: limitsText() }))
  await clickNone('limits-settings-monthly')
  await fill('limits-settings-monthly', '100')
  check('B: an amount for the month again (from No limit) is lower: no line, no question', (await formOf('limits-settings-daily')).asksAgain === null)
  await submit('limits-settings-daily')
  check('B: ...saved with no question', (await Q.count()) === 3 && limitsText() === '{"version":1,"daily":20,"monthly":100}', limitsText())

  // ============ C. the amount the app asks above ============
  await fill('ask-first-amount', '3')
  f = await formOf('ask-first-amount')
  check('C: $3 (above the default $0.50): the form says the system will ask once more ("The app would ask less often, ...")', f.asksAgain === 'The app would ask less often, so when you save, the system asks you once more in a window of its own.', show(f))
  await Q.queue('no')
  await submit('ask-first-amount')
  q = await lastAsked()
  f = await formOf('ask-first-amount')
  check('C: ...asked "Ask before a large request only above $3.00?" ("Ask above $3.00" / "Cancel"), naming the default now', (await Q.count()) === 4 && q.options.message === 'Ask before a large request only above $3.00?' && show(q.options.buttons) === '["Ask above $3.00","Cancel"]' && /\$0\.50, the default/.test(q.options.detail) && q.options.title === 'Large requests', show(q.options))
  check('C: ...a no: "Not saved: the amount is as it was.", and no ask-first.json', f.notice === 'Not saved: the amount is as it was.' && f.noticeError === false && askText() === null, show(f))
  await sleep(3200)
  await Q.queue('yes')
  await submit('ask-first-amount')
  check('C: ...a yes: saved {"above":3}', askText() === '{"version":1,"above":3}' && (await Q.count()) === 5, askText())
  await fill('ask-first-amount', '0.25')
  check('C: $0.25 (asks sooner): no line', (await formOf('ask-first-amount')).asksAgain === null)
  await submit('ask-first-amount')
  check('C: ...saved with no question', (await Q.count()) === 5 && askText() === '{"version":1,"above":0.25}', askText())
  await clickNone('ask-first-amount')
  check('C: Never ask: the line again', /the system asks you once more/.test((await formOf('ask-first-amount')).asksAgain ?? ''))
  await Q.queue('no')
  await submit('ask-first-amount')
  q = await lastAsked()
  check('C: ...asked "Stop asking before large requests?" ("Never ask"); a no keeps 0.25', (await Q.count()) === 6 && q.options.message === 'Stop asking before large requests?' && q.options.buttons[0] === 'Never ask' && askText() === '{"version":1,"above":0.25}', show({ m: q.options.message, file: askText() }))
  await closeSettings()

  // ============ D. the page's own bridge ============
  await sleep(3200)
  await Q.reset()
  await Q.hold()
  const pending = ev(`window.api.settings.setLimits({ daily: { kind: 'none' }, monthly: { kind: 'none' } })`)
  await sleep(500)
  check('D: a raise straight through the bridge is asked about all the same (the page cannot leave the question out)', (await Q.count()) === 1 && (await lastAsked()).options.message === 'Remove both spending limits?', show((await Q.asked()).map((a) => a.options.message)))
  const lower = await ev(`window.api.settings.setLimits({ daily: { kind: 'usd', usd: 1 }, monthly: { kind: 'usd', usd: 2 } })`)
  const lowerAsk = await ev(`window.api.settings.setAskFirst({ kind: 'usd', usd: 0.1 })`)
  check('D: while that question is open, another change through the bridge (even a lower one) is refused at once with a sentence, and not asked', lower.ok === false && lower.error === BUSY && lowerAsk.ok === false && lowerAsk.error === BUSY && (await Q.count()) === 1, show({ lower, lowerAsk }))
  await Q.queue('no')
  await Q.release()
  const first = await pending
  check('D: the open question\'s no: "cancelled", nothing saved', first.ok === false && first.cancelled === true && limitsText() === '{"version":1,"daily":20,"monthly":100}', show(first))
  const again = await ev(`window.api.settings.setLimits({ daily: { kind: 'none' }, monthly: { kind: 'none' } })`)
  check('D: the same raise through the bridge the moment after the no: not asked, refused with the sentence to wait (a page cannot put the box straight back)', again.ok === false && !again.cancelled && again.error === 'You said no to a question a moment ago. Wait a few seconds, then try again.' && (await Q.count()) === 1, show(again))
  await sleep(3200)
  await Q.hold()
  const burstDone = ev(`Promise.all(Array.from({ length: 50 }, (_, i) => window.api.settings.setLimits({ daily: { kind: 'usd', usd: 21 + i }, monthly: { kind: 'usd', usd: 100 } })))`)
  await sleep(800)
  check('D: fifty raises at once through the bridge, the first still unanswered: ONE question in front of the person', (await Q.count()) === 2, String(await Q.count()))
  await Q.queue('no')
  await Q.release()
  const burst = await burstDone
  check('D: ...the person\'s no answers that one ("cancelled"); the other 49 were refused at once with a sentence; nothing saved', burst.filter((r) => r.cancelled).length === 1 && burst.filter((r) => !r.ok && !r.cancelled && typeof r.error === 'string').length === 49 && (await Q.count()) === 2 && limitsText() === '{"version":1,"daily":20,"monthly":100}', show({ n: await Q.count(), errors: [...new Set(burst.map((r) => r.error))], file: limitsText() }))
  await sleep(3200)
  await Q.queue('yes')
  const yes = await ev(`window.api.settings.setLimits({ daily: { kind: 'usd', usd: 25 }, monthly: { kind: 'usd', usd: 100 } })`)
  check('D: through the bridge, only the person\'s yes in the box lets a raise through (and then main sends the new settings)', yes.ok === true && yes.status?.limits?.daily?.usd === 25 && limitsText() === '{"version":1,"daily":25,"monthly":100}', show(yes).slice(0, 120))
  check('D: the bridge has no way to answer a question: window.api.settings is the eight functions of Stage 8', show(await ev(`Object.keys(window.api.settings).sort()`)) === show(['clearApiKey', 'getStatus', 'setApiKey', 'setAskFirst', 'setEffort', 'setLimits', 'setModel', 'testApiKey']), show(await ev(`Object.keys(window.api.settings)`)))
  check('D: ...and no top-level part of window.api that could (attachments, chat, history, instructions since 10.2, memory since 10.4, projects since 10.5, settings, usage)', show(await ev(`Object.keys(window.api).sort()`)) === show(['attachments', 'audit', 'changes', 'chat', 'connectors', 'history', 'images', 'instructions', 'memory', 'programs', 'projects', 'settings', 'tools', 'updates', 'usage', 'voice', 'workspace']), show(await ev(`Object.keys(window.api)`)))

  // ============ E. narrow windows ============
  for (const width of [420, 280]) {
    await page.send('Emulation.setDeviceMetricsOverride', { width, height: 700, deviceScaleFactor: 1, mobile: false })
    await sleep(300)
    await openSettings()
    await fill('limits-settings-daily', '99')
    // Measured on the line itself (a check about overflow measures the thing it is about); what else is past the dialog's edge is printed, not judged here.
    const box = await ev(`(() => { const h = document.querySelector('dialog.settings .limits-asks-again'); if (!h) return null; const d = document.querySelector('dialog.settings'); const r = h.getBoundingClientRect(); const inner = d.getBoundingClientRect().left + d.clientLeft + d.clientWidth; const past = [...d.querySelectorAll('*')].filter((e) => e.getBoundingClientRect().right > inner + 0.5).slice(0, 6).map((e) => e.tagName + '.' + e.className + ' ' + Math.round(e.getBoundingClientRect().right) + ' ' + (e.textContent ?? '').slice(0, 40)); return { right: r.right, inner, lines: Math.round(r.height / parseFloat(getComputedStyle(h).lineHeight)), wide: h.scrollWidth > h.clientWidth, past } })()`)
    check(`E: at ${width} px the "asks once more" line is there, inside the dialog's own width, wrapped (no part of it scrolls sideways)`, box !== null && box.right <= box.inner + 0.5 && box.wide === false, show(box))
    // Found while measuring 10.1: Usage's "$0.00 of $25.00" could not wrap, and the whole dialog scrolled sideways at 280 px (Stage 8). Now it breaks before "of".
    // A cell is as tall as its row, so its lines are counted from where its two amounts sit: the same line, or one below the other.
    const usage = await ev(`(() => { const d = document.querySelector('dialog.settings'); const cell = d.querySelector('.settings-usage tr:nth-child(2) .settings-usage-cost'); const spans = cell ? [...cell.querySelectorAll('.settings-usage-amount')] : []; return { dialogScrolls: d.scrollWidth > d.clientWidth, cell: cell?.textContent ?? null, cellLines: spans.length === 2 ? (Math.abs(spans[0].getBoundingClientRect().top - spans[1].getBoundingClientRect().top) < 2 ? 1 : 2) : null } })()`)
    // (The row shows the limit the page last saved through its own form, $20.00: the raise to $25 above went straight through the bridge.)
    check(`E: at ${width} px nothing in Settings is past its edge (no sideways scroll); the Usage row for today reads "$0.00 of $20.00"${width > 340 ? ', on one line as before' : ', on two lines'}`, box?.past?.length === 0 && usage.dialogScrolls === false && usage.cell === '$0.00 of $20.00' && (width > 340 ? usage.cellLines === 1 : usage.cellLines === 2), show({ past: box?.past, usage }))
    await closeSettings()
  }
  await page.send('Emulation.clearDeviceMetricsOverride')
  await sleep(200)
  check('the page logged no errors and no warnings', page.problems.length === 0, show(page.problems))
} catch (error) {
  check(`the suite stopped before its end: ${String(error?.stack ?? error).slice(0, 500)}`, false)
} finally {
  try { await Q.release() } catch {}
  main.close()
  page.close()
}
process.exit(check.summary() ? 0 : 1)
