// Slices 18.4 and 18.5 under plain Node: the update check, the download and what the service lets happen (D-050). The real modules (updateSettings, updateFetch,
// updateManifest, updateService, systemQuestion's gate) against a stand-in for GitHub's downloads (tools/update-server.mjs) and a played person. What it shows:
//   A. updates.json: exactly what the app writes, or OFF; a damaged file never switches anything on;
//   B. the network rules: GitHub only over HTTPS (the real rule, githubOnly), a plain GET with nothing of the person, redirects by hand (at most five, every hop allowed),
//      404 / 500 / no answer / a redirect with no address / a loop, the 64 KB cap by the declared length and by the stream;
//   C. the download: held to the signed size (declared and streamed, longer and shorter) and SHA-256, a stalled download ends, and the file is read again before a run;
//   D. the service: OFF until the person's yes (no request before it, none after a no), one check right after the yes, at most one a day (across a restart too, a clock
//      moved back counts as due), "Check now" only while on, no key = nothing at all, the daily check offers a newer version ONCE (a "Not now" is remembered), Install
//      asks every time, a yes downloads, checks and runs only in the installed app, a refused / current / older file is never offered, a bad download is never run;
//   E. what the source must keep true (ipc.ts, the preload, the modules).
// Run: node tools/guarded.mjs tools/verify-18-4.mjs      (ONLY=A,C runs some parts)
import './ts-resolve.mjs'
import { checker } from './cdp.mjs'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { REPO, REPO_URL } from './paths.mjs'
import { envelope, manifestFor, newKeyPair } from './release-lib.mjs'
import { startUpdateServer } from './update-server.mjs'

const check = checker()
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(',')) : null
const guard = async (name, fn) => { if (ONLY && !ONLY.has(name)) return; try { await fn() } catch (error) { check(`${name} did not run to its end: ${String(error?.stack ?? error).slice(0, 500)}`, false) } }
const show = (v) => JSON.stringify(v)?.slice(0, 300)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const SRC = `${REPO_URL}/src`
const S = await import(`${SRC}/main/updateSettings.ts`)
const F = await import(`${SRC}/main/updateFetch.ts`)
const U = await import(`${SRC}/main/updateService.ts`)
const Q = await import(`${SRC}/main/systemQuestion.ts`)
const W = await import(`${SRC}/shared/updates.ts`)
const source = (rel) => readFileSync(join(REPO, rel), 'utf8')
const root = mkdtempSync(join(tmpdir(), 'frontier-184-'))
const sha = (b) => createHash('sha256').update(b).digest('hex')
const DAY = 86_400_000

const server = await startUpdateServer(Number(process.env.UPDATE_TEST_PORT ?? 0))
const keys = newKeyPair()
const other = newKeyPair()
const repo = 'someone/frontier-app-releases'
const INSTALLER = Buffer.concat([Buffer.from('MZ fake installer for the checks '), Buffer.alloc(300_000, 7)])
const releaseOf = (version, bytes = INSTALLER, key = keys.privateKey) => {
  const m = manifestFor({ repo, version, date: '2026-10-20', notes: `Version ${version}: fixes.`, size: bytes.length, sha256: sha(bytes) })
  server.setInstaller(m.installer.name, bytes)
  return envelope(m, key)
}
const allowedStandIn = (url) => url.origin === server.origin
const rewrite = (address) => address.replace('https://github.com/', `${server.origin}/`)
const rules = (extra = {}) => ({ fetch: (u, i) => fetch(u, i), allowed: allowedStandIn, timeoutMs: 3000, ...extra })

