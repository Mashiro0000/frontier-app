import { CONNECTOR_LIMITS, type ConnectorPlace } from '../shared/connectors'
import type { WriteMode } from './chatFile'
import type { SecretBox } from './credentialStore'
import { createKeptFile, type KeptFile } from './keptFile'
import type { ServerTool } from './mcpTools'

// The connectors the person added (Stage 14.6, D-045): connectors.json in the data folder, kept like the person's other documents (keptFile.ts: written like a chat, sealed
// like the chats when encryption is on, a damaged file never written over unless the person starts again). Main alone reads it. DENY BY DEFAULT: no file, or a file that is
// not exactly what this app writes, means no connector and every connector tool OFF.
//
// What it holds of a connector: its name, where it runs, what runs (the program and its arguments, or the web address), its grants, and the tools the person switched on,
// each with what the connector said about it when the person read it (its words, its arguments and their fingerprint), so that a tool can be offered before the connector
// is started (it starts when it is first needed) and so that a tool the connector changes later is noticed. A pasted token is kept SEALED by the system's secure storage
// (as base64); the page never sees it again. No Electron imports.

/** The version this app writes. Version 1 (before the sign-in of Stage 14b, which has no `auth`) is still read. */
export const CONNECTORS_VERSION = 2
const FIRST_VERSION = 1
const MAX_FILE_BYTES = 1024 * 1024
const ID = /^[a-z0-9]{8,16}$/
const PREFIX = /^[a-z][a-z0-9]{0,11}$/
const HIDDEN = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Co}\p{Cn}\p{Cs}]/u
const MAX_SCHEMA_CHARS = 16_000

export interface StoredConnector {
  id: string
  name: string
  /** The start of its tools' names (`notes` in `notes__search`): unique among the connectors. */
  prefix: string
  place: ConnectorPlace
  /** A program on this PC: the file the person chose (a script for node, or an .exe), and the folder a boxed one is given a copy of. Null for a web address. */
  program: string | null
  folder: string | null
  args: string[]
  /** A web address. Null for a program. */
  url: string | null
  /** The pasted token, sealed by the system's secure storage, as base64; null for none. */
  token: string | null
  /** The sign-in (Stage 14b): the whole record of oauthRecord.ts sealed by the system's secure storage, as base64; null for none. Never together with a pasted token. */
  auth: string | null
  /** The grants (each asked about in the system's box): the network, and a copy of the workspace folder. Only for a boxed program. */
  network: boolean
  workspace: boolean
  /** The tools that are switched on, as the person read them. */
  tools: ServerTool[]
  /** Tools the connector changed after they were switched on (they are off until read again). */
  changed: string[]
  added: number
}

const isPlain = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isText = (value: unknown, min: number, max: number): value is string =>
  typeof value === 'string' && value.length >= min && value.length <= max && !HIDDEN.test(value)

function exactKeys(raw: Record<string, unknown>, keys: readonly string[]): boolean {
  const have = Object.keys(raw)
  return (
    have.length === keys.length &&
    keys.every((key) => Object.prototype.hasOwnProperty.call(raw, key))
  )
}

const TOOL_KEYS = [
  'name',
  'title',
  'description',
  'inputSchema',
  'readOnly',
  'fingerprint'
] as const
const CONNECTOR_KEYS_V1 = [
  'id',
  'name',
  'prefix',
  'place',
  'program',
  'folder',
  'args',
  'url',
  'token',
  'network',
  'workspace',
  'tools',
  'changed',
  'added'
] as const
const CONNECTOR_KEYS = [...CONNECTOR_KEYS_V1, 'auth'] as const

function parseTool(raw: unknown): ServerTool | null {
  if (!isPlain(raw) || !exactKeys(raw, TOOL_KEYS)) return null
  const { name, title, description, inputSchema, readOnly, fingerprint } = raw
  if (!isText(name, 1, 128) || name.trim() !== name) return null
  if (title !== null && !isText(title, 1, 60)) return null
  if (typeof description !== 'string' || description.length > CONNECTOR_LIMITS.descriptionChars)
    return null
  if (HIDDEN.test(description)) return null
  if (!isPlain(inputSchema) || JSON.stringify(inputSchema).length > MAX_SCHEMA_CHARS) return null
  if (typeof readOnly !== 'boolean') return null
  if (typeof fingerprint !== 'string' || !/^[0-9a-f]{64}$/.test(fingerprint)) return null
  return { name, title, description, inputSchema, readOnly, fingerprint }
}

