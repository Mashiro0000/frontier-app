// Stage 14b.6 (D-046), in the real window against the mock: the SIGN-IN of a web connector. The Tools page shows a web connector that wants a sign-in, offers Sign in, asks in the
// system's own box, opens the browser (main's shell.openExternal is replaced from the main inspector; this script plays the browser by following the provider's redirect back to
// the app's real listener on 127.0.0.1), keeps the sign-in sealed by the REAL secure storage, lets the model's call through with the token and renews it silently, signs out, cancels,
// says no, takes a client id typed by the person, fits at 420 and 280 px, and the console stays clean. The provider is tools/fixtures14/oauth-server.mjs (no package) in this process.
// Needs: USER_DATA_DIR (scratch), INSPECT_PORT, MOCK_PORT, a saved key (setup-key.mjs).
import './temp-on-a.mjs'
import './ts-resolve.mjs'
import { connect, checker, sleep } from './cdp.mjs'
import { assertScratchProfile } from './profile-guard.mjs'
import { h4, mainInspector } from './lib4.mjs'
import { installQuestions } from './lib10.mjs'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { startProvider } from './fixtures14/oauth-server.mjs'

const port = Number(process.argv[3] ?? 9222)
const userData = process.env.USER_DATA_DIR
const inspectPort = Number(process.env.INSPECT_PORT)
const mockUrl = `http://127.0.0.1:${process.env.MOCK_PORT}`
if (!userData || !inspectPort || !process.env.MOCK_PORT) throw new Error('USER_DATA_DIR, INSPECT_PORT and MOCK_PORT must be set')
const check = checker()
class Done extends Error {}
const part = (id) => { if (process.env.STOP_AFTER === id) throw new Done(id) }
const page = await connect(port)
await assertScratchProfile()
const H = h4(page, { userData, mockUrl })
const { ev } = H
const main = await mainInspector(inspectPort)
const Q = await installQuestions(main, { fallback: 'no' })
const show = (v) => JSON.stringify(v)?.slice(0, 600)
const FILE = join(userData, 'connectors.json')
const control = (body) => fetch(`${mockUrl}/__tools`, { method: 'POST', body: JSON.stringify(body) })
const prov = await startProvider({ mode: 'good' })

// the person's browser: main's shell.openExternal only remembers the address; this script follows it (the provider's page, then the redirect back to the app's listener)
await main.inMain(`(() => { const { shell } = process.mainModule.require('electron'); globalThis.__open = []; shell.openExternal = async (u) => { globalThis.__open.push(u); return undefined }; return true })()`)
const opened = async () => JSON.parse(await main.inMain('JSON.stringify(globalThis.__open)'))
const forgetOpened = () => main.inMain('globalThis.__open.length = 0; true')
async function browserFollows(url) {
  const first = await fetch(url, { redirect: 'manual' })
  const where = first.headers.get('location')
  if (where) await fetch(where, { redirect: 'manual' })
  return first.status
}
async function waitOpened(count = 1, timeoutMs = 20000) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    const o = await opened()
    if (o.length >= count) return o
    await sleep(150)
  }
  return opened()
}

