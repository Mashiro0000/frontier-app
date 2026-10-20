// Shared helpers for the Stage 4 window suites (test harness; lives outside the project on purpose).
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { sleep } from './cdp.mjs'
import { helpers } from './lib3.mjs'

export const UUID_FILE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.json$/
/** Reads like readFileSync, but waits out the app's own write: Windows locks a file while it is copied over. */
export function readRetry(path, encoding) {
  let last
  for (let i = 0; i < 80; i++) {
    try { return readFileSync(path, encoding) } catch (e) { last = e; if (!['EBUSY', 'EPERM', 'EACCES'].includes(e.code)) throw e; Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25) }
  }
  throw last
}
/** The parsed JSON of a file; a read that landed in the middle of a copy (truncated JSON) is read again. */
export function readJsonRetry(path) {
  let last
  for (let i = 0; i < 80; i++) {
    try { return JSON.parse(readRetry(path, 'utf8')) } catch (e) { last = e; if (!(e instanceof SyntaxError)) throw e; Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25) }
  }
  throw last
}
export const shaFile = (path) => createHash('sha256').update(readRetry(path)).digest('hex').slice(0, 16)
/** What a person SEES of a saved message. A reply is drawn as Markdown since 7.2: its paragraphs are elements and a trailing space is gone
 *  (the person's own message is shown as typed). `screen()` reads a reply as `innerText`; compare it with `shown(role, saved)`, never the raw file text. */
export const shown = (role, content) => (role === 'assistant' ? content.trim() : content)

export function h4(page, { userData, mockUrl }) {
  const H = helpers(page, { userData, mockUrl })
  const ev = H.ev
  const dir = join(userData, 'conversations')
  const H4 = {
    ...H,
    dir,
    /** Every file name in the conversations folder, or null if the folder does not exist. */
    files: () => (existsSync(dir) ? readdirSync(dir).sort() : null),
    convFiles: () => (H4.files() ?? []).filter((n) => UUID_FILE.test(n)),
    /** Anything in the folder that is not a plain "<id>.json" (a leftover .tmp, a backup...). */
    strays: () => (H4.files() ?? []).filter((n) => !UUID_FILE.test(n)),
    readConv: (id) => readJsonRetry(join(dir, `${id}.json`)),
    rawConv: (id) => readRetry(join(dir, `${id}.json`), 'utf8'),
    allConvs: () => H4.convFiles().map((n) => readJsonRetry(join(dir, n))),
    mtime: (id) => statSync(join(dir, `${id}.json`)).mtimeMs,
    sha: (id) => shaFile(join(dir, `${id}.json`)),
    /** Waits until the file for `id` exists and `pred(conversation)` holds; returns the conversation. */
    waitConv: async (id, pred, timeoutMs = 6000) => {
      const t0 = Date.now()
      let last = null
      while (Date.now() - t0 < timeoutMs) {
        try { last = H4.readConv(id); if (pred(last)) return last } catch { /* not there yet */ }
        await sleep(40)
      }
      throw new Error('timed out waiting for the saved conversation to match; last seen: ' + JSON.stringify(last)?.slice(0, 200))
    },
    /** Waits until a conversation file whose first message starts with `text` exists and `pred` holds. */
    waitFirst: async (text, pred = () => true, timeoutMs = 6000) => {
      const t0 = Date.now()
      while (Date.now() - t0 < timeoutMs) {
        const found = H4.byFirst(text)
        if (found && pred(found.conv)) return found
        await sleep(40)
      }
      throw new Error('timed out waiting for a saved conversation starting with ' + JSON.stringify(text))
    },
    /** The conversation file whose first message starts with `text`, as { id, conv }. */
    byFirst: (text) => {
      for (const n of H4.convFiles()) {
        const conv = readJsonRetry(join(dir, n))
        if (conv.messages[0]?.content.startsWith(text)) return { id: n.replace('.json', ''), conv }
      }
      return null
    },
    // Settings is the one .header-button: in the header until D-051, at the foot of the sidebar since. The chat's buttons (.chat-button) were in a bar
    // under the message box from 7.6 (D-029); since D-051 New chat, History and Tools are in the sidebar and the rest in the message box.
    headerButtons: () => ev(`[...document.querySelectorAll('.header-button')].map((b) => ({ text: b.textContent, disabled: b.disabled, title: b.title }))`),
    headerButton: async (text) => (await H4.headerButtons()).find((b) => b.text === text),
    clickHeader: (text) => page.click(`.header-button@${text}`),
    chatButtons: () => ev(`[...document.querySelectorAll('.chat-button')].map((b) => ({ text: b.textContent, disabled: b.disabled, title: b.title }))`),
    chatButton: async (text) => (await H4.chatButtons()).find((b) => b.text === text),
    clickChat: (text) => page.click(`.chat-button@${text}`),
    /** The messages on screen: [{ role, text, note }]. A reply is read as a person sees it (innerText), the person's own message as typed (see `shown`). */
    screen: () => ev(`[...document.querySelectorAll('.message')].map((m) => { const user = m.classList.contains('message-user'); const b = m.querySelector('.bubble'); return { role: user ? 'user' : 'assistant', text: b ? (user ? b.textContent : b.innerText) : '', note: m.querySelector('.message-note')?.textContent ?? null } })`),
    emptyHint: () => ev(`document.querySelector('.empty-state')?.innerText ?? null`),
    replyReady: () => ev(`!!document.querySelector('.composer-button[type=submit]')`),
    waitReady: (timeoutMs = 15000) => page.waitFor(`!!document.querySelector('.composer-button[type=submit]')`, { timeoutMs }),
    historyOpen: () => ev(`!!document.querySelector('dialog.history')?.open`),
    openHistory: async () => { await H4.clickChat('History'); await page.waitFor(`!!document.querySelector('dialog.history')?.open`); await sleep(120) },
    closeHistory: async () => { await page.press('Escape'); await sleep(200) },
    rows: () => ev(`[...document.querySelectorAll('dialog.history .history-row')].map((r) => ({ title: r.querySelector('.history-title')?.textContent ?? null, meta: r.querySelector('.history-meta')?.textContent ?? null, current: r.querySelector('.history-open')?.getAttribute('aria-current') === 'true', asking: !!r.querySelector('.history-ask'), buttons: [...r.querySelectorAll('button')].map((b) => b.textContent), disabled: [...r.querySelectorAll('button')].every((b) => b.disabled) }))`),
    historyText: () => ev(`document.querySelector('dialog.history')?.innerText ?? ''`),
    /** Clicks a row's open button (by title). */
    clickRow: async (title) => {
      // A click lands where the row is ON SCREEN, and the list scrolls when the rows and the notes under them do not all fit (8b.3's longer hint made six rows too many for a 634 px window).
      await ev(`(() => { const r = [...document.querySelectorAll('dialog.history .history-row')].find((x) => x.querySelector('.history-title').textContent === ${JSON.stringify(title)}); r.querySelector('.history-open').scrollIntoView({ block: 'center' }); r.querySelector('.history-open').setAttribute('data-click', '1') })()`)
      await page.click('dialog.history .history-open[data-click="1"]')
      await ev(`document.querySelector('[data-click="1"]')?.removeAttribute('data-click')`)
    },
    /** Clicks a button inside a row: `which` is the button's text; `title` the row's title. Marks it, clicks it for real. */
    clickRowButton: async (title, which) => {
      const marked = await ev(`(() => { const r = [...document.querySelectorAll('dialog.history .history-row')].find((x) => x.querySelector('.history-title').textContent === ${JSON.stringify(title)}); const b = r && [...r.querySelectorAll('button')].find((x) => x.textContent === ${JSON.stringify(which)}); if (!b) return false; b.scrollIntoView({ block: 'center' }); b.setAttribute('data-click', '1'); return true })()`)
      if (!marked) throw new Error(`no "${which}" button in the row "${title}"`)
      await page.click('[data-click="1"]')
      await ev(`document.querySelector('[data-click="1"]')?.removeAttribute('data-click')`)
    },
    focusedText: () => ev(`document.activeElement ? (document.activeElement.textContent || document.activeElement.className || document.activeElement.tagName) : ''`),
    /** What the mock was sent, last request first. */
    lastRequest: async () => (await H4.mockReqs()).at(-1),
    /** The text of the messages as the provider is told about them (D-013: empty ones left out, same sides joined). */
    wireFrom: (messages) => {
      const out = []
      for (const m of messages.filter((x) => x.content !== '')) {
        const last = out.at(-1)
        if (last && last.role === m.role) last.content += '\n\n' + m.content
        else out.push({ role: m.role, content: m.content })
      }
      return out
    }
  }
  return H4
}

