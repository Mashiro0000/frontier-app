// Slice 5.2 (ported from 3.1): the registry file at schema 0.5 (capabilities, per-model effort levels, four prices per model since 8.1, documentInput since 9.3), its validator, the
// page-facing projection and the model-choice check, straight under Node (no window). Run: node verify-5-2.mjs
import { REPO, REPO_URL } from './paths.mjs'
import './ts-resolve.mjs'
import { checker } from './cdp.mjs'
import { readFileSync } from 'node:fs'

const check = checker()
const R = await import(`${REPO_URL}/src/shared/registry.ts`)
const V = await import(`${REPO_URL}/src/shared/validate.ts`)
const { parseRegistry, toModelOption, REGISTRY_SCHEMA_VERSION, SUPPORTED_PROVIDERS, PROVIDER_NAMES } = R

const raw = readFileSync(`${REPO}/registry/models.json`, 'utf8')
const fileJson = JSON.parse(raw)
const clone = (v) => JSON.parse(JSON.stringify(v))
const entry = (over = {}) => ({ ...clone(fileJson.models[1]), ...over })
const reg = (over = {}, models = [entry()]) => ({ ...clone({ ...fileJson, models }), ...over })
const errOf = (r) => (r.ok ? '(accepted)' : r.error)
const probs = (r) => r.problems.join(' | ')

// ============ 1. the real file ============
let r = parseRegistry(fileJson)
check('the real registry/models.json is accepted', r.ok, errOf(r))
check('...with no problems at all', r.ok && r.problems.length === 0, r.ok ? probs(r) : '')
const ids = r.ok ? r.registry.models.map((m) => m.id) : []
check('...it lists the three Anthropic models and then the three OpenAI models, in this order (Claude Haiku 4.5 was removed on 2026-10-06, D-036)', JSON.stringify(ids) === JSON.stringify(['claude-fable-5-1', 'claude-opus-5-5', 'claude-sonnet-5-5', 'gpt-6-astra', 'gpt-6.1-sol', 'gpt-6-luna']), JSON.stringify(ids))
check('...the default is Claude Opus 5.5, as in Stage 2 (billing does not change by itself)', r.ok && r.registry.defaultModel.id === 'claude-opus-5-5')
check('...and the default is the same object as the list entry', r.ok && r.registry.models.includes(r.registry.defaultModel))
check('...updatedAt is the day the facts were checked', r.ok && r.registry.updatedAt === '2026-10-01')
const by = Object.fromEntries((r.ok ? r.registry.models : []).map((m) => [m.id, m]))
check('effort per model: Fable high, Opus medium, Sonnet medium', by['claude-fable-5-1']?.effort === 'high' && by['claude-opus-5-5']?.effort === 'medium' && by['claude-sonnet-5-5']?.effort === 'medium')
check('context: 1M for the three Anthropic models; max output 128K', [by['claude-fable-5-1'], by['claude-opus-5-5'], by['claude-sonnet-5-5']].every((m) => m?.contextWindow === 1_000_000 && m.maxOutputTokens === 128_000))
check('prices (USD per million tokens, in/out): 10/50, 4/20, 2/10 (Anthropic), 10/50, 2/10, 0.1/0.5 (OpenAI)', JSON.stringify(Object.values(by).map((m) => [m.pricing.inputPerMTok, m.pricing.outputPerMTok])) === JSON.stringify([[10, 50], [4, 20], [2, 10], [10, 50], [2, 10], [0.1, 0.5]]))
check('every entry is for a provider this app can call, and the first three are Anthropic\'s and the last three OpenAI\'s', Object.values(by).every((m, i) => m.provider === (i < 3 ? 'anthropic' : 'openai')))
check('the file on disk and the schema constant agree on the version', fileJson.schemaVersion === REGISTRY_SCHEMA_VERSION && REGISTRY_SCHEMA_VERSION === '0.5')
check('every supported provider has a display name', SUPPORTED_PROVIDERS.every((p) => typeof PROVIDER_NAMES[p] === 'string' && PROVIDER_NAMES[p] !== ''))

