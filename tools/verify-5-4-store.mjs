// Slice 5.4 under plain Node (no window): the two fields that say who wrote a reply (D-021), in the validators and in the store.
// What the page may save (strict), what is read from a file (forgiving, and a version 1 file upgraded as it is read, never rewritten),
// and the file that is written (version 2 when this suite was made; version 3 since 7.4, D-027). Every store check runs in a normal folder and in the EFS-encrypted %APPDATA% (D-010).
// Run: node tools/verify-5-4-store.mjs
import { REPO_URL } from './paths.mjs'
import './ts-resolve.mjs'
import { checker } from './cdp.mjs'
import { promises as fsp, readFileSync, statSync } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { scratch } from './drive.mjs'

const check = checker()
const SRC = `${REPO_URL}/src`
const validate = await import(`${SRC}/shared/validate.ts`)
const storeMod = await import(`${SRC}/main/conversationStore.ts`)
const { checkSavedMessages, checkConversationSave, isModelId } = validate
const { createConversationStore, parseSavedFile } = storeMod

const msg = (role, content, status = 'done', extra = {}) => ({ role, content, status, ...extra })
const u = (c = 'q') => msg('user', c)
const a = (extra = {}, content = 'answer') => msg('assistant', content, 'done', extra)
const OPUS = 'claude-opus-5-5'
const SONNET = 'claude-sonnet-5-5'
const fields = (m) => JSON.stringify([m.provider, m.model])
const keys = (m) => JSON.stringify(Object.keys(m))
const page = (messages) => checkSavedMessages(messages) // the page is saving
const file = (messages) => checkSavedMessages(messages, 'file') // a version 2 file is being read
const v1 = (messages) => checkSavedMessages(messages, 'file-v1') // a version 1 file is being read

// ============ A. isModelId ============
for (const id of [OPUS, SONNET, 'claude-haiku-4-5-20251001', 'gpt-6.1-sol', 'gpt-6-luna', 'a', '0', 'x'.repeat(64), 'claude-retired-1', 'm_1']) {
  check(`isModelId: "${id.length > 30 ? id.slice(0, 12) + '...(' + id.length + ')' : id}" is an id`, isModelId(id))
}
for (const [name, value] of [['empty', ''], ['65 characters', 'a'.repeat(65)], ['a space', 'claude opus'], ['upper case', 'CLAUDE-OPUS'], ['a slash', 'a/b'], ['a path', '../x'], ['a backslash', 'a\\b'], ['a newline', 'a\n'], ['starts with a hyphen', '-a'], ['starts with a dot', '.a'], ['a colon', 'a:b'], ['non-ASCII', 'café'], ['a number', 5], ['null', null], ['an object', { id: OPUS }], ['an array', [OPUS]], ['undefined', undefined]]) {
  check(`isModelId: ${name} is not an id`, !isModelId(value))
}

