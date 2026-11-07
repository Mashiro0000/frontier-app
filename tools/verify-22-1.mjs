// Stage 22.1-22.2 (D-054), the Library and Experts under plain Node: the files of the saved chats (each once, the chats that carry it, newest first, the
// person's messages only), what can be starred and how library.json is read, the ready-made experts (ids, categories, the words for health and money), and
// an expert of the person's own (checked from the page and from experts.json).
// usage: node tools/verify-22-1.mjs
import './ts-resolve.mjs'
import { checker } from './cdp.mjs'
import { REPO_URL } from './paths.mjs'

const check = checker()
const { filesOfChats, checkStarred, isLibraryId, matchesQuery, LIBRARY_LIMITS } = await import(`${REPO_URL}/src/shared/library.ts`)
const { parseLibraryFile, libraryFileText } = await import(`${REPO_URL}/src/main/library.ts`)
const { EXPERTS, EXPERT_CATEGORIES } = await import(`${REPO_URL}/src/shared/experts.ts`)
const { checkMyExpert } = await import(`${REPO_URL}/src/shared/myExperts.ts`)
const { parseExpertsFile, expertsFileText, MAX_MY_EXPERTS } = await import(`${REPO_URL}/src/main/myExperts.ts`)

const hex = (c, n) => c.repeat(n)
const info = (id, name, kind = 'image') => ({ id, name, kind, mediaType: kind === 'pdf' ? 'application/pdf' : 'image/png', bytes: 10, changes: { shrunkFrom: null, turned: false, convertedFrom: null } })
const chat = (id, title, updatedAt, messages) => ({ id, title, updatedAt, createdAt: 0, instructions: '', messages })
const A = hex('a', 64), B = hex('b', 64), C = hex('c', 64)
const chats = [
  chat('c1', 'Old chat', 100, [{ role: 'user', content: 'x', status: 'done', attachments: [info(A, 'a.png'), info(B, 'b.pdf', 'pdf')] }, { role: 'assistant', content: 'y', status: 'done' }]),
  chat('c2', 'New chat', 300, [{ role: 'user', content: 'z', status: 'done', attachments: [info(A, 'a.png')] }]),
  chat('c3', 'Middle', 200, [{ role: 'user', content: 'q', status: 'done', attachments: [info(C, 'c.txt', 'text')] }, { role: 'user', content: 'again', status: 'done', attachments: [info(C, 'c.txt', 'text')] }])
]
const files = filesOfChats(chats)
check('A: each file once, the most recently used first', JSON.stringify(files.map((f) => f.info.id)) === JSON.stringify([A, C, B]), JSON.stringify(files.map((f) => f.info.name)))
check('A: a file names every chat that carries it, newest first, each chat once', JSON.stringify(files[0].chats.map((c) => c.id)) === '["c2","c1"]' && files[1].chats.length === 1)
check('A: the last-used date is the newest chat\'s', files[0].lastUsed === 300 && files[2].lastUsed === 100)
check('A: a reply never brings a file (only the person\'s messages)', filesOfChats([chat('r', 'R', 1, [{ role: 'user', content: 'a', status: 'done' }, { role: 'assistant', content: 'b', status: 'done', attachments: [info(A, 'x.png')] }])]).length === 0)
check('A: no chats, no files', filesOfChats([]).length === 0)

check('B: a file id (64 hex) and a picture id (32 hex) can be starred', isLibraryId(A) && isLibraryId(hex('0', 32)))
for (const bad of ['', hex('a', 63), hex('A', 64), hex('g', 64), hex('a', 33), 42, null]) check(`B: not an id: ${JSON.stringify(bad)?.slice(0, 20)}`, !isLibraryId(bad))
check('B: starred ids: a list, each once', JSON.stringify(checkStarred([A, B])) === JSON.stringify([A, B]) && checkStarred([A, A]) === null && checkStarred([A, 'x']) === null && checkStarred('a') === null)
check('B: at most 1,000 starred', LIBRARY_LIMITS.maxStarred === 1000 && checkStarred(Array.from({ length: 1001 }, (_, i) => i.toString(16).padStart(32, '0'))) === null)
check('B: library.json is read back exactly as written', JSON.stringify(parseLibraryFile(libraryFileText([A, C]))) === JSON.stringify([A, C]))
for (const [what, text] of [['not JSON', '{'], ['another version', JSON.stringify({ version: 2, starred: [] })], ['a field more', JSON.stringify({ version: 1, starred: [], x: 1 })], ['a bad id', JSON.stringify({ version: 1, starred: ['nope'] })], ['a list', '[]']]) {
  check(`B: library.json refused: ${what}`, parseLibraryFile(text) === null)
}
check('B: a search needs every word, any case', matchesQuery('Holiday Photo.PNG', 'photo holiday') && !matchesQuery('Holiday Photo.PNG', 'photo beach') && matchesQuery('anything', ''))

