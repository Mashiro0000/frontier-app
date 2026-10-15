// Slice 10.5 under plain Node (no window): projects (D-039). A project's rules (shared/projects.ts: a name for the person, never sent); projects.json read
// strictly (main/projects.ts); the service: making, renaming and deleting ask nothing; instructions are saved after the system's question (its words, a
// no, the look for secrets); files come through the system's open dialog and are added only after a question that names each (a no lets every copy go);
// taking a file off and deleting a project delete only the copies nothing else uses, and a deleted project's notes go with it; a damaged file is left
// alone with one way out that keeps a copy; sealed like the chats. Chats in a project: the chat file version 5 (only then; 3 and 4 byte for byte as
// before), read strictly, and backed up as they are. Memory: a project's notes, and deleting them with the project.
// Run: node tools/verify-10-5.mjs
import './ts-resolve.mjs'
import { checker } from './cdp.mjs'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { REPO, REPO_URL } from './paths.mjs'
import { makeBox } from './lib8b3.mjs'

const check = checker()
const guard = async (name, fn) => { try { await fn() } catch (error) { check(`${name} did not run to its end: ${String(error?.stack ?? error).slice(0, 300)}`, false) } }
const show = (v) => JSON.stringify(v)?.slice(0, 300)
const SRC = `${REPO_URL}/src`
const shared = await import(`${SRC}/shared/projects.ts`)
const proj = await import(`${SRC}/main/projects.ts`)
const gateMod = await import(`${SRC}/main/systemQuestion.ts`)
const storeMod = await import(`${SRC}/main/conversationStore.ts`)
const backupMod = await import(`${SRC}/main/backup.ts`)
const memMod = await import(`${SRC}/main/memory.ts`)
const { PROJECT_LIMITS } = shared
const temps = []
const tempDir = () => { const dir = mkdtempSync(join(tmpdir(), 'frontier-105-')); temps.push(dir); return dir }
const within = (promise, ms, what) => Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error(`no answer within ${ms} ms: ${what}`)), ms))])
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const source = (rel) => readFileSync(join(REPO, rel), 'utf8')

const KEY = 'sk-ant-api03-' + 'Zq3vR8tLm2Xw9Kc4Jh7Pd1Ns6Bf0Gy5Ue2Ta8Wo3Ri7Ml4Vx9Qk1Hs6Nc0Dj5Pg2Bf8Ty3Lw7Ex4Rv9Mz1Qa6Ku0Cn5Hj-AbCdEfAA'
const hex = (n) => n.toString(16).padStart(64, '0')
const info = (n, extra = {}) => ({ id: hex(n), name: `file-${n}.pdf`, kind: 'pdf', mediaType: 'application/pdf', bytes: 1000 + n, pages: 3, changes: { metadataRemoved: false, shrunkFrom: null, turned: false, convertedFrom: null }, ...extra })

function played(answers) {
  const asked = []
  const clock = { now: 1_000_000 }
  const askPerson = async (owner, question) => {
    asked.push({ owner, question })
    const answer = answers.shift()
    if (answer === 'throw') throw new Error('the box could not be shown')
    if (typeof answer === 'function') return answer()
    return answer
  }
  return { asked, clock, gate: gateMod.createQuestionGate(askPerson, () => clock.now) }
}

let ids = 0
const nextId = () => `00000000-0000-4000-b000-${String(++ids).padStart(12, '0')}`
/** A stand-in for the attachment store: what the open dialog would give, and a record of every copy let go of or deleted. */
function fakeFiles(picks = []) {
  const log = { picked: 0, released: [], discarded: [], deleted: [] }
  return {
    log,
    files: {
      pick: async () => { log.picked += 1; const next = picks.shift(); return next ?? { ok: false, cancelled: true, error: 'Cancelled.' } },
      release: (id) => { log.released.push(id) },
      discard: async (id) => { log.discarded.push(id) },
      deleteUnused: async (list) => { log.deleted.push(...list) }
    }
  }
}
function service(dir, answers, extra = {}) {
  const g = played(answers)
  const f = fakeFiles(extra.picks ?? [])
  const removedNotes = []
  const svc = proj.createProjects({
    pathOf: () => join(dir, 'projects.json'),
    writeMode: async () => ({ form: 'plain' }),
    gate: g.gate,
    savedKeys: async () => [{ provider: 'anthropic', key: KEY }],
    files: f.files,
    removeNotes: async (id) => { removedNotes.push(id) },
    now: () => 2_000_000,
    newId: nextId,
    ...(extra.options ?? {})
  })
  return { ...g, svc, log: f.log, removedNotes, file: join(dir, 'projects.json') }
}
const fileOf = (s) => (existsSync(s.file) ? JSON.parse(readFileSync(s.file, 'utf8')) : null)
const owner = { window: 5 }

