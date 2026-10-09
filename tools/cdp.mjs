// Throwaway verification helper (lives outside the project on purpose).
// A tiny Chrome DevTools Protocol client using Node's built-in fetch + WebSocket.
import { writeFileSync } from 'node:fs'

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

export async function connect(port, { timeoutMs = 45000, urlPattern = /^(http|file)/, title = null } = {}) {
  const started = Date.now()
  let target
  while (Date.now() - started < timeoutMs) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
      target = list.find(
        (t) => t.type === 'page' && !t.url.startsWith('devtools:') && urlPattern.test(t.url) && (title === null || t.title === title)
      )
      if (target) break
    } catch {
      // debug port not open yet
    }
    await sleep(500)
  }
  if (!target) throw new Error(`no page target on port ${port} after ${timeoutMs} ms`)

  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    ws.onopen = resolve
    ws.onerror = () => reject(new Error('websocket error'))
  })

  let nextId = 0
  const pending = new Map()
  const problems = []
  // If the page's connection closes (the window was closed, the renderer or the whole app died), every call still waiting would
  // wait forever and Node would end the script with only "unsettled top-level await": no summary line, which the driver shows
  // as 0/0. Fail the waiting calls, and every later one, with a message that says what happened.
  const connectedAt = Date.now()
  let closedAfterMs = null
  ws.onclose = () => {
    closedAfterMs = Date.now() - connectedAt
    for (const { reject, method } of pending.values()) reject(new Error(`the page connection closed ${closedAfterMs} ms after connecting (the window, the renderer or the app went away) while waiting for ${method}`))
    pending.clear()
  }
  const listeners = new Map() // event name -> handlers
  const on = (method, handler) => listeners.set(method, [...(listeners.get(method) ?? []), handler])
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data)
    if (msg.method) for (const handler of listeners.get(msg.method) ?? []) handler(msg.params)
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id)
      pending.delete(msg.id)
      if (msg.error) reject(new Error(`${msg.error.message} (${JSON.stringify(msg.error)})`))
      else resolve(msg.result)
    } else if (msg.method === 'Runtime.exceptionThrown') {
      problems.push('exception: ' + (msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text))
    } else if (msg.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(msg.params.type)) {
      problems.push(`console.${msg.params.type}: ` + msg.params.args.map((a) => a.value ?? a.description).join(' '))
    } else if (msg.method === 'Log.entryAdded' && ['error', 'warning'].includes(msg.params.entry.level)) {
      problems.push(`log.${msg.params.entry.level}: ${msg.params.entry.text} ${msg.params.entry.url ?? ''}`)
    }
  }

  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      if (closedAfterMs !== null) return reject(new Error(`the page connection is closed (it closed ${closedAfterMs} ms after connecting); cannot send ${method}`))
      const id = ++nextId
      pending.set(id, { resolve, reject, method })
      ws.send(JSON.stringify({ id, method, params }))
    })

  const navs = []
  const clicks = []
  on('Page.frameNavigated', (p) => { if (!p.frame.parentId) navs.push({ t: Date.now(), url: p.frame.url }) })
  await send('Runtime.enable')
  await send('Log.enable')
  await send('Page.enable')

  // Evaluate an expression in the page; returns the JSON-able result.
  const latencies = [] // [time, ms the page took to answer]
  const evaluate = async (expression) => {
    const t0 = Date.now()
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    latencies.push([t0, Date.now() - t0])
    if (latencies.length > 400) latencies.shift()
    if (r.exceptionDetails) {
      throw new Error('eval failed: ' + (r.exceptionDetails.exception?.description ?? r.exceptionDetails.text))
    }
    return r.result.value
  }

  // A window that the system hides or covers makes the page report visibilityState "hidden", and then input is acknowledged only after about
  // 5 s and sometimes dropped (tools/README.md, "Hidden windows"). Before any input: if the page says hidden, ask for the window to be brought
  // to the front and wait (up to 3 s) for "visible", and SAY so (the "!!" line is counted by the drivers, so the rate stays visible).
  // Added 2 October 2026 (8.1) after runs in which the Claude desktop app covered the test window; it does nothing when the page is visible.
  let hiddenTimes = 0
  const ensureVisible = async () => {
    if ((await evaluate(`document.visibilityState`)) !== 'hidden') return
    const t0 = Date.now()
    await send('Page.bringToFront').catch(() => undefined)
    while (Date.now() - t0 < 3000 && (await evaluate(`document.visibilityState`)) === 'hidden') await sleep(100)
    hiddenTimes += 1
    console.log(`!! the window was hidden before an input (#${hiddenTimes}); Page.bringToFront ${(await evaluate(`document.visibilityState`)) === 'hidden' ? 'did NOT make it visible' : 'made it visible'} after ${Date.now() - t0} ms`)
  }

  // Type text as if pasted/committed into the focused element.
  const type = async (text) => { await ensureVisible(); return send('Input.insertText', { text }) }

  const KEYS = {
    Enter: { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, text: '\r' },
    Escape: { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 },
    Tab: { key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 },
    ArrowDown: { key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40, nativeVirtualKeyCode: 40 },
    ArrowUp: { key: 'ArrowUp', code: 'ArrowUp', windowsVirtualKeyCode: 38, nativeVirtualKeyCode: 38 }
  }
  const press = async (name, { shift = false } = {}) => {
    await ensureVisible()
    const k = KEYS[name]
    const modifiers = shift ? 8 : 0
    await send('Input.dispatchKeyEvent', { type: 'keyDown', modifiers, ...k })
    await send('Input.dispatchKeyEvent', { type: 'keyUp', modifiers, ...k, text: undefined })
  }

  // Real mouse click at the centre of the first element matching the selector.
  const click = async (selector) => {
    // 'css@Text' = the first element matching css whose text is exactly Text (the header now has several .header-button)
    clicks.push({ t: Date.now(), selector })
    const [css, text] = selector.split('@')
    const box = await evaluate(`(() => { const el = [...document.querySelectorAll(${JSON.stringify(css)})].find((e) => ${text === undefined ? 'true' : `e.textContent.trim() === ${JSON.stringify(text)}`}); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })()`)
    if (!box) throw new Error('click: no element for ' + selector)
    await ensureVisible()
    const tMouse = Date.now()
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y })
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', clickCount: 1 })
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x, y: box.y, button: 'left', clickCount: 1 })
    const mouseAckMs = Date.now() - tMouse
    // A window that is hidden or covered acknowledges mouse events only after ~5 s while the page itself answers at once.
    if (mouseAckMs > 1500) console.log(`!! slow mouse acknowledgement: ${mouseAckMs} ms for a click on ${selector}; window state: ${await evaluate(`document.visibilityState + ', focus ' + document.hasFocus()`)}`)
    // A real click on Settings was lost 4 times in ~130 launches (unexplained, not reproducible in 150 rapid tries). Click again
    // once, and SAY SO, so the rate stays visible instead of hiding in a retry.
    if (text === 'Settings') {
      try { await waitFor(`!!document.querySelector('dialog.settings')?.open`, { timeoutMs: 2500 }) } catch {
        console.log('!! retry: a click on Settings did not open the dialog within 2.5 s; clicking again. Page: ' + await evaluate(`JSON.stringify({ readyState: document.readyState, visibility: document.visibilityState, hasFocus: document.hasFocus(), dialogs: [...document.querySelectorAll('dialog')].map((d) => d.className + ':' + d.open), active: document.activeElement?.tagName + '.' + document.activeElement?.className, disabled: [...document.querySelectorAll('.header-button')].map((b) => b.textContent + (b.disabled ? '(disabled)' : '')), under: (() => { const b = [...document.querySelectorAll('.header-button')].find((e) => e.textContent === 'Settings'); const r = b.getBoundingClientRect(); const el = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return el ? el.tagName + '.' + el.className : null })() })`) + ' | the three mouse events took ' + mouseAckMs + ' ms to be acknowledged | slowest page answers in the last 15 s (ms): ' + JSON.stringify(latencies.filter(([t]) => Date.now() - t < 15000).map(([, ms]) => ms).sort((a, b) => b - a).slice(0, 4)) + ' | navigations since start (ms ago): ' + JSON.stringify(navs.map((n) => Date.now() - n.t)) + ' | clicks (ms ago): ' + JSON.stringify(clicks.map((c) => Date.now() - c.t)))
        await ensureVisible()
        await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y })
        await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', clickCount: 1 })
        await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x, y: box.y, button: 'left', clickCount: 1 })
      }
    }
  }

  const screenshot = async (path) => {
    const r = await send('Page.captureScreenshot', { format: 'png' })
    writeFileSync(path, Buffer.from(r.data, 'base64'))
    return path
  }

  // Wait until a page expression is truthy (polls every 50 ms).
  const waitFor = async (expression, { timeoutMs = 8000, label = expression } = {}) => {
    const t0 = Date.now()
    while (Date.now() - t0 < timeoutMs) {
      if (await evaluate(expression)) return Date.now() - t0
      await sleep(50)
    }
    throw new Error(`timed out waiting for: ${label}`)
  }

  return { send, on, evaluate, type, press, click, screenshot, waitFor, problems, navs, clicks, close: () => ws.close(), url: target.url }
}

// Tiny assertion recorder so every check is printed as PASS/FAIL.
export function checker() {
  const results = []
  const check = (name, ok, detail = '') => {
    results.push({ name, ok: !!ok })
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -> ' + detail : ''}`)
  }
  check.summary = () => {
    const failed = results.filter((r) => !r.ok)
    console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
    return failed.length === 0
  }
  return check
}
