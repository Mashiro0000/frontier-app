// Stage 8b (D-034), in the real window: backing up chats to a file and restoring from one. The system's save and open dialogs are replaced from the main
// process's inspector (they cannot be driven from the page): each ask is recorded, and answered with a path the suite chose, or with "the person closed it".
// What is checked: the buttons and their states; a backup of all chats, of one, a cancelled dialog, a place inside the app's data folder; the notice after
// each; the preview of a backup (counts, titles, "not whole", a changed chat, a chat with instructions), the safe button having the focus, Escape; what is
// added (byte for byte what was there before) and what is not; that a restore never replaces; what the page cannot do through the bridge; the dialog at
// narrow widths. Needs: USER_DATA_DIR (scratch, seeded by run8b.mjs with five chats), FILES_DIR (the backup files), INSPECT_PORT.
import './ts-resolve.mjs'
import { connect, checker, sleep } from './cdp.mjs'
import { assertScratchProfile } from './profile-guard.mjs'
import { h4, mainInspector } from './lib4.mjs'
import { backup, makeChat, fileText, same, snapshot } from './lib8b.mjs'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const shots = process.argv[2]
const port = Number(process.argv[3] ?? 9222)
const userData = process.env.USER_DATA_DIR
const FILES = process.env.FILES_DIR
const inspectPort = Number(process.env.INSPECT_PORT)
if (!userData || !FILES || !inspectPort) throw new Error('USER_DATA_DIR, FILES_DIR and INSPECT_PORT must be set')
const check = checker()
const page = await connect(port)
await assertScratchProfile()
const H = h4(page, { userData, mockUrl: undefined })
const { ev } = H
const main = await mainInspector(inspectPort)
const convDir = join(userData, 'conversations')
const chats = Array.from({ length: 5 }, (_, i) => makeChat(i))
const byTitle = (title) => chats.find((c) => c.title === title)
const ALL = join(FILES, 'all.jsonl')
const CUT = join(FILES, 'cut.jsonl')
const TAMPERED = join(FILES, 'tampered.jsonl')
const LETTER = join(FILES, 'notbackup.txt')
const OUT = join(FILES, 'out')

// The system's dialogs, played from here (see the top).
await main.inMain(`(() => {
  const { dialog, ipcMain } = process.mainModule.require('electron')
  globalThis.__picks = { save: [], open: [], calls: [], hold: null, release: null, cancelled: [] }
  const answer = async (kind, args) => {
    const p = globalThis.__picks
    p.calls.push({ kind, withWindow: args.length > 1, options: args[args.length - 1] })
    if (p.hold) await p.hold
    const next = p[kind].shift()
    if (next === undefined || next === null) return kind === 'save' ? { canceled: true } : { canceled: true, filePaths: [] }
    return kind === 'save' ? { canceled: false, filePath: next } : { canceled: false, filePaths: [next] }
  }
  dialog.showSaveDialog = (...args) => answer('save', args)
  dialog.showOpenDialog = (...args) => answer('open', args)
  const original = ipcMain.listeners('history:restore-cancel')
  ipcMain.removeAllListeners('history:restore-cancel')
  ipcMain.on('history:restore-cancel', (...args) => { globalThis.__picks.cancelled.push(String(args[1]).length); for (const l of original) l(...args) })
  return true
})()`)
const queue = (kind, value) => main.inMain(`globalThis.__picks.${kind}.push(${JSON.stringify(value)}); true`)
const calls = async () => JSON.parse(await main.inMain('JSON.stringify(globalThis.__picks.calls)'))
const resetCalls = () => main.inMain('globalThis.__picks.calls.length = 0; globalThis.__picks.cancelled.length = 0; true')
const cancelCount = () => main.inMain('globalThis.__picks.cancelled.length')
const holdDialogs = () => main.inMain(`(() => { const p = globalThis.__picks; p.hold = new Promise((r) => { p.release = r }); return true })()`)
const releaseDialogs = () => main.inMain(`(() => { const p = globalThis.__picks; const r = p.release; p.hold = null; r(); return true })()`)

