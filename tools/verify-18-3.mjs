// Slice 18.3 under plain Node: the update manifest and its signature (src/main/updateManifest.ts, D-050). Every file here is signed by a key made for the run
// (tools/release-lib.mjs, the same code release.mjs uses), except where the point is another key. What it shows:
//   A. a good release is accepted, and the result cannot be changed afterwards;
//   B. the signature: another key, a changed byte of the payload or of the signature, a signature over other bytes, no key in the build, a key that is not one;
//   C. the envelope: every field more or less, another format, not JSON, not UTF-8, too large, empty, base64 that is not exactly canonical;
//   D. the manifest (signed with the RIGHT key, so only the strict reading can stop it): every field more or less, another app, every wrong version form,
//      a bad date, long notes, the installer's name, address (host, scheme, repository, version, a query), size and checksum;
//   E. the version order: equal is "current", lower is "older" (no downgrade, an old signed file replayed later is never taken), 0.10.0 > 0.9.0;
//   F. what the source must keep true: no Electron, no network, the key and the repository only from releaseConfig.ts, the build's key empty until the owner sets it.
// Run: node tools/verify-18-3.mjs      (ONLY=A,C runs some parts)
import './ts-resolve.mjs'
import { checker } from './cdp.mjs'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { REPO, REPO_URL } from './paths.mjs'
import { envelope, manifestFor, newKeyPair } from './release-lib.mjs'

const check = checker()
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(',')) : null
const guard = async (name, fn) => { if (ONLY && !ONLY.has(name)) return; try { await fn() } catch (error) { check(`${name} did not run to its end: ${String(error?.stack ?? error).slice(0, 400)}`, false) } }
const show = (v) => JSON.stringify(v)?.slice(0, 300)
const M = await import(`${REPO_URL}/src/main/updateManifest.ts`)
const source = (rel) => readFileSync(join(REPO, rel), 'utf8')

const keys = newKeyPair()
const other = newKeyPair()
const repo = 'someone/frontier-app-releases'
const rules = { publicKey: keys.publicBase64, repo, currentVersion: '0.1.0' }
const good = () => manifestFor({ repo, version: '0.2.0', date: '2026-10-20', notes: 'Fixes.', size: 114247821, sha256: 'ab'.repeat(32) })
const signed = (manifest, tamper) => envelope(manifest, keys.privateKey, tamper)
const read = (bytes, r = rules) => M.readSignedManifest(bytes, r)
const refused = (name, bytes, r = rules, kind = 'refused') => { const res = read(bytes, r); check(name, res.ok === false && res.kind === kind, show(res)) }
const edit = (fn) => { const m = structuredClone(good()); fn(m); return m }

await guard('A', async () => {
  const res = read(signed(good()))
  check('A: a good release is accepted', res.ok === true, show(res))
  check('A: ... with its version, installer name, address, size and checksum', res.ok && res.manifest.version === '0.2.0' && res.manifest.installer.name === 'frontier-app-0.2.0-setup.exe' && res.manifest.installer.url === `https://github.com/${repo}/releases/download/v0.2.0/frontier-app-0.2.0-setup.exe` && res.manifest.installer.size === 114247821 && res.manifest.installer.sha256 === 'ab'.repeat(32))
  check('A: the result is frozen (manifest and installer)', res.ok && Object.isFrozen(res.manifest) && Object.isFrozen(res.manifest.installer))
  check('A: the envelope address is the latest release\'s latest.json', M.envelopeUrl(repo) === `https://github.com/${repo}/releases/latest/download/latest.json`)
  check('A: Unicode notes are kept', read(signed(edit((m) => { m.notes = 'Corrigé · 修正 · 🎉' }))).manifest?.notes === 'Corrigé · 修正 · 🎉')
})

