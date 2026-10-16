// Slice 14b.5 (D-046) under plain Node: THE SERVICE OF A SIGN-IN (src/main/connectorService.ts: signIn, cancelSignIn, signOut, the states, the tokens, removing), with the real
// store (connectors.json), the real runtime and core, a played person (the system's box) and a played browser, against the reference provider (tools/fixtures14/oauth-server.mjs).
// What it shows:
//   A. a web connector that wants a sign-in says so (once), and the page is told what it may offer;
//   B. signing in: the inputs, the refusals before anything is asked, what the box shows, a no, a yes, what is kept (sealed, nothing readable), the tools listed afterwards,
//      a typed client id, the failures (a provider that cannot be used, a wrong issuer, a browser that does not open, a wait that ends, Cancel, a second sign-in at once);
//   C. a call through the real runtime with the token, renewed silently when it has run out; the states "more permissions" and "sign-in ended";
//   D. signing out and removing: the provider is asked to revoke, the record is forgotten, the audit log says so;
//   E. the tokens: held like keys (listed for the checks on arguments and results), never in the view, never in the audit log, never in a sentence of the page;
//   F. a write of the list never carries a sign-in away (a renewal and changes at the same moment);
//   G. what the source must keep true.
//
// Run: node tools/guarded.mjs tools/verify-14b-5.mjs      (ONLY=A,B runs some parts; later parts need nothing of earlier ones; it makes its own folder in the temp folder)
import './ts-resolve.mjs'
import { checker } from './cdp.mjs'
import fs from 'node:fs'
import os from 'node:os'
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
    check(`${name} did not run to its end: ${String(error?.stack ?? error).slice(0, 700)}`, false)
  }
}
const show = (v) => JSON.stringify(v)?.slice(0, 400)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const SRC = `${REPO_URL}/src`
const serviceMod = await import(`${SRC}/main/connectorService.ts`)
const storeMod = await import(`${SRC}/main/connectorStore.ts`)
const gateMod = await import(`${SRC}/main/systemQuestion.ts`)
const replyMod = await import(`${SRC}/main/replyTools.ts`)
const regMod = await import(`${SRC}/main/toolRegistry.ts`)
const dataMod = await import(`${SRC}/main/dataFolderGuard.ts`)
const secretsMod = await import(`${SRC}/main/secrets.ts`)
const recMod = await import(`${SRC}/main/oauthRecord.ts`)
const auditMod = await import(`${SRC}/shared/audit.ts`)
const sharedTools = await import(`${SRC}/shared/tools.ts`)
const source = (rel) => fs.readFileSync(join(REPO, rel), 'utf8')
const ROOT = fs.mkdtempSync(join(os.tmpdir(), 'frontier-14b5-'))
let worlds = 0

