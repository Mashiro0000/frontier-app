import { createHash, randomBytes, timingSafeEqual } from 'crypto'
import { OAUTH_LIMITS } from '../shared/oauth'
import { listenForCallback } from './oauthCallback'
import type { Discovery } from './oauthDiscovery'
import { checkNamedUrl, GuardError, type GuardedFetch, type GuardedResponse } from './oauthHttp'

// The sign-in itself (Stage 14b, D-046, slice 14b.3): authorization code with PKCE (S256) in the person's own browser, back to the listener of oauthCallback.ts. As the
// MCP specification (2026-07-28), OAuth 2.1 and RFC 8252 / 7636 / 8707 / 9207 / 7591 / 7009 say, and nothing more:
//   - a verifier of 64 random characters; the challenge is its SHA-256, in base64url; a `state` of 256 random bits; both made fresh for every sign-in and kept only in memory;
//   - the authorization address is BUILT from fields (never pasted together) and carries `resource` (RFC 8707: the address the token is for) and the redirect address;
//   - the answer is checked in this order before the code goes anywhere: the state, then the issuer by the specification's table (RFC 9207), and only then is `error` read;
//     nothing of what the provider wrote is shown (an error is told in the app's own words from its code);
//   - the token request carries the verifier and `resource`; the answer is read strictly (type Bearer, a visible token of a sane size, a sane life);
//   - the app registers itself with the provider (RFC 7591: a native client, no secret asked for) unless the person typed a client id; because the listener's port is new at
//     every sign-in, a registration is made at every sign-in, and its client id is kept for renewing the token;
//   - renewing and revoking use the same strict reading; revoking is best effort.
// Every request goes through the guard (oauthHttp.ts). No Electron imports: the system's browser is handed in.

export type ClientMethod = 'none' | 'client_secret_post' | 'client_secret_basic'
export interface ClientAuth {
  clientId: string
  clientSecret: string | null
  method: ClientMethod
}

export interface TokenSet {
  accessToken: string
  refreshToken: string | null
  /** Milliseconds since 1970 at which the access token ends. */
  expiresAt: number
  /** The permissions the provider says were granted, or null when it says nothing. */
  scopes: string[] | null
}

/** Everything the app keeps after a sign-in (sealed, in connectors.json; slice 14b.4). */
export interface AuthRecord {
  issuer: string
  tokenEndpoint: string
  revocationEndpoint: string | null
  resource: string
  client: ClientAuth
  /** Typed by the person (kept for the next sign-in) or registered by the app (made again at every sign-in). */
  clientKind: 'typed' | 'registered'
  scopes: string[]
  tokens: TokenSet
}

export type Failure = { ok: false; why: string; stopped?: true; error?: string }

const VISIBLE = /^[\x21-\x7e]+$/

// ---------------------------------------------------------------------- PKCE and state ----------------------------------------------------------------------

/** 64 characters of the unreserved set (RFC 7636 asks for 43 to 128), from 48 random bytes. */
export function newVerifier(): string {
  return randomBytes(48).toString('base64url')
}
/** BASE64URL(SHA256(verifier)) with no padding. */
export function challengeOf(verifier: string): string {
  return createHash('sha256').update(verifier, 'ascii').digest('base64url')
}
/** 256 random bits. */
export function newState(): string {
  return randomBytes(32).toString('base64url')
}

// ---------------------------------------------------------------------- the authorization address ------------------------------------------------------------

export interface AuthorizationInput {
  endpoint: string
  clientId: string
  redirectUri: string
  challenge: string
  state: string
  resource: string
  scopes: readonly string[]
  /** The connector's own address (decides what the guard allows an address to be). */
  anchor: string
}

