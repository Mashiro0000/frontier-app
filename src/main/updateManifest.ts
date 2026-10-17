import { createPublicKey, verify, type KeyObject } from 'crypto'

// The update manifest and its signature (Stage 18.3, D-050). No Electron imports: every rule is checked under plain Node.
//
// A release publishes two files: the installer, and `latest.json`, a small signed envelope:
//   { "format": 1, "payload": "<base64 of the manifest's exact bytes>", "signature": "<base64 of an Ed25519 signature over those bytes>" }
// The signature is over the payload's bytes as they are, so nothing has to be put in a canonical form first. The manifest itself:
//   { "app": "frontier-app", "version": "0.2.0", "date": "2026-10-20",
//     "installer": { "name": "frontier-app-0.2.0-setup.exe", "url": "https://github.com/<RELEASES_REPO>/releases/download/v0.2.0/frontier-app-0.2.0-setup.exe",
//                    "size": 114247821, "sha256": "<64 hex>" },
//     "notes": "What changed, plain text." }
//
// The rules, all of them or nothing:
//  - the envelope and the manifest are exactly what tools/release.mjs writes: no field more or less, every value of its kind, sizes capped;
//  - the signature is checked with the public key built into this program (releaseConfig.ts) BEFORE anything in the payload is read; with no key,
//    nothing is accepted;
//  - the app is this app; the version is plain x.y.z, and it must be HIGHER than the running version: an equal or lower one is refused (no downgrade,
//    and an old signed manifest replayed later is never newer);
//  - the installer's name carries the same version, its address is a download of THAT version from the releases repository, over HTTPS, and its size
//    and SHA-256 are given (the download is held to both, 18.5).

export const ENVELOPE_FORMAT = 1
export const MAX_ENVELOPE_BYTES = 64 * 1024
export const MAX_INSTALLER_BYTES = 512 * 1024 * 1024
export const MAX_NOTES_CHARS = 2000
const APP = 'frontier-app'
const VERSION = /^(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})$/
const DATE = /^\d{4}-\d{2}-\d{2}$/
const SHA256 = /^[0-9a-f]{64}$/
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/
const REPO = /^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/
// The DER prefix of an Ed25519 public key in SubjectPublicKeyInfo form; the 32 raw bytes follow it.
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex')

export interface UpdateManifest {
  app: string
  version: string
  date: string
  installer: { name: string; url: string; size: number; sha256: string }
  notes: string
}

/** `refused`: the file is not a valid signed release; `current`: the newest release is this version; `older`: it is lower (a downgrade, or an old file). */
export type ManifestResult =
  | { ok: true; manifest: UpdateManifest }
  | { ok: false; kind: 'refused' | 'current' | 'older'; reason: string }

export interface ManifestRules {
  /** The release key's public half: base64 of its 32 raw bytes (releaseConfig.ts). Empty: nothing is accepted. */
  publicKey: string
  /** "owner/name" of the releases repository. */
  repo: string
  /** The running app's version (app.getVersion()). */
  currentVersion: string
}

const isPlain = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const keysAre = (value: Record<string, unknown>, keys: string): boolean =>
  Object.keys(value).sort().join() === keys

/** The public key from base64 of its 32 raw bytes, or null when it is not one. */
export function releaseKey(publicKey: string): KeyObject | null {
  if (typeof publicKey !== 'string' || !BASE64.test(publicKey)) return null
  const raw = Buffer.from(publicKey, 'base64')
  if (raw.length !== 32 || raw.toString('base64') !== publicKey) return null
  try {
    return createPublicKey({
      key: Buffer.concat([ED25519_SPKI_PREFIX, raw]),
      format: 'der',
      type: 'spki'
    })
  } catch {
    return null
  }
}

/** -1, 0 or 1 for two plain x.y.z versions (both must be valid). */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1
  return 0
}

export const isVersion = (value: unknown): value is string =>
  typeof value === 'string' && VERSION.test(value)

/** The address an installer of `version` must have in `repo`. */
export const installerUrl = (repo: string, version: string, name: string): string =>
  `https://github.com/${repo}/releases/download/v${version}/${name}`

