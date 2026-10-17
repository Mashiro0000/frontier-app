// Slice 17.2 under plain Node (no window): the rules for the third provider (D-049). What it shows:
//   A. registry/models.json at schema 0.6: Google is a provider, the two Gemini models as the plan says (their prices, the days the prices change, their limits,
//      their thinking levels), the other six models exactly what they were but for an empty `priceChanges`; a file of 0.5 is refused as a whole;
//   B. `priceChanges` read strictly: every kind of damage leaves that model out, says why, and keeps the others;
//   C. prices by date: `pricesOn`, `nextPriceChange`, `pricedOn` and `localDay`, at the edges of the two days (this computer's calendar);
//   D. what the page is told about a model: today's prices and the next change, nothing more;
//   E. the ledger keeps the prices a request was counted at: a request of 30 November and one of 1 December, summed later, each at its own;
//   F. the Google key file: `credentials.google.json` as the other two are (one file, tied to its provider, read back), the page's provider check;
//   G. the look for keys knows a Google key; the search fee table names Google; the words for Google in Settings;
//   H. source checks: chat.ts prices the reply at the day it begins and uses nothing else; the page's list is priced at one moment; the adapter table has Google.
// Run: node tools/guarded.mjs tools/verify-17-2.mjs      (ONLY=A,C runs some parts)
import './ts-resolve.mjs'
import { checker } from './cdp.mjs'
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { REPO, REPO_URL } from './paths.mjs'

const check = checker()
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(',')) : null
const guard = async (name, fn) => { if (ONLY && !ONLY.has(name)) return; try { await fn() } catch (error) { check(`${name} did not run to its end: ${String(error?.stack ?? error).slice(0, 400)}`, false) } }
const show = (v) => JSON.stringify(v)?.slice(0, 400)
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const near = (a, b) => Math.abs(a - b) < 1e-12
const source = (rel) => readFileSync(join(REPO, rel), 'utf8')
const SRC = `${REPO_URL}/src`
const R = await import(`${SRC}/shared/registry.ts`)
const U = await import(`${SRC}/shared/usage.ts`)
const V = await import(`${SRC}/shared/validate.ts`)
const L = await import(`${SRC}/main/usageLedger.ts`)
const C = await import(`${SRC}/main/credentialStore.ts`)
const S = await import(`${SRC}/main/secrets.ts`)
const file = JSON.parse(source('registry/models.json'))
const T = (y, m, d, h = 12, mi = 0, s = 0, ms = 0) => new Date(y, m - 1, d, h, mi, s, ms).getTime()
const ARGON0 = { inputPerMTok: 2, cacheReadPerMTok: 0.1, cacheWritePerMTok: 2, outputPerMTok: 10 }
const ARGON1 = { inputPerMTok: 4, cacheReadPerMTok: 0.2, cacheWritePerMTok: 4, outputPerMTok: 20 }
const FLASH0 = { inputPerMTok: 0.75, cacheReadPerMTok: 0.75, cacheWritePerMTok: 0.75, outputPerMTok: 3.75 }
const FLASH1 = { inputPerMTok: 1.5, cacheReadPerMTok: 1.5, cacheWritePerMTok: 1.5, outputPerMTok: 7.5 }