export function buildAuthorizationUrl(
  input: AuthorizationInput
): { ok: true; url: string } | { ok: false; why: string } {
  const named = checkNamedUrl(input.endpoint, input.anchor)
  if (!named.ok) return { ok: false, why: 'The sign-in page is not an address the app opens.' }
  const url = new URL(named.url.href)
  // `set`, not `append`: whatever the provider's address already says about these fields, the app's words are the ones sent
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', input.clientId)
  url.searchParams.set('redirect_uri', input.redirectUri)
  url.searchParams.set('code_challenge', input.challenge)
  url.searchParams.set('code_challenge_method', 'S256')
  url.searchParams.set('state', input.state)
  url.searchParams.set('resource', input.resource)
  if (input.scopes.length > 0) url.searchParams.set('scope', input.scopes.join(' '))
  else url.searchParams.delete('scope')
  const text = url.href
  if (text.length > OAUTH_LIMITS.urlChars || !/^[\x21-\x7e]+$/.test(text)) {
    return { ok: false, why: 'The sign-in address would be longer than the app sends.' }
  }
  return { ok: true, url: text }
}

// ---------------------------------------------------------------------- the answer of the browser ---------------------------------------------------------------

const ERROR_WORDS: Record<string, string> = {
  access_denied: 'You did not allow the sign-in.',
  invalid_grant: 'The provider no longer accepts this sign-in.',
  invalid_client:
    'The provider does not know this app (the client id is wrong, or was taken back).',
  invalid_scope: 'The provider does not give the permissions that were asked for.',
  unauthorized_client: 'The provider does not let this app sign in.',
  server_error: 'The provider had a problem.',
  temporarily_unavailable: 'The provider is busy. Try again in a moment.',
  login_required: 'The provider wants you to sign in to it first.',
  consent_required: 'The provider wants your consent first.',
  interaction_required: 'The provider wants you to do something on its page first.'
}
const wordsOf = (code: string | null): string =>
  code !== null && Object.prototype.hasOwnProperty.call(ERROR_WORDS, code)
    ? ERROR_WORDS[code]
    : code === null
      ? 'The provider refused.'
      : `The provider refused (${code}).`
const ERROR_CODE = /^[A-Za-z0-9_.-]{1,40}$/

const same = (a: string, b: string): boolean => {
  const x = Buffer.from(a, 'utf8')
  const y = Buffer.from(b, 'utf8')
  return x.length === y.length && timingSafeEqual(x, y)
}

export interface Expected {
  state: string
  /** The issuer recorded from the provider's document, exactly as it was written. */
  issuer: string
  /** The provider's document promised an `iss` in every answer. */
  issResponse: boolean
}

export type Checked =
  | { ok: true; code: string }
  | { ok: false; kind: 'state' | 'issuer' | 'refused' | 'malformed'; why: string; error?: string }

/** The parameters of the browser's way back, judged in the specification's order. */
export function checkAuthorizationResponse(
  params: Readonly<Record<string, string>>,
  expected: Expected
): Checked {
  if (typeof params.state !== 'string' || !same(params.state, expected.state)) {
    return {
      ok: false,
      kind: 'state',
      why: 'The answer did not belong to this sign-in. It was ignored.'
    }
  }
  // RFC 9207 section 2.4, as the specification's table has it; a plain string comparison, no normalising of any kind
  const iss = params.iss
  if (iss !== undefined) {
    if (iss !== expected.issuer) {
      return {
        ok: false,
        kind: 'issuer',
        why: 'The answer came from a different provider than the one the app asked. It was ignored.'
      }
    }
  } else if (expected.issResponse) {
    return {
      ok: false,
      kind: 'issuer',
      why: 'The answer did not say which provider it came from, though the provider promised to. It was ignored.'
    }
  }
  if (params.error !== undefined) {
    const code = ERROR_CODE.test(params.error) ? params.error : null
    return {
      ok: false,
      kind: 'refused',
      why: wordsOf(code),
      ...(code === null ? {} : { error: code })
    }
  }
  const code = params.code
  if (
    typeof code !== 'string' ||
    code.length < 1 ||
    code.length > OAUTH_LIMITS.urlChars ||
    !VISIBLE.test(code)
  ) {
    return { ok: false, kind: 'malformed', why: 'The answer held no usable code.' }
  }
  return { ok: true, code }
}

// ---------------------------------------------------------------------- requests to the provider ------------------------------------------------------------------

const clean = (error: unknown, fallback: string): Failure => {
  if (error instanceof GuardError) {
    return error.code === 'stopped'
      ? { ok: false, why: error.message, stopped: true }
      : { ok: false, why: error.message }
  }
  return { ok: false, why: fallback }
}

