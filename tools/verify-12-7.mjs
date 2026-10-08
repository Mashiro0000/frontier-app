// Slice 12.7 (D-042) under plain Node: COST, ENCRYPTION AND BACKUPS of the code workspace. What the text of files costs (a reply that reads files or proposes them sends
// that text again with every request after it: the estimate counts what the model asked FOR as well as what it said, and the app asks again in the middle of a reply
// that has grown by more than the person's amount), the workspace setting and the undo journal sealed with the chats both ways, a backup that carries a chat with the
// notes of file calls and proposals but neither the workspace setting nor the undo journal nor a line of the audit log, and a hostile backup that pretends to be those.
// The window side of the cost is verify-12-7w.mjs. Windows only.
//
// Run: node tools/verify-12-7.mjs
import './ts-resolve.mjs'
import { checker } from './cdp.mjs'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { REPO, REPO_URL } from './paths.mjs'
import { backup, createConversationStore, makeChat, msg, NOW, same, seedFile, sourceOf, readAll, fileText } from './lib8b.mjs'
import { makeBox } from './lib8b3.mjs'

const check = checker()
const guard = async (name, fn) => { try { await fn() } catch (error) { check(`${name} did not run to its end: ${String(error?.stack ?? error).slice(0, 400)}`, false) } }
const show = (v) => JSON.stringify(v)?.slice(0, 300)
const SRC = `${REPO_URL}/src`
const usageMod = await import(`${SRC}/shared/usage.ts`)
const askMod = await import(`${SRC}/shared/askFirst.ts`)
const notesMod = await import(`${SRC}/shared/toolNotes.ts`)
const keptMod = await import(`${SRC}/main/keptFile.ts`)
const wsMod = await import(`${SRC}/main/workspace.ts`)
const settingsMod = await import(`${SRC}/main/toolSettings.ts`)
const auditMod = await import(`${SRC}/main/auditLog.ts`)
const source = (rel) => readFileSync(join(REPO, rel), 'utf8')
const root = mkdtempSync(join(tmpdir(), 'frontier-127-'))
let n = 0
const tempDir = () => { const d = join(root, `d${++n}`); mkdirSync(d, { recursive: true }); return d }

// ============ A. the estimate counts what files cost ============
await guard('A', async () => {
  const { estimateInputTokens } = usageMod
  const plain = [{ content: 'hello there' }, { content: 'an answer' }]
  const reference = Math.ceil((Buffer.byteLength('SYSTEM') + Buffer.byteLength('hello there') + Buffer.byteLength('an answer')) / 3) + 4 * 2
  check('A: a request without a tool turn is counted exactly as before (a third of the bytes, plus a few tokens a message)', estimateInputTokens('SYSTEM', plain) === reference, `${estimateInputTokens('SYSTEM', plain)} ${reference}`)
  const results = [...plain, { content: 'x'.repeat(90000) }]
  check('A: the text of a file that came back (the tool results are the next message) counts: 90,000 characters are 30,000 tokens', estimateInputTokens('SYSTEM', results) - estimateInputTokens('SYSTEM', plain) === 30000 + 4, String(estimateInputTokens('SYSTEM', results) - estimateInputTokens('SYSTEM', plain)))
  const turn = { content: 'Let me do that.', toolTurn: { calls: [], record: [{ type: 'text', text: 'Let me do that.' }, { type: 'tool_use', id: 't1', name: 'propose_new_file', input: { path: 'a.md', content: 'y'.repeat(60000), why: 'because' } }] } }
  const withTurn = estimateInputTokens('SYSTEM', [...plain, turn])
  const without = estimateInputTokens('SYSTEM', [...plain, { content: 'Let me do that.' }])
  check('A: what the model asked FOR counts too: a proposed file of 60,000 characters is sent back with the turn, and adds about 20,000 tokens', withTurn - without >= 20000 && withTurn - without < 20300, String(withTurn - without))
  check('A: a tool turn without a record, or with one that cannot be written as JSON text, adds nothing and does not throw', estimateInputTokens('S', [{ content: 'a', toolTurn: { calls: [], record: undefined } }]) === estimateInputTokens('S', [{ content: 'a' }]))
  check('A: a tool turn counts for every request after it (the estimate is made again for each)', estimateInputTokens('SYSTEM', [...plain, turn, turn]) - withTurn > 20000)
})

