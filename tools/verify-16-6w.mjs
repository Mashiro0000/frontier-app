// Slice 16.6 (D-048) in the real window, against the mock, with the system's message box and save dialog stood in for from the main inspector: the page of image generation.
// Every step is done as a person would (real clicks, real keys), and what the page shows is read back. What it shows:
//   A. Settings > Images: the switch (off, and it cannot be pressed without an OpenAI key, which it says), the price table, the ceiling note; no button in the chat bar yet;
//   B. the switch asks in the system's box; a no is said; a yes turns it on, and "Make an image..." appears under the message box;
//   C. the dialog: the description has the keyboard, Make waits for a description, the cost line is main's figure and follows every choice ("about" and the question above
//      $0.50 for the newer models), the Tab order; a picture made goes into the chat and the dialog closes;
//   D. above $0.50 the box asks; a no is said in the dialog and nothing is sent; a yes makes them;
//   E. the refusals in words: a block, a limit that the most would pass (Make cannot be pressed), Stop while waiting (Escape does not close it then);
//   F. the gallery: newest first, a picture large, Escape back to the grid with the keyboard on it, Save a copy, Use in chat, Delete (asks);
//   G. at 420 and 280 px nothing scrolls sideways; the page logged nothing.
// Needs: USER_DATA_DIR (scratch), INSPECT_PORT, MOCK_PORT, FRONTIER_GUARD_ROOT.
import './temp-on-a.mjs'
import './ts-resolve.mjs'
import { connect, checker, sleep } from './cdp.mjs'
import { assertScratchProfile } from './profile-guard.mjs'
import { mainInspector, h4 } from './lib4.mjs'
import { installQuestions } from './lib10.mjs'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

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
const page = await connect(port)
await assertScratchProfile()
const main = await mainInspector(inspectPort)
const Q = await installQuestions(main, { fallback: 'no' })
const H = h4(page, { userData, mockUrl })
const ev = (expression) => page.evaluate(expression)
const KEY_O = 'sk-proj-' + randomBytes(24).toString('hex')
const KEY_A = 'sk-ant-api03-' + randomBytes(24).toString('hex')
const control = (body) => fetch(`${mockUrl}/__images`, { method: 'POST', body: JSON.stringify(body) })
const imageRequests = async () => (await (await fetch(`${mockUrl}/__requests`)).json()).filter((r) => r.images)
/** Marks an element by an expression, scrolls it into view, and clicks it for real. */
const clickOn = async (expr) => {
  const ok = await ev(`(() => { const el = ${expr}; if (!el) return false; el.scrollIntoView({ block: 'center' }); el.setAttribute('data-click', '1'); return true })()`)
  if (!ok) throw new Error(`nothing to click: ${expr}`)
  await sleep(80)
  await page.click('[data-click="1"]')
  await ev(`document.querySelector('[data-click="1"]')?.removeAttribute('data-click')`)
}
const button = (scope, text) => `[...document.querySelectorAll(${JSON.stringify(scope + ' button')})].find((b) => b.textContent.trim() === ${JSON.stringify(text)})`
/** Chooses an option in a select of the open dialog by its label, the way a person's choice reaches React (a change event). */
const choose = (label, value) => ev(`(() => { const s = document.querySelector('dialog.make-image select[aria-label=${JSON.stringify(label)}]'); s.focus(); s.value = ${JSON.stringify(String(value))}; s.dispatchEvent(new Event('change', { bubbles: true })); return s.value })()`)
const cost = () => ev(`document.querySelector('dialog.make-image .make-image-cost')?.textContent ?? null`)
const waitCost = async (re, ms = 6000) => { const t0 = Date.now(); let last = null; while (Date.now() - t0 < ms) { last = await cost(); if (re.test(last ?? '')) return last; await sleep(80) } return last }
const makeButton = () => ev(`(() => { const b = ${button('dialog.make-image', 'Make')}; return b ? { disabled: b.disabled } : null })()`)
const openSettingsAt = async (headingId) => {
  await page.click('.header-button@Settings')
  await page.waitFor(`!!document.querySelector('dialog.settings')?.open`)
  await ev(`document.getElementById(${JSON.stringify(headingId)}).scrollIntoView({ block: 'start' })`)
  await sleep(250)
}
const closeSettings = async () => { await page.press('Escape'); await sleep(250) }
const imagesSection = () => ev(`(() => { const s = document.querySelector('.images-section'); if (!s) return null; const sw = s.querySelector('[role=switch]'); return { text: s.innerText, on: sw?.getAttribute('aria-checked'), disabled: sw?.disabled, table: [...s.querySelectorAll('tbody tr')].map((r) => r.innerText.replace(/\\s+/g, ' ')) } })()`)
const makeOpen = () => ev(`!!document.querySelector('dialog.make-image')?.open`)
const openMake = async () => {
  await clickOn(button('.chat-bar', 'Make an image...'))
  await page.waitFor(`!!document.querySelector('dialog.make-image')?.open`)
  await sleep(200)
}

