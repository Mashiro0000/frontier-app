// Slice 9.4 (D-037), in the real window against the fake provider: what attached files are guessed to cost. A chat with a 30-page PDF: the question before a
// large request (8.3) is asked, says the file is most of it and is sent again with every message, and "Don't send" sends nothing and writes nothing; with a
// daily limit of $0.10 the request is refused, with the same sentence about the file; with no limit it goes, and the ledger's first line holds the same
// guess, the file included (worked out here again from what the provider was sent). A message with only a small photo is not asked about. Needs
// USER_DATA_DIR (scratch; the harness gives it "No limit"), FILES_DIR (made by run94.mjs), INSPECT_PORT, MOCK_PORT and a saved key (setup-key.mjs).
import { start } from './lib8b3w.mjs'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { readRetry } from './lib4.mjs'
import { SRC } from './lib9.mjs'
import { installQuestions } from './lib10.mjs'

const W = await start()
const { page, H, ev, check, main, FILES, sleep, userData } = W
// Since 10.1 (D-039) "Never ask" and lifting a limit are asked about in the system's own message box: stood in for from main, answered yes (this suite
// tests what files cost, not the question).
await installQuestions(main, { fallback: 'yes' })
const usage = await import(`${SRC}/shared/usage.ts`)
const format = await import(`${SRC}/renderer/src/settings/format.ts`)
const mockUrl = `http://127.0.0.1:${process.env.MOCK_PORT}`
const F = (name) => join(FILES, name)
const show = (v) => JSON.stringify(v)?.slice(0, 400)
const reqs = async () => (await fetch(`${mockUrl}/__requests`)).json()
const ledgerFile = join(userData, 'usage', 'ledger.jsonl')
const ledger = () => (existsSync(ledgerFile) ? readRetry(ledgerFile, 'utf8').split('\n').filter((l) => l !== '').map((l) => JSON.parse(l)) : [])
const FILE_TOKENS = 30 * 4800 + 16
const question = () => ev(`(() => { const d = document.querySelector('dialog.large-request'); if (!d?.open) return null; return { files: d.querySelector('.large-request-files')?.textContent ?? null, rows: [...d.querySelectorAll('tbody tr')].map((tr) => tr.querySelector('.large-request-tokens')?.textContent ?? '') } })()`)
const lastNote = () => ev(`[...document.querySelectorAll('.message-assistant')].at(-1)?.querySelector('.message-note')?.textContent ?? null`)
const typeAndSend = async (text) => { await ev(`(() => { const t = document.querySelector('.composer-input'); t.focus(); t.select() })()`); if (text) await page.type(text); await page.press('Enter') }

await main.inMain(`(() => {
  const { dialog } = process.mainModule.require('electron')
  globalThis.__d = { open: [] }
  dialog.showOpenDialog = async () => { const next = globalThis.__d.open.shift(); return next ? { canceled: false, filePaths: next } : { canceled: true, filePaths: [] } }
  return true
})()`)
const attach = async (names) => {
  const before = await ev(`document.querySelectorAll('.attachment-chip').length`)
  await main.inMain(`globalThis.__d.open.push(${JSON.stringify(names.map(F))}); true`)
  await H.clickChat('Attach...')
  await page.waitFor(`document.querySelectorAll('.attachment-chip').length === ${before + names.length}`, { timeoutMs: 20000, label: 'the chips' })
}

