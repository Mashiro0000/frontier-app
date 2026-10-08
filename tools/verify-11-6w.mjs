// Stage 11.6 (D-041), in the real window against the mock: what a search costs. With the search on, a search that ran is a ledger record of its own with the
// provider's fee beside the tokens (one cent), the sums and the cost the reply reports include it, the box says "about one cent", a search that failed is not
// billed, and a search that the spending limit would not allow is not asked about. No console errors.
// Needs: USER_DATA_DIR (scratch), INSPECT_PORT, MOCK_PORT, a saved key (setup-key.mjs).
import './ts-resolve.mjs'
import { connect, checker, sleep } from './cdp.mjs'
import { assertScratchProfile } from './profile-guard.mjs'
import { h4, mainInspector } from './lib4.mjs'
import { installQuestions } from './lib10.mjs'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const port = Number(process.argv[3] ?? 9222)
const userData = process.env.USER_DATA_DIR
const inspectPort = Number(process.env.INSPECT_PORT)
const mockUrl = `http://127.0.0.1:${process.env.MOCK_PORT}`
if (!userData || !inspectPort || !process.env.MOCK_PORT) throw new Error('USER_DATA_DIR, INSPECT_PORT and MOCK_PORT must be set')
const check = checker()
const page = await connect(port)
await assertScratchProfile()
const H = h4(page, { userData, mockUrl })
const { ev } = H
const main = await mainInspector(inspectPort)
const Q = await installQuestions(main, { fallback: 'no' })
const show = (v) => JSON.stringify(v)?.slice(0, 500)
const control = (body) => fetch(`${mockUrl}/__tools`, { method: 'POST', body: JSON.stringify(body) })
const ASK = '[[mock:tool-use]] find the newest release of Rust'
const ledgerLines = () => readFileSync(join(userData, 'usage', 'ledger.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l))
const lastOf = (lines) => { const byId = new Map(); for (const l of lines) byId.set(l.id, l); return [...byId.values()] }
async function converse(text) {
  await ev(`window.__ev.length = 0; true`)
  await H.send(text)
  await page.waitFor(`!!document.querySelector('.composer-button[type=submit]')`, { timeoutMs: 40000 })
  await sleep(500)
  return ev(`window.__ev.map((e) => ({ ...e }))`)
}

try {
  await page.waitFor(`document.readyState === 'complete' && !!document.querySelector('.header-select, .app-badge')`, { timeoutMs: 15000 })
  await sleep(300)
  await ev(`window.__ev = []; window.__off = window.api.chat.onEvent((e) => window.__ev.push(e)); true`)
  await ev(`window.api.settings.setModel('claude-opus-5-5')`)
  writeFileSync(join(userData, 'tools.json'), JSON.stringify({ version: 1, enabled: { web_search: true }, caps: { steps: 5, seconds: 60 } }))

  // ============ A. a search that ran is billed ============
  await Q.reset()
  await Q.queue('yes')
  const events = await converse(ASK)
  const box = (await Q.asked())[0]?.options?.detail ?? ''
  check('A: the box says what a search costs: about one cent on top of the usual cost of the reply', /about one cent, on top of the usual cost of the reply/.test(box), box.slice(0, 300))
  const records = lastOf(ledgerLines())
  const searchRecord = records.find((r) => r.search !== undefined)
  check('A: the ledger has one record with the search: one search, one cent', records.filter((r) => r.search !== undefined).length === 1 && searchRecord.search.count === 1 && searchRecord.search.usdEach === 0.01, show(searchRecord))
  check('A: the two requests of the model (before and after) and the search are three records, only the search carrying the fee', records.length === 3 && records.filter((r) => r.search === undefined).length === 2)
  const usageEvent = events.find((e) => e.type === 'usage')?.usage
  const tokensCost = records.reduce((sum, r) => sum + (r.tokens.input * r.prices.inputPerMTok + r.tokens.cacheRead * r.prices.cacheReadPerMTok + r.tokens.cacheWrite * r.prices.cacheWritePerMTok + r.tokens.output * r.prices.outputPerMTok) / 1e6, 0)
  check('A: the cost the reply reports is the tokens of all three requests plus the cent', usageEvent !== undefined && Math.abs(usageEvent.costUsd - (tokensCost + 0.01)) < 1e-9, show([usageEvent?.costUsd, tokensCost]))
  const sums = await ev(`window.api.usage.summary(null)`)
  check('A: the sums (today) include it', Math.abs(sums.today.costUsd - (tokensCost + 0.01)) < 1e-9 && sums.today.requests === 3, show(sums.today))

  // ============ B. a search that failed is not billed ============
  await control({ search: { mode: 'fail' } })
  await sleep(3300)
  await Q.reset()
  await Q.queue('yes')
  await H.clickChat('New chat')
  await converse(ASK)
  const after = lastOf(ledgerLines())
  const failed = after.filter((r) => r.search === undefined && r.effort === 'low' && !records.some((o) => o.id === r.id))
  check('B: a search the provider failed has a record and no fee', after.length === 6 && failed.length >= 1 && after.filter((r) => r.search !== undefined).length === 1, show(after.map((r) => [r.state, r.search ?? null])))
  await control({})

  // ============ C. a search the limit would not allow is not asked about ============
  await H.clickChat('New chat')
  const spent = (await ev(`window.api.usage.summary(null)`)).today.costUsd
  const limitUsd = Math.ceil((spent + 0.015) * 100) / 100
  await ev(`window.api.settings.setLimits({ daily: { kind: 'usd', usd: ${limitUsd} }, monthly: { kind: 'none' } })`)
  await Q.reset()
  await sleep(300)
  const before = (await H.mockReqs()).length
  const ev2 = await converse(ASK)
  const asked2 = await Q.count()
  const toolTypes = ev2.filter((e) => e.type === 'tool').map((e) => e.event.type + (e.event.code ? ':' + e.event.code : '')).join()
  check('C: with a daily limit that the search would pass (its fee alone is a cent), nobody is asked and the call is refused as "limit"', asked2 === 0 && /refused:limit/.test(toolTypes), show([asked2, toolTypes, limitUsd, spent]))
  const cards = await ev(`[...document.querySelectorAll('.message-assistant .tool-note-outcome')].map((n) => n.textContent)`)
  check('C: the chat says so in words', cards.some((c) => /spending limit you set would be passed, so you were not asked/.test(c)), show(cards))
} catch (error) {
  check(`the suite stopped before its end: ${String(error?.stack ?? error).slice(0, 400)}`, false)
}

check('the page logged no errors and no warnings', page.problems.length === 0, show(page.problems))
main.close()
page.close()
process.exit(check.summary() ? 0 : 1)
