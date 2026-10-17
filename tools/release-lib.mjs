// The signing side of Stage 18's updates (D-050): what tools/release.mjs writes, and what the checks use to make signed files with a key of their own.
// The app only ever READS these files (src/main/updateManifest.ts); it has no private key and no code that signs.
import { createHash, createPrivateKey, generateKeyPairSync, sign } from 'node:crypto'
import { readFileSync } from 'node:fs'

export const ENVELOPE_FORMAT = 1

/** A new Ed25519 key pair; the public half as base64 of its 32 raw bytes, as releaseConfig.ts holds it. */
export function newKeyPair() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  return { publicKey, privateKey, publicBase64: rawPublic(publicKey) }
}

/** base64 of the 32 raw bytes of an Ed25519 public key. */
export const rawPublic = (publicKey) => publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64')

/** A private key from a PEM file's text. */
export const privateFromPem = (pem) => createPrivateKey({ key: pem, format: 'pem' })

/** The manifest of an installer file, as release.mjs writes it. */
export function manifestFor({ repo, version, date, notes = '', installerPath, size, sha256 }) {
  const name = `frontier-app-${version}-setup.exe`
  if (installerPath) {
    const bytes = readFileSync(installerPath)
    size = bytes.length
    sha256 = createHash('sha256').update(bytes).digest('hex')
  }
  return { app: 'frontier-app', version, date, installer: { name, url: `https://github.com/${repo}/releases/download/v${version}/${name}`, size, sha256 }, notes }
}

/** The envelope's bytes for a payload (a manifest object, or exact bytes), signed with `privateKey`. `tamper` changes things AFTER signing, for the checks. */
export function envelope(payload, privateKey, tamper = {}) {
  const payloadBytes = Buffer.isBuffer(payload) ? payload : Buffer.from(JSON.stringify(payload), 'utf8')
  const signature = sign(null, tamper.signOver ?? payloadBytes, privateKey)
  const body = { format: ENVELOPE_FORMAT, payload: payloadBytes.toString('base64'), signature: signature.toString('base64'), ...(tamper.fields ?? {}) }
  return Buffer.from(JSON.stringify(body), 'utf8')
}
