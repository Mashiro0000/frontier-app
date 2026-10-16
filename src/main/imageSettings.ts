import type { WriteMode } from './chatFile'
import type { SecretBox } from './credentialStore'
import { createKeptFile, type KeptFile } from './keptFile'

// Whether "Make images" is switched on (Stage 16.2, D-048): image-settings.json in the data folder, kept like voice.json (keptFile.ts: written like a chat, sealed like the chats,
// a damaged file never written over unless the person starts again). DENY BY DEFAULT: no file, a file that cannot be read, or anything in it that is not exactly what this
// app writes means OFF; a damaged file never switches it on. It is switched ON only after the person's yes in the system's own message box (imageService.ts). No Electron imports.

export const IMAGE_SETTINGS_VERSION = 1
const MAX_FILE_BYTES = 1024

export interface ImageSettings {
  readonly on: boolean
}

export const DEFAULT_IMAGE_SETTINGS: ImageSettings = Object.freeze({ on: false })

/** The file's own text for the settings. */
export const imageSettingsText = (settings: ImageSettings): string =>
  JSON.stringify({ version: IMAGE_SETTINGS_VERSION, on: settings.on })

/** The settings in a file's text, or null when it is not exactly what this app writes. */
export function parseImageSettings(content: string): ImageSettings | null {
  let raw: unknown
  try {
    raw = JSON.parse(content)
  } catch {
    return null
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const fields = raw as Record<string, unknown>
  if (
    Object.keys(fields).sort().join() !== 'on,version' ||
    fields.version !== IMAGE_SETTINGS_VERSION
  )
    return null
  if (typeof fields.on !== 'boolean') return null
  return Object.freeze({ on: fields.on })
}

export interface ImageSettingsStore {
  /** The settings now. Never throws: off when there is no file, off with the reason when it cannot be read. */
  read(): Promise<{ settings: ImageSettings; problem: string | null }>
  /** Keeps new settings (the service asks the person first when it goes on). Throws KeptRefused, or a disk error. */
  write(settings: ImageSettings, options?: { replace?: boolean }): Promise<void>
  /** For the encryption flow. */
  file: KeptFile<ImageSettings>
}

export function createImageSettings(options: {
  pathOf: () => string
  box?: SecretBox
  writeMode: () => Promise<WriteMode>
  now?: () => number
}): ImageSettingsStore {
  const file = createKeptFile<ImageSettings>({
    pathOf: options.pathOf,
    name: 'your image settings',
    parse: parseImageSettings,
    text: imageSettingsText,
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
        if (current.state === 'none') return { settings: DEFAULT_IMAGE_SETTINGS, problem: null }
        if (current.state === 'unreadable')
          return { settings: DEFAULT_IMAGE_SETTINGS, problem: current.why }
        return { settings: current.value, problem: null }
      } catch (error) {
        // Logged here only; the message could name a path.
        console.error(
          'Reading the image settings failed:',
          error instanceof Error ? error.message : error
        )
        return { settings: DEFAULT_IMAGE_SETTINGS, problem: 'it could not be read from the disk' }
      }
    },
    write: (settings, writeOptions) => file.write(settings, writeOptions)
  }
}
