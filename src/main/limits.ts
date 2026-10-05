import { promises as fs } from 'fs'
import { dirname } from 'path'
import {
  limitsFileText,
  parseLimitsFile,
  sameLimits,
  unsetLimits,
  type Limits
} from '../shared/limits'

// The spending limits (Stage 8.2, D-031): what the person chose for a day and for a month, in one small plain file of its own
// (limits.json, beside preferences.json and credentials.json). Like them it is written in place and read back, not written to a temp
// file and renamed: every rename fails with EXDEV in this project's own EFS-encrypted %APPDATA% (D-010). No Electron imports, so it can
// be checked under plain Node with any folder (`pathOf` is a function only so that the data folder is not asked for before it is known).
//
// A file that is missing, damaged or cut off holds NO CHOICE, never a default: until the person chooses again, every request is refused
// (checkAgainstLimits). So a torn write of this file costs a question, and cannot cost a limit that is not there.
//
// What is held here is read once and kept: it changes only in `save`, which runs one at a time. A person who edits the file while the app
// runs is not heard until the next start.

export interface LimitsStore {
  /**
   * The limits as they are now. A missing or damaged file is "not chosen" (and a damaged one is said once in the log). Throws if the
   * file exists and cannot be read at all: the caller then refuses, and a later call tries again.
   */
  read(): Promise<Limits>
  /** Writes both limits, in place, and does not claim success unless they read back the same. Throws if it cannot; then nothing changed. */
  save(limits: Limits): Promise<void>
}

export function createLimitsStore(pathOf: () => string): LimitsStore {
  let current: Limits | null = null
  let queue: Promise<unknown> = Promise.resolve()

  async function load(): Promise<Limits> {
    let text: string
    try {
      text = await fs.readFile(pathOf(), 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return unsetLimits()
      throw error
    }
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1) // a byte-order mark, which some editors add
    const { limits, damaged } = parseLimitsFile(text)
    if (damaged) {
      console.warn(
        'limits.json is damaged, so any limit in it that could not be read counts as not chosen: the app asks again.'
      )
    }
    return limits
  }

  return {
    read: () => {
      // Through the same queue as `save`, so a read never sees half of a write.
      const run = queue.then(async () => (current ??= await load()))
      queue = run.catch(() => undefined)
      return run
    },

    save: (limits) => {
      const run = queue.then(async () => {
        const file = pathOf()
        await fs.mkdir(dirname(file), { recursive: true })
        await fs.writeFile(file, limitsFileText(limits))
        const back = parseLimitsFile(await fs.readFile(file, 'utf8'))
        if (back.damaged || !sameLimits(back.limits, limits)) {
          throw new Error('the saved limits could not be read back')
        }
        current = back.limits
      })
      queue = run.catch(() => undefined)
      return run
    }
  }
}