/** A service over its own folder and provider, a played person and a played browser. */
async function world(mode = 'good', options = {}) {
  const prov = await startProvider({ mode, expiresIn: options.expiresIn })
  const dir = join(ROOT, `w${++worlds}`)
  fs.mkdirSync(dir)
  const events = []
  const asked = []
  const answers = []
  const opened = []
  const clock = { t: 1_000_000 }
  const gate = gateMod.createQuestionGate(async (_owner, question) => {
    asked.push(question)
    return answers.length === 0 ? true : answers.shift()
  }, () => (clock.t += 5_000))
  const box = makeBox()
  const state = { available: true, browser: 'follow', failWrites: false, failOpen: false, slowReadOnce: 0 }
  const secrets = { isAvailable: () => state.available && box.isAvailable(), encrypt: (p) => box.encrypt(p), decrypt: (b) => box.decrypt(b) }
  const real = storeMod.createConnectorStore({ pathOf: () => join(dir, 'connectors.json'), box: secrets, writeMode: async () => ({ form: 'plain' }) })
  const store = {
    ...real,
    // `slowReadOnce`: the next read hands back what it read after that many milliseconds (a list that is stale by the time it is used)
    read: async (...a) => {
      const r = await real.read(...a)
      if (state.slowReadOnce > 0) {
        const ms = state.slowReadOnce
        state.slowReadOnce = 0
        await new Promise((res) => setTimeout(res, ms))
      }
      return r
    },
    write: async (...a) => { if (state.failWrites) throw new Error('disk full'); return real.write(...a) }
  }
  let n = 0
  const svc = serviceMod.createConnectorService({
    store,
    gate,
    secrets,
    box: async () => ({ ok: false, why: 'no box in this suite' }),
    nodePath: async () => null,
    workspaceRoot: () => null,
    pickProgram: async () => null,
    forbidden: async () => true,
    savedKeys: async () => [],
    record: async (e) => void events.push(e),
    connectorId: () => `bbbb0000${String(++worlds * 10 + ++n).padStart(4, '0')}`,
    openBrowser: options.noBrowser
      ? undefined
      : async (url) => {
          if (state.failOpen) throw new Error('no browser')
          opened.push(url)
          if (state.browser === 'follow') {
            setImmediate(async () => {
              try {
                const first = await fetch(url, { redirect: 'manual' })
                const where = first.headers.get('location')
                if (where) await fetch(where, { redirect: 'manual' })
              } catch {
                /* the played browser could not get there */
              }
            })
          }
        },
    signInWaitMs: options.waitMs ?? 8000,
    ...(options.extra ?? {})
  })
  const file = join(dir, 'connectors.json')
  const w = {
    prov, svc, store, events, asked, answers, opened, state, file, secrets, box, dir,
    what: () => events.filter((e) => e.type === 'connector').map((e) => e.what),
    status: async () => (await svc.status()).connectors,
    one: async () => (await svc.status()).connectors[0],
    raw: () => fs.readFileSync(file, 'utf8'),
    close: async () => { svc.stopAll(); await prov.close() }
  }
  if (!options.noAdd) {
    const added = await svc.addRemote(null, { name: 'Web', url: prov.mcp, token: '' })
    if (!added.ok) throw new Error('adding the connector failed: ' + added.error)
    w.id = (await w.one()).id
    asked.length = 0
    events.length = 0
    prov.log.length = 0
  }
  return w
}
/** The sign-in of a world, as the page would send it. */
const signIn = (w, input = {}) => w.svc.signIn(null, { id: w.id, clientId: '', clientSecret: '', ...input })
/** Everything sealed in the file of a world, opened. */
const recordOf = async (w) => {
  const c = (await w.store.read()).connectors[0]
  return c.auth === null ? null : recMod.unsealAuth(w.secrets, c.auth)
}

// ============ A. a connector that wants a sign-in ============
await guard('A', async () => {
  const w = await world()
  try {
    const c0 = await w.one()
    check('A: a web connector added with no token starts with no sign-in and nothing to offer yet', c0.auth.state === 'none' && c0.auth.canSignIn === true && c0.hasToken === false && c0.auth.busy === false, show(c0.auth))
    const r = await w.svc.refresh({ id: w.id })
    check('A: starting it, the connector answers 401: the page is told it wants a sign-in, in the app\'s own words', r.ok === false && /sign in/i.test(r.error), show(r))
    const c1 = await w.one()
    check('A: ...the state is "needed", with a reason for the page, and it may offer Sign in', c1.auth.state === 'needed' && c1.auth.canSignIn === true && /Press Sign in/.test(c1.auth.why) && /sign in/i.test(c1.problem), show(c1.auth))
    check('A: ...the audit log has one line for it', w.what().filter((x) => x === 'sign-in-needed').length === 1, show(w.what()))
    await w.svc.refresh({ id: w.id })
    check('A: ...asking again does not make another line', w.what().filter((x) => x === 'sign-in-needed').length === 1)
    check('A: nothing was sent to the connector but the unauthenticated request (no token, no browser, no provider)', w.prov.log.every((l) => l.path === '/mcp') && w.opened.length === 0)
    const t = await world('good', { noAdd: true })
    await t.svc.addRemote(null, { name: 'Pasted', url: t.prov.mcp, token: 'a-pasted-token' })
    t.id = (await t.one()).id
    await t.svc.refresh({ id: t.id })
    const tc = await t.one()
    check('A: a connector with a PASTED token that is refused is not offered a sign-in (the token is wrong; it says so)', tc.auth.state === 'none' && tc.auth.canSignIn === false && /token/.test(tc.problem), show(tc.auth))
    await t.close()
    const nobox = await world('good', { noBrowser: true })
    check('A: without a way to open the browser, Sign in is not offered', (await nobox.one()).auth.canSignIn === false)
    await nobox.close()
    const nosec = await world()
    nosec.state.available = false
    check('A: without a secure place on this PC, Sign in is not offered', (await nosec.one()).auth.canSignIn === false)
    await nosec.close()
  } finally { await w.close() }
})

