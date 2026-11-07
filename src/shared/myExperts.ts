import { CHAT_LIMITS } from './ipc'
import { isConversationId } from './ids'
import { TASKS, type TaskId } from './rankings'

// (22.2, D-054) An expert of the person's own ("My experts"): a name, a line about it, the instructions a chat starts with, and the task it is for. Checked the
// same way from the page and from experts.json; the instructions follow the rules of a chat's own instructions (D-027): text, trimmed, within the limit.

export interface MyExpert {
  /** A lower-case uuid, made by main. */
  id: string
  name: string
  description: string
  instructions: string
  task: TaskId
}

export const MY_EXPERT_LIMITS = { maxNameChars: 60, maxDescriptionChars: 160 } as const

const oneLine = (value: unknown, max: number, mayBeEmpty: boolean): string | null => {
  if (typeof value !== 'string') return null
  const text = value.replace(/\s+/g, ' ').trim()
  // No control characters and no characters that turn the direction of text (a name that reads differently than it is).
  const hidden = (c: string): boolean => {
    const n = c.codePointAt(0) ?? 0
    return n < 0x20 || n === 0x7f || (n >= 0x202a && n <= 0x202e) || (n >= 0x2066 && n <= 0x2069)
  }
  if ([...text].some(hidden)) return null
  if ((!mayBeEmpty && text === '') || [...text].length > max) return null
  return text
}

/** A clean copy, or null. `strict`: read from the file, where every field must already be exactly as kept (trimmed, nothing extra). */
export function checkMyExpert(input: unknown, strict: boolean): MyExpert | null {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return null
  const fields = input as Record<string, unknown>
  const keys = Object.keys(fields)
  if (keys.some((k) => !['id', 'name', 'description', 'instructions', 'task'].includes(k)))
    return null
  if (!isConversationId(fields.id)) return null
  const name = oneLine(fields.name, MY_EXPERT_LIMITS.maxNameChars, false)
  const description = oneLine(fields.description ?? '', MY_EXPERT_LIMITS.maxDescriptionChars, true)
  const instructions = typeof fields.instructions === 'string' ? fields.instructions.trim() : null
  const task = TASKS.find((t) => t.id === fields.task)?.id ?? (strict ? null : 'chat')
  if (name === null || description === null || instructions === null || task === null) return null
  if (instructions === '' || instructions.length > CHAT_LIMITS.maxInstructionsChars) return null
  if (
    strict &&
    (name !== fields.name ||
      description !== fields.description ||
      instructions !== fields.instructions)
  )
    return null
  return { id: fields.id, name, description, instructions, task }
}

/** The person's experts after a list, a save or a removal, or why not. */
export type MyExpertsResult = { ok: true; experts: MyExpert[] } | { ok: false; error: string }
