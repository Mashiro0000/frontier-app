// Slice 17.6 under plain Node (no window): what goes into a Gemini request besides the conversation (D-049), and the golden test that the other two providers' requests
// did not change. What it shows:
//   A. THE GOLDEN TEST: every one of the 208 requests recorded from main before Stage 17 (tools/golden-17.json: six models of Anthropic and OpenAI, every shape, files,
//      tools, the tool loop, search, the listings) is byte for byte what the tree sends now;
//   B. files in a Gemini request: pictures and PDFs inline (their bytes as base64, their type), a text file as text led by its name, the person's words last, a message
//      that is only a file, files on two messages, a project's files first; the stand-in takes them and says what came;
//   C. what a Gemini model cannot be sent: a GIF (said, with the file's name), more than 14 MB of files (said, with the reason); the other providers keep their own rules;
//   D. instructions, a project, notes and the instructions for every chat go in the system instruction exactly as for OpenAI (the same prompt, word for word), and a
//      saved Google key in any of them refuses the request (the sentence names Google);
//   E. what the source must keep true.
// Run: node tools/guarded.mjs tools/verify-17-6.mjs      (ONLY=A,B runs some parts; A takes about 90 s)
import './ts-resolve.mjs'
import { checker } from './cdp.mjs'
import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { REPO, REPO_URL, TOOLS } from './paths.mjs'
import { startMock } from './mock-providers.mjs'
import { captureGolden, compareGolden } from './capture-golden-17.mjs'

const check = checker()
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(',')) : null
const guard = async (name, fn) => { if (ONLY && !ONLY.has(name)) return; try { await fn() } catch (error) { check(`${name} did not run to its end: ${String(error?.stack ?? error).slice(0, 400)}`, false) } }
const show = (v) => JSON.stringify(v)?.slice(0, 500)
const source = (rel) => readFileSync(join(REPO, rel), 'utf8')
const SRC = `${REPO_URL}/src`
const AR = await import(`${SRC}/main/attachmentRequest.ts`)
const AS = await import(`${SRC}/main/attachmentStore.ts`)
const G = await import(`${SRC}/main/providers/gemini.ts`)
const { buildStreamRequest, systemPromptFor, textFileLead } = await import(`${SRC}/main/providers/request.ts`)
const { parseRegistry } = await import(`${SRC}/shared/registry.ts`)
const S = await import(`${SRC}/main/secrets.ts`)

const models = parseRegistry(JSON.parse(source('registry/models.json'))).registry.models
const FLASH = models.find((m) => m.id === 'gemini-3.8-flash')
const ARGON = models.find((m) => m.id === 'gemini-4-argon')
const OPUS = models.find((m) => m.id === 'claude-opus-5-5')
const fixture = (name) => readFileSync(join(TOOLS, 'fixtures9', name))
const GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64')
/** A stand-in for the attachment store's reader: each id is a file of the test's, its facts read by the store's own factsOf. */
const reader = (files) => async (id) => { const bytes = files[id]; if (bytes === undefined) return { ok: false, why: 'missing', error: 'missing' }; const facts = AS.factsOf(bytes); return facts === null ? { ok: false, why: 'damaged', error: 'damaged' } : { ok: true, bytes, facts, form: 'plain' } }

// ============ A. the golden test ============
await guard('A', async () => {
  const golden = JSON.parse(readFileSync(join(TOOLS, 'golden-17.json'), 'utf8'))
  const now = await captureGolden({ port: Number(process.env.GOLDEN_PORT ?? 8903) })
  const { keys, differ } = compareGolden(golden, now)
  check('A: THE GOLDEN TEST: all 208 requests to Anthropic and OpenAI recorded before Stage 17 are byte for byte what the tree sends now (path, headers, body)', keys.length === 208 && differ.length === 0, `${keys.length} compared, ${differ.length} differ: ${differ.slice(0, 5).join(', ')}`)
  check('A: (the record covers files, tools, the tool loop, search, every effort and the listings of both)', ['claude-opus-5-5|files|all', 'gpt-6-luna|onlyfiles|instr', 'claude-sonnet-5-5|tool-loop', 'gpt-6.1-sol|search', 'gpt-6-luna|effort-none', 'openai|listing'].every((k) => keys.includes(k)))
  check('A: (and no request of the record went to Google)', Object.values(now.requests).flat().every((r) => !r.url?.startsWith?.('/v1beta')))
})

