// The code workspace, the part that main and (from 12.3) the window share (Stage 12, D-042): the limits that apply to what a tool reads, and how a name
// is sorted. Plain constants and types; nothing here decides anything. The decisions are main's: workspaceGuard.ts (what may be reached) and, from 12.2,
// toolCore.ts (what is asked). No Electron imports.

/** What may be read or proposed in the workspace (the plan, D6). Later slices add the per-reply caps. */
export const WORKSPACE_LIMITS = Object.freeze({
  /** The largest file the model may read or change, in bytes. A bigger file is refused, never cut. */
  maxFileBytes: 256 * 1024,
  /** The most entries one listing shows; the rest are only counted. */
  maxListEntries: 200,
  /** The longest path (relative to the workspace) the model may name. */
  maxPathChars: 300,
  /** The most file calls (a list, a read, a proposal; whatever becomes of them) one reply may make. Web search keeps the tool steps of Stage 11. */
  maxFileCalls: 30,
  /** The most characters of file text one reply may be given in all. */
  maxFileChars: 200_000,
  /** The most characters one read call returns (the core's own cap on a result); the model asks for the next line range. */
  maxReadChars: 60_000,
  /** The longest text a proposal may carry in one argument (a new file; the text to find or to put in its place is at most a fifth of it). */
  maxBodyChars: 100_000
})

/**
 * How a name in the workspace is treated (the plan, D4). `never`: refused, no question (version-control internals, links, the recycle bin).
 * `one-by-one`: a name that begins with a dot or looks like it holds secrets: read only after a question about that one file, naming it. `ok`: the rest.
 */
export const FILE_CLASSES = ['ok', 'one-by-one', 'never'] as const
export type FileClass = (typeof FILE_CLASSES)[number]

/** What the model may do with a path in the workspace. `create` is a file that does not exist yet; `edit` one that does. */
export const WORKSPACE_OPS = ['list', 'read', 'edit', 'create'] as const
export type WorkspaceOp = (typeof WORKSPACE_OPS)[number]

/** Why the workspace said no to a path (never shown to the model word for word: the core answers with fixed sentences). */
export const WORKSPACE_REFUSALS = [
  'no-workspace', //        no folder has been chosen (or the setting could not be read)
  'workspace-changed', //   the chosen folder is not what it was (a link now, gone, or it now holds the data folder)
  'outside', //             the path leaves the workspace
  'link', //                a symbolic link, junction or other link is on the way
  'never', //               version-control internals and other places that are never reached
  'data-folder', //         the app's data folder
  'bad-path', //            a path that cannot be judged, an absolute path, or a file with two names
  'not-found', //           the path (or a folder on the way) does not exist
  'not-a-file', //          a folder where a file was needed
  'not-a-folder', //        a file where a folder was needed
  'exists' //               a new file where one already is
] as const
export type WorkspaceRefusal = (typeof WORKSPACE_REFUSALS)[number]

/**
 * What main says about the code workspace (12.3). `folder` is the chosen folder as it really is, or null. `on` is whether the model may ask to use it (the one
 * "Code workspace" switch, which turns the tools that read on and off together). `problem`: the setting could not be read (there is then no workspace).
 * `unusable`: the chosen folder cannot be used just now, and why (it was moved, replaced by a link, or now holds the data folder).
 */
export interface WorkspaceStatus {
  folder: string | null
  name: string | null
  on: boolean
  problem: string | null
  unusable: string | null
}

/** The answer to a change: `cancelled` means the person closed the folder dialog, or said no in the system's message box, and nothing was changed. */
export type WorkspaceChangeResult =
  { ok: true; status: WorkspaceStatus } | { ok: false; error: string; cancelled?: true }