function clientHeaders(client: ClientAuth | null): Record<string, string> {
  if (client === null || client.method !== 'client_secret_basic' || client.clientSecret === null)
    return {}
  const pair = `${encodeURIComponent(client.clientId)}:${encodeURIComponent(client.clientSecret)}`
  return { authorization: `Basic ${Buffer.from(pair, 'utf8').toString('base64')}` }
}
function clientFields(client: ClientAuth | null): Record<string, string> {
  if (client === null) return {}
  if (client.method === 'client_secret_post' && client.clientSecret !== null)
    return { client_id: client.clientId, client_secret: client.clientSecret }
  return { client_id: client.clientId }
}

async function postForm(
  guarded: GuardedFetch,
  url: string,
  fields: Record<string, string>,
  client: ClientAuth | null,
  signal: AbortSignal | undefined,
  timeoutMs?: number
): Promise<GuardedResponse> {
  return guarded(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', ...clientHeaders(client) },
    body: new URLSearchParams({ ...fields, ...clientFields(client) }).toString(),
    ...(signal === undefined ? {} : { signal }),
    ...(timeoutMs === undefined ? {} : { timeoutMs })
  })
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** The token answer, read strictly. `previousRefresh` is kept when a renewal brings no new refresh token (the provider did not rotate it). */
export function readTokens(
  answer: GuardedResponse,
  now: number,
  previousRefresh: string | null
): { ok: true; tokens: TokenSet } | Failure {
  const body = answer.json
  if (answer.status !== 200) {
    const code =
      isObject(body) && typeof body.error === 'string' && ERROR_CODE.test(body.error)
        ? body.error
        : null
    return { ok: false, why: wordsOf(code), ...(code === null ? {} : { error: code }) }
  }
  if (!isObject(body))
    return { ok: false, why: 'The provider answered with something that is not a token.' }
  const access = body.access_token
  if (
    typeof access !== 'string' ||
    access.length < 1 ||
    access.length > OAUTH_LIMITS.tokenChars ||
    !VISIBLE.test(access)
  ) {
    return { ok: false, why: 'The provider gave no usable token.' }
  }
  if (typeof body.token_type !== 'string' || body.token_type.toLowerCase() !== 'bearer') {
    return { ok: false, why: 'The provider gave a kind of token the app does not use.' }
  }
  let seconds: number = OAUTH_LIMITS.defaultLifeSeconds
  if (body.expires_in !== undefined) {
    if (typeof body.expires_in !== 'number' || !Number.isFinite(body.expires_in)) {
      return { ok: false, why: 'The provider gave a token with a life the app cannot read.' }
    }
    seconds = Math.min(
      Math.max(body.expires_in, OAUTH_LIMITS.minLifeSeconds),
      OAUTH_LIMITS.maxLifeSeconds
    )
  }
  let refresh: string | null = previousRefresh
  if (body.refresh_token !== undefined) {
    const r = body.refresh_token
    if (
      typeof r !== 'string' ||
      r.length < 1 ||
      r.length > OAUTH_LIMITS.tokenChars ||
      !VISIBLE.test(r)
    ) {
      return { ok: false, why: 'The provider gave a renewal token the app cannot use.' }
    }
    refresh = r
  }
  let scopes: string[] | null = null
  if (typeof body.scope === 'string') {
    const parts = body.scope.split(/ +/).filter((s) => s !== '')
    if (
      parts.length <= OAUTH_LIMITS.scopes &&
      parts.every((s) => /^[\x21\x23-\x5b\x5d-\x7e]{1,100}$/.test(s))
    )
      scopes = [...new Set(parts)]
  }
  return {
    ok: true,
    tokens: {
      accessToken: access,
      refreshToken: refresh,
      expiresAt: now + Math.round(seconds * 1000),
      scopes
    }
  }
}

export async function exchangeCode(input: {
  guarded: GuardedFetch
  tokenEndpoint: string
  client: ClientAuth
  code: string
  verifier: string
  redirectUri: string
  resource: string
  now: number
  signal?: AbortSignal
}): Promise<{ ok: true; tokens: TokenSet } | Failure> {
  try {
    const answer = await postForm(
      input.guarded,
      input.tokenEndpoint,
      {
        grant_type: 'authorization_code',
        code: input.code,
        redirect_uri: input.redirectUri,
        code_verifier: input.verifier,
        resource: input.resource
      },
      input.client,
      input.signal
    )
    return readTokens(answer, input.now, null)
  } catch (error) {
    return clean(error, 'The provider could not be reached for the token.')
  }
}

