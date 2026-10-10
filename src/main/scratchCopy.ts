import { createHash, randomBytes } from 'crypto'
import { promises as fs } from 'fs'
import { win32 } from 'path'
import { RUN_LIMITS, SCRATCH } from '../shared/run'
import { WORKSPACE_LIMITS } from '../shared/workspace'
import { isInside, sweepMounts } from './commandRunner'
import { heldKey, type SavedKey } from './secrets'
import { classifyNames } from './workspaceGuard'
import { decodeText, type LineEnding } from './workspaceText'

// The scratch copy (Stage 13.3, D-043): a program never works in the person's folder. The files the model may see (the Stage 12 rules) are copied into a fresh folder
// of the app's own, the program works there, and when it is over the folder is compared with what was copied: changed and new text files become candidates for proposals
// (13.5 makes them proposals; nothing reaches the real folder without the Review window and the person's yes). The real folder is only ever READ here; every write, make,
// rename and removal of this file is inside the run root (checked by a suite that watches every call to the file system).
//
// What is copied (the same rules as the tools of Stage 12, read off the REAL names): ordinary files and folders. Left out, and counted by reason: links of any kind (Node
// reports a junction as a link), a file with more than one name, `.git` and the other places that are never reached, names that begin with a dot or look like secrets (and
// everything inside such a folder), a file that holds one of the app's saved keys, the one folder name this file reserves for the launcher, a path that is too long, anything
// that is not a file or a folder, a file that could not be read or changed while it was copied. More than the caps (20,000 files, 100 MB) and nothing is copied at all: the
// answer says so in words, and the model may ask to run in a subfolder (which copies only that).
//
// What is looked at afterwards: every file of the scratch folder, by hash (a file of the same size is compared by content). Links the program made are not followed and are
// left out; the launcher's own folder is skipped; a changed or new file is a candidate only if it is text (UTF-8), small (the Stage 12 file cap), and not in a class the
// copy would have left out. The rest are listed, never brought back. A file the program deleted is only listed.
//
// No Electron imports; the saved keys come in as a function.

export type CopyLeftOutWhy =
  | 'link'
  | 'hard-link'
  | 'never'
  | 'hidden-or-secret'
  | 'holds-a-key'
  | 'reserved'
  | 'special'
  | 'path-too-long'
  | 'unreadable'
  | 'changed-while-copying'

export interface CopyLeftOut {
  /** The path below the copied folder, with `/`. */
  path: string
  why: CopyLeftOutWhy
  folder: boolean
}

export interface ScratchManifest {
  /** The real folder that was copied (the workspace, or a subfolder of it). */
  source: string
  /** The names of that folder below the workspace (none: the whole workspace). */
  prefix: string[]
  /** What was copied: the path below the scratch folder (with `/`) and what the file was. */
  files: ReadonlyMap<string, { size: number; sha256: string }>
  dirs: ReadonlySet<string>
  /** What was left out: the first SCRATCH.maxListed of each kind in the list, all of them in the counts. */
  leftOut: CopyLeftOut[]
  leftOutCounts: Readonly<Record<CopyLeftOutWhy, number>>
  copiedFiles: number
  copiedBytes: number
}

export type MakeScratchResult =
  | { ok: true; id: string; dir: string; manifest: ScratchManifest }
  | { ok: false; code: 'too-many-files' | 'too-big' | 'source' | 'disk'; message: string }

export interface MakeScratchOptions {
  /** The app's folder for runs (see commandRunner.ts). The scratch folder is made inside it, in `scratch/<id>`. */
  runRoot: string
  /** The real folder to copy: already judged by the workspace guard (containment, no links, not the data folder). Only read. */
  source: string
  /** The names of `source` below the workspace root (empty for the workspace itself): the class of a name is read with them in front. */
  prefix?: readonly string[]
  /** The app's saved keys: a file that holds one is left out. */
  savedKeys?: () => Promise<readonly SavedKey[]>
  /** For checks: smaller caps. */
  limits?: { files?: number; bytes?: number }
  /** For checks: called between looking and copying (the place where a file can change under us). */
  afterLook?: () => Promise<void>
  /**
   * Look at what WOULD be copied and stop: nothing is made, no file is read, the answer holds the counts (what would be copied and what is left out) with an empty
   * manifest and no folder. The question before a run (13.4) shows these; the copy itself is made after the yes, and looks again.
   */
  lookOnly?: boolean
}

