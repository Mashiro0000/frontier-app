import { promises as fs } from 'fs'
import { posix, win32 } from 'path'

// The block that keeps every tool out of the app's data folder (Stage 11.1, D-041; the owner's addition to the plan). The data folder holds what the
// person wrote and what the app trusts: the chats, the notes, the instructions, the projects, the limits, the keys, and from 11.2 the audit log. A tool
// that could read it would send it to a provider; a tool that could write it would add words to every message (D-040) or take the limits away, with no
// question. So ONE guard decides, for every tool argument that is a path, whether it lies in the data folder, and it says no before anything is asked or
// run. It is fail-closed: a path it cannot be sure about is refused, not allowed.
//
// What it catches (each is a check of the suite, with the guard weakened one way at a time as a negative control):
//  - every spelling of a path in the folder: other letter case, `/` for `\`, `..` and `.`, doubled separators, trailing dots and spaces (Windows ignores
//    them), the `\\?\C:\` form, a relative path taken from a base folder;
//  - the same place under another name: a junction or symbolic link (also to a file that does not exist yet), a drive made with `subst`, a short 8.3 name,
//    a second name of one file (a hard link: a file with more than one name is refused whatever it is);
//  - paths it will not judge at all: a share on this computer (`\\localhost\C$\...`) or any network path, a device or volume path, a stream of a file
//    (`file:stream`), a name Windows treats as a device (`CON`, `NUL`), `%VARIABLE%` (another program would expand it), a path relative to a drive or to
//    the current drive, a control or invisible character, anything not a string;
//  - a tool that goes through a whole folder (a search, a listing of a tree, a copy or delete of a folder) given a folder that HOLDS the data folder.
//
// What it cannot do: stop a tool that opens the path later by another route. The guard hands back the real, resolved path (`real`), and a tool must use
// only that; it must not follow links when it opens it; and a tool that runs free text as a command cannot be held back by a check of paths at all
// (Stage 13 must deal with that on its own: D-041). No Electron imports.

/** What a tool does with a path. `delete` is always treated as going through the whole of a folder. */
export type PathOp = 'read' | 'write' | 'list' | 'create' | 'delete' | 'stat'

export interface PathRequest {
  /** What the tool was given, exactly. */
  path: unknown
  /** The folder that a relative path is taken from, or null when only an absolute path is accepted. */
  base: string | null
  op: PathOp
  /** True when the tool goes through everything under the path (a search, a copy, a listing of a tree). */
  recursive?: boolean
}

export type PathRefusal = 'data-folder' | 'bad-path'

/** `real` is the one path the tool may use: absolute, with every link followed. `why` is for the checks and the log, never for the model. */
export type PathVerdict = { ok: true; real: string } | { ok: false; code: PathRefusal; why: string }

export interface DataFolderGuard {
  check(request: PathRequest): Promise<PathVerdict>
}

export interface GuardOptions {
  /** The folders to keep out of every tool's reach (main hands in the data folder). Asked for at each check, so it is not needed before it is known. */
  roots: () => readonly string[]
  platform?: NodeJS.Platform
}

const MAX_PATH_CHARS = 2048
/** Windows treats these names (with or without an extension) as devices, wherever they are in a path. */
const DEVICE_NAME =
  /^(con|prn|aux|nul|com[1-9\u00b9\u00b2\u00b3]|lpt[1-9\u00b9\u00b2\u00b3]|conin\$|conout\$)(\..*)?$/i
const UNREADABLE_CHARS = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Co}\p{Cn}\p{Cs}]/u

export type Lexical = { ok: true; abs: string } | { ok: false; why: string }

const no = (why: string): { ok: false; why: string } => ({ ok: false, why })

/**
 * The absolute, tidy form of a path, from its text alone (nothing on the disk is looked at): `.` and `..` resolved, separators made one kind, trailing
 * dots and spaces dropped where Windows ignores them. Refuses what it will not judge (see the top of the file).
 */
