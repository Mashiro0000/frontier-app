import { join } from 'path'
import { moveTo } from '../shared/order'
import { randomUUID } from 'crypto'
import { CHAT_LIMITS } from '../shared/ipc'
import { checkMyExpert, type MyExpert, type MyExpertsResult } from '../shared/myExperts'
import type { SecretBox } from './credentialStore'
import type { WriteMode } from './chatFile'
import { createKeptFile, KeptRefused, type KeptFile } from './keptFile'
import { checkForSecrets, type SavedKey } from './secrets'

// (22.2, D-054) "My experts": the person's own assistants, kept in `experts.json` like the other small documents of their own words (D-039: written and read
// back, sealed with the chats when encryption is on, never written over by itself when it cannot be read). An expert's instructions become a chat's own
// instructions when it is used, so they get the same limit; main looks for a saved key in them again before any request (chat.ts), as for any chat's.

export const EXPERTS_FILE_VERSION = 1
export const MAX_MY_EXPERTS = 50
const MAX_FILE_BYTES = MAX_MY_EXPERTS * (CHAT_LIMITS.maxInstructionsChars * 6 + 1024) + 1024

export const expertsFileText = (experts: readonly MyExpert[]): string =>
  JSON.stringify({ version: EXPERTS_FILE_VERSION, experts })

export function parseExpertsFile(content: string): MyExpert[] | null {
  let raw: unknown
  try {
    raw = JSON.parse(content)
  } catch {
    return null
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const fields = raw as Record<string, unknown>
  if (fields.version !== EXPERTS_FILE_VERSION || Object.keys(fields).length !== 2) return null
  if (!Array.isArray(fields.experts) || fields.experts.length > MAX_MY_EXPERTS) return null
  const out: MyExpert[] = []
  for (const item of fields.experts) {
    const checked = checkMyExpert(item, true)
    if (checked === null || out.some((e) => e.id === checked.id)) return null
    out.push(checked)
  }
  return out
}

export interface MyExpertsService {
  list(): Promise<MyExpertsResult>
  /** Adds one (no id) or changes one (its id). */
  save(input: unknown): Promise<MyExpertsResult>
  remove(id: unknown): Promise<MyExpertsResult>
  move(input: unknown): Promise<MyExpertsResult>
  file: KeptFile<MyExpert[]>
}

export function createMyExperts(deps: {
  folder: () => string
  box?: SecretBox
  writeMode: () => Promise<WriteMode>
  /** The keys saved in the app: instructions that hold one are refused, like a project's (D-042). */
  savedKeys: () => Promise<SavedKey[]>
}): MyExpertsService {
  const file = createKeptFile<MyExpert[]>({
    pathOf: () => join(deps.folder(), 'experts.json'),
    name: 'your experts',
    parse: parseExpertsFile,
    text: expertsFileText,
    maxBytes: MAX_FILE_BYTES,
    ...(deps.box !== undefined ? { box: deps.box } : {}),
    writeMode: deps.writeMode
  })
  let queue: Promise<unknown> = Promise.resolve()
  const inOrder = <T>(task: () => Promise<T>): Promise<T> => {
    const run = queue.then(task)
    queue = run.catch(() => undefined)
    return run
  }
  const current = async (): Promise<MyExpertsResult> => {
    const read = await file.read()
    if (read.state === 'ok') return { ok: true, experts: read.value }
    if (read.state === 'none') return { ok: true, experts: [] }
    return { ok: false, error: `Your experts could not be read (${read.why}).` }
  }
  const write = async (experts: MyExpert[]): Promise<MyExpertsResult> => {
    try {
      await file.write(experts)
      return { ok: true, experts }
    } catch (error) {
      return {
        ok: false,
        error: error instanceof KeptRefused ? error.message : 'Your experts could not be saved.'
      }
    }
  }
  return {
    file,
    list: () => inOrder(current),
    save: (input) =>
      inOrder(async () => {
        if (typeof input !== 'object' || input === null || Array.isArray(input))
          return {
            ok: false,
            error: 'The expert was not understood: it needs a name and instructions.'
          }
        // 'saveAnyway' is the person's yes after a warning that the text looks like a key; it is not kept.
        const { saveAnyway, ...fields } = input as Record<string, unknown>
        const isNew = fields.id === undefined
        const checked = checkMyExpert(isNew ? { ...fields, id: randomUUID() } : fields, false)
        if (checked === null)
          return {
            ok: false,
            error: 'The expert was not understood: it needs a name and instructions.'
          }
        const secrets = checkForSecrets(
          [checked.name, checked.description, checked.instructions].join('\n'),
          await deps.savedKeys(),
          saveAnyway === true,
          "An expert's words"
        )
        if (!secrets.ok) return { ok: false, error: secrets.error }
        const now = await current()
        if (!now.ok) return now
        const others = now.experts.filter((e) => e.id !== checked.id)
        if (!isNew && others.length === now.experts.length)
          return { ok: false, error: 'That expert is not there any more.' }
        if (isNew && now.experts.length >= MAX_MY_EXPERTS)
          return { ok: false, error: `You can keep at most ${MAX_MY_EXPERTS} experts.` }
        const next = isNew
          ? [...now.experts, checked]
          : now.experts.map((e) => (e.id === checked.id ? checked : e))
        return write(next)
      }),
    remove: (id) =>
      inOrder(async () => {
        const now = await current()
        if (!now.ok) return now
        if (typeof id !== 'string' || !now.experts.some((e) => e.id === id))
          return { ok: false, error: 'That expert is not there any more.' }
        return write(now.experts.filter((e) => e.id !== id))
      }),
    // (23.8, D-055) one expert to another place; the others keep their order
    move: (input) =>
      inOrder(async () => {
        const now = await current()
        if (!now.ok) return now
        const fields =
          typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {}
        const next = moveTo(now.experts, fields.id, fields.to)
        if (next === null) return { ok: false, error: 'That expert is not there any more.' }
        return write(next)
      })
  }
}