// ============ B. signing in ============
await guard('B', async () => {
  let w = await world()
  try {
    await w.svc.refresh({ id: w.id })
    for (const [what, input] of [
      ['no id', { id: undefined }], ['an id that is not one', { id: 'NOT-AN-ID' }], ['a client id with a space', { clientId: 'a b' }], ['a secret with no client id', { clientSecret: 'x' }],
      ['a client id over 256 characters', { clientId: 'c'.repeat(257) }], ['a secret over 1,000 characters', { clientId: 'c', clientSecret: 's'.repeat(1001) }], ['a client id that is not text', { clientId: 5 }]
    ]) {
      const r = await signIn(w, input)
      check(`B: ${what} is not understood, and nothing is asked or opened`, r.ok === false && /not understood/.test(r.error) && w.asked.length === 0 && w.opened.length === 0, show(r))
    }
    check('B: an input that is not an object is not understood', (await w.svc.signIn(null, 'x')).ok === false && (await w.svc.signIn(null, null)).ok === false)
    check('B: a connector that is not there is not found', (await w.svc.signIn(null, { id: 'cccc00000000', clientId: '', clientSecret: '' })).error === 'That connector is not there any more.')
    const prefix = w.prov.log.length
    // a no
    w.answers.push(false)
    const no = await signIn(w)
    const q = w.asked.at(-1)
    check('B: the box names the connector, its address, the provider, the host the browser opens at, the permissions, and that the app never sees the password', q.title === 'Sign in to a connector' && q.detail.includes(`Connector: ${w.prov.mcp}`) && q.detail.includes(`Sign-in provider: ${w.prov.base}`) && q.detail.includes('Your browser opens at: 127.0.0.1:') && /Permissions asked for: read, write\./.test(q.detail) && /never sees your password/.test(q.detail) && /registers itself/.test(q.detail), q.detail.slice(0, 600))
    check('B: ...with "No" as the way out, and the same words about the model and the connector as the box for adding', q.no === "Don't sign in" && q.yes === 'Open my browser' && /leaves this PC for whoever runs/.test(q.detail))
    check('B: a no opens no browser, asks for no token, keeps nothing', no.ok === false && no.cancelled === true && w.opened.length === 0 && !w.prov.log.slice(prefix).some((l) => l.path === '/authorize' || l.path === '/token') && (await w.one()).auth.state === 'needed' && /"auth":null/.test(w.raw()), show(no))
    check('B: ...but the app has asked the provider for its documents and (registered nothing: the registration comes after the yes)', !w.prov.log.some((l) => l.path === '/register'))
    // a yes
    const yes = await signIn(w)
    check('B: a yes signs in', yes.ok === true, show(yes))
    check('B: the browser was opened once, at the provider\'s sign-in page, with the state, the challenge and the resource', w.opened.length === 1 && /\/authorize\?/.test(w.opened[0]) && /code_challenge_method=S256/.test(w.opened[0]) && w.opened[0].includes('resource='))
    const c = await w.one()
    check('B: the connector is signed in: the provider\'s host, the permissions, the kind of client, no pasted token', c.auth.state === 'signed-in' && c.auth.provider === new URL(w.prov.base).host && show(c.auth.scopes) === '["read","write"]' && c.auth.clientKind === 'registered' && /^dcr-/.test(c.auth.clientId) && c.hasToken === false, show(c.auth))
    check('B: ...it is running, with the tool it offers listed (the sign-in was used at once)', c.state === 'running' && c.tools.some((t) => t.name === 'echo'), show({ state: c.state, tools: c.tools.map((t) => t.name) }))
    const rec = await recordOf(w)
    const raw = w.raw()
    check('B: what is kept is a sealed record: the file holds no token, no client id, no secret, no provider address', rec !== null && !raw.includes(rec.tokens.accessToken) && !raw.includes(rec.tokens.refreshToken) && !raw.includes(rec.client.clientId) && !raw.includes('/token') && /"auth":"[A-Za-z0-9+/=]{40,}"/.test(raw))
    check('B: ...and opens to the tokens the provider gave, for the resource that is the connector\'s address', w.prov.isValid(rec.tokens.accessToken) && rec.resource === w.prov.mcp && rec.tokenEndpoint.endsWith('/token'))
    check('B: ...and the view holds no token anywhere', !JSON.stringify(await w.svc.status()).includes(rec.tokens.accessToken) && !JSON.stringify(await w.svc.status()).includes(rec.tokens.refreshToken))
    check('B: the audit log has one line for it, naming the connector and nothing of the provider', w.what().includes('signed-in') && w.events.filter((e) => e.type === 'connector' && e.what === 'signed-in').every((e) => e.connector === 'Web' && e.tool === '(connector)' && e.step === 0))
    check('B: nothing in the audit log holds a token', !JSON.stringify(w.events).includes(rec.tokens.accessToken) && !JSON.stringify(w.events).includes(rec.tokens.refreshToken))
    // signing in again: a client is registered again (the return address has a new port)
    const again = await signIn(w)
    check('B: signing in again is allowed (the connector may have been signed in for a long time), and registers the app again', again.ok === true && w.prov.log.filter((l) => l.path === '/register').length === 2)
    const rec2 = await recordOf(w)
    check('B: ...the new record replaces the old (the old client\'s tokens are not the ones kept)', rec2.client.clientId !== rec.client.clientId && rec2.tokens.accessToken !== rec.tokens.accessToken)
  } finally { await w.close() }

  // typed client
  w = await world()
  try {
    await w.svc.refresh({ id: w.id })
    const r = await signIn(w, { clientId: 'typed-client' })
    const q = w.asked.at(-1)
    check('B: a client id the person typed signs in with no registration, and the box says which id', r.ok === true && !w.prov.log.some((l) => l.path === '/register') && /signs in with the client id typed-client/.test(q.detail), show(r))
    check('B: ...it is kept as a typed client', (await w.one()).auth.clientKind === 'typed' && (await w.one()).auth.clientId === 'typed-client')
    w.prov.log.length = 0
    const again = await signIn(w)
    check('B: signing in again with nothing typed uses the client id kept (no registration, no retyping)', again.ok === true && !w.prov.log.some((l) => l.path === '/register') && new URLSearchParams(w.prov.log.find((l) => l.path === '/authorize').search).get('client_id') === 'typed-client')
  } finally { await w.close() }
  w = await world()
  try {
    await w.svc.refresh({ id: w.id })
    const r = await signIn(w, { clientId: 'typed-secret-client', clientSecret: 'typed-secret-value' })
    const q = w.asked.at(-1)
    check('B: a typed client with a secret: signs in, and the box says a secret was typed but not what it is', r.ok === true && /and the secret you typed/.test(q.detail) && !q.detail.includes('typed-secret-value'), show(r))
    const raw = w.raw()
    check('B: ...the secret is sealed in the record and nowhere else', !raw.includes('typed-secret-value') && (await recordOf(w)).client.clientSecret === 'typed-secret-value' && !JSON.stringify(w.events).includes('typed-secret-value'))
  } finally { await w.close() }

  // refusals before anything is asked
  w = await world('no-s256')
  try {
    await w.svc.refresh({ id: w.id })
    const r = await signIn(w)
    check('B: a provider that cannot be used is refused in words, before any question or browser', r.ok === false && /S256/.test(r.error) && w.asked.length === 0 && w.opened.length === 0 && w.what().includes('sign-in-failed'), show(r))
  } finally { await w.close() }
  w = await world('no-registration')
  try {
    await w.svc.refresh({ id: w.id })
    const r = await signIn(w)
    check('B: a provider that registers nobody, and no client id typed: it says so, with the return address to register, before any question', r.ok === false && /http:\/\/127\.0\.0\.1\/callback/.test(r.error) && w.asked.length === 0 && w.opened.length === 0, show(r))
    const typed = await signIn(w, { clientId: 'typed-client' })
    check('B: ...and with a client id typed it goes on', typed.ok === true)
  } finally { await w.close() }
  w = await world('iss-wrong')
  try {
    await w.svc.refresh({ id: w.id })
    const r = await signIn(w)
    check('B: an answer from another provider: the sign-in fails in words, nothing is kept, no token was asked for', r.ok === false && /different provider/.test(r.error) && (await recordOf(w)) === null && !w.prov.log.some((l) => l.path === '/token') && w.what().includes('sign-in-failed'), show(r))
  } finally { await w.close() }
  w = await world()
  try {
    await w.svc.refresh({ id: w.id })
    w.state.failOpen = true
    const r = await signIn(w)
    check('B: a browser that cannot be opened ends it at once, in words', r.ok === false && /browser was not opened/.test(r.error) && (await recordOf(w)) === null)
    w.state.failOpen = false
  } finally { await w.close() }
  w = await world('good', { waitMs: 400 })
  try {
    await w.svc.refresh({ id: w.id })
    w.state.browser = 'silent'
    const r = await signIn(w)
    check('B: the person never finishes in the browser: the wait ends by the clock, in words, and the page may sign in again', r.ok === false && /not finished in time/.test(r.error) && (await w.one()).auth.busy === false && (await w.one()).auth.state === 'needed', show(r))
  } finally { await w.close() }
  w = await world('good', { waitMs: 20000 })
  try {
    await w.svc.refresh({ id: w.id })
    w.state.browser = 'silent'
    const first = signIn(w)
    await sleep(300)
    check('B: while a sign-in is open the page is told so (busy)', (await w.one()).auth.busy === true)
    const second = await signIn(w)
    check('B: a second sign-in at once is refused in words', second.ok === false && /already open/.test(second.error), show(second))
    await w.svc.cancelSignIn()
    const done = await first
    check('B: Cancel ends the open one at once, as a cancel (not a failure), with nothing kept', done.ok === false && done.cancelled === true && (await recordOf(w)) === null && (await w.one()).auth.busy === false, show(done))
    check('B: ...and a cancel is not a "sign-in failed" line', !w.what().includes('sign-in-failed'))
    check('B: ...and nothing is listening any more (the next sign-in can start)', (await (async () => { w.state.browser = 'follow'; return signIn(w) })()).ok === true)
  } finally { await w.close() }
  w = await world('good', { waitMs: 20000 })
  try {
    await w.svc.refresh({ id: w.id })
    w.state.browser = 'silent'
    const t0 = Date.now()
    const first = signIn(w)
    await sleep(300)
    w.svc.stopAll()
    const done = await first
    check('B: the app closing ends an open sign-in at once (not by the clock)', done.ok === false && Date.now() - t0 < 6000, `${Date.now() - t0}`)
  } finally { await w.close() }
  // a pasted-token connector and a program
  w = await world('good', { noAdd: true })
  try {
    await w.svc.addRemote(null, { name: 'Pasted', url: w.prov.mcp, token: 'a-pasted-token' })
    w.id = (await w.one()).id
    const r = await signIn(w)
    check('B: a connector with a pasted token is not signed in (remove it and add it again without a token)', r.ok === false && /pasted/.test(r.error) && w.asked.length === 1 /* only the box for adding */)
  } finally { await w.close() }
  // no secure place
  w = await world()
  try {
    await w.svc.refresh({ id: w.id })
    w.state.available = false
    const r = await signIn(w)
    check('B: with no secure place on this PC it does not sign in, and says why, before anything is asked', r.ok === false && /no secure place/.test(r.error) && w.asked.length === 0 && w.opened.length === 0, show(r))
    w.state.available = true
  } finally { await w.close() }
  // the sign-in works but cannot be kept
  w = await world()
  try {
    await w.svc.refresh({ id: w.id })
    w.state.failWrites = true
    const r = await signIn(w)
    const issued = w.prov.issued.at(-1)
    check('B: a sign-in that cannot be kept is given back: the provider is asked to revoke, and the person is told', r.ok === false && /could not be kept/.test(r.error) && issued !== undefined && !w.prov.isValid(issued.access) && !w.prov.refreshValid(issued.refresh), show({ r, issued: !!issued }))
    w.state.failWrites = false
  } finally { await w.close() }
})