export function lexicalPath(
  raw: unknown,
  base: string | null,
  platform: NodeJS.Platform = process.platform
): Lexical {
  const win = platform === 'win32'
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_PATH_CHARS) {
    return no('not text of a sensible length')
  }
  if (UNREADABLE_CHARS.test(raw)) return no('control, invisible or unassigned characters')
  let text = raw
  let full: string
  if (win) {
    if (/^[\\/]{2}[?.][\\/]/.test(text)) {
      const extended = /^\\\\\?\\([A-Za-z]:[\\/].*)$/.exec(text) // only \\?\C:\... is understood
      if (extended === null) return no('a device or volume path')
      text = extended[1]
    } else if (/^[\\/]{2}/.test(text)) {
      return no('a network path')
    }
    if (text.includes('%')) return no('a variable that another program would expand')
    const drive = /^[A-Za-z]:/.exec(text)
    const rest = drive === null ? text : text.slice(2)
    if (/[<>:"|?*]/.test(rest)) return no('characters that are not allowed in a name, or a stream')
    if (drive !== null && !/^[\\/]/.test(rest)) return no('a path relative to a drive')
    if (drive === null && /^[\\/]/.test(rest)) return no('a path relative to the current drive')
    if (drive !== null) {
      full = text
    } else {
      if (base === null) return no('a relative path and no folder to take it from')
      const folder = lexicalPath(base, null, platform)
      if (!folder.ok) return folder
      full = `${folder.abs}\\${text}`
    }
  } else if (text.startsWith('/')) {
    full = text
  } else {
    if (base === null) return no('a relative path and no folder to take it from')
    const folder = lexicalPath(base, null, platform)
    if (!folder.ok) return folder
    full = `${folder.abs}/${text}`
  }
  const pieces = full.split(win ? /[\\/]+/ : /\/+/)
  const out: string[] = [pieces[0]] // 'C:' on Windows, '' before the first / elsewhere
  for (const piece of pieces.slice(1)) {
    if (piece === '' || piece === '.') continue
    if (piece === '..') {
      if (out.length > 1) out.pop() // never above the root
      continue
    }
    let name = piece
    if (win) {
      if (/^[. ]+$/.test(name)) return no('a name made of dots or spaces')
      name = name.replace(/[. ]+$/, '') // Windows ignores trailing dots and spaces
      if (DEVICE_NAME.test(name)) return no('a name Windows treats as a device')
    }
    out.push(name)
  }
  return {
    ok: true,
    abs: win ? `${out[0]}\\${out.slice(1).join('\\')}` : `/${out.slice(1).join('/')}`
  }
}

/** The names of an absolute path, root first: ['C:', 'Users', ...] or ['', 'home', ...]. */
export const partsOf = (abs: string, platform: NodeJS.Platform = process.platform): string[] =>
  (platform === 'win32' ? abs.split(/[\\/]+/) : abs.split('/')).filter(
    (name, index) => index === 0 || name !== ''
  )

const caseBlind = (platform: NodeJS.Platform): boolean =>
  platform === 'win32' || platform === 'darwin'

/** Two names are the same place. On Windows and macOS letter case does not tell places apart; both folds are tried, so a rule of one cannot be slipped past. */
const sameName = (a: string, b: string, blind: boolean): boolean =>
  a === b || (blind && (a.toLowerCase() === b.toLowerCase() || a.toUpperCase() === b.toUpperCase()))

/** True when `child` is `root` or lies under it, by whole names (so `frontier-app2` is not inside `frontier-app`). */
export function isInside(
  child: readonly string[],
  root: readonly string[],
  platform: NodeJS.Platform = process.platform
): boolean {
  if (root.length === 0 || child.length < root.length) return false
  const blind = caseBlind(platform)
  return root.every((name, index) => sameName(child[index], name, blind))
}

/** What the system says a path is when `\\?\` is put on it: back to the plain form. A share stays a share (`\\server\share`). */
const plain = (path: string): string =>
  path.startsWith('\\\\?\\UNC\\')
    ? `\\\\${path.slice(8)}`
    : path.startsWith('\\\\?\\')
      ? path.slice(4)
      : path

type Resolved = { ok: true; real: string; exists: boolean } | { ok: false; why: string }

/**
 * Where a path really is: the longest part of it that exists, with every link followed, short names made long and the letters in the case the disk has,
 * and then the rest as it was written (it does not exist, so no link can be in it). A link that leads nowhere is refused: it could be a path to a file
 * that a write would create inside the data folder.
 */
async function resolveReal(abs: string, platform: NodeJS.Platform): Promise<Resolved> {
  const P = platform === 'win32' ? win32 : posix
  let existing = abs
  const rest: string[] = []
  for (;;) {
    try {
      await fs.lstat(existing)
      break
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'ENOENT' && code !== 'ENOTDIR') return no('a part of it could not be looked at')
    }
    const parent = P.dirname(existing)
    if (parent === existing) return no('no part of it exists')
    rest.unshift(P.basename(existing))
    existing = parent
  }
  let real: string
  try {
    real = plain(await fs.realpath(existing))
  } catch {
    return no('a link that leads nowhere, or a part that could not be resolved')
  }
  if (platform === 'win32' && real.startsWith('\\\\')) return no('a network location')
  return {
    ok: true,
    real: rest.length === 0 ? real : P.join(real, ...rest),
    exists: rest.length === 0
  }
}

