// Stage 6 (D-023): registry/rankings.json at schema 0.2, its validator, the task list and the function that turns the rows
// into suggestions, straight under Node (no window). Run: node verify-6-1.mjs
import { REPO, REPO_URL } from './paths.mjs'
import './ts-resolve.mjs'
import { checker } from './cdp.mjs'
import { readFileSync } from 'node:fs'

const check = checker()
const K = await import(`${REPO_URL}/src/shared/rankings.ts`)
const R = await import(`${REPO_URL}/src/shared/registry.ts`)
const { parseRankings, suggestionsFor, TASKS, RANKINGS_SCHEMA_VERSION } = K

const fileJson = JSON.parse(readFileSync(`${REPO}/registry/rankings.json`, 'utf8'))
const modelsJson = JSON.parse(readFileSync(`${REPO}/registry/models.json`, 'utf8'))
const clone = (v) => JSON.parse(JSON.stringify(v))
const row = (over = {}) => ({ ...clone(fileJson.rankings[0]), ...over })
const file = (over = {}, rankings = [row()]) => ({ ...clone({ ...fileJson, rankings }), ...over })
const errOf = (r) => (r.ok ? '(accepted)' : r.error)
const probs = (r) => r.problems.join(' | ')
const reg = R.parseRegistry(modelsJson)
const models = reg.ok ? reg.registry.models : []

// ============ 1. the real file ============
let r = parseRankings(fileJson)
check('the real registry/rankings.json is accepted', r.ok, errOf(r))
check('...with no problems at all', r.ok && r.problems.length === 0, r.ok ? probs(r) : '')
check('...and nothing was dropped: as many rows as in the file', r.ok && r.rankings.rows.length === fileJson.rankings.length)
check('the file on disk and the schema constant agree on the version', fileJson.schemaVersion === RANKINGS_SCHEMA_VERSION && RANKINGS_SCHEMA_VERSION === '0.2')
check('the file says when it was checked (17.7: Google\'s page on 2026-10-17)', fileJson.updatedAt === '2026-10-17')
const rows = r.ok ? r.rankings.rows : []
check('every row is for a model that is in registry/models.json (the app would tolerate a stranger, but this file should not hold one)', rows.every((x) => models.some((m) => m.id === x.modelId)), rows.filter((x) => !models.some((m) => m.id === x.modelId)).map((x) => x.modelId).join())
check('every row has a source on an https page, a date, and a note in the page\'s own words (quoted)', rows.every((x) => /^https:\/\/[^\s]+$/.test(x.source) && /^\d{4}-\d{2}-\d{2}$/.test(x.asOf) && x.note.includes('"')))
check('no row carries a score or any number of its own: exactly the five known fields', rows.every((x) => Object.keys(x).sort().join() === 'asOf,modelId,note,source,task'))
check('no task/model pair appears twice', new Set(rows.map((x) => `${x.task}/${x.modelId}`)).size === rows.length)
check('rows only for sources that name the model for the task: no "chat" row, no row for Fable or Luna (nothing fetched backs one)', rows.every((x) => x.task !== 'chat' && x.modelId !== 'claude-fable-5-1' && x.modelId !== 'gpt-6-luna'))
check('the OpenAI "quick" task has no row either (OpenAI states no latency)', !rows.some((x) => x.task === 'quick' && x.modelId.startsWith('gpt-')))

// the result is a clean copy
const input = clone(fileJson)
const out = parseRankings(input)
input.rankings[0].note = 'CHANGED AFTER'
check('the result is a copy: changing the input afterwards changes nothing', out.ok && out.rankings.rows[0].note !== 'CHANGED AFTER')

// ============ 2. the task list ============
check('the tasks are chat, coding, writing, quick answer, in this order, with these labels', JSON.stringify(TASKS) === JSON.stringify([{ id: 'chat', label: 'Chat' }, { id: 'coding', label: 'Coding' }, { id: 'writing', label: 'Writing' }, { id: 'quick', label: 'Quick answer' }]), JSON.stringify(TASKS))

