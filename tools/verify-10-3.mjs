// Slice 10.3 under plain Node (no window): the memory store in main (D-039). The note's rules (shared/memory.ts: trimmed, 1 to 500 characters, where it
// applies); memory.json read strictly (main/memory.ts: exactly what this app writes, the caps of a place); the service: a note is made or changed only
// after the person's yes in the system's message box (its words, the place, the room left), never with a saved key, a lookalike only with "Save anyway",
// caps of 500 characters, 8,000 characters and 100 notes a place, a project that is not there refused; deleting and turning memory off ask nothing,
// turning it on asks; one change at a time and the gate's answers; what goes with a request (every chat's notes, then a project's, none while off); a file
// that cannot be read (every request refused, nothing changed but the two ways out, which keep a copy); sealed like the chats; the export to a plain file
// the person picks (never into the data folder, read back).
// Run: node tools/verify-10-3.mjs
import './ts-resolve.mjs'
import { checker } from './cdp.mjs'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { REPO_URL } from './paths.mjs'
import { makeBox } from './lib8b3.mjs'

const check = checker()
const guard = async (name, fn) => { try { await fn() } catch (error) { check(`${name} did not run to its end: ${String(error?.stack ?? error).slice(0, 300)}`, false) } }
const show = (v) => JSON.stringify(v)?.slice(0, 300)
const SRC = `${REPO_URL}/src`
const shared = await import(`${SRC}/shared/memory.ts`)
const mem = await import(`${SRC}/main/memory.ts`)
const gateMod = await import(`${SRC}/main/systemQuestion.ts`)
const { MEMORY_LIMITS, ALL_CHATS } = shared
const temps = []
const tempDir = () => { const dir = mkdtempSync(join(tmpdir(), 'frontier-103-')); temps.push(dir); return dir }
const within = (promise, ms, what) => Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error(`no answer within ${ms} ms: ${what}`)), ms))])
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const KEY = 'sk-ant-api03-' + 'Zq3vR8tLm2Xw9Kc4Jh7Pd1Ns6Bf0Gy5Ue2Ta8Wo3Ri7Ml4Vx9Qk1Hs6Nc0Dj5Pg2Bf8Ty3Lw7Ex4Rv9Mz1Qa6Ku0Cn5Hj-AbCdEfAA'
const PROJECT = '11111111-2222-4333-8444-555555555555'
const OTHER = '99999999-2222-4333-8444-555555555555'

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
const nextId = () => `00000000-0000-4000-9000-${String(++ids).padStart(12, '0')}` // never the seeded notes' ids (8000-...)
function service(dir, answers, extra = {}) {
  const g = played(answers)
  const time = { now: Date.UTC(2026, 9, 7, 9, 30) }
  const picks = []
  const svc = mem.createMemory({
    pathOf: () => join(dir, 'memory.json'),
    writeMode: async () => ({ form: 'plain' }),
    gate: g.gate,
    savedKeys: async () => [{ provider: 'anthropic', key: KEY }],
    projectName: async (id) => (id === PROJECT ? 'Thesis' : null),
    dataDir: dir,
    pickExportPath: async (owner, name) => { picks.push({ owner, name }); return extra.exportTo === undefined ? null : extra.exportTo },
    now: () => time.now,
    newId: nextId,
    ...extra
  })
  return { ...g, svc, time, picks, file: join(dir, 'memory.json') }
}
const fileOf = (s) => (existsSync(s.file) ? JSON.parse(readFileSync(s.file, 'utf8')) : null)
const owner = { window: 3 }

