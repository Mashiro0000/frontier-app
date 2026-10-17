// Golden capture for Stage 9.3 (D-037): what BOTH adapters send for conversations with no attachment, so that the change that teaches them attachments
// can be proved to leave every such request byte for byte what it was (as 7.4 proved for instructions). For every model of the fixed registry (tools/
// registry-good.json) and several conversation shapes (one message, turns, two of the person's in a row, instructions, unicode, a long text), the exact
// body text (its length and SHA-256, so that the committed copy, tools/golden-9.json, stays small), the path and the stable headers the mock received.
// usage: node tools/capture-golden-9.mjs <out.json>      then compare two captures with cmp (or: node tools/capture-golden-9.mjs --compare a.json b.json)
import { REPO_URL } from './paths.mjs'
import './ts-resolve.mjs'
import { readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { startMock } from './mock-providers.mjs'

if (process.argv[2] === '--compare') {
  const [a, b] = [JSON.parse(readFileSync(process.argv[3], 'utf8')), JSON.parse(readFileSync(process.argv[4], 'utf8'))]
  const keys = [...new Set([...Object.keys(a.requests), ...Object.keys(b.requests)])].sort()
  const differ = keys.filter((k) => JSON.stringify(a.requests[k]) !== JSON.stringify(b.requests[k]))
  console.log(`${keys.length} requests compared, ${differ.length} differ${differ.length ? ': ' + differ.slice(0, 10).join(', ') : ''}`)
  process.exit(differ.length === 0 && keys.length > 0 ? 0 : 1)
}
const out = process.argv[2]
if (!out) throw new Error('usage: node tools/capture-golden-9.mjs <out.json>')
const PORT = Number(process.env.GOLDEN_PORT ?? 8896)
const base = `${REPO_URL}/src/main/providers/`
const { adapterFor } = await import(base + 'index.ts')
const { buildStreamRequest } = await import(base + 'request.ts')
const { parseRegistry } = await import(`${REPO_URL}/src/shared/registry.ts`)
const registry = parseRegistry(JSON.parse(readFileSync(new URL('./registry-good.json', import.meta.url), 'utf8')))
if (!registry.ok) throw new Error('registry unusable: ' + registry.error)
const mock = await startMock(PORT)
const origin = `http://127.0.0.1:${PORT}`
const KEY = 'test-golden-9-key-0123456789abcdef0123456789'
const reset = () => fetch(`${origin}/__reset`, { method: 'POST' })
const requests = async () => (await fetch(`${origin}/__requests`)).json()
const stable = (headers) => Object.fromEntries(Object.entries(headers ?? {}).filter(([k]) => !['host', 'content-length', 'x-stainless-retry-count', 'x-stainless-timeout'].includes(k) && !/^x-stainless-(os|arch|runtime|runtime-version|lang|package-version)$/.test(k)).sort(([x], [y]) => (x < y ? -1 : 1)))

const SMILE = String.fromCodePoint(0x1f600)
const shapes = {
  one: [{ role: 'user', content: 'hello there' }],
  turns: [{ role: 'user', content: 'first' }, { role: 'assistant', content: 'an answer' }, { role: 'user', content: 'second' }],
  joined: [{ role: 'user', content: 'a' }, { role: 'user', content: 'b' }],
  unicode: [{ role: 'user', content: `quotes "x" 'y' \\ ${SMILE} é </script>` }],
  long: [{ role: 'user', content: 'lorem ipsum '.repeat(2000) }]
}
const captured = { requests: {} }
// (17.6: the record is of the two providers it was taken for; the Gemini models of the registry since 17.2 are not in it)
for (const model of registry.registry.models.filter((m) => m.provider === 'anthropic' || m.provider === 'openai')) {
  for (const [shape, messages] of Object.entries(shapes)) {
    for (const instructions of [undefined, 'Answer in French.']) {
      await reset()
      const request = buildStreamRequest({ credentials: { apiKey: KEY, baseURL: origin }, model, messages, instructions, signal: new AbortController().signal })
      try { for await (const event of adapterFor(model.provider).stream(request)) void event } catch { /* a refusal of the mock is part of the record: the request is what counts */ }
      const got = (await requests()).filter((r) => !r.listing)
      captured.requests[`${model.id}|${shape}|${instructions ? 'instr' : 'plain'}`] = got.map((r) => ({ url: r.url, headers: stable(r.headers), length: Buffer.byteLength(r.raw), sha256: createHash('sha256').update(r.raw, 'utf8').digest('hex') }))
    }
  }
}
await mock.close?.()
writeFileSync(out, JSON.stringify(captured, null, 1))
console.log(`captured ${Object.keys(captured.requests).length} requests -> ${out}`)
process.exit(0)
