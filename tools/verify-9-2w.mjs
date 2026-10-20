// Slice 9.2 (D-037), in the real window: getting files in. The system's open dialog is replaced from the main process's inspector (it cannot be driven
// from the page): each ask is recorded and answered with the paths the suite chose, or with "the person closed it". What is checked: the Attach button;
// files chosen in the dialog become chips (name, what it is, what was done to it, a small picture or the first lines, where it goes); the copies in the
// app's data folder (named by their hash, no metadata, the originals untouched); taking one off deletes its copy; refusals, each with a sentence; the
// caps (ten on a message, ten at a time); a closed dialog; a paste (a made one, and a real one through the system clipboard); a drop (a made one, and
// one the browser takes for a drag from Windows); what the page cannot do through the bridge; the layout down to 280 px; no console errors.
// Needs: USER_DATA_DIR (scratch), FILES_DIR (made by run92.mjs), INSPECT_PORT.
import './ts-resolve.mjs'
import { connect, checker, sleep } from './cdp.mjs'
import { assertScratchProfile } from './profile-guard.mjs'
import { h4, mainInspector } from './lib4.mjs'
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const shots = process.argv[2]
const port = Number(process.argv[3] ?? 9222)
const userData = process.env.USER_DATA_DIR
const FILES = process.env.FILES_DIR
const inspectPort = Number(process.env.INSPECT_PORT)
if (!userData || !FILES || !inspectPort) throw new Error('USER_DATA_DIR, FILES_DIR and INSPECT_PORT must be set')
const check = checker()
const page = await connect(port)
await assertScratchProfile()
const H = h4(page, { userData, mockUrl: undefined })
const { ev } = H
const main = await mainInspector(inspectPort)
const ATT = join(userData, 'attachments')
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex')
const copies = () => (existsSync(ATT) ? readdirSync(ATT).sort() : [])
const F = (name) => join(FILES, name)
const show = (v) => JSON.stringify(v)?.slice(0, 300)

// The system's open dialog, played from here.
await main.inMain(`(() => {
  const { dialog } = process.mainModule.require('electron')
  globalThis.__att = { answers: [], calls: [] }
  dialog.showOpenDialog = async (...args) => {
    const a = globalThis.__att
    a.calls.push({ withWindow: args.length > 1, options: args[args.length - 1] })
    const next = a.answers.shift()
    return next === undefined || next === null ? { canceled: true, filePaths: [] } : { canceled: false, filePaths: next }
  }
  return true
})()`)
const answer = (paths) => main.inMain(`globalThis.__att.answers.push(${JSON.stringify(paths)}); true`)
const calls = async () => JSON.parse(await main.inMain('JSON.stringify(globalThis.__att.calls)'))

const chips = () => ev(`[...document.querySelectorAll('.attachment-chip')].map((c) => ({ name: c.querySelector('.attachment-name')?.textContent, facts: c.querySelector('.attachment-facts')?.textContent, notes: c.querySelector('.attachment-notes')?.textContent ?? null, thumb: c.querySelector('img.attachment-thumb')?.getAttribute('src')?.slice(0, 30) ?? null, icon: c.querySelector('.attachment-icon')?.textContent ?? null, title: c.getAttribute('title'), remove: c.querySelector('.attachment-remove')?.getAttribute('aria-label') }))`)
const notices = () => ev(`(() => { const n = document.querySelector('.attachment-notices'); return n ? { role: n.getAttribute('role'), lines: [...n.querySelectorAll('p')].map((p) => p.textContent) } : null })()`)
// What a person sees: a line that is there but not shown reads as nothing (innerText alone gives the text of an element that is not drawn).
const destination = () => ev(`(() => { const p = document.querySelector('.attachment-destination'); return p && p.checkVisibility() ? p.innerText : null })()`)
const attachButton = () => H.chatButton('Attach...')
const waitChips = (n) => page.waitFor(`document.querySelectorAll('.attachment-chip').length === ${n}`, { timeoutMs: 20000, label: `${n} chips` })
const waitIdle = () => page.waitFor(`(() => { const b = [...document.querySelectorAll('.chat-bar .chat-button')].find((x) => x.textContent === 'Attach...'); return b && b.title !== 'Files are being attached.' })()`, { timeoutMs: 20000, label: 'attaching finished' })
const clickAttach = async () => { await H.clickChat('Attach...'); await sleep(150); await waitIdle() }
const removeChip = async (name) => {
  await ev(`[...document.querySelectorAll('.attachment-remove')].find((b) => b.getAttribute('aria-label') === ${JSON.stringify(`Remove ${name}`)})?.setAttribute('data-click', '1')`)
  await page.click('[data-click="1"]')
  await ev(`document.querySelector('[data-click="1"]')?.removeAttribute('data-click')`)
  await sleep(300)
}
const sendButton = () => ev(`(() => { const b = document.querySelector('.composer-button[type=submit]'); return b ? { disabled: b.disabled, title: b.title } : null })()`)
const b64 = (path) => readFileSync(path).toString('base64')
/** A File made in the page from bytes the suite hands it, for a made paste or drop. */
const fileExpr = (path, name, type) => `new File([Uint8Array.from(atob(${JSON.stringify(b64(path))}), (c) => c.charCodeAt(0))], ${JSON.stringify(name)}, { type: ${JSON.stringify(type)} })`

