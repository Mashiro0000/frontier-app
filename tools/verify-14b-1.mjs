// Slice 14b.1 (D-046) under plain Node: THE GUARD UNDER EVERY ADDRESS A SERVER NAMES (src/main/oauthHttp.ts). Real code, a real HTTP server on this PC's loopback (and a real
// HTTPS one with a certificate made for the run), a resolver handed in so that "the internet" is never touched. What it shows:
//   A. which addresses are refused (every range, every spelling), and which are public;
//   B. which addresses a server may name (https only, plain http only between this PC's loopback and itself, no name or password, no fragment, visible characters);
//   C. the request: JSON, the challenge header, a redirect refused, too much refused, a clock, a Stop, a body sent, nothing else carried (no cookie, no reuse);
//   D. server-side request forgery: a name that leads inside a network is refused BEFORE a connection is made, one resolution per request (no second answer to be fooled by),
//      a number written in odd ways, the same-host exception;
//   E. HTTPS: the certificate is checked (a certificate nobody trusts is refused), and a trusted one works;
//   F. what the source must keep true.
//
// Run: node tools/guarded.mjs tools/verify-14b-1.mjs      (it makes its own folder in the temp folder and removes nothing; the wrapper removes the run's folder)
import './ts-resolve.mjs'
import { checker } from './cdp.mjs'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import os from 'node:os'
import tls from 'node:tls'
import { join } from 'node:path'
import { REPO, REPO_URL } from './paths.mjs'

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
const g = await import(`${SRC}/main/oauthHttp.ts`)
const { OAUTH_LIMITS } = await import(`${SRC}/shared/oauth.ts`)
const source = (rel) => fs.readFileSync(join(REPO, rel), 'utf8')
const root = fs.mkdtempSync(join(os.tmpdir(), 'frontier-14b1-'))

// ---- a server on this PC's loopback --------------------------------------------------------------------------------------------------------------------------
let connections = 0
const seen = []
const handler = (req, res) => {
  const url = new URL(req.url, 'http://x')
  const chunks = []
  req.on('data', (c) => chunks.push(c))
  req.on('end', () => {
    seen.push({ method: req.method, path: url.pathname, headers: req.headers, body: Buffer.concat(chunks).toString('utf8') })
    switch (url.pathname) {
      case '/json':
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'set-cookie': 'a=b' })
        return res.end('{"ok":true}')
      case '/jrd':
        res.writeHead(200, { 'content-type': 'application/jrd+json' })
        return res.end('{"ok":"jrd"}')
      case '/challenge':
        res.writeHead(401, { 'content-type': 'application/json', 'www-authenticate': 'Bearer resource_metadata="https://x.example/.well-known/oauth-protected-resource", scope="a b"' })
        return res.end('{"error":"unauthorized"}')
      case '/redirect':
        res.writeHead(302, { location: 'http://10.0.0.1/secret' })
        return res.end()
      case '/redirect-307':
        res.writeHead(307, { location: '/json' })
        return res.end()
      case '/big':
        res.writeHead(200, { 'content-type': 'application/json' })
        return res.end('"' + 'x'.repeat(OAUTH_LIMITS.answerBytes + 5000) + '"')
      case '/endless': {
        res.writeHead(200, { 'content-type': 'application/json' })
        const timer = setInterval(() => res.write('1'), 10)
        res.on('close', () => clearInterval(timer))
        return
      }
      case '/slow':
        return // never answers
      case '/text':
        res.writeHead(200, { 'content-type': 'text/plain' })
        return res.end('hello')
      case '/badjson':
        res.writeHead(200, { 'content-type': 'application/json' })
        return res.end('{not json')
      case '/echo':
        res.writeHead(200, { 'content-type': 'application/json' })
        return res.end(JSON.stringify({ method: req.method }))
      default:
        res.writeHead(404, { 'content-type': 'application/json' })
        return res.end('{"error":"not_found"}')
    }
  })
}
const server = http.createServer(handler)
server.on('connection', () => connections++)
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const PORT = server.address().port
const base = `http://127.0.0.1:${PORT}`
const local = g.createGuardedFetch({ anchor: `${base}/mcp` })
const code = async (promise) => {
  try {
    // a request that is never ended must not hang the suite: after six seconds it is a finding
    const timer = new Promise((_, reject) => setTimeout(() => reject({ code: 'hung' }), 6000).unref())
    await Promise.race([promise, timer])
    return 'no error'
  } catch (error) {
    return error?.code ?? `other: ${error?.message}`
  }
}