// ============ B. asking again in the middle of a reply ============
await guard('B', async () => {
  const { needsConfirmationAgain, needsConfirmation, estimateRequest } = askMod
  const prices = { inputPerMTok: 5, cacheReadPerMTok: 0.5, cacheWritePerMTok: 6.25, outputPerMTok: 25 }
  const est = (tokens) => estimateRequest(tokens, 1000, prices)
  const usd = { kind: 'usd', usd: 0.5 }
  const dflt = { kind: 'default' }
  // 80,000 tokens at 6.25 a million = $0.50; the amount is "more than"
  check('B: "Never ask" never asks again either', needsConfirmationAgain({ kind: 'never' }, est(10_000_000), 0) === false)
  check('B: below the amount it does not ask again (here $0.4), however much it grew', needsConfirmationAgain(usd, est(64_000), 0) === false)
  check('B: exactly at the amount it does not ask (the same rule as the first question)', needsConfirmationAgain(usd, est(80_000), 0) === false && needsConfirmation(usd, est(80_000)) === false)
  check('B: above the amount and grown by more than the amount since the last yes, it asks', needsConfirmationAgain(usd, est(96_000), 0) === true)
  check('B: above the amount but grown by only the amount since the last yes, it does not (a reply that is already large is not asked at every step)', needsConfirmationAgain(usd, est(160_000), est(80_000).inputUsd) === false)
  check('B: grown by more than the amount since the last yes, it asks again', needsConfirmationAgain(usd, est(176_000), est(80_000).inputUsd) === true)
  check('B: the default amount (until one is chosen) is used', needsConfirmationAgain(dflt, est(96_000), 0) === true && needsConfirmationAgain(dflt, est(70_000), 0) === false)
  // a reply of many steps: it grows by $0.2 a step from $0.1 with the amount at $0.5
  let approved = 0.1
  const asked = []
  for (let step = 1; step <= 12; step += 1) {
    const inputUsd = 0.1 + step * 0.2
    if (needsConfirmationAgain(usd, { ...est(1), inputUsd }, approved)) { asked.push(Number(inputUsd.toFixed(2))); approved = inputUsd }
  }
  check('B: over twelve steps of +$0.20 from $0.10 the person is asked at $0.7, $1.3, $1.9 and $2.5 (every time it has grown by more than $0.50 since their last yes), not at every step', show(asked) === show([0.7, 1.3, 1.9, 2.5]), show(asked))
  check('B: float noise does not decide it (whole millionths of a dollar)', needsConfirmationAgain(usd, { ...est(1), inputUsd: 0.1 + 0.2 + 0.3 }, 0.1) === false && 0.1 + 0.2 + 0.3 - 0.1 > 0.5)
})

