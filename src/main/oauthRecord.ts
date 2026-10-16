import { OAUTH_LIMITS } from '../shared/oauth'
import type { SecretBox } from './credentialStore'
import type { AuthRecord, ClientMethod } from './oauthFlow'

// What the app keeps of a sign-in (Stage 14b, D-046, slice 14b.4): ONE record per connector, sealed whole by the system's secure storage (the same box as the saved keys and the
// pasted tokens) and kept as base64 in connectors.json. Nothing of it is ever written in the clear: not the tokens, not the client secret, and not the provider's addresses.
// Read back STRICTLY, like every document the app keeps: exactly the fields this app writes, each of the right kind and size, or it is not a record (and the connector counts as
// signed out). A box that cannot be used (the key is gone, the file is for another account) gives no record. No Electron imports.

const RECORD_VERSION = 1
const VISIBLE = /^[\x21-\x7e]+$/
const SCOPE = /^[\x21\x23-\x5b\x5d-\x7e]{1,100}$/

const isPlain = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

function exactKeys(raw: Record<string, unknown>, keys: readonly string[]): boolean {
  const have = Object.keys(raw)
  return (
    have.length === keys.length &&
    keys.every((key) => Object.prototype.hasOwnProperty.call(raw, key))
  )
}
const visible = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.length >= 1 && value.length <= max && VISIBLE.test(value)
const address = (value: unknown): value is string => {
  if (!visible(value, OAUTH_LIMITS.urlChars)) return false
  try {
    const url = new URL(value)
    return (
      (url.protocol === 'https:' || url.protocol === 'http:') &&
      url.username === '' &&
      url.password === '' &&
      url.hash === ''
    )
  } catch {
    return false
  }
}
function scopeList(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > OAUTH_LIMITS.scopes) return null
  for (const s of value as unknown[]) if (typeof s !== 'string' || !SCOPE.test(s)) return null
  return [...(value as string[])]
}

const KEYS = [
  'version',
  'issuer',
  'tokenEndpoint',
  'revocationEndpoint',
  'resource',
  'client',
  'clientKind',
  'scopes',
  'tokens'
] as const
const CLIENT_KEYS = ['clientId', 'clientSecret', 'method'] as const
const TOKEN_KEYS = ['accessToken', 'refreshToken', 'expiresAt', 'scopes'] as const

/** The record in a text, or null when it is not exactly what this app writes. */
export function parseAuthRecord(text: string): AuthRecord | null {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return null
  }
  if (!isPlain(raw) || !exactKeys(raw, KEYS) || raw.version !== RECORD_VERSION) return null
  if (!address(raw.issuer) || !address(raw.tokenEndpoint) || !address(raw.resource)) return null
  if (raw.revocationEndpoint !== null && !address(raw.revocationEndpoint)) return null
  if (raw.clientKind !== 'typed' && raw.clientKind !== 'registered') return null
  const client = raw.client
  if (!isPlain(client) || !exactKeys(client, CLIENT_KEYS)) return null
  if (!visible(client.clientId, 256)) return null
  if (client.clientSecret !== null && !visible(client.clientSecret, 1000)) return null
  if (
    client.method !== 'none' &&
    client.method !== 'client_secret_post' &&
    client.method !== 'client_secret_basic'
  )
    return null
  if ((client.method === 'none') !== (client.clientSecret === null)) return null
  const scopes = scopeList(raw.scopes)
  if (scopes === null) return null
  const tokens = raw.tokens
  if (!isPlain(tokens) || !exactKeys(tokens, TOKEN_KEYS)) return null
  if (!visible(tokens.accessToken, OAUTH_LIMITS.tokenChars)) return null
  if (tokens.refreshToken !== null && !visible(tokens.refreshToken, OAUTH_LIMITS.tokenChars))
    return null
  if (
    typeof tokens.expiresAt !== 'number' ||
    !Number.isSafeInteger(tokens.expiresAt) ||
    tokens.expiresAt < 0
  )
    return null
  const granted = tokens.scopes === null ? null : scopeList(tokens.scopes)
  if (tokens.scopes !== null && granted === null) return null
  return {
    issuer: raw.issuer,
    tokenEndpoint: raw.tokenEndpoint,
    revocationEndpoint: raw.revocationEndpoint as string | null,
    resource: raw.resource,
    client: {
      clientId: client.clientId,
      clientSecret: client.clientSecret as string | null,
      method: client.method as ClientMethod
    },
    clientKind: raw.clientKind,
    scopes,
    tokens: {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken as string | null,
      expiresAt: tokens.expiresAt,
      scopes: granted
    }
  }
}

/** The record's own text. */
export function authRecordText(r: AuthRecord): string {
  return JSON.stringify({
    version: RECORD_VERSION,
    issuer: r.issuer,
    tokenEndpoint: r.tokenEndpoint,
    revocationEndpoint: r.revocationEndpoint,
    resource: r.resource,
    client: {
      clientId: r.client.clientId,
      clientSecret: r.client.clientSecret,
      method: r.client.method
    },
    clientKind: r.clientKind,
    scopes: [...r.scopes],
    tokens: {
      accessToken: r.tokens.accessToken,
      refreshToken: r.tokens.refreshToken,
      expiresAt: r.tokens.expiresAt,
      scopes: r.tokens.scopes === null ? null : [...r.tokens.scopes]
    }
  })
}

/** The record sealed, as base64. Throws when the box cannot seal (the caller refuses the sign-in: there is no plain-text fallback). */
export function sealAuth(box: SecretBox, record: AuthRecord): string {
  if (!box.isAvailable()) throw new Error('This PC has no secure place to keep a sign-in.')
  return box.encrypt(authRecordText(record)).toString('base64')
}

/** The record from its sealed text, or null: the box cannot open it, or what it holds is not a record. */
export function unsealAuth(box: SecretBox, sealed: string): AuthRecord | null {
  try {
    return parseAuthRecord(box.decrypt(Buffer.from(sealed, 'base64')))
  } catch {
    return null
  }
}

/** Every secret in a record, for the places that look for secrets in text (the access token, the renewal token, the client secret). */
export function secretsOf(record: AuthRecord): string[] {
  return [record.tokens.accessToken, record.tokens.refreshToken, record.client.clientSecret].filter(
    (s): s is string => s !== null && s !== ''
  )
}
