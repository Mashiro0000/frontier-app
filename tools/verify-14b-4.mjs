// Slice 14b.4 (D-046) under plain Node: THE TOKENS (src/main/oauthRecord.ts, oauthTokens.ts, the wire's token source in mcpHttp.ts, version 2 of connectors.json). A real wire to the
// reference provider/connector (tools/fixtures14/oauth-server.mjs), a real sign-in to get the tokens, a fake secure storage, a clock the checks move. What it shows:
//   A. the sealed record: sealed whole, read strictly, nothing readable in the file, a box that fails gives nothing;
//   B. connectors.json version 2 (the sign-in field) and the old version 1 still read;
//   C. keeping the token alive: sent, renewed before it ends, renewed once after a 401, single-flight, the new renewal token kept BEFORE it is used, a refused renewal
//      blocks the connector (nothing more is asked of the provider) while a failed connection does not, a 403 or a second 401 is not renewed again;
//   D. where the tokens go (the connector's address only; the renewal token to the token address only; never in an address) and signing out (revoking, best effort);
//   E. the client's reading of a refusal (a 401 is "sign-in needed", at once, not an older server);
//   F. what the source must keep true.
//
// Run: node tools/guarded.mjs tools/verify-14b-4.mjs      (ONLY=A,C runs some parts; it makes no folder and removes nothing)
import './ts-resolve.mjs'
import { checker } from './cdp.mjs'
import fs from 'node:fs'
import { join } from 'node:path'
import { REPO, REPO_URL } from './paths.mjs'
import { startProvider } from './fixtures14/oauth-server.mjs'
import { makeBox } from './lib8b3.mjs'

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
const rec = await import(`${SRC}/main/oauthRecord.ts`)
const tok = await import(`${SRC}/main/oauthTokens.ts`)
const d = await import(`${SRC}/main/oauthDiscovery.ts`)
const g = await import(`${SRC}/main/oauthHttp.ts`)
const httpMod = await import(`${SRC}/main/mcpHttp.ts`)
const client = await import(`${SRC}/main/mcpClient.ts`)
const storeMod = await import(`${SRC}/main/connectorStore.ts`)
const { OAUTH_LIMITS } = await import(`${SRC}/shared/oauth.ts`)
const source = (rel) => fs.readFileSync(join(REPO, rel), 'utf8')
const NOW = 1_700_000_000_000

const sample = () => ({
  issuer: 'https://auth.example.net',
  tokenEndpoint: 'https://auth.example.net/token',
  revocationEndpoint: 'https://auth.example.net/revoke',
  resource: 'https://mcp.example.com/mcp',
  client: { clientId: 'client-1', clientSecret: 'client-secret-SECRET', method: 'client_secret_basic' },
  clientKind: 'registered',
  scopes: ['read', 'write'],
  tokens: { accessToken: 'ACCESS-TOKEN-SECRET', refreshToken: 'REFRESH-TOKEN-SECRET', expiresAt: NOW + 3_600_000, scopes: ['read'] }
})

