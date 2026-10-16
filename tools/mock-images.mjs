// The fake image-generation endpoint for the checks (Stage 16.1, D-048): POST /v1/images/generations, as OpenAI's image-generation guide and the installed SDK's types describe it
// (read on 16 October 2026). It is MY reading of the documentation, not the real API: a JSON body with `prompt` and optionally `model`, `n`, `size`, `quality`, `output_format`,
// `output_compression`, `background`, `moderation`, `partial_images`, `response_format`, `stream`, `style`, `user`; the answer is `{ created, data: [{ b64_json }], ..., usage? }`
// (base64 only for the GPT image models, never an address).
// It shares the server of mock-providers.mjs, its request log and its OpenAI key (Authorization: Bearer). A request the real API is documented to refuse is answered with a 400, and the
// problem is written in the request's log record, so a check can say what was wrong.
// How it behaves is chosen with POST /__images { mode, usage, ms } (POST /__reset puts it back):
//   mode  'ok' (default) | 'slow' (waits `ms`) | 'hang' (never answers) | 'garbage' (not JSON) | 'nodata' (no data) | 'fewer' (one picture less than asked) | 'more' (one more)
//         | 'url' (an address instead of base64) | 'badb64' (not base64) | 'text' (base64 of text, not a picture) | 'gif' | 'jpeg' | 'webp' (a picture of that kind)
//         | 'huge' (a PNG of more than 12 MB) | 'wide' (a PNG whose header says 5000 px) | 'cut' (a PNG cut in half)
//         | 'blocked' (400 moderation_blocked) | 'verify' (403: the organization must be verified) | '400' '401' '403' '404' '429' '429quota' '500' '503' '503retry' | 'echokey'
//   usage 'tokens' (default: input and output tokens, from OpenAI's table for gpt-image-2) | 'none' (no usage, which the SDK says is for gpt-image-1 only) | 'hostile' (negative and huge numbers)
import { deflateSync, crc32 } from 'node:zlib'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const MODELS = new Set(['gpt-image-1', 'gpt-image-1-mini', 'gpt-image-1.5', 'chatgpt-image-latest', 'gpt-image-2', 'gpt-image-2-2026-04-21', 'gpt-image-2.5-sunburst', 'gpt-image-2.5-sunburst-2026-09-08', 'gpt-image-2.5-flare', 'gpt-image-2.5-flare-2026-09-08'])
const NEWEST = (model) => /^gpt-image-2\.5-/.test(model)
const FIELDS = new Set(['prompt', 'model', 'n', 'size', 'quality', 'output_format', 'output_compression', 'background', 'moderation', 'partial_images', 'response_format', 'stream', 'style', 'user'])
// OpenAI's own table for gpt-image-2 (US dollars a picture), made into output tokens at $30 a million; the text in is about a token for four characters
const TABLE = { '1024x1024': { low: 0.006, medium: 0.053, high: 0.211 }, '1024x1536': { low: 0.005, medium: 0.041, high: 0.165 }, '1536x1024': { low: 0.005, medium: 0.041, high: 0.165 } }

/** Problems with a size, as the SDK's comment states the rules: WIDTHxHEIGHT, both divisible by 16, ratio within 1:3 and 3:1, at most 3840x2160 in pixels and 3840 an edge. */
export function sizeProblem(size) {
  if (size === 'auto') return null
  const m = /^(\d{2,4})x(\d{2,4})$/.exec(String(size))
  if (!m) return `invalid size ${size}`
  const [w, h] = [Number(m[1]), Number(m[2])]
  if (w % 16 !== 0 || h % 16 !== 0) return `size ${size}: width and height must be divisible by 16`
  if (Math.max(w, h) / Math.min(w, h) > 3) return `size ${size}: the aspect ratio must be between 1:3 and 3:1`
  if (Math.max(w, h) > 3840 || w * h > 3840 * 2160) return `size ${size} is larger than 3840x2160`
  return null
}

const chunk = (type, data) => {
  const head = Buffer.alloc(8)
  head.writeUInt32BE(data.length, 0)
  head.write(type, 4, 'latin1')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'latin1'), data])) >>> 0, 0)
  return Buffer.concat([head, data, crc])
}

