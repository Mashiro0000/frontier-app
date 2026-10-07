// Slice 9.5 (D-037), in the real window: a backup holds the attached files, and a restore puts them back. A chat with a photo and a PDF is sent and saved;
// "Back up all chats..." (the save dialog replaced from main) writes a version 2 file with the two files in it and says so; the chat is deleted (its copies
// with it); "Restore from a backup..." (the open dialog replaced) shows the files the backup holds, adds the chat and puts the files back, each copy named
// by its hash; the chat opens with its pictures and sends its files again, the same bytes. Then with encryption on, a restore into an emptied folder writes
// the copies sealed. Needs USER_DATA_DIR (scratch), FILES_DIR (made by run95.mjs), INSPECT_PORT, MOCK_PORT and a saved key (setup-key.mjs).
import { start } from './lib8b3w.mjs'
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const W = await start()
const { page, H, ev, check, main, FILES, sleep, userData } = W
const mockUrl = `http://127.0.0.1:${process.env.MOCK_PORT}`
const ATT = join(userData, 'attachments')
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex')
const copies = () => (existsSync(ATT) ? readdirSync(ATT).filter((n) => /^[0-9a-f]{64}$/.test(n)).sort() : [])
const F = (name) => join(FILES, name)
const show = (v) => JSON.stringify(v)?.slice(0, 400)
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const reqs = async () => (await fetch(`${mockUrl}/__requests`)).json()
const lines = (path) => readFileSync(path, 'utf8').split('\n').filter((l) => l !== '').map((l) => JSON.parse(l))
const SEALED = 'FRONTIER-SEALED-ATTACHMENT-1\n'

await main.inMain(`(() => {
  const { dialog } = process.mainModule.require('electron')
  globalThis.__d = { open: [], save: [], box: [] }
  dialog.showOpenDialog = async () => { const next = globalThis.__d.open.shift(); return next ? { canceled: false, filePaths: next } : { canceled: true, filePaths: [] } }
  dialog.showSaveDialog = async () => { const next = globalThis.__d.save.shift(); return next ? { canceled: false, filePath: next } : { canceled: true } }
  dialog.showMessageBox = async () => ({ response: globalThis.__d.box.shift() ?? 1, checkboxChecked: false })
  return true
})()`)
const queue = (kind, value) => main.inMain(`globalThis.__d.${kind}.push(${JSON.stringify(value)}); true`)
const attach = async (names) => {
  await queue('open', names.map(F))
  await H.clickChat('Attach...')
  await page.waitFor(`document.querySelectorAll('.attachment-chip').length === ${names.length}`, { timeoutMs: 20000, label: 'the chips' })
}
const sendNow = async (text) => {
  const before = (await reqs()).length
  await ev(`(() => { const t = document.querySelector('.composer-input'); t.focus(); t.select() })()`)
  await page.type(text)
  await page.press('Enter')
  const t0 = Date.now()
  while (Date.now() - t0 < 10000 && (await reqs()).length === before) await sleep(60)
  await H.waitReady(20000)
  await sleep(300)
  return (await reqs()).at(-1)
}
const notice = () => ev(`document.querySelector('dialog.history .backup-notice')?.textContent ?? null`)
const waitNotice = (re) => page.waitFor(`${re}.test(document.querySelector('dialog.history .backup-notice')?.textContent ?? '')`, { timeoutMs: 30000, label: `a notice like ${re}` })
const reveal = async (css, text) => { await ev(`(() => { const el = [...document.querySelectorAll(${JSON.stringify(css)})].find((e) => e.textContent.trim() === ${JSON.stringify(text)}); el?.scrollIntoView({ block: 'center' }) })()`); await sleep(80) }
const clickFooter = async (text) => { await reveal('dialog.history .history-footer .history-button', text); await page.click(`dialog.history .history-footer .history-button@${text}`) }
const clickPanel = async (text) => { await reveal('dialog.history .backup-preview button', text); await page.click(`dialog.history .backup-preview button@${text}`) }
const facts = () => ev(`[...document.querySelectorAll('dialog.history .backup-preview-facts li')].map((li) => li.innerText)`)

