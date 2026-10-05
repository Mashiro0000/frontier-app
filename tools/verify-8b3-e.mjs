// Stage 8b.4 (D-035), launch 5 of 5: THE CHOICE'S OWN FILE IS DAMAGED. run8b3.mjs wrote "this is not json {{{" over chat-encryption.json before this launch. Damage never means "plain" and never
// means "encrypted": it means "ask", so nothing new is saved, no file is changed, and the person chooses again. The page says so (Settings, History, the "Not saved" badge), and "Use plain files..."
// (a yes in the system's message box) writes the choice again and saving works.
import { start } from './lib8b3w.mjs'
import { same } from './lib8b.mjs'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const W = await start()
const { page, H, ev, check, main, settingFile, shots, sleep } = W

try {
  const prev = W.loadState('state4.json')
  await page.waitFor(`!!document.querySelector('.chat-bar')`, { timeoutMs: 20000, label: 'the app' })
  await sleep(400)
  const dialogs = await W.installDialogs()
  check('the choice file really is damaged, and the app started without touching it or any chat file', readFileSync(settingFile, 'utf8') === 'this is not json {{{' && same(W.folder().files, prev.folder.files))
  const st = await W.storage()
  check('storage(): the choice is "unreadable" (not "off", not "on"), nothing is known about a key, the twelve plain chats are still listed, and saving is blocked with the sentence about the choice', st.choice === 'unreadable' && st.keyUsable === null && st.plain === 12 && st.encrypted === 0 && /^Chats are not being saved: the file that says whether they are encrypted could not be read/.test(st.blocked ?? '') && /Nothing was changed\./.test(st.blocked), JSON.stringify(st))
  const sentence = st.blocked
  await W.openSettings()
  let s = await W.section()
  check('Settings: an alert with the sentence, the line says it is not known whether chats are encrypted, and the two buttons are "Encrypt my saved chats..." and "Use plain files..."', s.alerts.includes(sentence) && s.line === 'It is not known whether chats are encrypted.' && same(s.buttons.map((b) => b.text), ['Encrypt my saved chats...', 'Use plain files...']), JSON.stringify(s))
  await W.closeSettings()
  await H.openHistory()
  check('History lists the twelve chats (reading is not blocked) and shows the sentence as a notice', (await W.historyRows()).length === 12 && (await H.historyText()).includes(sentence))
  await H.closeHistory()

  await H.clickChat('New chat')
  await H.sendAndWait('the fifth launch says SECRET-WORDS-FIVE')
  await sleep(1500)
  const screen = await H.screen()
  const badge = await W.badge('Not saved')
  check('a reply on screen cannot be saved: the header says "Not saved" with the sentence in its title, nothing was written, and the choice file is still the damaged one', screen.length === 2 && !!badge && badge.title.includes(sentence) && same(W.folder().files, prev.folder.files) && readFileSync(settingFile, 'utf8') === 'this is not json {{{' && W.strays().length === 0, JSON.stringify({ badge, screen: screen.length }))
  const direct = await ev(`window.api.history.save({ id: crypto.randomUUID(), messages: [{ role: 'user', content: 'x', status: 'done' }] })`)
  check('history.save through the bridge is refused with the same sentence', direct.ok === false && direct.error === sentence, JSON.stringify(direct))

  // choosing again
  await W.openSettings()
  await dialogs.reset()
  await dialogs.queue('box', 0)
  await W.clickSection('Use plain files...')
  await W.waitNote(/plain files/)
  const asked = (await dialogs.calls())[0]
  check('"Use plain files..." asked in the system\'s message box (modal, "Keep encryption" the default) with the facts of a plain folder: "Chats you save from now on will be plain files."', asked.kind === 'box' && asked.withWindow && asked.options.message === 'Chats you save from now on will be plain files.' && /No saved chat is encrypted now/.test(asked.options.detail) && asked.options.defaultId === 1 && asked.options.cancelId === 1, JSON.stringify(asked.options))
  s = await W.section()
  check('after a yes the choice file is written again ({"version":1,"encrypt":false}), the section says plain files, there is no alert and the one button is "Encrypt my saved chats..."', readFileSync(settingFile, 'utf8') === '{"version":1,"encrypt":false}' && s.line === 'Chats are saved as plain files.' && s.alerts.length === 0 && same(s.buttons.map((b) => b.text), ['Encrypt my saved chats...']) && /^Chats you save from now on are plain files\./.test(s.notes[0] ?? ''), JSON.stringify(s))
  await W.closeSettings()
  await page.click('.app-badge-button')
  await page.waitFor(`![...document.querySelectorAll('.app-badge')].some((b) => b.textContent === 'Not saved')`, { timeoutMs: 8000, label: 'the Not saved badge to go' })
  await sleep(500)
  const added = Object.keys(W.folder().files).filter((n) => !(n in prev.folder.files))
  check('"Not saved" then retry: the chat on screen is saved, as a plain file, with its words', added.length === 1 && !W.isEnvelope(added[0]) && W.text(added[0]).includes('SECRET-WORDS-FIVE'), JSON.stringify(added))
  await page.screenshot(join(shots, 'v8b3-choice-damaged-fixed.png'))
  check('no problems in the page at the end (console errors, CSP violations)', page.problems.length === 0, JSON.stringify(page.problems))
} catch (error) {
  check(`the suite stopped before its end: ${String(error?.stack ?? error).slice(0, 400)}`, false)
  try { await page.screenshot(join(shots, 'v8b3e-stopped.png')) } catch { /* the page is gone */ }
}
main.close()
const passed = check.summary()
process.exit(passed ? 0 : 1)
