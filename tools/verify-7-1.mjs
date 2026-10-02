// Slice 7.1 (D-024), straight under Node (no window): the effort choice check, the helpers that decide what a reply asks for and
// what the page is told, and the request each adapter really sends against the mock, for every model and every level.
// Run: node tools/verify-7-1.mjs
import { REPO, REPO_URL } from './paths.mjs'
import './ts-resolve.mjs'
import { checker } from './cdp.mjs'
import { readFileSync } from 'node:fs'
import { startMock } from './mock-providers.mjs'

const check = checker()
const R = await import(`${REPO_URL}/src/shared/registry.ts`)
const V = await import(`${REPO_URL}/src/shared/validate.ts`)
const E = await import(`${REPO_URL}/src/shared/effort.ts`)
const { buildStreamRequest } = await import(`${REPO_URL}/src/main/providers/request.ts`)
const { adapterFor } = await import(`${REPO_URL}/src/main/providers/index.ts`)

const parsed = R.parseRegistry(JSON.parse(readFileSync(`${REPO}/registry/models.json`, 'utf8')))
if (!parsed.ok) throw new Error('the registry is unusable: ' + parsed.error)
const models = parsed.registry.models
const by = Object.fromEntries(models.map((m) => [m.id, m]))
const OPUS = 'claude-opus-5-5', HAIKU = 'claude-haiku-4-5-20251001', FABLE = 'claude-fable-5-1', SONNET = 'claude-sonnet-5-5'
const ASTRA = 'gpt-6-astra', SOL = 'gpt-6.1-sol', LUNA = 'gpt-6-luna'
const clone = (v) => JSON.parse(JSON.stringify(v))
const choose = (input) => V.checkEffortChoice(input, models)
const refusedWith = (r, re) => !r.ok && re.test(r.error)

// ============ 1. checkEffortChoice: what the page may ask for ============
let bad = []
let good = 0
for (const m of models) for (const level of m.capabilities.effortLevels) {
  const r = choose({ modelId: m.id, level })
  if (r.ok && r.modelId === m.id && r.level === level) good++
  else bad.push(`${m.id}/${level}`)
}
const levelCount = models.reduce((n, m) => n + m.capabilities.effortLevels.length, 0)
check(`every level each model lists is accepted, and handed back as the registry's own strings (${good} of ${levelCount} pairs)`, bad.length === 0 && good === levelCount, bad.join())

bad = []
let refused = 0
for (const m of models) for (const level of R.EFFORT_LEVELS.filter((l) => !m.capabilities.effortLevels.includes(l))) {
  const r = choose({ modelId: m.id, level })
  if (refusedWith(r, /does not take that effort level/)) refused++
  else bad.push(`${m.id}/${level}`)
}
check(`every level a model does NOT list is refused for that model, whoever lists it (${refused} pairs, among them every level for Haiku)`, bad.length === 0 && refused === models.length * R.EFFORT_LEVELS.length - levelCount, bad.join())
check('"none" is Luna\'s alone: refused for Opus and for Astra, accepted for Luna (the check uses the NAMED model\'s own list, not a list of all levels)', refusedWith(choose({ modelId: OPUS, level: 'none' }), /does not take/) && refusedWith(choose({ modelId: ASTRA, level: 'none' }), /does not take/) && choose({ modelId: LUNA, level: 'none' }).ok)
check('Haiku 4.5 takes no effort at all: even the mildest level is refused', refusedWith(choose({ modelId: HAIKU, level: 'low' }), /does not take/))