await guard('B', async () => {
  refused('B: signed with another key', envelope(good(), other.privateKey))
  const bytes = Buffer.from(JSON.stringify(good()))
  const flipped = Buffer.from(bytes); flipped[20] ^= 1
  const env = JSON.parse(signed(good()).toString())
  refused('B: one byte of the payload changed after signing', Buffer.from(JSON.stringify({ ...env, payload: flipped.toString('base64') })))
  const sig = Buffer.from(env.signature, 'base64'); sig[5] ^= 1
  refused('B: one byte of the signature changed', Buffer.from(JSON.stringify({ ...env, signature: sig.toString('base64') })))
  refused('B: a signature over other bytes (another release)', signed(good(), { signOver: Buffer.from(JSON.stringify(edit((m) => { m.version = '0.3.0' }))) }))
  refused('B: the payload of one release with the signature of another', Buffer.from(JSON.stringify({ ...env, signature: JSON.parse(signed(edit((m) => { m.notes = 'x' })).toString()).signature })))
  refused('B: no key in the build (empty)', signed(good()), { ...rules, publicKey: '' })
  check('B: ... and it says so', read(signed(good()), { ...rules, publicKey: '' }).reason === 'This build has no release key, so it cannot accept an update.')
  refused('B: a key of 31 bytes', signed(good()), { ...rules, publicKey: Buffer.alloc(31, 7).toString('base64') })
  refused('B: a key that is not base64', signed(good()), { ...rules, publicKey: 'not a key!' })
  refused('B: the right key with a space in it', signed(good()), { ...rules, publicKey: ' ' + keys.publicBase64 })
  refused('B: a signature of 63 bytes', Buffer.from(JSON.stringify({ ...env, signature: Buffer.from(env.signature, 'base64').subarray(0, 63).toString('base64') })))
  refused('B: an all-zero signature', Buffer.from(JSON.stringify({ ...env, signature: Buffer.alloc(64).toString('base64') })))
  check('B: releaseKey takes the right key only', M.releaseKey(keys.publicBase64) !== null && M.releaseKey('') === null && M.releaseKey(Buffer.alloc(33).toString('base64')) === null)
  check('B: no repository in the build is refused', read(signed(good()), { ...rules, repo: '' }).ok === false)
})

await guard('C', async () => {
  const env = JSON.parse(signed(good()).toString())
  refused('C: a field more in the envelope', signed(good(), { fields: { extra: 1 } }))
  refused('C: no format', Buffer.from(JSON.stringify({ payload: env.payload, signature: env.signature })))
  refused('C: no signature', Buffer.from(JSON.stringify({ format: 1, payload: env.payload })))
  refused('C: format 2', signed(good(), { fields: { format: 2 } }))
  refused('C: format "1" (a string)', signed(good(), { fields: { format: '1' } }))
  refused('C: not JSON', Buffer.from('<html>Not found</html>'))
  refused('C: an array', Buffer.from(JSON.stringify([env])))
  refused('C: empty', Buffer.alloc(0))
  refused('C: not UTF-8', Buffer.concat([Buffer.from('{"format":1,"payload":"'), Buffer.from([0xff, 0xfe]), Buffer.from('"}')]))
  { const ok = signed(good()); const padded = Buffer.concat([ok.subarray(0, ok.length - 1), Buffer.from(' '.repeat(70000) + '}')]); check('C: (a good envelope with 70 KB of spaces is still good JSON with the right fields)', JSON.parse(padded.toString()).format === 1); refused('C: a good envelope padded past 64 KB (only the size cap stops it)', padded) }
  refused('C: larger than 64 KB',Buffer.from(JSON.stringify({ ...env, pad: 'x'.repeat(70000) })))
  refused('C: the payload with a line break in its base64', Buffer.from(JSON.stringify({ ...env, payload: env.payload.slice(0, 10) + '\n' + env.payload.slice(10) })))
  // Notes chosen so that the payload's base64 has a '+' or '/' and padding (the cases only mean something then).
  let probe = null
  for (let i = 0; i < 400 && !probe; i++) { const e = JSON.parse(signed(edit((m) => { m.notes = 'ÿ~?'.repeat(i) })).toString()); if (/[+/]/.test(e.payload) && e.payload.endsWith('=')) probe = e }
  check('C: (a payload with + or / and padding was found for the next two cases)', !!probe)
  refused('C: the payload as URL-safe base64', Buffer.from(JSON.stringify({ ...probe, payload: probe.payload.replaceAll('+', '-').replaceAll('/', '_') })))
  refused('C: the payload without its padding', Buffer.from(JSON.stringify({ ...probe, payload: probe.payload.replace(/=+$/, '') })))
  check('C: (and the same payload with its padding and + / is accepted)', read(Buffer.from(JSON.stringify(probe))).ok === true)
  refused('C: the payload is not base64 at all', Buffer.from(JSON.stringify({ ...env, payload: 'not base64' })))
  refused('C: the payload a number', Buffer.from(JSON.stringify({ ...env, payload: 12 })))
  refused('C: a JSON file with a byte-order mark', Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), signed(good())]))
  refused('C: a payload with a byte-order mark (signed)', envelope(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(JSON.stringify(good()))]), keys.privateKey))
})

