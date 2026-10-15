import { CONNECTOR_LIMITS } from '../shared/connectors'
import { errorOf, McpError, type RpcAnswer, type Wire } from './mcpClient'

// The Streamable HTTP wire (Stage 14, D-045, pick D): the app's first network code of its own. One POST per message to the one address the person gave, and nothing else:
// https only (plain http only to this PC's own loopback), no name or password in the address, NO redirect followed (a redirect is a refusal, so a token can never be carried
// to another site), a size cap on every body and every event, a clock and a Stop on every request (aborting closes the response, which the protocol takes as the
// cancellation). The answer is a JSON object or an event stream; both are read with the same caps. A token the person pasted goes in the Authorization header of requests
// to this address only. The older revisions' session (`Mcp-Session-Id`) is kept for the connection when a server hands one out. No Electron imports: `fetch` is handed in
// by the checks, and is Node's own otherwise.

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]'])

/** An address the person typed, as the app will use it, or why it is not one it uses. */
export function checkRemoteUrl(
  text: unknown
): { ok: true; href: string; host: string } | { ok: false; why: string } {
  if (typeof text !== 'string') return { ok: false, why: 'The address is not text.' }
  const trimmed = text.trim()
  if (trimmed === '' || trimmed.length > CONNECTOR_LIMITS.urlChars) {
    return { ok: false, why: `The address must be 1 to ${CONNECTOR_LIMITS.urlChars} characters.` }
  }
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    return { ok: false, why: 'That is not a web address.' }
  }
  if (url.username !== '' || url.password !== '') {
    return {
      ok: false,
      why: 'The address may not hold a name or a password (paste a token instead).'
    }
  }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && LOOPBACK.has(url.hostname))) {
    return { ok: false, why: 'Only https addresses are used (plain http only to this PC itself).' }
  }
  url.hash = ''
  const href = url.href
  if (!/^[\x21-\x7e]+$/.test(href) || href.length > CONNECTOR_LIMITS.urlChars) {
    return { ok: false, why: 'The address holds characters the app does not send.' }
  }
  return { ok: true, href, host: url.host }
}

/** A header value as the protocol wants it: plain visible ASCII as it is; anything else (and anything that looks like the marker) as `=?base64?...?=`. */
export function headerValue(value: string): string {
  const plain =
    /^[\x21-\x7e](?:[\x20-\x7e]*[\x21-\x7e])?$/.test(value) &&
    !(value.startsWith('=?base64?') && value.endsWith('?='))
  return plain ? value : `=?base64?${Buffer.from(value, 'utf8').toString('base64')}?=`
}

type Fetch = typeof fetch

/** Reads a body of at most `max` bytes, or throws (and stops reading) past it. */
async function readCapped(response: Response, max: number): Promise<string> {
  const body = response.body
  if (body === null) return ''
  const reader = body.getReader()
  const parts: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > max) {
        await reader.cancel().catch(() => undefined)
        throw new McpError(
          'too-big',
          'The address sent a message larger than the app accepts (1 MB).'
        )
      }
      parts.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  return Buffer.concat(parts).toString('utf8')
}

/** Reads an event stream until the answer with `id` comes: each event at most `max` bytes, the whole stream at most eight times that. */
async function readEvents(response: Response, id: number, max: number): Promise<unknown> {
  const body = response.body
  if (body === null) throw new McpError('closed', 'The address ended its answer without one.')
  const reader = body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''
  let data: string[] = []
  let dataSize = 0
  let total = 0
  const dispatch = (): unknown => {
    if (data.length === 0) return undefined
    const text = data.join('\n')
    data = []
    dataSize = 0
    let message: unknown
    try {
      message = JSON.parse(text)
    } catch {
      return undefined
    }
    if (
      typeof message === 'object' &&
      message !== null &&
      (message as { id?: unknown }).id === id
    ) {
      return message
    }
    return undefined // a notification, or something else: not what is waited for
  }
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > max * 8) {
        throw new McpError('too-big', 'The address sent more than the app accepts for one answer.')
      }
      buffer += decoder.decode(value, { stream: true })
      for (;;) {
        const at = buffer.search(/\r\n|\r|\n/)
        if (at === -1) break
        const line = buffer.slice(0, at)
        buffer = buffer.slice(at + (buffer.startsWith('\r\n', at) ? 2 : 1))
        if (line === '') {
          const found = dispatch()
          if (found !== undefined) return found
        } else if (line.startsWith('data:')) {
          const piece = line.slice(line.startsWith('data: ') ? 6 : 5)
          dataSize += piece.length
          if (dataSize > max) {
            throw new McpError(
              'too-big',
              'The address sent a message larger than the app accepts (1 MB).'
            )
          }
          data.push(piece)
        } // a comment (":"), an event name, an id, a retry: nothing the app needs
        if (buffer.length > max) {
          throw new McpError('too-big', 'The address sent a line larger than the app accepts.')
        }
      }
    }
    const last = dispatch()
    if (last !== undefined) return last
    throw new McpError('closed', 'The address ended its answer without one.')
  } finally {
    await reader.cancel().catch(() => undefined)
  }
}

