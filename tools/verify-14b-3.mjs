// Slice 14b.3 (D-046) under plain Node: THE SIGN-IN FLOW (src/main/oauthFlow.ts and oauthCallback.ts), against the reference provider (tools/fixtures14/oauth-server.mjs) with a
// played browser (a plain request that follows the provider's redirect back to the app's listener). What it shows:
//   A. the verifier, the challenge (RFC 7636's own example) and the state;
//   B. the authorization address built from fields, and what it carries;
//   C. the answer of the browser judged in the specification's order (state, then issuer by its table, then the error), and nothing of the provider's words shown;
//   D. the token answer read strictly;
//   E. registering the app (RFC 7591) and every way the provider can answer badly;
//   F. the listener: where it listens, who it answers, how often, what it shows, how it ends;
//   G. the whole sign-in (registered client, typed client, typed client with a secret), the hostile modes of the flow, renewing and revoking;
//   H. what the source must keep true.
//
// Run: node tools/guarded.mjs tools/verify-14b-3.mjs      (ONLY=A,C runs some parts; it makes no folder and removes nothing)
import './ts-resolve.mjs'
import { checker } from './cdp.mjs'
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import os from 'node:os'
import { join } from 'node:path'
import { REPO, REPO_URL } from './paths.mjs'
import { startProvider } from './fixtures14/oauth-server.mjs'

const check = checker()
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(',')) : null
const guard = async (name, fn) => {
  if (ONLY && !ONLY.has(name)) return
  try {
    await fn()
  } catch (error) {
    check(`${name} did not run to its end: ${String(error?.stack ?? error).slice(0, 600)}`, false)
  }
}
const show = (v) => JSON.stringify(v)?.slice(0, 300)
const SRC = `${REPO_URL}/src`
const f = await import(`${SRC}/main/oauthFlow.ts`)
const cb = await import(`${SRC}/main/oauthCallback.ts`)
const d = await import(`${SRC}/main/oauthDiscovery.ts`)
const g = await import(`${SRC}/main/oauthHttp.ts`)
const { OAUTH_LIMITS } = await import(`${SRC}/shared/oauth.ts`)
const source = (rel) => fs.readFileSync(join(REPO, rel), 'utf8')
const UNRESERVED = /^[A-Za-z0-9\-._~]+$/

// ---- helpers ----
/** The played browser: asks the provider's sign-in page, follows its redirect to where it points (the app's listener), and does nothing else. */
const browser = (seen = []) => async (url) => {
  setImmediate(async () => {
    try {
      const first = await fetch(url, { redirect: 'manual' })
      const where = first.headers.get('location')
      seen.push({ url, status: first.status, where })
      if (where !== null) await fetch(where, { redirect: 'manual' })
    } catch (error) {
      seen.push({ url, error: String(error) })
    }
  })
  return true
}
async function session(mode, run) {
  const prov = await startProvider({ mode })
  try {
    const guarded = g.createGuardedFetch({ anchor: prov.mcp })
    const challenge = d.parseChallenge((await fetch(prov.mcp, { method: 'POST', body: '{}' })).headers.get('www-authenticate'))
    const found = await d.discover({ mcpUrl: prov.mcp, challenge, guarded })
    return await run({ prov, guarded, found: found.ok ? found.found : null, discovery: found })
  } finally {
    await prov.close()
  }
}
const signIn = (s, extra = {}) => f.runSignIn({ mcpUrl: s.prov.mcp, found: s.found, client: { kind: 'register' }, guarded: s.guarded, open: browser(), now: () => Date.now(), waitMs: 5000, ...extra })