// ============ A. the record ============
await guard('A', async () => {
  const box = makeBox()
  const r = sample()
  const sealed = rec.sealAuth(box, r)
  check('A: a record is sealed as base64', /^[A-Za-z0-9+/=]{40,}$/.test(sealed))
  const plain = Buffer.from(sealed, 'base64').toString('latin1')
  check('A: nothing of it is readable in what is kept: no token, no secret, no address', !/ACCESS|REFRESH|SECRET|auth\.example|mcp\.example|client-1/.test(sealed + plain))
  check('A: it opens again to exactly the same record', JSON.stringify(rec.unsealAuth(box, sealed)) === JSON.stringify(r))
  check('A: ...also with no secret, no renewal token, no revocation address, no granted list', (() => {
    const bare = { ...r, revocationEndpoint: null, client: { clientId: 'c', clientSecret: null, method: 'none' }, tokens: { ...r.tokens, refreshToken: null, scopes: null } }
    return JSON.stringify(rec.unsealAuth(box, rec.sealAuth(box, bare))) === JSON.stringify(bare)
  })())
  box.lie = true
  check('A: a box that answers wrongly gives no record', rec.unsealAuth(box, sealed) === null)
  box.lie = false
  box.available = false
  let threw = false
  try { rec.sealAuth(box, r) } catch { threw = true }
  check('A: with no secure storage the record is not kept at all (there is no plain-text way)', threw)
  box.available = true
  check('A: damaged sealed text gives no record', rec.unsealAuth(box, 'AAAA') === null && rec.unsealAuth(box, '') === null && rec.unsealAuth(box, sealed.slice(0, -8)) === null)
  const text = rec.authRecordText(r)
  const bad = (mutate) => { const o = JSON.parse(text); mutate(o); return rec.parseAuthRecord(JSON.stringify(o)) === null }
  check('A: the plain text parses back', JSON.stringify(rec.parseAuthRecord(text)) === JSON.stringify(r))
  for (const [what, mutate] of [
    ['a field more', (o) => { o.extra = 1 }], ['a field less', (o) => { delete o.scopes }], ['another version', (o) => { o.version = 2 }], ['a token field more', (o) => { o.tokens.extra = 1 }],
    ['a client field more', (o) => { o.client.extra = 1 }], ['an issuer that is not an address', (o) => { o.issuer = 'nothing' }], ['an address with a name and a password', (o) => { o.tokenEndpoint = 'https://a:b@x.example/t' }],
    ['a file: token address', (o) => { o.tokenEndpoint = 'file:///c:/x' }], ['an access token with a space', (o) => { o.tokens.accessToken = 'a b' }], ['an empty access token', (o) => { o.tokens.accessToken = '' }],
    ['an access token over 8,000 characters', (o) => { o.tokens.accessToken = 'a'.repeat(8001) }], ['a time that is text', (o) => { o.tokens.expiresAt = '5' }], ['a negative time', (o) => { o.tokens.expiresAt = -1 }],
    ['a time that is a fraction', (o) => { o.tokens.expiresAt = 1.5 }], ['a secret with the method "none"', (o) => { o.client.method = 'none' }], ['a method with no secret', (o) => { o.client.clientSecret = null }],
    ['a method nobody knows', (o) => { o.client.method = 'private_key_jwt' }], ['a kind of client nobody knows', (o) => { o.clientKind = 'other' }], ['21 permissions', (o) => { o.scopes = Array.from({ length: 21 }, (_, i) => `s${i}`) }],
    ['a permission with a quote', (o) => { o.scopes = ['a"b'] }], ['granted permissions that are not a list', (o) => { o.tokens.scopes = 'read' }]
  ]) {
    check(`A: a record with ${what} is not a record`, bad(mutate))
  }
  check('A: text that is not JSON, or not an object, is not a record', rec.parseAuthRecord('nope') === null && rec.parseAuthRecord('[]') === null && rec.parseAuthRecord('null') === null)
  check('A: the secrets of a record are its two tokens and the client secret (for the places that look for secrets)', show(rec.secretsOf(r)) === '["ACCESS-TOKEN-SECRET","REFRESH-TOKEN-SECRET","client-secret-SECRET"]' && rec.secretsOf({ ...r, tokens: { ...r.tokens, refreshToken: null }, client: { ...r.client, clientSecret: null, method: 'none' } }).length === 1)
})

