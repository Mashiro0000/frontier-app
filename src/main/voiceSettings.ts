import { DEFAULT_VOICE_SETTINGS, isRate, isVoiceName, type VoiceSettings } from '../shared/voice'
import type { WriteMode } from './chatFile'
import type { SecretBox } from './credentialStore'
import { createKeptFile, type KeptFile } from './keptFile'

// What the person chose for voice (Stage 15.2, D-047): voice.json in the data folder, kept like tools.json (keptFile.ts: written like a chat, sealed like the
// chats, a damaged file never written over unless the person starts again). DENY BY DEFAULT: no file, a file that cannot be read, or anything in it that is
// not exactly what this app writes means "Speak to type" is OFF and "Read aloud" is OFF; a damaged file never switches anything on. "Speak to type" is
// switched ON only after the person's yes in the system's own message box (voiceService.ts). No Electron imports.

export const VOICE_SETTINGS_VERSION = 1
const MAX_FILE_BYTES = 4 * 1024

/** The file's own text for the settings. */
export const voiceSettingsText = (settings: VoiceSettings): string =>
  JSON.stringify({
    version: VOICE_SETTINGS_VERSION,
    listen: settings.listen,
    speak: settings.speak,
    voice: settings.voice,
    rate: settings.rate
  })

const isPlain = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** The settings in a file's text, or null when it is not exactly what this app writes (a field more or less, a value of another kind, a rate out of range). */
export function parseVoiceSettings(content: string): VoiceSettings | null {
  let raw: unknown
  try {
    raw = JSON.parse(content)
  } catch {
    return null
  }
  if (!isPlain(raw)) return null
  const keys = Object.keys(raw).sort().join()
  if (keys !== 'listen,rate,speak,version,voice' || raw.version !== VOICE_SETTINGS_VERSION) {
    return null
  }
  const { listen, speak, voice, rate } = raw
  if (typeof listen !== 'boolean' || typeof speak !== 'boolean') return null
  if (voice !== null && !isVoiceName(voice)) return null
  if (!isRate(rate)) return null
  return Object.freeze({ listen, speak, voice, rate })
}

export interface VoiceSettingsStore {
  /**
   * The settings now. Never throws and always answers with something: the defaults (both switches off) when there is no file, and the defaults with the
   * reason when the file cannot be read.
   */
  read(): Promise<{ settings: VoiceSettings; problem: string | null }>
  /** Keeps new settings (the service asks the person first when a switch goes on). Throws KeptRefused, or a disk error. */
  write(settings: VoiceSettings, options?: { replace?: boolean }): Promise<void>
  /** For the encryption flow. */
  file: KeptFile<VoiceSettings>
}

export interface VoiceSettingsOptions {
  pathOf: () => string
  box?: SecretBox
  writeMode: () => Promise<WriteMode>
  now?: () => number
}

export function createVoiceSettings(options: VoiceSettingsOptions): VoiceSettingsStore {
  const file = createKeptFile<VoiceSettings>({
    pathOf: options.pathOf,
    name: 'your voice settings',
    parse: parseVoiceSettings,
    text: voiceSettingsText,
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
        if (current.state === 'none') return { settings: DEFAULT_VOICE_SETTINGS, problem: null }
        if (current.state === 'unreadable') {
          return { settings: DEFAULT_VOICE_SETTINGS, problem: current.why }
        }
        return { settings: current.value, problem: null }
      } catch (error) {
        // Logged here only; the message could name a path.
        console.error(
          'Reading the voice settings failed:',
          error instanceof Error ? error.message : error
        )
        return {
          settings: DEFAULT_VOICE_SETTINGS,
          problem: 'it could not be read from the disk'
        }
      }
    },
    write: (settings, writeOptions) => file.write(settings, writeOptions)
  }
}
