// Slice 16.4 under plain Node (no window): the gallery's store and the image service (D-048). The REAL service, switch file, index, store, usage ledger, limits store and adapter,
// with a played person (the system's box) and the fake image endpoint of the mock. What it shows:
//   A. the status: off, why a picture cannot be asked for (off, no key, no limits, a damaged file, a broken registry), the models with their state;
//   B. the switch: ON asks in the box (with words that tell the truth), only a yes switches it on, OFF is at once; a damaged file changes nothing until the person starts again;
//   C. the estimate: the most, from the file, what is left, whether it asks or is refused;
//   D. a request: every check before anything is paid for, the ledger's record BEFORE the request, ONE request, the record settled every way out, the pictures kept;
//   E. the gallery: newest first, a picture large, "Save a copy..." (a plain file where the person chose), deleting (asks), "Use in chat" (an attachment);
//   F. the store: random names, the order (files then index), nothing half-kept, sealed pictures, a key that is gone, damaged files;
//   G. what the source must keep true (the wiring).
// Run: node tools/guarded.mjs tools/verify-16-4.mjs      (ONLY=A,C runs some parts)
import './ts-resolve.mjs'
import { checker } from './cdp.mjs'
import { createHash, randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { REPO, REPO_URL } from './paths.mjs'
import { startMock } from './mock-providers.mjs'
import { makeBox } from './lib8b3.mjs'
import { solidPng } from './mock-images.mjs'

const check = checker()
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(',')) : null
const guard = async (name, fn) => { if (ONLY && !ONLY.has(name)) return; try { await fn() } catch (error) { check(`${name} did not run to its end: ${String(error?.stack ?? error).slice(0, 500)}`, false) } }
const show = (v) => JSON.stringify(v)?.slice(0, 500)
const SRC = `${REPO_URL}/src`
const I = await import(`${SRC}/shared/images.ts`)
const svcMod = await import(`${SRC}/main/imageService.ts`)
const settingsMod = await import(`${SRC}/main/imageSettings.ts`)
const indexMod = await import(`${SRC}/main/imageIndex.ts`)
const storeMod = await import(`${SRC}/main/imageStore.ts`)
const ledgerMod = await import(`${SRC}/main/usageLedger.ts`)
const limitsMod = await import(`${SRC}/main/limits.ts`)
const questionMod = await import(`${SRC}/main/systemQuestion.ts`)
const source = (rel) => readFileSync(join(REPO, rel), 'utf8')
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const REGISTRY = I.parseImagesRegistry(JSON.parse(source('registry/images.json')))

const PORT = Number(process.env.IMAGES_TEST_PORT ?? 8898)
const mock = await startMock(PORT)
const origin = `http://127.0.0.1:${PORT}`
const KEY = 'sk-proj-' + randomBytes(24).toString('hex')
const requests = async () => (await (await fetch(`${origin}/__requests`)).json()).filter((r) => r.images)
const resetMock = () => fetch(`${origin}/__reset`, { method: 'POST' })
const control = (body) => fetch(`${origin}/__images`, { method: 'POST', body: JSON.stringify(body) })
const tempRoot = mkdtempSync(join(tmpdir(), 'frontier-164-'))
let dirs = 0
const tempDir = () => { const d = join(tempRoot, `d${++dirs}`); mkdirSync(d, { recursive: true }); return d }
const sha = (b) => createHash('sha256').update(b).digest('hex')
const UUID = '0b8f0e2a-6c1d-4e8b-9a77-2f4d5c6b7a81'
const ASK = { prompt: 'A red bicycle\nleaning on a blue wall', model: 'gpt-image-2', shape: 'square', quality: 'medium', count: 1, chat: UUID }
const THUMB = 'data:image/png;base64,VEhVTUI='