const footer = () => ev(`[...document.querySelectorAll('dialog.history .history-footer button')].map((b) => ({ text: b.textContent.trim(), disabled: b.disabled }))`)
const footerButton = async (text) => (await footer()).find((b) => b.text === text)
const notice = () => ev(`(() => { const n = document.querySelector('dialog.history .backup-notice'); return n ? { text: n.textContent, role: n.getAttribute('role'), error: n.classList.contains('history-notice-error') } : null })()`)
const panel = () => ev(`(() => { const p = document.querySelector('dialog.history .backup-preview'); if (!p) return null; return { text: p.innerText, buttons: [...p.querySelectorAll('button')].map((b) => ({ text: b.textContent.trim(), disabled: b.disabled })), focused: document.activeElement?.textContent?.trim() ?? '', facts: [...p.querySelectorAll('.backup-preview-facts li')].map((li) => li.innerText), titles: [...p.querySelectorAll('.backup-preview-titles li')].map((li) => li.innerText), why: [...p.querySelectorAll('.backup-preview-why li')].map((li) => li.innerText), notices: [...p.querySelectorAll('.history-notice')].map((n) => n.innerText) } })()`)
// A click lands where the button is on screen, and a narrow window scrolls the dialog: bring the button to the middle first.
const reveal = async (css, text) => { await ev(`(() => { const el = [...document.querySelectorAll(${JSON.stringify(css)})].find((e) => e.textContent.trim() === ${JSON.stringify(text)}); el?.scrollIntoView({ block: 'center' }) })()`); await sleep(80) }
const clickFooter = async (text) => { await reveal('dialog.history .history-footer .history-button', text); await page.click(`dialog.history .history-footer .history-button@${text}`) }
const clickPanel = async (text) => { await reveal('dialog.history .backup-preview button', text); await page.click(`dialog.history .backup-preview button@${text}`) }
const rowTitles = () => ev(`[...document.querySelectorAll('dialog.history .history-row .history-title')].map((e) => e.textContent)`)
const waitRows = (n) => page.waitFor(`document.querySelectorAll('dialog.history .history-row').length === ${n}`, { timeoutMs: 15000, label: `${n} rows` })
const waitNotice = () => page.waitFor(`!!document.querySelector('dialog.history .backup-notice')`, { timeoutMs: 20000, label: 'a notice' })
const waitPanel = () => page.waitFor(`!!document.querySelector('dialog.history .backup-preview')`, { timeoutMs: 20000, label: 'the preview' })
const readAll = async (path) => { const got = []; const read = await backup.readBackup(path, (chat) => { got.push(chat) }); return { read, got } }
const convFilesNow = () => H.convFiles().map((n) => n.replace('.json', ''))
const onDisk = (id) => readFileSync(join(convDir, `${id}.json`), 'utf8')
// Chromium keeps its own files in the profile and changes them all the time, so only what the APP owns is compared.
const appOwned = () => readdirSync(userData).filter((n) => /^(conversations|usage|limits\.json|ask-first\.json|preferences\.json|credentials.*|.*\.jsonl|.*\.part|.*\.tmp)$/i.test(n)).sort().join(',')
const ownedSnapshot = async () => `${await snapshot(convDir)}#${appOwned()}`

