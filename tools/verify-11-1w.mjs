// Stage 11.1 (D-041), in the real window against the mock: the tool registry and the permission core are in main, and NOTHING in the app can reach them yet
// (11.3 wires the loop). So this suite proves that nothing changed and nothing new is reachable: a request carries no tools and no tool choice, to either
// provider; the bridge (window.api) is exactly Stage 10's and nothing in it, at any depth, is a tool, an approval or an audit function; the main process has
// no message handler with such a name; a model that asks for a tool (the mock's [[mock:tool-use]]) gets nothing: its text is shown, no second request is made,
// no system box opens, and the saved chat holds no tool call; Settings and the page say nothing of tools; no console errors.
// Needs: USER_DATA_DIR (scratch), INSPECT_PORT, MOCK_PORT, a saved key (setup-key.mjs).
import './ts-resolve.mjs'
import { connect, checker, sleep } from './cdp.mjs'
import { assertScratchProfile } from './profile-guard.mjs'
import { h4, mainInspector } from './lib4.mjs'
import { installQuestions } from './lib10.mjs'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { REPO } from './paths.mjs'

const port = Number(process.argv[3] ?? 9222)
const userData = process.env.USER_DATA_DIR
const inspectPort = Number(process.env.INSPECT_PORT)
const mockUrl = `http://127.0.0.1:${process.env.MOCK_PORT}`
if (!userData || !inspectPort || !process.env.MOCK_PORT) throw new Error('USER_DATA_DIR, INSPECT_PORT and MOCK_PORT must be set')
const check = checker()
const page = await connect(port)
await assertScratchProfile()
const H = h4(page, { userData, mockUrl })
const { ev } = H
const main = await mainInspector(inspectPort)
const Q = await installQuestions(main, { fallback: 'no' })
const show = (v) => JSON.stringify(v)?.slice(0, 400)
const OPENAI_KEY = 'sk-proj-' + 'T4kq9Vw2Lr7Xm3Jc8Hn1Pd6Bs0Gf5Uy2Ze7Wa4Ro9Mi3Vt8Qk1Hx6Nb0Dl5Pj2Cf8Sy3Lu7Ev4Rw9Mq1Ka6Gz0Cn5Hd'
const TOOLISH = /tool|audit|approv/i
const sentTools = (r) => ['tools', 'tool_choice', 'max_tool_calls', 'parallel_tool_calls'].filter((k) => k in (r?.body ?? {}))

