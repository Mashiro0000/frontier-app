import { spawn as nodeSpawn, execFileSync, type ChildProcess } from 'child_process'
import { randomBytes } from 'crypto'
import { promises as fs } from 'fs'
import { win32 } from 'path'
import {
  CONNECTOR_LIMITS,
  placeWords,
  type ConnectorChangeResult,
  type ConnectorPlace,
  type AuthView,
  type ConnectorsStatus,
  type ConnectorToolView,
  type ConnectorView
} from '../shared/connectors'
import { CONNECTOR_TOOL, type ConnectorEvent, type ToolEvent } from '../shared/tools'
import { isInside } from './commandRunner'
import type { StoredConnector, ConnectorStore } from './connectorStore'
import type { SecretBox } from './credentialStore'
import { KeptRefused } from './keptFile'
import {
  connectMcp,
  createStdioWire,
  McpError,
  oneLine,
  withClock,
  type McpSession,
  type Wire
} from './mcpClient'
import { checkRemoteUrl, createHttpWire } from './mcpHttp'
import { discover, parseChallenge, type Discovery } from './oauthDiscovery'
import { runSignIn, type AuthRecord, type ClientChoice } from './oauthFlow'
import { createGuardedFetch, type GuardedFetch, type Resolver } from './oauthHttp'
import { sealAuth, secretsOf, unsealAuth } from './oauthRecord'
import { createTokenProvider, type TokenProvider } from './oauthTokens'
import {
  argsWords,
  paramHeaders,
  readServerTool,
  resultText,
  serverArgs,
  toolIdOf,
  translateTool,
  type ConnectorFacts,
  type ServerTool
} from './mcpTools'
import type { BoxAnswer } from './programBox'
import { makeScratch, removeScratch } from './scratchCopy'
import { heldKey, type SavedKey } from './secrets'
import {
  QUESTION_BUSY,
  QUESTION_FAILED,
  QUESTION_RESTING,
  type GateAnswer,
  type QuestionGate,
  type SystemQuestion
} from './systemQuestion'
import type { ConnectorTools } from './replyTools'
import type { Executor } from './toolCore'
import { ASKED_HERE } from './toolQuestion'
import type { ToolDefinition } from './toolRegistry'

// The connectors (Stage 14.5 and 14.6, D-045): what the person can do with them on the Tools page, and how a connector's tool is run when the model asks and the person
// says yes. The rules of the plan:
//   - Adding a connector, giving it a grant, letting it run "as you" and switching one of its tools on each need the person's yes in the system's own message box (the page
//     can ask, never answer). Doing less (a tool off, a grant taken back, back into the box, stopping it) is done at once. Removing one asks, because its data goes too.
//   - The box for a new program shows exactly what runs, whole: the program, its arguments, the folder a copy of which it gets, and where it runs.
//   - A connector is started when it is first needed (to list its tools, or for a call the person allowed), never at start-up, and stopped after 5 idle minutes, when Stop
//     everything ends one of its calls, and when the app closes.
//   - A boxed one runs in the Stage 13 box with a container of its own (`FrontierApp.<id>`): a read-only copy of its folder (made again at every start, the Stage 13 copy
//     rules and caps), a data folder of its own that it may write and that stays, no network unless granted, and a copy of the workspace folder only when granted.
//   - What a connector says is untrusted: its tools are read, cleaned and translated (mcpTools.ts), a tool is offered only after the person switched it on, and a tool the
//     connector changes afterwards (its fingerprint) is switched off again and marked "changed".
// The audit log gets one line for everything that happens to a connector (added, removed, started, stopped, failed, a tool on, off or changed, a grant). No Electron imports.

export const NOT_UNDERSTOOD = 'That change was not understood.'
const BUSY = 'The connectors are being changed. Try again in a moment.'
const UNREADABLE = (why: string): string =>
  `Nothing was changed: your connectors could not be read (${why}). Every connector tool is off.`
const NOT_FOUND = 'That connector is not there any more.'
const NO_NODE =
  'Node.js is not installed on this PC. A connector that is a script needs it. Install it, then try again.'
const WARNING =
  "A connector is somebody else's code and somebody else's words: nothing it says is trusted, and every call it is asked to make is asked about in a window like this one first."

export interface ConnectorServiceOptions {
  store: ConnectorStore
  gate: QuestionGate
  /** The secure storage the tokens are sealed with. */
  secrets: SecretBox
  /** The box (Stage 13): its runner and the folder of runs that holds the connectors' folders. */
  box: () => Promise<BoxAnswer>
  /** The installed node.exe (for a script), or null. */
  nodePath: () => Promise<string | null>
  /** The workspace folder as it really is now, or null. */
  workspaceRoot: () => string | null
  /** The system's file dialog for a program (main's own window). Null when the person cancelled. */
  pickProgram: (owner: unknown) => Promise<string | null>
  /** True for a path the app never gives a connector: its data folder, a folder that holds it, the system's own places. */
  forbidden: (path: string) => Promise<boolean>
  savedKeys: () => Promise<readonly SavedKey[]>
  /** The audit log; a line that cannot be kept is logged, and the change still made (the person asked for it in the box). */
  record: (event: ToolEvent) => Promise<void>
  /** For checks: how a program "as you" is started, the HTTP client, the clock, ids, shorter clocks. */
  spawn?: typeof nodeSpawn
  fetch?: typeof fetch
  now?: () => number
  newId?: () => string
  /** A new connector's id (letters and digits, 8 to 16): the checks hand in the same few, so that the box makes no new container for every run of them. */
  connectorId?: () => string
  idleMs?: number
  startMs?: number
  callMs?: number
  /** Opens an address in the person's own browser (a sign-in). Throws when it will not. Absent: the app cannot sign in. */
  openBrowser?: (url: string) => Promise<void>
  /** For checks: how a name is resolved when a sign-in provider is asked for. */
  resolve?: Resolver
  /** For checks: how long a sign-in waits for the person (the app's limit by default). */
  signInWaitMs?: number
}

export type { ConnectorTools } from './replyTools'

export interface ConnectorService {
  status(): Promise<ConnectorsStatus>
  addLocal(owner: unknown, input: unknown): Promise<ConnectorChangeResult>
  addRemote(owner: unknown, input: unknown): Promise<ConnectorChangeResult>
  remove(owner: unknown, input: unknown): Promise<ConnectorChangeResult>
  /** Starts it (if it is not running) and lists its tools again. */
  refresh(input: unknown): Promise<ConnectorChangeResult>
  stop(input: unknown): Promise<ConnectorChangeResult>
  setTool(owner: unknown, input: unknown): Promise<ConnectorChangeResult>
  setGrant(owner: unknown, input: unknown): Promise<ConnectorChangeResult>
  setPlace(owner: unknown, input: unknown): Promise<ConnectorChangeResult>
  /** The tools a reply may offer (only those switched on), and how each is run. */
  forReply(): Promise<ConnectorTools>
  /** The ids of the tools that are switched on now (read at every turn of a reply). */
  onIds(): Promise<string[]>
  /** The tokens the person pasted, unsealed: a call's arguments that hold one are refused, as for an API key. */
  tokens(): Promise<string[]>
  /** Signs in to a web connector (Stage 14b): finds the provider, asks, opens the person's browser, waits for them to finish there. */
  signIn(owner: unknown, input: unknown): Promise<ConnectorChangeResult>
  /** Ends the sign-in that is open in the browser, if any. */
  cancelSignIn(): Promise<ConnectorChangeResult>
  /** Signs out: the provider is asked to revoke the token, and the app forgets it. */
  signOut(input: unknown): Promise<ConnectorChangeResult>
  /** Ends every connector (the app is closing). Synchronous on purpose. */
  stopAll(): void
}

interface Live {
  session: McpSession
  wire: Wire
  /** Ends the connection and the program (or the box). */
  end: () => void
  /** Set when the app ends it, so that its end is not a failure. */
  ending: boolean
  idle: ReturnType<typeof setTimeout> | null
  busy: number
}

