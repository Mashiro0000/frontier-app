// Slice 8.2 under plain Node (no window): the spending limits (D-031). What a limit is and how it is typed (an amount in whole cents, never zero, a
// deliberate "No limit" kept apart from "not chosen"), what the page may hand over, what limits.json holds and how a damaged one is read (as "not
// chosen", never as a limit that is not there), the check that refuses a request (exactly at the limit may go, a cent more may not, daily and
// monthly named in the sentence), the ledger running that check in the same turn as its write (a refusal writes nothing, ten requests at once
// cannot all pass on the money for three, yesterday's spending is not today's), the file store (missing, damaged, unreadable, a save that fails),
// and the two things the source must keep true (the check is in the one place a provider is called).
// Every file check runs in a normal folder and in the EFS-encrypted %APPDATA% (D-010).
// Run: node tools/verify-8-2.mjs
import { REPO, REPO_URL } from './paths.mjs'
import './ts-resolve.mjs'
import { checker } from './cdp.mjs'
import { promises as fsp, readFileSync, readdirSync, statSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { scratch } from './drive.mjs'

const check = checker()
const SRC = `${REPO_URL}/src`
const L = await import(`${SRC}/shared/limits.ts`)
const ledgerMod = await import(`${SRC}/main/usageLedger.ts`)
const storeMod = await import(`${SRC}/main/limits.ts`)
const { LIMIT_MAX_USD, isLimitAmount, parseLimitText, checkLimitsChoice, limitsFileText, parseLimitsFile, sameLimits, unsetLimits, limitsAreSet, checkAgainstLimits, formatMoney, LIMITS_UNSET_MESSAGE } = L
const { createUsageLedger, RequestRefused } = ledgerMod
const { createLimitsStore } = storeMod

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
// A sabotaged module can make a block throw; that must show as a failed check and a summary line, not as a crashed run (tools/README.md).
const guard = async (name, fn) => { try { await fn() } catch (error) { check(`${name} did not run to its end: ${String(error?.message ?? error).slice(0, 160)}`, false) } }
const OPUS = { inputPerMTok: 4, cacheReadPerMTok: 0.2, cacheWritePerMTok: 5, outputPerMTok: 20 }
// A price that makes a request's cost easy to read: 500,000 input tokens at $2 a million is exactly $1.
const ONE_DOLLAR = { inputPerMTok: 2, cacheReadPerMTok: 0.2, cacheWritePerMTok: 2.5, outputPerMTok: 10 }
const T = (y, m, d, h = 12, mi = 0, s = 0, ms = 0) => new Date(y, m - 1, d, h, mi, s, ms).getTime()
const usd = (n) => ({ kind: 'usd', usd: n })
const NONE = { kind: 'none' }
const UNSET = { kind: 'unset' }
const lim = (daily, monthly) => ({ daily, monthly })

// ============ A. what a limit is, and what is typed ============
check('LIMIT_MAX_USD is 10,000', LIMIT_MAX_USD === 10_000)
check('isLimitAmount: whole cents between a cent and the most are amounts', [0.01, 0.1, 0.07, 1, 5, 5.5, 12.5, 12.34, 9999.99, 10000].every(isLimitAmount))
check('isLimitAmount: nothing, a negative, a fraction of a cent, too much, NaN, Infinity, text and objects are not', [0, -1, 0.001, 5.005, 10000.01, 1e9, NaN, Infinity, -Infinity, '5', null, undefined, {}, [5], true, 1e-9].every((v) => !isLimitAmount(v)))
check('formatMoney: $5.00, $0.25, $12.34, $0.0041, $0.00, and a speck is "less than $0.0001"', formatMoney(5) === '$5.00' && formatMoney(0.25) === '$0.25' && formatMoney(12.34) === '$12.34' && formatMoney(0.0041) === '$0.0041' && formatMoney(0) === '$0.00' && formatMoney(0.00001) === 'less than $0.0001')

for (const [text, expected] of [['5', 5], ['5.0', 5], ['5.00', 5], ['5.5', 5.5], ['12.50', 12.5], ['$5', 5], ['$ 5', 5], [' 7 ', 7], ['0.01', 0.01], ['0.07', 0.07], ['10000', 10000], ['10000.00', 10000], ['9999.99', 9999.99], ['000012', 12], ['1.1', 1.1], ['$0.10', 0.1]]) {
  const r = parseLimitText(text)
  check(`parseLimitText: ${JSON.stringify(text)} is ${expected}`, r.ok && r.usd === expected, JSON.stringify(r))
}
for (const [name, text] of [['empty', ''], ['spaces', '   '], ['zero', '0'], ['zero with cents', '0.00'], ['a dot only', '.'], ['nothing before the dot', '.5'], ['nothing after the dot', '5.'], ['three decimals', '5.005'], ['a comma for the decimal point', '5,5'], ['a thousands comma', '1,000'], ['a minus sign', '-5'], ['a plus sign', '+5'], ['words', 'five'], ['a unit after', '5 dollars'], ['US$', 'US$5'], ['an exponent', '1e3'], ['hex', '0x10'], ['more than the most', '10001'], ['a huge number', '99999999999'], ['seven digits', '1000000'], ['two dollar signs', '$$5'], ['a line break inside', '5\n5'], ['Infinity', 'Infinity'], ['NaN', 'NaN']]) {
  const r = parseLimitText(text)
  check(`parseLimitText: ${name} (${JSON.stringify(text)}) is refused with a sentence`, !r.ok && typeof r.error === 'string' && r.error.length > 10, JSON.stringify(r))
}
check('parseLimitText: an amount too large says what the most is and points to "No limit"', (() => { const r = parseLimitText('10001'); return !r.ok && r.error.includes('$10,000') && /No limit/.test(r.error) })(), JSON.stringify(parseLimitText('10001')))
check('parseLimitText: an empty box says to type an amount or choose No limit', (() => { const r = parseLimitText(''); return !r.ok && /No limit/.test(r.error) })())

check('unsetLimits: both not chosen, and a new object every time', same(unsetLimits(), lim(UNSET, UNSET)) && unsetLimits() !== unsetLimits() && unsetLimits().daily !== unsetLimits().daily)
check('limitsAreSet: both chosen, as amounts or No limit, is set; either not chosen is not', limitsAreSet(lim(usd(5), usd(50))) && limitsAreSet(lim(NONE, NONE)) && limitsAreSet(lim(NONE, usd(1))) && !limitsAreSet(lim(UNSET, usd(1))) && !limitsAreSet(lim(usd(1), UNSET)) && !limitsAreSet(unsetLimits()))
check('sameLimits: kind and amount both count', sameLimits(lim(usd(5), NONE), lim(usd(5), NONE)) && !sameLimits(lim(usd(5), NONE), lim(usd(6), NONE)) && !sameLimits(lim(usd(5), NONE), lim(NONE, NONE)) && !sameLimits(lim(UNSET, NONE), lim(NONE, NONE)) && !sameLimits(lim(usd(5), NONE), lim(usd(5), usd(5))) && sameLimits(lim(UNSET, UNSET), unsetLimits()))

// ============ B. what the page may hand over ============
await guard('block 1', async () => {
  const ok = checkLimitsChoice({ daily: { kind: 'usd', usd: 5 }, monthly: { kind: 'usd', usd: 50.5 } })
  check('checkLimitsChoice: two amounts are accepted, and come back as main\'s own copy', ok.ok && same(ok.limits, lim(usd(5), usd(50.5))))
  const n = checkLimitsChoice({ daily: { kind: 'none' }, monthly: { kind: 'none' } })
  check('checkLimitsChoice: "No limit" for both is accepted', n.ok && same(n.limits, lim(NONE, NONE)))
  const mix = checkLimitsChoice({ daily: { kind: 'none' }, monthly: { kind: 'usd', usd: 20 } })
  check('checkLimitsChoice: one of each is accepted', mix.ok && same(mix.limits, lim(NONE, usd(20))))
  const extra = checkLimitsChoice({ daily: { kind: 'usd', usd: 5, note: 'x', __proto__: { y: 1 } }, monthly: { kind: 'none', usd: 3 }, extra: 1 })
  check('checkLimitsChoice: fields it does not know are not kept, and the amount that came with "No limit" is dropped', extra.ok && same(extra.limits, lim(usd(5), NONE)) && Object.keys(extra.limits).join() === 'daily,monthly')
  for (const [name, input] of [
    ['nothing', undefined], ['null', null], ['a string', '5'], ['a number', 5], ['an array', [usd(5), usd(5)]], ['an empty object', {}],
    ['no monthly', { daily: { kind: 'none' } }], ['no daily', { monthly: { kind: 'none' } }],
    ['"unset" from the page (a choice cannot be taken back)', { daily: { kind: 'unset' }, monthly: { kind: 'none' } }],
    ['both "unset"', { daily: { kind: 'unset' }, monthly: { kind: 'unset' } }],
    ['an unknown kind', { daily: { kind: 'off' }, monthly: { kind: 'none' } }], ['a kind in the wrong case', { daily: { kind: 'None' }, monthly: { kind: 'none' } }],
    ['a plain number for a side', { daily: 5, monthly: { kind: 'none' } }], ['"none" as text for a side', { daily: 'none', monthly: { kind: 'none' } }], ['null for a side', { daily: null, monthly: { kind: 'none' } }],
    ['an amount of 0', { daily: usd(0), monthly: { kind: 'none' } }], ['a negative amount', { daily: usd(-1), monthly: { kind: 'none' } }],
    ['an amount as text', { daily: { kind: 'usd', usd: '5' }, monthly: { kind: 'none' } }], ['a fraction of a cent', { daily: usd(5.005), monthly: { kind: 'none' } }],
    ['too much', { daily: usd(10000.01), monthly: { kind: 'none' } }], ['NaN', { daily: usd(NaN), monthly: { kind: 'none' } }], ['Infinity', { daily: usd(Infinity), monthly: { kind: 'none' } }],
    ['a usd side with no amount', { daily: { kind: 'usd' }, monthly: { kind: 'none' } }], ['an object that prints as a number', { daily: { kind: 'usd', usd: { valueOf: () => 5, toString: () => '5' } }, monthly: { kind: 'none' } }],
    ['a bad monthly beside a good daily', { daily: usd(5), monthly: usd(0) }]
  ]) {
    const r = checkLimitsChoice(input)
    check(`checkLimitsChoice: ${name} is refused with a sentence`, !r.ok && typeof r.error === 'string' && r.error.length > 10, JSON.stringify(r))
  }
})

// ============ C. what limits.json holds, and how it is read ============
await guard('block 2', async () => {
  for (const [name, limits, text] of [
    ['two amounts', lim(usd(5), usd(50)), '{"version":1,"daily":5,"monthly":50}'],
    ['No limit and an amount', lim(NONE, usd(12.5)), '{"version":1,"daily":"none","monthly":12.5}'],
    ['both none', lim(NONE, NONE), '{"version":1,"daily":"none","monthly":"none"}'],
    ['neither chosen (nothing is written for a limit not chosen)', unsetLimits(), '{"version":1}'],
    ['only the daily chosen', lim(usd(3), UNSET), '{"version":1,"daily":3}']
  ]) {
    check(`limitsFileText: ${name} is written as ${text}`, limitsFileText(limits) === text, limitsFileText(limits))
    const back = parseLimitsFile(text)
    check(`parseLimitsFile: ...and reads back the same, not damaged`, same(back.limits, limits) && back.damaged === false, JSON.stringify(back))
  }
  const damagedCases = [
    ['text that is not JSON', 'hello'], ['an empty file', ''], ['a cut-off file', '{"version":1,"dai'], ['JSON null', 'null'], ['a JSON array', '[1]'], ['a JSON number', '5'], ['version 2', '{"version":2,"daily":5,"monthly":5}'], ['no version', '{"daily":5,"monthly":5}'], ['version as text', '{"version":"1","daily":5}']
  ]
  for (const [name, text] of damagedCases) {
    const r = parseLimitsFile(text)
    check(`parseLimitsFile: ${name} holds no choice (neither limit), and is damaged`, same(r.limits, unsetLimits()) && r.damaged === true, JSON.stringify(r))
  }
  for (const [name, text, expected] of [
    ['a daily of 0', '{"version":1,"daily":0,"monthly":50}', lim(UNSET, usd(50))],
    ['a negative daily', '{"version":1,"daily":-5,"monthly":50}', lim(UNSET, usd(50))],
    ['a daily as text', '{"version":1,"daily":"5","monthly":50}', lim(UNSET, usd(50))],
    ['"NONE" in capitals (only "none" means none)', '{"version":1,"daily":"NONE","monthly":50}', lim(UNSET, usd(50))],
    ['a daily of null', '{"version":1,"daily":null,"monthly":50}', lim(UNSET, usd(50))],
    ['a daily of true', '{"version":1,"daily":true,"monthly":50}', lim(UNSET, usd(50))],
    ['a fraction of a cent', '{"version":1,"daily":5.001,"monthly":50}', lim(UNSET, usd(50))],
    ['a monthly above the most', '{"version":1,"daily":5,"monthly":10001}', lim(usd(5), UNSET)],
    ['a monthly of 1e999 (which JSON reads as Infinity)', '{"version":1,"daily":5,"monthly":1e999}', lim(usd(5), UNSET)],
    ['a monthly that is an object', '{"version":1,"daily":5,"monthly":{"usd":5}}', lim(usd(5), UNSET)]
  ]) {
    const r = parseLimitsFile(text)
    check(`parseLimitsFile: ${name}: that limit is not chosen, the other one is kept, and it is damaged`, same(r.limits, expected) && r.damaged === true, JSON.stringify(r))
  }
  const extra = parseLimitsFile('{"version":1,"daily":5,"monthly":"none","note":"mine"}')
  check('parseLimitsFile: a field it does not know is ignored, and is not damage', same(extra.limits, lim(usd(5), NONE)) && extra.damaged === false)
  const missingOne = parseLimitsFile('{"version":1,"monthly":50}')
  check('parseLimitsFile: a limit that is missing is not chosen, and a file that never had it is not damaged', same(missingOne.limits, lim(UNSET, usd(50))) && missingOne.damaged === false)
})

// ============ D. the check before a request ============
await guard('block 3', async () => {
  const S = (today, month, request = 0) => ({ today, month, request })
  const ALL = lim(usd(5), usd(50))
  check('checkAgainstLimits: limits not chosen refuse everything, with the sentence that says to set them', [lim(UNSET, UNSET), lim(UNSET, usd(50)), lim(usd(5), UNSET), lim(UNSET, NONE), lim(NONE, UNSET)].every((l) => checkAgainstLimits(l, S(0, 0, 0)) === LIMITS_UNSET_MESSAGE))
  check('LIMITS_UNSET_MESSAGE: says that nothing was sent, and where to set the limits, and that No limit is a choice', /^Nothing was sent/.test(LIMITS_UNSET_MESSAGE) && /Settings/.test(LIMITS_UNSET_MESSAGE) && /daily/.test(LIMITS_UNSET_MESSAGE) && /monthly/.test(LIMITS_UNSET_MESSAGE) && /No limit/.test(LIMITS_UNSET_MESSAGE))
  check('checkAgainstLimits: "No limit" for both never refuses, whatever has been spent', checkAgainstLimits(lim(NONE, NONE), S(1e6, 1e7, 1e5)) === null)
  check('checkAgainstLimits: nothing spent and a small request is allowed', checkAgainstLimits(ALL, S(0, 0, 0.01)) === null)
  check('checkAgainstLimits: spent plus the request exactly AT the daily limit is allowed (1 + 4 = 5)', checkAgainstLimits(ALL, S(1, 1, 4)) === null)
  check('checkAgainstLimits: ...and a cent more is refused (1 + 4.01)', typeof checkAgainstLimits(ALL, S(1, 1, 4.01)) === 'string')
  check('checkAgainstLimits: exactly AT the monthly limit is allowed (46 + 4 = 50, with today at 0)', checkAgainstLimits(ALL, S(0, 46, 4)) === null)
  check('checkAgainstLimits: ...and a cent more is refused', typeof checkAgainstLimits(ALL, S(0, 46, 4.01)) === 'string')
  {
    const m = checkAgainstLimits(ALL, S(4.5, 10, 1))
    check('checkAgainstLimits: over the daily only: the sentence names the daily limit, its amount, what was spent, and not the monthly', typeof m === 'string' && /^Nothing was sent: this would take today's spending past your daily limit of \$5\.00 \(\$4\.50 so far\)/.test(m) && !/monthly/.test(m), m)
    check('checkAgainstLimits: ...and says it can be raised in Settings and when the count starts again (midnight)', /Settings/.test(m) && /midnight/.test(m))
  }
  {
    const m = checkAgainstLimits(ALL, S(0.5, 49.5, 1))
    check('checkAgainstLimits: over the monthly only: it names the monthly limit and not the daily', typeof m === 'string' && /^Nothing was sent: this would take this month's spending past your monthly limit of \$50\.00 \(\$49\.50 so far\)/.test(m) && !/daily/.test(m) && /1st/.test(m), m)
  }
  {
    const m = checkAgainstLimits(ALL, S(4.5, 49.5, 1))
    check('checkAgainstLimits: over both: one sentence names both limits', typeof m === 'string' && /daily limit of \$5\.00/.test(m) && /monthly limit of \$50\.00/.test(m) && (m.match(/Nothing was sent/g) ?? []).length === 1, m)
  }
  {
    const m = checkAgainstLimits(ALL, S(5, 10, 0.0001))
    check('checkAgainstLimits: a limit already reached says so ("you have reached")', /you have reached your daily limit of \$5\.00 \(\$5\.00 so far today\)/.test(m ?? ''), m)
    const m2 = checkAgainstLimits(ALL, S(5.2, 10, 0.0001))
    check('checkAgainstLimits: ...also when it has been passed (by the last reply)', /you have reached your daily limit/.test(m2 ?? '') && /\$5\.20/.test(m2 ?? ''), m2)
  }
  check('checkAgainstLimits: the daily limit alone, with No limit for the month, still stops', typeof checkAgainstLimits(lim(usd(5), NONE), S(5, 5, 1)) === 'string' && checkAgainstLimits(lim(usd(5), NONE), S(1, 1e6, 1)) === null)
  check('checkAgainstLimits: the monthly limit alone, with No limit for the day, still stops', typeof checkAgainstLimits(lim(NONE, usd(50)), S(1e6, 50, 1)) === 'string' && checkAgainstLimits(lim(NONE, usd(50)), S(1e6, 1, 1)) === null)
  check('checkAgainstLimits: a request that costs nothing is refused only once a limit has been passed (spent 5.00 of 5.00 is not passed)', checkAgainstLimits(ALL, S(5, 5, 0)) === null && typeof checkAgainstLimits(ALL, S(5.01, 5.01, 0)) === 'string')
  check('checkAgainstLimits: the sentence is plain text (no markup, one line)', (() => { const m = checkAgainstLimits(ALL, S(4.5, 49.5, 1)); return !/[<>`*\n]/.test(m) })())
})

// ============ E. the ledger runs the check in the same turn as its write; the store keeps the file ============
for (const [where, base] of [['tmp', join(tmpdir(), `frontier-v82-${randomUUID()}`)], ['EFS', join(scratch('v82'), randomUUID())]]) {
  const T_ = (name) => `${name} [${where}]`
  await fsp.mkdir(base, { recursive: true })
  let n = 0
  const folder = () => join(base, `case-${++n}`)
  const ledgerPath = (dir) => join(dir, 'usage', 'ledger.jsonl')
  const linesOf = (file) => readFileSync(file, 'utf8').split('\n').filter((l) => l !== '')
  const exists = async (file) => fsp.stat(file).then(() => true, () => false)
  let clock = T(2026, 10, 15, 10)
  const make = (dir, options = {}) => createUsageLedger(ledgerPath(dir), { now: () => clock, ...options })
  const begin = (ledger, gate, over = {}) => ledger.begin({ chat: null, provider: 'anthropic', model: 'claude-opus-5-5', effort: 'medium', prices: OPUS, inputTokens: 1000, ...over }, gate)
  const refuseAlways = () => 'Nothing was sent: test refusal.'
  const refusalOf = async (promise) => { try { await promise; return null } catch (error) { return error } }

  // a refusal throws RequestRefused with the sentence, and writes nothing, not even the folder
  await guard('block 4', async () => {
    const dir = folder(), ledger = make(dir)
    const error = await refusalOf(begin(ledger, refuseAlways))
    check(T_('begin: a check that refuses makes begin throw RequestRefused with the check\'s own sentence'), error instanceof RequestRefused && error instanceof Error && error.message === 'Nothing was sent: test refusal.' && error.name === 'RequestRefused', String(error))
    check(T_('begin: ...and nothing was written (no file, and no folder was made for it)'), !(await exists(ledgerPath(dir))) && !(await exists(join(dir, 'usage'))))
    const s = await ledger.summary(null)
    check(T_('begin: ...and the sums do not move'), s.today.requests === 0 && s.month.requests === 0)
  })
  // no check: it is 8.1 as it was
  await guard('block 5', async () => {
    const dir = folder(), ledger = make(dir)
    const record = await begin(ledger, undefined)
    check(T_('begin: with no check it records the request, as in 8.1'), record.state === 'sent' && linesOf(ledgerPath(dir)).length === 1)
  })
  // a check that allows
  await guard('block 6', async () => {
    const dir = folder(), ledger = make(dir)
    const record = await begin(ledger, () => null)
    check(T_('begin: a check that answers null lets the request be recorded'), record.state === 'sent' && linesOf(ledgerPath(dir)).length === 1)
  })
  // what the check is given
  await guard('block 7', async () => {
    const dir = folder(), ledger = make(dir)
    const seen = []
    const spy = (spend) => { seen.push({ ...spend }); return null }
    clock = T(2026, 10, 15, 10)
    await begin(ledger, spy, { inputTokens: 1000 }) // costs 0.004 at 4 a million
    await begin(ledger, spy, { inputTokens: 500_000, prices: ONE_DOLLAR }) // costs 1
    const first = seen[0], second = seen[1]
    check(T_('check: the first request sees nothing spent, and its own input at list price (1,000 tokens at $4 a million = $0.004)'), first.today === 0 && first.month === 0 && Math.abs(first.request - 0.004) < 1e-12, JSON.stringify(first))
    check(T_('check: the second sees what the first is already on the books for (its input, as an estimate, while it is on its way) and its own input ($1)'), Math.abs(second.today - 0.004) < 1e-12 && Math.abs(second.month - 0.004) < 1e-12 && second.request === 1, JSON.stringify(second))
  })
  // in flight and finished requests: the real numbers replace the guess; a rejected request is not owed
  await guard('block 8', async () => {
    const dir = folder(), ledger = make(dir)
    const seen = []
    const spy = (spend) => { seen.push({ ...spend }); return null }
    const a = await begin(ledger, spy, { inputTokens: 500_000, prices: ONE_DOLLAR })
    await ledger.finish(a.id, { state: 'done', tokens: { input: 100_000, cacheRead: 0, cacheWrite: 0, output: 0 }, estimate: false })
    const b = await begin(ledger, spy, { inputTokens: 500_000, prices: ONE_DOLLAR })
    await ledger.finish(b.id, { state: 'rejected', tokens: { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 }, estimate: false })
    await begin(ledger, spy, { inputTokens: 10 })
    check(T_('check: a finished request counts for what the provider reported ($0.20, not the $1 guessed), and a refused one counts for nothing'), Math.abs(seen[1].today - 0.2) < 1e-12 && Math.abs(seen[2].today - 0.2) < 1e-12, JSON.stringify(seen))
  })
  // yesterday is not today
  await guard('block 9', async () => {
    const dir = folder(), ledger = make(dir)
    clock = T(2026, 10, 14, 23, 59, 59, 999)
    await begin(ledger, null, { inputTokens: 500_000, prices: ONE_DOLLAR })
    clock = T(2026, 10, 15, 0, 0, 0, 0)
    let seen = null
    await begin(ledger, (spend) => { seen = { ...spend }; return null }, { inputTokens: 1 })
    check(T_('check: a request of the last millisecond of yesterday is in this month but NOT in today'), seen.today === 0 && seen.month === 1, JSON.stringify(seen))
    clock = T(2026, 11, 1, 0, 0, 0, 0)
    await begin(ledger, (spend) => { seen = { ...spend }; return null }, { inputTokens: 1 })
    check(T_('check: on the first of the next month neither the day nor the month has it'), seen.today === 0 && seen.month === 0, JSON.stringify(seen))
    clock = T(2026, 10, 15, 10)
  })
  // a real limit through the real check: three of ten at once
  await guard('block 10', async () => {
    const dir = folder(), ledger = make(dir)
    const limits = lim(usd(3.5), NONE)
    const outcomes = await Promise.all(Array.from({ length: 10 }, () => refusalOf(begin(ledger, (spend) => checkAgainstLimits(limits, spend), { inputTokens: 500_000, prices: ONE_DOLLAR }))))
    const passed = outcomes.filter((o) => o === null).length
    const refused = outcomes.filter((o) => o instanceof RequestRefused).length
    const lines = linesOf(ledgerPath(dir))
    check(T_('ten requests asked for at once, with money for three ($1 each, a $3.50 limit): exactly 3 pass, 7 are refused, and 3 lines are written'), passed === 3 && refused === 7 && lines.length === 3, JSON.stringify([passed, refused, lines.length]))
    const s = await ledger.summary(null)
    check(T_('...and what is on the books is $3, under the limit'), Math.abs(s.today.costUsd - 3) < 1e-12 && s.today.requests === 3)
    const next = await refusalOf(begin(ledger, (spend) => checkAgainstLimits(limits, spend), { inputTokens: 500_000, prices: ONE_DOLLAR }))
    check(T_('...and the next one is refused with the sentence naming the daily limit'), next instanceof RequestRefused && /daily limit of \$3\.50/.test(next.message) && /\$3\.00 so far/.test(next.message), next?.message)
  })
  // the limit sees requests from a run before (the file is read once at the first request)
  await guard('block 11', async () => {
    const dir = folder()
    const first = make(dir)
    await begin(first, null, { inputTokens: 500_000, prices: ONE_DOLLAR })
    await begin(first, null, { inputTokens: 500_000, prices: ONE_DOLLAR })
    await first.whenIdle()
    const second = make(dir) // a new run of the app
    const error = await refusalOf(begin(second, (spend) => checkAgainstLimits(lim(usd(2), NONE), spend), { inputTokens: 500_000, prices: ONE_DOLLAR }))
    check(T_('after a restart the limit counts what the file holds ($2 spent, a $2 limit, one more dollar: refused)'), error instanceof RequestRefused && /reached your daily limit of \$2\.00/.test(error.message), error?.message)
  })
  // a check that throws something else is not a refusal, and nothing is written
  await guard('block 12', async () => {
    const dir = folder(), ledger = make(dir)
    const error = await refusalOf(begin(ledger, () => { throw new Error('boom') }))
    check(T_('begin: a check that throws is not a RequestRefused (the caller treats it as a failure), and nothing is written'), error instanceof Error && !(error instanceof RequestRefused) && error.message === 'boom' && !(await exists(ledgerPath(dir))))
    const record = await begin(ledger, null)
    check(T_('...and the ledger works afterwards (the queue is not stuck)'), record.state === 'sent')
  })

  // ---- the store of limits ----
  const limitsPath = (dir) => join(dir, 'limits.json')
  const makeStore = (dir) => createLimitsStore(() => limitsPath(dir))
  const originalWarn = console.warn
  const warns = []
  const quiet = async (task) => { console.warn = (...args) => warns.push(args.join(' ')); try { return await task() } finally { console.warn = originalWarn } }
  await guard('block 13', async () => {
    const dir = folder()
    await fsp.mkdir(dir, { recursive: true })
    const store = makeStore(dir)
    const got = await store.read()
    check(T_('store: no file means not chosen (both), and reading does not create one'), same(got, unsetLimits()) && !(await exists(limitsPath(dir))))
    await store.save(lim(usd(5), NONE))
    check(T_('store: save writes the plain file a person can read'), readFileSync(limitsPath(dir), 'utf8') === '{"version":1,"daily":5,"monthly":"none"}')
    check(T_('store: ...and read answers with what was saved'), same(await store.read(), lim(usd(5), NONE)))
    check(T_('store: ...and a new store (a new run of the app) reads the same from the file'), same(await makeStore(dir).read(), lim(usd(5), NONE)))
    const entries = readdirSync(dir)
    check(T_('store: no temp or backup file is left beside it'), same(entries, ['limits.json']), JSON.stringify(entries))
  })
  for (const [name, text, expected] of [
    ['text that is not JSON', 'hello', unsetLimits()],
    ['an empty file (a write cut off at once)', '', unsetLimits()],
    ['a file cut off in the middle', '{"version":1,"daily":5,"mon', unsetLimits()],
    ['a file with a byte-order mark (an editor added it)', '﻿{"version":1,"daily":5,"monthly":50}', lim(usd(5), usd(50))],
    ['a daily that is not an amount, beside a good monthly', '{"version":1,"daily":-1,"monthly":50}', lim(UNSET, usd(50))],
    ['the wrong version', '{"version":9,"daily":5,"monthly":50}', unsetLimits()]
  ]) {
    const dir = folder()
    await fsp.mkdir(dir, { recursive: true })
    await fsp.writeFile(limitsPath(dir), text)
    warns.length = 0
    const got = await quiet(() => makeStore(dir).read())
    const said = name.startsWith('a file with a byte-order') ? warns.length === 0 : warns.length === 1
    check(T_(`store: ${name}: read gives ${JSON.stringify(expected)}${said && !name.startsWith('a file with a byte-order') ? ', and says so once in the log' : ''}`), same(got, expected) && said, JSON.stringify([got, warns]))
    const asked = limitsAreSet(got)
    check(T_(`store: ...and what is not chosen refuses a request (${asked ? 'it is set here' : 'the check gives the "set your limits" sentence'})`), asked ? checkAgainstLimits(got, { today: 0, month: 0, request: 0.01 }) === null : checkAgainstLimits(got, { today: 0, month: 0, request: 0.01 }) === LIMITS_UNSET_MESSAGE)
  }
  await guard('block 14', async () => {
    // a file that cannot be read at all: a folder where the file should be
    const dir = folder()
    await fsp.mkdir(limitsPath(dir), { recursive: true })
    const store = makeStore(dir)
    const error = await refusalOf(store.read())
    check(T_('store: a file that cannot be read at all (a folder in its place) makes read THROW, not answer "not chosen"'), error instanceof Error, String(error))
    await fsp.rm(limitsPath(dir), { recursive: true })
    await fsp.writeFile(limitsPath(dir), '{"version":1,"daily":2,"monthly":20}')
    check(T_('store: ...and a failed read is not remembered: the next read tries again'), same(await store.read(), lim(usd(2), usd(20))))
  })
  await guard('block 15', async () => {
    // a save that fails changes nothing
    const dir = folder()
    await fsp.mkdir(dir, { recursive: true })
    const store = makeStore(dir)
    await store.save(lim(usd(1), usd(10)))
    const blocked = createLimitsStore(() => join(limitsPath(dir), 'inside', 'limits.json')) // its parent is a file
    const saveError = await refusalOf(blocked.save(lim(usd(2), usd(20))))
    check(T_('store: a save that cannot be written throws'), saveError instanceof Error)
    check(T_('store: ...and the saved limits are as they were, in the file and in memory'), readFileSync(limitsPath(dir), 'utf8') === '{"version":1,"daily":1,"monthly":10}' && same(await store.read(), lim(usd(1), usd(10))))
    const unchangedAfterFail = await refusalOf(blocked.read())
    check(T_('store: ...and the store that could not save is still usable (its queue is not stuck)'), unchangedAfterFail === null || unchangedAfterFail instanceof Error)
  })
  await guard('block 16', async () => {
    // saves one at a time, the last one asked for wins
    const dir = folder()
    await fsp.mkdir(dir, { recursive: true })
    const store = makeStore(dir)
    await Promise.all(Array.from({ length: 20 }, (_, i) => store.save(lim(usd(i + 1), usd(100 + i)))))
    check(T_('store: 20 saves asked for at once are written in order: the last one is what is kept, in the file and in memory'), readFileSync(limitsPath(dir), 'utf8') === '{"version":1,"daily":20,"monthly":119}' && same(await store.read(), lim(usd(20), usd(119))))
    const mixed = await Promise.all([store.save(lim(NONE, NONE)), store.read(), store.save(lim(usd(7), usd(70))), store.read()])
    check(T_('store: a read asked for between two saves sees the save before it, never half of one'), same(mixed[1], lim(NONE, NONE)) && same(mixed[3], lim(usd(7), usd(70))), JSON.stringify(mixed.slice(1)))
  })
  await guard('block 17', async () => {
    // read once, kept: an edit made while the app runs is not heard until the next start (documented in D-031)
    const dir = folder()
    await fsp.mkdir(dir, { recursive: true })
    const store = makeStore(dir)
    await store.save(lim(usd(5), usd(50)))
    await fsp.writeFile(limitsPath(dir), '{"version":1,"daily":"none","monthly":"none"}')
    check(T_('store: a change made to the file while the app runs is not heard (it is read once); the next start hears it'), same(await store.read(), lim(usd(5), usd(50))) && same(await makeStore(dir).read(), lim(NONE, NONE)))
  })
  await guard('block 18', async () => {
    // the store makes the folder for the file
    const dir = join(folder(), 'deeper')
    const store = makeStore(dir)
    await store.save(lim(NONE, NONE))
    check(T_('store: save makes the folder if it is not there yet'), statSync(limitsPath(dir)).isFile())
  })
  await fsp.rm(base, { recursive: true, force: true })
}

// ============ F. the two things the source must keep true ============
await guard('block 19', async () => {
  const read = (path) => readFileSync(join(REPO, path), 'utf8')
  const walk = (dir) => readdirSync(join(REPO, dir), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(`${dir}/${e.name}`) : [`${dir}/${e.name}`]))
  const mainFiles = walk('src/main').filter((f) => /\.ts$/.test(f))
  const callers = mainFiles.filter((f) => /\badapter\.stream\(|\.messages\.stream\(|\.responses\.stream\(/.test(read(f)))
  check('source: a provider is asked for a reply from exactly one place in main (chat.ts), and the adapters themselves', callers.every((f) => f === 'src/main/chat.ts' || f.startsWith('src/main/providers/')) && callers.includes('src/main/chat.ts'), JSON.stringify(callers))
  const chat = read('src/main/chat.ts')
  const beginIndex = chat.indexOf('await ledger.begin(')
  const streamIndex = chat.indexOf('adapter.stream(')
  check('source: chat.ts records and checks the request (ledger.begin with the limit check) BEFORE it calls the provider', beginIndex > 0 && streamIndex > beginIndex && /checkAgainstLimits\(limits, spend\)/.test(chat.slice(beginIndex, streamIndex)))
  check('source: chat.ts reads the limits on every request (inside runReply), not once at startup', (() => { const run = chat.slice(chat.indexOf('async function runReply('), chat.indexOf('export function registerChatIpc')); return /limitsStore\.read\(\)/.test(run) })())
  const preload = read('src/preload/index.ts')
  check('source: the page has setLimits and no way to read or write the ledger or limits file', /setLimits:/.test(preload) && !/ledger|limits\.json|unset/i.test(preload.replace(/settingsSetLimits|setLimits/g, '')))
})

const passed = check.summary()
process.exit(passed ? 0 : 1)
