// Stage 8b.4 (D-035), launch 3 of 4: A LOST KEY, made for real. Before this launch run8b3.mjs deleted the profile's "Local State" (the file where Chromium keeps the key that
// Electron's secure storage uses), so the app starts with a key that cannot open the six sealed chats. The app must say so, save NOTHING, write NOTHING (no new key is used), and
// leave every file as it is. The ways out are checked end to end: restoring from the backup made when encryption was turned on, and turning encryption off. The dialogs are
// replaced from the main process's inspector.
import { start } from './lib8b3w.mjs'
import { backup, makeChat, same } from './lib8b.mjs'
import { join } from 'node:path'
import { readFileSync } from 'node:fs'

const W = await start()
const { page, H, ev, check, main, settingFile, shots, sleep } = W
const chats = Array.from({ length: 5 }, (_, i) => makeChat(i))
const panel = () => ev(`(() => { const p = document.querySelector('dialog.history .backup-preview'); if (!p) return null; return { text: p.innerText, buttons: [...p.querySelectorAll('button')].map((b) => ({ text: b.textContent.trim(), disabled: b.disabled })), facts: [...p.querySelectorAll('.backup-preview-facts li')].map((li) => li.innerText) } })()`)
const histNotice = () => ev(`(() => { const n = document.querySelector('dialog.history .backup-notice'); return n ? { text: n.textContent, role: n.getAttribute('role') } : null })()`)

