// Slice 11.4 under plain Node (no window): the tool notes of a reply (what the chat shows and a saved chat keeps), their strict check, version 6 chat files,
// the settings service (a tool ON and a higher cap ask in the system's box; OFF and lower do not), the provider named in the approval question, and source
// checks on what the page can and cannot do (D-041).
// Run: node tools/verify-11-4.mjs
import './ts-resolve.mjs'
import { checker } from './cdp.mjs'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { REPO, REPO_URL } from './paths.mjs'

const check = checker()
const guard = async (name, fn) => { try { await fn() } catch (error) { check(`${name} did not run to its end: ${String(error?.stack ?? error).slice(0, 300)}`, false) } }
const show = (v) => JSON.stringify(v)?.slice(0, 300)
const SRC = `${REPO_URL}/src`
const notesMod = await import(`${SRC}/shared/toolNotes.ts`)
const auditShared = await import(`${SRC}/shared/audit.ts`)
const sharedTools = await import(`${SRC}/shared/tools.ts`)
const validateMod = await import(`${SRC}/shared/validate.ts`)
const storeMod = await import(`${SRC}/main/conversationStore.ts`)
const svcMod = await import(`${SRC}/main/toolSettingsService.ts`)
const settingsMod = await import(`${SRC}/main/toolSettings.ts`)
const registryMod = await import(`${SRC}/main/toolRegistry.ts`)
const questionMod = await import(`${SRC}/main/toolQuestion.ts`)
const gateMod = await import(`${SRC}/main/systemQuestion.ts`)
const coreMod = await import(`${SRC}/main/toolCore.ts`)
const auditSvc = await import(`${SRC}/main/auditService.ts`)
const source = (rel) => readFileSync(join(REPO, rel), 'utf8')
const cp = (n) => String.fromCodePoint(n)
const RLO = cp(0x202e)
const logged = []
const realError = console.error
console.error = (...args) => { logged.push(args.map(String).join(' ')) }
const tempRoot = mkdtempSync(join(tmpdir(), 'frontier-114-'))
let dirs = 0
const tempDir = () => { const d = join(tempRoot, `d${++dirs}`); mkdirSync(d, { recursive: true }); return d }

const T0 = 1_700_000_000_000
const PAGES = [{ title: 'Rust 1.90 released', url: 'https://blog.rust-lang.org/2026/09/10/Rust-1.90.html' }, { title: 'Release notes', url: 'https://doc.rust-lang.org/releases.html' }]
const E = {
  refused: (call, code, step = 1) => ({ type: 'refused', at: T0, call, tool: 'web_search', step, code }),
  asked: (call, query = 'rust release notes', step = 1) => ({ type: 'asked', at: T0, call, tool: 'web_search', step, args: { query }, why: 'The person asked for the newest release.' }),
  answered: (call, answer, step = 1) => ({ type: 'answered', at: T0 + 1, call, tool: 'web_search', step, answer }),
  ran: (call, step = 1) => ({ type: 'ran', at: T0 + 2, call, tool: 'web_search', step }),
  result: (call, ok = true, sources = PAGES, step = 1) => ({ type: 'result', at: T0 + 3, call, tool: 'web_search', step, ok, size: 1234, sources, searched: null, searches: ok ? 1 : 0 })
}
const story = (call, query) => [E.asked(call, query), E.answered(call, 'yes'), E.ran(call), E.result(call)]