// ============ A. PKCE and state ============
await guard('A', async () => {
  check('A: RFC 7636 appendix B: the challenge of its example verifier', f.challengeOf('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk') === 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM')
  const v = f.newVerifier()
  check('A: a verifier is 64 characters of the unreserved set (RFC 7636 wants 43 to 128)', v.length === 64 && UNRESERVED.test(v), v.length)
  const set = new Set()
  for (let i = 0; i < 2000; i++) set.add(f.newVerifier())
  check('A: 2,000 verifiers are all different', set.size === 2000)
  const states = new Set()
  for (let i = 0; i < 2000; i++) states.add(f.newState())
  check('A: 2,000 states are all different, 43 characters (256 bits) of the unreserved set', states.size === 2000 && [...states].every((s) => s.length === 43 && UNRESERVED.test(s)))
  check('A: the challenge is the SHA-256 of the verifier in base64url without padding', f.challengeOf(v) === crypto.createHash('sha256').update(v).digest('base64url') && !f.challengeOf(v).includes('=') && f.challengeOf(v).length === 43)
  check('A: the challenge is not the verifier (never the "plain" method)', f.challengeOf(v) !== v)
})

// ============ B. the authorization address ============
await guard('B', async () => {
  const input = { endpoint: 'https://auth.example.net/authorize', clientId: 'cid 1&x', redirectUri: 'http://127.0.0.1:5555/callback', challenge: 'CH', state: 'ST', resource: 'https://mcp.example.com/mcp', scopes: ['read', 'write'], anchor: 'https://mcp.example.com/mcp' }
  const r = f.buildAuthorizationUrl(input)
  const u = r.ok ? new URL(r.url) : null
  check('B: an address is built', r.ok && u.origin === 'https://auth.example.net' && u.pathname === '/authorize', show(r))
  const q = (n) => u.searchParams.get(n)
  check('B: it carries the code flow, the client, the return address, S256 with its challenge, the state, the resource and the permissions',
    q('response_type') === 'code' && q('client_id') === 'cid 1&x' && q('redirect_uri') === input.redirectUri && q('code_challenge') === 'CH' && q('code_challenge_method') === 'S256' && q('state') === 'ST' && q('resource') === input.resource && q('scope') === 'read write')
  check('B: a client id with spaces and an ampersand is encoded, not pasted (it does not add a field)', [...u.searchParams.keys()].filter((k) => k === 'x').length === 0 && r.url.includes('client_id=cid+1%26x'))
  const hostile = f.buildAuthorizationUrl({ ...input, endpoint: 'https://auth.example.net/authorize?redirect_uri=https%3A%2F%2Fevil.example&state=evil&client_id=evil&scope=admin&resource=x&code_challenge=evil&response_type=token' })
  const h = new URL(hostile.url)
  check('B: whatever the provider\'s own address says about these fields, the app\'s words are the ones sent', hostile.ok && ['redirect_uri', 'state', 'client_id', 'scope', 'resource', 'code_challenge', 'response_type'].every((k) => h.searchParams.getAll(k).length === 1) && h.searchParams.get('redirect_uri') === input.redirectUri && h.searchParams.get('state') === 'ST' && h.searchParams.get('response_type') === 'code' && h.searchParams.get('scope') === 'read write', hostile.url)
  const other = f.buildAuthorizationUrl({ ...input, endpoint: 'https://auth.example.net/authorize?prompt=consent&tenant=a' })
  check('B: its other fields (a tenant, a prompt) are kept', new URL(other.url).searchParams.get('tenant') === 'a' && new URL(other.url).searchParams.get('prompt') === 'consent')
  check('B: no permissions asked, no scope field (and a scope in the provider\'s own address is dropped)', !new URL(f.buildAuthorizationUrl({ ...input, scopes: [], endpoint: 'https://auth.example.net/a?scope=admin' }).url).searchParams.has('scope'))
  for (const [what, endpoint] of [['plain http', 'http://auth.example.net/authorize'], ['a file: address', 'file:///c:/windows/win.ini'], ['javascript:', 'javascript:alert(1)'], ['a name and a password', 'https://a:b@auth.example.net/x'], ['an address that is not one', 'nothing']]) {
    check(`B: ${what} as the sign-in page is refused`, !f.buildAuthorizationUrl({ ...input, endpoint }).ok)
  }
  check(`B: an address longer than ${OAUTH_LIMITS.urlChars} characters is refused`, !f.buildAuthorizationUrl({ ...input, scopes: Array.from({ length: 20 }, (_, i) => 's'.repeat(100) + i) }).ok)
  check('B: a connector and a page on this PC: plain http to this PC is allowed (the checks, a person\'s own server)', f.buildAuthorizationUrl({ ...input, endpoint: 'http://127.0.0.1:5/authorize', anchor: 'http://127.0.0.1:5/mcp' }).ok)
})

// ============ C. the answer of the browser ============
await guard('C', async () => {
  const exp = { state: 'STATE-1', issuer: 'https://auth.example.net', issResponse: true }
  const c = (params, e = exp) => f.checkAuthorizationResponse(params, e)
  check('C: the right state, the right issuer, a code: accepted', show(c({ state: 'STATE-1', iss: 'https://auth.example.net', code: 'abc' })) === '{"ok":true,"code":"abc"}')
  check('C: a wrong state is ignored', c({ state: 'STATE-2', iss: exp.issuer, code: 'abc' }).kind === 'state')
  check('C: no state is ignored', c({ iss: exp.issuer, code: 'abc' }).kind === 'state')
  check('C: a state with only a different length is ignored', c({ state: 'STATE-1x', iss: exp.issuer, code: 'abc' }).kind === 'state' && c({ state: 'STATE', iss: exp.issuer, code: 'abc' }).kind === 'state')
  // RFC 9207 section 2.4 as the specification's table has it
  check('C: iss promised and present and equal: accepted', c({ state: 'STATE-1', iss: exp.issuer, code: 'x' }).ok)
  check('C: iss promised and present but another: refused (a mix-up)', c({ state: 'STATE-1', iss: 'https://evil.example', code: 'x' }).kind === 'issuer')
  check('C: iss promised and absent: refused', c({ state: 'STATE-1', code: 'x' }).kind === 'issuer')
  const quiet = { ...exp, issResponse: false }
  check('C: iss not promised and absent: accepted', c({ state: 'STATE-1', code: 'x' }, quiet).ok)
  check('C: iss not promised but present and equal: accepted', c({ state: 'STATE-1', iss: exp.issuer, code: 'x' }, quiet).ok)
  check('C: iss not promised but present and another: refused all the same (the specification\'s third row)', c({ state: 'STATE-1', iss: 'https://evil.example', code: 'x' }, quiet).kind === 'issuer')
  for (const [what, iss] of [['a trailing slash', 'https://auth.example.net/'], ['another case', 'HTTPS://AUTH.example.net'], ['the default port written', 'https://auth.example.net:443'], ['a percent-encoded letter', 'https://auth.example.net/%61'], ['a space after', 'https://auth.example.net '], ['empty', '']]) {
    check(`C: ${what} in iss is a different issuer (a plain string comparison, nothing normalised)`, c({ state: 'STATE-1', iss, code: 'x' }).kind === 'issuer', iss)
  }
  const denied = c({ state: 'STATE-1', iss: exp.issuer, error: 'access_denied', error_description: '<script>alert(1)</script> go to http://evil.example', error_uri: 'http://evil.example' })
  check('C: an error is told in the app\'s own words, from its code; nothing the provider wrote is in it', denied.kind === 'refused' && denied.why === 'You did not allow the sign-in.' && denied.error === 'access_denied' && !/script|evil/.test(JSON.stringify(denied)), show(denied))
  const weird = c({ state: 'STATE-1', iss: exp.issuer, error: '<b>click me</b>' })
  check('C: an error code that is not a code is not repeated', weird.kind === 'refused' && !/click|<b>/.test(weird.why) && weird.error === undefined, show(weird))
  check('C: an unknown but well-formed code is quoted', c({ state: 'STATE-1', iss: exp.issuer, error: 'weird_thing' }).why === 'The provider refused (weird_thing).')
  const forged = c({ state: 'STATE-1', iss: 'https://evil.example', error: 'access_denied', error_description: 'x' })
  check('C: an error with the wrong issuer is not acted on or shown (the issuer is judged first)', forged.kind === 'issuer' && !/allow/.test(forged.why))
  check('C: an error with the wrong state is ignored first', c({ state: 'nope', iss: exp.issuer, error: 'access_denied' }).kind === 'state')
  for (const [what, code] of [['no code', undefined], ['an empty code', ''], ['a code with a space', 'a b'], ['a code with a control character', 'a\u0001b'], ['a code over 2,000 characters', 'c'.repeat(2001)]]) {
    const params = { state: 'STATE-1', iss: exp.issuer, ...(code === undefined ? {} : { code }) }
    check(`C: ${what} is refused`, c(params).kind === 'malformed', show(c(params)))
  }
  check('C: other parameters are ignored', c({ state: 'STATE-1', iss: exp.issuer, code: 'x', foo: 'bar', access_token: 'stolen' }).ok)
})

// ============ D. the token answer ============
await guard('D', async () => {
  const now = 1_000_000
  const ok = (body, status = 200) => f.readTokens({ status, type: 'application/json', challenge: null, json: body, size: 1 }, now, 'OLD')
  const good = ok({ access_token: 'at', token_type: 'Bearer', expires_in: 3600, refresh_token: 'rt', scope: 'read write' })
  check('D: a good answer: the token, the renewal token, the end of its life, the permissions', good.ok && good.tokens.accessToken === 'at' && good.tokens.refreshToken === 'rt' && good.tokens.expiresAt === now + 3_600_000 && show(good.tokens.scopes) === '["read","write"]', show(good))
  check('D: token_type in any case', ok({ access_token: 'at', token_type: 'bearer' }).ok && ok({ access_token: 'at', token_type: 'BEARER' }).ok)
  check('D: another kind of token (mac, dpop) is refused', !ok({ access_token: 'at', token_type: 'mac' }).ok && !ok({ access_token: 'at', token_type: 'DPoP' }).ok && !ok({ access_token: 'at' }).ok)
  check('D: no token is refused', !ok({ token_type: 'Bearer' }).ok && !ok({ access_token: '', token_type: 'Bearer' }).ok && !ok({ access_token: 5, token_type: 'Bearer' }).ok)
  check('D: a token with a space, a control character, or over 8,000 characters is refused', !ok({ access_token: 'a b', token_type: 'Bearer' }).ok && !ok({ access_token: 'a\u0001', token_type: 'Bearer' }).ok && !ok({ access_token: 'a'.repeat(8001), token_type: 'Bearer' }).ok && ok({ access_token: 'a'.repeat(8000), token_type: 'Bearer' }).ok)
  const life = (v) => ok({ access_token: 'at', token_type: 'Bearer', expires_in: v })
  check('D: no life given: an hour', life(undefined).tokens.expiresAt === now + 3_600_000)
  check('D: a life under a minute is a minute, over a year is a year', life(-5).tokens.expiresAt === now + 60_000 && life(0).tokens.expiresAt === now + 60_000 && life(1e12).tokens.expiresAt === now + 31_536_000_000)
  check('D: a life that is not a number is refused', !life('3600').ok && !life(null).ok && !life(NaN).ok && !life({}).ok)
  check('D: a renewal that brings no new renewal token keeps the old one', ok({ access_token: 'at', token_type: 'Bearer' }).tokens.refreshToken === 'OLD')
  check('D: a renewal token that is not usable is refused', !ok({ access_token: 'at', token_type: 'Bearer', refresh_token: 'a b' }).ok && !ok({ access_token: 'at', token_type: 'Bearer', refresh_token: 7 }).ok)
  check('D: permissions that are not permissions are dropped (null), not trusted', ok({ access_token: 'at', token_type: 'Bearer', scope: 'a"b' }).tokens.scopes === null)
  check('D: something that is not an object is refused', !ok('token').ok && !ok([]).ok && !ok(null).ok && !ok(undefined).ok)
  const err = ok({ error: 'invalid_grant', error_description: 'go to http://evil.example' }, 400)
  check('D: an error status is told in the app\'s words from its code, with the code', !err.ok && err.error === 'invalid_grant' && err.why === 'The provider no longer accepts this sign-in.' && !/evil/.test(err.why), show(err))
  check('D: a 200 with an error body is not a token', !ok({ error: 'invalid_grant' }).ok)
  check('D: a status other than 200 never yields a token, even with one in the body', !ok({ access_token: 'at', token_type: 'Bearer' }, 201).ok && !ok({ access_token: 'at', token_type: 'Bearer' }, 500).ok)
})

// ============ E. registering ============
await guard('E', async () => {
  await session('good', async (s) => {
    const ru = 'http://127.0.0.1:4444/callback'
    const r = await f.registerClient({ guarded: s.guarded, endpoint: s.found.registrationEndpoint, redirectUri: ru, scopes: ['read'] })
    check('E: the app is registered and gets a client id (no secret asked for)', r.ok && /^dcr-/.test(r.client.clientId) && r.client.clientSecret === null && r.client.method === 'none', show(r))
    const asked = JSON.parse(s.prov.log.find((l) => l.path === '/register').body)
    check('E: it said who it is, its one return address, the code flow with renewal, no secret, a native app, and the permissions', asked.client_name === 'Frontier App' && show(asked.redirect_uris) === `["${ru}"]` && show(asked.grant_types) === '["authorization_code","refresh_token"]' && show(asked.response_types) === '["code"]' && asked.token_endpoint_auth_method === 'none' && asked.application_type === 'native' && asked.scope === 'read', show(asked))
  })
  for (const [mode, re, what] of [
    ['reg-fail', /did not register/, 'a provider that fails'], ['reg-no-id', /client id/, 'an answer with no client id'], ['reg-other-redirect', /different return address/, 'a registration of another return address'],
    ['reg-bad-method', /does not know/, 'a way of proving itself the app does not know'], ['reg-no-secret', /without the secret/, 'a registration that asks for a secret and gives none'],
    ['reg-text', /did not register|not one/, 'an answer that is not JSON'], ['reg-redirect', /redirect|did not register/, 'an answer that redirects'], ['reg-huge', /more than the app accepts/, 'a huge answer']
  ]) {
    await session(mode, async (s) => {
      const r = await f.registerClient({ guarded: s.guarded, endpoint: s.found.registrationEndpoint, redirectUri: 'http://127.0.0.1:4444/callback', scopes: [] })
      check(`E: ${what} is refused, in words`, r.ok === false && re.test(r.why), show(r))
    })
  }
  await session('client-secret', async (s) => {
    const r = await f.registerClient({ guarded: s.guarded, endpoint: s.found.registrationEndpoint, redirectUri: 'http://127.0.0.1:4444/callback', scopes: [] })
    check('E: a provider that hands out a secret: it is kept with the way to send it', r.ok && r.client.clientSecret?.startsWith('sec-') && r.client.method === 'client_secret_basic', show(r))
  })
})

// ============ F. the listener ============
function request(port, { path = '/callback', method = 'GET', host } = {}) {
  return new Promise((resolve) => {
    const req = http.request({ host: '127.0.0.1', port, path, method, headers: host === undefined ? {} : { host }, agent: false }, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }))
    })
    req.on('error', (e) => resolve({ error: e.code ?? String(e) }))
    req.end()
  })
}
await guard('F', async () => {
  const L = await cb.listenForCallback({ state: 'S1', ms: 5000 })
  check('F: the return address is http://127.0.0.1:<port>/callback', L.redirectUri === `http://127.0.0.1:${L.port}/callback` && L.port > 0)
  const wrongHost = await request(L.port, { path: '/callback?state=S1&code=x', host: 'evil.test' })
  check('F: a request that names another host is answered 404 and is not the answer', wrongHost.status === 404, show(wrongHost.status))
  const wrongName = await request(L.port, { path: '/callback?state=S1&code=x', host: `localhost:${L.port}` })
  check('F: ...even the name "localhost" (only the exact address it was opened with)', wrongName.status === 404)
  check('F: another path is 404', (await request(L.port, { path: '/other?state=S1&code=x' })).status === 404 && (await request(L.port, { path: '/callback/x?state=S1&code=x' })).status === 404)
  check('F: another method is 404', (await request(L.port, { path: '/callback?state=S1&code=x', method: 'POST' })).status === 404 && (await request(L.port, { path: '/callback?state=S1&code=x', method: 'PUT' })).status === 404)
  check('F: no state, or another state, is 404 (not the answer waited for)', (await request(L.port, { path: '/callback?code=x' })).status === 404 && (await request(L.port, { path: '/callback?state=S2&code=x' })).status === 404 && (await request(L.port, { path: '/callback?state=S1&state=S1&code=x' })).status === 404)
  const still = await Promise.race([L.done.then(() => 'ended'), new Promise((r) => setTimeout(() => r('waiting'), 200))])
  check('F: ...and the listener goes on waiting after all of them', still === 'waiting')
  const right = await request(L.port, { path: '/callback?state=S1&code=THE-CODE&iss=https%3A%2F%2Fa.example&error_description=%3Cscript%3Ealert(1)%3C%2Fscript%3E' })
  const end = await L.done
  check('F: the right request is the answer: its parameters come back as text, each once', end.ok === true && end.params.code === 'THE-CODE' && end.params.state === 'S1' && end.params.iss === 'https://a.example', show(end))
  check('F: the page it shows holds no word of the request', right.status === 200 && !/THE-CODE|script|alert|a\.example/.test(right.body) && /close this window/.test(right.body))
  check('F: ...is never kept, sends no referrer, allows nothing, is not sniffed', right.headers['cache-control'] === 'no-store' && right.headers['referrer-policy'] === 'no-referrer' && right.headers['content-security-policy'] === "default-src 'none'" && right.headers['x-content-type-options'] === 'nosniff', show(right.headers))
  await new Promise((r) => setTimeout(r, 100))
  const second = await request(L.port, { path: '/callback?state=S1&code=SECOND' })
  check('F: a second request after the answer finds no listener (it closed)', second.error !== undefined, show(second))
})
await guard('F2', async () => {
  const dup = await cb.listenForCallback({ state: 'S1', ms: 5000 })
  await request(dup.port, { path: '/callback?state=S1&code=a&code=b' })
  const e1 = await dup.done
  check('F: a parameter that comes twice makes the answer unusable (and the listener closes)', e1.ok === false && e1.why === 'malformed', show(e1))
  const big = await cb.listenForCallback({ state: 'S1', ms: 5000 })
  await request(big.port, { path: `/callback?state=S1&code=${'c'.repeat(2001)}` })
  const e2 = await big.done
  check('F: a parameter over 2,000 characters makes it unusable', e2.ok === false && e2.why === 'malformed')
  const long = await cb.listenForCallback({ state: 'S1', ms: 5000 })
  const huge = await request(long.port, { path: `/callback?state=S1&code=${'c'.repeat(20000)}` })
  check('F: a request line over the header limit is refused by the server itself (and is not the answer)', huge.status === 431 || huge.error !== undefined || huge.status === 414, show(huge.status ?? huge.error))
  long.cancel()
  const t = await cb.listenForCallback({ state: 'S1', ms: 250 })
  check('F: nobody comes: it ends by the clock', (await t.done).why === 'timeout')
  const c = await cb.listenForCallback({ state: 'S1', ms: 5000 })
  c.cancel()
  check('F: Cancel ends it at once', (await c.done).why === 'cancelled')
  const stop = new AbortController()
  const s = await cb.listenForCallback({ state: 'S1', ms: 5000, signal: stop.signal })
  stop.abort()
  check('F: the person\'s Stop ends it', (await s.done).why === 'stopped')
  const pre = new AbortController()
  pre.abort()
  const p = await cb.listenForCallback({ state: 'S1', ms: 5000, signal: pre.signal })
  check('F: a Stop given before it starts ends it', (await p.done).why === 'stopped')
  await new Promise((r) => setTimeout(r, 100))
  check('F: after each of these ends, the port is closed', (await request(t.port)).error !== undefined && (await request(c.port)).error !== undefined && (await request(s.port)).error !== undefined)
  const noisy = await cb.listenForCallback({ state: 'S1', ms: 5000 })
  for (let i = 0; i < 21; i++) await request(noisy.port, { path: '/favicon.ico' })
  check('F: twenty-one requests that are not the answer end it ("too much noise")', (await noisy.done).why === 'noise')
  const quiet = await cb.listenForCallback({ state: 'S1', ms: 5000 })
  const refused = await new Promise((resolve) => {
    // the same port on the machine's other addresses: nothing listens there
    const others = Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address)
    if (others.length === 0) return resolve('no other address on this PC to try')
    const socket = net.connect({ host: others[0], port: quiet.port })
    socket.on('connect', () => { socket.destroy(); resolve('CONNECTED') })
    socket.on('error', (e) => resolve(e.code))
  })
  check('F: it listens on 127.0.0.1 only: the same port on the PC\'s other address is refused', refused === 'ECONNREFUSED' || refused === 'no other address on this PC to try' || refused === 'ETIMEDOUT', refused)
  const v6 = await new Promise((resolve) => {
    const socket = net.connect({ host: '::1', port: quiet.port })
    socket.on('connect', () => { socket.destroy(); resolve('CONNECTED') })
    socket.on('error', (e) => resolve(e.code))
  })
  check('F: ...and on the IPv6 loopback too: nothing is there', v6 !== 'CONNECTED', v6)
  quiet.cancel()
  const a = await cb.listenForCallback({ state: 'S1', ms: 5000 })
  const b = await cb.listenForCallback({ state: 'S1', ms: 5000 })
  check('F: two sign-ins get two different ports', a.port !== b.port)
  a.cancel()
  b.cancel()
})

