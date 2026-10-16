import { OAUTH_LIMITS } from '../shared/oauth'
import { oneLine } from './mcpClient'
import { checkNamedUrl, GuardError, refusedAddress, type GuardedFetch } from './oauthHttp'

// Finding the sign-in provider of a web connector (Stage 14b, D-046, slice 14b.2), as the MCP specification (2026-07-28) and the RFCs under it say, and no more:
//   1. The connector answered 401 (or 403) with a `WWW-Authenticate: Bearer` challenge. `parseChallenge` reads it: the address of the connector's own document about its
//      sign-in (`resource_metadata`) and the permissions it asks for (`scope`). Nothing else of the header is used, and nothing of it is shown as it is.
//   2. That document (RFC 9728): at the address in the challenge when there is one, else at the two well-known addresses in the specification's order. Its `resource` must be
//      THE ADDRESS THE PERSON TYPED (in the specification's canonical form), or the document is about something else and is refused. It names the providers (at most three
//      are looked at).
//   3. The provider's own document (RFC 8414 / OpenID Connect): at the well-known addresses in the specification's order. Its `issuer` must be identical to the address it
//      was found at (a document found at one address that claims another is refused: it is how a hostile one passes for an honest one). It must offer the S256 form of
//      PKCE (the specification: refuse to go on when the list is absent), and every address in it must be one the app uses (https; no name or password; not inside a network).
//   4. The permissions: the challenge's, else the document's `scopes_supported`, else none; `offline_access` only when the provider lists it (it means "stay signed in").
// Every request goes through the guard of oauthHttp.ts. At most OAUTH_LIMITS.discoveryRequests requests in one attempt. Failures are sentences of the app's own: a host name is
// quoted cleaned and cut, nothing else of what a server said. No Electron imports.

const SCOPE = /^[\x21\x23-\x5b\x5d-\x7e]{1,100}$/

export interface Challenge {
  /** A `Bearer` challenge was there. */
  bearer: boolean
  /** The address of the connector's document about its sign-in, as written; null when the challenge has none. */
  resourceMetadata: string | null
  /** The permissions asked for, or null when none are named. */
  scope: string[] | null
  /** The challenge named permissions that are not permissions (a quote, a backslash, too long, too many): the sign-in is refused. */
  scopeBad: boolean
  /** The `error` of the challenge (`invalid_token`, `insufficient_scope`, ...), cleaned, or null. */
  error: string | null
}

interface Param {
  name: string
  value: string
}
interface Parsed {
  scheme: string
  params: Param[]
}