for (const [name, id] of [['an unknown id', 'claude-nope-1'], ['empty', ''], ['upper case', 'CLAUDE-OPUS-5-5'], ['padded left', ' claude-opus-5-5'], ['padded right', 'claude-opus-5-5 '], ['a prototype name', '__proto__'], ['"constructor"', 'constructor'], ['"toString"', 'toString'], ['a NUL after the id', 'claude-opus-5-5\u0000'], ['a path', '..\\claude-opus-5-5'], ['a very long id', 'a'.repeat(100000)]]) {
  check(`a model id that is not exactly one on offer is refused: ${name}`, refusedWith(choose({ modelId: id, level: 'high' }), /That model is not available/))
}
for (const [name, level] of [['upper case', 'HIGH'], ['capitalised', 'High'], ['padded left', ' high'], ['padded right', 'high '], ['a newline after it', 'xhigh\n'], ['a NUL after it', 'medium\u0000'], ['an unknown level', 'extreme'], ['with a hyphen', 'x-high'], ['empty', ''], ['a very long string', 'h'.repeat(100000)]]) {
  check(`a level that is not exactly one the model lists is refused: ${name}`, refusedWith(choose({ modelId: OPUS, level }), /does not take that effort level/))
}
const kinds = [['a number', 5], ['null', null], ['undefined', undefined], ['true', true], ['an array', ['high']], ['an object that prints as "high"', { toString: () => 'high' }], ['a symbol', Symbol('high')]]
for (const [name, value] of kinds) {
  check(`a level that is not text is refused: ${name}`, refusedWith(choose({ modelId: OPUS, level: value }), /not understood/))
  check(`a model id that is not text is refused: ${name}`, refusedWith(choose({ modelId: value, level: 'high' }), /not understood/))
}
for (const [name, value] of [['null', null], ['undefined', undefined], ['a string', 'high'], ['a number', 5], ['an array', [OPUS, 'high']], ['an empty object', {}]]) {
  check(`input that is not { modelId, level } is refused: ${name}`, !choose(value).ok)
}
const extra = choose({ modelId: OPUS, level: 'high', evil: { x: 1 }, __proto__: { polluted: 1 } })
check('extra fields on the input are dropped: the answer holds exactly ok, modelId and level', extra.ok && Object.keys(extra).sort().join() === 'level,modelId,ok')
const echo = choose({ modelId: 'EVIL<script>alert(1)</script>', level: 'high' })
check('a refusal does not repeat what the page sent', !echo.ok && !/EVIL|script/.test(echo.error), echo.error)
check('with no usable registry (an empty list) nothing is accepted', refusedWith(V.checkEffortChoice({ modelId: OPUS, level: 'high' }, []), /not available/))
check('the check does not change the models it is given', JSON.stringify(models) === JSON.stringify(parsed.registry.models) && Object.isFrozen(models) === false)

// ============ 2. sortedLevels: the page always sees them from least to most thinking ============
check('sortedLevels puts any order into the canonical one', JSON.stringify(E.sortedLevels(['max', 'low', 'xhigh', 'medium', 'high'])) === '["low","medium","high","xhigh","max"]')
check('...with "none" first when a model takes it, each level once, and anything that is not a level dropped', JSON.stringify(E.sortedLevels(['high', 'none', 'high', 'extreme', 'low'])) === '["none","low","high"]')
check('...an empty list stays empty, and the input is not changed', (() => { const input = ['max', 'low']; const out = E.sortedLevels(input); return E.sortedLevels([]).length === 0 && JSON.stringify(input) === '["max","low"]' && out !== input })())

// ============ 3. parseSavedEfforts: reading what the file holds, forgiving about each entry ============
const parseText = (text) => E.parseSavedEfforts(JSON.parse(text))
const asObject = (map) => JSON.stringify(Object.fromEntries(map))
check('a good map is read as it is', asObject(parseText(`{"${OPUS}":"high","${LUNA}":"none"}`)) === `{"${OPUS}":"high","${LUNA}":"none"}`)
for (const [name, text] of [['null', 'null'], ['a string', '"high"'], ['a number', '7'], ['an array', `["${OPUS}","high"]`], ['true', 'true']]) {
  check(`something that is not a map holds nothing: ${name}`, parseText(text).size === 0)
}
check('an entry with a value that is not a known level is dropped, the others stay (a number, null, an object, a wrong spelling, an unknown level)', asObject(parseText(`{"a":5,"b":null,"c":{},"d":"HIGH","e":"extreme","${SONNET}":"low","${OPUS}":"max"}`)) === `{"${SONNET}":"low","${OPUS}":"max"}`)
check('a key that is not shaped like a model id is dropped (upper case, padded, empty, too long, a path)', asObject(parseText(`{"CLAUDE":"low"," x":"low","":"low","${'a'.repeat(65)}":"low","..\\\\x":"low","${OPUS}":"low"}`)) === `{"${OPUS}":"low"}`)
const polluted = parseText(`{"__proto__":"high","constructor":"low","${OPUS}":"high"}`)
const roundTrip = JSON.parse(JSON.stringify(Object.fromEntries(polluted)))
check('"__proto__" is dropped by its shape (a model id starts with a letter or digit), "constructor" is an ordinary key like any other id; nothing is polluted, also after writing the map out and reading it back', polluted.size === 2 && polluted.get('constructor') === 'low' && !polluted.has('__proto__') && polluted.get(OPUS) === 'high' && ({}).high === undefined && ({}).low === undefined && ({}).constructor === Object && Object.prototype.hasOwnProperty.call(Object.prototype, 'high') === false && E.parseSavedEfforts(roundTrip).size === 2)
const many = Object.fromEntries(Array.from({ length: 5000 }, (_, i) => [`m${i}`, 'low']))
check('a map with thousands of entries is cut at 200 (nobody chose that many)', E.parseSavedEfforts(many).size === 200)
check('the result is a Map of its own: changing it does not change what was parsed', (() => { const input = { [OPUS]: 'high' }; const out = E.parseSavedEfforts(input); out.set('x', 'low'); return !('x' in input) && out.get(OPUS) === 'high' })())

