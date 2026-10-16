// Slice 14b.2 (D-046) under plain Node: FINDING THE SIGN-IN PROVIDER (src/main/oauthDiscovery.ts), against a reference provider on this PC's loopback that misbehaves in about
// forty ways (tools/fixtures14/oauth-server.mjs). What it shows:
//   A. the challenge of a 401 read as the specification says (and nothing of it trusted);
//   B. the canonical form of the connector's address, and the well-known addresses in the specification's order;
//   C. the whole discovery against the provider: the good case (what was asked, in what order, what comes out), the connector's document (wrong resource, no provider, bad
//      permissions, huge, silent, redirecting, not JSON), the provider's document (a wrong identity, no S256, endpoints the app will not use, the three addresses in order),
//      the permissions chosen, the limit on requests, and that nothing inside a network is ever asked;
//   D. what the source must keep true.
//
// Run: node tools/guarded.mjs tools/verify-14b-2.mjs      (ONLY=A,C runs some parts; it makes no folder and removes nothing)
import './ts-resolve.mjs'
import { checker } from './cdp.mjs'
import fs from 'node:fs'
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
const d = await import(`${SRC}/main/oauthDiscovery.ts`)
const g = await import(`${SRC}/main/oauthHttp.ts`)
const { OAUTH_LIMITS } = await import(`${SRC}/shared/oauth.ts`)
const source = (rel) => fs.readFileSync(join(REPO, rel), 'utf8')

// ============ A. the challenge ============
await guard('A', async () => {
  const p = d.parseChallenge
  const good = p('Bearer resource_metadata="https://mcp.example.com/.well-known/oauth-protected-resource", scope="files:read"')
  check('A: the usual challenge: the address of the connector\'s document and the permissions', good.bearer && good.resourceMetadata === 'https://mcp.example.com/.well-known/oauth-protected-resource' && show(good.scope) === '["files:read"]' && !good.scopeBad, show(good))
  check('A: no header is no challenge', !p(null).bearer && !p('').bearer)
  check('A: another scheme is no challenge', !p('Basic realm="x"').bearer && !p('Digest realm="x", nonce="y"').bearer)
  check('A: Bearer in any case', p('bearer resource_metadata="https://a.example/m"').resourceMetadata === 'https://a.example/m' && p('BEARER resource_metadata="https://a.example/m"').bearer)
  const two = p('Basic realm="x", Bearer resource_metadata="https://a.example/m", scope="a b"')
  check('A: several challenges: the Bearer one is read', two.bearer && two.resourceMetadata === 'https://a.example/m' && show(two.scope) === '["a","b"]', show(two))
  check('A: parameters in any order, with white space', p('Bearer   scope="a",resource_metadata = "https://a.example/m" ,error="invalid_token"').resourceMetadata === 'https://a.example/m')
  check('A: bare (unquoted) values', p('Bearer resource_metadata=https://a.example/m, scope=read').resourceMetadata === 'https://a.example/m')
  check('A: the error of the challenge, cleaned and cut', p('Bearer error="insufficient_scope", scope="x"').error === 'insufficient_scope' && p('Bearer error="' + 'e'.repeat(300) + '"').error.length <= 40)
  check('A: an escaped quote inside a value does not end it', p('Bearer error="a\\"b", resource_metadata="https://a.example/m"').resourceMetadata === 'https://a.example/m')
  check('A: a comma inside a quoted value is part of it', p('Bearer error="a, b", resource_metadata="https://a.example/m"').resourceMetadata === 'https://a.example/m')
  check('A: a Bearer challenge with no parameters is a challenge with nothing in it', (() => { const c = p('Bearer'); return c.bearer && c.resourceMetadata === null && c.scope === null })())
  check('A: permissions are listed once each, in order', show(p('Bearer scope="b a b a"').scope) === '["b","a"]')
  check('A: several spaces between permissions are one', show(p('Bearer scope="a    b"').scope) === '["a","b"]')
  check('A: an empty scope names none', p('Bearer scope=""').scope === null && !p('Bearer scope=""').scopeBad)
  for (const [what, header] of [
    ['a quote', 'Bearer scope="a\\"b"'], ['a backslash', 'Bearer scope="a\\\\b"'], ['a control character', 'Bearer scope="a\u0001b"'], ['a very long one', `Bearer scope="${'s'.repeat(101)}"`],
    ['too many', `Bearer scope="${Array.from({ length: 21 }, (_, i) => `s${i}`).join(' ')}"`]
  ]) {
    check(`A: a permission with ${what} makes the challenge's permissions bad (the sign-in is refused)`, p(header).scopeBad === true, show(p(header)))
  }
  check('A: exactly the most permissions is fine', !p(`Bearer scope="${Array.from({ length: 20 }, (_, i) => `s${i}`).join(' ')}"`).scopeBad)
  const t0 = Date.now()
  const huge = p('Bearer ' + 'a="b", '.repeat(20000) + 'resource_metadata="https://a.example/m"')
  check('A: a huge header is cut and read quickly, and what is past the cut is not read', Date.now() - t0 < 1000 && huge.resourceMetadata === null)
  check('A: garbage is nothing, not a crash', ['"""', '=====', ',,,,', 'Bearer ="x"', 'Bearer scope', 'Bearer scope=', '\u0000'].every((h) => { try { p(h); return true } catch { return false } }))
  check('A: a hundred challenges are read as ten at most', (() => { try { p('Bearer a="1", '.repeat(100)); return true } catch { return false } })())
})

