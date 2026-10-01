import { app } from 'electron'
import { promises as fs } from 'fs'
import { dirname, join } from 'path'
import type { ModelEntry } from '../shared/registry'
import { getRegistry } from './registry'

// Which model answers. The registry says which models exist and which one is the default (D-014); the
// one thing saved here is the person's choice (D-015). It lives in a small file of its own beside
// credentials.json: removing the API key must not forget the model, and a model name is no secret.
// Like the key file (D-010) it is written in place and read back, not written to a temp file and
// renamed: every rename fails with EXDEV in this project's own %APPDATA%, which is EFS-encrypted. A torn
// write of a file this small only means the choice has to be made again.

interface StoredPreferences {
  version: 1
  modelId?: string
}

const preferencesPath = (): string => join(app.getPath('userData'), 'preferences.json')

async function readSavedModelId(): Promise<string | null> {
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(preferencesPath(), 'utf8'))
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      (parsed as StoredPreferences).version === 1
    ) {
      const id = (parsed as StoredPreferences).modelId
      return typeof id === 'string' ? id : null
    }
  } catch {
    // no file, or not readable: nothing is saved
  }
  return null
}

// The saved id is read once, on first use, and kept here. After that it changes only in chooseModel,
// so a read and a write can never cross.
let loaded: Promise<void> | null = null
let savedModelId: string | null = null
let warnedAbout: string | null = null

function ensureLoaded(): Promise<void> {
  loaded ??= readSavedModelId().then((id) => {
    savedModelId = id
  })
  return loaded
}

export type ModelChoice = { ok: true; entry: ModelEntry } | { ok: false; error: string }

/**
 * The model that answers: the person's saved choice if the registry still offers it, otherwise the
 * registry's default. Fails only if the registry could not be loaded at all.
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
  return { ok: true, entry: saved ?? registry.registry.defaultModel }
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
  const file = preferencesPath()
  const contents: StoredPreferences = { version: 1, modelId }
  await fs.mkdir(dirname(file), { recursive: true })
  await fs.writeFile(file, JSON.stringify(contents))
  // Do not claim success unless the choice really reads back.
  if ((await readSavedModelId()) !== modelId)
    throw new Error('the saved choice could not be read back')
  savedModelId = modelId
}

// One change at a time, in the order they arrive. Holding an arrow key on the model menu changes the
// choice for every option it passes, so several calls can be in flight at once. Run side by side their
// writes could cross, and the answer that arrives last might not describe the choice made last.
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