// ============ B. what the page may save: strict ============
{
  const r = page([u(), a()])
  check('page: a reply with neither field is accepted, and gets null and null (the field is never missing)', r.ok && fields(r.messages[1]) === '[null,null]', JSON.stringify(r))
  check('page: a reply with a provider and a model keeps both', page([u(), a({ provider: 'anthropic', model: OPUS })]).messages[1].model === OPUS)
  check('page: provider only (model null) is accepted', fields(page([u(), a({ provider: 'anthropic', model: null })]).messages[1]) === '["anthropic",null]')
  check('page: an explicit null provider and null model are accepted', fields(page([u(), a({ provider: null, model: null })]).messages[1]) === '[null,null]')
  check('page: the checked copy of a reply has exactly role, content, status, provider, model (in that order)', keys(page([u(), a({ provider: 'anthropic', model: OPUS, evil: 1, usage: { n: 1 } })]).messages[1]) === '["role","content","status","provider","model"]')
  check('page: a failed reply keeps its error, and still says its model', (() => { const m = page([u(), msg('assistant', '', 'error', { error: 'boom', provider: 'anthropic', model: SONNET })]).messages[1]; return keys(m) === '["role","content","status","error","provider","model"]' && m.error === 'boom' && m.model === SONNET })())
  check('page: a reply that is still streaming is saved as stopped, with its model', (() => { const m = page([u(), msg('assistant', 'part', 'streaming', { provider: 'anthropic', model: OPUS })]).messages[1]; return m.status === 'stopped' && m.model === OPUS })())
  const refused = [
    ['an unknown provider', { provider: 'nope', model: OPUS }], ['an upper-case provider', { provider: 'ANTHROPIC', model: OPUS }], ['a provider that is a number', { provider: 5, model: OPUS }], ['a provider that is an object', { provider: { id: 'anthropic' }, model: OPUS }],
    ['a provider with a trailing space', { provider: 'anthropic ', model: OPUS }], ['a model with a space', { provider: 'anthropic', model: 'claude opus' }], ['a model in upper case', { provider: 'anthropic', model: 'CLAUDE-OPUS' }],
    ['a model that is a number', { provider: 'anthropic', model: 5 }], ['a model that is an object', { provider: 'anthropic', model: { id: OPUS } }], ['a 65-character model', { provider: 'anthropic', model: 'a'.repeat(65) }],
    ['a model with a path', { provider: 'anthropic', model: '../x' }], ['an empty model', { provider: 'anthropic', model: '' }], ['a model but no provider', { model: OPUS }], ['a model and a null provider', { provider: null, model: OPUS }],
    ['a model that is an array', { provider: 'anthropic', model: [OPUS] }], ['a provider that is true', { provider: true, model: null }]
  ]
  for (const [name, extra] of refused) check(`page: a reply with ${name} refuses the whole save`, !page([u(), a(extra)]).ok && !checkConversationSave({ id: randomUUID(), messages: [u(), a(extra)] }).ok)
  check('page: a model the registry has never heard of is a fine value (retired models must stay readable)', page([u(), a({ provider: 'anthropic', model: 'claude-retired-1' })]).messages[1].model === 'claude-retired-1')
  check('page: the 64-character model is accepted', page([u(), a({ provider: 'anthropic', model: 'x'.repeat(64) })]).ok)
  const claimed = page([{ ...u(), provider: 'anthropic', model: OPUS }, a({ provider: 'anthropic', model: OPUS })])
  check('page: the person\'s own message that claims a provider and a model is accepted, and the claim is dropped', claimed.ok && keys(claimed.messages[0]) === '["role","content","status"]')
  check('page: ...even a claim that would be refused on a reply (nothing from a user message is read)', page([{ ...u(), provider: 'nope', model: 5 }, a()]).ok)
}

// ============ C. what is read from a version 2 file: forgiving ============
{
  check('file: both fields as written are kept', fields(file([u(), a({ provider: 'anthropic', model: OPUS })]).messages[1]) === '["anthropic","claude-opus-5-5"]')
  check('file: neither field is read as null and null', fields(file([u(), a()]).messages[1]) === '[null,null]')
  check('file: an unknown provider is read as null, and then so is its model (nothing to say it belongs to)', fields(file([u(), a({ provider: 'gemini', model: 'gem-1' })]).messages[1]) === '[null,null]')
  check('file: a provider of the wrong type is read as null', fields(file([u(), a({ provider: 7, model: OPUS })]).messages[1]) === '[null,null]')
  check('file: a model that is not an id is read as null, and the provider stays', fields(file([u(), a({ provider: 'anthropic', model: 'Not An Id' })]).messages[1]) === '["anthropic",null]')
  check('file: a model of the wrong type is read as null', fields(file([u(), a({ provider: 'anthropic', model: { x: 1 } })]).messages[1]) === '["anthropic",null]')
  check('file: a model with no provider is read as null', fields(file([u(), a({ model: OPUS })]).messages[1]) === '[null,null]')
  check('file: the person\'s messages carry neither field', keys(file([{ ...u(), provider: 'anthropic', model: OPUS }, a()]).messages[0]) === '["role","content","status"]')
  check('file: everything else is as strict as ever (a bad status still refuses the file)', !file([u(), { role: 'assistant', content: 'x', status: 'bogus', provider: 'anthropic', model: OPUS }]).ok)
}