// ============ C. a call through the runtime ============
async function callWorld(mode = 'good', options = {}) {
  const w = await world(mode, options)
  await w.svc.refresh({ id: w.id })
  const si = await signIn(w)
  if (!si.ok) throw new Error('the sign-in of the call world failed: ' + si.error)
  const on = await w.svc.setTool(null, { id: w.id, name: 'echo', on: true })
  if (!on.ok) throw new Error('switching the tool on failed: ' + on.error)
  w.asked.length = 0
  w.events.length = 0
  w.prov.log.length = 0
  const gate = gateMod.createQuestionGate(async (_o, q) => (w.asked.push(q), true), () => (w.clockT = (w.clockT ?? 1_000_000) + 5_000))
  w.run = async (text = 'hi') => {
    const tools = await w.svc.forReply()
    const ids = await w.svc.onIds()
    const runtime = replyMod.createToolRuntime({
      tools: regMod.createToolRegistry(regMod.BUILT_IN_TOOLS),
      gate,
      guard: dataMod.createDataFolderGuard({ roots: () => [w.dir] }),
      record: async (e) => void w.events.push(e),
      holdsSavedKey: async (t) => secretsMod.heldKey(t, (await w.svc.tokens()).map((key) => ({ provider: 'anthropic', key }))) !== null
    })
    const ctl = new AbortController()
    const r = runtime.forReply({ owner: null, signal: ctl.signal, settings: { enabled: Object.fromEntries(ids.map((id) => [id, true])), caps: { steps: 20, seconds: 120 } }, search: async () => { throw new Error('no search') }, connectors: tools })
    return (await r.runTurn([{ id: 'c1', name: 'web__echo', input: { why: 'for the checks', text } }])).results[0]
  }
  return w
}
await guard('C', async () => {
  let w = await callWorld()
  try {
    const r = await w.run('über')
    check('C: a call through the real runtime is asked, run with the token, and answered', /echo:über/.test(r.text ?? r.content ?? JSON.stringify(r)), show(r).slice(0, 300))
    check('C: the connector was sent the access token (and the call was a tools/call)', w.prov.log.some((l) => l.path === '/mcp' && /Bearer at-/.test(l.headers.authorization ?? '') && /tools\/call/.test(l.body)))
    w.prov.expireAll()
    const r2 = await w.run('again')
    check('C: when the token has run out the next call renews it silently and is answered (the person is not asked to sign in)', /echo:again/.test(JSON.stringify(r2)) && w.prov.log.filter((l) => l.path === '/token').length === 1 && (await w.one()).auth.state === 'signed-in', show(r2).slice(0, 200))
    const rec = await recordOf(w)
    check('C: ...and the new tokens are the ones kept', w.prov.isValid(rec.tokens.accessToken) && w.prov.refreshValid(rec.tokens.refreshToken))
  } finally { await w.close() }

  w = await callWorld()
  try {
    w.prov.set('mcp-always-403')
    const r = await w.run('x')
    const c = await w.one()
    check('C: a connector that wants more permissions: the call says so and sends nothing, the state is "more"', /sign in/i.test(JSON.stringify(r)) && /Nothing was sent/.test(JSON.stringify(r)) && c.auth.state === 'more' && /more permissions/.test(c.auth.why), show({ r: JSON.stringify(r).slice(0, 200), a: c.auth }))
    check('C: ...with one line in the audit log, and the Sign in button offered again (with the signed-in facts kept)', w.what().includes('sign-in-needed') && c.auth.canSignIn === true && c.auth.provider !== null)
  } finally { await w.close() }

  w = await callWorld()
  try {
    w.prov.set('tok-invalid-grant')
    w.prov.expireAll()
    const r = await w.run('x')
    const c = await w.one()
    check('C: a sign-in the provider no longer renews: the call says to sign in again, the state is "expired"', /sign in/i.test(JSON.stringify(r)) && c.auth.state === 'expired' && /ended/.test(c.auth.why), show({ r: JSON.stringify(r).slice(0, 200), a: c.auth }))
    const grants = w.prov.log.filter((l) => l.path === '/token').length
    await w.run('y')
    check('C: ...and the provider is not asked again (the next call fails at once)', w.prov.log.filter((l) => l.path === '/token').length === grants)
    check('C: ...one audit line for the change', w.what().filter((x) => x === 'sign-in-needed').length >= 1)
    w.prov.set('good')
    const again = await signIn(w)
    const r3 = await w.run('z')
    check('C: signing in again makes it work again', again.ok === true && /echo:z/.test(JSON.stringify(r3)) && (await w.one()).auth.state === 'signed-in', show(r3).slice(0, 200))
  } finally { await w.close() }

  // an unreadable record (another account, a key that is gone)
  w = await callWorld()
  try {
    w.box.lie = true
    const c = await w.one()
    check('C: a sign-in that cannot be opened on this PC any more is shown as ended, with the reason, and may be signed in again', c.auth.state === 'expired' && /cannot be opened/.test(c.auth.why) && c.auth.canSignIn === true, show(c.auth))
    w.box.lie = false
  } finally { await w.close() }
})