// ============ G. the whole sign-in ============
await guard('G', async () => {
  await session('good', async (s) => {
    const seen = []
    const r = await signIn(s, { open: browser(seen) })
    check('G: the sign-in comes to the end with tokens', r.ok === true && r.auth.tokens.accessToken.startsWith('at-') && r.auth.tokens.refreshToken.startsWith('rt-'), show(r))
    check('G: ...which the provider (and the connector) accept', s.prov.isValid(r.auth.tokens.accessToken) && (await fetch(s.prov.mcp, { method: 'POST', headers: { authorization: `Bearer ${r.auth.tokens.accessToken}` }, body: '{}' })).status === 200)
    check('G: ...with what is kept: the identity, the token address, the revocation address, the resource, the client, the permissions', r.auth.issuer === s.prov.issuer && r.auth.tokenEndpoint.endsWith('/token') && r.auth.revocationEndpoint.endsWith('/revoke') && r.auth.resource === s.prov.mcp && /^dcr-/.test(r.auth.client.clientId) && show(r.auth.scopes) === '["read","write"]', show(r.auth))
    const authorize = s.prov.log.find((l) => l.path === '/authorize')
    const q = new URLSearchParams(authorize.search)
    check('G: the browser was sent with the code flow, the registered client, a return address on 127.0.0.1, S256, a state, the resource and the permissions', q.get('response_type') === 'code' && q.get('client_id') === r.auth.client.clientId && /^http:\/\/127\.0\.0\.1:\d+\/callback$/.test(q.get('redirect_uri')) && q.get('code_challenge_method') === 'S256' && q.get('code_challenge').length === 43 && q.get('state').length === 43 && q.get('resource') === s.prov.mcp && q.get('scope') === 'read write', authorize.search)
    const tokenCall = s.prov.log.find((l) => l.path === '/token')
    const form = new URLSearchParams(tokenCall.body)
    check('G: the token request carried the code, the verifier whose challenge was sent, the same return address, and the resource', form.get('grant_type') === 'authorization_code' && f.challengeOf(form.get('code_verifier')) === q.get('code_challenge') && form.get('redirect_uri') === q.get('redirect_uri') && form.get('resource') === s.prov.mcp && form.get('client_id') === r.auth.client.clientId, tokenCall.body)
    check('G: the verifier was never in the browser\'s address, the token never in any address', !authorize.search.includes(form.get('code_verifier')) && s.prov.log.every((l) => !l.search.includes(r.auth.tokens.accessToken)))
    check('G: the registration was made first, with this sign-in\'s return address', s.prov.log.findIndex((l) => l.path === '/register') < s.prov.log.findIndex((l) => l.path === '/authorize') && JSON.parse(s.prov.log.find((l) => l.path === '/register').body).redirect_uris[0] === q.get('redirect_uri'))
    const port = Number(new URL(q.get('redirect_uri')).port)
    check('G: the listener is closed when it is over', (await request(port)).error !== undefined)
    // a second sign-in registers again (the return address has a new port)
    const again = await signIn(s)
    check('G: a second sign-in registers the app again (a new port, a new client)', again.ok && again.auth.client.clientId !== r.auth.client.clientId && s.prov.log.filter((l) => l.path === '/register').length === 2)
    // the code is good once
    const q2 = new URLSearchParams(s.prov.log.filter((l) => l.path === '/authorize').at(-1).search)
    const reuse = await f.exchangeCode({ guarded: s.guarded, tokenEndpoint: s.found.tokenEndpoint, client: again.auth.client, code: new URLSearchParams(s.prov.log.filter((l) => l.path === '/token').at(-1).body).get('code'), verifier: f.newVerifier(), redirectUri: q2.get('redirect_uri'), resource: s.prov.mcp, now: Date.now() })
    check('G: a code used again (or with another verifier) buys nothing', reuse.ok === false && reuse.error === 'invalid_grant', show(reuse))
  })
  await session('good', async (s) => {
    const r = await signIn(s, { client: { kind: 'typed', clientId: 'typed-client', clientSecret: null } })
    check('G: a client id the person typed works, with no registration', r.ok === true && r.auth.client.clientId === 'typed-client' && r.auth.client.method === 'none' && !s.prov.log.some((l) => l.path === '/register'), show(r))
    const secret = await signIn(s, { client: { kind: 'typed', clientId: 'typed-secret-client', clientSecret: 'typed-secret-value' }, found: { ...s.found, tokenAuthMethods: ['client_secret_basic'] } })
    check('G: a typed client with a secret sends it in the Authorization header (basic), and not in the body', secret.ok === true && secret.auth.client.method === 'client_secret_basic' && s.prov.log.filter((l) => l.path === '/token').at(-1).headers.authorization?.startsWith('Basic ') && !s.prov.log.filter((l) => l.path === '/token').at(-1).body.includes('typed-secret-value'), show(secret))
    const post = await signIn(s, { client: { kind: 'typed', clientId: 'typed-secret-client', clientSecret: 'typed-secret-value' } })
    check('G: ...or in the body when the provider lists only that way', post.ok === true && post.auth.client.method === 'client_secret_post' && s.prov.log.filter((l) => l.path === '/token').at(-1).body.includes('client_secret=typed-secret-value'), show(post))
    const wrong = await signIn(s, { client: { kind: 'typed', clientId: 'typed-secret-client', clientSecret: 'not-the-secret' } })
    check('G: a wrong secret fails with the provider\'s refusal in the app\'s words', wrong.ok === false && /does not know this app/.test(wrong.why), show(wrong))
    const unknown = await signIn(s, { client: { kind: 'typed', clientId: 'nobody', clientSecret: null } })
    check('G: an unknown client id fails (the provider\'s page refuses it; the browser never comes back, so the wait ends)', unknown.ok === false, show(unknown.why))
  })
  await session('client-secret', async (s) => {
    const r = await signIn(s)
    check('G: a registration that hands out a secret: the secret is used at the token address', r.ok === true && r.auth.client.clientSecret?.startsWith('sec-') && r.auth.client.method === 'client_secret_basic', show(r))
  })
  await session('no-registration', async (s) => {
    const r = await signIn(s)
    check('G: no registration and no typed client: it says so in words and opens no browser', r.ok === false && /Register the app there and type the client id/.test(r.why) && !s.prov.log.some((l) => l.path === '/authorize'), show(r))
  })
  // hostile flow modes
  for (const [mode, re, what] of [
    ['iss-wrong', /different provider/, 'an answer from another provider (iss)'], ['iss-missing', /did not say which provider/, 'an answer with no iss, though the provider promised one'],
    ['iss-slash', /different provider/, 'an iss that differs only by a slash'], ['state-wrong', /did not belong/, 'an answer with another state'], ['state-missing', /did not belong/, 'an answer with no state'],
    ['code-dup', /could not be read/, 'an answer with the code twice'], ['code-huge', /could not be read/, 'an answer with a huge code'],
    ['authorize-error', /did not allow/, 'a refusal by the provider\'s page'], ['authorize-error-badiss', /different provider/, 'a refusal that comes from another provider']
  ]) {
    await session(mode, async (s) => {
      const r = await signIn(s, { waitMs: mode.startsWith('state') ? 700 : 5000 })
      const isState = mode.startsWith('state')
      check(`G: ${what}: the sign-in fails, in words${isState ? ' (the answer is not waited for: the clock ends it)' : ''}`, r.ok === false && (isState ? /not finished in time/.test(r.why) : re.test(r.why)), show(r))
      check(`G: ...and no token was asked for (nothing was sent to the token address)`, !s.prov.log.some((l) => l.path === '/token'), show(s.prov.log.map((l) => l.path)))
      check(`G: ...and nothing the provider wrote is in the sentence`, !/script|evil|alert/.test(r.why))
    })
  }
  await session('no-iss', async (s) => {
    const r = await signIn(s)
    check('G: a provider that never promised an iss and sends none: accepted', r.ok === true)
  })
  for (const [mode, re, what] of [
    ['tok-no-access', /no usable token/, 'no token in the answer'], ['tok-type-mac', /kind of token/, 'another kind of token'], ['tok-expires-text', /life the app cannot read/, 'a life that is text'],
    ['tok-huge-token', /no usable token/, 'a token of 9,000 characters'], ['tok-text', /not a token|refused/, 'an answer that is not JSON'], ['tok-redirect', /redirect/, 'a token address that redirects'],
    ['tok-bad-refresh', /renewal token/, 'a renewal token with a space'], ['tok-fail-code', /no longer accepts/, 'a refusal with a hostile description']
  ]) {
    await session(mode, async (s) => {
      const r = await signIn(s)
      check(`G: ${what}: the sign-in fails, in words`, r.ok === false && re.test(r.why) && !/evil|<b>/.test(r.why), show(r))
    })
  }
  for (const [mode, life] of [['tok-expires-neg', 60_000], ['tok-expires-huge', 31_536_000_000], ['tok-expires-none', 3_600_000]]) {
    await session(mode, async (s) => {
      const t0 = Date.now()
      const r = await signIn(s)
      check(`G: ${mode}: the life is made sane (${life / 1000} s)`, r.ok && Math.abs(r.auth.tokens.expiresAt - t0 - life) < 5000, show(r.auth?.tokens))
    })
  }
  await session('tok-scope-narrow', async (s) => {
    const r = await signIn(s)
    check('G: the permissions the provider says it granted are the ones kept', r.ok && show(r.auth.scopes) === '["read"]', show(r.auth?.scopes))
  })
  await session('tok-slow', async (s) => {
    const t0 = Date.now()
    const r = await signIn(s, { found: s.found })
    check('G: a token address that never answers is cut by the clock (10 s)', r.ok === false && /did not answer in time/.test(r.why) && Date.now() - t0 < 20_000, show(r))
  })
  // ends of the wait
  await session('good', async (s) => {
    const r = await signIn(s, { open: async () => true, waitMs: 300 })
    check('G: the browser never comes back: the wait ends by the clock, in words', r.ok === false && /not finished in time/.test(r.why), show(r))
    const closed = await signIn(s, { open: async () => false })
    check('G: a browser that was not opened ends it at once', closed.ok === false && /not opened/.test(closed.why))
    const stop = new AbortController()
    const p = signIn(s, { open: async () => { setTimeout(() => stop.abort(), 100); return true }, signal: stop.signal })
    const stopped = await p
    check('G: the person\'s Stop ends it, marked as a stop', stopped.ok === false && stopped.stopped === true, show(stopped))
    const noToken = s.prov.log.filter((l) => l.path === '/token').length
    check('G: ...with no token asked for', noToken === 0, `${noToken}`)
  })
  // renewing and revoking
  await session('good', async (s) => {
    const r = await signIn(s)
    const renew = await f.refreshTokens({ guarded: s.guarded, tokenEndpoint: r.auth.tokenEndpoint, client: r.auth.client, refreshToken: r.auth.tokens.refreshToken, resource: r.auth.resource, now: Date.now() })
    check('G: a renewal brings a new access token and a new renewal token (the old one stops working)', renew.ok && renew.tokens.accessToken !== r.auth.tokens.accessToken && renew.tokens.refreshToken !== r.auth.tokens.refreshToken && s.prov.refreshValid(renew.tokens.refreshToken) && !s.prov.refreshValid(r.auth.tokens.refreshToken), show(renew))
    const form = new URLSearchParams(s.prov.log.filter((l) => l.path === '/token').at(-1).body)
    check('G: ...asked with the renewal token, the resource and the client', form.get('grant_type') === 'refresh_token' && form.get('resource') === r.auth.resource && form.get('client_id') === r.auth.client.clientId)
    const replay = await f.refreshTokens({ guarded: s.guarded, tokenEndpoint: r.auth.tokenEndpoint, client: r.auth.client, refreshToken: r.auth.tokens.refreshToken, resource: r.auth.resource, now: Date.now() })
    check('G: the old renewal token used again is refused (the provider rotates)', replay.ok === false && replay.error === 'invalid_grant', show(replay))
    const gone = await f.revokeToken({ guarded: s.guarded, revocationEndpoint: r.auth.revocationEndpoint, client: r.auth.client, token: renew.tokens.refreshToken, hint: 'refresh_token' })
    check('G: revoking works, and the token no longer does', gone === true && !s.prov.refreshValid(renew.tokens.refreshToken))
  })
  await session('tok-no-rotate', async (s) => {
    const r = await signIn(s)
    const renew = await f.refreshTokens({ guarded: s.guarded, tokenEndpoint: r.auth.tokenEndpoint, client: r.auth.client, refreshToken: r.auth.tokens.refreshToken, resource: r.auth.resource, now: Date.now() })
    check('G: a provider that keeps the renewal token the same: it is kept', renew.ok && renew.tokens.refreshToken === renew.tokens.refreshToken && s.prov.refreshValid(renew.tokens.refreshToken))
  })
  await session('tok-invalid-grant', async (s) => {
    const r = await signIn(s)
    const renew = await f.refreshTokens({ guarded: s.guarded, tokenEndpoint: r.auth.tokenEndpoint, client: r.auth.client, refreshToken: r.auth.tokens.refreshToken, resource: r.auth.resource, now: Date.now() })
    check('G: a renewal the provider refuses says so with the code (the caller turns the connector to "sign-in needed")', renew.ok === false && renew.error === 'invalid_grant', show(renew))
  })
  await session('revoke-fail', async (s) => {
    const r = await signIn(s)
    const gone = await f.revokeToken({ guarded: s.guarded, revocationEndpoint: r.auth.revocationEndpoint, client: r.auth.client, token: r.auth.tokens.refreshToken, hint: 'refresh_token' })
    check('G: a provider that fails to revoke: false, not a crash', gone === false)
  })
  await session('revoke-slow', async (s) => {
    const r = await signIn(s)
    const t0 = Date.now()
    const gone = await f.revokeToken({ guarded: s.guarded, revocationEndpoint: r.auth.revocationEndpoint, client: r.auth.client, token: r.auth.tokens.refreshToken, hint: 'refresh_token' })
    check('G: a provider that never answers a revocation is cut at 5 seconds', gone === false && Date.now() - t0 < 8000 && Date.now() - t0 >= 4500, `${Date.now() - t0}`)
  })
})

