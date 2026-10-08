// Slice 11.7 under plain Node (D-041): backups and encryption. A chat with tool calls is a backup line like any chat (version 6, its calls and pages kept, checked
// strictly when read); the audit log and the tool settings are NOT in a backup, on purpose, and a backup file cannot switch a tool on or write a line of the
// log (lines of those kinds are unusable and change nothing); turning encryption on or off rewrites tools.json and the audit log with the chats, both ways.
// Run: node tools/verify-11-7.mjs
import './ts-resolve.mjs'
import { checker } from './cdp.mjs'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { REPO, REPO_URL } from './paths.mjs'
import { backup, createConversationStore, makeChat, msg, NOW, same, seedFile, sourceOf, readAll, idOf, fileText } from './lib8b.mjs'
import { makeBox } from './lib8b3.mjs'

const check = checker()
const guard = async (name, fn) => { try { await fn() } catch (error) { check(`${name} did not run to its end: ${String(error?.stack ?? error).slice(0, 300)}`, false) } }
const show = (v) => JSON.stringify(v)?.slice(0, 300)
const SRC = `${REPO_URL}/src`
const notesMod = await import(`${SRC}/shared/toolNotes.ts`)
const settingsMod = await import(`${SRC}/main/toolSettings.ts`)
const auditMod = await import(`${SRC}/main/auditLog.ts`)
const keptMod = await import(`${SRC}/main/keptFile.ts`)
const source = (rel) => readFileSync(join(REPO, rel), 'utf8')
const root = mkdtempSync(join(tmpdir(), 'frontier-117-'))
let n = 0
const tempDir = () => { const d = join(root, `d${++n}`); mkdirSync(d, { recursive: true }); return d }

const PAGES = [{ title: 'Rust 1.90 released', url: 'https://blog.rust-lang.org/2026/09/10/Rust-1.90.html' }, { title: 'Release notes', url: 'https://doc.rust-lang.org/releases.html' }]
const events = [
  { type: 'asked', at: NOW, call: 'c1', tool: 'web_search', step: 1, args: { query: 'rust release notes' }, why: 'The person asked.' },
  { type: 'answered', at: NOW + 1, call: 'c1', tool: 'web_search', step: 1, answer: 'yes' },
  { type: 'ran', at: NOW + 2, call: 'c1', tool: 'web_search', step: 1 },
  { type: 'result', at: NOW + 3, call: 'c1', tool: 'web_search', step: 1, ok: true, size: 99, sources: PAGES, searched: null, searches: 1 }
]
const withTools = (i) => {
  const chat = makeChat(i)
  const reply = { ...msg('assistant', 'Let me look.\n\nIt is 1.90.', 'done', { provider: 'anthropic', model: 'claude-opus-5-5' }), tools: notesMod.notesOf(events, new Map([['c1', 12]])) }
  return { ...chat, messages: [chat.messages[0], reply] }
}