// ============ D. a version 1 file: upgraded as it is read ============
{
  const r = v1([u(), a(), u('again'), msg('assistant', '', 'error', { error: 'boom' }), msg('assistant', 'half', 'stopped')])
  check('v1: every reply is read as provider "anthropic", model null', r.ok && r.messages.filter((m) => m.role === 'assistant').every((m) => fields(m) === '["anthropic",null]'), JSON.stringify(r.messages?.map(fields)))
  check('v1: the person\'s messages carry neither field', r.messages.filter((m) => m.role === 'user').every((m) => keys(m) === '["role","content","status"]'))
  check('v1: text, status and error are untouched', r.messages[3].error === 'boom' && r.messages[3].status === 'error' && r.messages[4].status === 'stopped' && r.messages[4].content === 'half')
  check('v1: even a file that CLAIMS a provider and model has them ignored (it is a version 1 file: it cannot know)', fields(v1([u(), a({ provider: 'anthropic', model: OPUS })]).messages[1]) === '["anthropic",null]')
  const id = randomUUID()
  const text = (version, messages) => ({ version, id, title: 'T', createdAt: 1000, updatedAt: 2000, messages })
  const parsed = parseSavedFile(text(1, [u(), a()]), id)
  check('parseSavedFile: a version 1 file is accepted and upgraded', typeof parsed !== 'string' && fields(parsed.messages[1]) === '["anthropic",null]', JSON.stringify(parsed))
  const parsed2 = parseSavedFile(text(2, [u(), a({ provider: 'anthropic', model: SONNET })]), id)
  check('parseSavedFile: a version 2 file is accepted as written', typeof parsed2 !== 'string' && fields(parsed2.messages[1]) === '["anthropic","claude-sonnet-5-5"]')
  for (const version of [0, 4, 5, 9, '1', '2', '3', null, undefined, 1.5]) {
    check(`parseSavedFile: version ${JSON.stringify(version)} was made by another version and is refused`, parseSavedFile(text(version, [u(), a()]), id) === 'it was made by another version of the app')
  }
  check('parseSavedFile: the id inside must still match the name', typeof parseSavedFile(text(2, [u(), a()]), randomUUID()) === 'string')
}

// ============ E. the store: the file written, and reading never writes ============
const names = (dir) => fsp.readdir(dir).then((n) => n.sort())
const sha = (path) => createHash('sha256').update(readFileSync(path)).digest('hex').slice(0, 16)