const PORT = Number(process.env.GEMINI_TEST_PORT ?? 8904)
await startMock(PORT)
const origin = `http://127.0.0.1:${PORT}`
const KEY = 'AIza' + randomBytes(27).toString('base64url').slice(0, 35)
const credentials = { apiKey: KEY, baseURL: origin }
const reset = () => fetch(`${origin}/__reset`, { method: 'POST' })
const requests = async () => (await (await fetch(`${origin}/__requests`)).json()).filter((r) => r.provider === 'google' && !r.listing)
const adapter = G.createGeminiAdapter({ startMs: 20000, idleMs: 20000, listMs: 2000 })
async function send(model, messages, extra = {}) {
  let text = ''
  let end = null
  let error = null
  try { for await (const e of adapter.stream(buildStreamRequest({ credentials, model, messages, signal: new AbortController().signal, ...extra }))) { if (e.type === 'text') text += e.text; else end = e } } catch (e) { error = adapter.normalizeError(e, { modelId: model.id }) }
  return { text, end, error }
}

// ============ B. files ============
await guard('B', async () => {
  const files = { png: fixture('q.png'), jpg: fixture('q.jpg'), webp: fixture('lossy.webp'), pdf: fixture('three-pages.pdf'), md: Buffer.from('# Notes\n\nline one\n', 'utf8') }
  const wire = [{ role: 'user', content: 'what are these? [[mock:files]]', attachments: [{ id: 'png', name: 'q.png' }, { id: 'jpg', name: 'q.jpg' }, { id: 'webp', name: 'lossy.webp' }, { id: 'pdf', name: 'three-pages.pdf' }, { id: 'md', name: 'notes.md' }] }]
  const resolved = await AR.resolveAttachments(wire, FLASH, reader(files))
  check('B: the five files are read for a Gemini model', resolved.ok && resolved.files.count === 5, show(resolved.error))
  await reset()
  const got = await send(FLASH, resolved.messages)
  const [r] = await requests()
  const parts = r.body.contents[0].parts
  check('B: one user turn of six parts: three pictures, a PDF, the text file, then the person\'s words', parts.length === 6 && parts[5].text === 'what are these? [[mock:files]]', show(parts.map((p) => Object.keys(p))))
  check('B: the pictures inline with their own types and bytes (PNG, JPEG, WebP)', ['image/png', 'image/jpeg', 'image/webp'].every((t, i) => parts[i].inlineData?.mimeType === t) && parts[0].inlineData.data === files.png.toString('base64') && parts[2].inlineData.data === files.webp.toString('base64'))
  check('B: the PDF inline as application/pdf, its bytes as base64 (no Files API, nothing kept on Google\'s side)', parts[3].inlineData?.mimeType === 'application/pdf' && parts[3].inlineData.data === files.pdf.toString('base64') && !r.raw.includes('fileData') && !r.raw.includes('fileUri'))
  check('B: the text file as text, led by the line that names it (as for OpenAI)', parts[4].text === `${textFileLead('notes.md')}\n\n# Notes\n\nline one\n`, show(parts[4]))
  check('B: the stand-in takes it and says what came', r.problems.length === 0 && /\[image\/png \d+ bytes\] \[image\/jpeg \d+ bytes\] \[image\/webp \d+ bytes\] \[application\/pdf \d+ bytes\]/.test(got.text), show([r.problems, got.text]))
  // a message that is only a file; files on two messages; a reply between
  const two = [{ role: 'user', content: '', attachments: [{ id: 'png', name: 'q.png' }] }, { role: 'assistant', content: 'I see a picture.' }, { role: 'user', content: 'and this? [[mock:files]]', attachments: [{ id: 'pdf', name: 'three-pages.pdf' }] }]
  const res2 = await AR.resolveAttachments(two, ARGON, reader(files))
  await reset()
  await send(ARGON, res2.messages)
  const [r2] = await requests()
  check('B: a message that is only a picture is a user turn of one part; the reply between is a model turn; the second message has its PDF then its words', r2.problems.length === 0 && JSON.stringify(r2.body.contents.map((c) => [c.role, c.parts.map((p) => (p.inlineData ? p.inlineData.mimeType : 'text'))])) === JSON.stringify([['user', ['image/png']], ['model', ['text']], ['user', ['application/pdf', 'text']]]), show(r2.body.contents.map((c) => c.parts.map((p) => Object.keys(p)))))
})

