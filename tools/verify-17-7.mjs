// Slice 17.7 under plain Node (no window): kept, sealed and backed up; the shortlist; the safety rules of every stage (D-049). What it shows:
//   A. a chat answered by Gemini is a chat like any other: saved and read with "google" as who answered, the page's own save takes it, a provider this app does not know
//      ("gemini") is read as unknown;
//   B. a backup carries it and gives it back exactly, who answered included;
//   C. sealed and opened like any chat;
//   D. the shortlist: registry/rankings.json gains one row, Gemini 3.8 Flash for coding, quoting Google's models page; no row for Gemini 4 Argon (the page names no task
//      for it); the row is offered only with a Google key;
//   E. the safety rules of every stage: no new package (package.json and the lock file are main's), the window's policy unchanged, the key never logged, never in an
//      address, never sent to the page; a request to Google only when the person sends or tests; the data folder's new name is a key file the store makes.
// Run: node tools/guarded.mjs tools/verify-17-7.mjs
import './ts-resolve.mjs'
import { checker } from './cdp.mjs'
import { execFileSync } from 'node:child_process'
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { mkdtempSync, promises as fsp, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { REPO, REPO_URL } from './paths.mjs'
import { backup, makeChat, msg, seedFile, sourceOf, createConversationStore, NOW } from './lib8b.mjs'

const check = checker()
const guard = async (name, fn) => { try { await fn() } catch (error) { check(`${name} did not run to its end: ${String(error?.stack ?? error).slice(0, 400)}`, false) } }
const show = (v) => JSON.stringify(v)?.slice(0, 500)
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const source = (rel) => readFileSync(join(REPO, rel), 'utf8')
const SRC = `${REPO_URL}/src`
const V = await import(`${SRC}/shared/validate.ts`)
const RK = await import(`${SRC}/shared/rankings.ts`)
const R = await import(`${SRC}/shared/registry.ts`)
const CF = await import(`${SRC}/main/chatFile.ts`)
const git = (...args) => execFileSync('git', ['-C', REPO, ...args], { encoding: 'utf8' })

const geminiChat = (i) => {
  const chat = makeChat(i)
  chat.messages = [msg('user', 'Question for Gemini'), msg('assistant', 'Answer from Gemini', 'done', { provider: 'google', model: 'gemini-3.8-flash' }), msg('user', 'And Argon?'), msg('assistant', 'Argon here', 'done', { provider: 'google', model: 'gemini-4-argon' })]
  return chat
}

// ============ A. a chat answered by Gemini ============
const base = mkdtempSync(join(tmpdir(), 'frontier-17-7-'))
await guard('A', async () => {
  const dir = join(base, 'a', 'conversations')
  const chat = geminiChat(1)
  await seedFile(dir, chat)
  const store = createConversationStore(dir)
  const loaded = await store.load(chat.id)
  check('A: saved and read with who answered: google / gemini-3.8-flash, google / gemini-4-argon', loaded.ok && same(loaded.conversation.messages.filter((m) => m.role === 'assistant').map((m) => `${m.provider}/${m.model}`), ['google/gemini-3.8-flash', 'google/gemini-4-argon']), show(loaded))
  const save = V.checkConversationSave({ id: chat.id, title: chat.title, createdAt: chat.createdAt, updatedAt: chat.updatedAt, messages: chat.messages })
  check('A: the page\'s own save of it is taken (google is a provider of the list)', save.ok === true, show(save))
  const foreign = V.checkConversationSave({ id: chat.id, title: chat.title, createdAt: chat.createdAt, updatedAt: chat.updatedAt, messages: [msg('user', 'q'), msg('assistant', 'a', 'done', { provider: 'gemini', model: 'gemini-3.8-flash' })] })
  check('A: a save naming a provider this app does not know ("gemini") is refused, as before', foreign.ok === false)
  const other = { ...geminiChat(2) }
  other.messages = [msg('user', 'q'), msg('assistant', 'a', 'done', { provider: 'gemini', model: 'x' })]
  await seedFile(dir, other)
  const read = await createConversationStore(dir).load(other.id) // (a fresh store: the first one has its list already)
  check('A: a saved file naming "gemini" is still a chat; that reply\'s provider is read as unknown (null)', read.ok && read.conversation.messages[1].provider === null, show(read))
})

// ============ B. backed up ============
await guard('B', async () => {
  const dir = join(base, 'b', 'conversations')
  const chats = [geminiChat(3), makeChat(4)]
  for (const chat of chats) await seedFile(dir, chat)
  const store = createConversationStore(dir)
  await fsp.mkdir(join(base, 'b', 'out'), { recursive: true })
  const file = join(base, 'b', 'out', 'chats.jsonl')
  const written = await backup.writeBackup(file, sourceOf(store, chats.map((c) => c.id)), NOW)
  check('B: the backup is written with both chats', written.ok && written.count === 2, show(written))
  const back = []
  const read = await backup.readBackup(file, (chat) => { back.push(chat) })
  const g = back.find((c) => c.id === chats[0].id)
  check('B: read back, whole, the Gemini chat exactly as it was, who answered included', read.complete && read.good === 2 && same(g.messages.map((m) => [m.role, m.content, m.provider ?? null, m.model ?? null]), chats[0].messages.map((m) => [m.role, m.content, m.provider ?? null, m.model ?? null])), show(g?.messages))
})

// ============ C. sealed ============
await guard('C', async () => {
  const secret = randomBytes(32)
  const box = {
    isAvailable: () => true,
    encrypt(plain) { const iv = randomBytes(12); const c = createCipheriv('aes-256-gcm', secret, iv); const body = Buffer.concat([c.update(plain, 'utf8'), c.final()]); return Buffer.concat([iv, c.getAuthTag(), body]) },
    decrypt(blob) { const d = createDecipheriv('aes-256-gcm', secret, blob.subarray(0, 12)); d.setAuthTag(blob.subarray(12, 28)); return Buffer.concat([d.update(blob.subarray(28)), d.final()]).toString('utf8') }
  }
  const plain = JSON.stringify({ version: 3, ...geminiChat(5) })
  const sealed = CF.sealChat(plain, box)
  check('C: sealed, nothing of it is readable (not the words, not "google", not the model)', !sealed.includes('Gemini') && !sealed.includes('google') && !sealed.includes('gemini-3.8-flash'))
  const opened = CF.openChat(JSON.parse(sealed), box)
  check('C: opened, it is the same chat', opened.ok !== false && opened.text === plain, show(opened))
})

// ============ D. the shortlist ============
await guard('D', async () => {
  const file = JSON.parse(source('registry/rankings.json'))
  const parsed = RK.parseRankings(file)
  check('D: rankings.json is read whole, with no problem', parsed.ok && parsed.problems.length === 0, show(parsed.problems ?? parsed.error))
  const rows = parsed.rankings.rows.filter((r) => /gemini/.test(r.modelId))
  check('D: one row for Gemini: Gemini 3.8 Flash for coding, quoting Google\'s models page, read on 17 October 2026', rows.length === 1 && rows[0].task === 'coding' && rows[0].modelId === 'gemini-3.8-flash' && /^"engineered for long-horizon software engineering, autonomous agents/.test(rows[0].note) && rows[0].source === 'https://ai.google.dev/gemini-api/docs/models' && rows[0].asOf === '2026-10-17', show(rows))
  check('D: no row for Gemini 4 Argon (the page names no task for it), and no score anywhere (D-023)', !rows.some((r) => r.modelId === 'gemini-4-argon') && !/score/i.test(JSON.stringify(file)))
  const before = JSON.parse(readFileSync(join(REPO, 'tools', 'rankings-before-17.json'), 'utf8')) // main's file of before the stage (b8ee65a)
  check('D: the rows of before are exactly what they were', same(file.rankings.filter((r) => !/gemini/.test(r.modelId)), before.rankings), show(file.rankings.length))
  const models = R.parseRegistry(JSON.parse(source('registry/models.json'))).registry.models
  const withKey = RK.suggestionsFor(parsed.rankings, models, () => true)
  const without = RK.suggestionsFor(parsed.rankings, models, (p) => p !== 'google')
  check('D: offered with a Google key, not without one', withKey.some((s) => s.modelId === 'gemini-3.8-flash') && !without.some((s) => s.modelId === 'gemini-3.8-flash'))
  check('D: the source line names Google\'s pages', /Google/.test(file.source))
})

// ============ E. every stage's safety ============
await guard('E', async () => {
  // the SHA-256 of main's files of before the stage (b8ee65a), as git gave them: the regression runs from a copy with no .git
  const hash = (rel) => createHash('sha256').update(readFileSync(join(REPO, rel)).toString('utf8').replace(/\r\n/g, '\n')).digest('hex')
  // (18.1) package.json's scripts changed (build:mac and build:linux went): the rule is about packages, so its dependencies are compared, and the lock file byte for byte.
  const pkg = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8'))
  const deps = createHash('sha256').update(JSON.stringify({ d: pkg.dependencies, dd: pkg.devDependencies })).digest('hex')
  check('E: no new package: package.json\'s dependencies and package-lock.json are main\'s of before the stage (rule 10)', deps === '4310cf6266fc5398ef3153573104034496f93918c5dee13d71f8c835a70aac5c' && hash('package-lock.json') === '47ae1caaa4d8628a0500f046d038a00d95110708b15a1f3a34adb8e4eda7a906')
  check('E: the window\'s policy (index.html) is unchanged (rule 7)', hash('src/renderer/index.html') === 'f80ed67d49883c8105c73f0b5b502537829b5d35f59145c10418d71133a29a90')
  const gemini = source('src/main/providers/gemini.ts')
  check('E: the adapter logs nothing at all (no console), so it can log no key (rule 5)', !/console\./.test(gemini))
  check('E: the key never in an address: no "key=" in the adapter (rule 5)', !/[?&]key=/.test(gemini.replace(/\/\/.*$/gm, '')))
  const ipc = source('src/main/ipc.ts')
  check('E: the page is told of a provider only its id, its name and whether a key is saved (rule 5)', /SUPPORTED_PROVIDERS\.map\(async \(id\) => \(\{\s*id,\s*name: PROVIDER_NAMES\[id\],\s*hasKey: \(await readApiKey\(id\)\) !== null\s*\}\)\)/.test(ipc))
  const callers = ['src/main/chat.ts', 'src/main/ipc.ts'].filter((f) => /adapterFor\(/.test(source(f)))
  check('E: the adapters are called from two places only: a reply (chat.ts) and Test key (ipc.ts); nothing calls Google by itself (rule 1)', same(callers, ['src/main/chat.ts', 'src/main/ipc.ts']) && (ipc.match(/adapterFor\(/g) ?? []).length === 1)
  check('E: the stage keeps its tests against the stand-in: no real address in the checks but the adapter\'s own constant (rule 8)', !/generativelanguage\.googleapis\.com/.test(source('tools/verify-17-3.mjs').replace(/API_BASE_URL = 'https:\/\/generativelanguage\.googleapis\.com'/g, '')))
  check('E: the key file\'s name comes from the store, for every provider of the list (credentials.google.json)', /export const credentialFileName = \(provider: ProviderId\): string => `credentials\.\$\{provider\}\.json`/.test(source('src/main/credentialStore.ts')))
})

process.exit(check.summary() ? 0 : 1)
