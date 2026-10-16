// Slice 16.2 under plain Node (no window): the rules of image generation (D-048), as plain functions. What it shows:
//   A. registry/images.json: the real file reads, says what OpenAI's table says, and is read as strictly as models.json (every kind of damage makes it unusable);
//   B. retirement: a model that retires within 30 days is marked, a retired one cannot be asked for, and the log is told;
//   C. cost and the request: the most a request can cost for every shape, quality and count, "about" for the ceilings, the cost from tokens; what the page may send
//      (exactly the six fields, the description kept exactly as typed, every other value refused);
//   D. the ledger's image fee: read strictly, counted in the sums, reserved before and replaced after, a refused request owes nothing, a request that never ended counts its most;
//   E. the picture checker: PNG, JPEG and WebP by their header, nothing else, the count, base64 only, the size and edge caps;
//   F. images.json (the gallery's index): read strictly, written and read back, sealed like the chats;
//   G. image-settings.json: off unless the file says exactly otherwise;
//   H. what the source must keep true.
// Run: node tools/guarded.mjs tools/verify-16-2.mjs      (ONLY=A,C runs some parts)
import './ts-resolve.mjs'
import { checker } from './cdp.mjs'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { REPO, REPO_URL } from './paths.mjs'
import { makeBox } from './lib8b3.mjs'
import { lyingPng, solidPng } from './mock-images.mjs'

const check = checker()
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(',')) : null
const guard = async (name, fn) => { if (ONLY && !ONLY.has(name)) return; try { await fn() } catch (error) { check(`${name} did not run to its end: ${String(error?.stack ?? error).slice(0, 400)}`, false) } }
const show = (v) => JSON.stringify(v)?.slice(0, 400)
const SRC = `${REPO_URL}/src`
const I = await import(`${SRC}/shared/images.ts`)
const U = await import(`${SRC}/shared/usage.ts`)
const L = await import(`${SRC}/main/usageLedger.ts`)
const C = await import(`${SRC}/main/imageCheck.ts`)
const X = await import(`${SRC}/main/imageIndex.ts`)
const S = await import(`${SRC}/main/imageSettings.ts`)
const source = (rel) => readFileSync(join(REPO, rel), 'utf8')
const REAL = JSON.parse(source('registry/images.json'))
const clone = (v) => JSON.parse(JSON.stringify(v))
const root = mkdtempSync(join(tmpdir(), 'frontier-162-'))
const DAY = 86_400_000
const NOW = new Date(2026, 9, 16, 12, 0, 0).getTime()
const UUID = '0b8f0e2a-6c1d-4e8b-9a77-2f4d5c6b7a81'