/** The whole rig: a fresh folder, the real stores, a played person. */
async function rig({ key = KEY, limits = { daily: { kind: 'none' }, monthly: { kind: 'none' } }, on = true, answers = [], registry = REGISTRY, box = undefined, form = 'plain', generate = undefined } = {}) {
  const dir = tempDir()
  const clock = { value: new Date(2026, 9, 16, 12).getTime() }
  const mode = { form }
  const writeMode = async () => (mode.refused ? { refused: mode.refused } : { form: mode.form })
  const settings = settingsMod.createImageSettings({ pathOf: () => join(dir, 'image-settings.json'), box, writeMode })
  if (on) writeFileSync(join(dir, 'image-settings.json'), settingsMod.imageSettingsText({ on: true }))
  const index = indexMod.createImageIndexFile({ pathOf: () => join(dir, 'images.json'), box, writeMode })
  const thumbs = []
  const store = storeMod.createImageStore({ dir: join(dir, 'images'), index, images: { thumbnail: (bytes, edge) => { thumbs.push([bytes.length, edge]); return THUMB } }, box, writeMode })
  const limitsStore = limitsMod.createLimitsStore(() => join(dir, 'limits.json'))
  if (limits !== null) await limitsStore.save(limits)
  const ledger = ledgerMod.createUsageLedger(join(dir, 'ledger.jsonl'), { now: () => clock.value })
  const asked = []
  const askPerson = async (_owner, question) => { asked.push(question); const a = answers.shift(); return a === undefined ? false : a }
  const gate = questionMod.createQuestionGate(askPerson, () => clock.value)
  const keyBox = { key }
  const saved = { path: null, writes: [] }
  const attached = []
  const service = svcMod.createImageService({
    settings, store, gate, key: async () => keyBox.key, baseUrl: () => origin, limits: limitsStore, ledger, registry: () => registry, now: () => clock.value,
    savePath: async (_owner, name, type) => { saved.asked = { name, type }; return saved.path },
    writeCopy: async (path, bytes) => { saved.writes.push(path); writeFileSync(path, bytes) },
    attach: async (bytes, name) => { attached.push({ bytes, name }); return { ok: true, file: { name, bytes: bytes.length } } },
    ...(generate ? { generate } : {})
  })
  const lines = () => (existsSync(join(dir, 'ledger.jsonl')) ? readFileSync(join(dir, 'ledger.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [])
  const files = () => (existsSync(join(dir, 'images')) ? readdirSync(join(dir, 'images')) : [])
  return { dir, clock, mode, settings, index, store, limitsStore, ledger, asked, gate, keyBox, saved, attached, service, lines, files, thumbs }
}

// ============ A. the status ============
await guard('A', async () => {
  let r = await rig({ on: false })
  let s = await r.service.status()
  check('A: off at first, and the sentence says how to switch it on', s.on === false && s.blocked === I.IMAGE_WORDS.off && s.problem === null, show(s))
  check('A: the three models, with their state, the default gpt-image-2', s.models.map((m) => `${m.id}:${m.state}:${m.published}`).join() === 'gpt-image-2:ok:true,gpt-image-2.5-flare:ok:false,gpt-image-2.5-sunburst:ok:false' && s.defaultModelId === 'gpt-image-2', show(s.models.map((m) => m.id)))
  check('A: the numbers the page shows (asks above $0.50, 4 pictures, 4,000 characters, 500 in the gallery)', s.askAboveUsd === 0.5 && s.maxCount === 4 && s.maxPromptChars === 4000 && s.galleryMax === 500 && s.pictures === 0)
  check('A: nothing in the status is a path, a key or an address', !/[A-Z]:\\|sk-|:\/\//.test(JSON.stringify(s)))
  r = await rig({ key: null })
  check('A: on but no OpenAI key: says so', (await r.service.status()).blocked === I.IMAGE_WORDS.noKey)
  r = await rig({ key: null, on: false })
  check('A: (16.6) off AND no OpenAI key: the key is said first (without one the switch cannot be turned on either)', (await r.service.status()).blocked === I.IMAGE_WORDS.noKey)
  r = await rig({ limits: null })
  check('A: no limits chosen: says so', (await r.service.status()).blocked === I.IMAGE_WORDS.noLimits)
  r = await rig({ on: false })
  writeFileSync(join(r.dir, 'image-settings.json'), '{"version":1,"on":"yes"}')
  s = await r.service.status()
  check('A: a damaged switch file: off, and the reason is given', s.on === false && /could not be read/.test(s.blocked) && typeof s.problem === 'string', show(s))
  r = await rig({ registry: { ok: false, error: 'it is not an object' } })
  s = await r.service.status()
  check('A: a broken registry/images.json: no models, and the sentence says so', s.models.length === 0 && s.blocked === I.IMAGE_WORDS.noModels && s.registryError === 'it is not an object')
  r = await rig()
  check('A: on, with a key and limits: nothing blocks', (await r.service.status()).blocked === null)
})

// ============ B. the switch ============
await guard('B', async () => {
  let r = await rig({ on: false, answers: [false] })
  let out = await r.service.setOn(null, { on: true })
  const q = r.asked[0]
  check('B: ON asks once in the system\'s box', r.asked.length === 1 && q.title === 'Make images', show(r.asked.map((x) => x.title)))
  check('B: the box says it goes to OpenAI even while chatting with Claude, needs the OpenAI key, and what a picture costs', /OpenAI/.test(q.message) && /even when you chat with Claude/.test(q.detail) && /Anthropic cannot make pictures/.test(q.detail) && /OpenAI key/.test(q.detail) && /\$0\.005 to \$0\.21/.test(q.detail))
  check('B: ...that nothing is sent until Make is pressed and the model cannot start one', /Nothing is sent until you press Make/.test(q.detail) && /cannot start a picture/.test(q.detail))
  check('B: ...that OpenAI\'s content policy applies and the app never asks it to be less strict', /content policy/.test(q.detail) && /never asks it to be less strict/.test(q.detail))
  check('B: ...that the app keeps the pictures and descriptions on this computer, sealed with the chats when encryption is on, and asks again above $0.50', /keeps your pictures and their descriptions on this computer/.test(q.detail) && /encrypted with your chats/.test(q.detail) && /more than \$0\.50 asks you again/.test(q.detail))
  check('B: ...and that only the person can answer it here', /cannot answer/.test(q.detail) && q.yes === 'Turn on' && q.no === "Don't turn on")
  check('B: a no leaves it off, and writes nothing', !out.ok && out.error === 'Making images is still off.' && !existsSync(join(r.dir, 'image-settings.json')), show(out))
  r.clock.value += 10_000
  r = await rig({ on: false, answers: [true] })
  out = await r.service.setOn(null, { on: true })
  check('B: a yes switches it on, and the file says so', out.ok && out.status.on === true && settingsMod.parseImageSettings(readFileSync(join(r.dir, 'image-settings.json'), 'utf8')).on === true)
  out = await r.service.setOn(null, { on: true })
  check('B: ON when it is on asks nothing', out.ok && r.asked.length === 1)
  out = await r.service.setOn(null, { on: false })
  check('B: OFF is at once and asks nothing', out.ok && out.status.on === false && r.asked.length === 1)
  r = await rig({ on: false, key: null, answers: [true] })
  out = await r.service.setOn(null, { on: true })
  check('B: with no OpenAI key ON is refused before any question', !out.ok && out.error === I.IMAGE_WORDS.noKey && r.asked.length === 0)
  for (const bad of [{ on: 'yes' }, { on: true, extra: 1 }, true, null, { on: 1 }]) {
    const x = await r.service.setOn(null, bad)
    if (x.ok || x.error !== I.IMAGE_WORDS.notUnderstood) check(`B: refused: ${show(bad)}`, false, show(x))
  }
  check('B: what is not exactly { on: true|false } is not understood', r.asked.length === 0)
  r = await rig({ on: false, answers: [true] })
  writeFileSync(join(r.dir, 'image-settings.json'), 'garbage')
  out = await r.service.setOn(null, { on: true })
  check('B: a damaged file: nothing changes, no question, the reason is given', !out.ok && /could not be read/.test(out.error) && r.asked.length === 0 && readFileSync(join(r.dir, 'image-settings.json'), 'utf8') === 'garbage', show(out))
  out = await r.service.reset()
  check('B: starting again: off, the damaged file kept as a copy', out.ok && out.status.on === false && readdirSync(r.dir).some((n) => n.startsWith('image-settings.json.damaged-')))
  check('B: with nothing damaged there is nothing to start again', !(await r.service.reset()).ok)
})

// ============ C. the estimate ============
await guard('C', async () => {
  const r = await rig({ limits: { daily: { kind: 'usd', usd: 1 }, monthly: { kind: 'usd', usd: 20 } } })
  let e = await r.service.estimate({ model: 'gpt-image-2', shape: 'square', quality: 'medium', count: 1 })
  check('C: a standard square: at most $0.053, not about, $1 left today and $20 this month, no question, no refusal', e.ok && e.maxUsd === 0.053 && !e.about && e.leftTodayUsd === 1 && e.leftMonthUsd === 20 && !e.asks && e.refusal === null, show(e))
  e = await r.service.estimate({ model: 'gpt-image-2.5-flare', shape: 'square', quality: 'high', count: 2 })
  check('C: two high squares of Flare: about $0.844, it asks', e.ok && Math.abs(e.maxUsd - 0.844) < 1e-9 && e.about && e.asks && e.refusal === null, show(e))
  e = await r.service.estimate({ model: 'gpt-image-2.5-flare', shape: 'square', quality: 'high', count: 3 })
  check('C: three of them (about $1.266) would pass the day\'s $1: the refusal says so', e.ok && /daily limit of \$1\.00/.test(e.refusal ?? ''), show(e))
  for (const bad of [{ model: 'gpt-image-9', shape: 'square', quality: 'low', count: 1 }, { model: 'gpt-image-2', shape: 'round', quality: 'low', count: 1 }, { model: 'gpt-image-2', shape: 'square', quality: 'xhigh', count: 1 }, { model: 'gpt-image-2', shape: 'square', quality: 'low', count: 5 }, { model: 'gpt-image-2', shape: 'square', quality: 'low', count: 1, size: '3840x2160' }, { model: 'gpt-image-2', shape: 'square', quality: 'low' }]) {
    const x = await r.service.estimate(bad)
    if (x.ok) check(`C: refused: ${show(bad)}`, false)
  }
  check('C: an estimate of what the dialog does not offer is not understood (no size, no fifth picture)', true)
  const f = JSON.parse(source('registry/images.json'))
  f.models[1].retires = '2026-10-01'
  const r2 = await rig({ registry: I.parseImagesRegistry(f) })
  e = await r2.service.estimate({ model: 'gpt-image-2.5-flare', shape: 'square', quality: 'low', count: 1 })
  check('C: a retired model: the refusal says when it retired', e.ok && /was retired by OpenAI on 2026-10-01/.test(e.refusal ?? ''), show(e))
  check('C: an estimate sends nothing and writes nothing', (await requests()).length === 0 && r.lines().length === 0)
})

// ============ D. a request ============
await guard('D', async () => {
  await resetMock()
  let r = await rig()
  let out = await r.service.generate(null, ASK)
  const sent = await requests()
  check('D: a standard square: one request, the six fields, the description as typed', out.ok && sent.length === 1 && sent[0].fields.join() === 'model,n,output_format,prompt,quality,size' && sent[0].body.prompt === ASK.prompt && sent[0].body.size === '1024x1024' && sent[0].headers.authorization === `Bearer ${KEY}`, show([out, sent.length]))
  let lines = r.lines()
  check('D: the ledger has the record BEFORE the request (sent, the most reserved) and its end (done, the real cost from the tokens)', lines.length === 2 && lines[0].state === 'sent' && lines[0].image.usd === 0.053 && lines[0].image.count === 1 && lines[1].state === 'done' && lines[1].estimate === false && Math.abs(lines[1].image.usd - (Math.ceil(ASK.prompt.length / 4) * 5 + 1767 * 30) / 1e6) < 1e-12, show(lines.map((l) => [l.state, l.image])))
  check('D: the record names OpenAI, the image model, the chat, and has no priced tokens', lines[1].provider === 'openai' && lines[1].model === 'gpt-image-2' && lines[1].chat === UUID && lines[1].prices.outputPerMTok === 0 && lines[1].tokens.output === 1767)
  check('D: the answer: one picture, its cost, not a guess', out.ok && out.pictures.length === 1 && Math.abs(out.costUsd - lines[1].image.usd) < 1e-12 && out.estimate === false)
  const p = out.pictures[0]
  check('D: the picture as the page is shown it: a random id, the description, the model\'s label, the shape, the size, the chat, a small picture', indexMod.isPictureId(p.id) && p.prompt === ASK.prompt && p.modelLabel === 'GPT Image 2' && p.shape === 'square' && p.width === 1024 && p.height === 1024 && p.chat === UUID && p.thumbnail === THUMB && p.missing === undefined, show(p))
  check('D: the small picture was made in main at 256 px', r.thumbs.length >= 1 && r.thumbs[0][1] === 256)
  check('D: the file in images/ is named by that id, and holds the bytes that came', show(r.files()) === show([p.id]) && readFileSync(join(r.dir, 'images', p.id)).equals(solidPng(1024, 1024, [40, 120, 200])))
  const idx = indexMod.parseImageIndex(readFileSync(join(r.dir, 'images.json'), 'utf8'))
  check('D: the index has its line, with the hash of the bytes and its share of the cost', idx.pictures.length === 1 && idx.pictures[0].id === p.id && idx.pictures[0].sha256 === sha(solidPng(1024, 1024, [40, 120, 200])) && idx.pictures[0].costUsd === out.costUsd)
  // four at once, and no usage
  await resetMock()
  await control({ usage: 'none' })
  out = await r.service.generate(null, { ...ASK, count: 4, shape: 'landscape', quality: 'low' })
  lines = r.lines()
  check('D: no usage in the answer: the cost is the table\'s ($0.005 x 4), marked as a guess', out.ok && Math.abs(out.costUsd - 0.02) < 1e-12 && out.estimate === true && lines.at(-1).estimate === true && Math.abs(lines.at(-1).image.usd - 0.02) < 1e-12, show(out.ok ? [out.costUsd, out.estimate] : out))
  check('D: four pictures kept, each with a quarter of the cost, newest first in the gallery', out.ok && out.pictures.length === 4 && r.files().length === 5 && out.pictures.every((x) => Math.abs(x.costUsd - 0.005) < 1e-12))
  // the box above $0.50
  await resetMock()
  r = await rig({ answers: [false] })
  out = await r.service.generate(null, { ...ASK, model: 'gpt-image-2.5-flare', quality: 'high', count: 2 })
  const q = r.asked[0]
  check('D: above $0.50 the system\'s box asks first, with the description, the model, the shape, the quality, the count and the most', r.asked.length === 1 && /Spend up to about \$0\.84 on 2 pictures\?/.test(q.message) && /Description: "A red bicycle/.test(q.detail) && /Model: GPT Image 2\.5 Flare/.test(q.detail) && /Shape: Square \(1024x1024\)/.test(q.detail) && /Quality: High/.test(q.detail) && /Pictures: 2/.test(q.detail) && /app's ceiling/.test(q.detail), show(q))
  check('D: a no: nothing sent, nothing in the ledger', !out.ok && out.kind === 'refused' && (await requests()).length === 0 && r.lines().length === 0, show(out))
  r = await rig({ answers: [true] })
  out = await r.service.generate(null, { ...ASK, model: 'gpt-image-2.5-flare', quality: 'high', count: 2 })
  check('D: a yes: made', out.ok && r.asked.length === 1 && (await requests()).length === 1)
  await resetMock()
  out = await r.service.generate(null, { ...ASK, count: 4, quality: 'medium' })
  check('D: four standard squares ($0.212) do not ask', out.ok && r.asked.length === 1)
  // the limits
  await resetMock()
  r = await rig({ limits: { daily: { kind: 'usd', usd: 0.5 }, monthly: { kind: 'none' } } })
  out = await r.service.generate(null, { ...ASK, quality: 'high', count: 3 })
  check('D: a request whose MOST would pass the day\'s limit is refused before anything (no question, no record, no request), even if it might cost less', !out.ok && out.kind === 'refused' && /daily limit/.test(out.error) && (await requests()).length === 0 && r.lines().length === 0 && r.asked.length === 0, show(out))
  r = await rig({ limits: null })
  out = await r.service.generate(null, ASK)
  check('D: no limits chosen: refused, nothing sent', !out.ok && /no spending limits are set/.test(out.error) && (await requests()).length === 0)
  // the other refusals before sending
  r = await rig({ on: false })
  out = await r.service.generate(null, ASK)
  check('D: switched off: refused, nothing sent', !out.ok && out.error === I.IMAGE_WORDS.off && (await requests()).length === 0)
  r = await rig({ key: null })
  out = await r.service.generate(null, ASK)
  check('D: no key: refused, nothing sent', !out.ok && out.error === I.IMAGE_WORDS.noKey && (await requests()).length === 0)
  r = await rig()
  out = await r.service.generate(null, { ...ASK, size: '3840x2160' })
  check('D: a request with a size of its own is not understood', !out.ok && out.error === I.IMAGE_WORDS.notUnderstood && (await requests()).length === 0)
  out = await r.service.generate(null, { ...ASK, prompt: '   ' })
  check('D: a blank description: "Write a description first.", nothing sent', !out.ok && out.error === I.IMAGE_WORDS.noPrompt && (await requests()).length === 0)
  // a full gallery
  const many = Array.from({ length: 499 }, (_, i) => ({ id: i.toString(16).padStart(32, '0'), prompt: 'old', model: 'gpt-image-2', shape: 'square', quality: 'low', type: 'image/png', width: 8, height: 8, bytes: 100, sha256: 'a'.repeat(64), at: 1, costUsd: 0, estimate: false, chat: null }))
  writeFileSync(join(r.dir, 'images.json'), indexMod.imageIndexText({ pictures: many }))
  out = await r.service.generate(null, { ...ASK, count: 2 })
  check('D: a gallery with 499 of 500 refuses two more BEFORE anything is sent or paid', !out.ok && out.kind === 'refused' && /gallery is full \(499 of 500/.test(out.error) && (await requests()).length === 0 && r.lines().length === 0, show(out))
  out = await r.service.generate(null, ASK)
  check('D: and takes one more', out.ok && (await requests()).length === 1)
  // one at a time
  await resetMock()
  r = await rig()
  await control({ mode: 'slow', ms: 700 })
  const [a, b] = await Promise.all([r.service.generate(null, ASK), (async () => { await wait(100); return r.service.generate(null, ASK) })()])
  check('D: one request at a time: a second while the first is on its way is refused, and only one is sent', a.ok && !b.ok && b.error === I.IMAGE_WORDS.busy && (await requests()).length === 1, show([a.ok, b]))
  // failures and the ledger
  const failures = { blocked: ['blocked', 'rejected', /safety system refused this description \(violence\)/], '401': ['failed', 'rejected', /not accepted \(401\)/], verify: ['failed', 'rejected', /must be verified/], '503': ['failed', 'failed', /overloaded/], fewer: ['failed', 'failed', /could not be used/], garbage: ['failed', 'failed', /could not read/] }
  for (const [mode, [kind, state, re]] of Object.entries(failures)) {
    await resetMock()
    r = await rig()
    await control({ mode })
    out = await r.service.generate(null, ASK)
    lines = r.lines()
    check(`D: ${mode}: ${kind}, the sentence, the record settled as ${state} (${state === 'rejected' ? 'nothing owed' : 'counted at the most'}), nothing kept, one request`, !out.ok && out.kind === kind && re.test(out.error) && lines.length === 2 && lines[1].state === state && lines[1].image.usd === 0.053 && r.files().length === 0 && (await requests()).length === 1, show([out, lines.map((l) => l.state)]))
  }
  let sum = await r.ledger.summary(null)
  check('D: a failure that may have been billed counts its most in the sums', Math.abs(sum.today.costUsd - 0.053) < 1e-12 && sum.today.about)
  await resetMock()
  r = await rig()
  await control({ mode: 'blocked' })
  await r.service.generate(null, ASK)
  sum = await r.ledger.summary(null)
  check('D: a blocked request owes nothing in the sums', sum.today.costUsd === 0 && sum.today.requests === 0)
  // Stop, and OFF while on its way
  await resetMock()
  r = await rig()
  await control({ mode: 'hang' })
  const going = r.service.generate(null, ASK)
  await wait(300)
  r.service.stop()
  out = await going
  lines = r.lines()
  check('D: Stop: "stopped", the sentence says it may still be billed, the record "stopped" and counted at the most', !out.ok && out.kind === 'stopped' && /may still bill/.test(out.error) && lines.at(-1).state === 'stopped' && lines.at(-1).image.usd === 0.053 && r.files().length === 0, show([out, lines.map((l) => l.state)]))
  const going2 = r.service.generate(null, ASK)
  await wait(300)
  await r.service.setOn(null, { on: false })
  out = await going2
  check('D: switching off while a request is on its way stops it', !out.ok && out.kind === 'stopped' && r.lines().at(-1).state === 'stopped')
  // made and paid, but cannot be kept
  await resetMock()
  r = await rig()
  await r.service.generate(null, ASK)
  writeFileSync(join(r.dir, 'images.json'), '{"version":1,"pictures":[{"broken":true}]}')
  out = await r.service.generate(null, ASK)
  check('D: an index that cannot be read refuses BEFORE sending (the room is checked first)', !out.ok && /could not be read/.test(out.error) && (await requests()).length === 1, show(out))
  await resetMock()
  r = await rig()
  const realGenerate = (await import(`${SRC}/main/providers/openaiImages.ts`)).generatePictures
  const r3 = await rig({ generate: async (req) => { const got = await realGenerate(req); r3.mode.refused = 'Encryption is on, and the key cannot be used now.'; return got } })
  out = await r3.service.generate(null, ASK)
  lines = r3.lines()
  check('D: pictures made and paid for that cannot be kept: the sentence says they were made and counted, the record is done (paid), nothing is half-kept', !out.ok && /were made \(and counted, \$0\.05\) but could not be kept/.test(out.error) && lines.at(-1).state === 'done' && r3.files().length === 0, show([out, lines.map((l) => l.state)]))
})

// ============ E. the gallery ============
await guard('E', async () => {
  await resetMock()
  const r = await rig({ answers: [false, true] })
  const first = await r.service.generate(null, { ...ASK, prompt: 'first' })
  r.clock.value += 60_000
  const second = await r.service.generate(null, { ...ASK, prompt: 'second', shape: 'portrait' })
  let list = await r.service.list()
  check('E: the gallery, newest first', list.problem === null && list.pictures.map((p) => p.prompt).join() === 'second,first', show(list.pictures.map((p) => p.prompt)))
  const id = second.pictures[0].id
  const big = await r.service.picture(id)
  check('E: a picture large, as data: of its own type, the very bytes kept', big.ok && big.dataUrl === `data:image/png;base64,${solidPng(1024, 1536, [40, 120, 200]).toString('base64')}` && big.summary.id === id)
  for (const bad of ['../images.json', 'A'.repeat(32), null, 42, '0'.repeat(32)]) {
    const x = await r.service.picture(bad)
    if (x.ok) check(`E: refused: ${show(bad)}`, false)
  }
  check('E: an id that is not one of the gallery\'s is refused (never a path)', true)
  // Save a copy
  const out = join(r.dir, 'Pictures')
  mkdirSync(out)
  r.saved.path = null
  let s = await r.service.saveCopy(null, id)
  check('E: "Save a copy...": the system\'s dialog is asked with a plain name (no description in it) and the type; closing it saves nothing', !s.ok && s.cancelled === true && /^picture-2026-10-16-[0-9a-f]{8}\.png$/.test(r.saved.asked.name) && r.saved.asked.type === 'image/png' && r.saved.writes.length === 0, show([s, r.saved.asked]))
  r.saved.path = join(out, 'mine.png')
  s = await r.service.saveCopy(null, id)
  check('E: a path chosen: the plain picture is written there, the very bytes', s.ok && readFileSync(join(out, 'mine.png')).equals(solidPng(1024, 1536, [40, 120, 200])))
  // Use in chat
  const used = await r.service.useInChat(id)
  check('E: "Use in chat" hands the bytes to the attachments, named by the id, not by the description', used.ok && r.attached.length === 1 && r.attached[0].bytes.equals(solidPng(1024, 1536, [40, 120, 200])) && /^picture-[0-9a-f]{8}\.png$/.test(r.attached[0].name))
  // delete
  let d = await r.service.remove(null, id)
  check('E: deleting asks in the box, which says what is deleted and that saved copies are not touched; a no keeps it', !d.ok && d.cancelled === true && r.asked.at(-1).title === 'Delete a picture' && /Description: "second"/.test(r.asked.at(-1).detail) && /Copies you saved elsewhere/.test(r.asked.at(-1).detail) && r.files().includes(id), show(d))
  r.clock.value += 10_000
  d = await r.service.remove(null, id)
  list = await r.service.list()
  check('E: a yes deletes the app\'s copy and its line, and nothing else', d.ok && !r.files().includes(id) && list.pictures.map((p) => p.prompt).join() === 'first' && existsSync(join(out, 'mine.png')), show(d))
  const gone = await r.service.picture(id)
  check('E: the deleted picture is "no longer in the gallery" (a chat that shows it says so)', !gone.ok && /no longer in the gallery/.test(gone.error))
  check('E: deleting something that is not there asks nothing', !(await r.service.remove(null, id)).ok && r.asked.length === 2)
  // a damaged file
  writeFileSync(join(r.dir, 'images', first.pictures[0].id), 'not the picture')
  list = await r.service.list()
  check('E: a picture whose file was changed on the disk is shown as damaged, never shown', list.pictures[0].thumbnail === null && /damaged/.test(list.pictures[0].missing ?? ''), show(list.pictures[0]))
  const pic = await r.service.picture(first.pictures[0].id)
  check('E: and cannot be opened large', !pic.ok && /damaged/.test(pic.error))
})

// ============ F. the store ============
await guard('F', async () => {
  await resetMock()
  // sealed
  const box = makeBox()
  let r = await rig({ box, form: 'encrypted' })
  let out = await r.service.generate(null, ASK)
  const id = out.pictures[0].id
  const raw = readFileSync(join(r.dir, 'images', id))
  check('F: with encryption on, the picture is sealed on the disk (it begins with the seal, no PNG signature in it)', raw.subarray(0, storeMod.SEALED_PICTURE.length).equals(storeMod.SEALED_PICTURE) && raw.indexOf(Buffer.from([0x89, 0x50, 0x4e, 0x47])) === -1)
  check('F: and the index is sealed too (no description in it)', !readFileSync(join(r.dir, 'images.json'), 'utf8').includes('bicycle'))
  const big = await r.service.picture(id)
  check('F: it opens to the very bytes', big.ok && big.dataUrl.endsWith(solidPng(1024, 1024, [40, 120, 200]).toString('base64')))
  r.saved.path = join(r.dir, 'copy.png')
  await r.service.saveCopy(null, id)
  check('F: "Save a copy..." of a sealed picture writes the PLAIN picture (the plain file the roadmap asks for)', readFileSync(join(r.dir, 'copy.png')).equals(solidPng(1024, 1024, [40, 120, 200])))
  let counts = await r.store.counts()
  check('F: counted as one sealed picture', counts.pictures === 1 && counts.encrypted === 1 && counts.plain === 0 && counts.unlisted === 0, show(counts))
  const keyBefore = box.exportKey()
  box.lose()
  const lost = await r.service.picture(id)
  check('F: with the key lost: "could not be opened with the key this computer has"', !lost.ok && /could not be opened with the key/.test(lost.error), show(lost))
  box.importKey(keyBefore)
  // conform both ways
  r.mode.form = 'plain'
  let c = await r.store.conform()
  check('F: turned back to plain, the picture is rewritten plain', c.changed === 1 && readFileSync(join(r.dir, 'images', id)).equals(solidPng(1024, 1024, [40, 120, 200])), show(c))
  c = await r.store.conform()
  check('F: a second pass has nothing to do', c.changed === 0 && c.already === 1)
  // the order and nothing half-kept
  r = await rig({ form: 'plain' })
  // the index cannot be written AFTER the picture files were (a disk that fills up between the two): the files written for the request go again
  const realIndex = r.index
  const failing = { ...realIndex, read: () => realIndex.read(), write: async () => { throw new Error('the disk is full') } }
  const lone = storeMod.createImageStore({ dir: join(r.dir, 'images'), index: failing, images: { thumbnail: () => THUMB }, writeMode: async () => ({ form: 'plain' }) })
  const pngs = [solidPng(64, 64), solidPng(64, 64, [9, 9, 9])].map((bytes) => ({ bytes, type: 'image/png', width: 64, height: 64 }))
  let thrown = null
  try { await lone.add(pngs, { prompt: 'x', model: 'gpt-image-2', shape: 'square', quality: 'low', chat: null, costEach: 0.003, estimate: false }) } catch (e) { thrown = e }
  check('F: when the index cannot be written after the picture files were, those files go again: nothing half-kept', thrown !== null && /disk is full/.test(thrown.message) && r.files().length === 0, show([thrown?.message, r.files()]))
  mkdirSync(join(r.dir, 'images.json')) // and an index that cannot be read refuses before anything is sent
  out = await r.service.generate(null, ASK)
  check('F: an index that cannot be read: refused before anything is sent', !out.ok && /could not be read/.test(out.error) && r.files().length === 0, show(out))
  r = await rig()
  out = await r.service.generate(null, ASK)
  writeFileSync(join(r.dir, 'images', 'f'.repeat(32)), solidPng(8, 8))
  counts = await r.store.counts()
  check('F: a file no index line names (a crash between the two writes) is never listed, and is counted as unlisted', counts.pictures === 1 && counts.unlisted === 1 && (await r.service.list()).pictures.length === 1, show(counts))
  // random names
  const ids = new Set()
  for (let i = 0; i < 3; i++) { await resetMock(); const x = await r.service.generate(null, ASK); ids.add(x.pictures[0].id) }
  check('F: the same description three times: three different random names', ids.size === 3 && [...ids].every((x) => indexMod.isPictureId(x)))
  check('F: no file name holds the description, the model or anything the provider sent', r.files().every((n) => /^[0-9a-f]{32}$/.test(n)))
  // another picture of exactly the same length put in place of one: its hash is not the index's, so it is damaged and never shown
  const victim = (await r.service.list()).pictures.at(-1)
  const want = readFileSync(join(r.dir, 'images', victim.id)).length
  let other = null
  for (let c = 0; c < 256 && other === null; c++) { const candidate = solidPng(1024, 1024, [40, 120, c]); if (c !== 200 && candidate.length === want) other = candidate }
  other ??= Buffer.alloc(0)
  const sameLength = other.length === want
  writeFileSync(join(r.dir, 'images', victim.id), other)
  const swapped = await r.service.picture(victim.id)
  check('F: another picture of the same length put in place of one is damaged (the hash is checked, not only the size)', sameLength && !swapped.ok && /damaged/.test(swapped.error), show([sameLength, swapped.ok]))
  // a whole .tmp beside a missing real file is read (a crash after the .tmp was written)
  const one = (await r.service.list()).pictures[0]
  const bytes = readFileSync(join(r.dir, 'images', one.id))
  writeFileSync(join(r.dir, 'images', `${one.id}.tmp`), bytes)
  writeFileSync(join(r.dir, 'images', one.id), bytes.subarray(0, 10))
  check('F: a whole .tmp is read when the real file was cut off', (await r.service.picture(one.id)).ok)
  writeFileSync(join(r.dir, 'images', one.id), Buffer.alloc(storeMod.MAX_PICTURE_FILE_BYTES + 1))
  writeFileSync(join(r.dir, 'images', `${one.id}.tmp`), Buffer.alloc(10))
  const huge = await r.service.picture(one.id)
  check('F: a file larger than any picture the app writes is damaged (looked at before it is read)', !huge.ok && /damaged/.test(huge.error), show(huge))
})

// ============ G. the source ============
await guard('G', async () => {
  const ipc = source('src/main/ipc.ts')
  const shared = source('src/shared/ipc.ts')
  const preload = source('src/preload/index.ts')
  check('G: eleven channels, all images:*', Object.values(I.IMAGE_CHANNELS).length === 11 && Object.values(I.IMAGE_CHANNELS).every((c) => /^images:/.test(c)))
  for (const name of ['imagesStatus', 'imagesSetOn', 'imagesReset', 'imagesEstimate', 'imagesGenerate', 'imagesStop', 'imagesList', 'imagesPicture', 'imagesSaveCopy', 'imagesRemove', 'imagesUseInChat']) {
    if (!new RegExp(`ipcMain\\.handle\\(\\s*CHANNELS\\.${name},\\s*guarded`).test(ipc)) check(`G: ${name} is handled through the sender guard`, false)
  }
  check('G: every images handler goes through the sender guard', ['imagesStatus', 'imagesSetOn', 'imagesReset', 'imagesEstimate', 'imagesGenerate', 'imagesStop', 'imagesList', 'imagesPicture', 'imagesSaveCopy', 'imagesRemove', 'imagesUseInChat'].every((name) => new RegExp(`ipcMain\\.handle\\(\\s*CHANNELS\\.${name},\\s*guarded`).test(ipc)))
  check('G: the ones that can ask or open a dialog are given the window the call came from', ['imagesSetOn', 'imagesGenerate', 'imagesSaveCopy', 'imagesRemove'].every((name) => new RegExp(`CHANNELS\\.${name},\\s*guardedForWindow`).test(ipc)))
  check('G: the preload sends exact objects (no size, no path, no key)', /CHANNELS\.imagesGenerate, \{ prompt, model, shape, quality, count, chat \}/.test(preload) && /CHANNELS\.imagesEstimate, \{ model, shape, quality, count \}/.test(preload) && !/size|path|apiKey/.test(preload.slice(preload.indexOf('images: {'), preload.indexOf('images: {') + 1200)))
  check('G: the bridge type has the eleven functions', /images: \{\n\s+status\(\)/.test(shared) && ['setOn', 'reset', 'estimate', 'generate', 'stop', 'list', 'picture', 'saveCopy', 'remove', 'useInChat'].every((f) => new RegExp(`\\n\\s+${f}\\(`).test(shared.slice(shared.indexOf('  images: {')))))
  check('G: the switch file and the index are rewritten with the chats (the kept documents)', /voiceSettings\.file,\n\s+imageSettings\.file,\n\s+imageIndex\n/.test(ipc))
  check('G: quitting stops a request on its way and waits for the files', /^ {4}images\.stop\(\)/m.test(ipc) && /imageStore\.whenIdle\(\)/.test(ipc) && /imageIndex\.whenIdle\(\)/.test(ipc) && /imageSettings\.file\.whenIdle\(\)/.test(ipc))
  check('G: the registry\'s retirements are told at start', /reportImagesRegistry\(\)/.test(ipc))
  check('G: the reply path cannot start a picture (no import of the service or the adapter)', !['src/main/chat.ts', 'src/main/replyTools.ts', 'src/main/toolRegistry.ts', 'src/main/toolCore.ts', 'src/main/mcpTools.ts'].some((f) => /imageService|openaiImages/.test(source(f))))
  check('G: no image file imports Electron but the dialog (backupDialogs.ts)', ['imageService.ts', 'imageStore.ts', 'imageIndex.ts', 'imageSettings.ts', 'imageCheck.ts', 'providers/openaiImages.ts'].every((f) => !/from 'electron'/.test(source(`src/main/${f}`))))
  check('G: the store removes only ids it made (the random id check comes first)', /async function removeFile\(id: string\): Promise<boolean> \{\n\s+if \(!isPictureId\(id\)\) return false/.test(source('src/main/imageStore.ts')))
})

await mock.close()
const ok = check.summary()
process.exit(ok ? 0 : 1)
