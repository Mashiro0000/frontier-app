// Slice 16.7 (D-048) in the real window, against the mock, with the system's message box and save dialog stood in for from the main inspector: what is kept, sealed and
// backed up of the pictures, in the real app with the REAL secure storage of this PC (Electron's safeStorage). What it shows:
//   A. two pictures made through the dialog (real clicks) are in the chat, and the chat is saved;
//   B. Settings > Usage: this chat's sum is the pictures' cost, exactly as main's ledger has it, and today's holds it;
//   C. the scan, plain: of every file in the profile (the app's and Chromium's), only the picture files under images/ hold the picture's bytes, none holds the picture as
//      base64 (no data: copy on the disk), and the description is only in images.json and the chat;
//   D. encryption on: the backup made first holds the chat and its note and NOT the picture; the report counts the two pictures; then NO file in the profile holds the
//      picture's bytes, its base64 or the description; the gallery still shows them, byte for byte;
//   E. back to plain (a yes in the box): the two pictures are rewritten plain, and they are again the only files with the picture;
//   F. the page logged nothing.
// Needs: USER_DATA_DIR (scratch), INSPECT_PORT, MOCK_PORT, FRONTIER_GUARD_ROOT.
import './temp-on-a.mjs'
import './ts-resolve.mjs'
import { connect, checker, sleep } from './cdp.mjs'
import { assertScratchProfile } from './profile-guard.mjs'
import { mainInspector, h4 } from './lib4.mjs'
import { installQuestions } from './lib10.mjs'
import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { REPO_URL } from './paths.mjs'

const port = Number(process.argv[3] ?? 9222)
const userData = process.env.USER_DATA_DIR
const inspectPort = Number(process.env.INSPECT_PORT)
const mockUrl = `http://127.0.0.1:${process.env.MOCK_PORT}`
const runRoot = process.env.FRONTIER_GUARD_ROOT
if (!userData || !inspectPort || !process.env.MOCK_PORT || !runRoot) throw new Error('USER_DATA_DIR, INSPECT_PORT, MOCK_PORT and FRONTIER_GUARD_ROOT must be set')
const check = checker()
const STOP_AFTER = process.env.STOP_AFTER ?? null
let stopped = false
const part = async (name, fn) => { if (stopped) return; try { await fn() } catch (error) { check(`${name} did not run to its end: ${String(error?.stack ?? error).slice(0, 500)}`, false) } if (STOP_AFTER === name) stopped = true }
const show = (v) => JSON.stringify(v)?.slice(0, 600)
const { formatSpend } = await import(`${REPO_URL}/src/renderer/src/settings/format.ts`)
const page = await connect(port)
await assertScratchProfile()
const main = await mainInspector(inspectPort)
const Q = await installQuestions(main, { fallback: 'no' })
const H = h4(page, { userData, mockUrl })
const ev = (expression) => page.evaluate(expression)
const KEY_O = 'sk-proj-' + randomBytes(24).toString('hex')
const KEY_A = 'sk-ant-api03-' + randomBytes(24).toString('hex')
const WORD = `quillwort${randomBytes(4).toString('hex')}` // a word found nowhere else, to look for on the disk
const DESC = `Two herons by a ${WORD} pond`
const BACKUP = join(runRoot, 'before-encrypting.jsonl')
/** The files Chromium holds shut while the app runs: its LOCK files (empty) and its cookie store. */
const CHROMIUM_SHUT = /^(?:.*[\\/])?LOCK$|^Network[\\/]Cookies(?:-journal)?$/
const clickOn = async (expr) => {
  const ok = await ev(`(() => { const el = ${expr}; if (!el) return false; el.scrollIntoView({ block: 'center' }); el.setAttribute('data-click', '1'); return true })()`)
  if (!ok) throw new Error(`nothing to click: ${expr}`)
  await sleep(80)
  await page.click('[data-click="1"]')
  await ev(`document.querySelector('[data-click="1"]')?.removeAttribute('data-click')`)
}
const button = (scope, text) => `[...document.querySelectorAll(${JSON.stringify(scope + ' button')})].find((b) => b.textContent.trim() === ${JSON.stringify(text)})`
const choose = (label, value) => ev(`(() => { const s = document.querySelector('dialog.make-image select[aria-label=${JSON.stringify(label)}]'); s.focus(); s.value = ${JSON.stringify(String(value))}; s.dispatchEvent(new Event('change', { bubbles: true })); return s.value })()`)
const cost = () => ev(`document.querySelector('dialog.make-image .make-image-cost')?.textContent ?? null`)
const waitCost = async (re, ms = 6000) => { const t0 = Date.now(); let last = null; while (Date.now() - t0 < ms) { last = await cost(); if (re.test(last ?? '')) return last; await sleep(80) } return last }