/** The address of the newest release's envelope in `repo`. */
export const envelopeUrl = (repo: string): string =>
  `https://github.com/${repo}/releases/latest/download/latest.json`

/** Reads and checks a downloaded envelope. Never throws. */
export function readSignedManifest(bytes: Uint8Array, rules: ManifestRules): ManifestResult {
  const no = (reason: string): ManifestResult => ({ ok: false, kind: 'refused', reason })
  const key = releaseKey(rules.publicKey)
  if (!key) return no('This build has no release key, so it cannot accept an update.')
  if (!REPO.test(rules.repo)) return no('This build names no releases repository.')
  if (!isVersion(rules.currentVersion)) return no('The running version could not be read.')
  if (!(bytes instanceof Uint8Array) || bytes.length === 0) return no('The update file is empty.')
  if (bytes.length > MAX_ENVELOPE_BYTES) return no('The update file is too large to be one.')

  // The envelope: strict JSON, exactly three fields.
  let envelope: unknown
  try {
    envelope = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes))
  } catch {
    return no('The update file is not what a release publishes.')
  }
  if (!isPlain(envelope) || !keysAre(envelope, 'format,payload,signature'))
    return no('The update file is not what a release publishes.')
  if (envelope.format !== ENVELOPE_FORMAT)
    return no('The update file is of a format this version does not know.')
  const { payload, signature } = envelope
  if (
    typeof payload !== 'string' ||
    typeof signature !== 'string' ||
    !BASE64.test(payload) ||
    !BASE64.test(signature)
  )
    return no('The update file is not what a release publishes.')
  const payloadBytes = Buffer.from(payload, 'base64')
  const signatureBytes = Buffer.from(signature, 'base64')
  if (
    payloadBytes.toString('base64') !== payload ||
    signatureBytes.toString('base64') !== signature ||
    signatureBytes.length !== 64
  )
    return no('The update file is not what a release publishes.')

  // The signature, before anything in the payload is read.
  let signed = false
  try {
    signed = verify(null, payloadBytes, key, signatureBytes)
  } catch {
    signed = false
  }
  if (!signed) return no('The update is not signed with the release key. Nothing was downloaded.')

  // The manifest: what release.mjs writes, and nothing else.
  let raw: unknown
  try {
    raw = JSON.parse(
      new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(payloadBytes)
    )
  } catch {
    return no('The signed update could not be read.')
  }
  if (!isPlain(raw) || !keysAre(raw, 'app,date,installer,notes,version'))
    return no('The signed update could not be read.')
  const { app, version, date, installer, notes } = raw
  if (app !== APP) return no('The signed update is for another app.')
  if (!isVersion(version)) return no('The signed update has no valid version.')
  if (typeof date !== 'string' || !DATE.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`)))
    return no('The signed update has no valid date.')
  if (typeof notes !== 'string' || notes.length > MAX_NOTES_CHARS)
    return no('The signed update could not be read.')
  if (!isPlain(installer) || !keysAre(installer, 'name,sha256,size,url'))
    return no('The signed update could not be read.')
  const { name, url, size, sha256 } = installer
  if (name !== `${APP}-${version}-setup.exe`)
    return no('The signed update names another installer.')
  if (url !== installerUrl(rules.repo, version, name))
    return no('The signed update points somewhere other than the releases repository.')
  if (
    typeof size !== 'number' ||
    !Number.isSafeInteger(size) ||
    size <= 0 ||
    size > MAX_INSTALLER_BYTES
  )
    return no('The signed update gives no valid size.')
  if (typeof sha256 !== 'string' || !SHA256.test(sha256))
    return no('The signed update gives no valid checksum.')

  // Newer, or nothing.
  const order = compareVersions(version, rules.currentVersion)
  if (order === 0)
    return { ok: false, kind: 'current', reason: `This is the newest version (${version}).` }
  if (order < 0)
    return {
      ok: false,
      kind: 'older',
      reason: `The newest release (${version}) is older than this version (${rules.currentVersion}); it is not installed.`
    }

  return {
    ok: true,
    manifest: Object.freeze({
      app,
      version,
      date,
      installer: Object.freeze({ name, url, size, sha256 }),
      notes
    })
  }
}