export function createDataFolderGuard(options: GuardOptions): DataFolderGuard {
  const platform = options.platform ?? process.platform
  return {
    check: async (request) => {
      const folders = options.roots()
      const lexical = lexicalPath(request.path, request.base, platform)
      if (!lexical.ok) return { ok: false, code: 'bad-path', why: lexical.why }
      // No known data folder means nothing can be kept out of: nothing passes.
      if (folders.length === 0)
        return { ok: false, code: 'data-folder', why: 'no data folder is known' }

      const roots: string[][] = []
      for (const folder of folders) {
        const named = lexicalPath(folder, null, platform)
        if (!named.ok)
          return { ok: false, code: 'data-folder', why: 'the data folder cannot be understood' }
        roots.push(partsOf(named.abs, platform))
        try {
          roots.push(partsOf(plain(await fs.realpath(folder)), platform)) // the data folder may itself be reached through a link
        } catch {
          // a data folder that does not exist yet: its written name is all there is
        }
      }

      // Going through a whole folder: a folder that holds the data folder is refused as well, however it was reached. A delete always goes through all.
      const tree = request.recursive === true || request.op === 'delete'
      const against = (abs: string): PathRefusal | null => {
        const here = partsOf(abs, platform)
        for (const root of roots) {
          if (isInside(here, root, platform)) return 'data-folder'
          if (tree && isInside(root, here, platform)) return 'data-folder'
        }
        return null
      }

      const lexicalRefusal = against(lexical.abs)
      if (lexicalRefusal !== null) return { ok: false, code: lexicalRefusal, why: 'by its name' }

      const resolved = await resolveReal(lexical.abs, platform)
      if (!resolved.ok) return { ok: false, code: 'bad-path', why: resolved.why }
      const physicalRefusal = against(resolved.real)
      if (physicalRefusal !== null)
        return { ok: false, code: physicalRefusal, why: 'by where it really is' }

      if (resolved.exists) {
        // One file with two names cannot be told from its other name by a check of paths.
        try {
          const found = await fs.stat(resolved.real)
          if (found.isFile() && found.nlink > 1) {
            return { ok: false, code: 'bad-path', why: 'a file with more than one name' }
          }
        } catch {
          return { ok: false, code: 'bad-path', why: 'it could not be looked at' }
        }
      }
      return { ok: true, real: resolved.real }
    }
  }
}
