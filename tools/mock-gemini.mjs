// A stand-in for Google's Gemini API (Stage 17.1, D-049): POST /v1beta/models/{id}:streamGenerateContent?alt=sse and GET /v1beta/models, for testing Frontier App without
// a real key or any network. It is MY READING of Google's pages (the models page, the API reference for generateContent and models.list, the thinking, function-calling,
// document and image pages, the error-codes page; read on 17 October 2026), not the real API: its job is to refuse a request shape the documentation says is refused, to
// flag what this app must never do (the key in the address, a header the app does not send), and to misbehave on demand. Used by mock-providers.mjs, which owns the
// server, the request log and the controls.
//
// Behaviour is chosen by a directive in the LAST text part of the person's LAST turn: [[mock:NAME]] (default: echo the text back).
//   say, count, cached, no-usage, hostile-usage, thoughts, files, slow, empty, tool-use, tool-many, tool-two
//   blocked-prompt, blocked-prompt-other, blocked-reply, prohibited, recitation, max-tokens, malformed-call, finish-other, finish-odd
//   400, 400-key, echo-key, 403, 404, 429, 429-quota, 500, 503, 504, hang-before, drop, early-close, midstream-error, not-json, html-error
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// What each model takes (the model cards, read 2026-10-17): the thinking levels, the output cap. `minimal` is an error on 3.8 Flash ("not supported").
export const GEMINI_MODELS = {
  'gemini-4-argon': { levels: ['low', 'medium', 'high'], maxOutput: 65536, context: 1048576 },
  'gemini-3.8-flash': { levels: ['low', 'medium', 'high'], maxOutput: 65536, context: 1048576 }
}
const LISTED = [
  ['gemini-4-argon', 'Gemini 4 Argon'], ['gemini-3.8-flash', 'Gemini 3.8 Flash'], ['gemini-3.6-flash', 'Gemini 3.6 Flash'], ['gemini-3.5-flash-lite', 'Gemini 3.5 Flash-Lite'],
  ['gemini-3.1-flash-lite', 'Gemini 3.1 Flash-Lite'], ['gemini-3.1-pro-preview', 'Gemini 3.1 Pro Preview'], ['text-embedding-005', 'Text Embedding 005']
]
const TOP_FIELDS = ['contents', 'systemInstruction', 'generationConfig', 'tools', 'toolConfig', 'safetySettings', 'cachedContent']
const GENERATION_FIELDS = ['maxOutputTokens', 'thinkingConfig', 'temperature', 'topP', 'topK', 'candidateCount', 'stopSequences', 'responseMimeType', 'responseSchema', 'responseJsonSchema', 'presencePenalty', 'frequencyPenalty', 'seed', 'responseLogprobs', 'logprobs', 'mediaResolution']
const THINKING_FIELDS = ['thinkingLevel', 'includeThoughts', 'thinkingBudget']
// The media types the image and document pages list for inline data. GIF is not among them.
const INLINE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/heic', 'image/heif', 'application/pdf', 'text/plain']
// "The total request size, including the files sent inline, is limited to 20 MB" (the document and image pages, as I read them; not proven)
export const GEMINI_INLINE_LIMIT = 20 * 1024 * 1024
// The schema keywords the function-calling page lists for `parameters` (a subset of OpenAPI). `parametersJsonSchema` takes a JSON schema as it is.
const SCHEMA_KEYS = ['type', 'format', 'title', 'description', 'nullable', 'enum', 'maxItems', 'minItems', 'properties', 'required', 'minProperties', 'maxProperties', 'minLength', 'maxLength', 'pattern', 'example', 'anyOf', 'propertyOrdering', 'default', 'items', 'minimum', 'maximum']
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/
const SIGNATURE = 'CiIBmockThoughtSignature0123456789=='

