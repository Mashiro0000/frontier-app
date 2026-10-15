import { CONNECTOR_LIMITS } from '../shared/connectors'

// The app's own small MCP client (Stage 14, D-045, pick H): JSON-RPC 2.0 over a "wire" (stdio here, Streamable HTTP in mcpHttp.ts), both eras of the protocol, and
// nothing a server says trusted. It speaks the current revision (2026-07-28: stateless, every request carries its version and the client's abilities in `_meta`) and,
// for servers that do not, the older handshake (`initialize`, 2025-11-25 and earlier), as the specification's own dual-era rule says: ask `server/discover` first; a
// recognised modern answer or error means a modern server, anything else (another error, no answer in time) means an older one.
//
// What the app asks for, and nothing more (pick A): the list of tools and a call to one. It declares NO abilities (no sampling, no elicitation, no roots), so a server that
// needs one answers with an error or an "input required" result, and the call fails with a plain sentence. A request the server sends us (older servers may) is answered
// "method not found", except a ping. Every size and every wait has a limit: a line or a body bigger than a message may be ends the connection; a request has a clock and a
// Stop (an AbortSignal), and a stopped request is cancelled at the server (`notifications/cancelled` on stdio; closing the response on HTTP). No Electron imports.

export const MODERN_VERSION = '2026-07-28'
/** The older revisions the client can speak, newest first. */
export const LEGACY_VERSIONS: readonly string[] = Object.freeze([
  '2025-11-25',
  '2025-06-18',
  '2025-03-26',
  '2024-11-05'
])
/** Errors only a modern server sends: header mismatch, a missing client ability, an unsupported version. */
export const MODERN_ERRORS: ReadonlySet<number> = new Set([-32020, -32021, -32022])
export const CLIENT_INFO = Object.freeze({ name: 'Frontier App', version: '1.0.0' })

/** How long the first question (`server/discover`) waits before the server is taken to be an older one that does not answer unknown requests. */
export const PROBE_MS = 5000
/** Pages of a tool list, at most. */
const MAX_PAGES = 10
/** Unparseable lines, requests of the server's own: past these a connection is ended. */
const MAX_GARBAGE = 200
const MAX_SERVER_REQUESTS = 1000

export type McpFault =
  | 'closed' // the connection ended
  | 'timeout' // no answer in time
  | 'stopped' // Stop everything, or the app stopped the connector
  | 'too-big' // a message larger than the limit
  | 'not-mcp' // what came back is not the protocol
  | 'version' // no revision both sides speak
  | 'needs-input' // the server wants an ability the app does not give (sampling, questions, folders)
  | 'http' // an HTTP status that is not an answer (a refusal, a redirect, a server error)
  | 'refused' // the request was refused before it was sent (an address the app does not use)

/** A failure of the connection or of the protocol. `message` is the app's own sentence; nothing of the server's words is in it unless quoted and cleaned. */
export class McpError extends Error {
  readonly fault: McpFault
  constructor(fault: McpFault, message: string) {
    super(message)
    this.fault = fault
  }
}

/** What came back for one request: a result, or the server's JSON-RPC error (its message cleaned and cut). */
export type RpcAnswer =
  | { ok: true; result: unknown }
  | { ok: false; code: number; message: string; data: unknown; http?: number }

/** The way messages travel. A wire numbers its own requests. */
export interface Wire {
  request(
    method: string,
    params: Record<string, unknown>,
    options: { signal: AbortSignal; headers?: Readonly<Record<string, string>> }
  ): Promise<RpcAnswer>
  notify(method: string, params?: Record<string, unknown>): Promise<void>
  /** Told the era and revision once they are known (the HTTP wire puts them in its headers). */
  setVersion(era: 'modern' | 'legacy', version: string): void
  close(): void
  /** Resolves with a sentence when the connection has ended, for whatever reason. */
  readonly closed: Promise<string>
}

