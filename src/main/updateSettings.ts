import type { WriteMode } from './chatFile'
import type { SecretBox } from './credentialStore'
import { createKeptFile, type KeptFile } from './keptFile'
import { isVersion } from './updateManifest'

// Whether the update check is on (Stage 18.4, D-050): updates.json in the data folder, kept like image-settings.json (keptFile.ts). DENY BY DEFAULT: no file, a file
// that cannot be read, or anything in it that is not exactly what this app writes means OFF; a damaged file never switches it on. It is switched ON only after the
// person's yes in the system's own message box (updateService.ts). Besides the switch it keeps when the last check was made (so "once a day" holds across restarts)
// and the version the person last said "Not now" to (so that version is not offered again by itself). No Electron imports.

export const UPDATE_SETTINGS_VERSION = 1
const MAX_FILE_BYTES = 1024

export interface UpdateSettings {
  readonly on: boolean
  /** Milliseconds since 1970 of the last check, or null. */
  readonly lastCheck: number | null
  /** The version the person declined, or null. */
  readonly declined: string | null
}

export const DEFAULT_UPDATE_SETTINGS: UpdateSettings = Object.freeze({
  on: false,
  lastCheck: null,
  declined: null
})

export const updateSettingsText = (settings: UpdateSettings): string =>
  JSON.stringify({
    version: UPDATE_SETTINGS_VERSION,
    on: settings.on,
    lastCheck: settings.lastCheck,
    declined: settings.declined
  })

/** The settings in a file's text, or null when it is not exactly what this app writes. */
export function parseUpdateSettings(content: string): UpdateSettings | null {
  let raw: unknown
  try {
    raw = JSON.parse(content)
  } catch {
    return null
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const fields = raw as Record<string, unknown>
  if (
    Object.keys(fields).sort().join() !== 'declined,lastCheck,on,version' ||
    fields.version !== UPDATE_SETTINGS_VERSION
  )
    return null
  const { on, lastCheck, declined } = fields
  if (typeof on !== 'boolean') return null
  if (
    lastCheck !== null &&
    (typeof lastCheck !== 'number' || !Number.isSafeInteger(lastCheck) || lastCheck < 0)
  )
    return null
  if (declined !== null && !isVersion(declined)) return null
  return Object.freeze({ on, lastCheck, declined })
}

export interface UpdateSettingsStore {
  /** Never throws: off when there is no file, off with the reason when it cannot be read. */
  read(): Promise<{ settings: UpdateSettings; problem: string | null }>
  write(settings: UpdateSettings, options?: { replace?: boolean }): Promise<void>
  file: KeptFile<UpdateSettings>
}

export function createUpdateSettings(options: {
  pathOf: () => string
  box?: SecretBox
  writeMode: () => Promise<WriteMode>
  now?: () => number
}): UpdateSettingsStore {
  const file = createKeptFile<UpdateSettings>({
    pathOf: options.pathOf,
    name: 'your update settings',
    parse: parseUpdateSettings,
    text: updateSettingsText,
    maxBytes: MAX_FILE_BYTES,
    box: options.box,
    writeMode: options.writeMode,
    now: options.now
  })
  return {
    file,
    read: async () => {
      try {
        const current = await file.read()
        if (current.state === 'none') return { settings: DEFAULT_UPDATE_SETTINGS, problem: null }
        if (current.state === 'unreadable')
          return { settings: DEFAULT_UPDATE_SETTINGS, problem: current.why }
        return { settings: current.value, problem: null }
      } catch (error) {
        console.error(
          'Reading the update settings failed:',
          error instanceof Error ? error.message : error
        )
        return { settings: DEFAULT_UPDATE_SETTINGS, problem: 'it could not be read from the disk' }
      }
    },
    write: (settings, writeOptions) => file.write(settings, writeOptions)
  }
}