/** How many left-out entries are named in the manifest; the counts are whole. */
const MAX_LEFT_OUT_LISTED = 1000

const COUNT_KEYS: readonly CopyLeftOutWhy[] = [
  'link',
  'hard-link',
  'never',
  'hidden-or-secret',
  'holds-a-key',
  'reserved',
  'special',
  'path-too-long',
  'unreadable',
  'changed-while-copying'
]
const emptyCounts = (): Record<CopyLeftOutWhy, number> =>
  Object.fromEntries(COUNT_KEYS.map((k) => [k, 0])) as Record<CopyLeftOutWhy, number>

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')
const fmt = (n: number): string => n.toLocaleString('en-US')
const byName = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

interface Entry {
  rel: string[]
  size: number
}

/** The scratch folder of one run, made and filled. */
export async function makeScratch(options: MakeScratchOptions): Promise<MakeScratchResult> {
  const runRoot = win32.resolve(options.runRoot)
  const source = win32.resolve(options.source)
  const prefix = [...(options.prefix ?? [])]
  const maxFiles = options.limits?.files ?? RUN_LIMITS.copyFiles
  const maxBytes = options.limits?.bytes ?? RUN_LIMITS.copyBytes
  try {
    const found = await fs.lstat(source)
    if (found.isSymbolicLink() || !found.isDirectory()) {
      return { ok: false, code: 'source', message: 'The folder to copy is not an ordinary folder.' }
    }
  } catch {
    return { ok: false, code: 'source', message: 'The folder to copy is not there.' }
  }

  // ---- looking: what would be copied, and what is left out ----
  const leftOut: CopyLeftOut[] = []
  const counts = emptyCounts()
  const leave = (rel: string[], why: CopyLeftOutWhy, folder: boolean): void => {
    counts[why]++
    if (leftOut.length < MAX_LEFT_OUT_LISTED) leftOut.push({ path: rel.join('/'), why, folder })
  }
  const dirs: string[][] = []
  const files: Entry[] = []
  let bytes = 0
  const stack: string[][] = [[]]
  while (stack.length > 0) {
    const rel = stack.pop() as string[]
    let names: import('fs').Dirent[]
    try {
      names = await fs.readdir(win32.join(source, ...rel), { withFileTypes: true })
    } catch {
      leave(rel, 'unreadable', true)
      continue
    }
    names.sort((a, b) => byName(a.name, b.name))
    for (const entry of names) {
      const here = [...rel, entry.name]
      const folder = entry.isDirectory()
      if (rel.length === 0 && entry.name.toLowerCase() === SCRATCH.reserved) {
        leave(here, 'reserved', folder)
        continue
      }
      const kind = classifyNames([...prefix, ...here]).fileClass
      if (kind === 'never') {
        leave(here, 'never', folder)
        continue
      }
      if (kind === 'one-by-one') {
        leave(here, 'hidden-or-secret', folder)
        continue
      }
      if (entry.isSymbolicLink()) {
        leave(here, 'link', folder)
        continue
      }
      if (here.join('/').length > SCRATCH.maxPathChars) {
        leave(here, 'path-too-long', folder)
        continue
      }
      if (folder) {
        dirs.push(here)
        if (dirs.length + files.length > maxFiles) return tooMany(maxFiles)
        stack.push(here)
        continue
      }
      if (!entry.isFile()) {
        leave(here, 'special', false)
        continue
      }
      let info: import('fs').Stats
      try {
        info = await fs.lstat(win32.join(source, ...here))
      } catch {
        leave(here, 'unreadable', false)
        continue
      }
      if (info.nlink > 1) {
        leave(here, 'hard-link', false)
        continue
      }
      files.push({ rel: here, size: info.size })
      bytes += info.size
      if (dirs.length + files.length > maxFiles) return tooMany(maxFiles)
      if (bytes > maxBytes) return tooBig(maxBytes)
    }
  }
  if (options.lookOnly === true) {
    return {
      ok: true,
      id: '',
      dir: '',
      manifest: {
        source,
        prefix,
        files: new Map(),
        dirs: new Set(),
        leftOut,
        leftOutCounts: counts,
        copiedFiles: files.length,
        copiedBytes: bytes
      }
    }
  }
  await options.afterLook?.()

  // ---- copying ----
  const id = randomBytes(6).toString('hex')
  const dir = win32.join(runRoot, 'scratch', id)
  const manifestFiles = new Map<string, { size: number; sha256: string }>()
  const manifestDirs = new Set<string>()
  const keys = (await options.savedKeys?.()) ?? []
  let copiedBytes = 0
  try {
    await fs.mkdir(dir, { recursive: true })
    for (const d of dirs) {
      await fs.mkdir(win32.join(dir, ...d), { recursive: true })
      manifestDirs.add(d.join('/'))
    }
    let at = 0
    const worker = async (): Promise<void> => {
      while (at < files.length) {
        const { rel, size } = files[at++]
        const from = win32.join(source, ...rel)
        let data: Buffer
        try {
          data = await fs.readFile(from)
        } catch {
          leave(rel, 'unreadable', false)
          continue
        }
        if (data.length !== size) {
          leave(rel, 'changed-while-copying', false)
          continue
        }
        if (holdsKey(data, keys)) {
          leave(rel, 'holds-a-key', false)
          continue
        }
        copiedBytes += data.length
        if (copiedBytes > maxBytes) throw new CapError('the files together are more than the limit')
        try {
          await fs.writeFile(win32.join(dir, ...rel), data, { flag: 'wx' })
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOSPC') throw error
          leave(rel, 'unreadable', false)
          copiedBytes -= data.length
          continue
        }
        manifestFiles.set(rel.join('/'), { size: data.length, sha256: sha256(data) })
      }
    }
    await Promise.all(Array.from({ length: 8 }, worker))
  } catch (error) {
    await removeScratch(dir, runRoot)
    if (error instanceof CapError) return tooBig(maxBytes)
    return {
      ok: false,
      code: 'disk',
      message: `The copy could not be made: ${String((error as Error).message ?? error).slice(0, 160)}`
    }
  }
  return {
    ok: true,
    id,
    dir,
    manifest: {
      source,
      prefix,
      files: manifestFiles,
      dirs: manifestDirs,
      leftOut,
      leftOutCounts: counts,
      copiedFiles: manifestFiles.size,
      copiedBytes
    }
  }
}

