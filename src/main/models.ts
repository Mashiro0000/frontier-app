import { app } from 'electron'
import { promises as fs } from 'fs'
import { dirname, join } from 'path'
import { parseSavedEfforts, resolveEffort } from '../shared/effort'
import type { Effort, ModelEntry } from '../shared/registry'
import { getRegistry } from './registry'

// Which model answers, and how hard it thinks. The registry says which models exist, which one is the default and which effort
// each is asked for (D-014); the two things saved here are the person's choices (D-015, D-024). They live in a small file of its
// own beside credentials.json: removing the API key must not forget them, and neither is a secret. Like the key file (D-010)
// it is written in place and read back, not written to a temp file and renamed: every rename fails with EXDEV in this project's
// own %APPDATA%, which is EFS-encrypted. A torn write of a file this small only means the choices have to be made again.

interface StoredPreferences {
  version: 1
  modelId?: string
  /** The effort level the person chose, for each model by id (D-024). Absent until they choose one. */
  efforts?: Record<string, string>
}

interface Preferences {
  modelId: string | null
  efforts: Map<string, Effort>
}

const preferencesPath = (): string => join(app.getPath('userData'), 'preferences.json')

/** What the file holds, as far as it can be used. A file that is missing or damaged holds nothing: the registry's picks apply. */
async function readPreferences(): Promise<Preferences> {
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(preferencesPath(), 'utf8'))
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      (parsed as StoredPreferences).version === 1
    ) {
      const { modelId, efforts } = parsed as StoredPreferences
      return {
        modelId: typeof modelId === 'string' ? modelId : null,
        // Reading is forgiving about each entry, so a bad one never costs the model choice or the other entries.
        efforts: parseSavedEfforts(efforts)
      }
    }
  } catch {
    // no file, or not readable: nothing is saved
  }
  return { modelId: null, efforts: new Map() }
}

const sameEfforts = (a: ReadonlyMap<string, Effort>, b: ReadonlyMap<string, Effort>): boolean =>
  a.size === b.size && [...a].every(([modelId, level]) => b.get(modelId) === level)

// What is saved is read once, on first use, and kept here. After that it changes only in chooseModel and chooseEffort, which
// callers run one at a time (inOrder, below), so a read and a write can never cross.
let loaded: Promise<void> | null = null
let savedModelId: string | null = null
let savedEfforts = new Map<string, Effort>()
let warnedAbout: string | null = null
const warnedEfforts = new Set<string>()

function ensureLoaded(): Promise<void> {
  loaded ??= readPreferences().then((preferences) => {
    savedModelId = preferences.modelId
    savedEfforts = preferences.efforts
  })
  return loaded
}

export type ModelChoice =
  | {
      ok: true
      entry: ModelEntry
      /** What a reply from this model asks for (D-024): the person's saved choice for it, or the registry's pick. Null if it takes none. */
      effort: Effort | null
    }
  | { ok: false; error: string }

/**
 * The model that answers: the person's saved choice if the registry still offers it, otherwise the registry's default; and the
 * effort it is asked for. Fails only if the registry could not be loaded at all.
 */
export async function currentModel(): Promise<ModelChoice> {
  const registry = getRegistry()
  if (!registry.ok) {
    return {
      ok: false,
      error: `The list of models could not be loaded: ${registry.error}. Check registry/models.json.`
    }
  }
  await ensureLoaded()
  const saved = registry.registry.models.find((model) => model.id === savedModelId)
  if (savedModelId !== null && !saved && warnedAbout !== savedModelId) {
    warnedAbout = savedModelId
    console.warn(
      `The saved model ${JSON.stringify(savedModelId.slice(0, 64))} is not in the registry any more, so the default is used.`
    )
  }
  const entry = saved ?? registry.registry.defaultModel
  // A saved level the model no longer lists is not used (the registry's pick is), once in the log; the file is left as it is,
  // so the choice comes back if the registry offers the level again (as a saved model does, D-015).
  const { effort, unusable } = resolveEffort(entry, savedEfforts)
  if (unusable !== null && !warnedEfforts.has(`${entry.id}/${unusable}`)) {
    warnedEfforts.add(`${entry.id}/${unusable}`)
    console.warn(
      `The saved effort level ${JSON.stringify(unusable)} is not one ${JSON.stringify(entry.id)} offers any more, so the registry's pick is used.`
    )
  }
  return { ok: true, entry, effort }
}