check('C: the ready-made experts: at least 10, each id once, each in a known category, each with instructions and a task', EXPERTS.length >= 10 && new Set(EXPERTS.map((e) => e.id)).size === EXPERTS.length && EXPERTS.every((e) => EXPERT_CATEGORIES.includes(e.category) && e.instructions.length > 40 && ['chat', 'coding', 'writing', 'quick'].includes(e.task)))
check('C: every expert on health or money says it is not a professional and when to see one', EXPERTS.filter((e) => e.category === 'Health & Wellness' || e.category === 'Money').every((e) => /not a licensed professional/.test(e.instructions) && /should see one/.test(e.instructions)))
check('C: the health explainer never diagnoses and points to emergency services', /Never diagnose/.test(EXPERTS.find((e) => e.id === 'health-explainer').instructions) && /emergency/.test(EXPERTS.find((e) => e.id === 'health-explainer').instructions))
check('C: no expert names a real person or a company', EXPERTS.every((e) => !/OpenAI|Anthropic|Google|Claude|GPT|Gemini|AI Fiesta/i.test(`${e.name} ${e.description} ${e.instructions}`)))

const UUID = '3f2b8c1e-5d6a-4b7c-9e0f-1a2b3c4d5e6f'
const mine = { id: UUID, name: 'My Tutor', description: 'Maths help', instructions: 'Explain step by step.', task: 'chat' }
check('D: an expert of the person\'s own is read from the page, trimmed', JSON.stringify(checkMyExpert({ ...mine, name: '  My   Tutor ' }, false)) === JSON.stringify(mine))
check('D: from the page a missing task is "chat"', checkMyExpert({ id: UUID, name: 'X', description: '', instructions: 'y' }, false)?.task === 'chat')
for (const [what, bad] of [['no name', { ...mine, name: '  ' }], ['no instructions', { ...mine, instructions: ' ' }], ['a name too long', { ...mine, name: 'x'.repeat(61) }], ['a field more', { ...mine, extra: 1 }], ['an id that is not a uuid', { ...mine, id: 'abc' }], ['a hidden direction mark', { ...mine, name: 'Evil‮eman' }], ['a control character', { ...mine, name: 'a\u0007b' }], ['instructions too long', { ...mine, instructions: 'x'.repeat(100000) }]]) {
  check(`D: refused: ${what}`, checkMyExpert(bad, false) === null)
}
check('D: experts.json is read back exactly as written', JSON.stringify(parseExpertsFile(expertsFileText([mine]))) === JSON.stringify([mine]))
check('D: experts.json: not as kept (untrimmed) is refused', parseExpertsFile(expertsFileText([{ ...mine, name: ' My Tutor' }])) === null)
check('D: experts.json: an id twice is refused', parseExpertsFile(expertsFileText([mine, mine])) === null)
check(`D: experts.json: at most ${MAX_MY_EXPERTS}`, parseExpertsFile(expertsFileText(Array.from({ length: MAX_MY_EXPERTS + 1 }, (_, i) => ({ ...mine, id: UUID.slice(0, -2) + i.toString(16).padStart(2, '0') })))) === null)