// ============ 4. resolveEffort: what a reply asks for ============
const none = new Map()
const pick = (id, saved = none) => E.resolveEffort(by[id], saved)
check('nothing saved: every model gets the registry\'s own pick (Fable high, Opus medium, Sonnet medium, Haiku none, the OpenAI three medium)', [[FABLE, 'high'], [OPUS, 'medium'], [SONNET, 'medium'], [HAIKU, null], [ASTRA, 'medium'], [SOL, 'medium'], [LUNA, 'medium']].every(([id, level]) => pick(id).effort === level && pick(id).unusable === null))
check('a saved level the model lists is used', pick(OPUS, new Map([[OPUS, 'max']])).effort === 'max' && pick(LUNA, new Map([[LUNA, 'none']])).effort === 'none' && pick(FABLE, new Map([[FABLE, 'low']])).effort === 'low')
check('a choice is per model: one for Opus changes nothing for Sonnet or Astra', pick(SONNET, new Map([[OPUS, 'max']])).effort === 'medium' && pick(ASTRA, new Map([[OPUS, 'max']])).effort === 'medium')
const stale = pick(OPUS, new Map([[OPUS, 'none']]))
check('a saved level the model does not list (the registry changed under it) is NOT used: the registry\'s pick applies, and the level is named so it can be logged', stale.effort === 'medium' && stale.unusable === 'none')
const hk = pick(HAIKU, new Map([[HAIKU, 'high']]))
check('a saved level for a model that takes none is not used either: no effort at all', hk.effort === null && hk.unusable === 'high')
const changed = clone(by[OPUS]); changed.capabilities.effortLevels = ['low', 'medium']
check('the saved level is checked against the model\'s list EVERY time (a list that shrank drops "max" again)', E.resolveEffort(changed, new Map([[OPUS, 'max']])).effort === 'medium' && E.resolveEffort(changed, new Map([[OPUS, 'low']])).effort === 'low')

// ============ 5. effortStatusOf: what the page is told ============
const st = E.effortStatusOf(by[OPUS], 'high')
check('Opus: the five levels, from least to most; selected is what was resolved; default is the registry\'s pick', JSON.stringify(st) === '{"levels":["low","medium","high","xhigh","max"],"selected":"high","default":"medium"}', JSON.stringify(st))
check('Luna: "none" comes first (six levels)', E.effortStatusOf(by[LUNA], 'medium').levels.join() === 'none,low,medium,high,xhigh,max')
check('Haiku takes none: the page is told null (the menu is hidden)', E.effortStatusOf(by[HAIKU], null) === null && E.effortStatusOf(by[HAIKU], 'high') === null)
check('no resolved effort for a model that lists levels is also null (nothing to show)', E.effortStatusOf(by[OPUS], null) === null)
const unsorted = clone(by[OPUS]); unsorted.capabilities.effortLevels = ['max', 'low', 'high', 'medium', 'xhigh']
check('a registry that lists the levels in another order still shows them from least to most', E.effortStatusOf(unsorted, 'medium').levels.join() === 'low,medium,high,xhigh,max')
check('the status holds exactly levels, selected and default, and its levels are a copy (changing them changes nothing in the registry)', (() => { const s = E.effortStatusOf(by[OPUS], 'low'); s.levels.length = 0; return Object.keys(E.effortStatusOf(by[OPUS], 'low')).join() === 'levels,selected,default' && by[OPUS].capabilities.effortLevels.length === 5 })())
check('for every model, "selected" and "default" are among its levels', models.filter((m) => m.capabilities.effortLevels.length > 0).every((m) => { const s = E.effortStatusOf(m, E.resolveEffort(m, none).effort); return s.levels.includes(s.selected) && s.levels.includes(s.default) }))

// ============ 6. buildStreamRequest: the effort a request carries ============
const base = { credentials: { apiKey: 'k'.repeat(24) }, messages: [{ role: 'user', content: 'hi' }], signal: new AbortController().signal }
check('left out, the request asks what the registry picks (what every reply asked for before there was a choice)', buildStreamRequest({ ...base, model: by[OPUS] }).effort === 'medium' && buildStreamRequest({ ...base, model: by[HAIKU] }).effort === null && buildStreamRequest({ ...base, model: by[LUNA] }).effort === 'medium')
check('given, it is what the request carries, whatever the registry picks', buildStreamRequest({ ...base, model: by[OPUS], effort: 'max' }).effort === 'max' && buildStreamRequest({ ...base, model: by[ASTRA], effort: 'low' }).effort === 'low')
check('null is a decision too (a model that takes none), and is not turned into the registry\'s pick', buildStreamRequest({ ...base, model: by[OPUS], effort: null }).effort === null)

