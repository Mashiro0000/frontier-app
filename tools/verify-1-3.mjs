import { connect, checker, sleep } from './cdp.mjs'

const shots = process.argv[2]
const port = Number(process.argv[3] ?? 9222)
const check = checker()
const page = await connect(port)
await page.send('Page.reload')
await sleep(1500)

const ev = (expr) => page.evaluate(expr)
const articles = () => ev(`document.querySelectorAll('article').length`)
const lastAssistant = (expr) => ev(`(() => { const a = [...document.querySelectorAll('.message-assistant')].at(-1); return a ? (${expr}) : null })()`)
// 7.2: the text a person sees (Markdown: paragraphs are elements)
const replyText = () => lastAssistant(`a.querySelector('.bubble')?.innerText ?? null`)
const replyNote = () => lastAssistant(`a.querySelector('.message-note')?.textContent ?? null`)
const SEND_READY = `!!document.querySelector('.composer-button[type=submit]')`
const STOP_SHOWN = `!!document.querySelector('.composer-button-stop')`
const ariaBusy = () => ev(`document.querySelector('[role=log]').getAttribute('aria-busy')`)
const active = () => ev(`document.activeElement?.className`)
const send = async (text) => {
  await ev(`(() => { const t = document.querySelector('.composer-input'); t.focus(); t.select() })()`)
  await page.type(text)
  await page.press('Enter')
}
const words = (n) => Array.from({ length: n }, (_, i) => `w${i + 1}`).join(' ')

// ---- 1. a short message: typing dots, then the echo ----
let t0 = Date.now()
await send('hello world')
await page.waitFor(`!!document.querySelector('.message-assistant')`)
check('assistant message appears straight away with typing dots', await ev(`!!document.querySelector('.message-assistant .typing')`))
check('no text has arrived yet', (await replyText()) === null || (await replyText()) === '' || (await ev(`!!document.querySelector('.message-assistant .typing')`)))
check('button became Stop while replying', await ev(STOP_SHOWN) && (await ev(`document.querySelector('.composer-button-stop').textContent`)) === 'Stop')
check('log is aria-busy while replying', (await ariaBusy()) === 'true')
check('input stays enabled while replying (you can type ahead)', await ev(`!document.querySelector('.composer-input').disabled`))
await page.screenshot(`${shots}/1-3-typing.png`)
await page.waitFor(SEND_READY)
let elapsed = Date.now() - t0
check('reply is exactly "Echo: hello world"', (await replyText()) === 'Echo: hello world', JSON.stringify(await replyText()))
check('typing dots are gone', await ev(`!document.querySelector('.typing')`))
check('log is no longer busy', (await ariaBusy()) === 'false')
check('no note under a normal reply', (await replyNote()) === null)
check('reply took a visible moment (>= 350 ms), not instant', elapsed >= 350, `${elapsed} ms`)
check('button is Send again', await ev(SEND_READY))

// ---- 2. echo keeps spaces and line breaks exactly ----
await send('a  b\nc   d')
await page.waitFor(SEND_READY)
// 7.2 (D-025): a reply is Markdown, so a run of spaces collapses as it does in any rendered Markdown; the line break stays. What the
// person typed is shown as typed.
const typedText = () => ev(`[...document.querySelectorAll('.message-user .bubble')].at(-1).textContent`)
check('echo keeps the line break (spaces collapse, as in rendered Markdown), and the person\'s own message keeps every space', (await replyText()) === 'Echo: a b\nc d' && (await typedText()) === 'a  b\nc   d', JSON.stringify([await replyText(), await typedText()]))

// ---- 3. a long message streams in pieces and takes a bounded time ----
const long = words(300)
const longExpected = `Echo: ${long}`
t0 = Date.now()
await send(long)
await page.waitFor(`!!document.querySelector('.message-assistant:last-child .bubble') && document.querySelector('.message-assistant:last-child .bubble').textContent.length > 0 && !document.querySelector('.message-assistant:last-child .typing')`)
await sleep(500)
const partial = await replyText()
check('text arrives progressively (partial, a prefix of the final echo)', partial.length > 0 && partial.length < longExpected.length && longExpected.startsWith(partial), `${partial.length}/${longExpected.length} chars`)
check('Stop still showing mid-stream', await ev(STOP_SHOWN))
await page.waitFor(SEND_READY, { timeoutMs: 10000 })
elapsed = Date.now() - t0
check('long reply finishes with the exact text', (await replyText()) === longExpected)
check('long reply takes a bounded time (< 4.5 s)', elapsed < 4500, `${elapsed} ms`)
check('long reply is not instant either (> 1.5 s)', elapsed > 1500, `${elapsed} ms`)

// ---- 4. Stop mid-stream keeps the partial text ----
await send(long)
await page.waitFor(`(document.querySelector('.message-assistant:last-child .bubble')?.textContent.length ?? 0) > 0`)
await sleep(300)
await page.click('.composer-button-stop')
await page.waitFor(SEND_READY, { timeoutMs: 3000 })
const stoppedText = await replyText()
check('Stop: note says "Stopped"', (await replyNote()) === 'Stopped', JSON.stringify(await replyNote()))
check('Stop: partial text is kept (non-empty strict prefix)', stoppedText.length > 0 && stoppedText.length < longExpected.length && longExpected.startsWith(stoppedText), `${stoppedText.length} chars`)
await sleep(600)
check('Stop: text does not keep growing afterwards', (await replyText()) === stoppedText)
check('Stop: log is no longer busy', (await ariaBusy()) === 'false')
check('Stop: focus is in the input box', (await active()) === 'composer-input', await active())
await page.screenshot(`${shots}/1-3-stopped.png`)
await send('after stop')
await page.waitFor(SEND_READY)
check('can chat normally after a Stop', (await replyText()) === 'Echo: after stop', JSON.stringify(await replyText()))