// ============ B. connectors.json version 2 ============
await guard('B', async () => {
  const echo = { name: 'search', title: null, description: 'Searches.', inputSchema: { type: 'object' }, readOnly: false, fingerprint: 'a'.repeat(64) }
  const remote = (over = {}) => ({ id: 'abcdef123456', name: 'Web notes', prefix: 'web', place: 'remote', program: null, folder: null, args: [], url: 'https://mcp.example.com/mcp', token: null, auth: null, network: false, workspace: false, tools: [echo], changed: [], added: NOW, ...over })
  const local = (over = {}) => ({ id: 'abcdef654321', name: 'Local', prefix: 'local', place: 'box', program: 'C:\\s\\i.mjs', folder: 'C:\\s', args: [], url: null, token: null, auth: null, network: false, workspace: false, tools: [], changed: [], added: NOW, ...over })
  const sealed = 'QUJD'.repeat(50)
  const text = storeMod.connectorsText([remote({ auth: sealed }), local()])
  check('B: the file is version 2 and holds the sealed sign-in as it is', JSON.parse(text).version === 2 && JSON.parse(text).connectors[0].auth === sealed && storeMod.CONNECTORS_VERSION === 2)
  const back = storeMod.parseConnectors(text)
  check('B: it reads back exactly', back !== null && JSON.stringify(back) === JSON.stringify([remote({ auth: sealed }), local()]))
  const v1 = JSON.stringify({ version: 1, connectors: [remote(), local()].map((c) => { const { auth: _auth, ...rest } = c; return rest }) })
  const old = storeMod.parseConnectors(v1)
  check('B: a version 1 file (before the sign-in) still reads, every connector signed out', old !== null && old.length === 2 && old.every((c) => c.auth === null), show(old?.map((c) => c.auth)))
  check('B: ...and is written as version 2 the next time', JSON.parse(storeMod.connectorsText(old)).version === 2)
  const v1WithAuth = JSON.stringify({ version: 1, connectors: [remote({ auth: sealed })] })
  check('B: a version 1 file that has an auth field is not read (it never had one)', storeMod.parseConnectors(v1WithAuth) === null)
  const v2Without = JSON.stringify({ version: 2, connectors: [(({ auth: _a, ...r }) => r)(remote())] })
  check('B: a version 2 file without the field is not read (exactly what the app writes)', storeMod.parseConnectors(v2Without) === null)
  check('B: a pasted token AND a sign-in on one connector is not read', storeMod.parseConnectors(storeMod.connectorsText([remote({ token: 'QUJD'.repeat(5), auth: sealed })])) === null)
  check('B: a sign-in on a program is not read', storeMod.parseConnectors(storeMod.connectorsText([local({ auth: sealed })])) === null)
  for (const [what, auth] of [['text that is not base64', 'not base64 !!!'], ['a number', 5], ['too short', 'AB'], ['over the limit', 'A'.repeat(60001)]]) {
    check(`B: a sign-in field that is ${what} is not read`, storeMod.parseConnectors(storeMod.connectorsText([remote({ auth })])) === null)
  }
  check('B: version 3 is not read', storeMod.parseConnectors(JSON.stringify({ version: 3, connectors: [] })) === null)
})

// ============ C. keeping the token alive ============
/** A real sign-in at a reference provider, a holder that records what is kept and when, a clock that moves, a wire that asks for its token from the provider. */
async function world(mode = 'good', options = {}) {
  const prov = await startProvider({ mode, expiresIn: options.expiresIn })
  const clock = { offset: 0 }
  const now = () => Date.now() + clock.offset
  const net = { failing: false }
  const real = g.createGuardedFetch({ anchor: prov.mcp })
  const guarded = async (url, req) => {
    if (net.failing) throw new g.GuardError('unreachable', 'The address could not be reached.')
    return real(url, req)
  }
  const challenge = d.parseChallenge((await fetch(prov.mcp, { method: 'POST', body: '{}' })).headers.get('www-authenticate'))
  const found = (await d.discover({ mcpUrl: prov.mcp, challenge, guarded: real })).found
  const browser = async (url) => {
    setImmediate(async () => {
      const first = await fetch(url, { redirect: 'manual' })
      const where = first.headers.get('location')
      if (where) await fetch(where, { redirect: 'manual' })
    })
    return true
  }
  const signed = await f.runSignIn({ mcpUrl: prov.mcp, found, client: { kind: 'register' }, guarded: real, open: browser, now, waitMs: 5000 })
  if (!signed.ok) throw new Error('the sign-in of the world failed: ' + signed.why)
  prov.log.length = 0 // what the checks count starts here
  const kept = { record: signed.auth, writes: [], failWrite: false, delay: 0 }
  const holder = {
    read: async () => kept.record,
    write: async (r) => {
      if (kept.delay > 0) await new Promise((res) => setTimeout(res, kept.delay))
      kept.writes.push({ record: r, at: prov.log.length })
      if (kept.failWrite) return false
      kept.record = r
      return true
    }
  }
  let needs = []
  const provider = tok.createTokenProvider({ holder, guarded, now, onNeedsSignIn: (why) => needs.push(why) })
  const wire = httpMod.createHttpWire({ href: prov.mcp, token: null, auth: provider })
  const ask = () => wire.request('tools/list', {}, { signal: AbortSignal.timeout(20_000) })
  return { prov, clock, now, net, guarded, found, holder, kept, provider, wire, ask, get needs() { return needs }, signed: signed.auth, close: () => { wire.close(); return prov.close() } }
}
const grants = (w, kind) => w.prov.log.filter((l) => l.path === '/token' && new URLSearchParams(l.body).get('grant_type') === kind)
const mcpCalls = (w) => w.prov.log.filter((l) => l.path === '/mcp')

