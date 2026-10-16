// Slice 14.7 (D-045) under plain Node: COST, ENCRYPTION AND BACKUPS of connectors. connectors.json sealed with the chats both ways (and a key that cannot be used means no connector
// and every connector tool off); a backup that carries a chat with the notes of connector calls but nothing of connectors.json (no program, no address, no token) and a restore that never
// turns a connector or a tool on; the definitions of the connector tools that are on counted in the estimate of every request. Windows only.
//
// Run: node tools/guarded.mjs tools/verify-14-7.mjs      (it makes its own folders in the temp folder and removes nothing; the wrapper removes the run's folder)
import './ts-resolve.mjs'
import { checker } from './cdp.mjs'
import crypto from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { REPO, REPO_URL } from './paths.mjs'
import { backup, createConversationStore, makeChat, msg, NOW, same, seedFile, sourceOf, readAll, fileText } from './lib8b.mjs'
import { makeBox } from './lib8b3.mjs'

const check = checker()
const guard = async (name, fn) => { try { await fn() } catch (error) { check(`${name} did not run to its end: ${String(error?.stack ?? error).slice(0, 500)}`, false) } }
const show = (v) => JSON.stringify(v)?.slice(0, 400)
const SRC = `${REPO_URL}/src`
const notesMod = await import(`${SRC}/shared/toolNotes.ts`)
const storeMod = await import(`${SRC}/main/connectorStore.ts`)
const toolsMod = await import(`${SRC}/main/mcpTools.ts`)
const regMod = await import(`${SRC}/main/toolRegistry.ts`)
const source = (rel) => readFileSync(join(REPO, rel), 'utf8')
const root = mkdtempSync(join(tmpdir(), 'frontier-147-'))
let n = 0
const tempDir = () => { const d = join(root, `d${++n}`); mkdirSync(d, { recursive: true }); return d }
const sha = (text) => crypto.createHash('sha256').update(text).digest('hex')
const PROGRAM = 'C:\\servers\\private-notes\\index.mjs'
const URL_ = 'https://mcp.secret-host.example/mcp'

const echo = toolsMod.readServerTool({ name: 'search', description: 'Searches the notes.', inputSchema: { type: 'object', properties: { query: { type: 'string', maxLength: 100 } }, required: ['query'] } })
const list = (box) => [
  { id: 'abcdef123456', name: 'Private notes', prefix: 'notes', place: 'box', program: PROGRAM, folder: 'C:\\servers\\private-notes', args: ['--vault', 'personal'], url: null, token: null, auth: null, network: false, workspace: false, tools: [echo], changed: [], added: NOW },
  { id: 'abcdef654321', name: 'Web notes', prefix: 'web', place: 'remote', program: null, folder: null, args: [], url: URL_, token: box.encrypt('tok-SECRET-123456').toString('base64'), auth: null, network: false, workspace: false, tools: [], changed: [], added: NOW }
]

