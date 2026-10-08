import { randomUUID } from 'crypto'
import { promises as fs } from 'fs'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'path'
import {
  HISTORY_LIMITS,
  type HistoryExportResult,
  type HistoryRestoreApplyResult,
  type HistoryRestoreLookResult,
  type RestorePreview,
  type SavedConversation
} from '../shared/ipc'
import type { Note } from '../shared/memory'
import type { Project } from '../shared/projects'
import { checkBackupRequest } from '../shared/validate'
import type { AdoptOutcome } from './attachmentStore'
import { contentKey, readBackup, writeBackup } from './backup'
import { titleFor, type ConversationStore } from './conversationStore'
import { keptQuestion, nothingAdded, planKept, type KeptBackup, type KeptPlan } from './restoreKept'
import type { SavedKey } from './secrets'
import type { QuestionGate } from './systemQuestion'

// Backing up and restoring chats (D-034): the flow around the backup file (backup.ts), without Electron, so it can be checked under plain Node.
// The system's own dialogs are handed in as `pickers`. That is the whole of what the person decides here and the page never does: WHERE a
// backup goes and WHICH file is read. The page asks for "all" or "one chat by id" and later for "add what you showed me"; it never names a
// path, and what it is shown of a file is what passed the checks in backup.ts.
//
// Restoring is two steps, so that nothing is added until the person has seen what is in the file: `restoreLook` reads the file and adds nothing;
// `restoreApply` adds, and only with the token that look returned, once, within ten minutes, and only if the file is still the file that was
// looked at (same size, same time). It reads the file AGAIN and checks every chat again as it adds it, so what is added is what passes now.
// A restore NEVER replaces a saved chat: a chat whose id is free is added as it was (its dates and instructions kept); the same chat already here
// is skipped; a different chat under the same id (or a damaged file under it) is added as a copy under a new id.
// Since 10.7 (D-039) a backup of every chat holds the projects and the notes too, and a restore adds them as restoreKept.ts plans, only after the person's
// yes in the system's own box (a no adds the chats alone); its chats follow their project to a copy, or belong to none when it is not added.

export interface Pickers {
  /** Asks where to save, in the system's dialog. Null if the person closed it. `owner` is the window it belongs to; `title` replaces the dialog's usual title. */
  savePath(owner: unknown, suggestedName: string, title?: string): Promise<string | null>
  /** Asks which file to read, in the system's dialog. Null if the person closed it. */
  openPath(owner: unknown): Promise<string | null>
}

export interface BackupService {
  exportChats(request: unknown, owner: unknown): Promise<HistoryExportResult>
  restoreLook(owner: unknown): Promise<HistoryRestoreLookResult>
  /** `owner`: the window the question about projects and notes belongs to (10.7). */
  restoreApply(token: unknown, owner?: unknown): Promise<HistoryRestoreApplyResult>
  restoreCancel(token: unknown): void
  /**
   * For turning encryption on (D-035), which runs inside `exclusive` and so must not take the lock a second time: the same backup of EVERY chat, with its own
   * name and dialog title, written, read back and checked exactly as any backup is. Never called by the page.
   */
  backUpAllBeforeEncrypting(owner: unknown): Promise<HistoryExportResult>
  /** Runs `task` unless a backup, a restore or a change of how chats are kept is running: then it answers `busy` at once and runs nothing. One long thing at a time. */
  exclusive<T>(busy: T, task: () => Promise<T>): Promise<T>
  /** Resolves when a backup, a restore or a change of how chats are kept that is running has finished. For quitting the app. */
  whenIdle(): Promise<void>
}

