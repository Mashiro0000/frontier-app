// What "effort" means to the app (D-024): how hard a model thinks before it answers. The registry says which levels each model
// accepts and which one the app asks for until the person chooses (D-014, D-019); the person's own choice is kept per model by
// the main process. Plain functions with no Electron imports, so they can be checked on their own.

import type { EffortStatus } from './ipc'
import { EFFORT_LEVELS, MODEL_ID, type Effort, type ModelEntry } from './registry'

const isEffort = (value: unknown): value is Effort => EFFORT_LEVELS.some((level) => level === value)

/** More than this many saved choices is not something a person made: the rest are ignored. (The registry holds 50 models at most.) */
const MAX_SAVED_EFFORTS = 200

/** The levels in the order of how much the model thinks (the registry's own order is not relied on), each once. */
export function sortedLevels(levels: readonly Effort[]): Effort[] {
  return EFFORT_LEVELS.filter((level) => levels.includes(level))
}

/**
 * Reads the `efforts` field of preferences.json: a model id to a level. The file is the person's own, but it can be edited or
 * damaged, so reading is forgiving and takes only what is usable: a key that is not shaped like a model id, or a value that is not
 * a known level, is dropped (one bad entry never costs the others, and nothing here can cost the model choice). A Map, so that no
 * key (not even "__proto__") is special.
 */
export function parseSavedEfforts(raw: unknown): Map<string, Effort> {
  const saved = new Map<string, Effort>()
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return saved
  for (const [modelId, level] of Object.entries(raw)) {
    if (saved.size >= MAX_SAVED_EFFORTS) break
    if (MODEL_ID.test(modelId) && isEffort(level)) saved.set(modelId, level)
  }
  return saved
}

export interface ResolvedEffort {
  /** What the next reply from this model asks for. Null for a model that takes no effort setting. */
  effort: Effort | null
  /** A saved level this model does not offer (the registry changed since it was chosen), which is therefore not used. */
  unusable: Effort | null
}

/**
 * The effort a model is asked for: the person's saved choice if the model still offers that level, otherwise the registry's own
 * pick. The saved level is checked against the model's list EVERY time: the registry can change under a saved choice.
 */
export function resolveEffort(
  entry: ModelEntry,
  saved: ReadonlyMap<string, Effort>
): ResolvedEffort {
  const chosen = saved.get(entry.id)
  if (chosen === undefined) return { effort: entry.effort, unusable: null }
  if (entry.capabilities.effortLevels.includes(chosen)) return { effort: chosen, unusable: null }
  return { effort: entry.effort, unusable: chosen }
}

/**
 * What the page is told about the effort of the model that answers: null for a model that takes none, else the menu to show.
 * `effort` is what `resolveEffort` decided for this model.
 */
export function effortStatusOf(entry: ModelEntry, effort: Effort | null): EffortStatus | null {
  if (entry.capabilities.effortLevels.length === 0 || entry.effort === null || effort === null) {
    return null
  }
  return {
    levels: sortedLevels(entry.capabilities.effortLevels),
    selected: effort,
    default: entry.effort
  }
}
