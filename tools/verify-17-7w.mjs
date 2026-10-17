// Slice 17.7 (D-049) in the real window, on this PC's real secure storage, against the mock's Gemini stand-in: what is kept of a Google key and a Gemini chat, sealed
// and backed up. The system's box and the save dialog stood in for from the main inspector. What it shows:
//   A. a Google key saved and a Gemini reply: of every file in the profile, the key is in none (not plain, not base64), the chat's words only in the chat's file;
//   B. encryption on: the chat (google / gemini-3.8-flash) is backed up first, the backup holds it with who answered, and then no file holds the chat's words or the key;
//   C. the sealed chat opens with its replies still Google's; a Gemini reply while encrypted is saved sealed too; the key still works (the reply came);
//   D. the shortlist: with a Google key saved, main suggests Gemini 3.8 Flash for coding, quoting Google's page; never Gemini 4 Argon;
//   E. the page logged nothing.
// Needs: USER_DATA_DIR (scratch), INSPECT_PORT, MOCK_PORT, FRONTIER_GUARD_ROOT.
import './temp-on-a.mjs'
import './ts-resolve.mjs'
import { connect, checker, sleep } from './cdp.mjs'
import { assertScratchProfile } from './profile-guard.mjs'
import { mainInspector, h4 } from './lib4.mjs'
import { installQuestions } from './lib10.mjs'
import { randomBytes } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const port = Number(process.argv[3] ?? 9222)
const userData = process.env.USER_DATA_DIR
const inspectPort = Number(process.env.INSPECT_PORT)
const mockUrl = `http://127.0.0.1:${process.env.MOCK_PORT}`
const runRoot = process.env.FRONTIER_GUARD_ROOT
if (!userData || !inspectPort || !process.env.MOCK_PORT || !runRoot) throw new Error('USER_DATA_DIR, INSPECT_PORT, MOCK_PORT and FRONTIER_GUARD_ROOT must be set')
const check = checker()
const part = async (name, fn) => { try { await fn() } catch (error) { check(`${name} did not run to its end: ${String(error?.stack ?? error).slice(0, 500)}`, false) } }
const show = (v) => JSON.stringify(v)?.slice(0, 600)
const page = await connect(port)
await assertScratchProfile()
const main = await mainInspector(inspectPort)
const Q = await installQuestions(main, { fallback: 'yes' })
const H = h4(page, { userData, mockUrl })
const ev = (expression) => page.evaluate(expression)
const KEY_G = 'AIza' + randomBytes(27).toString('base64url').slice(0, 35)
const WORD = `bladderwrack${randomBytes(4).toString('hex')}` // a word found nowhere else, to look for on the disk
const BACKUP = join(runRoot, 'before-encrypting-17.jsonl')
const CHROMIUM_SHUT = /^(?:.*[\\/])?LOCK$|^Network[\\/]Cookies(?:-journal)?$/
const needles = { key: Buffer.from(KEY_G), key64: Buffer.from(Buffer.from(KEY_G).toString('base64').slice(0, 40)), word: Buffer.from(WORD) }
function scan() {
  const found = Object.fromEntries(Object.keys(needles).map((k) => [k, []]))
  let files = 0
  const shut = []
  for (const name of readdirSync(userData, { recursive: true })) {
    const path = join(userData, name)
    let stat
    try { stat = statSync(path) } catch { continue }
    if (!stat.isFile()) continue
    files += 1
    let bytes
    try { bytes = readFileSync(path) } catch { shut.push(relative(userData, path)); continue }
    for (const [k, needle] of Object.entries(needles)) if (bytes.indexOf(needle) !== -1) found[k].push(relative(userData, path).replaceAll('\\', '/'))
  }
  return { files, shut, found }
}