// ============ A. the notes ============
await guard('A', async () => {
  const { notesOf, noteOutcomeText, noteAbout, sourcesOfNotes, hostOf, piecesOf, settleNotes } = notesMod
  check('A: the window folds events with the very function main reads the log with', auditShared.groupCalls === auditSvc.groupCalls)
  const notes = notesOf(story('c1'), new Map([['c1', 12]]))
  check('A: a call becomes one note: the tool, its title, the step, what was asked, the reason, the outcome, and where in the text it stood', notes.length === 1 && notes[0].tool === 'web_search' && notes[0].title === 'Search the web' && notes[0].offset === 12 && notes[0].args.query === 'rust release notes' && notes[0].outcome.kind === 'done' && notes[0].outcome.sources.length === 2, show(notes))
  check('A: a call with no place known stands at 0', notesOf([E.asked('c9')], new Map())[0].offset === 0)
  check('A: calls that overlap in time stay apart', notesOf([E.asked('p'), E.refused('q', 'tool-off', 2), E.answered('p', 'no')], new Map()).map((n) => n.outcome.kind).join() === 'declined,refused')
  const sentences = [
    [{ kind: 'unanswered' }, true, 'Waiting for your answer in the Windows message box...'],
    [{ kind: 'unanswered' }, false, 'You were asked. No answer was recorded (the app may have been closed).'],
    [{ kind: 'running' }, true, 'Working on it...'],
    [{ kind: 'running' }, false, 'You allowed it. No end was recorded (the app may have been closed).'],
    [{ kind: 'done', size: 5, sources: PAGES }, false, 'You allowed it. 2 sources came back.'],
    [{ kind: 'done', size: 5, sources: [PAGES[0]] }, false, 'You allowed it. 1 source came back.'],
    [{ kind: 'done', size: 5, sources: [] }, false, 'You allowed it. No sources came back.'],
    [{ kind: 'failed' }, false, 'You allowed it. It started, but it failed or was stopped.'],
    [{ kind: 'declined', answer: 'no' }, false, 'You said no.'],
    [{ kind: 'declined', answer: 'stopped' }, false, 'You stopped the reply while the question was open.']
  ]
  for (const [outcome, live, want] of sentences) check(`A: the sentence for ${outcome.kind}${outcome.answer ? ':' + outcome.answer : ''}${live ? ' (live)' : ''}`, noteOutcomeText(outcome, live) === want, noteOutcomeText(outcome, live))
  check('A: every refusal and every other answer says what the audit log says', sharedTools.REFUSAL_CODES.every((code) => noteOutcomeText({ kind: 'refused', code }, false) === auditShared.REFUSED_TEXT[code]) && sharedTools.ANSWER_CODES.filter((a) => a !== 'yes').every((answer) => noteOutcomeText({ kind: 'declined', answer }, false) === auditShared.DECLINED_TEXT[answer]))
  check('A: what was asked, in quotes, as the person saw it', noteAbout(notes[0]) === '\u201crust release notes\u201d' && noteAbout({ args: null }) === '' && noteAbout({ args: { n: 3, q: 'x' } }) === '3, \u201cx\u201d')
  const two = notesOf([...story('a', 'one'), ...story('b', 'two'), E.asked('c', 'three')].map((e) => e), new Map())
  check('A: the sources of a reply are every page of every search that ran, each once, in order, and nothing from a call that did not run', sourcesOfNotes(two).length === 2 && sourcesOfNotes(two)[0].url === PAGES[0].url)
  check('A: the host of an address, as the browser reads it; nothing for what is not one', hostOf('https://blog.rust-lang.org/x') === 'blog.rust-lang.org' && hostOf('not an address') === '')
  const at = (offset, id) => ({ ...notes[0], id, offset })
  const flat = (pieces) => pieces.map((p) => (p.kind === 'text' ? `T:${p.text}` : `N:${p.note.id}`)).join('|')
  check('A: the text is cut where the calls happened', flat(piecesOf('Let me look.\n\nIt is 1.90.', [at(12, 'x')])) === 'T:Let me look.|N:x|T:\n\nIt is 1.90.')
  check('A: a call at the start, at the end, two at one place (in order), none, and a place past the end', flat(piecesOf('abc', [at(0, 'x')])) === 'N:x|T:abc' && flat(piecesOf('abc', [at(3, 'x')])) === 'T:abc|N:x' && flat(piecesOf('abc', [at(1, 'x'), at(1, 'y')])) === 'T:a|N:x|N:y|T:bc' && flat(piecesOf('abc', [])) === 'T:abc' && flat(piecesOf('abc', [at(99, 'x')])) === 'T:abc|N:x' && flat(piecesOf('', [at(0, 'x')])) === 'N:x')
  const open = notesOf([E.asked('u'), E.answered('r', 'yes', 2), E.ran('r', 2), ...story('d')].map((e) => e), new Map())
  const settled = settleNotes(open, true)
  check('A: when the person stopped a reply, a question left open is a stop, and a call that was running failed or was stopped; a finished one is left', settled.map((n) => n.outcome.kind + (n.outcome.answer ?? '')).join() === 'declinedstopped,failed,done', show(settled.map((n) => n.outcome)))
  check('A: when the reply ended some other way the notes are left as they are', settleNotes(open, false).map((n) => n.outcome.kind).join() === 'unanswered,running,done')
})

