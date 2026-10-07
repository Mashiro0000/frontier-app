// Slice 9.3 (D-037), launch 2 of run93.mjs: the same profile after a restart. Before it, run93.mjs put two copies in the attachments folder that no chat
// uses, one written two hours ago and one just now, and made the diagram's copy (which a saved chat uses) two hours old too. What is checked: at start
// the old unused copy is deleted, the new one is kept (it may belong to a message being written in another window... or a moment ago), and the one a chat
// uses is kept however old it is; the chat opened from History shows its file's picture, made by main from its copy; a message in it sends the file.
// Needs USER_DATA_DIR (the profile of launch 1), FILES_DIR, INSPECT_PORT, MOCK_PORT, ORPHAN_OLD, ORPHAN_NEW.
import { start } from './lib8b3w.mjs'
import { createHash } from 'node:crypto'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const W = await start()
const { page, H, ev, check, main, sleep, userData } = W
const mockUrl = `http://127.0.0.1:${process.env.MOCK_PORT}`
const ATT = join(userData, 'attachments')
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex')
const copies = () => (existsSync(ATT) ? readdirSync(ATT).sort() : [])
const show = (v) => JSON.stringify(v)?.slice(0, 300)
const { pngId } = W.loadState('w93.json')
const orphanOld = process.env.ORPHAN_OLD
const orphanNew = process.env.ORPHAN_NEW
const reqs = async () => (await fetch(`${mockUrl}/__requests`)).json()

try {
  await page.waitFor(`!!document.querySelector('.chat-bar')`, { timeoutMs: 20000, label: 'the app' })
  // the sweep runs in the background once main has read the chats
  for (let i = 0; i < 50 && copies().includes(orphanOld); i++) await sleep(100)
  const now = copies()
  check('at start the copy no chat uses and older than an hour is deleted', !now.includes(orphanOld), show(now))
  check('...the one no chat uses that is younger than an hour is kept', now.includes(orphanNew), show(now))
  check('...and the diagram\'s copy, two hours old but used by a saved chat, is kept', now.includes(pngId), show(now))

  await H.openHistory()
  await H.clickRow('diagram.png')
  await page.waitFor(`!document.querySelector('dialog.history')?.open`, { timeoutMs: 8000 })
  await page.waitFor(`!!document.querySelector('.message-file img.attachment-thumb')`, { timeoutMs: 10000, label: 'the picture of the file' })
  check('after the restart the chat opened from History shows the diagram\'s picture (main made it from its copy)', (await ev(`document.querySelector('.message-file img.attachment-thumb').getAttribute('src').slice(0, 22)`)) === 'data:image/png;base64,')
  const before = (await reqs()).length
  await ev(`(() => { const t = document.querySelector('.composer-input'); t.focus(); t.select() })()`)
  await page.type('[[mock:files]] after a restart')
  await page.press('Enter')
  const t0 = Date.now()
  while (Date.now() - t0 < 10000 && (await reqs()).length === before) await sleep(60)
  await H.waitReady(20000)
  const r = (await reqs()).at(-1)
  const img = r?.body?.messages?.[0]?.content?.[0]
  check('a message in it sends the diagram again, the bytes its name says', (await reqs()).length === before + 1 && r.problems.length === 0 && img?.type === 'image' && sha(Buffer.from(img.source.data, 'base64')) === pngId, show(r?.problems))
  const problems = page.problems.filter((p) => !/Autofill|Electron Security Warning|DevTools/.test(p))
  check('no console errors, warnings or CSP violations in the page', problems.length === 0, show(problems))
} catch (error) {
  check(`the suite stopped before its end: ${String(error?.stack ?? error).slice(0, 500)}`, false)
}

main.close()
page.close()
process.exit(check.summary() ? 0 : 1)
