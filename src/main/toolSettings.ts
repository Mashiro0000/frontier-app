import { DEFAULT_TOOL_SETTINGS, TOOL_CAPS_BOUNDS, type ToolSettings } from '../shared/tools'
import type { WriteMode } from './chatFile'
import type { SecretBox } from './credentialStore'
import { createKeptFile, type KeptFile } from './keptFile'

// Which tools are switched on, and the caps on one reply (Stage 11.3, D-041): tools.json in the data folder, kept like the person's other documents
// (keptFile.ts: written like a chat, sealed like the chats, a damaged file never written over unless the person starts again). Main alone reads it, at
// every reply. DENY BY DEFAULT: no file, a file that cannot be read, or anything in it that is not exactly what this app writes means every tool is OFF
// and the caps are the defaults; a damaged file never switches anything on. The page will be able to ask for a change (11.4), and a tool is switched ON
// only after the person's yes in the system's own message box. No Electron imports.

export const TOOL_SETTINGS_VERSION = 1
const TOOL_ID = /^[a-z][a-z0-9_]{1,31}$/
const MAX_TOOLS = 64
const MAX_FILE_BYTES = 16 * 1024

/** The file's own text for the settings. */
export const toolSettingsText = (settings: ToolSettings): string =>
  JSON.stringify({
    version: TOOL_SETTINGS_VERSION,
    enabled: { ...settings.enabled },
    caps: { steps: settings.caps.steps, seconds: settings.caps.seconds }
  })

const isPlain = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const inRange = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max

/** The settings in a file's text, or null when it is not exactly what this app writes (a field more or less, a value of another kind, a cap out of range). */
export function parseToolSettings(content: string): ToolSettings | null {
  let raw: unknown
  try {
    raw = JSON.parse(content)
  } catch {
    return null
  }
  if (!isPlain(raw)) return null
  if (Object.keys(raw).length !== 3 || raw.version !== TOOL_SETTINGS_VERSION) return null
  const { enabled, caps } = raw
  if (!isPlain(enabled) || !isPlain(caps)) return null
  const names = Object.keys(enabled)
  if (names.length > MAX_TOOLS) return null
  const on: Record<string, boolean> = {}
  for (const name of names) {
    if (!TOOL_ID.test(name) || typeof enabled[name] !== 'boolean') return null
    on[name] = enabled[name]
  }
  if (Object.keys(caps).length !== 2) return null
  const { steps, seconds } = caps
  if (!inRange(steps, TOOL_CAPS_BOUNDS.steps.min, TOOL_CAPS_BOUNDS.steps.max)) return null
  if (!inRange(seconds, TOOL_CAPS_BOUNDS.seconds.min, TOOL_CAPS_BOUNDS.seconds.max)) return null
  return Object.freeze({ enabled: Object.freeze(on), caps: Object.freeze({ steps, seconds }) })
}

export interface ToolSettingsStore {
  /**
   * The settings now. Never throws and always answers with something: the defaults (every tool off) when there is no file, and the defaults with the
   * reason when the file cannot be read.
   */
  read(): Promise<{ settings: ToolSettings; problem: string | null }>
  /** Keeps new settings (11.4 asks the person first). Throws KeptRefused, or a disk error. */
  write(settings: ToolSettings, options?: { replace?: boolean }): Promise<void>
  /** For the encryption flow and the backups. */
  file: KeptFile<ToolSettings>
}

export interface ToolSettingsOptions {
  pathOf: () => string
  box?: SecretBox
  writeMode: () => Promise<WriteMode>
  now?: () => number
}

export function createToolSettings(options: ToolSettingsOptions): ToolSettingsStore {
  const file = createKeptFile<ToolSettings>({
    pathOf: options.pathOf,
    name: 'your tool settings',
    parse: parseToolSettings,
    text: toolSettingsText,
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
        if (current.state === 'none') return { settings: DEFAULT_TOOL_SETTINGS, problem: null }
        if (current.state === 'unreadable') {
          return { settings: DEFAULT_TOOL_SETTINGS, problem: current.why }
        }
        return { settings: current.value, problem: null }
      } catch (error) {
        // Logged here only; the message could name a path.
        console.error(
          'Reading the tool settings failed:',
          error instanceof Error ? error.message : error
        )
        return { settings: DEFAULT_TOOL_SETTINGS, problem: 'it could not be read from the disk' }
      }
    },
    write: (settings, writeOptions) => file.write(settings, writeOptions)
  }
}