// the result is a clean copy
const input = clone(fileJson)
const out = parseRegistry(input)
input.models[1].label = 'CHANGED AFTER'
input.models[1].pricing.inputPerMTok = 999
check('the result is a copy: changing the input afterwards changes nothing', out.ok && out.registry.models[1].label === 'Claude Opus 5.5' && out.registry.models[1].pricing.inputPerMTok === 4)
check('each entry has exactly the known fields', out.ok && out.registry.models.every((m) => Object.keys(m).sort().join() === 'capabilities,contextWindow,description,effort,id,label,maxOutputTokens,pricing,provider'))

// ============ 2. a whole file that cannot be used ============
for (const [name, value] of [['null', null], ['a number', 5], ['a string', 'x'], ['an array', []], ['undefined', undefined]]) {
  r = parseRegistry(value)
  check(`refused as a whole: ${name}`, !r.ok && /does not hold a JSON object/.test(r.error), errOf(r))
}
for (const field of ['schemaVersion', 'updatedAt', 'source', 'defaultModelId', 'models']) {
  const f = clone(fileJson); delete f[field]
  r = parseRegistry(f)
  check(`refused: top-level field "${field}" missing`, !r.ok && r.error.includes(`"${field}"`) && /missing/.test(r.error), errOf(r))
}
r = parseRegistry({ ...clone(fileJson), defaultModel: 'claude-opus-5-5' })
check('refused: an unknown top-level field (a typo of defaultModelId is caught)', !r.ok && /unknown field "defaultModel"/.test(r.error), errOf(r))
for (const v of ['0.1', '0.2', '0.3', '0.4', '1', 0.5, null, '']) {
  r = parseRegistry({ ...clone(fileJson), schemaVersion: v })
  check(`refused: schemaVersion ${JSON.stringify(v)}`, !r.ok && /schemaVersion is .*reads 0\.5/.test(r.error), errOf(r))
}
for (const v of [null, '', '2026-13-01', '2026-02-30', '26-10-01', '2026-1-1', 20261001, '2026-10-01T00:00:00Z', ' 2026-10-01']) {
  r = parseRegistry({ ...clone(fileJson), updatedAt: v })
  check(`refused: updatedAt ${JSON.stringify(v)}`, !r.ok && /updatedAt must be a date/.test(r.error), errOf(r))
}
check('accepted: a real leap day', parseRegistry({ ...clone(fileJson), updatedAt: '2028-02-29' }).ok)
check('refused: 29 February in a year that has none', !parseRegistry({ ...clone(fileJson), updatedAt: '2027-02-29' }).ok)
for (const [name, v] of [['empty', ''], ['301 characters', 'x'.repeat(301)], ['a line break', 'one\ntwo'], ['padded', ' padded '], ['a number', 5]]) {
  r = parseRegistry({ ...clone(fileJson), source: v })
  check(`refused: source is ${name}`, !r.ok && /source must be one line of text/.test(r.error), errOf(r))
}
check('accepted: source of exactly 300 characters', parseRegistry({ ...clone(fileJson), source: 'x'.repeat(300) }).ok)
r = parseRegistry({ ...clone(fileJson), defaultModelId: 5 })
check('refused: defaultModelId is not text', !r.ok && /defaultModelId must be text/.test(r.error), errOf(r))
r = parseRegistry({ ...clone(fileJson), defaultModelId: 'claude-opus-5-6' })
check('refused: a default that is not a listed model (never guessed: it decides what is billed)', !r.ok && /defaultModelId "claude-opus-5-6" is not one of the usable models/.test(r.error), errOf(r))
r = parseRegistry({ ...clone(fileJson), defaultModelId: 'claude-opus-5-5', models: [entry({ id: 'claude-opus-5-5', effort: 'extreme' }), entry({ id: 'other-model' })] })
check('refused: the default points at an entry that was itself left out as broken', !r.ok && /is not one of the usable models/.test(r.error) && /effort must be/.test(probs(r)), `${errOf(r)} || ${probs(r)}`)
for (const [name, v] of [['not a list', {}], ['empty', []], ['a string', 'models'], ['null', null]]) {
  r = parseRegistry({ ...clone(fileJson), models: v })
  check(`refused: models is ${name}`, !r.ok && /models must be a list of 1 to 50 entries/.test(r.error), errOf(r))
}
const huge = { ...clone(fileJson), models: Array.from({ length: 100_000 }, () => entry()) } // built outside the timer
const t0 = Date.now()
r = parseRegistry(huge)
check('refused quickly: 100 000 entries (the parse alone is timed)', !r.ok && /1 to 50/.test(r.error) && Date.now() - t0 < 50, `${Date.now() - t0} ms`)
check('accepted: exactly 50 entries (49 duplicates are reported, not fatal)', (() => { const x = parseRegistry({ ...clone(fileJson), models: Array.from({ length: 50 }, () => entry()) }); return x.ok && x.registry.models.length === 1 && x.problems.length === 49 })())
r = parseRegistry({ ...clone(fileJson), models: [null, 5, 'x'] })
check('refused: every entry unusable', !r.ok && /none of the entries in models is usable/.test(r.error) && r.problems.length === 3, `${errOf(r)} || ${probs(r)}`)

