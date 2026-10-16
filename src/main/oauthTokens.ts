import { OAUTH_LIMITS } from '../shared/oauth'
import type { TokenSource } from './mcpHttp'
import { refreshTokens, revokeToken, type AuthRecord } from './oauthFlow'
import type { GuardedFetch } from './oauthHttp'

// The token of a signed-in connector, kept alive (Stage 14b, D-046, slice 14b.4). One provider per connector, in memory, behind the wire's `TokenSource`:
//   - `current()`: the access token to send. If it ends within a minute it is renewed first.
//   - `rejected(sent)`: the connector answered 401 to the token it was sent. If another request has renewed it meanwhile, that newer token; else it is renewed, once.
//   - renewing is SINGLE-FLIGHT (ten requests at the same moment make one renewal), and a renewal that brings a new renewal token is KEPT BEFORE the new access token is used
//     (the provider has already thrown the old one away; losing the new one would sign the person out). If the disk will not take it, the new record is used from memory and
//     kept again at the next call.
//   - a renewal the provider REFUSES (the sign-in ended or was taken back) blocks the connector: it is "sign-in needed" and nothing more is asked of the provider until the
//     person signs in again. A renewal that fails for want of a connection does not block: the token is used while it lives and tried again at the next request.
//   - the access token goes to the connector's address only (the wire does that); the renewal token goes to the token address kept at sign-in, and nowhere else.
// No Electron imports.

/** Where the record lives (the service: sealed in connectors.json). */
export interface AuthHolder {
  /** The record now, or null (none, or it cannot be opened). */
  read(): Promise<AuthRecord | null>
  /** Keeps the record (null: forgets it). False when it could not be kept. */
  write(record: AuthRecord | null): Promise<boolean>
}

export type AuthState = 'none' | 'signed-in' | 'needs-sign-in'

export interface TokenProvider extends TokenSource {
  /** What the connector's sign-in is now, and why it needs a new one. */
  status(): Promise<{ state: AuthState; why: string | null; record: AuthRecord | null }>
  /** A sign-in has just been made and kept: use it. */
  adopt(record: AuthRecord): void
  /** Asks the provider to revoke what it gave, then forgets it. Never throws; false when the provider did not say yes (or could not be asked). */
  signOut(): Promise<boolean>
  /** Forgets what is in memory (the connector is removed, or the file was changed under it). */
  reset(): void
}

export interface TokenProviderOptions {
  holder: AuthHolder
  guarded: GuardedFetch
  now: () => number
  /** Told when a sign-in is found to be over (the provider refused a renewal). */
  onNeedsSignIn?: (why: string) => void
}

/** Codes of a refused renewal that mean the sign-in is over (anything else is taken as a trouble of the moment). */
const OVER = new Set([
  'invalid_grant',
  'invalid_client',
  'unauthorized_client',
  'invalid_target',
  'access_denied'
])

export function createTokenProvider(options: TokenProviderOptions): TokenProvider {
  let memory: AuthRecord | null | undefined
  let blocked: string | null = null
  let unsaved = false
  let inflight: Promise<AuthRecord | null> | null = null

  const load = async (): Promise<AuthRecord | null> => {
    if (memory === undefined) memory = await options.holder.read()
    return memory
  }

  const renew = (): Promise<AuthRecord | null> => {
    inflight ??= (async (): Promise<AuthRecord | null> => {
      try {
        const record = await load()
        if (record === null || blocked !== null) return null
        if (record.tokens.refreshToken === null) {
          blocked = 'The sign-in has ended and cannot be renewed.'
          options.onNeedsSignIn?.(blocked)
          return null
        }
        const result = await refreshTokens({
          guarded: options.guarded,
          tokenEndpoint: record.tokenEndpoint,
          client: record.client,
          refreshToken: record.tokens.refreshToken,
          resource: record.resource,
          now: options.now()
        })
        if (!result.ok) {
          if (result.error !== undefined && OVER.has(result.error)) {
            blocked = result.why
            options.onNeedsSignIn?.(blocked)
          }
          return null
        }
        const next: AuthRecord = {
          ...record,
          tokens: { ...result.tokens, scopes: result.tokens.scopes ?? record.tokens.scopes }
        }
        // kept BEFORE the new token is used
        memory = next
        unsaved = !(await options.holder.write(next))
        return next
      } finally {
        inflight = null
      }
    })()
    return inflight
  }

  const keepAgain = async (): Promise<void> => {
    if (unsaved && memory !== undefined && memory !== null)
      unsaved = !(await options.holder.write(memory))
  }

  return {
    current: async () => {
      const record = await load()
      if (record === null || blocked !== null) return null
      await keepAgain()
      if (record.tokens.expiresAt - options.now() > OAUTH_LIMITS.renewBeforeMs)
        return record.tokens.accessToken
      const renewed = await renew()
      if (renewed !== null) return renewed.tokens.accessToken
      // it could not be renewed: the old token while it still lives, else none
      return blocked === null && record.tokens.expiresAt > options.now()
        ? record.tokens.accessToken
        : null
    },
    rejected: async (sent) => {
      const record = await load()
      if (record === null || blocked !== null) return null
      // another request has renewed it since this one was sent
      if (sent !== null && record.tokens.accessToken !== sent) return record.tokens.accessToken
      const renewed = await renew()
      return renewed === null ? null : renewed.tokens.accessToken
    },
    status: async () => {
      const record = await load()
      if (record === null) return { state: 'none', why: null, record: null }
      if (blocked !== null) return { state: 'needs-sign-in', why: blocked, record }
      return { state: 'signed-in', why: null, record }
    },
    adopt: (record) => {
      memory = record
      blocked = null
      unsaved = false
    },
    signOut: async () => {
      const record = await load()
      let said = true
      if (record !== null && record.revocationEndpoint !== null) {
        const ask = (token: string, hint: 'access_token' | 'refresh_token'): Promise<boolean> =>
          revokeToken({
            guarded: options.guarded,
            revocationEndpoint: record.revocationEndpoint as string,
            client: record.client,
            token,
            hint
          })
        const tasks: Promise<boolean>[] = []
        if (record.tokens.refreshToken !== null)
          tasks.push(ask(record.tokens.refreshToken, 'refresh_token'))
        tasks.push(ask(record.tokens.accessToken, 'access_token'))
        said = (await Promise.all(tasks)).every(Boolean)
      } else if (record !== null) {
        said = false
      }
      memory = null
      blocked = null
      unsaved = false
      await options.holder.write(null).catch(() => false)
      return said
    },
    reset: () => {
      memory = undefined
      blocked = null
      unsaved = false
      inflight = null
    }
  }
}
