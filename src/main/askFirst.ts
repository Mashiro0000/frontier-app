import { promises as fs } from 'fs'
import { dirname } from 'path'
import {
  askFirstFileText,
  defaultAskFirst,
  parseAskFirstFile,
  sameAskFirst,
  type AskFirstChoice,
  type AskFirstSetting
} from '../shared/askFirst'

// What the person chose for "ask me before a very large request" (Stage 8.3, D-032), in one small plain file of its own (ask-first.json, beside
// limits.json and preferences.json). Like them it is written in place and read back, not written to a temp file and renamed: every rename fails
// with EXDEV in this project's own EFS-encrypted %APPDATA% (D-010). No Electron imports, so it can be checked under plain Node with any folder
// (`pathOf` is a function only so that the data folder is not asked for before it is known).
//
// This is the opposite of the limits' file in one way, on purpose: a file that is missing, damaged, cut off or unreadable holds NO CHOICE and
// the DEFAULT applies, so the question is still asked. Damage can cost the person's amount; it can never turn the question off. For that
// reason `read` never throws.
//
// What is held here is read once and kept: it changes only in `save`, which runs one at a time. A person who edits the file while the app
// runs is not heard until the next start.

export interface AskFirstStore {
  /** The setting as it is now. A missing, damaged or unreadable file is "nothing chosen" (the default applies); never throws. */
  read(): Promise<AskFirstSetting>
  /** Writes the choice, in place, and does not claim success unless it reads back the same. Throws if it cannot; then nothing changed. */
  save(choice: AskFirstChoice): Promise<void>
}

export function createAskFirstStore(pathOf: () => string): AskFirstStore {
  let current: AskFirstSetting | null = null
  let queue: Promise<unknown> = Promise.resolve()

  /** What the file holds, and whether to keep it: a file that could not be read at all is not kept, so that a later call tries again. */
  async function load(): Promise<{ setting: AskFirstSetting; keep: boolean }> {
    let text: string
    try {
      text = await fs.readFile(pathOf(), 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return { setting: defaultAskFirst(), keep: true }
      }
      // Logged here only (a message could name a file path).
      console.error(
        'Reading ask-first.json failed, so the default applies:',
        error instanceof Error ? error.message : error
      )
      return { setting: defaultAskFirst(), keep: false }
    }
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1) // a byte-order mark, which some editors add
    const { setting, damaged } = parseAskFirstFile(text)
    if (damaged) {
      console.warn(
        'ask-first.json is damaged, so what could not be read counts as nothing chosen: the default applies.'
      )
    }
    return { setting, keep: true }
  }

  return {
    read: () => {
      // Through the same queue as `save`, so a read never sees half of a write.
      const run = queue.then(async () => {
        if (current !== null) return current
        const { setting, keep } = await load()
        if (keep) current = setting
        return setting
      })
      queue = run.catch(() => undefined)
      return run
    },

    save: (choice) => {
      const run = queue.then(async () => {
        const file = pathOf()
        await fs.mkdir(dirname(file), { recursive: true })
        await fs.writeFile(file, askFirstFileText(choice))
        const back = parseAskFirstFile(await fs.readFile(file, 'utf8'))
        if (back.damaged || !sameAskFirst(back.setting, choice)) {
          throw new Error('the saved choice could not be read back')
        }
        current = back.setting
      })
      queue = run.catch(() => undefined)
      return run
    }
  }
}
