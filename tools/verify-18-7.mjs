// Slice 18.7 under plain Node: the release tool (tools/release.mjs, D-050), pointed at a scratch folder (a copy of releaseConfig.ts, a key folder of its own, a stand-in
// installer), so the real config, the owner's key folder and dist/ are never touched. What it shows:
//   A. keygen: an Ed25519 private key in the key folder (PKCS#8 PEM), its public half written into the config copy (only that line changed); a second keygen changes nothing
//      (it never overwrites a key), nor does one with a config that already holds a key;
//   B. sign: a latest.json the app's own reader takes (name, address in the repository, size, SHA-256 of the installer, the notes), and the private key in no output;
//      refused and nothing written: a version that is not x.y.z, no installer, notes too long, no key, a key that does not match the config, an RSA key;
//   C. verify: reads it back, and says whether an installer matches;
//   D. the source: no network code at all (it never uploads), no key in the repo.
// Run: node tools/verify-18-7.mjs
import './ts-resolve.mjs'
import { checker } from './cdp.mjs'
import { generateKeyPairSync } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { REPO, REPO_URL, TOOLS } from './paths.mjs'

const check = checker()
const show = (v) => JSON.stringify(v)?.slice(0, 400)
const M = await import(`${REPO_URL}/src/main/updateManifest.ts`)
const root = mkdtempSync(join(tmpdir(), 'frontier-187-'))
const config = join(root, 'releaseConfig.ts')
copyFileSync(join(REPO, 'src', 'main', 'releaseConfig.ts'), config)
const keyDir = join(root, 'keys')
const out = join(root, 'dist')
mkdirSync(out)
const installer = join(out, 'frontier-app-0.2.0-setup.exe')
writeFileSync(installer, Buffer.concat([Buffer.from('MZ stand-in'), Buffer.alloc(50_000, 3)]))
const realConfigBefore = readFileSync(join(REPO, 'src', 'main', 'releaseConfig.ts'), 'utf8')
const tool = (...args) => { const r = spawnSync(process.execPath, [join(TOOLS, 'release.mjs'), ...args, '--config', config, '--key-dir', keyDir], { encoding: 'utf8' }); return { status: r.status, out: (r.stdout ?? '') + (r.stderr ?? '') } }
const keyLine = () => (readFileSync(config, 'utf8').match(/^export const RELEASE_PUBLIC_KEY = '([^']*)'$/m) ?? [])[1]