try {
  await page.waitFor(`!!document.querySelector('.chat-bar')`, { timeoutMs: 20000, label: 'the app' })
  await sleep(400)
  const topBefore = appOwned()

  // ============ 1. the dialog ============
  await H.openHistory()
  await waitRows(5)
  check('the History dialog lists the five seeded chats', (await rowTitles()).length === 5 && same([...(await rowTitles())].sort(), chats.map((c) => c.title).sort()), JSON.stringify(await rowTitles()))
  const buttons = await footer()
  check('the footer has "Back up all chats...", "Restore from a backup..." and Close, none disabled', same(buttons.map((b) => b.text), ['Back up all chats...', 'Restore from a backup...', 'Close']) && buttons.every((b) => !b.disabled), JSON.stringify(buttons))
  check('every row has an Export button and a Delete button', await ev(`[...document.querySelectorAll('dialog.history .history-row')].every((r) => { const t = [...r.querySelectorAll('button')].map((b) => b.textContent.trim()); return t.includes('Export') && t.includes('Delete') })`))
  check('every Export button says which chat it is for (its accessible name)', await ev(`[...document.querySelectorAll('dialog.history .history-row')].every((r) => { const b = [...r.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Export'); return b.getAttribute('aria-label').startsWith('Export the chat "') && b.getAttribute('aria-label').includes(r.querySelector('.history-title').textContent) })`))
  const hint = await H.historyText()
  check('the dialog still says the chats are plain files and not encrypted, and now says what a backup is and that a restore never replaces a chat', /as plain files\. Unlike your API key, the app does not encrypt them/.test(hint) && /never replaces a saved one/.test(hint) && /choose the place for/.test(hint), hint.slice(-420))
  check('no notice and no preview until something is asked', (await notice()) === null && (await panel()) === null)
  const savedChatFiles = await snapshot(convDir)

  // ============ 2. a backup of all chats ============
  const allOut = join(OUT, 'my-backup.jsonl')
  await resetCalls()
  await queue('save', allOut)
  await clickFooter('Back up all chats...')
  await waitNotice()
  const n1 = await notice()
  check('after a backup the notice says how many chats, where, and that the file was read back (a status, not an alert)', n1.role === 'status' && !n1.error && n1.text.startsWith('Backed up 5 chats to ') && n1.text.includes(allOut) && /read back and every chat matched/.test(n1.text), n1.text)
  const c1 = await calls()
  check('the save dialog was asked once, for the window (modal), with a name of the date, the backup file type, and an ask before replacing', c1.length === 1 && c1[0].kind === 'save' && c1[0].withWindow && /frontier-chats-\d{4}-\d{2}-\d{2}\.jsonl$/.test(c1[0].options.defaultPath) && same(c1[0].options.filters, [{ name: 'Frontier chat backup', extensions: ['jsonl'] }]) && c1[0].options.properties.includes('showOverwriteConfirmation'), JSON.stringify(c1))
  const w1 = await readAll(allOut)
  check('the file is a whole backup of exactly the five chats, each as it was saved', w1.read.complete && w1.got.length === 5 && w1.got.every((g) => same(g, chats.find((c) => c.id === g.id))) && w1.read.trailer.leftOut === 0)
  check('the saved chats themselves were not touched, and nothing else appeared in the profile', savedChatFiles === (await snapshot(convDir)) && topBefore === appOwned() && !existsSync(`${allOut}.part`))
  check('the buttons are enabled again once it is done', (await footer()).every((b) => !b.disabled))
  await page.screenshot(join(shots, 'v8b-after-backup.png'))

  // ============ 3. the person closes the dialog ============
  await resetCalls()
  await queue('save', null)
  await clickFooter('Back up all chats...')
  await page.waitFor(`!document.querySelector('dialog.history .history-footer button:disabled')`, { timeoutMs: 8000 })
  await sleep(250)
  check('the person closes the save dialog: the old notice is gone and no new one appears (a cancel is not an error), nothing written', (await notice()) === null && (await calls()).length === 1 && readdirSync(OUT).join() === 'my-backup.jsonl')

  // ============ 4. while a dialog is open ============
  await holdDialogs()
  await queue('save', join(OUT, 'held.jsonl'))
  await resetCalls()
  await clickFooter('Back up all chats...')
  await page.waitFor(`[...document.querySelectorAll('dialog.history .history-footer button')].some((b) => b.disabled)`, { timeoutMs: 8000 })
  const during = await footer()
  const rowButtonsDuring = await ev(`[...document.querySelectorAll('dialog.history .history-row button')].every((b) => b.disabled)`)
  check('while the system dialog is open every button in the History dialog is off (except Close), so nothing can be started twice', during.filter((b) => b.text !== 'Close').every((b) => b.disabled) && rowButtonsDuring, JSON.stringify(during))
  await ev(`document.querySelector('dialog.history .history-footer button').click()`) // a click on a disabled button does nothing
  await sleep(150)
  check('...and a second click opened no second dialog', (await calls()).length === 1)
  await releaseDialogs()
  await waitNotice()
  check('...then it finishes: a notice, the buttons back on, the file where it was asked to go', (await notice()).text.startsWith('Backed up 5 chats') && (await footer()).every((b) => !b.disabled) && existsSync(join(OUT, 'held.jsonl')))

  // ============ 5. one chat ============
  const target = chats[3]
  const oneOut = join(OUT, 'one-chat.jsonl')
  await resetCalls()
  await queue('save', oneOut)
  await H.clickRowButton(target.title, 'Export')
  await page.waitFor(`/Backed up 1 chat to /.test(document.querySelector('dialog.history .backup-notice')?.textContent ?? '')`, { timeoutMs: 20000, label: 'the notice for one chat' })
  const w2 = await readAll(oneOut)
  const c2 = await calls()
  check('Export on a row backs up that one chat: "1 chat", a whole file of exactly it, a name with the first 8 characters of its id', w2.read.complete && w2.got.length === 1 && same(w2.got[0], target) && c2.length === 1 && c2[0].options.defaultPath.endsWith(`-${target.id.slice(0, 8)}.jsonl`), JSON.stringify(c2))

  // ============ 6. a place the person may not choose ============
  for (const [name, place] of [['a key file in the app\'s data folder', join(userData, 'preferences.json')], ['a new file in the folder of the saved chats', join(convDir, 'x.jsonl')]]) {
    const beforeData = await ownedSnapshot()
    await queue('save', place)
    await clickFooter('Back up all chats...')
    await page.waitFor(`/own data folder/.test(document.querySelector('dialog.history .backup-notice')?.textContent ?? '')`, { timeoutMs: 20000, label: 'the refusal' })
    const n = await notice()
    check(`a backup to ${name} is refused with a sentence (an alert), and nothing in the data folder changed`, n.role === 'alert' && n.error && beforeData === (await ownedSnapshot()), n.text)
  }

  // ============ 7. restoring what is all here ============
  await resetCalls()
  await queue('open', ALL)
  await clickFooter('Restore from a backup...')
  await waitPanel()
  let p = await panel()
  const c3 = await calls()
  check('the open dialog was asked once, for the window, for a backup file (or any file), starting in the documents folder', c3.length === 1 && c3[0].kind === 'open' && c3[0].withWindow && same(c3[0].options.properties, ['openFile']) && c3[0].options.filters.length === 2 && c3[0].options.filters[0].extensions[0] === 'jsonl', JSON.stringify(c3))
  check('looking at a backup whose five chats are all here: "0 new", "5 already here", the file name only, "Nothing to add" is off, and the safe button has the focus', /Restore from\s*all\.jsonl/.test(p.text) && !p.text.includes(FILES) && p.facts[0].includes('0 chats') && p.facts[1].includes('5 chats') && p.buttons.some((b) => b.text === 'Nothing to add' && b.disabled) && p.focused === 'Back to the list', JSON.stringify(p))
  check('the list is hidden while the preview is shown, and Back up and Restore are off', (await rowTitles()).length === 0 && (await footer()).filter((b) => b.text !== 'Close').every((b) => b.disabled))
  check('the preview says when it was made and that the file is whole (no "not whole" warning), and with nothing to add it has no "add only a backup you trust" line', /Made /.test(p.text) && !/not whole/.test(p.text) && !/Add only a backup/.test(p.text), p.text.slice(0, 200))
  await clickPanel('Back to the list')
  await page.waitFor(`!document.querySelector('dialog.history .backup-preview')`)
  await waitRows(5)
  check('Back to the list: the preview goes, the list is back, and the page told main to let the file go (once)', (await panel()) === null && (await cancelCount()) === 1 && savedChatFiles === (await snapshot(convDir)), String(await cancelCount()))

  // ============ 8. delete two chats, then restore them ============
  const gone = [chats[0], chats[1]] // chat 0 has instructions of its own
  for (const chat of gone) {
    await H.clickRowButton(chat.title, 'Delete')
    await page.waitFor(`!!document.querySelector('dialog.history .history-ask')`)
    await H.clickRowButton(chat.title, 'Delete')
    await page.waitFor(`![...document.querySelectorAll('dialog.history .history-title')].some((e) => e.textContent === ${JSON.stringify(chat.title)})`, { timeoutMs: 8000 })
  }
  await waitRows(3)
  check('two chats deleted in the window: three rows and three files', convFilesNow().length === 3 && !existsSync(join(convDir, `${chats[0].id}.json`)))
  await resetCalls()
  await queue('open', ALL)
  await clickFooter('Restore from a backup...')
  await waitPanel()
  p = await panel()
  check('the preview now says "2 new" and "3 already here"', p.facts[0].includes('2 chats') && p.facts[1].includes('3 chats') && p.facts[2].includes('0 chats'), JSON.stringify(p.facts))
  check('...lists the titles of the two that would be added, warns that one of them has instructions of its own, and says to add only a backup you made or trust (the model reads it as history)', same([...p.titles].sort(), gone.map((c) => c.title).sort()) && p.notices.some((t) => /1 of these chats has instructions of its own/.test(t)) && /Add only a backup you made yourself or trust/.test(p.text) && /really happened/.test(p.text), JSON.stringify({ titles: p.titles, notices: p.notices }))
  check('...the button says "Add 2 chats", and the focus is on "Don\'t add"', p.buttons.some((b) => b.text === 'Add 2 chats' && !b.disabled) && p.focused === "Don't add", JSON.stringify(p.buttons))
  const snapBeforeAdd = await snapshot(convDir)
  check('looking wrote nothing', snapBeforeAdd === (await snapshot(convDir)) && convFilesNow().length === 3)
  await page.screenshot(join(shots, 'v8b-preview.png'))
  await clickPanel('Add 2 chats')
  await waitNotice()
  await waitRows(5)
  const n2 = await notice()
  check('after adding: "Added 2 chats." and "3 chats already here, left as they are."', n2.role === 'status' && /^Added 2 chats\./.test(n2.text) && /3 chats already here, left as they are\./.test(n2.text), n2.text)
  check('the two chats are back as files, byte for byte what they were before they were deleted (dates, instructions and all)', gone.every((c) => onDisk(c.id) === fileText(c)), 'differs')
  check('the list shows all five again, newest first by their own dates, and no stray file is in the folder', same(await rowTitles(), [...chats].sort((a, b) => b.updatedAt - a.updatedAt).map((c) => c.title)) && H.strays().length === 0, JSON.stringify(await rowTitles()))
  check('the preview is gone and nothing was told to let go of (the look was used)', (await panel()) === null && (await cancelCount()) === 0)
  const instr = await ev(`window.api.history.load(${JSON.stringify(chats[0].id)}).then((r) => r.conversation.instructions)`)
  check('the restored chat that had instructions has them (the Instructions of that chat show them)', instr === chats[0].instructions, instr)

  // ============ 9. nothing is replaced ============
  const mine = { ...chats[2], messages: [...chats[2].messages, { role: 'user', content: 'a later message of MINE', status: 'done' }] }
  const mineText = await ev(`window.api.history.save({ id: ${JSON.stringify(mine.id)}, messages: ${JSON.stringify(mine.messages)}, instructions: ${JSON.stringify(mine.instructions)} }).then((r) => r.ok)`)
  const mineBytes = onDisk(chats[2].id)
  check('a chat is continued after the backup was made (a longer chat under the same id)', mineText === true && mineBytes !== fileText(chats[2]))
  await resetCalls()
  await queue('open', ALL)
  await clickFooter('Restore from a backup...')
  await waitPanel()
  p = await panel()
  check('the preview says "1 chat" shares an id with a different chat and would be added as a copy, "4 already here"', p.facts[1].includes('4 chats') && p.facts[2].includes('1 chat') && p.facts[0].includes('0 chats'), JSON.stringify(p.facts))
  await clickPanel('Add 1 chat')
  await waitNotice()
  await waitRows(6)
  const n3 = await notice()
  check('after adding: "Added 1 chat (1 as a copy)."', /^Added 1 chat \(1 as a copy\)\./.test(n3.text), n3.text)
  check('the chat that was continued is byte for byte as it was before: nothing was replaced', onDisk(chats[2].id) === mineBytes)
  const files = convFilesNow()
  const copyId = files.find((id) => !chats.some((c) => c.id === id))
  check('the backup\'s older version was added as a separate chat under a new id, with the backup\'s own messages', files.length === 6 && !!copyId && same(JSON.parse(onDisk(copyId)).messages, chats[2].messages), String(copyId))

  // ============ 10. Escape, and "Don't add" ============
  await resetCalls()
  await queue('open', ALL)
  await clickFooter('Restore from a backup...')
  await waitPanel()
  await clickPanel("Don't add")
  await page.waitFor(`!document.querySelector('dialog.history .backup-preview')`)
  check('"Don\'t add" drops the preview, adds nothing, and tells main to let the file go', (await cancelCount()) === 1 && convFilesNow().length === 6)
  await resetCalls()
  await queue('open', ALL)
  await clickFooter('Restore from a backup...')
  await waitPanel()
  await page.press('Escape')
  await page.waitFor(`!document.querySelector('dialog.history')?.open`, { timeoutMs: 4000 })
  for (let t0 = Date.now(); (await cancelCount()) < 1 && Date.now() - t0 < 3000;) await sleep(50) // the page's message to main is asynchronous
  await sleep(200)
  check('Escape with a preview open closes the dialog, adds nothing, and tells main to let the file go (once)', (await cancelCount()) === 1 && convFilesNow().length === 6, String(await cancelCount()))
  await H.openHistory()
  await waitRows(6)
  check('the dialog opens again with the list, no preview and no old notice', (await panel()) === null && (await notice()) === null)

  // ============ 11. a backup that is cut off, and one with a changed chat ============
  for (const id of convFilesNow()) await ev(`window.api.history.remove(${JSON.stringify(id)})`)
  await H.closeHistory()
  await H.openHistory()
  check('all saved chats removed (through the bridge) to restore into an empty list', convFilesNow().length === 0)
  const cutRead = await readAll(CUT)
  await queue('open', CUT)
  await clickFooter('Restore from a backup...')
  await waitPanel()
  p = await panel()
  check('a backup cut off at 60%: the preview warns that it is not whole, counts the chats before the cut, and says one cannot be used', p.notices.some((t) => /not whole/.test(t)) && p.facts[0].includes(`${cutRead.got.length} chat`) && p.facts.some((f) => /1 chat.*cannot be used/.test(f)) && p.why.length === 1 && /cut off/.test(p.why[0]), JSON.stringify(p))
  await clickPanel(`Add ${cutRead.got.length} ${cutRead.got.length === 1 ? 'chat' : 'chats'}`)
  await waitNotice()
  await waitRows(cutRead.got.length)
  check('only the whole chats before the cut were added, each byte for byte as it was; the cut one is not there, not even in part', same(convFilesNow().sort(), cutRead.got.map((c) => c.id).sort()) && cutRead.got.every((c) => onDisk(c.id) === fileText(chats.find((x) => x.id === c.id))) && H.strays().length === 0)
  check('the notice says what was not added: "1 could not be used"', /Not added: 1 could not be used/.test((await notice()).text), (await notice()).text)

  await queue('open', TAMPERED)
  await clickFooter('Restore from a backup...')
  await waitPanel()
  p = await panel()
  check('a backup with one changed chat: the preview says one cannot be used and names its line and the reason (the checksum)', p.facts.some((f) => /1 chat.*cannot be used/.test(f)) && p.why.some((t) => /^Line 4: .*checksum/.test(t)) && !p.notices.some((t) => /not whole/.test(t)), JSON.stringify({ facts: p.facts, why: p.why }))
  await clickPanel("Don't add")
  await page.waitFor(`!document.querySelector('dialog.history .backup-preview')`)

  await queue('open', ALL)
  await clickFooter('Restore from a backup...')
  await waitPanel()
  p = await panel()
  const here = cutRead.got.length
  check('the whole backup next to what the cut one added: the rest are new, the ones already added are skipped', p.facts[0].includes(`${5 - here} chat`) && p.facts[1].includes(`${here} chat`), JSON.stringify(p.facts))
  await clickPanel(`Add ${5 - here} ${5 - here === 1 ? 'chat' : 'chats'}`)
  await waitNotice()
  await waitRows(5)
  check('after that the five chats are all back, byte for byte as they were at the start', chats.every((c) => onDisk(c.id) === fileText(c)) && convFilesNow().length === 5)

  // ============ 12. files that are not backups ============
  await queue('open', LETTER)
  await clickFooter('Restore from a backup...')
  await page.waitFor(`/not a Frontier chat backup/.test(document.querySelector('dialog.history .backup-notice')?.textContent ?? '')`, { timeoutMs: 20000, label: 'the refusal' })
  const n4 = await notice()
  check('a letter is refused with a sentence (an alert); the sentence does not repeat what the letter says, and no preview opens', n4.role === 'alert' && n4.error && !/SECRET|Sam/.test(n4.text) && (await panel()) === null, n4.text)
  // a notice is on screen (the refusal): closing the dialog drops it, so it is not still there when the dialog is opened again
  await H.closeHistory()
  await H.openHistory()
  await waitRows(5)
  check('a notice that is on screen when the dialog is closed is gone when it is opened again', (await notice()) === null && (await panel()) === null)
  await queue('open', LETTER)
  await clickFooter('Restore from a backup...')
  await page.waitFor(`/not a Frontier chat backup/.test(document.querySelector('dialog.history .backup-notice')?.textContent ?? '')`, { timeoutMs: 20000, label: 'the refusal again' })
  await queue('open', join(FILES, 'does-not-exist.jsonl'))
  await clickFooter('Restore from a backup...')
  await page.waitFor(`/could not be opened/.test(document.querySelector('dialog.history .backup-notice')?.textContent ?? '')`, { timeoutMs: 20000, label: 'the refusal' })
  check('a file that is not there is refused with "could not be opened"', (await notice()).error)
  await queue('open', null)
  await clickFooter('Restore from a backup...')
  await sleep(300)
  check('closing the open dialog leaves no notice and no preview', (await notice()) === null && (await panel()) === null)

  // ============ 13. what the page can do through the bridge ============
  await resetCalls()
  const odd = await ev(`(async () => {
    const h = window.api.history
    const out = {}
    out.junk = await Promise.all([undefined, null, 'all', 5, [], {}, { scope: 'x' }, { scope: 'one' }, { scope: 'one', id: '../x' }].map((r) => h.exportChats(r).then((x) => x.ok, () => 'threw')))
    out.apply = await Promise.all([undefined, null, 'nope', 5, {}].map((t) => h.restoreApply(t).then((x) => x.ok, () => 'threw')))
    out.cancel = h.restoreCancel('anything')
    return out
  })()`)
  check('through the bridge: junk requests for a backup, and apply with no or wrong token, are all refused', odd.junk.every((x) => x === false) && odd.apply.every((x) => x === false) && odd.cancel === undefined, JSON.stringify(odd))
  check('...and not one of them opened a dialog', (await calls()).length === 0)
  // a page script can call the bridge itself, so it can try to use a token twice (the page's own buttons use it once)
  await queue('open', ALL)
  const twice = await ev(`(async () => {
    const h = window.api.history
    const look = await h.restoreLook()
    const first = await h.restoreApply(look.preview.token)
    const second = await h.restoreApply(look.preview.token)
    return { look: look.ok, first: first.ok, firstSame: first.same, second: second.ok, secondError: second.error }
  })()`)
  check('a token from a look works once through the bridge (all five are "already here"), and the second use is refused', twice.look && twice.first && twice.firstSame === 5 && twice.second === false && /Nothing is waiting/.test(twice.secondError ?? ''), JSON.stringify(twice))
  await resetCalls()
  const sneakyPath = join(OUT, 'chosen-by-the-page.jsonl')
  const personsPath = join(OUT, 'chosen-by-the-person.jsonl')
  await queue('save', personsPath)
  const sneaky = await ev(`window.api.history.exportChats({ scope: 'all', path: ${JSON.stringify(sneakyPath)}, dest: ${JSON.stringify(sneakyPath)} })`)
  check('a request that carries a path: the path is ignored, the file goes where the person\'s dialog said', sneaky.ok && sneaky.where === personsPath && existsSync(personsPath) && !existsSync(sneakyPath), JSON.stringify(sneaky))
  check('after everything: no ".part" in the backup folder, nothing new in the profile but the chats, no "problems" (console errors, CSP) in the page', readdirSync(OUT).every((n) => !n.endsWith('.part')) && appOwned() === topBefore && page.problems.length === 0, JSON.stringify({ top: appOwned(), topBefore, problems: page.problems }))

  // ============ 14. narrow windows ============
  const overflow = () => ev(`(() => { const d = document.querySelector('dialog.history'); const r = d.getBoundingClientRect(); const bad = [...d.querySelectorAll('button, p, h2, h3, li')].filter((e) => { const b = e.getBoundingClientRect(); return b.width > 0 && (b.right > r.right + 1 || b.left < r.left - 1) }).map((e) => e.tagName + '.' + e.className + ':' + e.textContent.slice(0, 30)).slice(0, 5); return { scroll: d.scrollWidth, client: d.clientWidth, bad, dialogRight: Math.round(r.right), viewport: innerWidth } })()`)
  const metrics = async (width, height = 634) => { await page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false }); await sleep(300) }
  for (const width of [460, 320, 280]) {
    await metrics(width)
    await queue('save', join(OUT, `narrow-${width}.jsonl`))
    await clickFooter('Back up all chats...')
    await waitNotice()
    let o = await overflow()
    const f = await ev(`[...document.querySelectorAll('dialog.history .history-footer button')].map((b) => { const r = b.getBoundingClientRect(); return { text: b.textContent.trim(), h: Math.round(r.height), left: Math.round(r.left), right: Math.round(r.right) } })`)
    check(`at ${width} px the History dialog with a notice and the three footer buttons does not overflow sideways, and every footer button is inside the window`, o.scroll <= o.client + 1 && o.bad.length === 0 && f.every((b) => b.left >= 0 && b.right <= width), JSON.stringify({ o, f }))
    await queue('open', ALL)
    await clickFooter('Restore from a backup...')
    await waitPanel()
    o = await overflow()
    const pb = await ev(`[...document.querySelectorAll('dialog.history .backup-preview button')].map((b) => { const r = b.getBoundingClientRect(); return { text: b.textContent.trim(), left: Math.round(r.left), right: Math.round(r.right) } })`)
    check(`at ${width} px the preview does not overflow sideways and its buttons are inside the window`, o.scroll <= o.client + 1 && o.bad.length === 0 && pb.every((b) => b.left >= 0 && b.right <= width), JSON.stringify({ o, pb }))
    const innerScroll = await ev(`(() => { const p = document.querySelector('dialog.history .backup-preview'); return p.scrollHeight - p.clientHeight })()`)
    check(`at ${width} px the preview has no scroll box of its own (the whole dialog scrolls, so the buttons can be reached and the text read)`, innerScroll <= 1, String(innerScroll))
    if (width === 280) await page.screenshot(join(shots, 'v8b-preview-280.png'))
    await clickPanel('Back to the list')
    await page.waitFor(`!document.querySelector('dialog.history .backup-preview')`)
    await waitRows(5)
    if (width === 280) await page.screenshot(join(shots, 'v8b-list-280.png'))
  }
  // a SHORT window as well: the dialog scrolls as a whole, and the preview does not shrink into a scroll box of its own
  await metrics(320, 300)
  await queue('open', ALL)
  await clickFooter('Restore from a backup...')
  await waitPanel()
  const short = await ev(`(() => { const p = document.querySelector('dialog.history .backup-preview'); const d = document.querySelector('dialog.history'); return { inner: p.scrollHeight - p.clientHeight, dialogScrolls: d.scrollHeight > d.clientHeight, panelHeight: Math.round(p.getBoundingClientRect().height), dialogClient: d.clientHeight } })()`)
  check('in a window only 300 px high the dialog scrolls and the preview keeps its own height (no scroll box inside it)', short.inner <= 1 && short.dialogScrolls, JSON.stringify(short))
  await clickPanel('Back to the list')
  await page.waitFor(`!document.querySelector('dialog.history .backup-preview')`)
  await page.send('Emulation.clearDeviceMetricsOverride')
  await sleep(200)
  check('no problems in the page at the end (console errors, CSP violations)', page.problems.length === 0, JSON.stringify(page.problems))
} catch (error) {
  check(`the suite stopped before its end: ${String(error?.stack ?? error).slice(0, 400)}`, false)
  try { await page.screenshot(join(shots, 'v8b-stopped.png')) } catch { /* the page is gone */ }
}
main.close()
const passed = check.summary()
process.exit(passed ? 0 : 1)