// A person played through the real gate: each question is recorded, and answered from the queue (true = yes); an empty queue answers no.
function person() {
  const asked = []
  const answers = []
  const gate = Q.createQuestionGate(async (owner, question) => { asked.push({ owner, question }); return answers.length ? answers.shift() : false }, () => clock.t)
  return { asked, answers, gate }
}
const clock = { t: new Date(2026, 9, 20, 12, 0, 0).getTime() }
let dirN = 0
function service({ dir = mkdtempSync(join(root, `svc-${++dirN}-`)), publicKey = keys.publicBase64, installed = false, current = '0.1.0', p = person() } = {}) {
  const settings = S.createUpdateSettings({ pathOf: () => join(dir, 'updates.json'), writeMode: async () => ({ form: 'plain' }) })
  const ran = []
  let quits = 0
  const svc = U.createUpdateService({
    settings, gate: p.gate, fetch: (u, i) => fetch(u, i), allowed: allowedStandIn, publicKey, repo, currentVersion: current, rewrite,
    downloadsDir: () => join(dir, 'updates'), installed, runInstaller: (path) => ran.push(path), quit: () => { quits++ }, owner: () => 'the window', now: () => clock.t,
    timeouts: { checkMs: 3000, downloadMs: 5000 }
  })
  return { svc, dir, p, ran, quits: () => quits, settings }
}
const requestsTo = (re) => server.requests.filter((r) => re.test(r.path)).length
// A promise that has not settled in `ms` is a failure of the check (a hang is a FAIL line, not a suite that never ends).
const within = (promise, ms) => Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error(`no answer within ${ms} ms (the check's own limit)`)), ms))])
const until = async (fn, ms = 5000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await sleep(25) } return false }

await guard('A', async () => {
  const good = S.updateSettingsText({ on: true, lastCheck: 1792000000000, declined: '0.2.0' })
  check('A: what the app writes reads back', show(S.parseUpdateSettings(good)) === show({ on: true, lastCheck: 1792000000000, declined: '0.2.0' }))
  check('A: the default is off, never checked, nothing declined', !S.DEFAULT_UPDATE_SETTINGS.on && S.DEFAULT_UPDATE_SETTINGS.lastCheck === null && S.DEFAULT_UPDATE_SETTINGS.declined === null)
  for (const [label, text] of [
    ['a field more', JSON.stringify({ version: 1, on: true, lastCheck: null, declined: null, extra: 1 })],
    ['no lastCheck', JSON.stringify({ version: 1, on: true, declined: null })],
    ['version 2', JSON.stringify({ version: 2, on: true, lastCheck: null, declined: null })],
    ['on as "true"', JSON.stringify({ version: 1, on: 'true', lastCheck: null, declined: null })],
    ['on as 1', JSON.stringify({ version: 1, on: 1, lastCheck: null, declined: null })],
    ['a negative time', JSON.stringify({ version: 1, on: true, lastCheck: -5, declined: null })],
    ['a time with a fraction', JSON.stringify({ version: 1, on: true, lastCheck: 1.5, declined: null })],
    ['a declined version that is not one', JSON.stringify({ version: 1, on: true, lastCheck: null, declined: '0.2' })],
    ['not JSON', '{on: true}'],
    ['an array', '[true]']
  ]) check(`A: ${label} is not read`, S.parseUpdateSettings(text) === null)
  const dir = mkdtempSync(join(root, 'damaged-'))
  writeFileSync(join(dir, 'updates.json'), JSON.stringify({ version: 1, on: 'yes', lastCheck: null, declined: null }))
  const store = S.createUpdateSettings({ pathOf: () => join(dir, 'updates.json'), writeMode: async () => ({ form: 'plain' }) })
  const read = await store.read()
  check('A: a damaged file reads as OFF, with the reason', read.settings.on === false && typeof read.problem === 'string', show(read))
})