// ============ 7. what each adapter really sends, against the mock, for every model and every level ============
const PORT = Number(process.env.EFFORT_PORT ?? 8897)
const mock = await startMock(PORT)
const url = `http://127.0.0.1:${PORT}`
const KEY = 'test-effort-key-0123456789abcdef0123456789'
async function sent(model, extra) {
  await fetch(`${url}/__reset`, { method: 'POST' })
  const request = buildStreamRequest({ credentials: { apiKey: KEY, baseURL: url }, model, ...extra, messages: [{ role: 'user', content: '[[mock:empty]] hi' }], signal: new AbortController().signal })
  let error = null
  try { for await (const event of adapterFor(model.provider).stream(request)) void event } catch (e) { error = e }
  const records = await (await fetch(`${url}/__requests`)).json()
  return { error, records, body: records[0]?.body ?? null, problems: records[0]?.problems ?? null }
}
try {
  let wrong = []
  let n = 0
  for (const m of models.filter((x) => x.provider === 'anthropic' && x.capabilities.effortLevels.length > 0)) {
    for (const level of m.capabilities.effortLevels) {
      const r = await sent(m, { effort: level })
      n++
      if (r.error || r.problems?.length || JSON.stringify(r.body?.output_config) !== JSON.stringify({ effort: level })) wrong.push(`${m.id}/${level}: ${r.error?.message ?? ''} ${JSON.stringify(r.body?.output_config)}`)
    }
  }
  check(`Anthropic: every model sends output_config { effort: <the level chosen> } and the mock accepts it (${n} requests: Fable, Opus, Sonnet at five levels each)`, wrong.length === 0 && n === 15, wrong.join(' | '))

  wrong = []; n = 0
  for (const m of models.filter((x) => x.provider === 'openai')) {
    for (const level of m.capabilities.effortLevels) {
      const r = await sent(m, { effort: level })
      n++
      if (r.error || r.problems?.length || JSON.stringify(r.body?.reasoning) !== JSON.stringify({ effort: level })) wrong.push(`${m.id}/${level}: ${r.error?.message ?? ''} ${JSON.stringify(r.body?.reasoning)}`)
    }
  }
  check(`OpenAI: every model sends reasoning { effort: <the level chosen> } and the mock accepts it (${n} requests, Luna also at "none")`, wrong.length === 0 && n === 16, wrong.join(' | '))

  const a = await sent(by[OPUS], { effort: 'max' })
  check('the request\'s level wins over the registry entry\'s own: Opus (registry "medium") asked for "max" sends "max"', JSON.stringify(a.body?.output_config) === '{"effort":"max"}' && by[OPUS].effort === 'medium')
  const o = await sent(by[SOL], { effort: 'low' })
  check('...and the same for OpenAI: Sol (registry "medium") asked for "low" sends "low"', JSON.stringify(o.body?.reasoning) === '{"effort":"low"}' && by[SOL].effort === 'medium')
  const nothing = await sent(by[OPUS], { effort: null })
  check('a request with effort null sends NO effort at all, even to a model whose registry entry has one (the adapter does not look at the entry)', !('output_config' in (nothing.body ?? {})) && !nothing.error)
  const nothingO = await sent(by[SOL], { effort: null })
  check('...for OpenAI too: no reasoning field', !('reasoning' in (nothingO.body ?? {})) && !nothingO.error)
  const h = await sent(by[HAIKU], {})
  check('Haiku, which takes none: no output_config in the request, and the mock is content', !('output_config' in (h.body ?? {})) && !h.error)
  const def = await sent(by[OPUS], {})
  check('left out, the default still goes out unchanged: Opus sends effort "medium"', JSON.stringify(def.body?.output_config) === '{"effort":"medium"}')
  const none1 = await sent(by[OPUS], { effort: 'none' })
  check('Anthropic has no level "none": asked for it, the adapter fails before any request is made', !!none1.error && /no effort level "none"/.test(none1.error.message) && none1.records.length === 0, none1.error?.message)
  check('the output ceiling and the rest of the body do not depend on the effort (max_tokens 16000, cache control, stream, the same system prompt)', (() => { const x = a.body; const y = def.body; return x.max_tokens === 16000 && y.max_tokens === 16000 && x.system === y.system && JSON.stringify(x.cache_control) === JSON.stringify(y.cache_control) && x.stream === true && JSON.stringify(x.messages) === JSON.stringify(y.messages) })())
  check('the key travels only in the header, whatever the effort (not in any body)', JSON.stringify(a.body).indexOf(KEY) === -1 && JSON.stringify(o.body).indexOf(KEY) === -1)
} finally {
  await mock.close()
}

process.exit(check.summary() ? 0 : 1)
