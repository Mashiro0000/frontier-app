import { promises as fs, type Stats } from 'fs'
import { posix, win32 } from 'path'
import type { FileClass, WorkspaceOp, WorkspaceRefusal } from '../shared/workspace'
import {
  isInside,
  lexicalPath,
  partsOf,
  type DataFolderGuard,
  type PathOp,
  type PathVerdict
} from './dataFolderGuard'

// What a tool may reach in the code workspace (Stage 12.1, D-042). The folder is the boundary. This guard says, for a path the model wrote, whether it lies in
// the workspace and may be used, and hands back the one real path to use. It is the CONTAINMENT rule that stands beside the data-folder BLOCK
// (dataFolderGuard.ts): both are asked, and a path must pass both. Fail-closed: a path it cannot be sure about is refused.
//
// What it refuses (each is a check of the suite, with the rule taken out one at a time as a negative control):
//  - a path that is not relative to the workspace (a drive, a root, a share, the `\\?\` form), or that cannot be judged (a stream, a device name, a
//    variable, control and invisible characters, trailing dots made into a name of dots: the data-folder guard's own lexical rules);
//  - a path that leaves the workspace once `.` and `..` are resolved, whole names compared, letter case ignored on Windows and macOS;
//  - a SYMBOLIC LINK OR JUNCTION ANYWHERE ON THE WAY, even one that leads back inside (Node reports a junction as a symbolic link), and a workspace whose
//    own folder has become a link, has gone, or has come to hold (or lie in) the app's data folder since it was chosen;
//  - the data folder (the data-folder guard decides, by name and by where the path really is) and a file with more than one name;
//  - version-control internals and other places that are never reached (`never`), while names that begin with a dot or look like secrets are marked
//    `one-by-one` for the core to ask about (12.2). The class is read off the REAL names, so a short 8.3 name or another letter case cannot hide a name.
//
// What it cannot do: stop another program from swapping a folder for a link between this check and the use (the same limit as D-041; the tools open
// the real path it hands back and check again just before). Windows's Hidden attribute is not read (Node does not report it and the app starts no
// program): names only. A cloud placeholder (OneDrive) or another reparse point that Node does not report as a link is not recognised by the link rule;
// the real path is still compared with the workspace. No Electron imports.

export type { FileClass, WorkspaceOp, WorkspaceRefusal }

export type WorkspaceVerdict =
  | {
      ok: true
      /** The one path to use: absolute, links followed (there are none), in the disk's own letter case where it exists. */
      real: string
      /** The names below the workspace, as they really are. Empty for the workspace itself. */
      rel: string[]
      kind: 'file' | 'folder' | 'missing'
      size: number
      fileClass: FileClass
      /** For `one-by-one`: why (a sentence for the person's question; never from the model). */
      note: string
    }
  | { ok: false; code: WorkspaceRefusal; why: string }

export interface WorkspaceGuard {
  check(request: { path: unknown; op: WorkspaceOp }): Promise<WorkspaceVerdict>
  /** The workspace as it really is now, or why it cannot be used (every use asks again: the setting is not trusted from the file). */
  root(): Promise<{ ok: true; real: string; name: string } | { ok: false; why: string }>
}

export interface WorkspaceGuardOptions {
  /** The chosen folder, asked for at each check (null: none chosen). */
  root: () => string | null
  /** The data-folder block: a path must pass it as well, and the workspace must not hold, equal or lie in the data folder. */
  dataGuard: DataFolderGuard
  platform?: NodeJS.Platform
}

/** Names that are never reached: version-control internals and the system's own places. Matched on every name below the workspace, letter case ignored. */
const NEVER_NAME = /^(\.git|\.hg|\.svn|\$recycle\.bin|system volume information)$/iu
/** Names that look like they hold secrets: asked about one file at a time. Matched on every name below the workspace. */
const SECRET_NAME =
  /^(id_rsa|id_ed25519|id_ecdsa|id_dsa|credentials|secrets?)|\.(pem|key|pfx|p12|ppk|kdbx|jks|keystore|env)$/iu