let chatId = null
try {
  await fetch(`${mockUrl}/__reset`, { method: 'POST' })
  await part('A', async () => {
    check('A: (setup) a Google key saved (the box answered yes)', (await ev(`window.api.settings.setApiKey('google', ${JSON.stringify(KEY_G)})`)).ok === true)
    await H.chooseInPage('gemini-3.8-flash')
    await H.settle('gemini-3.8-flash')
    await H.askMock(`remember the ${WORD} please`)
    const saved = await H.waitFirst(`remember the ${WORD}`, (c) => c.messages.length === 2 && c.messages[1].status === 'done')
    chatId = saved.id
    check('A: the chat is saved with its reply as Google\'s (google / gemini-3.8-flash)', saved.conv.messages[1].provider === 'google' && saved.conv.messages[1].model === 'gemini-3.8-flash', show(saved.conv.messages[1]))
    const s = scan()
    check(`A: of ${s.files} files in the profile, none holds the Google key, plainly or as base64`, s.found.key.length === 0 && s.found.key64.length === 0, show([s.found.key, s.found.key64]))
    check('A: the chat\'s words are only in the chat\'s own file', s.found.word.length === 1 && s.found.word[0] === `conversations/${chatId}.json`, show(s.found.word))
    check('A: credentials.google.json is there and holds the key only encrypted', existsSync(join(userData, 'credentials.google.json')) && !readFileSync(join(userData, 'credentials.google.json'), 'utf8').includes(KEY_G))
    check('A: every file could be read but Chromium\'s own lock files and cookie store', s.shut.every((p) => CHROMIUM_SHUT.test(p)), show(s.shut))
  })

  await part('B', async () => {
    await main.inMain(`(() => { const { dialog } = process.mainModule.require('electron'); dialog.showSaveDialog = async () => ({ canceled: false, filePath: ${JSON.stringify(BACKUP)} }); return true })()`)
    const on = await ev(`window.api.history.encryptChats()`)
    check('B: encryption on: the chat backed up first, then encrypted', on.ok === true && on.report.backup?.count === 1 && on.report.changed === 1, show(on))
    const backup = existsSync(BACKUP) ? readFileSync(BACKUP, 'utf8') : ''
    check('B: the backup holds the chat with who answered it (google, gemini-3.8-flash), and not the key', backup.includes(WORD) && /"provider":"google"/.test(backup) && /"model":"gemini-3\.8-flash"/.test(backup) && !backup.includes(KEY_G), String(backup.length))
    const s = scan()
    check(`B: sealed: none of the ${s.files} files in the profile holds the chat's words or the key`, s.found.word.length === 0 && s.found.key.length === 0 && s.found.key64.length === 0, show(s.found))
  })

  await part('C', async () => {
    const loaded = await ev(`window.api.history.load(${JSON.stringify(chatId)})`)
    check('C: the sealed chat opens, its reply still Google\'s', loaded.ok === true && loaded.conversation.messages[1].provider === 'google' && loaded.conversation.messages[1].content.includes(WORD), show(loaded.conversation?.messages?.[1] ?? loaded))
    await H.clickChat('New chat')
    await sleep(300)
    const WORD2 = `${WORD}x`
    await H.askMock(`and the ${WORD2}`)
    check('C: a Gemini reply while encrypted (the key still works)', (await H.bubbleText()) === `Echo: and the ${WORD2}`)
    await sleep(800)
    const s = scan()
    check('C: ... and it is saved sealed: no file holds its words', s.found.word.length === 0, show(s.found.word))
  })

  await part('D', async () => {
    const st = await H.status()
    const coding = st.suggestions.filter((x) => x.task === 'coding')
    const flash = coding.find((x) => x.modelId === 'gemini-3.8-flash')
    check('D: with a Google key saved, Gemini 3.8 Flash is on the shortlist for coding, with Google\'s own words, the address of its page and the day it was read', flash !== undefined && /long-horizon software engineering/.test(flash.note) && flash.source === 'https://ai.google.dev/gemini-api/docs/models' && flash.asOf === '2026-10-17', show(coding))
    check('D: Gemini 4 Argon is on no list (Google\'s page names no task for it)', !st.suggestions.some((x) => x.modelId === 'gemini-4-argon'))
  })

  await part('E', async () => {
    check('E: the page logged no error or warning', page.problems.length === 0, show(page.problems))
    check('E: (the box was asked only for the Google key)', (await Q.count()) >= 1)
  })
} finally {
  const ok = check.summary()
  process.exit(ok ? 0 : 1)
}