/** The challenges of a `WWW-Authenticate` header (RFC 9110 section 11.6.1): schemes and their `name=value` parameters, values bare or quoted. */
function parseChallenges(header: string): Parsed[] {
  const text = header.slice(0, 8000)
  const found: Parsed[] = []
  let current: Parsed | null = null
  let i = 0
  const skip = (): void => {
    while (i < text.length && (text[i] === ' ' || text[i] === '\t' || text[i] === ',')) i++
  }
  const token = (): string => {
    const start = i
    while (i < text.length && !/[\s=,"]/.test(text[i])) i++
    return text.slice(start, i)
  }
  let guardCount = 0
  while (i < text.length && guardCount++ < 400) {
    skip()
    if (i >= text.length) break
    const name = token()
    if (name === '') {
      i++ // a stray quote or equals sign
      continue
    }
    const afterName = i
    while (i < text.length && (text[i] === ' ' || text[i] === '\t')) i++
    if (text[i] === '=' && current !== null) {
      i++
      while (i < text.length && (text[i] === ' ' || text[i] === '\t')) i++
      let value = ''
      if (text[i] === '"') {
        i++
        while (i < text.length && text[i] !== '"') {
          if (text[i] === '\\' && i + 1 < text.length) i++
          value += text[i]
          i++
        }
        i++ // the closing quote
      } else {
        const start = i
        while (i < text.length && !/[\s,]/.test(text[i])) i++
        value = text.slice(start, i)
      }
      if (current.params.length < 20) current.params.push({ name: name.toLowerCase(), value })
    } else {
      // a scheme (the parameters, if any, follow)
      i = afterName
      current = { scheme: name.toLowerCase(), params: [] }
      found.push(current)
      if (found.length >= 10) break
    }
  }
  return found
}

/** The part of a `WWW-Authenticate` header that the sign-in uses. */
export function parseChallenge(header: string | null): Challenge {
  const none: Challenge = {
    bearer: false,
    resourceMetadata: null,
    scope: null,
    scopeBad: false,
    error: null
  }
  if (header === null) return none
  const bearers = parseChallenges(header).filter((c) => c.scheme === 'bearer')
  if (bearers.length === 0) return none
  const first = (name: string): string | null => {
    for (const b of bearers) {
      const p = b.params.find((x) => x.name === name)
      if (p !== undefined) return p.value
    }
    return null
  }
  const rawScope = first('scope')
  let scope: string[] | null = null
  let scopeBad = false
  if (rawScope !== null) {
    const parts = rawScope.split(/ +/).filter((s) => s !== '')
    if (parts.length > OAUTH_LIMITS.scopes || parts.some((s) => !SCOPE.test(s))) scopeBad = true
    else if (parts.length > 0) scope = [...new Set(parts)]
  }
  const rawError = first('error')
  return {
    bearer: true,
    resourceMetadata: first('resource_metadata'),
    scope,
    scopeBad,
    error: rawError === null ? null : oneLine(rawError, 40)
  }
}

// ---------------------------------------------------------------------- addresses ---------------------------------------------------------------------------

/** The connector's address in the specification's canonical form (RFC 8707): no fragment; the root path without its slash. */
export function canonicalResource(href: string): string {
  const url = new URL(href)
  url.hash = ''
  const text = url.href
  return url.pathname === '/' && url.search === '' ? text.replace(/\/$/, '') : text
}

/** Two addresses of the same resource: the same canonical form, a single trailing slash on the path aside. */
export function sameResource(a: string, b: string): boolean {
  try {
    const norm = (s: string): string => canonicalResource(s).replace(/\/$/, '')
    return norm(a) === norm(b)
  } catch {
    return false
  }
}

/** Where the connector's document about its sign-in is looked for when the challenge names none, in the specification's order. */
export function resourceMetadataCandidates(href: string): string[] {
  const url = new URL(href)
  const path = url.pathname.replace(/\/$/, '')
  const root = `${url.origin}/.well-known/oauth-protected-resource`
  return path === '' ? [root] : [`${root}${path}`, root]
}

/** Where a provider's document is looked for, in the specification's order (RFC 8414 section 3.1 and the OpenID compatibility notes). */
export function providerMetadataCandidates(issuer: string): string[] {
  const url = new URL(issuer)
  const path = url.pathname.replace(/\/$/, '')
  const oauth = `${url.origin}/.well-known/oauth-authorization-server`
  const openid = `${url.origin}/.well-known/openid-configuration`
  return path === ''
    ? [oauth, openid]
    : [
        `${oauth}${path}`,
        `${openid}${path}`,
        `${url.origin}${path}/.well-known/openid-configuration`
      ]
}

// ---------------------------------------------------------------------- the result --------------------------------------------------------------------------

export interface Discovery {
  /** The address the token is asked for (RFC 8707), canonical. */
  resource: string
  /** The connector's document that named the provider. */
  resourceMetadataUrl: string
  /** The provider's identity, exactly as its document wrote it. */
  issuer: string
  authorizationEndpoint: string
  tokenEndpoint: string
  registrationEndpoint: string | null
  revocationEndpoint: string | null
  /** The provider promises to say who it is in every answer (RFC 9207); a missing `iss` is then refused. */
  issResponse: boolean
  /** The provider takes a client identified by a document at an address (not used by the app; shown in words). */
  clientIdDocuments: boolean
  /** How a client may prove itself at the token address, as the provider lists (default `client_secret_basic`). */
  tokenAuthMethods: string[]
  /** The permissions to ask for, in words of the provider's, and whether the app added `offline_access`. */
  scopes: string[]
  offlineAccess: boolean
}

/** A failure is a sentence; `stopped` is set when the person's Stop caused it (the caller says nothing more then). */
export type DiscoverResult =
  { ok: true; found: Discovery } | { ok: false; why: string; stopped?: true }

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const strings = (value: unknown, max: number): string[] | null => {
  if (!Array.isArray(value) || value.length > max) return null
  return value.every((v) => typeof v === 'string') ? (value as string[]) : null
}

class Budget {
  private left = OAUTH_LIMITS.discoveryRequests
  take(): boolean {
    if (this.left <= 0) return false
    this.left--
    return true
  }
}

const TOO_MANY = 'Finding the sign-in provider took more requests than the app makes.'

export interface DiscoverInput {
  /** The connector's address as the person typed it. */
  mcpUrl: string
  challenge: Challenge
  guarded: GuardedFetch
  signal?: AbortSignal
}

export async function discover(input: DiscoverInput): Promise<DiscoverResult> {
  const budget = new Budget()
  try {
    return await run(input, budget)
  } catch (error) {
    if (error instanceof GuardError) {
      return error.code === 'stopped'
        ? { ok: false, why: error.message, stopped: true }
        : { ok: false, why: error.message }
    }
    return { ok: false, why: 'Finding the sign-in provider failed.' }
  }
}

/** An address a document names, or why the app will not use it. A number that leads inside a network is refused here already (the guard would refuse it at the request). */
function endpoint(
  text: unknown,
  anchor: string,
  what: string
): { ok: true; href: string } | { ok: false; why: string } {
  const named = checkNamedUrl(text, anchor)
  if (!named.ok) return { ok: false, why: `The provider's ${what} is not an address the app uses.` }
  if (named.url.search !== '' && what === 'issuer')
    return { ok: false, why: `The provider's ${what} is not an address the app uses.` }
  const bare = named.url.hostname.replace(/^\[|\]$/g, '')
  if (!named.sameHost && refusedAddress(bare) !== null && /^[0-9.]+$|:/.test(bare)) {
    return {
      ok: false,
      why: `The provider's ${what} leads inside a network; the app does not use it.`
    }
  }
  return { ok: true, href: named.url.href }
}

async function run(input: DiscoverInput, budget: Budget): Promise<DiscoverResult> {
  const { mcpUrl, challenge, guarded, signal } = input
  if (challenge.scopeBad) {
    return {
      ok: false,
      why: 'The connector asked for permissions that are not written as permissions; the app does not go on.'
    }
  }
  const resource = canonicalResource(mcpUrl)

  // ---- 2. the connector's document ----
  const candidates =
    challenge.resourceMetadata !== null
      ? [challenge.resourceMetadata]
      : resourceMetadataCandidates(mcpUrl)
  let prm: Record<string, unknown> | null = null
  let prmUrl = ''
  let lastWhy = 'The connector does not say where its sign-in is.'
  for (const candidate of candidates) {
    if (!budget.take()) return { ok: false, why: TOO_MANY }
    let answer
    try {
      answer = await guarded(candidate, { ...(signal === undefined ? {} : { signal }) })
    } catch (error) {
      if (error instanceof GuardError && (error.code === 'stopped' || error.code === 'timeout'))
        throw error
      lastWhy = error instanceof GuardError ? error.message : lastWhy
      continue
    }
    if (answer.status === 200 && isObject(answer.json)) {
      prm = answer.json
      prmUrl = candidate
      break
    }
    lastWhy = 'The connector has no document about its sign-in at the address it named.'
  }
  if (prm === null) return { ok: false, why: lastWhy }
  if (typeof prm.resource !== 'string' || !sameResource(prm.resource, resource)) {
    return {
      ok: false,
      why: "The connector's sign-in document is about a different address than the one you gave. The app does not go on."
    }
  }
  const listed = strings(prm.authorization_servers, 50)
  if (listed === null || listed.length === 0) {
    return { ok: false, why: 'The connector names no sign-in provider.' }
  }
  const supported = prm.scopes_supported === undefined ? null : strings(prm.scopes_supported, 1000)
  if (
    prm.scopes_supported !== undefined &&
    (supported === null || supported.some((s) => !SCOPE.test(s)))
  ) {
    return {
      ok: false,
      why: 'The connector lists permissions that are not written as permissions.'
    }
  }

  // ---- 3. the provider's document ----
  let why = 'The sign-in provider could not be used.'
  for (const raw of listed.slice(0, OAUTH_LIMITS.providers)) {
    const issuerCheck = endpoint(raw, mcpUrl, 'issuer')
    if (!issuerCheck.ok) {
      why = issuerCheck.why
      continue
    }
    const issuerUrl = new URL(issuerCheck.href)
    if (
      issuerUrl.hash !== '' ||
      issuerUrl.search !== '' ||
      (raw !== issuerUrl.href && raw.replace(/\/$/, '') !== issuerUrl.href.replace(/\/$/, ''))
    ) {
      why = "The provider's identity is not an address the app uses."
      continue
    }
    // the issuer exactly as the connector wrote it (the document must say the same)
    let meta: Record<string, unknown> | null = null
    for (const candidate of providerMetadataCandidates(raw)) {
      if (!budget.take()) return { ok: false, why: TOO_MANY }
      let answer
      try {
        answer = await guarded(candidate, { ...(signal === undefined ? {} : { signal }) })
      } catch (error) {
        if (error instanceof GuardError && (error.code === 'stopped' || error.code === 'timeout'))
          throw error
        why = error instanceof GuardError ? error.message : why
        continue
      }
      if (answer.status === 200 && isObject(answer.json)) {
        meta = answer.json
        break
      }
    }
    if (meta === null) {
      why =
        'The sign-in provider has no document about itself where the specification says to look.'
      continue
    }
    if (meta.issuer !== raw) {
      why =
        "The provider's document names another identity than the address it was found at. The app does not use it."
      continue
    }
    // PKCE: the specification says to refuse to go on without a list that names S256
    const methods = strings(meta.code_challenge_methods_supported, 20)
    if (methods === null || !methods.includes('S256')) {
      why =
        'The sign-in provider does not offer the safe sign-in form (PKCE with S256), so the app does not use it.'
      continue
    }
    const responseTypes =
      meta.response_types_supported === undefined
        ? null
        : strings(meta.response_types_supported, 50)
    if (responseTypes !== null && !responseTypes.includes('code')) {
      why = 'The sign-in provider does not offer the sign-in form the app uses.'
      continue
    }
    const grants =
      meta.grant_types_supported === undefined ? null : strings(meta.grant_types_supported, 50)
    if (grants !== null && !grants.includes('authorization_code')) {
      why = 'The sign-in provider does not offer the sign-in form the app uses.'
      continue
    }
    const auth = endpoint(meta.authorization_endpoint, mcpUrl, 'sign-in page')
    if (!auth.ok) {
      why = auth.why
      continue
    }
    const token = endpoint(meta.token_endpoint, mcpUrl, 'token address')
    if (!token.ok) {
      why = token.why
      continue
    }
    let registration: string | null = null
    if (meta.registration_endpoint !== undefined) {
      const r = endpoint(meta.registration_endpoint, mcpUrl, 'registration address')
      if (!r.ok) {
        why = r.why
        continue
      }
      registration = r.href
    }
    let revocation: string | null = null
    if (meta.revocation_endpoint !== undefined) {
      const r = endpoint(meta.revocation_endpoint, mcpUrl, 'revocation address')
      if (!r.ok) {
        why = r.why
        continue
      }
      revocation = r.href
    }
    const authMethods =
      meta.token_endpoint_auth_methods_supported === undefined
        ? null
        : strings(meta.token_endpoint_auth_methods_supported, 20)

    // ---- 4. the permissions ----
    const providerScopes =
      meta.scopes_supported === undefined ? null : strings(meta.scopes_supported, 1000)
    let scopes: string[] = []
    if (challenge.scope !== null) scopes = challenge.scope
    else if (supported !== null) scopes = [...new Set(supported)]
    if (scopes.length > OAUTH_LIMITS.scopes) {
      return {
        ok: false,
        why: `The connector asks for more than ${OAUTH_LIMITS.scopes} permissions; the app does not ask for so many.`
      }
    }
    let offlineAccess = false
    if (
      providerScopes?.includes('offline_access') === true &&
      !scopes.includes('offline_access') &&
      scopes.length < OAUTH_LIMITS.scopes
    ) {
      scopes = [...scopes, 'offline_access']
      offlineAccess = true
    }
    return {
      ok: true,
      found: {
        resource,
        resourceMetadataUrl: prmUrl,
        issuer: raw,
        authorizationEndpoint: auth.href,
        tokenEndpoint: token.href,
        registrationEndpoint: registration,
        revocationEndpoint: revocation,
        issResponse: meta.authorization_response_iss_parameter_supported === true,
        clientIdDocuments: meta.client_id_metadata_document_supported === true,
        tokenAuthMethods: authMethods ?? ['client_secret_basic'],
        scopes,
        offlineAccess
      }
    }
  }
  return { ok: false, why }
}