await guard('B', async () => {
  const gh = (u) => F.githubOnly(new URL(u))
  check('B: github.com over HTTPS is allowed', gh('https://github.com/a/b/releases/latest/download/latest.json'))
  check('B: GitHub\'s file servers are allowed', gh('https://objects.githubusercontent.com/x') && gh('https://release-assets.githubusercontent.com/x'))
  for (const u of ['http://github.com/x', 'https://github.com:8443/x', 'https://user@github.com/x', 'https://github.com.evil.example/x', 'https://evilgithub.com/x', 'https://githubusercontent.com.evil.example/x', 'https://evil.example/x', 'https://raw.githubusercontent.com.evil.example/x', 'ftp://github.com/x', 'file:///C:/x'])
    check(`B: ${u} is not allowed`, !gh(u))
  server.mode = 'ok'; server.setEnvelope(Buffer.from('hello')); server.clear()
  const body = await F.fetchSmall(`${server.origin}/${repo}/releases/latest/download/latest.json`, 64 * 1024, rules())
  check('B: the redirect to the file server is followed and the body read', Buffer.from(body).toString() === 'hello')
  const r = server.requests[0]
  check('B: a plain GET with no body', server.requests.every((x) => x.method === 'GET' && x.bodyBytes === 0))
  check('B: no cookie, no authorization, no referrer, nothing of the app\'s', server.requests.every((x) => !x.headers.cookie && !x.headers.authorization && !x.headers.referer && !Object.keys(x.headers).some((h) => /^x-|frontier/i.test(h))), show(r?.headers))
  check('B: the headers are only what Node\'s fetch always sends', Object.keys(r.headers).every((h) => ['host', 'connection', 'accept', 'accept-language', 'sec-fetch-mode', 'user-agent', 'accept-encoding'].includes(h)), show(Object.keys(r.headers)))
  const fails = async (label, mode, maxBytes = 64 * 1024, extra = {}) => {
    server.mode = mode
    let error = null
    try { await within(F.fetchSmall(`${server.origin}/${repo}/releases/latest/download/latest.json`, maxBytes, rules(extra)), 6000) } catch (e) { error = e }
    check(label, error instanceof F.UpdateFetchFailed, String(error?.message ?? error))
    return error?.message ?? ''
  }
  check('B: a redirect to plain HTTP elsewhere is not followed', /127\.0\.0\.2/.test(await fails('B: (redirect elsewhere refused)', 'redirect-evil')))
  await fails('B: a redirect to HTTPS elsewhere is not followed', 'redirect-https-evil')
  server.clear(); await fails('B: a redirect loop ends', 'redirect-loop')
  check('B: ... after at most six requests (five redirects)', server.requests.length <= 6, String(server.requests.length))
  await fails('B: six redirects in a row are too many', 'redirect-six')
  await fails('B: a redirect with no address ends the request', 'redirect-no-location')
  check('B: 404 says no release was found', /404/.test(await fails('B: (404)', '404')))
  await fails('B: 500 ends the request', '500')
  const t0 = Date.now(); await fails('B: a server that never answers ends at the clock', 'hang', 64 * 1024, { timeoutMs: 800 })
  check('B: ... in about the time given', Date.now() - t0 < 3000, `${Date.now() - t0} ms`)
  await fails('B: a declared length over the cap is refused', 'big-declared')
  await fails('B: a streamed body over the cap is refused', 'big-stream')
  const outer = new AbortController(); setTimeout(() => outer.abort(), 300)
  await fails('B: Stop (the app closing) ends a request', 'hang', 64 * 1024, { timeoutMs: 10_000, signal: outer.signal })
  server.mode = 'ok'
})

