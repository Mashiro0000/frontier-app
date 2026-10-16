import dns from 'dns'
import http from 'http'
import https from 'https'
import net from 'net'
import { OAUTH_LIMITS } from '../shared/oauth'
import { oneLine } from './mcpClient'

// The guard under every address a server names (Stage 14b, D-046, pick D). A hosted connector tells the app where its sign-in provider is, and the provider tells it where
// to register, to get a token, to renew it and to revoke it. Those addresses come from OUTSIDE: a hostile server can name an address inside the person's own network
// (a router, a printer, a cloud's metadata service) to make the app knock on it (server-side request forgery). So every request to such an address goes through here:
//   - https only (plain http only when the connector the person typed is itself on this PC and so is the address), no name or password, visible characters only, no fragment;
//   - the name is resolved HERE, in the very step that connects (a custom `lookup`), and every answer must be a public address: a name cannot change its mind between the
//     check and the use (no second resolution exists to be fooled), and an address written as a number is checked before anything is sent;
//   - private, loopback, link-local, shared (100.64/10), unique-local, multicast, reserved, documentation, tunnelling (Teredo, 6to4, NAT64, IPv4-in-IPv6) and the clouds'
//     metadata addresses are refused, in every spelling (the URL parser turns 0x7f.1 or 2130706433 into 127.0.0.1 before we look);
//   - the one exception: an address on the SAME HOST as the connector the person typed (a connector on their own network may name its own provider);
//   - no redirect is followed (a redirect is a refusal), no cookie is kept, no connection is reused, the answer is JSON or nothing, cut at a size, with a clock and a Stop.
// No Electron imports. The resolver and the transport are handed in by the checks.

export type GuardCode =
  | 'refused-url' // not an address the app uses
  | 'refused-address' // the name leads to an address inside a network or a reserved one
  | 'redirect' // the address answered with a redirect
  | 'too-big' // the answer is larger than the app accepts
  | 'timeout' // no answer in time
  | 'stopped' // the person stopped it
  | 'unreachable' // no connection, or it broke

/** A request the guard did not make or could not finish. `message` is the app's own sentence; a host name is quoted cleaned and cut, nothing else of the server's. */
export class GuardError extends Error {
  readonly code: GuardCode
  constructor(code: GuardCode, message: string) {
    super(message)
    this.code = code
  }
}

export interface Resolved {
  address: string
  family: 4 | 6
}
export type Resolver = (host: string) => Promise<Resolved[]>

const systemResolve: Resolver = async (host) => {
  const all = await dns.promises.lookup(host, { all: true, verbatim: true })
  return all.map((a) => ({ address: a.address, family: a.family === 6 ? 6 : 4 }))
}

// ---------------------------------------------------------------------- addresses ---------------------------------------------------------------------------

type Family = 'ipv4' | 'ipv6'
/** [what it is, first address, bits]. Everything here is refused unless the address is on the connector's own host. */
const RANGES: readonly (readonly [string, string, number, Family])[] = [
  ['this network', '0.0.0.0', 8, 'ipv4'],
  ['private', '10.0.0.0', 8, 'ipv4'],
  ['shared', '100.64.0.0', 10, 'ipv4'],
  ['loopback', '127.0.0.0', 8, 'ipv4'],
  ['link-local', '169.254.0.0', 16, 'ipv4'],
  ['private', '172.16.0.0', 12, 'ipv4'],
  ['reserved', '192.0.0.0', 24, 'ipv4'],
  ['documentation', '192.0.2.0', 24, 'ipv4'],
  ['relay', '192.88.99.0', 24, 'ipv4'],
  ['private', '192.168.0.0', 16, 'ipv4'],
  ['benchmark', '198.18.0.0', 15, 'ipv4'],
  ['documentation', '198.51.100.0', 24, 'ipv4'],
  ['documentation', '203.0.113.0', 24, 'ipv4'],
  ['multicast', '224.0.0.0', 4, 'ipv4'],
  ['reserved', '240.0.0.0', 4, 'ipv4'],
  ['cloud metadata', '168.63.129.16', 32, 'ipv4'],
  ['unspecified', '::', 128, 'ipv6'],
  ['loopback', '::1', 128, 'ipv6'],
  ['IPv4 inside IPv6', '::', 96, 'ipv6'],
  ['IPv4 inside IPv6', '::ffff:0:0', 96, 'ipv6'],
  ['translation', '64:ff9b::', 96, 'ipv6'],
  ['translation', '64:ff9b:1::', 48, 'ipv6'],
  ['discard', '100::', 64, 'ipv6'],
  ['tunnel', '2001::', 32, 'ipv6'],
  ['documentation', '2001:db8::', 32, 'ipv6'],
  ['tunnel', '2002::', 16, 'ipv6'],
  ['documentation', '3fff::', 20, 'ipv6'],
  ['segment routing', '5f00::', 16, 'ipv6'],
  ['unique-local', 'fc00::', 7, 'ipv6'],
  ['link-local', 'fe80::', 10, 'ipv6'],
  ['site-local', 'fec0::', 10, 'ipv6'],
  ['multicast', 'ff00::', 8, 'ipv6']
]
const LISTS = RANGES.map(([name, first, bits, family]) => {
  const list = new net.BlockList()
  list.addSubnet(first, bits, family)
  return { name, family, list }
})