// ============ B. addresses ============
await guard('B', async () => {
  check('B: the root path is written without its slash', d.canonicalResource('https://mcp.example.com/') === 'https://mcp.example.com' && d.canonicalResource('https://MCP.example.com') === 'https://mcp.example.com')
  check('B: a path is kept as it is', d.canonicalResource('https://mcp.example.com/mcp') === 'https://mcp.example.com/mcp' && d.canonicalResource('https://mcp.example.com/a/b') === 'https://mcp.example.com/a/b')
  check('B: a port is kept, a fragment is dropped', d.canonicalResource('https://mcp.example.com:8443/mcp#x') === 'https://mcp.example.com:8443/mcp')
  check('B: a query is kept', d.canonicalResource('https://mcp.example.com/mcp?tenant=a') === 'https://mcp.example.com/mcp?tenant=a')
  check('B: the same resource, a trailing slash aside', d.sameResource('https://mcp.example.com/mcp/', 'https://mcp.example.com/mcp') && d.sameResource('https://mcp.example.com', 'https://mcp.example.com/') && d.sameResource('HTTPS://MCP.example.com/mcp', 'https://mcp.example.com/mcp'))
  check('B: not the same resource: another host, path, port, scheme, query', ![
    ['https://mcp.example.com/mcp', 'https://other.example.com/mcp'], ['https://mcp.example.com/mcp', 'https://mcp.example.com/other'], ['https://mcp.example.com/mcp', 'https://mcp.example.com:444/mcp'],
    ['https://mcp.example.com/mcp', 'http://mcp.example.com/mcp'], ['https://mcp.example.com/mcp', 'https://mcp.example.com/mcp?x=1'], ['https://mcp.example.com/mcp', 'https://mcp.example.com.evil.net/mcp'],
    ['https://mcp.example.com/mcp', 'not a url']
  ].some(([a, b]) => d.sameResource(a, b)))
  check('B: the connector\'s document is looked for with the path inserted, then at the root', show(d.resourceMetadataCandidates('https://example.com/public/mcp')) === '["https://example.com/.well-known/oauth-protected-resource/public/mcp","https://example.com/.well-known/oauth-protected-resource"]')
  check('B: ...and only at the root for a connector at the root', show(d.resourceMetadataCandidates('https://example.com/')) === '["https://example.com/.well-known/oauth-protected-resource"]' && show(d.resourceMetadataCandidates('https://example.com')) === '["https://example.com/.well-known/oauth-protected-resource"]')
  check('B: a provider without a path: the OAuth address, then the OpenID one', show(d.providerMetadataCandidates('https://auth.example.com')) === '["https://auth.example.com/.well-known/oauth-authorization-server","https://auth.example.com/.well-known/openid-configuration"]')
  check('B: a provider with a path: OAuth inserted, OpenID inserted, OpenID appended (the specification\'s order)', show(d.providerMetadataCandidates('https://auth.example.com/tenant1')) === '["https://auth.example.com/.well-known/oauth-authorization-server/tenant1","https://auth.example.com/.well-known/openid-configuration/tenant1","https://auth.example.com/tenant1/.well-known/openid-configuration"]')
  check('B: a trailing slash of the provider\'s path is removed first, a port is kept', show(d.providerMetadataCandidates('https://auth.example.com:8443/t/')) === '["https://auth.example.com:8443/.well-known/oauth-authorization-server/t","https://auth.example.com:8443/.well-known/openid-configuration/t","https://auth.example.com:8443/t/.well-known/openid-configuration"]')
})