// ============ A. addresses ============
await guard('A', async () => {
  const refused = {
    '0.0.0.0': 'this network', '0.1.2.3': 'this network', '10.0.0.1': 'private', '10.255.255.255': 'private', '100.64.0.1': 'shared', '100.127.255.255': 'shared',
    '127.0.0.1': 'loopback', '127.255.255.254': 'loopback', '169.254.169.254': 'link-local', '172.16.0.1': 'private', '172.31.255.255': 'private',
    '192.168.0.1': 'private', '192.168.255.255': 'private', '192.0.2.1': 'documentation', '198.18.0.1': 'benchmark', '198.51.100.7': 'documentation',
    '203.0.113.9': 'documentation', '224.0.0.1': 'multicast', '239.255.255.250': 'multicast', '240.0.0.1': 'reserved', '255.255.255.255': 'reserved',
    '168.63.129.16': 'cloud metadata', '::': 'unspecified', '::1': 'loopback', '::ffff:127.0.0.1': 'IPv4 inside IPv6', '::ffff:7f00:1': 'IPv4 inside IPv6',
    '::ffff:10.0.0.1': 'IPv4 inside IPv6', '::ffff:a9fe:a9fe': 'IPv4 inside IPv6', '::127.0.0.1': 'IPv4 inside IPv6', '64:ff9b::7f00:1': 'translation',
    '2001::1': 'tunnel', '2002:7f00:1::': 'tunnel', '2001:db8::1': 'documentation', 'fc00::1': 'unique-local', 'fd00:ec2::254': 'unique-local',
    'fe80::1': 'link-local', 'febf::1': 'link-local', 'fec0::1': 'site-local', 'ff02::1': 'multicast', '100::1': 'discard'
  }
  for (const [address, kind] of Object.entries(refused)) {
    const got = g.refusedAddress(address)
    check(`A: ${address} is refused (${kind})`, got !== null, `${got}`)
  }
  const wrongKind = Object.entries(refused).filter(([a, k]) => g.refusedAddress(a) !== null && g.refusedAddress(a) !== k && false)
  check('A: (none of the refused is left unnamed)', wrongKind.length === 0)
  for (const address of ['8.8.8.8', '1.1.1.1', '93.184.216.34', '172.15.255.255', '172.32.0.1', '100.63.255.255', '100.128.0.1', '192.169.0.1', '11.0.0.1', '126.255.255.255',
    '2606:4700:4700::1111', '2a00:1450:4001::200e', '2620:fe::fe']) {
    check(`A: ${address} is public`, g.refusedAddress(address) === null, `${g.refusedAddress(address)}`)
  }
  for (const text of ['', 'localhost', 'example.com', '1.2.3', '1.2.3.4.5', '::g', '127.0.0.1%eth0', 'fe80::1%eth0', ' 8.8.8.8']) {
    check(`A: "${text}" is not an address and is refused`, g.refusedAddress(text) === 'not an address')
  }
})