/** Text from outside as one visible line of at most `max` characters: controls and white space become one space; invisible and reversing characters go. */
export function oneLine(text: string, max: number): string {
  const line = text
    .slice(0, max * 4)
    .replace(/[\p{Cc}\s]+/gu, ' ')
    .replace(/[\p{Cf}\p{Zl}\p{Zp}\p{Co}\p{Cn}\p{Cs}]/gu, '')
    .trim()
  const chars = Array.from(line)
  return chars.length > max ? `${chars.slice(0, max - 1).join('')}…` : line
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** A JSON-RPC error object as the app keeps it, or null when it is not one. */
export function errorOf(raw: unknown): { code: number; message: string; data: unknown } | null {
  if (!isObject(raw)) return null
  const { code, message, data } = raw
  if (typeof code !== 'number' || !Number.isSafeInteger(code)) return null
  return { code, message: typeof message === 'string' ? oneLine(message, 300) : '', data }
}

/** A signal that aborts with either of two: the caller's, or a clock. */
export function withClock(signal: AbortSignal, ms: number): AbortSignal {
  return AbortSignal.any([signal, AbortSignal.timeout(ms)])
}

/** Why a signal aborted, as a fault: the clock, or a stop. */
export function abortFault(signal: AbortSignal): McpError {
  const why: unknown = signal.reason
  return why instanceof DOMException && why.name === 'TimeoutError'
    ? new McpError('timeout', 'The connector did not answer in time.')
    : new McpError('stopped', 'The call was stopped.')
}

// ---------------------------------------------------------------------- stdio -----------------------------------------------------------------------------

export interface StdioStreams {
  stdin: NodeJS.WritableStream
  stdout: NodeJS.ReadableStream
}

/**
 * Splits bytes into lines (newline-delimited JSON-RPC, as the stdio transport says), each at most `maxBytes`. A longer line is a fault: the caller ends the connection.
 * A carriage return before the newline is dropped.
 */
export function createLineReader(
  maxBytes: number,
  onLine: (line: string) => void,
  onTooBig: () => void
): (chunk: Buffer) => void {
  let parts: Buffer[] = []
  let size = 0
  let dead = false
  return (chunk) => {
    if (dead) return
    let start = 0
    for (;;) {
      const at = chunk.indexOf(10, start)
      if (at === -1) {
        const rest = chunk.subarray(start)
        size += rest.length
        if (size > maxBytes) {
          dead = true
          parts = []
          onTooBig()
          return
        }
        if (rest.length > 0) parts.push(Buffer.from(rest))
        return
      }
      const piece = chunk.subarray(start, at)
      size += piece.length
      if (size > maxBytes) {
        dead = true
        parts = []
        onTooBig()
        return
      }
      parts.push(piece)
      let line = Buffer.concat(parts).toString('utf8')
      if (line.endsWith('\r')) line = line.slice(0, -1)
      parts = []
      size = 0
      if (line.trim() !== '') onLine(line)
      if (dead) return
      start = at + 1
    }
  }
}

interface Pending {
  resolve: (answer: RpcAnswer) => void
  reject: (error: McpError) => void
}

/** The stdio wire over a process's standard streams (plain, or the box's relay). */
export function createStdioWire(streams: StdioStreams, options: { maxBytes?: number } = {}): Wire {
  const maxBytes = options.maxBytes ?? CONNECTOR_LIMITS.messageBytes
  const pending = new Map<number, Pending>()
  let nextId = 1
  let garbage = 0
  let serverRequests = 0
  let ended: string | null = null
  let markClosed: (why: string) => void = () => undefined
  const closed = new Promise<string>((resolve) => {
    markClosed = resolve
  })

  const end = (why: string, fault: McpFault = 'closed'): void => {
    if (ended !== null) return
    ended = why
    for (const [, p] of pending) p.reject(new McpError(fault, why))
    pending.clear()
    try {
      streams.stdin.end()
    } catch {
      /* already closed */
    }
    markClosed(why)
  }

  const write = (message: Record<string, unknown>): boolean => {
    if (ended !== null) return false
    try {
      // JSON.stringify never writes a raw line break: a message is always one line
      streams.stdin.write(`${JSON.stringify(message)}\n`)
      return true
    } catch {
      end('The connection to the connector broke.')
      return false
    }
  }

  const onLine = (line: string): void => {
    let message: unknown
    try {
      message = JSON.parse(line)
    } catch {
      message = undefined
    }
    if (!isObject(message) || message.jsonrpc !== '2.0') {
      garbage += 1
      if (garbage > MAX_GARBAGE) end('The connector writes things that are not the protocol.')
      return
    }
    const { id, method } = message
    if (typeof method === 'string') {
      if (id === undefined) return // a notification: nothing of it is needed
      if (typeof id !== 'string' && typeof id !== 'number') return
      serverRequests += 1
      if (serverRequests > MAX_SERVER_REQUESTS) {
        end('The connector sends too many requests of its own.')
        return
      }
      // the app has no abilities to offer (pick A); an older server's ping is answered, as its revision says
      write(
        method === 'ping'
          ? { jsonrpc: '2.0', id, result: {} }
          : { jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found' } }
      )
      return
    }
    if (typeof id !== 'number') return
    const waiting = pending.get(id)
    if (waiting === undefined) return // an answer to nothing we wait for (or a second one): dropped
    pending.delete(id)
    if (Object.prototype.hasOwnProperty.call(message, 'error')) {
      const error = errorOf(message.error)
      if (error === null)
        waiting.reject(new McpError('not-mcp', 'The connector sent an error that is not one.'))
      else waiting.resolve({ ok: false, ...error })
      return
    }
    if (!Object.prototype.hasOwnProperty.call(message, 'result')) {
      waiting.reject(new McpError('not-mcp', 'The connector sent an answer with no result.'))
      return
    }
    waiting.resolve({ ok: true, result: message.result })
  }

  const read = createLineReader(maxBytes, onLine, () =>
    end('The connector sent a message larger than the app accepts (1 MB).', 'too-big')
  )
  streams.stdout.on('data', (chunk: Buffer | string) =>
    read(typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk)
  )
  streams.stdout.on('end', () => end('The connector ended.'))
  streams.stdout.on('close', () => end('The connector ended.'))
  streams.stdout.on('error', () => end('The connection to the connector broke.'))

  return {
    closed,
    setVersion: () => undefined,
    close: () => end('The app closed the connection.'),
    notify: async (method, params) => {
      write({ jsonrpc: '2.0', method, ...(params === undefined ? {} : { params }) })
    },
    request: (method, params, { signal }) =>
      new Promise<RpcAnswer>((resolve, reject) => {
        if (ended !== null) return reject(new McpError('closed', ended))
        if (signal.aborted) return reject(abortFault(signal))
        const id = nextId++
        const onAbort = (): void => {
          if (!pending.delete(id)) return
          // cancelled at the server: it should stop, and must not answer (an answer that comes anyway is dropped above)
          write({
            jsonrpc: '2.0',
            method: 'notifications/cancelled',
            params: { requestId: id, reason: 'Stopped by the app.' }
          })
          reject(abortFault(signal))
        }
        pending.set(id, {
          resolve: (answer) => {
            signal.removeEventListener('abort', onAbort)
            resolve(answer)
          },
          reject: (error) => {
            signal.removeEventListener('abort', onAbort)
            reject(error)
          }
        })
        signal.addEventListener('abort', onAbort, { once: true })
        if (!write({ jsonrpc: '2.0', id, method, params })) {
          pending.delete(id)
          signal.removeEventListener('abort', onAbort)
          reject(new McpError('closed', ended ?? 'The connector ended.'))
        }
      })
  }
}

// ---------------------------------------------------------------------- the client ------------------------------------------------------------------------

/** What a call brought back: the server's result object (checked to be one), or its JSON-RPC error. */
export type CallAnswer =
  | { kind: 'result'; result: Record<string, unknown> }
  | { kind: 'error'; code: number; message: string }

export interface McpSession {
  readonly era: 'modern' | 'legacy'
  readonly version: string
  /** What the server calls itself (self-reported, cleaned; for showing only, never for a decision). */
  readonly serverName: string | null
  listTools(signal: AbortSignal): Promise<{ tools: unknown[]; more: boolean }>
  callTool(
    name: string,
    args: Record<string, unknown>,
    signal: AbortSignal,
    headers?: Readonly<Record<string, string>>
  ): Promise<CallAnswer>
  close(): void
}

/** A result's `resultType`, as the specification says to read it: absent is `complete` (older servers), `input_required` is an ask, anything else is not valid. */
function resultKind(result: Record<string, unknown>): 'complete' | 'input' | 'bad' {
  const t = result.resultType
  if (t === undefined || t === 'complete') return 'complete'
  return t === 'input_required' ? 'input' : 'bad'
}

const NEEDS_INPUT =
  'The connector asked for something the app does not give connectors (to call a model, to ask you a question, or to list your folders).'

/**
 * Opens the protocol on a wire: modern first (`server/discover`), the older handshake when the answer says so, and the session to list and call tools in. Throws an
 * McpError with a sentence for the person when no revision both sides speak can be had, or the connection ends first.
 */
export async function connectMcp(
  wire: Wire,
  options: { signal: AbortSignal; probeMs?: number }
): Promise<McpSession> {
  const { signal } = options
  let era: 'modern' | 'legacy' = 'modern'
  let version = MODERN_VERSION
  let serverName: string | null = null

  const meta = (): Record<string, unknown> => ({
    'io.modelcontextprotocol/protocolVersion': version,
    'io.modelcontextprotocol/clientInfo': { ...CLIENT_INFO },
    'io.modelcontextprotocol/clientCapabilities': {}
  })
  const params = (body: Record<string, unknown>): Record<string, unknown> =>
    era === 'modern' ? { ...body, _meta: meta() } : body

  const ask = async (
    method: string,
    body: Record<string, unknown>,
    askSignal: AbortSignal,
    headers?: Readonly<Record<string, string>>
  ): Promise<RpcAnswer> => {
    try {
      return await wire.request(method, params(body), { signal: askSignal, headers })
    } catch (error) {
      if (error instanceof McpError) throw error
      if (askSignal.aborted) throw abortFault(askSignal)
      throw new McpError('closed', 'The connection to the connector broke.')
    }
  }

  // ---- which era: the probe ----
  let modern = false
  try {
    const probe = await ask('server/discover', {}, withClock(signal, options.probeMs ?? PROBE_MS))
    if (probe.ok) {
      const result = probe.result
      if (!isObject(result) || !Array.isArray(result.supportedVersions)) {
        modern = false // an answer that is not a discovery result: an older server that answers anything (it is asked again below)
      } else if ((result.supportedVersions as unknown[]).includes(MODERN_VERSION)) {
        modern = true
        const info = isObject(result._meta)
          ? result._meta['io.modelcontextprotocol/serverInfo']
          : undefined
        if (isObject(info) && typeof info.name === 'string')
          serverName = oneLine(info.name, 60) || null
      } else {
        throw new McpError(
          'version',
          'The connector speaks only revisions of MCP that this app does not know.'
        )
      }
    } else if (MODERN_ERRORS.has(probe.code)) {
      // a modern server that does not take the revision the app speaks: the app speaks no other modern one
      throw new McpError(
        'version',
        'The connector speaks only revisions of MCP that this app does not know.'
      )
    }
  } catch (error) {
    if (!(error instanceof McpError)) throw error
    if (error.fault === 'version' || error.fault === 'closed' || error.fault === 'too-big')
      throw error
    if (signal.aborted) throw abortFault(signal)
    // no answer in time, an HTTP refusal of the modern request, something that is not the protocol: an older server (it is asked to shake hands below)
  }

  if (modern) {
    wire.setVersion('modern', MODERN_VERSION)
  } else {
    era = 'legacy'
    version = LEGACY_VERSIONS[0]
    wire.setVersion('legacy', version)
    const hello = await ask(
      'initialize',
      { protocolVersion: version, capabilities: {}, clientInfo: { ...CLIENT_INFO } },
      withClock(signal, CONNECTOR_LIMITS.startMs)
    )
    if (!hello.ok) {
      throw new McpError(
        'not-mcp',
        'The connector refused to start a conversation (neither revision of MCP worked).'
      )
    }
    const result = hello.result
    if (!isObject(result) || typeof result.protocolVersion !== 'string') {
      throw new McpError('not-mcp', 'The connector did not answer as an MCP server does.')
    }
    if (!LEGACY_VERSIONS.includes(result.protocolVersion)) {
      throw new McpError(
        'version',
        'The connector speaks only revisions of MCP that this app does not know.'
      )
    }
    version = result.protocolVersion
    wire.setVersion('legacy', version)
    if (isObject(result.serverInfo) && typeof result.serverInfo.name === 'string') {
      serverName = oneLine(result.serverInfo.name, 60) || null
    }
    await wire.notify('notifications/initialized')
  }

  return {
    era,
    version,
    serverName,
    close: () => wire.close(),

    listTools: async (listSignal) => {
      const tools: unknown[] = []
      let cursor: string | null = null
      let more = false
      for (let page = 0; page < MAX_PAGES; page++) {
        const answer = await ask('tools/list', cursor === null ? {} : { cursor }, listSignal)
        if (!answer.ok) throw new McpError('not-mcp', 'The connector refused to list its tools.')
        const result = answer.result
        if (!isObject(result) || !Array.isArray(result.tools)) {
          throw new McpError(
            'not-mcp',
            'The connector listed its tools in a form that is not the protocol.'
          )
        }
        const kind = resultKind(result)
        if (kind === 'input') throw new McpError('needs-input', NEEDS_INPUT)
        if (kind === 'bad')
          throw new McpError('not-mcp', 'The connector answered in a form the app does not know.')
        for (const tool of result.tools as unknown[]) {
          if (tools.length >= CONNECTOR_LIMITS.toolsEach) {
            more = true
            break
          }
          tools.push(tool)
        }
        const next = result.nextCursor
        if (more || typeof next !== 'string' || next === '' || next.length > 2000) break
        if (page === MAX_PAGES - 1) more = true
        cursor = next
      }
      return { tools, more }
    },

    callTool: async (name, args, callSignal, headers) => {
      const answer = await ask('tools/call', { name, arguments: args }, callSignal, headers)
      if (!answer.ok) return { kind: 'error', code: answer.code, message: answer.message }
      const result = answer.result
      if (!isObject(result))
        throw new McpError(
          'not-mcp',
          'The connector answered the call in a form that is not the protocol.'
        )
      const kind = resultKind(result)
      if (kind === 'input') throw new McpError('needs-input', NEEDS_INPUT)
      if (kind === 'bad')
        throw new McpError('not-mcp', 'The connector answered in a form the app does not know.')
      return { kind: 'result', result }
    }
  }
}
