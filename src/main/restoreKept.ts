import { randomUUID } from 'crypto'
import { ALL_CHATS, MEMORY_LIMITS, scopeUse, type Note } from '../shared/memory'
import { isProjectId, PROJECT_LIMITS, sameName, type Project } from '../shared/projects'
import { heldKey, type SavedKey } from './secrets'
import type { SystemQuestion } from './systemQuestion'

// What a restore does with the projects and the notes of a backup (Stage 10.7, D-039). No Electron, no disk: the plan only, so that the look and the
// restore say the same thing and the checks can run it under plain Node. A restore ADDS, never replacing, as for chats (D-034):
//  - a project already here (the same id, name, instructions and files) is left as it is; one whose id is taken by a different project is added as a copy
//    under a new id; one whose name is taken is added as "name (2)" (names are the person's labels and are never sent); past the cap it is not added;
//  - a note already here (the same place and words) is left; one for a project that is not added, or past its place's caps, is not added;
//  - a project's instructions or a note that hold one of the API keys saved in this app are not added (the same rule as when they are saved);
//  - the backup's chats of a project that was added as a copy are moved to the copy; of a project that was not added, they belong to no project.
// Nothing of it is written without the person's yes in the system's own box (`keptQuestion`), because all of it goes with every message.

export interface KeptBackup {
  projects: readonly Project[]
  notes: readonly Note[]
}

export interface KeptPlan {
  projects: { add: Project[]; same: number; copies: number; noRoom: number; refused: number }
  notes: { add: Note[]; same: number; noRoom: number; refused: number }
  /** A project id of the backup, and the id its chats belong to here: its own, its copy's, or null when it is not here and is not added. */
  map: ReadonlyMap<string, string | null>
}

const sameProject = (a: Project, b: Project): boolean =>
  a.name === b.name &&
  a.instructions === b.instructions &&
  a.files.length === b.files.length &&
  a.files.every((file, index) => file.id === b.files[index].id)

/** The name with " (2)", " (3)" ... until no project has it, cut so that it stays within the cap. */
function freeName(name: string, taken: readonly string[]): string {
  if (!taken.some((other) => sameName(other, name))) return name
  for (let n = 2; ; n++) {
    const tail = ` (${n})`
    const candidate = `${[...name]
      .slice(0, PROJECT_LIMITS.maxNameChars - tail.length)
      .join('')
      .trimEnd()}${tail}`
    if (!taken.some((other) => sameName(other, candidate))) return candidate
  }
}

/** What adding `backup` to what is here would do. `newId` only for the checks. */
export function planKept(
  backup: KeptBackup,
  here: KeptBackup,
  keys: readonly SavedKey[],
  newId: () => string = randomUUID
): KeptPlan {
  const map = new Map<string, string | null>()
  const projects: KeptPlan['projects'] = { add: [], same: 0, copies: 0, noRoom: 0, refused: 0 }
  const all = (): Project[] => [...here.projects, ...projects.add]
  const freshId = (taken: (id: string) => boolean): string => {
    for (;;) {
      const id = newId()
      if (isProjectId(id) && !taken(id)) return id
    }
  }
  for (const project of backup.projects) {
    if (map.has(project.id)) continue // twice in one file: the first counts
    const sameId = all().find((other) => other.id === project.id)
    if (sameId !== undefined && sameProject(sameId, project)) {
      projects.same += 1
      map.set(project.id, project.id)
      continue
    }
    if (heldKey(project.instructions, keys) !== null) {
      projects.refused += 1
      map.set(project.id, null)
      continue
    }
    if (all().length >= PROJECT_LIMITS.maxProjects) {
      projects.noRoom += 1
      map.set(project.id, null)
      continue
    }
    const id =
      sameId === undefined
        ? project.id
        : freshId((candidate) => all().some((other) => other.id === candidate))
    if (id !== project.id) projects.copies += 1
    const name = freeName(
      project.name,
      all().map((other) => other.name)
    )
    projects.add.push({ ...project, id, name })
    map.set(project.id, id)
  }

  const notes: KeptPlan['notes'] = { add: [], same: 0, noRoom: 0, refused: 0 }
  const allNotes = (): Note[] => [...here.notes, ...notes.add]
  for (const note of backup.notes) {
    // Its place here: every chat; the project it was for, as added or already here; or none, when that project is not here and is not added.
    const scope =
      note.scope === ALL_CHATS
        ? ALL_CHATS
        : map.has(note.scope)
          ? (map.get(note.scope) ?? null)
          : here.projects.some((project) => project.id === note.scope)
            ? note.scope
            : null
    if (scope === null) {
      notes.refused += 1
      continue
    }
    if (allNotes().some((other) => other.scope === scope && other.text === note.text)) {
      notes.same += 1
      continue
    }
    if (heldKey(note.text, keys) !== null) {
      notes.refused += 1
      continue
    }
    const use = scopeUse(allNotes(), scope)
    if (
      use.notes + 1 > MEMORY_LIMITS.maxScopeNotes ||
      use.chars + note.text.length > MEMORY_LIMITS.maxScopeChars
    ) {
      notes.noRoom += 1
      continue
    }
    const id = allNotes().some((other) => other.id === note.id)
      ? freshId((candidate) => allNotes().some((other) => other.id === candidate))
      : note.id
    notes.add.push({ ...note, id, scope })
  }
  return { projects, notes, map }
}

