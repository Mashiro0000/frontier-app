// Slice 8.1 under plain Node (no window): the usage ledger (D-030). The arithmetic of cost (each of the four buckets at its own price),
// the guess made when a provider gives no report, the strict reader of one ledger line, the sums for a chat, a day and a month (with
// the edges of both), the file itself (appended to, a later line replacing an earlier one with the same id, a cut-off or damaged line
// skipped and counted, a request that cannot be written down refused, a size cap), the registry's four prices per model against what
// the providers' pricing pages said on 2026-10-02, and the one new field of a chat request.
// Every file check runs in a normal folder and in the EFS-encrypted %APPDATA% (D-010).
// Run: node tools/verify-8-1.mjs
import { REPO, REPO_URL } from './paths.mjs'
import './ts-resolve.mjs'
import { checker } from './cdp.mjs'
import { promises as fsp, readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { scratch } from './drive.mjs'

const check = checker()
const SRC = `${REPO_URL}/src`
const usage = await import(`${SRC}/shared/usage.ts`)
const reg = await import(`${SRC}/shared/registry.ts`)
const validate = await import(`${SRC}/shared/validate.ts`)
const ledgerMod = await import(`${SRC}/main/usageLedger.ts`)
const { costOf, estimateInputTokens, estimateOutputTokens, utf8Length, parseLedgerRecord, ledgerLine, summarize, startOfDay, startOfMonth, tokensAreEmpty, addRecord, emptyTotals } = usage
const { createUsageLedger, LEDGER_LIMITS } = ledgerMod
const { parseRegistry, toModelOption } = reg
const { checkChatRequest, chatForUsage } = validate

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const near = (a, b) => Math.abs(a - b) < 1e-12
const OPUS = { inputPerMTok: 4, cacheReadPerMTok: 0.2, cacheWritePerMTok: 5, outputPerMTok: 20 }
const T = (y, m, d, h = 12, mi = 0, s = 0, ms = 0) => new Date(y, m - 1, d, h, mi, s, ms).getTime()

// ============ A. cost: each bucket at its own price ============
check('costOf: the four buckets are each priced by their own price (1,000 / 2,000 / 500 / 300 tokens at 4 / 0.2 / 5 / 20)', near(costOf({ input: 1000, cacheRead: 2000, cacheWrite: 500, output: 300 }, OPUS), 0.0129))
for (const [bucket, price] of [['input', 4], ['cacheRead', 0.2], ['cacheWrite', 5], ['output', 20]]) {
  check(`costOf: a million ${bucket} tokens alone cost exactly ${price} dollars`, near(costOf({ input: 0, cacheRead: 0, cacheWrite: 0, output: 0, [bucket]: 1_000_000 }, OPUS), price))
}
check('costOf: nothing costs nothing', costOf({ input: 0, cacheRead: 0, cacheWrite: 0, output: 0 }, OPUS) === 0)
check('costOf: a bucket with a price of 0 is free, the others are not', near(costOf({ input: 1_000_000, cacheRead: 1_000_000, cacheWrite: 0, output: 0 }, { ...OPUS, cacheReadPerMTok: 0 }), 4))
check('tokensAreEmpty: all four zero is empty, any one not', tokensAreEmpty({ input: 0, cacheRead: 0, cacheWrite: 0, output: 0 }) && ['input', 'cacheRead', 'cacheWrite', 'output'].every((b) => !tokensAreEmpty({ input: 0, cacheRead: 0, cacheWrite: 0, output: 0, [b]: 1 })))

// ============ B. the guess (no provider report) ============
check('utf8Length: ASCII is a byte a character, é is 2, a Chinese character 3, an emoji 4', utf8Length('abc') === 3 && utf8Length('é') === 2 && utf8Length('中') === 3 && utf8Length('😀') === 4)
check('estimateInputTokens: "abc" + one message "defghi" = ceil(9 / 3) + 4 = 7', estimateInputTokens('abc', [{ content: 'defghi' }]) === 7)
check('estimateInputTokens: it rounds up (10 bytes = 4 tokens, plus 4 for the message)', estimateInputTokens('', [{ content: 'x'.repeat(10) }]) === 4 + 4)
check('estimateInputTokens: every message adds its framing', estimateInputTokens('', [{ content: '' }, { content: '' }, { content: '' }]) === 12)
check('estimateInputTokens: counts bytes, not characters (100 Chinese characters = 300 bytes = 100 tokens)', estimateInputTokens('', [{ content: '中'.repeat(100) }]) === 100 + 4)
check('estimateInputTokens: the system prompt is counted', estimateInputTokens('x'.repeat(300), [{ content: 'y' }]) === 100 + 1 + 4)
check('estimateOutputTokens: 0 bytes is 0, 1 is 1, 3 is 1, 4 is 2', estimateOutputTokens(0) === 0 && estimateOutputTokens(1) === 1 && estimateOutputTokens(3) === 1 && estimateOutputTokens(4) === 2)
check('the guess is on the high side for English (4 characters a token is typical; 3 bytes a token is more)', estimateOutputTokens(4000) >= 1000)

// ============ C. reading one ledger line: strict ============
const GOOD = { version: 1, id: randomUUID(), at: 1790000000000, chat: randomUUID(), provider: 'anthropic', model: 'claude-opus-5-5', effort: 'medium', state: 'done', estimate: false, tokens: { input: 1, cacheRead: 2, cacheWrite: 3, output: 4 }, prices: OPUS }
check('parseLedgerRecord: a good record is accepted, and comes back as a clean copy of the same', same(parseLedgerRecord(GOOD), GOOD) && parseLedgerRecord(GOOD) !== GOOD)
check('parseLedgerRecord: fields it does not know are dropped (a later version may add some)', same(parseLedgerRecord({ ...GOOD, costUsd: 9, future: { a: 1 } }), GOOD))
check('parseLedgerRecord: chat and effort may be null', parseLedgerRecord({ ...GOOD, chat: null, effort: null })?.chat === null && parseLedgerRecord({ ...GOOD, chat: null, effort: null })?.effort === null)
for (const state of ['sent', 'done', 'stopped', 'failed', 'rejected']) check(`parseLedgerRecord: state "${state}" is accepted`, parseLedgerRecord({ ...GOOD, state })?.state === state)
for (const provider of ['anthropic', 'openai']) check(`parseLedgerRecord: provider "${provider}" is accepted`, parseLedgerRecord({ ...GOOD, provider })?.provider === provider)
for (const effort of ['none', 'low', 'medium', 'high', 'xhigh', 'max']) check(`parseLedgerRecord: effort "${effort}" is accepted`, parseLedgerRecord({ ...GOOD, effort })?.effort === effort)
const bad = [
  ['not an object', 5], ['null', null], ['an array', [GOOD]], ['a string', JSON.stringify(GOOD)],
  ['version 2', { ...GOOD, version: 2 }], ['no version', { ...GOOD, version: undefined }], ['version "1"', { ...GOOD, version: '1' }],
  ['no id', { ...GOOD, id: undefined }], ['an id that is not a uuid', { ...GOOD, id: 'abc' }], ['an upper-case id', { ...GOOD, id: GOOD.id.toUpperCase() }], ['a numeric id', { ...GOOD, id: 5 }],
  ['at negative', { ...GOOD, at: -1 }], ['at a fraction', { ...GOOD, at: 1.5 }], ['at NaN', { ...GOOD, at: NaN }], ['at a string', { ...GOOD, at: '1790000000000' }], ['at beyond a safe integer', { ...GOOD, at: 2 ** 60 }], ['no at', { ...GOOD, at: undefined }],
  ['chat that is not an id', { ...GOOD, chat: 'abc' }], ['chat missing (not null)', { ...GOOD, chat: undefined }],
  ['an unknown provider', { ...GOOD, provider: 'google' }], ['no provider', { ...GOOD, provider: undefined }],
  ['a model that is not an id', { ...GOOD, model: 'Claude Opus' }], ['a model with a slash', { ...GOOD, model: 'a/b' }], ['no model', { ...GOOD, model: undefined }],
  ['an effort that is not a level', { ...GOOD, effort: 'extreme' }], ['effort missing (not null)', { ...GOOD, effort: undefined }],
  ['an unknown state', { ...GOOD, state: 'paid' }], ['no state', { ...GOOD, state: undefined }],
  ['estimate as text', { ...GOOD, estimate: 'false' }], ['estimate as 0', { ...GOOD, estimate: 0 }], ['no estimate', { ...GOOD, estimate: undefined }],
  ['no tokens', { ...GOOD, tokens: undefined }], ['tokens as an array', { ...GOOD, tokens: [1, 2, 3, 4] }],
  ['a bucket missing', { ...GOOD, tokens: { input: 1, cacheRead: 2, output: 4 } }],
  ['a negative bucket', { ...GOOD, tokens: { ...GOOD.tokens, output: -1 } }], ['a fractional bucket', { ...GOOD, tokens: { ...GOOD.tokens, input: 1.5 } }],
  ['a bucket as text', { ...GOOD, tokens: { ...GOOD.tokens, cacheRead: '2' } }], ['a bucket NaN', { ...GOOD, tokens: { ...GOOD.tokens, cacheWrite: NaN } }], ['a bucket Infinity', { ...GOOD, tokens: { ...GOOD.tokens, output: Infinity } }],
  ['a bucket above a billion', { ...GOOD, tokens: { ...GOOD.tokens, input: 1_000_000_001 } }],
  ['no prices', { ...GOOD, prices: undefined }], ['a price missing', { ...GOOD, prices: { inputPerMTok: 4, cacheReadPerMTok: 0.2, outputPerMTok: 20 } }],
  ['a negative price', { ...GOOD, prices: { ...OPUS, inputPerMTok: -4 } }], ['a price NaN', { ...GOOD, prices: { ...OPUS, outputPerMTok: NaN } }], ['a price above 10,000', { ...GOOD, prices: { ...OPUS, cacheWritePerMTok: 10_001 } }], ['a price as text', { ...GOOD, prices: { ...OPUS, cacheReadPerMTok: '0.2' } }]
]
for (const [name, value] of bad) check(`parseLedgerRecord: ${name} is refused`, parseLedgerRecord(value) === null)
const line = ledgerLine(GOOD)
check('ledgerLine: one line of JSON, with the cost beside the record for a person reading the file', !line.includes('\n') && JSON.parse(line).costUsd === costOf(GOOD.tokens, GOOD.prices))
check('ledgerLine: a line has exactly these fields and no other (so no message text, no key and no path can be in one): version, id, at, chat, provider, model, effort, state, estimate, tokens, prices, costUsd', same(Object.keys(JSON.parse(line)), ['version', 'id', 'at', 'chat', 'provider', 'model', 'effort', 'state', 'estimate', 'tokens', 'prices', 'costUsd']) && same(Object.keys(JSON.parse(line).tokens), ['input', 'cacheRead', 'cacheWrite', 'output']) && same(Object.keys(JSON.parse(line).prices), ['inputPerMTok', 'cacheReadPerMTok', 'cacheWritePerMTok', 'outputPerMTok']))
check('ledgerLine: what is written is read back as the same record', same(parseLedgerRecord(JSON.parse(line)), GOOD))
check('ledgerLine: a cost written into the file is NOT read (a line cannot claim a cost its numbers do not give)', same(parseLedgerRecord({ ...JSON.parse(line), costUsd: 12345 }), GOOD))

// ============ D. sums: a chat, a day, a month, and their edges ============
{
  const C1 = randomUUID(), C2 = randomUUID()
  const rec = (at, over = {}) => ({ ...GOOD, id: randomUUID(), at, chat: C1, state: 'done', estimate: false, tokens: { input: 1_000_000, cacheRead: 0, cacheWrite: 0, output: 0 }, ...over }) // 4 dollars each
  const now = T(2026, 10, 15, 14, 30)
  const r = {
    midnightToday: rec(T(2026, 10, 15, 0, 0, 0, 0)),
    lastMsYesterday: rec(T(2026, 10, 14, 23, 59, 59, 999)),
    firstOfMonth: rec(T(2026, 10, 1, 0, 0, 0, 0)),
    lastMsLastMonth: rec(T(2026, 9, 30, 23, 59, 59, 999)),
    refused: rec(T(2026, 10, 15, 9), { state: 'rejected' }),
    guessed: rec(T(2026, 10, 15, 10), { estimate: true, chat: C2 }),
    sent: rec(T(2026, 10, 15, 11), { state: 'sent', estimate: true, chat: null })
  }
  const s = summarize(Object.values(r), C1, now, 2)
  check('summarize: today = the record at midnight, the guess and the one on its way (a refused one owes nothing) = 3 requests, 12 dollars', s.today.requests === 3 && near(s.today.costUsd, 12), JSON.stringify(s.today))
  check('summarize: the last millisecond of yesterday is not today (3, not 4 requests), and is this month (5, 20 dollars)', s.today.requests === 3 && s.month.requests === 5 && near(s.month.costUsd, 20), JSON.stringify(s.month))
  check('summarize: the first instant of the month is in the month; the last millisecond of the month before is not', s.month.requests === 5)
  check('summarize: the chat sum is only that chat (midnight, yesterday, first of month, last month = 4 requests, 16 dollars)', s.chat.requests === 4 && near(s.chat.costUsd, 16), JSON.stringify(s.chat))
  check('summarize: a chat sum is for ANY month (the one last month is in it); today and month are not', s.chat.requests === 4 && s.month.requests === 5)
  check('summarize: a sum with a guess, or a request still on its way, is "about"', s.today.about === true && s.month.about === true)
  check('summarize: a sum of provider reports only is not "about"', summarize([r.midnightToday, r.lastMsYesterday], null, now, 0).today.about === false)
  check('summarize: no chat asked for -> no chat sum', summarize(Object.values(r), null, now, 0).chat === null)
  check('summarize: a chat with nothing in it sums to zero, not to null', summarize(Object.values(r), randomUUID(), now, 0).chat.requests === 0)
  check('summarize: the unreadable count and the time are passed through', s.unreadable === 2 && s.at === now)
  check('summarize: the buckets are added per bucket', (() => { const t = emptyTotals(); addRecord(t, rec(now, { tokens: { input: 1, cacheRead: 2, cacheWrite: 3, output: 4 } })); addRecord(t, rec(now, { tokens: { input: 10, cacheRead: 20, cacheWrite: 30, output: 40 } })); return same(t.tokens, { input: 11, cacheRead: 22, cacheWrite: 33, output: 44 }) && t.requests === 2 })())
  check('startOfDay / startOfMonth: local midnight, and the first of the month', startOfDay(now) === T(2026, 10, 15, 0) && startOfMonth(now) === T(2026, 10, 1, 0))
  check('summarize: a month boundary at the turn of the year (1 January is a new month, 31 December is the old one)', summarize([rec(T(2026, 12, 31, 23, 59, 59, 999)), rec(T(2027, 1, 1, 0, 0, 0, 0))], null, T(2027, 1, 20), 0).month.requests === 1)
  check('summarize: money adds up per record, at that record\'s own prices (a price changed later does not change an old record)', (() => { const cheap = rec(now, { prices: { ...OPUS, inputPerMTok: 1 } }); const dear = rec(now, { prices: { ...OPUS, inputPerMTok: 10 } }); return near(summarize([cheap, dear], null, now, 0).today.costUsd, 11) })())
}

// ============ E. the registry: four prices per model ============
{
  const file = JSON.parse(readFileSync(`${REPO}/registry/models.json`, 'utf8'))
  const parsed = parseRegistry(file)
  check('registry: the file in the repo is read, with no problem', parsed.ok && parsed.problems.length === 0, JSON.stringify(parsed.problems ?? parsed.error))
  check('registry: the schema is 0.4', reg.REGISTRY_SCHEMA_VERSION === '0.4' && file.schemaVersion === '0.4')
  // What the providers' pricing pages said on 2026-10-02 (the Anthropic page and OpenAI's pricing table): input, cache read, cache write, output.
  const PAGES = {
    'claude-fable-5-1': [10, 0.25, 12.5, 50], 'claude-opus-5-5': [4, 0.2, 5, 20], 'claude-sonnet-5-5': [2, 0.2, 2.5, 10], 'claude-haiku-4-5-20251001': [1, 0.1, 1.25, 5],
    'gpt-6-astra': [10, 1, 12.5, 50], 'gpt-6.1-sol': [2, 0.1, 2.5, 10], 'gpt-6-luna': [0.1, 0.01, 0.125, 0.5]
  }
  check('registry: it lists exactly the seven models the pages were read for', same([...Object.keys(PAGES)].sort(), (parsed.ok ? parsed.registry.models : []).map((m) => m.id).sort()))
  for (const m of parsed.ok ? parsed.registry.models : []) {
    const p = m.pricing
    check(`registry: ${m.id} is priced as the pages said (in / cache read / cache write / out)`, same([p.inputPerMTok, p.cacheReadPerMTok, p.cacheWritePerMTok, p.outputPerMTok], PAGES[m.id]), JSON.stringify(p))
    check(`registry: ${m.id}: toModelOption hands the page all four prices`, same(toModelOption(m).pricing, p))
  }
  const clone = () => JSON.parse(JSON.stringify(file))
  const withModel = (i, change) => { const f = clone(); change(f.models[i]); return parseRegistry(f) }
  const left = (r, i) => r.ok && r.problems.length === 1 && r.problems[0].startsWith(`models[${i}]`) && !r.registry.models.some((m) => m.id === file.models[i].id)
  let r1 = withModel(2, (m) => { delete m.pricing.cacheWritePerMTok })
  check('registry: an entry with no cacheWritePerMTok is left out, and the problem names the four fields a price list has (the default model is not the one dropped here)', left(r1, 2) && /exactly/.test(r1.problems[0]) && /cacheWritePerMTok/.test(r1.problems[0]), JSON.stringify(r1.problems))
  r1 = withModel(2, (m) => { delete m.pricing.cacheReadPerMTok })
  check('registry: an entry with no cacheReadPerMTok is left out', left(r1, 2))
  r1 = withModel(2, (m) => { m.pricing.cacheReadPerMtok = m.pricing.cacheReadPerMTok; delete m.pricing.cacheReadPerMTok })
  check('registry: a misspelt cacheReadPerMtok is left out, with the right spelling in the message', left(r1, 2) && /"cacheReadPerMTok"/.test(r1.problems[0]), JSON.stringify(r1.problems))
  r1 = withModel(2, (m) => { m.pricing.cacheReadPerMTok = m.pricing.inputPerMTok + 1 })
  check('registry: a cache read dearer than ordinary input is a typo, and is left out', left(r1, 2) && /cacheReadPerMTok is more than/.test(r1.problems[0]), JSON.stringify(r1.problems))
  r1 = withModel(2, (m) => { m.pricing.cacheReadPerMTok = m.pricing.inputPerMTok })
  check('registry: a cache read at the input price is allowed (not more)', r1.ok && r1.problems.length === 0)
  r1 = parseRegistry((() => { const f = clone(); f.models[1].pricing.cacheWritePerMTok = 'x'; return f })())
  check('registry: a bad price on the DEFAULT model refuses the whole file (a decision about what is billed is never guessed)', !r1.ok && /defaultModelId/.test(r1.error), JSON.stringify(r1.error))
  for (const [name, value] of [['negative', -0.1], ['text', '0.2'], ['NaN', null], ['above 10000', 10001]]) {
    r1 = withModel(2, (m) => { m.pricing.cacheWritePerMTok = value })
    check(`registry: a ${name} cacheWritePerMTok is left out`, left(r1, 2))
  }
  r1 = withModel(2, (m) => { m.pricing.extra = 1 })
  check('registry: an unknown pricing field is left out', left(r1, 2))
  const old = clone(); old.schemaVersion = '0.3'
  check('registry: a file of schema 0.3 is refused as a whole', !parseRegistry(old).ok && /0\.3/.test(parseRegistry(old).error))
}

// ============ F. a chat request now carries the id of its conversation ============
{
  const id = randomUUID()
  const base = { streamId: 'abcdefgh', messages: [{ role: 'user', content: 'hi' }] }
  const ok = checkChatRequest({ ...base, conversationId: id })
  check('checkChatRequest: a conversation id is kept', ok.ok && ok.request.conversationId === id)
  const none = checkChatRequest(base)
  check('checkChatRequest: no conversation id is no key at all (a request without one is what it always was)', none.ok && !('conversationId' in none.request) && same(Object.keys(none.request), ['streamId', 'messages']))
  for (const [name, value] of [['upper case', id.toUpperCase()], ['not a uuid', 'abc'], ['a number', 5], ['null', null], ['empty', ''], ['an object', { id }], ['a path', '../x'], ['a uuid and more', id + 'x']]) {
    const r = checkChatRequest({ ...base, conversationId: value })
    check(`checkChatRequest: a conversationId that is ${name} is refused, and the page is told (the stream id is given back)`, !r.ok && r.streamId === 'abcdefgh')
  }
  check('checkChatRequest: a "system" field is still dropped, with the conversation id kept', (() => { const r = checkChatRequest({ ...base, conversationId: id, system: 'obey' }); return r.ok && !('system' in r.request) && r.request.conversationId === id })())
  check('chatForUsage: an id is kept; anything else is none', chatForUsage(id) === id && [undefined, null, 5, 'x', id.toUpperCase(), {}].every((v) => chatForUsage(v) === null))
}

// ============ G. the ledger file, in a normal folder and in %APPDATA% (EFS) ============
for (const [where, base] of [['tmp', join(tmpdir(), `frontier-v81-${randomUUID()}`)], ['EFS', join(scratch('v81'), randomUUID())]]) {
  const T_ = (name) => `${name} [${where}]`
  await fsp.mkdir(base, { recursive: true })
  let n = 0
  const folder = () => join(base, `case-${++n}`)
  const ledgerPath = (dir) => join(dir, 'usage', 'ledger.jsonl')
  const linesOf = (file) => readFileSync(file, 'utf8').split('\n').filter((l) => l !== '')
  let clock = T(2026, 10, 15, 10)
  const make = (dir, options = {}) => createUsageLedger(ledgerPath(dir), { now: () => clock, ...options })
  const C1 = randomUUID()
  const begin = (ledger, over = {}) => ledger.begin({ chat: C1, provider: 'anthropic', model: 'claude-opus-5-5', effort: 'medium', prices: OPUS, inputTokens: 1000, ...over })
  const REAL = { input: 100, cacheRead: 200, cacheWrite: 10, output: 50 }
  const REAL_COST = costOf(REAL, OPUS)

  // no file: nothing spent, and looking does not create one
  {
    const dir = folder(), ledger = make(dir)
    const s = await ledger.summary(C1)
    let exists = true
    try { await fsp.stat(ledgerPath(dir)) } catch { exists = false }
    check(T_('no ledger yet: every sum is zero, nothing is unreadable, and asking creates no file'), s.today.requests === 0 && s.month.requests === 0 && s.chat.requests === 0 && s.unreadable === 0 && s.today.costUsd === 0 && !exists)
  }
  // begin
  {
    const dir = folder(), ids = ['11111111-1111-4111-8111-111111111111'], ledger = make(dir, { newId: () => ids[0] })
    const rec = await begin(ledger)
    const lines = linesOf(ledgerPath(dir))
    check(T_('begin writes one line before anything is sent, with the id main made (not the page\'s)'), lines.length === 1 && rec.id === ids[0] && JSON.parse(lines[0]).id === ids[0])
    check(T_('begin: the request is "sent", an estimate, with only the guessed input and the prices it will be counted at'), rec.state === 'sent' && rec.estimate === true && same(rec.tokens, { input: 1000, cacheRead: 0, cacheWrite: 0, output: 0 }) && same(rec.prices, OPUS) && rec.at === clock && rec.chat === C1 && rec.effort === 'medium')
    check(T_('begin: the line written is a record the reader accepts, with its cost beside it'), same(parseLedgerRecord(JSON.parse(lines[0])), rec) && near(JSON.parse(lines[0]).costUsd, costOf(rec.tokens, OPUS)))
    const s = await ledger.summary(C1)
    check(T_('begin: it already counts (1 request, about), so a request in flight is on the books'), s.today.requests === 1 && s.today.about === true && near(s.today.costUsd, costOf(rec.tokens, OPUS)) && s.chat.requests === 1)
  }
  // finish with a real report
  {
    const dir = folder(), ledger = make(dir)
    const rec = await begin(ledger)
    clock += 5000 // the day has not changed, and the record keeps the time it began
    const done = await ledger.finish(rec.id, { state: 'done', tokens: REAL, estimate: false })
    clock -= 5000
    const lines = linesOf(ledgerPath(dir))
    check(T_('finish: a second line with the same id is appended; the first is not touched'), done.saved === true && lines.length === 2 && lines[0].includes('"state":"sent"') && lines[1].includes('"state":"done"') && JSON.parse(lines[0]).id === JSON.parse(lines[1]).id)
    check(T_('finish: the record keeps when it began, its chat, its model and its prices'), done.record.at === rec.at && done.record.chat === C1 && done.record.model === rec.model && same(done.record.prices, OPUS))
    const s = await ledger.summary(C1)
    check(T_('finish: the later line REPLACES the earlier one in the sums (1 request, not 2) and the provider\'s numbers are counted, not "about"'), s.today.requests === 1 && near(s.today.costUsd, REAL_COST) && s.today.about === false && same(s.today.tokens, REAL))
    const again = make(dir)
    const s2 = await again.summary(C1)
    check(T_('...and a new run of the app reading the file gets the same sums (last line wins)'), s2.today.requests === 1 && near(s2.today.costUsd, REAL_COST) && s2.today.about === false && s2.unreadable === 0)
  }
  // a guess, then a real report replaces it
  {
    const dir = folder(), ledger = make(dir)
    const rec = await begin(ledger)
    const guess = { input: 1000, cacheRead: 0, cacheWrite: 0, output: 60 }
    const g = await ledger.finish(rec.id, { state: 'stopped', tokens: guess, estimate: true })
    let s = await ledger.summary(null)
    check(T_('a stopped reply counts a guess marked "about"'), g.record.state === 'stopped' && g.record.estimate === true && s.today.about === true && near(s.today.costUsd, costOf(guess, OPUS)) && s.chat === null)
    await ledger.finish(rec.id, { state: 'done', tokens: REAL, estimate: false })
    s = await ledger.summary(null)
    check(T_('a real report that arrives later REPLACES the guess (same request, the real numbers, no longer "about")'), s.today.requests === 1 && near(s.today.costUsd, REAL_COST) && s.today.about === false)
    const s2 = await make(dir).summary(null)
    check(T_('...also after a restart (three lines in the file, one request)'), linesOf(ledgerPath(dir)).length === 3 && s2.today.requests === 1 && near(s2.today.costUsd, REAL_COST))
  }
  // a refused request owes nothing
  {
    const dir = folder(), ledger = make(dir)
    const rec = await begin(ledger)
    const r = await ledger.finish(rec.id, { state: 'rejected', tokens: { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 }, estimate: false })
    const s = await ledger.summary(C1)
    check(T_('a refused request is written ("rejected", zero tokens) and owes nothing: not counted, no cost'), r.record.state === 'rejected' && s.today.requests === 0 && s.today.costUsd === 0 && s.chat.requests === 0 && linesOf(ledgerPath(dir)).length === 2)
  }
  // finish for an id that was never begun
  {
    const ledger = make(folder())
    check(T_('finish for an id that was never begun does nothing (null)'), (await ledger.finish(randomUUID(), { state: 'done', tokens: REAL, estimate: false })) === null)
  }
  // a cut-off last line
  {
    const dir = folder(), ledger = make(dir)
    const rec = await begin(ledger)
    await ledger.finish(rec.id, { state: 'done', tokens: REAL, estimate: false })
    await fsp.appendFile(ledgerPath(dir), '{"version":1,"id":"22222222-2222-4222-8222-2222') // power cut in the middle of a line: no newline
    const second = make(dir)
    const s = await second.summary(C1)
    check(T_('a cut-off last line is skipped and counted as unreadable; what came before it still counts'), s.unreadable === 1 && s.today.requests === 1 && near(s.today.costUsd, REAL_COST))
    const next = await begin(second)
    const lines = linesOf(ledgerPath(dir))
    const parsedNext = lines.map((l) => { try { return parseLedgerRecord(JSON.parse(l)) } catch { return null } })
    check(T_('the next write starts on a new line, so it does not join the cut-off one (the new record is whole)'), parsedNext.filter(Boolean).some((p) => p.id === next.id) && lines.length === 4)
    const third = await make(dir).summary(C1)
    check(T_('...and a third run reads both: 2 requests, still exactly 1 unreadable line'), third.today.requests === 2 && third.unreadable === 1)
  }
  // damaged and odd lines
  {
    const dir = folder()
    await fsp.mkdir(join(dir, 'usage'), { recursive: true })
    const a = { ...GOOD, id: randomUUID(), at: clock, chat: C1, tokens: REAL, prices: OPUS }, b = { ...GOOD, id: randomUUID(), at: clock, chat: C1, tokens: REAL, prices: OPUS }
    const text = '﻿' + JSON.stringify(a) + '\r\n' + 'not json at all\r\n' + '{}\r\n' + '[]\r\n' + '\r\n' + '   \r\n' + JSON.stringify({ ...b, tokens: { ...REAL, output: -5 } }) + '\r\n' + JSON.stringify(b) + '\r\n'
    await fsp.writeFile(ledgerPath(dir), text)
    const before = readFileSync(ledgerPath(dir), 'utf8')
    const s = await make(dir).summary(C1)
    check(T_('a file with a byte-order mark, CRLF lines, blank lines and four damaged lines: 2 good requests counted, 4 unreadable'), s.today.requests === 2 && s.unreadable === 4 && near(s.today.costUsd, 2 * REAL_COST), JSON.stringify([s.today.requests, s.unreadable]))
    check(T_('reading never writes: the file is byte for byte what it was'), readFileSync(ledgerPath(dir), 'utf8') === before)
  }
  // the same id twice by hand: the last wins
  {
    const dir = folder()
    await fsp.mkdir(join(dir, 'usage'), { recursive: true })
    const id = randomUUID()
    const first = { ...GOOD, id, at: clock, chat: C1, tokens: REAL, prices: OPUS }, last = { ...first, tokens: { input: 7, cacheRead: 0, cacheWrite: 0, output: 0 } }
    await fsp.writeFile(ledgerPath(dir), JSON.stringify(first) + '\n' + JSON.stringify(last) + '\n')
    const s = await make(dir).summary(null)
    check(T_('two lines with one id: the later one is the record (1 request, its numbers)'), s.today.requests === 1 && s.today.tokens.input === 7)
  }
  // many at once
  {
    const dir = folder(), ledger = make(dir)
    const recs = await Promise.all(Array.from({ length: 25 }, () => begin(ledger)))
    const lines = linesOf(ledgerPath(dir))
    const ids = new Set(recs.map((r) => r.id))
    check(T_('25 requests begun at once: 25 different ids (lower-case uuids), 25 whole lines, none crossed'), ids.size === 25 && [...ids].every((i) => /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(i)) && lines.length === 25 && lines.every((l) => parseLedgerRecord(JSON.parse(l)) !== null))
    check(T_('...and the sum counts all 25'), (await ledger.summary(C1)).today.requests === 25)
    await Promise.all(recs.map((r, i) => ledger.finish(r.id, { state: 'done', tokens: { input: i, cacheRead: 0, cacheWrite: 0, output: 0 }, estimate: false })))
    const s = await ledger.summary(C1)
    check(T_('25 requests finished at once: 25 requests still, the numbers are the later lines\' (0+1+...+24 = 300 input tokens)'), s.today.requests === 25 && s.today.tokens.input === 300 && linesOf(ledgerPath(dir)).length === 50)
  }
  // a request that cannot be written down is refused
  {
    const dir = folder()
    await fsp.mkdir(dir, { recursive: true })
    await fsp.writeFile(join(dir, 'usage'), 'a file where the folder should be')
    const ledger = make(dir)
    let refused = false
    try { await begin(ledger) } catch { refused = true }
    const s = await ledger.summary(C1)
    check(T_('begin THROWS when the ledger cannot be written (so the request is not sent), and nothing is counted'), refused && s.today.requests === 0)
  }
  {
    const dir = folder(), ledger = make(dir)
    let refused = false
    try { await begin(ledger, { inputTokens: NaN }) } catch { refused = true }
    let exists = true
    try { await fsp.stat(ledgerPath(dir)) } catch { exists = false }
    check(T_('begin refuses a record that could not be read back (NaN tokens), and writes nothing'), refused && !exists && (await ledger.summary(null)).today.requests === 0)
  }
  // the disk refuses the end of a request
  {
    const dir = folder(), ledger = make(dir)
    const rec = await begin(ledger)
    await fsp.chmod(ledgerPath(dir), 0o444) // read-only
    const warned = []
    const real = console.error
    console.error = (...args) => warned.push(args.join(' '))
    const done = await ledger.finish(rec.id, { state: 'done', tokens: REAL, estimate: false })
    console.error = real
    await fsp.chmod(ledgerPath(dir), 0o666)
    const s = await ledger.summary(C1)
    check(T_('finish never throws when the disk refuses: it says saved: false, logs, and the sums in memory are the real numbers'), done.saved === false && warned.length === 1 && near(s.today.costUsd, REAL_COST) && s.today.about === false, JSON.stringify([done.saved, warned.length]))
    const after = await make(dir).summary(C1)
    check(T_('...a new run of the app only knows what reached the file (the "sent" line: about, the guessed input)'), after.today.requests === 1 && after.today.about === true && after.today.tokens.input === 1000)
  }
  // the size cap
  {
    const dir = folder(), ledger = make(dir)
    for (let i = 0; i < 10; i++) { const r = await begin(ledger, { inputTokens: 1000 + i }); clock += 1 }
    const file = ledgerPath(dir)
    const lines = linesOf(file)
    const size = readFileSync(file).length
    const keep = lines.slice(-3).join('\n').length + 1 + Math.floor(lines[0].length / 2) // the newest three lines and half of the one before
    const warned = []
    const real = console.warn
    console.warn = (...args) => warned.push(args.join(' '))
    const capped = createUsageLedger(file, { now: () => clock, maxFileBytes: keep })
    const s = await capped.summary(null)
    console.warn = real
    check(T_('a file larger than the cap: only its newest part is read (3 of 10 requests), the line it began in the middle of is not counted as unreadable, and it is said in the log'), size > keep && s.today.requests === 3 && s.unreadable === 0 && warned.some((w) => /larger than/.test(w)), JSON.stringify([size, keep, s.today.requests, s.unreadable, warned.length]))
    clock = T(2026, 10, 15, 10)
  }
  await fsp.rm(base, { recursive: true, force: true })
}
check('LEDGER_LIMITS: the default cap is 64 MiB', LEDGER_LIMITS.maxFileBytes === 64 * 1024 * 1024)

const passed = check.summary()
process.exit(passed ? 0 : 1)