/** A connection to the Electron MAIN process through Node's inspector (INSPECT_PORT), for facts only main knows. */
export async function mainInspector(inspectPort) {
  // Retry for a few seconds: a refused port is either "not open yet" or "the app is already gone", and the error must say which.
  let list, lastError
  const t0 = Date.now()
  while (!list && Date.now() - t0 < 8000) {
    try { list = await (await fetch(`http://127.0.0.1:${inspectPort}/json/list`)).json() } catch (e) { lastError = e; await sleep(250) }
  }
  if (!list) throw new Error(`the main process's inspector port ${inspectPort} refused connections for ${Date.now() - t0} ms (${lastError?.cause?.code ?? lastError?.message}): the app is not running, or it was started without INSPECT_PORT`)
  const ws = new WebSocket(list[0].webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(new Error('main inspector ws error')) })
  let n = 0
  const waiting = new Map()
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id) } }
  let closed = false
  ws.onclose = () => { closed = true; for (const answer of waiting.values()) answer({ error: 'the main inspector connection closed (the app went away)' }); waiting.clear() }
  const inMain = (expression) => new Promise((resolve, reject) => {
    if (closed) return reject(new Error('the main inspector connection is closed (the app went away)'))
    const id = ++n
    waiting.set(id, (m) => (m.error || m.result.exceptionDetails ? reject(new Error(JSON.stringify(m.error ?? m.result.exceptionDetails.exception?.description))) : resolve(m.result.result.value)))
    ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true } }))
  })
  return { inMain, close: () => ws.close() }
}

/** Waits until the app's debug port stops answering (the app has really exited). Returns milliseconds waited, or null. */
export async function waitForExit(port, timeoutMs = 20000) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    try { await fetch(`http://127.0.0.1:${port}/json`) } catch { return Date.now() - t0 }
    await sleep(100)
  }
  return null
}