// ============ D. signing out and removing ============
await guard('D', async () => {
  let w = await callWorld()
  try {
    const rec = await recordOf(w)
    const out = await w.svc.signOut({ id: w.id })
    const c = await w.one()
    check('D: signing out: the provider is asked to revoke both tokens and said yes, and the person is told nothing more than "ok"', out.ok === true && out.notice === undefined && !w.prov.isValid(rec.tokens.accessToken) && !w.prov.refreshValid(rec.tokens.refreshToken), show(out.notice))
    check('D: ...the record is forgotten (the file has no sign-in), the state is "needed", the connector is stopped', (await recordOf(w)) === null && /"auth":null/.test(w.raw()) && c.auth.state === 'needed' && c.auth.provider === null && c.state !== 'running')
    check('D: ...one audit line, no question asked (signing out gives rights up, it asks for none)', w.what().includes('signed-out') && w.asked.length === 0)
    const r = await w.run('x')
    check('D: afterwards a call is refused for want of a sign-in', /sign in/i.test(JSON.stringify(r)) && w.prov.log.at(-1).headers.authorization === undefined)
    check('D: signing out a connector that is not signed in is nothing to do', (await w.svc.signOut({ id: w.id })).ok === true)
    check('D: signing out something that is not there is "not found"', (await w.svc.signOut({ id: 'cccc00000000' })).error === 'That connector is not there any more.' && (await w.svc.signOut(7)).ok === false)
  } finally { await w.close() }
  w = await callWorld('revoke-fail')
  try {
    const out = await w.svc.signOut({ id: w.id })
    check('D: a provider that fails to revoke: the sign-in is forgotten all the same, and the person is told it could not be revoked', out.ok === true && /could not be asked to revoke/.test(out.notice) && (await recordOf(w)) === null, show(out))
  } finally { await w.close() }
  w = await callWorld()
  try {
    const rec = await recordOf(w)
    w.answers.push(false)
    const no = await w.svc.remove(null, { id: w.id })
    const q = w.asked.at(-1)
    check('D: removing a signed-in connector says that the provider is asked to revoke the sign-in', /asked to revoke your sign-in/.test(q.detail), q.detail.slice(0, 300))
    check('D: ...a no changes nothing (still signed in, tokens still good)', no.ok === false && (await recordOf(w)) !== null && w.prov.isValid(rec.tokens.accessToken))
    const yes = await w.svc.remove(null, { id: w.id })
    check('D: a yes revokes the tokens at the provider, forgets the sign-in and removes the connector', yes.ok === true && !w.prov.isValid(rec.tokens.accessToken) && !w.prov.refreshValid(rec.tokens.refreshToken) && (await w.status()).length === 0 && !/auth/.test(w.raw().replace(/"auth"/g, '')) )
  } finally { await w.close() }
  w = await callWorld('revoke-slow')
  try {
    const t0 = Date.now()
    const out = await w.svc.signOut({ id: w.id })
    check('D: a provider that never answers a revocation does not hold up signing out for more than five seconds', out.ok === true && Date.now() - t0 < 9000 && (await recordOf(w)) === null, `${Date.now() - t0}`)
  } finally { await w.close() }
  const p = await world('good', { noAdd: true })
  try {
    check('D: the audit log reads in words for the four new lines', ['signed-in', 'signed-out', 'sign-in-failed', 'sign-in-needed'].every((what) => sharedTools.CONNECTOR_EVENTS.includes(what) && /"Web"/.test(auditMod.connectorEventText(what, 'Web'))))
  } finally { await p.close() }
})