// ============ 3. one bad entry: left out, the others stay ============
const skipped = (name, bad, pattern) => {
  const x = parseRegistry({ ...clone(fileJson), models: [entry(), entry({ id: 'second-model', ...bad })] })
  check(`entry left out, other kept: ${name}`, x.ok && x.registry.models.length === 1 && x.problems.length === 1 && pattern.test(x.problems[0]), x.ok ? probs(x) : errOf(x))
}
for (const field of ['provider', 'id', 'label', 'description', 'contextWindow', 'maxOutputTokens', 'pricing', 'capabilities', 'effort']) {
  const e = entry({ id: 'second-model' }); delete e[field]
  const x = parseRegistry({ ...clone(fileJson), models: [entry(), e] })
  check(`entry left out: field "${field}" missing (a missing effort is an error, not a quiet default)`, x.ok && x.registry.models.length === 1 && new RegExp(`field "${field}" missing`).test(x.problems[0] ?? ''), x.ok ? probs(x) : errOf(x))
}
skipped('a misspelt field (effrot)', { effrot: 'medium' }, /unknown field "effrot"/)
// a misspelt field name is BOTH a missing field and an unknown one, and the message must show both halves
{
  const e = entry({ id: 'second-model' }); e.effrot = e.effort; delete e.effort
  const x = parseRegistry({ ...clone(fileJson), models: [entry(), e] })
  check('a renamed field (effort -> effrot) is reported as BOTH missing and unknown, in one message', x.ok && x.problems.length === 1 && /: field "effort" missing; unknown field "effrot"$/.test(x.problems[0]), x.ok ? probs(x) : errOf(x))
  const f = entry({ id: 'third-model' }); f.lable = f.label; f.descripton = f.description; delete f.label; delete f.description
  const y = parseRegistry({ ...clone(fileJson), models: [entry(), f] })
  check('several misspelt fields: plural wording, both lists', y.ok && /fields "label", "description" missing; unknown fields "lable", "descripton"$/.test(y.problems[0]), y.ok ? probs(y) : errOf(y))
  const root = clone(fileJson); root.defaultModel = root.defaultModelId; delete root.defaultModelId
  const z = parseRegistry(root)
  check('top level: a renamed defaultModelId is reported as both missing and unknown', !z.ok && /field "defaultModelId" missing; unknown field "defaultModel"/.test(z.error), errOf(z))
}
skipped('provider "gemini" (no code for it yet)', { provider: 'gemini' }, /provider "gemini" is not one this version of the app can call/)
skipped('provider is not text', { provider: 5 }, /provider "5" is not one/)
for (const [name, v] of [['upper case', 'Claude-Opus'], ['a space', 'claude opus'], ['a slash', 'a/b'], ['65 characters', 'a'.repeat(65)], ['empty', ''], ['a number', 5], ['a leading hyphen', '-opus'], ['non-ASCII', 'cläude'], ['a line break', 'a\nb']]) {
  skipped(`id is ${name}`, { id: v }, /id must be lower-case letters/)
}
check('accepted: an id of exactly 64 characters, and ids with dots, hyphens, underscores', parseRegistry({ ...clone(fileJson), models: [entry({ id: 'a'.repeat(64) }), entry({ id: 'x.y-z_1' })], defaultModelId: 'x.y-z_1' }).ok)
for (const [name, v] of [['empty', ''], ['61 characters', 'x'.repeat(61)], ['a line break', 'a\nb'], ['a control character', 'a\u0007b'], ['padded', ' x '], ['a number', 5], ['null', null]]) {
  skipped(`label is ${name}`, { label: v }, /label must be one line of text, up to 60/)
}
skipped('description of 161 characters', { description: 'x'.repeat(161) }, /description must be one line of text, up to 160/)
skipped('description with a tab', { description: 'a\tb' }, /description must be one line/)
check('accepted: label of 60 and description of 160 characters', parseRegistry({ ...clone(fileJson), models: [entry({ label: 'x'.repeat(60), description: 'y'.repeat(160) })] }).ok)
for (const [name, v] of [['zero', 0], ['negative', -1], ['fractional', 1.5], ['text', '1000'], ['NaN', NaN], ['Infinity', Infinity], ['above 100 million', 100_000_001], ['unsafe integer', Number.MAX_SAFE_INTEGER + 1], ['null', null]]) {
  skipped(`contextWindow is ${name}`, { contextWindow: v }, /contextWindow must be a whole number of tokens/)
}
skipped('maxOutputTokens larger than the context window', { contextWindow: 1000, maxOutputTokens: 1001 }, /maxOutputTokens must be .* at most contextWindow/)
skipped('maxOutputTokens is zero', { maxOutputTokens: 0 }, /maxOutputTokens must be/)
check('accepted: maxOutputTokens equal to the context window', parseRegistry({ ...clone(fileJson), models: [entry({ contextWindow: 1000, maxOutputTokens: 1000 })] }).ok)
skipped('pricing is not an object', { pricing: 4 }, /pricing must have exactly "inputPerMTok", "cacheReadPerMTok", "cacheWritePerMTok", "outputPerMTok"/)
skipped('pricing is an array', { pricing: [4, 20] }, /pricing must have exactly/)
skipped('pricing lacks outputPerMTok', { pricing: { inputPerMTok: 4 } }, /pricing must have exactly/)
skipped('pricing has an extra field', { pricing: { inputPerMTok: 4, outputPerMTok: 20, cachedPerMTok: 0.4 } }, /pricing must have exactly/)
const prices = (over) => ({ inputPerMTok: 4, cacheReadPerMTok: 0.4, cacheWritePerMTok: 5, outputPerMTok: 20, ...over })
for (const [name, p] of [['negative', prices({ inputPerMTok: -1 })], ['NaN', prices({ inputPerMTok: NaN })], ['Infinity', prices({ outputPerMTok: Infinity })], ['text', prices({ inputPerMTok: '4' })], ['10001', prices({ outputPerMTok: 10001 })], ['null', prices({ inputPerMTok: null })], ['a negative cache read', prices({ cacheReadPerMTok: -1 })], ['a cache write as text', prices({ cacheWritePerMTok: '5' })], ['a cache write of 10001', prices({ cacheWritePerMTok: 10001 })]]) {
  skipped(`a price is ${name}`, { pricing: p }, /the prices must be numbers from 0 to 10000/)
}
check('accepted: free (0) and fractional prices', (() => { const x = parseRegistry({ ...clone(fileJson), models: [entry({ pricing: { inputPerMTok: 0, cacheReadPerMTok: 0, cacheWritePerMTok: 0, outputPerMTok: 0.25 } })] }); return x.ok && x.registry.models[0].pricing.outputPerMTok === 0.25 })())
for (const [name, v] of [['a word no provider has ("extreme")', 'extreme'], ['"minimal" (not a level this registry knows)', 'minimal'], ['upper case', 'MEDIUM'], ['a number', 5], ['undefined', undefined], ['an empty string', ''], ['false', false]]) {
  skipped(`effort is ${name}`, { effort: v }, /effort must be one of "none", "low", "medium", "high", "xhigh", "max" or null/)
}
// 5.2: "xhigh" and "max" are now facts a model can state (capabilities.effortLevels), so they may be picked
check('accepted: any level the model lists (Opus lists low, medium, high, xhigh, max)', ['low', 'medium', 'high', 'xhigh', 'max'].every((e) => parseRegistry({ ...clone(fileJson), models: [entry({ effort: e })] }).ok))
check('accepted: effort null, for a model whose effortLevels is empty', parseRegistry({ ...clone(fileJson), models: [entry({ effort: null, capabilities: { ...entry().capabilities, effortLevels: [] } })] }).ok)
for (const [name, v] of [['null', null], ['a number', 5], ['a string', 'x'], ['an array', []]]) {
  const x = parseRegistry({ ...clone(fileJson), models: [entry(), v] })
  check(`entry left out: it is ${name}`, x.ok && x.registry.models.length === 1 && /models\[1\]: is not an object/.test(x.problems[0]), x.ok ? probs(x) : errOf(x))
}
const dup = parseRegistry({ ...clone(fileJson), models: [entry(), entry({ label: 'Second with the same id' })] })
check('entry left out: a duplicate id (the first one wins)', dup.ok && dup.registry.models.length === 1 && dup.registry.models[0].label !== 'Second with the same id' && /already used by an earlier entry/.test(dup.problems[0]), dup.ok ? probs(dup) : errOf(dup))
check('problems name the entry by position and id', (() => { const x = parseRegistry({ ...clone(fileJson), models: [entry(), entry({ id: 'second-model', effort: 'extreme' })] }); return x.ok && x.problems[0].startsWith('models[1] ("second-model"): ') })())