// ============ A. a project's rules ============
await guard('A', async () => {
  const { checkProjectName, isProjectId, sameName } = shared
  check('A: the caps: 100 projects, a name of 100 characters, 20 files', PROJECT_LIMITS.maxProjects === 100 && PROJECT_LIMITS.maxNameChars === 100 && PROJECT_LIMITS.maxFiles === 20)
  check('A: a name is put on one line and trimmed', show(checkProjectName('  My\n  thesis  ')) === show({ ok: true, name: 'My thesis' }))
  check('A: an empty name, 101 characters and not text are refused, each with a sentence', !checkProjectName('   ').ok && !checkProjectName('x'.repeat(101)).ok && checkProjectName('x'.repeat(100)).ok && /not understood/.test(checkProjectName(5).error))
  check('A: a project id is a lower-case uuid', isProjectId('11111111-2222-4333-8444-555555555555') && !isProjectId('AAAAAAAA-2222-4333-8444-555555555555') && !isProjectId('x'))
  check('A: two names that differ only in capitals are the same', sameName('Thesis', 'THESIS') && !sameName('Thesis', 'Theses'))
})

// ============ B. the file ============
const project = (n, extra = {}) => ({ id: `00000000-0000-4000-a000-${String(n).padStart(12, '0')}`, name: `Project ${n}`, instructions: '', files: [], createdAt: 10 + n, updatedAt: 10 + n, ...extra })
await guard('B', async () => {
  const { parseProjectsFile, projectsFileText } = proj
  const good = { version: 1, projects: [project(1, { instructions: 'Be brief.', files: [info(1)] }), project(2)] }
  check('B: what this app writes is read back the same', show(parseProjectsFile(JSON.stringify(good))) === show({ projects: good.projects }) && projectsFileText({ projects: good.projects }) === JSON.stringify(good))
  const bad = [
    ['a field more', { ...good, extra: 1 }],
    ['another version', { ...good, version: 2 }],
    ['101 projects', { ...good, projects: Array.from({ length: 101 }, (_, i) => project(i + 1)) }],
    ['an id twice', { ...good, projects: [project(1), project(1, { name: 'Other' })] }],
    ['a name twice (in other capitals)', { ...good, projects: [project(1, { name: 'Thesis' }), project(2, { name: 'THESIS' })] }],
    ['a name that is not trimmed', { ...good, projects: [project(1, { name: ' Thesis' })] }],
    ['instructions that are not trimmed', { ...good, projects: [project(1, { instructions: ' x' })] }],
    ['instructions of 8,001 characters', { ...good, projects: [project(1, { instructions: 'x'.repeat(8001) })] }],
    ['21 files', { ...good, projects: [project(1, { files: Array.from({ length: 21 }, (_, i) => info(i + 1)) })] }],
    ['a file twice', { ...good, projects: [project(1, { files: [info(1), info(1)] })] }],
    ['a file that is not one', { ...good, projects: [project(1, { files: [{ id: 'x' }] })] }],
    ['changed before it was made', { ...good, projects: [project(1, { updatedAt: 1 })] }],
    ['a project with a field more', { ...good, projects: [{ ...project(1), colour: 'red' }] }]
  ]
  const passed = bad.filter(([, value]) => parseProjectsFile(JSON.stringify(value)) !== null).map(([what]) => what)
  check('B: anything but exactly what this app writes is not read (13 kinds)', passed.length === 0, show(passed))
})