// ============ A. the file ============
await guard('A', async () => {
  const out = R.parseRegistry(file)
  check('A: the schema is 0.6, in the file and in the code', file.schemaVersion === '0.6' && R.REGISTRY_SCHEMA_VERSION === '0.6')
  check('A: the file is read whole, with no problem', out.ok && out.problems.length === 0, show(out.problems ?? out.error))
  check('A: three providers: anthropic, openai, google ("Google" to the person); Google\'s thinking words are low, medium and high', same(R.SUPPORTED_PROVIDERS, ['anthropic', 'openai', 'google']) && R.PROVIDER_NAMES.google === 'Google' && same(R.PROVIDER_EFFORTS.google, ['low', 'medium', 'high']))
  const by = Object.fromEntries(out.registry.models.map((m) => [m.id, m]))
  check('A: eight models; the two new ones last, in this order: gemini-4-argon, gemini-3.8-flash; the default is still Claude Opus 5.5', out.registry.models.map((m) => m.id).join() === 'claude-fable-5-1,claude-opus-5-5,claude-sonnet-5-5,gpt-6-astra,gpt-6.1-sol,gpt-6-luna,gemini-4-argon,gemini-3.8-flash' && out.registry.defaultModel.id === 'claude-opus-5-5')
  const a = by['gemini-4-argon']
  const f = by['gemini-3.8-flash']
  check('A: Gemini 4 Argon: Google, 1,048,576 tokens in, 65,536 out', a.provider === 'google' && a.contextWindow === 1048576 && a.maxOutputTokens === 65536)
  check('A: Gemini 4 Argon: $2 in, $10 out, cached $0.10 until 30 November 2026; from 1 December $4, $20, $0.20 (the pricing page)', same(a.pricing, ARGON0) && same(a.priceChanges, [{ from: '2026-12-01', pricing: ARGON1 }]))
  check('A: Gemini 3.8 Flash: $0.75 in and $3.75 out until 31 December 2026; from 1 January 2027 $1.50 and $7.50; its cached price is not published, so it is the input price (never less than billed)', same(f.pricing, FLASH0) && same(f.priceChanges, [{ from: '2027-01-01', pricing: FLASH1 }]))
  check('A: implicit caching has no write fee: a written token is priced as ordinary input', a.pricing.cacheWritePerMTok === a.pricing.inputPerMTok && f.pricing.cacheWritePerMTok === f.pricing.inputPerMTok)
  for (const m of [a, f]) {
    check(`A: ${m.id}: reads images and PDFs, takes tools, thinks, low/medium/high, the app's pick medium`, m.capabilities.imageInput && m.capabilities.documentInput && m.capabilities.toolUse && m.capabilities.reasoning && same(m.capabilities.effortLevels, ['low', 'medium', 'high']) && m.effort === 'medium')
  }
  check('A: the descriptions say what each is for, and that Argon needs a billed key', /most capable/.test(a.description) && /billed key/.test(a.description) && /everyday/.test(f.description))
  // the other six, against the file of main before this stage (git), but for the new empty field
  const before = JSON.parse(execFileSync('git', ['-C', REPO, 'show', 'b8ee65a:registry/models.json'], { encoding: 'utf8' }))
  const now = file.models.filter((m) => m.provider !== 'google')
  check('A: the six models of Anthropic and OpenAI are exactly what they were, but for "priceChanges": [] after "pricing"', now.length === 6 && now.every((m, i) => m.priceChanges.length === 0 && Object.keys(m).join() === Object.keys(before.models[i]).flatMap((k) => (k === 'pricing' ? [k, 'priceChanges'] : [k])).join() && same({ ...m, priceChanges: undefined }, { ...before.models[i], priceChanges: undefined })))
  check('A: the source line names Google\'s pages and fits 300 characters', /Google's Gemini/.test(file.source) && file.source.length <= 300 && file.updatedAt === '2026-10-17')
  const old = R.parseRegistry({ ...file, schemaVersion: '0.5' })
  check('A: a file of 0.5 is refused as a whole, and says which version this app reads', !old.ok && /reads 0\.6/.test(old.error))
  const noField = R.parseRegistry({ ...file, models: file.models.map(({ priceChanges, ...rest }) => (void priceChanges, rest)) })
  check('A: an entry without "priceChanges" (a 0.5 entry in a 0.6 file) is left out, and says so', !noField.ok && noField.problems.length === 8 && noField.problems.every((p) => /"priceChanges" missing/.test(p)))
  const wrongWord = R.parseRegistry({ ...file, models: file.models.map((m) => (m.id === 'gemini-3.8-flash' ? { ...m, capabilities: { ...m.capabilities, effortLevels: ['low', 'medium', 'xhigh'] } } : m)) })
  check('A: a level Google does not know (xhigh) leaves that model out', wrongWord.ok && wrongWord.problems.length === 1 && /not an effort level google knows/.test(wrongWord.problems[0]) && !wrongWord.registry.models.some((m) => m.id === 'gemini-3.8-flash'))
  const none = R.parseRegistry({ ...file, models: file.models.map((m) => (m.id === 'gemini-4-argon' ? { ...m, capabilities: { ...m.capabilities, effortLevels: ['none', 'low'] }, effort: 'low' } : m)) })
  check('A: ... and so does "none" (an OpenAI word)', none.ok && none.problems.length === 1 && !none.registry.models.some((m) => m.id === 'gemini-4-argon'))
})

// ============ B. priceChanges, strictly ============
await guard('B', async () => {
  const damaged = (change) => R.parseRegistry({ ...file, models: file.models.map((m) => (m.id === 'gemini-4-argon' ? { ...m, priceChanges: change(m.priceChanges) } : m)) })
  const cases = {
    'not a list': () => ({ from: '2026-12-01', pricing: ARGON1 }),
    'null': () => null,
    'eleven changes': () => Array.from({ length: 11 }, (_, i) => ({ from: `2027-01-${String(i + 10)}`, pricing: ARGON1 })),
    'a change that is not an object': () => ['2026-12-01'],
    'no "from"': () => [{ pricing: ARGON1 }],
    'an extra field': () => [{ from: '2026-12-01', pricing: ARGON1, note: 'doubles' }],
    'a day that does not exist (2026-02-30)': () => [{ from: '2026-02-30', pricing: ARGON1 }],
    'a day with a time': () => [{ from: '2026-12-01T00:00', pricing: ARGON1 }],
    'a number for the day': () => [{ from: 20261201, pricing: ARGON1 }],
    'the same day twice': () => [{ from: '2026-12-01', pricing: ARGON1 }, { from: '2026-12-01', pricing: ARGON0 }],
    'out of order': () => [{ from: '2027-01-01', pricing: ARGON1 }, { from: '2026-12-01', pricing: ARGON0 }],
    'a price missing': () => [{ from: '2026-12-01', pricing: { inputPerMTok: 4, cacheReadPerMTok: 0.2, outputPerMTok: 20 } }],
    'a price as text': () => [{ from: '2026-12-01', pricing: { ...ARGON1, outputPerMTok: '20' } }],
    'a price below 0': () => [{ from: '2026-12-01', pricing: { ...ARGON1, inputPerMTok: -4 } }],
    'a price above 10,000': () => [{ from: '2026-12-01', pricing: { ...ARGON1, outputPerMTok: 20000 } }],
    'a cached price above the input price': () => [{ from: '2026-12-01', pricing: { ...ARGON1, cacheReadPerMTok: 5 } }],
    'a misspelt price': () => [{ from: '2026-12-01', pricing: { inputPerMTok: 4, cacheReadPerMTok: 0.2, cacheWritePerMTok: 4, outputPerMtok: 20 } }]
  }
  for (const [name, make] of Object.entries(cases)) {
    const out = damaged(make)
    check(`B: ${name}: Gemini 4 Argon is left out with a reason, the other seven stay`, out.ok && out.registry.models.length === 7 && !out.registry.models.some((m) => m.id === 'gemini-4-argon') && out.problems.length === 1 && /gemini-4-argon/.test(out.problems[0]) && /priceChanges/.test(out.problems[0]), show(out.problems))
  }
  const two = damaged(() => [{ from: '2026-12-01', pricing: ARGON1 }, { from: '2027-06-01', pricing: { ...ARGON1, inputPerMTok: 3 } }])
  check('B: two changes in order are read, each a clean copy', two.ok && two.problems.length === 0 && two.registry.models.find((m) => m.id === 'gemini-4-argon').priceChanges.length === 2)
  const empty = damaged(() => [])
  check('B: an empty list is no change at all', empty.ok && empty.problems.length === 0 && empty.registry.models.find((m) => m.id === 'gemini-4-argon').priceChanges.length === 0)
  const input = [{ from: '2026-12-01', pricing: { ...ARGON1 } }]
  const copy = damaged(() => input)
  input[0].pricing.inputPerMTok = 999
  check('B: what is read is a copy: changing the input afterwards changes nothing', copy.registry.models.find((m) => m.id === 'gemini-4-argon').priceChanges[0].pricing.inputPerMTok === 4)
})

// ============ C. prices by date ============
await guard('C', async () => {
  const out = R.parseRegistry(file)
  const by = Object.fromEntries(out.registry.models.map((m) => [m.id, m]))
  const a = by['gemini-4-argon']
  const f = by['gemini-3.8-flash']
  check('C: localDay is this computer\'s calendar day', R.localDay(T(2026, 11, 30, 23, 59, 59, 999)) === '2026-11-30' && R.localDay(T(2026, 12, 1, 0, 0, 0, 0)) === '2026-12-01' && R.localDay(T(2027, 1, 1, 0, 0)) === '2027-01-01')
  check('C: Argon on the last moment of 30 November 2026: $2 / $10', same(R.pricesOn(a, T(2026, 11, 30, 23, 59, 59, 999)), ARGON0))
  check('C: Argon at midnight on 1 December 2026: $4 / $20', same(R.pricesOn(a, T(2026, 12, 1, 0, 0, 0, 0)), ARGON1))
  check('C: Argon today (17 October 2026) and in 2030', same(R.pricesOn(a, T(2026, 10, 17)), ARGON0) && same(R.pricesOn(a, T(2030, 6, 1)), ARGON1))
  check('C: Flash on 31 December 2026 at 23:59 and on 1 January 2027', same(R.pricesOn(f, T(2026, 12, 31, 23, 59, 59, 999)), FLASH0) && same(R.pricesOn(f, T(2027, 1, 1, 0, 0, 0, 0)), FLASH1))
  check('C: Claude Opus 5.5 (no change announced) is its own price on every day', same(R.pricesOn(by['claude-opus-5-5'], T(2026, 12, 1)), by['claude-opus-5-5'].pricing) && same(R.pricesOn(by['claude-opus-5-5'], T(2031, 1, 1)), by['claude-opus-5-5'].pricing))
  const p = R.pricesOn(a, T(2026, 12, 2))
  p.inputPerMTok = 999
  check('C: pricesOn hands back a copy', a.priceChanges[0].pricing.inputPerMTok === 4 && R.pricesOn(a, T(2026, 12, 2)).inputPerMTok === 4)
  check('C: the next change: on 17 October Argon\'s is 1 December, Flash\'s 1 January; on 1 December Argon has none left; Opus never has one', R.nextPriceChange(a, T(2026, 10, 17))?.from === '2026-12-01' && same(R.nextPriceChange(a, T(2026, 10, 17)).pricing, ARGON1) && R.nextPriceChange(f, T(2026, 10, 17))?.from === '2027-01-01' && R.nextPriceChange(a, T(2026, 12, 1, 0, 0)) === null && R.nextPriceChange(by['claude-opus-5-5'], T(2026, 10, 17)) === null)
  check('C: on 30 November the change of the next day is still "next"', R.nextPriceChange(a, T(2026, 11, 30, 23, 59))?.from === '2026-12-01')
  const priced = R.pricedOn(a, T(2026, 12, 5))
  check('C: pricedOn: the same entry, priced at that day (everything else as it was, the registry\'s entry untouched)', same(priced.pricing, ARGON1) && same({ ...priced, pricing: null }, { ...a, pricing: null }) && same(a.pricing, ARGON0))
  // a request's cost at the two prices: 1,000,000 in, 100,000 out, 4,000 cached
  const tokens = { input: 1_000_000, cacheRead: 4_000, cacheWrite: 0, output: 100_000 }
  check('C: the same request costs $3.0004 on 30 November and $6.0008 on 1 December', near(U.costOf(tokens, R.pricesOn(a, T(2026, 11, 30))), 3.0004) && near(U.costOf(tokens, R.pricesOn(a, T(2026, 12, 1))), 6.0008))
})

// ============ D. what the page is told ============
await guard('D', async () => {
  const out = R.parseRegistry(file)
  const by = Object.fromEntries(out.registry.models.map((m) => [m.id, m]))
  const o = R.toModelOption(by['gemini-4-argon'], T(2026, 10, 17))
  check('D: a model option has exactly id, label, provider, description, contextWindow, pricing, priceChange, imageInput, documentInput', Object.keys(o).sort().join() === 'contextWindow,description,documentInput,id,imageInput,label,priceChange,pricing,provider', Object.keys(o).join())
  check('D: Argon today: $2 / $10, and the change of 1 December with its prices', same(o.pricing, ARGON0) && same(o.priceChange, { from: '2026-12-01', pricing: ARGON1 }) && o.provider === 'google')
  const later = R.toModelOption(by['gemini-4-argon'], T(2026, 12, 3))
  check('D: Argon on 3 December: $4 / $20 and no change coming', same(later.pricing, ARGON1) && later.priceChange === null)
  check('D: Claude Opus 5.5: its prices and no change', R.toModelOption(by['claude-opus-5-5'], T(2026, 10, 17)).priceChange === null)
  check('D: nothing about how it is called (no effort, no limits, no capabilities)', !/effort|maxOutputTokens|capabilit|priceChanges/.test(JSON.stringify(o)))
  const o2 = R.toModelOption(by['gemini-4-argon'], T(2026, 10, 17))
  o2.priceChange.pricing.inputPerMTok = 999
  o2.pricing.inputPerMTok = 999
  check('D: the option is a copy', by['gemini-4-argon'].priceChanges[0].pricing.inputPerMTok === 4 && by['gemini-4-argon'].pricing.inputPerMTok === 2)
  check('D: with no moment given, it is now', same(R.toModelOption(by['gemini-4-argon']).pricing, R.pricesOn(by['gemini-4-argon'], Date.now())))
})

// ============ E. the ledger keeps the prices of the day ============
await guard('E', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'frontier-17-2-'))
  let clock = T(2026, 11, 30, 23, 59, 30)
  const out = R.parseRegistry(file)
  const a = out.registry.models.find((m) => m.id === 'gemini-4-argon')
  const ledger = L.createUsageLedger(join(dir, 'usage.jsonl'), { now: () => clock })
  const begin = (chat) => ledger.begin({ chat, provider: 'google', model: a.id, effort: 'medium', prices: R.pricedOn(a, clock).pricing, inputTokens: 1000 })
  const r1 = await begin('11111111-1111-4111-8111-111111111111')
  await ledger.finish(r1.id, { state: 'done', tokens: { input: 1_000_000, cacheRead: 0, cacheWrite: 0, output: 100_000 }, estimate: false })
  clock = T(2026, 12, 1, 0, 0, 30)
  const r2 = await begin('22222222-2222-4222-8222-222222222222')
  await ledger.finish(r2.id, { state: 'done', tokens: { input: 1_000_000, cacheRead: 0, cacheWrite: 0, output: 100_000 }, estimate: false })
  check('E: a record of the provider "google" is written and read (the ledger takes the third provider)', r1.provider === 'google' && r2.provider === 'google')
  check('E: the record of 30 November keeps $2 / $10, the record of 1 December $4 / $20', same(r1.prices, ARGON0) && same(r2.prices, ARGON1))
  clock = T(2026, 12, 15)
  const again = L.createUsageLedger(join(dir, 'usage.jsonl'), { now: () => clock })
  const one = await again.summary('11111111-1111-4111-8111-111111111111')
  const two = await again.summary('22222222-2222-4222-8222-222222222222')
  check('E: read again from the disk two weeks later, each chat costs what it cost on its day: $3 and $6', near(one.chat.costUsd, 3) && near(two.chat.costUsd, 6), show([one.chat.costUsd, two.chat.costUsd]))
  check('E: this month (December) holds only the second ($6)', near(two.month.costUsd, 6))
  const lines = readFileSync(join(dir, 'usage.jsonl'), 'utf8').trim().split('\n').map((l) => U.parseLedgerRecord(JSON.parse(l)))
  check('E: every line of the file is read strictly as a record of "google"', lines.length === 4 && lines.every((r) => r !== null && r.provider === 'google'))
  const foreign = U.parseLedgerRecord({ ...JSON.parse(readFileSync(join(dir, 'usage.jsonl'), 'utf8').trim().split('\n')[0]), provider: 'gemini' })
  check('E: a record of a provider this app does not know ("gemini") is not read', foreign === null)
})