// ============ A. a note's rules ============
await guard('A', async () => {
  const { checkNoteText, isNoteScope, isNoteId, scopeUse } = shared
  check('A: the caps: 500 characters a note, 8,000 characters and 100 notes a place', MEMORY_LIMITS.maxNoteChars === 500 && MEMORY_LIMITS.maxScopeChars === 8000 && MEMORY_LIMITS.maxScopeNotes === 100)
  check('A: a note is trimmed', show(checkNoteText('  I like tea.\n')) === show({ ok: true, text: 'I like tea.' }))
  check('A: empty or white space is refused, with a sentence', !checkNoteText('  \n ').ok && /needs some text/.test(checkNoteText('').error))
  check('A: 500 characters pass, 501 are refused (it goes with every message)', checkNoteText('x'.repeat(500)).ok && !checkNoteText('x'.repeat(501)).ok && /500 characters/.test(checkNoteText('x'.repeat(501)).error))
  check('A: text that is not text is not understood', [5, null, undefined, {}, ['x']].every((v) => !checkNoteText(v).ok && /not understood/.test(checkNoteText(v).error)))
  check('A: a place is "all" or a project id (a lower-case uuid), nothing else', isNoteScope('all') && isNoteScope(PROJECT) && !isNoteScope('ALL') && !isNoteScope('aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'.toUpperCase()) && !isNoteScope('project') && !isNoteScope(5) && !isNoteScope(''))
  check('A: a note id is a lower-case uuid', isNoteId(PROJECT) && !isNoteId('1') && !isNoteId(null))
  const notes = [{ scope: 'all', text: 'abc' }, { scope: PROJECT, text: 'defg' }, { scope: 'all', text: 'hi' }]
  check('A: the room a place takes is counted by notes and characters', show(scopeUse(notes, 'all')) === show({ notes: 2, chars: 5 }) && show(scopeUse(notes, PROJECT)) === show({ notes: 1, chars: 4 }))
})

