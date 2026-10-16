// Writes the negative-control specs for Stage 14b (sign-in for web connectors, D-046): one sabotage each, which the named suite must notice. The suites: verify-14b-1.mjs (the guard
// under every address a server names), and the ones of the later slices (added as they are made).
// usage: node tools/make-specs14b.mjs
//   then: FRONTIER_MAY_REMOVE=1 FRONTIER_KEEP_TEMP=1 TEMP=C:\frontier-tmp TMP=C:\frontier-tmp node tools/nc-all.mjs specs14b <names...>
//   (nc.mjs backs the file up in the temp folder, sabotages it, runs the suite and puts it back, proved by its hash; it removes nothing. The suites run under the wrapper of
//   tools/guarded.mjs. No control touches a rule that keeps a removal inside its folder (D-044).)
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { TOOLS } from './paths.mjs'

const HTTP = '{{REPO}}/src/main/oauthHttp.ts'
const DISC = '{{REPO}}/src/main/oauthDiscovery.ts'
const FLOW = '{{REPO}}/src/main/oauthFlow.ts'
const CALL = '{{REPO}}/src/main/oauthCallback.ts'
const TOKENS = '{{REPO}}/src/main/oauthTokens.ts'
const RECORD = '{{REPO}}/src/main/oauthRecord.ts'
const HTTPW = '{{REPO}}/src/main/mcpHttp.ts'
const CLIENT = '{{REPO}}/src/main/mcpClient.ts'
const STORE = '{{REPO}}/src/main/connectorStore.ts'
const SVC = '{{REPO}}/src/main/connectorService.ts'
const IPC = '{{REPO}}/src/main/ipc.ts'