// ============ 4. hostile shapes ============
const hostile = JSON.parse(raw.replace('"provider": "anthropic",', '"provider": "anthropic", "__proto__": {"polluted": true},'))
const polluted = parseRegistry(hostile)
check('a "__proto__" key in an entry is just an unknown field', polluted.ok && polluted.problems.some((p) => /unknown field "__proto__"/.test(p)) && polluted.registry.models.length === 5, polluted.ok ? probs(polluted) : errOf(polluted))
check('...and nothing was polluted', ({}).polluted === undefined && Object.prototype.polluted === undefined)
const rootHostile = parseRegistry(JSON.parse('{"__proto__": {"x": 1}, "schemaVersion": "0.5"}'))
check('a "__proto__" key at the top level is refused', !rootHostile.ok)
const t1 = Date.now()
r = parseRegistry({ ...clone(fileJson), models: [entry({ label: 'x'.repeat(1_000_000), description: 'y'.repeat(1_000_000), id: 'z'.repeat(1_000_000) })] })
check('a megabyte in every text field is refused quickly, and not echoed back whole', !r.ok && Date.now() - t1 < 200 && r.problems.every((p) => p.length < 200), `${Date.now() - t1} ms, longest problem ${Math.max(0, ...r.problems.map((p) => p.length))} chars`)
check('a 500-character id is cut to 64 characters inside the problem text', (() => { const x = parseRegistry({ ...clone(fileJson), models: [entry(), entry({ id: 'q'.repeat(500) })] }); return x.ok && x.problems[0].includes('q'.repeat(64)) && !x.problems[0].includes('q'.repeat(65)) && x.problems[0].length < 250 })())
check('an object with no prototype is handled like any other', parseRegistry(Object.assign(Object.create(null), clone(fileJson))).ok)