// ============ A. encryption ============
await guard('A', async () => {
  const box = makeBox()
  const dir = tempDir()
  const mode = { form: 'plain' }
  const store = storeMod.createConnectorStore({ pathOf: () => join(dir, 'connectors.json'), box, writeMode: async () => mode })
  await store.write(list(box))
  const plain = readFileSync(join(dir, 'connectors.json'), 'utf8')
  check('A: (set up) written plain, the list is readable as it is', plain.includes('Private notes') && plain.includes(PROGRAM.replaceAll('\\', '\\\\')))
  check('A: even plain, the token is kept sealed by the system (never as it is)', !plain.includes('tok-SECRET-123456'))
  mode.form = 'encrypted'
  const conformed = await store.file.conform()
  const sealed = readFileSync(join(dir, 'connectors.json'), 'utf8')
  check('A: when encryption is turned on, connectors.json is rewritten sealed: no name, no program, no address in it', conformed === 'changed' && !sealed.includes('Private notes') && !sealed.includes('private-notes') && !sealed.includes('secret-host'), `${conformed} ${sealed.slice(0, 80)}`)
  const read = await store.read()
  check('A: ...and reads back as the same list', read.problem === null && JSON.stringify(read.connectors) === JSON.stringify(list(box).map((c) => ({ ...c, token: read.connectors.find((x) => x.id === c.id)?.token }))))
  mode.form = 'plain'
  check('A: turned off again, it is rewritten plain', (await store.file.conform()) === 'changed' && readFileSync(join(dir, 'connectors.json'), 'utf8').includes('Private notes'))
  mode.form = 'encrypted'
  await store.file.conform()
  box.lie = true // the key cannot be used now
  const lost = await store.read()
  check('A: with the key unusable, the file is not read: no connector, and the reason is given (every connector tool is off)', lost.connectors.length === 0 && typeof lost.problem === 'string', show(lost))
  const kept = /keptDocuments\(\[([^\]]*)\]\)/.exec(source('src/main/ipc.ts'))?.[1] ?? ''
  check('A: ipc.ts rewrites connectors.json with the chats (it is one of the kept documents)', /\bconnectorStore\.file\b/.test(kept) && /\btoolSettings\.file\b/.test(kept), kept.replace(/\s+/g, ' '))
})

// ============ B. backups ============
await guard('B', async () => {
  const base = tempDir()
  const dir = join(base, 'conversations')
  const events = [
    { type: 'asked', at: NOW, call: 'c1', tool: 'notes__search', step: 1, args: { query: 'holiday plans' }, why: 'To find the note.' },
    { type: 'answered', at: NOW + 1, call: 'c1', tool: 'notes__search', step: 1, answer: 'yes' },
    { type: 'ran', at: NOW + 2, call: 'c1', tool: 'notes__search', step: 1 },
    { type: 'connector-call', at: NOW + 3, call: 'c1', tool: 'notes__search', step: 1, ms: 840, isError: false, dropped: 0 },
    { type: 'result', at: NOW + 4, call: 'c1', tool: 'notes__search', step: 1, ok: true, size: 412, sources: [], searched: null, searches: 0 }
  ]
  const notes = notesMod.notesOf(events, new Map([['c1', 3]]))
  check('B: (set up) a reply that called a connector has a note with the call\'s numbers', notes.length === 1 && notes[0].outcome.kind === 'ran-connector' && notes[0].title === 'search (connector notes)', show(notes))
  const chat = makeChat(9)
  const reply = { ...msg('assistant', 'Found it.\n\nHere it is.', 'done', { provider: 'anthropic', model: 'claude-opus-5-5' }), tools: notes }
  const withNotes = { ...chat, messages: [chat.messages[0], reply] }
  await seedFile(dir, withNotes, fileText(withNotes, 6))
  const store = createConversationStore(dir)
  const box = makeBox()
  writeFileSync(join(base, 'connectors.json'), storeMod.connectorsText(list(box)))
  const before = readFileSync(join(base, 'connectors.json'), 'utf8')
  const file = join(base, 'out', 'all.jsonl')
  mkdirSync(join(base, 'out'), { recursive: true })
  const written = await backup.writeBackup(file, sourceOf(store, [chat.id]), NOW)
  const text = readFileSync(file, 'utf8')
  check('B: the backup of a chat with a connector call is written whole', written.ok && written.count === 1, show(written))
  check('B: it holds the note (the tool, the argument, the numbers)', text.includes('notes__search') && text.includes('holiday plans') && text.includes('ran-connector'))
  check('B: it holds nothing of connectors.json: no program, no address, no argument of a connector, no token', !text.includes('private-notes') && !text.includes('secret-host') && !text.includes('--vault') && !text.includes('tok-SECRET'), text.slice(0, 200))
  const { read, chats: got } = await readAll(file)
  check('B: read back, the chat comes back exactly, the note included', read.problem === null && got.length === 1 && same(got[0], (await store.load(chat.id)).conversation) && got[0].messages[1].tools[0].outcome.connector.ms === 840)
  const lines = text.split('\n').filter((l) => l !== '').map((l) => JSON.parse(l))
  const reseal = async (mutate) => {
    const copy = JSON.parse(JSON.stringify(lines[1]))
    mutate(copy.chat.messages[1].tools)
    copy.sha256 = sha(JSON.stringify(copy.chat))
    const out = join(base, 'out', `bad-${++n}.jsonl`)
    writeFileSync(out, [lines[0], copy, lines.at(-1)].map((l) => JSON.stringify(l)).join('\n') + '\n')
    return readAll(out)
  }
  for (const [what, mutate] of [
    ['a time that is not one', (t) => { t[0].outcome.connector.ms = -5 }],
    ['a field more', (t) => { t[0].outcome.connector.command = 'node evil.mjs' }],
    ['a failure flag that is not one', (t) => { t[0].outcome.connector.isError = 'no' }],
    ['a title the app did not give it', (t) => { t[0].title = 'Run anything' }]
  ]) {
    const result = await reseal(mutate)
    check(`B: a chat whose connector note has ${what} is refused`, result.read.refusedCount === 1 && result.chats.length === 0, show(result.read.refused))
  }
  const hostile = [JSON.stringify(lines[0]), JSON.stringify({ connectors: { version: 1, connectors: list(box) }, sha256: '0'.repeat(64) }), JSON.stringify({ connector: { name: 'x', program: 'C:\\evil.exe' }, sha256: '0'.repeat(64) }), JSON.stringify(lines.at(-1))].join('\n') + '\n'
  writeFileSync(join(base, 'hostile.jsonl'), hostile)
  const seen = { kept: 0 }
  const readHostile = await backup.readBackup(join(base, 'hostile.jsonl'), () => undefined, undefined, { project: () => { seen.kept++ }, note: () => { seen.kept++ } })
  check('B: lines that pretend to be connectors are unusable lines, counted, and nothing is handed on', readHostile.refusedCount >= 2 && seen.kept === 0, show([readHostile.refusedCount, seen]))
  check('B: connectors.json beside the chats is untouched by a backup and by reading one', readFileSync(join(base, 'connectors.json'), 'utf8') === before && !existsSync(join(dir, 'connectors.json')))
  const code = source('src/main/backupService.ts') + source('src/main/backup.ts') + source('src/main/restoreKept.ts')
  check('B: no code of backing up or restoring names connectors (so a restore never adds one or turns a tool on)', !/connector/i.test(code))
  check('B: a connector tool is switched on only by the service, after the box (one write that adds a tool)', (source('src/main/connectorService.ts').match(/tools: \[\.\.\.x\.tools\.filter\(\(y\) => y\.name !== toolName\), tool\]/g) ?? []).length === 1)
})

