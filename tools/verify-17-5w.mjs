// Slice 17.5 (D-049) in the real window, against the mock, the system's message box stood in for from the main inspector: Settings and the window for Google.
// Every step as a person would do it (real clicks, real typing), and what the page shows is read back. What it shows:
//   A. Settings > Google API key: what the key is for, where to make one, the free-tier note, no key saved;
//   B. saving a Google key asks in the system's box, for this window, with the free-tier words; a no saves nothing and says so; a yes saves it; a second key asks
//      again; an OpenAI key saves with no question;
//   C. Test key for Google, by the button;
//   D. with Gemini 4 Argon chosen, Settings says the price change that is coming (before 1 December 2026);
//   E. the Tools page says the web search is not offered with Gemini models;
//   F. a Gemini reply's cost is in Settings > Usage;
//   G. at 420 and 280 px the Google key section and the model section fit inside the dialog; the page logged nothing.
// Needs: USER_DATA_DIR (scratch), INSPECT_PORT, MOCK_PORT.
import './temp-on-a.mjs'
import './ts-resolve.mjs'
import { connect, checker, sleep } from './cdp.mjs'
import { assertScratchProfile } from './profile-guard.mjs'
import { mainInspector, h4 } from './lib4.mjs'
import { installQuestions, linesOf } from './lib10.mjs'
import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const port = Number(process.argv[3] ?? 9222)
const userData = process.env.USER_DATA_DIR
const inspectPort = Number(process.env.INSPECT_PORT)
const mockUrl = `http://127.0.0.1:${process.env.MOCK_PORT}`
if (!userData || !inspectPort || !process.env.MOCK_PORT) throw new Error('USER_DATA_DIR, INSPECT_PORT and MOCK_PORT must be set')
const check = checker()
const part = async (name, fn) => { try { await fn() } catch (error) { check(`${name} did not run to its end: ${String(error?.stack ?? error).slice(0, 500)}`, false) } }
const show = (v) => JSON.stringify(v)?.slice(0, 700)
const page = await connect(port)
await assertScratchProfile()
const main = await mainInspector(inspectPort)
const Q = await installQuestions(main, { fallback: 'no' })
const H = h4(page, { userData, mockUrl })
const ev = (expression) => page.evaluate(expression)
const KEY_G = 'AIza' + randomBytes(27).toString('base64url').slice(0, 35)
const KEY_G2 = 'AIza' + randomBytes(27).toString('base64url').slice(0, 35)
const KEY_O = 'sk-proj-' + randomBytes(24).toString('hex')
const beforeDecember = Date.now() < new Date(2026, 11, 1).getTime()
const KEY_FILE = join(userData, 'credentials.google.json')

const openSettings = async () => {
  await page.click('.header-button@Settings')
  await page.waitFor(`!!document.querySelector('dialog.settings')?.open`)
  await sleep(300)
}
const closeSettings = async () => { await page.press('Escape'); await sleep(250) }
/** The Google key section: its text, the field, the buttons, the notice. */
const googleSection = () => ev(`(() => { const s = [...document.querySelectorAll('dialog.settings form.settings-section')].find((f) => f.querySelector('h3')?.textContent === 'Google API key'); if (!s) return null; return { text: s.innerText, note: s.querySelector('.settings-key-note')?.textContent ?? null, status: s.querySelector('.settings-status')?.textContent ?? null, notice: [...s.querySelectorAll('[role=status], [role=alert], .settings-notice')].map((n) => n.textContent).join(' | '), buttons: [...s.querySelectorAll('button')].map((b) => ({ text: b.textContent, disabled: b.disabled })) } })()`)
/** Types a key into the Google field for real and presses Save. */
const saveGoogleKey = async (key) => {
  await ev(`(() => { const i = document.getElementById('api-key-google'); i.scrollIntoView({ block: 'center' }); i.focus(); i.select(); return true })()`)
  await page.type(key)
  await sleep(100)
  await ev(`(() => { const s = document.getElementById('api-key-google').closest('form'); const b = [...s.querySelectorAll('button')].find((x) => x.textContent === 'Save key'); b.setAttribute('data-click', '1'); b.scrollIntoView({ block: 'center' }); return true })()`)
  await sleep(80)
  await page.click('[data-click="1"]')
  await ev(`document.querySelector('[data-click="1"]')?.removeAttribute('data-click')`)
}
const waitNotice = async (re, ms = 6000) => { const t0 = Date.now(); let last = null; while (Date.now() - t0 < ms) { last = (await googleSection())?.notice ?? ''; if (re.test(last)) return last; await sleep(80) } return last }