// ============ C. making, renaming, instructions ============
await guard('C', async () => {
  let dir = tempDir()
  let s = service(dir, [])
  check('C: nothing saved: no projects, no problem', show(await s.svc.status()) === show({ projects: [], problem: null }))
  let r = await s.svc.create({ name: '  Thesis ' })
  const thesis = r.project
  check('C: making a project asks nothing, answers its id, and writes it (no instructions, no files)', r.ok && s.asked.length === 0 && thesis === '00000000-0000-4000-b000-000000000001' && fileOf(s).projects[0].name === 'Thesis' && fileOf(s).projects[0].instructions === '' && fileOf(s).projects[0].files.length === 0, show(r))
  r = await s.svc.create({ name: 'thesis' })
  check('C: a second project of the same name (in other capitals) is refused', !r.ok && /already a project called "thesis"/.test(r.error), show(r))
  r = await s.svc.rename({ id: thesis, name: 'My thesis' })
  check('C: renaming asks nothing', r.ok && s.asked.length === 0 && fileOf(s).projects[0].name === 'My thesis')
  r = await s.svc.rename({ id: '99999999-2222-4333-8444-555555555555', name: 'X' })
  check('C: a project that is not there cannot be renamed', !r.ok && /not there any more/.test(r.error))
  for (const input of [null, 5, {}, { name: 5 }, { name: '' }]) {
    r = await s.svc.create(input)
    if (r.ok) check(`C: ${show(input)} made a project`, false)
  }
  check('C: input that is not { name } makes nothing', fileOf(s).projects.length === 1)
  s = service(dir, [true])
  r = await s.svc.setInstructions(owner, { id: thesis, text: '  Cite sources.  ' })
  const q = s.asked[0]?.question
  check('C: instructions are saved after the question: "Project instructions", the project named, the text and its length, where they go; for the window that asked', r.ok && s.asked.length === 1 && s.asked[0].owner === owner && q.title === 'Project instructions' && q.message === 'Save these instructions for the project "My thesis"?' && q.detail.startsWith('"Cite sources."') && q.detail.includes('13 characters. They go to the company that runs the model with every message of every chat in this project') && q.yes === 'Save the instructions' && fileOf(s).projects[0].instructions === 'Cite sources.', show(q))
  s = service(dir, [false])
  r = await s.svc.setInstructions(owner, { id: thesis, text: 'Something else' })
  check('C: a no: the project is as it was, marked "cancelled"', !r.ok && r.cancelled === true && fileOf(s).projects[0].instructions === 'Cite sources.')
  s = service(dir, [])
  r = await s.svc.setInstructions(owner, { id: thesis, text: `use ${KEY}` })
  check('C: instructions holding a saved key are refused before any question', !r.ok && /Anthropic API key/.test(r.error) && s.asked.length === 0)
  r = await s.svc.setInstructions(owner, { id: thesis, text: 'password: hunter22' })
  check('C: a lookalike: warnings, nothing asked', !r.ok && r.warnings?.length === 1 && s.asked.length === 0)
  r = await s.svc.setInstructions(owner, { id: thesis, text: '' })
  check('C: emptying them asks nothing', r.ok && s.asked.length === 0 && fileOf(s).projects[0].instructions === '')
  r = await s.svc.setInstructions(owner, { id: thesis, text: 5 })
  check('C: instructions that are not text are not understood', !r.ok && /not understood/.test(r.error))
  const many = tempDir()
  writeFileSync(join(many, 'projects.json'), JSON.stringify({ version: 1, projects: Array.from({ length: 100 }, (_, i) => project(i + 1)) }))
  s = service(many, [])
  r = await s.svc.create({ name: 'One more' })
  check('C: a 101st project is refused', !r.ok && /100 projects, the most there can be/.test(r.error))
})