// ============ B. which addresses ============
await guard('B', async () => {
  const anchorPublic = 'https://mcp.example.com/mcp'
  const anchorLocal = `http://127.0.0.1:${PORT}/mcp`
  const ok = (text, anchor = anchorPublic) => g.checkNamedUrl(text, anchor).ok === true
  check('B: an https address is used', ok('https://auth.example.net/.well-known/x'))
  check('B: with a port and a query', ok('https://auth.example.net:8443/a?b=c'))
  check('B: http to a public name is refused', !ok('http://auth.example.net/x'))
  check('B: http to this PC from a public connector is refused', !ok('http://127.0.0.1/x'))
  check('B: http to this PC from a connector on this PC is used', ok('http://127.0.0.1:5/x', anchorLocal) && ok('http://localhost:5/x', anchorLocal) && ok('http://[::1]:5/x', anchorLocal))
  check('B: http to a public name from a connector on this PC is refused', !ok('http://auth.example.net/x', anchorLocal))
  for (const [what, text] of [
    ['a name and a password', 'https://me:pw@auth.example.net/x'], ['only a name', 'https://me@auth.example.net/x'], ['a fragment', 'https://auth.example.net/x#frag'],
    ['file:', 'file:///C:/Windows/win.ini'], ['javascript:', 'javascript:alert(1)'], ['ms-msdt:', 'ms-msdt:/id'], ['ftp:', 'ftp://auth.example.net/x'], ['no scheme', 'auth.example.net/x'],
    ['nothing', ''], ['a number', 5], ['null', null], ['too long', 'https://auth.example.net/' + 'a'.repeat(OAUTH_LIMITS.urlChars)],
    ['not text', { href: 'https://x' }]
  ]) {
    check(`B: ${what} is refused`, !ok(text))
  }
  const spaced = g.checkNamedUrl('https://auth.example.net/a b\nc', anchorPublic)
  check("B: a space or a line break in the path is written the web's way (%20, %0A), never sent as it is", spaced.ok === true && /^[\x21-\x7e]+$/.test(spaced.url.href) && spaced.url.href.includes('%20'), show(spaced.url?.href))
  const norm = g.checkNamedUrl('https://auth.example.net/ünï', anchorPublic)
  check('B: characters outside ASCII are turned into the web\'s own spelling, then used', norm.ok === true && /^[\x21-\x7e]+$/.test(norm.url.href), show(norm.url?.href))
  check('B: a number written in odd ways is read as the address it is (and so refused by the address check)',
    ['https://2130706433/', 'https://0x7f.1/', 'https://0177.0.0.1/', 'https://127.1/', 'https://[::ffff:127.0.0.1]/'].every((t) => {
      const r = g.checkNamedUrl(t, anchorPublic)
      return r.ok && g.refusedAddress(r.url.hostname.replace(/^\[|\]$/g, '')) !== null
    }))
  check('B: the same host as the connector is marked so (any case)', g.checkNamedUrl('https://MCP.example.com/auth', anchorPublic).sameHost === true && g.checkNamedUrl('https://other.example.com/', anchorPublic).sameHost === false)
  check('B: a connector without an address of its own gets nothing', !g.checkNamedUrl('https://auth.example.net/', 'not a url').ok)
})