/** Why an address is not one the app will knock on ("private", "loopback", ...), or null when it is public. Text that is not an address is refused as "not an address". */
export function refusedAddress(address: string): string | null {
  const family = address.includes('%') ? 0 : net.isIP(address)
  if (family === 0) return 'not an address'
  const kind: Family = family === 6 ? 'ipv6' : 'ipv4'
  for (const range of LISTS) {
    if (range.family === kind && range.list.check(address, kind)) return range.name
  }
  return null
}

// ---------------------------------------------------------------------- addresses of the web ----------------------------------------------------------------

const LOOPBACK_NAMES = new Set(['localhost', '127.0.0.1', '[::1]'])
const bare = (hostname: string): string =>
  hostname.startsWith('[') ? hostname.slice(1, -1) : hostname

export type NamedUrl =
  { ok: true; url: URL; host: string; sameHost: boolean } | { ok: false; why: string }

/**
 * An address a server named, as the app would use it, or why not. `anchor` is the connector's own address (the one the person typed): an address on the same host may be a
 * private one, and plain http is allowed only when both are on this PC itself.
 */
export function checkNamedUrl(text: unknown, anchor: string): NamedUrl {
  if (typeof text !== 'string' || text === '' || text.length > OAUTH_LIMITS.urlChars) {
    return { ok: false, why: 'The connector named an address that is empty or too long.' }
  }
  let url: URL
  try {
    url = new URL(text)
  } catch {
    return { ok: false, why: 'The connector named something that is not a web address.' }
  }
  let anchorUrl: URL
  try {
    anchorUrl = new URL(anchor)
  } catch {
    return { ok: false, why: 'The connector has no address of its own.' }
  }
  if (url.username !== '' || url.password !== '') {
    return { ok: false, why: 'The connector named an address that holds a name or a password.' }
  }
  if (url.hash !== '') {
    return { ok: false, why: 'The connector named an address with a fragment in it.' }
  }
  if (!/^[\x21-\x7e]+$/.test(url.href) || url.href.length > OAUTH_LIMITS.urlChars) {
    return {
      ok: false,
      why: 'The connector named an address with characters the app does not send.'
    }
  }
  const host = url.hostname.toLowerCase()
  const sameHost = host === anchorUrl.hostname.toLowerCase()
  if (url.protocol === 'http:') {
    const onThisPc =
      LOOPBACK_NAMES.has(host) && LOOPBACK_NAMES.has(anchorUrl.hostname.toLowerCase())
    if (!onThisPc) {
      return { ok: false, why: 'The connector named an address that is not https.' }
    }
  } else if (url.protocol !== 'https:') {
    return { ok: false, why: 'The connector named an address that is not https.' }
  }
  return { ok: true, url, host: oneLine(host, 100), sameHost }
}

// ---------------------------------------------------------------------- the request ------------------------------------------------------------------------

export interface GuardedResponse {
  status: number
  /** The media type of the answer, lower case, without parameters ('' if none). */
  type: string
  /** The `WWW-Authenticate` header(s) as the server sent them, or null. */
  challenge: string | null
  /** The body parsed as JSON when the answer is JSON and parses; otherwise undefined. */
  json: unknown
  /** How many bytes the body had. */
  size: number
}

export interface GuardedRequest {
  method?: 'GET' | 'POST'
  headers?: Readonly<Record<string, string>>
  /** At most `sendBytes`. */
  body?: string
  /** The person's Stop. */
  signal?: AbortSignal
  /** Shorter limits for this request (never longer). */
  maxBytes?: number
  timeoutMs?: number
}

export type GuardedFetch = (url: string, request?: GuardedRequest) => Promise<GuardedResponse>

export interface GuardedFetchOptions {
  /** The connector's own address, as the person typed it. */
  anchor: string
  /** Name -> addresses. The system's by default; the checks hand in their own. */
  resolve?: Resolver
}

const isJson = (type: string): boolean => type === 'application/json' || type.endsWith('+json')