/** Thrown when the files together turn out bigger than the limit while they are being copied. */
class CapError extends Error {}

function tooMany(limit: number): MakeScratchResult {
  return {
    ok: false,
    code: 'too-many-files',
    message: `The folder holds more than ${fmt(limit)} files and folders, more than a run may copy. Ask to run in a subfolder, which copies only that.`
  }
}

function tooBig(limit: number): MakeScratchResult {
  return {
    ok: false,
    code: 'too-big',
    message: `The files in the folder are more than ${fmt(Math.round(limit / (1024 * 1024)))} MB together, more than a run may copy. Ask to run in a subfolder, which copies only that.`
  }
}

/** True when the bytes hold one of the saved keys: all the looks of it in a small file, the whole key in a big one. */
function holdsKey(data: Buffer, keys: readonly SavedKey[]): boolean {
  if (keys.length === 0) return false
  if (data.length <= SCRATCH.keyScanBytes) return heldKey(data.toString('latin1'), keys) !== null
  return keys.some(({ key }) => key.length > 0 && data.includes(key))
}

// ============================ after the run ================================

export type ChangeLeftOutWhy =
  | 'never'
  | 'hidden-or-secret'
  | 'too-big'
  | 'not-text'
  | 'link'
  | 'special'
  | 'unreadable'
  | 'path-too-long'

export interface Candidate {
  kind: 'changed' | 'created'
  /** The names below the workspace root (the copied folder's own names in front). */
  rel: string[]
  path: string
  text: string
  bom: boolean
  eol: LineEnding
  bytes: number
  /** For a changed file: the SHA-256 of the file as it was copied (the proposal must find the real file still like that). */
  baseSha256: string | null
}

