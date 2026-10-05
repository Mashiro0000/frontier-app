// Stage 8b.3 / 8b.4 (D-035), launch 4 of 4: THE KEY COMES BACK. run8b3.mjs put the profile's original "Local State" back, so the key that sealed the chats opens them again. Nothing
// was lost: the six sealed files are readable again, and "turn the encrypted chats back to plain files" gives the very bytes that were seeded. The choice is still "off" (it was turned off in
// launch 3), so the section shows chats that are "still encrypted from before".
import { start } from './lib8b3w.mjs'
import { makeChat, fileText, same } from './lib8b.mjs'
import { join } from 'node:path'

const W = await start()
const { page, H, check, main, shots, sleep } = W
const chats = Array.from({ length: 5 }, (_, i) => makeChat(i))

try {
  const prev = W.loadState('state3.json')
  await page.waitFor(`!!document.querySelector('.chat-bar')`, { timeoutMs: 20000, label: 'the app' })
  await sleep(400)
  const dialogs = await W.installDialogs()
  check('the app started with the original key back and wrote nothing at start: every chat file and the setting are byte for byte what launch 3 left', same(W.folder(), prev.folder))
  const st = await W.storage()
  check('storage(): choice off, the six sealed chats OPEN AGAIN (6 encrypted, 0 unreadable), 6 plain, nothing blocked: nothing was lost', st.choice === 'off' && st.canEncrypt === true && st.encrypted === 6 && st.plain === 6 && st.unreadable === 0 && st.unopened === 0 && st.blocked === null, JSON.stringify(st))
  await H.openHistory()
  const rows = await W.historyRows()
  check('History lists all twelve chats: the six that were sealed (their titles are back) and the six plain ones', rows.length === 12 && chats.every((c) => rows.filter((r) => r === c.title).length === 2), JSON.stringify(rows))
  await H.closeHistory()
  await W.openSettings()
  let s = await W.section()
  check('Settings: plain files, "6 chats are still encrypted from before", and two buttons: Encrypt my saved chats... and Turn the encrypted chats back to plain files...', s.line === 'Chats are saved as plain files.' && /6 chats are still encrypted from before\./.test(s.text) && same(s.buttons.map((b) => b.text), ['Encrypt my saved chats...', 'Turn the encrypted chats back to plain files...']), JSON.stringify(s))
  await dialogs.reset()
  await dialogs.queue('box', 0)
  await W.clickSection('Turn the encrypted chats back to plain files...')
  await W.waitNote(/Rewrote 6 chats as plain files/)
  const c = (await dialogs.calls())[0]
  check('the message box was asked with the counts (6 chats) and the usual detail, once', c.kind === 'box' && /6 chats will be rewritten as plain files/.test(c.options.message) && /Anyone who can read the app's data folder/.test(c.options.detail))
  s = await W.section()
  check('the six are plain files now; the four seeded chats that were never touched are BYTE FOR BYTE what run8b3 seeded (plain, sealed, key lost and back, plain again); no file is sealed; no leftover copy', W.chatFiles().length === 12 && W.chatFiles().every((n) => !W.isEnvelope(n)) && [1, 2, 3, 4].every((i) => W.text(`${chats[i].id}.json`) === fileText(chats[i])) && W.strays().length === 0)
  check('...and the section says plain, nothing left encrypted', s.line === 'Chats are saved as plain files.' && !/still encrypted/.test(s.text) && same(s.buttons.map((b) => b.text), ['Encrypt my saved chats...']))
  const st2 = await W.storage()
  check('storage(): off, 12 plain, nothing else', st2.choice === 'off' && st2.plain === 12 && st2.encrypted === 0 && st2.unreadable === 0 && st2.blocked === null, JSON.stringify(st2))
  await page.screenshot(join(shots, 'v8b3-key-back.png'))
  await W.closeSettings()
  W.saveState('state4.json', { folder: W.folder() })
  check('no problems in the page at the end (console errors, CSP violations)', page.problems.length === 0, JSON.stringify(page.problems))
} catch (error) {
  check(`the suite stopped before its end: ${String(error?.stack ?? error).slice(0, 400)}`, false)
  try { await page.screenshot(join(shots, 'v8b3d-stopped.png')) } catch { /* the page is gone */ }
}
main.close()
const passed = check.summary()
process.exit(passed ? 0 : 1)
