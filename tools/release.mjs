// The owner's release tool (Stage 18.7, D-050). It NEVER uploads anything and has no network code: it makes the key, builds, hashes and signs; the owner attaches the two
// files to a release of the public releases repository by hand.
//
//   node tools/release.mjs keygen
//       Makes the owner's Ed25519 release key pair. The private half goes to %USERPROFILE%\.frontier-release\release-key.pem (never into the repo, never overwritten:
//       if a key is there, nothing is done), the public half into src/main/releaseConfig.ts (only while it is empty). Build after this: the installed app accepts only
//       updates signed with this key. Keep a copy of the private key somewhere safe: without it no update can ever be signed for the installed apps again.
//
//   node tools/release.mjs sign --notes "What changed" [--date 2026-10-20] [--no-build]
//       Builds the installer (npm run build:win) unless --no-build, then writes dist/latest.json for the version in package.json: the installer's name, its address in the
//       releases repository, size and SHA-256, signed with the private key. It reads the result back with the app's own reader before it says it is done.
//       Then: make a release named v<version> in the releases repository and attach dist/frontier-app-<version>-setup.exe and dist/latest.json.
//
//   node tools/release.mjs verify [dist/latest.json]
//       Reads a latest.json with the app's own reader and the build's public key, and prints what it says.
//
// For the checks only: --key-dir, --config, --installer, --out, --version, --public, --repo point the tool somewhere else.
import './ts-resolve.mjs'
import { createHash, createPublicKey } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { REPO, REPO_URL } from './paths.mjs'
import { envelope, manifestFor, newKeyPair, privateFromPem, rawPublic } from './release-lib.mjs'

const [command, ...rest] = process.argv.slice(2)
const flags = {}
for (let i = 0; i < rest.length; i++) {
  const a = rest[i]
  if (!a.startsWith('--')) { flags._ = a; continue }
  const name = a.slice(2)
  if (name === 'no-build') flags.noBuild = true
  else flags[name] = rest[++i]
}
const fail = (text) => { console.error(`release.mjs: ${text}`); process.exit(1) }
const CONFIG = flags.config ?? join(REPO, 'src', 'main', 'releaseConfig.ts')
const KEY_DIR = flags['key-dir'] ?? join(homedir(), '.frontier-release')
const KEY_FILE = flags.key ?? join(KEY_DIR, 'release-key.pem')
const KEY_LINE = /^export const RELEASE_PUBLIC_KEY = '([A-Za-z0-9+/=]*)'$/m
const REPO_LINE = /^export const RELEASES_REPO = '([^']*)'$/m
const configText = () => readFileSync(CONFIG, 'utf8')
const configKey = () => (configText().match(KEY_LINE) ?? [])[1]
const configRepo = () => (configText().match(REPO_LINE) ?? [])[1]
const M = await import(`${REPO_URL}/src/main/updateManifest.ts`)

if (command === 'keygen') {
  if (existsSync(KEY_FILE)) fail(`a release key is already at ${KEY_FILE}; nothing was changed (this tool never overwrites a key).`)
  const current = configKey()
  if (current === undefined) fail(`${CONFIG} has no RELEASE_PUBLIC_KEY line this tool can read.`)
  if (current !== '') fail(`${CONFIG} already holds a public key; nothing was changed. Put the matching private key at ${KEY_FILE}.`)
  const keys = newKeyPair()
  mkdirSync(KEY_DIR, { recursive: true })
  writeFileSync(KEY_FILE, keys.privateKey.export({ format: 'pem', type: 'pkcs8' }), { flag: 'wx', mode: 0o600 })
  writeFileSync(CONFIG, configText().replace(KEY_LINE, `export const RELEASE_PUBLIC_KEY = '${keys.publicBase64}'`))
  console.log(`The private key is at ${KEY_FILE}. Keep a copy somewhere safe and never share it.`)
  console.log(`The public key (${keys.publicBase64}) is now in ${CONFIG}. Build and commit: the installed app accepts only updates signed with this key.`)
  process.exit(0)
}