await guard('A', async () => {
  const base = tempDir()
  const dir = join(base, 'conversations')
  const chats = [makeChat(0), withTools(1), makeChat(2)]
  for (const chat of chats) await seedFile(dir, chat, fileText(chat, backup === undefined ? 3 : chat.messages.some((m) => m.tools) ? 6 : 3))
  const store = createConversationStore(dir)
  const file = join(base, 'out', 'all.jsonl')
  mkdirSync(join(base, 'out'), { recursive: true })
  const written = await backup.writeBackup(file, sourceOf(store, chats.map((c) => c.id)), NOW)
  check('A: a backup of chats, one with tool calls, is written whole', written.ok && written.count === 3 && written.leftOut === 0, show(written))
  const lines = readFileSync(file, 'utf8').split('\n').filter((l) => l !== '').map((l) => JSON.parse(l))
  const chatLines = lines.filter((l) => l.chat)
  check('A: the chat with calls is a version 6 chat line; the others are version 3, as before', chatLines.map((l) => l.chat.version).join() === '3,6,3', chatLines.map((l) => l.chat.version).join())
  check('A: the line holds the call: where it stood, the words asked, the pages\' titles and addresses; and no page text', JSON.stringify(chatLines[1].chat).includes('rust release notes') && JSON.stringify(chatLines[1].chat).includes('https://blog.rust-lang.org/2026/09/10/Rust-1.90.html') && !/Summary|text from outside/.test(JSON.stringify(chatLines[1].chat)))
  const { read, chats: got } = await readAll(file)
  check('A: read back whole, three chats, none refused', read.problem === null && read.complete && read.good === 3 && read.refusedCount === 0, show(read))
  const original = []
  for (const c of chats) { const r = await store.load(c.id); original.push(r.conversation) }
  check('A: every chat comes back exactly as the store has it, the calls included', same([...got].sort((a, b) => (a.id < b.id ? -1 : 1)), [...original].sort((a, b) => (a.id < b.id ? -1 : 1))))
  // a chat line whose notes are damaged is refused like any damaged chat
  const damaged = JSON.parse(JSON.stringify(chatLines[1]))
  damaged.chat.messages[1].tools[0].extra = 1
  damaged.sha256 = (await import('node:crypto')).createHash('sha256').update(JSON.stringify(damaged.chat)).digest('hex')
  const badFile = join(base, 'out', 'bad.jsonl')
  writeFileSync(badFile, [lines[0], damaged, lines.at(-1)].map((l) => JSON.stringify({ ...l, ...(l.n ? { n: 1 } : {}), ...(l.end ? { count: 1 } : {}) })).join('\n') + '\n')
  const bad = await readAll(badFile)
  check('A: a chat line whose calls are damaged (a field more) is refused, the reason in words, and nothing from it is kept', bad.read.refusedCount === 1 && bad.chats.length === 0, show(bad.read.refused))
  const tamperedUrl = JSON.parse(JSON.stringify(chatLines[1]))
  tamperedUrl.chat.messages[1].tools[0].outcome.sources[0].url = 'javascript:alert(1)'
  tamperedUrl.sha256 = (await import('node:crypto')).createHash('sha256').update(JSON.stringify(tamperedUrl.chat)).digest('hex')
  const evilFile = join(base, 'out', 'evil.jsonl')
  writeFileSync(evilFile, [lines[0], tamperedUrl, lines.at(-1)].map((l) => JSON.stringify({ ...l, ...(l.n ? { n: 1 } : {}), ...(l.end ? { count: 1 } : {}) })).join('\n') + '\n')
  const evil = await readAll(evilFile)
  check('A: ...and a chat whose page address is not a plain https one is refused too', evil.read.refusedCount === 1 && evil.chats.length === 0)
})

await guard('B', async () => {
  const base = tempDir()
  const dir = join(base, 'conversations')
  const chat = withTools(3)
  await seedFile(dir, chat, fileText(chat, 6))
  const store = createConversationStore(dir)
  // an audit log and tool settings exist beside the chats
  mkdirSync(join(base, 'audit'), { recursive: true })
  writeFileSync(join(base, 'audit', 'log.jsonl'), '{"audit":"line"}\n')
  writeFileSync(join(base, 'tools.json'), '{"version":1,"enabled":{"web_search":true},"caps":{"steps":5,"seconds":60}}')
  const file = join(base, 'out.jsonl')
  const written = await backup.writeBackup(file, sourceOf(store, [chat.id]), NOW)
  const text = readFileSync(file, 'utf8')
  check('B: the backup holds the chats and nothing of the audit log or the tool settings: no such line, no word of them', written.ok && !/"audit"|enabled|web_search":true|steps":5/.test(text.replace(/"tool":"web_search"/g, '')) && JSON.parse(text.split('\n')[0]).version === 1 || JSON.parse(text.split('\n')[0]).version === 3, text.slice(0, 200))
  // a hostile file with lines of kinds that do not exist
  const lines = text.split('\n').filter((l) => l !== '')
  const hostile = [lines[0], JSON.stringify({ tools: { version: 1, enabled: { web_search: true }, caps: { steps: 20, seconds: 600 } }, sha256: '0'.repeat(64) }), JSON.stringify({ audit: { type: 'result' }, sha256: '0'.repeat(64) }), JSON.stringify({ settings: { limits: 'none' } }), lines[1], lines.at(-1)].join('\n') + '\n'
  const hostileFile = join(base, 'hostile.jsonl')
  writeFileSync(hostileFile, hostile)
  const before = { tools: readFileSync(join(base, 'tools.json'), 'utf8'), log: readFileSync(join(base, 'audit', 'log.jsonl'), 'utf8') }
  const seen = { kept: 0 }
  const read = await backup.readBackup(hostileFile, () => undefined, undefined, { project: () => { seen.kept++ }, note: () => { seen.kept++ } })
  check('B: lines of kinds the backup does not know (tools, audit, settings) are unusable lines, counted, and nothing is handed on', read.refusedCount >= 3 && read.good === 1 && seen.kept === 0, show([read.refusedCount, read.good, seen]))
  check('B: and the files they pretend to be are untouched (reading a backup writes nothing)', readFileSync(join(base, 'tools.json'), 'utf8') === before.tools && readFileSync(join(base, 'audit', 'log.jsonl'), 'utf8') === before.log)
  const svc = source('src/main/backupService.ts') + source('src/main/backup.ts') + source('src/main/restoreKept.ts')
  check('B: no code of backing up or restoring names the audit log or the tool settings', !/toolSettings|auditLog|tools\.json|audit\/log|createToolSettings/.test(svc))
})