await guard('C', async () => {
  const name = 'frontier-app-9.9.9-setup.exe'
  server.setInstaller(name, INSTALLER); server.mode = 'ok'
  const dir = mkdtempSync(join(root, 'dl-'))
  const expected = { size: INSTALLER.length, sha256: sha(INSTALLER) }
  const url = `${server.origin}/${repo}/releases/download/v9.9.9/${name}`
  const shares = []
  await F.downloadInstaller(url, join(dir, name), expected, rules({ timeoutMs: 5000 }), (s) => shares.push(s))
  check('C: the download is the installer, byte for byte', sha(readFileSync(join(dir, name))) === expected.sha256)
  check('C: progress goes up to 1', shares.length > 0 && shares.at(-1) === 1 && shares.every((s, i) => i === 0 || s >= shares[i - 1]))
  check('C: it is still the installer when read again', await F.stillTheInstaller(join(dir, name), expected))
  const changed = Buffer.from(INSTALLER); changed[1000] ^= 1; writeFileSync(join(dir, name), changed)
  check('C: a byte changed on the disk after the download is seen before a run', !(await F.stillTheInstaller(join(dir, name), expected)))
  check('C: a missing file is not the installer', !(await F.stillTheInstaller(join(dir, 'none.exe'), expected)))
  for (const [label, mode, re] of [
    ['a declared length other than the signed size', 'installer-wrong-length', /size/],
    ['a stream longer than the signed size', 'installer-longer', /larger/],
    ['a stream shorter than the signed size', 'installer-shorter', /smaller/],
    ['one byte changed', 'installer-changed', /SHA-256/],
    ['a download that stalls', 'installer-stall', /too long|cut off/]
  ]) {
    server.mode = mode
    let error = null
    try { await within(F.downloadInstaller(url, join(dir, `${mode}.exe`), expected, rules({ timeoutMs: 1500 })), 6000) } catch (e) { error = e }
    check(`C: ${label} is refused`, error instanceof F.UpdateFetchFailed && re.test(error.message), String(error?.message ?? error))
  }
  server.mode = 'ok'
})

