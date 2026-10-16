// A reference sign-in provider AND protected MCP server for the Stage 14b checks (D-046), written with no package. One process (or one call in-process) plays both the connector
// (POST /mcp, 401 until a good token comes) and the provider that signs a person in (the documents, /authorize, /token, /register, /revoke), on this PC's loopback, and misbehaves
// on purpose in the ways `mode` says (a comma-separated list; see the MODES below). It is a test tool: it is never shipped, and it trusts nobody.
//
//   in-process:  const p = await startProvider({ mode: 'good' })  ->  { port, base, issuer, mcp, log, issued, config, close(), set(mode), expireAll(), isValid(t) }
//   as a process: node oauth-server.mjs --mode good --port 0     (prints "LISTENING <port>")
//
// The clients it knows: `typed-client` (no secret) and `typed-secret-client` (secret `typed-secret-value`, basic) as if registered by hand (any port on 127.0.0.1/callback),
// and every client that registers through /register (the exact return address it gave).
//
// DOCUMENT MODES
//   good                no change
//   no-challenge        the 401 has no WWW-Authenticate at all (the well-known addresses must be used)
//   challenge-nometa    the challenge names no resource_metadata (the well-known addresses must be used)
//   challenge-scope     the challenge asks for "read write"
//   challenge-bad-scope the challenge's scope holds a quote
//   meta-elsewhere      the challenge points at /prm-elsewhere (another path of the same server)
//   root-only           the sub-path document is not there, only the root one
//   wrong-resource      the connector's document is about https://other.example/mcp
//   resource-slash      the connector's document writes its resource with a trailing slash
//   no-as / no-as-field the connector names no provider (empty list / no field)
//   as-nonhttps / as-private / as-many   the provider is http://auth.example.net / https://10.0.0.1 / a bad one first and the good one second
//   scopes-many / scopes-bad / no-scopes  the connector's scopes_supported: 25 of them / one with a quote / none
//   prm-huge / prm-slow / prm-redirect / prm-text   the connector's document is huge / never answers / redirects / is not JSON
//   path-issuer         the provider's identity has a path (/tenant1): three well-known addresses in order
//   oidc-only / oidc-append-only   only openid-configuration (with / without the path inserted) answers
//   issuer-mismatch     the provider's document says it is https://honest.example
//   no-s256 / no-pkce-field   code_challenge_methods_supported is ["plain"] / absent
//   no-registration     no registration address
//   endpoint-file / endpoint-http / endpoint-private / endpoint-userinfo   the sign-in page is a file: address / plain http / the token address is https://10.0.0.1/ / holds a name
//   no-iss              the provider does not promise an iss (and sends none)
//   no-code             the provider offers no authorization-code flow
//   as-redirect / as-huge / as-slow   the provider's document redirects / is huge / never answers
//   offline             the provider lists offline_access
// FLOW MODES
//   iss-wrong / iss-missing / iss-slash   the answer of /authorize says iss=https://evil.example / says no iss / says the identity with a trailing slash added
//   state-wrong / state-missing / code-dup / code-huge   the answer's state is another / none / the code comes twice / is huge
//   authorize-error / authorize-error-badiss   the answer is error=access_denied with a hostile description / and the iss is wrong
//   reg-fail / reg-no-id / reg-other-redirect / reg-bad-method / reg-no-secret / reg-huge / reg-text / reg-redirect   the registration misbehaves
//   client-secret       the registration hands out a secret (method client_secret_basic) which /token then insists on
//   tok-no-access / tok-type-mac / tok-expires-neg / tok-expires-huge / tok-expires-none / tok-expires-text / tok-huge-token / tok-text / tok-redirect / tok-slow /
//   tok-bad-refresh / tok-scope-narrow / tok-no-rotate / tok-invalid-grant (renewing only) / tok-fail-code (/token always fails with invalid_grant)
//   revoke-fail / revoke-slow   /revoke answers 500 / never answers
//   mcp-always-401 / mcp-always-403   /mcp refuses every token with a 401 / with a 403 insufficient_scope
import crypto from 'node:crypto'
import http from 'node:http'
import { pathToFileURL } from 'node:url'

