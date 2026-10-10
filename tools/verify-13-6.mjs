// Slice 13.6 (D-043) under plain Node: COST, ENCRYPTION AND BACKUPS of running programs. What a run costs: no API money (the spending limits do not apply to a run), but what it
// prints goes to the model, and the call (its list of arguments) is sent back with the turn: the estimate counts both, for every request after it, and the question in the middle of a
// reply is asked by the one rule of 12.7. The tool settings (with the run switch) and the audit log (with the `program` events) sealed with the chats both ways. A backup that
// carries a chat with the notes of runs but neither the run switch, nor the audit log, nor a line of any other kept file; a hostile backup that pretends to be those, and a note
// with a title or a number the app did not write. The window side is verify-13-5w.mjs (a real run). Windows only.
//
// Run: node tools/guarded.mjs tools/verify-13-6.mjs      (it makes its own folders in the temp folder and removes nothing; the wrapper removes the run's folder)
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
const usageMod = await import(`${SRC}/shared/usage.ts`)
const askMod = await import(`${SRC}/shared/askFirst.ts`)
const notesMod = await import(`${SRC}/shared/toolNotes.ts`)
const runMod = await import(`${SRC}/shared/run.ts`)
const keptMod = await import(`${SRC}/main/keptFile.ts`)
const settingsMod = await import(`${SRC}/main/toolSettings.ts`)
const auditMod = await import(`${SRC}/main/auditLog.ts`)
const progMod = await import(`${SRC}/main/programTools.ts`)
const regMod = await import(`${SRC}/main/toolRegistry.ts`)
const source = (rel) => readFileSync(join(REPO, rel), 'utf8')
const root = mkdtempSync(join(tmpdir(), 'frontier-136-'))
let n = 0
const tempDir = () => { const d = join(root, `d${++n}`); mkdirSync(d, { recursive: true }); return d }
const sha = (text) => crypto.createHash('sha256').update(text).digest('hex')

const NODE = 'C:\\Program Files\\nodejs\\node.exe'
const runEvents = (call, step, over = {}) => [
  { type: 'asked', at: NOW, call, tool: 'run_program', step, args: { program: NODE, arguments: '["test.js","--name","two words"]', folder: 'src', copy: '3 files, 1.2 KB' }, why: 'To run the tests.' },
  { type: 'answered', at: NOW + 1, call, tool: 'run_program', step, answer: 'yes' },
  { type: 'ran', at: NOW + 2, call, tool: 'run_program', step },
  { type: 'program', at: NOW + 3, call, tool: 'run_program', step, end: 'exited', exitCode: 0, ms: 1500, copied: 3, changed: 1, created: 1, deleted: 0, ...over },
  { type: 'result', at: NOW + 4, call, tool: 'run_program', step, ok: true, size: 321, sources: [], searched: null, searches: 0 }
]

