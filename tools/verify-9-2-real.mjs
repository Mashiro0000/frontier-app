// Slice 9.2 once with the REAL Windows open dialog (D-037), on a scratch profile: the page is driven from the debug port (a script .click(), no mouse), and the
// dialog is read and answered with tools/real-dialogs.ps1 (UI Automation reads it; window messages go to that dialog's own controls; nothing else on the
// desktop is touched). Proves what the suites cannot: that Windows really shows the dialog Electron is asked for (its title, a file name box, several files
// at once) and that what the person picks there becomes chips.
// usage: node tools/run-one.mjs real92 dev verify-9-2-real.mjs USER_DATA_DIR=s92real FILES_DIR=<a folder of files>   (run92.mjs's s92-files will do)
import { connect, checker, sleep } from './cdp.mjs'
import { assertScratchProfile } from './profile-guard.mjs'
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { OUT, TOOLS } from './paths.mjs'

const shots = process.argv[2]
const port = Number(process.argv[3] ?? 9222)
const userData = process.env.USER_DATA_DIR
const FILES = process.env.FILES_DIR
if (!userData || !FILES) throw new Error('USER_DATA_DIR and FILES_DIR must be set')
const check = checker()
const page = await connect(port)
await assertScratchProfile()
const ev = (e) => page.evaluate(e)
const dialog = (op, extra = []) => {
  const r = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(TOOLS, 'real-dialogs.ps1'), '-Op', op, '-Port', String(port), ...extra], { encoding: 'utf8', timeout: 60000 })
  return ((r.stdout ?? '') + (r.stderr ?? '')).trim()
}
const chips = () => ev(`[...document.querySelectorAll('.attachment-chip .attachment-name')].map((n) => n.textContent)`)
const clickAttach = () => ev(`[...document.querySelectorAll('.chat-bar .chat-button')].find((b) => b.textContent === 'Attach...').click()`)

try {
  await page.waitFor(`!!document.querySelector('.chat-bar')`, { timeoutMs: 20000, label: 'the app' })
  await sleep(500)
  // one file, by its full path
  await clickAttach()
  const found = dialog('find', ['-WaitSec', '15'])
  check('the real dialog is there, titled "Attach files", with a file name box and an Open button', /Attach files/.test(found) && /1148/.test(found) && /Open/.test(found), found.slice(0, 600))
  // No screenshot: the dialog opens in a folder Windows remembers, which can be the person's own (it was the Downloads folder once).
  const filetype = dialog('filetype')
  check('the file type Windows shows first is "All files" (a text file can have any extension; what a file is comes from its bytes)', /^FILETYPE \[All files/.test(filetype), filetype)
  dialog('setname', ['-Value', join(FILES, 'holiday.jpg')])
  dialog('ok')
  await page.waitFor(`document.querySelectorAll('.attachment-chip').length === 1`, { timeoutMs: 20000, label: 'one chip' })
  check('the file picked in the real dialog becomes a chip (holiday.jpg, turned upright)', JSON.stringify(await chips()) === JSON.stringify(['holiday.jpg']) && /32 x 64/.test(await ev(`document.querySelector('.attachment-facts').textContent`)))
  check('the dialog is gone afterwards', /no dialog|gone/i.test(dialog('gone', ['-WaitSec', '3'])))
  // several at once: Windows' own syntax, names in quotes, in the folder the dialog opens in (the one used last)
  await clickAttach()
  dialog('find', ['-WaitSec', '15'])
  // Open with a folder in the name box goes into that folder (Windows' own behaviour); then two names in quotes are two files in it.
  dialog('setname', ['-Value', FILES.replaceAll('/', String.fromCharCode(92))])
  dialog('ok')
  await sleep(1500)
  dialog('setname', ['-Value', '"report.pdf" "notes.md"'])
  dialog('ok')
  await sleep(1500)
  console.log(dialog('gone', ['-WaitSec', '1']))
  await page.waitFor(`document.querySelectorAll('.attachment-chip').length === 3`, { timeoutMs: 20000, label: 'three chips' })
  check('two files picked at once in the real dialog become two chips (several files are allowed)', JSON.stringify((await chips()).slice(1).sort()) === JSON.stringify(['notes.md', 'report.pdf']), JSON.stringify(await chips()))
  check('three copies in the profile\'s attachments folder', existsSync(join(userData, 'attachments')) && readdirSync(join(userData, 'attachments')).filter((n) => /^[0-9a-f]{64}$/.test(n)).length === 3)
} catch (error) {
  check(`the run stopped before its end: ${String(error?.stack ?? error).slice(0, 400)}`, false)
  console.log(dialog('gone', ['-WaitSec', '1']))
}
void OUT
page.close()
process.exit(check.summary() ? 0 : 1)