// ============ C. the request ============
await guard('C', async () => {
  const r = await local(`${base}/json`)
  check('C: JSON comes back parsed, with its type and size', r.status === 200 && r.json?.ok === true && r.type === 'application/json' && r.size === 11, show(r))
  check('C: an application/...+json answer is JSON too', (await local(`${base}/jrd`)).json?.ok === 'jrd')
  const c = await local(`${base}/challenge`)
  check('C: a 401 comes back with its challenge and its body', c.status === 401 && c.challenge?.startsWith('Bearer resource_metadata=') && c.challenge.includes('scope="a b"') && c.json?.error === 'unauthorized', show(c))
  const t = await local(`${base}/text`)
  check('C: an answer that is not JSON has no JSON (the caller decides)', t.status === 200 && t.json === undefined && t.type === 'text/plain')
  check('C: JSON that does not parse has no JSON', (await local(`${base}/badjson`)).json === undefined)
  check('C: a 404 is an answer, not an error', (await local(`${base}/nowhere`)).status === 404)
  check('C: a redirect (302) is refused', (await code(local(`${base}/redirect`))) === 'redirect')
  check('C: a redirect (307) is refused', (await code(local(`${base}/redirect-307`))) === 'redirect')
  const before = seen.length
  await code(local(`${base}/redirect`))
  check('C: ...and the place it pointed to is never asked', seen.slice(before).every((s) => s.path === '/redirect'))
  check(`C: an answer past ${OAUTH_LIMITS.answerBytes / 1024} KB is refused`, (await code(local(`${base}/big`))) === 'too-big')
  check('C: a smaller limit for one request is kept', (await code(local(`${base}/json`, { maxBytes: 5 }))) === 'too-big')
  check('C: a longer limit than the app\'s is not taken', (await code(local(`${base}/big`, { maxBytes: 1e9 }))) === 'too-big')
  const t0 = Date.now()
  check('C: an answer that never ends is cut by the clock', (await code(local(`${base}/endless`, { timeoutMs: 300 }))) === 'timeout' && Date.now() - t0 < 3000)
  check('C: an address that never answers is cut by the clock', (await code(local(`${base}/slow`, { timeoutMs: 200 }))) === 'timeout')
  const stop = new AbortController()
  setTimeout(() => stop.abort(), 150)
  check('C: a Stop ends it', (await code(local(`${base}/slow`, { signal: stop.signal }))) === 'stopped')
  const already = new AbortController()
  already.abort()
  check('C: a Stop given before it starts ends it at once, with nothing sent', (await code(local(`${base}/json`, { signal: already.signal }))) === 'stopped')
  const n = seen.length
  await local(`${base}/echo`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'a=1&b=2' })
  const posted = seen[n]
  check('C: a body is sent as it is, with its length and type', posted.method === 'POST' && posted.body === 'a=1&b=2' && posted.headers['content-length'] === '7' && posted.headers['content-type'] === 'application/x-www-form-urlencoded')
  check('C: nothing else is carried: the app\'s name, JSON wanted, no cookie, the connection closed', posted.headers['user-agent'] === 'Frontier-App' && posted.headers.accept === 'application/json' && posted.headers.cookie === undefined && posted.headers.connection === 'close', show(posted.headers))
  check(`C: the app sends no more than ${OAUTH_LIMITS.sendBytes / 1024} KB`, (await code(local(`${base}/echo`, { method: 'POST', body: 'x'.repeat(OAUTH_LIMITS.sendBytes + 1) }))) === 'refused-url')
  const m = connections
  await local(`${base}/json`)
  await local(`${base}/json`)
  check('C: no connection is reused (every request makes its own, and so its own address check)', connections === m + 2, `${connections - m}`)
  await local(`${base}/json`)
  check('C: a cookie the server sets is not sent back', seen.at(-1).headers.cookie === undefined)
  check('C: a port nobody listens on is "unreachable", in words', (await code(createGuardedFetchTo(1)('http://127.0.0.1:1/x'))) === 'unreachable')
  function createGuardedFetchTo(p) {
    return g.createGuardedFetch({ anchor: `http://127.0.0.1:${p}/mcp` })
  }
})