// ============ 5. what the page is told ============
const opt = toModelOption(by['claude-opus-5-5'] ?? entry())
check('toModelOption: exactly id, label, provider, description, contextWindow, pricing, and (since 9.3) whether it reads images and PDFs', Object.keys(opt).sort().join() === 'contextWindow,description,documentInput,id,imageInput,label,pricing,provider', Object.keys(opt).join())
check('toModelOption: the provider is its id ("anthropic"); the page takes the name from the settings status (D-020)', opt.provider === 'anthropic')
check('toModelOption: nothing about how the model is called (no effort, no output limit, no provider id)', !/effort|maxOutputTokens/.test(JSON.stringify(opt)) && !('effort' in opt) && !('maxOutputTokens' in opt))
const e1 = entry(); const o1 = toModelOption(e1); o1.pricing.inputPerMTok = 777
check('toModelOption: pricing is a copy', e1.pricing.inputPerMTok === 4)

// ============ 6. the model choice from the page ============
const options = (out.ok ? out.registry.models : []).map(toModelOption)
const choice = (v) => V.checkModelChoice(v, options)
for (const id of ids) check(`choice accepted: ${id}`, choice(id).ok && choice(id).modelId === id)
check('choice: the id handed back is the registry\'s own string', (() => { const c = choice('claude-opus-5-5'); return c.ok && c.modelId === options[1].id })())
for (const [name, v] of [['a trailing space', 'claude-opus-5-5 '], ['upper case', 'CLAUDE-OPUS-5-5'], ['an unknown id', 'claude-opus-9'], ['empty', ''], ['__proto__', '__proto__'], ['constructor', 'constructor'], ['toString', 'toString'], ['a prefix of a real id', 'claude-opus'], ['null', null], ['undefined', undefined], ['a number', 5], ['an object', {}], ['an array holding a real id', ['claude-opus-5-5']], ['an object whose toString returns a real id', { toString: () => 'claude-opus-5-5' }], ['an object whose toString throws', { toString() { throw new Error('should never be called') } }], ['a 1 MB string', 'x'.repeat(1_000_000)]]) {
  let result
  try { result = choice(v) } catch (e) { result = { threw: String(e) } }
  check(`choice refused: ${name}`, result.ok === false && !result.threw, JSON.stringify(result).slice(0, 100))
}
check('choice refused when there are no models on offer', V.checkModelChoice('claude-opus-5-5', []).ok === false)
check('choice: error text is plain and never echoes the input', (() => { const c = choice('secret-looking-' + 'x'.repeat(30)); return !c.ok && !c.error.includes('secret-looking') })())