await guard('D', async () => {
  refused('D: a field more in the manifest', signed(edit((m) => { m.extra = true })))
  refused('D: no notes', signed(edit((m) => { delete m.notes })))
  refused('D: another app', signed(edit((m) => { m.app = 'other-app' })))
  for (const v of ['0.2', '0.2.0.0', '0.2.0-beta', 'v0.2.0', '01.2.0', ' 0.2.0', '0.2.0 ', '1e3.0.0', '9999999.0.0', '', '0.-1.0'])
    refused(`D: the version "${v}"`, signed(edit((m) => { m.version = v; m.installer.name = `frontier-app-${v}-setup.exe`; m.installer.url = `https://github.com/${repo}/releases/download/v${v}/frontier-app-${v}-setup.exe` })))
  refused('D: the version a number', signed(edit((m) => { m.version = 2 })))
  for (const d of ['2026-13-45', '20-10-2026', '2026-10-20T00:00:00Z', ''])
    refused(`D: the date "${d}"`, signed(edit((m) => { m.date = d })))
  refused('D: notes longer than 2,000 characters', signed(edit((m) => { m.notes = 'x'.repeat(2001) })))
  check('D: notes of exactly 2,000 characters are fine', read(signed(edit((m) => { m.notes = 'x'.repeat(2000) }))).ok === true)
  refused('D: notes that are not text', signed(edit((m) => { m.notes = ['x'] })))
  refused('D: a field more in the installer', signed(edit((m) => { m.installer.args = '/S' })))
  refused('D: the installer named for another version', signed(edit((m) => { m.installer.name = 'frontier-app-0.3.0-setup.exe' })))
  refused('D: the installer named otherwise', signed(edit((m) => { m.installer.name = 'evil.exe'; m.installer.url = `https://github.com/${repo}/releases/download/v0.2.0/evil.exe` })))
  for (const [label, url] of [
    ['another host', 'https://example.com/frontier-app-0.2.0-setup.exe'],
    ['plain HTTP', `http://github.com/${repo}/releases/download/v0.2.0/frontier-app-0.2.0-setup.exe`],
    ['another repository', 'https://github.com/someone-else/frontier-app-releases/releases/download/v0.2.0/frontier-app-0.2.0-setup.exe'],
    ['another version\'s download', `https://github.com/${repo}/releases/download/v0.1.0/frontier-app-0.2.0-setup.exe`],
    ['a query added', `https://github.com/${repo}/releases/download/v0.2.0/frontier-app-0.2.0-setup.exe?x=1`],
    ['a user in the address', `https://evil@github.com/${repo}/releases/download/v0.2.0/frontier-app-0.2.0-setup.exe`],
    ['github.com.evil.example', `https://github.com.evil.example/${repo}/releases/download/v0.2.0/frontier-app-0.2.0-setup.exe`],
    ['upper-case host', `https://GITHUB.com/${repo}/releases/download/v0.2.0/frontier-app-0.2.0-setup.exe`],
    ['a dot-dot path', `https://github.com/${repo}/releases/download/v0.2.0/../../x/frontier-app-0.2.0-setup.exe`]
  ]) refused(`D: the address on ${label}`, signed(edit((m) => { m.installer.url = url })))
  for (const s of [0, -1, 1.5, '114247821', M.MAX_INSTALLER_BYTES + 1, Number.MAX_SAFE_INTEGER + 2, null])
    refused(`D: the size ${show(s)}`, signed(edit((m) => { m.installer.size = s })))
  for (const h of ['AB'.repeat(32), 'ab'.repeat(31), 'ab'.repeat(33), 'zz'.repeat(32), ''])
    refused(`D: the checksum "${h.slice(0, 12)}..." (${h.length})`, signed(edit((m) => { m.installer.sha256 = h })))
  refused('D: a payload that is not JSON (but signed)', envelope(Buffer.from('not json'), keys.privateKey))
  refused('D: a payload that is an array (but signed)', envelope(Buffer.from('[1]'), keys.privateKey))
})