export function createGuardedFetch(options: GuardedFetchOptions): GuardedFetch {
  const resolve = options.resolve ?? systemResolve
  return (rawUrl, request = {}) =>
    new Promise<GuardedResponse>((done, fail) => {
      const named = checkNamedUrl(rawUrl, options.anchor)
      if (!named.ok) return fail(new GuardError('refused-url', named.why))
      const { url, sameHost } = named
      const hostname = bare(url.hostname)
      const literal = net.isIP(hostname) !== 0
      if (literal && !sameHost) {
        const kind = refusedAddress(hostname)
        if (kind !== null) {
          return fail(
            new GuardError(
              'refused-address',
              `The connector named an address inside a network (${kind}); the app does not use it.`
            )
          )
        }
      }
      const body = request.body
      if (body !== undefined && Buffer.byteLength(body) > OAUTH_LIMITS.sendBytes) {
        return fail(new GuardError('refused-url', 'The app would send more than it allows.'))
      }
      const max = Math.min(request.maxBytes ?? OAUTH_LIMITS.answerBytes, OAUTH_LIMITS.answerBytes)
      const ms = Math.min(request.timeoutMs ?? OAUTH_LIMITS.requestMs, OAUTH_LIMITS.requestMs)
      const signal = AbortSignal.any([
        request.signal ?? new AbortController().signal,
        AbortSignal.timeout(ms)
      ])
      if (signal.aborted) return fail(abortError(signal))

      // the one place a name becomes an address: the answers are checked and the connection uses them, nothing else
      const lookup: net.LookupFunction = (name, lookupOptions, callback) => {
        void (async () => {
          try {
            const found = literal
              ? [{ address: hostname, family: net.isIP(hostname) as 4 | 6 }]
              : await resolve(name)
            if (found.length === 0)
              throw new GuardError('unreachable', 'The address could not be found.')
            if (!sameHost) {
              for (const a of found) {
                const kind = refusedAddress(a.address)
                if (kind !== null) {
                  throw new GuardError(
                    'refused-address',
                    `The connector named ${named.host}, which leads inside a network (${kind}); the app does not use it.`
                  )
                }
              }
            }
            if (lookupOptions.all === true) callback(null, found)
            else callback(null, found[0].address, found[0].family)
          } catch (error) {
            const wrapped =
              error instanceof GuardError
                ? error
                : new GuardError('unreachable', 'The address could not be found.')
            callback(wrapped as unknown as NodeJS.ErrnoException, '', 4)
          }
        })()
      }

      const lib = url.protocol === 'https:' ? https : http
      const headers: Record<string, string> = {
        accept: 'application/json',
        'user-agent': 'Frontier-App',
        connection: 'close'
      }
      for (const [name, value] of Object.entries(request.headers ?? {}))
        headers[name.toLowerCase()] = value
      if (body !== undefined) headers['content-length'] = String(Buffer.byteLength(body))
      let finished = false
      const end = (settle: () => void): void => {
        if (finished) return
        finished = true
        settle()
      }
      const req = lib.request(
        {
          protocol: url.protocol,
          hostname,
          port: url.port === '' ? undefined : Number(url.port),
          path: `${url.pathname}${url.search}`,
          method: request.method ?? 'GET',
          headers,
          lookup,
          agent: false,
          // the certificate is checked against the name in the address, as ever
          servername: literal ? undefined : hostname
        },
        (res) => {
          const status = res.statusCode ?? 0
          if (status >= 300 && status < 400) {
            end(() =>
              fail(
                new GuardError(
                  'redirect',
                  `${named.host} answered with a redirect, and the app does not follow redirects.`
                )
              )
            )
            res.destroy()
            req.destroy()
            return
          }
          const type = String(res.headers['content-type'] ?? '')
            .split(';')[0]
            .trim()
            .toLowerCase()
          const challenge = res.headers['www-authenticate']
          const parts: Buffer[] = []
          let size = 0
          res.on('data', (chunk: Buffer) => {
            size += chunk.length
            if (size > max) {
              // settle first: destroying the request raises an error of its own, which must not be the answer
              end(() =>
                fail(
                  new GuardError(
                    'too-big',
                    `${named.host} sent more than the app accepts for one answer.`
                  )
                )
              )
              res.destroy()
              req.destroy()
              return
            }
            parts.push(chunk)
          })
          res.on('error', () => end(() => fail(failure(signal, named.host))))
          res.on('aborted', () => end(() => fail(failure(signal, named.host))))
          res.on('end', () => {
            let json: unknown
            if (isJson(type)) {
              try {
                json = JSON.parse(Buffer.concat(parts).toString('utf8'))
              } catch {
                json = undefined
              }
            }
            end(() =>
              done({
                status,
                type,
                challenge: typeof challenge === 'string' ? challenge : null,
                json,
                size
              })
            )
          })
        }
      )
      req.on('error', (error: Error) => {
        end(() => fail(error instanceof GuardError ? error : failure(signal, named.host, error)))
      })
      signal.addEventListener(
        'abort',
        () => {
          req.destroy()
          end(() => fail(abortError(signal)))
        },
        { once: true }
      )
      req.end(body)
    })
}

function abortError(signal: AbortSignal): GuardError {
  const why: unknown = signal.reason
  return why instanceof DOMException && why.name === 'TimeoutError'
    ? new GuardError('timeout', 'The address did not answer in time.')
    : new GuardError('stopped', 'The sign-in was stopped.')
}

function failure(signal: AbortSignal, host: string, error?: Error): GuardError {
  if (signal.aborted) return abortError(signal)
  // a refusal made inside the lookup comes back as the error of the connection
  const inner: unknown = (error as { cause?: unknown } | undefined)?.cause
  if (inner instanceof GuardError) return inner
  return new GuardError('unreachable', `${host} could not be reached.`)
}
