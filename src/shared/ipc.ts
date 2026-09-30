// The contract between the page (renderer), the preload and the main process. Everything that can
// cross that boundary is described here, so all three sides agree. Types, channel names and limits
// only: this file is bundled into the preload, which runs sandboxed (see D-004).

/** What the page may learn about settings. The API key itself is never part of it. */
export interface SettingsStatus {
  /** True if an API key is saved and the app can read it back. */
  hasKey: boolean
  /** False if this computer has no secure place to keep a key. Saving is then refused. */
  canStoreKey: boolean
  /** Who answers the chat, and with which model. Shown to the person; fixed for now. */
  provider: string
  modelLabel: string
}

export type SetKeyResult = { ok: true; status: SettingsStatus } | { ok: false; error: string }

/** A message as the model is told about it: who wrote it, and the plain text. */
export type WireRole = 'user' | 'assistant'
export interface WireMessage {
  role: WireRole
  content: string
}

/** Asks for one reply. The conversation so far ends with the message just sent by the person. */
export interface ChatRequest {
  /** Chosen by the page. Every event about this reply carries it back. */
  streamId: string
  messages: WireMessage[]
}

/** What the main process reports while a reply is being produced. */
export type ChatStreamEvent =
  | { streamId: string; type: 'text'; text: string }
  | { streamId: string; type: 'done' }
  | { streamId: string; type: 'error'; message: string }

/** Everything the preload hands to the page as `window.api`. Nothing else is reachable. */
export interface FrontierApi {
  settings: {
    getStatus(): Promise<SettingsStatus>
    /** Hands the key to the main process, which stores it encrypted. It is never sent back. */
    setApiKey(key: string): Promise<SetKeyResult>
    clearApiKey(): Promise<SettingsStatus>
  }
  chat: {
    /** Starts a reply. It is answered by events (see `onEvent`), not by a return value. */
    start(request: ChatRequest): void
    /** Stops a reply that is still arriving. */
    cancel(streamId: string): void
    /** Listens for reply events. Returns a function that stops listening. */
    onEvent(listener: (event: ChatStreamEvent) => void): () => void
  }
}

export const CHANNELS = {
  settingsStatus: 'settings:status',
  settingsSetApiKey: 'settings:set-api-key',
  settingsClearApiKey: 'settings:clear-api-key',
  chatStart: 'chat:start',
  chatCancel: 'chat:cancel',
  chatEvent: 'chat:event'
} as const

/**
 * Upper bounds on one request. The whole conversation is sent again with every message, so its size
 * is also its price: this stops a runaway chat from quietly costing a lot per message.
 */
export const CHAT_LIMITS = {
  maxMessages: 500,
  maxMessageChars: 200_000,
  maxTotalChars: 600_000
} as const