// ============ A. registry/images.json ============
await guard('A', async () => {
  const r = I.parseImagesRegistry(REAL)
  check('A: the real file reads, with nothing to say', r.ok && r.problems.length === 0, show(r.ok ? r.problems : r.error))
  const reg = r.registry
  check('A: three models, gpt-image-2 the default (the owner\'s pick)', reg.models.map((m) => m.id).join() === 'gpt-image-2,gpt-image-2.5-flare,gpt-image-2.5-sunburst' && reg.defaultModelId === 'gpt-image-2')
  const g2 = reg.models[0]
  check('A: gpt-image-2 carries OpenAI\'s own table (square 0.006 / 0.053 / 0.211; portrait and landscape 0.005 / 0.041 / 0.165) and says it is published', g2.published && show(g2.perPicture) === show({ square: { low: 0.006, medium: 0.053, high: 0.211 }, portrait: { low: 0.005, medium: 0.041, high: 0.165 }, landscape: { low: 0.005, medium: 0.041, high: 0.165 } }))
  check('A: the 2.5 models carry the ceiling, twice the gpt-image-2 high figure, and say it is not published', reg.models.slice(1).every((m) => !m.published && m.perPicture.square.high === 2 * g2.perPicture.square.high && m.perPicture.portrait.high === 2 * g2.perPicture.portrait.high && m.perPicture.landscape.low === 2 * g2.perPicture.landscape.high))
  check('A: the prices per million tokens: $5 text in, $30 picture out', reg.models.every((m) => m.prices.textInPerMTok === 5 && m.prices.imageOutPerMTok === 30))
  check('A: no model of the file retires yet (none is announced)', reg.models.every((m) => m.retires === null))
  check('A: the result is frozen', Object.isFrozen(reg) && Object.isFrozen(reg.models) && Object.isFrozen(g2.perPicture.square))
  const text = source('registry/images.json')
  check('A: the file holds no address and nothing like a key', !/:\/\//.test(text) && !/sk-/.test(text))
  const broken = {
    'a field more at the top': (f) => { f.extra = 1 },
    'a field less at the top': (f) => { delete f.source },
    'another schemaVersion': (f) => { f.schemaVersion = '2' },
    'a schemaVersion as a number': (f) => { f.schemaVersion = 1 },
    'updatedAt not a day': (f) => { f.updatedAt = '2026-02-30' },
    'an address in the source': (f) => { f.source = 'see https://example.com' },
    'no models': (f) => { f.models = [] },
    'thirteen models': (f) => { f.models = Array.from({ length: 13 }, (_, i) => ({ ...clone(REAL.models[0]), id: `gpt-image-x${i}` })) },
    'a model with a field more': (f) => { f.models[0].endpoint = 'x' },
    'a model with a field less': (f) => { delete f.models[0].published },
    'a model that is not an OpenAI image model': (f) => { f.models[0].id = 'dall-e-3' },
    'a model id with a capital': (f) => { f.models[0].id = 'gpt-image-2X' },
    'a model listed twice': (f) => { f.models[1].id = 'gpt-image-2' },
    'a label with a control character': (f) => { f.models[0].label = 'GPT\u0007Image' },
    'a label with a reversing mark': (f) => { f.models[0].label = 'GPT \u202eImage' },
    'a label with an address': (f) => { f.models[0].label = 'http://x' },
    'a label that looks like a key': (f) => { f.models[0].label = 'key sk-abc123' },
    'an empty label': (f) => { f.models[0].label = '' },
    'a description of 301 characters': (f) => { f.models[0].description = 'x'.repeat(301) },
    'a retirement day that is not a day': (f) => { f.models[0].retires = '2026-13-01' },
    'a retirement day as a number': (f) => { f.models[0].retires = 20261201 },
    'published as a string': (f) => { f.models[0].published = 'true' },
    'a price of 0': (f) => { f.models[0].prices.imageOutPerMTok = 0 },
    'a price as a string': (f) => { f.models[0].prices.textInPerMTok = '5' },
    'a price field more': (f) => { f.models[0].prices.imageInPerMTok = 8 },
    'a table without a shape': (f) => { delete f.models[0].perPicture.portrait },
    'a table with a quality more': (f) => { f.models[0].perPicture.square.xhigh = 0.3 },
    'a picture price of 0': (f) => { f.models[0].perPicture.square.low = 0 },
    'a picture price above $5': (f) => { f.models[0].perPicture.square.high = 5.01 },
    'a picture price that is not a number': (f) => { f.models[0].perPicture.square.high = null },
    'a table where high costs less than medium': (f) => { f.models[0].perPicture.square.high = 0.01 },
    'an array for the file': () => [],
    'null for the file': () => null
  }
  for (const [what, damage] of Object.entries(broken)) {
    const f = clone(REAL)
    const replaced = damage(f)
    const out = I.parseImagesRegistry(replaced === undefined ? f : replaced)
    if (out.ok) check(`A: refused: ${what}`, false, 'it was read')
  }
  check(`A: every one of ${Object.keys(broken).length} kinds of damage makes the file unusable`, Object.entries(broken).every(([, damage]) => { const f = clone(REAL); const replaced = damage(f); return !I.parseImagesRegistry(replaced === undefined ? f : replaced).ok }))
  const f = clone(REAL)
  f.defaultModelId = 'gpt-image-9'
  const d = I.parseImagesRegistry(f)
  check('A: a default that is not in the list is said, and the first model with no retirement day is used', d.ok && d.registry.defaultModelId === 'gpt-image-2' && /not in the list/.test(d.problems[0]), show(d.ok && d.problems))
  check('A: 2028-02-29 is a day, 2027-02-29 is not', I.isDay('2028-02-29') && !I.isDay('2027-02-29') && !I.isDay('2026-1-01'))
})

// ============ B. retirement ============
await guard('B', async () => {
  const reg = I.parseImagesRegistry(REAL).registry
  const at = (days) => ({ ...reg.models[0], retires: I.dayOf(NOW + days * DAY) })
  check('B: no day: ok', I.retirement(reg.models[0], NOW) === 'ok')
  check('B: in 31 days: ok', I.retirement(at(31), NOW) === 'ok')
  check('B: in 30 days: retiring', I.retirement(at(30), NOW) === 'retiring')
  check('B: tomorrow: retiring', I.retirement(at(1), NOW) === 'retiring')
  check('B: today: retired (the shutdown day itself)', I.retirement(at(0), NOW) === 'retired')
  check('B: a month ago: retired', I.retirement(at(-30), NOW) === 'retired')
  check('B: gpt-image-1, which shuts on 23 October 2026, is retiring on 16 October and retired on the 23rd', I.retirement({ ...reg.models[0], retires: '2026-10-23' }, NOW) === 'retiring' && I.retirement({ ...reg.models[0], retires: '2026-10-23' }, new Date(2026, 9, 23, 0, 30).getTime()) === 'retired')
  const f = clone(REAL)
  f.models[1].retires = I.dayOf(NOW + 10 * DAY)
  f.models[2].retires = I.dayOf(NOW - DAY)
  const r2 = I.parseImagesRegistry(f).registry
  const warnings = I.retirementWarnings(r2, NOW)
  check('B: the log is told of the model that retires soon and the one that has retired, and of no other', warnings.length === 2 && /Flare .* is retired by OpenAI on/.test(warnings[0]) && /Sunburst .* was retired .* cannot be chosen/.test(warnings[1]), show(warnings))
  const ask = { prompt: 'a cat', model: 'gpt-image-2.5-sunburst', shape: 'square', quality: 'low', count: 1, chat: null }
  const refused = I.checkImageAsk(ask, r2, NOW)
  check('B: a retired model cannot be asked for, and the sentence says when it retired', !refused.ok && /was retired by OpenAI on/.test(refused.error), show(refused))
  check('B: a retiring one still can', I.checkImageAsk({ ...ask, model: 'gpt-image-2.5-flare' }, r2, NOW).ok)
})

// ============ C. cost and the request ============
await guard('C', async () => {
  const reg = I.parseImagesRegistry(REAL).registry
  const [g2, flare] = reg.models
  const table = { square: [0.006, 0.053, 0.211], portrait: [0.005, 0.041, 0.165], landscape: [0.005, 0.041, 0.165] }
  let all = true
  for (const shape of ['square', 'portrait', 'landscape']) for (const [qi, quality] of ['low', 'medium', 'high'].entries()) for (const count of [1, 2, 3, 4]) {
    const m = I.maximumCost(g2, shape, quality, count, 0)
    if (Math.abs(m.usd - (table[shape][qi] + 0.0005) * count) > 1e-12 || m.about) { all = false; check(`C: ${shape} ${quality} x${count}`, false, show(m)) }
  }
  check('C: the most for gpt-image-2 is the table figure and its rounding ($0.0005, 16.7) times the count, for all 36 choices, and not "about"', all)
  const words = I.maximumCost(g2, 'square', 'medium', 1, 4000).usd - I.maximumCost(g2, 'square', 'medium', 1, 0).usd
  check('C: (16.7) a description adds its bytes as words in at $5 a million, once a request: 4,000 bytes are $0.02, for one picture or four', Math.abs(words - 0.02) < 1e-12 && Math.abs(I.maximumCost(g2, 'square', 'medium', 4, 4000).usd - I.maximumCost(g2, 'square', 'medium', 4, 0).usd - 0.02) < 1e-12)
  check('C: (16.7) the bytes, not the characters: "é" is two, a CJK character three, an emoji four', I.promptBytes('é') === 2 && I.promptBytes('猫') === 3 && I.promptBytes('😀') === 4 && I.promptBytes('abc') === 3)
  check('C: (16.7) the most is never under what the usage of the probe would bill: 9 words in and 1,767 out ($0.053055) against one standard square with a 36-byte description', I.costFromTokens(g2, { input: 9, output: 1767 }) <= I.maximumCost(g2, 'square', 'medium', 1, 36).usd)
  const f4 = I.maximumCost(flare, 'square', 'high', 4, 0)
  check('C: four high squares of Flare are at most $1.69, "about" (above the $0.50 that asks)', Math.abs(f4.usd - 1.69) < 1e-9 && f4.about && f4.usd > I.IMAGE_LIMITS.askAboveUsd)
  check('C: an ordinary standard square of gpt-image-2 ($0.053) does not ask', I.maximumCost(g2, 'square', 'medium', 1, 0).usd < I.IMAGE_LIMITS.askAboveUsd)
  check('C: four high squares of gpt-image-2 ($0.846) ask', I.maximumCost(g2, 'square', 'high', 4, 0).usd > I.IMAGE_LIMITS.askAboveUsd)
  check('C: the cost from tokens: 9 words in and 1,767 out is $0.053055', Math.abs(I.costFromTokens(g2, { input: 9, output: 1767 }) - (9 * 5 + 1767 * 30) / 1e6) < 1e-12)
  const ok = { prompt: '  A red bicycle\nleaning on a wall  ', model: 'gpt-image-2', shape: 'portrait', quality: 'high', count: 2, chat: UUID }
  const got = I.checkImageAsk(ok, reg, NOW)
  check('C: a request as the page sends it is taken', got.ok, show(got))
  check('C: the description is kept EXACTLY as typed (spaces and the line break too: no rewrite)', got.ok && got.ask.prompt === ok.prompt)
  check('C: the size comes from the shape, never from the page', got.ok && got.ask.size === '1024x1536' && got.ask.model === g2 && got.ask.count === 2 && got.ask.chat === UUID)
  check('C: the three shapes are the three ordinary sizes', show(I.IMAGE_SHAPES) === show({ square: '1024x1024', portrait: '1024x1536', landscape: '1536x1024' }))
  const bad = {
    'a field more (a size)': { ...ok, size: '3840x2160' },
    'a field more (an address)': { ...ok, baseURL: 'http://x' },
    'a field less': (() => { const { chat, ...rest } = ok; return rest })(),
    'a description of 4,001 characters': { ...ok, prompt: 'x'.repeat(4001) },
    'an empty description': { ...ok, prompt: '' },
    'a description of spaces': { ...ok, prompt: '   \n ' },
    'a description with a control character': { ...ok, prompt: 'a cat\u0000' },
    'a description with a reversing mark': { ...ok, prompt: 'a cat \u202e' },
    'a description that is not text': { ...ok, prompt: ['a cat'] },
    'a model not in the file': { ...ok, model: 'gpt-image-1' },
    'a model of another kind': { ...ok, model: 'claude-opus-5-5' },
    'a shape not offered': { ...ok, shape: 'banner' },
    'a quality not offered (xhigh)': { ...ok, quality: 'xhigh' },
    'a quality spelled as the dialog shows it': { ...ok, quality: 'High' },
    'no pictures': { ...ok, count: 0 },
    'five pictures': { ...ok, count: 5 },
    'one and a half pictures': { ...ok, count: 1.5 },
    'a count as text': { ...ok, count: '2' },
    'a chat that is not an id': { ...ok, chat: '../x' },
    'an array': [ok],
    'null': null
  }
  for (const [what, input] of Object.entries(bad)) {
    const out = I.checkImageAsk(input, reg, NOW)
    if (out.ok) check(`C: refused: ${what}`, false, 'it was taken')
  }
  check(`C: every one of ${Object.keys(bad).length} wrong requests is refused`, Object.values(bad).every((input) => !I.checkImageAsk(input, reg, NOW).ok))
  check('C: the description of exactly 4,000 characters is taken', I.checkImageAsk({ ...ok, prompt: 'y'.repeat(4000) }, reg, NOW).ok)
  check('C: a tab in a description is taken', I.checkImageAsk({ ...ok, prompt: 'a\tcat' }, reg, NOW).ok)
  const long = I.checkImageAsk({ ...ok, prompt: 'x'.repeat(4001) }, reg, NOW)
  check('C: the sentence for a long description says the limit', /longer than 4,000 characters/.test(long.error), long.error)
  check('C: the sentence for a blank one asks for a description', I.checkImageAsk({ ...ok, prompt: ' ' }, reg, NOW).error === I.IMAGE_WORDS.noPrompt)
})

// ============ D. the ledger's image fee ============
await guard('D', async () => {
  const base = { version: 1, id: '00000000-0000-4000-8000-000000000001', at: NOW, chat: null, provider: 'openai', model: 'gpt-image-2', effort: null, state: 'done', estimate: false, tokens: { input: 9, cacheRead: 0, cacheWrite: 0, output: 1767 }, prices: { inputPerMTok: 0, cacheReadPerMTok: 0, cacheWritePerMTok: 0, outputPerMTok: 0 } }
  const rec = U.parseLedgerRecord({ ...base, image: { kind: 'generate', count: 2, usd: 0.106 } })
  check('D: a record with an image fee reads', rec !== null && show(rec.image) === show({ kind: 'generate', count: 2, usd: 0.106 }))
  check('D: its cost is the fee (its tokens are priced at 0)', rec !== null && Math.abs(U.costOfRecord(rec) - 0.106) < 1e-12)
  check('D: the line written carries the cost beside it for a reader', JSON.parse(U.ledgerLine(rec)).costUsd === 0.106)
  const wrong = { 'a field more': { kind: 'generate', count: 1, usd: 0.1, model: 'x' }, 'a field less': { kind: 'generate', usd: 0.1 }, 'another kind': { kind: 'edit', count: 1, usd: 0.1 }, 'no pictures': { kind: 'generate', count: 0, usd: 0.1 }, 'eleven pictures': { kind: 'generate', count: 11, usd: 0.1 }, 'a part of a picture': { kind: 'generate', count: 1.5, usd: 0.1 }, 'a negative fee': { kind: 'generate', count: 1, usd: -0.01 }, 'a fee above $100': { kind: 'generate', count: 1, usd: 100.01 }, 'a fee that is not a number': { kind: 'generate', count: 1, usd: '0.1' }, 'NaN': { kind: 'generate', count: 1, usd: NaN }, 'an array': [1] }
  let refusedAll = true
  for (const [what, image] of Object.entries(wrong)) if (U.parseLedgerRecord({ ...base, image }) !== null) { refusedAll = false; check(`D: refused: ${what}`, false) }
  check(`D: every one of ${Object.keys(wrong).length} wrong image fees makes the line unusable`, refusedAll)
  check('D: a record without one reads as before, with no image field', !('image' in U.parseLedgerRecord(base)))
  // the ledger itself, on disk
  const dir = mkdtempSync(join(root, 'ledger-'))
  let t = NOW
  const ledger = L.createUsageLedger(join(dir, 'usage.jsonl'), { now: () => t })
  const zero = { inputPerMTok: 0, cacheReadPerMTok: 0, cacheWritePerMTok: 0, outputPerMTok: 0 }
  const begin = (usd, check2) => ledger.begin({ chat: null, provider: 'openai', model: 'gpt-image-2', effort: null, prices: zero, inputTokens: 0, reserveUsd: usd, image: { kind: 'generate', count: 4, usd } }, check2)
  const seen = []
  const r1 = await begin(0.844, (spend) => { seen.push(spend); return null })
  check('D: the limits are asked with the most reserved as the request\'s cost', seen.length === 1 && Math.abs(seen[0].request - 0.844) < 1e-12, show(seen))
  let sum = await ledger.summary(null)
  check('D: a request on its way counts its most, "about"', Math.abs(sum.today.costUsd - 0.844) < 1e-12 && sum.today.about, show(sum.today))
  await ledger.finish(r1.id, { state: 'done', tokens: { input: 9, cacheRead: 0, cacheWrite: 0, output: 4 * 7033 }, estimate: false, image: { kind: 'generate', count: 4, usd: I.costFromTokens(I.parseImagesRegistry(REAL).registry.models[0], { input: 9, output: 4 * 7033 }) } })
  sum = await ledger.summary(null)
  check('D: when it ends, the real cost replaces the reserve', Math.abs(sum.today.costUsd - (9 * 5 + 4 * 7033 * 30) / 1e6) < 1e-12 && !sum.today.about, show(sum.today))
  const r2 = await begin(0.211)
  await ledger.finish(r2.id, { state: 'rejected', tokens: { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 }, estimate: true, image: { kind: 'generate', count: 1, usd: 0.211 } })
  sum = await ledger.summary(null)
  check('D: a request the provider refused owes nothing', sum.today.requests === 1, show(sum.today))
  await begin(0.05) // never finished: the app died
  await ledger.whenIdle()
  const again = L.createUsageLedger(join(dir, 'usage.jsonl'), { now: () => t })
  sum = await again.summary(null)
  check('D: read again from the disk, a request that never ended still counts its most', sum.today.requests === 2 && Math.abs(sum.today.costUsd - ((9 * 5 + 4 * 7033 * 30) / 1e6 + 0.05)) < 1e-12 && sum.unreadable === 0, show(sum.today))
  let refusal = null
  try { await again.begin({ chat: null, provider: 'openai', model: 'gpt-image-2', effort: null, prices: zero, inputTokens: 0, reserveUsd: 1.688, image: { kind: 'generate', count: 4, usd: 1.688 } }, (spend) => spend.today + spend.request > 1 ? 'over' : null) } catch (e) { refusal = e }
  check('D: a request whose most would pass the day\'s limit is refused and nothing is written', refusal instanceof L.RequestRefused && readFileSync(join(dir, 'usage.jsonl'), 'utf8').trim().split('\n').length === 5)
})

// ============ E. the picture checker ============
await guard('E', async () => {
  const b64 = (buf) => ({ b64_json: buf.toString('base64') })
  const png = solidPng(1024, 1536)
  let r = C.checkAnswerPictures([b64(png)], 1)
  check('E: a PNG is taken, with the size its header says', r.ok && r.pictures[0].type === 'image/png' && r.pictures[0].width === 1024 && r.pictures[0].height === 1536 && r.pictures[0].bytes.equals(png), show(r.ok ? [r.pictures[0].width, r.pictures[0].height] : r))
  const jpeg = readFileSync(join(REPO, 'tools/fixtures9/q.jpg'))
  const webp = readFileSync(join(REPO, 'tools/fixtures9/lossy.webp'))
  r = C.checkAnswerPictures([b64(jpeg), b64(webp)], 2)
  check('E: a JPEG and a WebP are taken (by their header)', r.ok && r.pictures.map((p) => p.type).join() === 'image/jpeg,image/webp', show(r.ok ? r.pictures.map((p) => p.type) : r))
  r = C.checkAnswerPictures([b64(solidPng(3840, 2160))], 1)
  check('E: 3840x2160 (the largest the API makes) is taken', r.ok)
  const refusedFor = (data, count, re, what) => {
    const out = C.checkAnswerPictures(data, count)
    check(`E: refused: ${what}`, !out.ok && re.test(out.why), show(out.ok ? 'taken' : out.why))
  }
  refusedFor([b64(Buffer.from('R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==', 'base64'))], 1, /not a PNG, JPEG or WebP/, 'a GIF')
  refusedFor([b64(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))], 1, /not a PNG, JPEG or WebP/, 'an SVG')
  refusedFor([b64(Buffer.from('%PDF-1.7 not a picture'))], 1, /not a PNG, JPEG or WebP/, 'a PDF')
  refusedFor([b64(Buffer.from('this is a text file and not a picture at all'))], 1, /not a PNG, JPEG or WebP/, 'a text')
  refusedFor([b64(png.subarray(0, 20))], 1, /not a whole PNG|cut off/, 'a cut PNG')
  refusedFor([b64(Buffer.alloc(0))], 1, /empty|cut off/, 'nothing')
  refusedFor([b64(solidPng(64, 64, [1, 2, 3], 12 * 1024 * 1024))], 1, /larger than 12 MB/, 'a PNG of more than 12 MB')
  refusedFor([b64(lyingPng(5008, 1680))], 1, /3840 pixels/, 'a PNG whose header says 5008 px wide')
  refusedFor([b64(lyingPng(1024, 3856))], 1, /3840 pixels/, 'a PNG whose header says 3856 px high')
  refusedFor([b64(png)], 2, /1 picture came back for 2/, 'one picture for two asked')
  refusedFor([b64(png), b64(png)], 1, /2 pictures came back for 1/, 'two pictures for one asked')
  refusedFor([], 1, /0 pictures came back/, 'no pictures')
  refusedFor(undefined, 1, /held no pictures/, 'no data at all')
  refusedFor({ b64_json: png.toString('base64') }, 1, /held no pictures/, 'data that is not a list')
  refusedFor([{ url: 'https://files.example.com/p.png' }], 1, /address/, 'an address in place of base64 (never fetched)')
  refusedFor([{ ...b64(png), url: 'https://x' }], 1, /address/, 'base64 and an address')
  refusedFor([{ b64_json: 42 }], 1, /address or not at all/, 'base64 that is a number')
  refusedFor(['iVBORw0KGgo='], 1, /address or not at all/, 'a bare string')
  refusedFor([{ b64_json: '***not base64***' }], 1, /not base64/, 'text that is not base64')
  refusedFor([{ b64_json: png.toString('base64').slice(0, -2) }], 1, /not base64/, 'base64 cut short (not a multiple of four)')
  refusedFor([{ b64_json: png.toString('base64').replace(/(.{76})/g, '$1\n') }], 1, /not base64/, 'base64 with line breaks')
  // base64 that is not the one way of writing those bytes: the unused low bits of the last letter before the padding are set (it decodes, but not back to itself)
  const padded = Buffer.concat([png, Buffer.alloc((4 - (png.length % 3)) % 3 === 2 ? 0 : (3 + 1 - (png.length % 3)) % 3)])
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  const canonical = padded.toString('base64')
  const at = canonical.indexOf('=') - 1
  const loose = at > 0 ? canonical.slice(0, at) + alphabet[alphabet.indexOf(canonical[at]) | (canonical.endsWith('==') ? 0x0f : 0x03)] + canonical.slice(at + 1) : null
  check('E: (the test makes a loose spelling of base64 that decodes to the same bytes)', loose !== null && loose !== canonical && Buffer.from(loose, 'base64').equals(padded), show([canonical.slice(-4), loose?.slice(-4)]))
  refusedFor([{ b64_json: loose }], 1, /not base64/, 'base64 that does not decode back to itself (a loose spelling)')
  refusedFor([b64(png), b64(Buffer.from('not a picture at all, sorry'))], 2, /refused/, 'one good picture and one bad (all or nothing)')
  // too long AND not base64 at its end: refused for its length, so the length was looked at before anything else (and before decoding)
  const big = 'A'.repeat(C.MAX_BASE64_CHARS + 8) + '!!!!'
  refusedFor([{ b64_json: big }], 1, /larger than 12 MB/, 'base64 longer than the largest picture (looked at before it is read or decoded)')
  const direct = C.checkPictureBytes(solidPng(64, 64, [1, 2, 3], 12 * 1024 * 1024))
  check('E: the bytes check alone refuses a picture of more than 12 MB too', !direct.ok && /larger than 12 MB/.test(direct.why), show(direct.ok ? 'taken' : direct.why))
  // an animated WebP (VP8X with the animation flag and an ANIM chunk)
  const chunk = (fourcc, data) => { const h = Buffer.alloc(8); h.write(fourcc, 0, 'latin1'); h.writeUInt32LE(data.length, 4); return Buffer.concat([h, data, data.length % 2 ? Buffer.alloc(1) : Buffer.alloc(0)]) }
  const vp8x = Buffer.alloc(10); vp8x[0] = 0x02; vp8x.writeUIntLE(99, 4, 3); vp8x.writeUIntLE(99, 7, 3)
  const body = Buffer.concat([Buffer.from('WEBP', 'latin1'), chunk('VP8X', vp8x), chunk('ANIM', Buffer.alloc(6)), chunk('ANMF', Buffer.alloc(24))])
  const riff = Buffer.concat([Buffer.from('RIFF', 'latin1'), Buffer.alloc(4), body]); riff.writeUInt32LE(body.length, 4)
  const anim = C.checkPictureBytes(riff)
  check('E: an animated WebP is refused', !anim.ok && /animated/.test(anim.why), show(anim.ok ? 'taken' : anim.why))
  check('E: the checker never decodes: it imports no image tools and no Electron', !/nativeImage|electron|ImageTools/.test(source('src/main/imageCheck.ts')))
})