export interface BackupServiceOptions {
  store: ConversationStore
  /** The app's whole data folder. A backup is never written inside it, so it can never land on a key or a setting. */
  dataDir: string
  pickers: Pickers
  /** For the tests. */
  now?: () => number
  tokenLifetimeMs?: number
  /**
   * The attached files (D-037): a copy's plain bytes for a backup (null if it cannot be read), and a copy put back from one. Without it a backup holds no
   * files and a restore puts none back.
   */
  files?: {
    read(id: string): Promise<Buffer | null>
    adopt(id: string, bytes: Buffer): Promise<AdoptOutcome>
  }
  /**
   * The projects and the notes (10.7, D-039): what is here (or why it cannot be read), the keys saved in the app, the question gate, and the adding.
   * Without it a backup holds neither and a restore adds neither.
   */
  kept?: {
    projects(): Promise<Project[] | string>
    notes(): Promise<Note[] | string>
    savedKeys(): Promise<SavedKey[]>
    gate: QuestionGate
    addProjects(projects: readonly Project[]): Promise<{ ok: true } | { ok: false; error: string }>
    addNotes(notes: readonly Note[]): Promise<{ ok: true } | { ok: false; error: string }>
  }
}

/** The ids of the files a chat's messages carry. */
const filesOf = (chat: SavedConversation): string[] =>
  chat.messages.flatMap((message) => (message.attachments ?? []).map((file) => file.id))

/** A sentence for projects or notes that cannot be read (their file is damaged, or its key cannot be used). */
const keptUnreadable = (what: string, why: string): string => `${what} could not be read (${why}).`

/** What is here of the projects and the notes, or the sentence that says why it cannot be used. */
async function keptHere(
  kept: NonNullable<BackupServiceOptions['kept']>
): Promise<KeptBackup | string> {
  const [projects, notes] = await Promise.all([kept.projects(), kept.notes()])
  if (typeof projects === 'string') return keptUnreadable('Your projects', projects)
  if (typeof notes === 'string') return keptUnreadable('Your notes', notes)
  return { projects, notes }
}

export const TOKEN_LIFETIME_MS = 10 * 60 * 1000
/** The save dialog's title when the backup is the first step of turning encryption on, so the person knows why a backup is asked for now. */
export const BEFORE_ENCRYPTING_TITLE = 'Back up your chats before they are encrypted'
const PREVIEW_TITLES = 10
const BUSY = 'Another backup or restore is still going. Wait for it to finish.'
const NOTHING_WAITING = 'Nothing is waiting to be added. Choose the backup file again.'

const reason = (error: unknown): unknown => (error instanceof Error ? error.message : error)

/**
 * A path with every link in it followed. A path that is not there yet is resolved as far as it exists (the deepest folder that does) and the rest
 * is added on, so a place that does not exist and a place that does are always written the same way (on some computers the user's folders are
 * reached through a link, and "resolved" and "as typed" are then different trees).
 */
async function throughLinks(path: string): Promise<string> {
  const absolute = resolve(path)
  const missing: string[] = []
  let current = absolute
  for (;;) {
    try {
      return join(await fs.realpath(current), ...[...missing].reverse())
    } catch {
      const parent = dirname(current)
      if (parent === current) return absolute // nothing of it exists
      missing.push(basename(current))
      current = parent
    }
  }
}

/** True if `path` is `folder` or anything inside it, looking through links (a folder that points into the data folder counts as inside). */
export async function isInside(folder: string, path: string): Promise<boolean> {
  const root = await throughLinks(folder)
  const place = await throughLinks(path)
  const from = relative(root, place)
  return from === '' || (from !== '..' && !from.startsWith(`..${sep}`) && !isAbsolute(from))
}

