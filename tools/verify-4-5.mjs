// Slice 4.3/4.4: WHEN SAVING FAILS, in the real window. A disk fault is injected into the running app's main process
// (fs.promises.writeFile of a conversation's .tmp throws EIO, with a path in its message) and removed again, through the
// inspector. What does the person see, does retry work, does the page ever see a path, does the old file survive, and can a
// chat that was deleted after a failed save come back? Needs INSPECT_PORT, MOCK_PORT, USER_DATA_DIR, APP_LOG and a key
// (run setup-key.mjs first).
import './ts-resolve.mjs'
import { connect, checker, sleep } from './cdp.mjs'
import { assertScratchProfile } from './profile-guard.mjs'
import { h4, mainInspector } from './lib4.mjs'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const shots = process.argv[2]
const port = Number(process.argv[3] ?? 9222)
const { MOCK_PORT, USER_DATA_DIR: userData, INSPECT_PORT, APP_LOG } = process.env
const check = checker()
const page = await connect(port)
await assertScratchProfile()
const H = h4(page, { userData, mockUrl: `http://127.0.0.1:${MOCK_PORT}` })
const ev = H.ev
const main = await mainInspector(Number(INSPECT_PORT))
await page.waitFor(`!!document.querySelector('.header-select, .app-badge')`, { timeoutMs: 20000 })
await sleep(500)

const SECRET = 'C:\\\\very\\\\secret\\\\place'
const inject = () => main.inMain(`(() => { const fsp = process.mainModule.require('fs').promises; if (!globalThis.__realWrite) globalThis.__realWrite = fsp.writeFile; fsp.writeFile = async (p, ...r) => { if (String(p).endsWith('.json.tmp')) { const e = new Error('EIO: simulated disk failure, open ${SECRET}'); e.code = 'EIO'; throw e } return globalThis.__realWrite(p, ...r) }; return 'injected' })()`)
const heal = () => main.inMain(`(() => { const fsp = process.mainModule.require('fs').promises; if (globalThis.__realWrite) fsp.writeFile = globalThis.__realWrite; return 'healed' })()`)
const badge = () => ev(`(() => { const b = [...document.querySelectorAll('.app-header .app-badge-button')].find((x) => x.textContent === 'Not saved'); return b ? { text: b.textContent, title: b.title, tag: b.tagName } : null })()`)
const failures = () => (readFileSync(APP_LOG, 'utf8').match(/Saving a conversation failed/g) ?? []).length

// ===================== A. a normal save first =====================
await H.sendAndWait('before the failure')
const first = await H.waitFirst('before the failure', (c) => c.messages.length === 2 && c.messages[1].status === 'done')
check('precondition: the first exchange is saved, and there is no "Not saved" badge', (await badge()) === null && first.conv.messages.length === 2)
const shaBefore = H.sha(first.id)

// ===================== B. the disk fails =====================
check('the fault is injected into the main process', (await inject()) === 'injected')
await H.sendAndWait('during the failure')
await page.waitFor(`!![...document.querySelectorAll('.app-header .app-badge-button')].find((x) => x.textContent === 'Not saved')`, { timeoutMs: 6000 })
const b1 = await badge()
check('a "Not saved" button appears in the header, a real button', b1 !== null && b1.tag === 'BUTTON', JSON.stringify(b1))
check('...its tooltip says why in a plain sentence and offers to try again', /could not be saved on this computer/.test(b1.title) && /Click to try again/.test(b1.title), b1.title)
const hdr = await ev(`(() => { const h = document.querySelector('.app-header'); const cs = [...h.querySelectorAll('.app-title, .app-header-actions > *')].map((e) => { const r = e.getBoundingClientRect(); return (r.top + r.bottom) / 2 }); return { h: Math.round(h.getBoundingClientRect().height), spread: Math.round(Math.max(...cs) - Math.min(...cs)), vw: innerWidth, over: document.documentElement.scrollWidth > innerWidth } })()`)
check('...and with the real badge showing, the header is still ONE row at the default window (7.6, D-029)', hdr.h < 60 && hdr.spread <= 4 && !hdr.over, JSON.stringify(hdr))
check('...and the page never sees the disk error or the path inside it (only the app\'s log does)', !/EIO: |simulated disk failure|very.{1,3}secret.{1,3}place/.test(JSON.stringify(await ev(`document.documentElement.outerHTML`))) && !b1.title.includes('secret'), '')
const appLog = () => readFileSync(APP_LOG, 'utf8')
check('...the log has the real reason, once per failed attempt', failures() >= 1 && /Saving a conversation failed: EIO: simulated disk failure/.test(appLog()), String(failures()))
check('the old copy on disk survived the failure untouched (same bytes), and no temp file was left', H.sha(first.id) === shaBefore && H.strays().length === 0, JSON.stringify(H.files()))
const newChat = await H.chatButton('New chat')
check('New chat warns that starting another chat would lose the unsaved one', /not saved/i.test(newChat.title) && !newChat.disabled, newChat.title)
await H.openHistory()
check('the History dialog warns that the chat on screen is not saved', /not saved/i.test(await H.historyText()) && /would lose it/.test(await H.historyText()), (await H.historyText()).slice(0, 200).replace(/\s+/g, ' '))
await page.screenshot(`${shots}/4-5-not-saved.png`)
await H.closeHistory()
await page.screenshot(`${shots}/4-5-badge.png`)