export function createGeminiMock({ json, readBody, requests, expectedKey, modelsControl }) {
  let toolsControl = {}
  const issued = new Map() // call ids the mock gave out -> the signature it put on them
  const err = (status, code, message, extra = {}) => ({ status, body: { error: { code: status, message, status: code, ...extra } } })
  const send = (res, e) => json(res, e.status, e.body)

  function schemaProblems(schema, where, out) {
    if (typeof schema !== 'object' || schema === null || Array.isArray(schema)) { out.push(`Invalid value at '${where}': must be an object.`); return }
    for (const key of Object.keys(schema)) if (!SCHEMA_KEYS.includes(key)) out.push(`Invalid JSON payload received. Unknown name "${key}" at '${where}': Cannot find field.`)
    if (schema.properties && typeof schema.properties === 'object') for (const [name, sub] of Object.entries(schema.properties)) schemaProblems(sub, `${where}.properties[${name}].value`, out)
    if (schema.items) schemaProblems(schema.items, `${where}.items`, out)
  }

  function problemsWith(req, body, modelId) {
    const problems = []
    const url = new URL(req.url, 'http://x')
    if (url.searchParams.has('key')) problems.push('THE KEY WAS PUT IN THE ADDRESS (?key=): this app must send it only in the x-goog-api-key header')
    if (url.searchParams.get('alt') !== 'sse') problems.push('alt=sse is missing: without it the stream is one JSON array, not server-sent events')
    for (const name of url.searchParams.keys()) if (!['alt', 'key'].includes(name)) problems.push(`an unexpected query parameter "${name}" was sent`)
    if (req.headers['authorization']) problems.push('an Authorization header was sent: this app sends the key in x-goog-api-key only')
    if (req.headers['x-api-key']) problems.push('an x-api-key header was sent (that is Anthropic\'s)')
    if (req.headers['x-goog-user-project']) problems.push('an x-goog-user-project header was sent: this app does not send one')
    if (!/^application\/json/.test(req.headers['content-type'] ?? '')) problems.push('the body is not sent as application/json')
    if (typeof body !== 'object' || body === null || Array.isArray(body)) return ['Invalid JSON payload received. Expected an object.']
    for (const name of Object.keys(body)) if (!TOP_FIELDS.includes(name)) problems.push(`Invalid JSON payload received. Unknown name "${name}": Cannot find field.`)
    const spec = GEMINI_MODELS[modelId]
    // contents
    if (!Array.isArray(body.contents) || body.contents.length === 0) problems.push('* GenerateContentRequest.contents: contents is not specified')
    else {
      let inlineBytes = 0
      body.contents.forEach((content, i) => {
        const where = `contents[${i}]`
        if (typeof content !== 'object' || content === null) { problems.push(`${where}: must be an object`); return }
        for (const extra of Object.keys(content)) if (!['role', 'parts'].includes(extra)) problems.push(`Invalid JSON payload received. Unknown name "${extra}" at '${where}': Cannot find field.`)
        if (!['user', 'model'].includes(content.role)) problems.push(`${where}.role: Please use a valid role: user, model.`)
        if (!Array.isArray(content.parts) || content.parts.length === 0) { problems.push(`* GenerateContentRequest.${where}.parts: contents.parts must not be empty.`); return }
        content.parts.forEach((part, k) => {
          const at = `${where}.parts[${k}]`
          if (typeof part !== 'object' || part === null) { problems.push(`${at}: must be an object`); return }
          const kinds = ['text', 'inlineData', 'functionCall', 'functionResponse', 'fileData'].filter((kind) => kind in part)
          for (const extra of Object.keys(part)) if (![...kinds, 'thought', 'thoughtSignature'].includes(extra)) problems.push(`Invalid JSON payload received. Unknown name "${extra}" at '${at}': Cannot find field.`)
          if (kinds.length !== 1) { problems.push(`${at}: a part must hold exactly one of text, inlineData, functionCall, functionResponse (it holds ${kinds.length})`); return }
          const kind = kinds[0]
          if (kind === 'text' && (typeof part.text !== 'string' || part.text === '')) problems.push(`${at}.text: must be a non-empty string`)
          if (kind === 'fileData') problems.push(`${at}: fileData (the Files API) is not used by this app: files are sent inline`)
          if (kind === 'inlineData') {
            const d = part.inlineData
            if (typeof d !== 'object' || d === null) { problems.push(`${at}.inlineData: must be an object`); return }
            for (const extra of Object.keys(d)) if (!['mimeType', 'data'].includes(extra)) problems.push(`Invalid JSON payload received. Unknown name "${extra}" at '${at}.inline_data': Cannot find field.`)
            if (!INLINE_TYPES.includes(d.mimeType)) problems.push(`${at}.inlineData.mimeType: Unsupported MIME type: ${String(d.mimeType).slice(0, 40)}`)
            if (typeof d.data !== 'string' || d.data === '' || d.data.length % 4 !== 0 || !BASE64.test(d.data)) problems.push(`Invalid value at '${at}.inline_data.data' (TYPE_BYTES), Base64 decoding failed`)
            else inlineBytes += Buffer.byteLength(d.data, 'base64')
            if (content.role !== 'user') problems.push(`${at}: inline data is only taken in a user turn here`)
          }
          if (kind === 'functionCall') {
            const c = part.functionCall
            if (content.role !== 'model') problems.push(`${at}: a functionCall belongs to a model turn`)
            if (typeof c?.name !== 'string' || typeof c?.args !== 'object' || c.args === null || Array.isArray(c.args)) problems.push(`${at}.functionCall: needs a name and args (an object)`)
            for (const extra of Object.keys(c ?? {})) if (!['name', 'args', 'id'].includes(extra)) problems.push(`Invalid JSON payload received. Unknown name "${extra}" at '${at}.function_call': Cannot find field.`)
          }
          if (kind === 'functionResponse') {
            const r = part.functionResponse
            if (content.role !== 'user') problems.push(`${at}: a functionResponse belongs to a user turn`)
            if (typeof r?.name !== 'string' || typeof r?.response !== 'object' || r.response === null || Array.isArray(r.response)) problems.push(`${at}.functionResponse: needs a name and a response (an object)`)
            for (const extra of Object.keys(r ?? {})) if (!['name', 'response', 'id'].includes(extra)) problems.push(`Invalid JSON payload received. Unknown name "${extra}" at '${at}.function_response': Cannot find field.`)
          }
          if ('thought' in part && part.thought === true) problems.push(`${at}: a thought part was sent back: this app does not ask for thoughts, so it has none to send`)
        })
      })
      if (body.contents[0]?.role !== 'user') problems.push('contents[0]: the first turn must be the user\'s')
      if (body.contents.at(-1)?.role !== 'user') problems.push('the last turn must be the user\'s (a model turn at the end is not continued)')
      if (inlineBytes + 4096 > GEMINI_INLINE_LIMIT) problems.push(`Request payload size exceeds the limit: ${GEMINI_INLINE_LIMIT} bytes.`)
      // a model turn that called functions is answered, in the very next turn, by a functionResponse for each call, by name (and by id when the call had one);
      // a call the mock issued with a thought signature must come back WITH that signature ("Function call is missing a thought_signature")
      body.contents.forEach((content, i) => {
        const calls = content?.role === 'model' && Array.isArray(content.parts) ? content.parts.filter((p) => p?.functionCall) : []
        if (calls.length === 0) return
        const next = body.contents[i + 1]
        const answers = next?.role === 'user' && Array.isArray(next.parts) ? next.parts.filter((p) => p?.functionResponse) : []
        if (answers.length !== calls.length) problems.push(`Please ensure that the number of function response parts is equal to the number of function call parts of the function call turn (contents[${i}]).`)
        calls.forEach((p, k) => {
          const answer = answers[k]?.functionResponse
          if (answer && answer.name !== p.functionCall.name) problems.push(`contents[${i + 1}]: the function response ${k} is named ${answer.name} but answers ${p.functionCall.name}`)
          if (answer && p.functionCall.id !== undefined && answer.id !== p.functionCall.id) problems.push(`contents[${i + 1}]: the function response ${k} does not carry the id of its call`)
          const signed = issued.get(p.functionCall.id ?? p.functionCall.name)
          if (signed && k === 0 && p.thoughtSignature !== signed) problems.push(`Function call is missing a thought_signature in functionCall parts. This is required for tools to work correctly (contents[${i}].parts[${content.parts.indexOf(p)}]).`)
        })
      })
      body.contents.forEach((content, i) => {
        if (content?.role !== 'user' || !Array.isArray(content.parts) || !content.parts.some((p) => p?.functionResponse)) return
        const before = body.contents[i - 1]
        if (!(before?.role === 'model' && Array.isArray(before.parts) && before.parts.some((p) => p?.functionCall))) problems.push(`contents[${i}]: a function response must follow the model turn that called the function`)
      })
    }
    // systemInstruction
    if (body.systemInstruction !== undefined) {
      const s = body.systemInstruction
      if (typeof s !== 'object' || s === null || !Array.isArray(s.parts) || s.parts.length === 0 || s.parts.some((p) => typeof p?.text !== 'string' || p.text === '' || Object.keys(p).length !== 1)) problems.push('systemInstruction: must be { parts: [{ text }] } with non-empty text parts')
      for (const extra of Object.keys(s ?? {})) if (!['parts', 'role'].includes(extra)) problems.push(`Invalid JSON payload received. Unknown name "${extra}" at 'system_instruction': Cannot find field.`)
    } else problems.push('no systemInstruction: this app always sends its rules')
    // generationConfig
    const g = body.generationConfig
    if (g !== undefined) {
      if (typeof g !== 'object' || g === null) problems.push('generationConfig: must be an object')
      else {
        for (const extra of Object.keys(g)) if (!GENERATION_FIELDS.includes(extra)) problems.push(`Invalid JSON payload received. Unknown name "${extra}" at 'generation_config': Cannot find field.`)
        for (const sent of ['temperature', 'topP', 'topK', 'candidateCount']) if (sent in g) problems.push(`generationConfig.${sent} was sent: this app leaves it to the model`)
        if (!Number.isInteger(g.maxOutputTokens) || g.maxOutputTokens < 1) problems.push('generationConfig.maxOutputTokens: must be a positive integer')
        else if (spec && g.maxOutputTokens > spec.maxOutput) problems.push(`The maximum number of output tokens for ${modelId} is ${spec.maxOutput} (asked: ${g.maxOutputTokens}).`)
        const t = g.thinkingConfig
        if (t !== undefined) {
          if (typeof t !== 'object' || t === null) problems.push('generationConfig.thinkingConfig: must be an object')
          else {
            for (const extra of Object.keys(t)) if (!THINKING_FIELDS.includes(extra)) problems.push(`Invalid JSON payload received. Unknown name "${extra}" at 'generation_config.thinking_config': Cannot find field.`)
            if ('thinkingBudget' in t && 'thinkingLevel' in t) problems.push('thinking_budget and thinking_level cannot be set together.')
            if ('thinkingLevel' in t && spec && !spec.levels.includes(t.thinkingLevel)) problems.push(`Thinking level ${String(t.thinkingLevel).slice(0, 20)} is not supported for this model.`)
            if ('includeThoughts' in t && typeof t.includeThoughts !== 'boolean') problems.push('thinking_config.include_thoughts: must be a boolean')
            if (t.includeThoughts === true) problems.push('includeThoughts was asked for: this app does not ask for the thoughts (D-049)')
          }
        }
      }
    } else problems.push('no generationConfig: this app always says how long a reply may be')
    // tools
    if (body.tools !== undefined) {
      if (!Array.isArray(body.tools) || body.tools.length === 0) problems.push('tools: must be a non-empty list')
      else body.tools.forEach((tool, i) => {
        const keys = Object.keys(tool ?? {})
        if (keys.some((k) => ['googleSearch', 'googleSearchRetrieval', 'codeExecution', 'urlContext', 'fileSearch', 'googleMaps', 'computerUse'].includes(k))) problems.push(`tools[${i}]: a Google-hosted tool (${keys.join(', ')}) was offered: this app offers its own functions only (D-049)`)
        for (const extra of keys) if (extra !== 'functionDeclarations' && !['googleSearch', 'googleSearchRetrieval', 'codeExecution', 'urlContext', 'fileSearch', 'googleMaps', 'computerUse'].includes(extra)) problems.push(`Invalid JSON payload received. Unknown name "${extra}" at 'tools[${i}]': Cannot find field.`)
        const decls = tool?.functionDeclarations
        if (decls === undefined) return
        if (!Array.isArray(decls) || decls.length === 0) { problems.push(`tools[${i}].functionDeclarations: must be a non-empty list`); return }
        const names = new Set()
        decls.forEach((d, k) => {
          const at = `tools[${i}].function_declarations[${k}]`
          if (typeof d?.name !== 'string' || !/^[a-zA-Z_][a-zA-Z0-9_.:-]{0,127}$/.test(d.name)) problems.push(`* GenerateContentRequest.${at}.name: Invalid function name.`)
          if (names.has(d?.name)) problems.push(`${at}.name: duplicate function name`)
          names.add(d?.name)
          for (const extra of Object.keys(d ?? {})) if (!['name', 'description', 'parameters', 'parametersJsonSchema', 'response', 'responseJsonSchema', 'behavior'].includes(extra)) problems.push(`Invalid JSON payload received. Unknown name "${extra}" at '${at}': Cannot find field.`)
          if ('parameters' in d && 'parametersJsonSchema' in d) problems.push(`${at}: parameters and parametersJsonSchema cannot both be set`)
          if ('parameters' in d) schemaProblems(d.parameters, `${at}.parameters`, problems)
          if ('parametersJsonSchema' in d && (typeof d.parametersJsonSchema !== 'object' || d.parametersJsonSchema === null || d.parametersJsonSchema.type !== 'object')) problems.push(`${at}.parametersJsonSchema: must be a JSON schema of type object`)
        })
      })
    }
    if (body.toolConfig !== undefined) {
      const c = body.toolConfig?.functionCallingConfig
      for (const extra of Object.keys(body.toolConfig ?? {})) if (extra !== 'functionCallingConfig') problems.push(`Invalid JSON payload received. Unknown name "${extra}" at 'tool_config': Cannot find field.`)
      if (!c || !['AUTO', 'ANY', 'NONE', 'VALIDATED'].includes(c.mode)) problems.push('toolConfig.functionCallingConfig.mode: must be AUTO, ANY, NONE or VALIDATED')
      if (body.tools === undefined) problems.push('toolConfig was sent without tools')
    }
    if (body.safetySettings !== undefined) problems.push('safetySettings were sent: this app leaves Google\'s defaults alone (it never asks for less filtering)')
    if (body.cachedContent !== undefined) problems.push('cachedContent was sent: this app keeps nothing on Google\'s side')
    return problems
  }

  const lastUserText = (body) => {
    const turn = [...(body.contents ?? [])].reverse().find((c) => c?.role === 'user' && Array.isArray(c.parts) && c.parts.some((p) => typeof p?.text === 'string'))
    return turn ? turn.parts.filter((p) => typeof p?.text === 'string').at(-1).text : ''
  }
  const USAGE = (over = {}) => ({ promptTokenCount: 25, candidatesTokenCount: 12, totalTokenCount: 65, thoughtsTokenCount: 28, promptTokensDetails: [{ modality: 'TEXT', tokenCount: 25 }], ...over })

  function describe(body) {
    const turn = [...body.contents].reverse().find((c) => c.role === 'user')
    return turn.parts.map((p) => p.inlineData ? `[${p.inlineData.mimeType} ${Buffer.byteLength(p.inlineData.data, 'base64')} bytes]` : p.text !== undefined ? `[text ${p.text.length} chars: ${p.text.slice(0, 60).replace(/\s+/g, ' ')}]` : `[${Object.keys(p).join('+')}]`).join(' ')
  }

  async function handleGenerate(req, res, modelId) {
    const raw = await readBody(req)
    let body
    const record = { provider: 'google', headers: req.headers, url: req.url, raw, body: null, directive: null, problems: [], closedEarly: false, startedAt: Date.now(), finishedAt: null }
    requests.push(record)
    let alive = true
    res.on('close', () => { alive = false; record.finishedAt = Date.now(); if (!res.writableFinished) record.closedEarly = true })
    try { body = JSON.parse(raw) } catch { record.problems.push('the body is not JSON'); return send(res, err(400, 'INVALID_ARGUMENT', 'Invalid JSON payload received. Unexpected token.')) }
    record.body = body
    const directive = [...lastUserText(body).matchAll(/\[\[mock:([a-z0-9-]+)\]\]/g)].at(-1)?.[1] ?? 'echo'
    record.directive = directive
    record.problems = problemsWith(req, body, modelId)

    const key = req.headers['x-goog-api-key']
    const fromUrl = new URL(req.url, 'http://x').searchParams.get('key')
    if (typeof key !== 'string' && fromUrl === null) return send(res, err(403, 'PERMISSION_DENIED', 'Method doesn\'t allow unregistered callers (callers without established identity). Please use API Key or other form of API consumer identity to call this API.'))
    const wanted = expectedKey()
    const invalidKey = err(400, 'INVALID_ARGUMENT', 'API key not valid. Please pass a valid API key.', { details: [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: 'API_KEY_INVALID', domain: 'googleapis.com', metadata: { service: 'generativelanguage.googleapis.com' } }] })
    if (wanted !== null && (key ?? fromUrl) !== wanted) return send(res, invalidKey)
    if (!GEMINI_MODELS[modelId]) return send(res, err(404, 'NOT_FOUND', `models/${modelId.slice(0, 64)} is not found for API version v1beta, or is not supported for generateContent. Call ListModels to see the list of available models and their supported methods.`))
    if (record.problems.length) return send(res, err(400, 'INVALID_ARGUMENT', record.problems.join('; ')))

    switch (directive) {
      case '400': return send(res, err(400, 'INVALID_ARGUMENT', 'Request contains an invalid argument.'))
      case '400-key': return send(res, invalidKey)
      case 'echo-key': return send(res, err(400, 'INVALID_ARGUMENT', `API key not valid: ${key}. Please pass a valid API key. (a mock that repeats the whole key, to see that the app scrubs it)`, { details: [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: 'API_KEY_INVALID', domain: 'googleapis.com' }] }))
      case '403': return send(res, err(403, 'PERMISSION_DENIED', 'Generative Language API has not been used in project 123 before or it is disabled.'))
      case '404': return send(res, err(404, 'NOT_FOUND', `models/${modelId} is not found for API version v1beta, or is not supported for generateContent.`))
      case '429': return send(res, err(429, 'RESOURCE_EXHAUSTED', 'Resource has been exhausted (e.g. check quota).', { details: [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '7s' }] }))
      case '429-quota': return send(res, err(429, 'RESOURCE_EXHAUSTED', 'You exceeded your current quota, please check your plan and billing details. For more information on this error, head to: https://ai.google.dev/gemini-api/docs/rate-limits.', { details: [{ '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaMetric: 'generativelanguage.googleapis.com/generate_content_free_tier_requests', quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier' }] }] }))
      case '500': return send(res, err(500, 'INTERNAL', 'An internal error has occurred. Please retry or report in https://developers.generativeai.google/guide/troubleshooting'))
      case '503': return send(res, err(503, 'UNAVAILABLE', 'The model is overloaded. Please try again later.'))
      case '504': return send(res, err(504, 'DEADLINE_EXCEEDED', 'Deadline expired before operation could complete.'))
      case 'html-error': res.writeHead(502, { 'content-type': 'text/html' }); return res.end('<html><body>502 Bad Gateway</body></html>')
      case 'hang-before': return
      default:
    }

    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', 'x-goog-request-id': 'req_mock_gem_ok' })
    // Google ends each event with a blank line made of CRLFs; the reader must take both line endings
    const emit = (chunk) => res.write(`data: ${JSON.stringify(chunk)}\r\n\r\n`)
    const chunk = (parts, extra = {}) => ({ candidates: [{ content: { parts, role: 'model' }, index: 0, ...extra.candidate }], ...(extra.usage === null ? {} : { usageMetadata: extra.usage ?? { promptTokenCount: 25, totalTokenCount: 25 } }), modelVersion: modelId, responseId: 'mockResponseId' })
    const finish = (finishReason = 'STOP', usage = USAGE(), parts = []) => { emit(chunk(parts.length ? parts : [{ text: '' }], { candidate: { finishReason }, usage })); res.end() }
    const pieces = async (text) => {
      const words = text.match(/\S+\s*/g) ?? []
      const per = Math.max(1, Math.ceil(words.length / 80))
      await sleep(200)
      for (let i = 0; i < words.length && alive; i += per) { emit(chunk([{ text: words.slice(i, i + per).join('') }])); await sleep(20) }
    }
    const echo = `Echo: ${lastUserText(body).replace(/\[\[mock:[a-z0-9-]+\]\]\s*/g, '')}`
    const offered = (body.tools ?? []).flatMap((t) => t.functionDeclarations ?? []).map((d) => d.name)
    const rounds = body.contents.filter((c) => c.role === 'user' && c.parts.some((p) => p.functionResponse)).length
    const endsWithResults = body.contents.at(-1)?.parts?.some((p) => p.functionResponse)

    switch (directive) {
      case 'say': await pieces(lastUserText(body).replace(/\[\[mock:[a-z0-9-]+\]\]\s*/g, '')); return alive && finish()
      case 'count': await pieces(`Reply ${requests.length}`); return alive && finish()
      case 'files': await pieces(describe(body)); return alive && finish()
      case 'empty': return finish('STOP', USAGE({ candidatesTokenCount: 0 }))
      case 'cached': await pieces(echo); return alive && finish('STOP', USAGE({ promptTokenCount: 4100, cachedContentTokenCount: 4000, totalTokenCount: 4140, cacheTokensDetails: [{ modality: 'TEXT', tokenCount: 4000 }] }))
      case 'no-usage': emit(chunk([{ text: 'No usage ' }], { usage: null })); emit(chunk([{ text: 'here.' }], { usage: null, candidate: { finishReason: 'STOP' } })); return res.end()
      case 'hostile-usage': emit(chunk([{ text: 'Odd usage.' }], { usage: { promptTokenCount: -5, candidatesTokenCount: 1e15, thoughtsTokenCount: 'many', totalTokenCount: 3 } })); emit(chunk([{ text: '' }], { usage: { promptTokenCount: -5, candidatesTokenCount: 1e15, thoughtsTokenCount: 'many', totalTokenCount: 3 }, candidate: { finishReason: 'STOP' } })); return res.end()
      case 'thoughts':
        // a model that sends its thoughts although they were not asked for: the app must not show them (their tokens are counted all the same)
        emit(chunk([{ text: 'SECRET THINKING that must not be shown', thought: true }]))
        await pieces('The answer.')
        return alive && finish()
      case 'blocked-prompt':
      case 'blocked-prompt-other':
        emit({ promptFeedback: { blockReason: directive === 'blocked-prompt' ? 'SAFETY' : 'OTHER', safetyRatings: [{ category: 'HARM_CATEGORY_DANGEROUS_CONTENT', probability: 'HIGH', blocked: true }] }, usageMetadata: { promptTokenCount: 25, totalTokenCount: 25 }, modelVersion: modelId, responseId: 'mockResponseId' })
        return res.end()
      case 'blocked-reply':
        await pieces('Partial answer that ')
        emit(chunk([{ text: '' }], { candidate: { finishReason: 'SAFETY', safetyRatings: [{ category: 'HARM_CATEGORY_HARASSMENT', probability: 'HIGH', blocked: true }] }, usage: USAGE() }))
        return res.end()
      case 'prohibited': await pieces('Partial '); return alive && finish('PROHIBITED_CONTENT')
      case 'recitation': await pieces('Partial quoted '); return alive && finish('RECITATION')
      case 'max-tokens': await pieces('Cut off here'); return alive && finish('MAX_TOKENS')
      case 'malformed-call': await pieces('Let me '); return alive && finish('MALFORMED_FUNCTION_CALL')
      case 'finish-other': await pieces('Partial '); return alive && finish('OTHER')
      case 'finish-odd': await pieces('Partial '); return alive && finish('SOMETHING_NEW')
      case 'midstream-error':
        await pieces('Partial ')
        emit({ error: { code: 500, message: 'An internal error has occurred.', status: 'INTERNAL' } })
        return res.end()
      case 'not-json': await pieces('Partial '); res.write('data: {"candidates": [ {"content": \r\n\r\n'); return res.end()
      case 'drop': await pieces('Partial '); await sleep(40); return res.destroy()
      case 'early-close': await pieces('Partial '); return res.end() // a clean end, but no finishReason ever came
      case 'slow':
        await sleep(100)
        for (let i = 0; alive && i < 300; i++) { emit(chunk([{ text: `tick${i} ` }])); await sleep(100) }
        return alive && finish()
      case 'tool-use':
      case 'tool-many':
      case 'tool-two': {
        // a model that asks for a function (when it was offered one), the first call part with a thought signature, as Gemini 3 models do; after the response it
        // answers with what it was told ("tool-use"), or asks again after every result ("tool-many"); "tool-two" asks for two calls in one turn
        const name = toolsControl.name ?? offered[0] ?? 'web_search'
        if (endsWithResults && !(directive === 'tool-many' && offered.includes(name))) {
          const told = body.contents.at(-1).parts.filter((p) => p.functionResponse).map((p) => {
            const r = p.functionResponse.response
            const t = String(r.output ?? r.error ?? JSON.stringify(r))
            const summary = t.includes('Summary:\n') ? t.split('Summary:\n')[1].split('\n')[0] : t.split('\n')[0]
            return `The ${r.error !== undefined ? 'tool failed' : 'search found'}: ${summary.slice(0, 160)}`
          })
          await pieces(told.join(' | '))
          return alive && finish()
        }
        if (rounds === 0 && !toolsControl.emptyText) emit(chunk([{ text: 'Let me search for that. ' }]))
        const n = requests.length
        const callParts = (directive === 'tool-two' ? [0, 1] : [0]).map((k) => {
          const id = `gcall_mock_${n}_${k}`
          const args = toolsControl.args ?? { query: rounds === 0 ? (toolsControl.query ?? 'rust release notes') : `more ${rounds}`, why: 'The person asked for the newest release.' }
          if (k === 0) issued.set(id, SIGNATURE)
          return { functionCall: { name, args, id }, ...(k === 0 ? { thoughtSignature: SIGNATURE } : {}) }
        })
        return finish('STOP', USAGE(), callParts)
      }
      default:
        await pieces(echo)
        if (alive) finish()
    }
  }

  // GET /v1beta/models: { models: [{ name: 'models/<id>', version, displayName, description, inputTokenLimit, outputTokenLimit, supportedGenerationMethods, thinking }], nextPageToken }
  function listModels(req, res) {
    const record = { provider: 'google', headers: req.headers, url: req.url, listing: true, body: null, problems: [], closedEarly: false }
    requests.push(record)
    res.on('close', () => { if (!res.writableFinished) record.closedEarly = true })
    const url = new URL(req.url, 'http://x')
    if (url.searchParams.has('key')) record.problems.push('THE KEY WAS PUT IN THE ADDRESS (?key=)')
    if (req.headers['authorization']) record.problems.push('an Authorization header was sent')
    const control = modelsControl()
    if (control.hang) return
    const key = req.headers['x-goog-api-key'] ?? url.searchParams.get('key')
    if (typeof key !== 'string') return send(res, err(403, 'PERMISSION_DENIED', 'Method doesn\'t allow unregistered callers (callers without established identity). Please use API Key or other form of API consumer identity to call this API.'))
    const wanted = expectedKey()
    if (wanted !== null && key !== wanted) return send(res, err(400, 'INVALID_ARGUMENT', 'API key not valid. Please pass a valid API key.', { details: [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: 'API_KEY_INVALID', domain: 'googleapis.com' }] }))
    if (control.fail) return send(res, err(control.fail, control.fail === 429 ? 'RESOURCE_EXHAUSTED' : control.fail === 403 ? 'PERMISSION_DENIED' : 'INTERNAL', 'listing failed on purpose'))
    const all = control.many ? Array.from({ length: control.many }, (_, i) => [`made-up-model-${i}`, `Made-up ${i}`]) : LISTED
    const size = Math.min(Number(url.searchParams.get('pageSize') ?? 50), control.pageSize ?? 1000)
    const start = Number(url.searchParams.get('pageToken') ?? 0) || 0
    const page = all.slice(start, start + size)
    const next = start + size < all.length ? String(start + size) : undefined
    return json(res, 200, { models: page.map(([id, displayName]) => ({ name: `models/${id}`, version: '001', displayName, description: `${displayName} (mock)`, inputTokenLimit: 1048576, outputTokenLimit: 65536, supportedGenerationMethods: ['generateContent', 'countTokens'], thinking: true })), ...(next ? { nextPageToken: next } : {}) })
  }

  function route(req, res) {
    const path = req.url.split('?')[0]
    if (req.method === 'GET' && path === '/v1beta/models') { listModels(req, res); return true }
    const m = /^\/v1beta\/models\/([^/:]+):(streamGenerateContent|generateContent)$/.exec(path)
    if (req.method === 'POST' && m) {
      if (m[2] === 'generateContent') { requests.push({ provider: 'google', headers: req.headers, url: req.url, raw: '', body: null, problems: ['generateContent (not streamed) was called: this app streams'], closedEarly: false }); json(res, 400, { error: { code: 400, message: 'the mock serves streamGenerateContent only', status: 'INVALID_ARGUMENT' } }); return true }
      handleGenerate(req, res, decodeURIComponent(m[1]))
      return true
    }
    return false
  }

  return { route, setTools: (control) => { toolsControl = control ?? {} }, reset: () => { toolsControl = {}; issued.clear() } }
}