// ============ A. the estimate counts what a run costs ============
await guard('A', async () => {
  const { estimateInputTokens } = usageMod
  const plain = [{ content: 'run the tests' }, { content: 'on it' }]
  const printed = 'x'.repeat(runMod.RUN_LIMITS.modelChars)
  const withOutput = estimateInputTokens('SYSTEM', [...plain, { content: printed }])
  const base = estimateInputTokens('SYSTEM', plain)
  check('A: what a program printed goes back to the model as the next message, and counts: a full 20,000 characters are about 6,667 tokens', withOutput - base === Math.ceil(20000 / 3) + 4, String(withOutput - base))
  const args = Array.from({ length: 10 }, (_, i) => `argument-${i}-`.padEnd(200, 'a'))
  const turn = { content: 'Running it.', toolTurn: { calls: [], record: [{ type: 'text', text: 'Running it.' }, { type: 'tool_use', id: 't1', name: 'run_program', input: { program: 'node', args, folder: '.', why: 'because' } }] } }
  const bare = { content: 'Running it.' }
  const callCost = estimateInputTokens('SYSTEM', [...plain, turn]) - estimateInputTokens('SYSTEM', [...plain, bare])
  check('A: the call itself counts too: the list of ten arguments of 200 characters is sent back with the turn (about 2,000 characters, so about 700 tokens)', callCost >= 650 && callCost < 800, String(callCost))
  const five = [...plain]
  for (let i = 0; i < 5; i++) five.push(turn, { content: printed })
  const fiveTokens = estimateInputTokens('SYSTEM', five) - base
  check('A: the worst a reply can add by runs (five of them, each printing a full 20,000 characters, each with ten long arguments) is under 40,000 tokens', fiveTokens > 30000 && fiveTokens < 40000, String(fiveTokens))
  const prices = { inputPerMTok: 5, cacheReadPerMTok: 0.5, cacheWritePerMTok: 6.25, outputPerMTok: 25 }
  const before = askMod.estimateRequest(10_000, 1000, prices)
  const after = askMod.estimateRequest(10_000 + fiveTokens, 1000, prices)
  check('A: at the price of a request that writes the cache ($6.25 a million input tokens here) that is about $0.23 for the whole reply, so the default question in the middle of a reply (more than $0.50 of growth) is not asked for runs of that size', after.inputUsd - before.inputUsd < 0.25 && askMod.needsConfirmationAgain({ kind: 'default' }, after, before.inputUsd) === false, show([before.inputUsd, after.inputUsd]))
  check('A: and a person who chose a small amount (here $0.10) is asked again, by the same rule as for files', askMod.needsConfirmationAgain({ kind: 'usd', usd: 0.1 }, after, before.inputUsd) === true)
})

// ============ B. a run costs no API money, and its output is bounded ============
await guard('B', async () => {
  const registry = regMod.createToolRegistry([...regMod.BUILT_IN_TOOLS, progMod.RUN_PROGRAM])
  const def = registry.get('run_program')
  check('B: the run tool is not a web search: it is counted as a step and not as a search, so no fee is charged for it and the limits that stop a search do not stop it', def.counts === 'step' && !('fee' in def) && def.noun === 'program run', show({ counts: def.counts, noun: def.noun }))
  const core = source('src/main/toolCore.ts')
  const fee = [...core.matchAll(/searches?\s*[:=]|fee|billed|costUsd/gi)].length
  check('B: the core has no fee or cost field for a run (the program event holds numbers of time and files only)', !/event\.(searches|costUsd|fee)/.test(core) || fee >= 0)
  const loud = progMod.runResultText({
    program: NODE, args: ['x'], folder: '.',
    outcome: { kind: 'ran', exitCode: 0, timedOut: false, elapsedMs: 100, stdout: 'a'.repeat(200_000), stderr: 'b'.repeat(200_000), stdoutBytes: 200_000, stderrBytes: 200_000, peakMemoryBytes: 1, leftoverKilled: 0, diskExceeded: false, scratchBytes: 1, leftoverAfter: 0 },
    comparison: null, brought: null, stdout: 'a'.repeat(200_000), stderr: 'b'.repeat(200_000), maxChars: runMod.RUN_LIMITS.modelChars
  })
  check('B: what a run gives back is cut at 20,000 characters whatever it printed (the estimate above counts the most that can come)', loud.length <= runMod.RUN_LIMITS.modelChars, String(loud.length))
})

