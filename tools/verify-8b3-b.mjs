// Stage 8b.3 (D-035), launch 2 of 4: a RESTART on the profile launch 1 left, with encryption on and five sealed chats. Reading never writes: nothing in the chat folder
// or the setting is touched at start; the sealed chats open again with the real secure storage; a new chat is saved sealed and the five others are not rewritten.
import { start } from './lib8b3w.mjs'
import { same } from './lib8b.mjs'
import { join } from 'node:path'

const W = await start()
const { page, H, ev, check, main, shots, sleep } = W

try {
  const prev = W.loadState('state1.json')
  await page.waitFor(`!!document.querySelector('.chat-bar')`, { timeoutMs: 20000, label: 'the app' })
  await sleep(400)
  check('after a restart nothing in the chat folder and nothing in the setting was rewritten at start: every file is byte for byte what launch 1 left (reading never writes)', same(W.folder(), prev.folder), JSON.stringify(W.folder()).slice(0, 200))
  const st = await W.storage()
  check('storage() after the restart: on, key usable, 5 encrypted, nothing unreadable (this PC\'s secure storage opens the files again)', same(st, { choice: 'on', canEncrypt: true, keyUsable: true, plain: 0, encrypted: 5, unreadable: 0, unopened: 0, blocked: null }), JSON.stringify(st))
  await H.openHistory()
  check('History lists the five chats with their real titles', same([...(await W.historyRows())].sort(), [...prev.titles].sort()))
  await H.closeHistory()
  await W.openSettings()
  const s = await W.section()
  check('Settings says encryption is on, 5 encrypted, with "Go back to plain files..." as the only button', s.line === 'Encryption is on: 5 chats are encrypted, and every chat you save from now on is too.' && same(s.buttons, [{ text: 'Go back to plain files...', disabled: false }]) && s.notes.length === 0, JSON.stringify(s))
  await W.closeSettings()

  // a new chat in the restarted app is saved sealed, and nothing else is rewritten
  await H.clickChat('New chat')
  await H.sendAndWait('the second launch says SECRET-WORDS-TWO')
  await sleep(1300)
  const now = W.folder()
  const added = Object.keys(now.files).filter((n) => !(n in prev.folder.files))
  check('the new chat is one new file; the five that were here are byte for byte untouched; no leftover copy', added.length === 1 && Object.keys(prev.folder.files).every((n) => now.files[n] === prev.folder.files[n]) && W.strays().length === 0, JSON.stringify(added))
  check('...and it is sealed: an envelope, with the words not readable in it', added.length === 1 && W.isEnvelope(added[0]) && !W.text(added[0]).includes('SECRET-WORDS-TWO'))
  check('...and the setting file was not rewritten', now.setting === prev.folder.setting)
  W.saveState('state2.json', { folder: W.folder(), backups: prev.backups, titles: prev.titles, newChat: added[0] })
  await page.screenshot(join(shots, 'v8b3-restart.png'))
  check('no problems in the page at the end (console errors, CSP violations)', page.problems.length === 0, JSON.stringify(page.problems))
} catch (error) {
  check(`the suite stopped before its end: ${String(error?.stack ?? error).slice(0, 400)}`, false)
  try { await page.screenshot(join(shots, 'v8b3b-stopped.png')) } catch { /* the page is gone */ }
}
main.close()
const passed = check.summary()
process.exit(passed ? 0 : 1)
