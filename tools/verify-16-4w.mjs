// Slice 16.4 (D-048) in the real window, against the fake image endpoint of the mock, with the system's message box and save dialog stood in for from the main inspector.
// What it shows, on the real window and the real path (the bridge, the switch, the key, the limits, the ledger, the store):
//   A. the bridge: exactly eleven images functions and no other new door; off at first; a request while off sends nothing;
//   B. "Make images" is switched on only through the system's box, for this window;
//   C. a request: ONE request reaches the endpoint, the pictures come back as data: and show, the files and the index are on the disk, the ledger has the record;
//   D. above $0.50 the box asks first; a no sends nothing;
//   E. "Save a copy..." through the system's save dialog (a plain file where the person chose); "Use in chat" (an attachment); deleting asks;
//   F. Stop; what the page sends that is not understood; the console stays clean.
// Needs: USER_DATA_DIR (scratch), INSPECT_PORT, MOCK_PORT, and FRONTIER_GUARD_ROOT (the run's own folder, where the saved copy goes).
import './temp-on-a.mjs'
import './ts-resolve.mjs'
import { connect, checker, sleep } from './cdp.mjs'
import { assertScratchProfile } from './profile-guard.mjs'
import { mainInspector } from './lib4.mjs'
import { installQuestions } from './lib10.mjs'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { solidPng } from './mock-images.mjs'

const port = Number(process.argv[3] ?? 9222)
const userData = process.env.USER_DATA_DIR
const inspectPort = Number(process.env.INSPECT_PORT)
const mockUrl = `http://127.0.0.1:${process.env.MOCK_PORT}`
const runRoot = process.env.FRONTIER_GUARD_ROOT
if (!userData || !inspectPort || !process.env.MOCK_PORT || !runRoot) throw new Error('USER_DATA_DIR, INSPECT_PORT, MOCK_PORT and FRONTIER_GUARD_ROOT must be set')
const check = checker()
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(',')) : null
const STOP_AFTER = process.env.STOP_AFTER ?? null
let stopped = false
const part = async (name, fn) => { if (stopped || (ONLY && !ONLY.has(name))) return; try { await fn() } catch (error) { check(`${name} did not run to its end: ${String(error?.stack ?? error).slice(0, 500)}`, false) } if (STOP_AFTER === name) stopped = true }
const show = (v) => JSON.stringify(v)?.slice(0, 600)
const page = await connect(port)
await assertScratchProfile()
const main = await mainInspector(inspectPort)
const Q = await installQuestions(main, { fallback: 'no' })
const ev = (expression) => page.evaluate(expression)
const KEY = 'sk-proj-' + randomBytes(24).toString('hex')
const mockRequests = async () => (await (await fetch(`${mockUrl}/__requests`)).json()).filter((r) => r.images)
const control = (body) => fetch(`${mockUrl}/__images`, { method: 'POST', body: JSON.stringify(body) })
const ledgerLines = () => { const f = join(userData, 'usage', 'ledger.jsonl'); return existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [] }
const pictureFiles = () => (existsSync(join(userData, 'images')) ? readdirSync(join(userData, 'images')) : [])
const ASK = { prompt: 'A lighthouse at dusk, in watercolour', model: 'gpt-image-2', shape: 'square', quality: 'medium', count: 1, chat: null }
/** Puts an <img> with `src` in the page; answers its natural size, or that it did not load. */
const shows = (src) => ev(`new Promise((resolve) => { const img = document.createElement('img'); img.onload = () => { resolve({ ok: true, w: img.naturalWidth, h: img.naturalHeight }); img.remove() }; img.onerror = () => { resolve({ ok: false }); img.remove() }; img.style.position = 'fixed'; img.style.left = '-99999px'; img.src = ${JSON.stringify(src)}; document.body.appendChild(img); setTimeout(() => resolve({ ok: false, timeout: true }), 10000) })`)

