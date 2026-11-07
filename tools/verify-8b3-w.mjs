// Stage 8b.3 (D-035) in the real window, launch 1 of 4: encrypting the saved chats with the REAL secure storage of this PC (Electron's safeStorage), turning it
// back off, and on again. The system's save dialog (the backup) and message box (going back to plain files) are replaced from the main process's inspector:
// each ask is recorded with what the profile looked like at that moment, and answered with what the suite chose. Needs USER_DATA_DIR (a scratch profile seeded
// by run8b3.mjs with five plain chats), FILES_DIR, INSPECT_PORT, and the fake provider (MOCK_PORT) with a key saved by setup-key.mjs.
// What is checked: the section in Settings in each state and what it says; the backup is asked for FIRST, with a title and name that say why, while nothing has
// changed; the buttons are off while the dialog is open; what is on disk afterwards (envelopes, no readable word, a setting with a check); that History lists and
// opens sealed chats and a new message is saved sealed; what the page can and cannot do through the bridge; going back (and "Keep encryption"); the section at
// narrow widths. It ends with encryption ON, for the restart and the lost key of launch 2 to 4.
import { start } from './lib8b3w.mjs'
import { backup, makeChat, fileText, same } from './lib8b.mjs'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const W = await start()
const { page, H, ev, check, main, FILES, convDir, settingFile, shots, sleep } = W
const chats = Array.from({ length: 5 }, (_, i) => makeChat(i))
const OUT = join(FILES, 'out')
const readable = chats.flatMap((c) => [c.title, c.instructions, ...c.messages.map((m) => m.content.slice(0, 20))]).filter((s) => s && s.length > 5)
const cid = (i) => `${chats[i].id}.json`
const readAll = async (path) => { const got = []; const read = await backup.readBackup(path, (chat) => { got.push(chat) }); return { read, got } }