// ============ F. images.json, the gallery's index ============
await guard('F', async () => {
  const one = { id: 'a'.repeat(32), prompt: 'A red bicycle\nleaning', model: 'gpt-image-2', shape: 'square', quality: 'medium', type: 'image/png', width: 1024, height: 1024, bytes: 5337, sha256: 'b'.repeat(64), at: NOW, costUsd: 0.053, estimate: false, chat: UUID }
  const file = (pictures, extra = {}) => JSON.stringify({ version: 1, pictures, ...extra })
  const idx = X.parseImageIndex(file([one, { ...one, id: 'c'.repeat(32), chat: null, estimate: true, type: 'image/webp' }]))
  check('F: an index as this app writes it reads', idx !== null && idx.pictures.length === 2 && idx.pictures[1].chat === null)
  check('F: written and read again it is the same, field for field', X.imageIndexText(idx) === file([one, { ...one, id: 'c'.repeat(32), chat: null, estimate: true, type: 'image/webp' }]))
  const wrongRecords = {
    'a field more': { ...one, url: 'https://x' }, 'a field less': (() => { const { sha256, ...r } = one; return r })(), 'an id that is a name': { ...one, id: 'my-picture.png' }, 'an id in capitals': { ...one, id: 'A'.repeat(32) }, 'an id of a path': { ...one, id: '..\\..\\x' },
    'an empty description': { ...one, prompt: '' }, 'a description of 4,001 characters': { ...one, prompt: 'x'.repeat(4001) }, 'a model id that is not one': { ...one, model: 'GPT image' }, 'a shape not known': { ...one, shape: 'round' }, 'a quality not known': { ...one, quality: 'max' },
    'a GIF': { ...one, type: 'image/gif' }, 'an SVG': { ...one, type: 'image/svg+xml' }, 'a width of 0': { ...one, width: 0 }, 'a height of 3856': { ...one, height: 3856 }, 'a width that is not whole': { ...one, width: 10.5 },
    'a size of 13 MB': { ...one, bytes: 13 * 1024 * 1024 }, 'a hash that is not one': { ...one, sha256: 'z'.repeat(64) }, 'a time before 1970': { ...one, at: -1 }, 'a negative cost': { ...one, costUsd: -1 }, 'a cost above $100': { ...one, costUsd: 101 },
    'estimate as text': { ...one, estimate: 'no' }, 'a chat that is not an id': { ...one, chat: 'x' }
  }
  let all = true
  for (const [what, record] of Object.entries(wrongRecords)) if (X.parseImageIndex(file([record])) !== null) { all = false; check(`F: refused: ${what}`, false) }
  check(`F: each of ${Object.keys(wrongRecords).length} wrong records makes the whole index unreadable`, all)
  check('F: an id used twice is refused', X.parseImageIndex(file([one, one])) === null)
  check('F: another version is refused', X.parseImageIndex(JSON.stringify({ version: 2, pictures: [] })) === null)
  check('F: a field more at the top is refused', X.parseImageIndex(file([], { extra: 1 })) === null)
  check('F: not JSON is refused', X.parseImageIndex('{"version":1,') === null)
  const many = Array.from({ length: 501 }, (_, i) => ({ ...one, id: i.toString(16).padStart(32, '0') }))
  check('F: 500 pictures read, 501 do not (the gallery keeps 500)', X.parseImageIndex(file(many.slice(0, 500))) !== null && X.parseImageIndex(file(many)) === null)
  check('F: an id is 32 hex characters, nothing else', X.isPictureId('0123456789abcdef0123456789abcdef') && !X.isPictureId('0123456789abcdef0123456789abcde') && !X.isPictureId('0123456789abcdef0123456789abcdeg'))
  // kept and sealed
  const dir = mkdtempSync(join(root, 'index-'))
  const box = makeBox()
  let mode = { form: 'plain' }
  const kept = X.createImageIndexFile({ pathOf: () => join(dir, 'images.json'), box, writeMode: async () => ({ ...mode }) })
  check('F: no file means no pictures (the store treats "none" as empty)', (await kept.read()).state === 'none')
  await kept.write(idx)
  const plain = readFileSync(join(dir, 'images.json'), 'utf8')
  check('F: written plain, the descriptions can be read in the file', plain.includes('A red bicycle'))
  mode = { form: 'encrypted' }
  check('F: turned to sealed by the encryption flow', (await kept.conform()) === 'changed')
  const sealed = readFileSync(join(dir, 'images.json'), 'utf8')
  check('F: sealed, nothing readable is left (no description, no model, no hash)', !sealed.includes('bicycle') && !sealed.includes('gpt-image') && !sealed.includes('b'.repeat(16)))
  const back = await kept.read()
  check('F: and it reads back the same', back.state === 'ok' && X.imageIndexText(back.value) === X.imageIndexText(idx) && back.form === 'encrypted')
  box.lose()
  const lost = await kept.read()
  check('F: with the key lost it cannot be read, and says why', lost.state === 'unreadable', show(lost))
  let refusedWrite = false
  try { await kept.write(X.EMPTY_INDEX) } catch { refusedWrite = true }
  check('F: and it is never written over by itself', refusedWrite && readFileSync(join(dir, 'images.json'), 'utf8') === sealed)
})

