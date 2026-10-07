import { randomUUID } from 'crypto'
import { isAttachmentId, type AttachmentInfo } from '../shared/attachments'
import type { AttachPickResult } from '../shared/ipc'
import {
  checkProjectName,
  isProjectId,
  PROJECT_LIMITS,
  sameName,
  type Project,
  type ProjectChangeResult,
  type ProjectsStatus
} from '../shared/projects'
import { checkAttachmentInfo, checkInstructions } from '../shared/validate'
import type { WriteMode } from './chatFile'
import type { SecretBox } from './credentialStore'
import { createKeptFile, KeptRefused, type KeptFile } from './keptFile'
import { checkForSecrets, type SavedKey } from './secrets'
import {
  QUESTION_BUSY,
  QUESTION_FAILED,
  QUESTION_RESTING,
  type QuestionGate,
  type SystemQuestion
} from './systemQuestion'

// The person's projects (Stage 10.5, D-039): a name, instructions and files for a group of chats, kept by main in projects.json in the data folder
// (keptFile.ts: written like a chat, sealed like the chats when encryption is on). What a project adds to a request (its instructions, its notes, its
// files; 10.6) goes out with every message of every chat in it, so:
//  - its instructions are saved only after the person's yes in the system's own message box, after the look for secrets (as for every chat's);
//  - its files come in through the system's open dialog (main's own copies, checked by their bytes, D-037) and are added only after a yes in the box,
//    which names each one; a file that is not added is let go of at once;
//  - making a project, renaming it, taking a file off it and deleting it send nothing new, so they ask nothing there (deleting asks on the page first).
// The NAME is the person's label and is never sent to the model. Deleting a project deletes its notes (memory.ts) and the copies of its files that no
// chat and no other project uses; its chats keep their files and simply belong to no project (their files still name it; an unknown project is none).
// When projects.json cannot be read, nothing is changed and no request of a chat in a project is sent (10.6): the way out is to delete them all, which
// keeps a copy of the damaged file.

export const PROJECTS_FILE_VERSION = 1

/** A hundred projects, each with its instructions (8,000 characters, at most 6 bytes each escaped) and 20 files: well under 8 MB. */
const MAX_FILE_BYTES = 8 * 1024 * 1024

export interface ProjectsFile {
  projects: Project[]
}

export const projectsFileText = (value: ProjectsFile): string =>
  JSON.stringify({
    version: PROJECTS_FILE_VERSION,
    projects: value.projects.map(({ id, name, instructions, files, createdAt, updatedAt }) => ({
      id,
      name,
      instructions,
      files,
      createdAt,
      updatedAt
    }))
  })

const isTime = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0

function parseProject(raw: unknown): Project | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const fields = raw as Record<string, unknown>
  if (Object.keys(fields).length !== 6) return null
  const { id, name, instructions, files, createdAt, updatedAt } = fields
  if (!isProjectId(id) || !isTime(createdAt) || !isTime(updatedAt) || updatedAt < createdAt)
    return null
  const checkedName = checkProjectName(name)
  if (!checkedName.ok || checkedName.name !== name) return null
  if (typeof instructions !== 'string') return null
  const checkedInstructions = checkInstructions(instructions)
  if (!checkedInstructions.ok || checkedInstructions.instructions !== instructions) return null
  if (!Array.isArray(files) || files.length > PROJECT_LIMITS.maxFiles) return null
  const infos: AttachmentInfo[] = []
  for (const file of files) {
    const info = checkAttachmentInfo(file)
    if (info === null || infos.some((other) => other.id === info.id)) return null
    infos.push(info)
  }
  return { id, name: checkedName.name, instructions, files: infos, createdAt, updatedAt }
}