// ============ F. the Google key file ============
await guard('F', async () => {
  const secret = randomBytes(32)
  const box = {
    isAvailable: () => true,
    encrypt(plain) { const iv = randomBytes(12); const c = createCipheriv('aes-256-gcm', secret, iv); const body = Buffer.concat([c.update(plain, 'utf8'), c.final()]); return Buffer.concat([iv, c.getAuthTag(), body]) },
    decrypt(blob) { const d = createDecipheriv('aes-256-gcm', secret, blob.subarray(0, 12)); d.setAuthTag(blob.subarray(12, 28)); return Buffer.concat([d.update(blob.subarray(28)), d.final()]).toString('utf8') }
  }
  const dir = mkdtempSync(join(tmpdir(), 'frontier-17-2-keys-'))
  const store = C.createCredentialStore(dir, box)
  const KEY = 'AIza' + randomBytes(27).toString('base64url').slice(0, 35)
  check('F: no Google key at first', (await store.read('google')) === null)
  await store.save('google', KEY)
  check('F: saved and read back', (await store.read('google')) === KEY)
  check('F: one file, credentials.google.json', same(readdirSync(dir), ['credentials.google.json']) && C.credentialFileName('google') === 'credentials.google.json')
  const stored = JSON.parse(readFileSync(join(dir, 'credentials.google.json'), 'utf8'))
  check('F: it holds { version: 2, provider: "google", key } and the key only encrypted', Object.keys(stored).join() === 'version,provider,key' && stored.version === 2 && stored.provider === 'google' && !JSON.stringify(stored).includes(KEY))
  check('F: the other two providers have no key from it', (await store.read('anthropic')) === null && (await store.read('openai')) === null)
  const dir2 = mkdtempSync(join(tmpdir(), 'frontier-17-2-keys-'))
  writeFileSync(join(dir2, 'credentials.openai.json'), readFileSync(join(dir, 'credentials.google.json')))
  writeFileSync(join(dir2, 'credentials.anthropic.json'), readFileSync(join(dir, 'credentials.google.json')))
  const store2 = C.createCredentialStore(dir2, box)
  check('F: the Google file put under OpenAI\'s or Anthropic\'s name is read as nothing: a Google key never goes to another provider', (await store2.read('openai')) === null && (await store2.read('anthropic')) === null)
  mkdirSync(join(dir2, 'g'))
  const store3 = C.createCredentialStore(join(dir2, 'g'), box)
  writeFileSync(join(dir2, 'g', 'credentials.google.json'), JSON.stringify({ version: 2, provider: 'openai', key: stored.key }))
  check('F: a file named for Google that says it is OpenAI\'s is read as nothing', (await store3.read('google')) === null)
  check('F: the page may name "google"; "gemini", "Google" and "google " are refused', V.checkProvider('google').ok && !V.checkProvider('gemini').ok && !V.checkProvider('Google').ok && !V.checkProvider('google ').ok)
  const sub = V.checkKeySubmission({ provider: 'google', key: ` ${KEY} ` })
  check('F: a Google key (39 characters, "AIza...") is taken, trimmed', sub.ok && sub.provider === 'google' && sub.key === KEY)
})