// ============ C. where it is asked (the sources) ============
await guard('C', async () => {
  const chat = source('src/main/chat.ts')
  const run = chat.slice(chat.indexOf('async function runReply'))
  check('C: chat.ts asks the question in one function, askLarge, for the first request and for the later ones', (run.match(/askLarge\(/g) ?? []).length === 2 && /const askLarge = async \(asked: RequestEstimate, later: boolean\)/.test(run))
  check('C: the one wait for a yes is inside askLarge (a single `confirmations.ask`)', (run.match(/confirmations\.ask\(/g) ?? []).length === 1)
  check('C: what the person has agreed to starts as the first request of the reply, and the answer to the question needs a send and no stop', /let approvedInputUsd = estimate\.inputUsd/.test(run) && /return answer === 'send' && !controller\.signal\.aborted/.test(run))
  check('C: the first request is asked about as before (needsConfirmation and askLarge with later = false)', /needsConfirmation\(askFirst, estimate\) && !\(await askLarge\(estimate, false\)\)\) return/.test(run))
  const loop = run.slice(run.indexOf('for (let pass = 0; pass < 25; pass++)'))
  check('C: in the loop the question comes BEFORE the ledger line and the provider (`beginRequest`), for every pass after the first', loop.indexOf('askLarge(next, true)') > 0 && loop.indexOf('askLarge(next, true)') < loop.indexOf('beginRequest())) return') && /if \(pass > 0\) \{/.test(loop))
  check('C: a no, a stop or a limit that refuses ends the reply (`return`), and the agreed amount moves up only after a yes', /if \(!\(await askLarge\(next, true\)\)\) return\s+approvedInputUsd = next\.inputUsd/.test(loop))
  check('C: the later question uses the estimate made again from the messages as they are now (inputTokens is recomputed after every tool turn)', /inputTokens = inputTokensFor\(\)/.test(loop) && /estimateRequest\(\s*inputTokens,\s*streamRequest\.maxOutputTokens,\s*entry\.pricing,\s*files\s*\)/.test(loop))
  check('C: the event carries `later: true` only for the later question, and the page words it for that', /\.\.\.\(later \? \{ later: true \} : \{\}\)/.test(run) && /request\.later === true/.test(source('src/renderer/src/chat/LargeRequestDialog.tsx')) && /NOT_SENT_LATER_MESSAGE/.test(source('src/renderer/src/chat/ipcReply.ts')))
  check('C: the limits check of every request still counts the whole estimate (the same `inputTokens` goes to the ledger\'s begin, with the files\' note)', /inputTokens\n\s+\},\n\s+\(spend\) => withFilesNote\(checkAgainstLimits\(limits, spend\), files\)/.test(run))
})

// ============ D. the workspace setting and the undo journal, sealed with the chats ============
await guard('D', async () => {
  const box = makeBox()
  const dir = tempDir()
  const mode = { form: 'plain' }
  const writeMode = async () => ({ ...mode })
  const store = wsMod.createWorkspaceStore({ pathOf: () => join(dir, 'workspace.json'), box, writeMode })
  const journalMod = await import(`${SRC}/main/journal.ts`)
  const undoMod = await import(`${SRC}/main/undoRecords.ts`)
  const journal = journalMod.createJournal({ pathOf: () => join(dir, 'workspace', 'changes.jsonl'), box, writeMode, parse: undoMod.parseUndoEntry, render: undoMod.renderUndoEntry, version: undoMod.UNDO_VERSION, maxLineChars: undoMod.UNDO_LIMITS.maxLineChars, maxConformBytes: undoMod.UNDO_LIMITS.maxBytes, name: 'the undo journal' })
  const settings = settingsMod.createToolSettings({ pathOf: () => join(dir, 'tools.json'), box, writeMode })
  const log = auditMod.createAuditLog({ pathOf: () => join(dir, 'audit', 'log.jsonl'), box, writeMode })
  const folder = 'C:\\Users\\someone\\Documents\\my-secret-project'
  await store.write({ folder, chosenAt: NOW })
  await journal.append({ type: 'applied', id: 'u1-1', at: NOW, kind: 'edit', path: 'src/secret-name.ts', before: Buffer.from('original text').toString('base64'), beforeHash: (await import('node:crypto')).createHash('sha256').update('original text').digest('hex'), afterHash: 'a'.repeat(64), afterBytes: 3, fingerprint: 'a'.repeat(12) })
  await settings.write({ enabled: { web_search: true, read_file: true }, caps: { steps: 5, seconds: 60 } })
  await log.append({ type: 'asked', at: NOW, call: 'c1', tool: 'apply_change', step: 1, args: { change: 'p1', path: 'src/secret-name.ts', fingerprint: 'abc' }, why: 'because' })
  const docs = keptMod.keptDocuments([settings.file, store.file, journal.document, log.document])
  check('D: before, all four are plain and readable (the folder, the path, the tool names)', show(await docs.counts()) === '{"plain":4,"encrypted":0}' && readFileSync(join(dir, 'workspace.json'), 'utf8').includes('my-secret-project') && readFileSync(join(dir, 'workspace', 'changes.jsonl'), 'utf8').includes('secret-name'), show(await docs.counts()))
  mode.form = 'encrypted'
  const on = await docs.conform()
  const sealed = ['workspace.json', 'workspace\\changes.jsonl', 'tools.json', 'audit\\log.jsonl'].map((f) => readFileSync(join(dir, f), 'utf8'))
  check('D: turning encryption on rewrites all four: nothing readable is left (no folder, no path, no original text, no tool name)', on.changed === 4 && on.failed === 0 && !/my-secret-project|secret-name|original text|b3JpZ2luYWw|read_file|apply_change/.test(sealed.join('\n')), show(on))
  check('D: ...and all four read back to what they were', (await store.read()).record?.folder === folder && (await journal.readAll()).entries.length === 1 && (await log.read()).events.length === 1 && (await settings.read()).settings.enabled.read_file === true)
  check('D: the flow counts all four as encrypted, and a second pass has nothing to do', show(await docs.counts()) === '{"plain":0,"encrypted":4}' && (await docs.conform()).changed === 0)
  mode.form = 'plain'
  const off = await docs.conform()
  check('D: turning it off rewrites all four back to plain, and they read back again', off.changed === 4 && off.failed === 0 && readFileSync(join(dir, 'workspace.json'), 'utf8').includes('my-secret-project') && (await store.read()).record?.folder === folder && (await journal.readAll()).entries.length === 1)
  mode.form = 'encrypted'
  await docs.conform()
  box.lose()
  const lost = await store.read()
  check('D: with the key lost, a sealed workspace setting means NO workspace (a file that cannot be opened never names a folder), with the reason in words', lost.record === null && typeof lost.problem === 'string' && lost.problem.length > 0, show(lost))
  const lostJournal = await journal.readAll()
  check('D: ...and a sealed journal gives no entry (so nothing can be undone from a copy that cannot be opened), the lines counted', lostJournal.entries.length === 0 && lostJournal.sealedClosed === 1)
  const src = source('src/main/ipc.ts')
  check('D: the wiring has the four files in the same list of kept documents (the one the encryption flow walks)', /toolSettings\.file,\s*workspaceStore\.file,\s*undoJournal\.document/.test(src) && /auditLog\.document/.test(src))
})

// ============ E. backups ============
await guard('E', async () => {
  const base = tempDir()
  const dir = join(base, 'conversations')
  const events = [
    { type: 'asked', at: NOW, call: 'c1', tool: 'read_file', step: 1, args: { path: 'src/main.ts', start_line: 1, max_lines: 50 }, why: 'To read the entry point.' },
    { type: 'answered', at: NOW + 1, call: 'c1', tool: 'read_file', step: 1, answer: 'yes' },
    { type: 'ran', at: NOW + 2, call: 'c1', tool: 'read_file', step: 1 },
    { type: 'result', at: NOW + 3, call: 'c1', tool: 'read_file', step: 1, ok: true, size: 2400, sources: [], searched: null, searches: 0 },
    { type: 'asked', at: NOW + 4, call: 'c2', tool: 'propose_edit', step: 2, args: { path: 'src/main.ts', find: 'x', replace: 'y' }, why: 'A fix.' },
    { type: 'answered', at: NOW + 5, call: 'c2', tool: 'propose_edit', step: 2, answer: 'covered' },
    { type: 'ran', at: NOW + 6, call: 'c2', tool: 'propose_edit', step: 2 },
    { type: 'result', at: NOW + 7, call: 'c2', tool: 'propose_edit', step: 2, ok: true, size: 120, sources: [], searched: null, searches: 0 }
  ]
  const offsets = new Map([['c1', 3], ['c2', 12]])
  const notes = notesMod.notesOf(events, offsets)
  check('E: (set up) a reply that read a file and proposed a change has two notes with the words of the workspace tools', notes.length === 2 && notes[0].tool === 'read_file' && notes[1].tool === 'propose_edit' && notes[0].title === 'Read a file in the workspace', show(notes.map((x) => x.title)))
  const chat = makeChat(7)
  const reply = { ...msg('assistant', 'Let me look.\n\nThe entry point is main.ts.', 'done', { provider: 'anthropic', model: 'claude-opus-5-5' }), tools: notes }
  const withNotes = { ...chat, messages: [chat.messages[0], reply] }
  await seedFile(dir, withNotes, fileText(withNotes, 6))
  const store = createConversationStore(dir)
  const file = join(base, 'out', 'all.jsonl')
  mkdirSync(join(base, 'out'), { recursive: true })
  // the workspace setting, the undo journal and the audit log exist beside the chats
  writeFileSync(join(base, 'workspace.json'), '{"version":1,"folder":"C:\\\\Users\\\\someone\\\\proj","chosenAt":1}')
  mkdirSync(join(base, 'workspace'), { recursive: true })
  writeFileSync(join(base, 'workspace', 'changes.jsonl'), '{"v":1,"type":"undone","id":"u1-1","at":5}\n')
  mkdirSync(join(base, 'audit'), { recursive: true })
  writeFileSync(join(base, 'audit', 'log.jsonl'), '{"audit":"line"}\n')
  const before = { ws: readFileSync(join(base, 'workspace.json'), 'utf8'), journal: readFileSync(join(base, 'workspace', 'changes.jsonl'), 'utf8'), log: readFileSync(join(base, 'audit', 'log.jsonl'), 'utf8') }
  const written = await backup.writeBackup(file, sourceOf(store, [chat.id]), NOW)
  const text = readFileSync(file, 'utf8')
  const raw = text.split('\n').filter((l) => l !== '')
  const lines = raw.map((l) => JSON.parse(l))
  check('E: the backup of a chat with workspace notes is written whole as a version 6 chat line', written.ok && written.count === 1 && lines.filter((l) => l.chat).map((l) => l.chat.version).join() === '6', show(written))
  check('E: the line holds the notes: the tool, the path and the words asked, the size; and no text of any file', JSON.stringify(lines[1].chat).includes('read_file') && JSON.stringify(lines[1].chat).includes('src/main.ts'))
  check('E: the backup holds nothing of the workspace setting, the undo journal or the audit log: not the folder, not a journal line', !/someone|proj|"undone"|u1-1|"audit"/.test(text), text.slice(0, 200))
  const { read, chats: got } = await readAll(file)
  check('E: read back, the chat comes back exactly as the store has it, the notes included', read.problem === null && read.good === 1 && got.length === 1 && same(got[0], (await store.load(chat.id)).conversation))
  const back = got[0].messages[1].tools
  check('E: ...and the notes read back as themselves (the title is the app\'s own word for the tool)', back.length === 2 && back[0].tool === 'read_file' && back[1].outcome.covered === true && back[0].title === 'Read a file in the workspace')
  // a note for a workspace tool with a title that is not the app's own, or an unknown field, is refused like any damaged note
  const damaged = JSON.parse(JSON.stringify(lines[1]))
  damaged.chat.messages[1].tools[0].title = 'Read any file on this computer'
  damaged.sha256 = (await import('node:crypto')).createHash('sha256').update(JSON.stringify(damaged.chat)).digest('hex')
  const badFile = join(base, 'out', 'bad.jsonl')
  writeFileSync(badFile, [lines[0], damaged, lines.at(-1)].map((l) => JSON.stringify(l)).join('\n') + '\n')
  const bad = await readAll(badFile)
  check('E: a chat whose workspace note has a title the app did not give it is refused (a backup cannot make a tool say something else)', bad.read.refusedCount === 1 && bad.chats.length === 0, show(bad.read.refused))
  // a hostile file with lines of kinds that do not exist
  const hostile = [raw[0], JSON.stringify({ workspace: { folder: 'C:\\Windows', chosenAt: 1 }, sha256: '0'.repeat(64) }), JSON.stringify({ undo: { type: 'applied', id: 'u9-9', kind: 'create', path: 'x.ts' }, sha256: '0'.repeat(64) }), JSON.stringify({ journal: { v: 1, type: 'undone', id: 'u1-1', at: 9 } }), JSON.stringify({ audit: { type: 'result' }, sha256: '0'.repeat(64) }), JSON.stringify({ tools: { version: 1, enabled: { read_file: true, propose_edit: true }, caps: { steps: 20, seconds: 600 } } }), raw[1], raw.at(-1)].join('\n') + '\n'
  const hostileFile = join(base, 'hostile.jsonl')
  writeFileSync(hostileFile, hostile)
  const seen = { kept: 0 }
  const readHostile = await backup.readBackup(hostileFile, () => undefined, undefined, { project: () => { seen.kept++ }, note: () => { seen.kept++ } })
  check('E: lines that pretend to be the workspace setting, the undo journal, the audit log or the tool settings are unusable lines, counted, and nothing is handed on', readHostile.refusedCount >= 5 && readHostile.good === 1 && seen.kept === 0, show([readHostile.refusedCount, readHostile.good, seen]))
  check('E: and the files they pretend to be are untouched (reading a backup writes nothing)', readFileSync(join(base, 'workspace.json'), 'utf8') === before.ws && readFileSync(join(base, 'workspace', 'changes.jsonl'), 'utf8') === before.journal && readFileSync(join(base, 'audit', 'log.jsonl'), 'utf8') === before.log && !existsSync(join(base, 'tools.json')))
  const code = source('src/main/backupService.ts') + source('src/main/backup.ts') + source('src/main/restoreKept.ts')
  check('E: no code of backing up or restoring names the workspace setting, the undo journal, the applier or the audit log', !/workspace\.json|changes\.jsonl|undoJournal|applyService|journal\.ts|createWorkspaceStore|workspaceStore|auditLog|toolSettings|tools\.json/.test(code))
  const ipcSrc = source('src/main/ipc.ts')
  check('E: the backup and restore wiring is handed the conversation store, the projects and the notes, and nothing of the workspace', !/exportChats[\s\S]{0,400}(workspaceStore|undoJournal)/.test(ipcSrc))
})

const ok = check.summary()
process.exit(ok ? 0 : 1)