try {
  await page.waitFor(`!!document.querySelector('.chat-bar')`, { timeoutMs: 20000, label: 'the app' })
  await sleep(400)

  // ============ 1. a small photo: no question ============
  await attach(['photo.jpg'])
  const before1 = (await reqs()).length
  await typeAndSend('[[mock:files]] a small photo')
  const t0 = Date.now()
  while (Date.now() - t0 < 10000 && (await reqs()).length === before1) await sleep(60)
  await H.waitReady(20000)
  check('a message with a small photo (a few tokens) goes without the question', (await reqs()).length === before1 + 1 && !(await ev(`!!document.querySelector('dialog.large-request')?.open`)))

  // ============ 2. a 30-page PDF: the question ============
  await H.clickChat('New chat')
  await sleep(300)
  await attach(['long.pdf'])
  const before2 = (await reqs()).length
  const lines2 = ledger().length
  await typeAndSend('[[mock:files]] read this')
  await page.waitFor(`!!document.querySelector('dialog.large-request')?.open`, { timeoutMs: 20000, label: 'the question' })
  const q = await question()
  check('a chat with a 30-page PDF is asked about (its guess is far over the default $0.50)', q !== null, show(q))
  // The question writes token counts the app's usual short way (formatTokens: "144K"), as its other rows do.
  check('...and the question says the file is about 144K tokens of it (144,016, written the way the app writes tokens) and is sent again with every message', q?.files === `The file attached in this chat is about ${format.formatTokens(FILE_TOKENS)} tokens of it: every file in a chat is sent again with each message, so a new chat without it costs less.` && format.formatTokens(FILE_TOKENS) === '144K', show(q))
  const shown2 = /^about ([0-9.]+)K tokens$/.exec(q?.rows?.[0] ?? '')
  check('...its "Sending the conversation" counts the file (about 144.0K to 149.0K: the file and a few words)', shown2 !== null && Number(shown2[1]) * 1000 >= Math.floor(FILE_TOKENS / 100) * 100 && Number(shown2[1]) * 1000 < FILE_TOKENS + 5000, show(q?.rows))
  await page.click('dialog.large-request .settings-actions button@Don\'t send')
  await page.waitFor(`!document.querySelector('dialog.large-request')?.open`, { timeoutMs: 8000 })
  await H.waitReady()
  check('"Don\'t send": nothing reached the provider and nothing was written to the ledger', (await reqs()).length === before2 && ledger().length === lines2 && (await lastNote()) === 'Not sent: you chose not to send this request.', show(await lastNote()))

  // ============ 3. a daily limit of $0.10: refused, with the file's sentence ============
  const set = await ev(`(async () => [await window.api.settings.setAskFirst({ kind: 'never' }), await window.api.settings.setLimits({ daily: { kind: 'usd', usd: 0.1 }, monthly: { kind: 'none' } })])()`)
  check('(Never ask, and a daily limit of $0.10)', set.every((r) => r.ok), show(set))
  await H.clickChat('New chat')
  await sleep(300)
  await attach(['long.pdf'])
  await typeAndSend('[[mock:files]] read this now')
  await page.waitFor(`!!([...document.querySelectorAll('.message-assistant')].at(-1)?.querySelector('.message-note-error'))`, { timeoutMs: 15000, label: 'the refusal' })
  const note3 = await lastNote()
  check('the request is refused by the daily limit, and the refusal says the file is part of it and is sent again with each message', /^Nothing was sent: this would take today's spending past your daily limit of \$0\.10/.test(note3) && note3.endsWith('The file in this chat is about 144,016 tokens of it: every file in a chat is sent again with each message, so a new chat without it costs less.'), note3)
  check('...nothing reached the provider', (await reqs()).length === before2)

  // ============ 4. no limit: it goes, and the ledger holds the same guess ============
  const unset = await ev(`window.api.settings.setLimits({ daily: { kind: 'none' }, monthly: { kind: 'none' } })`)
  check('(no limit again)', unset.ok, show(unset))
  const lines4 = ledger().length
  const before4 = (await reqs()).length
  // a new message in the same chat: the PDF on the first message goes with it
  await typeAndSend('[[mock:files]] read this at last')
  const t4 = Date.now()
  while (Date.now() - t4 < 10000 && (await reqs()).length === before4) await sleep(60)
  await H.waitReady(20000)
  await sleep(600)
  const r4 = (await reqs()).at(-1)
  const sent = ledger().slice(lines4).find((l) => l.state === 'sent')
  const textOf = (m) => (typeof m.content === 'string' ? m.content : m.content.filter((b) => b.type === 'text').map((b) => b.text).join(''))
  const expected = r4 ? usage.estimateInputTokens(r4.body.system, r4.body.messages.map((m) => ({ content: textOf(m) }))) + FILE_TOKENS : null
  check('with no limit it goes; the ledger\'s first line guesses its input as the text plus the file (worked out again here from what the provider was sent)', r4 && r4.problems.length === 0 && sent && sent.tokens.input === expected, show({ sent: sent?.tokens?.input, expected, lines: ledger().slice(lines4).map((l) => l.state) }))
  const problems = page.problems.filter((p) => !/Autofill|Electron Security Warning|DevTools/.test(p))
  check('no console errors, warnings or CSP violations in the page', problems.length === 0, show(problems))
} catch (error) {
  check(`the suite stopped before its end: ${String(error?.stack ?? error).slice(0, 500)}`, false)
}

main.close()
page.close()
process.exit(check.summary() ? 0 : 1)
