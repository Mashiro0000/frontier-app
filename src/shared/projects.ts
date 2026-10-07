// The person's projects (Stage 10.5, D-039): a name, instructions and files for a group of chats. Kept by main in projects.json; a chat belongs to one
// project or none (its file says which, version 5). The limits and the checks both sides use. Types and plain functions only: bundled into the preload.

import type { AttachmentInfo } from './attachments'
import type { SecretFinding } from './ipc'

export const PROJECT_LIMITS = {
  maxProjects: 100,
  /** A name, for the person: it is never sent to the model. */
  maxNameChars: 100,
  /** Files a project carries. They go with every message of its chats, so they count against each request's caps with the chat's own (10.6). */
  maxFiles: 20
} as const

/** A project as main keeps it and the page is shown it. */
export interface Project {
  /** Made by main: a lower-case uuid. */
  id: string
  name: string
  /** Its instructions: '' for none; at most CHAT_LIMITS.maxInstructionsChars, the same rule as a chat's. */
  instructions: string
  /** Its files, main's own copies (D-037), in the order they were added. */
  files: AttachmentInfo[]
  /** Milliseconds since 1970. */
  createdAt: number
  updatedAt: number
}

export interface ProjectsStatus {
  /** Oldest first. */
  projects: Project[]
  /** Why projects.json cannot be read, or null. While it cannot, no request of a chat in a project is sent. */
  problem: string | null
}

/**
 * What a change of the projects came to. `project`: the id of a project just made. `cancelled`: the person said no in the system's own message box (or
 * closed a dialog); nothing changed. `warnings`: parts of instructions that look like a key or a password ("Save anyway"). `refused`: files that could
 * not be added, each in a sentence that names it.
 */
export type ProjectChangeResult =
  | { ok: true; status: ProjectsStatus; project?: string; refused?: string[] }
  | {
      ok: false
      error: string
      cancelled?: true
      warnings?: SecretFinding[]
      refused?: string[]
    }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export const isProjectId = (value: unknown): value is string =>
  typeof value === 'string' && UUID.test(value)

/** A project's name as it may be kept: text, on one line, trimmed, 1 to `maxNameChars` characters. */
export function checkProjectName(
  input: unknown
): { ok: true; name: string } | { ok: false; error: string } {
  if (typeof input !== 'string') return { ok: false, error: 'The name was not understood.' }
  const name = input.replace(/\s+/g, ' ').trim()
  if (name === '') return { ok: false, error: 'A project needs a name.' }
  if (name.length > PROJECT_LIMITS.maxNameChars) {
    return {
      ok: false,
      error: `A project's name can be at most ${PROJECT_LIMITS.maxNameChars} characters.`
    }
  }
  return { ok: true, name }
}

/** Two names that differ only in capital letters are the same name. */
export const sameName = (a: string, b: string): boolean =>
  a.toLocaleLowerCase() === b.toLocaleLowerCase()