// ============ 7. capabilities and the effort rules (Stage 5.2) ============
const caps = (over = {}) => ({ ...clone(entry().capabilities), ...over })
const left = (name, over, pattern) => {
  const x = parseRegistry({ ...clone(fileJson), models: [entry(), entry({ id: 'second-model', ...over })] })
  check(`entry left out: ${name}`, x.ok && x.registry.models.length === 1 && x.problems.length === 1 && pattern.test(x.problems[0]), x.ok ? probs(x) : errOf(x))
}
const FIVE = ['low', 'medium', 'high', 'xhigh', 'max']
check('the real file: Fable, Opus and Sonnet list all five levels (low to max), and think by themselves', ['claude-fable-5-1', 'claude-opus-5-5', 'claude-sonnet-5-5'].every((id) => JSON.stringify(by[id]?.capabilities.effortLevels) === JSON.stringify(FIVE) && by[id].capabilities.reasoning === true))
check('the real file: Claude Haiku 4.5 is no longer listed (D-036), so every model in it lists effort levels; an entry with none is still accepted (the fixture checks above)', !('claude-haiku-4-5-20251001' in by) && Object.values(by).every((m) => m.capabilities.effortLevels.length > 0))
check('the real file: every model reads images and PDFs, calls tools and can cache the start of a conversation', Object.values(by).every((m) => m.capabilities.imageInput && m.capabilities.documentInput && m.capabilities.toolUse && m.capabilities.promptCaching))
check('the real file: every picked effort is one of the model\'s own levels, and null exactly when there are none', Object.values(by).every((m) => (m.effort === null) === (m.capabilities.effortLevels.length === 0) && (m.effort === null || m.capabilities.effortLevels.includes(m.effort))))
check('capabilities has exactly six fields (documentInput since 9.3)', Object.values(by).every((m) => Object.keys(m.capabilities).sort().join() === 'documentInput,effortLevels,imageInput,promptCaching,reasoning,toolUse'))
check('a clean copy: changing the input\'s effortLevels afterwards changes nothing', (() => { const f = clone(fileJson); const x = parseRegistry(f); f.models[1].capabilities.effortLevels.push('none'); f.models[1].capabilities.imageInput = false; return x.ok && x.registry.models[1].capabilities.effortLevels.length === 5 && x.registry.models[1].capabilities.imageInput === true })())
check('the provider has its own effort words, and "none" is not an Anthropic one', JSON.stringify(R.PROVIDER_EFFORTS.anthropic) === JSON.stringify(FIVE) && R.EFFORT_LEVELS.includes('none') && Object.keys(R.PROVIDER_EFFORTS).join() === R.SUPPORTED_PROVIDERS.join())