try {
  await page.waitFor(`!!document.querySelector('.chat-bar')`, { timeoutMs: 20000, label: 'the app' })
  await sleep(400)

  // ============ 1. a chat with two files ============
  await attach(['photo.jpg', 'report.pdf'])
  const r1 = await sendNow('[[mock:files]] keep these')
  const ids = copies()
  check('(a chat with a photo and a PDF is sent and saved; two copies)', r1 && r1.problems.length === 0 && ids.length === 2, show(ids))
  const photoBytes = Buffer.from(r1.body.messages[0].content[0].source.data, 'base64')
  await sleep(800)

  // ============ 2. the backup ============
  const dest = join(FILES, 'out', 'all.jsonl')
  await queue('save', dest)
  await H.openHistory()
  await clickFooter('Back up all chats...')
  await waitNotice(/^Backed up/)
  const n2 = await notice()
  check('"Back up all chats..." says it holds the chat\'s two attached files too', n2 === `Backed up 1 chat to ${dest}. The file was read back and every chat matched. It holds their 2 attached files too.`, n2)
  const l2 = lines(dest)
  const fileLines = l2.filter((l) => typeof l.file === 'string')
  check('the file is a version 2 backup: the chat, then a line for each file (its id and its bytes), then the trailer counting them', l2[0].version === 2 && fileLines.length === 2 && same(fileLines.map((l) => l.file).sort(), ids) && fileLines.every((l) => sha(Buffer.from(l.data, 'base64')) === l.file) && same(l2.at(-1), { end: true, count: 1, leftOut: 0, files: 2, filesLeftOut: 0 }), show(l2.at(-1)))

  // ============ 3. the chat deleted, its copies with it ============
  const title = (await H.rows())[0].title
  await H.clickRowButton(title, 'Delete')
  await sleep(200)
  await H.clickRowButton(title, 'Delete')
  await page.waitFor(`document.querySelectorAll('dialog.history .history-row').length === 0`, { timeoutMs: 8000, label: 'the row to go' })
  await sleep(400)
  check('(the chat is deleted, and its two copies with it)', copies().length === 0, show(copies()))

  // ============ 4. the restore ============
  await queue('open', [dest])
  await clickFooter('Restore from a backup...')
  await page.waitFor(`!!document.querySelector('dialog.history .backup-preview')`, { timeoutMs: 20000, label: 'the preview' })
  const f4 = await facts()
  check('the look before adding says the backup holds two attached files to put back', f4.includes('2 attached files to put back'), show(f4))
  await clickPanel('Add 1 chat')
  await waitNotice(/^Added/)
  const n4 = await notice()
  check('adding says one chat was added and the two files put back', n4 === 'Added 1 chat. Put back 2 attached files.', n4)
  check('the two copies are back, each named by the hash of what it holds', same(copies(), ids) && copies().every((id) => sha(readFileSync(join(ATT, id))) === id), show(copies()))
  await H.clickRow(title)
  await page.waitFor(`!document.querySelector('dialog.history')?.open`, { timeoutMs: 8000 })
  await page.waitFor(`!!document.querySelector('.message-file img.attachment-thumb')`, { timeoutMs: 10000, label: 'the picture' })
  check('the restored chat shows its files, the photo with its picture made again from the copy put back', (await ev(`[...document.querySelectorAll('.message-file .attachment-name')].map((e) => e.textContent)`)).join() === 'photo.jpg,report.pdf')
  const r4 = await sendNow('[[mock:files]] after the restore')
  check('a message in it sends the files again, the same bytes as before the backup', r4 && r4.problems.length === 0 && Buffer.from(r4.body.messages[0].content[0].source.data, 'base64').equals(photoBytes), show(r4?.problems))

  // ============ 5. with encryption on, the copies put back are sealed ============
  // The backup made before encrypting holds the chat as it is now (the first backup holds it as it was before the message above, so a restore
  // of that one would add it as a copy).
  const beforeEncrypting = join(FILES, 'out', 'before-encrypting.jsonl')
  await queue('save', beforeEncrypting)
  await W.openSettings()
  await W.clickSection('Encrypt my saved chats...')
  await W.waitNote(/Encrypted 1 chat/)
  await W.closeSettings()
  check('(encryption on: the copies are sealed)', copies().every((id) => readFileSync(join(ATT, id)).subarray(0, SEALED.length).toString('latin1') === SEALED))
  const lb = lines(beforeEncrypting)
  check('the backup made before encrypting holds the two files too, as their plain bytes (a backup is a plain file)', lb[0].version === 2 && lb.filter((l) => typeof l.file === 'string').every((l) => sha(Buffer.from(l.data, 'base64')) === l.file) && same(lb.at(-1), { end: true, count: 1, leftOut: 0, files: 2, filesLeftOut: 0 }), show(lb.at(-1)))
  for (const id of copies()) rmSync(join(ATT, id))
  await H.openHistory()
  await queue('open', [beforeEncrypting])
  await clickFooter('Restore from a backup...')
  await page.waitFor(`!!document.querySelector('dialog.history .backup-preview')`, { timeoutMs: 20000, label: 'the preview' })
  const f5 = await facts()
  const b5 = await ev(`[...document.querySelectorAll('dialog.history .backup-preview .history-actions button')].map((b) => ({ text: b.textContent.trim(), disabled: b.disabled }))`)
  check('with the chat already here and its copies lost, the look says the chat is here and two attached files are to be put back, and offers "Put back 2 attached files"', f5.includes('1 chat already here, left as it is') && f5.includes('2 attached files to put back') && b5[0]?.text === 'Put back 2 attached files' && !b5[0].disabled, show({ f5, b5 }))
  await clickPanel('Put back 2 attached files')
  await waitNotice(/attached files/)
  const n5 = await notice()
  const sealedNow = copies().map((id) => readFileSync(join(ATT, id)).subarray(0, SEALED.length).toString('latin1') === SEALED)
  check('...it puts the two copies back, written SEALED (encryption is on), and says so', n5 === '1 chat already here, left as it is. Put back 2 attached files.' && same(copies(), ids) && sealedNow.every(Boolean), show({ n5, copies: copies().length, sealedNow }))
  const problems = page.problems.filter((p) => !/Autofill|Electron Security Warning|DevTools/.test(p))
  check('no console errors, warnings or CSP violations in the page', problems.length === 0, show(problems))
} catch (error) {
  check(`the suite stopped before its end: ${String(error?.stack ?? error).slice(0, 500)}`, false)
}

main.close()
page.close()
process.exit(check.summary() ? 0 : 1)
