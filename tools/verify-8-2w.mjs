// Stage 8.2 (D-031), in the real window against the mock: the spending limits. On a profile that has never chosen any, the app asks for a daily and
// a monthly limit before the first send (nothing filled in for the person; "No limit" is a deliberate choice), and main refuses every request
// until both are chosen: from the page's own bridge as well as from the message box. Then real limits: a request under them goes, a request when
// a limit is reached is refused in main with a sentence that names the limit, and Regenerate ("Try again") and an edited message are refused the
// same way, nothing reaching the provider and nothing written to the ledger. The limits are changed in Settings (daily alone, monthly alone, both
// none), the file holds what was chosen, and what the page cannot do is checked (a limit that is not an amount, "not chosen" sent from the page,
// a missing side, extra fields). Needs: MOCK_PORT, USER_DATA_DIR (scratch, PRESEED_LIMITS=off) and a saved key (setup-key.mjs, which puts the
// first-run question off and leaves it to come back at the reload).
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
const ledgerFile = join(userData, 'usage', 'ledger.jsonl')
const limitsFile = join(userData, 'limits.json')
const UNSET_SENTENCE = 'Nothing was sent: no spending limits are set yet. Open Settings, set a daily and a monthly limit (or choose No limit), and try again.'

const ledgerLines = () => (existsSync(ledgerFile) ? readRetry(ledgerFile, 'utf8').split('\n').filter((l) => l !== '').length : 0)
const limitsText = () => (existsSync(limitsFile) ? readRetry(limitsFile, 'utf8') : null)
const reqCount = async () => (await H.mockReqs()).length
const status = () => ev('window.api.settings.getStatus()')
const limitsNow = async () => (await status()).limits
const dialogOpen = (cls) => ev(`!!document.querySelector('dialog.${cls}')?.open`)
const stray = () => readdirSync(userData).filter((n) => /limits/i.test(n))

/** What a request made straight through the page's bridge gets back (the events), whatever the window shows. */
const rawAsk = (text) => ev(`new Promise((resolve) => {
  const id = crypto.randomUUID()
  const events = []
  const off = window.api.chat.onEvent((e) => { if (e.streamId !== id) return; events.push(e); if (e.type === 'done' || e.type === 'error') { off(); resolve(events) } })
  window.api.chat.start({ streamId: id, messages: [{ role: 'user', content: ${JSON.stringify(text)} }] })
  setTimeout(() => { off(); resolve(events) }, 20000)
})`)

