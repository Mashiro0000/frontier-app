// Slice 9.4 under plain Node (no window): what attached files are guessed to cost (D-037). The guess for an image (by its size), a PDF (by its pages), a text
// file (by its bytes) and each file's framing; what main's request check counts (each file each time it is sent); the estimate the question is asked from
// (the files' share, and nothing new for a request without files); a limit's refusal of a request with files (one sentence more, and none for "no limits
// set yet"); the few things chat.ts must keep true (the files are in the one guess used for the question, the limits and the ledger).
// Run: node tools/verify-9-4.mjs
import { checker } from './cdp.mjs'
import { mkdirSync, readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TOOLS } from './paths.mjs'
import { SRC, storeMod, standInTools, fixture, makePdf, same, source } from './lib9.mjs'

const check = checker()
const guard = async (name, fn) => { try { await fn() } catch (error) { check(`${name} did not run to its end: ${String(error?.stack ?? error).slice(0, 300)}`, false) } }
const show = (v) => JSON.stringify(v)?.slice(0, 260)
const usage = await import(`${SRC}/shared/usage.ts`)
const ask = await import(`${SRC}/shared/askFirst.ts`)
const limits = await import(`${SRC}/shared/limits.ts`)
const req = await import(`${SRC}/main/attachmentRequest.ts`)
const { parseRegistry } = await import(`${SRC}/shared/registry.ts`)
const reg = parseRegistry(JSON.parse(readFileSync(join(TOOLS, 'registry-good.json'), 'utf8')))
const opus = reg.registry.models.find((m) => m.id === 'claude-opus-5-5')

await guard('A', async () => {
  const { imageTokens, estimateFileTokens, PDF_PAGE_TOKENS } = usage
  check('A: an image is guessed by its size: one token a 28 x 28 square, and a quarter more (28 x 28 is 2; 2000 x 2000, the largest sent, is 6,480; 32 x 64 is 8)', imageTokens(28, 28) === 2 && imageTokens(2000, 2000) === 6480 && imageTokens(32, 64) === 8 && imageTokens(29, 28) === 3, show([imageTokens(28, 28), imageTokens(2000, 2000), imageTokens(32, 64), imageTokens(29, 28)]))
  check('A: ...at least Anthropic\'s own rule (one token for every 750 pixels) for every size up to 2000 px a side', [[100, 100], [750, 1], [1000, 1000], [1568, 1568], [2000, 1333], [2000, 2000], [57, 2000]].every(([w, h]) => imageTokens(w, h) >= Math.ceil((w * h) / 750)))
  check('A: a PDF page is 4,800 tokens (its text, up to 3,000, and a picture of it)', PDF_PAGE_TOKENS === 4800)
  const none = { count: 0, images: [], pdfPages: 0, textBytes: 0 }
  check('A: no files: nothing', estimateFileTokens(none) === 0)
  check('A: each part adds up: an image 2000 x 2000, a PDF of 3 pages and 3,000 bytes of text, three files: 6,480 + 14,400 + 1,000 + 3 x 16', estimateFileTokens({ count: 3, images: [{ width: 2000, height: 2000 }], pdfPages: 3, textBytes: 3000 }) === 6480 + 14400 + 1000 + 48)
  check('A: text is one token for three bytes, rounded up, like the rest of the guess', estimateFileTokens({ ...none, textBytes: 1 }) === 1 && estimateFileTokens({ ...none, textBytes: 4 }) === 2)
})

// The files of a request, read from a real store (9.1's).
const base = join(tmpdir(), `frontier-v94-${randomUUID()}`)
mkdirSync(base, { recursive: true })
const store = storeMod.createAttachmentStore(join(base, 'attachments'), { images: standInTools() })
const kept = {}
for (const [name, bytes] of [['photo.jpg', fixture('q.jpg')], ['report.pdf', makePdf(30)], ['notes.txt', Buffer.from('héllo wörld\n', 'utf8')]]) {
  const r = await store.add({ bytes, name })
  if (!r.ok) throw new Error(`could not keep ${name}: ${r.error}`)
  kept[name] = r.file.info
}
const wire = (name) => ({ id: kept[name].id, name })

await guard('B', async () => {
  const messages = [
    { role: 'user', content: 'look', attachments: [wire('photo.jpg'), wire('report.pdf'), wire('notes.txt')] },
    { role: 'assistant', content: 'seen' },
    { role: 'user', content: 'and again', attachments: [wire('photo.jpg')] }
  ]
  const r = await req.resolveAttachments(messages, opus, (id) => store.read(id))
  check('B: the request check counts every file each time it is sent (the photo twice: four in all)', r.ok && r.files.count === 4 && r.files.images.length === 2 && r.files.pdfs === 1 && r.files.pdfPages === 30, show(r.ok ? { ...r.files, images: r.files.images.length } : r))
  check('B: ...and the text file by its UTF-8 bytes (12 characters, 14 bytes), beside its characters for the cap', r.ok && r.files.textChars === 12 && r.files.textBytes === 14, show(r.ok ? r.files : r))
  const plain = await req.resolveAttachments([{ role: 'user', content: 'hi' }], opus, (id) => store.read(id))
  check('B: a request without files counts nothing', plain.ok && same(plain.files, req.NO_FILES) && plain.files.count === 0 && plain.files.textBytes === 0)
  const guess = usage.estimateFileTokens(r.files)
  check('B: what the files of that request are guessed at: two images of 64 x 32, 30 pages, 14 bytes of text, four files', guess === 2 * usage.imageTokens(64, 32) + 30 * 4800 + 5 + 4 * 16, String(guess))
})