const openTools = async () => { await H.clickChat('Tools'); await page.waitFor(`!!document.querySelector('dialog.tools')?.open`, { timeoutMs: 8000, label: 'Tools' }); await sleep(500) }
const closeTools = async () => { await page.press('Escape'); await sleep(300) }
const SECTION = `[...document.querySelectorAll('dialog.tools .tools-section')].find((x) => x.querySelector('#tools-connectors-title'))`
const CARD = `[...${SECTION}.querySelectorAll('.connector-card')].find((c) => c.getAttribute('aria-label') === 'Connector Web')`
const card = () => ev(`(() => { const c = ${CARD}; if (!c) return null; const a = c.querySelector('.connector-auth'); return { head: c.querySelector('.connector-head')?.textContent ?? '', problem: c.querySelector('.tools-notice-error')?.textContent ?? null, auth: a?.textContent ?? null, buttons: [...c.querySelectorAll('button')].map((b) => ({ text: b.textContent.trim(), disabled: b.disabled })), tools: [...c.querySelectorAll('[role=switch]')].map((s) => ({ label: s.getAttribute('aria-label'), on: s.getAttribute('aria-checked') === 'true' })), inputs: [...c.querySelectorAll('input')].map((i) => ({ type: i.type, value: i.value })) } })()`)
const notice = () => ev(`${SECTION}.querySelector('.tools-notice')?.textContent ?? null`)
const clickCard = (text) => ev(`(() => { const b = [...${CARD}.querySelectorAll('button')].find((e) => e.textContent.trim() === ${JSON.stringify(text)}); if (!b || b.disabled) return false; b.click(); return true })()`)
const fill = async (label, text) => {
  await ev(`(() => { const l = [...${SECTION}.querySelectorAll('label')].find((x) => x.textContent.includes(${JSON.stringify(label)})); const el = l ? l.querySelector('input') : ${SECTION}.querySelector('[aria-label=${JSON.stringify(label)}]'); el.focus(); el.select?.(); return true })()`)
  await page.type(text)
  await sleep(100)
}
const idle = async () => {
  await sleep(300)
  await page.waitFor(`(() => { const s = ${SECTION}; return !!s && !/Working|Answer the question/.test(s.querySelector('.tools-notice')?.textContent ?? '') && ![...s.querySelectorAll('button')].some((b) => b.disabled && b.textContent === 'Check its tools') })()`, { timeoutMs: 60000, label: 'the section to be idle' })
}
async function converse(text, { timeoutMs = 120000 } = {}) {
  await H.send(text)
  await page.waitFor(`!!document.querySelector('.composer-button[type=submit]')`, { timeoutMs })
  await sleep(300)
}
const toolResultsOf = async () => (await H.mockReqs()).filter((r) => r.body && Array.isArray(r.body.messages)).flatMap((r) => r.body.messages.flatMap((m) => (Array.isArray(m.content) ? m.content.filter((b) => b?.type === 'tool_result') : []))).map((b) => (typeof b.content === 'string' ? b.content : JSON.stringify(b.content)))
const stored = () => JSON.parse(readFileSync(FILE, 'utf8')).connectors.find((c) => c.name === 'Web')