// name: [suite, ONLY (or null), file, from, to]
const controls = {
  // ---- the guard (14b.1) ----
  gLookupCheck: ['14b-1', 'D', HTTP, '              for (const a of found) {', '              for (const a of []) {'],
  gLiteral: ['14b-1', 'D', HTTP, '      if (literal && !sameHost) {', '      if (false) {'],
  gSameHostAlways: ['14b-1', 'D', HTTP, '            if (!sameHost) {', '            if (false) {'],
  gSameHostLoose: ['14b-1', 'D', HTTP, '  const sameHost = host === anchorUrl.hostname.toLowerCase()', '  const sameHost = true'],
  gResolveTwice: ['14b-1', 'D', HTTP, ': await resolve(name)', ': (await resolve(name), await resolve(name))'],
  gRedirect: ['14b-1', 'C', HTTP, '          if (status >= 300 && status < 400) {', '          if (false) {'],
  gMaxBytes: ['14b-1', 'C', HTTP, '            if (size > max) {', '            if (false) {'],
  gClock: ['14b-1', 'C', HTTP, 'AbortSignal.timeout(ms)', 'new AbortController().signal'],
  gSendCap: ['14b-1', 'C', HTTP, '      if (body !== undefined && Buffer.byteLength(body) > OAUTH_LIMITS.sendBytes) {', '      if (false) {'],
  gPlainHttp: ['14b-1', 'B', HTTP, '    const onThisPc =\n      LOOPBACK_NAMES.has(host) && LOOPBACK_NAMES.has(anchorUrl.hostname.toLowerCase())', '    const onThisPc = true'],
  gUserinfo: ['14b-1', 'B', HTTP, "  if (url.username !== '' || url.password !== '') {", '  if (false) {'],
  gFragment: ['14b-1', 'B', HTTP, "  if (url.hash !== '') {", '  if (false) {'],
  gMetadataRange: ['14b-1', 'A', HTTP, "  ['cloud metadata', '168.63.129.16', 32, 'ipv4'],\n", ''],
  gSharedRange: ['14b-1', 'A', HTTP, "  ['shared', '100.64.0.0', 10, 'ipv4'],\n", ''],
  gMappedRange: ['14b-1', 'A', HTTP, "  ['IPv4 inside IPv6', '::ffff:0:0', 96, 'ipv6'],\n", ''],
  gZone: ['14b-1', 'A', HTTP, "  const family = address.includes('%') ? 0 : net.isIP(address)", '  const family = net.isIP(address)'],
  gCertificate: ['14b-1', 'E', HTTP, '          agent: false,', '          agent: false,\n          rejectUnauthorized: false,'],
  // ---- discovery (14b.2) ----
  dResource: ['14b-2', 'C', DISC, "  if (typeof prm.resource !== 'string' || !sameResource(prm.resource, resource)) {", "  if (typeof prm.resource !== 'string') {"],
  dIssuer: ['14b-2', 'C', DISC, '    if (meta.issuer !== raw) {', '    if (false) {'],
  dS256: ['14b-2', 'C', DISC, "    if (methods === null || !methods.includes('S256')) {", '    if (false) {'],
  dBudget: ['14b-2', 'C', DISC, '    if (this.left <= 0) return false', '    if (false) return false'],
  dScopeBad: ['14b-2', 'C', DISC, '  if (challenge.scopeBad) {', '  if (false) {'],
  dScopeCap: ['14b-2', 'C', DISC, '    if (scopes.length > OAUTH_LIMITS.scopes) {', '    if (false) {'],
  dOffline: ['14b-2', 'C', DISC, "      providerScopes?.includes('offline_access') === true &&", '      true &&'],
  dNoFallback: ['14b-2', 'C', DISC, '    challenge.resourceMetadata !== null\n      ? [challenge.resourceMetadata]\n      : resourceMetadataCandidates(mcpUrl)', '    [...(challenge.resourceMetadata !== null ? [challenge.resourceMetadata] : []), ...resourceMetadataCandidates(mcpUrl)]'],
  dBearerOnly: ['14b-2', 'A', DISC, "  const bearers = parseChallenges(header).filter((c) => c.scheme === 'bearer')", '  const bearers = parseChallenges(header)'],
  dOrder: ['14b-2', 'B', DISC, "  return path === ''\n    ? [oauth, openid]", "  return path === ''\n    ? [openid, oauth]"],
  dStopped: ['14b-2', 'C', DISC, "      return error.code === 'stopped'\n        ? { ok: false, why: error.message, stopped: true }\n        : { ok: false, why: error.message }", '      return { ok: false, why: error.message }'],
  dScopeChars: ['14b-2', 'A', DISC, 'if (parts.length > OAUTH_LIMITS.scopes || parts.some((s) => !SCOPE.test(s))) scopeBad = true', 'if (parts.length > OAUTH_LIMITS.scopes) scopeBad = true'],
  // ---- the flow (14b.3) ----
  fState: ['14b-3', 'C', FLOW, "  if (typeof params.state !== 'string' || !same(params.state, expected.state)) {", '  if (false) {'],
  fIssAbsent: ['14b-3', 'C', FLOW, '  } else if (expected.issResponse) {', '  } else if (false) {'],
  fIssCompare: ['14b-3', 'C', FLOW, '    if (iss !== expected.issuer) {', '    if (false) {'],
  fErrorCode: ['14b-3', 'C', FLOW, '    const code = ERROR_CODE.test(params.error) ? params.error : null', '    const code = params.error'],
  fS256: ['14b-3', 'A', FLOW, "  return createHash('sha256').update(verifier, 'ascii').digest('base64url')", '  return verifier'],
  fVerifierLen: ['14b-3', 'A', FLOW, "  return randomBytes(48).toString('base64url')\n}\n/** BASE64URL", "  return randomBytes(8).toString('base64url')\n}\n/** BASE64URL"],
  fResourceAuth: ['14b-3', 'B,G', FLOW, "  url.searchParams.set('resource', input.resource)", '  void input.resource'],
  fSetNotAppend: ['14b-3', 'B', FLOW, "  url.searchParams.set('state', input.state)", "  url.searchParams.append('state', input.state)"],
  fTokenType: ['14b-3', 'D', FLOW, "  if (typeof body.token_type !== 'string' || body.token_type.toLowerCase() !== 'bearer') {", "  if (typeof body.token_type !== 'string') {"],
  fLifeClamp: ['14b-3', 'D', FLOW, '    seconds = Math.min(\n      Math.max(body.expires_in, OAUTH_LIMITS.minLifeSeconds),\n      OAUTH_LIMITS.maxLifeSeconds\n    )', '    seconds = body.expires_in'],
  fRegRedirect: ['14b-3', 'E', FLOW, '      if (!Array.isArray(uris) || uris.length !== 1 || uris[0] !== input.redirectUri) {', '      if (false) {'],
  fRegSecret: ['14b-3', 'E', FLOW, "    if (said !== 'none' && secret === null)\n", '    if (false)\n'],
  fVerifierSent: ['14b-3', 'G', FLOW, 'code_verifier: input.verifier,', "code_verifier: 'x',"],
  fResourceToken: ['14b-3', 'G', FLOW, '        code_verifier: input.verifier,\n        resource: input.resource\n      },\n      input.client,\n      input.signal\n    )\n    return readTokens(answer, input.now, null)', '        code_verifier: input.verifier\n      },\n      input.client,\n      input.signal\n    )\n    return readTokens(answer, input.now, null)'],
  fBasic: ['14b-3', 'G', FLOW, "  if (client === null || client.method !== 'client_secret_basic' || client.clientSecret === null)\n    return {}", '  return {}'],
  cHost: ['14b-3', 'F', CALL, 'req.headers.host !== hostHeader', 'false'],
  cState: ['14b-3', 'F', CALL, '      if (states.length !== 1 || states[0] !== options.state) return notTheAnswer()', '      if (false) return notTheAnswer()'],
  cPath: ['14b-3', 'F', CALL, '      if (url.pathname !== PATH) return notTheAnswer()', '      if (false) return notTheAnswer()'],
  cMethod: ['14b-3', 'F', CALL, "req.method !== 'GET' || ", ''],
  cLoopback: ['14b-3', 'F2', CALL, "    server.listen(0, '127.0.0.1', () => {", '    server.listen(0, () => {'],
  cDup: ['14b-3', 'F2', CALL, '        if (values.length !== 1 || values[0].length > MAX_PARAM || key.length > 40) {', '        if (false) {'],
  cNoise: ['14b-3', 'F2', CALL, '        if (++noise > MAX_NOISE) settle(', '        if (false) settle('],
  cClose: ['14b-3', 'F', CALL, '          server.close()\n          for (const s of sockets) s.destroy()', '          void sockets'],
  cReflect: ['14b-3', 'F', CALL, '      reply(200, PAGE_OK)', '      reply(200, PAGE_OK + JSON.stringify(params))'],
  cNoStore: ['14b-3', 'F', CALL, "          'cache-control': 'no-store',\n", ''],
  // ---- the tokens (14b.4) ----
  tSingle: ['14b-4', 'C', TOKENS, '    inflight ??= (async (): Promise<AuthRecord | null> => {', '    inflight = (async (): Promise<AuthRecord | null> => {'],
  tSaveFirst: ['14b-4', 'C', TOKENS, '        unsaved = !(await options.holder.write(next))\n        return next', '        void options.holder.write(next)\n        unsaved = false\n        return next'],
  tBlock: ['14b-4', 'C', TOKENS, '          if (result.error !== undefined && OVER.has(result.error)) {', '          if (false) {'],
  tNewer: ['14b-4', 'C', TOKENS, '      if (sent !== null && record.tokens.accessToken !== sent) return record.tokens.accessToken', '      void sent'],
  tBeforeEnd: ['14b-4', 'C', TOKENS, '      if (record.tokens.expiresAt - options.now() > OAUTH_LIMITS.renewBeforeMs)\n        return record.tokens.accessToken', '      if (true) return record.tokens.accessToken'],
  tOldWhileLives: ['14b-4', 'C', TOKENS, '      return blocked === null && record.tokens.expiresAt > options.now()\n        ? record.tokens.accessToken\n        : null', '      return record.tokens.accessToken'],
  tForget: ['14b-4', 'D', TOKENS, '      await options.holder.write(null).catch(() => false)', '      void 0'],
  tRevokeRefresh: ['14b-4', 'D', TOKENS, "        if (record.tokens.refreshToken !== null)\n          tasks.push(ask(record.tokens.refreshToken, 'refresh_token'))\n", ''],
  tNoRefresh: ['14b-4', 'C', TOKENS, '        if (record.tokens.refreshToken === null) {', '        if (false) {'],
  hOnly401: ['14b-4', 'C', HTTPW, '          error.denied?.status === 401 &&\n', ''],
  hProbe: ['14b-4', 'E', CLIENT, "      error.fault === 'too-big' ||\n      error.fault === 'unauthorized'\n    )", "      error.fault === 'too-big'\n    )"],
  rExact: ['14b-4', 'A', RECORD, '  if (!isPlain(raw) || !exactKeys(raw, KEYS) || raw.version !== RECORD_VERSION) return null', '  if (!isPlain(raw)) return null'],
  rSeal: ['14b-4', 'A', RECORD, "  if (!box.isAvailable()) throw new Error('This PC has no secure place to keep a sign-in.')\n", ''],
  rVisible: ['14b-4', 'A', RECORD, '  if (!visible(tokens.accessToken, OAUTH_LIMITS.tokenChars)) return null\n', ''],
  sBoth: ['14b-4', 'B', STORE, "        o.token !== null ||\n        typeof o.auth !== 'string' ||", "        typeof o.auth !== 'string' ||"],
  sLocalAuth: ['14b-4', 'B', STORE, "    if (o.url !== null || o.token !== null || (o.auth !== undefined && o.auth !== null)) return null", "    if (o.url !== null || o.token !== null) return null"],
  sOld: ['14b-4', 'B', STORE, '    (raw.version !== CONNECTORS_VERSION && raw.version !== FIRST_VERSION)', '    raw.version !== CONNECTORS_VERSION'],
  sText: ['14b-4', 'B', STORE, '      auth: c.auth,\n      network: c.network,', '      network: c.network,'],
  // ---- the service of a sign-in (14b.5) ----
  vNoYes: ['14b-5', 'B', SVC, "        if (answer !== 'yes') return notYes(answer, 'You did not sign in.')\n", ''],
  vOneAtATime: ['14b-5', 'B', SVC, '      if (signing !== null) {', '      if (false) {'],
  vRegistrationFirst: ['14b-5', 'B', SVC, "        if (client.kind === 'register' && found.found.registrationEndpoint === null) {", '        if (false) {'],
  vPasted: ['14b-5', 'B', SVC, '      if (c.token !== null) {\n        return {\n          ok: false,\n          error:\n            \'This connector uses a token you pasted.', '      if (false) {\n        return {\n          ok: false,\n          error:\n            \'This connector uses a token you pasted.'],
  vSecure: ['14b-5', 'B', SVC, '      if (!options.secrets.isAvailable()) {\n        return {\n          ok: false,\n          error: \'This PC has no secure place to keep a sign-in', '      if (false) {\n        return {\n          ok: false,\n          error: \'This PC has no secure place to keep a sign-in'],
  vKept: ['14b-5', 'B', SVC, '        const kept = again !== undefined && (await writeAuth(id, result.auth))', '        const kept = true'],
  vGiveBack: ['14b-5', 'B', SVC, '          await tmp.signOut()', '          void tmp'],
  vCancel: ['14b-5', 'B', SVC, '    cancelSignIn: async () => {\n      signing?.ctl.abort()\n', '    cancelSignIn: async () => {\n'],
  vStopAll: ['14b-5', 'B', SVC, '      closing = true\n      signing?.ctl.abort()\n', '      closing = true\n'],
  vCarry: ['14b-5', 'F', SVC, '          list.map((x) => (auths.has(x.id) ? { ...x, auth: auths.get(x.id) ?? null } : x))', '          list'],
  vTokensAuth: ['14b-5', 'E', SVC, '      if (record !== null) out.push(...secretsOf(record))\n', ''],
  vRevokeOnRemove: ['14b-5', 'D', SVC, '        if (c.auth !== null) await providerFor(c).signOut()\n', ''],
  vSignOutRevoke: ['14b-5', 'D', SVC, '      const said = await providerFor(c).signOut()', '      const said = true; providers.delete(id)'],
  iOpenOnlyHttps: ['14b-5', 'G', IPC, '      if (!isSafeExternalUrl(url) && !local) throw new Error', '      if (false) throw new Error']
}

mkdirSync(join(TOOLS, 'specs14b'), { recursive: true })
for (const [name, [suite, only, file, from, to]] of Object.entries(controls)) {
  // (nc.mjs puts `to` in with String.replace: a `$` followed by one of these would be read as a pattern, not as text)
  if (typeof file !== 'string' || typeof from !== 'string' || typeof to !== 'string' || /\$[$&`'0-9<]/.test(to)) throw new Error(`the control ${name} is not well formed`)
  const spec = {
    label: `n14b-${name}`,
    edits: [{ file, from, to }],
    argv: ['{{TOOLS}}/guarded.mjs', `{{TOOLS}}/verify-${suite}.mjs`],
    env: only === null ? {} : { ONLY: only },
    timeoutMs: 400000
  }
  writeFileSync(join(TOOLS, 'specs14b', `n14b-${name}.json`), JSON.stringify(spec, null, 2) + '\n')
}
console.log(`wrote ${Object.keys(controls).length} specs in specs14b`)