await guard('C', async () => {
  const prices = opus.pricing
  const plain = ask.estimateRequest(1000, 64000, prices)
  check('C: an estimate without files is exactly what it was (no files field)', same(Object.keys(plain), ['inputTokens', 'inputUsd', 'outputTokens', 'outputUsd', 'totalUsd']), show(plain))
  check('C: ...and so is one given no files at all ({ count: 0 })', same(ask.estimateRequest(1000, 64000, prices, { count: 0, tokens: 0 }), plain))
  const withFiles = ask.estimateRequest(145_000, 64000, prices, { count: 1, tokens: 144_016 })
  check('C: with files the estimate says how many and how many of its tokens they are, and prices them with the rest', same(withFiles.files, { count: 1, tokens: 144_016 }) && withFiles.inputTokens === 145_000 && Math.abs(withFiles.inputUsd - (145_000 * Math.max(prices.inputPerMTok, prices.cacheWritePerMTok)) / 1e6) < 1e-12, show(withFiles))
  check('C: the default question ($0.50) is asked for a 30-page PDF on Claude Opus 5.5 (about $0.72 to send) and not for the same chat without it', ask.needsConfirmation(ask.defaultAskFirst(), withFiles) && !ask.needsConfirmation(ask.defaultAskFirst(), ask.estimateRequest(1000, 64000, prices)))
})

await guard('D', async () => {
  const L = { daily: { kind: 'usd', usd: 0.1 }, monthly: { kind: 'none' } }
  const refusal = limits.checkAgainstLimits(L, { today: 0, month: 0, request: 0.72 })
  const one = limits.withFilesNote(refusal, { count: 1, tokens: 144016 })
  check('D: a limit\'s refusal of a request with one file says the file is part of it and goes again with each message', one === `${refusal} The file in this chat is about 144,016 tokens of it: every file in a chat is sent again with each message, so a new chat without it costs less.`, one)
  const three = limits.withFilesNote(refusal, { count: 3, tokens: 2000 })
  check('D: ...with three: "The 3 files in this chat are ... without them"', three.endsWith('The 3 files in this chat are about 2,000 tokens of it: every file in a chat is sent again with each message, so a new chat without them costs less.'), three)
  check('D: unchanged without files, for a request that may go (null), and for "no limits are set yet"', limits.withFilesNote(refusal, undefined) === refusal && limits.withFilesNote(refusal, { count: 0, tokens: 0 }) === refusal && limits.withFilesNote(null, { count: 1, tokens: 5 }) === null && limits.withFilesNote(limits.LIMITS_UNSET_MESSAGE, { count: 1, tokens: 5 }) === limits.LIMITS_UNSET_MESSAGE)
})

await guard('E', async () => {
  const chat = source('main/chat.ts')
  const at = (a) => chat.indexOf(a)
  check('E: the one guess of what a request sends adds the files to the text, after the files are read and before the question, the limits and the ledger (a function since 11.3, inputTokensFor: with tools on, their definitions are in it too)', /const fileTokens = estimateFileTokens\(resolved\.files\)/.test(chat) && /const inputTokensFor = \(\): number =>\s*estimateInputTokens\(streamRequest\.system, streamRequest\.messages\) \+\s*fileTokens \+/.test(chat) && at('const fileTokens') > at('resolveAttachments(messages') && at('let inputTokens = inputTokensFor()') > at('const fileTokens') && at('let inputTokens = inputTokensFor()') < at('const estimate = estimateRequest(') && at('let inputTokens = inputTokensFor()') < at('const beginRequest = async'))
  check('E: the question is given the files\' share, and both limit checks (before the question, and the one that counts in the ledger) add the files\' sentence', /estimateRequest\(\s*inputTokens,\s*streamRequest\.maxOutputTokens,\s*entry\.pricing,\s*files\s*\)/.test(chat) && /refusal = withFilesNote\(\s*checkAgainstLimits\(before,/.test(chat) && /\(spend\) => withFilesNote\(checkAgainstLimits\(limits, spend\), files\)/.test(chat))
  check('E: the ledger\'s first line is that same guess (inputTokens, files included)', /prices: entry\.pricing,\s*inputTokens\s*\}/.test(chat))
  const dialog = source('renderer/src/chat/LargeRequestDialog.tsx')
  check('E: the question shows the files\' sentence only when the estimate has files', /\{request\.estimate\.files !== undefined && \(/.test(dialog) && /every file in a chat\s*is sent again with each message/.test(dialog))
})

process.exit(check.summary() ? 0 : 1)