export interface Comparison {
  candidates: Candidate[]
  /** Changed or new things that cannot be brought back, and why. */
  leftOut: { path: string; kind: 'changed' | 'created' | 'link'; why: ChangeLeftOutWhy }[]
  /** Files that were copied and are not there now. */
  deleted: string[]
  counts: {
    unchanged: number
    changed: number
    created: number
    deleted: number
    candidates: number
    leftOut: number
  }
  /** A list above was cut at its limit (the counts are whole). */
  truncated: boolean
}

export async function compareScratch(dir: string, manifest: ScratchManifest): Promise<Comparison> {
  const candidates: Candidate[] = []
  const leftOut: Comparison['leftOut'] = []
  const seen = new Set<string>()
  const counts = { unchanged: 0, changed: 0, created: 0, deleted: 0, candidates: 0, leftOut: 0 }
  let truncated = false
  const out = (path: string, kind: 'changed' | 'created' | 'link', why: ChangeLeftOutWhy): void => {
    counts.leftOut++
    if (leftOut.length < SCRATCH.maxListed) leftOut.push({ path, kind, why })
    else truncated = true
  }
  const stack: string[][] = [[]]
  while (stack.length > 0) {
    const rel = stack.pop() as string[]
    let names: import('fs').Dirent[]
    try {
      names = await fs.readdir(win32.join(dir, ...rel), { withFileTypes: true })
    } catch {
      continue
    }
    names.sort((a, b) => byName(a.name, b.name))
    for (const entry of names) {
      const here = [...rel, entry.name]
      const key = here.join('/')
      if (rel.length === 0 && entry.name.toLowerCase() === SCRATCH.reserved) continue
      if (entry.isSymbolicLink()) {
        out(key, 'link', 'link')
        continue
      }
      if (entry.isDirectory()) {
        stack.push(here)
        continue
      }
      if (!entry.isFile()) {
        out(key, 'created', 'special')
        continue
      }
      seen.add(key)
      const before = manifest.files.get(key)
      const full = win32.join(dir, ...here)
      let data: Buffer | null = null
      let size: number
      try {
        size = (await fs.lstat(full)).size
      } catch {
        out(key, before ? 'changed' : 'created', 'unreadable')
        continue
      }
      if (before !== undefined && before.size === size) {
        try {
          data = await fs.readFile(full)
        } catch {
          out(key, 'changed', 'unreadable')
          continue
        }
        if (sha256(data) === before.sha256) {
          counts.unchanged++
          continue
        }
      }
      const kind = before === undefined ? 'created' : 'changed'
      counts[kind]++
      const names2 = [...manifest.prefix, ...here]
      const path = names2.join('/')
      const cls = classifyNames(names2).fileClass
      if (cls === 'never') {
        out(path, kind, 'never')
        continue
      }
      if (cls === 'one-by-one') {
        out(path, kind, 'hidden-or-secret')
        continue
      }
      if (key.length > SCRATCH.maxPathChars) {
        out(path, kind, 'path-too-long')
        continue
      }
      if (size > WORKSPACE_LIMITS.maxFileBytes) {
        out(path, kind, 'too-big')
        continue
      }
      if (data === null) {
        try {
          data = await fs.readFile(full)
        } catch {
          out(path, kind, 'unreadable')
          continue
        }
      }
      const decoded = decodeText(data)
      if (!decoded.ok) {
        out(path, kind, 'not-text')
        continue
      }
      if (candidates.length >= SCRATCH.maxCandidates) {
        counts.leftOut++
        truncated = true
        continue
      }
      candidates.push({
        kind,
        rel: names2,
        path,
        text: decoded.text,
        bom: decoded.bom,
        eol: decoded.eol,
        bytes: data.length,
        baseSha256: before?.sha256 ?? null
      })
    }
  }
  const deleted: string[] = []
  for (const key of manifest.files.keys()) {
    if (seen.has(key)) continue
    counts.deleted++
    if (deleted.length < SCRATCH.maxListed)
      deleted.push([...manifest.prefix, ...key.split('/')].join('/'))
    else truncated = true
  }
  counts.candidates = candidates.length
  candidates.sort((a, b) => byName(a.path, b.path))
  return { candidates, leftOut, deleted, counts, truncated }
}

// ============================ clearing up ==================================