function parseConnector(raw: unknown, version: number): StoredConnector | null {
  if (
    !isPlain(raw) ||
    !exactKeys(raw, version === FIRST_VERSION ? CONNECTOR_KEYS_V1 : CONNECTOR_KEYS)
  )
    return null
  const o = raw
  if (typeof o.id !== 'string' || !ID.test(o.id)) return null
  if (!isText(o.name, 1, CONNECTOR_LIMITS.nameChars) || o.name.trim() !== o.name) return null
  if (typeof o.prefix !== 'string' || !PREFIX.test(o.prefix)) return null
  if (o.place !== 'box' && o.place !== 'as-you' && o.place !== 'remote') return null
  if (typeof o.network !== 'boolean' || typeof o.workspace !== 'boolean') return null
  if (typeof o.added !== 'number' || !Number.isSafeInteger(o.added) || o.added <= 0) return null
  if (!Array.isArray(o.args) || o.args.length > CONNECTOR_LIMITS.args) return null
  let argChars = 0
  for (const a of o.args as unknown[]) {
    if (typeof a !== 'string' || a.length > CONNECTOR_LIMITS.argChars || HIDDEN.test(a)) return null
    argChars += a.length
  }
  if (argChars > CONNECTOR_LIMITS.argsChars) return null
  if (o.place === 'remote') {
    if (!isText(o.url, 9, CONNECTOR_LIMITS.urlChars) || !/^https?:\/\/[\x21-\x7e]+$/.test(o.url))
      return null
    if (o.program !== null || o.folder !== null || o.args.length > 0) return null
    if (
      o.token !== null &&
      (typeof o.token !== 'string' || !/^[A-Za-z0-9+/=]{4,12000}$/.test(o.token))
    )
      return null
    if (o.network || o.workspace) return null
    // a sign-in and a pasted token are two ways to the same door: never both
    if (o.auth !== undefined && o.auth !== null) {
      if (
        o.token !== null ||
        typeof o.auth !== 'string' ||
        !/^[A-Za-z0-9+/=]{4,60000}$/.test(o.auth)
      )
        return null
    }
  } else {
    if (o.url !== null || o.token !== null || (o.auth !== undefined && o.auth !== null)) return null
    if (!isText(o.program, 4, 260) || !/^[A-Za-z]:\\/.test(o.program)) return null
    if (!isText(o.folder, 3, 260) || !/^[A-Za-z]:\\/.test(o.folder)) return null
    // the grants are the box's: a program that runs as the person has every right already, and none is kept for it
    if (o.place === 'as-you' && (o.network || o.workspace)) return null
  }
  if (!Array.isArray(o.tools) || o.tools.length > CONNECTOR_LIMITS.toolsOn) return null
  const tools: ServerTool[] = []
  const names = new Set<string>()
  for (const t of o.tools as unknown[]) {
    const tool = parseTool(t)
    if (tool === null || names.has(tool.name)) return null
    names.add(tool.name)
    tools.push(tool)
  }
  if (!Array.isArray(o.changed) || o.changed.length > CONNECTOR_LIMITS.toolsEach) return null
  const changed: string[] = []
  for (const c of o.changed as unknown[]) {
    if (!isText(c, 1, 128) || changed.includes(c)) return null
    changed.push(c)
  }
  return {
    id: o.id,
    name: o.name,
    prefix: o.prefix,
    place: o.place,
    program: o.program as string | null,
    folder: o.folder as string | null,
    args: [...(o.args as string[])],
    url: o.url as string | null,
    token: o.token as string | null,
    auth: (o.auth ?? null) as string | null,
    network: o.network,
    workspace: o.workspace,
    tools,
    changed,
    added: o.added
  }
}

/** The connectors in a file's text, or null when it is not exactly what this app writes. */
export function parseConnectors(content: string): StoredConnector[] | null {
  let raw: unknown
  try {
    raw = JSON.parse(content)
  } catch {
    return null
  }
  if (
    !isPlain(raw) ||
    !exactKeys(raw, ['version', 'connectors']) ||
    (raw.version !== CONNECTORS_VERSION && raw.version !== FIRST_VERSION)
  )
    return null
  if (!Array.isArray(raw.connectors) || raw.connectors.length > CONNECTOR_LIMITS.connectors)
    return null
  const list: StoredConnector[] = []
  const ids = new Set<string>()
  const prefixes = new Set<string>()
  let on = 0
  for (const item of raw.connectors as unknown[]) {
    const c = parseConnector(item, raw.version as number)
    if (c === null || ids.has(c.id) || prefixes.has(c.prefix)) return null
    ids.add(c.id)
    prefixes.add(c.prefix)
    on += c.tools.length
    list.push(c)
  }
  // the cap on tools switched on, across every connector, holds in the file too
  if (on > CONNECTOR_LIMITS.toolsOn) return null
  return list
}

/** The file's own text for the connectors. */
export function connectorsText(list: readonly StoredConnector[]): string {
  return JSON.stringify({
    version: CONNECTORS_VERSION,
    connectors: list.map((c) => ({
      id: c.id,
      name: c.name,
      prefix: c.prefix,
      place: c.place,
      program: c.program,
      folder: c.folder,
      args: [...c.args],
      url: c.url,
      token: c.token,
      auth: c.auth,
      network: c.network,
      workspace: c.workspace,
      tools: c.tools.map((t) => ({
        name: t.name,
        title: t.title,
        description: t.description,
        inputSchema: t.inputSchema,
        readOnly: t.readOnly,
        fingerprint: t.fingerprint
      })),
      changed: [...c.changed],
      added: c.added
    }))
  })
}

export interface ConnectorStore {
  /** The connectors now. Never throws: none when there is no file; none, with the reason, when it cannot be read. */
  read(): Promise<{ connectors: StoredConnector[]; problem: string | null }>
  /** Keeps the list. Throws KeptRefused (a sentence for the person), or a disk error. */
  write(list: readonly StoredConnector[], options?: { replace?: boolean }): Promise<void>
  file: KeptFile<StoredConnector[]>
}

export function createConnectorStore(options: {
  pathOf: () => string
  box?: SecretBox
  writeMode: () => Promise<WriteMode>
  now?: () => number
}): ConnectorStore {
  const file = createKeptFile<StoredConnector[]>({
    pathOf: options.pathOf,
    name: 'your connectors',
    parse: parseConnectors,
    text: connectorsText,
    maxBytes: MAX_FILE_BYTES,
    box: options.box,
    writeMode: options.writeMode,
    now: options.now
  })
  return {
    file,
    read: async () => {
      try {
        const current = await file.read()
        if (current.state === 'none') return { connectors: [], problem: null }
        if (current.state === 'unreadable') return { connectors: [], problem: current.why }
        return { connectors: current.value, problem: null }
      } catch (error) {
        console.error(
          'Reading the connectors failed:',
          error instanceof Error ? error.message : error
        )
        return { connectors: [], problem: 'it could not be read' }
      }
    },
    write: (list, writeOptions) => file.write([...list], writeOptions)
  }
}