// ===================== C. retry while the disk is still bad, then after it recovers =====================
const f0 = failures()
await page.click('.app-badge-button')
await sleep(900)
check('pressing "Not saved" while the disk is still failing really tries again (another failure is logged) and keeps the badge', failures() > f0 && (await badge()) !== null, `${f0} -> ${failures()}`)
check('(nothing was written meanwhile)', H.sha(first.id) === shaBefore)
await heal()
await page.click('.app-badge-button')
await page.waitFor(`![...document.querySelectorAll('.app-header .app-badge-button')].find((x) => x.textContent === 'Not saved')`, { timeoutMs: 6000 })
const saved = await H.waitConv(first.id, (c) => c.messages.length === 4)
check('after the disk recovers, pressing it saves the whole chat and the badge goes away', saved.messages[2].content === 'during the failure' && saved.messages[3].status === 'done' && (await badge()) === null, JSON.stringify(saved.messages.map((m) => m.content.slice(0, 12))))
check('...and no temp file is left', H.strays().length === 0)

// ===================== D. a failure, then the next message heals by itself =====================
await inject()
await H.sendAndWait('a message that cannot be saved')
await page.waitFor(`!![...document.querySelectorAll('.app-header .app-badge-button')].find((x) => x.textContent === 'Not saved')`, { timeoutMs: 6000 })
await heal()
await H.sendAndWait('and the next one')
await page.waitFor(`![...document.querySelectorAll('.app-header .app-badge-button')].find((x) => x.textContent === 'Not saved')`, { timeoutMs: 6000 })
const healed = await H.waitConv(first.id, (c) => c.messages.length === 8)
check('once the disk is back, the NEXT message saves everything, including the one that could not be saved, and the badge clears by itself', healed.messages[4].content === 'a message that cannot be saved' && healed.messages[6].content === 'and the next one')

// ===================== E. deleting a chat whose latest save failed must not bring it back =====================
await inject()
await H.sendAndWait('lost to the failure, then deleted')
await page.waitFor(`!![...document.querySelectorAll('.app-header .app-badge-button')].find((x) => x.textContent === 'Not saved')`, { timeoutMs: 6000 })
// The disk recovers BEFORE the person deletes the chat: the last snapshot is still unsaved (nothing has asked to save it
// again), so a delete that left it marked "unsaved" would have it saved again, right after being deleted.
await heal()
await H.openHistory()
const title = (await H.rows())[0].title
await H.clickRowButton(title, 'Delete')
await sleep(150)
await H.clickRowButton(title, 'Delete')
await page.waitFor(`document.querySelectorAll('dialog.history .history-row').length === 0`)
check('deleting the open chat removes its file and starts a new, empty chat', H.convFiles().length === 0 && (await H.screen()).length === 0, JSON.stringify(H.files()))
check('...and the "Not saved" badge goes, because it belonged to the chat that left the screen', (await badge()) === null)
await H.closeHistory()
await sleep(2500) // plenty of time for anything that wanted to save the deleted chat again
check('...and with the disk working again, nothing brings the deleted chat back (no file, an empty list)', H.convFiles().length === 0 && (await ev(`window.api.history.list()`)).conversations.length === 0 && H.strays().length === 0, JSON.stringify(H.files()))

// ===================== F. nothing leaked =====================
check('the fault is gone: a normal chat saves again', await (async () => { await H.sendAndWait('after everything'); return !!(await H.waitFirst('after everything', (c) => c.messages.length === 2 && c.messages[1].status === 'done')) })())
check('no console errors, warnings or exceptions in the page', page.problems.length === 0, page.problems.join(' | '))
main.close()
const passed = check.summary()
page.close()
process.exit(passed ? 0 : 1)
