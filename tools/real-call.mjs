// Frontier App: ONE REAL CALL PER PROVIDER, through the app's own adapters (src/main/providers/*), run by the person who owns the keys.
//
//   node real-call.mjs                  asks for each provider's API key (typed or pasted, hidden), then checks each provider
//   node real-call.mjs --only openai    only that provider
//   node real-call.mjs --model <id>     use this registry model instead of the cheapest one of each provider
//   node real-call.mjs --all            try EVERY registry model of each provider (a few cents in all; Fable and Astra cost the most)
//   node real-call.mjs --bad-key        also make one call with an invented key, to see the provider's real "key refused" answer (free)
//
// What it does, per provider, with the real API:
//   1. listModels: the models this key can use (free: no tokens), and which of the app's registry models are or are not in it;
//   2. one short reply from the cheapest registry model ("Reply with the single word: pong", at most 1024 tokens: well under a cent):
//      the text, how it ended, the tokens it used (the four buckets), how long the first word and the whole reply took.
// A key comes from the environment (ANTHROPIC_API_KEY, OPENAI_API_KEY) if one is set for this command, else you are asked. It is kept in
// memory for this run only: it is never written anywhere, never printed, and scrubbed from any error message. This script is NOT part of
// the app (the app reads no environment variable for a key); it lives outside the repository.
import { REPO, REPO_URL } from './paths.mjs'
import './ts-resolve.mjs'
import { readFileSync } from 'node:fs'

const args = process.argv.slice(2)
const flag = (name) => args.includes(name)
const value = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined }
const only = value('--only')
const forcedModel = value('--model')
const baseOverride = value('--base-url') // for testing this script against a local fake server ONLY
if (baseOverride) console.log(`!! --base-url given: calls go to ${baseOverride}, NOT to the providers.\n`)

const SRC = process.env.FRONTIER_SRC ?? `${REPO_URL}/src/`
const { adapterFor } = await import(`${SRC}main/providers/index.ts`)
const { buildStreamRequest } = await import(`${SRC}main/providers/request.ts`)
const { describeFailure } = await import(`${SRC}main/providers/errors.ts`)
const { parseRegistry, SUPPORTED_PROVIDERS, PROVIDER_NAMES } = await import(`${SRC}shared/registry.ts`)

const registryFile = process.env.FRONTIER_REGISTRY ?? `${REPO}/registry/models.json`
const parsed = parseRegistry(JSON.parse(readFileSync(registryFile, 'utf8')))
if (!parsed.ok) { console.error('The registry cannot be used: ' + parsed.error); process.exit(2) }
const registryModels = parsed.registry.models

const ENV = { anthropic: 'ANTHROPIC_API_KEY', openai: 'OPENAI_API_KEY' }

/** Asks for a key without showing it. Needs a real terminal; otherwise returns null. */
function askHidden(question) {
  return new Promise((resolve) => {
    const stdin = process.stdin
    if (!stdin.isTTY || typeof stdin.setRawMode !== 'function') return resolve(null)
    process.stdout.write(question)
    stdin.setRawMode(true)
    stdin.resume()
    stdin.setEncoding('utf8')
    let text = ''
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') {
          stdin.setRawMode(false); stdin.pause(); stdin.off('data', onData)
          process.stdout.write('\n')
          return resolve(text.trim() === '' ? null : text.trim())
        }
        if (ch === '\u0003') { process.stdout.write('\n'); process.exit(130) } // Ctrl+C
        if (ch === '\u007f' || ch === '\b') text = text.slice(0, -1)
        else text += ch
      }
    }
    stdin.on('data', onData)
  })
}

const cheapest = (models) => [...models].sort((a, b) => a.pricing.inputPerMTok + a.pricing.outputPerMTok - (b.pricing.inputPerMTok + b.pricing.outputPerMTok))[0]
const ms = (t0) => `${Math.round(performance.now() - t0)} ms`
let failures = 0
const say = (line = '') => console.log(line)

