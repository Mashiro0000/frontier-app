// The contract between the page (renderer), the preload and the main process. Everything that can
// cross that boundary is described here, so all three sides agree. Types, channel names and nothing
// else: this file is bundled into the preload, which runs sandboxed (see D-004).

/** What the page may learn about settings. The API key itself is never part of it. */
export interface SettingsStatus {
  /** True if an API key is saved and the app can read it back. */
  hasKey: boolean
  /** False if this computer has no secure place to keep a key. Saving is then refused. */
  canStoreKey: boolean
}

export type SetKeyResult = { ok: true; status: SettingsStatus } | { ok: false; error: string }

/** Everything the preload hands to the page as `window.api`. Nothing else is reachable. */
export interface FrontierApi {
  settings: {
    getStatus(): Promise<SettingsStatus>
    /** Hands the key to the main process, which stores it encrypted. It is never sent back. */
    setApiKey(key: string): Promise<SetKeyResult>
    clearApiKey(): Promise<SettingsStatus>
  }
}

export const CHANNELS = {
  settingsStatus: 'settings:status',
  settingsSetApiKey: 'settings:set-api-key',
  settingsClearApiKey: 'settings:clear-api-key'
} as const