// ============ D. files ============
await guard('D', async () => {
  const dir = tempDir()
  writeFileSync(join(dir, 'projects.json'), JSON.stringify({ version: 1, projects: [project(1, { name: 'Thesis', files: [info(1)] })] }))
  const id = project(1).id
  let s = service(dir, [true], { picks: [{ ok: true, files: [{ info: info(2) }, { info: info(3, { name: 'notes.txt', kind: 'text', mediaType: 'text/plain', chars: 4200, lines: 80, pages: undefined }) }, { info: info(1) }], refused: ['big.zip was not attached: it is not a kind of file the app takes.'] }] })
  let r = await s.svc.addFiles(owner, { id })
  const q = s.asked[0]?.question
  check('D: "Add files..." opens the system\'s open dialog, then asks a question that names each new file', s.log.picked === 1 && q?.title === 'Project files' && q.message === 'Add these 2 files to the project "Thesis"?' && q.detail.includes('- file-2.pdf (3 pages, 1 KB)') && q.detail.includes('- notes.txt (4,200 characters)') && /with every message of every chat in this project, at the start of the conversation/.test(q.detail) && q.yes === 'Add the files', show(q))
  check('D: ...a file already in the project is not asked about again, and is let go of; what the dialog refused is said', r.ok && s.log.discarded.includes(hex(1)) && r.refused?.some((x) => /already in the project/.test(x)) && r.refused?.some((x) => /big\.zip/.test(x)), show(r))
  check('D: on a yes the files are added (oldest first) and let go of by this run (the project keeps them now)', show(fileOf(s).projects[0].files.map((f) => f.id)) === show([hex(1), hex(2), hex(3)]) && s.log.released.includes(hex(2)) && s.log.released.includes(hex(3)), show(fileOf(s).projects[0].files.map((f) => f.name)))
  s = service(dir, [false], { picks: [{ ok: true, files: [{ info: info(4) }], refused: [] }] })
  r = await s.svc.addFiles(owner, { id })
  check('D: a no: nothing added, and the copy is let go of (deleted if nothing uses it)', !r.ok && r.cancelled === true && fileOf(s).projects[0].files.length === 3 && s.log.discarded.includes(hex(4)) && s.asked[0].question.message === 'Add this file to the project "Thesis"?')
  s = service(dir, [], { picks: [] })
  r = await s.svc.addFiles(owner, { id })
  check('D: closing the open dialog changes nothing and asks nothing', !r.ok && r.cancelled === true && s.asked.length === 0)
  const full = tempDir()
  writeFileSync(join(full, 'projects.json'), JSON.stringify({ version: 1, projects: [project(1, { files: Array.from({ length: 19 }, (_, i) => info(i + 10)) })] }))
  s = service(full, [true], { picks: [{ ok: true, files: [{ info: info(50) }, { info: info(51) }], refused: [] }] })
  r = await s.svc.addFiles(owner, { id })
  check('D: past 20 files: the room left is filled, the rest refused and let go of', r.ok && fileOf(s).projects[0].files.length === 20 && s.log.discarded.includes(hex(51)) && r.refused?.some((x) => /at most 20 files/.test(x)), show(r))
  s = service(dir, [])
  r = await s.svc.removeFile({ id, fileId: hex(2) })
  check('D: taking a file off asks nothing, and its copy is deleted only if nothing else uses it (the store decides)', r.ok && s.asked.length === 0 && !fileOf(s).projects[0].files.some((f) => f.id === hex(2)) && show(s.log.deleted) === show([hex(2)]))
  r = await s.svc.removeFile({ id, fileId: hex(2) })
  check('D: taking it off again: "not in the project any more"', !r.ok && /not in the project any more/.test(r.error))
  check('D: the files of every project, for the sweep', show([...(await s.svc.fileRefs())].sort()) === show([hex(1), hex(3)]))
})