for (const [name, v] of [['null', null], ['a number', 5], ['a string', 'all'], ['an array', []], ['undefined', undefined]]) {
  left(`capabilities is ${name}`, { capabilities: v }, /capabilities must be an object|field "capabilities" missing/)
}
{
  const e = entry({ id: 'second-model' }); delete e.capabilities
  const x = parseRegistry({ ...clone(fileJson), models: [entry(), e] })
  check('entry left out: capabilities missing altogether is reported as a missing field', x.ok && /field "capabilities" missing/.test(x.problems[0] ?? ''), x.ok ? probs(x) : errOf(x))
}
for (const flag of ['imageInput', 'documentInput', 'toolUse', 'reasoning', 'promptCaching', 'effortLevels']) {
  const c = caps(); delete c[flag]
  left(`capabilities lacks "${flag}"`, { capabilities: c }, /capabilities must have exactly/)
}
left('capabilities has an extra field', { capabilities: caps({ vision: true }) }, /capabilities must have exactly/)
{
  const c = caps(); c.imagInput = c.imageInput; delete c.imageInput
  left('a misspelt capability (imagInput) is an error, not a flag that is quietly false', { capabilities: c }, /capabilities must have exactly/)
}
for (const flag of ['imageInput', 'toolUse', 'reasoning', 'promptCaching']) {
  for (const [name, v] of [['a string', 'true'], ['a number', 1], ['null', null], ['undefined', undefined], ['an array', [true]]]) {
    left(`${flag} is ${name}`, { capabilities: caps({ [flag]: v }) }, new RegExp(`capabilities\\.${flag} must be true or false`))
  }
}
for (const [name, v] of [['not a list', 'low'], ['null', null], ['an object', {}], ['six words (too many for Anthropic)', ['low', 'medium', 'high', 'xhigh', 'max', 'low']]]) {
  left(`effortLevels is ${name}`, { capabilities: caps({ effortLevels: v }) }, /capabilities\.effortLevels must be a list of at most 5 effort levels/)
}
for (const [name, v] of [['"none" (Anthropic has none)', ['none', 'low']], ['"minimal"', ['minimal']], ['upper case', ['LOW']], ['a number', [1]], ['null', [null]], ['an object', [{}]]]) {
  left(`effortLevels names ${name}`, { capabilities: caps({ effortLevels: v }), effort: 'low' }, /capabilities\.effortLevels: .* is not an effort level anthropic knows/)
}
left('effortLevels names a level twice', { capabilities: caps({ effortLevels: ['low', 'low'] }), effort: 'low' }, /capabilities\.effortLevels names "low" twice/)
left('effort is null, though the model lists levels (the level is never guessed)', { effort: null }, /effort is null, but capabilities\.effortLevels is not empty/)
left('effort is set, though the model lists no levels', { capabilities: caps({ effortLevels: [] }), effort: 'medium' }, /effort is set, but capabilities\.effortLevels is empty/)
left('effort is a level the model does not list', { capabilities: caps({ effortLevels: ['low', 'medium'] }), effort: 'high' }, /effort "high" is not one of this model's capabilities\.effortLevels/)
left('the model lists effort levels but is said not to think', { capabilities: caps({ reasoning: false }) }, /capabilities\.effortLevels is not empty, but capabilities\.reasoning is false/)
check('accepted: levels in any order, and a subset of what the provider knows', (() => { const x = parseRegistry({ ...clone(fileJson), models: [entry({ capabilities: caps({ effortLevels: ['max', 'low'] }), effort: 'max' })] }); return x.ok && JSON.stringify(x.registry.models[0].capabilities.effortLevels) === '["max","low"]' })())
check('accepted: a model that thinks by itself but takes no effort setting', parseRegistry({ ...clone(fileJson), models: [entry({ capabilities: caps({ effortLevels: [] }), effort: null })] }).ok)
check('accepted: a model that does not think and takes no effort', parseRegistry({ ...clone(fileJson), models: [entry({ capabilities: caps({ effortLevels: [], reasoning: false }), effort: null })] }).ok)
check('accepted: every flag false (a plain text model)', parseRegistry({ ...clone(fileJson), models: [entry({ capabilities: { imageInput: false, documentInput: false, toolUse: false, reasoning: false, promptCaching: false, effortLevels: [] }, effort: null })] }).ok)
{
  const x = parseRegistry({ ...clone(fileJson), models: [entry(), entry({ id: 'second-model', capabilities: caps({ effortLevels: ['low', 'bad'] }), effort: 'low' }), entry({ id: 'third-model' })] })
  check('one entry with bad capabilities is left out and the others stay, named by position and id', x.ok && x.registry.models.length === 2 && x.problems.length === 1 && x.problems[0].startsWith('models[1] ("second-model"): capabilities.effortLevels'), x.ok ? probs(x) : errOf(x))
}
check('toModelOption tells the page nothing about capabilities or effort but the two flags it needs for files (9.3): imageInput and documentInput, as booleans', (() => { const o = toModelOption(by['claude-opus-5-5'] ?? entry()); return !/capabilit|effortLevels|toolUse|reasoning|promptCaching/.test(JSON.stringify(o)) && o.imageInput === true && o.documentInput === true })())

const passed = check.summary()
process.exit(passed ? 0 : 1)
