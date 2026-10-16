// Sign-in for web connectors (Stage 14b, D-046): the part that main and the window share. Plain constants and types; nothing here decides anything. The decisions are main's
// (oauthHttp.ts, oauthDiscovery.ts, oauthFlow.ts, oauthCallback.ts, oauthTokens.ts, connectorService.ts). No Electron imports.

/** The limits of the plan's pick I. Main holds them; the page only shows them. */
export const OAUTH_LIMITS = Object.freeze({
  /** One request to an address a server named: the whole of it, from the first byte sent to the last received. */
  requestMs: 10_000,
  /** The most bytes of one answer to such a request. */
  answerBytes: 256 * 1024,
  /** The most bytes the app sends in one such request. */
  sendBytes: 16 * 1024,
  /** An address a server named, and the authorization address handed to the browser. */
  urlChars: 2000,
  /** Requests to find the provider, at most, in one sign-in. */
  discoveryRequests: 6,
  /** Providers a server lists that the app looks at. */
  providers: 3,
  /** Permissions asked for in one sign-in: how many, how long each. */
  scopes: 20,
  scopeChars: 100,
  /** How long the person has to finish in the browser. */
  waitMs: 5 * 60_000,
  /** An access token or a refresh token, in characters. */
  tokenChars: 8000,
  /** A token that says nothing about its life lasts this long (seconds); the shortest and the longest life taken. */
  defaultLifeSeconds: 3600,
  minLifeSeconds: 60,
  maxLifeSeconds: 31_536_000,
  /** A token is renewed this long before it ends. */
  renewBeforeMs: 60_000,
  /** Asking the provider to revoke a token. */
  revokeMs: 5000
})