// ============ E. the tokens are held like keys ============
await guard('E', async () => {
  const w = await callWorld('client-secret')
  try {
    const rec = await recordOf(w)
    const held = await w.svc.tokens()
    check('E: the access token, the renewal token and the client secret are all in the list of what must never leave', [rec.tokens.accessToken, rec.tokens.refreshToken, rec.client.clientSecret].every((s) => held.includes(s)) && rec.client.clientSecret?.startsWith('sec-'), show(held.map((h) => h.slice(0, 6))))
    const view = JSON.stringify(await w.svc.status())
    check('E: none of them is in what the page is given', held.every((s) => !view.includes(s)))
    check('E: none of them is in the audit log', held.every((s) => !JSON.stringify(w.events).includes(s)))
    check('E: none of them is in the file in the clear', held.every((s) => !w.raw().includes(s)))
    const sentences = [(await w.svc.signOut({ id: 'cccc00000000' })).error, (await signIn(w, { id: 'x' })).error]
    check('E: none of them is in a sentence of the service', held.every((s) => sentences.every((t) => !String(t).includes(s))))
    const before = w.prov.log.filter((l) => /tools\/call/.test(l.body)).length
    const leak = await w.run('text that holds ' + rec.tokens.refreshToken)
    const leak2 = await w.run('text that holds ' + rec.tokens.accessToken)
    void leak2
    check('E: a call that carries a token in its arguments never reaches the connector, and nobody is asked about it (as for a saved key)', w.prov.log.filter((l) => /tools\/call/.test(l.body)).length === before && w.asked.length === 0 && /refus|not made|key|secret/i.test(JSON.stringify(leak)), show(leak).slice(0, 300))
  } finally { await w.close() }
})