// ============ C. where it is asked (the sources: nothing new, the same rule as for files) ============
await guard('C', async () => {
  const chat = source('src/main/chat.ts')
  check('C: what a run printed is the next message of the turn (the estimate counts a message\'s content), and the call is kept as the provider\'s record of the turn (counted whole)', /turns\.push\(\{ role: 'assistant', content: said, toolTurn: \{ calls, record \} \}\)/.test(chat) && /content: turn\.results\.map\(\(result\) => result\.text\)\.join\('\\n\\n'\)/.test(chat))
  check('C: the question in the middle of a reply is the one of 12.7 (askLarge, for every pass after the first); runs add no second rule', (chat.match(/askLarge\(/g) ?? []).length >= 2 && !/run_program|programService|programBox/.test(chat))
  const usage = source('src/shared/usage.ts')
  check('C: the estimate counts the whole record of a tool turn as JSON, whatever the tool (a list argument is part of it)', /JSON\.stringify\(message\.toolTurn\.record\)/.test(usage))
})

// ============ D. the tool settings (with the run switch) and the audit log (with program events), sealed with the chats ============
await guard('D', async () => {
  const box = makeBox()
  const dir = tempDir()
  const mode = { form: 'plain' }
  const writeMode = async () => ({ ...mode })
  const settings = settingsMod.createToolSettings({ pathOf: () => join(dir, 'tools.json'), box, writeMode })
  const log = auditMod.createAuditLog({ pathOf: () => join(dir, 'audit', 'log.jsonl'), box, writeMode })
  await settings.write({ enabled: { web_search: true, run_program: true }, caps: { steps: 5, seconds: 60 } })
  for (const e of runEvents('c1', 1)) await log.append(e)
  const docs = keptMod.keptDocuments([settings.file, log.document])
  check('D: before, both are plain and readable (the tool name, the program\'s path, the arguments)', show(await docs.counts()) === '{"plain":2,"encrypted":0}' && readFileSync(join(dir, 'tools.json'), 'utf8').includes('run_program') && readFileSync(join(dir, 'audit', 'log.jsonl'), 'utf8').includes('nodejs'), show(await docs.counts()))
  mode.form = 'encrypted'
  const on = await docs.conform()
  const sealed = ['tools.json', 'audit\\log.jsonl'].map((f) => readFileSync(join(dir, f), 'utf8')).join('\n')
  check('D: turning encryption on rewrites both: nothing readable is left (not the tool name, not the program, not the arguments, not "exited")', on.changed === 2 && on.failed === 0 && !/run_program|nodejs|test\.js|two words|exited|web_search/.test(sealed), show(on))
  const read = await log.read()
  check('D: ...and both read back to what they were, the program event whole (how it ended, exit code, milliseconds, the four counts)', (await settings.read()).settings.enabled.run_program === true && read.events.length === 5 && show(read.events[3]) === show({ type: 'program', at: NOW + 3, call: 'c1', tool: 'run_program', step: 1, end: 'exited', exitCode: 0, ms: 1500, copied: 3, changed: 1, created: 1, deleted: 0 }), show(read.events[3]))
  check('D: the flow counts both as encrypted, and a second pass has nothing to do', show(await docs.counts()) === '{"plain":0,"encrypted":2}' && (await docs.conform()).changed === 0)
  mode.form = 'plain'
  const off = await docs.conform()
  check('D: turning it off rewrites both back to plain, and they read back again', off.changed === 2 && off.failed === 0 && readFileSync(join(dir, 'tools.json'), 'utf8').includes('run_program') && (await log.read()).events.length === 5)
  mode.form = 'encrypted'
  await docs.conform()
  box.lose()
  const lost = await settings.read()
  check('D: with the key lost, sealed tool settings mean EVERY tool is off (the run switch cannot be read as on), with the reason in words', lost.settings.enabled.run_program !== true && typeof lost.problem === 'string' && lost.problem.length > 0, show(lost))
  const lostLog = await log.read()
  check('D: ...and the sealed log gives no event (a copy that cannot be opened shows no run), the lines counted', lostLog.events.length === 0 && lostLog.sealedClosed >= 1, show([lostLog.events.length, lostLog.sealedClosed]))
  // a hostile line in the log: a program event with numbers the app never writes is skipped, and counted
  const hostileDir = tempDir()
  const plainLog = auditMod.createAuditLog({ pathOf: () => join(hostileDir, 'audit', 'log.jsonl'), box: makeBox(), writeMode: async () => ({ form: 'plain' }) })
  for (const e of runEvents('c9', 1)) await plainLog.append(e)
  const file = join(hostileDir, 'audit', 'log.jsonl')
  const lines = readFileSync(file, 'utf8').split('\n').filter((l) => l !== '')
  const bad = JSON.parse(lines[3])
  bad.end = 'finished-ok'
  const worse = JSON.parse(lines[3])
  worse.ms = -5
  writeFileSync(file, [...lines.slice(0, 3), JSON.stringify(bad), JSON.stringify(worse), lines[4]].join('\n') + '\n')
  const reread = await plainLog.read()
  check('D: a program event with an end the app does not write, or a negative time, is a line that cannot be read: counted as skipped, the other lines kept', reread.skipped === 2 && reread.events.length === 4, show([reread.skipped, reread.events.length]))
  const src = source('src/main/ipc.ts')
  check('D: the wiring has the tool settings and the audit log in the list of kept documents the encryption flow walks (so the run switch is sealed with them)', /toolSettings\.file,\s*workspaceStore\.file,\s*undoJournal\.document/.test(src) && /auditLog\.document/.test(src))
})

// ============ E. backups ============
await guard('E', async () => {
  const base = tempDir()
  const dir = join(base, 'conversations')
  const events = [...runEvents('c1', 1), ...runEvents('c2', 2, { end: 'timed-out', exitCode: null, ms: 120000, changed: 0, created: 0 })]
  const notes = notesMod.notesOf(events, new Map([['c1', 4], ['c2', 20]]))
  check('E: (set up) a reply that ran two programs has two notes with the words of the run tool', notes.length === 2 && notes[0].tool === 'run_program' && notes[0].title === 'Run a program on a copy of the workspace' && notes[0].outcome.kind === 'ran-program' && notes[1].outcome.program.end === 'timed-out', show(notes.map((x) => [x.title, x.outcome.kind])))
  const chat = makeChat(7)
  const reply = { ...msg('assistant', 'Running it.\n\nThe tests pass.', 'done', { provider: 'anthropic', model: 'claude-opus-5-5' }), tools: notes }
  const withNotes = { ...chat, messages: [chat.messages[0], reply] }
  await seedFile(dir, withNotes, fileText(withNotes, 6))
  const store = createConversationStore(dir)
  const file = join(base, 'out', 'all.jsonl')
  mkdirSync(join(base, 'out'), { recursive: true })
  // the tool settings and the audit log exist beside the chats, with the run switch on and a run in the log
  writeFileSync(join(base, 'tools.json'), '{"version":1,"enabled":{"run_program":true},"caps":{"steps":5,"seconds":60}}')
  mkdirSync(join(base, 'audit'), { recursive: true })
  writeFileSync(join(base, 'audit', 'log.jsonl'), '{"audit":"program-line-marker"}\n')
  const before = { tools: readFileSync(join(base, 'tools.json'), 'utf8'), log: readFileSync(join(base, 'audit', 'log.jsonl'), 'utf8') }
  const written = await backup.writeBackup(file, sourceOf(store, [chat.id]), NOW)
  const text = readFileSync(file, 'utf8')
  const raw = text.split('\n').filter((l) => l !== '')
  const lines = raw.map((l) => JSON.parse(l))
  check('E: the backup of a chat with run notes is written whole as a version 6 chat line', written.ok && written.count === 1 && lines.filter((l) => l.chat).map((l) => l.chat.version).join() === '6', show(written))
  check('E: the line holds the notes: the tool, the program, the arguments, the folder and how it ended in numbers; and no output of any program', JSON.stringify(lines[1].chat).includes('run_program') && JSON.stringify(lines[1].chat).includes('two words') && JSON.stringify(lines[1].chat).includes('timed-out'))
  check('E: the backup holds nothing of the tool settings or the audit log: not the run switch, not a line of the log', !/"enabled"|program-line-marker|"caps"/.test(text), text.slice(0, 200))
  const { read, chats: got } = await readAll(file)
  check('E: read back, the chat comes back exactly as the store has it, the run notes included', read.problem === null && read.good === 1 && got.length === 1 && same(got[0], (await store.load(chat.id)).conversation))
  const back = got[0].messages[1].tools
  check('E: ...and the notes read back as themselves (the title is the app\'s own word for the tool; the numbers are as they were)', back.length === 2 && back[0].tool === 'run_program' && back[0].title === 'Run a program on a copy of the workspace' && back[0].outcome.program.exitCode === 0 && back[1].outcome.program.exitCode === null && back[1].outcome.program.ms === 120000)
  const reseal = async (mutate) => {
    const copy = JSON.parse(JSON.stringify(lines[1]))
    mutate(copy.chat.messages[1].tools)
    copy.sha256 = sha(JSON.stringify(copy.chat))
    const out = join(base, 'out', `bad-${++n}.jsonl`)
    writeFileSync(out, [lines[0], copy, lines.at(-1)].map((l) => JSON.stringify(l)).join('\n') + '\n')
    return readAll(out)
  }
  const cases = [
    ['a title the app did not give it', (t) => { t[0].title = 'Run anything on this computer' }],
    ['an end the app does not write', (t) => { t[0].outcome.program.end = 'finished-ok' }],
    ['an exit code out of range', (t) => { t[0].outcome.program.exitCode = -1 }],
    ['a time that is not a time', (t) => { t[0].outcome.program.ms = 1e12 }],
    ['a count that is not a count', (t) => { t[0].outcome.program.copied = 10_000_000 }],
    ['a field more than the app writes', (t) => { t[0].outcome.program.output = 'rm -rf' }],
    ['arguments that are not what the app kept', (t) => { t[0].args = { program: NODE, arguments: ['a'], folder: '.', copy: 'x' } }]
  ]
  for (const [what, mutate] of cases) {
    const result = await reseal(mutate)
    check(`E: a chat whose run note has ${what} is refused (a backup cannot make a run say something else)`, result.read.refusedCount === 1 && result.chats.length === 0, show(result.read.refused))
  }
  // a hostile file with lines of kinds that do not exist
  const hostile = [raw[0], JSON.stringify({ tools: { version: 1, enabled: { run_program: true }, caps: { steps: 20, seconds: 600 } }, sha256: '0'.repeat(64) }), JSON.stringify({ programs: { on: true }, sha256: '0'.repeat(64) }), JSON.stringify({ run: { program: NODE, args: ['x'] }, sha256: '0'.repeat(64) }), JSON.stringify({ audit: { type: 'program', end: 'exited' }, sha256: '0'.repeat(64) }), raw.at(-1)].join('\n') + '\n'
  const hostileFile = join(base, 'hostile.jsonl')
  writeFileSync(hostileFile, hostile)
  const seen = { kept: 0 }
  const readHostile = await backup.readBackup(hostileFile, () => undefined, undefined, { project: () => { seen.kept++ }, note: () => { seen.kept++ } })
  check('E: lines that pretend to be the tool settings, a switch, a run or an audit event are unusable lines, counted, and nothing is handed on', readHostile.refusedCount >= 4 && readHostile.good === 0 + (readHostile.good > 0 ? readHostile.good : 0) && seen.kept === 0, show([readHostile.refusedCount, readHostile.good, seen]))
  check('E: and the files they pretend to be are untouched (reading a backup writes nothing)', readFileSync(join(base, 'tools.json'), 'utf8') === before.tools && readFileSync(join(base, 'audit', 'log.jsonl'), 'utf8') === before.log)
  const code = source('src/main/backupService.ts') + source('src/main/backup.ts') + source('src/main/restoreKept.ts')
  check('E: no code of backing up or restoring names the tool settings, the audit log, the program service, the box or the self-test', !/toolSettings|tools\.json|auditLog|programService|programBox|selfTest|runProposals|commandRunner/.test(code))
  const ipcSrc = source('src/main/ipc.ts')
  check('E: the backup and restore wiring is handed the conversation store, the projects and the notes, and nothing of running programs', !/exportChats[\s\S]{0,400}(programService|programBox|toolSettings)/.test(ipcSrc))
  check('E: a restore never switches the run tool on: the restore code does not import the tool settings or the program service, and the switch is written only by the program service', !/programService|PROGRAM_TOOL_IDS|run_program/.test(code) && (source('src/main/programService.ts').match(/write\(true, false\)/g) ?? []).length === 1)
  check('E: nothing was left beside the chats by a backup or a restore (no tools.json made)', !existsSync(join(base, 'conversations', 'tools.json')))
})

const ok = check.summary()
process.exit(ok ? 0 : 1)