await guard('C', async () => {
  let w = await world()
  try {
    const a = await w.ask()
    check('C: a request carries the access token and is answered', a.ok === true && mcpCalls(w).length === 1 && mcpCalls(w)[0].headers.authorization === `Bearer ${w.signed.tokens.accessToken}`, show(a))
    check('C: no renewal was asked for while the token lives', grants(w, 'refresh_token').length === 0)
  } finally { await w.close() }

  // a 401 for a token the provider no longer honours: renewed once, asked again, answered
  w = await world()
  try {
    w.prov.expireAll()
    const before = w.signed.tokens.refreshToken
    const a = await w.ask()
    check('C: a 401 renews the token once and the request is asked again and answered', a.ok === true && grants(w, 'refresh_token').length === 1 && mcpCalls(w).length === 2, show({ a, grants: grants(w, 'refresh_token').length, calls: mcpCalls(w).length }))
    check('C: ...the second ask carries the NEW token', mcpCalls(w)[1].headers.authorization === `Bearer ${w.kept.record.tokens.accessToken}` && w.kept.record.tokens.accessToken !== w.signed.tokens.accessToken)
    check('C: ...the rotated renewal token was kept BEFORE the new access token was used (the write came before the second ask)', w.kept.writes.length === 1 && w.kept.writes[0].at <= w.prov.log.indexOf(mcpCalls(w)[1]), show({ at: w.kept.writes[0]?.at, second: w.prov.log.indexOf(mcpCalls(w)[1]) }))
    check('C: ...and what was kept is the new pair (the old renewal token no longer works at the provider)', w.kept.record.tokens.refreshToken !== before && w.prov.refreshValid(w.kept.record.tokens.refreshToken) && !w.prov.refreshValid(before))
    await w.ask()
    check('C: later requests use the new token with no more renewals', grants(w, 'refresh_token').length === 1 && mcpCalls(w).length === 3)
    w.prov.expireAll()
    const again = await w.ask()
    check('C: and a second renewal uses the renewal token from the first', again.ok === true && new URLSearchParams(grants(w, 'refresh_token')[1].body).get('refresh_token') === w.kept.writes[0].record.tokens.refreshToken)
  } finally { await w.close() }

  // before it ends
  w = await world()
  try {
    w.clock.offset = 3_600_000 - 30_000 // 30 seconds of life left: under the minute
    const a = await w.ask()
    check('C: a token with under a minute left is renewed BEFORE it is sent (no 401 is needed)', a.ok === true && grants(w, 'refresh_token').length === 1 && mcpCalls(w).length === 1 && mcpCalls(w)[0].headers.authorization === `Bearer ${w.kept.record.tokens.accessToken}`, show({ calls: mcpCalls(w).length }))
    w.clock.offset = 0
  } finally { await w.close() }
  w = await world()
  try {
    w.clock.offset = 3_600_000 - 120_000 // two minutes left: not yet
    await w.ask()
    check('C: ...but not with two minutes left', grants(w, 'refresh_token').length === 0)
  } finally { await w.close() }

  // single flight
  w = await world()
  try {
    w.clock.offset = 3_600_000 - 10_000
    const all = await Promise.all(Array.from({ length: 12 }, () => w.ask()))
    check('C: twelve requests at the same moment make ONE renewal, and all are answered', all.every((x) => x.ok) && grants(w, 'refresh_token').length === 1, show({ grants: grants(w, 'refresh_token').length }))
  } finally { await w.close() }
  w = await world()
  try {
    w.prov.expireAll()
    const all = await Promise.all(Array.from({ length: 12 }, () => w.ask()))
    check('C: twelve requests that all get a 401 make ONE renewal too (the others find the newer token), and all are answered', all.every((x) => x.ok) && grants(w, 'refresh_token').length === 1, show({ grants: grants(w, 'refresh_token').length, ok: all.map((x) => x.ok) }))
  } finally { await w.close() }

  // the disk will not take the new record
  w = await world()
  try {
    w.kept.failWrite = true
    w.prov.expireAll()
    const a = await w.ask()
    check('C: when the new record cannot be kept the new token is still used from memory (the old renewal token is gone at the provider)', a.ok === true && w.kept.writes.length === 1)
    w.kept.failWrite = false
    await w.ask()
    check('C: ...and it is kept again at the next request', w.kept.writes.length === 2 && w.kept.record.tokens.accessToken === mcpCalls(w).at(-1).headers.authorization.slice(7), show(w.kept.writes.length))
  } finally { await w.close() }
  w = await world()
  try {
    w.kept.delay = 150
    w.prov.expireAll()
    const t0 = Date.now()
    const a = await w.ask()
    check('C: a slow disk delays the request (it waits for the record to be kept first)', a.ok === true && Date.now() - t0 >= 140)
  } finally { await w.close() }

  // a renewal the provider refuses
  w = await world()
  try {
    w.prov.set('tok-invalid-grant')
    w.prov.expireAll()
    const err = await w.ask().catch((e) => e)
    check('C: a refused renewal ends in "sign-in needed" (an unauthorized refusal), at once', err instanceof client.McpError && err.fault === 'unauthorized' && err.denied?.status === 401, show(String(err)))
    check('C: ...the holder of the sign-in is told', w.needs.length === 1 && /no longer accepts/.test(w.needs[0]), show(w.needs))
    const status = await w.provider.status()
    check('C: ...the status says so, with the reason', status.state === 'needs-sign-in' && /no longer accepts/.test(status.why))
    const n = grants(w, 'refresh_token').length
    const calls = mcpCalls(w).length
    await w.ask().catch(() => undefined)
    await w.ask().catch(() => undefined)
    check('C: ...and nothing more is asked of the provider (it is blocked until the person signs in again)', grants(w, 'refresh_token').length === n && w.needs.length === 1)
    check('C: ...the requests go without the dead token', mcpCalls(w).slice(calls).every((l) => l.headers.authorization === undefined), show(mcpCalls(w).slice(calls).map((l) => l.headers.authorization)))
    w.prov.set('good')
    const fresh = await (async () => {
      const real = g.createGuardedFetch({ anchor: w.prov.mcp })
      const open = async (url) => { setImmediate(async () => { const r = await fetch(url, { redirect: 'manual' }); const loc = r.headers.get('location'); if (loc) await fetch(loc, { redirect: 'manual' }) }); return true }
      return f.runSignIn({ mcpUrl: w.prov.mcp, found: w.found, client: { kind: 'register' }, guarded: real, open, now: w.now, waitMs: 5000 })
    })()
    w.provider.adopt(fresh.auth)
    const after = await w.ask()
    check('C: a new sign-in adopted: the connector works again', after.ok === true && (await w.provider.status()).state === 'signed-in')
  } finally { await w.close() }
  w = await world()
  try {
    // no renewal token at all
    w.kept.record = { ...w.kept.record, tokens: { ...w.kept.record.tokens, refreshToken: null } }
    w.prov.expireAll()
    const err = await w.ask().catch((e) => e)
    check('C: no renewal token: a 401 is "sign-in needed" at once, without asking the provider', err.fault === 'unauthorized' && grants(w, 'refresh_token').length === 0 && w.needs.length === 1)
  } finally { await w.close() }

  // a failed connection is not a refused sign-in
  w = await world()
  try {
    w.prov.expireAll()
    w.net.failing = true
    const err = await w.ask().catch((e) => e)
    check('C: when the provider cannot be reached the request fails as unauthorized but the sign-in is NOT blocked', err.fault === 'unauthorized' && (await w.provider.status()).state === 'signed-in' && w.needs.length === 0)
    w.net.failing = false
    const a = await w.ask()
    check('C: ...and once it can, the next request renews and works', a.ok === true && grants(w, 'refresh_token').length === 1)
  } finally { await w.close() }
  w = await world()
  try {
    w.clock.offset = 3_600_000 - 20_000
    w.net.failing = true
    const a = await w.ask()
    check('C: a token about to end whose renewal cannot be reached is still sent while it lives', a.ok === true && mcpCalls(w)[0].headers.authorization === `Bearer ${w.signed.tokens.accessToken}`)
    w.clock.offset = 3_600_000 + 60_000
    const gone = await w.provider.current()
    check('C: ...and not once it has ended', gone === null)
  } finally { await w.close() }

  // rejected() when another request has already renewed
  w = await world()
  try {
    w.prov.expireAll()
    await w.ask()
    const n = grants(w, 'refresh_token').length
    const newer = await w.provider.rejected(w.signed.tokens.accessToken)
    check('C: a request that was refused for an OLD token is given the newer one, with no second renewal', newer === w.kept.record.tokens.accessToken && grants(w, 'refresh_token').length === n)
  } finally { await w.close() }

  // retry once
  w = await world('mcp-always-401')
  try {
    const err = await w.ask().catch((e) => e)
    check('C: a connector that refuses even the new token: renewed once, asked once more, then refused (no loop)', err.fault === 'unauthorized' && grants(w, 'refresh_token').length === 1 && mcpCalls(w).length === 2, show({ calls: mcpCalls(w).length, grants: grants(w, 'refresh_token').length }))
  } finally { await w.close() }
  w = await world('mcp-always-403')
  try {
    const err = await w.ask().catch((e) => e)
    check('C: a 403 (more permissions needed) is not renewed at all, and says so with its challenge', err.fault === 'unauthorized' && err.denied.status === 403 && /insufficient_scope/.test(err.denied.challenge) && grants(w, 'refresh_token').length === 0 && mcpCalls(w).length === 1, show(err.denied))
  } finally { await w.close() }
})

