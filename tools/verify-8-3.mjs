// Slice 8.3 under plain Node (no window): the question before a very large request (D-032). What the estimate is (a request's input at the dearer of the
// two input prices, a reply as long as the request's own ceiling lets it be), when the question is asked (what a request SENDS could cost more than the
// person's amount; exactly at the amount goes; "Never ask" never asks), what is typed and what the page may hand over, what ask-first.json holds and how
// a damaged one is read (as the DEFAULT, never as "Never ask"), the file store (missing, damaged, unreadable, a save that fails), the waiting room that
// holds a question until the person answers (an early, late or repeated yes is dropped; a stop or a closed window declines), the way the amounts are
// written for the person (rounded UP, rows that add up), and the few things the source must keep true (the question comes before the ledger and before
// the provider; the limits are read again after the wait; the page cannot give a yes ahead of time).
// Every file check runs in a normal folder and in the EFS-encrypted %APPDATA% (D-010).
// Run: node tools/verify-8-3.mjs
import { REPO, REPO_URL } from './paths.mjs'
import './ts-resolve.mjs'
import { checker } from './cdp.mjs'
import { promises as fsp, readFileSync, readdirSync, statSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { getEventListeners } from 'node:events'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { scratch } from './drive.mjs'

const check = checker()
const SRC = `${REPO_URL}/src`
const A = await import(`${SRC}/shared/askFirst.ts`)
const storeMod = await import(`${SRC}/main/askFirst.ts`)
const roomMod = await import(`${SRC}/main/confirmation.ts`)
const formatMod = await import(`${SRC}/renderer/src/settings/format.ts`)
const validateMod = await import(`${SRC}/shared/validate.ts`)
const usageMod = await import(`${SRC}/shared/usage.ts`)
const requestMod = await import(`${SRC}/main/providers/request.ts`)
const limitsMod = await import(`${SRC}/shared/limits.ts`)
const { ASK_FIRST_DEFAULT_USD, askFirstAmount, sameAskFirst, defaultAskFirst, estimateRequest, needsConfirmation, parseAskFirstText, checkAskFirstChoice, askFirstFileText, parseAskFirstFile } = A
const { createAskFirstStore } = storeMod
const { createConfirmations } = roomMod
const { largeRequestFigures } = formatMod
const { checkChatRequest } = validateMod
const { estimateInputTokens } = usageMod
const { buildStreamRequest, MAX_REPLY_TOKENS } = requestMod
const { LIMIT_MAX_USD } = limitsMod

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
// A sabotaged module can make a block throw; that must show as a failed check and a summary line, not as a crashed run (tools/README.md).
const guard = async (name, fn) => { try { await fn() } catch (error) { check(`${name} did not run to its end: ${String(error?.message ?? error).slice(0, 160)}`, false) } }
const usd = (n) => ({ kind: 'usd', usd: n })
const NEVER = { kind: 'never' }
const DEFAULT = { kind: 'default' }
const registry = JSON.parse(readFileSync(join(REPO, 'registry', 'models.json'), 'utf8'))
const models = registry.models
const byId = (id) => models.find((m) => m.id === id)
const FABLE = byId('claude-fable-5-1').pricing
const OPUS = byId('claude-opus-5-5').pricing
const close = (a, b) => Math.abs(a - b) < 1e-9

// ============ A. the estimate ============
await guard('block A', async () => {
  check('the default amount is $0.50 (a number of the app\'s own, so it is pinned here, and D-032 and Settings say it)', ASK_FIRST_DEFAULT_USD === 0.5)
  check('askFirstAmount: nothing chosen is the default amount, "Never ask" is none, an amount is itself', askFirstAmount(DEFAULT) === 0.5 && askFirstAmount(NEVER) === null && askFirstAmount(usd(2)) === 2 && askFirstAmount(usd(0.01)) === 0.01)
  check('defaultAskFirst: nothing chosen, and a new object every time', same(defaultAskFirst(), DEFAULT) && defaultAskFirst() !== defaultAskFirst())
  check('sameAskFirst: kind and amount both count', sameAskFirst(usd(1), usd(1)) && !sameAskFirst(usd(1), usd(2)) && !sameAskFirst(usd(0.5), DEFAULT) && !sameAskFirst(NEVER, DEFAULT) && sameAskFirst(NEVER, NEVER) && sameAskFirst(DEFAULT, defaultAskFirst()) && !sameAskFirst(usd(1), NEVER))

  // each of the six models, a million tokens in and the 16,000-token ceiling out: the input at the dearer of its two input prices
  const expected = {
    'claude-fable-5-1': { input: 12.5, output: 0.8 },
    'claude-opus-5-5': { input: 5, output: 0.32 },
    'claude-sonnet-5-5': { input: 2.5, output: 0.16 },
    'gpt-6-astra': { input: 12.5, output: 0.8 },
    'gpt-6.1-sol': { input: 2.5, output: 0.16 },
    'gpt-6-luna': { input: 0.125, output: 0.008 }
  }
  check('the registry holds exactly the six models this suite knows (Claude Haiku 4.5 was removed on 2026-10-06, D-036)', same(models.map((m) => m.id).sort(), Object.keys(expected).sort()), models.map((m) => m.id).join(','))
  for (const model of models) {
    const want = expected[model.id]
    if (!want) continue
    const e = estimateRequest(1_000_000, 16_000, model.pricing)
    check(`estimateRequest, ${model.label}: a million tokens in at the dearer input price ($${want.input}), the 16,000-token ceiling out ($${want.output}), and the two added`, close(e.inputUsd, want.input) && close(e.outputUsd, want.output) && close(e.totalUsd, want.input + want.output) && e.inputTokens === 1_000_000 && e.outputTokens === 16_000, JSON.stringify(e))
    check(`estimateRequest, ${model.label}: the input is never shown below the ordinary input price, and the cache-write price is never below it either`, e.inputUsd >= model.pricing.inputPerMTok - 1e-12 && model.pricing.cacheWritePerMTok >= model.pricing.inputPerMTok)
  }
  check('estimateRequest: nothing in is nothing in, and a reply is still priced', (() => { const e = estimateRequest(0, 16_000, OPUS); return e.inputUsd === 0 && close(e.outputUsd, 0.32) && close(e.totalUsd, 0.32) })())
  check('estimateRequest: the ceiling given is the one priced (4,000 tokens at $20 a million is $0.08)', close(estimateRequest(10, 4_000, OPUS).outputUsd, 0.08))
  check('estimateRequest: a price where the cache write is DEARER than the input uses the write price, and one where it is not uses the input price', close(estimateRequest(1_000_000, 0, { inputPerMTok: 4, cacheReadPerMTok: 0.2, cacheWritePerMTok: 5, outputPerMTok: 20 }).inputUsd, 5) && close(estimateRequest(1_000_000, 0, { inputPerMTok: 6, cacheReadPerMTok: 0.2, cacheWritePerMTok: 5, outputPerMTok: 20 }).inputUsd, 6))

  // the ceiling comes from the request that is really built (a model that cannot write 16,000 tokens gets its own, lower one)
  const abort = new AbortController()
  const built = (model) => buildStreamRequest({ credentials: { apiKey: 'x' }, model, messages: [{ role: 'user', content: 'hi' }], signal: abort.signal })
  check('the ceiling that is priced is the request\'s own: 16,000 for the registry\'s models', models.every((m) => built(m).maxOutputTokens === Math.min(MAX_REPLY_TOKENS, m.maxOutputTokens)) && MAX_REPLY_TOKENS === 16_000)
  check('...and a model that can only write 4,000 tokens has a ceiling of 4,000', built({ ...models[0], maxOutputTokens: 4_000 }).maxOutputTokens === 4_000)
  // the guess is the ledger's guess: the same function
  const request = built(models[0])
  check('the input guess is estimateInputTokens of the request\'s system prompt and messages (what the ledger counts)', estimateInputTokens(request.system, request.messages) > 0 && Number.isInteger(estimateInputTokens(request.system, request.messages)))

  // where the default $0.50 begins to ask, per model (D-032 quotes these)
  const startsAbove = (model) => Math.floor(500_000 / Math.max(model.pricing.inputPerMTok, model.pricing.cacheWritePerMTok))
  const begins = Object.fromEntries(models.map((m) => [m.id, startsAbove(m)]))
  check('the default asks above 40,000 tokens on Fable 5.1 and GPT-6 Astra, 100,000 on Opus 5.5, 200,000 on Sonnet 5.5 and GPT-6.1 Sol, 4,000,000 on GPT-6 Luna', begins['claude-fable-5-1'] === 40_000 && begins['gpt-6-astra'] === 40_000 && begins['claude-opus-5-5'] === 100_000 && begins['claude-sonnet-5-5'] === 200_000 && begins['gpt-6.1-sol'] === 200_000 && begins['gpt-6-luna'] === 4_000_000 && Object.keys(begins).length === 6, JSON.stringify(begins))
  // The comparison is made in millionths of a dollar (a token at $1 a million is one), so a token on the cheapest model, which is an eighth of one, cannot
  // tip it: "more than" means at least a millionth of a dollar more. The first token count that asks is therefore at most 8 tokens above the amount.
  for (const model of models) {
    const at = needsConfirmation(DEFAULT, estimateRequest(startsAbove(model), 16_000, model.pricing))
    let firstAsked = null
    for (let extra = 1; extra <= 16 && firstAsked === null; extra += 1) {
      if (needsConfirmation(DEFAULT, estimateRequest(startsAbove(model) + extra, 16_000, model.pricing))) firstAsked = extra
    }
    check(`default amount, ${model.label}: ${startsAbove(model).toLocaleString('en-US')} tokens goes without a question, and a millionth of a dollar more (at most 8 tokens more) asks`, at === false && firstAsked !== null && firstAsked <= 8, String(firstAsked))
  }

  // the biggest request the app lets through (CHAT_LIMITS: 600,000 characters of messages, 8,000 of instructions): what it could cost on each model
  const biggest = estimateInputTokens('x'.repeat(900) + 'y'.repeat(8_000), [{ content: 'a'.repeat(600_000) }, ...Array.from({ length: 499 }, () => ({ content: '' }))])
  const worst = models.map((m) => ({ id: m.id, ...estimateRequest(biggest, Math.min(MAX_REPLY_TOKENS, m.maxOutputTokens), m.pricing) }))
  const dearest = worst.reduce((a, b) => (b.totalUsd > a.totalUsd ? b : a))
  check(`the dearest request the app can make today is on ${dearest.id} and could cost about $${dearest.totalUsd.toFixed(2)} (D-032 says $3.4: about $2.6 to send and $0.80 to reply)`, dearest.id === 'claude-fable-5-1' || dearest.id === 'gpt-6-astra' ? dearest.totalUsd > 3.3 && dearest.totalUsd < 3.5 : false, JSON.stringify(dearest))
})

// ============ B. when the question is asked ============
await guard('block B', async () => {
  const E = (inputUsd, outputUsd = 0.8) => ({ inputTokens: 1, inputUsd, outputTokens: 16_000, outputUsd, totalUsd: inputUsd + outputUsd })
  for (const [name, setting, inputUsd, expected] of [
    ['nothing chosen, exactly the default amount', DEFAULT, 0.5, false],
    ['nothing chosen, a millionth of a dollar above it', DEFAULT, 0.500001, true],
    ['nothing chosen, a cent below it', DEFAULT, 0.49, false],
    ['nothing chosen, far above it', DEFAULT, 100, true],
    ['nothing chosen, a request that sends nothing', DEFAULT, 0, false],
    ['a $2 amount, exactly at it', usd(2), 2, false],
    ['a $2 amount, a millionth above it', usd(2), 2.000001, true],
    ['a $2 amount, a cent above it', usd(2), 2.01, true],
    ['a $0.01 amount (the least), a request that costs a cent', usd(0.01), 0.01, false],
    ['a $0.01 amount, a request that costs two cents', usd(0.01), 0.02, true],
    ['an amount of $10,000 (the most), the dearest request there is', usd(10_000), 3.5, false],
    ['float noise: 0.1 + 0.2 against $0.30 is exactly at it', usd(0.3), 0.1 + 0.2, false],
    ['float noise: 0.07 * 3 against $0.21 is exactly at it', usd(0.21), 0.07 * 3, false],
    ['"Never ask", a small request', NEVER, 0.01, false],
    ['"Never ask", a huge request', NEVER, 10_000, false],
    ['"Never ask", a request that could cost $1,000,000', NEVER, 1_000_000, false]
  ]) {
    check(`needsConfirmation: ${name}: ${expected ? 'asks' : 'does not ask'}`, needsConfirmation(setting, E(inputUsd)) === expected)
  }
  check('needsConfirmation: it is the INPUT that decides, not the reply: a huge reply ceiling with a small input does not ask', needsConfirmation(DEFAULT, E(0.01, 50)) === false && needsConfirmation(DEFAULT, E(0.6, 0)) === true)
  check('needsConfirmation: it answers a boolean', typeof needsConfirmation(DEFAULT, E(1)) === 'boolean' && typeof needsConfirmation(NEVER, E(1)) === 'boolean')
})

// ============ C. what is typed ============
await guard('block C', async () => {
  for (const [text, expected] of [['0.50', 0.5], ['.5'.padStart(3, '0'), 0.5], ['2', 2], ['2.0', 2], ['$12.50', 12.5], ['$ 3', 3], [' 7 ', 7], ['0.01', 0.01], ['10000', 10000], ['10000.00', 10000], ['9999.99', 9999.99], ['000012', 12], ['0.1', 0.1], ['$0.10', 0.1]]) {
    const r = parseAskFirstText(text)
    check(`parseAskFirstText: ${JSON.stringify(text)} is ${expected}`, r.ok && r.usd === expected, JSON.stringify(r))
  }
  for (const [name, text] of [['empty', ''], ['spaces', '   '], ['zero', '0'], ['zero with cents', '0.00'], ['a dot only', '.'], ['nothing before the dot', '.5'], ['nothing after the dot', '5.'], ['three decimals', '0.505'], ['a comma for the decimal point', '0,5'], ['a thousands comma', '1,000'], ['a minus sign', '-1'], ['a plus sign', '+1'], ['words', 'one'], ['a unit after', '1 dollar'], ['US$', 'US$1'], ['an exponent', '1e3'], ['hex', '0x10'], ['more than the most', '10001'], ['a huge number', '99999999999'], ['seven digits', '1000000'], ['two dollar signs', '$$5'], ['a line break inside', '5\n5'], ['Infinity', 'Infinity'], ['NaN', 'NaN'], ['the word never', 'never']]) {
    const r = parseAskFirstText(text)
    check(`parseAskFirstText: ${name} (${JSON.stringify(text)}) is refused with a sentence`, !r.ok && typeof r.error === 'string' && r.error.length > 10, JSON.stringify(r))
  }
  check('parseAskFirstText: an empty box says to type an amount or choose Never ask', (() => { const r = parseAskFirstText(''); return !r.ok && /Never ask/.test(r.error) })())
  check('parseAskFirstText: too much says what the most is and points to "Never ask" (not to "No limit": this is not a limit)', (() => { const r = parseAskFirstText('10001'); return !r.ok && r.error.includes('$10,000') && /Never ask/.test(r.error) && !/No limit/.test(r.error) && !/limit/i.test(r.error) })(), JSON.stringify(parseAskFirstText('10001')))
  check('parseAskFirstText: zero says the amount must be more than $0 (and does not call it a limit)', (() => { const r = parseAskFirstText('0'); return !r.ok && /more than \$0/.test(r.error) && !/limit/i.test(r.error) })())
  check('parseAskFirstText: the most is the same as a spending limit\'s (10,000)', LIMIT_MAX_USD === 10_000 && parseAskFirstText('10000').ok && !parseAskFirstText('10000.01').ok)
})

// ============ D. what the page may hand over ============
await guard('block D', async () => {
  const good = [[{ kind: 'never' }, NEVER], [{ kind: 'usd', usd: 0.5 }, usd(0.5)], [{ kind: 'usd', usd: 0.01 }, usd(0.01)], [{ kind: 'usd', usd: 10_000 }, usd(10_000)], [{ kind: 'usd', usd: 12.34 }, usd(12.34)]]
  for (const [input, expected] of good) {
    const r = checkAskFirstChoice(input)
    check(`checkAskFirstChoice: ${JSON.stringify(input)} is accepted as ${JSON.stringify(expected)}`, r.ok && same(r.choice, expected), JSON.stringify(r))
  }
  const bad = [
    ['nothing', undefined], ['null', null], ['a number', 5], ['a string', 'never'], ['an array', [{ kind: 'never' }]], ['an empty object', {}],
    ['the kind "default" (the page cannot take a choice back to nothing)', { kind: 'default' }], ['the kind "unset"', { kind: 'unset' }], ['the kind "none"', { kind: 'none' }],
    ['the kind "NEVER" in capitals', { kind: 'NEVER' }], ['an amount of zero', { kind: 'usd', usd: 0 }], ['a negative amount', { kind: 'usd', usd: -1 }],
    ['a fraction of a cent', { kind: 'usd', usd: 0.001 }], ['half a cent over a cent', { kind: 'usd', usd: 0.015 }], ['more than the most', { kind: 'usd', usd: 10_000.01 }],
    ['NaN', { kind: 'usd', usd: NaN }], ['Infinity', { kind: 'usd', usd: Infinity }], ['an amount as text', { kind: 'usd', usd: '5' }], ['an amount that prints as a number', { kind: 'usd', usd: { valueOf: () => 5 } }],
    ['no amount', { kind: 'usd' }], ['a null amount', { kind: 'usd', usd: null }], ['an amount in an array', { kind: 'usd', usd: [5] }], ['a boolean amount', { kind: 'usd', usd: true }],
    ['a kind that is an object', { kind: { toString: () => 'never' } }], ['a kind of "usd " with a space', { kind: 'usd ', usd: 5 }]
  ]
  for (const [name, input] of bad) {
    const r = checkAskFirstChoice(input)
    check(`checkAskFirstChoice: ${name} is refused with a sentence`, !r.ok && typeof r.error === 'string' && r.error.length > 5, JSON.stringify(r))
  }
  const withExtras = { kind: 'usd', usd: 5, evil: '<b>x</b>', other: 1, __proto__: { polluted: true } }
  const r = checkAskFirstChoice(withExtras)
  check('checkAskFirstChoice: what comes back is main\'s own object with the one amount, and nothing else the page carried', r.ok && same(Object.keys(r.choice).sort(), ['kind', 'usd']) && r.choice !== withExtras && r.choice.polluted === undefined)
  const never = checkAskFirstChoice({ kind: 'never', usd: 3, extra: 1 })
  check('checkAskFirstChoice: "never" keeps nothing else it carries (no amount)', never.ok && same(never.choice, NEVER) && Object.keys(never.choice).length === 1)
  check('checkAskFirstChoice: a getter that throws is not run past the check (it is read once, and a throw is the caller\'s: not a yes)', (() => { try { const input = { kind: 'usd', get usd() { return 5 } }; return checkAskFirstChoice(input).ok === true } catch { return false } })())
})

// ============ E. the file ============
await guard('block E', async () => {
  check('askFirstFileText: nothing chosen writes the version only', askFirstFileText(DEFAULT) === '{"version":1}')
  check('askFirstFileText: an amount is written as a number a person can read', askFirstFileText(usd(0.5)) === '{"version":1,"above":0.5}' && askFirstFileText(usd(12.34)) === '{"version":1,"above":12.34}')
  check('askFirstFileText: "Never ask" is written as the word', askFirstFileText(NEVER) === '{"version":1,"above":"never"}')
  for (const setting of [DEFAULT, NEVER, usd(0.5), usd(0.01), usd(10_000), usd(12.34), usd(7)]) {
    const r = parseAskFirstFile(askFirstFileText(setting))
    check(`parseAskFirstFile reads back what askFirstFileText wrote: ${JSON.stringify(setting)}`, same(r.setting, setting) && r.damaged === false, JSON.stringify(r))
  }
  const damaged = [
    ['text that is not JSON', 'hello'], ['an empty file (a write cut off at once)', ''], ['spaces only', '   '], ['a file cut off in the middle', '{"version":1,"above":"nev'],
    ['the wrong version', '{"version":9,"above":"never"}'], ['no version', '{"above":"never"}'], ['a version that is text', '{"version":"1","above":"never"}'],
    ['an array', '[1,2]'], ['null', 'null'], ['a number', '5'], ['a string', '"never"'],
    ['"Never" in capitals', '{"version":1,"above":"Never"}'], ['"NEVER" in capitals', '{"version":1,"above":"NEVER"}'], ['"never " with a space', '{"version":1,"above":"never "}'],
    ['"none" (the spelling of a spending limit, not of this)', '{"version":1,"above":"none"}'], ['"off"', '{"version":1,"above":"off"}'], ['false', '{"version":1,"above":false}'],
    ['zero', '{"version":1,"above":0}'], ['a negative amount', '{"version":1,"above":-1}'], ['a fraction of a cent', '{"version":1,"above":0.001}'], ['too much', '{"version":1,"above":10000.01}'],
    ['an amount as text', '{"version":1,"above":"5"}'], ['null', '{"version":1,"above":null}'], ['an object', '{"version":1,"above":{"kind":"never"}}'], ['an array', '{"version":1,"above":["never"]}'], ['true', '{"version":1,"above":true}']
  ]
  for (const [name, text] of damaged) {
    const r = parseAskFirstFile(text)
    check(`parseAskFirstFile: ${name} holds no choice (the default applies), is damaged, and is NOT "Never ask"`, same(r.setting, DEFAULT) && r.damaged === true, JSON.stringify(r))
  }
  check('parseAskFirstFile: a file with the version and no amount is nothing chosen, and not damaged', (() => { const r = parseAskFirstFile('{"version":1}'); return same(r.setting, DEFAULT) && r.damaged === false })())
  check('parseAskFirstFile: a field it does not know is ignored (a later version may add some)', same(parseAskFirstFile('{"version":1,"above":2,"later":true}').setting, usd(2)))
  // damage can never turn the question off: every cut of the "never" file, short of the whole of it, reads as the default
  const never = askFirstFileText(NEVER)
  let cutsAllDefault = true
  for (let n = 0; n < never.length; n += 1) {
    const r = parseAskFirstFile(never.slice(0, n))
    if (r.setting.kind === 'never') cutsAllDefault = false
  }
  check(`parseAskFirstFile: all ${never.length} cut-off copies of the "Never ask" file read as the default, never as "Never ask"`, cutsAllDefault)
  check('parseAskFirstFile: ...and the whole file still reads as "Never ask"', parseAskFirstFile(never).setting.kind === 'never')
})

// ============ F. the file store ============
for (const [where, base] of [['tmp', join(tmpdir(), `frontier-v83-${randomUUID()}`)], ['EFS', join(scratch('v83'), randomUUID())]]) {
  const T_ = (name) => `${name} [${where}]`
  await fsp.mkdir(base, { recursive: true })
  let n = 0
  const folder = () => join(base, `case-${++n}`)
  const askPath = (dir) => join(dir, 'ask-first.json')
  const makeStore = (dir) => createAskFirstStore(() => askPath(dir))
  const exists = async (file) => fsp.stat(file).then(() => true, () => false)
  const refusalOf = async (promise) => { try { await promise; return null } catch (error) { return error } }
  const originalWarn = console.warn
  const originalError = console.error
  const said = { warn: [], error: [] }
  const quiet = async (task) => { console.warn = (...args) => said.warn.push(args.join(' ')); console.error = (...args) => said.error.push(args.join(' ')); try { return await task() } finally { console.warn = originalWarn; console.error = originalError } }

  await guard('block F1', async () => {
    const dir = folder()
    await fsp.mkdir(dir, { recursive: true })
    const store = makeStore(dir)
    check(T_('store: no file means nothing chosen (the default), and reading does not create one'), same(await store.read(), DEFAULT) && !(await exists(askPath(dir))))
    await store.save(usd(2))
    check(T_('store: save writes the plain file a person can read'), readFileSync(askPath(dir), 'utf8') === '{"version":1,"above":2}')
    check(T_('store: ...and read answers with what was saved'), same(await store.read(), usd(2)))
    check(T_('store: ...and a new store (a new run of the app) reads the same from the file'), same(await makeStore(dir).read(), usd(2)))
    await store.save(NEVER)
    check(T_('store: "Never ask" is written as the word, read back, and survives a new run'), readFileSync(askPath(dir), 'utf8') === '{"version":1,"above":"never"}' && same(await store.read(), NEVER) && same(await makeStore(dir).read(), NEVER))
    await store.save(usd(0.5))
    check(T_('store: a later save replaces it (an amount again), in the file and in memory'), readFileSync(askPath(dir), 'utf8') === '{"version":1,"above":0.5}' && same(await store.read(), usd(0.5)))
    const entries = readdirSync(dir)
    check(T_('store: no temp or backup file is left beside it'), same(entries, ['ask-first.json']), JSON.stringify(entries))
  })
  for (const [name, text, expected, logs] of [
    ['text that is not JSON', 'hello', DEFAULT, true],
    ['an empty file (a write cut off at once)', '', DEFAULT, true],
    ['a file cut off in the middle of "never"', '{"version":1,"above":"nev', DEFAULT, true],
    ['a file with a byte-order mark (an editor added it)', '﻿{"version":1,"above":3}', usd(3), false],
    ['a file with a byte-order mark and "never"', '﻿{"version":1,"above":"never"}', NEVER, false],
    ['an amount that is not an amount', '{"version":1,"above":-4}', DEFAULT, true],
    ['"Never" in capitals', '{"version":1,"above":"Never"}', DEFAULT, true],
    ['the wrong version', '{"version":9,"above":"never"}', DEFAULT, true],
    ['the version only', '{"version":1}', DEFAULT, false]
  ]) {
    const dir = folder()
    await fsp.mkdir(dir, { recursive: true })
    await fsp.writeFile(askPath(dir), text)
    said.warn.length = 0
    said.error.length = 0
    const got = await quiet(() => makeStore(dir).read())
    check(T_(`store: ${name}: read gives ${JSON.stringify(expected)}${logs ? ', and says so once in the log' : ''}`), same(got, expected) && said.warn.length === (logs ? 1 : 0) && said.error.length === 0, JSON.stringify([got, said]))
    check(T_(`store: ...and damage is never read as "Never ask" (${logs ? 'this file is damaged, and the default asks' : 'this file is whole'})`), logs ? got.kind !== 'never' : true)
  }
  await guard('block F2', async () => {
    // a file that cannot be read at all: a folder where the file should be. read does NOT throw (the question is still asked); the failure is not kept
    const dir = folder()
    await fsp.mkdir(askPath(dir), { recursive: true })
    const store = makeStore(dir)
    said.error.length = 0
    const got = await quiet(() => store.read())
    check(T_('store: a file that cannot be read at all (a folder in its place) is read as nothing chosen: read does NOT throw, so the question is still asked'), same(got, DEFAULT) && said.error.length === 1, JSON.stringify([got, said.error]))
    await fsp.rm(askPath(dir), { recursive: true })
    await fsp.writeFile(askPath(dir), '{"version":1,"above":9}')
    check(T_('store: ...and a failed read is not remembered: the next read tries again and hears the repaired file'), same(await store.read(), usd(9)))
    const noThrow = await refusalOf(makeStore(dir).read())
    check(T_('store: ...and a store over a good file does not throw either'), noThrow === null)
    // and saving over that folder says it could not
    const dir2 = folder()
    await fsp.mkdir(askPath(dir2), { recursive: true })
    const saveError = await refusalOf(makeStore(dir2).save(usd(1)))
    check(T_('store: a save with a folder in the file\'s place throws, and the folder is still a folder'), saveError instanceof Error && statSync(askPath(dir2)).isDirectory())
  })
  await guard('block F3', async () => {
    // a save that fails changes nothing
    const dir = folder()
    await fsp.mkdir(dir, { recursive: true })
    const store = makeStore(dir)
    await store.save(usd(1))
    const blocked = createAskFirstStore(() => join(askPath(dir), 'inside', 'ask-first.json')) // its parent is a file
    const saveError = await refusalOf(blocked.save(usd(2)))
    check(T_('store: a save that cannot be written throws'), saveError instanceof Error)
    check(T_('store: ...and the saved choice is as it was, in the file and in memory'), readFileSync(askPath(dir), 'utf8') === '{"version":1,"above":1}' && same(await store.read(), usd(1)))
    const after = await refusalOf(blocked.read())
    check(T_('store: ...and the store that could not save is still usable (its queue is not stuck)'), after === null)
  })
  await guard('block F4', async () => {
    // saves one at a time, the last one asked for wins
    const dir = folder()
    await fsp.mkdir(dir, { recursive: true })
    const store = makeStore(dir)
    await Promise.all(Array.from({ length: 20 }, (_, i) => store.save(usd(i + 1))))
    check(T_('store: 20 saves asked for at once are written in order: the last one is what is kept, in the file and in memory'), readFileSync(askPath(dir), 'utf8') === '{"version":1,"above":20}' && same(await store.read(), usd(20)))
    const mixed = await Promise.all([store.save(NEVER), store.read(), store.save(usd(7)), store.read()])
    check(T_('store: a read asked for between two saves sees the save before it, never half of one'), same(mixed[1], NEVER) && same(mixed[3], usd(7)), JSON.stringify(mixed.slice(1)))
  })
  await guard('block F5', async () => {
    // read once, kept: an edit made while the app runs is not heard until the next start
    const dir = folder()
    await fsp.mkdir(dir, { recursive: true })
    const store = makeStore(dir)
    await store.save(usd(5))
    await fsp.writeFile(askPath(dir), '{"version":1,"above":"never"}')
    check(T_('store: a change made to the file while the app runs is not heard (it is read once); the next start hears it'), same(await store.read(), usd(5)) && same(await makeStore(dir).read(), NEVER))
  })
  await guard('block F6', async () => {
    // the store makes the folder for the file
    const dir = join(folder(), 'deeper')
    await makeStore(dir).save(NEVER)
    check(T_('store: save makes the folder if it is not there yet'), statSync(askPath(dir)).isFile())
  })
  await fsp.rm(base, { recursive: true, force: true })
}

// ============ G. the waiting room ============
await guard('block G', async () => {
  const tick = () => new Promise((resolve) => setImmediate(resolve))
  // An answer that never comes (a sabotaged room) must fail a check, not hang the whole suite: every awaited answer goes through this.
  const TIMED_OUT = 'TIMED OUT'
  const within = (promise, ms = 1500) => Promise.race([promise, new Promise((resolve) => setTimeout(() => resolve(TIMED_OUT), ms))])
  const open = () => new AbortController()
  {
    const room = createConfirmations()
    const c = open()
    let shown = 0
    let waitingWhenShown = -1
    const answer = room.ask('1:a', c.signal, () => { shown += 1; waitingWhenShown = room.waiting() })
    check('waiting room: the question is shown once, and it is already waiting when it is shown', shown === 1 && waitingWhenShown === 1 && room.waiting() === 1)
    check('waiting room: a yes is heard and answers "send"', room.send('1:a') === true && (await within(answer)) === 'send' && room.waiting() === 0)
    check('waiting room: ...and a second yes finds nobody waiting and is dropped', room.send('1:a') === false && room.waiting() === 0)
    check('waiting room: ...and the stop button\'s signal, fired later, does nothing (the listener is gone)', getEventListeners(c.signal, 'abort').length === 0)
  }
  {
    // a yes that comes BEFORE the question exists is dropped, not remembered
    const room = createConfirmations()
    check('waiting room: a yes before any question is dropped (false)', room.send('1:b') === false)
    const c = open()
    let settled = false
    const answer = room.ask('1:b', c.signal, () => {}).then((a) => { settled = true; return a })
    await tick()
    check('waiting room: ...and it did not pre-approve the question that came after it: that one is still waiting', settled === false && room.waiting() === 1)
    c.abort()
    check('waiting room: ...until the stop button, which declines it', (await within(answer)) === 'decline' && room.waiting() === 0)
  }
  {
    // a stop while waiting declines, and a yes after it is dropped
    const room = createConfirmations()
    const c = open()
    const answer = room.ask('1:c', c.signal, () => {})
    c.abort()
    check('waiting room: a stop (or a window that goes away) while waiting declines the question', (await within(answer)) === 'decline' && room.waiting() === 0)
    check('waiting room: ...and a yes that arrives after it is dropped', room.send('1:c') === false)
    check('waiting room: ...and its listener is gone', getEventListeners(c.signal, 'abort').length === 0)
  }
  {
    // a signal that is already aborted declines at once and shows nothing
    const room = createConfirmations()
    const c = open()
    c.abort()
    let shown = false
    const answer = await within(room.ask('1:d', c.signal, () => { shown = true }))
    check('waiting room: a reply that was stopped before the question is not shown anything, and is declined', answer === 'decline' && shown === false && room.waiting() === 0)
  }
  {
    // the same key twice
    const room = createConfirmations()
    const c1 = open()
    const c2 = open()
    let shownSecond = false
    const first = room.ask('1:e', c1.signal, () => {})
    const second = await within(room.ask('1:e', c2.signal, () => { shownSecond = true }))
    check('waiting room: a second question under a key that is already waiting is declined at once and not shown', second === 'decline' && shownSecond === false && room.waiting() === 1)
    check('waiting room: ...and the first is still waiting and still answerable', room.send('1:e') === true && (await within(first)) === 'send')
    check('waiting room: ...and the second one\'s signal has no listener left', getEventListeners(c2.signal, 'abort').length === 0)
  }
  {
    // show throws
    const room = createConfirmations()
    const c = open()
    const answer = await within(room.ask('1:f', c.signal, () => { throw new Error('nobody to show it to') }))
    check('waiting room: a question that cannot be shown is declined (nothing is sent), and nothing is left waiting', answer === 'decline' && room.waiting() === 0 && getEventListeners(c.signal, 'abort').length === 0)
  }
  {
    // keys are kept apart: another window's yes, another stream's yes
    const room = createConfirmations()
    const a = open()
    const b = open()
    const first = room.ask('1:x', a.signal, () => {})
    const second = room.ask('2:x', b.signal, () => {})
    check('waiting room: a yes for another window\'s stream (same stream id, other window) is not heard here', room.send('3:x') === false && room.send('1:y') === false && room.waiting() === 2)
    room.send('2:x')
    check('waiting room: a yes answers only the question it names', (await within(second)) === 'send' && room.waiting() === 1)
    a.abort()
    check('waiting room: ...and the other is declined by its own stop', (await within(first)) === 'decline' && room.waiting() === 0)
  }
  {
    // yes and stop at the same moment: whichever comes first is the answer, once
    const room = createConfirmations()
    const c = open()
    const answer = room.ask('1:g', c.signal, () => {})
    room.send('1:g')
    c.abort()
    check('waiting room: a yes and then a stop: the answer stays "send" (resolved once)', (await within(answer)) === 'send' && room.waiting() === 0)
    const c2 = open()
    const answer2 = room.ask('1:h', c2.signal, () => {})
    c2.abort()
    check('waiting room: a stop and then a yes: the answer stays "decline", and the yes is dropped', room.send('1:h') === false && (await within(answer2)) === 'decline')
  }
  {
    // an answer given from inside show (the instant the question is put in front of anyone) is heard
    const room = createConfirmations()
    const c = open()
    let sendResult = null
    const answer = await within(room.ask('1:i', c.signal, () => { sendResult = room.send('1:i') }))
    check('waiting room: a yes given the very moment the question is shown is heard (the question is waiting before it is shown)', sendResult === true && answer === 'send')
  }
  {
    // many at once
    const room = createConfirmations()
    const controllers = Array.from({ length: 100 }, open)
    const answers = controllers.map((c, i) => room.ask(`9:${i}`, c.signal, () => {}))
    check('waiting room: 100 questions at once are all waiting', room.waiting() === 100)
    controllers.forEach((c, i) => { if (i % 2 === 0) room.send(`9:${i}`); else c.abort() })
    const settled = await within(Promise.all(answers), 4000)
    const results = settled === TIMED_OUT ? [] : settled
    check('waiting room: ...each is answered by its own yes or stop (50 send, 50 decline), and none is left waiting', results.filter((r) => r === 'send').length === 50 && results.filter((r) => r === 'decline').length === 50 && results.every((r, i) => r === (i % 2 === 0 ? 'send' : 'decline')) && room.waiting() === 0 && controllers.every((c) => getEventListeners(c.signal, 'abort').length === 0))
  }
})

// ============ H. how the amounts are written for the person ============
await guard('block H', async () => {
  const E = (inputUsd, outputUsd) => ({ inputTokens: 1, inputUsd, outputTokens: 1, outputUsd, totalUsd: inputUsd + outputUsd })
  for (const [inputUsd, outputUsd, input, output, total] of [
    [0.5000125, 0.8, '$0.51', '$0.80', '$1.31'],
    [0.5, 0.32, '$0.50', '$0.32', '$0.82'],
    [0.51, 0.8, '$0.51', '$0.80', '$1.31'],
    [0.57, 0.29, '$0.57', '$0.29', '$0.86'],
    [1.0625, 0.8, '$1.07', '$0.80', '$1.87'],
    [12.5, 0.8, '$12.50', '$0.80', '$13.30'],
    [2.5625, 0.8, '$2.57', '$0.80', '$3.37'],
    [0.0001, 0.008, '$0.01', '$0.01', '$0.02'],
    [0.011, 0.001, '$0.02', '$0.01', '$0.03'],
    [0, 0, '$0.00', '$0.00', '$0.00']
  ]) {
    const f = largeRequestFigures(E(inputUsd, outputUsd))
    check(`largeRequestFigures: ${inputUsd} and ${outputUsd} are shown as ${input}, ${output} and ${total} (rounded UP)`, f.input === input && f.output === output && f.total === total, JSON.stringify(f))
  }
  // a property: nothing is ever shown below what it is, never more than a cent above, and the rows add up
  let bad = null
  const dollars = (text) => Number(text.slice(1))
  for (let i = 0; i < 20_000; i += 1) {
    const inputUsd = Math.round(Math.random() * 40_000) / 10_000 + (i % 7 === 0 ? 0.00005 : 0)
    const outputUsd = Math.round(Math.random() * 9_000) / 10_000
    const f = largeRequestFigures(E(inputUsd, outputUsd))
    const rows = Math.round((dollars(f.input) + dollars(f.output)) * 100)
    if (dollars(f.input) < inputUsd - 1e-9 || dollars(f.input) - inputUsd >= 0.01 + 1e-9 || dollars(f.output) < outputUsd - 1e-9 || dollars(f.output) - outputUsd >= 0.01 + 1e-9 || Math.round(dollars(f.total) * 100) !== rows) { bad = { inputUsd, outputUsd, f }; break }
  }
  check('largeRequestFigures: for 20,000 random pairs nothing is shown below what it is or more than a cent above, and the total is the sum of the two rows', bad === null, JSON.stringify(bad))
})

// ============ I. the page cannot give a yes ahead of time; the source keeps the order ============
await guard('block I', async () => {
  const read = (path) => readFileSync(join(REPO, path), 'utf8')
  const request = { streamId: 'abcdefgh12', messages: [{ role: 'user', content: 'hello' }], confirmed: true, confirm: true, approved: true, yes: true, askFirst: 'never', skipConfirmation: true }
  const r = checkChatRequest(request)
  check('a chat request carries no field that could approve it ahead of time: whatever extra fields the page adds (confirmed, approved, askFirst...) are not kept', r.ok && same(Object.keys(r.request).sort(), ['messages', 'streamId']) && !('confirmed' in r.request), JSON.stringify(r))

  const chat = read('src/main/chat.ts')
  const run = chat.slice(chat.indexOf('async function runReply('), chat.indexOf('export function registerChatIpc'))
  const at = (needle, from = 0) => run.indexOf(needle, from)
  const iEstimate = at('estimateRequest(')
  const iAsk = at('confirmations.ask(')
  const iAfterAskRead = at('await readLimits()', iAsk)
  const iBegin = at('await ledger.begin(')
  const iStream = at('adapter.stream(')
  check('source: chat.ts works out the estimate, then asks, then reads the limits again, then records the request in the ledger, and only then calls the provider', iEstimate > 0 && iAsk > iEstimate && iAfterAskRead > iAsk && iBegin > iAfterAskRead && iStream > iBegin, JSON.stringify([iEstimate, iAsk, iAfterAskRead, iBegin, iStream]))
  check('source: ...so a request that is waiting for a yes has written nothing to the ledger (the question comes before ledger.begin, and nothing between touches the ledger but a look at the sums)', (() => { const between = run.slice(iEstimate, iBegin); return !/ledger\.(begin|finish)\(/.test(between) && /ledger\.summary\(/.test(between) })())
  check('source: the guess at the input is made once (one estimateInputTokens in runReply) and the same number goes to the question and to the ledger', (run.match(/estimateInputTokens\(/g) ?? []).length === 1 && /estimateRequest\(inputTokens,/.test(run) && /\n\s+inputTokens\n/.test(run.slice(iBegin, iStream)) && !/estimateInputTokens\(/.test(run.slice(iBegin, iStream)))
  check('source: the ceiling that is priced is the request\'s own (streamRequest.maxOutputTokens) and the prices are the model\'s', /estimateRequest\(inputTokens, streamRequest\.maxOutputTokens, entry\.pricing\)/.test(run))
  check('source: the question is asked only when the setting says so (needsConfirmation), and the amount it names is the one main used', /needsConfirmation\(askFirst, estimate\)/.test(run) && /askAboveUsd: askAbove/.test(run) && /askFirstAmount\(askFirst\)/.test(run))
  check('source: a request the limits will refuse anyway is not asked about (a look at the limits and the sums comes first, and its refusal is sent as the error)', (() => { const part = run.slice(run.indexOf('needsConfirmation('), iAsk); return /checkAgainstLimits\(/.test(part) && /type: 'error'/.test(part) })())
  check('source: no yes and no stop-free path: anything but "send", or a stop, ends the reply without a request', /answer !== 'send' \|\| controller\.signal\.aborted/.test(run) && /return\n/.test(run.slice(run.indexOf("answer !== 'send'"), run.indexOf("answer !== 'send'") + 200)))
  check('source: the provider is still called from exactly one place in main', (() => { const walk = (dir) => readdirSync(join(REPO, dir), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(`${dir}/${e.name}`) : [`${dir}/${e.name}`])); const callers = walk('src/main').filter((f) => /\.ts$/.test(f)).filter((f) => /\badapter\.stream\(|\.messages\.stream\(|\.responses\.stream\(/.test(read(f))); return callers.every((f) => f === 'src/main/chat.ts' || f.startsWith('src/main/providers/')) && callers.includes('src/main/chat.ts') })())

  const handlerStart = chat.indexOf('ipcMain.on(CHANNELS.chatConfirm')
  const handler = chat.slice(handlerStart, chat.indexOf('})', handlerStart) + 2)
  check('source: the yes handler checks who is asking, takes a string stream id, and answers only the sender\'s own question (key "<window id>:<stream id>")', handlerStart > 0 && /isTrustedSender\(event, appUrl\)/.test(handler) && /typeof streamId !== 'string'/.test(handler) && /confirmations\.send\(`\$\{event\.sender\.id\}:\$\{streamId\}`\)/.test(handler), handlerStart > 0 ? '' : 'the handler was not found')
  check('source: a question and the running reply share one key, "<window id>:<stream id>", so a stop for the reply also declines its question', /const key = `\$\{windowId\}:\$\{streamId\}`/.test(run) && /confirmations\.ask\(key, controller\.signal,/.test(run))

  const preload = read('src/preload/index.ts')
  check('source: the page has confirm (a yes for a stream) and setAskFirst, and no way to read or write the file or the ledger', /confirm: \(streamId\)/.test(preload) && /setAskFirst:/.test(preload) && !/ask-first\.json|askFirst\.json|ledger|limits\.json/i.test(preload.replace(/settingsSetAskFirst|setAskFirst/g, '')))
  const ipc = read('src/main/ipc.ts')
  check('source: the settings status carries the setting from the store, and setAskFirst saves only what checkAskFirstChoice built', /askFirst: await askFirstStore\.read\(\)/.test(ipc) && /askFirstStore\.save\(check\.choice\)/.test(ipc) && /checkAskFirstChoice\(input\)/.test(ipc))
  const pageSources = ['src/renderer/src/chat/ipcReply.ts', 'src/renderer/src/chat/useChat.ts', 'src/renderer/src/chat/LargeRequestDialog.tsx'].map(read).join('\n')
  check('source: the page works out no estimate of its own (the figures in the question are main\'s)', !/estimateRequest|estimateInputTokens|needsConfirmation/.test(pageSources))
})

const passed = check.summary()
process.exit(passed ? 0 : 1)