try {
  const prev = W.loadState('state2.json')
  await page.waitFor(`!!document.querySelector('.chat-bar')`, { timeoutMs: 20000, label: 'the app' })
  await sleep(400)
  const dialogs = await W.installDialogs()
  console.log(`note: LOCAL_STATE_BACK=${process.env.LOCAL_STATE_BACK} (the original Local State was kept for launch 4)`)
  check('the app started with a key that cannot open the sealed chats, and wrote NOTHING at start: every chat file and the setting are byte for byte what launch 2 left', same(W.folder(), prev.folder), JSON.stringify(W.folder()).slice(0, 200))
  const st = await W.storage()
  console.log(`note: storage() = ${JSON.stringify(st)}`)
  check('storage(): the choice is still "on" but the key is NOT usable; none of the 6 sealed chats can be read: 6 unreadable, all 6 of them encrypted files that could not be opened; saving is blocked with a sentence', st.choice === 'on' && st.keyUsable === false && st.encrypted === 0 && st.plain === 0 && st.unreadable === 6 && st.unopened === 6 && typeof st.blocked === 'string' && /^Chats are not being saved: /.test(st.blocked) && /Nothing was changed\./.test(st.blocked), JSON.stringify(st))
  console.log(`note: this PC's secure storage after the reset says canEncrypt=${st.canEncrypt}; the blocked sentence is the ${/new key is never made/.test(st.blocked ?? '') ? 'KEY one (the storage works, with a different key)' : 'one for "no secure storage"'}`)
  const sentence = st.blocked

  // History
  await H.openHistory()
  const hist = await H.historyText()
  check('History: lists nothing, says why nothing is saved (the sentence), that 6 saved files could not be read (the app\'s existing wording: "and was left as it is") and 6 of them are encrypted and could not be opened with this computer\'s key, and that Restore from a backup brings them back as copies', (await W.historyRows()).length === 0 && hist.includes(sentence) && /6 saved files could not be read and was left as it is/.test(hist) && /6 of them are encrypted and could not be opened with this computer's key; Restore from a backup brings such chats back as copies/.test(hist), hist.slice(0, 700).split('\n').join(' | '))
  await H.closeHistory()
  await W.openSettings()
  let s = await W.section()
  check('Settings: an alert with the sentence; the line says encryption is on but its key cannot be used; "No file was changed"; "6 saved files ... could not be opened"; the only button is "Turn encryption off..." (no way to encrypt anything while the key is lost)', s.alerts.includes(sentence) && s.line === 'Encryption is on, but its key cannot be used now.' && /No file was changed\./.test(s.text) && /6 saved files are encrypted and could not be opened with this computer's key/.test(s.text) && same(s.buttons, [{ text: 'Turn encryption off...', disabled: false }]), JSON.stringify(s))
  await page.screenshot(join(shots, 'v8b3-settings-lost-key.png'))
  const narrow = async (width) => { await page.send('Emulation.setDeviceMetricsOverride', { width, height: 634, deviceScaleFactor: 1, mobile: false }); await sleep(300); return ev(`(() => { const sec = document.getElementById('settings-storage-heading').closest('section'); const d = document.querySelector('dialog.settings'); const r = d.getBoundingClientRect(); const out = (e) => { const b = e.getBoundingClientRect(); return b.width > 0 && (b.right > r.right + 1 || b.left < r.left - 1) }; return { bad: [...sec.querySelectorAll('button, p, h3')].filter(out).map((e) => e.textContent.slice(0, 30)), clipped: [...sec.querySelectorAll('button')].filter((b) => b.scrollWidth > b.clientWidth + 1 || b.scrollHeight > b.clientHeight + 1).map((b) => b.textContent.slice(0, 30)), width: sec.scrollWidth <= sec.clientWidth + 1 } })()`) }
  for (const width of [320, 280]) {
    const o = await narrow(width)
    check(`at ${width} px the section in its lost-key state (an alert, three notes and one button) fits: nothing past the dialog's edge and no button text spilling out`, o.bad.length === 0 && o.clipped.length === 0 && o.width, JSON.stringify(o))
  }
  await page.send('Emulation.clearDeviceMetricsOverride')
  await sleep(200)
  await W.closeSettings()

  // a chat with a reply that cannot be saved
  await H.clickChat('New chat')
  await H.sendAndWait('the third launch says SECRET-WORDS-THREE')
  await sleep(1500)
  const screen = await H.screen()
  const badge = await W.badge('Not saved')
  check('the reply is on screen (the conversation is not lost), the header shows "Not saved" and its title carries the sentence', screen.length === 2 && screen[0].text === 'the third launch says SECRET-WORDS-THREE' && !!badge && badge.title.includes(sentence), JSON.stringify({ screen: screen.map((m) => m.text.slice(0, 40)), badge }))
  check('...and NOT ONE file was written, no leftover copy, the setting untouched', same(W.folder(), prev.folder) && W.strays().length === 0)
  const direct = await ev(`window.api.history.save({ id: crypto.randomUUID(), messages: [{ role: 'user', content: 'x', status: 'done' }] })`)
  check('history.save through the bridge is refused with the same sentence', direct.ok === false && direct.error === sentence, JSON.stringify(direct))
  await dialogs.reset()
  const enc = await ev(`window.api.history.encryptChats()`)
  check('encryptChats is refused ("Nothing was encrypted..." and the sentence), and no dialog was opened for it', enc.ok === false && /^Nothing was encrypted\. /.test(enc.error) && enc.error.includes(sentence.slice(0, 60)) && (await dialogs.calls()).length === 0, JSON.stringify(enc))

  // restoring from the backup, while the key is lost: the look is fine, adding is refused
  await H.openHistory()
  await dialogs.queue('open', prev.backups[1])
  await page.click('dialog.history .history-footer .history-button@Restore from a backup...')
  await page.waitFor(`!!document.querySelector('dialog.history .backup-preview')`, { timeoutMs: 20000, label: 'the preview' })
  let p = await panel()
  check('looking at the backup made when encryption was turned on (5 chats): the preview says 0 new and that 5 would be added as copies (their own files cannot be opened), and adds nothing', p.facts[0].includes('0 chats') && p.facts[2].includes('5 chats') && same(W.folder(), prev.folder), JSON.stringify(p.facts))
  await page.click('dialog.history .backup-preview button@Add 5 chats')
  await page.waitFor(`!!document.querySelector('dialog.history .backup-notice')`, { timeoutMs: 20000, label: 'a notice' })
  const refused = await histNotice()
  check('adding is REFUSED with the sentence (an alert: "Nothing was added. Chats are not being saved..."), and not one file changed', refused.role === 'alert' && /^Nothing was added\. Chats are not being saved/.test(refused.text) && same(W.folder(), prev.folder), refused.text)
  await H.closeHistory()

  // turning encryption off: the person is asked, with the facts of a lost key; then ONLY the setting changes
  await W.openSettings()
  await dialogs.reset()
  await dialogs.queue('box', 0)
  await W.clickSection('Turn encryption off...')
  await W.waitNote(/left exactly as they are/)
  const c1 = (await dialogs.calls())[0]
  check('the system message box was asked with the facts of a lost key: "Turn encryption off?", "The key that protects your encrypted chats cannot be read.", the button "Turn encryption off", and the safe answer is the default', c1.kind === 'box' && c1.withWindow && c1.options.title === 'Turn encryption off?' && /cannot be read/.test(c1.options.message) && /stay exactly as they are/.test(c1.options.detail) && /6 encrypted files cannot be opened/.test(c1.options.detail) && /Restore from a backup/.test(c1.options.detail) && c1.options.buttons[0] === 'Turn encryption off' && c1.options.defaultId === 1 && c1.options.cancelId === 1, JSON.stringify(c1.options))
  s = await W.section()
  check('after a yes ONLY the choice changed: the setting says plain, every chat file is byte for byte as before; the section says plain files, 6 files cannot be opened, no alert', readFileSync(settingFile, 'utf8') === '{"version":1,"encrypt":false}' && same(W.folder().files, prev.folder.files) && s.line === 'Chats are saved as plain files.' && s.alerts.length === 0 && /6 saved files are encrypted and could not be opened/.test(s.text), JSON.stringify({ line: s.line, notes: s.notes }))
  await W.closeSettings()

  // the conversation on screen can now be saved: the badge is the way ("Click to try again")
  await page.click('.app-badge-button')
  await page.waitFor(`![...document.querySelectorAll('.app-badge')].some((b) => b.textContent === 'Not saved')`, { timeoutMs: 8000, label: 'the Not saved badge to go' })
  await sleep(500)
  const newFiles = Object.keys(W.folder().files).filter((n) => !(n in prev.folder.files))
  check('"Not saved" then retry: the chat on screen is saved, as a PLAIN file (encryption is off), with its words', newFiles.length === 1 && !W.isEnvelope(newFiles[0]) && W.text(newFiles[0]).includes('SECRET-WORDS-THREE'), JSON.stringify(newFiles))

  // the way out: restore the backup
  await H.openHistory()
  await dialogs.queue('open', prev.backups[1])
  await page.click('dialog.history .history-footer .history-button@Restore from a backup...')
  await page.waitFor(`!!document.querySelector('dialog.history .backup-preview')`, { timeoutMs: 20000, label: 'the preview' })
  await page.click('dialog.history .backup-preview button@Add 5 chats')
  await page.waitFor(`/^Added 5 chats/.test(document.querySelector('dialog.history .backup-notice')?.textContent ?? '')`, { timeoutMs: 30000, label: 'the notice for the restore' })
  const rows = await W.historyRows()
  check('RESTORING THE BACKUP brings the five chats back as copies: "Added 5 chats (5 as copies).", the list shows them with their own titles (and the chat saved a moment ago)', (await histNotice()).text.startsWith('Added 5 chats (5 as copies).') && rows.length === 6 && chats.every((c) => rows.includes(c.title)), JSON.stringify(rows))
  const ids = await ev(`window.api.history.list().then((l) => l.conversations.map((c) => ({ id: c.id, title: c.title })))`)
  const loaded = await Promise.all(ids.filter((x) => chats.some((c) => c.title === x.title)).map((x) => ev(`window.api.history.load(${JSON.stringify(x.id)}).then((r) => r.ok ? r.conversation : r)`)))
  // what the backup holds is the truth: it was made in launch 1 after chat 0 got a new message, so chat 0 there is longer than the seeded one
  const inBackup = []
  await backup.readBackup(prev.backups[1], (chat) => { inBackup.push(chat) })
  const why = inBackup.map((b) => { const l = loaded.find((x) => x?.title === b.title); return l ? `${same(l.messages, b.messages)}/${l.instructions === b.instructions}/${l.createdAt === b.createdAt}/${l.updatedAt === b.updatedAt}/${l.id !== b.id}` : 'missing' })
  check('...and each restored chat is exactly what the backup holds: its messages, its instructions and its dates, under a new id (chat 0 there has the message added in launch 1)', inBackup.length === 5 && loaded.length === 5 && inBackup.every((b) => loaded.some((l) => same(l.messages, b.messages) && l.instructions === b.instructions && l.createdAt === b.createdAt && l.updatedAt === b.updatedAt && l.id !== b.id)) && loaded.some((l) => l.messages.some((m) => m.content.includes('SECRET-WORDS-ONE'))), JSON.stringify({ loaded: loaded.length, why }))
  const afterRestore = W.folder()
  check('the six old sealed files are STILL THERE, untouched (counted, never deleted, never written over), and the restored copies are plain files', Object.keys(prev.folder.files).every((n) => afterRestore.files[n] === prev.folder.files[n]) && Object.keys(afterRestore.files).filter((n) => !(n in prev.folder.files)).every((n) => !W.isEnvelope(n)))
  const st2 = await W.storage()
  check('storage(): plain, 6 plain chats (5 restored and the one saved a moment ago), 6 files still unreadable and all of them unopened', st2.choice === 'off' && st2.plain === 6 && st2.encrypted === 0 && st2.unreadable === 6 && st2.unopened === 6 && st2.blocked === null, JSON.stringify(st2))
  await H.closeHistory()
  W.saveState('state3.json', { folder: W.folder(), titles: prev.titles, backups: prev.backups, newChat: prev.newChat })
  check('no problems in the page at the end (console errors, CSP violations)', page.problems.length === 0, JSON.stringify(page.problems))
} catch (error) {
  check(`the suite stopped before its end: ${String(error?.stack ?? error).slice(0, 400)}`, false)
  try { await page.screenshot(join(shots, 'v8b3c-stopped.png')) } catch { /* the page is gone */ }
}
main.close()
const passed = check.summary()
process.exit(passed ? 0 : 1)
