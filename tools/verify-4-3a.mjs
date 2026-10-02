// Slice 4.3: the real window on a conversations folder in every state a crash or a hand edit could leave (seeded by
// run43a.mjs before launch). No key is saved on this profile: nothing here calls the network, except the one message sent
// at the end to prove a damaged-then-recovered conversation can be carried on (no key -> an error reply, which is saved too).
// Needs: USER_DATA_DIR, APP_LOG, and the seed manifest in %TEMP%.
import { connect, checker, sleep } from './cdp.mjs'
import { assertScratchProfile } from './profile-guard.mjs'
import { h4, shaFile } from './lib4.mjs'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const shots = process.argv[2]
const port = Number(process.argv[3] ?? 9222)
const { USER_DATA_DIR: userData } = process.env
const manifest = JSON.parse(readFileSync(join(process.env.TEMP ?? '.', 'frontier-4-3a-seeds.json'), 'utf8'))
const check = checker()
const page = await connect(port)
await assertScratchProfile()
const H = h4(page, { userData, mockUrl: 'http://127.0.0.1:1' })
const ev = H.ev
await page.waitFor(`!!document.querySelector('.header-select, .app-badge')`, { timeoutMs: 20000 })
await sleep(800)
const dir = manifest.dir
// a file can vanish between listing the folder and reading it (the app deletes a .tmp): skip it then
const hashNow = () => Object.fromEntries(readdirSync(dir).flatMap((n) => { try { return [[n, shaFile(join(dir, n))]] } catch { return [] } }))
const listed = manifest.seeds.filter((s) => s.listed)
const unreadable = manifest.seeds.filter((s) => s.unreadable)

// ===================== A. listing =====================
const list = await ev(`window.api.history.list()`)
check(`the app starts and lists the ${listed.length} readable conversations out of ${manifest.seeds.length} cases`, list.conversations.length === listed.length, JSON.stringify(list.conversations.map((c) => c.title)))
check('...newest first by the dates inside the files', JSON.stringify(list.conversations.map((c) => c.title)) === JSON.stringify([...listed].sort((a, b) => 0).map((s) => s.listed).sort((x, y) => (list.conversations.find((c) => c.title === y)?.updatedAt ?? 0) - (list.conversations.find((c) => c.title === x)?.updatedAt ?? 0))), JSON.stringify(list.conversations.map((c) => [c.title, c.updatedAt])))
check('...each with the right title and message count', listed.every((s) => { const c = list.conversations.find((x) => x.id === s.id); return c && c.title === s.listed && c.messageCount === s.messages }), JSON.stringify(list.conversations.map((c) => [c.title, c.messageCount])))
check('a torn real file, 5 MB of random bytes and a file from another version are counted as unreadable, and nothing else is', list.unreadable === unreadable.length, `${list.unreadable} of ${unreadable.length}`)
check('crash during the copy: the .tmp won (the list shows its title, not the torn file\'s)', list.conversations.some((c) => c.title === 'recovered from tmp') && !list.conversations.some((c) => c.title === 'old title'))
check('crash during the first write: the whole real file won over the cut-off .tmp', list.conversations.some((c) => c.title === 'kept final') && !list.conversations.some((c) => c.title === 'never finished'))
check('a byte-order mark did not make a good file unreadable', list.conversations.some((c) => c.title === 'with bom'))
await H.openHistory()
const rows = await H.rows()
const text = await H.historyText()
check('History shows the same rows, and says how many files could not be read, without a path', rows.length === listed.length && /3 saved files could not be read and was left as it is/.test(text) && !text.includes('README') , text.slice(text.indexOf('saved files') - 20, text.indexOf('saved files') + 100).replace(/\s+/g, ' '))
await page.screenshot(`${shots}/4-3a-history.png`)
await H.closeHistory()

// ===================== B. reading wrote nothing =====================
const before = manifest.hashes
const afterList = hashNow()
check('after starting up and listing, every seeded file is byte-for-byte what it was (damaged ones too), none added or removed', Object.entries(before).every(([n, h]) => afterList[n] === h) && Object.keys(afterList).length === Object.keys(before).length, JSON.stringify(Object.keys(afterList).filter((n) => before[n] !== afterList[n])))
const log = readFileSync(process.env.APP_LOG, 'utf8')
for (const s of unreadable) check(`the log names the unreadable case "${s.name}" by its id, once`, log.split(s.id).length - 1 === 1, String(log.split(s.id).length - 1))
check('...and the log shows no path, no file contents', !/AppData|conversations[\\/]/.test(log.split('\n').filter((l) => /saved conversation/.test(l)).join('\n')))