// A
const configBefore = readFileSync(config, 'utf8')
const k = tool('keygen')
check('A: keygen succeeds', k.status === 0, k.out)
const pem = existsSync(join(keyDir, 'release-key.pem')) ? readFileSync(join(keyDir, 'release-key.pem'), 'utf8') : ''
check('A: the private key is a PKCS#8 PEM in the key folder', /^-----BEGIN PRIVATE KEY-----/.test(pem))
const pub = keyLine()
check('A: its public half is in the config copy, a key the app takes', typeof pub === 'string' && M.releaseKey(pub) !== null, pub)
check('A: only that line changed', readFileSync(config, 'utf8').replace(/RELEASE_PUBLIC_KEY = '[^']*'/, "RELEASE_PUBLIC_KEY = ''") === configBefore)
check('A: the private key is not printed', !k.out.includes(pem.split('\n')[1] ?? '@@'))
const k2 = tool('keygen')
check('A: a second keygen is refused and changes nothing', k2.status !== 0 && readFileSync(join(keyDir, 'release-key.pem'), 'utf8') === pem && keyLine() === pub, k2.out)
const otherDir = join(root, 'keys2')
const k3 = spawnSync(process.execPath, [join(TOOLS, 'release.mjs'), 'keygen', '--config', config, '--key-dir', otherDir], { encoding: 'utf8' })
check('A: keygen with a config that already holds a key is refused, no key made', k3.status !== 0 && !existsSync(join(otherDir, 'release-key.pem')) && keyLine() === pub)

{ // a key already in the key folder, the config still empty: only the key-file rules can stop it
  const cfg2 = join(root, 'releaseConfig-empty.ts'); copyFileSync(join(REPO, 'src', 'main', 'releaseConfig.ts'), cfg2)
  const x = spawnSync(process.execPath, [join(TOOLS, 'release.mjs'), 'keygen', '--config', cfg2, '--key-dir', keyDir], { encoding: 'utf8' })
  check('A: with a key already in the folder (and an empty config): refused, the key and the config unchanged', x.status !== 0 && readFileSync(join(keyDir, 'release-key.pem'), 'utf8') === pem && readFileSync(cfg2, 'utf8') === realConfigBefore, (x.stderr ?? '').trim().slice(0, 200))
}

// B
const repo = 'Mashiro0000/frontier-app-releases'
const s = tool('sign', '--no-build', '--version', '0.2.0', '--out', out, '--installer', installer, '--date', '2026-10-20', '--notes', 'Fixes.\nMore fixes.')
check('B: sign succeeds and says nothing was uploaded', s.status === 0 && /Nothing was uploaded/.test(s.out), s.out)
const bytes = existsSync(join(out, 'latest.json')) ? readFileSync(join(out, 'latest.json')) : Buffer.alloc(0)
const r = M.readSignedManifest(bytes, { publicKey: pub, repo, currentVersion: '0.1.0' })
check('B: the app\'s own reader takes latest.json', r.ok, show(r))
const inst = readFileSync(installer)
check('B: ... with the installer\'s name, address, size, SHA-256 and the notes', r.ok && r.manifest.installer.name === 'frontier-app-0.2.0-setup.exe' && r.manifest.installer.url === `https://github.com/${repo}/releases/download/v0.2.0/frontier-app-0.2.0-setup.exe` && r.manifest.installer.size === inst.length && r.manifest.installer.sha256 === (await import('node:crypto')).createHash('sha256').update(inst).digest('hex') && r.manifest.notes === 'Fixes.\nMore fixes.' && r.manifest.date === '2026-10-20')
check('B: the private key is in no output (latest.json, what it printed)', !bytes.toString().includes('PRIVATE') && !s.out.includes(pem.split('\n')[1]))
const refused = (label, args, before = bytes) => {
  const x = tool('sign', '--no-build', '--out', out, '--installer', installer, ...args)
  const now = existsSync(join(out, 'latest.json')) ? readFileSync(join(out, 'latest.json')) : null
  check(`B: ${label}: refused, latest.json unchanged`, x.status !== 0 && now !== null && Buffer.compare(now, before) === 0, x.out.trim())
}
refused('a version that is not x.y.z', ['--version', '0.2'])
refused('notes longer than 2,000 characters', ['--version', '0.2.0', '--notes', 'x'.repeat(2001)])
{ const x = tool('sign', '--no-build', '--out', out, '--version', '0.3.0'); check('B: no installer for the version: refused', x.status !== 0 && /no installer/.test(x.out), x.out.trim()) }
{ const x = spawnSync(process.execPath, [join(TOOLS, 'release.mjs'), 'sign', '--no-build', '--version', '0.2.0', '--out', out, '--installer', installer, '--config', config, '--key-dir', join(root, 'none')], { encoding: 'utf8' }); check('B: no private key: refused', x.status !== 0 && /no private key/.test(x.stderr), x.stderr) }
{ const x = tool('sign', '--no-build', '--version', '0.2.0', '--out', out, '--installer', installer, '--public', Buffer.alloc(32, 1).toString('base64')); check('B: a private key that does not match the public key: refused', x.status !== 0 && /does not match/.test(x.out), x.out.trim()) }
{ const rsaDir = join(root, 'rsa'); mkdirSync(rsaDir); writeFileSync(join(rsaDir, 'release-key.pem'), generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ format: 'pem', type: 'pkcs8' }))
  const x = spawnSync(process.execPath, [join(TOOLS, 'release.mjs'), 'sign', '--no-build', '--version', '0.2.0', '--out', out, '--installer', installer, '--config', config, '--key-dir', rsaDir], { encoding: 'utf8' })
  check('B: an RSA key: refused', x.status !== 0 && /not an Ed25519 key/.test(x.stderr), x.stderr) }

// C
const v = tool('verify', join(out, 'latest.json'), '--installer', installer)
check('C: verify reads it back and the installer matches', v.status === 0 && /version 0\.2\.0/.test(v.out) && /The installer matches\./.test(v.out), v.out)
const other = join(root, 'other.exe'); writeFileSync(other, 'not it')
const v2 = tool('verify', join(out, 'latest.json'), '--installer', other)
check('C: ... and says when an installer does not', v2.status !== 0 && /does NOT match/.test(v2.out), v2.out)

// D
const text = readFileSync(join(TOOLS, 'release.mjs'), 'utf8') + readFileSync(join(TOOLS, 'release-lib.mjs'), 'utf8')
check('D: no network code at all (no fetch, http, https, net, an upload, gh)', !/\bfetch\(|from 'node:(https?|net|tls|dgram)'|upload\(|['"]gh['"]/.test(text))
check('D: the real releaseConfig.ts was not changed by this check', readFileSync(join(REPO, 'src', 'main', 'releaseConfig.ts'), 'utf8') === realConfigBefore)
check('D: the repo holds no private key', !/BEGIN PRIVATE KEY/.test(readFileSync(join(REPO, 'src', 'main', 'releaseConfig.ts'), 'utf8')) && !existsSync(join(REPO, 'release-key.pem')))
console.log(`(left, as the owner's rule wants: ${root})`)
process.exit(check.summary() ? 0 : 1)