await guard('E', async () => {
  refused('E: the same version is "current"', signed(edit((m) => { m.version = '0.1.0'; m.installer.name = 'frontier-app-0.1.0-setup.exe'; m.installer.url = `https://github.com/${repo}/releases/download/v0.1.0/frontier-app-0.1.0-setup.exe` })), rules, 'current')
  const old = signed(good())
  refused('E: a lower version is "older" (an old signed file replayed to a newer app)', old, { ...rules, currentVersion: '0.3.0' }, 'older')
  refused('E: 0.2.0 under 0.10.0 is older (numbers, not text)', old, { ...rules, currentVersion: '0.10.0' }, 'older')
  check('E: 0.10.0 is newer than 0.9.0', M.compareVersions('0.10.0', '0.9.0') === 1 && M.compareVersions('0.9.0', '0.10.0') === -1)
  check('E: 1.0.0 > 0.99.99, 0.2.1 > 0.2.0, equal is 0', M.compareVersions('1.0.0', '0.99.99') === 1 && M.compareVersions('0.2.1', '0.2.0') === 1 && M.compareVersions('3.4.5', '3.4.5') === 0)
  for (const v of ['0.1.1', '0.2.0', '1.0.0']) check(`E: ${v} is newer than 0.1.0 and accepted`, read(signed(edit((m) => { m.version = v; m.installer.name = `frontier-app-${v}-setup.exe`; m.installer.url = `https://github.com/${repo}/releases/download/v${v}/frontier-app-${v}-setup.exe` }))).ok === true)
  check('E: a running version that is not x.y.z refuses everything', read(signed(good()), { ...rules, currentVersion: '0.1' }).ok === false)
})

await guard('F', async () => {
  const text = source('src/main/updateManifest.ts')
  check('F: no Electron import', !/from 'electron'/.test(text))
  check('F: no network (no fetch, http, https, net)', !/\bfetch\(|from '(node:)?(https?|net)'/.test(text))
  check('F: nothing signs in the app (no sign(, no private key)', !/\bsign\(|createPrivateKey|privateKey/.test(text))
  check('F: the signature is checked before the payload is parsed', text.indexOf('verify(null, payloadBytes') > 0 && text.indexOf('verify(null, payloadBytes') < text.indexOf('.decode(payloadBytes)'))
  const config = source('src/main/releaseConfig.ts')
  check('F: this build\'s release key is empty until the owner makes one (release.mjs keygen)', /export const RELEASE_PUBLIC_KEY = ''/.test(config))
  check('F: the releases repository is named', /export const RELEASES_REPO = '[A-Za-z0-9-]+\/[A-Za-z0-9._-]+'/.test(config))
  const others = ['src/main/ipc.ts', 'src/main/chat.ts', 'src/main/index.ts'].filter((f) => /RELEASE_PUBLIC_KEY/.test(source(f)))
  check('F: no other file of the reply path reads the key', others.length === 0, show(others))
})

process.exit(check.summary() ? 0 : 1)