try {
  await page.waitFor(`document.readyState === 'complete' && !!document.querySelector('.header-select, .app-badge')`, { timeoutMs: 15000 })
  await sleep(300)

  // ============ A. a request carries no tools ============
  let r = await H.askMock('[[mock:count]] hello, nothing is switched on')
  check('A: a request to Anthropic carries no tool and no tool choice', r?.provider === 'anthropic' && sentTools(r).length === 0, show(Object.keys(r?.body ?? {})))
  check('A: ...and the app\'s rules say nothing of tools or of searching', !/tool|search the web|web_search/i.test(r?.body?.system ?? ''), show(r?.body?.system?.slice(0, 200)))
  const keysAnthropic = Object.keys(r?.body ?? {}).sort()
  check('A: ...the request has exactly the fields of Stage 10 (nothing new was added to it)', ['cache_control', 'max_tokens', 'messages', 'model', 'output_config', 'stream', 'system'].every((k) => keysAnthropic.includes(k)) && keysAnthropic.every((k) => ['cache_control', 'max_tokens', 'messages', 'model', 'output_config', 'stream', 'system'].includes(k)), show(keysAnthropic))
  const set = await ev(`window.api.settings.setApiKey('openai', ${JSON.stringify(OPENAI_KEY)})`)
  const chose = await ev(`window.api.settings.setModel('gpt-6-luna')`)
  check('A: (an OpenAI key is saved and its model chosen)', set.ok === true && chose.ok === true, show([set.ok, chose]))
  await H.clickChat('New chat')
  r = await H.askMock('[[mock:count]] hello to the other provider')
  check('A: a request to OpenAI carries no tool, no tool choice and no cap on tool calls either', r?.provider === 'openai' && sentTools(r).length === 0, show([r?.provider, Object.keys(r?.body ?? {})]))
  check('A: ...nor does its instructions text say anything of tools', !/tool|search the web|web_search/i.test(r?.body?.instructions ?? ''))
  await ev(`window.api.settings.setModel('claude-opus-5-5')`)
  await H.clickChat('New chat')

  // ============ B. the bridge ============
  const api = await ev(`(() => {
    const names = []
    const walk = (value, path, depth) => {
      if (depth > 4 || value === null || (typeof value !== 'object' && typeof value !== 'function')) return
      for (const key of Object.keys(value)) { names.push(path + key); walk(value[key], path + key + '.', depth + 1) }
    }
    walk(window.api, '', 0)
    return { top: Object.keys(window.api).sort(), names }
  })()`)
  check('B: window.api is exactly Stage 10\'s eight groups (attachments, chat, history, instructions, memory, projects, settings, usage)', show(api.top) === show(['attachments', 'chat', 'history', 'instructions', 'memory', 'projects', 'settings', 'usage']), show(api.top))
  check('B: nothing in it, at any depth, is called a tool, an approval or an audit', !api.names.some((n) => TOOLISH.test(n)), show(api.names.filter((n) => TOOLISH.test(n))))
  check('B: ...and the walk reached the functions of the groups (54 names at the end of Stage 10)', api.names.length >= 50, String(api.names.length))

  // ============ C. the main process ============
  const handlers = JSON.parse(await main.inMain(`JSON.stringify([...process.mainModule.require('electron').ipcMain._invokeHandlers.keys()].sort())`))
  check('C: main has message handlers for the page (the list could be read: 41 at the end of Stage 10)', handlers.length >= 38 && handlers.some((h) => /settings/.test(h)), String(handlers.length))
  check('C: ...none of them has tool, approval or audit in its name', !handlers.some((h) => TOOLISH.test(h)), show(handlers.filter((h) => TOOLISH.test(h))))
  const listeners = JSON.parse(await main.inMain(`JSON.stringify(process.mainModule.require('electron').ipcMain.eventNames().map(String).sort())`))
  check('C: ...nor does any one-way listener', !listeners.some((h) => TOOLISH.test(h)), show(listeners))

  // ============ D. a model that asks for a tool gets nothing ============
  await Q.reset()
  const before = (await H.mockReqs()).length
  r = await H.askMock('[[mock:tool-use]] find the newest release of Rust')
  await sleep(600)
  const after = await H.mockReqs()
  const screen = await H.screen()
  const reply = screen.at(-1)
  check('D: the mock answered with a tool call, as a model would that wants to search', r?.directive === 'tool-use' && sentTools(r).length === 0, show(r?.directive))
  check('D: the reply\'s text is shown and the reply finished, with no error', reply?.role === 'assistant' && /Let me search for that\./.test(reply.text) && reply.note === null && (await H.replyReady()), show(reply))
  check('D: nothing was run and nothing followed: no second request was made', after.length === before + 1, show([before, after.length]))
  check('D: no system box was opened', (await Q.count()) === 0, show(await Q.asked()))
  check('D: the page shows no dialog, no tool activity and no approval', (await ev(`[...document.querySelectorAll('dialog')].filter((d) => d.open).length`)) === 0 && !(await ev(`document.body.innerText`)).match(/web_search|tool call|Allow this/i))
  const files = H.convFiles()
  await sleep(500)
  const saved = H.allConvs().find((c) => (c.messages ?? []).some((m) => /find the newest release of Rust/.test(m.content ?? '')))
  const savedText = saved ? JSON.stringify(saved) : ''
  check('D: the saved chat holds the text of the reply and no tool call', !!saved && /Let me search for that\./.test(savedText) && !/tool_use|toolu_|web_search/.test(savedText), show(savedText.slice(0, 300)) + ` (${files.length} chats)`)
  r = await H.askMock('[[mock:count]] and then an ordinary message')
  check('D: the next message of the chat is an ordinary request (the tool call left nothing in it)', r !== null && sentTools(r).length === 0 && !JSON.stringify(r.body.messages).includes('toolu_') && !JSON.stringify(r.body.messages).includes('tool_use'), show(JSON.stringify(r?.body?.messages).slice(0, 300)))

  // ============ F. the program that is running holds none of it ============
  const bundle = readFileSync(join(REPO, 'out', 'main', 'index.js'), 'utf8')
  const NEW_TEXT = ['That tool does not exist.', 'The person did not allow this.', 'a name Windows treats as a device', 'The model asked to use a tool.', 'Search the web']
  check('F: the main program that is running (out/main/index.js) holds none of the new code: nothing imports it, so the bundler left it out', bundle.length > 100000 && NEW_TEXT.every((t) => !bundle.includes(t)), show([bundle.length, NEW_TEXT.filter((t) => bundle.includes(t))]))

  // ============ E. the page says nothing of tools ============
  await page.click('.header-button@Settings')
  await page.waitFor(`!!document.querySelector('dialog.settings')?.open`, { timeoutMs: 8000, label: 'Settings' })
  await sleep(400)
  const settingsText = await ev(`document.querySelector('dialog.settings').innerText`)
  check('E: Settings says nothing of tools, searches or approvals (nothing can be switched on yet)', !/\btools?\b|web search|search the web|approval|audit/i.test(settingsText), show(settingsText.slice(0, 200)))
  await page.press('Escape')
  await sleep(300)
  // (the chat's own messages are left out: this suite's own text, "find the newest release", is in them)
  const chrome = await ev(`['.app-header', '.chat-bar', '.composer'].map((s) => document.querySelector(s)?.innerText ?? '').join('\\n')`)
  check('E: nor does the page itself (the header, the chat bar, the message box)', chrome.length > 40 && !/\btools?\b|web search|search the web|audit/i.test(chrome), show(chrome.slice(0, 200)))
  const buttons = await ev(`[...document.querySelectorAll('.app-header button, .chat-bar button, .composer button, dialog.settings button')].map((b) => b.textContent.trim()).filter(Boolean)`)
  check('E: no button of the page is about tools, a search or an audit log', buttons.length >= 8 && !buttons.some((b) => /tool|search|audit|stop everything/i.test(b)), show(buttons))
} catch (error) {
  check(`the suite stopped before its end: ${String(error?.stack ?? error).slice(0, 400)}`, false)
}

check('the page logged no errors and no warnings', page.problems.length === 0, show(page.problems))
main.close()
page.close()
process.exit(check.summary() ? 0 : 1)