export async function startProvider(options = {}) {
  let modes = new Set(String(options.mode ?? 'good').split(',').map((s) => s.trim()).filter(Boolean))
  const has = (m) => modes.has(m)
  const log = []
  const server = http.createServer((req, res) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      const url = new URL(req.url, 'http://x')
      const body = Buffer.concat(chunks).toString('utf8')
      log.push({ method: req.method, path: url.pathname, search: url.search, headers: req.headers, body })
      try {
        route(req, res, url, body)
      } catch (error) {
        res.writeHead(500, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: 'fixture', detail: String(error) }))
      }
    })
  })
  const sockets = new Set()
  server.on('connection', (s) => {
    sockets.add(s)
    s.on('close', () => sockets.delete(s))
  })
  await new Promise((resolve) => server.listen(options.port ?? 0, '127.0.0.1', resolve))
  const port = server.address().port
  const base = `http://127.0.0.1:${port}`
  const issuer = () => (has('path-issuer') ? `${base}/tenant1` : base)
  const mcp = `${base}/mcp`
  const rand = (n) => crypto.randomBytes(n).toString('base64url')

  // what the provider remembers
  const clients = new Map([
    ['typed-client', { redirectUris: [], secret: null, anyPort: true, method: 'none' }],
    ['typed-secret-client', { redirectUris: [], secret: 'typed-secret-value', anyPort: true, method: 'client_secret_basic' }]
  ])
  const codes = new Map()
  const access = new Map() // token -> ends at (ms)
  const refreshes = new Map() // token -> { clientId }
  const issued = []
  const config = { expiresIn: options.expiresIn ?? 3600 }

  const json = (res, status, value, headers = {}) => {
    res.writeHead(status, { 'content-type': 'application/json', ...headers })
    res.end(JSON.stringify(value))
  }
  const notFound = (res) => json(res, 404, { error: 'not_found' })

  // ---- the documents ----
  const prm = () => {
    const doc = {
      resource: has('wrong-resource') ? 'https://other.example/mcp' : has('resource-slash') ? `${mcp}/` : mcp,
      authorization_servers: [issuer()],
      scopes_supported: ['read', 'write']
    }
    if (has('no-as')) doc.authorization_servers = []
    if (has('no-as-field')) delete doc.authorization_servers
    if (has('as-nonhttps')) doc.authorization_servers = ['http://auth.example.net']
    if (has('as-private')) doc.authorization_servers = ['https://10.0.0.1']
    if (has('as-many')) doc.authorization_servers = ['https://10.0.0.1', issuer(), 'https://10.0.0.2', 'https://10.0.0.3']
    if (has('scopes-many')) doc.scopes_supported = Array.from({ length: 25 }, (_, i) => `scope${i}`)
    if (has('scopes-bad')) doc.scopes_supported = ['read', 'bad"scope']
    if (has('no-scopes')) delete doc.scopes_supported
    return doc
  }
  const asDoc = () => {
    const doc = {
      issuer: has('issuer-mismatch') ? 'https://honest.example' : issuer(),
      authorization_endpoint: `${base}/authorize`,
      token_endpoint: `${base}/token`,
      registration_endpoint: `${base}/register`,
      revocation_endpoint: `${base}/revoke`,
      code_challenge_methods_supported: ['S256'],
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      token_endpoint_auth_methods_supported: ['none', 'client_secret_post'],
      scopes_supported: has('offline') ? ['read', 'write', 'offline_access'] : ['read', 'write'],
      authorization_response_iss_parameter_supported: !has('no-iss')
    }
    if (has('no-s256')) doc.code_challenge_methods_supported = ['plain']
    if (has('no-pkce-field')) delete doc.code_challenge_methods_supported
    if (has('no-registration')) delete doc.registration_endpoint
    if (has('endpoint-file')) doc.authorization_endpoint = 'file:///c:/windows/win.ini'
    if (has('endpoint-http')) doc.authorization_endpoint = 'http://auth.example.net/authorize'
    if (has('endpoint-private')) doc.token_endpoint = 'https://10.0.0.1/token'
    if (has('endpoint-userinfo')) doc.token_endpoint = 'https://me:pw@auth.example.net/token'
    if (has('no-code')) doc.response_types_supported = ['token']
    return doc
  }
  const challenge = () => {
    if (has('no-challenge')) return null
    const parts = []
    if (!has('challenge-nometa')) {
      parts.push(`resource_metadata="${has('meta-elsewhere') ? `${base}/prm-elsewhere` : `${base}/.well-known/oauth-protected-resource/mcp`}"`)
    }
    if (has('challenge-scope')) parts.push('scope="read write"')
    if (has('challenge-bad-scope')) parts.push('scope="read b\\"ad"')
    return `Bearer ${parts.join(', ')}`.trim()
  }
  const serveDoc = (res, doc, kind) => {
    if (has(`${kind}-redirect`)) {
      res.writeHead(302, { location: 'http://10.0.0.1/secret' })
      return res.end()
    }
    if (has(`${kind}-slow`)) return undefined
    if (has(`${kind}-huge`)) return json(res, 200, { pad: 'x'.repeat(300 * 1024), ...doc })
    if (has(`${kind}-text`)) {
      res.writeHead(200, { 'content-type': 'text/plain' })
      return res.end('not json')
    }
    return json(res, 200, doc)
  }

  // ---- the sign-in ----
  function register(req, res, body) {
    if (has('reg-fail')) return json(res, 500, { error: 'server_error' })
    if (has('reg-redirect')) {
      res.writeHead(302, { location: 'http://10.0.0.1/secret' })
      return res.end()
    }
    if (has('reg-text')) {
      res.writeHead(201, { 'content-type': 'text/plain' })
      return res.end('registered')
    }
    let asked
    try {
      asked = JSON.parse(body)
    } catch {
      return json(res, 400, { error: 'invalid_client_metadata' })
    }
    const id = 'dcr-' + rand(9)
    const secret = has('client-secret') ? 'sec-' + rand(18) : null
    const method = has('client-secret') ? 'client_secret_basic' : 'none'
    clients.set(id, { redirectUris: asked.redirect_uris ?? [], secret, anyPort: false, method })
    const doc = { client_id: id, redirect_uris: asked.redirect_uris, token_endpoint_auth_method: method, client_name: asked.client_name }
    if (secret !== null) doc.client_secret = secret
    if (has('reg-no-id')) delete doc.client_id
    if (has('reg-other-redirect')) doc.redirect_uris = ['http://127.0.0.1:1/callback']
    if (has('reg-bad-method')) doc.token_endpoint_auth_method = 'private_key_jwt'
    if (has('reg-no-secret')) {
      delete doc.client_secret
      doc.token_endpoint_auth_method = 'client_secret_basic'
    }
    if (has('reg-huge')) doc.pad = 'x'.repeat(300 * 1024)
    return json(res, 201, doc)
  }

  function authorize(res, url) {
    const q = url.searchParams
    const client = clients.get(q.get('client_id') ?? '')
    const bad = (why) => json(res, 400, { error: 'invalid_request', why })
    if (client === undefined) return bad('client')
    if (q.get('response_type') !== 'code') return bad('response_type')
    if (q.get('code_challenge_method') !== 'S256' || !q.get('code_challenge')) return bad('pkce')
    const redirect = q.get('redirect_uri') ?? ''
    let target
    try {
      target = new URL(redirect)
    } catch {
      return bad('redirect_uri')
    }
    const okRedirect = client.anyPort ? target.protocol === 'http:' && target.hostname === '127.0.0.1' && target.pathname === '/callback' : client.redirectUris.includes(redirect)
    if (!okRedirect) return bad('redirect_uri')
    if (!q.get('state')) return bad('state')
    if (!q.get('resource')) return bad('resource')
    const code = 'code-' + rand(18)
    codes.set(code, { clientId: q.get('client_id'), redirect, challenge: q.get('code_challenge'), resource: q.get('resource'), scope: q.get('scope') ?? '', used: false })
    const back = new URL(redirect)
    const withIss = !(has('no-iss') || has('iss-missing'))
    if (has('authorize-error') || has('authorize-error-badiss')) {
      back.searchParams.set('error', 'access_denied')
      back.searchParams.set('error_description', '<script>alert(1)</script> Click http://evil.example to continue')
    } else {
      back.searchParams.set('code', has('code-huge') ? 'c'.repeat(5000) : code)
      if (has('code-dup')) back.searchParams.append('code', code)
    }
    if (!has('state-missing')) back.searchParams.set('state', has('state-wrong') ? 'not-the-state' : q.get('state'))
    if (withIss) {
      const iss = has('iss-wrong') || has('authorize-error-badiss') ? 'https://evil.example' : has('iss-slash') ? asDoc().issuer + '/' : asDoc().issuer
      back.searchParams.set('iss', iss)
    }
    res.writeHead(302, { location: back.href })
    return res.end()
  }

  function clientOf(req, form) {
    const basic = String(req.headers.authorization ?? '')
    let id = form.get('client_id')
    let secret = form.get('client_secret')
    if (basic.startsWith('Basic ')) {
      const [a, b] = Buffer.from(basic.slice(6), 'base64').toString('utf8').split(':')
      id = decodeURIComponent(a ?? '')
      secret = decodeURIComponent(b ?? '')
    }
    const client = clients.get(id ?? '')
    if (client === undefined) return null
    if (client.secret !== null && secret !== client.secret) return null
    return { id, client }
  }

  function issue(clientId, scope, previous) {
    const accessToken = 'at-' + rand(24)
    const refreshToken = previous !== null && has('tok-no-rotate') ? previous : 'rt-' + rand(24)
    access.set(accessToken, Date.now() + config.expiresIn * 1000)
    refreshes.set(refreshToken, { clientId })
    if (previous !== null && refreshToken !== previous) refreshes.delete(previous)
    issued.push({ access: accessToken, refresh: refreshToken, at: Date.now() })
    const doc = { access_token: accessToken, token_type: 'Bearer', expires_in: config.expiresIn, refresh_token: refreshToken, scope }
    if (has('tok-no-access')) delete doc.access_token
    if (has('tok-type-mac')) doc.token_type = 'mac'
    if (has('tok-expires-neg')) doc.expires_in = -5
    if (has('tok-expires-huge')) doc.expires_in = 1e12
    if (has('tok-expires-none')) delete doc.expires_in
    if (has('tok-expires-text')) doc.expires_in = '3600'
    if (has('tok-huge-token')) doc.access_token = 'a'.repeat(9000)
    if (has('tok-bad-refresh')) doc.refresh_token = 'bad token with spaces'
    if (has('tok-scope-narrow')) doc.scope = 'read'
    return doc
  }

  function token(req, res, body) {
    if (has('tok-slow')) return undefined
    if (has('tok-redirect')) {
      res.writeHead(302, { location: 'http://10.0.0.1/secret' })
      return res.end()
    }
    if (has('tok-text')) {
      res.writeHead(200, { 'content-type': 'text/plain' })
      return res.end('token')
    }
    if (has('tok-fail-code')) return json(res, 400, { error: 'invalid_grant', error_description: 'Click http://evil.example <b>now</b>' })
    const form = new URLSearchParams(body)
    const who = clientOf(req, form)
    if (who === null) return json(res, 401, { error: 'invalid_client' })
    const grant = form.get('grant_type')
    if (grant === 'authorization_code') {
      const entry = codes.get(form.get('code') ?? '')
      if (entry === undefined || entry.used || entry.clientId !== who.id || entry.redirect !== form.get('redirect_uri')) return json(res, 400, { error: 'invalid_grant' })
      entry.used = true
      const verifier = form.get('code_verifier') ?? ''
      if (crypto.createHash('sha256').update(verifier, 'ascii').digest('base64url') !== entry.challenge) return json(res, 400, { error: 'invalid_grant' })
      if (form.get('resource') !== entry.resource) return json(res, 400, { error: 'invalid_target' })
      return json(res, 200, issue(who.id, entry.scope, null))
    }
    if (grant === 'refresh_token') {
      if (has('tok-invalid-grant')) return json(res, 400, { error: 'invalid_grant' })
      const given = form.get('refresh_token') ?? ''
      const entry = refreshes.get(given)
      if (entry === undefined || entry.clientId !== who.id) return json(res, 400, { error: 'invalid_grant' })
      if (!form.get('resource')) return json(res, 400, { error: 'invalid_target' })
      return json(res, 200, issue(who.id, '', given))
    }
    return json(res, 400, { error: 'unsupported_grant_type' })
  }

  function revoke(req, res, body) {
    if (has('revoke-slow')) return undefined
    if (has('revoke-fail')) return json(res, 500, { error: 'server_error' })
    const form = new URLSearchParams(body)
    const t = form.get('token') ?? ''
    access.delete(t)
    refreshes.delete(t)
    res.writeHead(200)
    return res.end()
  }

  function route(req, res, url, body) {
    const p = url.pathname
    if (req.method === 'POST' && p === '/mcp') {
      const auth = String(req.headers.authorization ?? '')
      const given = auth.startsWith('Bearer ') ? auth.slice(7) : null
      if (has('mcp-always-401') || has('mcp-always-403')) {
        return has('mcp-always-403')
          ? json(res, 403, { error: 'insufficient_scope' }, { 'www-authenticate': `Bearer error="insufficient_scope", scope="admin", resource_metadata="${base}/.well-known/oauth-protected-resource/mcp"` })
          : json(res, 401, { error: 'unauthorized' }, { 'www-authenticate': challenge() ?? 'Bearer' })
      }
      if (given !== null && (access.get(given) ?? 0) > Date.now()) {
        // a small modern MCP server behind the token: discovery, one tool, one call
        let message = {}
        try {
          message = JSON.parse(body)
        } catch {
          message = {}
        }
        const id = message.id ?? 1
        switch (message.method) {
          case 'server/discover':
            return json(res, 200, { jsonrpc: '2.0', id, result: { supportedVersions: ['2026-07-28'], capabilities: { tools: {} }, _meta: { 'io.modelcontextprotocol/serverInfo': { name: 'oauth-ref', version: '1' } } } })
          case 'tools/list':
            return json(res, 200, { jsonrpc: '2.0', id, result: { tools: [{ name: 'echo', description: 'Gives the text back.', inputSchema: { type: 'object', properties: { text: { type: 'string', maxLength: 100 } }, required: ['text'] } }] } })
          case 'tools/call':
            return json(res, 200, { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: `echo:${message.params?.arguments?.text ?? ''}` }] } })
          default:
            return json(res, 200, { jsonrpc: '2.0', id, result: {} })
        }
      }
      const header = challenge()
      return json(res, 401, { error: 'unauthorized' }, header === null ? {} : { 'www-authenticate': header })
    }
    if (req.method === 'GET' && p === '/prm-elsewhere') return serveDoc(res, prm(), 'prm')
    if (req.method === 'GET' && p === '/.well-known/oauth-protected-resource/mcp') {
      return has('root-only') ? notFound(res) : serveDoc(res, prm(), 'prm')
    }
    if (req.method === 'GET' && p === '/.well-known/oauth-protected-resource') return serveDoc(res, prm(), 'prm')
    if (req.method === 'GET') {
      const withPath = has('path-issuer')
      const oauth = withPath ? '/.well-known/oauth-authorization-server/tenant1' : '/.well-known/oauth-authorization-server'
      const oidcInserted = withPath ? '/.well-known/openid-configuration/tenant1' : '/.well-known/openid-configuration'
      const oidcAppended = '/tenant1/.well-known/openid-configuration'
      // exactly one of the three well-known addresses answers: the OAuth one, the OpenID one with the path inserted, or the OpenID one with the path appended
      const served = has('oidc-append-only') ? oidcAppended : has('oidc-only') ? oidcInserted : oauth
      if (p === served) return serveDoc(res, asDoc(), 'as')
    }
    if (req.method === 'POST' && p === '/register') return register(req, res, body)
    if (req.method === 'GET' && p === '/authorize') return authorize(res, url)
    if (req.method === 'POST' && p === '/token') return token(req, res, body)
    if (req.method === 'POST' && p === '/revoke') return revoke(req, res, body)
    return notFound(res)
  }

  return {
    port,
    base,
    mcp,
    get issuer() {
      return issuer()
    },
    log,
    issued,
    config,
    set: (m) => {
      modes = new Set(String(m).split(',').map((s) => s.trim()).filter(Boolean))
    },
    /** Ends every access token now (a token that has run out). */
    expireAll: () => {
      for (const k of access.keys()) access.set(k, 0)
    },
    isValid: (t) => (access.get(t) ?? 0) > Date.now(),
    refreshValid: (t) => refreshes.has(t),
    close: () =>
      new Promise((resolve) => {
        for (const s of sockets) s.destroy()
        server.close(() => resolve())
      })
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const argv = process.argv.slice(2)
  const opt = (name, fallback) => {
    const i = argv.indexOf(`--${name}`)
    return i === -1 ? fallback : argv[i + 1]
  }
  const p = await startProvider({ mode: opt('mode', 'good'), port: Number(opt('port', '0')) })
  console.log(`LISTENING ${p.port}`)
}