// ============ 3. a whole file that cannot be used ============
for (const [name, value] of [['null', null], ['a number', 5], ['a string', 'x'], ['an array', []], ['undefined', undefined]]) {
  r = parseRankings(value)
  check(`refused as a whole: ${name}`, !r.ok && /does not hold a JSON object/.test(r.error), errOf(r))
}
for (const field of ['schemaVersion', 'updatedAt', 'source', 'rankings']) {
  const f = clone(fileJson); delete f[field]
  r = parseRankings(f)
  check(`refused: top-level field "${field}" missing`, !r.ok && r.error.includes(`"${field}"`) && /missing/.test(r.error), errOf(r))
}
r = parseRankings((() => { const f = clone(fileJson); f.ranking = f.rankings; delete f.rankings; return f })())
check('refused: a typo of "rankings" is caught: the real field missing and the unknown one named', !r.ok && /unknown field "ranking"/.test(r.error) && /"rankings" missing/.test(r.error), errOf(r))
for (const v of ['0.1', '0.3', '1', 0.2, null, '']) {
  r = parseRankings(file({ schemaVersion: v }))
  check(`refused: schemaVersion ${JSON.stringify(v)}`, !r.ok && /schemaVersion is .*reads 0\.2/.test(r.error), errOf(r))
}
for (const v of [null, '', '2026-02-30', '2026-1-1', 20261001, '2026-10-01 ', 'today']) {
  r = parseRankings(file({ updatedAt: v }))
  check(`refused: updatedAt ${JSON.stringify(v)}`, !r.ok && /updatedAt must be a date/.test(r.error), errOf(r))
}
for (const v of [null, '', ' padded', 'two\nlines', 5, 'x'.repeat(301)]) {
  r = parseRankings(file({ source: v }))
  check(`refused: source ${JSON.stringify(typeof v === 'string' ? v.slice(0, 20) : v)}`, !r.ok && /source must be one line/.test(r.error), errOf(r))
}
for (const v of [null, 'x', {}, 5]) {
  r = parseRankings(file({ rankings: v }))
  check(`refused: rankings is ${JSON.stringify(v)}`, !r.ok && /rankings must be a list/.test(r.error), errOf(r))
}
check('refused: more than 500 rows', !parseRankings(file({}, Array.from({ length: 501 }, (_, i) => row({ modelId: `m${i}` })))).ok)
{
  r = parseRankings(file({}, []))
  check('accepted: an empty list of rows (nothing is suggested; that is a valid file)', r.ok && r.rankings.rows.length === 0 && r.problems.length === 0, errOf(r))
}

// ============ 4. one row that cannot be used ============
const drop = (name, bad, pattern) => {
  const x = parseRankings(file({}, [row({ modelId: 'before-model' }), bad, row({ modelId: 'after-model' })]))
  check(`a row left out: ${name}; the rows around it stay, and it is named by position`, x.ok && x.rankings.rows.length === 2 && x.problems.length === 1 && x.problems[0].startsWith('rankings[1]') && pattern.test(x.problems[0]), x.ok ? probs(x) : errOf(x))
}
for (const field of ['task', 'modelId', 'note', 'source', 'asOf']) {
  const bad = row(); delete bad[field]
  drop(`field "${field}" missing`, bad, new RegExp(`field "${field}" missing`))
}
drop('an unknown field (a score cannot sneak in)', row({ score: 90 }), /unknown field "score"/)
drop('a typo of a field name', (() => { const b = row(); b.modle = b.modelId; delete b.modelId; return b })(), /"modelId" missing; unknown field "modle"/)
for (const [name, v] of [['not a known task', 'research'], ['upper case', 'Coding'], ['a number', 1], ['empty', ''], ['null', null]]) drop(`task ${name}`, row({ task: v }), /task .* is not one of/)
for (const [name, v] of [['upper case', 'Claude-Opus'], ['empty', ''], ['a space', 'a b'], ['too long', 'a'.repeat(65)], ['a number', 5], ['a slash', 'a/b']]) drop(`modelId ${name}`, row({ modelId: v }), /modelId must be lower-case/)
for (const [name, v] of [['empty', ''], ['padded', ' x'], ['two lines', 'a\nb'], ['a control character', 'a\u0007b'], ['too long (161)', 'x'.repeat(161)], ['a number', 5], ['null', null]]) drop(`note ${name}`, row({ note: v }), /note must be one line/)
for (const [name, v] of [['plain http', 'http://example.com/x'], ['no scheme', 'example.com/x'], ['javascript:', 'javascript:alert(1)'], ['file:', 'file:///c:/x'], ['only the scheme', 'https://'], ['a space in it', 'https://example.com/a b'], ['no host', 'https:///x'], ['too long', `https://example.com/${'a'.repeat(200)}`], ['empty', ''], ['a number', 5]]) drop(`source ${name}`, row({ source: v }), /source must be the https address/)
for (const [name, v] of [['an impossible day', '2026-02-30'], ['no zero padding', '2026-1-1'], ['a number', 20261001], ['empty', ''], ['words', 'today']]) drop(`asOf ${name}`, row({ asOf: v }), /asOf must be a date/)
for (const [name, v] of [['null', null], ['a number', 5], ['a string', 'x'], ['an array', []]]) drop(`the row is ${name}`, v, /is not an object/)
{
  const x = parseRankings(file({}, [row({ task: 'coding', modelId: 'm1' }), row({ task: 'coding', modelId: 'm1', note: 'second' }), row({ task: 'writing', modelId: 'm1' })]))
  check('the same model twice for one task: the later row is left out and says why', x.ok && x.rankings.rows.length === 2 && x.problems.length === 1 && /rankings\[1\] \("m1"\): this model is already named for coding/.test(x.problems[0]) && x.rankings.rows[0].note !== 'second', x.ok ? probs(x) : errOf(x))
  check('...but the same model for a different task is fine', x.ok && x.rankings.rows.some((y) => y.task === 'writing'))
}
{
  const x = parseRankings(file({}, [row({ task: 'bad' }), row({ source: 'http://x' }), row({ asOf: 'no' })]))
  check('every bad row is reported, none is dropped silently', x.ok && x.rankings.rows.length === 0 && x.problems.length === 3, x.ok ? probs(x) : errOf(x))
}