// ============ E. deleting a project, a damaged file, sealing ============
await guard('E', async () => {
  const dir = tempDir()
  writeFileSync(join(dir, 'projects.json'), JSON.stringify({ version: 1, projects: [project(1, { name: 'Thesis', files: [info(1), info(2)] }), project(2, { name: 'Novel' })] }))
  let s = service(dir, [])
  check('E: a project\'s name by id, and none for an id that is not one', (await s.svc.nameOf(project(1).id)) === 'Thesis' && (await s.svc.nameOf('99999999-2222-4333-8444-555555555555')) === null)
  const fr = await s.svc.forRequest(project(1).id)
  check('E: what a request of a chat in it brings (10.6): the project; none for one that has gone', fr.ok && fr.project?.name === 'Thesis' && (await s.svc.forRequest('99999999-2222-4333-8444-555555555555')).project === null)
  let r = await s.svc.remove({ id: project(1).id })
  check('E: deleting a project asks nothing here, deletes its notes, and offers its files for deletion (kept if a chat uses them)', r.ok && s.asked.length === 0 && show(s.removedNotes) === show([project(1).id]) && show(s.log.deleted) === show([hex(1), hex(2)]) && fileOf(s).projects.map((p) => p.name).join() === 'Novel', show(r))
  const bad = tempDir()
  writeFileSync(join(bad, 'projects.json'), '{"version":1,"projects":[{"id"')
  s = service(bad, [true])
  const st = await s.svc.status()
  check('E: a damaged file: no projects, and the problem in words', st.projects.length === 0 && /not a file this app wrote/.test(st.problem ?? ''), show(st))
  const before = readFileSync(join(bad, 'projects.json'), 'utf8')
  const tries = [await s.svc.create({ name: 'New' }), await s.svc.rename({ id: project(1).id, name: 'X' }), await s.svc.setInstructions(owner, { id: project(1).id, text: 'x' }), await s.svc.remove({ id: project(1).id })]
  check('E: nothing is changed while it cannot be read (byte for byte), and nothing is asked', tries.every((t) => !t.ok && /could not be read/.test(t.error)) && s.asked.length === 0 && readFileSync(join(bad, 'projects.json'), 'utf8') === before, show(tries.map((t) => t.error)))
  check('E: a request of a chat in a project is refused while it cannot be read, saying the way out', /^Nothing was sent: your projects could not be read \(.+\)\. Open Projects to delete them all; the app keeps a copy of the file\.$/.test((await s.svc.forRequest(project(1).id)).error ?? ''))
  check('E: ...and its files are not known, so nothing is deleted by the sweep', (await s.svc.fileRefs()) === null)
  r = await s.svc.removeAll()
  check('E: "Delete all projects" is the way out: a copy of the damaged file is kept, then none', r.ok && readdirSync(bad).some((n) => n.startsWith('projects.json.damaged-')) && show(fileOf(s)) === show({ version: 1, projects: [] }))
  const box = makeBox()
  const sdir = tempDir()
  s = service(sdir, [], { options: { box, writeMode: async () => ({ form: 'encrypted' }) } })
  await s.svc.create({ name: 'Sealed project' })
  const raw = readFileSync(join(sdir, 'projects.json'), 'utf8')
  check('E: with encryption on, projects.json is the chats\' envelope and the name is nowhere in it', raw.startsWith('{"format":"frontier-chat-encrypted"') && !raw.includes('Sealed project'))
  let release
  const hold = new Promise((resolve) => { release = resolve })
  const busyDir = tempDir()
  writeFileSync(join(busyDir, 'projects.json'), JSON.stringify({ version: 1, projects: [project(1)] }))
  s = service(busyDir, [() => hold.then(() => true)])
  const first = s.svc.setInstructions(owner, { id: project(1).id, text: 'First' })
  await wait(20)
  const second = await within(s.svc.create({ name: 'While waiting' }), 2000, 'a second change while the first waits')
  check('E: one change at a time: a second while the first waits for its answer is refused at once', !second.ok && /still being changed/.test(second.error), show(second))
  release()
  await within(first, 2000, 'the first change')
})