const OP_FOR_DATA_GUARD: Readonly<Record<WorkspaceOp, PathOp>> = {
  list: 'list',
  read: 'read',
  edit: 'write',
  create: 'create'
}

const no = (
  code: WorkspaceRefusal,
  why: string
): { ok: false; code: WorkspaceRefusal; why: string } => ({
  ok: false,
  code,
  why
})

/**
 * How the names below the workspace are treated (the plan, D4): `never` when any of them is a place that is never reached, `one-by-one` when any begins
 * with a dot or looks like it holds secrets (everything inside such a folder is too), else `ok`. Pure: it looks at names only.
 */
export function classifyNames(names: readonly string[]): { fileClass: FileClass; note: string } {
  for (const name of names) {
    if (NEVER_NAME.test(name)) return { fileClass: 'never', note: 'a place that is never reached' }
  }
  for (const name of names) {
    if (name.startsWith('.')) {
      return { fileClass: 'one-by-one', note: 'its name begins with a dot (a hidden file)' }
    }
    if (SECRET_NAME.test(name)) {
      return { fileClass: 'one-by-one', note: 'its name looks like it holds secrets' }
    }
  }
  return { fileClass: 'ok', note: '' }
}

const ABSOLUTE_WIN = /^[A-Za-z]:|^[\\/]/