let clipboardSaved = false
try {
  await page.waitFor(`!!document.querySelector('.chat-bar')`, { timeoutMs: 20000, label: 'the app' })
  await sleep(400)
  const originals = Object.fromEntries(['holiday.jpg', 'diagram.png', 'report.pdf', 'notes.md'].map((n) => [n, sha(readFileSync(F(n)))]))

  // ============ 1. the button ============
  // (D-051) the chat bar is in the message box; New chat, History and Tools moved to the sidebar, so the bar's own buttons are read here
  const bar = await ev(`[...document.querySelectorAll('.chat-bar .chat-button')].map((b) => ({ text: b.textContent, disabled: b.disabled, title: b.title }))`)
  check('the chat bar starts with "Attach...", enabled, and its tooltip says the files are chosen in a Windows dialog and sent to the model', bar[0]?.text === 'Attach...' && !bar[0].disabled && /Windows dialog/.test(bar[0].title) && /sends it to the model/.test(bar[0].title), show(bar))
  check('no chips, no notices and no attachments folder before anything is attached', (await chips()).length === 0 && (await notices()) === null && copies().length === 0)

  // ============ 2. three files from the dialog ============
  await answer([F('holiday.jpg'), F('report.pdf'), F('notes.md')])
  await clickAttach()
  await waitChips(3)
  const c3 = await chips()
  const c1 = await calls()
  check('the open dialog was asked once, for the window (modal), titled "Attach files", for several files, with the one filter "All files"', c1.length === 1 && c1[0].withWindow && c1[0].options.title === 'Attach files' && c1[0].options.properties.includes('multiSelections') && c1[0].options.properties.includes('openFile') && JSON.stringify(c1[0].options.filters) === JSON.stringify([{ name: 'All files', extensions: ['*'] }]), show(c1))
  const photo = c3.find((c) => c.name === 'holiday.jpg')
  check('the photo\'s chip: its name, "JPEG image, 32 x 64" (turned upright: it was held sideways), its notes ("metadata removed; turned upright"), a small picture made by main (a PNG data URL)', photo && /^JPEG image, 32 x 64, /.test(photo.facts) && photo.notes === 'metadata removed; turned upright' && photo.thumb === 'data:image/png;base64,iVBORw0K', show(photo))
  const pdf = c3.find((c) => c.name === 'report.pdf')
  check('the PDF\'s chip: "PDF, 3 pages", the note that it goes as it is with its metadata, an icon instead of a picture', pdf && /^PDF, 3 pages, /.test(pdf.facts) && /sent as it is, with any metadata it holds/.test(pdf.notes) && pdf.icon === 'PDF' && pdf.thumb === null, show(pdf))
  const md = c3.find((c) => c.name === 'notes.md')
  check('the text\'s chip: "Text, 9 lines", and its tooltip holds its first five lines (a title, a blank line, three more) and not the sixth', md && /^Text, 9 lines, /.test(md.facts) && md.title.includes('First line of my notes') && md.title.includes('Third line') && !md.title.includes('Fourth line') && md.icon === 'TXT', show(md))
  check('each chip has a button that says which file it takes off', c3.every((c) => c.remove === `Remove ${c.name}`))
  check('under the chips: where they go ("These files go to Anthropic with this message, and again with each later message of this chat.")', (await destination()) === 'These files go to Anthropic with this message, and again with each later message of this chat.', await destination())
  const area = await ev(`document.querySelector('.attachments').innerText`)
  check('nothing on screen names the folder the files came from (the page never learns a path)', !area.includes(FILES) && !area.includes('s92-files') && !(await ev(`document.body.innerText`)).includes('s92-files'))
  const kept = copies()
  check('main kept three copies in the profile\'s attachments folder, each named by the SHA-256 of what it holds', kept.length === 3 && kept.every((n) => /^[0-9a-f]{64}$/.test(n) && sha(readFileSync(join(ATT, n))) === n), show(kept))
  const photoCopy = kept.map((n) => readFileSync(join(ATT, n))).find((b) => b[0] === 0xff && b[1] === 0xd8)
  check('the photo\'s copy has no EXIF, no place and no comment in it', photoCopy && !photoCopy.includes(Buffer.from('GPS-HOME')) && !photoCopy.includes(Buffer.from('Exif')) && !photoCopy.includes(Buffer.from('SECRET-CAMERA')))
  check('the original files were only read: byte for byte what they were', Object.entries(originals).every(([n, h]) => sha(readFileSync(F(n))) === h))
  const s1 = await sendButton()
  await page.click('.composer-input')
  await page.type('Here are my files')
  const s2 = await sendButton()
  check('with files on the message Send is on (since 9.3 they are sent), with or without words typed, and nothing says it is in the way', !s1.disabled && !s2.disabled && s2.title === '' && (await ev(`document.querySelector('.composer-blocked')`)) === null, show({ s1, s2 }))
  await page.screenshot(join(shots, 'v92-three-chips.png'))

  // ============ 3. taking one off ============
  const mdCopy = kept.find((n) => readFileSync(join(ATT, n)).toString('utf8').startsWith('# Notes'))
  await removeChip('notes.md')
  await waitChips(2)
  const after = copies()
  check('taking a file off removes its chip, and its copy is deleted (no saved chat uses it)', !(await chips()).some((c) => c.name === 'notes.md') && after.length === 2 && !after.includes(mdCopy), show(after))

  // ============ 4. refusals ============
  await answer([F('dancing.gif'), F('setup.exe'), F('huge.bin'), F('link-folder')])
  await clickAttach()
  await page.waitFor(`!!document.querySelector('.attachment-notices')`, { timeoutMs: 15000, label: 'the notices' })
  const n4 = await notices()
  check('four files refused, each in its own sentence that names it and says why, as an alert', n4.role === 'alert' && n4.lines.length === 4 && n4.lines[0] === 'dancing.gif was not attached: it is animated, and only still images can be sent.' && n4.lines[1] === 'setup.exe was not attached: it is not a PNG, JPEG, GIF or WebP image, a PDF, or a text file (UTF-8).' && n4.lines[2] === 'huge.bin was not attached: it is larger than 20 MB.' && n4.lines[3] === 'link-folder was not attached: it is a link to another file.', show(n4))
  check('...nothing was added: still two chips and two copies', (await chips()).length === 2 && copies().length === 2)

  // ============ 5. the caps: ten at a time, ten on a message ============
  const many = readdirSync(join(FILES, 'many')).sort().map((n) => join(FILES, 'many', n))
  await answer(many)
  await clickAttach()
  await waitChips(10)
  const n5 = await notices()
  check('twelve chosen with two on the message: main takes ten, the message eight, and both say what was left out', n5 && n5.lines.includes('At most 10 files can be attached at a time: 2 were left out.') && n5.lines.includes('A message can carry at most 10 files: 2 were left out.'), show(n5))
  const full = await attachButton()
  check('with ten on the message, Attach... is off and says why', full.disabled && full.title === 'A message can carry at most 10 files.', show(full))
  check('the two that did not fit on the message were let go of and their copies deleted: ten copies in the folder', copies().length === 10, `${copies().length} copies`)
  for (const name of (await chips()).map((c) => c.name).filter((n) => n.startsWith('note-'))) await removeChip(name)
  await waitChips(2)
  check('taking the eight notes off again leaves the photo and the PDF, and two copies', copies().length === 2 && !(await attachButton()).disabled)

  // ============ 6. the person closes the dialog ============
  await answer(null)
  await clickAttach()
  check('a closed dialog is not an error: no notice, nothing changed', (await notices()) === null && (await chips()).length === 2)

  // ============ 7. paste ============
  await ev(`(() => { const t = document.querySelector('.composer-input'); const dt = new DataTransfer(); dt.items.add(${fileExpr(F('diagram.png'), 'diagram.png', 'image/png')}); t.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); return true })()`)
  await waitChips(3)
  check('a pasted image (made in the page) becomes a chip ("PNG image, 48 x 24"), and nothing is typed', (await chips()).some((c) => c.name === 'diagram.png' && /^PNG image, 48 x 24/.test(c.facts)) && (await ev(`document.querySelector('.composer-input').value`)) === 'Here are my files')
  await ev(`(() => { const t = document.querySelector('.composer-input'); const dt = new DataTransfer(); dt.setData('text/plain', ' and text'); dt.items.add(${fileExpr(F('notes.md'), 'notes.md', 'text/markdown')}); const e = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }); t.dispatchEvent(e); window.__pasteDefault = e.defaultPrevented; return true })()`)
  await sleep(600)
  check('a paste that also carries text attaches nothing (the text is the person\'s paste)', (await chips()).length === 3 && (await ev('window.__pasteDefault')) === false)
  await removeChip('diagram.png')
  await waitChips(2)
  // a real paste: an image on the system clipboard, then the paste command
  await main.inMain(`(() => { const { clipboard } = process.mainModule.require('electron'); Promise.resolve(clipboard.readText()).then((t) => { globalThis.__clip = t }); return true })()`)
  await sleep(200)
  clipboardSaved = true
  // Electron 44's clipboard in main is the web's asynchronous one: write() takes ClipboardItems (writeImage is gone).
  await main.inMain(`(() => { const { clipboard, ClipboardItem } = process.mainModule.require('electron'); globalThis.__clipOk = null; clipboard.write([new ClipboardItem({ 'image/png': new Blob([Buffer.from(${JSON.stringify(b64(F('diagram.png')))}, 'base64')], { type: 'image/png' }) })]).then(() => { globalThis.__clipOk = true }, (e) => { globalThis.__clipOk = String(e) }); return true })()`)
  for (let i = 0; i < 40 && (await main.inMain('globalThis.__clipOk')) === null; i++) await sleep(50)
  check('(the image is on the system clipboard)', (await main.inMain('globalThis.__clipOk')) === true, String(await main.inMain('globalThis.__clipOk')))
  await page.click('.composer-input')
  await page.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', modifiers: 2, key: 'v', code: 'KeyV', windowsVirtualKeyCode: 86, nativeVirtualKeyCode: 86, commands: ['paste'] })
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', modifiers: 2, key: 'v', code: 'KeyV', windowsVirtualKeyCode: 86, nativeVirtualKeyCode: 86 })
  let realPaste = null
  try { await waitChips(3); realPaste = (await chips()).find((c) => !['holiday.jpg', 'report.pdf'].includes(c.name)) } catch { /* reported below */ }
  check('a REAL paste of an image from the system clipboard becomes a chip (a PNG, 48 x 24, named by the browser)', realPaste && /^PNG image, 48 x 24/.test(realPaste.facts), show(realPaste ?? (await notices())))
  if (realPaste) { await removeChip(realPaste.name); await waitChips(2) }

  // ============ 8. drop ============
  await ev(`(() => { const dt = new DataTransfer(); dt.items.add(${fileExpr(F('diagram.png'), 'dropped.png', 'image/png')}); const target = document.querySelector('main.chat'); const over = new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }); target.dispatchEvent(over); window.__overPrevented = over.defaultPrevented; target.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })); return true })()`)
  await waitChips(3)
  check('a dropped file (made in the page) becomes a chip, and the chat says it takes the drop (dragover is accepted)', (await chips()).some((c) => c.name === 'dropped.png') && (await ev('window.__overPrevented')) === true)
  await removeChip('dropped.png')
  await waitChips(2)
  const box = await ev(`(() => { const r = document.querySelector('.message-list, main.chat').getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + Math.min(120, r.height / 2)) } })()`)
  const drag = { items: [], files: [F('diagram.png')], dragOperationsMask: 1 }
  let realDrop = null
  try {
    for (const type of ['dragEnter', 'dragOver', 'drop']) await page.send('Input.dispatchDragEvent', { type, x: box.x, y: box.y, data: drag })
    await waitChips(3)
    realDrop = (await chips()).find((c) => c.name === 'diagram.png')
  } catch (error) { realDrop = { error: String(error.message).slice(0, 200) } }
  check('a drop the browser takes for a drag of a file from Windows (DevTools\' drag of a real path) becomes a chip, read as bytes', realDrop && realDrop.name === 'diagram.png' && /^PNG image, 48 x 24/.test(realDrop.facts), show(realDrop))
  if (realDrop?.name) { await removeChip('diagram.png'); await waitChips(2) }
  check('the window did not navigate away while files were dropped on it', (await ev('location.href')).startsWith('http') || (await ev('location.href')).startsWith('file'), await ev('location.href'))

  // ============ 9. what the page cannot do through the bridge ============
  const pngB64 = b64(F('diagram.png'))
  const bridge = await ev(`(async () => {
    const a = window.api.attachments
    const png = Uint8Array.from(atob(${JSON.stringify(pngB64)}), (c) => c.charCodeAt(0))
    const out = {}
    out.numberName = await a.addBytes(123, png)
    out.pathAsBytes = await a.addBytes('win.ini', 'C:\\\\Windows\\\\win.ini')
    out.arrayBytes = await a.addBytes('x.png', [137, 80, 78, 71])
    out.objectBytes = await a.addBytes('x.png', { 0: 137 })
    out.longName = await a.addBytes('n'.repeat(1001), png)
    out.tooBig = await a.addBytes('big.bin', new Uint8Array(21 * 1024 * 1024))
    out.pathName = await a.addBytes('C:\\\\Users\\\\someone\\\\..\\\\evil.png', png)
    out.extraArgs = await a.pick.call(null, 'C:\\\\Windows\\\\win.ini').catch((e) => ({ threw: String(e) }))
    return JSON.parse(JSON.stringify(out))
  })()`)
  const beforeJunk = copies().join()
  await ev(`(() => { const a = window.api.attachments; a.discard('../../conversations'); a.discard(42); a.discard({ id: 'x' }); a.discard('${'f'.repeat(64)}'); return true })()`)
  await sleep(400)
  check('the bridge refuses a name that is not text, bytes that are a path, a list or an object, and a name over 1,000 characters ("not understood")', ['numberName', 'pathAsBytes', 'arrayBytes', 'objectBytes', 'longName'].every((k) => bridge[k].ok === false && bridge[k].error === 'The file was not understood.'), show(bridge))
  check('...and bytes over 20 MB before anything is copied ("larger than 20 MB")', bridge.tooBig.ok === false && /larger than 20 MB/.test(bridge.tooBig.error), show(bridge.tooBig))
  check('a name with a folder in it is only a label: the file is kept under its hash, shown as "evil.png", and nothing is written anywhere else', bridge.pathName.ok === true && bridge.pathName.file.info.name === 'evil.png' && existsSync(join(ATT, bridge.pathName.file.info.id)), show(bridge.pathName))
  check('pick() given a path ignores it: the dialog is asked (and closed here), nothing is read from the path', bridge.extraArgs.ok === false && bridge.extraArgs.cancelled === true, show(bridge.extraArgs))
  check('discard with junk (a path, a number, an object, an id that is not kept) deletes nothing', copies().join() === beforeJunk, `${beforeJunk} -> ${copies().join()}`)

  // ============ 10. the layout ============
  for (const [width, height] of [[320, 634], [280, 634]]) {
    await page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })
    await sleep(300)
    const lay = await ev(`(() => { const root = document.documentElement; const chips = [...document.querySelectorAll('.attachment-chip')].map((c) => c.getBoundingClientRect()); const bar = document.querySelector('.chat-bar').getBoundingClientRect(); return { scrollX: root.scrollWidth > root.clientWidth + 1, chipsInside: chips.every((r) => r.left >= 0 && r.right <= ${width} + 0.5), chipsWide: chips.every((r) => r.width >= 150), barInside: bar.right <= ${width} + 0.5, buttonsOneLine: [...document.querySelectorAll('.chat-bar .chat-button')].every((b) => b.getBoundingClientRect().height <= 34) } })()`)
    check(`at ${width} px: no sideways scroll, the chips (each at least 150 px wide: they wrap, not squeeze) and the chat bar inside the window, every chat button on one line`, !lay.scrollX && lay.chipsInside && lay.chipsWide && lay.barInside && lay.buttonsOneLine, show(lay))
    await page.screenshot(join(shots, `v92-${width}.png`))
  }
  await page.send('Emulation.clearDeviceMetricsOverride')
  await sleep(200)
  const problems = page.problems.filter((p) => !/Autofill|Electron Security Warning|DevTools/.test(p))
  check('no console errors, warnings or CSP violations in the page (the small pictures are data: URLs, which the page allows)', problems.length === 0, show(problems))
} catch (error) {
  check(`the suite stopped before its end: ${String(error?.stack ?? error).slice(0, 400)}`, false)
} finally {
  if (clipboardSaved) await main.inMain(`(() => { const { clipboard } = process.mainModule.require('electron'); clipboard.writeText(globalThis.__clip ?? ''); return true })()`).catch(() => undefined)
}

main.close()
page.close()
process.exit(check.summary() ? 0 : 1)