// ============ 5. from rows to suggestions ============
const rankings = parseRankings(fileJson).rankings
const both = () => true
const key = (list) => (p) => list.includes(p)
const tag = (list) => list.map((s) => `${s.modelId}:${s.task}`)
let s = suggestionsFor(rankings, models, both)
check('with every key: seven suggestions (17.7: Gemini 3.8 Flash for coding), in the registry\'s order and then the task list\'s', JSON.stringify(tag(s)) === JSON.stringify(['claude-opus-5-5:coding', 'claude-sonnet-5-5:coding', 'claude-sonnet-5-5:writing', 'gpt-6-astra:coding', 'gpt-6-astra:writing', 'gpt-6.1-sol:coding', 'gemini-3.8-flash:coding']), JSON.stringify(tag(s)))
check('each suggestion has exactly task, modelId, note, source, asOf, copied from its row', s.every((x) => Object.keys(x).sort().join() === 'asOf,modelId,note,source,task' && rankings.rows.some((y) => y.task === x.task && y.modelId === x.modelId && y.note === x.note && y.source === x.source && y.asOf === x.asOf)))
check('only an Anthropic key: only Anthropic models are suggested', JSON.stringify(tag(suggestionsFor(rankings, models, key(['anthropic'])))) === JSON.stringify(['claude-opus-5-5:coding', 'claude-sonnet-5-5:coding', 'claude-sonnet-5-5:writing']))
check('only an OpenAI key: only OpenAI models are suggested', JSON.stringify(tag(suggestionsFor(rankings, models, key(['openai'])))) === JSON.stringify(['gpt-6-astra:coding', 'gpt-6-astra:writing', 'gpt-6.1-sol:coding']))
check('no key at all: nothing is suggested', suggestionsFor(rankings, models, () => false).length === 0)
check('no rankings (the file could not be loaded): nothing is suggested, and nothing throws', suggestionsFor(null, models, both).length === 0)
check('an empty list of rows: nothing is suggested', suggestionsFor({ ...rankings, rows: [] }, models, both).length === 0)
check('"chat" has no suggestion (nothing fetched names a model for it)', s.every((x) => x.task !== 'chat'))
{
  // A row for a model the registry no longer has is skipped without a word (Haiku 4.5's row would have been: both were removed on 2026-10-06, D-036).
  const stranger = { task: 'quick', modelId: 'claude-haiku-4-5-20251001', note: '"The lowest latency and price, with extended thinking"', source: 'https://platform.claude.com/docs/en/about-claude/models/choosing-a-model', asOf: '2026-10-01' }
  let t
  let threw = false
  try { t = suggestionsFor({ ...rankings, rows: [...rankings.rows, stranger] }, models, both) } catch { threw = true }
  check('a row for a model the registry no longer has is skipped without an error, and the rest is unchanged', !threw && JSON.stringify(tag(t)) === JSON.stringify(tag(s)), JSON.stringify(t && tag(t)))
  check('"quick" has no suggestion now: its only row was Haiku 4.5\'s, removed with the model (D-036)', !s.some((x) => x.task === 'quick') && !rows.some((x) => x.task === 'quick'))
}
{
  const strange = { ...rankings, rows: [...rankings.rows, { task: 'coding', modelId: 'model-nobody-has', note: 'n', source: 'https://x.example/y', asOf: '2026-10-01' }] }
  check('a row for a model the registry does not have is ignored', !suggestionsFor(strange, models, both).some((x) => x.modelId === 'model-nobody-has'))
}
{
  const frozenRankings = Object.freeze({ ...rankings, rows: Object.freeze(rankings.rows.map((x) => Object.freeze({ ...x }))) })
  const frozenModels = Object.freeze(models.map((m) => Object.freeze({ id: m.id, provider: m.provider })))
  let threw = false
  try { suggestionsFor(frozenRankings, frozenModels, both) } catch { threw = true }
  check('it changes nothing it is given (frozen inputs are fine), and needs only the id and provider of a model', !threw)
  const a = suggestionsFor(rankings, models, both)
  a[0].note = 'CHANGED'
  check('the suggestions are copies: changing one does not change the rankings', rankings.rows[0].note !== 'CHANGED')
}

const passed = check.summary()
process.exit(passed ? 0 : 1)