/** What the page sees of a connector that is not in the file: what was listed in this session, and how it ended. */
interface Seen {
  listed: ServerTool[]
  bad: { name: string; why: string }[]
  more: boolean
  listedAt: number | null
  version: string | null
  problem: string | null
  state: 'stopped' | 'starting' | 'running' | 'failed'
  /** The connector answered that it wants a sign-in (401 or 403), and what it said (the challenge header, for the provider to be found). */
  signIn: {
    kind: 'needed' | 'expired' | 'more'
    challenge: string | null
    why: string | null
  } | null
}

const isPlain = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const HIDDEN = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Co}\p{Cn}\p{Cs}]/u
const reason = (error: unknown): string => (error instanceof Error ? error.message : String(error))
const quoteArg = (a: string): string =>
  a === '' || /[\s"]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a
const SCRIPT = /\.(?:js|mjs|cjs)$/i
const EXE = /\.exe$/i
const WORKSPACE_MARK = '<<WORKSPACE>>'
/** How long a connector in the box has to answer the first (modern) request, its start in the box included (about 3 to 5 seconds on this PC). */
const BOX_PROBE_MS = 15_000

/** The name the person gave, as the app keeps it, or null. */
function checkName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const name = raw.trim()
  if (name.length < 1 || name.length > CONNECTOR_LIMITS.nameChars || HIDDEN.test(name)) return null
  return name
}

/** A local connector's arguments, as the app keeps them, or null. */
function checkArgs(raw: unknown): string[] | null {
  if (!Array.isArray(raw) || raw.length > CONNECTOR_LIMITS.args) return null
  let total = 0
  for (const a of raw as unknown[]) {
    if (typeof a !== 'string' || a.length > CONNECTOR_LIMITS.argChars || HIDDEN.test(a)) return null
    total += a.length
  }
  return total <= CONNECTOR_LIMITS.argsChars ? [...(raw as string[])] : null
}

/** The start of a connector's tool names, from its name: letters and digits, a letter first, at most 12, not one that another connector has. */
export function prefixFor(name: string, taken: ReadonlySet<string>): string {
  let base = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 10)
  if (!/^[a-z]/.test(base)) base = `c${base}`.slice(0, 10)
  if (!taken.has(base)) return base
  for (let n = 2; n < 100; n++) if (!taken.has(`${base}${n}`)) return `${base}${n}`
  return `c${randomBytes(4).toString('hex')}`.slice(0, 12)
}

/** The folder a program's copy is made of: the nearest folder above it that holds a package.json (at most four up, never a drive's root), else its own. */
async function folderOf(program: string): Promise<string> {
  let dir = win32.dirname(program)
  if (EXE.test(program)) return dir
  for (let up = 0; up < 5; up++) {
    if (win32.dirname(dir) === dir) break
    try {
      const info = await fs.lstat(win32.join(dir, 'package.json'))
      if (info.isFile()) return dir
    } catch {
      /* not here */
    }
    const parent = win32.dirname(dir)
    if (win32.dirname(parent) === parent) break // never the root of a drive
    dir = parent
  }
  return win32.dirname(program)
}

/** The environment of a program that runs as the person: theirs, without the app's own settings. */
function plainEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (/^(ELECTRON|FRONTIER|NODE_OPTIONS|NODE_PATH|VITE|DEBUG)/i.test(key)) continue
    env[key] = value
  }
  return env
}

function endTree(child: ChildProcess): void {
  if (child.pid === undefined || child.exitCode !== null) return
  try {
    execFileSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore'
    })
  } catch {
    /* already gone */
  }
}

/** The answer of a question that was not a yes, as the page is told it. */
function notYes(
  answer: Exclude<GateAnswer, 'yes'>,
  nothing: string
): { ok: false; error: string; cancelled?: true } {
  if (answer === 'busy') return { ok: false, error: QUESTION_BUSY }
  if (answer === 'resting') return { ok: false, error: QUESTION_RESTING }
  if (answer === 'failed') return { ok: false, error: QUESTION_FAILED }
  return { ok: false, error: nothing, cancelled: true }
}