// ============ B. the file ============
const note = (n, extra = {}) => ({ id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`, text: `Note ${n}`, scope: 'all', createdAt: 1_000 + n, updatedAt: 1_000 + n, ...extra })
await guard('B', async () => {
  const { parseMemoryFile, memoryFileText } = mem
  const good = { version: 1, on: true, notes: [note(1), note(2, { scope: PROJECT })] }
  check('B: what this app writes is read back the same', show(parseMemoryFile(JSON.stringify(good))) === show({ on: true, notes: good.notes }) && memoryFileText({ on: true, notes: good.notes }) === JSON.stringify(good))
  const bad = [
    ['a field more', { ...good, extra: 1 }],
    ['another version', { ...good, version: 2 }],
    ['"on" not true or false', { ...good, on: 'yes' }],
    ['notes not a list', { ...good, notes: {} }],
    ['an id twice', { ...good, notes: [note(1), note(1)] }],
    ['a note with a field more', { ...good, notes: [{ ...note(1), pinned: true }] }],
    ['a note with an id that is not one', { ...good, notes: [note(1, { id: 'x' })] }],
    ['a note in a place that is not one', { ...good, notes: [note(1, { scope: 'ALL' })] }],
    ['a note changed before it was made', { ...good, notes: [note(1, { updatedAt: 5 })] }],
    ['a note that is not trimmed', { ...good, notes: [note(1, { text: ' x' })] }],
    ['a note of 501 characters', { ...good, notes: [note(1, { text: 'x'.repeat(501) })] }],
    ['an empty note', { ...good, notes: [note(1, { text: '' })] }],
    ['a place over 8,000 characters', { ...good, notes: Array.from({ length: 17 }, (_, i) => note(i + 1, { text: 'y'.repeat(499) + i })) }],
    ['a place with 101 notes', { ...good, notes: Array.from({ length: 101 }, (_, i) => note(i + 1)) }],
    ['a time that is not a whole number', { ...good, notes: [note(1, { createdAt: 1.5 })] }]
  ]
  const passed = bad.filter(([, value]) => parseMemoryFile(JSON.stringify(value)) !== null).map(([what]) => what)
  check('B: anything but exactly what this app writes is not read (15 kinds)', passed.length === 0, show(passed))
  check('B: 100 notes in one place and 16 x 500 characters are within the caps', parseMemoryFile(JSON.stringify({ ...good, notes: Array.from({ length: 100 }, (_, i) => note(i + 1)) })) !== null && parseMemoryFile(JSON.stringify({ ...good, notes: Array.from({ length: 16 }, (_, i) => note(i + 1, { text: 'z'.repeat(499) + (i % 10) })) })) !== null)
  check('B: the caps are per place: 100 notes for every chat and 100 for a project', parseMemoryFile(JSON.stringify({ ...good, notes: [...Array.from({ length: 100 }, (_, i) => note(i + 1)), ...Array.from({ length: 100 }, (_, i) => note(i + 101, { scope: PROJECT }))] })) !== null)
})

// ============ C. making, changing and deleting notes ============
await guard('C', async () => {
  let dir = tempDir()
  let s = service(dir, [true])
  check('C: nothing saved: memory on, no notes, no problem', show(await s.svc.status()) === show({ on: true, notes: [], problem: null }))
  let r = await s.svc.add(owner, { text: '  I am a nurse in Leeds.  ', scope: 'all' })
  check('C: a note is saved only after the question, asked once, for the window that asked', r.ok && s.asked.length === 1 && s.asked[0].owner === owner, show(r))
  const q = s.asked[0].question
  check('C: the question: "Memory", "Remember this for every chat?", the note, its length, where it goes, the room it leaves, that the page cannot answer; "Remember it" and "Cancel"', q.title === 'Memory' && q.message === 'Remember this for every chat?' && q.detail.startsWith('"I am a nurse in Leeds."') && q.detail.includes('22 characters. Your notes go to the company that runs the model with every message of every chat') && q.detail.includes('With this one: 1 note for every chat, 22 of 8,000 characters.') && /cannot answer/.test(q.detail) && q.yes === 'Remember it' && q.no === 'Cancel', show(q))
  let f = fileOf(s)
  check('C: the file: {"version":1,"on":true,"notes":[...]}, the note trimmed, with an id from main and its time', f?.version === 1 && f.on === true && f.notes.length === 1 && f.notes[0].text === 'I am a nurse in Leeds.' && f.notes[0].id === '00000000-0000-4000-9000-000000000001' && f.notes[0].scope === 'all' && f.notes[0].createdAt === s.time.now && f.notes[0].updatedAt === s.time.now, show(f))
  check('C: the answer carries the new status', r.status.notes.length === 1 && r.status.on === true)
  s = service(dir, [false])
  r = await s.svc.add(owner, { text: 'I prefer metric units.', scope: 'all' })
  check('C: a no: nothing saved, "Not saved: your notes are as they were.", marked "cancelled"', !r.ok && r.cancelled === true && r.error === mem.NOTE_NOT_SAVED && fileOf(s).notes.length === 1, show(r))
  s.clock.now += 1000
  r = await s.svc.add(owner, { text: 'Again at once.', scope: 'all' })
  check('C: within 3 s of a no, nothing is asked (the gate rests)', !r.ok && /Wait a few seconds/.test(r.error) && s.asked.length === 1)
  s = service(dir, [])
  r = await s.svc.add(owner, { text: 'I am a nurse in Leeds.', scope: 'all' })
  check('C: the same note again asks nothing: "This is already one of your notes."', !r.ok && r.cancelled === true && /already one of your notes/.test(r.error) && s.asked.length === 0)
  r = await s.svc.add(owner, { text: `My key: ${KEY.slice(10, 40)}`, scope: 'all', saveAnyway: true })
  check('C: a note that holds a saved key is refused at once (even with "Save anyway"), naming Anthropic, never showing it', !r.ok && s.asked.length === 0 && /Anthropic API key/.test(r.error) && !r.error.includes(KEY.slice(14, 30)), show(r))
  r = await s.svc.add(owner, { text: 'wifi password: Tr0ub4dor', scope: 'all' })
  check('C: a note that looks like a password: warnings, masked, nothing asked', !r.ok && r.warnings?.length === 1 && r.warnings[0].shown === 'password: T… (9 characters)' && s.asked.length === 0, show(r))
  s = service(dir, [true])
  r = await s.svc.add(owner, { text: 'wifi password: Tr0ub4dor', scope: 'all', saveAnyway: true })
  check('C: ...with "Save anyway" the question is asked and says so; on a yes it is kept', r.ok && /you chose to save it anyway/.test(s.asked[0].question.detail) && fileOf(s).notes.length === 2)
  s = service(dir, [])
  r = await s.svc.add(owner, { text: 'x'.repeat(501), scope: 'all' })
  check('C: 501 characters are refused before any question', !r.ok && /500 characters/.test(r.error) && s.asked.length === 0)
  for (const input of [null, 5, {}, { text: 5, scope: 'all' }, { text: 'x', scope: 'ALL' }, { text: 'x', scope: 'project' }, { text: 'x' }]) {
    r = await s.svc.add(owner, input)
    if (r.ok || s.asked.length !== 0) check(`C: ${show(input)} was taken as a note`, false, show(r))
  }
  check('C: input that is not { text, scope } is refused, nothing asked, nothing written', fileOf(s).notes.length === 2)
  r = await s.svc.add(owner, { text: 'For a project that is gone', scope: OTHER })
  check('C: a note for a project that is not there is refused', !r.ok && /project is not there/.test(r.error) && s.asked.length === 0)
  s = service(dir, [true])
  r = await s.svc.add(owner, { text: 'Chapter 3 is about sampling.', scope: PROJECT })
  check('C: a note for a project: the question names the project and its chats', r.ok && s.asked[0].question.message === 'Remember this for the chats of "Thesis"?' && s.asked[0].question.detail.includes('with every message of the chats of the project "Thesis"') && s.asked[0].question.detail.includes('1 note for the chats of the project "Thesis"'), show(s.asked[0]?.question))

  // Changing a note.
  const first = fileOf(s).notes[0]
  s = service(dir, [true])
  s.time.now += 60_000
  r = await s.svc.edit(owner, { id: first.id, text: 'I am a nurse in York.' })
  check('C: changing a note asks "Change this note?", with the new words and the old', r.ok && s.asked[0].question.message === 'Change this note?' && s.asked[0].question.detail.startsWith('"I am a nurse in York."') && s.asked[0].question.detail.includes('Was: "I am a nurse in Leeds."') && s.asked[0].question.yes === 'Save the note', show(s.asked[0]?.question))
  f = fileOf(s)
  const changed = f.notes.find((n) => n.id === first.id)
  check('C: ...on a yes the same note (id, place, time made) has the new words and the time it changed', changed?.text === 'I am a nurse in York.' && changed.createdAt === first.createdAt && changed.updatedAt === s.time.now && changed.scope === 'all' && f.notes[0].id === first.id, show(changed))
  s = service(dir, [])
  r = await s.svc.edit(owner, { id: first.id, text: 'I am a nurse in York.' })
  check('C: the same words again: nothing asked, nothing changed', r.ok && s.asked.length === 0)
  s = service(dir, [false])
  r = await s.svc.edit(owner, { id: first.id, text: 'Something else' })
  check('C: a no to a change: the note is as it was', !r.ok && r.cancelled && fileOf(s).notes[0].text === 'I am a nurse in York.')
  s = service(dir, [])
  r = await s.svc.edit(owner, { id: PROJECT, text: 'no such note' })
  check('C: changing a note that is not there is refused', !r.ok && /not there any more/.test(r.error) && s.asked.length === 0)
  r = await s.svc.edit(owner, { id: 'x', text: 'y' })
  check('C: an id that is not one is not understood', !r.ok && /not understood/.test(r.error))

  // Deleting, memory off and on.
  const count = fileOf(s).notes.length
  r = await s.svc.remove({ id: first.id })
  check('C: deleting a note asks nothing here (the page asks first) and removes only it', r.ok && s.asked.length === 0 && fileOf(s).notes.length === count - 1 && !fileOf(s).notes.some((n) => n.id === first.id))
  r = await s.svc.remove({ id: first.id })
  check('C: deleting it again: "That note is not there any more."', !r.ok && /not there any more/.test(r.error))
  r = await s.svc.setOn(owner, false)
  check('C: turning memory off asks nothing, keeps the notes, and writes "on": false', r.ok && s.asked.length === 0 && fileOf(s).on === false && fileOf(s).notes.length === count - 1 && r.status.on === false)
  check('C: while it is off, no note goes with a request', show(await s.svc.forRequest(null)) === show({ ok: true, notes: [] }) && show(await s.svc.forRequest(PROJECT)) === show({ ok: true, notes: [] }))
  s = service(dir, [false])
  r = await s.svc.setOn(owner, true)
  const qOn = s.asked[0]?.question
  check('C: turning it on asks, "Turn memory on?", with how many notes and characters go again; a no: "Memory is still off."', !r.ok && r.cancelled && r.error === 'Memory is still off.' && qOn?.message === 'Turn memory on?' && /Your 2 notes \(\d+ characters\) will go to the company/.test(qOn.detail) && qOn.yes === 'Turn memory on' && fileOf(s).on === false, show(qOn))
  s = service(dir, [true])
  s.clock.now += 5000
  r = await s.svc.setOn(owner, true)
  check('C: ...a yes turns it on', r.ok && fileOf(s).on === true)
  r = await s.svc.setOn(owner, 'true')
  check('C: on/off must be true or false', !r.ok && /not understood/.test(r.error))
  const fresh = service(tempDir(), [])
  r = await fresh.svc.setOn(owner, true)
  check('C: turning on with no notes asks nothing', r.ok && fresh.asked.length === 0)

  // What goes with a request.
  dir = tempDir()
  s = service(dir, [true, true, true])
  await s.svc.add(owner, { text: 'Every one', scope: 'all' })
  s.clock.now += 10
  await s.svc.add(owner, { text: 'Project one', scope: PROJECT })
  await s.svc.add(owner, { text: 'Every two', scope: 'all' })
  const plain = await s.svc.forRequest(null)
  const inProject = await s.svc.forRequest(PROJECT)
  const other = await s.svc.forRequest(OTHER)
  check('C: a chat in no project gets the notes for every chat, oldest first', plain.ok && show(plain.notes.map((n) => n.text)) === show(['Every one', 'Every two']), show(plain))
  check('C: a chat in the project gets those, then the project\'s', inProject.ok && show(inProject.notes.map((n) => n.text)) === show(['Every one', 'Every two', 'Project one']), show(inProject))
  check('C: a chat in another project does not get them', other.ok && show(other.notes.map((n) => n.text)) === show(['Every one', 'Every two']))
  r = await s.svc.removeAll()
  check('C: "Delete all" asks nothing here and leaves memory on with no notes', r.ok && show(fileOf(s)) === show({ version: 1, on: true, notes: [] }))
})

// ============ D. the caps ============
await guard('D', async () => {
  const dir = tempDir()
  const seeded = { version: 1, on: true, notes: Array.from({ length: 16 }, (_, i) => note(i + 1, { text: 'w'.repeat(495) + String(i).padStart(4, '0') })) }
  writeFileSync(join(dir, 'memory.json'), JSON.stringify(seeded))
  let s = service(dir, [])
  let r = await s.svc.add(owner, { text: 'x'.repeat(100), scope: 'all' })
  check('D: a note that would take every chat\'s notes past 8,000 characters is refused before any question, saying how far', !r.ok && /would be 8,084 characters, and the most is 8,000/.test(r.error) && s.asked.length === 0, show(r))
  s = service(dir, [true])
  r = await s.svc.add(owner, { text: 'x'.repeat(16), scope: 'all' })
  check('D: ...one that just fits (7,984 + 16 = 8,000) is asked about and saved', r.ok && s.asked.length === 1 && fileOf(s).notes.length === 17, show(r))
  s = service(dir, [])
  r = await s.svc.edit(owner, { id: seeded.notes[0].id, text: 'v'.repeat(500) })
  check('D: changing a note to longer words is refused when the place would be over the cap (8,001)', !r.ok && /would be 8,001 characters/.test(r.error) && s.asked.length === 0, show(r))
  r = await s.svc.add(owner, { text: 'y'.repeat(80), scope: PROJECT })
  check('D: a project\'s notes have room of their own: a note for the project is asked about', s.asked.length === 1 && r.cancelled === true, show(r))
  const many = tempDir()
  writeFileSync(join(many, 'memory.json'), JSON.stringify({ version: 1, on: true, notes: Array.from({ length: 100 }, (_, i) => note(i + 1)) }))
  s = service(many, [])
  r = await s.svc.add(owner, { text: 'one more', scope: 'all' })
  check('D: a 101st note for a place is refused', !r.ok && /100 notes for every chat, the most there can be/.test(r.error) && s.asked.length === 0, show(r))
})

// ============ E. one change at a time, and the gate ============
await guard('E', async () => {
  const dir = tempDir()
  let release
  const hold = new Promise((resolve) => { release = resolve })
  const s = service(dir, [() => hold.then(() => true)])
  const first = s.svc.add(owner, { text: 'First', scope: 'all' })
  await wait(20)
  const second = await within(s.svc.add(owner, { text: 'Second', scope: 'all' }), 2000, 'a second note while the first waits')
  check('E: a second change while the first waits for its answer is refused at once', !second.ok && /still being changed/.test(second.error) && s.asked.length === 1, show(second))
  const removing = await within(s.svc.removeAll(), 2000, 'delete all while a note waits')
  check('E: ...so is "Delete all" (one change at a time)', !removing.ok && /still being changed/.test(removing.error))
  release()
  check('E: the first, once answered, is saved', (await within(first, 2000, 'the first note')).ok && fileOf(s).notes.length === 1)
  const busyGate = played([() => new Promise(() => {})])
  void busyGate.gate.ask(null, { title: 't', message: 'm', detail: 'd', yes: 'y', no: 'n' })
  const busy = mem.createMemory({ pathOf: () => join(tempDir(), 'memory.json'), writeMode: async () => ({ form: 'plain' }), gate: busyGate.gate, savedKeys: async () => [], projectName: async () => null, dataDir: tempDir(), pickExportPath: async () => null })
  const r = await within(busy.add(owner, { text: 'While another question is open', scope: 'all' }), 2000, 'a note while the gate is busy')
  check('E: while another question of the app is open, a note is refused with the gate\'s sentence', !r.ok && r.error === gateMod.QUESTION_BUSY, show(r))
  const failing = service(tempDir(), ['throw'])
  const f = await failing.svc.add(owner, { text: 'Box fails', scope: 'all' })
  check('E: a box that cannot be shown saves nothing', !f.ok && f.error === gateMod.QUESTION_FAILED && !existsSync(failing.file))
})

// ============ F. a file that cannot be read ============
await guard('F', async () => {
  const dir = tempDir()
  const file = join(dir, 'memory.json')
  writeFileSync(file, '{"version":1,"on":true,"notes":[{"id"')
  let s = service(dir, [true])
  const st = await s.svc.status()
  check('F: status: no notes, and the problem in words', st.notes.length === 0 && /not a file this app wrote/.test(st.problem ?? ''), show(st))
  const fr = await s.svc.forRequest(null)
  check('F: EVERY request is refused while it cannot be read: what, why and the way out', !fr.ok && /^Nothing was sent: your notes could not be read \(.+\)\. Open Memory to delete them all or turn memory off; the app keeps a copy of the file\.$/.test(fr.error), show(fr))
  const before = readFileSync(file, 'utf8')
  const tries = [await s.svc.add(owner, { text: 'x', scope: 'all' }), await s.svc.edit(owner, { id: PROJECT, text: 'y' }), await s.svc.remove({ id: PROJECT }), await s.svc.setOn(owner, true)]
  check('F: adding, changing, deleting one and turning on are refused, nothing asked, the file byte for byte as it was', tries.every((t) => !t.ok && /could not be read/.test(t.error)) && s.asked.length === 0 && readFileSync(file, 'utf8') === before, show(tries.map((t) => t.error)))
  const exp = await s.svc.exportAll(owner)
  check('F: nothing is exported from it', !exp.ok && /could not be read/.test(exp.error))
  let r = await s.svc.removeAll()
  const asides = readdirSync(dir).filter((n) => n.startsWith('memory.json.damaged-'))
  check('F: "Delete all" is a way out: a copy of the damaged file is kept beside it (byte for byte), then an empty memory, on', r.ok && asides.length === 1 && readFileSync(join(dir, asides[0]), 'utf8') === before && show(fileOf(s)) === show({ version: 1, on: true, notes: [] }), show([r, asides]))
  const dir2 = tempDir()
  writeFileSync(join(dir2, 'memory.json'), 'garbage')
  s = service(dir2, [])
  r = await s.svc.setOn(owner, false)
  check('F: "Turn memory off" is the other: the copy kept, memory off and empty, nothing asked', r.ok && s.asked.length === 0 && readdirSync(dir2).some((n) => n.startsWith('memory.json.damaged-')) && show(fileOf(s)) === show({ version: 1, on: false, notes: [] }) && show(await s.svc.forRequest(null)) === show({ ok: true, notes: [] }), show(r))

  // Sealed like the chats.
  const box = makeBox()
  const dir3 = tempDir()
  s = service(dir3, [true], { box, writeMode: async () => ({ form: 'encrypted' }) })
  await s.svc.add(owner, { text: 'A sealed note', scope: 'all' })
  const raw = readFileSync(join(dir3, 'memory.json'), 'utf8')
  check('F: with encryption on, memory.json is the chats\' envelope and the note is nowhere in it', raw.startsWith('{"format":"frontier-chat-encrypted"') && !raw.includes('sealed note'))
  check('F: ...and reads back', (await s.svc.forRequest(null)).notes?.[0]?.text === 'A sealed note')
  box.lose()
  check('F: with a key that cannot be used, every request is refused, saying why', /could not be opened/.test((await s.svc.forRequest(null)).error ?? ''))
})

// ============ G. the export ============
await guard('G', async () => {
  const dir = tempDir()
  const outDir = tempDir()
  let s = service(dir, [true, true, true])
  let r = await s.svc.exportAll(owner)
  check('G: with no notes there is nothing to export, and no dialog', !r.ok && /no notes to export/.test(r.error) && s.picks.length === 0)
  await s.svc.add(owner, { text: 'I am a nurse in Leeds.', scope: 'all' })
  s.time.now += 3_600_000
  await s.svc.add(owner, { text: 'Line one\nline two', scope: 'all' })
  await s.svc.add(owner, { text: 'Chapter 3 is about sampling.', scope: PROJECT })
  r = await s.svc.exportAll(owner)
  check('G: closing the save dialog is "cancelled"; the dialog was for the window that asked, with a dated name', !r.ok && r.cancelled === true && s.picks.length === 1 && s.picks[0].owner === owner && /^frontier-notes-\d{4}-\d{2}-\d{2}\.txt$/.test(s.picks[0].name), show(s.picks))
  const dest = join(outDir, 'notes.txt')
  const s2 = service(dir, [], { exportTo: dest })
  r = await s2.svc.exportAll(owner)
  const text = existsSync(dest) ? readFileSync(dest, 'utf8') : ''
  check('G: the export is written where the person chose, read back, and counted', r.ok && r.count === 3 && r.where === dest, show(r))
  check('G: ...it says when and whether memory is on, then every note under the place it is for, with when it was made', /^Your notes in Frontier App, exported on \d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(text) && text.includes('Memory is on') && text.includes('For every chat (2 notes, 39 of 8,000 characters):') && text.includes('- I am a nurse in Leeds.\n  (made ') && text.includes('- Line one\n  line two\n') && text.includes('For the chats of the project "Thesis" (1 note, 28 of 8,000 characters):') && text.indexOf('For every chat') < text.indexOf('Thesis'), text)
  const inside = service(dir, [], { exportTo: join(dir, 'sub', 'notes.txt') })
  mkdirSync(join(dir, 'sub'), { recursive: true })
  r = await inside.svc.exportAll(owner)
  check('G: never into the app\'s own data folder: refused, nothing written', !r.ok && /data folder/.test(r.error) && !existsSync(join(dir, 'sub', 'notes.txt')), show(r))
  const relative = service(dir, [], { exportTo: 'notes.txt' })
  r = await relative.svc.exportAll(owner)
  check('G: a place that is not a full path is refused', !r.ok && /could not be used/.test(r.error))
})

// ============ H. found on the way (10.3): what is written must read back, and a short secret shows little ============
await guard('H', async () => {
  const kept = await import(`${SRC}/main/keptFile.ts`)
  const secrets = await import(`${SRC}/main/secrets.ts`)
  const dir = tempDir()
  const doc = kept.createKeptFile({ pathOf: () => join(dir, 'doc.json'), name: 'the test document', parse: (t) => (t === '"good"' ? 'good' : null), text: (v) => JSON.stringify(v), maxBytes: 4096, writeMode: async () => ({ form: 'plain' }) })
  await doc.write('good')
  let refused = null
  try { await doc.write('bad') } catch (error) { refused = error }
  check('H: a kept file never writes what its own reader would refuse: the write fails and the file is as it was', refused !== null && readFileSync(join(dir, 'doc.json'), 'utf8') === '"good"' && !existsSync(join(dir, 'doc.json.tmp')), String(refused))
  const taken = '00000000-0000-4000-8000-000000000001'
  const fresh = '00000000-0000-4000-a000-000000000001'
  const sdir = tempDir()
  writeFileSync(join(sdir, 'memory.json'), JSON.stringify({ version: 1, on: true, notes: [note(1)] }))
  const ids = [taken, fresh]
  const s = service(sdir, [true], { newId: () => ids.shift() ?? fresh })
  const r = await s.svc.add(owner, { text: 'A second note', scope: 'all' })
  const f = fileOf(s)
  check('H: a new note never takes an id already in use: a fresh one is made, and the file stays readable', r.ok && f.notes.length === 2 && f.notes[1].id === fresh && (await s.svc.status()).problem === null, show([r, f?.notes?.map((n) => n.id)]))
  const { mask } = secrets
  check('H: a part of 9 to 23 characters shows only its first character and its length', mask('Tr0ub4dor') === 'T… (9 characters)' && mask('x'.repeat(23)) === 'x… (23 characters)', show([mask('Tr0ub4dor'), mask('x'.repeat(23))]))
  check('H: ...from 24 characters (key length) its first four and last two, and up to 8 its first character and dots, as before', mask('abcdefghijklmnopqrstuvwx') === 'abcd…wx (24 characters)' && mask('hunter2') === 'h••••••')
})

for (const dir of temps) rmSync(dir, { recursive: true, force: true })
process.exit(check.summary() ? 0 : 1)