// ============ H. the source ============
await guard('H', async () => {
  const flow = source('src/main/oauthFlow.ts').replace(/\/\/[^\n]*/g, '')
  const call = source('src/main/oauthCallback.ts').replace(/\/\/[^\n]*/g, '')
  check('H: neither imports Electron', !/from 'electron'/.test(flow) && !/from 'electron'/.test(call))
  check('H: the method is S256 and never plain', /'S256'/.test(flow) && !/'plain'/.test(flow))
  check('H: the resource is in the authorization address AND in both token requests', /searchParams\.set\('resource'/.test(flow) && (flow.match(/resource: input\.resource/g) ?? []).length === 2)
  check('H: the verifier goes only into the token request', (flow.match(/code_verifier/g) ?? []).length === 1)
  check('H: the answer is judged state, then issuer, then error', flow.indexOf('same(params.state') < flow.indexOf('params.iss') && flow.indexOf('params.iss') < flow.indexOf('params.error'))
  check('H: the issuer is compared as written', /iss !== expected\.issuer/.test(flow))
  check('H: the state is compared in constant time', /timingSafeEqual/.test(flow))
  check('H: the listener binds 127.0.0.1 only', /listen\(0, '127\.0\.0\.1'/.test(call) && !/localhost|0\.0\.0\.0|'::'/.test(call))
  check('H: the listener answers one exact path and the exact Host', /PATH = '\/callback'/.test(call) && /req\.headers\.host !== hostHeader/.test(call))
  check('H: nothing of the request is put in the page', !/\$\{[^}]*(params|url|req)/.test(call.slice(call.indexOf('PAGE_OK'), call.indexOf('PAGE_OK') + 400)))
  check('H: no request of the flow bypasses the guard (no fetch of its own)', !/\bfetch\(/.test(flow))
})

const ok = check.summary()
process.exit(ok ? 0 : 1)