// ============ B. the strict check of saved notes ============
await guard('B', async () => {
  const { notesOf, checkToolNotes, isKeptAddress } = notesMod
  const notes = notesOf([...story('c1'), E.asked('c2', 'second', 2), E.answered('c2', 'no', 2), E.refused('c3', 'step-cap', 3)], new Map([['c1', 5], ['c2', 9]]))
  const wire = JSON.parse(JSON.stringify(notes))
  const back = checkToolNotes(wire, 50)
  check('B: what the window makes is accepted, and comes back as itself', back !== null && show(back) === show(notes), show(back))
  const bad = (what, change, len = 50) => { const copy = JSON.parse(JSON.stringify(wire)); change(copy); check(`B: refused: ${what}`, checkToolNotes(copy, len) === null) }
  check('B: refused: none, not a list, 26 notes', checkToolNotes([], 5) === null && checkToolNotes('x', 5) === null && checkToolNotes(Array.from({ length: 26 }, (_, i) => ({ ...wire[0], id: 'n' + i })), 50) === null)
  bad('a field more', (c) => { c[0].extra = 1 })
  bad('a field less', (c) => { delete c[0].why })
  bad('an id with capitals', (c) => { c[0].id = 'ABC' })
  bad('the same id twice', (c) => { c[1].id = c[0].id })
  bad('a tool that is not shaped like an id', (c) => { c[0].tool = 'Web Search'; c[0].title = 'Web Search' })
  bad('a title that is not what the app calls the tool', (c) => { c[0].title = 'Click here' })
  bad('step 0', (c) => { c[0].step = 0 })
  bad('a time with a fraction', (c) => { c[0].at = 1.5 })
  bad('a place past the text', (c) => { c[0].offset = 51 })
  bad('a negative place', (c) => { c[0].offset = -1 })
  bad('nine arguments', (c) => { c[0].args = Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`a${i}`, 'x'])) })
  bad('an argument named in capitals', (c) => { c[0].args = { Query: 'x' } })
  bad('an argument value with a reversing character', (c) => { c[0].args = { query: `a${RLO}b` } })
  bad('an argument value with a line break', (c) => { c[0].args = { query: 'a\nb' } })
  bad('an argument that is an object', (c) => { c[0].args = { query: {} } })
  bad('a reason of 501 characters', (c) => { c[0].why = 'x'.repeat(501) })
  bad('a reason that is a number', (c) => { c[0].why = 5 })
  bad('an outcome of another kind', (c) => { c[0].outcome = { kind: 'ok' } })
  bad('a refusal code that does not exist', (c) => { c[2].outcome.code = 'whatever' })
  bad('a "decline" that is a yes', (c) => { c[1].outcome = { kind: 'declined', answer: 'yes' } })
  bad('an outcome with a field more', (c) => { c[0].outcome.extra = 1 })
  bad('21 sources', (c) => { c[0].outcome.sources = Array.from({ length: 21 }, (_, i) => ({ title: 't', url: `https://a.test/${i}` })) })
  bad('a source address that is http', (c) => { c[0].outcome.sources[0].url = 'http://a.test/' })
  bad('a source address with a password', (c) => { c[0].outcome.sources[0].url = 'https://u:p@a.test/' })
  bad('a source address with a name and no password', (c) => { c[0].outcome.sources[0].url = 'https://u@a.test/' })
  bad('a source address in capitals (not the form the app keeps)', (c) => { c[0].outcome.sources[0].url = 'https://A.test/' })
  bad('a source address with other letters', (c) => { c[0].outcome.sources[0].url = 'https://\u00fcn.test/' })
  bad('a javascript address', (c) => { c[0].outcome.sources[0].url = 'javascript:alert(1)' })
  bad('a source title with a line break', (c) => { c[0].outcome.sources[0].title = 'a\nb' })
  bad('a source title with a reversing character', (c) => { c[0].outcome.sources[0].title = `a${RLO}b` })
  bad('a source title with a space before it', (c) => { c[0].outcome.sources[0].title = ' a' })
  bad('a source title of 201 characters', (c) => { c[0].outcome.sources[0].title = 'x'.repeat(201) })
  bad('a result bigger than any result can be', (c) => { c[0].outcome.size = 1e9 })
  const hostile = [{ title: 'Line\nbreak', url: 'https://a.test/1' }, { title: `Spoof${RLO}`, url: 'https://EXAMPLE.test/Path' }, { title: '  many   spaces  ', url: 'https://u:p@b.test/' }, { title: 'x'.repeat(500), url: 'http://c.test/' }, { title: '\u200bzero', url: 'https://d.test/\u202e' }, { title: 'ok', url: 'https://\u00fcn.test/' }, { title: 'fine', url: 'https://e.test/a b' }]
  const kept = coreMod.shapeResult({ text: 't', sources: hostile, searched: null, searches: 1 }).sources
  const viaCore = JSON.parse(JSON.stringify(notesOf(story('h'), new Map())))
  viaCore[0].outcome.sources = kept
  check('B: whatever the core keeps of a hostile page, the check accepts (the window can always save what main sent)', kept.length > 0 && checkToolNotes(viaCore, 0) !== null && kept.every((s) => isKeptAddress(s.url)), show(kept))
})