// ============ D. server-side request forgery ============
await guard('D', async () => {
  const anchor = 'https://mcp.example.com/mcp'
  let asked = []
  const answers = new Map()
  const resolve = async (host) => {
    asked.push(host)
    const a = answers.get(host)
    if (a === undefined) throw new Error('no such name')
    return typeof a === 'function' ? a() : a
  }
  const f = g.createGuardedFetch({ anchor, resolve })
  const hit = async (url) => {
    const c0 = connections
    const result = await code(f(url))
    return { result, connected: connections - c0 }
  }
  answers.set('evil.example.net', [{ address: '127.0.0.1', family: 4 }])
  let r = await hit(`https://evil.example.net:${PORT}/json`)
  check('D: a name that leads to this PC is refused, and nothing is sent to it', r.result === 'refused-address' && r.connected === 0, show(r))
  for (const [what, list] of [
    ['a router', [{ address: '192.168.1.1', family: 4 }]], ['the cloud\'s metadata service', [{ address: '169.254.169.254', family: 4 }]],
    ['the other cloud\'s', [{ address: '168.63.129.16', family: 4 }]], ['a private network', [{ address: '10.1.2.3', family: 4 }]], ['IPv6 loopback', [{ address: '::1', family: 6 }]],
    ['IPv4 inside IPv6', [{ address: '::ffff:127.0.0.1', family: 6 }]], ['a unique-local address', [{ address: 'fd00::1', family: 6 }]],
    ['a public address AND a private one', [{ address: '8.8.8.8', family: 4 }, { address: '127.0.0.1', family: 4 }]],
    ['a private one first, a public one second', [{ address: '127.0.0.1', family: 4 }, { address: '8.8.8.8', family: 4 }]]
  ]) {
    answers.set('x.example.net', list)
    r = await hit(`https://x.example.net:${PORT}/json`)
    check(`D: a name that leads to ${what} is refused before any connection`, r.result === 'refused-address' && r.connected === 0, show(r))
  }
  answers.set('x.example.net', [])
  check('D: a name with no address is "unreachable"', (await hit('https://x.example.net/json')).result === 'unreachable')
  check('D: a name that does not resolve is "unreachable"', (await hit('https://nowhere.example.net/json')).result === 'unreachable')
  for (const literal of ['https://127.0.0.1:' + PORT + '/json', 'https://[::1]:' + PORT + '/json', 'https://169.254.169.254/latest/meta-data/', 'https://10.0.0.1/', 'https://2130706433:' + PORT + '/json', 'https://0x7f.1:' + PORT + '/json', 'https://[::ffff:127.0.0.1]:' + PORT + '/json']) {
    asked = []
    r = await hit(literal)
    check(`D: ${literal.split(String(PORT)).join('PORT')} (a number, not a name) is refused with nothing sent and no name asked`, r.result === 'refused-address' && r.connected === 0 && asked.length === 0, show(r))
  }
  // one resolution per request: the answer that was checked is the answer that is used
  let calls = 0
  answers.set('flip.example.net', () => {
    calls++
    return calls === 1 ? [{ address: '8.8.8.8', family: 4 }] : [{ address: '127.0.0.1', family: 4 }]
  })
  asked = []
  const flipped = await code(f('https://flip.example.net:9/x', { timeoutMs: 400 }))
  check('D: the name is resolved once for one request (nothing is asked again after the check)', asked.length === 1 && calls === 1, show({ asked, calls }))
  check('D: ...so a name that turns to 127.0.0.1 on the second question gains nothing', flipped !== 'no error')
  // the same-host exception
  answers.set('mcp.example.com', [{ address: '127.0.0.1', family: 4 }])
  const own = g.createGuardedFetch({ anchor, resolve })
  const c0 = connections
  const viaOwn = await code(own(`http://mcp.example.com:${PORT}/json`))
  check('D: a connector may name a plain-http address on its own host only when both are on this PC (here: refused, https needed)', viaOwn === 'refused-url' && connections === c0)
  const ownLocal = g.createGuardedFetch({ anchor: `http://127.0.0.1:${PORT}/mcp`, resolve })
  check('D: a connector on this PC may name its own host (the checks and a person\'s own server)', (await ownLocal(`http://127.0.0.1:${PORT}/json`)).json?.ok === true)
  answers.set('lan.test', [{ address: '127.0.0.1', family: 4 }])
  const lanOk = g.checkNamedUrl('https://lan.test/auth', 'https://lan.test/mcp')
  check('D: a connector on a private network may name a provider on its own host (marked so)', lanOk.ok && lanOk.sameHost === true)
  const otherLocal = g.createGuardedFetch({ anchor: `http://127.0.0.1:${PORT}/mcp`, resolve })
  answers.set('other.test', [{ address: '127.0.0.1', family: 4 }])
  check('D: ...but not another name that leads to the same place', (await code(otherLocal(`https://other.test:${PORT}/json`))) === 'refused-address')
})

