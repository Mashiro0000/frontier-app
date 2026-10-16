// Connectors (Stage 14, D-045): tools that other programs offer through the Model Context Protocol (MCP), the part that main and the window share. Plain types
// and constants; nothing here decides anything. The decisions are main's (connectorService.ts, and the one core of tool calls, toolCore.ts). No Electron imports.

/** The limits of the plan's pick I. Main holds them; the page only shows them. */
export const CONNECTOR_LIMITS = Object.freeze({
  /** Connectors in all. */
  connectors: 10,
  /** Tools of one connector that the app lists (a connector that offers more is told so, and the rest are not listed). */
  toolsEach: 50,
  /** Connector tools that may be switched on at once, across every connector: their definitions go with every request and cost tokens. */
  toolsOn: 20,
  /** The most bytes of one message from a connector (a line, an HTTP body, an event). A bigger one ends the connection. */
  messageBytes: 1024 * 1024,
  /** One call, from the yes to its answer (starting the connector included). Stop ends it sooner, and so does the reply's working time. */
  callMs: 60_000,
  /** How long a connector may take to start and say which tools it has. */
  startMs: 30_000,
  /** Characters of a result passed on to the model. */
  resultChars: 20_000,
  /** A connector that has had no call for this long is stopped. */
  idleMs: 5 * 60_000,
  /** What a connector says a tool does: the person reads all of it; the model is given it framed. */
  descriptionChars: 600,
  /** The name the person gives a connector. */
  nameChars: 40,
  /** A local connector's arguments: how many, how long each, how long all together. */
  args: 20,
  argChars: 300,
  argsChars: 2000,
  /** A web address. */
  urlChars: 500,
  /** A pasted token. */
  tokenChars: 4000,
  /** The copy of a local connector's folder (the Stage 13 caps). */
  copyFiles: 20_000,
  copyBytes: 100 * 1024 * 1024,
  /** What a boxed connector may write in its own data folder. */
  dataBytes: 512 * 1024 * 1024
})

/**
 * Where a connector runs. `box`: a program on this PC in the locked box of Stage 13 (no network unless the person gave it; it sees only a copy of its own folder and writes only
 * in a data folder of its own). `as-you`: a program on this PC with every right the person has (not boxed; exists only behind a typed confirmation). `remote`: a web address.
 */
export type ConnectorPlace = 'box' | 'as-you' | 'remote'

export type ConnectorState = 'stopped' | 'starting' | 'running' | 'failed'

/** One tool of a connector as the Tools page shows it. */
export interface ConnectorToolView {
  /** The tool's own name at the connector (cleaned for showing). */
  name: string
  /** The name the model calls it by (`notes__search`), or null when it is not offered. */
  id: string | null
  /** What the connector says the tool does, cleaned and cut: the person reads it before switching the tool on. */
  description: string
  /** Its arguments as the box would show them: "query (text, up to 300 characters)". */
  args: string[]
  /** Why it is not offered (null when it is): "takes a text of up to 100,000 characters". */
  notOffered: string | null
  on: boolean
  /** The connector changed this tool's name, description or arguments since the person switched it on: it is off until they read it again. */
  changed: boolean
  /** The connector says the tool only reads. Shown; it never skips the question. */
  readOnlyClaim: boolean
}

/**
 * Where a web connector's sign-in (Stage 14b) stands. `none`: it has no sign-in (a pasted token, or none needed). `signed-in`: the app holds a token. `needed`: the connector
 * answered that it wants a sign-in. `expired`: the sign-in ended (the provider refused to renew it, or the record cannot be opened on this PC). `more`: the connector wants more
 * permissions than the sign-in gave.
 */
export type AuthKind = 'none' | 'signed-in' | 'needed' | 'expired' | 'more'

export interface AuthView {
  state: AuthKind
  /** The sign-in provider's host once signed in (or while expired), else null. */
  provider: string | null
  /** The permissions kept at the last sign-in. */
  scopes: string[]
  /** The client id kept at the last sign-in (typed or registered), for the page to offer again; never the secret. */
  clientId: string | null
  clientKind: 'typed' | 'registered' | null
  /** A sign-in to this connector is open in the browser now. */
  busy: boolean
  /** The page may offer Sign in: a web connector with no pasted token, and a secure place on this PC to keep the result. */
  canSignIn: boolean
  /** Why it is `expired` or `more`, in the app's words. */
  why: string | null
}

export interface ConnectorView {
  id: string
  name: string
  place: ConnectorPlace
  /** What runs, in full, as the box for adding it showed it: the program and its arguments, or the web address. */
  command: string
  /** Where it runs, in words ("in the box, no network"). */
  where: string
  network: boolean
  /** The folder of the workspace a copy of which it sees (relative), or null. */
  folder: string | null
  hasToken: boolean
  auth: AuthView
  state: ConnectorState
  /** Why it failed last, in a plain sentence, or null. */
  problem: string | null
  /** The tools as last listed (in this session); empty until it has been started once. */
  tools: ConnectorToolView[]
  /** The connector offers more tools than the app lists. */
  moreTools: boolean
  /** When its tools were last listed (milliseconds since 1970), or null. */
  listedAt: number | null
  /** Which revision of MCP it speaks, once known: "2026-07-28" or an older one. */
  version: string | null
}

export interface ConnectorsStatus {
  connectors: ConnectorView[]
  /** The file could not be read: every connector tool is off and nothing can be added until the person starts again. */
  problem: string | null
  /** How many connector tools are on, across every connector. */
  toolsOn: number
  /** Node.js is installed (a local connector that is a script needs it). */
  nodeInstalled: boolean
}

export type ConnectorChangeResult =
  | { ok: true; status: ConnectorsStatus; notice?: string }
  | { ok: false; error: string; cancelled?: true; status?: ConnectorsStatus }

/** What the page sends to add a remote connector. A local one is chosen in the system's own file dialog (main opens it); the page sends only its name and arguments. */
export interface AddLocalInput {
  name: string
  args: string[]
}
/** What the page sends to sign in to a web connector. A client id the person registered by hand at the provider, or '' to let the app register itself. The secret is never sent back. */
export interface SignInInput {
  id: string
  clientId: string
  clientSecret: string
}
export interface AddRemoteInput {
  name: string
  url: string
  /** Pasted by the person, or '' for none. Never shown again, never sent back to the page. */
  token: string
}

/** The words of a place, for the page and the box. */
export function placeWords(place: ConnectorPlace, network: boolean, host?: string): string {
  switch (place) {
    case 'box':
      return network
        ? 'a program on this PC, in the locked box, WITH the network'
        : 'a program on this PC, in the locked box, without the network'
    case 'as-you':
      return 'a program on this PC, NOT boxed: it has every right you have'
    case 'remote':
      return `a web address: ${host ?? 'unknown host'}`
  }
}