// ---- E. The services on a real folder (22.1, 22.2): stars kept and read back, an expert saved, changed, refused with a saved key, removed ----
// (A fresh folder in the system's temp folder each run; nothing is deleted.)
{
  const { mkdtempSync, readFileSync, writeFileSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { createLibrary } = await import(`${REPO_URL}/src/main/library.ts`)
  const { createMyExperts } = await import(`${REPO_URL}/src/main/myExperts.ts`)
  const dir = mkdtempSync(join(tmpdir(), 'frontier-221-'))
  const plain = async () => ({ form: 'plain' })
  const lib = createLibrary({ folder: () => dir, writeMode: plain, chats: async () => ({ chats, unreadable: 2 }) })
  const listed = await lib.files()
  check("E: the Library lists the chats' files and counts the unreadable chats", listed.ok && listed.files.length === 3 && listed.unreadable === 2 && listed.starred.length === 0 && listed.starsProblem === null)
  const P = hex('1', 32)
  const [s1, s2] = await Promise.all([lib.star(A, true), lib.star(P, true)])
  check('E: two quick stars are both kept (one change at a time)', s1.ok && s2.ok && JSON.stringify(s2.starred) === JSON.stringify([A, P]))
  check('E: library.json holds exactly the stars', readFileSync(join(dir, 'library.json'), 'utf8') === libraryFileText([A, P]))
  const off = await lib.star(A, false)
  check('E: a star taken off', off.ok && JSON.stringify(off.starred) === JSON.stringify([P]))
  check('E: a star on something that is not an id is refused', !(await lib.star('../x', true)).ok && !(await lib.star(A.toUpperCase(), true)).ok && !(await lib.star(A, 'yes')).ok)
  const damaged = '{"version":1,"starred":"x"}'
  writeFileSync(join(dir, 'library.json'), damaged)
  const broken = await lib.files()
  check('E: unreadable stars are said, the files still listed', broken.ok && broken.files.length === 3 && broken.starsProblem !== null)
  const blocked = await lib.star(A, true)
  check('E: and no star is written over them', !blocked.ok && readFileSync(join(dir, 'library.json'), 'utf8') === damaged)

  const KEY = 'sk-ant-api03-' + 'k'.repeat(80)
  const ex = createMyExperts({ folder: () => dir, writeMode: plain, savedKeys: async () => [{ provider: 'anthropic', key: KEY }] })
  const made = await ex.save({ name: ' Tutor ', description: 'Helps', instructions: 'Teach slowly.', task: 'chat' })
  check('E: a new expert is saved with an id main made, trimmed', made.ok && made.experts.length === 1 && /^[0-9a-f-]{36}$/.test(made.experts[0].id) && made.experts[0].name === 'Tutor')
  const id = made.ok ? made.experts[0].id : ''
  const changed = await ex.save({ id, name: 'Tutor', description: 'Helps more', instructions: 'Teach slowly.', task: 'chat' })
  check('E: an expert is changed in place', changed.ok && changed.experts.length === 1 && changed.experts[0].description === 'Helps more')
  const withKey = await ex.save({ name: 'Leaky', description: '', instructions: 'Use ' + KEY, task: 'chat' })
  check('E: instructions that hold a saved key are refused, and say so', !withKey.ok && /API key/.test(withKey.error), withKey.ok ? 'saved' : withKey.error)
  check('E: an unknown id is not saved as a new one', !(await ex.save({ id: '00000000-0000-4000-8000-000000000000', name: 'X', description: '', instructions: 'x', task: 'chat' })).ok)
  check('E: a field of its own is refused', !(await ex.save({ name: 'X', description: '', instructions: 'x', task: 'chat', extra: 1 })).ok)
  const gone = await ex.remove(id)
  check('E: an expert removed', gone.ok && gone.experts.length === 0 && JSON.parse(readFileSync(join(dir, 'experts.json'), 'utf8')).experts.length === 0)
}

// ---- F. The wiring (22.1, 22.2): the channels, guarded handlers, the bridge, and both files sealed with the chats ----
{
  const { readFileSync } = await import('node:fs')
  const { fileURLToPath } = await import('node:url')
  const read = (path) => readFileSync(fileURLToPath(`${REPO_URL}/${path}`), 'utf8')
  const ipc = read('src/main/ipc.ts')
  const pre = read('src/preload/index.ts')
  for (const ch of ['libraryFiles', 'libraryStar', 'expertsList', 'expertsSave', 'expertsRemove']) {
    check(`F: ${ch} is handled behind the sender check`, new RegExp(`ipcMain\\.handle\\(\\s*CHANNELS\\.${ch},\\s*guarded\\(`).test(ipc))
    check(`F: ${ch} is bridged in the preload`, pre.includes(`CHANNELS.${ch}`))
  }
  const start = ipc.indexOf('documents: keptDocuments([')
  const docs = ipc.slice(start, ipc.indexOf('])', start))
  check('F: library.json and experts.json are sealed and opened with the chats', docs.includes('library.file') && docs.includes('myExperts.file'))
  check('F: My experts read the saved keys', /createMyExperts\(\{[^}]*savedKeys/.test(ipc))
  check('F: a star names only an id and on/off (anything else is refused)', ipc.includes("k !== 'id' && k !== 'on'"))
}

process.exit(check.summary() ? 0 : 1)