/** Every file under the profile, read (a file Chromium holds shut is counted, not skipped silently). */
function scan(needles) {
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
let ids = []
let dataUrls = []
let needles = null

try {
  await part('A', async () => {
    check('A: (setup) the two keys are saved', (await ev(`window.api.settings.setApiKey('anthropic', ${JSON.stringify(KEY_A)})`)).ok && (await ev(`window.api.settings.setApiKey('openai', ${JSON.stringify(KEY_O)})`)).ok)
    // switched on in Settings, as a person does (a yes in the box)
    await page.click('.header-button@Settings')
    await page.waitFor(`!!document.querySelector('dialog.settings')?.open`)
    await ev(`document.getElementById('settings-images-heading').scrollIntoView({ block: 'start' })`)
    await page.waitFor(`document.querySelector('.images-section [role=switch]')?.disabled === false`, { timeoutMs: 6000 })
    await Q.queue('yes')
    await clickOn(`document.querySelector('.images-section [role=switch]')`)
    await page.waitFor(`document.querySelector('.images-section [role=switch]')?.getAttribute('aria-checked') === 'true'`, { timeoutMs: 6000 })
    await page.press('Escape')
    await sleep(250)
    await page.waitFor(`!!${button('.chat-bar', 'Make an image...')}`, { timeoutMs: 6000 })
    await clickOn(button('.chat-bar', 'Make an image...'))
    await page.waitFor(`!!document.querySelector('dialog.make-image')?.open`)
    await ev(`document.getElementById('make-image-prompt').focus()`)
    await page.type(DESC)
    await choose('How many', 2)
    await waitCost(/0\.11/)
    await clickOn(button('dialog.make-image', 'Make'))
    await page.waitFor(`!document.querySelector('dialog.make-image')?.open`, { timeoutMs: 15000 })
    const saved = await H.waitFirst(DESC, (c) => c.version === 7)
    chatId = saved.conv.id
    ids = saved.conv.messages[0].picture.ids
    check('A: two pictures made by real clicks; the chat is saved as version 7 with their ids', ids.length === 2 && typeof chatId === 'string', show(saved.conv.messages[0].picture))
    dataUrls = []
    for (const id of ids) dataUrls.push((await ev(`window.api.images.picture(${JSON.stringify(id)})`)).dataUrl)
    const bytes = Buffer.from(dataUrls[0].split(',')[1], 'base64')
    const b64 = dataUrls[0].split(',')[1]
    needles = { bytes: bytes.subarray(Math.floor(bytes.length / 2), Math.floor(bytes.length / 2) + 48), base64: Buffer.from(b64.slice(Math.floor(b64.length / 2), Math.floor(b64.length / 2) + 64)), word: Buffer.from(WORD) }
    check('A: (setup) the picture read back is a PNG of some size', bytes.subarray(1, 4).toString() === 'PNG' && bytes.length > 1000, bytes.length)
  })

  await part('B', async () => {
    const sums = await ev(`window.api.usage.summary(${JSON.stringify(chatId)})`)
    const fromTokens = (sums.chat.tokens.input * 5 + sums.chat.tokens.output * 30) / 1e6
    check('B: main\'s ledger: this chat is one request, at the cost the answer\'s tokens say (words in at $5 a million, the pictures out at $30), not a guess, and today holds it', Math.abs(sums.chat.costUsd - fromTokens) < 1e-12 && sums.chat.tokens.output > 0 && sums.chat.requests === 1 && sums.chat.about === false && sums.today.costUsd >= sums.chat.costUsd - 1e-9, show(sums))
    check('B: (16.7) that cost is not above the most the dialog showed and the limits reserved (two standard squares, the rounding, the description\'s bytes)', sums.chat.costUsd <= 2 * (0.053 + 0.0005) + Buffer.byteLength(DESC) * 5e-6 + 1e-12, show([sums.chat.costUsd]))
    await page.click('.header-button@Settings')
    await page.waitFor(`!!document.querySelector('dialog.settings')?.open`)
    await page.waitFor(`!!document.querySelector('table.settings-usage[aria-label="Usage so far"]')`, { timeoutMs: 6000 })
    const rows = await ev(`[...document.querySelectorAll('table.settings-usage[aria-label="Usage so far"] tr')].map((r) => ({ label: r.querySelector('th')?.textContent, cost: r.querySelector('.settings-usage-cost')?.textContent }))`)
    const chatRow = rows.find((r) => r.label === 'This chat')
    const today = rows.find((r) => /^Today/.test(r.label ?? ''))
    check('B: Settings > Usage shows this chat at that cost ("$0.11")', chatRow?.cost === formatSpend(sums.chat.costUsd, sums.chat.about) && /\$0\.11/.test(chatRow?.cost ?? ''), show(rows))
    check('B: ...and today at main\'s sum', today?.cost?.startsWith(formatSpend(sums.today.costUsd, sums.today.about)) === true, show(today))
    await page.press('Escape')
    await sleep(250)
  })

  await part('C', async () => {
    const s = scan(needles)
    const pictureFiles = ids.map((id) => `images/${id}`).sort()
    check(`C: plain: of ${s.files} files in the profile, only the two picture files under images/ hold the picture's bytes`, show([...s.found.bytes].sort()) === show(pictureFiles), show(s.found.bytes))
    check('C: no file holds the picture as base64 (no data: copy was written by the app or by Chromium)', s.found.base64.length === 0, show(s.found.base64))
    check('C: the description is only in images.json and the chat\'s file', s.found.word.length >= 2 && s.found.word.every((p) => p === 'images.json' || p === `conversations/${chatId}.json`), show(s.found.word))
    check('C: every file could be read but Chromium\'s own lock files and its cookie store, which the running app holds shut (the app sets no cookie)', s.shut.every((p) => CHROMIUM_SHUT.test(p)), show(s.shut))
  })

  await part('D', async () => {
    await main.inMain(`(() => { const { dialog } = process.mainModule.require('electron'); globalThis.__saves = []; dialog.showSaveDialog = async (...args) => { globalThis.__saves.push(args[args.length - 1]?.title ?? ''); return { canceled: false, filePath: ${JSON.stringify(BACKUP)} } }; return true })()`)
    const on = await ev(`window.api.history.encryptChats()`)
    check('D: encryption on: the chat was backed up first and encrypted; the report counts the two pictures', on.ok === true && on.report.backup?.count === 1 && on.report.changed === 1 && show(on.report.pictures) === '{"changed":2,"failed":0}', show(on))
    const backup = existsSync(BACKUP) ? readFileSync(BACKUP) : Buffer.alloc(0)
    check('D: the backup holds the chat and the pictures\' ids, and NOT the picture (no bytes, no base64, no data: address)', backup.indexOf(Buffer.from(WORD)) !== -1 && ids.every((id) => backup.includes(id)) && backup.indexOf(needles.bytes) === -1 && backup.indexOf(needles.base64) === -1 && !backup.includes('data:image'), backup.length)
    const s = scan(needles)
    check(`D: sealed: none of the ${s.files} files in the profile holds the picture's bytes, its base64 or the description`, s.found.bytes.length === 0 && s.found.base64.length === 0 && s.found.word.length === 0, show(s.found))
    check('D: every file could be read but those same Chromium files', s.shut.every((p) => CHROMIUM_SHUT.test(p)), show(s.shut))
    const list = await ev(`window.api.images.list()`)
    const again = []
    for (const id of ids) again.push((await ev(`window.api.images.picture(${JSON.stringify(id)})`)).dataUrl)
    check('D: the gallery still lists both with their description and small pictures, and each opens byte for byte as it was', list.problem === null && list.pictures.length === 2 && list.pictures.every((p) => p.prompt === DESC && typeof p.thumbnail === 'string') && again[0] === dataUrls[0] && again[1] === dataUrls[1], show(list.pictures.map((p) => p.prompt)))
  })

  await part('E', async () => {
    await Q.queue('yes')
    const off = await ev(`window.api.history.decryptChats()`)
    check('E: back to plain files (a yes in the box): the two pictures are rewritten plain', off.ok === true && show(off.report.pictures) === '{"changed":2,"failed":0}', show(off))
    const s = scan(needles)
    check('E: and they are again the only files that hold the picture', show([...s.found.bytes].sort()) === show(ids.map((id) => `images/${id}`).sort()) && s.found.base64.length === 0, show(s.found))
  })

  await part('F', async () => {
    check('F: the page logged no errors and no warnings', page.problems.length === 0, show(page.problems))
  })
} finally {
  const ok = check.summary()
  process.exit(ok ? 0 : 1)
}
