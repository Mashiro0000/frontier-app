// Slice 17.3 (D-049) in the real window, against the mock's Gemini stand-in: the adapter in the running app. Anything the system's box may ask (17.5 makes saving a Google
// key ask) is answered yes from the main inspector, so the suite tests the adapter, not the question. What it shows:
//   A. a Google key saved; Test key lists Google's models (with the saved key, in its header);
//   B. Gemini 3.8 Flash answers: the text in the window, the model named above the reply, the request as 17.3 builds it, the key in its header only, the usage counted
//      at Gemini's prices in the ledger;
//   C. a chat that moves from Claude to Gemini and back carries all of it, each request with its own provider's key;
//   D. the endings and failures in the app's words: a blocked question, a blocked reply, a cut-off reply, a refused key (400), no quota, overloaded, a key repeated by
//      the provider (scrubbed), a thought never shown, Stop;
//   E. the saved chat says who wrote each reply (google / the model); the page logged nothing.
// Needs: USER_DATA_DIR (scratch), INSPECT_PORT, MOCK_PORT.
import './temp-on-a.mjs'
import './ts-resolve.mjs'
import { connect, checker, sleep } from './cdp.mjs'
import { assertScratchProfile } from './profile-guard.mjs'
import { mainInspector, h4 } from './lib4.mjs'
import { installQuestions } from './lib10.mjs'
import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const port = Number(process.argv[3] ?? 9222)
const userData = process.env.USER_DATA_DIR
const inspectPort = Number(process.env.INSPECT_PORT)
const mockUrl = `http://127.0.0.1:${process.env.MOCK_PORT}`
if (!userData || !inspectPort || !process.env.MOCK_PORT) throw new Error('USER_DATA_DIR, INSPECT_PORT and MOCK_PORT must be set')
const check = checker()
const part = async (name, fn) => { try { await fn() } catch (error) { check(`${name} did not run to its end: ${String(error?.stack ?? error).slice(0, 500)}`, false) } }
const show = (v) => JSON.stringify(v)?.slice(0, 600)
const page = await connect(port)
await assertScratchProfile()
const main = await mainInspector(inspectPort)
await installQuestions(main, { fallback: 'yes' })
const H = h4(page, { userData, mockUrl })
const ev = (expression) => page.evaluate(expression)
const KEY_G = 'AIza' + randomBytes(27).toString('base64url').slice(0, 35)
const KEY_A = 'sk-ant-api03-' + randomBytes(24).toString('hex')
const FLASH = 'gemini-3.8-flash'
const ARGON = 'gemini-4-argon'
const OPUS = 'claude-opus-5-5'
const reqs = async () => (await H.mockReqs()).filter((r) => !r.listing)
const google = async () => (await reqs()).filter((r) => r.provider === 'google')
const captions = () => ev(`[...document.querySelectorAll('.message-model')].map((m) => m.textContent)`)
const ledger = () => { const f = join(userData, 'usage', 'ledger.jsonl'); return existsSync(f) ? readFileSync(f, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : [] }

try {
  await fetch(`${mockUrl}/__reset`, { method: 'POST' })
  await part('A', async () => {
    const saved = await ev(`window.api.settings.setApiKey('google', ${JSON.stringify(KEY_G)})`)
    check('A: a Google key is saved (any question in the system\'s box answered yes from main)', saved.ok === true && saved.status.providers.find((p) => p.id === 'google').hasKey === true, show(saved))
    check('A: the key file is credentials.google.json, and the page never sees the key', existsSync(join(userData, 'credentials.google.json')) && !JSON.stringify(saved).includes(KEY_G))
    check('A: (an Anthropic key too, for the chat that changes provider)', (await ev(`window.api.settings.setApiKey('anthropic', ${JSON.stringify(KEY_A)})`)).ok === true)
    const tested = await ev(`window.api.settings.testApiKey('google')`)
    const listing = (await H.mockReqs()).filter((r) => r.listing && r.provider === 'google')
    check('A: Test key for Google: Google\'s list of models (7), asked with the saved key in its header, nothing in the address', tested.ok === true && tested.modelCount === 7 && listing.length === 1 && listing[0].headers['x-goog-api-key'] === KEY_G && !listing[0].url.includes(KEY_G), show([tested, listing.map((l) => l.url)]))
  })

  await part('B', async () => {
    await H.chooseInPage(FLASH)
    await H.settle(FLASH)
    const r = await H.askMock('hello Gemini')
    check('B: Gemini 3.8 Flash answers in the window', (await H.bubbleText()) === 'Echo: hello Gemini' && !(await H.noteText()), show([await H.bubbleText(), await H.noteText()]))
    check('B: the reply is named "Gemini 3.8 Flash"', (await captions()).at(-1) === 'Gemini 3.8 Flash', show(await captions()))
    check('B: one request to Google, to the model\'s address with alt=sse; the key in x-goog-api-key, not in the address or the body', r?.provider === 'google' && r.url === `/v1beta/models/${FLASH}:streamGenerateContent?alt=sse` && r.headers['x-goog-api-key'] === KEY_G && !r.url.includes(KEY_G) && !r.raw.includes(KEY_G) && !r.headers.authorization, show(r?.url))
    check('B: the stand-in found nothing it would refuse', r.problems.length === 0, show(r.problems))
    check('B: the request: the message as a user turn, the app\'s rules as the system instruction, 16,000 tokens at most, thinking at medium, no thoughts asked', JSON.stringify(r.body.contents) === JSON.stringify([{ role: 'user', parts: [{ text: 'hello Gemini' }] }]) && /^You are an AI assistant, chatting with someone in Frontier App/.test(r.body.systemInstruction.parts[0].text) && JSON.stringify(r.body.generationConfig) === JSON.stringify({ maxOutputTokens: 16000, thinkingConfig: { thinkingLevel: 'medium', includeThoughts: false } }))
    check('B: no tools are offered (none is switched on), no Google tool ever', r.body.tools === undefined && r.body.toolConfig === undefined)
    await sleep(400)
    const rec = ledger().filter((l) => l.provider === 'google').at(-1)
    check('B: the ledger counts it as Google\'s, at today\'s Gemini 3.8 Flash prices, from Google\'s report: 25 in, 12 + 28 thinking out', rec?.model === FLASH && rec.state === 'done' && rec.estimate === false && rec.prices.inputPerMTok === (Date.now() < new Date(2027, 0, 1).getTime() ? 0.75 : 1.5) && rec.tokens.input === 25 && rec.tokens.output === 40, show(rec))
    await H.chooseInPage(ARGON)
    await H.settle(ARGON)
    const a = await H.askMock('and Argon')
    check('B: Gemini 4 Argon answers too, to its own address, with the whole chat as user / model / user', a?.url === `/v1beta/models/${ARGON}:streamGenerateContent?alt=sse` && JSON.stringify(a.body.contents.map((c) => c.role)) === '["user","model","user"]' && (await H.bubbleText()) === 'Echo: and Argon', show(a?.body.contents))
  })

  await part('C', async () => {
    await H.chooseInPage(OPUS)
    await H.settle(OPUS)
    const c = await H.askMock('now Claude, who read it all')
    check('C: Claude gets the whole chat, the Gemini replies as plain assistant turns, with the Anthropic key only', c?.provider === 'anthropic' && JSON.stringify(c.body.messages.map((m) => m.role)) === '["user","assistant","user","assistant","user"]' && /Echo: hello Gemini/.test(JSON.stringify(c.body.messages)) && c.headers['x-api-key'] === KEY_A && !JSON.stringify(c.headers).includes(KEY_G), show(c?.body.messages.map((m) => m.role)))
    await H.chooseInPage(FLASH)
    await H.settle(FLASH)
    const g = await H.askMock('back to Gemini')
    check('C: back on Gemini: the Claude reply arrives as a model turn, and only the Google key goes', JSON.stringify(g.body.contents.map((x) => x.role)) === '["user","model","user","model","user","model","user"]' && /Echo: now Claude/.test(JSON.stringify(g.body.contents)) && g.headers['x-goog-api-key'] === KEY_G && !g.headers['x-api-key'], show(g?.body.contents.map((x) => x.role)))
  })

  await part('D', async () => {
    await page.click('.chat-button@New chat')
    await sleep(300)
    const errors = [
      ['[[mock:blocked-prompt]] blocked question', /^The model declined to answer this \(SAFETY\)\./],
      ['[[mock:max-tokens]] too long', /^The reply reached the length limit and was cut off\./],
      ['[[mock:429-quota]] no quota', /^Your Google account has no credit left, or has reached its spending limit \(429\)\. Check your billing with Google\./],
      ['[[mock:503]] busy', /^Google is overloaded right now \(503\)\. Try again in a moment\./],
      ['[[mock:400-key]] refused key', /^The API key was not accepted \(400\)\. Check it in Settings\./],
      ['[[mock:midstream-error]] broke', /^Google stopped the reply: An internal error has occurred\./]
    ]
    for (const [text, pattern] of errors) {
      await H.sendAndWait(text)
      const note = await H.noteText()
      check(`D: ${text.split(']] ')[1]}: "${pattern.source.slice(1, 60).replace(/\\/g, '')}..."`, pattern.test(note ?? ''), show(note))
    }
    await H.sendAndWait('[[mock:blocked-reply]] half')
    check('D: a reply blocked half way keeps the text that came, and says it was declined, with Google\'s reason', (await H.bubbleText()) === 'Partial answer that' && /^The model declined to answer this \(SAFETY\)\./.test((await H.noteText()) ?? ''), show([await H.bubbleText(), await H.noteText()]))
    await H.sendAndWait('[[mock:echo-key]] repeats the key')
    const scrubbed = await H.noteText()
    check('D: a provider that repeats the whole key: the app\'s sentence, with no trace of the key anywhere on the page', /^The API key was not accepted \(400\)/.test(scrubbed ?? '') && !(await ev('document.body.innerText')).includes(KEY_G), show(scrubbed))
    await H.sendAndWait('[[mock:thoughts]] think')
    check('D: a thought Google sent although not asked for is never shown', (await H.bubbleText()) === 'The answer.' && !(await ev('document.body.innerText')).includes('SECRET THINKING'))
    await H.send('[[mock:slow]] go on')
    await page.waitFor(`/tick1/.test([...document.querySelectorAll('.message-assistant')].at(-1)?.innerText ?? '')`, { timeoutMs: 10000 })
    await page.click('.composer-button@Stop')
    await page.waitFor(`!!document.querySelector('.composer-button[type=submit]')`, { timeoutMs: 8000 })
    await sleep(400)
    const last = (await google()).at(-1)
    check('D: Stop ends a Gemini reply at once: the connection is closed, the text that came stays', last.closedEarly === true && /^tick0 tick1/.test((await H.bubbleText()) ?? ''), show([last.closedEarly, await H.bubbleText()]))
    const counted = (await google()).length
    check('D: each of these was ONE request (no retry anywhere)', counted === 2 + 1 + errors.length + 4, String(counted))
  })

  await part('E', async () => {
    const first = await H.waitFirst('hello Gemini', (c) => c.messages.filter((m) => m.role === 'assistant').length === 4)
    check('E: the saved chat says who wrote each reply: google / Flash, google / Argon, anthropic / Opus, google / Flash', JSON.stringify(first.conv.messages.filter((m) => m.role === 'assistant').map((m) => `${m.provider}/${m.model}`)) === JSON.stringify([`google/${FLASH}`, `google/${ARGON}`, `anthropic/${OPUS}`, `google/${FLASH}`]), show(first.conv.messages.map((m) => m.provider)))
    check('E: the page logged no error or warning', page.problems.length === 0, show(page.problems))
  })
} finally {
  const ok = check.summary()
  process.exit(ok ? 0 : 1)
}