for (const [folderName, makeDir] of [['a normal folder', () => fsp.mkdtemp(join(tmpdir(), 'frontier-5-4-'))], ['an EFS folder', async () => { const d = scratch('s54store'); await fsp.rm(d, { recursive: true, force: true }); await fsp.mkdir(d, { recursive: true }); return d }]]) {
  const T = (s) => `[${folderName}] ${s}`
  const dir = join(await makeDir(), 'conversations')
  const store = createConversationStore(dir)
  const id = randomUUID()
  const saved = await store.save({ id, messages: [u('one'), a({ provider: 'anthropic', model: OPUS }), u('two'), a({ provider: 'anthropic', model: SONNET }, '')] })
  check(T('save works'), saved.ok)
  const raw = readFileSync(join(dir, `${id}.json`), 'utf8')
  const onDisk = JSON.parse(raw)
  check(T('the file says version 3 (D-027; it was version 2 from 5.4 to 7.3)'), onDisk.version === 3 && raw.startsWith('{"version":3,'), raw.slice(0, 30))
  check(T('the file\'s top-level fields are version, id, title, createdAt, updatedAt, instructions, messages, in that order'), keys(onDisk) === '["version","id","title","createdAt","updatedAt","instructions","messages"]', keys(onDisk))
  check(T('each reply in the file has both fields, and the person\'s messages have neither'), onDisk.messages.every((m) => (m.role === 'assistant' ? 'provider' in m && 'model' in m : !('provider' in m) && !('model' in m))))
  check(T('the models are the ones saved (Opus, then Sonnet)'), onDisk.messages.filter((m) => m.role === 'assistant').map((m) => m.model).join() === `${OPUS},${SONNET}`)
  const loaded = await store.load(id)
  check(T('load hands the fields back'), loaded.ok && loaded.conversation.messages.filter((m) => m.role === 'assistant').map(fields).join(';') === `["anthropic","${OPUS}"];["anthropic","${SONNET}"]`)
  check(T('a fresh store (as after a restart) reads the same'), (await createConversationStore(dir).load(id)).conversation?.messages[3]?.model === SONNET)

  // a version 1 file written by Stages 2-4, put there by hand
  const oldId = randomUUID()
  const oldText = JSON.stringify({ version: 1, id: oldId, title: 'old question', createdAt: 5000, updatedAt: 9000, messages: [u('old question'), a({}, 'old answer'), u('another'), msg('assistant', '', 'error', { error: 'The service had a problem.' })] })
  await fsp.writeFile(join(dir, `${oldId}.json`), oldText)
  const before = { sha: sha(join(dir, `${oldId}.json`)), mtime: statSync(join(dir, `${oldId}.json`)).mtimeMs }
  const fresh = createConversationStore(dir)
  const list = await fresh.list()
  check(T('the version 1 file is listed (not "unreadable")'), list.unreadable === 0 && list.conversations.some((c) => c.id === oldId && c.title === 'old question' && c.messageCount === 4), JSON.stringify(list))
  const old = await fresh.load(oldId)
  check(T('...and loads as version 2 would: Anthropic, model unknown'), old.ok && old.conversation.messages.filter((m) => m.role === 'assistant').every((m) => fields(m) === '["anthropic",null]'))
  await new Promise((r) => setTimeout(r, 1200))
  check(T('listing and loading it wrote nothing: same bytes, same modification time, no other file'), sha(join(dir, `${oldId}.json`)) === before.sha && statSync(join(dir, `${oldId}.json`)).mtimeMs === before.mtime && (await names(dir)).join() === [id + '.json', oldId + '.json'].sort().join(), JSON.stringify(await names(dir)))
  const next = await fresh.save({ id: oldId, messages: [...old.conversation.messages, u('a new question'), a({ provider: 'anthropic', model: OPUS }, 'a new answer')] })
  const upgraded = JSON.parse(readFileSync(join(dir, `${oldId}.json`), 'utf8'))
  check(T('the next save of it writes version 3, with the old replies still "anthropic"/null and the new one named'), next.ok && upgraded.version === 3 && upgraded.messages.filter((m) => m.role === 'assistant').map(fields).join(';') === `["anthropic",null];["anthropic",null];["anthropic","${OPUS}"]`, upgraded.version + ' ' + upgraded.messages.map(fields).join(';'))
  check(T('...keeps its creation date, and nothing else is left in the folder'), upgraded.createdAt === 5000 && (await names(dir)).join() === [id + '.json', oldId + '.json'].sort().join())

  // a version 4 file (made by a later build) is left alone and counted
  const futureId = randomUUID()
  const futureText = JSON.stringify({ version: 4, id: futureId, title: 'later', createdAt: 1, updatedAt: 2, instructions: '', messages: [u('x'), a()] })
  await fsp.writeFile(join(dir, `${futureId}.json`), futureText)
  const future = createConversationStore(dir)
  const fl = await future.list()
  check(T('a version 4 file is counted as unreadable, not listed, and left as it is'), fl.unreadable === 1 && !fl.conversations.some((c) => c.id === futureId) && readFileSync(join(dir, `${futureId}.json`), 'utf8') === futureText)

  // a version 2 file with unusable fields is still a conversation
  const oddId = randomUUID()
  await fsp.writeFile(join(dir, `${oddId}.json`), JSON.stringify({ version: 2, id: oddId, title: 'odd', createdAt: 1, updatedAt: 3, messages: [u('x'), a({ provider: 'nope', model: 'NOT AN ID' })] }))
  const odd = await createConversationStore(dir).load(oddId)
  check(T('a version 2 file whose provider is one this build does not know is still readable (null and null)'), odd.ok && fields(odd.conversation.messages[1]) === '[null,null]')
  await fsp.rm(join(dir, '..'), { recursive: true, force: true })
}

const passed = check.summary()
process.exit(passed ? 0 : 1)