export function createWorkspaceGuard(options: WorkspaceGuardOptions): WorkspaceGuard {
  const platform = options.platform ?? process.platform
  const P = platform === 'win32' ? win32 : posix
  const { dataGuard } = options

  /** The workspace as it really is, or why not. */
  async function rootNow(): Promise<
    | { ok: true; abs: string; parts: string[]; real: string; realParts: string[] }
    | { ok: false; code: WorkspaceRefusal; why: string }
  > {
    const chosen = options.root()
    if (chosen === null || chosen === undefined) return no('no-workspace', 'no folder is chosen')
    const lexical = lexicalPath(chosen, null, platform)
    if (!lexical.ok) return no('workspace-changed', 'the chosen folder cannot be understood')
    const parts = partsOf(lexical.abs, platform)
    if (parts.length <= 1) return no('workspace-changed', 'a drive is not a workspace')
    let real: string
    try {
      const found = await fs.lstat(lexical.abs)
      if (found.isSymbolicLink()) return no('workspace-changed', 'the chosen folder is now a link')
      if (!found.isDirectory()) return no('workspace-changed', 'the chosen folder is not a folder')
      real = await fs.realpath(lexical.abs)
    } catch {
      return no('workspace-changed', 'the chosen folder cannot be looked at')
    }
    if (platform === 'win32' && real.startsWith('\\\\')) {
      return no('workspace-changed', 'the chosen folder is on the network')
    }
    const realParts = partsOf(plainPath(real, platform), platform)
    if (!isInside(realParts, parts, platform) || !isInside(parts, realParts, platform)) {
      return no('workspace-changed', 'the chosen folder is reached through a link now')
    }
    // The data folder may not be the workspace, hold it, or lie in it: asked as for a tool that goes through a whole folder.
    let verdict: PathVerdict
    try {
      verdict = await dataGuard.check({
        path: lexical.abs,
        base: null,
        op: 'list',
        recursive: true
      })
    } catch {
      return no('workspace-changed', 'the data-folder check failed')
    }
    if (!verdict.ok)
      return no('workspace-changed', 'the chosen folder is, holds or lies in the data folder')
    return { ok: true, abs: lexical.abs, parts, real: plainPath(real, platform), realParts }
  }

  return {
    root: async () => {
      try {
        const now = await rootNow()
        if (!now.ok) return { ok: false, why: now.why }
        return { ok: true, real: now.real, name: now.parts[now.parts.length - 1] }
      } catch {
        return { ok: false, why: 'the chosen folder could not be checked' }
      }
    },

    check: async (request) => {
      try {
        return await judge(request.path, request.op)
      } catch {
        return no('bad-path', 'the check failed')
      }
    }
  }

  async function judge(raw: unknown, op: WorkspaceOp): Promise<WorkspaceVerdict> {
    if (typeof raw !== 'string' || raw.length === 0) return no('bad-path', 'not text')
    // Only a path relative to the workspace: an absolute one is refused even when it points inside (the model is told the workspace's name, never its place).
    if (platform === 'win32' ? ABSOLUTE_WIN.test(raw) : raw.startsWith('/')) {
      return no('bad-path', 'not a path relative to the workspace')
    }
    const root = await rootNow()
    if (!root.ok) return root

    const lexical = lexicalPath(raw, root.abs, platform)
    if (!lexical.ok) return no('bad-path', lexical.why)
    const parts = partsOf(lexical.abs, platform)
    if (!isInside(parts, root.parts, platform)) return no('outside', 'it leaves the workspace')
    const below = parts.slice(root.parts.length)

    // Every name below the workspace is looked at as it IS, without following anything: a link anywhere on the way is refused.
    let found = 0
    let finalStat: Stats | null = null
    let current = root.abs
    for (let index = 0; index < below.length; index++) {
      current = P.join(current, below[index])
      let stat
      try {
        stat = await fs.lstat(current)
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code
        if (code === 'ENOENT' || code === 'ENOTDIR') break
        return no('bad-path', 'a part of it could not be looked at')
      }
      if (stat.isSymbolicLink()) return no('link', 'a link is on the way')
      found = index + 1
      finalStat = stat
      if (index < below.length - 1 && !stat.isDirectory()) {
        return no('not-a-folder', 'a file is where a folder should be')
      }
    }
    const exists = found === below.length
    if (below.length === 0) finalStat = await fs.lstat(root.abs)

    // Where it really is: the part that exists, links followed (there are none), with the disk's own names; the rest as written.
    let existing = root.abs
    if (found > 0) existing = P.join(root.abs, ...below.slice(0, found))
    let real: string
    try {
      real = plainPath(await fs.realpath(existing), platform)
    } catch {
      return no('bad-path', 'a part of it could not be resolved')
    }
    const realParts = partsOf(real, platform)
    if (!isInside(realParts, root.realParts, platform)) {
      return no('outside', 'it really lies outside the workspace')
    }
    const tail = below.slice(found)
    const relNames = realParts.slice(root.realParts.length).concat(tail)

    // The data-folder block, by name and by where it really is, and the rule for a file with two names.
    const data = await dataGuard.check({
      path: lexical.abs,
      base: null,
      op: OP_FOR_DATA_GUARD[op]
    })
    if (!data.ok) return no(data.code, data.why)

    const { fileClass, note } = classifyNames(relNames)
    if (fileClass === 'never') return no('never', note)

    const kind = exists
      ? finalStat?.isDirectory()
        ? 'folder'
        : finalStat?.isFile()
          ? 'file'
          : null
      : 'missing'
    if (kind === null) return no('bad-path', 'neither a file nor a folder')
    if (op === 'list' && kind !== 'folder')
      return no(kind === 'missing' ? 'not-found' : 'not-a-folder', 'a folder was needed')
    if ((op === 'read' || op === 'edit') && kind !== 'file') {
      return no(kind === 'missing' ? 'not-found' : 'not-a-file', 'a file was needed')
    }
    if (op === 'create' && kind !== 'missing') return no('exists', 'it is there already')

    return {
      ok: true,
      real: P.join(real, ...tail),
      rel: relNames,
      kind,
      size: kind === 'file' && finalStat !== null ? Number(finalStat.size) : 0,
      fileClass,
      note
    }
  }
}

/** What the system says a path is when `\\?\` is put on it: back to the plain form. */
function plainPath(path: string, platform: NodeJS.Platform): string {
  if (platform !== 'win32') return path
  return path.startsWith('\\\\?\\UNC\\')
    ? `\\\\${path.slice(8)}`
    : path.startsWith('\\\\?\\')
      ? path.slice(4)
      : path
}