export async function refreshTokens(input: {
  guarded: GuardedFetch
  tokenEndpoint: string
  client: ClientAuth
  refreshToken: string
  resource: string
  now: number
  signal?: AbortSignal
}): Promise<{ ok: true; tokens: TokenSet } | Failure> {
  try {
    const answer = await postForm(
      input.guarded,
      input.tokenEndpoint,
      { grant_type: 'refresh_token', refresh_token: input.refreshToken, resource: input.resource },
      input.client,
      input.signal
    )
    return readTokens(answer, input.now, input.refreshToken)
  } catch (error) {
    return clean(error, 'The provider could not be reached to renew the token.')
  }
}

/** Asks the provider to revoke a token (RFC 7009). Best effort: the answer is only whether the provider said yes. */
export async function revokeToken(input: {
  guarded: GuardedFetch
  revocationEndpoint: string
  client: ClientAuth
  token: string
  hint: 'access_token' | 'refresh_token'
  signal?: AbortSignal
}): Promise<boolean> {
  try {
    const answer = await postForm(
      input.guarded,
      input.revocationEndpoint,
      { token: input.token, token_type_hint: input.hint },
      input.client,
      input.signal,
      OAUTH_LIMITS.revokeMs
    )
    return answer.status === 200
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------- registering the app ----------------------------------------------------------------------

export const CLIENT_NAME = 'Frontier App'

export async function registerClient(input: {
  guarded: GuardedFetch
  endpoint: string
  redirectUri: string
  scopes: readonly string[]
  signal?: AbortSignal
}): Promise<{ ok: true; client: ClientAuth } | Failure> {
  try {
    const request = {
      client_name: CLIENT_NAME,
      redirect_uris: [input.redirectUri],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      application_type: 'native',
      ...(input.scopes.length > 0 ? { scope: input.scopes.join(' ') } : {})
    }
    const answer = await input.guarded(input.endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request),
      ...(input.signal === undefined ? {} : { signal: input.signal })
    })
    if (answer.status !== 200 && answer.status !== 201)
      return { ok: false, why: 'The provider did not register the app.' }
    const body = answer.json
    if (!isObject(body))
      return {
        ok: false,
        why: 'The provider answered the registration with something that is not one.'
      }
    const id = body.client_id
    if (typeof id !== 'string' || id.length > 256 || !VISIBLE.test(id))
      return { ok: false, why: 'The provider gave no usable client id.' }
    const secret = body.client_secret === undefined ? null : body.client_secret
    if (
      secret !== null &&
      (typeof secret !== 'string' ||
        secret.length < 1 ||
        secret.length > 1000 ||
        !VISIBLE.test(secret))
    ) {
      return { ok: false, why: 'The provider gave a client secret the app cannot use.' }
    }
    const said =
      body.token_endpoint_auth_method === undefined
        ? secret === null
          ? 'none'
          : 'client_secret_basic'
        : body.token_endpoint_auth_method
    if (said !== 'none' && said !== 'client_secret_post' && said !== 'client_secret_basic') {
      return {
        ok: false,
        why: 'The provider wants the app to prove itself in a way the app does not know.'
      }
    }
    if (said !== 'none' && secret === null)
      return { ok: false, why: 'The provider registered the app without the secret it asks for.' }
    if (body.redirect_uris !== undefined) {
      const uris = body.redirect_uris
      if (!Array.isArray(uris) || uris.length !== 1 || uris[0] !== input.redirectUri) {
        return {
          ok: false,
          why: 'The provider registered a different return address than the one the app gave.'
        }
      }
    }
    return {
      ok: true,
      client: { clientId: id, clientSecret: said === 'none' ? null : secret, method: said }
    }
  } catch (error) {
    return clean(error, 'The provider could not be reached to register the app.')
  }
}

// ---------------------------------------------------------------------- the whole sign-in --------------------------------------------------------------------------