try {
  // ============ A. the bridge ============
  await part('A', async () => {
    const keys = await ev(`Object.keys(window.api.images).sort().join()`)
    check('A: the bridge has exactly the eleven images functions', keys === 'estimate,generate,list,picture,remove,reset,saveCopy,setOn,status,stop,useInChat', keys)
    const groups = await ev(`Object.keys(window.api).sort().join()`)
    check('A: one new group, images, and nothing that takes a path, a size, a key or an address', groups === 'attachments,audit,changes,chat,connectors,experts,history,images,instructions,library,memory,programs,projects,settings,tools,updates,usage,voice,workspace', groups)
    check('A: the page has no ipcRenderer of its own', await ev(`typeof window.require === 'undefined' && typeof window.ipcRenderer === 'undefined'`))
    const status = await ev(`window.api.images.status()`)
    check('A: off at first; the three models; gpt-image-2 the default; an empty gallery; with no OpenAI key yet, the key is what it says first (16.6)', status.on === false && status.models.length === 3 && status.defaultModelId === 'gpt-image-2' && status.pictures === 0 && status.blocked === 'Making images needs an OpenAI key. Save one in Settings.', show(status))
    const out = await ev(`window.api.images.generate(${JSON.stringify(ASK)})`)
    check('A: a request while it is off is refused and nothing is sent', out.ok === false && out.kind === 'refused' && (await mockRequests()).length === 0 && ledgerLines().length === 0, show(out))
  })

  // ============ B. switching on ============
  await part('B', async () => {
    await fetch(`${mockUrl}/__expect-key`, { method: 'POST', body: JSON.stringify({ key: KEY, provider: 'openai' }) })
    const refused = await ev(`window.api.images.setOn(true)`)
    check('B: without an OpenAI key switching on is refused before any question', refused.ok === false && /OpenAI key/.test(refused.error) && (await Q.count()) === 0, show(refused))
    const saved = await ev(`window.api.settings.setApiKey('openai', ${JSON.stringify(KEY)})`)
    check('B: (setup) an OpenAI key is saved through the bridge', saved.ok === true, show(saved))
    await Q.queue('no')
    const no = await ev(`window.api.images.setOn(true)`)
    check('B: a no in the system\'s box leaves it off and writes nothing', no.ok === false && (await ev(`window.api.images.status()`)).on === false && !existsSync(join(userData, 'image-settings.json')), show(no))
    await sleep(3300)
    await Q.queue('yes')
    const yes = await ev(`window.api.images.setOn(true)`)
    const asked = await Q.asked()
    const q = asked.at(-1)?.options ?? {}
    const words = [q.title, q.message, q.detail].join('\n')
    check('B: a yes switches it on', yes.ok === true && yes.status.on === true && yes.status.blocked === null, show(yes))
    check('B: asked for this window, in the system\'s box, "Turn on" / "Don\'t turn on"', asked.at(-1)?.withWindow === true && q.buttons?.[0] === 'Turn on' && /Don't turn on/.test(String(q.buttons?.[1])), show([asked.at(-1)?.withWindow, q.buttons]))
    check('B: and the words say OpenAI, even with Claude, the cost, the policy, what is kept', /OpenAI/.test(words) && /even when you chat with Claude/.test(words) && /\$0\.005 to \$0\.21/.test(words) && /content policy/.test(words) && /keeps your pictures/.test(words), words.slice(0, 200))
    check('B: image-settings.json says on, and nothing else', readFileSync(join(userData, 'image-settings.json'), 'utf8') === '{"version":1,"on":true}')
  })

  // ============ C. a request ============
  await part('C', async () => {
    await control({})
    const est = await ev(`window.api.images.estimate({ model: 'gpt-image-2', shape: 'square', quality: 'medium', count: 1, promptBytes: 0 })`)
    check('C: the estimate: at most $0.0535 (the table and its rounding, 16.7), no question, nothing refused (no limits in this profile)', est.ok && Math.abs(est.maxUsd - 0.0535) < 1e-12 && !est.asks && est.refusal === null && est.leftTodayUsd === null, show(est))
    const out = await ev(`window.api.images.generate(${JSON.stringify(ASK)})`)
    const seen = await mockRequests()
    check('C: ONE request reached the endpoint: the six fields, the description as typed, the saved OpenAI key, nothing refused', seen.length === 1 && seen[0].fields.join() === 'model,n,output_format,prompt,quality,size' && seen[0].body.prompt === ASK.prompt && seen[0].headers.authorization === `Bearer ${KEY}` && seen[0].problems.length === 0 && seen[0].retryCount === 0, show(seen[0]?.body))
    check('C: the page is told: one picture, its cost, not a guess', out.ok === true && out.pictures.length === 1 && out.estimate === false && out.costUsd > 0.05 && out.costUsd < 0.06, show(out.ok ? { cost: out.costUsd, n: out.pictures.length } : out))
    const p = out.pictures[0]
    const small = await shows(p.thumbnail)
    check('C: the small picture, made in main by Electron\'s own tools, shows as data: (256 px)', /^data:image\/png;base64,/.test(p.thumbnail) && small.ok && small.w === 256 && small.h === 256, show(small))
    const big = await ev(`window.api.images.picture(${JSON.stringify(p.id)})`)
    const large = await shows(big.dataUrl)
    check('C: the picture large shows at its own size, from the very bytes', big.ok && large.ok && large.w === 1024 && big.dataUrl === `data:image/png;base64,${solidPng(1024, 1024, [40, 120, 200]).toString('base64')}`, show(large))
    check('C: on the disk: images/<the random id>, the bytes that came', show(pictureFiles()) === show([p.id]) && readFileSync(join(userData, 'images', p.id)).equals(solidPng(1024, 1024, [40, 120, 200])))
    const index = JSON.parse(readFileSync(join(userData, 'images.json'), 'utf8'))
    check('C: images.json names it, with the description and the model, and no key', index.version === 1 && index.pictures.length === 1 && index.pictures[0].id === p.id && index.pictures[0].prompt === ASK.prompt && !JSON.stringify(index).includes(KEY))
    const lines = ledgerLines()
    check('C: the ledger: sent (the most) then done (the cost from the tokens), OpenAI, gpt-image-2, an image fee', lines.length === 2 && lines[0].state === 'sent' && Math.abs(lines[0].image.usd - (0.0535 + Buffer.byteLength(ASK.prompt, 'utf8') * 5e-6)) < 1e-12 && lines[1].image.usd <= lines[0].image.usd && lines[1].state === 'done' && lines[1].provider === 'openai' && lines[1].model === 'gpt-image-2' && lines[1].image.kind === 'generate', show(lines.map((l) => [l.state, l.image])))
    const summary = await ev(`window.api.usage.summary(null)`)
    check('C: the sums of Settings include it', summary.today.requests === 1 && Math.abs(summary.today.costUsd - out.costUsd) < 1e-9, show(summary.today))
    const list = await ev(`window.api.images.list()`)
    check('C: the gallery lists it', list.problem === null && list.pictures.length === 1 && list.pictures[0].id === p.id)
  })

  // ============ D. the box above $0.50 ============
  await part('D', async () => {
    const before = (await mockRequests()).length
    await sleep(3300)
    await Q.queue('no')
    const big = { ...ASK, model: 'gpt-image-2.5-flare', quality: 'high', count: 2 }
    const no = await ev(`window.api.images.generate(${JSON.stringify(big)})`)
    const q = (await Q.asked()).at(-1)
    check('D: above $0.50 the box asks first, for this window, with the most and the description', q.withWindow === true && /Spend up to about \$0\.85 on 2 pictures\?/.test(q.options.message) && /lighthouse at dusk/.test(q.options.detail) && q.options.buttons?.[0] === 'Make them', show(q.options.message))
    check('D: a no: nothing sent, nothing in the ledger', no.ok === false && no.kind === 'refused' && (await mockRequests()).length === before && ledgerLines().length === 2, show(no))
    await sleep(3300)
    await Q.queue('yes')
    const yes = await ev(`window.api.images.generate(${JSON.stringify(big)})`)
    check('D: a yes: two pictures made', yes.ok === true && yes.pictures.length === 2 && (await mockRequests()).length === before + 1, show(yes.ok ? yes.pictures.length : yes))
  })

  // ============ E. the gallery ============
  await part('E', async () => {
    const list = await ev(`window.api.images.list()`)
    const id = list.pictures.at(-1).id
    const folder = join(runRoot, 'saved-pictures')
    mkdirSync(folder, { recursive: true })
    const target = join(folder, 'my lighthouse.png')
    await main.inMain(`(() => { const { dialog } = process.mainModule.require('electron'); globalThis.__saves = []; globalThis.__saveTo = null; dialog.showSaveDialog = async (...args) => { globalThis.__saves.push({ withWindow: args.length > 1, options: args[args.length - 1] }); return globalThis.__saveTo === null ? { canceled: true, filePath: '' } : { canceled: false, filePath: globalThis.__saveTo } }; return true })()`)
    let s = await ev(`window.api.images.saveCopy(${JSON.stringify(id)})`)
    const saves = JSON.parse(await main.inMain('JSON.stringify(globalThis.__saves)'))
    check('E: "Save a copy..." opens the system\'s save dialog for this window: its title, a PNG filter, a plain name, asks before overwriting; closing it saves nothing', s.ok === false && s.cancelled === true && saves[0].withWindow === true && saves[0].options.title === 'Save a copy of the picture' && saves[0].options.filters[0].extensions.join() === 'png' && /picture-\d{4}-\d{2}-\d{2}-[0-9a-f]{8}\.png$/.test(saves[0].options.defaultPath) && saves[0].options.properties.includes('showOverwriteConfirmation'), show(saves[0]))
    await main.inMain(`globalThis.__saveTo = ${JSON.stringify(target)}; true`)
    s = await ev(`window.api.images.saveCopy(${JSON.stringify(id)})`)
    check('E: a place chosen: the plain picture is there, the very bytes', s.ok === true && readFileSync(target).equals(solidPng(1024, 1024, [40, 120, 200])), show(s))
    const used = await ev(`window.api.images.useInChat(${JSON.stringify(id)})`)
    check('E: "Use in chat" gives an attachment like a pasted file (an image, named by the id)', used.ok === true && /^picture-[0-9a-f]{8}\.png$/.test(used.file.info?.name ?? used.file.name ?? '') && (used.file.info?.mediaType ?? used.file.mediaType) === 'image/png', show(used))
    await sleep(3300)
    await Q.queue('no')
    let d = await ev(`window.api.images.remove(${JSON.stringify(id)})`)
    const q = (await Q.asked()).at(-1)
    check('E: deleting asks in the box, for this window; a no keeps it', d.ok === false && d.cancelled === true && q.withWindow === true && q.options.title === 'Delete a picture' && pictureFiles().includes(id), show(d))
    await sleep(3300)
    await Q.queue('yes')
    d = await ev(`window.api.images.remove(${JSON.stringify(id)})`)
    check('E: a yes deletes the app\'s copy and its line; the saved copy stays', d.ok === true && !pictureFiles().includes(id) && !readFileSync(join(userData, 'images.json'), 'utf8').includes(id) && existsSync(target), show(d))
    const gone = await ev(`window.api.images.picture(${JSON.stringify(id)})`)
    check('E: the deleted picture is no longer in the gallery', gone.ok === false && /no longer in the gallery/.test(gone.error))
  })

  // ============ F. Stop, odd input, the console ============
  await part('F', async () => {
    await control({ mode: 'hang' })
    const going = ev(`window.api.images.generate(${JSON.stringify(ASK)})`)
    await sleep(600)
    await ev(`window.api.images.stop()`)
    const out = await going
    check('F: Stop: "stopped", it may still be billed, the record says stopped', out.ok === false && out.kind === 'stopped' && /may still bill/.test(out.error) && ledgerLines().at(-1).state === 'stopped', show(out))
    await control({})
    const odd = await ev(`(async () => {
      const r = []
      r.push(await window.api.images.picture('../images.json'))
      r.push(await window.api.images.picture('A'.repeat(32)))
      r.push(await window.api.images.saveCopy('C:\\\\Windows\\\\win.ini'))
      r.push(await window.api.images.generate({ prompt: 'x', model: 'gpt-image-1', shape: 'square', quality: 'medium', count: 1, chat: null }))
      r.push(await window.api.images.estimate({ model: 'gpt-image-2', shape: 'square', quality: 'max', count: 1, promptBytes: 0 }))
      return r
    })()`)
    check('F: an id that is a path, a model not in the file, a quality not offered: each refused, nothing sent', odd.every((x) => x.ok === false) && (await mockRequests()).filter((r) => r.body.prompt === 'x').length === 0, show(odd))
    const sized = await ev(`window.api.images.generate({ prompt: 'sized by the page', model: 'gpt-image-2', shape: 'square', quality: 'low', count: 1, chat: null, size: '3840x2160', moderation: 'low' })`)
    const sizedReq = (await mockRequests()).find((r) => r.body.prompt === 'sized by the page')
    check('F: a size or a moderation level the page adds never reaches OpenAI (the bridge sends only the six fields): the picture is the size of its shape', sized.ok === true && sizedReq.body.size === '1024x1024' && !('moderation' in sizedReq.body) && sizedReq.fields.join() === 'model,n,output_format,prompt,quality,size', show(sizedReq?.body))
    const raw = await main.inMain(`(() => { const { ipcMain } = process.mainModule.require('electron'); return typeof ipcMain._invokeHandlers?.keys === 'function' ? [...ipcMain._invokeHandlers.keys()].filter((k) => k.startsWith('images:')).sort().join() : 'unknown' })()`)
    check('F: main handles exactly the eleven images channels', raw === 'unknown' || raw === 'images:estimate,images:generate,images:list,images:picture,images:remove,images:reset,images:save-copy,images:set-on,images:status,images:stop,images:use-in-chat', raw)
    check('F: the page logged no errors and no warnings in the whole run', page.problems.length === 0, show(page.problems))
  })
} finally {
  const ok = check.summary()
  process.exit(ok ? 0 : 1)
}