for (const provider of SUPPORTED_PROVIDERS) {
  if (only && only !== provider) continue
  const name = PROVIDER_NAMES[provider]
  say(`=== ${name} ${'='.repeat(60 - name.length)}`)
  let apiKey = process.env[ENV[provider]]?.trim() || null
  if (!apiKey) apiKey = await askHidden(`${name} API key (hidden; Enter to skip ${name}): `)
  if (!apiKey) { say(`skipped: no ${name} key given (set ${ENV[provider]} for this command, or run in a terminal and type it)`); say(); continue }
  const adapter = adapterFor(provider)
  const credentials = { apiKey, baseURL: baseOverride }
  const mine = registryModels.filter((m) => m.provider === provider)
  let ok = true

  // ---- 1. the model listing (free) ----
  try {
    const t0 = performance.now()
    const listed = await adapter.listModels(credentials)
    say(`1. listModels: OK, ${listed.length} models listed (${ms(t0)})`)
    const ids = new Set(listed.map((m) => m.id))
    const missing = mine.filter((m) => !ids.has(m.id))
    say(`   registry models in the listing: ${mine.length - missing.length} of ${mine.length}` + (missing.length ? `   NOT LISTED: ${missing.map((m) => m.id).join(', ')}` : ''))
    if (missing.length) say('   (a model that is not listed may be unavailable to this key, retired, or spelt differently by the provider: look before relying on it)')
    say(`   first few listed: ${listed.slice(0, 6).map((m) => m.id).join(', ')}${listed.length > 6 ? ', ...' : ''}`)
  } catch (error) {
    ok = false
    say(`1. listModels: FAILED: ${describeFailure(adapter.normalizeError(error, { modelId: '' }), apiKey)}`)
  }

  // ---- 2. one real reply ----
  const todo = forcedModel ? mine.filter((m) => m.id === forcedModel) : flag('--all') ? mine : [cheapest(mine)]
  if (todo.length === 0) say(`2. no registry model "${forcedModel}" for ${name}`)
  for (const model of todo) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 120000)
    const request = buildStreamRequest({ credentials, model, messages: [{ role: 'user', content: 'Reply with the single word: pong' }], signal: controller.signal })
    request.maxOutputTokens = Math.min(request.maxOutputTokens, 1024) // a smoke test: keep any possible cost tiny
    const t0 = performance.now()
    let first = null
    let text = ''
    let end = null
    try {
      for await (const event of adapter.stream(request)) {
        if (event.type === 'text') { if (first === null) first = performance.now(); text += event.text }
        else end = event
      }
      const u = end?.usage
      say(`2. reply from ${model.id} (effort ${model.effort ?? 'not sent'}): ${JSON.stringify(text.trim().slice(0, 120))}`)
      say(`   ended: ${JSON.stringify(end?.end)}; first text after ${first === null ? 'n/a' : ms(t0).replace(/\d+/, Math.round(first - t0))}, whole reply ${ms(t0)}`)
      say(`   tokens: ordinary input ${u?.inputTokens}, read from cache ${u?.cacheReadTokens}, written to cache ${u?.cacheWriteTokens}, output ${u?.outputTokens} (thinking included)`)
      if (u) {
        const cost = (u.inputTokens * model.pricing.inputPerMTok + u.outputTokens * model.pricing.outputPerMTok) / 1e6
        say(`   at the registry's list prices that is about $${cost.toFixed(5)} (cache tokens not priced)`)
      }
      if (end?.end.kind !== 'done') { ok = false; say('   !! the reply did not end normally') }
      if (!/pong/i.test(text)) say('   (note: the reply does not contain "pong"; the model may have phrased it differently)')
    } catch (error) {
      ok = false
      say(`2. reply from ${model.id}: FAILED: ${describeFailure(adapter.normalizeError(error, { modelId: model.id }), apiKey)}`)
    } finally {
      clearTimeout(timer)
    }
  }

  // ---- 3. optional: what the provider says to a key it does not know (free) ----
  if (flag('--bad-key')) {
    try {
      await adapter.listModels({ apiKey: 'invented-key-' + 'x'.repeat(40), baseURL: baseOverride })
      say('3. an invented key was ACCEPTED by listModels (unexpected)')
    } catch (error) {
      const n = adapter.normalizeError(error, { modelId: '' })
      say(`3. an invented key: kind "${n.kind}", status ${n.status}, request id ${n.requestId ?? 'none'}`)
      say(`   the person would read: ${describeFailure(n, 'invented-key')}`)
    }
  }
  if (!ok) failures++
  say(ok ? `${name}: OK` : `${name}: SOMETHING FAILED (see above)`)
  say()
  apiKey = null
}
say(failures === 0 ? 'Done. Nothing failed.' : `Done. ${failures} provider(s) had a problem.`)
process.exit(failures === 0 ? 0 : 1)