// ============ C. messages and chat files ============
await guard('C', async () => {
  const { notesOf } = notesMod
  const notes = notesOf(story('c1'), new Map([['c1', 4]]))
  const reply = { role: 'assistant', content: 'Look this up. It is 1.90.', status: 'done', provider: 'anthropic', model: 'claude-opus-5-5', tools: notes }
  const user = { role: 'user', content: 'newest Rust?', status: 'done' }
  const ok = validateMod.checkSavedMessages([user, reply])
  check('C: a reply with tool notes is accepted from the page and kept', ok.ok && show(ok.messages[1].tools) === show(notes))
  check('C: notes on a message of the person\'s are refused', !validateMod.checkSavedMessages([{ ...user, tools: notes }, reply]).ok)
  check('C: an empty list of notes is refused (a reply without a call has none)', !validateMod.checkSavedMessages([user, { ...reply, tools: [] }]).ok)
  check('C: a note placed past the end of the reply\'s text is refused', !validateMod.checkSavedMessages([user, { ...reply, content: 'ab' }]).ok)
  const fromOldFile = validateMod.checkSavedMessages([user, reply], 'file', true, false)
  check('C: an older file\'s messages are read without notes (they were not made by a version that knew them)', fromOldFile.ok && fromOldFile.messages[1].tools === undefined)
  const fromFileDefault = validateMod.checkSavedMessages([user, reply], 'file', true)
  check('C: a message read from a file gets no notes unless the caller says the file is version 6 (the default is none)', fromFileDefault.ok && fromFileDefault.messages[1].tools === undefined)
  const save = validateMod.checkConversationSave({ id: '0f3a9c2e-1b4d-4c6e-8a7f-123456789abc', messages: [user, reply], instructions: '' })
  check('C: a conversation to save keeps them', save.ok && save.conversation.messages[1].tools?.length === 1)
  const { fileVersion, parseSavedFile, createConversationStore } = storeMod
  const id = '0f3a9c2e-1b4d-4c6e-8a7f-123456789abc'
  const conv = { messages: save.conversation.messages }
  check('C: a chat with tool notes is version 6, in a project or not; otherwise as before', fileVersion(conv) === 6 && fileVersion({ ...conv, project: 'p' }) === 6 && fileVersion({ messages: [user] }) === 3 && fileVersion({ messages: [user], project: 'p' }) === 5)
  const base = { version: 6, id, title: 'x', createdAt: 1, updatedAt: 2, instructions: '', messages: JSON.parse(JSON.stringify(conv.messages)) }
  const parsed = parseSavedFile(base, id)
  check('C: a version 6 file reads, with its notes and no project', typeof parsed === 'object' && parsed.messages[1].tools.length === 1 && parsed.project === undefined, show(parsed))
  const withProject = parseSavedFile({ ...base, project: '0f3a9c2e-1b4d-4c6e-8a7f-123456789abd' }, id)
  check('C: ...with a project when it names one that is shaped like one', typeof withProject === 'object' && typeof withProject.project === 'string', show(withProject))
  check('C: a version 6 file with a project that is not one, or with no notes, or with a bad note, is refused', typeof parseSavedFile({ ...base, project: 'x' }, id) === 'string' && typeof parseSavedFile({ ...base, messages: [user, { ...reply, tools: undefined }] }, id) === 'string' && typeof parseSavedFile({ ...base, messages: [user, { ...reply, tools: [{ ...notes[0], extra: 1 }] }] }, id) === 'string')
  const v5 = parseSavedFile({ ...base, version: 5, project: '0f3a9c2e-1b4d-4c6e-8a7f-123456789abd' }, id)
  check('C: a version 5 file that carries notes is read without them', typeof v5 === 'object' && v5.messages[1].tools === undefined)
  const dir = tempDir()
  const store = createConversationStore(dir)
  const saved = await store.save({ id, messages: conv.messages })
  const text = JSON.parse(readFileSync(join(dir, `${id}.json`), 'utf8'))
  const loaded = await store.load(id)
  check('C: saved by the real store as version 6 and read back with its notes', saved.ok && text.version === 6 && loaded.ok && show(loaded.conversation.messages[1].tools) === show(notes), show(loaded))
  check('C: the file holds the notes\' sources as titles and addresses and no page text', !/Summary|<script|text from outside/i.test(JSON.stringify(text)))
})