if (command === 'sign') {
  const pkg = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8'))
  const version = flags.version ?? pkg.version
  if (!M.isVersion(version)) fail(`the version "${version}" is not x.y.z.`)
  const repo = flags.repo ?? configRepo()
  const date = flags.date ?? new Date().toISOString().slice(0, 10)
  const notes = flags.notes ?? ''
  if (notes.length > M.MAX_NOTES_CHARS) fail(`the notes are longer than ${M.MAX_NOTES_CHARS} characters.`)
  if (!existsSync(KEY_FILE)) fail(`no private key at ${KEY_FILE} (node tools/release.mjs keygen makes one).`)
  let privateKey
  try { privateKey = privateFromPem(readFileSync(KEY_FILE, 'utf8')) } catch { fail(`${KEY_FILE} is not a private key.`) }
  if (privateKey.asymmetricKeyType !== 'ed25519') fail(`${KEY_FILE} is not an Ed25519 key.`)
  const publicKey = flags.public ?? configKey()
  if (rawPublic(createPublicKey(privateKey)) !== publicKey) fail('the private key does not match the public key in releaseConfig.ts; nothing was signed.')
  if (!flags.noBuild && !flags.installer) {
    const env = { ...process.env, ELECTRON_BUILDER_CACHE: process.env.ELECTRON_BUILDER_CACHE ?? 'C:\\frontier-build-cache' }
    const built = spawnSync('npm', ['run', 'build:win'], { cwd: REPO, stdio: 'inherit', shell: true, env })
    if (built.status !== 0) fail('the build failed; nothing was signed.')
  }
  const out = flags.out ?? join(REPO, 'dist')
  const installerPath = flags.installer ?? join(out, `frontier-app-${version}-setup.exe`)
  if (!existsSync(installerPath)) fail(`no installer at ${installerPath}.`)
  const manifest = manifestFor({ repo, version, date, notes, installerPath })
  const bytes = envelope(manifest, privateKey)
  // Read back with the app's own reader before anything is said to be done: as an app one version lower would read it.
  const back = M.readSignedManifest(bytes, { publicKey, repo, currentVersion: '0.0.0' })
  if (!back.ok) fail(`the signed file does not read back (${back.reason}); nothing was written.`)
  mkdirSync(out, { recursive: true })
  writeFileSync(join(out, 'latest.json'), bytes)
  console.log(`Signed ${manifest.installer.name}: ${manifest.installer.size} bytes, SHA-256 ${manifest.installer.sha256}.`)
  console.log(`Wrote ${join(out, 'latest.json')}. Nothing was uploaded.`)
  console.log(`Next: in github.com/${repo}, make a release named v${version} and attach ${installerPath} and ${join(out, 'latest.json')}.`)
  console.log(`Publish the SHA-256 above in the release's text too, so a first install can be checked by hand (Get-FileHash).`)
  process.exit(0)
}

if (command === 'verify') {
  const file = flags._ ?? join(REPO, 'dist', 'latest.json')
  const bytes = readFileSync(file)
  const result = M.readSignedManifest(bytes, { publicKey: flags.public ?? configKey(), repo: flags.repo ?? configRepo(), currentVersion: flags.version ?? '0.0.0' })
  if (!result.ok) fail(result.reason)
  const i = result.manifest.installer
  console.log(`${file}: version ${result.manifest.version} (${result.manifest.date}), ${i.name}, ${i.size} bytes, SHA-256 ${i.sha256}, from ${i.url}`)
  if (flags.installer) {
    const b = readFileSync(flags.installer)
    const match = b.length === i.size && createHash('sha256').update(b).digest('hex') === i.sha256
    console.log(match ? 'The installer matches.' : 'The installer does NOT match.')
    process.exit(match ? 0 : 1)
  }
  process.exit(0)
}

fail('usage: node tools/release.mjs keygen | sign --notes "..." [--date YYYY-MM-DD] [--no-build] | verify [file]')