// ===================== C. opening them =====================
for (const s of listed) {
  await H.openHistory()
  await H.clickRow(s.listed)
  await page.waitFor(`!document.querySelector('dialog.history')?.open`)
  await sleep(250)
  const screen = await H.screen()
  check(`opening "${s.listed}" shows ${s.messages} messages`, screen.length === s.messages, JSON.stringify(screen.map((m) => m.text.slice(0, 12))))
  if (s.lastNote) check(`...a message saved as "streaming" opens as "${s.lastNote}", not as typing dots`, screen.at(-1).note === s.lastNote && !(await ev(`!!document.querySelector('.typing')`)) && (await H.replyReady()), JSON.stringify(screen.at(-1)))
  if (s.notes) check('...with the saved notes: the error text of the failed reply and "Stopped" for the stopped one', JSON.stringify(screen.map((m) => m.note)) === JSON.stringify(s.notes), JSON.stringify(screen.map((m) => m.note)))
  if (s.listed === 'recovered from tmp') check('...the recovered conversation shows the NEW text from the .tmp', screen[0].text === 'recovered from tmp' && screen[1].text === 'new answer')
}
const afterOpen = hashNow()
check('opening every one of them changed no file either', Object.entries(before).every(([n, h]) => afterOpen[n] === h))
await page.screenshot(`${shots}/4-3a-opened.png`)

// ===================== D. carrying on from a recovered conversation heals the folder =====================
const rec = manifest.seeds.find((s) => s.heal)
await H.openHistory()
await H.clickRow('recovered from tmp')
await page.waitFor(`!document.querySelector('dialog.history')?.open`)
await sleep(250)
await H.sendAndWait('carry on from the recovery')
const healed = await H.waitConv(rec.id, (c) => c.messages.length === 4 && c.messages[2].content === 'carry on from the recovery' && c.messages[3].status === 'error')
await sleep(400) // the save that wrote it has finished; let it delete its .tmp too
check('sending a message in the recovered conversation saves it: its file is whole again and has the .tmp\'s messages plus the new ones', healed.messages[0].content === 'recovered from tmp' && healed.messages[1].content === 'new answer' && healed.messages[3].status === 'error')
check('...and the leftover .tmp is gone', !existsSync(join(dir, `${rec.id}.json.tmp`)) && !readdirSync(dir).some((n) => n.startsWith(rec.id) && n !== `${rec.id}.json`), JSON.stringify(readdirSync(dir).filter((n) => n.startsWith(rec.id))))
const afterAll = hashNow()
const touched = Object.keys(before).filter((n) => afterAll[n] !== before[n])
check('...and it is the ONLY seeded file that changed: the damaged ones, the other conversations and the foreign files are untouched', JSON.stringify(touched.sort()) === JSON.stringify([`${rec.id}.json`, `${rec.id}.json.tmp`].sort()), JSON.stringify(touched))
// ===================== E. a file that goes bad or missing AFTER it was listed =====================
import { truncateSync, unlinkSync, writeFileSync } from 'node:fs'
await H.clickChat('New chat')
await sleep(300)
const victimBad = manifest.seeds.find((s) => s.listed === 'good a')
const victimGone = manifest.seeds.find((s) => s.listed === 'with bom')
const badPath = join(dir, `${victimBad.id}.json`)
truncateSync(badPath, 50) // the file was fine when listed; now it is cut off
const badHash = shaFile(badPath)
unlinkSync(join(dir, `${victimGone.id}.json`))
const listBefore = await ev(`window.api.history.list()`)
check('the list still shows both (main listed them before the files changed)', listBefore.conversations.some((c) => c.id === victimBad.id) && listBefore.conversations.some((c) => c.id === victimGone.id))
await H.openHistory()
await H.clickRow('good a')
await sleep(500)
const textBad = await H.historyText()
check('opening the one that was damaged since: the dialog stays open and says it could not be read', (await H.historyOpen()) && /could not be read/.test(textBad), textBad.slice(0, 160).replace(/\s+/g, ' '))
check('...the chat on screen did not change (still empty), and the damaged file was left exactly as it is', (await H.screen()).length === 0 && shaFile(badPath) === badHash)
const rowsE = await H.rows()
check('...and the damaged one has gone from the list, which now counts it as unreadable', !rowsE.some((r) => r.title === 'good a') && /4 saved files could not be read/.test(await H.historyText()), JSON.stringify(rowsE.map((r) => r.title)))
await H.clickRow('with bom')
await sleep(500)
const textGone = await H.historyText()
check('opening the one whose file was deleted: the dialog says it was not found, and the row goes', (await H.historyOpen()) && /not found/.test(textGone) && !(await H.rows()).some((r) => r.title === 'with bom'), textGone.slice(0, 120).replace(/\s+/g, ' '))
await H.closeHistory()
check('no console errors, warnings or exceptions in the page', page.problems.length === 0, page.problems.join(' | '))
const passed = check.summary()
page.close()
process.exit(passed ? 0 : 1)