// ============ D. where the tokens go; signing out ============
await guard('D', async () => {
  let w = await world()
  try {
    w.prov.expireAll()
    await w.ask()
    await w.ask()
    const access = [w.signed.tokens.accessToken, w.kept.record.tokens.accessToken]
    const refresh = [w.signed.tokens.refreshToken, w.kept.record.tokens.refreshToken]
    const withBearer = w.prov.log.filter((l) => /Bearer at-/.test(String(l.headers.authorization ?? '')))
    check('D: an access token is sent to the connector\'s address and to nowhere else (not the token, registration, sign-in or document addresses)', withBearer.length > 0 && withBearer.every((l) => l.path === '/mcp'), show([...new Set(withBearer.map((l) => l.path))]))
    const holdsRefresh = w.prov.log.filter((l) => refresh.some((r) => l.body.includes(r) || l.search.includes(r) || JSON.stringify(l.headers).includes(r)))
    check('D: a renewal token is sent to the token address only', holdsRefresh.length > 0 && holdsRefresh.every((l) => l.path === '/token'), show([...new Set(holdsRefresh.map((l) => l.path))]))
    check('D: no token is in any address', w.prov.log.every((l) => ![...access, ...refresh].some((t) => l.search.includes(t))))
    check('D: the connector\'s requests carry no renewal token and no client id', mcpCalls(w).every((l) => !refresh.some((r) => JSON.stringify(l.headers).includes(r) || l.body.includes(r))))
  } finally { await w.close() }

  w = await world()
  try {
    const { access, refresh } = { access: w.signed.tokens.accessToken, refresh: w.signed.tokens.refreshToken }
    const said = await w.provider.signOut()
    check('D: signing out revokes both tokens at the provider, and the provider said yes', said === true && !w.prov.isValid(access) && !w.prov.refreshValid(refresh))
    const revokes = w.prov.log.filter((l) => l.path === '/revoke')
    check('D: ...two requests, each naming what it is (access, refresh)', revokes.length === 2 && revokes.some((l) => new URLSearchParams(l.body).get('token_type_hint') === 'refresh_token') && revokes.some((l) => new URLSearchParams(l.body).get('token_type_hint') === 'access_token'))
    check('D: ...the record is forgotten (written as nothing) and the status is "none"', w.kept.writes.at(-1).record === null && (await w.provider.status()).state === 'none')
    const err = await w.ask().catch((e) => e)
    check('D: afterwards the connector is refused (no token is sent)', err.fault === 'unauthorized' && mcpCalls(w).at(-1).headers.authorization === undefined)
  } finally { await w.close() }
  w = await world('revoke-fail')
  try {
    const said = await w.provider.signOut()
    check('D: a provider that fails to revoke: signing out still forgets the record, and says it could not revoke', said === false && w.kept.writes.at(-1).record === null && (await w.provider.status()).state === 'none')
  } finally { await w.close() }
  w = await world('revoke-slow')
  try {
    const t0 = Date.now()
    const said = await w.provider.signOut()
    check('D: a provider that never answers a revocation is waited for 5 seconds at most (both tokens at once)', said === false && Date.now() - t0 < 8000 && Date.now() - t0 >= 4500 && w.kept.writes.at(-1).record === null, `${Date.now() - t0}`)
  } finally { await w.close() }
  w = await world()
  try {
    w.kept.record = { ...w.kept.record, revocationEndpoint: null }
    w.provider.reset()
    const said = await w.provider.signOut()
    check('D: a provider with no revocation address: forgotten, and it says it could not revoke', said === false && w.prov.log.every((l) => l.path !== '/revoke') && w.kept.writes.at(-1).record === null)
  } finally { await w.close() }
  const nobody = tok.createTokenProvider({ holder: { read: async () => null, write: async () => true }, guarded: async () => { throw new Error('never') }, now: () => NOW })
  check('D: with no sign-in at all there is no token, signing out is nothing to do, and the status is "none"', (await nobody.current()) === null && (await nobody.rejected('x')) === null && (await nobody.signOut()) === true && (await nobody.status()).state === 'none')
})