/** The plan once the person has said no (or could not be asked): nothing of the backup's is added, and its chats belong to the projects already here. */
export function nothingAdded(plan: KeptPlan): KeptPlan {
  const map = new Map<string, string | null>()
  const added = new Set(plan.projects.add.map((project) => project.id))
  for (const [from, to] of plan.map) map.set(from, to === null || added.has(to) ? null : to)
  return {
    projects: { ...plan.projects, add: [], copies: 0 },
    notes: { ...plan.notes, add: [] },
    map
  }
}

const fmt = (n: number): string => n.toLocaleString('en-US')
const projectsWord = (n: number): string => `${n} ${n === 1 ? 'project' : 'projects'}`
const notesWord = (n: number): string => `${n} ${n === 1 ? 'note' : 'notes'}`
const filesWord = (n: number): string => `${n} ${n === 1 ? 'file' : 'files'}`
const LISTED = 10
const PAGE_CANNOT =
  "Frontier App asks this in a window of its own, which the app's page cannot answer: what goes out with every message needs your yes here."

/** The one question before a restore adds projects or notes. Plain text: the system draws it. */
export function keptQuestion(plan: KeptPlan, fileName: string, here: KeptBackup): SystemQuestion {
  const { add: projects } = plan.projects
  const { add: notes } = plan.notes
  const what = [
    ...(projects.length > 0 ? [projectsWord(projects.length)] : []),
    ...(notes.length > 0 ? [notesWord(notes.length)] : [])
  ].join(' and ')
  const lines: string[] = []
  for (const project of projects.slice(0, LISTED)) {
    const parts = [
      project.instructions === ''
        ? 'no instructions'
        : `instructions of ${fmt(project.instructions.length)} ${project.instructions.length === 1 ? 'character' : 'characters'}`,
      filesWord(project.files.length)
    ]
    lines.push(`- Project "${project.name}": ${parts.join(', ')}`)
  }
  if (projects.length > LISTED) lines.push(`- and ${projectsWord(projects.length - LISTED)} more`)
  const nameOf = (scope: string): string =>
    [...projects, ...here.projects].find((project) => project.id === scope)?.name ?? 'unknown'
  for (const scope of [...new Set(notes.map((note) => note.scope))].slice(0, LISTED)) {
    const count = notes.filter((note) => note.scope === scope).length
    lines.push(
      `- ${notesWord(count)} for ${scope === ALL_CHATS ? 'every chat' : `the chats of "${nameOf(scope)}"`}`
    )
  }
  lines.push(
    '',
    `A project's instructions and files and your notes go to the company that runs the model with every message of the chats they are for. Nothing already here is replaced. The backup's chats are added whatever you answer; without a yes, those of a project that is not added belong to no project.`,
    '',
    PAGE_CANNOT
  )
  return {
    title: 'Restore',
    message: `Add ${what} from the backup "${fileName}"?`,
    detail: lines.join('\n'),
    yes: 'Add them',
    no: 'Add only the chats'
  }
}