/**
 * Removes one scratch folder. It refuses anything that is not a folder directly below `<run root>/scratch` (so a mistake cannot remove anything else), never follows a link
 * (Node removes a junction itself, not what it leads to), and tries again for a few seconds (Windows holds a file for a moment after a program ends). True when it is gone.
 */
export async function removeScratch(dir: string, runRootInput: string): Promise<boolean> {
  const runRoot = win32.resolve(runRootInput)
  const target = win32.resolve(dir)
  const home = win32.join(runRoot, 'scratch')
  if (!isInside(home, target) || win32.dirname(target).toLowerCase() !== home.toLowerCase())
    return false
  try {
    await fs.rm(target, { recursive: true, force: true, maxRetries: 12, retryDelay: 250 })
  } catch {
    /* looked at below */
  }
  try {
    await fs.lstat(target)
    return false
  } catch {
    return true
  }
}

export interface StartupSweep {
  scratchRemoved: number
  scratchLeft: number
  specsRemoved: number
  lettersRemoved: string[]
}

/**
 * At start-up, when no run can be going on: takes away what a crash left behind. Drive letters that point into the run root, every scratch folder, every spec and result
 * file of the launcher. The folders for the launcher and the private tools stay.
 */
export async function sweepStartup(runRootInput: string): Promise<StartupSweep> {
  const runRoot = win32.resolve(runRootInput)
  const sweep: StartupSweep = {
    scratchRemoved: 0,
    scratchLeft: 0,
    specsRemoved: 0,
    lettersRemoved: sweepMounts(runRoot)
  }
  const home = win32.join(runRoot, 'scratch')
  let names: string[] = []
  try {
    names = await fs.readdir(home)
  } catch {
    names = []
  }
  for (const name of names) {
    if (await removeScratch(win32.join(home, name), runRoot)) sweep.scratchRemoved++
    else sweep.scratchLeft++
  }
  const specs = win32.join(runRoot, 'specs')
  let specNames: string[] = []
  try {
    specNames = await fs.readdir(specs)
  } catch {
    specNames = []
  }
  for (const name of specNames) {
    try {
      await fs.rm(win32.join(specs, name), { recursive: true, force: true })
      sweep.specsRemoved++
    } catch {
      /* left; the next start tries again */
    }
  }
  return sweep
}

// ============================ where the run root lives ======================

export interface RunRootChoice {
  ok: true
  root: string
  /** Which candidate was used (0 is the first choice). */
  index: number
}

/**
 * The first of the candidate folders where a run can live. A candidate is used only if the folder can be made and a file in it can be written, renamed and deleted
 * (an encrypted folder fails the rename, D-043) and a folder can be made and removed. The first choice is the workspace's own drive (the owner's C: is short of space;
 * a copy on the same drive is quicker), then the system's temp folder.
 */
export async function chooseRunRoot(
  candidates: readonly string[]
): Promise<RunRootChoice | { ok: false; message: string }> {
  for (let index = 0; index < candidates.length; index++) {
    const root = win32.resolve(candidates[index])
    const probe = win32.join(root, `probe-${randomBytes(4).toString('hex')}`)
    try {
      await fs.mkdir(win32.join(probe, 'sub'), { recursive: true })
      await fs.writeFile(win32.join(probe, 'a.txt'), 'x')
      await fs.rename(win32.join(probe, 'a.txt'), win32.join(probe, 'b.txt'))
      await fs.writeFile(win32.join(probe, 'sub', 'c.txt'), 'y')
      await fs.rm(win32.join(probe, 'b.txt'))
      await fs.rm(probe, { recursive: true })
      return { ok: true, root, index }
    } catch {
      await fs.rm(probe, { recursive: true, force: true }).catch(() => undefined)
    }
  }
  return {
    ok: false,
    message:
      'There is no folder on this PC where a program can be run: none of the places tried can be written, renamed in and cleared.'
  }
}

/** The candidates for the run root, in order: a folder at the root of the workspace's drive, then one in the system's temp folder. */
export function runRootCandidates(
  workspaceReal: string,
  systemTemp: string,
  folderName = 'FrontierRun'
): string[] {
  const drive = win32.parse(win32.resolve(workspaceReal)).root
  return [win32.join(drive, folderName), win32.join(win32.resolve(systemTemp), folderName)]
}