// ============ F. chats in a project: the file version 5 ============
await guard('F', async () => {
  const { createConversationStore, parseSavedFile, fileVersion } = storeMod
  const dir = tempDir()
  const store = createConversationStore(join(dir, 'conversations'), { writeMode: async () => ({ form: 'plain' }) })
  const id1 = '00000000-0000-4000-8000-000000000001'
  const id2 = '00000000-0000-4000-8000-000000000002'
  const messages = [{ role: 'user', content: 'Hello', status: 'done' }, { role: 'assistant', content: 'Hi', status: 'done', provider: 'anthropic', model: 'claude-opus-5-5' }]
  await store.save({ id: id1, messages, instructions: '' })
  await store.save({ id: id2, messages, instructions: '', project: project(1).id })
  const f1 = JSON.parse(readFileSync(join(dir, 'conversations', `${id1}.json`), 'utf8'))
  const f2 = JSON.parse(readFileSync(join(dir, 'conversations', `${id2}.json`), 'utf8'))
  check('F: a chat in no project is written as before (version 3, no "project" field)', f1.version === 3 && !('project' in f1) && JSON.stringify(Object.keys(f1)) === '["version","id","title","createdAt","updatedAt","instructions","messages"]', show(Object.keys(f1)))
  check('F: a chat in a project is version 5, with the project\'s id last', f2.version === 5 && f2.project === project(1).id && JSON.stringify(Object.keys(f2)) === '["version","id","title","createdAt","updatedAt","instructions","messages","project"]', show(Object.keys(f2)))
  const loaded = await store.load(id2)
  check('F: it opens with its project; one in no project opens without', loaded.ok && loaded.conversation.project === project(1).id && (await store.load(id1)).conversation.project === undefined)
  const list = await store.list()
  check('F: the list says which project each chat is in', list.conversations.find((c) => c.id === id2)?.project === project(1).id && list.conversations.find((c) => c.id === id1)?.project === undefined, show(list.conversations))
  check('F: the version is 5 with a project, else 4 with files, else 3', fileVersion({ messages, project: 'x' }) === 5 && fileVersion({ messages: [{ ...messages[0], attachments: [info(1)] }] }) === 4 && fileVersion({ messages }) === 3)
  const v5 = { ...f2 }
  check('F: a version 5 file must name a project, by an id that is one', typeof parseSavedFile({ ...v5, project: undefined }, id2) === 'string' && typeof parseSavedFile({ ...v5, project: 'Thesis' }, id2) === 'string' && typeof parseSavedFile(v5, id2) === 'object')
  check('F: a version 5 file may carry files, like version 4', typeof parseSavedFile({ ...v5, messages: [{ ...messages[0], attachments: [info(1)] }, messages[1]] }, id2) === 'object')
  check('F: an older file that says "project" is read without one (that version did not know projects)', parseSavedFile({ ...f1, project: project(1).id }, id1).project === undefined)
  await store.save({ id: id2, messages, instructions: '' })
  check('F: taken out of the project, the chat is version 3 again', JSON.parse(readFileSync(join(dir, 'conversations', `${id2}.json`), 'utf8')).version === 3)
  const line = backupMod.chatText({ ...loaded.conversation })
  check('F: a backup holds a chat in a project as its version 5 text', JSON.parse(line).version === 5 && JSON.parse(line).project === project(1).id)
})

// ============ G. memory: a project's notes ============
await guard('G', async () => {
  const dir = tempDir()
  const g = played([true, true])
  const memory = memMod.createMemory({ pathOf: () => join(dir, 'memory.json'), writeMode: async () => ({ form: 'plain' }), gate: g.gate, savedKeys: async () => [], projectName: async (id) => (id === project(1).id ? 'Thesis' : null), dataDir: dir, pickExportPath: async () => null })
  await memory.add(null, { text: 'For every chat', scope: 'all' })
  const r = await memory.add(null, { text: 'For the thesis', scope: project(1).id })
  check('G: a note for a project is asked about with the project named', r.ok && g.asked[1].question.message === 'Remember this for the chats of "Thesis"?')
  await memory.removeScope(project(1).id)
  const st = await memory.status()
  check('G: deleting a project deletes its notes and only them, asking nothing', show(st.notes.map((n) => n.text)) === show(['For every chat']) && g.asked.length === 2)
})

// ============ H. what only the window would show, by its source ============
await guard('H', async () => {
  const ipc = source('src/main/ipc.ts')
  check('H: ipc.ts: the projects store uses the app\'s one gate, the chats\' write rule and the attachment store; memory knows project names', /createProjects\(\{/.test(ipc) && /gate: questions/.test(ipc) && /projectName: \(id\) => projects\.nameOf\(id\)/.test(ipc))
  check('H: ...the sweep and every deletion count the projects\' files as used, and delete nothing while projects.json cannot be read', /const inProjects = await projects\.fileRefs\(\)\s*return chats\.complete && inProjects !== null \? new Set\(\[\.\.\.chats\.ids, \.\.\.inProjects\]\) : null/.test(ipc) && /void usedFiles\(\)\s*\.then\(\(used\) => \(used !== null \? attachments\.sweep\(used, 3_600_000\)/.test(ipc) && /referenced: \(\) => usedFiles\(\)/.test(ipc))
  check('H: ...the encryption flow converts projects.json, quitting waits for it', /keptDocuments\(\[\s*everyChat\.file,\s*memory\.file,\s*projects\.file,\s*auditLog\.document,\s*toolSettings\.file,\s*workspaceStore\.file,\s*undoJournal\.document,\s*connectorStore\.file\s*\]\)/.test(ipc) && /projects\.file\.whenIdle\(\)/.test(ipc))
})

for (const dir of temps) rmSync(dir, { recursive: true, force: true })
process.exit(check.summary() ? 0 : 1)