// ============ G. keys, fees, words ============
await guard('G', async () => {
  const KEY = 'AIza' + 'Sy' + randomBytes(27).toString('base64url').slice(0, 33)
  check('G: (the key of this test has the shape of a Google key: 39 characters)', KEY.length === 39)
  check('G: text that holds the saved Google key is found, and named as Google\'s', S.heldKey(`my notes ${KEY} end`, [{ provider: 'google', key: KEY }]) === 'google')
  check('G: the sentence names Google', /Google API key/.test(S.keyInNotes('google')) && /Google API key/.test(S.keyInInstructions('google', 'for this chat')))
  check('G: a Google key that is not saved is still found by its shape', S.findLookalikes(`key ${KEY}`).some((f) => /Google API key/.test(f.what)), show(S.findLookalikes(`key ${KEY}`)))
  check('G: the search fee table names Google ($14 per 1,000; never used: Google Search is not offered)', U.SEARCH_FEE_USD.google === 0.014 && Object.isFrozen(U.SEARCH_FEE_USD))
  const copy = source('src/renderer/src/settings/providerCopy.ts')
  check('G: Settings says what a Google key is for and where to make one', /google: \{ uses: "Google's Gemini models", whereToCreate: 'Google AI Studio' \}/.test(copy))
  check('G: the system prompt does not call a Gemini model Claude', /google: 'an AI assistant'/.test(source('src/main/providers/request.ts')))
})

// ============ H. sources ============
await guard('H', async () => {
  const chat = source('src/main/chat.ts')
  check('H: chat.ts prices the reply at the day it begins (pricedOn(model.entry, Date.now()))', /const entry = pricedOn\(model\.entry, Date\.now\(\)\)/.test(chat))
  check('H: chat.ts uses the registry\'s entry nowhere else (every price of the reply is that day\'s)', (chat.match(/model\.entry/g) ?? []).length === 1)
  const ipc = source('src/main/ipc.ts')
  check('H: the page\'s list is priced at one moment for every model', /const now = Date\.now\(\)/.test(ipc) && /registry\.registry\.models\.map\(\(entry\) => toModelOption\(entry, now\)\)/.test(ipc) && !/map\(toModelOption\)/.test(ipc))
  const index = source('src/main/providers/index.ts')
  check('H: the adapter table has an entry for Google', /google: geminiAdapter/.test(index))
  check('H: no Google package and no Google address in the app yet (the adapter is 17.3)', !/@google\//.test(source('package.json')) && !/googleapis\.com/.test(source('src/main/providers/gemini.ts')))
})

process.exit(check.summary() ? 0 : 1)