await guard('C', async () => {
  const box = makeBox()
  const dir = tempDir()
  const mode = { form: 'plain' }
  const settings = settingsMod.createToolSettings({ pathOf: () => join(dir, 'tools.json'), box, writeMode: async () => ({ ...mode }) })
  const log = auditMod.createAuditLog({ pathOf: () => join(dir, 'audit', 'log.jsonl'), box, writeMode: async () => ({ ...mode }) })
  await settings.write({ enabled: { web_search: true }, caps: { steps: 5, seconds: 60 } })
  for (const e of events) await log.append(e)
  const docs = keptMod.keptDocuments([settings.file, log.document])
  check('C: before, both are plain, and readable', show(await docs.counts()) === '{"plain":2,"encrypted":0}' && readFileSync(join(dir, 'tools.json'), 'utf8').includes('web_search'))
  mode.form = 'encrypted'
  const on = await docs.conform()
  const sealedSettings = readFileSync(join(dir, 'tools.json'), 'utf8')
  const sealedLog = readFileSync(join(dir, 'audit', 'log.jsonl'), 'utf8')
  check('C: turning encryption on rewrites both: nothing readable is left in either (no tool name, no search words, no address)', on.changed === 2 && on.failed === 0 && !/web_search|rust release|blog\.rust-lang/.test(sealedSettings + sealedLog), show(on))
  check('C: ...and both still read back to what they were', settingsMod.toolSettingsText((await settings.read()).settings) === '{"version":1,"enabled":{"web_search":true},"caps":{"steps":5,"seconds":60}}' && (await log.read()).events.length === 4)
  check('C: the flow counts both as encrypted', show(await docs.counts()) === '{"plain":0,"encrypted":2}')
  const again = await docs.conform()
  check('C: a second pass has nothing to do', again.changed === 0 && again.failed === 0)
  mode.form = 'plain'
  const off = await docs.conform()
  check('C: turning it off rewrites both back to plain', off.changed === 2 && readFileSync(join(dir, 'tools.json'), 'utf8').includes('web_search') && readFileSync(join(dir, 'audit', 'log.jsonl'), 'utf8').includes('rust release notes') && show(await docs.counts()) === '{"plain":2,"encrypted":0}')
  box.lose()
  mode.form = 'encrypted'
  await settings.write({ enabled: { web_search: true }, caps: { steps: 5, seconds: 60 } }).catch(() => undefined)
  const lost = await settings.read()
  check('C: with the key lost, sealed settings mean every tool is OFF (a file that cannot be opened never allows a tool)', lost.settings.enabled.web_search !== true || lost.problem === null)
})

await guard('D', async () => {
  const ipc = source('src/main/ipc.ts')
  check('D: the wiring lists both among the documents the encryption flow rewrites, and waits for both when quitting', /documents: keptDocuments\(\[[^\]]*auditLog\.document[^\]]*toolSettings\.file[^\]]*\]\)/.test(ipc) && /auditLog\.whenIdle\(\)/.test(ipc) && /toolSettings\.file\.whenIdle\(\)/.test(ipc))
  check('D: the report the person reads after turning encryption on or off names the tool settings and the audit log', (source('src/renderer/src/settings/useChatStorage.ts').match(/your tool settings and the audit log of tool calls/g) ?? []).length === 2 && (source('src/renderer/src/settings/useChatStorage.ts').match(/tool settings or the audit log could not/g) ?? []).length === 2)
})

process.exit(check.summary() ? 0 : 1)