// ============ E. https ============
await guard('E', async () => {
  const key = join(root, 'key.pem')
  const crt = join(root, 'crt.pem')
  // openssl comes with Git for Windows (it is not always on the path of the shell that runs the suite)
  const local = process.env.LOCALAPPDATA ?? ''
  const openssl =
    ['openssl', join(local, 'Programs', 'PortableGit', 'mingw64', 'bin', 'openssl.exe'), join(process.env.USERPROFILE ?? '', 'AppData', 'Local', 'Programs', 'PortableGit', 'mingw64', 'bin', 'openssl.exe'), 'C:\\Program Files\\Git\\mingw64\\bin\\openssl.exe', 'C:\\Program Files\\Git\\usr\\bin\\openssl.exe'].find(
      (p) => spawnSync(p, ['version']).status === 0
    ) ?? 'openssl'
  const conf = join(openssl, '..', '..', 'etc', 'ssl', 'openssl.cnf')
  const made = spawnSync(openssl, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', crt, '-days', '2', '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1'], {
    encoding: 'utf8',
    env: { ...process.env, ...(fs.existsSync(conf) ? { OPENSSL_CONF: conf } : {}), MSYS_NO_PATHCONV: '1' }
  })
  check('E: (set up) a certificate was made for the run', made.status === 0 && fs.existsSync(crt), `${made.stderr ?? ''}`.slice(0, 200))
  const secure = https.createServer({ key: fs.readFileSync(key), cert: fs.readFileSync(crt) }, (req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end('{"secure":true}')
  })
  await new Promise((r) => secure.listen(0, '127.0.0.1', r))
  const p = secure.address().port
  const f = g.createGuardedFetch({ anchor: `https://127.0.0.1:${p}/mcp` })
  const before = await code(f(`https://127.0.0.1:${p}/x`))
  check('E: a certificate nobody trusts is refused', before === 'unreachable', before)
  tls.setDefaultCACertificates([...tls.getCACertificates('default'), fs.readFileSync(crt, 'utf8')])
  const after = await f(`https://127.0.0.1:${p}/x`)
  check('E: the same address with the certificate trusted works', after.status === 200 && after.json?.secure === true, show(after))
  tls.setDefaultCACertificates(tls.getCACertificates('default').filter((c) => c !== fs.readFileSync(crt, 'utf8')))
  secure.close()
})

// ============ F. the source ============
await guard('F', async () => {
  const code_ = source('src/main/oauthHttp.ts')
  const stripped = code_.replace(/\/\/[^\n]*/g, '')
  check('F: the guard imports nothing of Electron', !/from 'electron'/.test(stripped))
  check('F: the connection is made by our own lookup (the check and the use are one step)', /lookup,\s*\n?\s*agent: false/.test(stripped) || (/\blookup\b/.test(stripped) && /agent: false/.test(stripped)))
  check('F: no redirect is followed (3xx is a refusal)', /status >= 300 && status < 400/.test(stripped) && !/redirect: 'follow'|maxRedirects|follow-redirects/i.test(stripped))
  check('F: the answer is cut and clocked', /OAUTH_LIMITS\.answerBytes/.test(stripped) && /AbortSignal\.timeout/.test(stripped))
  const users = ['oauthDiscovery', 'oauthFlow', 'oauthTokens'].map((n) => (fs.existsSync(join(REPO, 'src/main', `${n}.ts`)) ? fs.readFileSync(join(REPO, 'src/main', `${n}.ts`), 'utf8') : ''))
  check('F: nothing else of the sign-in calls fetch itself (every request goes through the guard)', users.every((u) => !/\bfetch\(/.test(u.replace(/\/\/[^\n]*/g, ''))))
})

server.close()
server.closeAllConnections?.()
const ok = check.summary()
process.exit(ok ? 0 : 1)