export function createBackupService(options: BackupServiceOptions): BackupService {
  const { store, dataDir, pickers } = options
  const now = options.now ?? Date.now
  const lifetime = options.tokenLifetimeMs ?? TOKEN_LIFETIME_MS

  // One backup or restore at a time: two would only get in each other's way, and a page that asks again while the person is still choosing a file
  // must not open a second dialog.
  let running: Promise<unknown> | null = null
  async function exclusive<T>(busy: T, task: () => Promise<T>): Promise<T> {
    if (running !== null) return busy
    const run = task()
    running = run.catch(() => undefined)
    try {
      return await run
    } finally {
      running = null
    }
  }

  let pending: { token: string; path: string; size: number; mtimeMs: number; at: number } | null =
    null

  /** What to do with one chat of a backup. `earlier` is what the same file already said about each id, so the look and the restore agree. */
  type Kind = 'fresh' | 'same' | 'copy'
  function classifier(): (chat: SavedConversation) => Promise<Kind> {
    const earlier = new Map<string, string>()
    return async (chat) => {
      const key = contentKey(chat)
      const before = earlier.get(chat.id)
      if (before !== undefined) return before === key ? 'same' : 'copy'
      earlier.set(chat.id, key)
      const found = await store.inspect(chat.id)
      if (found.kind === 'free') return 'fresh'
      return found.kind === 'here' && contentKey(found.conversation) === key ? 'same' : 'copy'
    }
  }

  async function exportChats(
    request: unknown,
    owner: unknown,
    beforeEncrypting = false
  ): Promise<HistoryExportResult> {
    const checked = checkBackupRequest(request)
    if (!checked.ok) return checked
    const { conversations, unreadable } = await store.list()
    let ids: string[]
    let leftOut = 0
    let name: string
    // A backup of every chat holds the projects and the notes too (10.7): what can be read; what cannot is said, and the chats are backed up anyway.
    let kept: KeptBackup | undefined
    const keptLeftOut: string[] = []
    const day = new Date(now()).toISOString().slice(0, 10)
    if (checked.request.scope === 'all') {
      ids = conversations.map((one) => one.id)
      leftOut = unreadable
      if (options.kept !== undefined) {
        const [projects, notes] = await Promise.all([options.kept.projects(), options.kept.notes()])
        if (typeof projects === 'string')
          keptLeftOut.push(keptUnreadable('Your projects', projects))
        if (typeof notes === 'string') keptLeftOut.push(keptUnreadable('Your notes', notes))
        kept = {
          projects: typeof projects === 'string' ? [] : projects,
          notes: typeof notes === 'string' ? [] : notes
        }
      }
      const anyKept = kept !== undefined && kept.projects.length + kept.notes.length > 0
      if (ids.length === 0 && !anyKept)
        return { ok: false, error: 'There are no saved chats to back up yet.' }
      name = beforeEncrypting
        ? `frontier-chats-before-encrypting-${day}.jsonl`
        : `frontier-chats-${day}.jsonl`
    } else {
      const { id } = checked.request
      if (!conversations.some((one) => one.id === id)) {
        return { ok: false, error: 'That chat was not found.' }
      }
      ids = [id]
      name = `frontier-chat-${day}-${id.slice(0, 8)}.jsonl`
    }
    const dest = await pickers.savePath(
      owner,
      name,
      beforeEncrypting ? BEFORE_ENCRYPTING_TITLE : undefined
    )
    if (dest === null) return { ok: false, cancelled: true, error: 'Cancelled.' }
    if (typeof dest !== 'string' || !isAbsolute(dest)) {
      return { ok: false, error: 'That place could not be used.' }
    }
    if (await isInside(dataDir, dest)) {
      return {
        ok: false,
        error: "A backup cannot go in the app's own data folder. Choose another place."
      }
    }
    try {
      const written = await writeBackup(
        dest,
        {
          ids,
          leftOut,
          load: async (id) => {
            const loaded = await store.load(id)
            return loaded.ok ? loaded.conversation : null
          },
          ...(options.files !== undefined ? { readFile: options.files.read } : {}),
          ...(kept !== undefined ? { kept } : {})
        },
        now()
      )
      if (!written.ok) return written
      return {
        ok: true,
        count: written.count,
        leftOut: written.leftOut,
        where: dest,
        ...(written.files !== undefined ? { files: written.files } : {}),
        ...(written.kept !== undefined ? { kept: written.kept } : {}),
        ...(keptLeftOut.length > 0
          ? { keptLeftOut: `${keptLeftOut.join(' ')} So they are not in it.` }
          : {})
      }
    } catch (error) {
      console.error('Writing a backup failed:', reason(error))
      return { ok: false, error: 'The backup could not be written there.' }
    }
  }

  /** Collects a backup's projects and notes as they are read, and counts a project's files among the files the backup may put back. */
  function keptReaders(
    into: { projects: Project[]; notes: Note[] },
    named: Set<string>
  ): Parameters<typeof readBackup>[3] {
    return {
      project: (project) => {
        into.projects.push(project)
        for (const file of project.files) named.add(file.id)
      },
      note: (note) => {
        into.notes.push(note)
      }
    }
  }

  /** The plan for a backup's projects and notes against what is here, or the sentence that says why none can be added. */
  async function keptPlan(
    fromBackup: KeptBackup
  ): Promise<{ plan: KeptPlan; here: KeptBackup } | { problem: string }> {
    if (options.kept === undefined) {
      return { problem: 'This app cannot add projects or notes from a backup.' }
    }
    const here = await keptHere(options.kept)
    if (typeof here === 'string') return { problem: `${here} So none can be added.` }
    return { plan: planKept(fromBackup, here, await options.kept.savedKeys()), here }
  }

  async function keptPreview(
    fromBackup: KeptBackup,
    counts: NonNullable<Awaited<ReturnType<typeof readBackup>>['kept']>
  ): Promise<NonNullable<RestorePreview['kept']>> {
    const planned = await keptPlan(fromBackup)
    const unusable = { projects: counts.projects.refusedCount, notes: counts.notes.refusedCount }
    if ('problem' in planned) {
      return {
        projects: { add: 0, same: 0, copies: 0, notAdded: counts.projects.seen, names: [] },
        notes: { add: 0, same: 0, notAdded: counts.notes.seen },
        problem: planned.problem
      }
    }
    const { projects, notes } = planned.plan
    return {
      projects: {
        add: projects.add.length,
        same: projects.same,
        copies: projects.copies,
        notAdded: projects.noRoom + projects.refused + unusable.projects,
        names: projects.add.slice(0, PREVIEW_TITLES).map((project) => project.name)
      },
      notes: {
        add: notes.add.length,
        same: notes.same,
        notAdded: notes.noRoom + notes.refused + unusable.notes
      },
      problem: null
    }
  }

  async function restoreLook(owner: unknown): Promise<HistoryRestoreLookResult> {
    pending = null // a new look replaces the last one
    const path = await pickers.openPath(owner)
    if (path === null) return { ok: false, cancelled: true, error: 'Cancelled.' }
    if (typeof path !== 'string' || !isAbsolute(path)) {
      return { ok: false, error: 'That file could not be used.' }
    }
    try {
      const info = await fs.stat(path).catch(() => null)
      if (info === null || !info.isFile())
        return { ok: false, error: 'That file could not be opened.' }
      const classify = classifier()
      let fresh = 0
      let same = 0
      let copies = 0
      let withInstructions = 0
      const titles: string[] = []
      // The files the backup's chats name (D-037): only those are counted as files to put back, and only those are put back.
      const named = new Set<string>()
      const files = { count: 0, missing: 0, refused: 0 }
      const fromBackup = { projects: [] as Project[], notes: [] as Note[] }
      const read = await readBackup(
        path,
        async (chat) => {
          for (const id of filesOf(chat)) named.add(id)
          const kind = await classify(chat)
          if (kind === 'same') {
            same += 1
            return
          }
          if (kind === 'fresh') fresh += 1
          else copies += 1
          if (chat.instructions !== '') withInstructions += 1
          if (titles.length < PREVIEW_TITLES) titles.push(titleFor(chat.messages))
        },
        async (id) => {
          if (!named.has(id)) {
            files.refused += 1
            return
          }
          files.count += 1
          if (options.files === undefined || (await options.files.read(id)) === null)
            files.missing += 1
        },
        keptReaders(fromBackup, named)
      )
      if (read.problem !== null) return { ok: false, error: read.problem }
      files.refused += read.files?.refusedCount ?? 0
      const kept = read.kept === undefined ? undefined : await keptPreview(fromBackup, read.kept)
      const { conversations } = await store.list()
      const token = randomUUID()
      pending = { token, path, size: info.size, mtimeMs: info.mtimeMs, at: now() }
      return {
        ok: true,
        preview: {
          token,
          fileName: basename(path),
          exportedAt: read.header?.exportedAt ?? null,
          complete: read.complete,
          leftOutAtExport: read.trailer?.leftOut ?? null,
          fresh,
          same,
          copies,
          withInstructions,
          ...(read.files !== undefined ? { files } : {}),
          ...(kept !== undefined ? { kept } : {}),
          refusedCount: read.refusedCount,
          refused: read.refused.slice(0, 5),
          room: Math.max(0, HISTORY_LIMITS.maxConversations - conversations.length),
          titles
        }
      }
    } catch (error) {
      console.error('Reading a backup failed:', reason(error))
      return { ok: false, error: 'That file could not be read.' }
    }
  }

  async function restoreApply(token: unknown, owner: unknown): Promise<HistoryRestoreApplyResult> {
    const plan = pending
    if (plan === null || typeof token !== 'string' || token !== plan.token) {
      return { ok: false, error: NOTHING_WAITING }
    }
    pending = null // good for one use, whatever happens next
    if (now() - plan.at > lifetime) return { ok: false, error: NOTHING_WAITING }
    // Nothing is added while writing is refused (D-035: the key that protects the chats cannot be used): said once, up front, not once for every chat.
    const refusal = await store.blocked()
    if (refusal !== null) return { ok: false, error: `Nothing was added. ${refusal}` }
    try {
      const info = await fs.stat(plan.path).catch(() => null)
      if (info === null || info.size !== plan.size || info.mtimeMs !== plan.mtimeMs) {
        return { ok: false, error: 'The file changed after it was looked at. Choose it again.' }
      }
      // The projects and notes first (10.7): read, planned, asked about once, and added, before any chat (the chats follow their project).
      const named = new Set<string>()
      const here = new Set<string>()
      const fromBackup = { projects: [] as Project[], notes: [] as Note[] }
      const first = await readBackup(
        plan.path,
        () => undefined,
        undefined,
        keptReaders(fromBackup, named)
      )
      if (first.problem !== null) return { ok: false, error: first.problem }
      let kept: NonNullable<Extract<HistoryRestoreApplyResult, { ok: true }>['kept']> | undefined
      let projectOf: ReadonlyMap<string, string | null> = new Map()
      if (first.kept !== undefined) {
        const unusable = first.kept.projects.refusedCount + first.kept.notes.refusedCount
        const planned = await keptPlan(fromBackup)
        if ('problem' in planned) {
          // None is added; the backup's chats of its projects belong to no project.
          projectOf = new Map(fromBackup.projects.map((project) => [project.id, null]))
          kept = {
            projects: 0,
            notes: 0,
            same: 0,
            notAdded: first.kept.projects.seen + first.kept.notes.seen,
            declined: false,
            problem: planned.problem
          }
        } else {
          let chosen = planned.plan
          let declined = false
          let problem: string | null = null
          if (
            chosen.projects.add.length + chosen.notes.add.length > 0 &&
            options.kept !== undefined
          ) {
            const answer = await options.kept.gate.ask(
              owner,
              keptQuestion(chosen, basename(plan.path), planned.here)
            )
            if (answer !== 'yes') {
              declined = true
              chosen = nothingAdded(chosen)
            }
          }
          if (options.kept !== undefined && chosen.projects.add.length > 0) {
            const done = await options.kept.addProjects(chosen.projects.add)
            if (!done.ok) {
              problem = done.error
              chosen = nothingAdded(chosen)
            }
          }
          if (options.kept !== undefined && chosen.notes.add.length > 0) {
            const done = await options.kept.addNotes(chosen.notes.add)
            if (!done.ok) {
              problem = done.error
              chosen = { ...chosen, notes: { ...chosen.notes, add: [] } }
            }
          }
          projectOf = chosen.map
          // The files of the projects that are here now (added, or already here) are put back like the chats' own.
          for (const project of fromBackup.projects) {
            if ((chosen.map.get(project.id) ?? null) === null) continue
            for (const file of project.files) here.add(file.id)
          }
          const wanted = planned.plan
          kept = {
            projects: chosen.projects.add.length,
            notes: chosen.notes.add.length,
            same: wanted.projects.same + wanted.notes.same,
            notAdded:
              fromBackup.projects.length +
              fromBackup.notes.length +
              unusable -
              chosen.projects.add.length -
              chosen.notes.add.length -
              wanted.projects.same -
              wanted.notes.same,
            declined,
            problem
          }
        }
      }
      /** A chat of the backup, moved to its project's copy, or out of a project that is not added. */
      const follow = (chat: SavedConversation): SavedConversation => {
        if (chat.project === undefined || !projectOf.has(chat.project)) return chat
        const to = projectOf.get(chat.project) ?? null
        if (to === chat.project) return chat
        if (to === null) {
          const rest = { ...chat }
          delete rest.project
          return rest
        }
        return { ...chat, project: to }
      }
      const classify = classifier()
      let added = 0
      let copies = 0
      let same = 0
      let noRoom = 0
      let failed = 0
      let tooLarge = 0
      // The files (D-037): those of chats that are here once this restore has added what it could (added, copied, or already here) are put back; a file
      // named by a chat that could not be added is left (the chat's own failure is reported); a file no chat in the backup names is not usable.
      const files = { added: 0, already: 0, noRoom: 0, failed: 0, refused: 0 }
      const read = await readBackup(
        plan.path,
        async (read) => {
          const chat = follow(read)
          for (const id of filesOf(chat)) named.add(id)
          const kind = await classify(chat)
          if (kind === 'same') {
            same += 1
            for (const id of filesOf(chat)) here.add(id)
            return
          }
          try {
            let asCopy = kind === 'copy'
            let outcome = await store.add(asCopy ? { ...chat, id: randomUUID() } : chat)
            if (!outcome.ok && outcome.why === 'occupied') {
              // Taken after it was looked at, or by a file the list did not know of: never written over, so a new id.
              asCopy = true
              outcome = await store.add({ ...chat, id: randomUUID() })
            }
            if (outcome.ok) {
              if (asCopy) copies += 1
              else added += 1
              for (const id of filesOf(chat)) here.add(id)
            } else if (outcome.why === 'full') noRoom += 1
            else if (outcome.why === 'too-large') tooLarge += 1
            else failed += 1
          } catch (error) {
            console.error('Adding a chat from a backup failed:', reason(error))
            failed += 1
          }
        },
        async (id, bytes) => {
          if (!named.has(id) || options.files === undefined) {
            files.refused += 1
            return
          }
          if (!here.has(id)) return
          const outcome = await options.files.adopt(id, bytes)
          if (outcome === 'added') files.added += 1
          else if (outcome === 'already') files.already += 1
          else if (outcome === 'full') files.noRoom += 1
          else if (outcome === 'failed') files.failed += 1
          else files.refused += 1
        }
      )
      if (read.problem !== null) return { ok: false, error: read.problem }
      files.refused += read.files?.refusedCount ?? 0
      return {
        ok: true,
        added,
        copies,
        same,
        refused: read.refusedCount + tooLarge,
        noRoom,
        failed,
        ...(read.files !== undefined ? { files } : {}),
        ...(kept !== undefined ? { kept } : {})
      }
    } catch (error) {
      console.error('Restoring from a backup failed:', reason(error))
      return { ok: false, error: 'The chats could not be added.' }
    }
  }

  return {
    exportChats: (request, owner) =>
      exclusive<HistoryExportResult>({ ok: false, error: BUSY }, () => exportChats(request, owner)),
    restoreLook: (owner) =>
      exclusive<HistoryRestoreLookResult>({ ok: false, error: BUSY }, () => restoreLook(owner)),
    restoreApply: (token, owner) =>
      exclusive<HistoryRestoreApplyResult>({ ok: false, error: BUSY }, () =>
        restoreApply(token, owner)
      ),
    restoreCancel: (token) => {
      if (pending !== null && token === pending.token) pending = null
    },
    backUpAllBeforeEncrypting: (owner) => exportChats({ scope: 'all' }, owner, true),
    exclusive,
    whenIdle: () => (running ?? Promise.resolve()).then(() => undefined)
  }
}