// ============ G. image-settings.json ============
await guard('G', async () => {
  check('G: the file as written reads', S.parseImageSettings('{"version":1,"on":true}')?.on === true && S.parseImageSettings(S.imageSettingsText({ on: false }))?.on === false)
  const bad = ['{"version":1,"on":"true"}', '{"version":1,"on":1}', '{"version":2,"on":true}', '{"version":1,"on":true,"x":1}', '{"on":true}', '[true]', '', 'on', '{"version":1}', 'null']
  check(`G: ${bad.length} other files are not read`, bad.every((text) => S.parseImageSettings(text) === null), show(bad.filter((text) => S.parseImageSettings(text) !== null)))
  const dir = mkdtempSync(join(root, 'settings-'))
  const store = S.createImageSettings({ pathOf: () => join(dir, 'image-settings.json'), writeMode: async () => ({ form: 'plain' }) })
  let now = await store.read()
  check('G: no file: off, with nothing to say', now.settings.on === false && now.problem === null)
  await store.write({ on: true })
  now = await store.read()
  check('G: written on, it reads on', now.settings.on === true && now.problem === null)
  for (const text of ['{"version":1,"on":"yes"}', '{"version":1,"on":true,"model":"x"}', 'garbage']) {
    writeFileSync(join(dir, 'image-settings.json'), text)
    now = await store.read()
    if (!(now.settings.on === false && typeof now.problem === 'string')) check(`G: a damaged file (${text}) means off`, false, show(now))
  }
  check('G: a damaged file means OFF, with the reason (it never switches it on)', now.settings.on === false && /not a file this app wrote/.test(now.problem), show(now))
  let refused = false
  try { await store.write({ on: true }) } catch { refused = true }
  check('G: a damaged file is not written over unless the person starts again', refused && readFileSync(join(dir, 'image-settings.json'), 'utf8') === 'garbage')
  await store.write({ on: false }, { replace: true })
  check('G: starting again keeps a copy of the damaged file and writes off', (await store.read()).settings.on === false && readdirSync(dir).some((n) => n.startsWith('image-settings.json.damaged-')))
})

