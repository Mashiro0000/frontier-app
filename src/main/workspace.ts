import { promises as fs } from 'fs'
import type { WriteMode } from './chatFile'
import type { SecretBox } from './credentialStore'
import { isInside, lexicalPath, partsOf, type DataFolderGuard } from './dataFolderGuard'
import { createKeptFile, type KeptFile } from './keptFile'

// The one folder the person chose as the code workspace (Stage 12.1, D-042): what makes a folder acceptable, and the file that remembers the choice.
//
// The choice. Main opens the system's folder dialog and gets the path from it; the page never supplies one. `checkWorkspaceFolder` then judges it: a real
// folder, not a link or junction, not reached through a link or a substituted drive, not on the network, not a drive's root, not a place the app or the
// system lives in (the places `avoid` lists), and not the app's data folder, a folder that holds it, or one inside it. A refusal is a sentence for the person.
// The choice is shown in the system's own message box with the real path before it is kept (12.3), because it lets the app do more.
//
// The file (`workspace.json`, a kept document like the notes: written like a chat, sealed with the chats when encryption is on, a damaged file never written
// over unless the person starts again). Deny by default: no file, or one that is not exactly what this app writes, means NO workspace. What it holds is
// checked again at every use (workspaceGuard.ts), not trusted. No Electron imports.

export const WORKSPACE_FILE_VERSION = 1
const MAX_FILE_BYTES = 4 * 1024
const MAX_FOLDER_CHARS = 1024
/** The longest folder path that may be chosen as the workspace (the question that names it must fit the box). */
export const WORKSPACE_MAX_FOLDER_CHARS = 300

export interface WorkspaceRecord {
  /** The folder as it really is (the disk's own names, no link on the way). */
  folder: string
  /** When the person chose it (milliseconds since 1970). */
  chosenAt: number
}

export const workspaceText = (record: WorkspaceRecord): string =>
  JSON.stringify({
    version: WORKSPACE_FILE_VERSION,
    folder: record.folder,
    chosenAt: record.chosenAt
  })

/** The record in a file's text, or null when it is not exactly what this app writes (a field more or less, a folder that is not in its tidy absolute form). */
export function parseWorkspace(
  content: string,
  platform: NodeJS.Platform = process.platform
): WorkspaceRecord | null {
  let raw: unknown
  try {
    raw = JSON.parse(content)
  } catch {
    return null
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
  const fields = raw as Record<string, unknown>
  const names = Object.keys(fields)
  if (names.length !== 3 || fields.version !== WORKSPACE_FILE_VERSION) return null
  const { folder, chosenAt } = fields
  if (typeof folder !== 'string' || folder.length > MAX_FOLDER_CHARS) return null
  if (typeof chosenAt !== 'number' || !Number.isSafeInteger(chosenAt) || chosenAt < 0) return null
  const lexical = lexicalPath(folder, null, platform)
  // Only an absolute folder in its own tidy form (what `checkWorkspaceFolder` hands back), never a relative one or one with `..` in it.
  if (!lexical.ok || lexical.abs !== folder || partsOf(lexical.abs, platform).length <= 1)
    return null
  return Object.freeze({ folder, chosenAt })
}

export interface WorkspaceStore {
  /** The chosen folder now, or null; with the reason when the file cannot be read (then there is no workspace). Never throws. */
  read(): Promise<{ record: WorkspaceRecord | null; problem: string | null }>
  /** Keeps a choice (12.3 asks the person first). Throws KeptRefused, or a disk error. */
  write(record: WorkspaceRecord, options?: { replace?: boolean }): Promise<void>
  /** Forgets the choice. */
  clear(options?: { replace?: boolean }): Promise<void>
  /** For the encryption flow. */
  file: KeptFile<WorkspaceRecord>
}

export interface WorkspaceStoreOptions {
  pathOf: () => string
  box?: SecretBox
  writeMode: () => Promise<WriteMode>
  now?: () => number
}

export function createWorkspaceStore(options: WorkspaceStoreOptions): WorkspaceStore {
  const file = createKeptFile<WorkspaceRecord>({
    pathOf: options.pathOf,
    name: 'your workspace setting',
    parse: (text) => parseWorkspace(text),
    text: workspaceText,
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
        if (current.state === 'none') return { record: null, problem: null }
        if (current.state === 'unreadable') return { record: null, problem: current.why }
        return { record: current.value, problem: null }
      } catch (error) {
        // Logged here only; the message could name a path.
        console.error(
          'Reading the workspace setting failed:',
          error instanceof Error ? error.message : error
        )
        return { record: null, problem: 'it could not be read from the disk' }
      }
    },
    write: (record, writeOptions) => file.write(record, writeOptions),
    clear: (clearOptions) => file.remove(clearOptions)
  }
}