// ============ D. the settings service ============
await guard('D', async () => {
  const mk = (answers = [], mode = { form: 'plain' }) => {
    const file = join(tempDir(), 'tools.json')
    const store = settingsMod.createToolSettings({ pathOf: () => file, writeMode: async () => ({ ...mode }) })
    const asked = []
    const gate = gateMod.createQuestionGate(async (owner, question) => { asked.push(question); const a = answers.shift(); return a === undefined ? false : a }, () => 0)
    const service = svcMod.createToolSettingsService({ store, registry: registryMod.createToolRegistry(registryMod.BUILT_IN_TOOLS), gate })
    return { file, store, asked, service, gate }
  }
  let r = mk()
  let s = await r.service.status()
  check('D: with no file every tool is listed and off, the caps are the defaults, no problem', s.problem === null && s.tools.length === 1 && s.tools[0].id === 'web_search' && s.tools[0].title === 'Search the web' && s.tools[0].on === false && s.caps.steps === 5 && s.caps.seconds === 60 && s.tools[0].about.length > 20, show(s))
  check('D: the tool\'s own words are those of the registry (what it does, for the person)', s.tools[0].about === registryMod.WEB_SEARCH.effect)
  let out = await r.service.setEnabled('w', { tool: 'web_search', on: true })
  check('D: nothing is on after a no: the person was asked, nothing was written', !out.ok && out.cancelled === true && out.error === svcMod.TOOL_NOT_ON && r.asked.length === 1 && !readdirSync(join(r.file, '..')).includes('tools.json'), show(out))
  const q = r.asked[0]
  check('D: the question names the tool and what it does, says nothing runs without the person, gives the caps and says why it is asked there; two buttons, a no that is the default', q.title === 'Search the web' && /web search|Search the web/i.test(q.message) && q.detail.includes(registryMod.WEB_SEARCH.effect) && /Nothing runs without you/.test(q.detail) && /5 tool steps/.test(q.detail) && q.detail.includes(questionMod.ASKED_HERE) && q.yes === 'Turn on' && q.no === "Don't turn on", show(q))
  r = mk([true])
  out = await r.service.setEnabled('w', { tool: 'web_search', on: true })
  check('D: after a yes the tool is on, in the file, and the answer is the new status', out.ok && out.status.tools[0].on === true && sharedTools.toolIsOn((await r.store.read()).settings, 'web_search'), show(out))
  out = await r.service.setEnabled('w', { tool: 'web_search', on: true })
  check('D: switching on what is already on asks nothing', out.ok && r.asked.length === 1)
  out = await r.service.setEnabled('w', { tool: 'web_search', on: false })
  check('D: switching off asks nothing and is done at once', out.ok && out.status.tools[0].on === false && r.asked.length === 1 && !sharedTools.toolIsOn((await r.store.read()).settings, 'web_search'))
  r = mk([true, true])
  for (const input of [null, 'web_search', { tool: 'web_search' }, { tool: 'web_search', on: 'true' }, { tool: 'web_search', on: 1 }, { tool: 5, on: true }, { tool: '__proto__', on: true }, { tool: 'constructor', on: true }, { tool: 'nope', on: true }, []]) {
    const o = await r.service.setEnabled('w', input)
    if (o.ok || r.asked.length > 0) { check(`D: refused without a question: ${show(input)}`, false, show(o)); break }
  }
  check('D: refused without a question: a missing or odd tool, an on that is not a boolean, __proto__, constructor', r.asked.length === 0)
  for (const [what, id, state] of [['a no', false, 'cancelled'], ['a box that could not be shown', 'throw', 'failed']]) {
    const x = mk([id === 'throw' ? undefined : false])
    if (id === 'throw') x.gate.ask = async () => 'failed'
    const o = await (id === 'throw' ? svcMod.createToolSettingsService({ store: x.store, registry: registryMod.createToolRegistry(registryMod.BUILT_IN_TOOLS), gate: { ask: async () => 'failed', open: () => false } }).setEnabled('w', { tool: 'web_search', on: true }) : x.service.setEnabled('w', { tool: 'web_search', on: true }))
    check(`D: ${what} switches nothing on`, !o.ok && !sharedTools.toolIsOn((await x.store.read()).settings, 'web_search') && (state === 'cancelled' ? o.cancelled === true : o.error === gateMod.QUESTION_FAILED), show(o))
  }
  // caps
  r = mk([true])
  out = await r.service.setCaps('w', { steps: 3, seconds: 30 })
  check('D: lower caps ask nothing and are saved', out.ok && out.status.caps.steps === 3 && out.status.caps.seconds === 30 && r.asked.length === 0)
  out = await r.service.setCaps('w', { steps: 3, seconds: 30 })
  check('D: the same caps ask nothing', out.ok && r.asked.length === 0)
  out = await r.service.setCaps('w', { steps: 3, seconds: 90 })
  check('D: one cap raised asks, once, naming what changes, and a yes saves both', out.ok && r.asked.length === 1 && r.asked[0].detail.includes('Seconds of working time: 30 -> 90') && !r.asked[0].detail.includes('Tool steps:') && r.asked[0].yes === 'Raise the limits' && out.status.caps.seconds === 90)
  out = await r.service.setCaps('w', { steps: 9, seconds: 10 })
  check('D: a no to a raise leaves the caps exactly as they were (a lower one in the same change is not made either)', !out.ok && out.cancelled === true && out.error === svcMod.CAPS_NOT_RAISED && (await r.service.status()).caps.steps === 3 && (await r.service.status()).caps.seconds === 90)
  const mal = [{ steps: 0, seconds: 60 }, { steps: 21, seconds: 60 }, { steps: 5, seconds: 9 }, { steps: 5, seconds: 601 }, { steps: 1.5, seconds: 60 }, { steps: '5', seconds: 60 }, { steps: NaN, seconds: 60 }, { steps: Infinity, seconds: 60 }, { steps: 5 }, null, 'x']
  const outs = await Promise.all(mal.map((m) => mk().service.setCaps('w', m)))
  check('D: caps outside what the page offers, or not whole numbers, are refused', outs.every((o) => !o.ok && /whole numbers/.test(o.error)), show(outs.find((o) => o.ok)))
  const edges = [{ steps: 1, seconds: 10 }, { steps: 20, seconds: 600 }]
  check('D: the edges of the range are accepted', (await Promise.all(edges.map((e) => mk([true]).service.setCaps('w', e)))).every((o) => o.ok))
  // unreadable
  r = mk([true])
  writeFileSync(r.file, 'garbage')
  s = await r.service.status()
  check('D: a file that cannot be read: every tool off, the reason given', s.problem !== null && s.tools.every((t) => !t.on))
  out = await r.service.setEnabled('w', { tool: 'web_search', on: true })
  check('D: ...nothing can be switched on, and nobody is asked', !out.ok && /could not be read/.test(out.error) && r.asked.length === 0)
  out = await r.service.setCaps('w', { steps: 4, seconds: 40 })
  check('D: ...nor can the caps be changed', !out.ok && /could not be read/.test(out.error))
  out = await r.service.reset()
  const copies = readdirSync(join(r.file, '..')).filter((n) => n.startsWith('tools.json.damaged-'))
  check('D: starting again makes a clean file and keeps the old one as a copy', out.ok && out.status.problem === null && copies.length === 1)
  out = await r.service.reset()
  check('D: there is nothing to start again when the file can be read', !out.ok)
  r = mk()
  writeFileSync(r.file, 'garbage')
  out = await r.service.setEnabled('w', { tool: 'web_search', on: false })
  check('D: switching off a tool when the file cannot be read starts again with everything off (that does less)', out.ok && out.status.problem === null)
  // one at a time
  r = mk()
  let release
  r.gate.ask = () => new Promise((resolve) => { release = () => resolve('yes') })
  const svc = svcMod.createToolSettingsService({ store: r.store, registry: registryMod.createToolRegistry(registryMod.BUILT_IN_TOOLS), gate: r.gate })
  const first = svc.setEnabled('w', { tool: 'web_search', on: true })
  await new Promise((resolve) => setTimeout(resolve, 20))
  const second = await svc.setCaps('w', { steps: 4, seconds: 40 })
  release()
  check('D: a second change while a question is open is refused at once', !second.ok && /still being changed/.test(second.error) && (await first).ok)
  // write refused
  const refuser = settingsMod.createToolSettings({ pathOf: () => join(tempDir(), 'tools.json'), writeMode: async () => ({ form: 'refused', why: 'the key cannot be used' }) })
  const o2 = await svcMod.createToolSettingsService({ store: refuser, registry: registryMod.createToolRegistry(registryMod.BUILT_IN_TOOLS), gate: gateMod.createQuestionGate(async () => true) }).setEnabled('w', { tool: 'web_search', on: true })
  check('D: a write the rules refuse (encryption on, key unusable) is an error in words, and nothing is on', !o2.ok && o2.error.length > 10 && !sharedTools.toolIsOn((await refuser.read()).settings, 'web_search'), show(o2))
})

