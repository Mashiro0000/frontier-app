// Stage 22.5 (D-054), the usage chart under plain Node: the ledger summed day by day for 7, 30 and 90 days on this computer's clock (one entry per day, the
// oldest first, ending today; a record goes to the day it began in; before the first day or after now left out; a refused request not counted); the range's
// sum is the days' sum; the ledger answers it from its file; the channel takes only a range; the page draws one colour with no legend and a table under it.
// usage: node tools/verify-22-5.mjs
import './ts-resolve.mjs'
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { checker } from './cdp.mjs'
import { REPO_URL } from './paths.mjs'

const check = checker()
const U = await import(`${REPO_URL}/src/shared/usage.ts`)
const { createUsageLedger } = await import(`${REPO_URL}/src/main/usageLedger.ts`)
const read = (path) => readFileSync(fileURLToPath(`${REPO_URL}/${path}`), 'utf8')

const PRICES = { inputPerMTok: 1, outputPerMTok: 10, cacheReadPerMTok: 0.1, cacheWritePerMTok: 1.25 }
let n = 0
const rec = (at, output, state = 'done', estimate = false) => ({
  version: 1, id: `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`, at, chat: null, provider: 'anthropic', model: 'claude-opus-5-5', effort: null,
  state, estimate, tokens: { input: 1000, cacheRead: 0, cacheWrite: 0, output }, prices: PRICES
})
const NOW = new Date(2026, 10, 7, 15, 30).getTime() // 7 November 2026, 15:30 on this computer's clock
const midnight = (y, m, d) => new Date(y, m, d).getTime()

check('A: three ranges: 7, 30 and 90 days', JSON.stringify(U.USAGE_RANGES) === '[7,30,90]' && U.isUsageRange(30) && !U.isUsageRange(31) && !U.isUsageRange('7'))
for (const r of [7, 30, 90]) {
  const d = U.dailyUsage([], r, NOW, 0)
  const startsOk = d.days.every((day, i) => i === 0 || day.start > d.days[i - 1].start) && d.days.every((day) => new Date(day.start).getHours() === 0 && new Date(day.start).getMinutes() === 0)
  check(`A: ${r} days: ${r} entries, the oldest first, each at a midnight, the last today`, d.days.length === r && startsOk && d.days.at(-1).start === midnight(2026, 10, 7) && d.days[0].start === midnight(2026, 10, 7 - (r - 1)))
}
const records = [
  rec(midnight(2026, 10, 7) + 1000, 500), // today, early
  rec(NOW - 60_000, 1500), // today, a minute ago
  rec(midnight(2026, 10, 6) + 3_600_000, 1000), // yesterday
  rec(midnight(2026, 10, 1), 2000), // 1 November at midnight exactly: that day
  rec(midnight(2026, 10, 1) - 1, 9999), // the last moment of 31 October: outside 7 days
  rec(NOW + 60_000, 9999), // after now (a clock put back): left out
  rec(midnight(2026, 10, 5) + 5, 7777, 'rejected'), // refused: not counted
  rec(midnight(2026, 10, 4) + 5, 300, 'sent', false) // still on its way: counted, "about"
]
const week = U.dailyUsage(records, 7, NOW, 2)
const byDay = Object.fromEntries(week.days.map((d) => [new Date(d.start).getDate(), d]))
check('B: today holds both of today\'s requests', byDay[7].requests === 2 && byDay[7].tokens.output === 2000)
check('B: yesterday holds its one', byDay[6].requests === 1 && byDay[6].tokens.output === 1000)
check('B: a request at midnight counts in the day it begins', byDay[1].requests === 1 && byDay[1].tokens.output === 2000)
check('B: one a moment before the first day, and one after now, are left out', week.days.every((d) => d.tokens.output !== 9999) && week.total.tokens.output !== 9999 && !String(week.total.tokens.output).includes('9999'))
check('B: a refused request is not counted', byDay[5].requests === 0)
check('B: one still on its way is counted and makes its day and the total "about"', byDay[4].requests === 1 && byDay[4].about && week.total.about)
const sum = week.days.reduce((a, d) => ({ cost: a.cost + d.costUsd, req: a.req + d.requests, out: a.out + d.tokens.output }), { cost: 0, req: 0, out: 0 })
check('B: the range\'s total is the sum of its days', Math.abs(sum.cost - week.total.costUsd) < 1e-9 && sum.req === week.total.requests && sum.out === week.total.tokens.output && week.total.requests === 5)
check('B: the cost of a day is the cost of its records', Math.abs(byDay[6].costUsd - U.costOfRecord(records[2])) < 1e-12)
check('B: the unreadable lines are passed on', week.unreadable === 2)
const month = U.dailyUsage(records, 30, NOW, 0)
check('B: 30 days also holds 31 October', month.days.some((d) => d.tokens.output === 9999 && d.start === midnight(2026, 9, 31)))

// ---- C. the ledger answers it from its file ----
const dir = mkdtempSync(join(tmpdir(), 'frontier-225-'))
mkdirSync(join(dir, 'usage'))
const file = join(dir, 'usage', 'ledger.jsonl')
writeFileSync(file, records.slice(0, 4).map((r) => JSON.stringify(r)).join('\n') + '\nnot json\n')
const ledger = createUsageLedger(file, { now: () => NOW })
const fromFile = await ledger.daily(7)
check('C: the ledger sums its file day by day, and counts the unreadable line', fromFile.days.length === 7 && fromFile.total.requests === 4 && fromFile.unreadable === 1, JSON.stringify(fromFile.total))

// ---- D. the wiring and the page ----
const ipc = read('src/main/ipc.ts')
check('D: the channel is behind the sender check and takes a range only', /ipcMain\.handle\(\s*CHANNELS\.usageDaily,\s*guarded\(/.test(ipc) && /if \(!isUsageRange\(input\)\) throw/.test(ipc))
check('D: bridged in the preload', /daily: \(range\) => ipcRenderer\.invoke\(CHANNELS\.usageDaily, range\)/.test(read('src/preload/index.ts')))
const chart = read('src/renderer/src/settings/UsageChart.tsx')
check('D: the page asks for sums only (no ledger file, no record)', !/LedgerRecord|readFile|ledger\.jsonl/.test(chart) && (chart.match(/window\.api/g) ?? []).length === 1 && /window\.api\.usage\s*\.daily\(range\)/.test(chart))
check('D: one scale at a time (cost or tokens), never two axes', /type Measure = 'cost' \| 'tokens'/.test(chart) && (chart.match(/<line className="usage-baseline"/g) ?? []).length === 1)
check('D: the same numbers as a table for a screen reader', /<table className="visually-hidden">/.test(chart))
check('D: one colour from the accent\'s text colour (readable on every surface, 22.4)', /\.usage-bar \{\s*fill: var\(--color-accent-text\)/.test(read('src/renderer/src/assets/main.css')))

process.exit(check.summary() ? 0 : 1)