// ============ F. a write of the list never carries a sign-in away ============
await guard('F', async () => {
  const w = await callWorld()
  try {
    for (let round = 0; round < 6; round++) {
      w.prov.expireAll()
      await Promise.all([w.run(`round ${round}`), w.svc.setTool(null, { id: w.id, name: 'echo', on: false })])
      await w.svc.setTool(null, { id: w.id, name: 'echo', on: true })
    }
    // the exact case: a list read a moment ago, saved after the token was renewed
    w.state.slowReadOnce = 500
    const stale = w.svc.setTool(null, { id: w.id, name: 'echo', on: false })
    await sleep(100)
    w.prov.expireAll()
    await w.run('during the stale read')
    await stale
    const kept = await recordOf(w)
    check('F: a list that was read before a renewal and is saved after it does not carry the old sign-in back (the renewal token kept is the one the provider honours)', kept !== null && w.prov.refreshValid(kept.tokens.refreshToken), show(kept?.tokens.refreshToken?.slice(0, 8)))
    await w.svc.setTool(null, { id: w.id, name: 'echo', on: true })
    const rec = await recordOf(w)
    check('F: after six renewals and as many changes of the list at the same moments, the sign-in kept is the newest (its renewal token is the one the provider honours)', rec !== null && w.prov.refreshValid(rec.tokens.refreshToken), show(rec?.tokens.refreshToken?.slice(0, 8)))
    check('F: ...and the connector still works', /echo:final/.test(JSON.stringify(await w.run('final'))))
  } finally { await w.close() }
})

