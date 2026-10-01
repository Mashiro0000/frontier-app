// Exercises failure paths the real echo can never take, by swapping the echo module INSIDE the running
// app (DevTools Fetch interception). Nothing in the repository is changed.
import { connect, checker, sleep } from './cdp.mjs'

const shots = process.argv[2]
const port = Number(process.argv[3] ?? 9222)
const check = checker()
const page = await connect(port)

const WRAPPER = `
export async function* ipcReply(history, signal, onAnswerer) {
  const last = history[history.length - 1].content
  if (last === '/fail') throw new Error('Simulated failure')
  if (last === '/fail-mid') { yield 'partial '; throw new Error('Connection lost') }
  if (last === '/fail-string') { throw 'plain string failure' }
  if (last === '/empty') return
  if (last === '/abort-error') {
    yield 'before '
    await new Promise((resolve) => signal.addEventListener('abort', resolve))
    throw new DOMException('The operation was aborted.', 'AbortError')
  }
  if (last === '/late-piece') {
    yield 'first '
    await new Promise((resolve) => signal.addEventListener('abort', resolve))
    yield 'LATE '
    return
  }
  yield* realReply(history, signal, onAnswerer)
}
`
let patched = false
await page.send('Network.enable')
await page.send('Network.setCacheDisabled', { cacheDisabled: true }) // so we get a 200 body, not a 304
await page.send('Fetch.enable', { patterns: [{ urlPattern: '*ipcReply.ts*', requestStage: 'Response' }] })
page.on('Fetch.requestPaused', async (p) => {
  try {
    if (p.responseStatusCode === undefined) return void (await page.send('Fetch.continueRequest', { requestId: p.requestId }))
    const { body, base64Encoded } = await page.send('Fetch.getResponseBody', { requestId: p.requestId })
    let src = base64Encoded ? Buffer.from(body, 'base64').toString('utf8') : body
    const re = /export\s+async\s+function\s*\*\s*ipcReply\s*\(/
    if (!re.test(src)) throw new Error('ipcReply not found in module source: ' + src.slice(0, 200))
    src = src.replace(re, 'async function* realReply(') + WRAPPER
    patched = true
    const headers = p.responseHeaders.filter((h) => h.name.toLowerCase() !== 'content-length')
    await page.send('Fetch.fulfillRequest', { requestId: p.requestId, responseCode: 200, responseHeaders: headers, body: Buffer.from(src).toString('base64') })
  } catch (e) {
    console.error('intercept failed:', e.message)
    await page.send('Fetch.continueRequest', { requestId: p.requestId }).catch(() => {})
  }
})
await page.send('Page.reload')
await sleep(2500)
check('reply module was swapped for the test wrapper', patched)

const ev = (expr) => page.evaluate(expr)
const SEND_READY = `!!document.querySelector('.composer-button[type=submit]')`
const lastAssistant = (expr) => ev(`(() => { const a = [...document.querySelectorAll('.message-assistant')].at(-1); return a ? (${expr}) : null })()`)
const bubbleText = () => lastAssistant(`a.querySelector('.bubble')?.textContent ?? null`)
const noteText = () => lastAssistant(`a.querySelector('.message-note')?.textContent ?? null`)
const send = async (text) => {
  await ev(`(() => { const t = document.querySelector('.composer-input'); t.focus(); t.select() })()`)
  await page.type(text)
  await page.press('Enter')
}

// 1. fails before any text
await send('/fail')
await page.waitFor(SEND_READY, { timeoutMs: 4000 })
check('error before any text: no bubble', await lastAssistant(`!a.querySelector('.bubble')`))
check('error before any text: note shows the error message', (await noteText()) === 'Simulated failure', JSON.stringify(await noteText()))
check('error note is styled as an error (light red)', (await lastAssistant(`getComputedStyle(a.querySelector('.message-note')).color`)) === 'rgb(255, 135, 135)')
check('error: log no longer busy, Send is back', (await ev(`document.querySelector('[role=log]').getAttribute('aria-busy')`)) === 'false')
await page.screenshot(`${shots}/1-3-error.png`)
await send('ok')
await page.waitFor(SEND_READY, { timeoutMs: 4000 })
// History policy (D-013): /fail produced no text, so that reply is left out of the history and the next
// message is sent together with the unanswered one. The mock echoes the whole merged user message.
check('chat works normally after an error (the failed message travels with the next one)', (await bubbleText()) === 'Echo: /fail\n\nok', JSON.stringify(await bubbleText()))

// 2. fails mid-stream: partial text kept + error
await send('/fail-mid')
await page.waitFor(SEND_READY, { timeoutMs: 4000 })
check('error mid-stream: partial text kept', (await bubbleText()) === 'partial ', JSON.stringify(await bubbleText()))
check('error mid-stream: error note shown', (await noteText()) === 'Connection lost')

// 3. provider throws something that is not an Error
await send('/fail-string')
await page.waitFor(SEND_READY, { timeoutMs: 4000 })
check('non-Error throw is still shown as text', (await noteText()) === 'plain string failure', JSON.stringify(await noteText()))

// 4. empty reply
await send('/empty')
await page.waitFor(SEND_READY, { timeoutMs: 4000 })
check('empty reply: explained, not a blank gap', (await noteText()) === 'The reply was empty.' && (await lastAssistant(`!a.querySelector('.bubble')`)))

// 5. provider throws AbortError when stopped -> that is a Stop, not an error
await send('/abort-error')
await page.waitFor(`document.querySelector('.message-assistant:last-child .bubble')?.textContent === 'before '`, { timeoutMs: 4000 })
await page.click('.composer-button-stop')
await page.waitFor(SEND_READY, { timeoutMs: 4000 })
check('AbortError after Stop is shown as "Stopped", not as an error', (await noteText()) === 'Stopped' && (await lastAssistant(`!a.querySelector('.message-note-error')`)), JSON.stringify(await noteText()))
check('AbortError after Stop keeps the partial text', (await bubbleText()) === 'before ')

// 6. provider sends one more piece after Stop -> must be dropped
await send('/late-piece')
await page.waitFor(`document.querySelector('.message-assistant:last-child .bubble')?.textContent === 'first '`, { timeoutMs: 4000 })
await page.click('.composer-button-stop')
await page.waitFor(SEND_READY, { timeoutMs: 4000 })
await sleep(300)
check('a piece that arrives after Stop is ignored', (await bubbleText()) === 'first ', JSON.stringify(await bubbleText()))
check('...and it is marked Stopped', (await noteText()) === 'Stopped')

// 7. unmodified behaviour still flows through the wrapper
await send('still fine')
await page.waitFor(SEND_READY, { timeoutMs: 4000 })
check('normal echo still works', (await bubbleText()) === 'Echo: still fine')

check('no console errors / warnings / exceptions', page.problems.length === 0, page.problems.join(' | '))
const ok = check.summary()
page.close()
process.exit(ok ? 0 : 1)