export interface HttpWireOptions {
  href: string
  /** The person's token, or null: sent as `Authorization: Bearer` to this address only. */
  token: string | null
  fetch?: Fetch
  maxBytes?: number
}

export function createHttpWire(options: HttpWireOptions): Wire {
  const send = options.fetch ?? fetch
  const max = options.maxBytes ?? CONNECTOR_LIMITS.messageBytes
  let version: string | null = null
  let era: 'modern' | 'legacy' = 'modern'
  let session: string | null = null
  let nextId = 1
  let ended: string | null = null
  let markClosed: (why: string) => void = () => undefined
  const closed = new Promise<string>((resolve) => {
    markClosed = resolve
  })
  const live = new AbortController()

  const headersFor = (
    method: string,
    params: Record<string, unknown> | undefined,
    extra?: Readonly<Record<string, string>>
  ): Record<string, string> => {
    const h: Record<string, string> = {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'mcp-method': method
    }
    // the modern revision wants its version on every request; an older one after the handshake
    if (era === 'modern') h['mcp-protocol-version'] = version ?? '2026-07-28'
    else if (method !== 'initialize' && version !== null) h['mcp-protocol-version'] = version
    if (method === 'tools/call' && params !== undefined && typeof params.name === 'string') {
      h['mcp-name'] = headerValue(params.name)
    }
    if (session !== null) h['mcp-session-id'] = session
    if (options.token !== null) h['authorization'] = `Bearer ${options.token}`
    for (const [name, value] of Object.entries(extra ?? {})) h[name.toLowerCase()] = value
    return h
  }

  const post = async (
    method: string,
    body: Record<string, unknown>,
    signal: AbortSignal,
    extra?: Readonly<Record<string, string>>
  ): Promise<Response> => {
    if (ended !== null) throw new McpError('closed', ended)
    let response: Response
    try {
      response = await send(options.href, {
        method: 'POST',
        headers: headersFor(method, body.params as Record<string, unknown> | undefined, extra),
        body: JSON.stringify(body),
        redirect: 'manual',
        signal: AbortSignal.any([signal, live.signal])
      })
    } catch (error) {
      if (signal.aborted || live.signal.aborted) throw error
      throw new McpError('closed', 'The address could not be reached.')
    }
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel().catch(() => undefined)
      throw new McpError(
        'http',
        'The address answered with a redirect, and the app does not follow redirects.'
      )
    }
    return response
  }

  return {
    closed,
    setVersion: (newEra, newVersion) => {
      era = newEra
      version = newVersion
    },
    close: () => {
      if (ended !== null) return
      ended = 'The app closed the connection.'
      live.abort()
      markClosed(ended)
    },
    notify: async (method, params) => {
      const signal = AbortSignal.timeout(10_000)
      const response = await post(
        method,
        { jsonrpc: '2.0', method, ...(params === undefined ? {} : { params }) },
        signal
      )
      await readCapped(response, 64 * 1024).catch(() => '')
    },
    request: async (method, params, { signal, headers }) => {
      const id = nextId++
      const response = await post(method, { jsonrpc: '2.0', id, method, params }, signal, headers)
      if (method === 'initialize') {
        const minted = response.headers.get('mcp-session-id')
        if (minted !== null && /^[\x21-\x7e]{1,200}$/.test(minted)) session = minted
      }
      const type = (response.headers.get('content-type') ?? '').toLowerCase()
      if (response.status === 200 || response.status === 201) {
        let message: unknown
        if (type.startsWith('text/event-stream')) {
          message = await readEvents(response, id, max)
        } else {
          const text = await readCapped(response, max)
          try {
            message = JSON.parse(text)
          } catch {
            throw new McpError(
              'not-mcp',
              'The address answered with something that is not the protocol.'
            )
          }
        }
        if (
          typeof message !== 'object' ||
          message === null ||
          (message as { id?: unknown }).id !== id
        ) {
          throw new McpError('not-mcp', 'The address answered something other than the question.')
        }
        const m = message as Record<string, unknown>
        if (Object.prototype.hasOwnProperty.call(m, 'error')) {
          const error = errorOf(m.error)
          if (error === null)
            throw new McpError('not-mcp', 'The address sent an error that is not one.')
          return { ok: false, ...error }
        }
        if (!Object.prototype.hasOwnProperty.call(m, 'result')) {
          throw new McpError('not-mcp', 'The address sent an answer with no result.')
        }
        return { ok: true, result: m.result } satisfies RpcAnswer
      }
      // not an answer: an error status. A JSON-RPC error in the body is handed back with the status (the era probe reads it); without one it is the status alone.
      const text = await readCapped(response, 64 * 1024).catch(() => '')
      let parsed: unknown = null
      try {
        parsed = JSON.parse(text)
      } catch {
        parsed = null
      }
      const error =
        typeof parsed === 'object' && parsed !== null
          ? errorOf((parsed as { error?: unknown }).error)
          : null
      if (response.status === 401 || response.status === 403) {
        throw new McpError(
          'http',
          `The address refused the app (status ${response.status}): it needs a sign-in or a token, or the token is wrong.`
        )
      }
      if (error !== null) return { ok: false, ...error, http: response.status }
      throw new McpError('http', `The address answered with status ${response.status}.`)
    }
  }
}
