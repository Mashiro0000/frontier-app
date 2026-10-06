// The fake provider API for the checks: Anthropic (Messages) and OpenAI (Responses), and each one's model list.
// A stand-in for POST /v1/messages (streaming) on this computer, for testing Frontier App without a real
// API key or any network. It speaks Anthropic's server-sent-event format, validates requests the way the
// real API is documented to (so a wrong request shape fails loudly), and misbehaves on demand.
// Behaviour is chosen by a directive in the LAST user message: [[mock:NAME]] (default: echo the text back,
// paced like the old fake reply: 400 ms pause, then word pieces 30 ms apart, at most 80 pieces).
//
//   GET  /__requests   -> everything received so far, as JSON (headers, body, problems, closedEarly)
//   POST /__reset      -> forget it
//   POST /__expect-key -> { key }  requests carrying any other x-api-key get a 401
//   POST /__models    -> { pageSize?: n, fail?: status, hang?: true }  GET /v1/models serves pages of at most n models, fails with that status, or never answers
import { anthropicBlockProblems, anthropicManyImages, describeAnthropic } from './mock-files.mjs'
import { createOpenAIMock } from './mock-openai.mjs'
import http from 'node:http'

// Stage 3: what each model accepts, from Anthropic's documentation (models overview, effort page), read on
// 2026-10-01. It is MY reading of the docs, not the real API: the point is that a request shape the real API
// is documented to refuse fails loudly here. A model that is not in this table gets a 404, like the real API.
//   effort: the levels the model accepts, or null when it rejects the parameter altogether
//   thinks: whether it thinks by itself (so a thinking block precedes the text in its stream)
const ALL_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max']
const MODELS = {
  'claude-fable-5-1': { effort: ALL_EFFORTS, thinks: true, maxOutput: 128000 },
  'claude-opus-5-5': { effort: ALL_EFFORTS, thinks: true, maxOutput: 128000 },
  'claude-sonnet-5-5': { effort: ALL_EFFORTS, thinks: true, maxOutput: 128000 },
  'claude-haiku-4-5-20251001': { effort: null, thinks: false, maxOutput: 64000 },
  'claude-haiku-4-5': { effort: null, thinks: false, maxOutput: 64000 } // the alias of the line above
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

export function startMock(port = 8787) {
  const requests = []
  let expectKey = null // the key the Anthropic side accepts (null: any)
  let expectKeyOpenAI = null // the key the OpenAI side accepts (null: any); POST /__expect-key { key, provider: 'openai' }
  let modelsControl = { pageSize: null, fail: null }

  const json = (res, status, body, headers = {}) => {
    res.writeHead(status, { 'content-type': 'application/json', ...headers })
    res.end(JSON.stringify(body))
  }
  const errorBody = (type, message, requestId) => ({ type: 'error', error: { type, message }, request_id: requestId })
  const readBody = (req) => new Promise((resolve) => { const chunks = []; req.on('data', (c) => chunks.push(c)); req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8'))) })
  const sse = (res, event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)

  // What the real API would reject. Anything found is reported as a 400, like the real thing.
  function problemsWith(headers, body) {
    const problems = []
    if (!headers['x-api-key']) problems.push('missing x-api-key')
    if (headers['authorization']) problems.push('an Authorization header was sent as well as x-api-key')
    if (!headers['anthropic-version']) problems.push('missing anthropic-version')
    const spec = MODELS[body.model] // an unknown model is answered with a 404 before this runs
    if (body.stream !== true) problems.push('stream must be true')
    if (!Number.isInteger(body.max_tokens) || body.max_tokens < 1) problems.push('max_tokens must be a positive integer')
    else if (spec && body.max_tokens > spec.maxOutput) problems.push(`max_tokens: ${body.max_tokens} > ${spec.maxOutput}, which is the maximum allowed number of output tokens for ${body.model}`)
    for (const removed of ['temperature', 'top_p', 'top_k', 'tool_choice']) if (removed in body) problems.push(`${removed} is not supported for this model`)
    if ('thinking' in body && body.thinking?.type !== 'adaptive') problems.push('thinking must be omitted or adaptive on this model')
    if (typeof body.system !== 'string' || body.system === '') problems.push('expected a non-empty system prompt')
    // effort: the mock no longer demands one value (that was a Stage 2 design assertion, not an API rule). It
    // refuses what the API is documented to refuse: the parameter on a model without it, or an unknown level.
    if (body.output_config !== undefined) {
      if (typeof body.output_config !== 'object' || body.output_config === null) problems.push('output_config must be an object')
      else if ('effort' in body.output_config) {
        if (spec && spec.effort === null) problems.push(`This model does not support the effort parameter.`)
        else if (spec && !spec.effort.includes(body.output_config.effort)) problems.push(`output_config.effort: "${body.output_config.effort}" is not a valid level for ${body.model}`)
      }
    }
    if (body.cache_control?.type !== 'ephemeral') problems.push('top-level cache_control was not sent')
    const messages = body.messages
    if (!Array.isArray(messages) || messages.length === 0) {
      problems.push('messages must be a non-empty array')
    } else {
      if (messages[0].role !== 'user') problems.push('first message must be user')
      if (messages.at(-1).role !== 'user') problems.push('last message must be user (prefill is not supported)')
      // 9.3 (D-037): a message's content is text, or a list of blocks (text, image, document), each checked as the documentation says.
      const images = []
      messages.forEach((m, i) => {
        if (typeof m.content === 'string') { if (m.content.trim() === '') problems.push(`messages.${i}: text content blocks must be non-empty`) }
        else if (Array.isArray(m.content)) problems.push(...anthropicBlockProblems(m, i, images))
        else problems.push(`messages.${i}.content: must be a string or a list of content blocks`)
        if (i > 0 && messages[i - 1].role === m.role) problems.push(`messages.${i}: roles must alternate between "user" and "assistant"`)
      })
      problems.push(...anthropicManyImages(images))
    }
    return problems
  }

  // GET /v1/models, Anthropic's shape: newest first, paged with limit / after_id, { data, has_more, first_id, last_id }.
  const LISTED = [
    ['claude-fable-5-1', 'Claude Fable 5.1', 1000000, 128000],
    ['claude-opus-5-5', 'Claude Opus 5.5', 1000000, 128000],
    ['claude-sonnet-5-5', 'Claude Sonnet 5.5', 1000000, 128000],
    ['claude-opus-5', 'Claude Opus 5', 1000000, 128000],
    ['claude-sonnet-5', 'Claude Sonnet 5', 1000000, 128000],
    ['claude-haiku-4-5-20251001', 'Claude Haiku 4.5', 200000, 64000]
  ].map(([id, display_name, max_input_tokens, max_tokens]) => ({ type: 'model', id, display_name, created_at: '2026-01-01T00:00:00Z', max_input_tokens, max_tokens, capabilities: null }))
  function listModels(req, res) {
    const record = { provider: 'anthropic', headers: req.headers, url: req.url, listing: true, body: null, problems: [], closedEarly: false }
    requests.push(record)
    res.on('close', () => { if (!res.writableFinished) record.closedEarly = true })
    if (modelsControl.hang) return // never answered: the client has to give up
    const key = req.headers['x-api-key']
    if (!key) return json(res, 401, errorBody('authentication_error', 'x-api-key header is required', 'req_mock_401'), { 'request-id': 'req_mock_401' })
    if (expectKey !== null && key !== expectKey) return json(res, 401, errorBody('authentication_error', 'invalid x-api-key', 'req_mock_401'), { 'request-id': 'req_mock_401' })
    if (modelsControl.fail) return json(res, modelsControl.fail, errorBody('api_error', 'listing failed on purpose', 'req_mock_' + modelsControl.fail), { 'request-id': 'req_mock_' + modelsControl.fail, 'x-should-retry': 'false' })
    const url = new URL(req.url, 'http://x')
    const asked = Number(url.searchParams.get('limit') ?? 20)
    const size = Math.max(1, Math.min(asked, modelsControl.pageSize ?? 1000, 1000))
    const after = url.searchParams.get('after_id')
    const start = after ? LISTED.findIndex((m) => m.id === after) + 1 : 0
    const data = LISTED.slice(start, start + size)
    return json(res, 200, { data, has_more: start + size < LISTED.length, first_id: data[0]?.id ?? null, last_id: data.at(-1)?.id ?? null }, { 'request-id': 'req_mock_list' })
  }

  const lastUserText = (body) => {
    const m = [...(body.messages ?? [])].reverse().find((x) => x.role === 'user')
    return typeof m?.content === 'string' ? m.content : Array.isArray(m?.content) ? m.content.map((b) => b.text ?? '').join('') : ''
  }

  // What a reply reports it used (8.1). Anthropic gives the input side in message_start (cache tokens beside input_tokens, not inside it) and the
  // output so far in message_delta. [[mock:cached]] reports cache tokens as well; [[mock:no-usage]] reports nothing (an empty usage object), [[mock:heavy]] reports a million input and a hundred thousand output tokens ($6 at Opus's prices; 8.2 uses it to reach a spending limit),
  // so the app has to guess; every other directive keeps the numbers the earlier stages knew (25 in, 12 out).
  const USAGE_START = { 'cached': { input_tokens: 25, cache_read_input_tokens: 800, cache_creation_input_tokens: 40, output_tokens: 1 }, 'no-usage': {}, 'heavy': { input_tokens: 1_000_000, output_tokens: 1 } }
  const USAGE_END = { 'cached': { output_tokens: 300 }, 'no-usage': {}, 'heavy': { output_tokens: 100_000 } }
  function beginStream(res, { thinking = true, model, directive } = {}) {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', 'request-id': 'req_mock_ok' })
    sse(res, 'message_start', { type: 'message_start', message: { id: 'msg_mock', type: 'message', role: 'assistant', model, content: [], stop_reason: null, stop_sequence: null, usage: USAGE_START[directive] ?? { input_tokens: 25, output_tokens: 1 } } })
    let index = 0
    if (thinking) {
      // The models that think by themselves (not Haiku 4.5 here) stream a thinking block first; with display "omitted" it has empty text and a signature.
      sse(res, 'content_block_start', { type: 'content_block_start', index, content_block: { type: 'thinking', thinking: '', signature: '' } })
      sse(res, 'content_block_delta', { type: 'content_block_delta', index, delta: { type: 'signature_delta', signature: 'EuYBmock' } })
      sse(res, 'content_block_stop', { type: 'content_block_stop', index })
      index++
    }
    sse(res, 'content_block_start', { type: 'content_block_start', index, content_block: { type: 'text', text: '' } })
    sse(res, 'ping', { type: 'ping' })
    return index
  }
  const text = (res, index, piece) => sse(res, 'content_block_delta', { type: 'content_block_delta', index, delta: { type: 'text_delta', text: piece } })
  function finish(res, index, stopReason, stopDetails, directive) {
    sse(res, 'content_block_stop', { type: 'content_block_stop', index })
    const delta = { stop_reason: stopReason, stop_sequence: null }
    if (stopDetails) delta.stop_details = stopDetails
    sse(res, 'message_delta', { type: 'message_delta', delta, usage: USAGE_END[directive] ?? { output_tokens: 12 } })
    sse(res, 'message_stop', { type: 'message_stop' })
    res.end()
  }

  async function echoPieces(res, index, reply, alive) {
    const words = reply.match(/\S+\s*/g) ?? []
    const perPiece = Math.max(1, Math.ceil(words.length / 80))
    await sleep(400)
    for (let i = 0; i < words.length && alive(); i += perPiece) {
      text(res, index, words.slice(i, i + perPiece).join(''))
      await sleep(30)
    }
  }

  // OpenAI's side (Responses API and model list) lives in mock-openai.mjs; it shares the server, the request log and the controls.
  const openai = createOpenAIMock({ json, readBody, requests, expectedKey: () => expectKeyOpenAI, modelsControl: () => modelsControl })

  const server = http.createServer(async (req, res) => {
    if (req.method === 'GET' && req.url === '/__requests') return json(res, 200, requests)
    if (req.method === 'POST' && req.url === '/__reset') { requests.length = 0; expectKey = null; expectKeyOpenAI = null; modelsControl = { pageSize: null, fail: null }; return json(res, 200, { ok: true }) }
    if (req.method === 'POST' && req.url === '/__models') { modelsControl = { pageSize: null, fail: null, ...JSON.parse(await readBody(req)) }; return json(res, 200, { ok: true }) }
    // Both providers list their models at GET /v1/models; they are told apart by how the key is sent (x-api-key, or Authorization: Bearer)
    if (req.method === 'GET' && req.url.split('?')[0] === '/v1/models') return !req.headers['x-api-key'] && req.headers['authorization'] ? openai.listModels(req, res) : listModels(req, res)
    if (req.method === 'POST' && req.url.split('?')[0] === '/v1/responses') return openai.handleResponses(req, res)
    if (req.method === 'POST' && req.url === '/__expect-key') {
      const { key, provider } = JSON.parse(await readBody(req))
      if (provider === 'openai') expectKeyOpenAI = key
      else expectKey = key
      return json(res, 200, { ok: true })
    }
    if (!(req.method === 'POST' && req.url.split('?')[0] === '/v1/messages')) return json(res, 404, errorBody('not_found_error', `no route ${req.method} ${req.url}`, 'req_mock_404'))

    const raw = await readBody(req)
    if (Buffer.byteLength(raw) > 32 * 1024 * 1024) return json(res, 413, errorBody('request_too_large', 'Request exceeds the maximum allowed number of bytes.', 'req_mock_413'))
    let body
    try { body = JSON.parse(raw) } catch { return json(res, 400, errorBody('invalid_request_error', 'request body is not valid JSON', 'req_mock_400')) }
    // The newest directive wins: after a failed reply the app merges the unanswered message into the next one.
    const directive = [...lastUserText(body).matchAll(/\[\[mock:([a-z0-9-]+)\]\]/g)].at(-1)?.[1] ?? 'echo'
    const problems = problemsWith(req.headers, body)
    const record = { provider: 'anthropic', headers: req.headers, url: req.url, raw, body, directive, problems, closedEarly: false, startedAt: Date.now(), finishedAt: null }
    requests.push(record)
    let alive = true
    res.on('close', () => { alive = false; record.finishedAt = Date.now(); if (!res.writableFinished) record.closedEarly = true })

    if (expectKey !== null && req.headers['x-api-key'] !== expectKey) return json(res, 401, errorBody('authentication_error', 'invalid x-api-key', 'req_mock_401'), { 'request-id': 'req_mock_401' })
    if (!MODELS[body.model]) return json(res, 404, errorBody('not_found_error', 'model: ' + body.model, 'req_mock_404'), { 'request-id': 'req_mock_404' })
    if (problems.length) return json(res, 400, errorBody('invalid_request_error', problems.join('; '), 'req_mock_400'), { 'request-id': 'req_mock_400' })

    const fail = (status, type, message, extra = {}) => json(res, status, errorBody(type, message, `req_mock_${status}`), { 'request-id': `req_mock_${status}`, 'x-should-retry': 'false', ...extra })
    switch (directive) {
      case '401': return fail(401, 'authentication_error', 'invalid x-api-key')
      case '403': return fail(403, 'permission_error', 'Your API key does not have permission to use the specified resource.')
      case '404': return fail(404, 'not_found_error', 'model: ' + body.model)
      case '400-credit': return fail(400, 'invalid_request_error', 'Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.')
      case '429': return fail(429, 'rate_limit_error', 'This request would exceed your organization rate limit.', { 'retry-after': '1' })
      case '500': return fail(500, 'api_error', 'Internal server error')
      case '529': return fail(529, 'overloaded_error', 'Overloaded')
      case 'flaky': {
        // Overloaded for the first two attempts, fine on the third: the SDK's own retries should hide it.
        if (Number(req.headers['x-stainless-retry-count'] ?? 0) < 2) return json(res, 529, errorBody('overloaded_error', 'Overloaded', 'req_mock_flaky'), { 'request-id': 'req_mock_flaky', 'retry-after-ms': '20' })
        break
      }
      case 'hang-before': return // never answer; the client has to give up (Stop)
      default:
    }

    const index = beginStream(res, { thinking: MODELS[body.model].thinks && directive !== 'no-thinking', model: body.model, directive })
    const reply = `Echo: ${lastUserText(body).replace(/\[\[mock:[a-z0-9-]+\]\]\s*/g, '')}`
    switch (directive) {
      case 'midstream-error':
        text(res, index, 'Partial ')
        await sleep(30)
        sse(res, 'error', { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } })
        return res.end()
      case 'drop':
        text(res, index, 'Partial ')
        await sleep(60)
        return res.destroy() // abrupt: no end event, connection reset
      case 'max-tokens':
        text(res, index, 'Cut off here')
        return finish(res, index, 'max_tokens')
      case 'refusal':
        return finish(res, index, 'refusal', { type: 'refusal', category: 'cyber', explanation: 'mock refusal' })
      case 'context-full':
        text(res, index, 'Almost ')
        return finish(res, index, 'model_context_window_exceeded')
      case 'empty':
        return finish(res, index, 'end_turn')
      case 'count':
        // 7.3: "Reply N", N = how many requests the mock has received, so a reply asked for again is visibly a NEW one.
        await echoPieces(res, index, `Reply ${requests.length}`, () => alive)
        return alive ? finish(res, index, 'end_turn') : undefined
      case 'say':
      case 'say-chars': {
        // 7.2 (Markdown): the reply is the rest of the message, word for word (no "Echo: "), so a test can send the app Markdown.
        // say-chars streams it two characters at a time, so a marker (**, a code fence, a table row) arrives cut in the middle.
        const verbatim = lastUserText(body).replace(/\[\[mock:[a-z0-9-]+\]\]\s*/g, '')
        if (directive === 'say') await echoPieces(res, index, verbatim, () => alive)
        else {
          await sleep(100)
          for (let i = 0; i < verbatim.length && alive; i += 2) { text(res, index, verbatim.slice(i, i + 2)); await sleep(4) }
        }
        return alive ? finish(res, index, 'end_turn') : undefined
      }
      case 'files':
        // 9.3: the reply says what the last message of the person's carried: each image (type, size, bytes), PDF (title, bytes), text document and text block.
        await echoPieces(res, index, describeAnthropic(body), () => alive)
        return alive ? finish(res, index, 'end_turn') : undefined
      case 'slow':
        await sleep(200)
        for (let i = 0; alive && i < 300; i++) { text(res, index, `tick${i} `); await sleep(100) }
        return alive ? finish(res, index, 'end_turn') : undefined
      default: {
        await echoPieces(res, index, reply, () => alive)
        if (alive) finish(res, index, 'end_turn', undefined, directive)
      }
    }
  })
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve({ port, requests, close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r) }) })))
}

if (import.meta.url === `file:///${process.argv[1].replaceAll('\\', '/')}`) {
  const port = Number(process.argv[2] ?? 8787)
  await startMock(port)
  console.log(`mock Anthropic API listening on http://127.0.0.1:${port}`)
}
