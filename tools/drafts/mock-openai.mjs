// A stand-in for OpenAI's Responses API (POST /v1/responses, streaming) and GET /v1/models, for testing Frontier App without a real
// key or any network. It is MY READING of OpenAI's documentation (developers.openai.com, read 2026-10-01) and of the `openai` SDK's
// own types, not the real API: its job is to refuse a request shape the documentation says is refused, and to behave on demand.
// Used by mock-providers.mjs, which owns the server, the request log and the expected key.
//
// Behaviour is chosen by a directive in the LAST user message: [[mock:NAME]] (default: echo the text back).
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// What each model accepts: the effort levels (gpt-6-luna also takes "none"), the output cap, and that all of them think.
export const OPENAI_MODELS = {
  'gpt-6-astra': { efforts: ['low', 'medium', 'high', 'xhigh', 'max'], maxOutput: 128000 },
  'gpt-6.1-sol': { efforts: ['low', 'medium', 'high', 'xhigh', 'max'], maxOutput: 128000 },
  'gpt-6-luna': { efforts: ['none', 'low', 'medium', 'high', 'xhigh', 'max'], maxOutput: 128000 }
}
const LISTED = ['gpt-6-astra', 'gpt-6.1-sol', 'gpt-6-luna', 'gpt-5.5', 'gpt-5.4-mini', 'o3', 'text-embedding-4-large', 'whisper-2']
const ALLOWED_FIELDS = new Set(['model', 'input', 'instructions', 'max_output_tokens', 'reasoning', 'store', 'stream'])