/** A real PNG of one colour, `w` by `h` (every row filter 0, RGB), with an optional private chunk of `extra` bytes (for 'huge'). */
export function solidPng(w, h, rgb = [40, 120, 200], extra = 0) {
  const row = Buffer.alloc(1 + w * 3)
  for (let x = 0; x < w; x++) { row[1 + x * 3] = rgb[0]; row[2 + x * 3] = rgb[1]; row[3 + x * 3] = rgb[2] }
  const raw = Buffer.alloc(row.length * h)
  for (let y = 0; y < h; y++) row.copy(raw, y * row.length)
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // RGB
  const parts = [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr)]
  if (extra > 0) parts.push(chunk('zzZz', Buffer.alloc(extra, 7)))
  parts.push(chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)))
  return Buffer.concat(parts)
}

/** A PNG whose header says `w` by `h` but which holds one row only (enough for a check that reads the header). */
export function lyingPng(w, h) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.alloc(1 + 3 * Math.min(w, 64)))), chunk('IEND', Buffer.alloc(0))])
}

const COLOURS = [[40, 120, 200], [200, 80, 40], [60, 160, 90], [150, 60, 170]]
const fixture = (name) => readFileSync(join(here, 'fixtures9', name))

export function createImagesMock({ json, readBody, requests, expectedKey }) {
  let control = {}
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  const error = (res, status, message, type, code, headers = {}) => json(res, status, { error: { message, type, param: null, code } }, headers)

  async function handle(req, res) {
    const raw = await readBody(req)
    const problems = []
    let body = null
    try { body = JSON.parse(raw) } catch { problems.push('the body is not JSON') }
    if (!/^application\/json/i.test(req.headers['content-type'] ?? '')) problems.push('the request is not application/json')
    const auth = req.headers['authorization']
    if (!auth || !/^Bearer .+/.test(auth)) problems.push('missing Authorization: Bearer')
    if (req.headers['x-api-key']) problems.push("an x-api-key header was sent (that is Anthropic's)")
    const b = body && typeof body === 'object' && !Array.isArray(body) ? body : {}
    const model = typeof b.model === 'string' ? b.model : null
    for (const key of Object.keys(b)) if (!FIELDS.has(key)) problems.push(`Unknown parameter: '${key}'.`)
    if (typeof b.prompt !== 'string' || b.prompt.length === 0) problems.push('missing prompt')
    else if (b.prompt.length > 32000) problems.push('prompt longer than 32000 characters')
    if (model === null) problems.push('no model was named (the API would use dall-e-2)')
    const n = b.n ?? 1
    if (!Number.isInteger(n) || n < 1 || n > 10) problems.push(`invalid n ${b.n}`)
    if (b.size !== undefined) { const p = sizeProblem(b.size); if (p) problems.push(p) }
    const qualities = model !== null && NEWEST(model) ? ['low', 'medium', 'high', 'xhigh', 'max', 'auto'] : ['low', 'medium', 'high', 'auto']
    if (b.quality !== undefined && !qualities.includes(b.quality)) problems.push(`invalid quality ${b.quality} for ${model}`)
    if (b.output_format !== undefined && !['png', 'jpeg', 'webp'].includes(b.output_format)) problems.push(`invalid output_format ${b.output_format}`)
    if (b.moderation !== undefined && !['low', 'auto'].includes(b.moderation)) problems.push(`invalid moderation ${b.moderation}`)
    if (b.response_format !== undefined) problems.push("Unknown parameter: 'response_format' (the GPT image models always answer in base64)")
    if (b.stream === true) problems.push('stream is not handled by this mock')
    const record = {
      provider: 'openai',
      images: true,
      url: req.url,
      headers: req.headers,
      fields: Object.keys(b).sort(),
      body: b,
      problems,
      startedAt: Date.now(),
      retryCount: Number(req.headers['x-stainless-retry-count'] ?? 0)
    }
    requests.push(record)
    const wanted = expectedKey()
    if (wanted !== null && auth !== `Bearer ${wanted}`) return error(res, 401, 'Incorrect API key provided: sk-...mock. You can find your API key at https://platform.openai.com/account/api-keys.', 'invalid_request_error', 'invalid_api_key')
    const mode = control.mode ?? 'ok'
    switch (mode) {
      case 'echokey': return error(res, 400, `Bad request, and by the way your key is ${String(auth).slice(7)} and again ${String(auth).slice(7, 20)}`, 'invalid_request_error', null)
      case 'blocked': return error(res, 400, 'Your request was rejected by the safety system. If you believe this is an error, contact us at help.openai.com and include the request ID req_mock_blocked. safety_violations=[violence].', 'image_generation_user_error', 'moderation_blocked')
      case 'verify': return error(res, 403, `Your organization must be verified to use the model \`${model}\`. Please go to: https://platform.openai.com/settings/organization/general and click on Verify Organization. If you just verified, it can take up to 15 minutes for access to propagate.`, 'invalid_request_error', null)
      case '400': return error(res, 400, 'Invalid value for size.', 'invalid_request_error', 'invalid_value')
      case '401': return error(res, 401, 'Incorrect API key provided: sk-...mock.', 'invalid_request_error', 'invalid_api_key')
      case '403': return error(res, 403, 'You are not allowed to use this model.', 'invalid_request_error', 'model_not_found')
      case '404': return error(res, 404, `The model \`${model}\` does not exist or you do not have access to it.`, 'invalid_request_error', 'model_not_found')
      case '429': return error(res, 429, `Rate limit reached for ${model}. Please try again in 1s.`, 'requests', 'rate_limit_exceeded', { 'x-should-retry': 'false' })
      case '429quota': return error(res, 429, 'You exceeded your current quota, please check your plan and billing details.', 'insufficient_quota', 'insufficient_quota', { 'x-should-retry': 'false' })
      case '500': return error(res, 500, 'The server had an error while processing your request.', 'server_error', null, { 'x-should-retry': 'false' })
      case '503retry': return error(res, 503, 'That model is currently overloaded with other requests.', 'server_error', null, { 'retry-after-ms': '10' }) // no x-should-retry: an SDK that retries would send again
      case '503': return error(res, 503, 'That model is currently overloaded with other requests.', 'server_error', null, { 'x-should-retry': 'false' })
      case 'hang': return // never answers
      case 'garbage': res.writeHead(200, { 'content-type': 'application/json' }); return res.end('this is not json')
      case 'slow': await sleep(control.ms ?? 1000); break
    }
    if (problems.length > 0) return error(res, 400, problems.join('; '), 'invalid_request_error', null)
    const size = b.size === undefined || b.size === 'auto' ? '1024x1024' : b.size
    const [w, h] = size.split('x').map(Number)
    const quality = b.quality === undefined || b.quality === 'auto' ? 'medium' : b.quality
    const format = b.output_format ?? 'png'
    const count = mode === 'fewer' ? n - 1 : mode === 'more' ? n + 1 : n
    const picture = (i) => {
      switch (mode) {
        case 'text': return Buffer.from('this is a text file and not a picture at all')
        case 'gif': return Buffer.from('R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==', 'base64')
        case 'jpeg': return fixture('q.jpg')
        case 'webp': return fixture('lossy.webp')
        case 'huge': return solidPng(64, 64, COLOURS[i % 4], 13 * 1024 * 1024)
        case 'wide': return lyingPng(5008, 1680)
        case 'cut': { const p = solidPng(w, h, COLOURS[i % 4]); return p.subarray(0, 20) }
        default: return solidPng(w, h, COLOURS[i % 4])
      }
    }
    const data = Array.from({ length: Math.max(0, count) }, (_, i) =>
      mode === 'url' ? { url: `https://files.example.com/picture-${i}.png` } : mode === 'badb64' ? { b64_json: '***not base64***' } : { b64_json: picture(i).toString('base64') })
    const answer = { created: Math.floor(Date.now() / 1000), background: 'opaque', output_format: format, quality, size }
    if (mode !== 'nodata') answer.data = data
    const usage = control.usage ?? 'tokens'
    if (usage === 'tokens') {
      const usd = (TABLE[size] ?? TABLE['1024x1024'])[quality] ?? 0.211
      const text = Math.ceil(b.prompt.length / 4)
      const out = Math.round((usd / 30) * 1e6) * count
      answer.usage = { input_tokens: text, input_tokens_details: { image_tokens: 0, text_tokens: text }, output_tokens: out, output_tokens_details: { image_tokens: out, text_tokens: 0 }, total_tokens: text + out }
    } else if (usage === 'hostile') {
      answer.usage = { input_tokens: -5, input_tokens_details: { image_tokens: 0, text_tokens: -5 }, output_tokens: 1e15, total_tokens: 1e15 }
    }
    return json(res, 200, answer)
  }

  return { handle, setControl: (c) => { control = c ?? {} }, reset: () => { control = {} } }
}