// ============ E. the provider is named in the question ============
await guard('E', async () => {
  const withP = questionMod.approvalQuestion(registryMod.WEB_SEARCH, { query: 'abc' }, 'why', { step: 1, steps: 5, provider: 'Anthropic' })
  const without = questionMod.approvalQuestion(registryMod.WEB_SEARCH, { query: 'abc' }, 'why', { step: 1, steps: 5 })
  check('E: the question names the provider that would run the call', withP.detail.includes('The AI provider answering you: Anthropic.') && !without.detail.includes('The AI provider answering you'))
  check('E: ...between what the call does and the step, and the question is the same otherwise', withP.detail.replace('The AI provider answering you: Anthropic.\n', '') === without.detail)
  check('E: the question still fits the box with the longest provider name', questionMod.approvalQuestion(registryMod.WEB_SEARCH, { query: '"'.repeat(300) }, '"'.repeat(240), { step: 20, steps: 20, provider: 'Anthropic' }).detail.length <= questionMod.SHOWN_LIMIT)
  const chat = source('src/main/chat.ts')
  check('E: the loop hands the runtime the provider\'s name, and the runtime hands it to the core', /provider: PROVIDER_NAMES\[entry\.provider\]/.test(chat) && /provider: input\.provider/.test(source('src/main/replyTools.ts')) && /context\.provider/.test(source('src/main/toolCore.ts')))
})