await guard('D', async () => {
  server.mode = 'ok'
  server.setEnvelope(releaseOf('0.2.0'))
  // OFF by default; nothing goes out
  { const s = service(); server.clear()
    const st = await s.svc.status()
    check('D: off by default', st.on === false && st.hasKey === true && st.lastCheck === null && st.finding.kind === 'none' && st.source === `github.com/${repo}`)
    await s.svc.tick(); clock.t += 2 * DAY; await s.svc.tick()
    check('D: while off, the daily tick makes no request', server.requests.length === 0)
    const cn = await s.svc.checkNow()
    check('D: while off, "Check now" is refused and makes no request', !cn.ok && cn.error === W.UPDATE_WORDS.off && server.requests.length === 0)
    const ins = await s.svc.install('the window')
    check('D: while off, Install is refused', !ins.ok)
    // the person says no
    const no = await s.svc.setOn('the window', { on: true })
    check('D: turning on asks in the system\'s box (once)', s.p.asked.length === 1 && s.p.asked[0].owner === 'the window')
    const q = s.p.asked[0]?.question
    check('D: ... which names the repository, says nothing of the person is sent, and that installs ask', q && q.detail.includes(`github.com/${repo}`) && /Nothing about you, your chats or your keys is sent/.test(q.detail) && /asks you here first/.test(q.detail) && q.yes === 'Turn on')
    check('D: after a no it stays off, and nothing was requested', !no.ok && !(await s.svc.status()).on && server.requests.length === 0)
    for (const bad of [{ on: 'yes' }, { on: true, url: 'https://evil.example' }, null, [true], { On: true }]) {
      const r = await s.svc.setOn('the window', bad)
      check(`D: the page's ${show(bad)} is not understood`, !r.ok && r.error === W.UPDATE_WORDS.notUnderstood)
    }
  }
  // yes: one check at once; then at most once a day, across a restart
  { const dir = mkdtempSync(join(root, 'daily-'))
    const s = service({ dir }); s.p.answers.push(true); server.clear()
    clock.t += 3200 // past the quiet time of an earlier no
    const yes = await s.svc.setOn('the window', { on: true })
    check('D: after a yes it is on', yes.ok && yes.status.on === true)
    await until(async () => (await s.svc.status()).busy === null && (await s.svc.status()).lastCheck !== null)
    const st = await s.svc.status()
    check('D: one check right after the yes (one request for latest.json)', requestsTo(/latest\.json$/) === 2 && requestsTo(/\/releases\/latest\//) === 1, show(server.requests.map((r) => r.path)))
    check('D: it found 0.2.0, with its date, size and notes', st.finding.kind === 'available' && st.finding.version === '0.2.0' && st.finding.sizeBytes === INSTALLER.length && st.finding.notes === 'Version 0.2.0: fixes.', show(st.finding))
    check('D: the check after the yes asks nothing more by itself', s.p.asked.length === 1)
    check('D: nothing was downloaded', requestsTo(/setup\.exe$/) === 0)
    server.clear(); clock.t += DAY - 60_000; await s.svc.tick()
    check('D: a tick less than a day later makes no request', server.requests.length === 0)
    const again = service({ dir }); await again.svc.tick()
    check('D: ... nor does a restart', server.requests.length === 0)
    clock.t += 120_000; await again.svc.tick()
    check('D: a day later, one check', requestsTo(/\/releases\/latest\//) === 1)
    check('D: the daily check offers 0.2.0 in the box', again.p.asked.length === 1 && again.p.asked[0].question.message === 'Install Frontier App 0.2.0?', show(again.p.asked.map((a) => a.question.message)))
    const iq = again.p.asked[0]?.question
    check('D: ... with the version now, the size, where from, the notes quoted, and what "Not now" does', iq && /You have version 0\.1\.0/.test(iq.detail) && iq.detail.includes(`github.com/${repo}`) && iq.detail.includes('"Version 0.2.0: fixes."') && /does not ask again for this version/.test(iq.detail) && iq.yes === 'Download and install' && iq.no === 'Not now')
    check('D: "Not now" downloads nothing', requestsTo(/setup\.exe$/) === 0)
    check('D: ... and is remembered in updates.json', JSON.parse(readFileSync(join(dir, 'updates.json'), 'utf8')).declined === '0.2.0')
    clock.t += DAY + 1000; server.clear(); const later = service({ dir }); await later.svc.tick()
    check('D: the next day it checks, but does not ask about 0.2.0 again', requestsTo(/\/releases\/latest\//) === 1 && later.p.asked.length === 0)
    clock.t -= 10 * DAY; server.clear(); await later.svc.tick()
    check('D: a clock moved back (the last check "in the future") counts as due', requestsTo(/\/releases\/latest\//) === 1)
    clock.t += 10 * DAY
    // Install from Settings: asks each time; a yes downloads and checks; only the installed app runs
    clock.t += 3200; server.clear()
    later.p.answers.push(true)
    const inst = await later.svc.install('the window')
    check('D: Install asks again, even after "Not now"', later.p.asked.length === 1 && later.p.asked[0].question.message === 'Install Frontier App 0.2.0?')
    check('D: after the yes, the installer is downloaded once', requestsTo(/setup\.exe$/) === 2 && requestsTo(/\/releases\/download\/v0\.2\.0\//) === 1)
    check('D: running from source it is downloaded and checked, and not run', !inst.ok && inst.error === W.UPDATE_WORDS.notInstalled && later.ran.length === 0 && later.quits() === 0)
    check('D: the file is in the data folder\'s updates folder, the signed bytes', sha(readFileSync(join(dir, 'updates', 'frontier-app-0.2.0-setup.exe'))) === sha(INSTALLER))
    const off = await later.svc.setOn('the window', { on: false })
    check('D: turning off asks nothing and is at once', off.ok && off.status.on === false && later.p.asked.length === 1)
  }
  // the installed app: a yes runs the checked installer and quits
  { const s = service({ installed: true }); s.p.answers.push(true, true); clock.t += 3200; server.clear()
    await s.svc.setOn('w', { on: true }); await until(async () => (await s.svc.status()).finding.kind !== 'none')
    clock.t += 3200
    const r = await s.svc.install('w')
    check('D: in the installed app a yes runs the installer it checked, once, and quits', r.ok && s.ran.length === 1 && s.ran[0] === join(s.dir, 'updates', 'frontier-app-0.2.0-setup.exe') && s.quits() === 1, show({ r, ran: s.ran }))
  }
  // a bad download is never run
  for (const mode of ['installer-changed', 'installer-longer', 'installer-shorter']) {
    const s = service({ installed: true }); s.p.answers.push(true, true); clock.t += 3200; server.mode = 'ok'
    await s.svc.setOn('w', { on: true }); await until(async () => (await s.svc.status()).finding.kind !== 'none')
    clock.t += 3200; server.mode = mode
    const r = await s.svc.install('w')
    check(`D: ${mode}: refused, never run, the app stays`, !r.ok && s.ran.length === 0 && s.quits() === 0, show(r))
    server.mode = 'ok'
  }
  // what is never offered
  for (const [label, env, kind] of [
    ['signed with another key', () => releaseOf('0.2.0', INSTALLER, other.privateKey), 'refused'],
    ['the same version', () => releaseOf('0.1.0'), 'current'],
    ['an older version (a replayed file)', () => releaseOf('0.0.9'), 'current'],
    ['not a release at all', () => Buffer.from('<html>hi</html>'), 'refused']
  ]) {
    server.setEnvelope(env()); server.clear()
    const s = service({ installed: true }); s.p.answers.push(true, true); clock.t += 3200
    await s.svc.setOn('w', { on: true }); await until(async () => (await s.svc.status()).finding.kind !== 'none')
    clock.t += DAY + 1000; await s.svc.tick()
    const st = await s.svc.status()
    check(`D: ${label}: "${kind}", no question, no download`, st.finding.kind === kind && s.p.asked.length === 1 && requestsTo(/setup\.exe$/) === 0, show(st.finding))
    const ins = await s.svc.install('w')
    check(`D: ${label}: Install has nothing to install`, !ins.ok && ins.error === W.UPDATE_WORDS.nothingToInstall && s.ran.length === 0)
  }
  // no key in the build: nothing at all
  { server.setEnvelope(releaseOf('0.2.0')); server.clear()
    const s = service({ publicKey: '' })
    const r = await s.svc.setOn('w', { on: true })
    check('D: with no key in the build it cannot be turned on, no question, no request', !r.ok && r.error === W.UPDATE_WORDS.noKey && s.p.asked.length === 0 && server.requests.length === 0)
    check('D: ... and the status says so', (await s.svc.status()).hasKey === false)
    // a file that says on, with no key: still nothing
    writeFileSync(join(s.dir, 'updates.json'), S.updateSettingsText({ on: true, lastCheck: null, declined: null }))
    await s.svc.tick(); const cn = await s.svc.checkNow()
    check('D: ... even with a file that says on, no request is made', server.requests.length === 0 && !cn.ok)
  }
  // a damaged file
  { const s = service(); writeFileSync(join(s.dir, 'updates.json'), '{"version":1,"on":true}'); server.clear()
    await s.svc.tick()
    const st = await s.svc.status()
    check('D: a damaged file: off, its reason shown, no request', st.on === false && st.problem !== null && server.requests.length === 0)
    const r = await s.svc.setOn('w', { on: true })
    check('D: ... and it cannot be turned on until started again', !r.ok && s.p.asked.length === 0)
    const reset = await s.svc.reset()
    check('D: starting again leaves it off', reset.ok && reset.status.on === false && reset.status.problem === null)
  }
  // one question at a time
  { const s = service(); s.p.answers.push(true); clock.t += 3200
    let release
    const slowGate = Q.createQuestionGate(() => new Promise((r) => { release = r }), () => clock.t)
    const s2 = U.createUpdateService({ settings: s.settings, gate: slowGate, fetch: (u, i) => fetch(u, i), allowed: allowedStandIn, publicKey: keys.publicBase64, repo, currentVersion: '0.1.0', rewrite, downloadsDir: () => join(s.dir, 'u'), installed: false, runInstaller: () => {}, quit: () => {}, owner: () => 'w', now: () => clock.t })
    const first = s2.setOn('w', { on: true })
    await sleep(50)
    const second = await s2.setOn('w', { on: true })
    check('D: a second change while the box is open is refused at once', !second.ok)
    release(false); await first
  }
})

await guard('F', async () => {
  const base = { app: 'frontier-app', version: '0.2.0', date: '2026-10-20', installer: { name: 'frontier-app-0.2.0-setup.exe', url: 'x', size: 1048576, sha256: 'ab'.repeat(32) } }
  const q = (notes) => U.installQuestion({ ...base, notes }, '0.1.0', repo).detail
  check('F: each line of the notes is quoted on its own', q('One.\nTwo.').includes('"One."\n"Two."'))
  check('F: a line that looks like the box\'s own words stays quoted', q('Turn on\nFrontier App asks this').includes('"Turn on"\n"Frontier App asks this"'))
  const many = q(Array.from({ length: 20 }, (_, i) => `Line ${i + 1}`).join('\n'))
  check('F: at most 12 lines, then "(and more in the release)"', many.includes('"Line 12"') && !many.includes('"Line 13"') && many.includes('(and more in the release)'))
  check('F: a line longer than 200 characters is cut', q('x'.repeat(300)).includes(`"${'x'.repeat(200)}..."`))
  check('F: no notes, no notes heading', !q('  ').includes("What changed"))
  check('F: the size in MB', q('').includes('(1.0 MB)'))
})

await guard('E', async () => {
  const ipc = source('src/main/ipc.ts')
  check('E: the stand-in address is read only when running from source', /const updateStandIn = !app\.isPackaged \? \(process\.env\['FRONTIER_UPDATE_URL'\] \?\? ''\) : ''/.test(ipc))
  check('E: the stand-in key is read only when running from source', /publicKey: !app\.isPackaged\s*\?\s*\(process\.env\['FRONTIER_UPDATE_KEY'\] \?\? RELEASE_PUBLIC_KEY\)\s*:\s*RELEASE_PUBLIC_KEY/.test(ipc))
  check('E: otherwise the rule is githubOnly', /: githubOnly,/.test(ipc))
  check('E: the installer is started with exactly --updated /S --force-run, detached', /spawn\(path, \['--updated', '\/S', '--force-run'\], \{ detached: true, stdio: 'ignore' \}\)\.unref\(\)/.test(ipc))
  check('E: only the installed app runs an installer', /installed: app\.isPackaged,/.test(ipc))
  check('E: the four calls that change something are given the calling window (guardedForWindow)', ['updatesSetOn', 'updatesReset', 'updatesCheckNow', 'updatesInstall'].every((c) => new RegExp(`CHANNELS\\.${c},\\s*guardedForWindow`).test(ipc)))
  const pre = source('src/preload/index.ts')
  const bridge = pre.slice(pre.indexOf('  updates: {'), pre.indexOf('\n  }', pre.indexOf('  updates: {')))
  check('E: the preload gives the page five calls, and the only thing it can pass is { on }', (bridge.match(/ipcRenderer\.invoke/g) ?? []).length === 5 && /setOn: \(on\) => ipcRenderer\.invoke\(CHANNELS\.updatesSetOn, \{ on \}\)/.test(bridge) && !/url|version|path/.test(bridge), bridge)
  for (const f of ['src/main/updateService.ts', 'src/main/updateFetch.ts', 'src/main/updateSettings.ts', 'src/main/updateManifest.ts'])
    check(`E: ${f} has no Electron import`, !/from 'electron'/.test(source(f)))
  check('E: the network is only in updateFetch.ts (the service calls nothing else)', !/\bfetch\(/.test(source('src/main/updateService.ts').replace(/options\.fetch/g, '')))
  check('E: updates.json is rewritten with the chats (in the kept documents)', /documents: keptDocuments\(\[[^\]]*updateSettings\.file,/.test(ipc) && /updateSettings\.file\.whenIdle\(\)/.test(ipc))
})

await server.close()
process.exit(check.summary() ? 0 : 1)