try {
  await page.waitFor(`document.readyState === 'complete' && !!document.querySelector('.header-select, .app-badge')`, { timeoutMs: 15000 })
  await sleep(300)
  await ev(`window.api.settings.setModel('claude-opus-5-5')`)

  // ============ A. the page ============
  await openTools()
  const apiKeys = await ev(`Object.keys(window.api.connectors).sort().join()`)
  check('A: the page can read and ask, and sign in, cancel and sign out: nothing that names an address of a provider, reads a token or answers a question', apiKeys === 'addLocal,addRemote,cancelSignIn,refresh,remove,setGrant,setPlace,setTool,signIn,signOut,status,stop', apiKeys)
  await Q.reset()
  const odd = await ev(`window.api.connectors.signIn('../../x', '', '')`)
  const odd2 = await ev(`window.api.connectors.signIn('abcdef123456', '', 'a secret with no client id')`)
  check('A: what the page sends is checked (an id that is not one, a secret with no client id: not understood, nobody is asked, no browser)', odd.ok === false && /not understood/.test(odd.error) && odd2.ok === false && /not understood/.test(odd2.error) && (await Q.count()) === 0 && (await opened()).length === 0, show([odd, odd2]))
  part('A')

  // ============ B. a web connector that wants a sign-in ============
  await ev(`(() => { [...${SECTION}.querySelectorAll('input[type=radio]')][1].click(); return true })()`)
  await sleep(200)
  await fill('Name of the connector', 'Web')
  await fill('Web address', prov.mcp)
  await Q.reset()
  await Q.queue('yes')
  await ev(`(() => { const b = [...${SECTION}.querySelectorAll('button')].find((e) => e.textContent.trim() === 'Add...'); b.click(); return true })()`)
  await idle()
  let c = await card()
  check('B: the web connector is added (with no token) and shows no sign-in block yet', c !== null && c.auth === null && /Stopped/.test(c.head), show(c))
  await ev(`(() => { const b = [...${CARD}.querySelectorAll('button')].find((e) => e.textContent.trim() === 'Check its tools'); b.click(); return true })()`)
  await idle()
  c = await card()
  check('B: starting it, the connector wants a sign-in: the card says so in the app\'s words and offers Sign in', c.auth !== null && /wants you to sign in/.test(c.auth) && c.buttons.some((b) => b.text === 'Sign in...' && !b.disabled) && /sign in/i.test(c.problem ?? ''), show(c))
  check('B: ...and a way to say the person has a client id of their own, closed to begin with', c.inputs.length === 1 && c.inputs[0].type === 'checkbox' && !/Client id/.test(c.auth), show(c.inputs))
  part('B')

  // ============ C. a no ============
  await sleep(3300)
  await Q.reset()
  await Q.queue('no')
  await clickCard('Sign in...')
  await idle()
  const noQ = (await Q.asked())[0]?.options
  check('C: Sign in asks ONE question in the system\'s box, naming the connector, its address, the provider and the permissions, and saying the app never sees the password; "Don\'t sign in" is the way out', (await Q.count()) === 1 && noQ?.message === 'Sign in to the connector "Web"?' && noQ.detail.includes(`Connector: ${prov.mcp}`) && noQ.detail.includes(`Sign-in provider: ${prov.base}`) && /Permissions asked for: read, write\./.test(noQ.detail) && /never sees your password/.test(noQ.detail) && show(noQ.buttons) === show(['Open my browser', "Don't sign in"]) && noQ.defaultId === 1 && noQ.cancelId === 1, show(noQ))
  check('C: a no opens no browser, keeps nothing, and the page says so', (await opened()).length === 0 && stored().auth === null && /You did not sign in/.test((await notice()) ?? ''), show(await notice()))
  part('C')

  // ============ D. a yes ============
  await sleep(3300)
  await Q.reset()
  await Q.queue('yes')
  await clickCard('Sign in...')
  const urls = await waitOpened(1)
  check('D: after the yes main opened the browser ONCE, at the provider\'s sign-in page, with S256, a state and the resource', urls.length === 1 && urls[0].startsWith(`${prov.base}/authorize?`) && /code_challenge_method=S256/.test(urls[0]) && /resource=/.test(urls[0]) && /redirect_uri=http%3A%2F%2F127\.0\.0\.1%3A\d+%2Fcallback/.test(urls[0]), show(urls))
  await sleep(300)
  c = await card()
  check('D: while the person is in the browser the page says it waits, and Cancel is there and can be pressed', /Waiting for you to finish in your browser/.test(c.auth ?? '') && c.buttons.some((b) => b.text === 'Cancel the sign-in' && !b.disabled), show(c.buttons))
  check('D: ...a listener is open on 127.0.0.1 for it, and nothing else of the page can start another sign-in', c.buttons.every((b) => b.text !== 'Sign in...'))
  const status = await browserFollows(urls[0])
  check('D: the played browser got a redirect from the provider\'s page', status === 302, `${status}`)
  await idle()
  c = await card()
  check('D: the connector is signed in: the provider, the permissions, Sign out offered, and it is running with its tool listed', /Signed in at 127\.0\.0\.1:\d+ with: read, write\./.test(c.auth ?? '') && c.buttons.some((b) => b.text === 'Sign out') && /Running/.test(c.head) && c.tools.some((t) => /echo/.test(t.label)), show({ auth: c.auth, head: c.head }))
  check('D: the notice says so', /You are signed in/.test((await notice()) ?? ''), show(await notice()))
  const raw = readFileSync(FILE, 'utf8')
  const entry = stored()
  const issued = prov.issued.at(-1)
  check('D: connectors.json holds the sign-in SEALED by the real secure storage: no token, no client id, no provider address in the clear', typeof entry.auth === 'string' && entry.auth.length > 100 && !raw.includes(issued.access) && !raw.includes(issued.refresh) && !raw.includes('dcr-') && !raw.includes('/token'), show({ len: entry.auth?.length }))
  const pageStatus = JSON.stringify(await ev(`window.api.connectors.status()`))
  check('D: the page was never given a token (not in its status, not in the card)', !pageStatus.includes(issued.access) && !pageStatus.includes(issued.refresh) && !(await ev(`document.body.innerText.includes(${JSON.stringify(issued.access)})`)))
  const log = await ev(`window.api.audit.read()`)
  const events = log.ok ? log.calls.filter((x) => x.outcome.kind === 'connector-event').map((x) => x.outcome.what) : []
  check('D: the audit log has the lines: added, sign-in-needed, signed-in, started', ['added', 'sign-in-needed', 'signed-in', 'started'].every((w) => events.includes(w)) && !JSON.stringify(log).includes(issued.access) && !JSON.stringify(log).includes(issued.refresh), show(events))
  part('D')

  // ============ E. a call with the token, renewed silently ============
  await sleep(3300)
  await Q.reset()
  await Q.queue('yes')
  await ev(`(() => { ${CARD}.querySelector('[aria-label="Tool echo of Web"]').click(); return true })()`)
  await idle()
  check('E: switching the tool on asks, and a yes switches it on', (await Q.count()) === 1 && (await card()).tools.find((t) => /echo/.test(t.label)).on === true)
  await closeTools()
  await H.clickChat('New chat')
  await control({ calls: [{ name: 'web__echo', input: { why: 'to hear it back', text: 'hello with a token' } }] })
  await Q.reset()
  await Q.queue('yes')
  await converse('[[mock:tool-use]] say it back')
  const told = [...new Set(await toolResultsOf())]
  check('E: the model was told what came back, labelled as text from outside', told.length === 1 && /text from outside/.test(told[0]) && /echo:hello with a token/.test(told[0]), show(told))
  check('E: the call carried the access token to the connector (and the connector accepted it)', prov.log.some((l) => l.path === '/mcp' && /tools\/call/.test(l.body) && l.headers.authorization === `Bearer ${issued.access}`))
  const before = prov.log.filter((l) => l.path === '/token').length
  prov.expireAll()
  await control({ calls: [{ name: 'web__echo', input: { why: 'again', text: 'after the token ran out' } }] })
  await Q.reset()
  await Q.queue('yes')
  await converse('[[mock:tool-use]] say it back again')
  const told2 = [...new Set(await toolResultsOf())]
  check('E: when the token has run out the next call renews it silently: one renewal, the call answered, nobody asked to sign in', prov.log.filter((l) => l.path === '/token').length === before + 1 && told2.some((t) => /echo:after the token ran out/.test(t)) && (await Q.count()) === 1, show({ renewals: prov.log.filter((l) => l.path === '/token').length - before, q: await Q.count() }))
  await sleep(500)
  const cards = await ev(`[...document.querySelectorAll('.message-assistant .tool-note')].map((n) => ({ title: n.querySelector('.tool-note-title')?.textContent, outcome: n.querySelector('.tool-note-outcome')?.textContent ?? null }))`)
  check('E: the chat shows both calls as calls of the connector, and nothing about tokens', cards.length >= 1 && cards.every((n) => n.title === 'echo (connector web)') && !JSON.stringify(cards).includes('at-'), show(cards))
  part('E')

  // ============ F. signing out ============
  await sleep(3300)
  await openTools()
  const nowRec = prov.issued.at(-1)
  await Q.reset()
  await clickCard('Sign out')
  await idle()
  c = await card()
  check('F: signing out asked no question (it gives rights up)', (await Q.count()) === 0, show(await Q.count()))
  check('F: ...the tokens no longer work at the provider, and the file holds no sign-in', !prov.isValid(nowRec.access) && !prov.refreshValid(nowRec.refresh) && stored().auth === null, show({ auth: stored().auth }))
  check('F: ...the card says it wants a sign-in again, with Sign in offered', /wants you to sign in/.test(c.auth ?? '') && c.buttons.some((b) => b.text === 'Sign in...'), show(c.auth))
  part('F')

  // ============ G. cancelling ============
  await sleep(3300)
  await forgetOpened()
  await Q.reset()
  await Q.queue('yes')
  await clickCard('Sign in...')
  await waitOpened(1)
  await sleep(300)
  check('G: waiting for the browser, Cancel is offered', (await card()).buttons.some((b) => b.text === 'Cancel the sign-in' && !b.disabled))
  await clickCard('Cancel the sign-in')
  await idle()
  c = await card()
  check('G: Cancel ends it at once: the notice says it was cancelled, Sign in is back, nothing is kept, no token was asked for', /cancelled/i.test((await notice()) ?? '') && c.buttons.some((b) => b.text === 'Sign in...') && stored().auth === null && !prov.log.slice(-10).some((l) => l.path === '/token' && /authorization_code/.test(l.body)), show({ n: await notice(), b: c.buttons }))
  const gone = await browserFollows((await opened()).at(-1)).then(() => false, () => true)
  check('G: ...and the listener is closed: the redirect of the abandoned sign-in finds nothing', gone === true)
  part('G')

  // ============ H. a client id of the person's own ============
  await sleep(3300)
  await forgetOpened()
  await ev(`(() => { const l = [...${CARD}.querySelectorAll('label')].find((x) => /I registered the app/.test(x.textContent)); l.querySelector('input').click(); return true })()`)
  await sleep(300)
  c = await card()
  check('H: the box for a client id opens: a client id (text) and a secret (a password field), with the return address to register', c.inputs.some((i) => i.type === 'password') && /127\.0\.0\.1\/callback/.test(c.auth ?? ''), show(c.inputs))
  await fill('Client id', 'typed-client')
  const registered = prov.log.filter((l) => l.path === '/register').length
  await Q.reset()
  await Q.queue('yes')
  await clickCard('Sign in...')
  const urls2 = await waitOpened(1)
  const qs = new URL(urls2[0]).searchParams
  check('H: the browser is opened with the client id that was typed, and no registration was made', qs.get('client_id') === 'typed-client' && prov.log.filter((l) => l.path === '/register').length === registered && /typed-client/.test((await Q.asked())[0]?.options.detail ?? ''), show([...qs.keys()]))
  await browserFollows(urls2[0])
  await idle()
  c = await card()
  check('H: signed in again with the typed client; the secret field is empty and nothing of it is on the page', /Signed in at/.test(c.auth ?? '') && stored().auth !== null, show(c.auth))
  part('H')

  // ============ I. the page fits ============
  await sleep(3300)
  await clickCard('Sign out')
  await idle()
  for (const width of [420, 280]) {
    await page.send('Emulation.setDeviceMetricsOverride', { width, height: 800, deviceScaleFactor: 1, mobile: false })
    await sleep(300)
    const fit = await ev(`(() => { const d = document.querySelector('dialog.tools'); const s = ${SECTION}; const r = s.getBoundingClientRect(); const dr = d.getBoundingClientRect(); return { overflow: d.scrollWidth - d.clientWidth, right: r.right, dialogRight: dr.right } })()`)
    check(`I: at ${width} px nothing of the "Connectors" section (the sign-in block among it) sticks out sideways`, fit.overflow <= 1 && fit.right <= fit.dialogRight + 1, show(fit))
  }
  await page.send('Emulation.clearDeviceMetricsOverride', {})
  await closeTools()
  check('I: the page logged no errors and no warnings in the whole run', page.problems.length === 0, show(page.problems))
} catch (error) {
  if (!(error instanceof Done)) check(`the suite stopped before its end: ${String(error?.stack ?? error).slice(0, 500)}`, false)
}
await prov.close()
const ok = check.summary()
process.exit(ok ? 0 : 1)
