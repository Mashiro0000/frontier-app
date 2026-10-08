// Slice 11.6 under plain Node (D-041): the cost of a search. The provider's fee for one hosted search (about one cent) is kept in the ledger beside the tokens,
// counted in the sums and in the check against the spending limits (reserved before the search is made, settled with what the provider billed), a search that
// failed is not billed, a search that the limits would refuse is not asked about, and the line of the ledger is strict about the new field.
// Run: node tools/verify-11-6.mjs
import './ts-resolve.mjs'
import { checker } from './cdp.mjs'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { REPO, REPO_URL } from './paths.mjs'

const check = checker()
const guard = async (name, fn) => { try { await fn() } catch (error) { check(`${name} did not run to its end: ${String(error?.stack ?? error).slice(0, 300)}`, false) } }
const show = (v) => JSON.stringify(v)?.slice(0, 300)
const SRC = `${REPO_URL}/src`
const usage = await import(`${SRC}/shared/usage.ts`)
const ledgerMod = await import(`${SRC}/main/usageLedger.ts`)
const limitsMod = await import(`${SRC}/shared/limits.ts`)
const coreMod = await import(`${SRC}/main/toolCore.ts`)
const replyMod = await import(`${SRC}/main/replyTools.ts`)
const registryMod = await import(`${SRC}/main/toolRegistry.ts`)
const gateMod = await import(`${SRC}/main/systemQuestion.ts`)
const sharedTools = await import(`${SRC}/shared/tools.ts`)
const auditShared = await import(`${SRC}/shared/audit.ts`)
const source = (rel) => readFileSync(join(REPO, rel), 'utf8')
const dir = mkdtempSync(join(tmpdir(), 'frontier-116-'))
const T0 = Date.UTC(2026, 9, 8, 9, 0, 0)
const PRICES = { inputPerMTok: 4, cacheReadPerMTok: 0.2, cacheWritePerMTok: 5, outputPerMTok: 20 }
const ID = (n) => `0f3a9c2e-1b4d-4c6e-8a7f-1234567890${String(10 + n)}`
const logged = []
const realError = console.error
console.error = (...a) => { logged.push(a.map(String).join(' ')) }

await guard('A', async () => {
  check('A: the fee for one hosted search is one cent for both providers, from their pricing pages', usage.SEARCH_FEE_USD.anthropic === 0.01 && usage.SEARCH_FEE_USD.openai === 0.01 && Object.isFrozen(usage.SEARCH_FEE_USD))
  const base = { version: 1, id: ID(1), at: T0, chat: null, provider: 'anthropic', model: 'claude-opus-5-5', effort: 'low', state: 'done', estimate: false, tokens: { input: 1_000_000, cacheRead: 0, cacheWrite: 0, output: 0 }, prices: PRICES }
  const withFee = { ...base, search: { count: 2, usdEach: 0.01 } }
  check('A: a record without searches costs what it always did; with them, the fee is added (2 x 1 cent)', usage.costOfRecord(base) === 4 && Math.abs(usage.costOfRecord(withFee) - 4.02) < 1e-9)
  check('A: the line shows the cost beside the record, the fee in it', JSON.parse(usage.ledgerLine(withFee)).costUsd > 4.0199 && JSON.parse(usage.ledgerLine(withFee)).search.count === 2)
  check('A: a line with searches reads back as itself; one without has no such field', show(usage.parseLedgerRecord(JSON.parse(usage.ledgerLine(withFee))).search) === '{"count":2,"usdEach":0.01}' && !('search' in usage.parseLedgerRecord(JSON.parse(usage.ledgerLine(base)))))
  for (const [what, search] of [['a negative count', { count: -1, usdEach: 0.01 }], ['21 searches', { count: 21, usdEach: 0.01 }], ['a fraction of a search', { count: 1.5, usdEach: 0.01 }], ['a fee that is not a number', { count: 1, usdEach: 'x' }], ['a negative fee', { count: 1, usdEach: -0.01 }], ['a fee of 11 dollars', { count: 1, usdEach: 11 }], ['no fee', { count: 1 }], ['text', 'two']]) {
    check(`A: a line with ${what} is not usable (it would count the wrong amount)`, usage.parseLedgerRecord({ ...JSON.parse(usage.ledgerLine(base)), search }) === null)
  }
  const sums = usage.summarize([base, withFee, { ...base, id: ID(2), search: { count: 0, usdEach: 0.01 } }], null, T0 + 1000, 0)
  check('A: the sums include the fee: 3 requests, 12 dollars of tokens and 2 cents of searches', sums.today.requests === 3 && Math.abs(sums.today.costUsd - 12.02) < 1e-9, show(sums.today))
})