export function createConnectorService(options: ConnectorServiceOptions): ConnectorService {
  const { store, gate } = options
  const now = options.now ?? Date.now
  const spawn = options.spawn ?? nodeSpawn
  const idleMs = options.idleMs ?? CONNECTOR_LIMITS.idleMs
  const startMs = options.startMs ?? CONNECTOR_LIMITS.startMs
  const callMs = options.callMs ?? CONNECTOR_LIMITS.callMs
  let counter = 0
  const newId =
    options.newId ??
    ((): string => {
      counter += 1
      return `${now().toString(36)}-c${counter.toString(36)}-${randomBytes(3).toString('hex')}`
    })
  const connectorId = options.connectorId ?? ((): string => randomBytes(6).toString('hex'))
  const live = new Map<string, Live>()
  const starting = new Map<string, Promise<Live>>()
  const seen = new Map<string, Seen>()
  let changing = false
  let closing = false

  const seenOf = (id: string): Seen => {
    let s = seen.get(id)
    if (s === undefined) {
      s = {
        listed: [],
        bad: [],
        more: false,
        listedAt: null,
        version: null,
        problem: null,
        state: 'stopped',
        signIn: null
      }
      seen.set(id, s)
    }
    return s
  }

  async function note(
    what: ConnectorEvent,
    connector: StoredConnector,
    tool = CONNECTOR_TOOL
  ): Promise<void> {
    try {
      await options.record({
        type: 'connector',
        at: now(),
        call: newId(),
        tool,
        step: 0,
        what,
        connector: connector.name
      })
    } catch (error) {
      console.error('Keeping the record of a connector event failed:', reason(error))
    }
  }

  const facts = (c: StoredConnector): ConnectorFacts => ({
    name: c.name,
    prefix: c.prefix,
    place: c.place,
    network: c.network,
    ...(c.url === null
      ? {}
      : {
          host: checkRemoteUrl(c.url).ok
            ? (checkRemoteUrl(c.url) as { host: string }).host
            : 'unknown host'
        })
  })

  /** The command as the box and the page show it, whole. */
  const commandOf = (c: Pick<StoredConnector, 'place' | 'program' | 'args' | 'url'>): string => {
    if (c.place === 'remote') return c.url ?? ''
    const program = c.program ?? ''
    const head = SCRIPT.test(program) ? `node ${quoteArg(program)}` : quoteArg(program)
    return [head, ...c.args.map(quoteArg)].join(' ')
  }

  const unseal = (token: string | null): string | null => {
    if (token === null) return null
    try {
      return options.secrets.decrypt(Buffer.from(token, 'base64'))
    } catch {
      return null
    }
  }

  // ---------------------------------------------------------------- the sign-in of a web connector (Stage 14b, D-046) ----------------------------------------------------------------

  /** One token provider for each signed-in connector, in memory. */
  const providers = new Map<string, TokenProvider>()
  /** The sign-in that is open in the person's browser (one in the whole app), and the means to end it. */
  let signing: { id: string; ctl: AbortController } | null = null
  /** The writes of connectors.json go one after another (a renewal of a token can come at any moment). */
  let lockTail: Promise<unknown> = Promise.resolve()
  const withLock = <T>(task: () => Promise<T>): Promise<T> => {
    const run = lockTail.then(task, task)
    lockTail = run.catch(() => undefined)
    return run
  }

  const guardedFor = (url: string): GuardedFetch =>
    createGuardedFetch({
      anchor: url,
      ...(options.resolve === undefined ? {} : { resolve: options.resolve })
    })

  /** Keeps (or forgets, with null) the sign-in of one connector, sealed. False when it could not be kept. */
  async function writeAuth(id: string, record: AuthRecord | null): Promise<boolean> {
    try {
      return await withLock(async () => {
        const current = await store.read()
        if (current.problem !== null) return false
        if (!current.connectors.some((x) => x.id === id)) return false
        const sealed = record === null ? null : sealAuth(options.secrets, record)
        await store.write(current.connectors.map((x) => (x.id === id ? { ...x, auth: sealed } : x)))
        return true
      })
    } catch (error) {
      console.error('Keeping a sign-in failed:', reason(error))
      return false
    }
  }

  const SIGN_IN_WORDS = {
    needed: 'It wants you to sign in. Press Sign in on the Tools page.',
    expired: 'Your sign-in has ended. Press Sign in on the Tools page to sign in again.',
    more: 'It wants more permissions than you gave. Press Sign in on the Tools page to sign in again.'
  } as const

  /** The connector answered that it wants a sign-in (401 or 403): remember it, once per change, for the page. */
  function markSignIn(c: StoredConnector, error: McpError): void {
    if (c.place !== 'remote' || c.token !== null) return
    const s = seenOf(c.id)
    const kind: 'needed' | 'expired' | 'more' =
      error.denied?.status === 403 ? 'more' : c.auth === null ? 'needed' : 'expired'
    const challenge = error.denied?.challenge ?? null
    const changed = s.signIn === null || s.signIn.kind !== kind
    s.signIn = { kind, challenge, why: SIGN_IN_WORDS[kind] }
    s.problem = SIGN_IN_WORDS[kind]
    if (changed) void note('sign-in-needed', c)
  }

  /** The token provider of a signed-in connector (made when first needed). */
  function providerFor(c: StoredConnector): TokenProvider {
    let p = providers.get(c.id)
    if (p === undefined) {
      const id = c.id
      p = createTokenProvider({
        holder: {
          read: async () => {
            const { connectors } = await store.read()
            const x = connectors.find((y) => y.id === id)
            return x === undefined || x.auth === null ? null : unsealAuth(options.secrets, x.auth)
          },
          write: (record) => writeAuth(id, record)
        },
        guarded: guardedFor(c.url ?? ''),
        now,
        onNeedsSignIn: (why) => {
          const s = seenOf(id)
          s.signIn = {
            kind: 'expired',
            challenge: s.signIn?.challenge ?? null,
            why: SIGN_IN_WORDS.expired
          }
          s.problem = SIGN_IN_WORDS.expired
          void why
          void note('sign-in-needed', c)
        }
      })
      providers.set(id, p)
    }
    return p
  }

  const hostOf = (address: string): string => {
    try {
      return new URL(address).host
    } catch {
      return 'unknown host'
    }
  }

  function authViewOf(c: StoredConnector): AuthView {
    const s = seenOf(c.id)
    const canSignIn =
      c.place === 'remote' &&
      c.token === null &&
      options.secrets.isAvailable() &&
      options.openBrowser !== undefined
    const base = {
      provider: null,
      scopes: [] as string[],
      clientId: null,
      clientKind: null,
      busy: signing?.id === c.id,
      canSignIn,
      why: null as string | null
    }
    if (c.place !== 'remote' || c.token !== null) return { state: 'none', ...base }
    if (c.auth === null) {
      return s.signIn === null
        ? { state: 'none', ...base }
        : { state: s.signIn.kind === 'more' ? 'more' : 'needed', ...base, why: s.signIn.why }
    }
    const record = unsealAuth(options.secrets, c.auth)
    if (record === null) {
      return {
        state: 'expired',
        ...base,
        why: 'The sign-in cannot be opened on this PC any more. Sign in again.'
      }
    }
    const info = {
      provider: hostOf(record.issuer),
      scopes: record.scopes,
      clientId: record.client.clientId,
      clientKind: record.clientKind
    }
    if (s.signIn !== null) {
      return {
        state: s.signIn.kind === 'more' ? 'more' : 'expired',
        ...base,
        ...info,
        why: s.signIn.why
      }
    }
    return { state: 'signed-in', ...base, ...info }
  }

  function signInQuestion(
    c: StoredConnector,
    found: Discovery,
    client: ClientChoice
  ): SystemQuestion {
    const hosts = [
      ...new Set([found.issuer, found.authorizationEndpoint, found.tokenEndpoint].map(hostOf))
    ]
    const asked =
      found.scopes.length === 0
        ? 'No particular permissions are asked for.'
        : `Permissions asked for: ${found.scopes.join(', ')}.${found.offlineAccess ? ' (offline_access means: stay signed in without asking you again.)' : ''}`
    return {
      title: 'Sign in to a connector',
      message: `Sign in to the connector "${c.name}"?`,
      detail: [
        `Connector: ${c.url}`,
        `Sign-in provider: ${found.issuer}`,
        `Your browser opens at: ${hostOf(found.authorizationEndpoint)}`,
        `The app will talk to: ${hosts.join(', ')}`,
        asked,
        client.kind === 'typed'
          ? `The app signs in with the client id ${client.clientId}${client.clientSecret === null ? '' : ' and the secret you typed'}.`
          : 'The app registers itself with the provider.',
        '',
        "You sign in on the provider's page, in your browser: the app never sees your password. The app keeps a token for this connector, sealed on this PC, until you sign out or remove the connector.",
        `What the model sends to this connector's tools leaves this PC for whoever runs ${hostOf(c.url ?? '')}, and what it answers comes back to the model.`,
        '',
        WARNING,
        '',
        ASKED_HERE
      ].join('\n'),
      yes: 'Open my browser',
      no: "Don't sign in"
    }
  }

  // ---------------------------------------------------------------- the list ----------------------------------------------------------------

  function viewOf(c: StoredConnector): ConnectorView {
    const s = seenOf(c.id)
    const f = facts(c)
    const on = new Map(c.tools.map((t) => [t.name, t]))
    const taken = new Set<string>()
    const tools: ConnectorToolView[] = []
    const listedNames = new Set(s.listed.map((t) => t.name))
    for (const tool of s.listed) {
      const translated = translateTool(tool, f, (id) => taken.has(id))
      if (translated.ok) taken.add(translated.def.id)
      const kept = on.get(tool.name)
      tools.push({
        name: tool.name,
        id: translated.ok ? translated.def.id : null,
        description: tool.description,
        args: translated.ok ? argsWords(translated.def) : [],
        notOffered: translated.ok ? null : translated.why,
        on: kept !== undefined && kept.fingerprint === tool.fingerprint,
        changed: c.changed.includes(tool.name),
        readOnlyClaim: tool.readOnly
      })
    }
    // switched on, and not listed in this session (it has not been started yet): shown as the person read it
    for (const tool of c.tools) {
      if (listedNames.has(tool.name)) continue
      const translated = translateTool(tool, f, (id) => taken.has(id))
      if (translated.ok) taken.add(translated.def.id)
      tools.push({
        name: tool.name,
        id: translated.ok ? translated.def.id : null,
        description: tool.description,
        args: translated.ok ? argsWords(translated.def) : [],
        notOffered: translated.ok ? null : translated.why,
        on: true,
        changed: false,
        readOnlyClaim: tool.readOnly
      })
    }
    for (const bad of s.bad) {
      tools.push({
        name: bad.name,
        id: null,
        description: '',
        args: [],
        notOffered: bad.why,
        on: false,
        changed: false,
        readOnlyClaim: false
      })
    }
    return {
      id: c.id,
      name: c.name,
      place: c.place,
      command: commandOf(c),
      where: placeWords(c.place, c.network, f.host),
      network: c.network,
      folder: c.workspace ? 'the workspace folder' : null,
      hasToken: c.token !== null,
      auth: authViewOf(c),
      state: live.has(c.id)
        ? 'running'
        : starting.has(c.id)
          ? 'starting'
          : s.state === 'failed'
            ? 'failed'
            : 'stopped',
      problem: s.problem,
      tools,
      moreTools: s.more,
      listedAt: s.listedAt,
      version: s.version
    }
  }

  async function status(): Promise<ConnectorsStatus> {
    const { connectors, problem } = await store.read()
    return {
      connectors: connectors.map(viewOf),
      problem,
      toolsOn: connectors.reduce((n, c) => n + c.tools.length, 0),
      nodeInstalled: (await options.nodePath()) !== null
    }
  }

  async function save(list: StoredConnector[]): Promise<ConnectorChangeResult | null> {
    try {
      await withLock(async () => {
        // a list read a moment ago may hold an older sign-in than the one on disk (a token is renewed at any time): the sign-in on disk is the one kept
        const current = await store.read()
        const auths = new Map(current.connectors.map((x) => [x.id, x.auth]))
        await store.write(
          list.map((x) => (auths.has(x.id) ? { ...x, auth: auths.get(x.id) ?? null } : x))
        )
      })
      return null
    } catch (error) {
      if (error instanceof KeptRefused) return { ok: false, error: error.message }
      console.error('Saving the connectors failed:', reason(error))
      return { ok: false, error: 'Your connectors could not be saved on this computer.' }
    }
  }

  /** One change at a time; the list is read again inside it. */
  async function change(
    task: (list: StoredConnector[]) => Promise<ConnectorChangeResult>
  ): Promise<ConnectorChangeResult> {
    if (changing) return { ok: false, error: BUSY }
    changing = true
    try {
      const { connectors, problem } = await store.read()
      if (problem !== null) return { ok: false, error: UNREADABLE(problem) }
      return await task(connectors)
    } finally {
      changing = false
    }
  }

  const ok = async (): Promise<ConnectorChangeResult> => ({ ok: true, status: await status() })

  const idOf = (input: unknown): string | null =>
    isPlain(input) && typeof input.id === 'string' && /^[a-z0-9]{8,16}$/.test(input.id)
      ? input.id
      : null

  // ---------------------------------------------------------------- starting and stopping ----------------------------------------------------------------

  function stopLive(id: string): void {
    const l = live.get(id)
    if (l === undefined) return
    live.delete(id)
    l.ending = true
    if (l.idle !== null) clearTimeout(l.idle)
    try {
      l.end()
    } catch {
      /* already ended */
    }
    const s = seenOf(id)
    if (s.state !== 'failed') s.state = 'stopped'
  }

  function touch(id: string, c: StoredConnector): void {
    const l = live.get(id)
    if (l === undefined) return
    if (l.idle !== null) clearTimeout(l.idle)
    l.idle = setTimeout(() => {
      if (l.busy > 0) return touch(id, c)
      stopLive(id)
      void note('stopped', c)
    }, idleMs)
    l.idle.unref?.()
  }

  /** The folder of a boxed connector: `<run root>\connectors\<id>`, with its data folder. */
  async function homeOf(
    c: StoredConnector
  ): Promise<
    { runner: Extract<BoxAnswer, { ok: true }>['runner']; home: string; data: string } | string
  > {
    const box = await options.box()
    if (!box.ok) return `the box could not be made on this PC (${box.why})`
    const home = win32.join(box.runRoot, 'connectors', c.id)
    const data = win32.join(home, 'data')
    try {
      await fs.mkdir(data, { recursive: true })
    } catch {
      return "the connector's folder could not be made"
    }
    return { runner: box.runner, home, data }
  }

  /** Starts the program, or opens the address, and speaks the protocol with it. Throws an Error with a sentence for the person. */
  async function open(
    c: StoredConnector,
    signal: AbortSignal
  ): Promise<{ wire: Wire; end: () => void }> {
    if (c.place === 'remote') {
      const url = checkRemoteUrl(c.url)
      if (!url.ok) throw new Error(url.why)
      const token = unseal(c.token)
      if (c.token !== null && token === null)
        throw new Error('its token could not be unsealed on this PC (paste it again)')
      const wire = createHttpWire({
        href: url.href,
        token,
        ...(c.auth === null ? {} : { auth: providerFor(c) }),
        ...(options.fetch === undefined ? {} : { fetch: options.fetch })
      })
      return { wire, end: () => wire.close() }
    }
    const program = c.program ?? ''
    const node = SCRIPT.test(program) ? await options.nodePath() : null
    if (SCRIPT.test(program) && node === null) throw new Error(NO_NODE)
    if (c.place === 'as-you') {
      if (c.args.some((a) => a.startsWith(WORKSPACE_MARK))) {
        throw new Error(
          `${WORKSPACE_MARK} is only for a connector in the box that may see a copy of the workspace`
        )
      }
      const child = spawn(node ?? program, node === null ? [...c.args] : [program, ...c.args], {
        cwd: c.folder ?? win32.dirname(program),
        env: plainEnv(),
        windowsHide: true,
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe']
      })
      child.stdin?.on('error', () => undefined)
      child.stderr?.resume()
      const failedToStart = new Promise<never>((_, reject) =>
        child.once('error', () => reject(new Error('the program could not be started')))
      )
      failedToStart.catch(() => undefined)
      if (child.stdin === null || child.stdout === null)
        throw new Error('the program could not be started')
      const wire = createStdioWire(
        { stdin: child.stdin, stdout: child.stdout },
        { maxBytes: CONNECTOR_LIMITS.messageBytes }
      )
      child.once('close', () => wire.close())
      return {
        wire,
        end: () => {
          wire.close()
          try {
            child.stdin?.end()
          } catch {
            /* already closed */
          }
          setTimeout(() => endTree(child), 3000).unref()
        }
      }
    }
    // in the box
    const place = await homeOf(c)
    if (typeof place === 'string') throw new Error(place)
    const { runner, home, data } = place
    // the copies of an earlier start go (only folders directly below <home>\scratch)
    const scratchHome = win32.join(home, 'scratch')
    try {
      for (const name of await fs.readdir(scratchHome))
        await removeScratch(win32.join(scratchHome, name), home)
    } catch {
      /* none yet */
    }
    if (signal.aborted) throw new Error('it was stopped before it started')
    const folder = c.folder ?? win32.dirname(program)
    const copy = await makeScratch({ runRoot: home, source: folder, savedKeys: options.savedKeys })
    if (!copy.ok) throw new Error(`its folder could not be copied: ${copy.message}`)
    const rel = win32.relative(folder, program)
    if (rel.startsWith('..') || win32.isAbsolute(rel))
      throw new Error('the program is not inside its folder')
    if (!copy.manifest.files.has(rel.split('\\').join('/'))) {
      throw new Error(
        'the program itself was left out of the copy (a hidden name, a link, or a file that holds a saved key)'
      )
    }
    const inHome = `<<HOME>>\\scratch\\${copy.id}\\${rel}`
    let args = [...c.args]
    if (args.some((a) => a.startsWith(WORKSPACE_MARK))) {
      if (!c.workspace)
        throw new Error(
          `an argument names ${WORKSPACE_MARK}, but the connector may not see a copy of the workspace`
        )
      const root = options.workspaceRoot()
      if (root === null)
        throw new Error('no workspace folder is chosen, so there is no copy to give it')
      if (await options.forbidden(root))
        throw new Error('the workspace folder is not one a connector may be given')
      const ws = await makeScratch({ runRoot: home, source: root, savedKeys: options.savedKeys })
      if (!ws.ok) throw new Error(`the workspace could not be copied: ${ws.message}`)
      args = args.map((a) =>
        a.startsWith(WORKSPACE_MARK)
          ? `<<HOME>>\\scratch\\${ws.id}${a.slice(WORKSPACE_MARK.length)}`
          : a
      )
    }
    const started = await runner.serve({
      container: `FrontierApp.${c.id}`,
      homeDir: home,
      dataDir: data,
      program: node === null ? inHome : node,
      args: node === null ? args : [inHome, ...args],
      network: c.network
    })
    if (!('stdin' in started))
      throw new Error(`the box could not start it (${oneLine(started.message, 200)})`)
    started.stderr.resume()
    const wire = createStdioWire(
      { stdin: started.stdin, stdout: started.stdout },
      { maxBytes: CONNECTOR_LIMITS.messageBytes }
    )
    void started.ended.then(() => wire.close())
    return {
      wire,
      end: () => {
        wire.close()
        started.close()
      }
    }
  }

  /** The connector running, started now if it is not (once at a time), with its tools listed and compared with what the person switched on. */
  function ensure(c: StoredConnector, signal: AbortSignal): Promise<Live> {
    const running = live.get(c.id)
    if (running !== undefined) return Promise.resolve(running)
    const already = starting.get(c.id)
    if (already !== undefined) return already
    const s = seenOf(c.id)
    s.state = 'starting'
    const task = (async (): Promise<Live> => {
      if (closing) throw new Error('the app is closing')
      const clock = withClock(signal, startMs)
      let opened: { wire: Wire; end: () => void } | null = null
      try {
        opened = await open(c, clock)
        // (in the box the program starts a few seconds after the first message is sent: the wait for a modern answer counts from then, so it is longer there)
        const session = await connectMcp(opened.wire, {
          signal: clock,
          ...(c.place === 'box' ? { probeMs: BOX_PROBE_MS } : {})
        })
        const listing = await session.listTools(clock)
        const listed: ServerTool[] = []
        const bad: { name: string; why: string }[] = []
        const names = new Set<string>()
        for (const raw of listing.tools) {
          const tool = readServerTool(raw)
          if ('bad' in tool) {
            bad.push({ name: tool.name, why: tool.bad })
            continue
          }
          if (names.has(tool.name)) {
            bad.push({
              name: oneLine(tool.name, 60),
              why: 'the connector listed two tools with this name'
            })
            continue
          }
          names.add(tool.name)
          listed.push(tool)
        }
        const l: Live = {
          session,
          wire: opened.wire,
          end: opened.end,
          ending: false,
          idle: null,
          busy: 0
        }
        if (closing) {
          opened.end()
          throw new Error('the app is closing')
        }
        live.set(c.id, l)
        Object.assign(s, {
          listed,
          bad,
          more: listing.more,
          listedAt: now(),
          version: session.version,
          problem: null,
          signIn: null,
          state: 'running'
        })
        void opened.wire.closed.then(() => {
          if (live.get(c.id) !== l) return
          live.delete(c.id)
          if (l.idle !== null) clearTimeout(l.idle)
          if (!l.ending) {
            s.state = 'failed'
            s.problem = 'It ended by itself. It starts again when it is next needed.'
            void note('failed', c)
          }
        })
        await note('started', c)
        await compare(c.id, listed)
        touch(c.id, c)
        return l
      } catch (error) {
        opened?.end()
        s.state = 'failed'
        const message =
          error instanceof McpError ? error.message : `It could not be started: ${reason(error)}.`
        s.problem = oneLine(message.replace(/\.\.$/, '.'), 300)
        if (error instanceof McpError && error.fault === 'unauthorized') markSignIn(c, error)
        await note('failed', c)
        throw new Error(s.problem)
      }
    })()
    starting.set(c.id, task)
    void task.then(
      () => starting.delete(c.id),
      () => starting.delete(c.id)
    )
    return task
  }

  /** The tools the connector lists now, against those the person switched on: any it changed is switched off and marked (one write for all). */
  async function compare(id: string, listed: readonly ServerTool[]): Promise<void> {
    const byName = new Map(listed.map((t) => [t.name, t]))
    const { connectors, problem } = await store.read()
    if (problem !== null) return
    const c = connectors.find((x) => x.id === id)
    if (c === undefined) return
    const gone = c.tools.filter((t) => byName.get(t.name)?.fingerprint !== t.fingerprint)
    if (gone.length === 0) return
    const next = connectors.map((x) =>
      x.id !== id
        ? x
        : {
            ...x,
            tools: x.tools.filter((t) => !gone.includes(t)),
            changed: [...new Set([...x.changed, ...gone.map((t) => t.name)])].slice(
              0,
              CONNECTOR_LIMITS.toolsEach
            )
          }
    )
    const failed = await save(next)
    if (failed !== null) return
    for (const t of gone) await note('tool-changed', c, toolIdOf(c.prefix, t.name))
  }

  // ---------------------------------------------------------------- the tools of a reply ----------------------------------------------------------------

  /** Every tool that is on, translated as the model is offered it, with the connector it belongs to. */
  function translated(list: readonly StoredConnector[]): {
    c: StoredConnector
    tool: ServerTool
    t: Extract<ReturnType<typeof translateTool>, { ok: true }>
  }[] {
    const out: {
      c: StoredConnector
      tool: ServerTool
      t: Extract<ReturnType<typeof translateTool>, { ok: true }>
    }[] = []
    for (const c of list) {
      const taken = new Set<string>()
      for (const tool of c.tools) {
        const t = translateTool(tool, facts(c), (id) => taken.has(id))
        if (!t.ok) continue
        taken.add(t.def.id)
        out.push({ c, tool, t })
      }
    }
    return out.slice(0, CONNECTOR_LIMITS.toolsOn)
  }

  async function tokens(): Promise<string[]> {
    const { connectors } = await store.read()
    const out: string[] = []
    for (const c of connectors) {
      const pasted = unseal(c.token)
      if (pasted !== null && pasted !== '') out.push(pasted)
      const record = c.auth === null ? null : unsealAuth(options.secrets, c.auth)
      if (record !== null) out.push(...secretsOf(record))
    }
    return out
  }

  function executorFor(
    c0: StoredConnector,
    tool: ServerTool,
    argNames: Readonly<Record<string, string>>,
    headers: Readonly<Record<string, string>>
  ): Executor {
    return async (args, context) => {
      const startedAt = now()
      const facts0 = (
        isError: boolean,
        dropped = 0
      ): { ms: number; isError: boolean; dropped: number } => ({
        ms: Math.max(0, Math.min(1_000_000_000, now() - startedAt)),
        isError,
        dropped
      })
      const failedText = (
        sentence: string
      ): { text: string; connector: ReturnType<typeof facts0> } => ({
        text: `The call to the tool "${oneLine(tool.name, 60)}" of the connector "${c0.name}" was not made: ${sentence}`,
        connector: facts0(true)
      })
      // the connector and the tool as they are now (it may have been removed, or the tool switched off, since the reply began)
      const { connectors } = await store.read()
      const c = connectors.find((x) => x.id === c0.id)
      const kept = c?.tools.find((t) => t.name === tool.name)
      if (c === undefined || kept === undefined || kept.fingerprint !== tool.fingerprint) {
        return failedText('the tool is not switched on any more.')
      }
      const signal = withClock(context.signal, callMs)
      let l: Live
      try {
        l = await ensure(c, signal)
      } catch (error) {
        if (context.signal.aborted) throw error
        return failedText(`the connector could not be started. ${reason(error)}`)
      }
      // what the connector lists now must still be what the person read
      const listedNow = seenOf(c.id).listed.find((t) => t.name === tool.name)
      if (listedNow === undefined || listedNow.fingerprint !== tool.fingerprint) {
        return failedText(
          'the connector changed this tool since the person switched it on, so the app switched it off. Nothing was sent.'
        )
      }
      l.busy += 1
      try {
        const sent = serverArgs(args, argNames)
        const answer = await l.session.callTool(
          tool.name,
          sent,
          signal,
          c.place === 'remote' ? paramHeaders(sent, headers) : undefined
        )
        const keys = await options.savedKeys()
        const held = await tokens()
        const result = resultText(c.name, tool.name, answer, {
          maxChars: Math.min(CONNECTOR_LIMITS.resultChars, context.maxChars),
          holdsKey: (text) =>
            heldKey(text, keys) !== null || held.some((t) => t.length >= 8 && text.includes(t))
        })
        return { text: result.text, connector: facts0(result.isError, result.dropped) }
      } catch (error) {
        if (context.signal.aborted) {
          // Stop everything: the call was cancelled (the protocol's own cancel went with the abort); a program is ended too, in case it goes on.
          if (c.place !== 'remote') {
            stopLive(c.id)
            void note('stopped', c)
          }
          throw error
        }
        if (error instanceof McpError && error.fault === 'timeout') {
          return failedText(
            `the connector did not answer within ${Math.round(callMs / 1000)} seconds.`
          )
        }
        if (error instanceof McpError && signal.aborted) {
          return failedText(
            `the connector did not answer within ${Math.round(callMs / 1000)} seconds.`
          )
        }
        if (error instanceof McpError && error.fault === 'unauthorized') {
          markSignIn(c, error)
          return failedText(
            `the connector wants you to sign in (or to sign in again). Nothing was sent. Press Sign in on the Tools page.`
          )
        }
        stopLive(c.id)
        const s = seenOf(c.id)
        s.state = 'failed'
        s.problem =
          error instanceof McpError ? oneLine(error.message, 300) : 'The connection to it broke.'
        void note('failed', c)
        return failedText(error instanceof McpError ? error.message : 'the connection to it broke.')
      } finally {
        l.busy -= 1
        touch(c.id, c)
      }
    }
  }

  // ---------------------------------------------------------------- the questions ----------------------------------------------------------------

  const ask = (owner: unknown, q: SystemQuestion): Promise<GateAnswer> => gate.ask(owner, q)

  function addQuestion(
    c: Pick<StoredConnector, 'name' | 'place' | 'program' | 'args' | 'url' | 'folder' | 'token'>,
    host: string | null
  ): SystemQuestion {
    const lines =
      c.place === 'remote'
        ? [
            `Name: ${c.name}`,
            `Web address: ${c.url}`,
            c.token === null
              ? 'No token.'
              : 'With the token you pasted (sent to this address only).',
            '',
            `What the model sends to this connector's tools leaves this PC for whoever runs ${host ?? 'that address'}, and what it answers comes back to the model.`
          ]
        : [
            `Name: ${c.name}`,
            'What runs, exactly:',
            commandOf(c),
            '',
            `It runs in the locked box: it gets a read-only copy of the folder ${c.folder}, a data folder of its own that it may write, no network and no other folder. You can give it the network or a copy of the workspace folder later, each with its own question.`
          ]
    return {
      title: 'Add a connector',
      message: `Add the connector "${c.name}"?`,
      detail: [
        ...lines,
        '',
        WARNING,
        'Its tools all start off: you read each one before you switch it on.',
        '',
        ASKED_HERE
      ].join('\n'),
      yes: 'Add it',
      no: "Don't add"
    }
  }

  // ---------------------------------------------------------------- the service ----------------------------------------------------------------

  return {
    status,

    addLocal: async (owner, input) => {
      if (!isPlain(input)) return { ok: false, error: NOT_UNDERSTOOD }
      const name = checkName(input.name)
      const args = checkArgs(input.args)
      if (name === null)
        return {
          ok: false,
          error: `Give the connector a name of 1 to ${CONNECTOR_LIMITS.nameChars} characters.`
        }
      if (args === null) {
        return {
          ok: false,
          error: `At most ${CONNECTOR_LIMITS.args} arguments of at most ${CONNECTOR_LIMITS.argChars} characters each (${CONNECTOR_LIMITS.argsChars} in all), with no invisible characters.`
        }
      }
      return change(async (list) => {
        if (list.length >= CONNECTOR_LIMITS.connectors)
          return {
            ok: false,
            error: `There are already ${CONNECTOR_LIMITS.connectors} connectors, the most the app keeps.`
          }
        if (list.some((c) => c.name.toLowerCase() === name.toLowerCase()))
          return { ok: false, error: 'Another connector has that name.' }
        const picked = await options.pickProgram(owner)
        if (picked === null) return { ok: false, error: 'No program was chosen.', cancelled: true }
        if (
          !win32.isAbsolute(picked) ||
          !/^[A-Za-z]:\\/.test(picked) ||
          picked.length > 260 ||
          HIDDEN.test(picked)
        ) {
          return { ok: false, error: 'That is not a file on a drive of this PC.' }
        }
        const program = win32.resolve(picked)
        if (!SCRIPT.test(program) && !EXE.test(program))
          return {
            ok: false,
            error: 'Choose a script for node (.js, .mjs, .cjs) or a program (.exe).'
          }
        try {
          const info = await fs.lstat(program)
          if (!info.isFile() || info.isSymbolicLink())
            return { ok: false, error: 'That is not an ordinary file.' }
        } catch {
          return { ok: false, error: 'That file is not there.' }
        }
        if (SCRIPT.test(program) && (await options.nodePath()) === null)
          return { ok: false, error: NO_NODE }
        const folder = await folderOf(program)
        if ((await options.forbidden(folder)) || (await options.forbidden(program))) {
          return {
            ok: false,
            error:
              "That folder is not one a connector may be given (it is or holds the app's own data, or a place of the system's)."
          }
        }
        const candidate = {
          name,
          place: 'box' as const,
          program,
          folder,
          args,
          url: null,
          token: null
        }
        const answer = await ask(owner, addQuestion(candidate, null))
        if (answer !== 'yes') return notYes(answer, 'The connector was not added.')
        const fresh = await store.read()
        if (fresh.problem !== null) return { ok: false, error: UNREADABLE(fresh.problem) }
        if (fresh.connectors.length >= CONNECTOR_LIMITS.connectors)
          return { ok: false, error: 'There are already as many connectors as the app keeps.' }
        const c: StoredConnector = {
          id: connectorId(),
          ...candidate,
          prefix: prefixFor(name, new Set(fresh.connectors.map((x) => x.prefix))),
          auth: null,
          network: false,
          workspace: false,
          tools: [],
          changed: [],
          added: now()
        }
        const failed = await save([...fresh.connectors, c])
        if (failed !== null) return failed
        await note('added', c)
        return ok()
      })
    },

    addRemote: async (owner, input) => {
      if (!isPlain(input)) return { ok: false, error: NOT_UNDERSTOOD }
      const name = checkName(input.name)
      if (name === null)
        return {
          ok: false,
          error: `Give the connector a name of 1 to ${CONNECTOR_LIMITS.nameChars} characters.`
        }
      const url = checkRemoteUrl(input.url)
      if (!url.ok) return { ok: false, error: url.why }
      const tokenText = typeof input.token === 'string' ? input.token.trim() : null
      if (
        tokenText === null ||
        tokenText.length > CONNECTOR_LIMITS.tokenChars ||
        !/^[\x21-\x7e]*$/.test(tokenText)
      ) {
        return {
          ok: false,
          error: `A token is at most ${CONNECTOR_LIMITS.tokenChars} visible characters with no spaces.`
        }
      }
      if (tokenText !== '' && !options.secrets.isAvailable()) {
        return {
          ok: false,
          error:
            'This PC has no secure place to keep a token, so a connector with a token cannot be added.'
        }
      }
      return change(async (list) => {
        if (list.length >= CONNECTOR_LIMITS.connectors)
          return {
            ok: false,
            error: `There are already ${CONNECTOR_LIMITS.connectors} connectors, the most the app keeps.`
          }
        if (list.some((c) => c.name.toLowerCase() === name.toLowerCase()))
          return { ok: false, error: 'Another connector has that name.' }
        let sealed: string | null = null
        if (tokenText !== '') {
          try {
            sealed = options.secrets.encrypt(tokenText).toString('base64')
          } catch {
            return { ok: false, error: 'The token could not be sealed on this PC.' }
          }
        }
        const candidate = {
          name,
          place: 'remote' as const,
          program: null,
          folder: null,
          args: [],
          url: url.href,
          token: sealed
        }
        const answer = await ask(owner, addQuestion(candidate, url.host))
        if (answer !== 'yes') return notYes(answer, 'The connector was not added.')
        const fresh = await store.read()
        if (fresh.problem !== null) return { ok: false, error: UNREADABLE(fresh.problem) }
        if (fresh.connectors.length >= CONNECTOR_LIMITS.connectors)
          return { ok: false, error: 'There are already as many connectors as the app keeps.' }
        const c: StoredConnector = {
          id: connectorId(),
          ...candidate,
          prefix: prefixFor(name, new Set(fresh.connectors.map((x) => x.prefix))),
          auth: null,
          network: false,
          workspace: false,
          tools: [],
          changed: [],
          added: now()
        }
        const failed = await save([...fresh.connectors, c])
        if (failed !== null) return failed
        await note('added', c)
        return ok()
      })
    },

    remove: async (owner, input) => {
      const id = idOf(input)
      if (id === null) return { ok: false, error: NOT_UNDERSTOOD }
      return change(async (list) => {
        const c = list.find((x) => x.id === id)
        if (c === undefined) return { ok: false, error: NOT_FOUND }
        const answer = await ask(owner, {
          title: 'Remove a connector',
          message: `Remove the connector "${c.name}"?`,
          detail: [
            'It is stopped, its tools are switched off and forgotten, and so is its token.',
            c.auth === null
              ? ''
              : 'The provider is asked to revoke your sign-in (if it cannot be asked, the sign-in is forgotten here all the same).',
            c.place === 'remote'
              ? ''
              : 'Its folder in the box is deleted, with the data it kept there.',
            '',
            ASKED_HERE
          ].join('\n'),
          yes: 'Remove it',
          no: "Don't remove"
        })
        if (answer !== 'yes') return notYes(answer, 'The connector was not removed.')
        stopLive(id)
        if (signing?.id === id) signing.ctl.abort()
        if (c.auth !== null) await providerFor(c).signOut()
        providers.delete(id)
        const fresh = await store.read()
        if (fresh.problem !== null) return { ok: false, error: UNREADABLE(fresh.problem) }
        const failed = await save(fresh.connectors.filter((x) => x.id !== id))
        if (failed !== null) return failed
        seen.delete(id)
        if (c.place !== 'remote') {
          // its folder (only `<run root>\connectors\<id>`, never anything else)
          const box = await options.box()
          if (box.ok) {
            const parent = win32.join(box.runRoot, 'connectors')
            const home = win32.join(parent, c.id)
            if (
              isInside(parent, home) &&
              win32.dirname(home).toLowerCase() === parent.toLowerCase()
            ) {
              await fs
                .rm(home, { recursive: true, force: true, maxRetries: 12, retryDelay: 250 })
                .catch(() => undefined)
            }
          }
        }
        await note('removed', c)
        return ok()
      })
    },

    refresh: async (input) => {
      const id = idOf(input)
      if (id === null) return { ok: false, error: NOT_UNDERSTOOD }
      const { connectors, problem } = await store.read()
      if (problem !== null) return { ok: false, error: UNREADABLE(problem) }
      const c = connectors.find((x) => x.id === id)
      if (c === undefined) return { ok: false, error: NOT_FOUND }
      if (live.has(id)) {
        stopLive(id)
        await note('stopped', c)
      }
      try {
        await ensure(c, new AbortController().signal)
      } catch (error) {
        return { ok: false, error: reason(error), status: await status() }
      }
      return ok()
    },

    stop: async (input) => {
      const id = idOf(input)
      if (id === null) return { ok: false, error: NOT_UNDERSTOOD }
      const { connectors } = await store.read()
      const c = connectors.find((x) => x.id === id)
      if (live.has(id)) {
        stopLive(id)
        if (c !== undefined) await note('stopped', c)
      }
      return ok()
    },

    setTool: async (owner, input) => {
      const id = idOf(input)
      if (
        id === null ||
        !isPlain(input) ||
        typeof input.name !== 'string' ||
        typeof input.on !== 'boolean'
      ) {
        return { ok: false, error: NOT_UNDERSTOOD }
      }
      const toolName = input.name
      const on = input.on
      return change(async (list) => {
        const c = list.find((x) => x.id === id)
        if (c === undefined) return { ok: false, error: NOT_FOUND }
        if (!on) {
          const tool = c.tools.find((t) => t.name === toolName)
          if (tool === undefined) return ok()
          const failed = await save(
            list.map((x) => (x.id === id ? { ...x, tools: x.tools.filter((t) => t !== tool) } : x))
          )
          if (failed !== null) return failed
          await note('tool-off', c, toolIdOf(c.prefix, tool.name))
          return ok()
        }
        const tool = seenOf(id).listed.find((t) => t.name === toolName)
        if (tool === undefined)
          return {
            ok: false,
            error:
              'Start the connector first (Check its tools): the app switches on only a tool it has just been told about.'
          }
        if (c.tools.some((t) => t.name === toolName && t.fingerprint === tool.fingerprint))
          return ok()
        const others = c.tools.filter((t) => t.name !== toolName)
        const taken = new Set<string>()
        for (const t of others) {
          const tr = translateTool(t, facts(c), (x) => taken.has(x))
          if (tr.ok) taken.add(tr.def.id)
        }
        const t = translateTool(tool, facts(c), (x) => taken.has(x))
        if (!t.ok) return { ok: false, error: `This tool cannot be offered: ${t.why}.` }
        const onNow = list.reduce(
          (n, x) => n + x.tools.filter((y) => !(x.id === id && y.name === toolName)).length,
          0
        )
        if (onNow >= CONNECTOR_LIMITS.toolsOn) {
          return {
            ok: false,
            error: `${CONNECTOR_LIMITS.toolsOn} connector tools are on already, the most the app offers. Switch one off first.`
          }
        }
        const answer = await ask(owner, {
          title: 'Switch on a connector tool',
          message: `Switch on the tool "${oneLine(tool.name, 60)}" of "${c.name}"?`,
          detail: [
            `Where it runs: ${placeWords(c.place, c.network, facts(c).host)}.`,
            `The model will call it: ${t.def.id}`,
            '',
            'What the connector says it does (its own words, not checked by the app):',
            tool.description === '' ? '(nothing)' : tool.description,
            '',
            `Arguments: ${argsWords(t.def).join('; ') || 'none'}`,
            tool.readOnly
              ? 'The connector says this tool only reads. The app cannot check that, and you are asked before every call anyway.'
              : '',
            '',
            'You are asked before every call, and shown its arguments in full. If the connector changes this tool later, it is switched off again until you read it again.',
            '',
            ASKED_HERE
          ]
            .filter((line, i, all) => !(line === '' && all[i - 1] === ''))
            .join('\n'),
          yes: 'Switch it on',
          no: "Don't switch on"
        })
        if (answer !== 'yes') return notYes(answer, 'The tool is still off.')
        const fresh = await store.read()
        if (fresh.problem !== null) return { ok: false, error: UNREADABLE(fresh.problem) }
        const now2 = fresh.connectors.find((x) => x.id === id)
        if (now2 === undefined) return { ok: false, error: NOT_FOUND }
        // the tool as the person read it must still be what the connector lists
        const still = seenOf(id).listed.find((x) => x.name === toolName)
        if (still === undefined || still.fingerprint !== tool.fingerprint)
          return {
            ok: false,
            error:
              'The connector changed the tool while you were reading it. It stays off: read it again.'
          }
        const failed = await save(
          fresh.connectors.map((x) =>
            x.id === id
              ? {
                  ...x,
                  tools: [...x.tools.filter((y) => y.name !== toolName), tool],
                  changed: x.changed.filter((n) => n !== toolName)
                }
              : x
          )
        )
        if (failed !== null) return failed
        await note('tool-on', c, t.def.id)
        return ok()
      })
    },

    setGrant: async (owner, input) => {
      const id = idOf(input)
      if (
        id === null ||
        !isPlain(input) ||
        (input.grant !== 'network' && input.grant !== 'workspace') ||
        typeof input.on !== 'boolean'
      ) {
        return { ok: false, error: NOT_UNDERSTOOD }
      }
      const grant = input.grant
      const on = input.on
      return change(async (list) => {
        const c = list.find((x) => x.id === id)
        if (c === undefined) return { ok: false, error: NOT_FOUND }
        if (c.place !== 'box')
          return { ok: false, error: 'Only a connector in the box is given grants.' }
        if (c[grant] === on) return ok()
        if (on) {
          const answer = await ask(owner, {
            title:
              grant === 'network'
                ? 'Let a connector use the network'
                : 'Give a connector a copy of the workspace',
            message:
              grant === 'network'
                ? `Let the connector "${c.name}" use the network?`
                : `Let the connector "${c.name}" see a copy of the workspace folder?`,
            detail: [
              grant === 'network'
                ? 'It will be able to reach the internet from inside the box (never this PC itself). It can then send anything it is given or can read, to anywhere.'
                : `Each time it starts, it gets a read-only copy of the workspace folder (as a program run does: no hidden or secret-looking files, at most ${CONNECTOR_LIMITS.copyFiles.toLocaleString('en-US')} files and 100 MB). An argument that begins with ${WORKSPACE_MARK} names the copy. It cannot change your folder.`,
              c.network || grant === 'network'
                ? 'With the network AND a copy of your folder, it could send the copy anywhere.'
                : '',
              '',
              'It is stopped now, and starts with this when it is next needed.',
              '',
              ASKED_HERE
            ].join('\n'),
            yes: grant === 'network' ? 'Allow the network' : 'Give it a copy',
            no: "Don't allow"
          })
          if (answer !== 'yes') return notYes(answer, 'Nothing was changed.')
        }
        const fresh = await store.read()
        if (fresh.problem !== null) return { ok: false, error: UNREADABLE(fresh.problem) }
        const failed = await save(
          fresh.connectors.map((x) => (x.id === id ? { ...x, [grant]: on } : x))
        )
        if (failed !== null) return failed
        stopLive(id)
        await note(
          grant === 'network'
            ? on
              ? 'network-on'
              : 'network-off'
            : on
              ? 'folder-on'
              : 'folder-off',
          c
        )
        return ok()
      })
    },

    setPlace: async (owner, input) => {
      const id = idOf(input)
      if (id === null || !isPlain(input) || (input.place !== 'box' && input.place !== 'as-you'))
        return { ok: false, error: NOT_UNDERSTOOD }
      const place: ConnectorPlace = input.place
      return change(async (list) => {
        const c = list.find((x) => x.id === id)
        if (c === undefined) return { ok: false, error: NOT_FOUND }
        if (c.place === 'remote') return { ok: false, error: 'A web address runs where it runs.' }
        if (c.place === place) return ok()
        if (place === 'as-you') {
          if (input.typed !== c.name)
            return { ok: false, error: "Type the connector's name exactly to confirm." }
          const answer = await ask(owner, {
            title: 'Run a connector NOT boxed',
            message: `Let "${c.name}" run with every right you have?`,
            detail: [
              'What runs, exactly:',
              commandOf(c),
              '',
              'It will NOT be in the box: it can read, change and delete your files, use the network, start other programs and keep running after it is stopped, as you could. Choose this only for a program you trust as you trust yourself.',
              'Its grants are dropped (it has every right already).',
              '',
              ASKED_HERE
            ].join('\n'),
            yes: 'Run it as me',
            no: 'Keep it boxed'
          })
          if (answer !== 'yes') return notYes(answer, 'It stays in the box.')
        }
        const fresh = await store.read()
        if (fresh.problem !== null) return { ok: false, error: UNREADABLE(fresh.problem) }
        const failed = await save(
          fresh.connectors.map((x) =>
            x.id === id ? { ...x, place, network: false, workspace: false } : x
          )
        )
        if (failed !== null) return failed
        stopLive(id)
        await note(place === 'as-you' ? 'as-you-on' : 'as-you-off', c)
        return ok()
      })
    },

    forReply: async () => {
      const { connectors, problem } = await store.read()
      if (problem !== null) return { defs: [], executors: {} }
      const defs: ToolDefinition[] = []
      const executors: Record<string, Executor> = {}
      for (const { c, tool, t } of translated(connectors)) {
        defs.push(t.def)
        executors[t.def.id] = executorFor(c, tool, t.argNames, t.headers)
      }
      return { defs, executors }
    },

    onIds: async () => {
      const { connectors, problem } = await store.read()
      return problem !== null ? [] : translated(connectors).map((x) => x.t.def.id)
    },

    signIn: async (owner, input) => {
      if (!isPlain(input)) return { ok: false, error: NOT_UNDERSTOOD }
      const id = idOf(input)
      const typedId = typeof input.clientId === 'string' ? input.clientId.trim() : null
      const typedSecret = typeof input.clientSecret === 'string' ? input.clientSecret.trim() : null
      if (
        id === null ||
        typedId === null ||
        typedSecret === null ||
        (typedId !== '' && !/^[\x21-\x7e]{1,256}$/.test(typedId)) ||
        (typedSecret !== '' && !/^[\x21-\x7e]{1,1000}$/.test(typedSecret)) ||
        (typedSecret !== '' && typedId === '')
      ) {
        return { ok: false, error: NOT_UNDERSTOOD }
      }
      if (options.openBrowser === undefined)
        return { ok: false, error: 'This version of the app cannot open your browser.' }
      if (!options.secrets.isAvailable()) {
        return {
          ok: false,
          error: 'This PC has no secure place to keep a sign-in, so the app does not sign in.'
        }
      }
      if (signing !== null) {
        return {
          ok: false,
          error: 'A sign-in is already open in your browser. Finish it there, or cancel it first.'
        }
      }
      const { connectors, problem } = await store.read()
      if (problem !== null) return { ok: false, error: UNREADABLE(problem) }
      const c = connectors.find((x) => x.id === id)
      if (c === undefined) return { ok: false, error: NOT_FOUND }
      if (c.place !== 'remote') return { ok: false, error: 'Only a web connector signs in.' }
      if (c.token !== null) {
        return {
          ok: false,
          error:
            'This connector uses a token you pasted. Remove it and add it again without a token to sign in instead.'
        }
      }
      const address = checkRemoteUrl(c.url)
      if (!address.ok) return { ok: false, error: address.why }
      const ctl = new AbortController()
      signing = { id, ctl }
      const s = seenOf(id)
      try {
        const guarded = guardedFor(address.href)
        const found = await discover({
          mcpUrl: address.href,
          challenge: parseChallenge(s.signIn?.challenge ?? null),
          guarded,
          signal: ctl.signal
        })
        if (!found.ok) {
          if (found.stopped === true)
            return { ok: false, error: 'The sign-in was cancelled.', cancelled: true }
          await note('sign-in-failed', c)
          return { ok: false, error: found.why }
        }
        const stored = c.auth === null ? null : unsealAuth(options.secrets, c.auth)
        const client: ClientChoice =
          typedId !== ''
            ? {
                kind: 'typed',
                clientId: typedId,
                clientSecret: typedSecret === '' ? null : typedSecret
              }
            : stored !== null && stored.clientKind === 'typed'
              ? {
                  kind: 'typed',
                  clientId: stored.client.clientId,
                  clientSecret: stored.client.clientSecret
                }
              : { kind: 'register' }
        if (client.kind === 'register' && found.found.registrationEndpoint === null) {
          await note('sign-in-failed', c)
          return {
            ok: false,
            error:
              'The provider does not register apps by itself. Register the app there (the return address is http://127.0.0.1/callback) and type the client id.'
          }
        }
        const answer = await ask(owner, signInQuestion(c, found.found, client))
        if (answer !== 'yes') return notYes(answer, 'You did not sign in.')
        const result = await runSignIn({
          mcpUrl: address.href,
          found: found.found,
          client,
          guarded,
          open: async (url) => {
            try {
              await options.openBrowser?.(url)
              return true
            } catch {
              return false
            }
          },
          now,
          signal: ctl.signal,
          ...(options.signInWaitMs === undefined ? {} : { waitMs: options.signInWaitMs })
        })
        if (!result.ok) {
          if (result.stopped === true)
            return { ok: false, error: 'The sign-in was cancelled.', cancelled: true }
          await note('sign-in-failed', c)
          return { ok: false, error: result.why }
        }
        const again = (await store.read()).connectors.find((x) => x.id === id)
        const kept = again !== undefined && (await writeAuth(id, result.auth))
        if (!kept) {
          // the provider has issued tokens that cannot be kept: ask it to take them back
          const tmp = createTokenProvider({
            holder: { read: async () => result.auth, write: async () => true },
            guarded,
            now
          })
          await tmp.signOut()
          await note('sign-in-failed', c)
          return {
            ok: false,
            error: 'The sign-in worked, but it could not be kept on this PC, so it was given back.'
          }
        }
        providerFor(c).adopt(result.auth)
        s.signIn = null
        s.problem = null
        await note('signed-in', c)
        stopLive(id)
        const fresh = (await store.read()).connectors.find((x) => x.id === id)
        if (fresh !== undefined)
          await ensure(fresh, new AbortController().signal).catch(() => undefined)
        return ok()
      } finally {
        signing = null
      }
    },

    cancelSignIn: async () => {
      signing?.ctl.abort()
      return ok()
    },

    signOut: async (input) => {
      const id = idOf(input)
      if (id === null) return { ok: false, error: NOT_UNDERSTOOD }
      const { connectors, problem } = await store.read()
      if (problem !== null) return { ok: false, error: UNREADABLE(problem) }
      const c = connectors.find((x) => x.id === id)
      if (c === undefined) return { ok: false, error: NOT_FOUND }
      if (c.auth === null) return ok()
      if (signing?.id === id) signing.ctl.abort()
      stopLive(id)
      const said = await providerFor(c).signOut()
      providers.delete(id)
      const s = seenOf(id)
      s.signIn = {
        kind: 'needed',
        challenge: s.signIn?.challenge ?? null,
        why: SIGN_IN_WORDS.needed
      }
      s.problem = null
      await note('signed-out', c)
      const status0 = await status()
      return said
        ? { ok: true, status: status0 }
        : {
            ok: true,
            status: status0,
            notice:
              'The provider could not be asked to revoke the token (or did not say yes). It is forgotten on this PC.'
          }
    },

    tokens,

    stopAll: () => {
      closing = true
      signing?.ctl.abort()
      for (const id of [...live.keys()]) stopLive(id)
    }
  }
}