/** What the file holds, or null when it is not exactly what this app writes (a field more or less, a name twice, an id twice, a cap passed). */
export function parseProjectsFile(content: string): ProjectsFile | null {
  let raw: unknown
  try {
    raw = JSON.parse(content)
  } catch {
    return null
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const fields = raw as Record<string, unknown>
  if (fields.version !== PROJECTS_FILE_VERSION || Object.keys(fields).length !== 2) return null
  if (!Array.isArray(fields.projects) || fields.projects.length > PROJECT_LIMITS.maxProjects)
    return null
  const projects: Project[] = []
  for (const raw of fields.projects) {
    const project = parseProject(raw)
    if (project === null) return null
    if (projects.some((other) => other.id === project.id || sameName(other.name, project.name)))
      return null
    projects.push(project)
  }
  return { projects }
}

const PAGE_CANNOT =
  "Frontier App asks this in a window of its own, which the app's page cannot answer: what goes out with every message needs your yes here."
const fmt = (n: number): string => n.toLocaleString('en-US')
const QUESTION_TEXT_CHARS = 400

/** One line about a file for the question: its name and what it is. */
function fileLine(file: AttachmentInfo): string {
  const size =
    file.bytes >= 1024 * 1024
      ? `${(file.bytes / (1024 * 1024)).toFixed(1)} MB`
      : `${Math.max(1, Math.round(file.bytes / 1024))} KB`
  const what =
    file.kind === 'pdf' && file.pages !== undefined
      ? `${fmt(file.pages)} ${file.pages === 1 ? 'page' : 'pages'}, ${size}`
      : file.kind === 'text' && file.chars !== undefined
        ? `${fmt(file.chars)} characters`
        : size
  return `- ${file.name} (${what})`
}

export function filesQuestion(project: Project, files: readonly AttachmentInfo[]): SystemQuestion {
  const one = files.length === 1
  return {
    title: 'Project files',
    message: `Add ${one ? 'this file' : `these ${files.length} files`} to the project "${project.name}"?`,
    detail: [
      ...files.map(fileLine),
      '',
      `${one ? 'It goes' : 'They go'} to the company that runs the model with every message of every chat in this project, at the start of the conversation, and ${one ? 'counts' : 'count'} against each request's size and cost. The app keeps ${one ? 'a copy' : 'copies'} in its data folder.`,
      '',
      PAGE_CANNOT
    ].join('\n'),
    yes: one ? 'Add the file' : 'Add the files',
    no: 'Cancel'
  }
}

export function projectInstructionsQuestion(
  project: Project,
  text: string,
  warned: boolean
): SystemQuestion {
  const chars = [...text]
  const start =
    chars.length > QUESTION_TEXT_CHARS ? `${chars.slice(0, QUESTION_TEXT_CHARS).join('')}...` : text
  const lines = [
    `"${start}"`,
    '',
    `${fmt(text.length)} characters. They go to the company that runs the model with every message of every chat in this project, and are kept in this app's data folder.`
  ]
  if (warned) lines.push('Part of it looks like a key or a password; you chose to save it anyway.')
  lines.push('', PAGE_CANNOT)
  return {
    title: 'Project instructions',
    message: `Save these instructions for the project "${project.name}"?`,
    detail: lines.join('\n'),
    yes: 'Save the instructions',
    no: 'Cancel'
  }
}

export const PROJECTS_NOT_SAVED = 'Not saved: the project is as it was.'
const NOT_UNDERSTOOD = 'The project was not understood.'
const BUSY = 'Your projects are still being changed.'
const NO_PROJECT = 'That project is not there any more.'
const NO_FILE = 'That file is not in the project any more.'

const changeRefused = (why: string): string =>
  `Nothing was changed: your projects could not be read (${why}). Delete them all to start again; the app keeps a copy of the file.`
/** The refusal of a request of a chat in a project while the file cannot be read (10.6). */
export const projectsUnreadable = (why: string): string =>
  `Nothing was sent: your projects could not be read (${why}). Open Projects to delete them all; the app keeps a copy of the file.`

export interface ProjectsService {
  status(): Promise<ProjectsStatus>
  /** A new, empty project: `{ name }`. Asks nothing. */
  create(input: unknown): Promise<ProjectChangeResult>
  rename(input: unknown): Promise<ProjectChangeResult>
  /** `{ id, text, saveAnyway? }`; '' turns them off (asks nothing). */
  setInstructions(owner: unknown, input: unknown): Promise<ProjectChangeResult>
  /** `{ id }`: the system's open dialog, then the question that names the files. */
  addFiles(owner: unknown, input: unknown): Promise<ProjectChangeResult>
  /** `{ id, fileId }`: asks nothing. */
  removeFile(input: unknown): Promise<ProjectChangeResult>
  /** `{ id }`: deletes it, its notes, and the copies of its files nothing else uses. Asks nothing here (the page asks first). */
  remove(input: unknown): Promise<ProjectChangeResult>
  /** Every project, deleted, the damaged file kept as a copy: the way out when projects.json cannot be read. */
  removeAll(): Promise<ProjectChangeResult>
  /** A project's name, or null when there is no such project (or the file cannot be read). */
  nameOf(id: string): Promise<string | null>
  /** The project a request of a chat in `id` brings (10.6): null when there is none of that id, or the sentence that refuses the request. */
  forRequest(
    id: string
  ): Promise<{ ok: true; project: Project | null } | { ok: false; error: string }>
  /** The files every project carries, for the sweep and for deletions: null while the file cannot be read (then nothing is deleted). */
  fileRefs(): Promise<ReadonlySet<string> | null>
  file: KeptFile<ProjectsFile>
}

export interface ProjectsOptions {
  pathOf: () => string
  box?: SecretBox
  writeMode: () => Promise<WriteMode>
  gate: QuestionGate
  savedKeys: () => Promise<SavedKey[]>
  files: {
    /** The system's open dialog for the window that asked, and checked copies of what the person chose (attachmentService.ts). */
    pick(owner: unknown): Promise<AttachPickResult>
    /** Stops holding a copy for this run (a project now names it). */
    release(id: string): void
    /** A copy that was picked and not added: let go of, and deleted if nothing uses it. */
    discard(id: string): Promise<void>
    /** Copies taken off a project, or of a deleted project: deleted when no chat and no other project uses them. */
    deleteUnused(ids: readonly string[]): Promise<void>
  }
  /** Deletes the notes of a project that is deleted (memory.ts). */
  removeNotes(projectId: string): Promise<void>
  now?: () => number
  newId?: () => string
}

const reason = (error: unknown): unknown => (error instanceof Error ? error.message : error)

export function createProjects(options: ProjectsOptions): ProjectsService {
  const now = options.now ?? Date.now
  const newId = options.newId ?? randomUUID
  const file = createKeptFile<ProjectsFile>({
    pathOf: options.pathOf,
    name: 'your projects',
    parse: parseProjectsFile,
    text: projectsFileText,
    maxBytes: MAX_FILE_BYTES,
    box: options.box,
    writeMode: options.writeMode,
    now
  })
  let changing = false

  async function oneAtATime(
    task: () => Promise<ProjectChangeResult>
  ): Promise<ProjectChangeResult> {
    if (changing) return { ok: false, error: BUSY }
    changing = true
    try {
      return await task()
    } finally {
      changing = false
    }
  }

  async function status(): Promise<ProjectsStatus> {
    const current = await file.read()
    if (current.state === 'unreadable') return { projects: [], problem: current.why }
    return {
      projects:
        current.state === 'ok'
          ? current.value.projects.map((p) => ({ ...p, files: [...p.files] }))
          : [],
      problem: null
    }
  }

  async function readable(): Promise<
    { ok: true; projects: Project[] } | { ok: false; error: string }
  > {
    const current = await file.read()
    if (current.state === 'unreadable') return { ok: false, error: changeRefused(current.why) }
    return { ok: true, projects: current.state === 'ok' ? current.value.projects : [] }
  }

  async function write(
    projects: Project[],
    extra: Partial<{ project: string; refused: string[] }> = {},
    replace = false
  ): Promise<ProjectChangeResult> {
    try {
      await file.write({ projects }, { replace })
    } catch (error) {
      if (error instanceof KeptRefused) return { ok: false, error: error.message }
      console.error('Saving the projects failed:', reason(error))
      return { ok: false, error: 'Your projects could not be saved on this computer.' }
    }
    return { ok: true, status: await status(), ...extra }
  }

  async function ask(
    owner: unknown,
    question: SystemQuestion
  ): Promise<ProjectChangeResult | null> {
    const answer = await options.gate.ask(owner, question)
    if (answer === 'yes') return null
    if (answer === 'busy') return { ok: false, error: QUESTION_BUSY }
    if (answer === 'resting') return { ok: false, error: QUESTION_RESTING }
    if (answer === 'failed') return { ok: false, error: QUESTION_FAILED }
    return { ok: false, cancelled: true, error: PROJECTS_NOT_SAVED }
  }

  const fieldsOf = (input: unknown): Record<string, unknown> | null =>
    typeof input === 'object' && input !== null && !Array.isArray(input)
      ? (input as Record<string, unknown>)
      : null

  function freshId(projects: readonly Project[]): string | null {
    for (let tries = 0; tries < 5; tries++) {
      const id = newId()
      if (isProjectId(id) && !projects.some((project) => project.id === id)) return id
    }
    return null
  }

  function create(input: unknown): Promise<ProjectChangeResult> {
    const checked = checkProjectName(fieldsOf(input)?.name)
    if (!checked.ok) return Promise.resolve(checked)
    return oneAtATime(async () => {
      const now0 = await readable()
      if (!now0.ok) return now0
      if (now0.projects.length >= PROJECT_LIMITS.maxProjects) {
        return {
          ok: false,
          error: `You have ${PROJECT_LIMITS.maxProjects} projects, the most there can be. Delete one first.`
        }
      }
      if (now0.projects.some((project) => sameName(project.name, checked.name))) {
        return { ok: false, error: `There is already a project called "${checked.name}".` }
      }
      const id = freshId(now0.projects)
      if (id === null)
        return { ok: false, error: 'Your projects could not be saved on this computer.' }
      const at = now()
      const project: Project = {
        id,
        name: checked.name,
        instructions: '',
        files: [],
        createdAt: at,
        updatedAt: at
      }
      return write([...now0.projects, project], { project: id })
    })
  }

  /** Changes one project with `change`, after `find` has found it; a project that is gone is said so. */
  async function update(
    id: unknown,
    change: (project: Project, projects: Project[]) => Promise<Project | ProjectChangeResult>
  ): Promise<ProjectChangeResult> {
    if (!isProjectId(id)) return { ok: false, error: NOT_UNDERSTOOD }
    const now0 = await readable()
    if (!now0.ok) return now0
    const project = now0.projects.find((p) => p.id === id)
    if (project === undefined) return { ok: false, error: NO_PROJECT }
    const next = await change(project, now0.projects)
    if ('ok' in next) return next
    // Read again after any wait: what is written is what is there now, with this one change.
    const fresh = await readable()
    if (!fresh.ok) return fresh
    if (!fresh.projects.some((p) => p.id === id)) return { ok: false, error: NO_PROJECT }
    return write(
      fresh.projects.map((p) =>
        p.id === id ? { ...next, updatedAt: Math.max(now(), p.createdAt) } : p
      )
    )
  }

  function rename(input: unknown): Promise<ProjectChangeResult> {
    const fields = fieldsOf(input)
    const checked = checkProjectName(fields?.name)
    if (!checked.ok) return Promise.resolve(checked)
    return oneAtATime(() =>
      update(fields?.id, async (project, projects) => {
        if (project.name === checked.name) return { ok: true, status: await status() }
        if (
          projects.some((other) => other.id !== project.id && sameName(other.name, checked.name))
        ) {
          return { ok: false, error: `There is already a project called "${checked.name}".` }
        }
        return { ...project, name: checked.name }
      })
    )
  }

  function setInstructions(owner: unknown, input: unknown): Promise<ProjectChangeResult> {
    const fields = fieldsOf(input)
    if (fields === null || typeof fields.text !== 'string')
      return Promise.resolve({ ok: false, error: NOT_UNDERSTOOD })
    const checked = checkInstructions(fields.text)
    if (!checked.ok) return Promise.resolve(checked)
    const text = checked.instructions
    return oneAtATime(() =>
      update(fields.id, async (project) => {
        if (project.instructions === text) return { ok: true, status: await status() }
        if (text !== '') {
          const secrets = checkForSecrets(
            text,
            await options.savedKeys(),
            fields.saveAnyway === true,
            'Instructions'
          )
          if (!secrets.ok) return secrets
          const no = await ask(owner, projectInstructionsQuestion(project, text, secrets.warned))
          if (no !== null) return no
        }
        return { ...project, instructions: text }
      })
    )
  }

  function addFiles(owner: unknown, input: unknown): Promise<ProjectChangeResult> {
    const fields = fieldsOf(input)
    // The files the dialog or the caps refused, said to the person whatever else happens.
    let refused: string[] = []
    return oneAtATime(async () => {
      const result = await update(fields?.id, async (project) => {
        const room = PROJECT_LIMITS.maxFiles - project.files.length
        if (room <= 0) {
          return {
            ok: false,
            error: `The project has ${PROJECT_LIMITS.maxFiles} files, the most it can carry. Take one off first.`
          }
        }
        const picked = await options.files.pick(owner)
        if (!picked.ok)
          return picked.cancelled
            ? { ok: false, cancelled: true, error: 'Cancelled.' }
            : { ok: false, error: picked.error }
        refused = [...picked.refused]
        const fresh: AttachmentInfo[] = []
        for (const attached of picked.files) {
          const info = attached.info
          if (
            project.files.some((file) => file.id === info.id) ||
            fresh.some((file) => file.id === info.id)
          ) {
            refused.push(`${info.name} is already in the project.`)
          } else if (fresh.length >= room) {
            refused.push(
              `${info.name} was not added: the project can carry at most ${PROJECT_LIMITS.maxFiles} files.`
            )
          } else {
            fresh.push(info)
            continue
          }
          await options.files.discard(info.id)
        }
        if (fresh.length === 0) {
          return {
            ok: false,
            error: refused.length > 0 ? 'No file was added.' : 'Cancelled.',
            refused
          }
        }
        const no = await ask(owner, filesQuestion(project, fresh))
        if (no !== null) {
          for (const info of fresh) await options.files.discard(info.id)
          return { ...no, refused }
        }
        for (const info of fresh) options.files.release(info.id)
        return { ...project, files: [...project.files, ...fresh] }
      })
      return result.ok && refused.length > 0 ? { ...result, refused } : result
    })
  }

  function removeFile(input: unknown): Promise<ProjectChangeResult> {
    const fields = fieldsOf(input)
    const fileId = fields?.fileId
    if (!isAttachmentId(fileId)) return Promise.resolve({ ok: false, error: NOT_UNDERSTOOD })
    return oneAtATime(async () => {
      const result = await update(fields?.id, async (project) => {
        if (!project.files.some((file) => file.id === fileId)) return { ok: false, error: NO_FILE }
        return { ...project, files: project.files.filter((file) => file.id !== fileId) }
      })
      if (result.ok) await options.files.deleteUnused([fileId])
      return result
    })
  }

  function remove(input: unknown): Promise<ProjectChangeResult> {
    const id = fieldsOf(input)?.id
    if (!isProjectId(id)) return Promise.resolve({ ok: false, error: NOT_UNDERSTOOD })
    return oneAtATime(async () => {
      const now0 = await readable()
      if (!now0.ok) return now0
      const project = now0.projects.find((p) => p.id === id)
      if (project === undefined) return { ok: false, error: NO_PROJECT }
      const result = await write(now0.projects.filter((p) => p.id !== id))
      if (!result.ok) return result
      // Its notes go with it; its chats stay (they belong to no project now); its files go where nothing else uses them.
      await options
        .removeNotes(id)
        .catch((error: unknown) =>
          console.error("Deleting a project's notes failed:", reason(error))
        )
      await options.files.deleteUnused(project.files.map((file) => file.id))
      return { ok: true, status: await status() }
    })
  }

  function removeAll(): Promise<ProjectChangeResult> {
    return oneAtATime(async () => {
      const current = await file.read()
      if (current.state === 'none') return { ok: true, status: await status() }
      const gone = current.state === 'ok' ? current.value.projects : []
      const result = await write([], {}, current.state === 'unreadable')
      if (!result.ok) return result
      for (const project of gone) {
        await options
          .removeNotes(project.id)
          .catch((error: unknown) =>
            console.error("Deleting a project's notes failed:", reason(error))
          )
      }
      await options.files.deleteUnused(gone.flatMap((project) => project.files.map((f) => f.id)))
      return result
    })
  }

  async function nameOf(id: string): Promise<string | null> {
    const current = await file.read()
    if (current.state !== 'ok') return null
    return current.value.projects.find((project) => project.id === id)?.name ?? null
  }

  async function forRequest(
    id: string
  ): Promise<{ ok: true; project: Project | null } | { ok: false; error: string }> {
    const current = await file.read()
    if (current.state === 'unreadable') return { ok: false, error: projectsUnreadable(current.why) }
    if (current.state === 'none') return { ok: true, project: null }
    return {
      ok: true,
      project: current.value.projects.find((project) => project.id === id) ?? null
    }
  }

  async function fileRefs(): Promise<ReadonlySet<string> | null> {
    const current = await file.read()
    if (current.state === 'unreadable') return null
    if (current.state === 'none') return new Set()
    return new Set(current.value.projects.flatMap((project) => project.files.map((f) => f.id)))
  }

  return {
    status,
    create,
    rename,
    setInstructions,
    addFiles,
    removeFile,
    remove,
    removeAll,
    nameOf,
    forRequest,
    fileRefs,
    file
  }
}
