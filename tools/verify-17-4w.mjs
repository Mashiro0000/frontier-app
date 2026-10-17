// Slice 17.4 (D-049) in the real window, against the mock's Gemini stand-in, the folder dialog and the system's box stood in for from the main inspector: the app's
// tools with a Gemini model. What it shows:
//   A. (setup) a Google and an Anthropic key; the web search switched on; a code workspace chosen and its tools switched on (each asked in the box, answered yes);
//   B. Gemini 3.8 Flash asks to list the files: the question in the box names Google; the request offered the workspace's four tools and NOT the web search; the
//      result goes back as a functionResponse by name and id, with the turn and its signature; the model answers from it; the call shows in the reply;
//   C. the same chat with Claude Opus 5.5: the web search IS offered there, as before;
//   D. a Gemini model that asks for the web search anyway: refused with no question and no search, and told to the model as an error;
//   E. every request of the loop is in the ledger as Google's; the saved chat keeps the calls; the page logged nothing.
// Needs: USER_DATA_DIR (scratch), INSPECT_PORT, MOCK_PORT.
import './temp-on-a.mjs'
import './ts-resolve.mjs'
import { connect, checker, sleep } from './cdp.mjs'
import { assertScratchProfile } from './profile-guard.mjs'
import { mainInspector, h4 } from './lib4.mjs'
import { installQuestions, linesOf } from './lib10.mjs'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
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
const KEY_A = 'sk-ant-api03-' + randomBytes(24).toString('hex')
const control = (body) => fetch(`${mockUrl}/__tools`, { method: 'POST', body: JSON.stringify(body) })
const reqs = async () => (await H.mockReqs()).filter((r) => !r.listing)
const google = async () => (await reqs()).filter((r) => r.provider === 'google')
const ledger = () => { const f = join(userData, 'usage', 'ledger.jsonl'); return existsSync(f) ? readFileSync(f, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : [] }
const declared = (r) => (r?.body?.tools ?? []).flatMap((t) => t.functionDeclarations ?? []).map((d) => d.name)
const converse = async (text, timeoutMs = 40000) => { await H.send(text); await sleep(300); await page.waitFor(`!!document.querySelector('.composer-button[type=submit]')`, { timeoutMs }); await sleep(300) }

// the scratch workspace (in this run's own temporary folder)
const base = mkdtempSync(join(tmpdir(), 'frontier-174w-'))
const WS = join(realpathSync.native(base), 'project')
mkdirSync(WS, { recursive: true })
writeFileSync(join(WS, 'notes.txt'), 'POSITIVE-notes\nsecond line')
await main.inMain(`(() => { const { dialog } = process.mainModule.require('electron'); const p = globalThis.__pick = { next: null }; dialog.showOpenDialog = async () => (p.next === null ? { canceled: true, filePaths: [] } : { canceled: false, filePaths: [p.next] }); return true })()`)

try {
  await fetch(`${mockUrl}/__reset`, { method: 'POST' })
  await part('A', async () => {
    await Q.fallback('yes')
    check('A: (setup) a Google key and an Anthropic key saved', (await ev(`window.api.settings.setApiKey('google', ${JSON.stringify(KEY_G)})`)).ok && (await ev(`window.api.settings.setApiKey('anthropic', ${JSON.stringify(KEY_A)})`)).ok)
    await sleep(200)
    const search = await ev(`window.api.tools.setEnabled('web_search', true)`)
    await main.inMain(`globalThis.__pick.next = ${JSON.stringify(WS)}; true`)
    const chosen = await ev(`window.api.workspace.choose()`)
    await sleep(200)
    const on = await ev(`window.api.workspace.setOn(true)`)
    const status = await ev(`window.api.tools.status()`)
    const enabled = status.tools?.filter((t) => t.on).map((t) => t.id) ?? []
    check('A: (setup) the web search on, the workspace chosen and its tools on (each answered yes in the box)', JSON.stringify(search).length > 0 && JSON.stringify(chosen).length > 0 && JSON.stringify(on).length > 0 && enabled.includes('web_search'), show([enabled, chosen, on]))
    await Q.fallback('no')
  })

  await part('B', async () => {
    await H.chooseInPage('gemini-3.8-flash')
    await H.settle('gemini-3.8-flash')
    await control({ name: 'list_files', args: { path: '.', why: 'To see the files.' } })
    await Q.reset()
    await Q.queue('yes')
    const before = (await google()).length
    await converse('[[mock:tool-use]] what files do I have?')
    const asked = await Q.asked()
    const g = (await google()).slice(before)
    check('B: one question in the box for the file access of this reply, and it names Google as the provider that gets the text', asked.length === 1 && linesOf(asked[0]).some((l) => /Google/.test(l)), show(asked.map((a) => linesOf(a))))
    check('B: two requests to Google: the one that asked, and the one with the result', g.length === 2 && g.every((r) => r.problems.length === 0), show(g.map((r) => r.problems)))
    check('B: the workspace\'s tools were offered as function declarations, and the web search was NOT (though it is switched on)', declared(g[0]).includes('list_files') && declared(g[0]).includes('read_file') && !declared(g[0]).includes('web_search') && JSON.stringify(g[0].body.toolConfig) === JSON.stringify({ functionCallingConfig: { mode: 'AUTO' } }), show(declared(g[0])))
    const second = g[1]?.body.contents ?? []
    const response = second.at(-1)?.parts?.[0]?.functionResponse
    check('B: the second request: the model\'s turn sent back with its thought signature, then a functionResponse for list_files with the call\'s id and the listing', second.at(-2)?.role === 'model' && second.at(-2).parts.some((p) => p.functionCall?.name === 'list_files' && typeof p.thoughtSignature === 'string') && response?.name === 'list_files' && /^gcall_mock_/.test(response.id ?? '') && /notes\.txt/.test(JSON.stringify(response.response)), show(second.slice(-2)))
    check('B: the words before the call, the call (you allowed it), and the model\'s answer from the result are shown', /^Let me search for that\./.test((await H.bubbleText()) ?? '') && /You allowed it\./.test((await H.bubbleText()) ?? '') && /The search found: The contents of the folder "\." in the person's workspace/.test((await H.bubbleText()) ?? ''), show(await H.bubbleText()))
    check('B: the call shows in the reply', (await ev(`[...document.querySelectorAll('.message-assistant .tool-note')].length`)) >= 1)
  })

  await part('C', async () => {
    await H.chooseInPage('claude-opus-5-5')
    await H.settle('claude-opus-5-5')
    await H.clickChat('New chat')
    await sleep(300)
    const r = await H.askMock('hello Claude, with tools')
    check('C: with Claude Opus 5.5 the web search IS offered (beside the workspace\'s tools), as before Stage 17', (r?.body.tools ?? []).some((t) => t.name === 'web_search') && (r?.body.tools ?? []).some((t) => t.name === 'list_files'), show((r?.body.tools ?? []).map((t) => t.name)))
  })

  await part('D', async () => {
    await H.chooseInPage('gemini-3.8-flash')
    await H.settle('gemini-3.8-flash')
    await H.clickChat('New chat')
    await sleep(300)
    await control({ name: 'web_search', args: { query: 'rust release notes', why: 'The person asked.' } })
    await Q.reset()
    const before = (await reqs()).length
    await converse('[[mock:tool-use]] search the web for me')
    const after = (await reqs()).slice(before)
    const answer = after.filter((r) => r.provider === 'google').at(-1)?.body.contents.at(-1)?.parts?.[0]?.functionResponse
    check('D: a Gemini model that asks for the web search anyway: no question in the box', (await Q.count()) === 0)
    check('D: ... no search request to any provider, only the two requests to Google', after.length === 2 && after.every((r) => r.provider === 'google'), show(after.map((r) => r.provider)))
    check('D: ... and the model is told, as an error: "That tool is switched off."', answer?.name === 'web_search' && JSON.stringify(answer.response) === JSON.stringify({ error: 'That tool is switched off.' }) && /The tool failed: That tool is switched off\./.test((await H.bubbleText()) ?? ''), show([answer, await H.bubbleText()]))
  })

  await part('E', async () => {
    await sleep(400)
    const records = ledger().filter((l) => l.provider === 'google' && l.model === 'gemini-3.8-flash')
    const ids = new Set(records.map((l) => l.id))
    check('E: every request of the two Gemini replies is in the ledger as Google\'s (four requests)', ids.size === 4, String(ids.size))
    const saved = await H.waitFirst('[[mock:tool-use]] what files do I have?', (c) => c.messages.some((m) => m.role === 'assistant' && m.provider === 'google'))
    check('E: the saved chat says Google answered, and keeps the call of list_files (not the files\' text)', saved.conv.messages.some((m) => m.provider === 'google' && /list_files/.test(JSON.stringify(m))) && !JSON.stringify(saved.conv).includes('POSITIVE-notes'), show(saved.conv.messages.map((m) => [m.role, m.provider])))
    check('E: the page logged no error or warning', page.problems.length === 0, show(page.problems))
  })
} finally {
  const ok = check.summary()
  process.exit(ok ? 0 : 1)
}