try {
  // ============ A. Settings, before ============
  await part('A', async () => {
    check('A: (setup) an Anthropic key is saved; no OpenAI key yet', (await ev(`window.api.settings.setApiKey('anthropic', ${JSON.stringify(KEY_A)})`)).ok)
    check('A: no "Make an image..." in the chat bar while it is off', (await ev(`${button('.chat-bar', 'Make an image...')} === undefined`)) === true)
    await openSettingsAt('settings-images-heading')
    const s = await imagesSection()
    check('A: Settings has an Images section: the switch is off and cannot be pressed without an OpenAI key, and says so', s !== null && s.on === 'false' && s.disabled === true && /needs an OpenAI key/.test(s.text), show(s))
    check('A: it says the description goes to OpenAI even when chatting with Claude, and where the pictures are kept', /goes to OpenAI/.test(s.text) && /even when you chat with Claude/.test(s.text) && /kept on this computer/.test(s.text))
    check('A: the price table of GPT Image 2 (OpenAI\'s own): square $0.01 / $0.05 / $0.21, portrait and landscape $0.01 / $0.04 / $0.17 (whole cents as the limits are shown)', show(s.table) === show(['Square $0.0060 $0.05 $0.21', 'Portrait $0.0050 $0.04 $0.17', 'Landscape $0.0050 $0.04 $0.17']) || show(s.table) === show(['Square $0.01 $0.05 $0.21', 'Portrait $0.01 $0.04 $0.17', 'Landscape $0.01 $0.04 $0.17']), show(s.table))
    check('A: and the ceiling note for the 2.5 models', /GPT Image 2\.5 Flare and GPT Image 2\.5 Sunburst: OpenAI does not publish their prices/.test(s.text) && /"about"/.test(s.text))
    await closeSettings()
  })

  // ============ B. switching on ============
  await part('B', async () => {
    check('B: (setup) an OpenAI key is saved', (await ev(`window.api.settings.setApiKey('openai', ${JSON.stringify(KEY_O)})`)).ok)
    await openSettingsAt('settings-images-heading')
    await Q.queue('no')
    await clickOn(`document.querySelector('.images-section [role=switch]')`)
    await page.waitFor(`/still off/.test(document.querySelector('.images-section')?.innerText ?? '')`, { timeoutMs: 6000 })
    let s = await imagesSection()
    check('B: the switch asks in the system\'s box; a no is said, and it stays off', s.on === 'false' && /Making images is still off\./.test(s.text) && (await Q.count()) === 1, show(s.text.slice(0, 300)))
    await sleep(3300)
    await Q.queue('yes')
    await clickOn(`document.querySelector('.images-section [role=switch]')`)
    await page.waitFor(`document.querySelector('.images-section [role=switch]')?.getAttribute('aria-checked') === 'true'`, { timeoutMs: 6000 })
    s = await imagesSection()
    check('B: a yes turns it on, and the page says so', s.on === 'true' && /Making images is on\./.test(s.text), show(s.text.slice(0, 200)))
    await closeSettings()
    check('B: "Make an image..." is now under the message box', (await ev(`!!${button('.chat-bar', 'Make an image...')}`)) === true)
  })

  // ============ C. the dialog ============
  await part('C', async () => {
    await openMake()
    check('C: the dialog opens with the keyboard in the description', (await ev(`document.activeElement?.id`)) === 'make-image-prompt')
    const text = await ev(`document.querySelector('dialog.make-image').innerText`)
    check('C: it says the description goes to OpenAI even with Claude, and that the pictures are not sent to the model', /goes to OpenAI/.test(text) && /even when you chat with Claude/.test(text) && /not sent to the model you chat with/.test(text), text.slice(0, 200))
    check('C: Make waits for a description', (await makeButton()).disabled === true)
    check('C: the cost line is main\'s figure: "At most $0.05 for this." (no limit in this profile, so nothing about what is left)', /^At most \$0\.05 for this\.$/.test(await waitCost(/At most/)), await cost())
    await choose('Quality', 'high')
    check('C: High: at most $0.21', /At most \$0\.21 for this\./.test(await waitCost(/0\.21/)), await cost())
    await choose('How many', 4)
    check('C: four of them: at most $0.85 for these, and Windows will ask first', /At most \$0\.85 for these\..*Windows will ask you first/.test(await waitCost(/0\.85/)), await cost())
    await choose('Model', 'gpt-image-2.5-flare')
    const flare = await waitCost(/about/)
    check('C: Flare: "about" $1.69, the ceiling note, and the question', /At most about \$1\.69 for these/.test(flare) && /ask you first/.test(flare) && /does not publish this model's prices/.test(await ev(`document.querySelector('dialog.make-image').innerText`)), flare)
    const models = await ev(`[...document.querySelectorAll('dialog.make-image select[aria-label=Model] option')].map((o) => o.textContent)`)
    check('C: three models offered', show(models) === show(['GPT Image 2', 'GPT Image 2.5 Flare', 'GPT Image 2.5 Sunburst']), show(models))
    await choose('Model', 'gpt-image-2')
    await choose('How many', 1)
    await choose('Quality', 'medium')
    await waitCost(/0\.05/)
    // the Tab order, from the description
    await ev(`document.getElementById('make-image-prompt').focus()`)
    const order = []
    for (let i = 0; i < 7; i++) { await page.press('Tab'); order.push(await ev(`document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.textContent?.trim()`)) }
    check('C: Tab goes description, Shape, Quality, How many, Model, Gallery..., Cancel (Make is off until there is a description)', show(order.slice(0, 6)) === show(['Shape', 'Quality', 'How many', 'Model', 'Gallery...', 'Cancel']), show(order))
    await ev(`document.getElementById('make-image-prompt').focus()`)
    await page.type('A lighthouse at dusk, in watercolour')
    check('C: with a description, Make can be pressed', (await makeButton()).disabled === false)
    const before = (await imageRequests()).length
    await clickOn(button('dialog.make-image', 'Make'))
    await page.waitFor(`!document.querySelector('dialog.make-image')?.open`, { timeoutMs: 15000 })
    check('C: one request was sent and the dialog closed', (await imageRequests()).length === before + 1 && !(await makeOpen()))
    await page.waitFor(`[...document.querySelectorAll('.bubble-picture img.picture-image')].some((i) => i.complete && i.naturalWidth === 1024)`, { timeoutMs: 8000 })
    const shown = await ev(`document.querySelector('.bubble-picture').innerText`)
    check('C: the picture is in the chat, with the description and the cost', /You asked for a picture:/.test(shown) && /A lighthouse at dusk/.test(shown) && /GPT Image 2, square, standard: \$0\.05/.test(shown), shown)
    const saved = await H.waitFirst('A lighthouse at dusk', (c) => c.version === 7)
    check('C: the chat is saved as version 7 with the note', saved.conv.messages[0].picture?.ids.length === 1)
  })

  // ============ D. the box above $0.50 ============
  await part('D', async () => {
    await openMake()
    await page.type('Four views of a red bicycle')
    await choose('Quality', 'high')
    await choose('How many', 4)
    await waitCost(/ask you first/)
    const before = (await imageRequests()).length
    await sleep(3300)
    await Q.queue('no')
    await clickOn(button('dialog.make-image', 'Make'))
    await page.waitFor(`/Nothing was sent\\./.test(document.querySelector('dialog.make-image')?.innerText ?? '')`, { timeoutMs: 8000 })
    const q = (await Q.asked()).at(-1)
    check('D: the box asked "Spend up to $0.85 on 4 pictures?" with the description; a no is said in the dialog, which stays open; nothing was sent', /Spend up to \$0\.85 on 4 pictures\?/.test(q.options.message) && /red bicycle/.test(q.options.detail) && (await makeOpen()) && (await imageRequests()).length === before, show(q.options.message))
    await sleep(3300)
    await Q.queue('yes')
    await clickOn(button('dialog.make-image', 'Make'))
    await page.waitFor(`!document.querySelector('dialog.make-image')?.open`, { timeoutMs: 15000 })
    check('D: a yes makes the four pictures, and they are in the chat', (await imageRequests()).length === before + 1 && (await ev(`document.querySelectorAll('.bubble-picture').length`)) === 2)
  })

  // ============ E. refusals in words ============
  await part('E', async () => {
    await control({ mode: 'blocked' })
    await openMake()
    await page.type('Something the safety system will refuse')
    await waitCost(/At most/)
    await clickOn(button('dialog.make-image', 'Make'))
    await page.waitFor(`/safety system refused/.test(document.querySelector('dialog.make-image')?.innerText ?? '')`, { timeoutMs: 8000 })
    check('E: a block is said in the dialog, with its category, and the description is still there to change', /OpenAI's safety system refused this description \(violence\)/.test(await ev(`document.querySelector('dialog.make-image').innerText`)) && (await ev(`document.getElementById('make-image-prompt').value`)) === 'Something the safety system will refuse')
    // a limit the most would pass
    await control({})
    // a daily limit of what was spent today and 50 cents more, in whole cents (a lower limit asks nothing)
    const spent = (await ev(`window.api.usage.summary(null)`)).today.costUsd
    const daily = Math.ceil((spent + 0.5) * 100) / 100
    const lowered = await ev(`window.api.settings.setLimits({ daily: { kind: 'usd', usd: ${daily} }, monthly: { kind: 'none' } })`)
    await choose('Quality', 'high')
    await choose('How many', 3)
    const line = await waitCost(/daily limit/)
    check('E: a request whose most would pass today\'s limit: the dialog says so, with what is left ($0.50), and Make cannot be pressed', lowered.ok !== false && /\$0\.50 left today/.test(line ?? '') && /daily limit of \$/.test(line ?? '') && (await makeButton()).disabled === true, show([lowered, line]))
    await choose('How many', 1)
    await choose('Quality', 'medium')
    const fits = await waitCost(/^At most \$0\.05 for this\. \$0\.50 left today\.$/)
    check('E: a standard square fits under it: "At most $0.05 for this. $0.50 left today."', /^At most \$0\.05 for this\. \$0\.50 left today\.$/.test(fits ?? ''), fits)
    // Stop, and Escape while waiting
    await control({ mode: 'hang' })
    await clickOn(button('dialog.make-image', 'Make'))
    await page.waitFor(`/Making the picture/.test(document.querySelector('dialog.make-image')?.innerText ?? '')`, { timeoutMs: 6000 })
    await page.press('Escape')
    await sleep(400)
    check('E: while it waits the dialog says so; Escape does not close it (the request is on its way)', await makeOpen())
    await clickOn(button('dialog.make-image', 'Stop'))
    await page.waitFor(`/may still bill/.test(document.querySelector('dialog.make-image')?.innerText ?? '')`, { timeoutMs: 6000 })
    check('E: Stop: "Stopped. OpenAI may still bill the request."', /Stopped\. OpenAI may still bill the request\./.test(await ev(`document.querySelector('dialog.make-image').innerText`)))
    await control({})
    await Q.queue('yes')
    await ev(`window.api.settings.setLimits({ daily: { kind: 'none' }, monthly: { kind: 'none' } })`)
    await clickOn(button('dialog.make-image', 'Cancel'))
    await sleep(300)
    check('E: Cancel closes it', !(await makeOpen()))
  })

  // ============ F. the gallery ============
  await part('F', async () => {
    await openMake()
    await clickOn(button('dialog.make-image', 'Gallery...'))
    await page.waitFor(`document.querySelectorAll('dialog.gallery .gallery-open').length > 0`, { timeoutMs: 8000 })
    const items = await ev(`[...document.querySelectorAll('dialog.gallery .gallery-open')].map((b) => ({ title: b.title, img: b.querySelector('img')?.naturalWidth ?? 0 }))`)
    check('F: the gallery: five pictures, newest first, each a small picture (256 px)', items.length === 5 && /red bicycle/.test(items[0].title) && /lighthouse/.test(items[4].title) && items.every((i) => i.img === 256), show(items))
    check('F: the "Make an image" dialog gave way to it', !(await makeOpen()))
    await clickOn(`document.querySelectorAll('dialog.gallery .gallery-open')[4]`)
    await page.waitFor(`document.querySelector('dialog.gallery .gallery-large-image')?.naturalWidth === 1024`, { timeoutMs: 8000 })
    const large = await ev(`document.querySelector('dialog.gallery .gallery-large').innerText`)
    check('F: a picture large, with its description and facts and four buttons', /A lighthouse at dusk/.test(large) && /GPT Image 2, square, standard/.test(large) && /Use in chat/.test(large) && /Save a copy\.\.\./.test(large) && /Delete\.\.\./.test(large), large)
    await page.press('Escape')
    await sleep(300)
    check('F: Escape goes back to the grid (the dialog stays), with the keyboard on that picture', (await ev(`!!document.querySelector('dialog.gallery')?.open && !document.querySelector('dialog.gallery .gallery-large')`)) && /lighthouse/.test(await ev(`document.activeElement?.title ?? ''`)))
    // Save a copy
    const folder = join(runRoot, 'saved-16-6')
    mkdirSync(folder, { recursive: true })
    await main.inMain(`(() => { const { dialog } = process.mainModule.require('electron'); dialog.showSaveDialog = async () => ({ canceled: false, filePath: ${JSON.stringify(join(folder, 'lighthouse.png'))} }); return true })()`)
    await page.press('Enter')
    await page.waitFor(`document.querySelector('dialog.gallery .gallery-large-image')?.naturalWidth === 1024`, { timeoutMs: 8000 })
    await clickOn(button('dialog.gallery', 'Save a copy...'))
    await page.waitFor(`/A copy was saved\\./.test(document.querySelector('dialog.gallery')?.innerText ?? '')`, { timeoutMs: 6000 })
    check('F: Enter opens it again; Save a copy writes the plain picture where the dialog said', existsSync(join(folder, 'lighthouse.png')) && readFileSync(join(folder, 'lighthouse.png')).subarray(1, 4).toString() === 'PNG')
    // Delete (asks)
    await sleep(3300)
    await Q.queue('yes')
    await clickOn(button('dialog.gallery', 'Delete...'))
    await page.waitFor(`document.querySelectorAll('dialog.gallery .gallery-open').length === 4`, { timeoutMs: 8000 })
    check('F: Delete asks in the box; a yes leaves four pictures, and the page says so', /The picture was deleted\./.test(await ev(`document.querySelector('dialog.gallery').innerText`)) && (await Q.asked()).at(-1).options.title === 'Delete a picture')
    // Use in chat
    await clickOn(`document.querySelectorAll('dialog.gallery .gallery-open')[0]`)
    await page.waitFor(`document.querySelector('dialog.gallery .gallery-large-image')?.naturalWidth > 0`, { timeoutMs: 8000 })
    await clickOn(button('dialog.gallery', 'Use in chat'))
    await page.waitFor(`document.querySelectorAll('.attachment-chip').length === 1`, { timeoutMs: 8000 })
    check('F: Use in chat closes the gallery and the picture is on the next message', !(await ev(`!!document.querySelector('dialog.gallery')?.open`)) && /picture-[0-9a-f]{8}\.png/.test(await ev(`document.querySelector('.attachment-chip').innerText`)))
    await clickOn(`document.querySelector('.attachment-chip button')`)
    await sleep(300)
  })

  // ============ G. layout ============
  await part('G', async () => {
    for (const width of [420, 280]) {
      await page.send('Emulation.setDeviceMetricsOverride', { width, height: 700, deviceScaleFactor: 1, mobile: false })
      await sleep(300)
      await openMake()
      const m = await ev(`(() => { const d = document.querySelector('dialog.make-image'); return { sideways: d.scrollWidth - d.clientWidth, right: d.getBoundingClientRect().right <= window.innerWidth, page: document.documentElement.scrollWidth - document.documentElement.clientWidth } })()`)
      check(`G: at ${width} px the "Make an image" dialog fits (no sideways scroll)`, m.sideways <= 0 && m.right && m.page <= 0, show(m))
      await clickOn(button('dialog.make-image', 'Gallery...'))
      await page.waitFor(`document.querySelectorAll('dialog.gallery .gallery-open').length > 0`, { timeoutMs: 8000 })
      const g = await ev(`(() => { const d = document.querySelector('dialog.gallery'); return { sideways: d.scrollWidth - d.clientWidth, right: d.getBoundingClientRect().right <= window.innerWidth } })()`)
      check(`G: at ${width} px the gallery fits`, g.sideways <= 0 && g.right, show(g))
      await page.press('Escape')
      await sleep(250)
      await openSettingsAt('settings-images-heading')
      // measured element by element against the dialog's inner edge (a wrapper that scrolls would hide a table that sticks out; found by the regression of Stage 16)
      const s = await ev(`(() => { const sec = document.querySelector('.images-section'); const d = document.querySelector('dialog.settings'); const inner = d.getBoundingClientRect().left + d.clientLeft + d.clientWidth; const past = [sec, ...sec.querySelectorAll('*')].filter((e) => e.getBoundingClientRect().right > inner + 0.5).slice(0, 6).map((e) => e.tagName + '.' + e.className + ' ' + Math.round(e.getBoundingClientRect().right)); const wrap = sec.querySelector('.images-prices'); return { sideways: sec.scrollWidth - sec.clientWidth, wrapScrolls: wrap ? wrap.scrollWidth - wrap.clientWidth : 0, past } })()`)
      check(`G: at ${width} px the Images section of Settings fits: nothing in it past the dialog's edge, and the price table does not scroll`, s.sideways <= 0 && s.wrapScrolls <= 0 && s.past.length === 0, show(s))
      await closeSettings()
    }
    await page.send('Emulation.clearDeviceMetricsOverride')
    check('G: the page logged no errors and no warnings', page.problems.length === 0, show(page.problems))
  })
} finally {
  const ok = check.summary()
  process.exit(ok ? 0 : 1)
}