try {
  await fetch(`${mockUrl}/__reset`, { method: 'POST' })
  await part('A', async () => {
    await openSettings()
    const s = await googleSection()
    check('A: Settings has a "Google API key" section: what it is for and where to make one', /Google's Gemini models/.test(s?.text ?? '') && /Google AI Studio/.test(s.text), show(s))
    check('A: the free-tier note is there, word for word', s.note === 'On a free (unbilled) key, Google uses what you send to improve its products, and people at Google may read it; on a billed key it does not. The app cannot tell which kind of key you have. Gemini 4 Argon needs a billed key.', show(s.note))
    check('A: no Google key is saved yet', s.status === 'No key is saved yet.')
    check('A: the other two sections have no such note', (await ev(`document.querySelectorAll('dialog.settings .settings-key-note').length`)) === 1)
  })

  await part('B', async () => {
    await Q.reset()
    await Q.queue('no')
    await saveGoogleKey(KEY_G)
    const said = await waitNotice(/Not saved/)
    const asked = await Q.asked()
    check('B: Save asks ONE question in the system\'s box, for this window', asked.length === 1 && asked[0].withWindow === true, show(asked.map((a) => a.options.message)))
    const lines = linesOf(asked[0] ?? { options: {} })
    check('B: the box: "Save this Google API key, so that the app can send your chats to Google?"', asked[0]?.options.message === 'Save this Google API key, so that the app can send your chats to Google?' && asked[0].options.title === 'Google API key')
    check('B: it says what Google does on a free key, that the app cannot tell, and that Argon needs a billed key', lines.some((l) => /^On a free \(unbilled\) key, Google uses what you send to improve its products, and people at Google may read it\./.test(l)) && lines.some((l) => /The app cannot tell which kind of key this is, and sends nothing to find out\./.test(l)) && lines.some((l) => /^Gemini 4 Argon needs a billed key/.test(l)), show(lines))
    check('B: its buttons: "Save the key" and "Don\'t save it", the no the default and the cancel', JSON.stringify(asked[0]?.options.buttons) === JSON.stringify(['Save the key', "Don't save it"]) && asked[0].options.defaultId === 1 && asked[0].options.cancelId === 1, show(asked[0]?.options))
    check('B: a no: nothing saved, the page says so', /Not saved: you said no in the window that asked\./.test(said ?? '') && !existsSync(KEY_FILE) && (await googleSection()).status === 'No key is saved yet.', show(said))
    check('B: the key never reached the page\'s text or the box', !(await ev('document.body.innerText')).includes(KEY_G) && !JSON.stringify(asked).includes(KEY_G))
    await sleep(3300) // the box rests for three seconds after a no (D-039)
    await Q.reset()
    await Q.queue('yes')
    await saveGoogleKey(KEY_G)
    const saved = await waitNotice(/Saved\./)
    check('B: a yes: "Saved.", the key file is there, the section says a key is saved', /Saved\./.test(saved ?? '') && existsSync(KEY_FILE) && (await googleSection()).status === 'A key is saved.' && (await Q.count()) === 1, show(saved))
    await Q.reset()
    await Q.queue('yes')
    await saveGoogleKey(KEY_G2)
    await waitNotice(/Saved\./)
    check('B: a second Google key asks again (a new key may be of the other kind)', (await Q.count()) === 1)
    await Q.reset()
    const o = await ev(`window.api.settings.setApiKey('openai', ${JSON.stringify(KEY_O)})`)
    check('B: an OpenAI key saves with no question, as before', o.ok === true && (await Q.count()) === 0)
    await closeSettings()
  })

  await part('C', async () => {
    await openSettings()
    await ev(`(() => { const s = document.getElementById('api-key-google').closest('form'); const b = [...s.querySelectorAll('button')].find((x) => x.textContent === 'Test key'); b.setAttribute('data-click', '1'); b.scrollIntoView({ block: 'center' }); return true })()`)
    await sleep(80)
    await page.click('[data-click="1"]')
    await ev(`document.querySelector('[data-click="1"]')?.removeAttribute('data-click')`)
    const said = await waitNotice(/accepted/)
    const listing = (await H.mockReqs()).filter((r) => r.listing && r.provider === 'google').at(-1)
    check('C: Test key by the button: "The key was accepted. Google lists 7 models for it.", asked with the second key, in its header', /The key was accepted\. Google lists 7 models for it\./.test(said ?? '') && listing?.headers['x-goog-api-key'] === KEY_G2 && !listing.url.includes(KEY_G2), show(said))
    await closeSettings()
  })

  await part('D', async () => {
    await H.chooseInPage('gemini-4-argon')
    await H.settle('gemini-4-argon')
    await openSettings()
    const text = await ev(`document.querySelector('dialog.settings').innerText`)
    const change = await ev(`document.querySelector('dialog.settings .settings-price-change')?.textContent ?? null`)
    if (beforeDecember) {
      check('D: Settings says the coming change: "From 1 December 2026: $4 per million tokens it reads and $20 per million tokens it writes, twice today\'s prices. The app counts each request at the prices of the day it is sent."', change === "From 1 December 2026: $4 per million tokens it reads and $20 per million tokens it writes, twice today's prices. The app counts each request at the prices of the day it is sent.", show(change))
      check('D: ... below today\'s list price ($2 and $10)', /List price: \$2 per million tokens it reads and \$10 per million tokens it writes, billed to\s+your Google account/.test(text), show(text.match(/List price[^\n]*/)?.[0]))
    } else console.log('   (run after 1 December 2026: D\'s words are for October and November)')
    await closeSettings()
    await H.chooseInPage('claude-opus-5-5')
    await H.settle('claude-opus-5-5')
    await openSettings()
    check('D: Claude Opus 5.5 has no change coming: no such line', (await ev(`document.querySelector('dialog.settings .settings-price-change')`)) === null)
    await closeSettings()
  })

  await part('E', async () => {
    await H.clickChat('Tools')
    await page.waitFor(`!!document.querySelector('dialog.tools')?.open`, { timeoutMs: 8000 })
    await sleep(400)
    const item = await ev(`(() => { const li = [...document.querySelectorAll('ul[aria-label=Tools] li')].find((x) => x.querySelector('.tools-switch-title')?.textContent === 'Search the web'); return li ? li.innerText : null })()`)
    check('E: under "Search the web": not offered with Gemini models, because it would run on Google Search, which keeps searched prompts for 30 days', /Not offered with Gemini models: the search would run on Google Search, and Google keeps searched prompts for 30 days\./.test(item ?? ''), show(item))
    await page.press('Escape')
    await sleep(300)
  })

  await part('F', async () => {
    await H.chooseInPage('gemini-3.8-flash')
    await H.settle('gemini-3.8-flash')
    await H.askMock('a Gemini reply to count')
    await sleep(400)
    await openSettings()
    const usage = await ev(`document.querySelector('dialog.settings .usage-section, dialog.settings [aria-labelledby=settings-usage-heading]')?.innerText ?? document.querySelector('dialog.settings').innerText`)
    check('F: Settings > Usage counts the Gemini reply (25 in at $0.75, 40 out at $3.75 a million: $0.0002)', /\$0\.0002/.test(usage), show(usage.slice(0, 600)))
    await closeSettings()
  })

  await part('G', async () => {
    for (const width of [420, 280]) {
      await page.send('Emulation.setDeviceMetricsOverride', { width, height: 800, deviceScaleFactor: 1, mobile: false })
      await sleep(300)
      await openSettings()
      const fit = await ev(`(() => { const d = document.querySelector('dialog.settings'); const inner = d.getBoundingClientRect().left + d.clientLeft + d.clientWidth; const sec = [...d.querySelectorAll('form.settings-section')].find((f) => f.querySelector('h3')?.textContent === 'Google API key'); const model = d.querySelector('[aria-labelledby=settings-model-heading]'); const past = [sec, ...sec.querySelectorAll('*'), model, ...model.querySelectorAll('*')].filter((e) => e.getBoundingClientRect().right > inner + 0.5).slice(0, 6).map((e) => e.tagName + '.' + e.className + ' ' + Math.round(e.getBoundingClientRect().right)); return { past, sideways: d.scrollWidth - d.clientWidth } })()`)
      check(`G: at ${width} px the Google key section and the model section fit inside Settings, element by element`, fit.past.length === 0 && fit.sideways <= 0, show(fit))
      await closeSettings()
    }
    await page.send('Emulation.clearDeviceMetricsOverride')
    check('G: the page logged no error or warning', page.problems.length === 0, show(page.problems))
  })
} finally {
  const ok = check.summary()
  process.exit(ok ? 0 : 1)
}