export type ClientChoice =
  { kind: 'register' } | { kind: 'typed'; clientId: string; clientSecret: string | null }

export interface SignInInput {
  /** The connector's address as typed. */
  mcpUrl: string
  found: Discovery
  client: ClientChoice
  guarded: GuardedFetch
  /** Hands the address to the system's browser. False when it was not opened. */
  open: (url: string) => Promise<boolean>
  now: () => number
  signal?: AbortSignal
  /** For the checks: a shorter wait. */
  waitMs?: number
}

export async function runSignIn(
  input: SignInInput
): Promise<{ ok: true; auth: AuthRecord } | Failure> {
  const { found, guarded, signal } = input
  const verifier = newVerifier()
  const state = newState()
  let listener
  try {
    listener = await listenForCallback({
      state,
      ...(input.waitMs === undefined ? {} : { ms: input.waitMs }),
      ...(signal === undefined ? {} : { signal })
    })
  } catch {
    return {
      ok: false,
      why: 'The app could not open the small place the browser comes back to on this PC.'
    }
  }
  try {
    // the client: typed by the person, or registered now (the return address has a new port every time)
    let client: ClientAuth
    if (input.client.kind === 'typed') {
      // with a secret: the way the provider lists, basic unless it lists only the other
      const basic =
        found.tokenAuthMethods.includes('client_secret_basic') ||
        !found.tokenAuthMethods.includes('client_secret_post')
      const method: ClientMethod =
        input.client.clientSecret === null
          ? 'none'
          : basic
            ? 'client_secret_basic'
            : 'client_secret_post'
      client = { clientId: input.client.clientId, clientSecret: input.client.clientSecret, method }
    } else {
      if (found.registrationEndpoint === null) {
        return {
          ok: false,
          why: 'The provider does not register apps by itself. Register the app there and type the client id.'
        }
      }
      const registered = await registerClient({
        guarded,
        endpoint: found.registrationEndpoint,
        redirectUri: listener.redirectUri,
        scopes: found.scopes,
        ...(signal === undefined ? {} : { signal })
      })
      if (!registered.ok) return registered
      client = registered.client
    }
    const url = buildAuthorizationUrl({
      endpoint: found.authorizationEndpoint,
      clientId: client.clientId,
      redirectUri: listener.redirectUri,
      challenge: challengeOf(verifier),
      state,
      resource: found.resource,
      scopes: found.scopes,
      anchor: input.mcpUrl
    })
    if (!url.ok) return { ok: false, why: url.why }
    if (!(await input.open(url.url))) return { ok: false, why: 'The browser was not opened.' }
    const end = await listener.done
    if (!end.ok) {
      const why: Record<string, string> = {
        timeout: 'The sign-in was not finished in time.',
        cancelled: 'The sign-in was cancelled.',
        stopped: 'The sign-in was stopped.',
        malformed: 'The answer of the browser could not be read.',
        noise: 'Too many requests came to the place the browser comes back to.'
      }
      return {
        ok: false,
        why: why[end.why],
        ...(end.why === 'stopped' || end.why === 'cancelled' ? { stopped: true as const } : {})
      }
    }
    const checked = checkAuthorizationResponse(end.params, {
      state,
      issuer: found.issuer,
      issResponse: found.issResponse
    })
    if (!checked.ok)
      return {
        ok: false,
        why: checked.why,
        ...(checked.error === undefined ? {} : { error: checked.error })
      }
    const exchanged = await exchangeCode({
      guarded,
      tokenEndpoint: found.tokenEndpoint,
      client,
      code: checked.code,
      verifier,
      redirectUri: listener.redirectUri,
      resource: found.resource,
      now: input.now(),
      ...(signal === undefined ? {} : { signal })
    })
    if (!exchanged.ok) return exchanged
    return {
      ok: true,
      auth: {
        issuer: found.issuer,
        tokenEndpoint: found.tokenEndpoint,
        revocationEndpoint: found.revocationEndpoint,
        resource: found.resource,
        client,
        clientKind: input.client.kind === 'typed' ? 'typed' : 'registered',
        scopes: exchanged.tokens.scopes ?? found.scopes,
        tokens: exchanged.tokens
      }
    }
  } finally {
    listener.cancel()
  }
}