// ============ H. the source ============
await guard('H', async () => {
  const shared = source('src/shared/images.ts')
  check('H: the shared part imports no Electron and nothing only Node has', !/from '(electron|fs|path|os|crypto|child_process)'|node:/.test(shared))
  for (const f of ['imageCheck.ts', 'imageIndex.ts', 'imageSettings.ts', 'imageRegistry.ts']) check(`H: src/main/${f} imports no Electron`, !/from 'electron'/.test(source(`src/main/${f}`)))
  check('H: the checker reads no file and writes none', !/from 'fs'|from 'path'|promises/.test(source('src/main/imageCheck.ts')))
  check('H: registry/images.json is embedded like models.json (a JSON import), not read from a path at run time', /import imagesFile from '..\/..\/registry\/images.json'/.test(source('src/main/imageRegistry.ts')))
  const files = []
  const walk = (dir) => { for (const name of readdirSync(dir, { withFileTypes: true })) { const p = join(dir, name.name); if (name.isDirectory()) walk(p); else if (/\.(ts|tsx)$/.test(name.name)) files.push(p) } }
  walk(join(REPO, 'src'))
  const importers = files.filter((f) => /from '\.\/image(Check|Index|Settings|Registry)'|shared\/images'/.test(readFileSync(f, 'utf8'))).map((f) => f.slice(REPO.length + 1).replaceAll('\\', '/'))
  // (written for 16.2, when nothing used them; since 16.4 the image service and the page do) the chat's reply path still uses none of them
  const replyPath = ['src/main/chat.ts', 'src/main/providers/anthropic.ts', 'src/main/providers/openai.ts', 'src/main/providers/index.ts', 'src/main/usageLedger.ts']
  check('H: the chat\'s reply path (chat.ts, the two chat adapters, the ledger) uses none of these modules', importers.length > 0 && replyPath.every((f) => !importers.includes(f)), show(importers))
  check('H: the ledger takes an image fee in begin and finish, as it takes an audio fee', /image\?: ImageFee/.test(source('src/main/usageLedger.ts')) && (source('src/main/usageLedger.ts').match(/input\.image|outcome\.image/g) ?? []).length === 4)
})

const ok = check.summary()
process.exit(ok ? 0 : 1)