// ============ C. the discovery ============
/** The provider in a mode, and the discovery run as the sign-in would run it: the real 401 first, its challenge read, then everything else. */
async function attempt(mode, extra = {}) {
  const prov = await startProvider({ mode })
  try {
    const guarded = g.createGuardedFetch({ anchor: prov.mcp })
    const unauthenticated = await fetch(prov.mcp, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}', redirect: 'manual' })
    const challenge = d.parseChallenge(unauthenticated.headers.get('www-authenticate'))
    prov.log.length = 0
    const result = await d.discover({ mcpUrl: prov.mcp, challenge, guarded, ...extra })
    return { prov, result, log: prov.log.map((l) => l.path), challenge }
  } finally {
    await prov.close()
  }
}

await guard('C', async () => {
  const ok = await attempt('good')
  const f = ok.result.found
  check('C: the good case is found', ok.result.ok === true, show(ok.result))
  check('C: ...with the identity, the sign-in page, the token and registration and revocation addresses', f.issuer.startsWith('http://127.0.0.1:') && f.authorizationEndpoint.endsWith('/authorize') && f.tokenEndpoint.endsWith('/token') && f.registrationEndpoint.endsWith('/register') && f.revocationEndpoint.endsWith('/revoke'), show(f))
  check('C: ...the resource in the canonical form, and the provider\'s promise of an iss', f.resource === ok.prov.mcp && f.issResponse === true && f.clientIdDocuments === false)
  check('C: ...the permissions the connector\'s document lists (the challenge named none)', show(f.scopes) === '["read","write"]' && f.offlineAccess === false, show(f.scopes))
  check('C: ...asked in the specification\'s order: the connector\'s document where the challenge said, then the provider\'s', show(ok.log) === '["/.well-known/oauth-protected-resource/mcp","/.well-known/oauth-authorization-server"]', show(ok.log))
  check('C: ...the token methods default to client_secret_basic only when the provider lists none; here its list', show(f.tokenAuthMethods) === '["none","client_secret_post"]')

  const noChallenge = await attempt('no-challenge')
  check('C: with no challenge at all, the well-known addresses are tried: the sub-path first', noChallenge.result.ok === true && noChallenge.log[0] === '/.well-known/oauth-protected-resource/mcp', show(noChallenge.log))
  const rootOnly = await attempt('no-challenge,root-only')
  check('C: ...and the root one when the sub-path is not there', rootOnly.result.ok === true && show(rootOnly.log.slice(0, 2)) === '["/.well-known/oauth-protected-resource/mcp","/.well-known/oauth-protected-resource"]', show(rootOnly.log))
  const noMeta = await attempt('challenge-nometa')
  check('C: a challenge without an address is the same as none', noMeta.result.ok === true && noMeta.log[0] === '/.well-known/oauth-protected-resource/mcp')
  const elsewhere = await attempt('meta-elsewhere')
  check('C: the address the challenge names is used as it is', elsewhere.result.ok === true && elsewhere.log[0] === '/prm-elsewhere', show(elsewhere.log))
  const elsewhereBad = await attempt('meta-elsewhere,prm-text')
  check('C: ...and when it fails there is no fall-back to the well-known ones (the specification: use the address from the header when present)', elsewhereBad.result.ok === false && elsewhereBad.log.length === 1, show(elsewhereBad.log))

  const scope = await attempt('challenge-scope')
  check('C: the permissions of the challenge win over the document\'s list', show(scope.result.found.scopes) === '["read","write"]' && show(scope.challenge.scope) === '["read","write"]')
  const noScopes = await attempt('no-scopes')
  check('C: with no list and no challenge scope, none are asked', noScopes.result.ok === true && noScopes.result.found.scopes.length === 0)
  const offline = await attempt('offline')
  check('C: offline_access is added only because the provider lists it, and the result says so', show(offline.result.found.scopes) === '["read","write","offline_access"]' && offline.result.found.offlineAccess === true)
  const offlineOwn = await attempt('offline,challenge-scope')
  check('C: ...also after the challenge\'s permissions', offlineOwn.result.found.offlineAccess === true && offlineOwn.result.found.scopes.at(-1) === 'offline_access')
  const badScope = await attempt('challenge-bad-scope')
  check('C: a challenge whose permissions are not permissions stops the sign-in before any request', badScope.result.ok === false && badScope.log.length === 0, show(badScope.result))
  const many = await attempt('scopes-many')
  check('C: a document that lists more permissions than the app asks for stops the sign-in', many.result.ok === false && /more than 20/.test(many.result.why), show(many.result))
  const manyButChallenge = await attempt('scopes-many,challenge-scope')
  check('C: ...unless the challenge names the few that are needed', manyButChallenge.result.ok === true && show(manyButChallenge.result.found.scopes) === '["read","write"]')
  const scopesBad = await attempt('scopes-bad')
  check('C: a list with a permission that is not one stops the sign-in', scopesBad.result.ok === false)

  const slash = await attempt('resource-slash')
  check('C: a resource written with a trailing slash is the same resource', slash.result.ok === true)
  const wrong = await attempt('wrong-resource')
  check('C: a connector document about another address is refused', wrong.result.ok === false && /different address/.test(wrong.result.why) && wrong.log.length === 1, show(wrong))
  for (const [mode, re, what] of [
    ['no-as', /names no sign-in provider/, 'no provider (an empty list)'], ['no-as-field', /names no sign-in provider/, 'no provider (no list)'],
    ['as-nonhttps', /not an address the app uses/, 'a provider at a plain http address'], ['as-private', /inside a network/, 'a provider at an address inside a network'],
    ['prm-text', /no document about its sign-in/, 'a document that is not JSON'], ['prm-redirect', /redirect/, 'a document that redirects'], ['prm-huge', /more than the app accepts/, 'a huge document']
  ]) {
    const r = await attempt(mode)
    check(`C: ${what} is refused, in words`, r.result.ok === false && re.test(r.result.why), show(r.result))
  }
  const silent = await attempt('prm-slow', { signal: AbortSignal.timeout(500) })
  check('C: a connector that never answers is cut (here by the caller\'s clock)', silent.result.ok === false, show(silent.result))
  const privateTraffic = await attempt('as-private')
  check('C: nothing inside a network is asked for a provider named at a private address', privateTraffic.log.length === 1, show(privateTraffic.log))

  // the provider
  const mismatch = await attempt('issuer-mismatch')
  check('C: a provider document whose identity is not the address it was found at is refused', mismatch.result.ok === false && /another identity/.test(mismatch.result.why), show(mismatch.result))
  for (const mode of ['no-s256', 'no-pkce-field']) {
    const r = await attempt(mode)
    check(`C: a provider without S256 (${mode}) is refused, in words`, r.result.ok === false && /S256/.test(r.result.why), show(r.result))
  }
  const noCode = await attempt('no-code')
  check('C: a provider that offers no authorization-code flow is refused', noCode.result.ok === false)
  const noReg = await attempt('no-registration')
  check('C: no registration address is allowed (a client id can be typed)', noReg.result.ok === true && noReg.result.found.registrationEndpoint === null)
  const noIss = await attempt('no-iss')
  check('C: a provider that does not promise an iss is allowed, and the result says so', noIss.result.ok === true && noIss.result.found.issResponse === false)
  for (const [mode, what] of [['endpoint-file', 'a file: sign-in page'], ['endpoint-http', 'a plain-http sign-in page'], ['endpoint-private', 'a token address inside a network'], ['endpoint-userinfo', 'a token address with a name and a password in it']]) {
    const r = await attempt(mode)
    check(`C: ${what} is refused`, r.result.ok === false && /not an address the app uses|inside a network/.test(r.result.why), show(r.result))
  }
  const path = await attempt('path-issuer')
  check('C: a provider with a path in its identity: the OAuth address with the path inserted answers first', path.result.ok === true && path.log[1] === '/.well-known/oauth-authorization-server/tenant1' && path.result.found.issuer.endsWith('/tenant1'), show(path.log))
  const oidc = await attempt('oidc-only')
  check('C: a provider that only has the OpenID document: the second address answers', oidc.result.ok === true && show(oidc.log.slice(1)) === '["/.well-known/oauth-authorization-server","/.well-known/openid-configuration"]', show(oidc.log))
  const oidcPath = await attempt('path-issuer,oidc-only')
  check('C: ...with a path: the third of the specification\'s order is not needed when the second answers', oidcPath.result.ok === true && oidcPath.log.length === 3, show(oidcPath.log))
  const appended = await attempt('path-issuer,oidc-append-only')
  check('C: ...and the third (the path appended) is reached when it is the only one', appended.result.ok === true && appended.log.at(-1) === '/tenant1/.well-known/openid-configuration' && appended.log.length === 4, show(appended.log))
  for (const [mode, re, what] of [['as-redirect', /redirect/, 'a document that redirects'], ['as-huge', /more than the app accepts|no document/, 'a huge document']]) {
    const r = await attempt(mode)
    check(`C: a provider's ${what} is not used`, r.result.ok === false, show(r.result))
  }
  const many2 = await attempt('as-many')
  check('C: of several providers a bad one first does not stop a good one after it', many2.result.ok === true && many2.result.found.issuer.startsWith('http://127.0.0.1:'), show(many2.result))
  check('C: ...and nothing inside a network was asked on the way', many2.log.every((p) => p.startsWith('/')) && many2.prov.log.length > 0)
  const budgetProv = await startProvider({ mode: 'good' })
  try {
    let asked = 0
    const counting = async (url, request) => {
      asked++
      return g.createGuardedFetch({ anchor: budgetProv.mcp })(url, request)
    }
    // a connector whose document never lets the provider be found: every request counts
    const endless = await d.discover({ mcpUrl: budgetProv.mcp, challenge: d.parseChallenge(null), guarded: async (u, r) => { asked++; return { status: 404, type: 'application/json', challenge: null, json: {}, size: 2 } } })
    check(`C: at most ${OAUTH_LIMITS.discoveryRequests} requests are made in one attempt`, asked <= OAUTH_LIMITS.discoveryRequests && endless.ok === false, show({ asked, endless }))
    asked = 0
    const wide = { status: 200, type: 'application/json', challenge: null, size: 2 }
    const out = await d.discover({
      mcpUrl: budgetProv.mcp,
      challenge: d.parseChallenge(null),
      guarded: async (u) => {
        asked++
        if (u.includes('oauth-protected-resource')) return { ...wide, json: { resource: budgetProv.mcp, authorization_servers: ['https://a.example', 'https://b.example', 'https://c.example'] } }
        return { status: 404, type: 'application/json', challenge: null, json: {}, size: 2 }
      }
    })
    check(`C: three providers that all fail do not make more than ${OAUTH_LIMITS.discoveryRequests} requests, and the sentence says why`, asked <= OAUTH_LIMITS.discoveryRequests && out.ok === false && /more requests than the app makes|no document/.test(out.why), show({ asked, out }))
    void counting
  } finally {
    await budgetProv.close()
  }
  const stopped = new AbortController()
  stopped.abort()
  const halted = await attempt('good', { signal: stopped.signal })
  check('C: a Stop given to the discovery ends it at once, marked as a stop (not as "not found")', halted.result.ok === false && halted.result.stopped === true && halted.prov.log.length === 0, show(halted.result))
})

// ============ D. the source ============
await guard('D', async () => {
  const code = source('src/main/oauthDiscovery.ts')
  const stripped = code.replace(/\/\/[^\n]*/g, '')
  check('D: discovery imports nothing of Electron and no network module of its own', !/from 'electron'|from 'http'|from 'https'|from 'net'|from 'dns'/.test(stripped))
  check('D: every request goes through the guard (the injected fetcher)', !/\bfetch\(/.test(stripped) && (stripped.match(/await guarded\(/g) ?? []).length === 2)
  check('D: S256 is required of the provider\'s list', /includes\('S256'\)/.test(stripped))
  check('D: the identity is compared as written (no normalisation)', /meta\.issuer !== raw/.test(stripped))
  check('D: the resource is compared with the address the person typed', /sameResource\(prm\.resource, resource\)/.test(stripped))
  check('D: the budget of requests is taken before each one', (stripped.match(/budget\.take\(\)/g) ?? []).length === 2)
})

const ok = check.summary()
process.exit(ok ? 0 : 1)