// ============ C. what a Gemini model cannot be sent ============
await guard('C', async () => {
  const gifWire = [{ role: 'user', content: 'look', attachments: [{ id: 'gif', name: 'moving.gif' }] }]
  const forGemini = await AR.resolveAttachments(gifWire, FLASH, reader({ gif: GIF }))
  check('C: a GIF for a Gemini model: nothing is sent, and the sentence names the model and the file', !forGemini.ok && forGemini.error === 'Nothing was sent: Gemini 3.8 Flash cannot read GIF pictures, and this chat has one ("moving.gif"). Choose another model, or start a new chat without it.', show(forGemini))
  const forClaude = await AR.resolveAttachments(gifWire, OPUS, reader({ gif: GIF }))
  check('C: the same GIF for Claude goes as before', forClaude.ok && forClaude.messages[0].attachments[0].mediaType === 'image/gif')
  // more than 14 MB of files: a reader that says the copy is a PDF of three pages (the store's own checks of a PDF are its business, 9.1; this is about the size)
  const sized = (files) => async (id) => (files[id] === undefined ? { ok: false, why: 'missing', error: 'missing' } : { ok: true, bytes: files[id], facts: { kind: 'pdf', mediaType: 'application/pdf', pages: 3 }, form: 'plain' })
  const padded = (size) => Buffer.alloc(size, 0x25)
  const big = padded(14 * 1024 * 1024 + 1024)
  const bigWire = [{ role: 'user', content: 'read it', attachments: [{ id: 'big', name: 'big.pdf' }] }]
  const tooBig = await AR.resolveAttachments(bigWire, ARGON, sized({ big }))
  check('C: 14.0 MB and a bit of files for a Gemini model: nothing is sent, with the reason (Google takes 20 MB, files go a third larger)', !tooBig.ok && /the files in this chat come to 14\.0 MB, and a request to Gemini 4 Argon may carry at most 14\.0 MB of files \(Google takes 20 MB in one request, and the files go in it a third larger\)/.test(tooBig.error), show(tooBig))
  const forOpus = await AR.resolveAttachments(bigWire, OPUS, sized({ big }))
  check('C: the same files for Claude: within the app\'s own cap of 20 MB, sent as before', forOpus.ok)
  const fits = padded(13.5 * 1024 * 1024)
  const ok = await AR.resolveAttachments([{ role: 'user', content: 'read it [[mock:files]]', attachments: [{ id: 'fits', name: 'fits.pdf' }] }], FLASH, sized({ fits }))
  await reset()
  const sent = await send(FLASH, ok.messages)
  const [r] = await requests()
  check('C: 13.5 MB of files for a Gemini model: sent, and the whole request (18 MB as base64) is within the stand-in\'s 20 MB', ok.ok && r.problems.length === 0 && Buffer.byteLength(r.raw) < 20 * 1024 * 1024 && sent.error === null, show([r.problems, Buffer.byteLength(r.raw), sent.error]))
  check('C: the cap is 14 MB exactly', AR.GEMINI_MAX_FILE_BYTES === 14 * 1024 * 1024)
})

// ============ D. instructions, projects, notes ============
await guard('D', async () => {
  const parts = { notes: ['Likes tea', 'Two lines\nof note'], everyChat: 'I live in Lisbon.', project: 'The project is a garden plan.' }
  check('D: the system prompt for Google is word for word the one for OpenAI, with every part (neither is told it is Claude)', systemPromptFor('google', 'Be brief.', parts) === systemPromptFor('openai', 'Be brief.', parts) && systemPromptFor('google') === systemPromptFor('openai') && !/You are Claude/.test(systemPromptFor('google', 'x', parts)))
  await reset()
  await send(FLASH, [{ role: 'user', content: 'hello' }], { instructions: 'Be brief.', ...parts })
  const [r] = await requests()
  check('D: it is the system instruction of the Gemini request, as one text part, and nothing of it is in the conversation', r.body.systemInstruction.parts.length === 1 && r.body.systemInstruction.parts[0].text === systemPromptFor('google', 'Be brief.', parts) && JSON.stringify(r.body.contents) === JSON.stringify([{ role: 'user', parts: [{ text: 'hello' }] }]))
  const KEY_G = 'AIza' + randomBytes(27).toString('base64url').slice(0, 35)
  const held = S.heldKey(`please use ${KEY_G} for the API`, [{ provider: 'google', key: KEY_G }])
  check('D: a saved Google key in instructions or notes is found and named as Google\'s (chat.ts then refuses the request in these words)', held === 'google' && S.keyInInstructions('google', 'for every chat') === 'Nothing was sent: your instructions for every chat hold your Google API key, which is saved in this app. Open Instructions and take it out.' && /Google API key/.test(S.keyInNotes('google')))
})

// ============ E. the source ============
await guard('E', async () => {
  const ar = source('src/main/attachmentRequest.ts')
  check('E: the GIF rule and the 14 MB cap apply to Google only (model.provider === \'google\')', /facts\.mediaType === 'image\/gif' &&\s+model\.provider === 'google'/.test(ar) && /model\.provider === 'google' && files\.bytes > GEMINI_MAX_FILE_BYTES/.test(ar))
  check('E: the adapter sends files inline only, never by reference', /inlineData: \{ mimeType: file\.mediaType, data: file\.data \}/.test(source('src/main/providers/gemini.ts')) && !/fileData|fileUri/.test(source('src/main/providers/gemini.ts').replace(/\/\/.*$/gm, '')))
  check('E: no Google name or rule in the Anthropic or OpenAI adapter', !/google|gemini/i.test(source('src/main/providers/anthropic.ts') + source('src/main/providers/openai.ts')))
})

process.exit(check.summary() ? 0 : 1)