/**
 * (21.3, D-053) A model the page named for one request (Auto picks one for each message): that model if the registry offers it, with the effort the person
 * saved for it (or the registry's pick). Refused when it is not on offer: the request is not sent to another model in its place.
 */
export async function modelById(modelId: string): Promise<ModelChoice> {
  const registry = getRegistry()
  if (!registry.ok) {
    return {
      ok: false,
      error: `The list of models could not be loaded: ${registry.error}. Check registry/models.json.`
    }
  }
  const entry = registry.registry.models.find((model) => model.id === modelId)
  if (!entry) return { ok: false, error: 'That model is not on offer any more.' }
  await ensureLoaded()
  return { ok: true, entry, effort: resolveEffort(entry, savedEfforts).effort }
}

/**
 * Writes both choices, in place, and does not claim success unless they really read back. The two live in one file, so every
 * write carries both: choosing a model keeps the efforts, and choosing an effort keeps the model. Throws if it cannot be saved.
 */
async function writePreferences(
  modelId: string | null,
  efforts: ReadonlyMap<string, Effort>
): Promise<void> {
  const file = preferencesPath()
  const contents: StoredPreferences = {
    version: 1,
    ...(modelId !== null ? { modelId } : {}),
    ...(efforts.size > 0 ? { efforts: Object.fromEntries(efforts) } : {})
  }
  await fs.mkdir(dirname(file), { recursive: true })
  await fs.writeFile(file, JSON.stringify(contents))
  const back = await readPreferences()
  if (back.modelId !== modelId || !sameEfforts(back.efforts, efforts)) {
    throw new Error('the saved choice could not be read back')
  }
}

/**
 * Remembers the person's choice. Throws if it cannot be saved, and then nothing has changed. The id is
 * checked against the registry here as well, so no caller can save a model that is not on offer.
 * Callers that can overlap go through inOrder (below).
 */
export async function chooseModel(modelId: string): Promise<void> {
  const registry = getRegistry()
  if (!registry.ok || !registry.registry.models.some((model) => model.id === modelId)) {
    throw new Error('that model is not on offer')
  }
  await ensureLoaded()
  await writePreferences(modelId, savedEfforts)
  savedModelId = modelId
}

/**
 * Remembers how hard one model should think (D-024). Throws if it cannot be saved, and then nothing has changed. The model and the
 * level are checked against the registry here as well as in the handler, so no caller can save a level a model does not take.
 * Callers that can overlap go through inOrder (below).
 */
export async function chooseEffort(modelId: string, level: Effort): Promise<void> {
  const registry = getRegistry()
  const entry = registry.ok
    ? registry.registry.models.find((model) => model.id === modelId)
    : undefined
  if (!entry) throw new Error('that model is not on offer')
  if (!entry.capabilities.effortLevels.includes(level)) {
    throw new Error('that model does not take that effort level')
  }
  await ensureLoaded()
  const next = new Map(savedEfforts).set(modelId, level)
  await writePreferences(savedModelId, next)
  savedEfforts = next
}

// One change at a time, in the order they arrive. Holding an arrow key on the model menu changes the
// choice for every option it passes, so several calls can be in flight at once. Run side by side their
// writes could cross, and the answer that arrives last might not describe the choice made last. (The model and the effort
// share one file and one queue: a model change and an effort change must not cross either.)
let queue: Promise<unknown> = Promise.resolve()

/**
 * Runs `task` once every earlier task has finished (whether it worked or not), and returns what it
 * returns. The handler in ipc.ts wraps its whole body in this: it saves the choice and also reads the
 * status it answers with, so each answer is complete before the next change begins.
 */
export function inOrder<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task)
  queue = run.catch(() => undefined)
  return run
}