export function createOpenAIMock({ json, readBody, requests, expectedKey, modelsControl }) {
  const err = (status, message, code, type = 'invalid_request_error', param = null, extraHeaders = {}) => ({
    status, headers: { 'x-request-id': `req_mock_oai_${status}`, ...extraHeaders }, body: { error: { message, type, param, code } }
  })
  const send = (res, e) => json(res, e.status, e.body, e.headers)

  function problemsWith(headers, body) {
    const problems = []
    if (headers['x-api-key']) problems.push('an x-api-key header was sent (OpenAI wants Authorization: Bearer)')
    if (headers['openai-organization']) problems.push('an OpenAI-Organization header was sent: this app does not send one')
    if (headers['openai-project']) problems.push('an OpenAI-Project header was sent: this app does not send one')
    for (const name of Object.keys(body)) if (!ALLOWED_FIELDS.has(name)) problems.push(`Unknown parameter: '${name}'.`)
    const spec = OPENAI_MODELS[body.model]
    if (body.stream !== true) problems.push('stream must be true')
    if (body.store !== false) problems.push('store must be false: this app keeps nothing on the provider')
    if (typeof body.instructions !== 'string' || body.instructions === '') problems.push('instructions must be a non-empty string')
    if (!Number.isInteger(body.max_output_tokens) || body.max_output_tokens < 16) problems.push('max_output_tokens must be an integer of at least 16')
    else if (spec && body.max_output_tokens > spec.maxOutput) problems.push(`max_output_tokens ${body.max_output_tokens} is above the maximum of ${spec.maxOutput} for ${body.model}`)
    if (!Array.isArray(body.input) || body.input.length === 0) problems.push('input must be a non-empty array')
    else body.input.forEach((m, i) => {
      if (!m || !['user', 'assistant', 'system', 'developer'].includes(m.role)) problems.push(`input[${i}].role is not valid`)
      if (typeof m?.content !== 'string' || m.content.trim() === '') problems.push(`input[${i}].content must be non-empty text`)
    })
    if (body.reasoning !== undefined) {
      if (typeof body.reasoning !== 'object' || body.reasoning === null) problems.push('reasoning must be an object')
      else {
        for (const k of Object.keys(body.reasoning)) if (k !== 'effort') problems.push(`Unknown parameter: 'reasoning.${k}'.`)
        if ('effort' in body.reasoning && spec && !spec.efforts.includes(body.reasoning.effort)) problems.push(`Unsupported value: 'reasoning.effort' does not support '${body.reasoning.effort}' with this model.`)
      }
    }
    return problems
  }

  const lastUserText = (body) => {
    const m = [...(body.input ?? [])].reverse().find((x) => x.role === 'user')
    return typeof m?.content === 'string' ? m.content : ''
  }

  // ---- the events of one reply, in the order the real API sends them (the SDK's accumulator checks ids and indexes) ----
  const responseObject = (model, status, output, usage = null, extra = {}) => ({
    id: 'resp_mock', object: 'response', created_at: 1790000000, status, background: false, error: null, incomplete_details: null,
    instructions: null, max_output_tokens: null, model, output, parallel_tool_calls: true, previous_response_id: null, reasoning: { effort: null, summary: null },
    store: false, temperature: 1, text: { format: { type: 'text' } }, tool_choice: 'auto', tools: [], top_p: 1, truncation: 'disabled', usage, user: null, metadata: {}, ...extra
  })
  const USAGE = (over = {}) => ({ input_tokens: 25, input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 }, output_tokens: 40, output_tokens_details: { reasoning_tokens: 28 }, total_tokens: 65, ...over })

  function makeStream(res) {
    let seq = 0
    const emit = (type, data = {}) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, sequence_number: seq++, ...data })}\n\n`)
    return emit
  }

  async function handleResponses(req, res) {
    const raw = await readBody(req)
    let body
    try { body = JSON.parse(raw) } catch { return send(res, err(400, 'We could not parse the JSON body of your request.', null)) }
    const directive = [...lastUserText(body).matchAll(/\[\[mock:([a-z0-9-]+)\]\]/g)].at(-1)?.[1] ?? 'echo'
    const problems = problemsWith(req.headers, body)
    const record = { provider: 'openai', headers: req.headers, body, directive, problems, closedEarly: false, startedAt: Date.now(), finishedAt: null }
    requests.push(record)
    let alive = true
    res.on('close', () => { alive = false; record.finishedAt = Date.now(); if (!res.writableFinished) record.closedEarly = true })

    const auth = req.headers['authorization'] ?? ''
    const key = auth.startsWith('Bearer ') ? auth.slice(7) : null
    if (key === null) return send(res, err(401, "You didn't provide an API key. You need to provide your API key in an Authorization header using Bearer auth.", null))
    const wanted = expectedKey()
    if (wanted !== null && key !== wanted) return send(res, err(401, `Incorrect API key provided: ${key.slice(0, 4)}***${key.slice(-4)}. You can find your API key at https://platform.openai.com/account/api-keys.`, 'invalid_api_key'))
    const spec = OPENAI_MODELS[body.model]
    if (!spec) return send(res, err(404, `The model \`${String(body.model).slice(0, 64)}\` does not exist or you do not have access to it.`, 'model_not_found'))
    if (problems.length) return send(res, err(400, problems.join('; '), problems.some((p) => /^Unknown parameter/.test(p)) ? 'unknown_parameter' : null))

    const retryable = { 'x-should-retry': 'false' }
    switch (directive) {
      case '401': return send(res, err(401, 'Incorrect API key provided.', 'invalid_api_key'))
      case 'echo-key': return send(res, err(401, `Incorrect API key provided: ${key}. (a mock that repeats the whole key, to see that the app scrubs it)`, 'invalid_api_key'))
      case '403': return send(res, err(403, 'Country, region, or territory not supported', 'unsupported_country_region_territory'))
      case '404': return send(res, err(404, `The model \`${body.model}\` does not exist or you do not have access to it.`, 'model_not_found'))
      case '429': return send(res, err(429, 'Rate limit reached for requests. Please try again in 1s.', 'rate_limit_exceeded', 'requests', null, { ...retryable, 'retry-after': '1' }))
      case '429-quota': return send(res, err(429, 'You exceeded your current quota, please check your plan and billing details.', 'insufficient_quota', 'insufficient_quota', null, retryable))
      case '429-credit': return send(res, err(429, 'Your account has no credit left.', 'credit_balance_exhausted', 'insufficient_quota', null, retryable))
      case '400-context': return send(res, err(400, `This model's maximum context length is 1050000 tokens. However, your messages resulted in 1200000 tokens.`, 'context_length_exceeded'))
      case '500': return send(res, err(500, 'The server had an error while processing your request. Sorry about that!', 'server_error', 'server_error', null, retryable))
      case '503': return send(res, err(503, 'That model is currently overloaded with other requests.', 'server_is_overloaded', 'service_unavailable_error', null, retryable))
      case 'flaky':
        if (Number(req.headers['x-stainless-retry-count'] ?? 0) < 2) return send(res, err(503, 'That model is currently overloaded with other requests.', 'server_is_overloaded', 'service_unavailable_error', null, { 'retry-after-ms': '20' }))
        break
      case 'hang-before': return
      default:
    }

    res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache', 'x-request-id': 'req_mock_oai_ok' })
    const emit = makeStream(res)
    const model = body.model
    const items = []
    emit('response.created', { response: responseObject(model, 'in_progress', []) })
    emit('response.in_progress', { response: responseObject(model, 'in_progress', []) })
    // every model here thinks first: a reasoning item at output_index 0, so the text is at index 1 (the SDK must cope)
    const reasoning = { id: 'rs_mock', type: 'reasoning', summary: [] }
    emit('response.output_item.added', { output_index: 0, item: reasoning })
    emit('response.output_item.done', { output_index: 0, item: reasoning })
    items.push(reasoning)
    const itemId = 'msg_mock'
    const message = (status, content) => ({ id: itemId, type: 'message', status, role: 'assistant', content })
    emit('response.output_item.added', { output_index: 1, item: message('in_progress', []) })
    const refusing = directive === 'refusal'
    const part = (text) => (refusing ? { type: 'refusal', refusal: text } : { type: 'output_text', text, annotations: [], logprobs: [] })
    emit('response.content_part.added', { item_id: itemId, output_index: 1, content_index: 0, part: part('') })

    const reply = `Echo: ${lastUserText(body).replace(/\[\[mock:[a-z0-9-]+\]\]\s*/g, '')}`
    let said = ''
    const say = (piece) => {
      said += piece
      if (refusing) emit('response.refusal.delta', { item_id: itemId, output_index: 1, content_index: 0, delta: piece })
      else emit('response.output_text.delta', { item_id: itemId, output_index: 1, content_index: 0, delta: piece, logprobs: [] })
    }
    const closeText = () => {
      if (refusing) emit('response.refusal.done', { item_id: itemId, output_index: 1, content_index: 0, refusal: said })
      else emit('response.output_text.done', { item_id: itemId, output_index: 1, content_index: 0, text: said, logprobs: [] })
      emit('response.content_part.done', { item_id: itemId, output_index: 1, content_index: 0, part: part(said) })
      emit('response.output_item.done', { output_index: 1, item: message('completed', [part(said)]) })
    }
    const finish = (status, extra = {}, usage = USAGE()) => {
      const output = [...items, message(status === 'completed' ? 'completed' : 'incomplete', said === '' && directive === 'empty' ? [] : [part(said)])]
      const type = status === 'completed' ? 'response.completed' : status === 'incomplete' ? 'response.incomplete' : 'response.failed'
      emit(type, { response: responseObject(model, status, output, usage, extra) })
      res.end()
    }

    switch (directive) {
      case 'midstream-error':
        say('Partial ')
        await sleep(30)
        emit('error', { code: 'server_error', message: 'The server had an error while generating the response.', param: null })
        return res.end()
      case 'failed':
        say('Partial ')
        await sleep(30)
        return finish('failed', { error: { code: 'server_error', message: 'The model failed to generate a response.' } }, null)
      case 'incomplete-max':
        say('Cut off here')
        closeText()
        return finish('incomplete', { incomplete_details: { reason: 'max_output_tokens' } })
      case 'incomplete-filter':
        say('Cut off by a filter')
        closeText()
        return finish('incomplete', { incomplete_details: { reason: 'content_filter' } })
      case 'incomplete-odd':
        say('Cut off for a reason this app has not met')
        closeText()
        return finish('incomplete', { incomplete_details: { reason: 'something_new' } })
      case 'refusal':
        say("I'm sorry, but I can't help with that.")
        closeText()
        return finish('completed')
      case 'drop':
        say('Partial ')
        await sleep(60)
        return res.destroy()
      case 'early-close': // the stream ends cleanly, but the reply never says it is complete
        say('Partial ')
        await sleep(30)
        return res.end()
      case 'empty':
        closeText()
        return finish('completed')
      case 'cached':
        say(reply)
        closeText()
        return finish('completed', {}, USAGE({ input_tokens_details: { cached_tokens: 10, cache_write_tokens: 4 } }))
      case 'slow':
        await sleep(200)
        for (let i = 0; alive && i < 300; i++) { say(`tick${i} `); await sleep(100) }
        if (!alive) return
        closeText()
        return finish('completed')
      default: {
        const words = reply.match(/\S+\s*/g) ?? []
        const perPiece = Math.max(1, Math.ceil(words.length / 80))
        await sleep(400)
        for (let i = 0; i < words.length && alive; i += perPiece) { say(words.slice(i, i + perPiece).join('')); await sleep(30) }
        if (!alive) return
        closeText()
        finish('completed')
      }
    }
  }

  // GET /v1/models, OpenAI's shape: { object: 'list', data: [{ id, object: 'model', created, owned_by }] } (one page)
  function listModels(req, res) {
    const record = { provider: 'openai', headers: req.headers, url: req.url, listing: true, body: null, problems: [], closedEarly: false }
    requests.push(record)
    res.on('close', () => { if (!res.writableFinished) record.closedEarly = true })
    if (modelsControl().hang) return
    const auth = req.headers['authorization'] ?? ''
    const key = auth.startsWith('Bearer ') ? auth.slice(7) : null
    if (key === null) return send(res, err(401, "You didn't provide an API key.", null))
    const wanted = expectedKey()
    if (wanted !== null && key !== wanted) return send(res, err(401, `Incorrect API key provided: ${key.slice(0, 4)}***${key.slice(-4)}.`, 'invalid_api_key'))
    const fail = modelsControl().fail
    if (fail) return send(res, err(fail, 'listing failed on purpose', fail === 429 ? 'rate_limit_exceeded' : 'server_error', 'server_error', null, { 'x-should-retry': 'false' }))
    return json(res, 200, { object: 'list', data: LISTED.map((id, i) => ({ id, object: 'model', created: 1790000000 + i, owned_by: 'system' })) }, { 'x-request-id': 'req_mock_oai_list' })
  }

  return { handleResponses, listModels }
}