// ============ G. the source ============
await guard('G', async () => {
  const svc = source('src/main/connectorService.ts').replace(/\/\/[^\n]*/g, '')
  const ipc = source('src/main/ipc.ts')
  check('G: a sign-in is started only by signIn (the page\'s call): nothing else calls runSignIn', (svc.match(/runSignIn\(/g) ?? []).length === 1)
  check('G: the box is asked before the browser is opened (the question comes before runSignIn)', svc.indexOf('signInQuestion(c, found.found, client)') < svc.indexOf('await runSignIn('))
  check('G: a no stops it: the answer must be yes to go on', /if \(answer !== 'yes'\) return notYes\(answer, 'You did not sign in\.'\)/.test(svc))
  check('G: one sign-in at a time in the whole app', /if \(signing !== null\)/.test(svc))
  check('G: every write of the list is under the lock, and carries the sign-in on disk, never the one in a stale list', /withLock\(async \(\) => \{\s*\/\/? ?[^]*?auths = new Map/.test(svc) || /const auths = new Map\(current\.connectors\.map\(\(x\) => \[x\.id, x\.auth\]\)\)/.test(svc))
  check('G: the page\'s secrets are never kept as typed (the secret goes into the record, sealed, and nowhere else)', !/clientSecret[^\n]*(console|record\(|note\()/.test(svc))
  check('G: the three channels are handled and each is guarded for the window', ['connectorsSignIn', 'connectorsCancelSignIn', 'connectorsSignOut'].every((n) => new RegExp(`CHANNELS\\.${n},\\s*guardedForWindow`).test(ipc)))
  check('G: the browser is opened only for https, or for an address on this PC', /isSafeExternalUrl\(url\) && !local/.test(ipc))
  check('G: signing out and cancelling are not questions (they give rights up)', !/signOut: async[^]*?ask\(/.test(svc.slice(svc.indexOf('signOut: async'), svc.indexOf('signOut: async') + 1400)))
})

const ok = check.summary()
process.exit(ok ? 0 : 1)