try {
  await page.waitFor(`!!document.querySelector('.chat-bar')`, { timeoutMs: 20000, label: 'the app' })
  await sleep(400)
  const dialogs = await W.installDialogs()
  const seeded = W.folder()
  check('the profile starts with five plain chat files and no setting file', W.chatFiles().length === 5 && seeded.setting === null && chats.every((c) => W.text(cid(chats.indexOf(c))) === fileText(c)))

  // ============ 1. plain, before anything ============
  await W.openSettings()
  let s = await W.section()
  check('Settings has a "Saved chats" section that says chats are saved as plain files; its only button is "Encrypt my saved chats..." and it is on', !!s && s.line === 'Chats are saved as plain files.' && same(s.buttons, [{ text: 'Encrypt my saved chats...', disabled: false }]), JSON.stringify(s))
  check('...it says what turning it on does (a backup first, checked, and only then encrypts) and what a lost key means (encrypted chats cannot be opened; the backup is the way back); the reminder to back up is only for when encryption is on', /asks where to save a backup/.test(s.text) && /only then encrypts/.test(s.text) && /cannot be opened, and that backup is how you get them back/.test(s.text) && !/Back up now and then/.test(s.text), s.text)
  check('...and what encryption does NOT do: it does not stop a program running as you, and it does not cover a backup (always a plain file)', /does not stop a program running as you/.test(s.text) && /does not cover a backup/.test(s.text) && /another computer or account cannot be read/.test(s.text))
  const st0 = await W.storage()
  check('storage() says: off, this computer can encrypt, 5 plain, nothing unreadable, nothing blocked', same(st0, { choice: 'off', canEncrypt: true, keyUsable: null, plain: 5, encrypted: 0, unreadable: 0, unopened: 0, blocked: null }), JSON.stringify(st0))
  await page.screenshot(join(shots, 'v8b3-settings-plain.png'))

  // ============ 2. turning it on ============
  const dest1 = join(OUT, 'before-1.jsonl')
  await dialogs.reset()
  await dialogs.queue('save', dest1)
  await dialogs.hold()
  await W.clickSection('Encrypt my saved chats...')
  await page.waitFor(`(() => { const s = document.getElementById('settings-storage-heading').closest('section'); return [...s.querySelectorAll('button')].every((b) => b.disabled) })()`, { timeoutMs: 8000, label: 'the buttons to go off while the dialog is open' })
  check('while the backup dialog is open every button of the section is off (nothing can be started twice)', (await W.section()).buttons.every((b) => b.disabled))
  // Main opens the save dialog after it has counted what is kept (since 10.2-10.5 also the instructions, notes and projects): wait for the call, not
  // for the buttons alone.
  let during = await dialogs.calls()
  for (let i = 0; i < 50 && during.length === 0; i++) { await sleep(100); during = await dialogs.calls() }
  await dialogs.release()
  await W.waitNote(/Encrypted 5 chats/)
  s = await W.section()
  const note1 = s.notes[0] ?? ''
  check('the save dialog was asked once, for the window, with the title and the file name that say why ("before they are encrypted")', during.length === 1 && during[0].kind === 'save' && during[0].withWindow && during[0].options.title === 'Back up your chats before they are encrypted' && /frontier-chats-before-encrypting-\d{4}-\d{2}-\d{2}\.jsonl$/.test(during[0].options.defaultPath) && same(during[0].options.filters, [{ name: 'Frontier chat backup', extensions: ['jsonl'] }]), JSON.stringify(during[0]?.options))
  check('WHEN IT WAS ASKED NOTHING HAD CHANGED: five plain chat files, no setting file, no leftover copy (the backup comes first)', during[0].at.plain === 5 && during[0].at.chatFiles === 5 && during[0].at.settingThere === false && during[0].at.tmp === 0, JSON.stringify(during[0].at))
  check('the notice (a status) says: backed up 5 chats to the place chosen, checked it, it is a plain file, "Encrypted 5 chats.", and chats saved from now on are encrypted too', note1.startsWith('Backed up 5 chats to ') && note1.includes(dest1) && /and checked it\. It is a plain file: keep it somewhere safe\./.test(note1) && /Encrypted 5 chats\./.test(note1) && /Chats you save from now on are encrypted too\./.test(note1), note1)
  const made = await readAll(dest1)
  check('the backup is a whole backup of exactly the five chats as they were (plain), read back and checked', made.read.complete && made.got.length === 5 && made.got.every((g) => same(g, chats.find((c) => c.id === g.id))) && made.read.trailer.leftOut === 0)
  const names = W.chatFiles()
  check('on disk: still five files named "<id>.json", every one an envelope, nothing else in the folder', names.length === 5 && names.every((n) => W.isEnvelope(n)) && W.strays().length === 0, JSON.stringify(readdirSync(convDir)))
  const allText = names.map((n) => W.text(n)).join('\n')
  check('NOT A WORD of any chat can be read in any file: no title, no start of a message, no instructions', readable.every((m) => !allText.includes(m)), JSON.stringify(readable.filter((m) => allText.includes(m)).slice(0, 3)))
  const setting = JSON.parse(readFileSync(settingFile, 'utf8'))
  check('chat-encryption.json is {"version":1,"encrypt":true,"check":...} and nothing else', same(Object.keys(setting), ['version', 'encrypt', 'check']) && setting.version === 1 && setting.encrypt === true && /^[A-Za-z0-9+/]+={0,2}$/.test(setting.check))
  const st1 = await W.storage()
  check('storage(): on, key usable, 5 encrypted, 0 plain, nothing blocked (this PC\'s real secure storage opened what it sealed)', same(st1, { choice: 'on', canEncrypt: true, keyUsable: true, plain: 0, encrypted: 5, unreadable: 0, unopened: 0, blocked: null }), JSON.stringify(st1))
  check('the section now says encryption is on, 5 encrypted; its only button is "Go back to plain files..."; no alert', s.line === 'Encryption is on: 5 chats are encrypted, and every chat you save from now on is too.' && same(s.buttons, [{ text: 'Go back to plain files...', disabled: false }]) && s.alerts.length === 0, JSON.stringify({ line: s.line, buttons: s.buttons }))
  check('...and it reminds the person that a backup holds the chats only as they were when it was made, so a chat saved after the last backup cannot be brought back if the key is lost', /A backup holds the chats as they were when you made it\. Back up now and then \(History, Back up all chats\.\.\.\): a chat saved after your last backup cannot be brought back if the key is lost\./.test(s.text), s.text.slice(-420))
  await page.screenshot(join(shots, 'v8b3-settings-encrypted.png'))
  await W.closeSettings()

  // ============ 3. History and chatting with sealed files ============
  await H.openHistory()
  const rows = await W.historyRows()
  check('History lists the five chats with their real titles (the list is built by opening each sealed file)', same([...rows].sort(), chats.map((c) => c.title).sort()), JSON.stringify(rows))
  const hist = await H.historyText()
  check('History now says the chats are saved as encrypted files, protected like the API key, and no longer says "as plain files"', /as encrypted files, protected by this computer's secure storage like your API key/.test(hist) && !/as plain files/.test(hist), hist.slice(-420))
  await H.clickRow(chats[0].title)
  await page.waitFor(`!document.querySelector('dialog.history')?.open`, { timeoutMs: 8000, label: 'the History dialog to close after opening a chat' })
  await page.waitFor(`document.querySelectorAll('.message').length === ${chats[0].messages.length}`, { timeoutMs: 8000, label: 'the opened chat to be on screen' })
  const shown = await H.screen()
  check('opening a sealed chat puts it on screen as it was: the right number of messages and its first message word for word', shown.length === chats[0].messages.length && shown[0].text === chats[0].messages[0].content, JSON.stringify(shown.map((m) => m.text.slice(0, 30))))
  const before = W.folder()
  await H.sendAndWait('a new message with SECRET-WORDS-ONE')
  await sleep(1300) // the save of a finished reply
  const after = W.folder()
  const ids1to4 = [1, 2, 3, 4].map((i) => cid(i))
  check('a message sent in a sealed chat is saved sealed: the file is still an envelope, the words cannot be read in it, and the other four files were not touched', W.isEnvelope(cid(0)) && !W.text(cid(0)).includes('SECRET-WORDS-ONE') && after.files[cid(0)] !== before.files[cid(0)] && ids1to4.every((n) => after.files[n] === before.files[n]) && W.chatFiles().length === 5 && W.strays().length === 0)
  const loaded = await ev(`window.api.history.load(${JSON.stringify(chats[0].id)}).then((r) => r.ok ? r.conversation.messages.map((m) => m.content) : r)`)
  check('...and loading it through the bridge gives the new words back (the secure storage opens it)', Array.isArray(loaded) && loaded.some((t) => t.includes('SECRET-WORDS-ONE')))

  // ============ 4. what the page can do through the bridge ============
  const keys = await ev(`Object.keys(window.api.history).sort()`)
  check('the bridge has the three new functions beside the old ones, and nothing that takes a path or a key', same(keys, ['decryptChats', 'encryptChats', 'exportChats', 'list', 'load', 'remove', 'restoreApply', 'restoreCancel', 'restoreLook', 'save', 'search', 'storage']) /* (21.5, D-053) search: titles and pieces, a query only */, JSON.stringify(keys))
  const fields = await ev(`(async () => Object.keys(await window.api.history.storage()))()`)
  check('storage() tells the page exactly eight facts: no key, no check, no path', same(fields, ['choice', 'canEncrypt', 'keyUsable', 'plain', 'encrypted', 'unreadable', 'unopened', 'blocked']), JSON.stringify(fields))
  await dialogs.reset()
  const again = await ev(`window.api.history.encryptChats({ path: 'C:/x', scope: 'all' }, 5)`)
  check('encryptChats when everything is encrypted already: ok, nothing changed, and no dialog (a page that asks again gets nothing)', again.ok && again.report.changed === 0 && again.report.already === 5 && again.report.backup === null && (await dialogs.calls()).length === 0, JSON.stringify(again))
  const f0 = W.folder()
  await dialogs.reset()
  const declined = await ev(`window.api.history.decryptChats()`)
  const c2 = await dialogs.calls()
  check('decryptChats from the page opens the SYSTEM message box (modal to the window, a warning), which only the person answers: "Keep encryption" is the default and the Escape answer, and the detail says who can read plain files', c2.length === 1 && c2[0].kind === 'box' && c2[0].withWindow && c2[0].options.type === 'warning' && same(c2[0].options.buttons, ['Go back to plain files', 'Keep encryption']) && c2[0].options.defaultId === 1 && c2[0].options.cancelId === 1 && /5 chats will be rewritten as plain files/.test(c2[0].options.message) && /Anyone who can read the app's data folder/.test(c2[0].options.detail) && /API keys stay encrypted/.test(c2[0].options.detail), JSON.stringify(c2[0]?.options))
  check('...and with nobody saying yes nothing changed: cancelled, and every file and the setting are exactly as they were', declined.ok === false && declined.cancelled === true && same(W.folder(), f0), JSON.stringify(declined))
  await ev(`window.api.history.decryptChats('yes', { answer: true, confirm: true }, true)`)
  check('...extra arguments, a "yes" from the page, are ignored: it asked again and nothing changed', (await dialogs.calls()).length === 2 && same(W.folder(), f0))

  // ============ 5. going back ============
  await W.openSettings()
  await dialogs.reset()
  await dialogs.queue('box', 1)
  await W.clickSection('Go back to plain files...')
  await sleep(500)
  s = await W.section()
  check('"Keep encryption" in the message box: nothing changes and no notice appears (cancelling is not an error)', (await dialogs.calls()).length === 1 && same(W.folder(), f0) && s.notes.length === 0 && s.alerts.length === 0 && s.buttons.every((b) => !b.disabled), JSON.stringify(s))
  await dialogs.queue('box', 0)
  await W.clickSection('Go back to plain files...')
  await W.waitNote(/Rewrote 5 chats as plain files/)
  s = await W.section()
  check('"Go back to plain files": the five chats are plain files again, the four that were not touched since are byte for byte what they were at the start, and nothing else is in the folder', W.chatFiles().length === 5 && W.chatFiles().every((n) => !W.isEnvelope(n)) && [1, 2, 3, 4].every((i) => W.text(cid(i)) === fileText(chats[i])) && W.strays().length === 0)
  check('...the setting file now says {"version":1,"encrypt":false}; the section says plain files and offers "Encrypt my saved chats..." again; the notice says what was done', readFileSync(settingFile, 'utf8') === '{"version":1,"encrypt":false}' && s.line === 'Chats are saved as plain files.' && same(s.buttons, [{ text: 'Encrypt my saved chats...', disabled: false }]) && /^Rewrote 5 chats as plain files\. Chats you save from now on are plain files too\.$/.test(s.notes[0]), JSON.stringify({ line: s.line, notes: s.notes }))
  check('...and the chat that got a new message while it was sealed is plain too, with that message', JSON.parse(W.text(cid(0))).messages.some((m) => m.content.includes('SECRET-WORDS-ONE')))
  await W.closeSettings()
  await H.openHistory()
  check('History says "plain files" again', /as plain files\. Unlike your API key, the app does not encrypt them unless you turn that on/.test(await H.historyText()))
  await H.closeHistory()

  // ============ 6. on again, with a second backup ============
  const dest2 = join(OUT, 'before-2.jsonl')
  await W.openSettings()
  await dialogs.reset()
  await dialogs.queue('save', dest2)
  await W.clickSection('Encrypt my saved chats...')
  await W.waitNote(/Encrypted 5 chats/)
  const made2 = await readAll(dest2)
  check('turned on a second time: a fresh backup was asked for first (5 chats, whole), and the chats are sealed again', made2.read.complete && made2.got.length === 5 && W.chatFiles().every((n) => W.isEnvelope(n)) && (await dialogs.calls()).length === 1 && (await dialogs.calls())[0].at.plain === 5)

  // ============ 7. narrow windows ============
  // The check is about THIS section. (The dialog as a whole scrolls sideways below about 320 px because of the spending-limits form of 8.2, which is not part of this
  // slice: it is reported on a "note:" line, not counted, so it stays visible.)
  const overflow = () => ev(`(() => { const d = document.querySelector('dialog.settings'); const r = d.getBoundingClientRect(); const sec = document.getElementById('settings-storage-heading').closest('section'); const out = (e) => { const b = e.getBoundingClientRect(); return b.width > 0 && (b.right > r.right + 1 || b.left < r.left - 1) }; const bad = [...sec.querySelectorAll('button, p, h3')].filter(out).map((e) => e.tagName + ':' + e.textContent.slice(0, 30)).slice(0, 5); const clipped = [...sec.querySelectorAll('button')].filter((b) => b.scrollWidth > b.clientWidth + 1 || b.scrollHeight > b.clientHeight + 1).map((b) => b.textContent.slice(0, 30)); const outside = [...d.querySelectorAll('*')].filter((e) => !sec.contains(e) && out(e)).map((e) => e.tagName + '.' + e.className).slice(0, 4); return { scroll: sec.scrollWidth, client: sec.clientWidth, bad, clipped, dialogScroll: d.scrollWidth, dialogClient: d.clientWidth, hbar: d.offsetHeight - d.clientHeight, outside } })()`)
  const metrics = async (width, height = 634) => { await page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false }); await sleep(300) }
  for (const width of [460, 320, 280]) {
    await metrics(width)
    const o = await overflow()
    check(`at ${width} px the Saved chats section (encrypted, with its notice) does not overflow sideways, and no button's text spills out of the button`, o.scroll <= o.client + 1 && o.bad.length === 0 && o.clipped.length === 0, JSON.stringify(o))
    check(`at ${width} px the Settings dialog has no horizontal scrollbar (its height minus its client height is only the border)`, o.hbar <= 2 && o.dialogScroll <= o.dialogClient + 1, JSON.stringify({ hbar: o.hbar, scroll: o.dialogScroll, client: o.dialogClient, outside: o.outside }))
    if (width === 280) {
      await ev(`document.getElementById('settings-storage-heading').scrollIntoView({ block: 'start' })`)
      await sleep(150)
      await page.screenshot(join(shots, 'v8b3-settings-280.png'))
    }
  }
  await page.send('Emulation.clearDeviceMetricsOverride')
  await sleep(200)
  await W.closeSettings()

  // what the restarts check
  W.saveState('state1.json', { folder: W.folder(), backups: [dest1, dest2], titles: chats.map((c) => c.title) })
  check('no problems in the page at the end (console errors, CSP violations)', page.problems.length === 0, JSON.stringify(page.problems))
} catch (error) {
  check(`the suite stopped before its end: ${String(error?.stack ?? error).slice(0, 400)}`, false)
  try { await page.screenshot(join(shots, 'v8b3-stopped.png')) } catch { /* the page is gone */ }
}
main.close()
const passed = check.summary()
process.exit(passed ? 0 : 1)