/** Types into a limit's box like a person (a real edit), after selecting what is there. Empty text clears the box. */
const fill = async (id, text) => {
  if (text === '') {
    await ev(`(() => { const i = document.getElementById(${JSON.stringify(id)}); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, ''); i.dispatchEvent(new Event('input', { bubbles: true })) })()`)
    return
  }
  await ev(`(() => { const i = document.getElementById(${JSON.stringify(id)}); i.focus(); i.select() })()`)
  await page.type(text)
}
/** Scrolls an element to the middle of what is visible: the Settings dialog is taller than the window, and a click on something below the fold lands on nothing. */
const reveal = async (selector) => { await ev(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({ block: 'center' })`); await sleep(80) }
/** Clicks a "No limit" box: which = 'daily' or 'monthly'. */
const clickNone = async (prefix, which) => {
  await ev(`(() => { const l = document.getElementById('${prefix}-${which}').closest('.limit-field').querySelector('.limit-none'); l.scrollIntoView({ block: 'center' }); l.setAttribute('data-click', '1') })()`)
  await sleep(80)
  await page.click('[data-click="1"]')
  await ev(`document.querySelector('[data-click="1"]')?.removeAttribute('data-click')`)
  await sleep(80)
}
/** What a limits form shows: both fields (value, disabled, No limit ticked, the problem under it), whether Save is off, the warning, the notice. */
const form = (prefix) => ev(`(() => {
  const g = (n) => { const i = document.getElementById('${prefix}-' + n); const w = i.closest('.limit-field'); return { value: i.value, disabled: i.disabled, none: w.querySelector('.limit-none input').checked, error: w.querySelector('.settings-notice-error')?.textContent ?? null } }
  const root = document.getElementById('${prefix}-daily').closest('form')
  return { daily: g('daily'), monthly: g('monthly'), saveOff: root.querySelector('button[type=submit]').disabled, saveText: root.querySelector('button[type=submit]').textContent, warning: root.querySelector('.limits-warning')?.textContent ?? null, hint: [...root.querySelectorAll('.settings-hint')].map((p) => p.textContent).join(' | '), notice: root.querySelector('p[role=status]')?.textContent ?? null }
})()`)
const openSettings = async () => {
  await page.click('.header-button@Settings')
  await page.waitFor(`!!document.querySelector('dialog.settings')?.open && !!document.getElementById('limits-settings-daily')`, { timeoutMs: 8000, label: 'Settings with the limits' })
  await sleep(150)
}
const closeSettings = async () => { await page.press('Escape'); await page.waitFor(`!document.querySelector('dialog.settings')?.open`, { timeoutMs: 4000 }); await sleep(150) }
const usageRows = () => ev(`[...document.querySelectorAll('.settings-usage tbody tr')].map((tr) => ({ label: tr.querySelector('th').textContent, cost: tr.children[2].textContent }))`)
/** Sets the limits in Settings, saves, and answers what the form said after. */
const setInSettings = async ({ daily, monthly, dailyNone = false, monthlyNone = false }) => {
  await openSettings()
  const now = await form('limits-settings')
  if (dailyNone !== now.daily.none) await clickNone('limits-settings', 'daily')
  if (monthlyNone !== now.monthly.none) await clickNone('limits-settings', 'monthly')
  if (!dailyNone) await fill('limits-settings-daily', daily)
  if (!monthlyNone) await fill('limits-settings-monthly', monthly)
  await sleep(100)
  const before = await form('limits-settings')
  await reveal('dialog.settings .limits-form button[type=submit]')
  await page.click('dialog.settings .limits-form button[type=submit]')
  await page.waitFor(`document.querySelector('dialog.settings .limits-form p[role=status]')?.textContent === 'Saved.'`, { timeoutMs: 6000, label: 'the limits to be saved' })
  const after = await form('limits-settings')
  await closeSettings()
  return { before, after }
}
const lastNote = () => H.noteText()
/** Sends from the message box and waits for the reply bubble to end with a note (an error): answers the note. Nothing is expected to reach the mock. */
const sendRefused = async (text) => {
  const count = await reqCount()
  await H.send(text)
  await page.waitFor(`!!document.querySelector('.message-assistant:last-child .message-note-error')`, { timeoutMs: 8000, label: 'a refusal under the reply' })
  await H.waitReady()
  await sleep(150)
  return { note: await lastNote(), mockDelta: (await reqCount()) - count }
}
const action = (text) => `${MSG}:last-child .message-action@${text}`

try {
  await page.waitFor(`document.readyState === 'complete' && !!document.querySelector('.header-select, .app-badge')`, { timeoutMs: 15000 })
  await sleep(400)

  // ============ A. first run: the app asks, and nothing is filled in ============
  check('a profile that has never chosen limits has no limits.json', limitsText() === null)
  check('the first-run question is open on its own (a modal dialog), titled "Set your spending limits"', (await dialogOpen('limits-dialog')) && (await ev(`document.getElementById('limits-dialog-title').textContent`)) === 'Set your spending limits')
  let f = await form('limits-first')
  check('...with a daily and a monthly box that are EMPTY (no preset number), neither "No limit" ticked, and Save off', f.daily.value === '' && f.monthly.value === '' && !f.daily.none && !f.monthly.none && f.saveOff && f.saveText === 'Save limits', JSON.stringify(f))
  check('...saying who bills the messages, that the app counts what a reply costs and does not send a request that would pass a limit, and that it can be changed in Settings', await ev(`/billed by the company that runs the model/.test(document.querySelector('dialog.limits-dialog').innerText) && /does not send a request that would pass a limit/.test(document.querySelector('dialog.limits-dialog').innerText) && /change them later in Settings/.test(document.querySelector('dialog.limits-dialog').innerText)`))
  check('...and a "Not now" button beside Save', await ev(`[...document.querySelectorAll('dialog.limits-dialog .button')].some((b) => b.textContent === 'Not now')`))
  check('the status main gives the page says neither limit is chosen', JSON.stringify(await limitsNow()) === JSON.stringify({ daily: { kind: 'unset' }, monthly: { kind: 'unset' } }), JSON.stringify(await limitsNow()))
  if (shots) await page.screenshot(`${shots}/8-2-first-run.png`)

  // The page's own bridge, with no limits chosen: refused in main, whatever the window shows.
  let mockBefore = await reqCount()
  let events = await rawAsk('hello before any limit')
  const sawStart = events.find((e) => e.type === 'start')
  const refusal = events.find((e) => e.type === 'error')
  check('a request through the bridge with no limits chosen is refused by main with the sentence that says to set them, and no text, no usage and no "done"', refusal?.message === UNSET_SENTENCE && !events.some((e) => ['text', 'usage', 'done'].includes(e.type)), JSON.stringify(events))
  check('...it was refused before anything was sent: the mock saw no request, and the ledger has no line (nothing was recorded)', (await reqCount()) === mockBefore && ledgerLines() === 0 && !existsSync(ledgerFile))
  check('...(it still said which model would answer: "start" came first)', !!sawStart && events[0].type === 'start')

  // typing: what the boxes say about what is typed
  await fill('limits-first-daily', 'abc')
  f = await form('limits-first')
  check('a box with text that is not an amount says what to type, and Save stays off', /Type an amount in dollars/.test(f.daily.error ?? '') && f.saveOff, JSON.stringify(f.daily))
  await fill('limits-first-daily', '0')
  check('zero is refused in the box ("more than $0")', /more than \$0/.test((await form('limits-first')).daily.error ?? ''))
  await fill('limits-first-daily', '5.005')
  check('three decimals are refused in the box', /two decimals/.test((await form('limits-first')).daily.error ?? ''))
  await fill('limits-first-daily', '20000')
  check('more than the most ($10,000) is refused, pointing to "No limit"', /\$10,000/.test((await form('limits-first')).daily.error ?? '') && /No limit/.test((await form('limits-first')).daily.error ?? ''))
  await fill('limits-first-daily', '5')
  f = await form('limits-first')
  check('a good daily amount alone leaves Save off (the monthly one is still empty), and says nothing about the empty box', f.daily.error === null && f.monthly.error === null && f.saveOff, JSON.stringify(f))
  await clickNone('limits-first', 'monthly')
  f = await form('limits-first')
  check('ticking "No limit" for the month turns its amount box off, shows a one-line warning that nothing in the app then stops spending, and turns Save on', f.monthly.none && f.monthly.disabled && /With No limit, nothing in this app stops spending for that period; only a limit set in your provider's own account would\./.test(f.warning ?? '') && !f.saveOff, JSON.stringify(f))
  await clickNone('limits-first', 'monthly')
  await fill('limits-first-monthly', '3')
  f = await form('limits-first')
  check('a daily limit above the monthly one is allowed but says the monthly one will always stop you first', !f.saveOff && /monthly limit will always stop you first/.test(f.hint), f.hint)
  await fill('limits-first-monthly', '50')
  f = await form('limits-first')
  check('with 5 and 50: no warning, no hint about the order, no problem, Save on', f.warning === null && !/always stop you first/.test(f.hint) && f.daily.error === null && f.monthly.error === null && !f.saveOff, JSON.stringify(f))
  await fill('limits-first-daily', '')
  check('...and emptying a box turns Save off again, without shouting', (await form('limits-first')).saveOff && (await form('limits-first')).daily.error === null)

  // "Not now": the question is put off, and nothing is sent meanwhile
  await page.click('dialog.limits-dialog .button@Not now')
  await page.waitFor(`!document.querySelector('dialog.limits-dialog')?.open`, { timeoutMs: 4000 })
  check('"Not now" closes the question and chooses nothing (no file, both still not chosen)', limitsText() === null && JSON.stringify(await limitsNow()) === JSON.stringify({ daily: { kind: 'unset' }, monthly: { kind: 'unset' } }))
  check('the empty chat then says "Set your spending limits to start chatting" with a "Set limits" button, and not "Type a message to start."', await ev(`/^Set your spending limits to start chatting\\./.test(document.querySelector('.empty-state').innerText) && !!document.querySelector('.empty-state .link-button') && document.querySelector('.empty-state .link-button').textContent === 'Set limits'`))
  mockBefore = await reqCount()
  const put = await sendRefused('hello from the message box')
  check('a message typed in the message box is refused too: the reply says the same sentence in its red note, and the mock saw nothing', put.note === UNSET_SENTENCE && put.mockDelta === 0 && ledgerLines() === 0, JSON.stringify(put))
  check('...and the failed reply offers "Try again"', await ev(`[...document.querySelectorAll('${MSG}:last-child .message-action')].some((b) => b.textContent === 'Try again')`))
  await page.click(action('Try again'))
  await page.waitFor(`!!document.querySelector('.message-assistant:last-child .message-note-error')`, { timeoutMs: 8000 })
  await H.waitReady()
  await sleep(150)
  check('"Try again" with no limits chosen is refused the same way (it is a request like any other), nothing sent or written', (await lastNote()) === UNSET_SENTENCE && (await reqCount()) === mockBefore && ledgerLines() === 0)
  await page.click('.chat-button@New chat')
  await page.waitFor(`document.querySelectorAll('${MSG}').length === 0`, { timeoutMs: 6000 })
  await sleep(150)
  await page.click('.empty-state .link-button@Set limits')
  await page.waitFor(`!!document.querySelector('dialog.limits-dialog')?.open`, { timeoutMs: 4000 })
  f = await form('limits-first')
  check('"Set limits" asks the question again, with the boxes empty again (a draft is not kept)', f.daily.value === '' && f.monthly.value === '' && f.saveOff)

  // choose 5 and 50
  await fill('limits-first-daily', '5')
  await fill('limits-first-monthly', '50')
  await page.click('dialog.limits-dialog button[type=submit]')
  await page.waitFor(`!document.querySelector('dialog.limits-dialog')?.open`, { timeoutMs: 6000, label: 'the question to close after Save' })
  check('Save closes the question by itself, and main now has 5 dollars a day and 50 a month', JSON.stringify(await limitsNow()) === JSON.stringify({ daily: { kind: 'usd', usd: 5 }, monthly: { kind: 'usd', usd: 50 } }), JSON.stringify(await limitsNow()))
  check('limits.json holds exactly {"version":1,"daily":5,"monthly":50}, and nothing else beside it by that name', limitsText() === '{"version":1,"daily":5,"monthly":50}' && JSON.stringify(stray()) === '["limits.json"]', JSON.stringify([limitsText(), stray()]))
  check('the empty chat says "Type a message to start." again', await ev(`document.querySelector('.empty-state')?.innerText === 'Type a message to start.'`))

  // ============ B. under the limits: a request goes ============
  const ok1 = await H.askMock('hello under the limits')
  check('with 5 and 50 chosen, a request is sent: the mock got it, and the ledger has its two lines', !!ok1 && ledgerLines() === 2, JSON.stringify([!!ok1, ledgerLines()]))
  check('...and the reply shows its cost (25 in, 12 out, $0.0003)', await H.lastAssistant(`a.querySelector('.message-usage')?.textContent`) === '25 in, 12 out, $0.0003')

  // ============ C. Settings shows them, with how much of each has gone ============
  await openSettings()
  f = await form('limits-settings')
  check('Settings > Spending limits shows 5.00 and 50.00, no "No limit" ticked, and Save off (nothing changed)', f.daily.value === '5.00' && f.monthly.value === '50.00' && !f.daily.none && !f.monthly.none && f.saveOff && f.notice === null, JSON.stringify(f))
  await page.waitFor(`document.querySelectorAll('.settings-usage tbody tr').length === 3`, { timeoutMs: 6000 })
  let rows = await usageRows()
  check('Usage says how much of each limit has gone: "Today ... $0.0003 of $5.00" and "This month ... $0.0003 of $50.00", and nothing for the chat', rows[0].cost === '$0.0003' && rows[1].cost === '$0.0003 of $5.00' && rows[2].cost === '$0.0003 of $50.00', JSON.stringify(rows))
  const sectionText = await ev(`document.querySelector('[aria-labelledby=settings-limits-heading]').innerText`)
  check('the section says a request that would pass a limit is not sent, that a reply that starts under a limit can end a little over, and that deleting usage/ledger.jsonl starts the count again from zero', /not sent/.test(sectionText) && /can end a little over it, by at most that one reply/.test(sectionText) && /usage\/ledger\.jsonl/.test(sectionText) && /Deleting that file starts the count again from zero/.test(sectionText), sectionText.slice(0, 700))
  if (shots) { await ev(`document.getElementById('settings-limits-heading').scrollIntoView({ block: 'start' })`); await sleep(150); await page.screenshot(`${shots}/8-2-settings.png`) }
  await closeSettings()

  // ============ D. a limit that is reached: send, Try again and Edit are all refused ============
  const heavy = await H.askMock('[[mock:heavy]] a big one')
  check('a request that STARTS under the limit goes, even if it ends far over it: a million tokens in and a hundred thousand out ($6.00 at Opus) against a $5 daily limit', !!heavy && (await H.lastAssistant(`a.querySelector('.message-usage')?.textContent`)) === '1,000,000 in, 100,000 out, $6.00')
  const lines0 = ledgerLines()
  const mock0 = await reqCount()
  const r1 = await sendRefused('after the big one')
  const daily = /^Nothing was sent: you have reached your daily limit of \$5\.00 \(\$6\.00 so far today\)\. You can raise the limit in Settings \(today's count starts again at midnight\)\.$/
  check('the next message is refused in main with a sentence that names the DAILY limit, its amount, what has been spent, where to raise it and when the count starts again, and does not mention the monthly one', daily.test(r1.note ?? '') && !/monthly/.test(r1.note ?? ''), r1.note)
  check('...nothing reached the mock, and no line was written to the ledger', r1.mockDelta === 0 && ledgerLines() === lines0 && (await reqCount()) === mock0)
  await page.click(action('Try again'))
  await page.waitFor(`document.querySelector('.message-assistant:last-child .message-note-error')?.textContent.startsWith('Nothing was sent: you have reached')`, { timeoutMs: 8000 })
  await H.waitReady()
  await sleep(150)
  check('"Try again" (Regenerate) is refused the same way: same sentence, nothing sent or written', daily.test((await lastNote()) ?? '') && (await reqCount()) === mock0 && ledgerLines() === lines0, await lastNote())
  // Edit the last message of the person and send it again
  await page.click(`${MSG}:nth-last-child(2) .message-action@Edit`)
  await page.waitFor(`!!document.querySelector('.message-edit textarea')`, { timeoutMs: 6000 })
  await ev(`(() => { const t = document.querySelector('.message-edit textarea'); const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; set.call(t, 'after the big one, edited'); t.dispatchEvent(new Event('input', { bubbles: true })) })()`)
  await ev(`(() => { const b = [...document.querySelectorAll('.message-edit button')].find((x) => x.type === 'submit'); b.setAttribute('data-click', '1') })()`)
  await page.click('[data-click="1"]')
  await ev(`document.querySelector('[data-click="1"]')?.removeAttribute('data-click')`)
  await page.waitFor(`document.querySelector('.message-assistant:last-child .message-note-error')?.textContent.startsWith('Nothing was sent: you have reached') && !document.querySelector('.message-edit')`, { timeoutMs: 8000, label: 'the edited message to be refused' })
  await H.waitReady()
  await sleep(150)
  check('an edited message sent again is refused the same way: nothing sent or written', daily.test((await lastNote()) ?? '') && (await reqCount()) === mock0 && ledgerLines() === lines0, await lastNote())
  events = await rawAsk('through the bridge, over the limit')
  check('a request through the page\'s bridge is refused with the same sentence (the page cannot get round it)', events.at(-1)?.type === 'error' && daily.test(events.at(-1).message) && (await reqCount()) === mock0, JSON.stringify(events.at(-1)))
  rows = await (async () => { await openSettings(); await page.waitFor(`document.querySelectorAll('.settings-usage tbody tr').length === 3`, { timeoutMs: 6000 }); const r = await usageRows(); await closeSettings(); return r })()
  check('Usage then reads "$6.00 of $5.00" for the day (over its limit) and "$6.00 of $50.00" for the month', rows[1].cost === '$6.00 of $5.00' && rows[2].cost === '$6.00 of $50.00', JSON.stringify(rows))

  // ============ E. raising the limit in Settings lets the next request through ============
  const e1 = await setInSettings({ daily: '10', monthly: '50' })
  check('Settings: changing the daily limit to 10 enables Save, and after saving says "Saved." and Save is off again', e1.before.daily.value === '10' && !e1.before.saveOff && e1.after.notice === 'Saved.' && e1.after.saveOff, JSON.stringify([e1.before, e1.after]))
  check('...main and the file have 10 and 50', JSON.stringify((await limitsNow())) === JSON.stringify({ daily: { kind: 'usd', usd: 10 }, monthly: { kind: 'usd', usd: 50 } }) && limitsText() === '{"version":1,"daily":10,"monthly":50}', limitsText())
  const mockE = await reqCount()
  await page.click(action('Try again'))
  await page.waitFor(`!document.querySelector('.message-assistant:last-child .message-note-error') && !!document.querySelector('.message-assistant:last-child .message-usage')`, { timeoutMs: 15000, label: 'the retried reply' })
  await H.waitReady()
  check('"Try again" now goes through (6.00 spent, 10 allowed): the mock got a request and the reply has a cost line', (await reqCount()) === mockE + 1 && /\$/.test(await H.lastAssistant(`a.querySelector('.message-usage')?.textContent`)))

  // ============ F. the monthly limit alone ============
  const f1 = await setInSettings({ dailyNone: true, monthly: '6.50' })
  check('Settings: "No limit" for the day with 6.50 for the month: the daily box is off, the warning shows, and the file holds {"daily":"none","monthly":6.5}', f1.before.daily.none && f1.before.daily.disabled && /nothing in this app stops spending/.test(f1.before.warning ?? '') && limitsText() === '{"version":1,"daily":"none","monthly":6.5}', limitsText())
  const okF = await H.askMock('under the monthly limit')
  check('a request under the monthly limit goes (about 6.00 of 6.50 spent)', !!okF)
  const bigF = await H.askMock('[[mock:heavy]] and again')
  check('another big one starts under it and goes, and ends at about $12 this month (the limit can be passed by one reply, as the section says)', !!bigF && (await H.lastAssistant(`a.querySelector('.message-usage')?.textContent`)) === '1,000,000 in, 100,000 out, $6.00')
  const linesF = ledgerLines()
  const mockF = await reqCount()
  const rF = await sendRefused('over the monthly limit')
  const monthly = /^Nothing was sent: you have reached your monthly limit of \$6\.50 \(\$1\d\.\d\d so far this month\)\. You can raise the limit in Settings \(this month's count starts again on the 1st\)\.$/
  check('now it is refused naming the MONTHLY limit only (the day has no limit), with the 1st as when it starts again', monthly.test(rF.note ?? '') && !/daily|midnight/.test(rF.note ?? ''), rF.note)
  check('...nothing sent, nothing written', rF.mockDelta === 0 && ledgerLines() === linesF && (await reqCount()) === mockF)

  // ============ G. No limit at all ============
  const g1 = await setInSettings({ dailyNone: true, monthlyNone: true })
  check('Settings: "No limit" for both is saved (the file holds "none" and "none")', limitsText() === '{"version":1,"daily":"none","monthly":"none"}' && g1.after.notice === 'Saved.', limitsText())
  const okG = await H.askMock('no limit at all')
  check('with No limit for both a request goes however much is spent: the monthly total is over $12 and it is sent', !!okG)
  await openSettings()
  rows = await (async () => { await page.waitFor(`document.querySelectorAll('.settings-usage tbody tr').length === 3`, { timeoutMs: 6000 }); return usageRows() })()
  check('...and Usage then shows plain costs with no "of" (there is no limit to compare with)', rows.slice(1).every((r) => !/ of /.test(r.cost)), JSON.stringify(rows))
  await closeSettings()

  // ============ H. what the page cannot do ============
  const before = limitsText()
  const tries = [
    ['an amount of zero', { daily: { kind: 'usd', usd: 0 }, monthly: { kind: 'none' } }],
    ['a negative amount', { daily: { kind: 'usd', usd: -5 }, monthly: { kind: 'none' } }],
    ['an amount as text', { daily: { kind: 'usd', usd: '5' }, monthly: { kind: 'none' } }],
    ['a fraction of a cent', { daily: { kind: 'usd', usd: 5.005 }, monthly: { kind: 'none' } }],
    ['more than the most', { daily: { kind: 'usd', usd: 10001 }, monthly: { kind: 'none' } }],
    ['"not chosen" (a choice cannot be taken back)', { daily: { kind: 'unset' }, monthly: { kind: 'none' } }],
    ['one side missing', { daily: { kind: 'none' } }],
    ['nothing', null],
    ['a text', 'none']
  ]
  for (const [name, input] of tries) {
    const result = await ev(`window.api.settings.setLimits(${JSON.stringify(input)})`)
    check(`setLimits with ${name} is refused with a sentence, and nothing changes`, result.ok === false && typeof result.error === 'string' && limitsText() === before && JSON.stringify((await limitsNow())) === JSON.stringify({ daily: { kind: 'none' }, monthly: { kind: 'none' } }), JSON.stringify(result))
  }
  const clean = await ev(`window.api.settings.setLimits({ daily: { kind: 'usd', usd: 5, evil: '<b>x</b>' }, monthly: { kind: 'none', usd: 3, other: 1 }, extra: 1 })`)
  check('fields the page adds are not kept: the file holds exactly {"version":1,"daily":5,"monthly":"none"}', clean.ok === true && limitsText() === '{"version":1,"daily":5,"monthly":"none"}', limitsText())
  check('the page has setLimits to choose limits, and no function to take them back, read the file or reach the ledger', (await ev(`JSON.stringify(Object.keys(window.api.settings).sort())`)) === JSON.stringify(['clearApiKey', 'getStatus', 'setApiKey', 'setAskFirst', 'setEffort', 'setLimits', 'setModel', 'testApiKey'].sort()) && (await ev(`JSON.stringify(Object.keys(window.api).sort())`)) === '["attachments","audit","changes","chat","history","instructions","memory","programs","projects","settings","tools","usage","workspace"]') // attachments since 9.2 (D-037), instructions since 10.2, memory since 10.4 and projects since 10.5 (D-039)

  // leave it as the restart suite expects: 10 a day (already over by the two big ones), 50 a month
  await ev(`window.api.settings.setLimits({ daily: { kind: 'usd', usd: 10 }, monthly: { kind: 'usd', usd: 50 } })`)
  check('left at 10 a day and 50 a month for the restart', limitsText() === '{"version":1,"daily":10,"monthly":50}')
  await sleep(300)
} finally {
  standIn.main.close()
  page.close()
}
const ok = check.summary()
process.exit(ok ? 0 : 1)