// ============ F. source checks: what the page can and cannot do ============
await guard('F', async () => {
  const preload = source('src/preload/index.ts')
  const group = preload.slice(preload.indexOf('  tools: {'), preload.indexOf('  projects: {'))
  const fns = [...group.matchAll(/^\s{4}(\w+):/gm)].map((m) => m[1])
  check('F: the bridge\'s tools group is exactly status, setEnabled, setCaps and reset', show(fns) === '["status","setEnabled","setCaps","reset"]', show(fns))
  check('F: ...and each sends only data: no path, no answer, no token', /setEnabled: \(tool, on\) => ipcRenderer\.invoke\(CHANNELS\.toolsSetEnabled, \{ tool, on \}\)/.test(group) && /setCaps: \(caps\) => ipcRenderer\.invoke\(CHANNELS\.toolsSetCaps, caps\)/.test(group))
  const ipc = source('src/main/ipc.ts')
  const handler = (name) => { const start = ipc.indexOf(`CHANNELS.${name}`); return ipc.slice(start, ipc.indexOf('ipcMain.handle', start + 10)) }
  check('F: main checks who is asking for each: status and reset with `guarded`, the two that may ask in the system\'s box with `guardedForWindow`', /guarded\(/.test(handler('toolsStatus')) && /guarded\(/.test(handler('toolsReset')) && /guardedForWindow\(/.test(handler('toolsSetEnabled')) && /guardedForWindow\(/.test(handler('toolsSetCaps')) && /toolsService\.setEnabled\(window, input\)/.test(ipc) && /toolsService\.setCaps\(window, input\)/.test(ipc))
  const svc = source('src/main/toolSettingsService.ts')
  check('F: switching ON asks (the gate), after the file is read and before it is written; switching OFF is written without asking', svc.indexOf('toolOnQuestion(def, current') > svc.indexOf('const current = await store.read()') && svc.indexOf('toolOnQuestion(def, current') < svc.indexOf('[tool]: true') && svc.indexOf('[tool]: false') < svc.indexOf('toolOnQuestion(def, current'))
  check('F: a raised cap asks, a lowered one does not', /next\.steps > from\.steps \|\| next\.seconds > from\.seconds/.test(svc))
  const files = ['src/renderer/src/chat/ToolNote.tsx', 'src/renderer/src/chat/Sources.tsx', 'src/renderer/src/tools/SwitchesSection.tsx', 'src/renderer/src/chat/MessageBubble.tsx']
  check('F: what a model or a page wrote is only ever shown as text: no markup is set, no address is an href or src, no frame, no direct window.open in the notes, the sources or the switches', files.every((f) => !/dangerouslySetInnerHTML|href=|src=|<a[ >]|<iframe|window\.open|innerHTML|eval\(/.test(source(f))))
  check('F: a source is a button that asks to open the address through the same box as any link, and carries the address only as a tooltip', /OpenLinkContext/.test(source('src/renderer/src/chat/Sources.tsx')) && /<button/.test(source('src/renderer/src/chat/Sources.tsx')) && /openLink\(source\.url\)/.test(source('src/renderer/src/chat/Sources.tsx')))
  check('F: the Stop button says "Stop everything" when a tool is on, and "Stop" otherwise', /stopEverything \? 'Stop everything' : 'Stop'/.test(source('src/renderer/src/chat/Composer.tsx')) && /stopEverything=\{toolsOn\}/.test(source('src/renderer/src/chat/ChatView.tsx')) && /toolsOn=\{anyToolOn\(toolSettings\.status\)\}/.test(source('src/renderer/src/App.tsx')))
  check('F: the tool notes never go back to the model: the wire messages hold the text only', !/tools/.test(source('src/renderer/src/chat/history.ts')))
  check('F: the settings dialog\'s Escape is held while main is working', /busyRef/.test(source('src/renderer/src/tools/ToolsDialog.tsx')))
})

console.error = realError
if (logged.length > 0) console.log(`(${logged.length} lines the app logs on faults were collected)`)
process.exit(check.summary() ? 0 : 1)