await guard('B', async () => {
  const ledger = ledgerMod.createUsageLedger(join(dir, 'ledger.jsonl'), { now: () => T0, newId: (() => { let n = 0; return () => ID(++n) })() })
  const input = { chat: null, provider: 'anthropic', model: 'claude-opus-5-5', effort: 'low', prices: PRICES, inputTokens: 1000 }
  const checkWith = (limitUsd) => (spend) => (spend.today + spend.request > limitUsd ? 'over the limit' : null)
  let asked = null
  await ledger.begin({ ...input, reserveUsd: 0.01 }, (spend) => { asked = spend; return null })
  check('B: begin gives the check the cost of the input AND the reserved fee', Math.abs(asked.request - (0.004 + 0.01)) < 1e-9, show(asked))
  const refused = await ledger.begin({ ...input, reserveUsd: 0.01 }, checkWith(0.012)).then(() => null, (e) => e)
  check('B: a search whose fee alone would pass the limit is refused, and nothing is written', refused?.name === 'RequestRefused' && (await ledger.summary(null)).today.requests === 1, String(refused))
  const ok = await ledger.begin({ ...input, reserveUsd: 0 }, checkWith(0.012)).then((r) => r, () => null)
  check('B: the same request with no fee reserved fits', ok !== null)
  const rec = (await ledger.summary(null)).today
  await ledger.finish(ID(1), { state: 'done', tokens: { input: 5000, cacheRead: 0, cacheWrite: 0, output: 100 }, estimate: false, search: { count: 1, usdEach: 0.01 } })
  const done = (await ledger.summary(null)).today
  check('B: finishing with a search adds its fee to the sums (the tokens at the provider\'s report, plus one cent)', Math.abs(done.costUsd - rec.costUsd - ((5000 * 4 + 100 * 20) / 1e6 - 0.004 + 0.01)) < 1e-9, show([rec.costUsd, done.costUsd]))
  await ledger.finish(ID(3), { state: 'failed', tokens: { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 }, estimate: true })
  const text = readFileSync(join(dir, 'ledger.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l))
  check('B: on disk the record that had a search keeps it (count and the fee it was counted at); the failed one has none', text.some((l) => l.id === ID(1) && l.search?.count === 1 && l.search?.usdEach === 0.01) && !text.filter((l) => l.id === ID(3)).some((l) => 'search' in l))
  const again = ledgerMod.createUsageLedger(join(dir, 'ledger.jsonl'), { now: () => T0 })
  check('B: a new run reads the file back and gets the same sums', Math.abs((await again.summary(null)).today.costUsd - done.costUsd) < 1e-9)
})

await guard('C', async () => {
  const OWNER = { w: 1 }
  const make = (affordable) => {
    const asked = []
    const events = []
    const searches = []
    const gate = gateMod.createQuestionGate(async (o, q) => { asked.push(q); return true }, () => 0)
    const runtime = replyMod.createToolRuntime({ tools: registryMod.createToolRegistry(registryMod.BUILT_IN_TOOLS), gate, guard: { check: async () => { throw new Error('no path') } }, record: async (e) => { events.push(e) }, holdsSavedKey: async () => false })
    const reply = runtime.forReply({ owner: OWNER, signal: new AbortController().signal, settings: { enabled: { web_search: true }, caps: { steps: 5, seconds: 60 } }, search: async (q) => { searches.push(q); return { text: 't', sources: [], searched: null, searches: 1, usage: {}, end: 'done' } }, ...(affordable === undefined ? {} : { affordable }) })
    return { reply, asked, events, searches }
  }
  const call = { id: 'a', name: 'web_search', input: { query: 'rust', why: 'because' } }
  let r = make(async () => false)
  let turn = await r.reply.runTurn([call])
  check('C: a search the limits would refuse is not asked about: refused with its own code, nobody asked, nothing searched', turn.results[0].isError === true && turn.results[0].text === coreMod.LIMIT_TEXT && r.asked.length === 0 && r.searches.length === 0 && r.events.length === 1 && r.events[0].type === 'refused' && r.events[0].code === 'limit', show([turn, r.events]))
  check('C: ...it counts as a step (a model that keeps asking is stopped by the cap), and the log says it in words', auditShared.REFUSED_TEXT.limit === 'Refused: a spending limit you set would be passed, so you were not asked.' && sharedTools.REFUSAL_CODES.includes('limit'))
  r = make(async () => true)
  turn = await r.reply.runTurn([call])
  check('C: a search the limits allow is asked about and runs', r.asked.length === 1 && r.searches.length === 1 && turn.results[0].isError === false)
  r = make(async () => { throw new Error('the ledger could not be read') })
  turn = await r.reply.runTurn([call])
  check('C: a fault in looking at the limits counts as yes (the search itself is checked again when it is made)', r.asked.length === 1 && r.searches.length === 1)
  r = make(undefined)
  turn = await r.reply.runTurn([call])
  check('C: with nothing to ask, as before 11.6, the search is asked about', r.asked.length === 1)
  check('C: the box says what a search costs', /about one cent/.test(registryMod.WEB_SEARCH.effect) && /about one cent/.test(r.asked[0].detail))
})

await guard('D', async () => {
  const chat = source('src/main/chat.ts')
  check('D: the search is begun in the ledger with the fee reserved, and settled with the searches the provider reports (none when it failed)', /reserveUsd: SEARCH_FEE_USD\[entry\.provider\]/.test(chat) && /count: found\.searches, usdEach: SEARCH_FEE_USD\[entry\.provider\]/.test(chat))
  const failure = chat.slice(chat.indexOf('const failure = adapter.normalizeError'), chat.indexOf('throw error', chat.indexOf('const failure = adapter.normalizeError')))
  check('D: ...a search that threw is settled with no fee', failure.length > 50 && !/SEARCH_FEE_USD/.test(failure))
  check('D: the question about a search is preceded by a look at the limits (affordable), handed to the reply\'s tools', /affordable: affordableSearch/.test(chat) && /request:\s*costOf\(\{ \.\.\.NO_TOKENS, input: guess \}, entry\.pricing\) \+ SEARCH_FEE_USD\[entry\.provider\]/.test(chat))
  const core = source('src/main/toolCore.ts')
  const iAfford = core.indexOf('context.affordable()')
  check('D: in the core the look comes after the arguments, the key look and the paths, and before the question is made and recorded', iAfford > core.indexOf("refused('secret'") && iAfford > core.indexOf('guard.check') && iAfford < core.indexOf('const question = approvalQuestion') && iAfford < core.indexOf("type: 'asked'"))
  check('D: "ask first" still counts what a request SENDS (a search is asked about by its own box, with its fee in the words)', !/SEARCH_FEE_USD|reserveUsd/.test(source('src/shared/askFirst.ts')))
})

console.error = realError
process.exit(check.summary() ? 0 : 1)