// ============ E. the client's reading of a refusal ============
await guard('E', async () => {
  const prov = await startProvider({ mode: 'good' })
  try {
    const wire = httpMod.createHttpWire({ href: prov.mcp, token: null })
    const err = await client.connectMcp(wire, { signal: AbortSignal.timeout(10_000) }).catch((e) => e)
    check('E: connecting without a token: a 401 is "sign-in needed" at once, not taken for an older server', err instanceof client.McpError && err.fault === 'unauthorized' && err.denied.status === 401 && /needs a sign-in or a token/.test(err.message), show(String(err)))
    check('E: ...and only one request was made (no second try with the older handshake)', prov.log.filter((l) => l.path === '/mcp').length === 1)
    check('E: ...the challenge is handed on as it was sent (and reads as a challenge)', d.parseChallenge(err.denied.challenge).resourceMetadata === `${prov.base}/.well-known/oauth-protected-resource/mcp`)
    check('E: ...the sentence holds nothing the server wrote', !/resource_metadata|oauth-protected/.test(err.message))
    wire.close()
    const pasted = httpMod.createHttpWire({ href: prov.mcp, token: 'a-pasted-token' })
    const e2 = await pasted.request('tools/list', {}, { signal: AbortSignal.timeout(5000) }).catch((e) => e)
    check('E: a pasted token that is refused: the same fault, and the sentence says the token is not accepted', e2.fault === 'unauthorized' && /token it was given is not accepted/.test(e2.message) && prov.log.filter((l) => l.path === '/mcp').length === 2)
    pasted.close()
  } finally { await prov.close() }
})