// ============ C. cost ============
await guard('C', async () => {
  const t = toolsMod.translateTool(echo, { name: 'Private notes', prefix: 'notes', place: 'box', network: false }, () => false)
  const spec = regMod.offeredTool(t.def)
  check('C: a connector tool is offered with the framed words (about a thousand characters at most), and every request sends it', t.ok && spec.description.length <= 1000 && spec.description.includes('Searches the notes.'))
  const chat = source('src/main/chat.ts')
  check('C: the estimate of every request counts the definitions of the tools offered (the connector tools among them)', /Math\.ceil\(JSON\.stringify\(specs\)\.length \/ 4\)/.test(chat) && /specs = replyTools\.specs\(\)/.test(chat))
  check('C: the connector tools of a reply come from the service when the reply begins, and the settings say at every turn which are still on', /connectors: await toolsContext\.connectors\(\)/.test(chat) && /withConnectorTools\(settings, await connectorService\.onIds\(\)/.test(source('src/main/ipc.ts')))
  const twenty = Array.from({ length: 20 }, () => spec)
  check(`C: twenty connector tools (the most) add about ${Math.ceil(JSON.stringify(twenty).length / 4).toLocaleString('en-US')} tokens to a request`, Math.ceil(JSON.stringify(twenty).length / 4) < 12_000)
})

const ok = check.summary()
process.exit(ok ? 0 : 1)