/** Places that may not be the workspace (and, for `inside`, may not hold it either): main hands in what the system says (home, Windows, Program Files...). */
export interface AvoidPlaces {
  /** The workspace may not be one of these, nor a folder that holds one (the user's folder, the app-data folders, the system drive's root...). */
  holds: readonly string[]
  /** The workspace may not be one of these, nor lie inside one (Windows, Program Files...). */
  inside: readonly string[]
}

export type WorkspaceChoice =
  { ok: true; folder: string; name: string } | { ok: false; why: string }

const refuse = (why: string): { ok: false; why: string } => ({ ok: false, why })

/**
 * Whether a folder can be the workspace, and the folder as it really is. Never throws. `input` is what the system's folder dialog answered.
 */
export async function checkWorkspaceFolder(
  input: unknown,
  options: { dataGuard: DataFolderGuard; avoid: AvoidPlaces; platform?: NodeJS.Platform }
): Promise<WorkspaceChoice> {
  const platform = options.platform ?? process.platform
  try {
    const lexical = lexicalPath(input, null, platform)
    if (!lexical.ok) return refuse('That is not a folder this app can use as a workspace.')
    const parts = partsOf(lexical.abs, platform)
    if (parts.length <= 1) return refuse("A drive's root cannot be the workspace: choose a folder.")
    let found
    try {
      found = await fs.lstat(lexical.abs)
    } catch {
      return refuse('That folder does not exist.')
    }
    if (found.isSymbolicLink()) {
      return refuse('That is a link or junction. Choose the folder itself, not a link to it.')
    }
    if (!found.isDirectory()) return refuse('That is not a folder.')
    let real: string
    try {
      real = await fs.realpath(lexical.abs)
    } catch {
      return refuse('That folder could not be looked at.')
    }
    if (platform === 'win32') {
      if (
        real.startsWith('\\\\?\\UNC\\') ||
        (real.startsWith('\\\\') && !real.startsWith('\\\\?\\'))
      ) {
        return refuse('A folder on the network cannot be the workspace.')
      }
      if (real.startsWith('\\\\?\\')) real = real.slice(4)
    }
    const realParts = partsOf(real, platform)
    if (!isInside(realParts, parts, platform) || !isInside(parts, realParts, platform)) {
      return refuse(
        'That folder is reached through a link, a substituted drive or a short name. Choose the real folder.'
      )
    }
    try {
      await fs.readdir(real)
    } catch {
      return refuse('That folder cannot be read.')
    }
    for (const place of options.avoid.holds) {
      const named = lexicalPath(place, null, platform)
      if (named.ok && isInside(partsOf(named.abs, platform), realParts, platform)) {
        return refuse(
          'That folder is, or holds, a place the app and the system keep their own files: choose a folder of your project.'
        )
      }
    }
    for (const place of options.avoid.inside) {
      const named = lexicalPath(place, null, platform)
      if (named.ok && isInside(realParts, partsOf(named.abs, platform), platform)) {
        return refuse(
          "That folder is part of the system's own files: choose a folder of your project."
        )
      }
    }
    // The data folder: not the workspace, not holding it, not inside it (asked as for a tool that goes through a whole folder).
    const verdict = await options.dataGuard.check({
      path: real,
      base: null,
      op: 'list',
      recursive: true
    })
    if (!verdict.ok) {
      return refuse(
        "That folder is the app's own data folder, holds it, or lies inside it. Choose a folder of your project."
      )
    }
    const tidy = lexicalPath(real, null, platform)
    if (!tidy.ok) return refuse('That folder could not be checked.')
    // The question that names the folder must fit the system's box in full (toolQuestion.ts), so the folder's path is kept short.
    if (tidy.abs.length > WORKSPACE_MAX_FOLDER_CHARS) {
      return refuse(
        `That folder's path is longer than ${WORKSPACE_MAX_FOLDER_CHARS} characters: choose a folder with a shorter path.`
      )
    }
    return { ok: true, folder: tidy.abs, name: realParts[realParts.length - 1] }
  } catch {
    return refuse('That folder could not be checked.')
  }
}
