// Golden capture for Stage 17 (D-049): what the Anthropic and OpenAI adapters send, recorded BEFORE the Gemini work (17.1, from main b8ee65a) and compared after it
// (17.6, and in the regression), so that adding a third provider can be proved to leave every request to the other two byte for byte what it was.
// It covers more than the 9.3 golden: for every Anthropic and OpenAI model of the fixed registry (tools/registry-good.json, read here as plain JSON, so a change of the
// registry's parser cannot change what is sent), several conversation shapes, with and without instructions, notes, instructions for every chat and a project; every
// effort a model lists; files (a PNG, a JPEG, a WebP, a PDF, a text file); a request that offers a tool, the turn that asked for it sent back with its result (the record
// as the adapter made it, from a real tool turn of the mock); a hosted web search; and the model listing. For each: the path, the stable headers and the exact body
// (its length and SHA-256).
// usage: node tools/capture-golden-17.mjs <out.json>            node tools/capture-golden-17.mjs --compare a.json b.json
import { REPO_URL } from './paths.mjs'
import './ts-resolve.mjs'
import { readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { startMock } from './mock-providers.mjs'

export function compareGolden(a, b) {
  const keys = [...new Set([...Object.keys(a.requests), ...Object.keys(b.requests)])].sort()
  const differ = keys.filter((k) => JSON.stringify(a.requests[k]) !== JSON.stringify(b.requests[k]))
  return { keys, differ }
}

export async function captureGolden({ port = 8898 } = {}) {
  const base = `${REPO_URL}/src/main/providers/`
  const { adapterFor } = await import(base + 'index.ts')
  const { buildStreamRequest } = await import(base + 'request.ts')
  const file = JSON.parse(readFileSync(new URL('./registry-good.json', import.meta.url), 'utf8'))
  const models = file.models.filter((m) => m.provider === 'anthropic' || m.provider === 'openai')
  const mock = await startMock(port)
  const origin = `http://127.0.0.1:${port}`
  const KEY = 'test-golden-17-key-0123456789abcdef0123456789'
  const credentials = { apiKey: KEY, baseURL: origin }
  const reset = () => fetch(`${origin}/__reset`, { method: 'POST' })
  const requests = async () => (await fetch(`${origin}/__requests`)).json()
  const stable = (headers) => Object.fromEntries(Object.entries(headers ?? {}).filter(([k]) => !['host', 'content-length', 'x-stainless-retry-count', 'x-stainless-timeout'].includes(k) && !/^x-stainless-(os|arch|runtime|runtime-version|lang|package-version)$/.test(k)).sort(([x], [y]) => (x < y ? -1 : 1)))
  const record = (got) => got.map((r) => ({ url: r.url, headers: stable(r.headers), length: Buffer.byteLength(r.raw ?? ''), sha256: createHash('sha256').update(r.raw ?? '', 'utf8').digest('hex') }))
  const fixture = (name) => readFileSync(new URL(`./fixtures9/${name}`, import.meta.url)).toString('base64')
  const signal = () => new AbortController().signal
  const drain = async (gen) => { const events = []; try { for await (const e of gen) events.push(e) } catch { /* a refusal of the mock is part of the record */ } return events }
  // only the request counts here: the first event (or a refusal) means the mock has it, and leaving the loop closes the connection
  const sendOnly = async (gen) => { try { for await (const e of gen) { void e; break } } catch { /* a refusal of the mock is part of the record */ } }

  const SMILE = String.fromCodePoint(0x1f600)
  const shapes = {
    one: [{ role: 'user', content: 'hello there' }],
    turns: [{ role: 'user', content: 'first' }, { role: 'assistant', content: 'an answer' }, { role: 'user', content: 'second' }],
    joined: [{ role: 'user', content: 'a' }, { role: 'user', content: 'b' }],
    unicode: [{ role: 'user', content: `quotes "x" 'y' \\ ${SMILE} é </script>` }],
    long: [{ role: 'user', content: 'lorem ipsum '.repeat(2000) }],
    files: [{ role: 'user', content: 'what are these?', attachments: [
      { kind: 'image', mediaType: 'image/png', data: fixture('q.png') },
      { kind: 'image', mediaType: 'image/jpeg', data: fixture('q.jpg') },
      { kind: 'image', mediaType: 'image/webp', data: fixture('lossy.webp') },
      { kind: 'pdf', name: 'three-pages.pdf', data: fixture('three-pages.pdf') },
      { kind: 'text', name: 'notes.md', text: '# Notes\n\nline one\nline two\n' }
    ] }],
    onlyfiles: [{ role: 'user', content: '', attachments: [{ kind: 'image', mediaType: 'image/png', data: fixture('alpha.png') }] }]
  }
  const prompts = {
    plain: {},
    instr: { instructions: 'Answer in French.' },
    all: { instructions: 'Be brief.', everyChat: 'I live in Lisbon.', notes: ['Likes tea', 'Two lines\nof note'], project: 'The project is a garden plan.' }
  }
  const TOOL = { name: 'web_search', description: 'Search the web.', parameters: { type: 'object', properties: { query: { type: 'string', minLength: 1, maxLength: 200 }, why: { type: 'string' } }, required: ['query', 'why'], additionalProperties: false } }

  const captured = { requests: {} }
  for (const model of models) {
    for (const [shape, messages] of Object.entries(shapes)) {
      for (const [p, parts] of Object.entries(prompts)) {
        await reset()
        await sendOnly(adapterFor(model.provider).stream(buildStreamRequest({ credentials, model, messages, ...parts, signal: signal() })))
        captured.requests[`${model.id}|${shape}|${p}`] = record((await requests()).filter((r) => !r.listing))
      }
    }
    for (const effort of [...model.capabilities.effortLevels, null]) {
      await reset()
      await sendOnly(adapterFor(model.provider).stream(buildStreamRequest({ credentials, model, effort, messages: shapes.one, signal: signal() })))
      captured.requests[`${model.id}|effort-${effort}`] = record((await requests()).filter((r) => !r.listing))
    }
    // a request that offers a tool; the model asks for it; the turn and its result are sent back
    await reset()
    const asked = [{ role: 'user', content: 'find the news [[mock:tool-use]]' }]
    const events = await drain(adapterFor(model.provider).stream(buildStreamRequest({ credentials, model, messages: asked, tools: [TOOL], signal: signal() })))
    const end = events.find((e) => e.type === 'end')
    const turns = end?.calls?.length ? [
      { role: 'assistant', content: '', toolTurn: { calls: end.calls, record: end.record } },
      { role: 'user', content: '', toolResults: end.calls.map((c) => ({ callId: c.id, text: 'Summary:\nIt came out last week.\nUntrusted text.', isError: false })) }
    ] : []
    await drain(adapterFor(model.provider).stream(buildStreamRequest({ credentials, model, messages: [...asked, ...turns], tools: [TOOL], signal: signal() })))
    captured.requests[`${model.id}|tool-loop`] = record((await requests()).filter((r) => !r.listing))
    captured.requests[`${model.id}|tool-loop-asked`] = [{ calls: end?.calls?.length ?? 0 }]
    // the hosted web search
    await reset()
    try { await adapterFor(model.provider).search({ credentials, model, effort: model.effort, query: 'rust release notes', maxOutputTokens: 4000, signal: signal() }) } catch { /* the request is what counts */ }
    captured.requests[`${model.id}|search`] = record((await requests()).filter((r) => !r.listing))
  }
  for (const provider of ['anthropic', 'openai']) {
    await reset()
    try { await adapterFor(provider).listModels(credentials) } catch { /* the request is what counts */ }
    captured.requests[`${provider}|listing`] = record((await requests()).filter((r) => r.listing))
  }
  await mock.close?.()
  return captured
}

if (import.meta.url === `file:///${process.argv[1].replaceAll('\\', '/')}`) {
  if (process.argv[2] === '--compare') {
    const { keys, differ } = compareGolden(JSON.parse(readFileSync(process.argv[3], 'utf8')), JSON.parse(readFileSync(process.argv[4], 'utf8')))
    console.log(`${keys.length} requests compared, ${differ.length} differ${differ.length ? ': ' + differ.slice(0, 10).join(', ') : ''}`)
    process.exit(differ.length === 0 && keys.length > 0 ? 0 : 1)
  }
  const out = process.argv[2]
  if (!out) throw new Error('usage: node tools/capture-golden-17.mjs <out.json>')
  const captured = await captureGolden()
  writeFileSync(out, JSON.stringify(captured, null, 1))
  console.log(`captured ${Object.keys(captured.requests).length} requests -> ${out}`)
  process.exit(0)
}