// ---- 5. Stop before any text arrives ----
await send('quick stop')
await page.waitFor(`!!document.querySelector('.composer-button-stop')`)
await page.click('.composer-button-stop')
await page.waitFor(SEND_READY, { timeoutMs: 3000 })
check('Stop before first text: no empty bubble, just the note', await lastAssistant(`!a.querySelector('.bubble') && a.querySelector('.message-note')?.textContent === 'Stopped'`))

// ---- 6. Regression: clicking Stop must not send a half-typed draft ----
const before6 = await articles()
await send(long)
await page.waitFor(STOP_SHOWN)
await ev(`document.querySelector('.composer-input').focus()`)
await page.type('my draft')
await page.click('.composer-button-stop')
await page.waitFor(SEND_READY, { timeoutMs: 3000 })
await sleep(200)
check('Stop with a draft typed: draft was NOT sent', (await articles()) === before6 + 2, `articles ${before6} -> ${await articles()} (expected +2: your message and its stopped reply)`)
check('Stop with a draft typed: draft still in the input', (await ev(`document.querySelector('.composer-input').value`)) === 'my draft')
check('Send is enabled for the kept draft', await ev(`!document.querySelector('.composer-button').disabled`))
await page.press('Enter')
await page.waitFor(SEND_READY, { timeoutMs: 6000 })
// History policy (D-013): replies that ended with no text at all are left out, so the earlier unanswered
// messages travel together with this one. The mock echoes the whole merged user message; the last part is ours.
check('the kept draft can then be sent normally (merged after the unanswered messages)', (await replyText()).startsWith('Echo: ') && (await replyText()).endsWith('\n\nmy draft'), JSON.stringify((await replyText()).slice(-60)))

// ---- 7. Enter while a reply is streaming does nothing ----
const before7 = await articles()
await send(long)
await page.waitFor(STOP_SHOWN)
await ev(`document.querySelector('.composer-input').focus()`)
await page.type('x')
await page.press('Enter')
await sleep(100)
check('Enter during a reply: nothing sent', (await articles()) === before7 + 2, `articles ${before7} -> ${await articles()}`)
check('Enter during a reply: no stray newline', (await ev(`document.querySelector('.composer-input').value`)) === 'x')
await page.waitFor(SEND_READY, { timeoutMs: 6000 })
await ev(`(() => { const t = document.querySelector('.composer-input'); t.select() })()`)
await page.type('y') // replace the draft so later steps start clean
await ev(`document.querySelector('.composer-input').select()`)

// ---- 8. Scrolling while a tall reply streams in ----
const tall = Array.from({ length: 40 }, (_, i) => `line ${i + 1}`).join('\n')
await send(tall)
await page.waitFor(`(document.querySelector('.message-assistant:last-child .bubble')?.textContent.length ?? 0) > 20`)
await sleep(400)
const dist = `(() => { const l = document.querySelector('.message-list'); return l.scrollHeight - l.scrollTop - l.clientHeight })()`
check('while streaming, the list stays pinned to the newest text', (await ev(dist)) < 2, `${await ev(dist)}px from bottom`)
const h1 = await ev(`document.querySelector('.message-list').scrollHeight`)
await ev(`document.querySelector('.message-list').scrollTop = 0`)
await sleep(700)
const h2 = await ev(`document.querySelector('.message-list').scrollHeight`)
check('reply kept growing while the reader was scrolled up', h2 > h1, `${h1} -> ${h2}`)
check('reader who scrolled up is NOT yanked back down mid-stream', (await ev(`document.querySelector('.message-list').scrollTop`)) === 0)
await page.waitFor(SEND_READY, { timeoutMs: 8000 })
check('still not yanked after the reply finished', (await ev(`document.querySelector('.message-list').scrollTop`)) === 0)
check('tall reply arrived complete', (await replyText()) === `Echo: ${tall}`)
await page.screenshot(`${shots}/1-3-scrolled-up.png`)
await send('next')
await page.waitFor(`!!document.querySelector('.message-assistant:last-child .bubble')`)
await sleep(200)
check('sending again jumps back to the bottom', (await ev(dist)) < 2, `${await ev(dist)}px from bottom`)
await page.waitFor(SEND_READY)

// ---- 9. Typing dots respect "reduce motion" ----
await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
await send('reduced')
await page.waitFor(`!!document.querySelector('.typing span')`)
check('reduced motion: dots do not animate', (await ev(`getComputedStyle(document.querySelector('.typing span')).animationName`)) === 'none')
await page.waitFor(SEND_READY)
await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] })
await send('animated')
await page.waitFor(`!!document.querySelector('.typing span')`)
check('normal motion: dots animate', (await ev(`getComputedStyle(document.querySelector('.typing span')).animationName`)) === 'typing-pulse')
await page.waitFor(SEND_READY)
await page.send('Emulation.setEmulatedMedia', { features: [] })

// ---- 10. Final look + structure ----
await page.screenshot(`${shots}/1-3-final.png`)
const a11y = await ev(`({ assistants: document.querySelectorAll('article[aria-label=Assistant]').length, users: document.querySelectorAll('article[aria-label=You]').length })`)
check('every user message has an assistant reply', a11y.assistants === a11y.users, JSON.stringify(a11y))
check('nothing is left streaming', await ev(`!document.querySelector('.typing') && !document.querySelector('.composer-button-stop')`))
check('page itself does not scroll', await ev(`document.documentElement.scrollHeight <= innerHeight`))

check('no console errors / warnings / exceptions', page.problems.length === 0, page.problems.join(' | '))
const ok = check.summary()
page.close()
process.exit(ok ? 0 : 1)