// ============ F. the source ============
await guard('F', async () => {
  const tokens = source('src/main/oauthTokens.ts').replace(/\/\/[^\n]*/g, '')
  const http = source('src/main/mcpHttp.ts').replace(/\/\/[^\n]*/g, '')
  const record = source('src/main/oauthRecord.ts').replace(/\/\/[^\n]*/g, '')
  check('F: none of the three imports Electron', ![tokens, http, record].some((s) => /from 'electron'/.test(s)))
  check('F: the new record is kept before it is used (the write is awaited before the token is returned)', tokens.indexOf('await options.holder.write(next)') !== -1 && tokens.indexOf('await options.holder.write(next)') < tokens.indexOf('return next'))
  check('F: renewing is single-flight', /inflight \?\?=/.test(tokens))
  check('F: only a refusal of the provider blocks the connector (a fixed list of codes)', /OVER\.has\(result\.error\)/.test(tokens))
  check('F: the renewal is asked once at most per refused request', (http.match(/options\.auth\.rejected\(sent\)/g) ?? []).length === 1 && /error\.denied\?\.status === 401/.test(http))
  check('F: a 403 is not renewed', !/status === 403[^}]*rejected/.test(http))
  check('F: the token is sent only in the Authorization header, never in an address', /h\['authorization'\] = `Bearer \$\{bearer\}`/.test(http) && !/searchParams[^\n]*(token|bearer)/i.test(http))
  check('F: nothing logs a token', ![tokens, http, record].some((s) => /console\.(log|error|warn)\([^)]*(token|secret|bearer)/i.test(s)))
  check('F: the record is sealed with the same box as the other secrets (no key of its own)', /box\.encrypt\(authRecordText\(record\)\)/.test(record) && !/createCipheriv|randomBytes/.test(record))
  check('F: with no secure storage nothing is sealed', /if \(!box\.isAvailable\(\)\) throw/.test(record))
  void OAUTH_LIMITS
})

const ok = check.summary()
process.exit(ok ? 0 : 1)
