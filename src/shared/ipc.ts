// The contract between the page (renderer), the preload and the main process. Everything that can
// cross that boundary is described here, so all three sides agree. Types, channel names and limits
// only: this file is bundled into the preload, which runs sandboxed (see D-004).

import type { AskFirstChoice, AskFirstSetting, RequestEstimate } from './askFirst'
import type { Limits, LimitsChoice } from './limits'
import type { Suggestion, TaskOption } from './rankings'
import type { Effort, ModelPricing, ProviderId } from './registry'
import type { ReplyUsage, UsageSummary } from './usage'

/**
 * A model the person can choose, as the page sees it: what to show about it, and nothing about how
 * the main process calls it. The list comes from registry/models.json (D-014).
 */
export interface ModelOption {
  /** What the API calls it. The page hands it back to choose the model. */
  id: string
  /** For example "Claude Opus 5.5". */
  label: string
  /** Who runs it: one of the providers in `SettingsStatus.providers`, which says how to show it. */
  provider: ProviderId
  description: string
  /** Tokens: how much conversation it can read at once. */
  contextWindow: number
  /** List prices in US dollars per million tokens (D-030). */
  pricing: ModelPricing
}

/** One provider the app can call, as the page sees it: its name, and whether an API key for it is saved (D-020). */
export interface ProviderStatus {
  id: ProviderId
  /** How the person knows it, for example "Anthropic". */
  name: string
  /** True if an API key for it is saved and the app can read it back. */
  hasKey: boolean
}

/**
 * The effort setting of the model that answers, as the page may know it (D-024): the levels to choose from, the one the next
 * reply will use, and the one the registry picks until the person chooses. It is a menu to show, not a request: the page is
 * still told nothing about how a model is called, and a reply's effort is main's to decide (the chat request carries none).
 */
export interface EffortStatus {
  /** The levels the model accepts, from the one that thinks least to the one that thinks most. Never empty. */
  levels: Effort[]
  /** What the next reply will ask for: the person's saved choice for this model, or else `default`. One of `levels`. */
  selected: Effort
  /** The registry's own pick, used until the person chooses. One of `levels`. */
  default: Effort
}

/** What the page may learn about settings. The API keys themselves are never part of it. */
export interface SettingsStatus {
  /** Every provider this version of the app can call, in the order to show them. */
  providers: ProviderStatus[]
  /** False if this computer has no secure place to keep a key. Saving is then refused. */
  canStoreKey: boolean
  /** The models on offer, in the order to show them. Empty if the registry could not be loaded. */
  models: ModelOption[]
  /** The model that answers: the person's saved choice, or else the registry's default. */
  selectedModelId: string | null
  /** Why the registry could not be loaded, or null if it was. Replies are unavailable until it is fixed. */
  modelsError: string | null
  /** When the registry's facts and prices were last checked, as a date like "2026-10-01". */
  modelsCheckedOn: string | null
  /** The kinds of task a person can say they are doing, in the order to show them (D-023). */
  tasks: TaskOption[]
  /**
   * What the providers' documentation names for each task, for the models that are on offer and whose provider has a key
   * saved. Never a choice: the app only shows it. Empty if the registry or the rankings could not be loaded.
   */
  suggestions: Suggestion[]
  /** How hard the model that answers thinks (D-024). Null if that model takes no such setting (Haiku 4.5), or none is selected. */
  effort: EffortStatus | null
  /**
   * The daily and the monthly spending limit (D-031). Each is an amount, "No limit" chosen on purpose, or not chosen yet; until both are chosen
   * every request is refused. Main enforces them; the page only shows them and sends the person's choice.
   */
  limits: Limits
  /**
   * What the person chose for "ask me before a very large request" (D-032): an amount, "Never ask", or nothing yet (the default amount applies,
   * `ASK_FIRST_DEFAULT_USD`). Main asks the question; the page only shows the setting and sends the person's choice.
   */
  askFirst: AskFirstSetting
}

export type SetKeyResult = { ok: true; status: SettingsStatus } | { ok: false; error: string }
/** What "Test key" found out: how many models the provider lists for the key (a free call), or what went wrong. */
export type TestKeyResult = { ok: true; modelCount: number } | { ok: false; error: string }
export type SetModelResult = { ok: true; status: SettingsStatus } | { ok: false; error: string }
export type SetEffortResult = { ok: true; status: SettingsStatus } | { ok: false; error: string }
export type SetLimitsResult = { ok: true; status: SettingsStatus } | { ok: false; error: string }
export type SetAskFirstResult = { ok: true; status: SettingsStatus } | { ok: false; error: string }

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
  /**
   * The person's own instructions for this chat (D-027). Main adds them to the app's own rules AFTER them and never in place of them:
   * this is not the system prompt, and the page cannot replace that. Absent when there are none. Main checks them again
   * (`checkInstructions`): text, trimmed, at most `CHAT_LIMITS.maxInstructionsChars`, and left out when blank.
   */
  instructions?: string
  /**
   * The conversation this request belongs to (a lower-case uuid, the id the chat is saved under), so that what it costs can be shown under
   * that chat (D-030). It decides nothing else: the day's and the month's sums, and the limit of Stage 8.2, count the request whatever it says.
   * Absent for a request that does not belong to a saved chat.
   */
  conversationId?: string
}

/** What the main process reports while a reply is being produced. */
export type ChatStreamEvent =
  /** Always first, before the key is looked up: which model is answering (D-021). Not sent if no model could be chosen. */
  | { streamId: string; type: 'start'; provider: ProviderId; model: string }
  /**
   * The request is large (D-032) and nothing has been sent: main is WAITING for the person's yes (`chat.confirm`) before it sends. It says which
   * model would answer, what the request could cost at the most, and the amount above which it asks. A reply that gets no yes is never sent.
   */
  | {
      streamId: string
      type: 'confirm'
      model: string
      estimate: RequestEstimate
      askAboveUsd: number
    }
  | { streamId: string; type: 'text'; text: string }
  /** What the reply used and cost (D-030). Sent just before 'done' or 'error', and only when something is owed. */
  | { streamId: string; type: 'usage'; usage: ReplyUsage }
  | { streamId: string; type: 'done' }
  | { streamId: string; type: 'error'; message: string }

/** How a saved message ended. A reply that was still arriving when it was saved counts as stopped. */
export type SavedStatus = 'done' | 'stopped' | 'error'

/** A message as it is saved on disk and handed back to the page. */
export interface SavedMessage {
  role: WireRole
  content: string
  status: SavedStatus
  /** Why the reply failed. Only present when the status is 'error'. */
  error?: string
  /**
   * Who wrote a reply (D-021). Both are present on every reply and absent on the person's own messages. `null` means
   * not known: a reply saved before the app recorded it knows its provider (there was only one) but not its model.
   */
  provider?: ProviderId | null
  model?: string | null
}

/** A message as the page hands it over to be saved. Main turns 'streaming' into 'stopped'. */
export interface MessageToSave {
  role: WireRole
  content: string
  status: SavedStatus | 'streaming'
  error?: string
  /** For a reply: which model answered, as main reported it when the reply began (D-021). Checked again by main. */
  provider?: ProviderId | null
  model?: string | null
}

/**
 * The whole conversation on screen, to be saved (a snapshot, not a change). The title and the dates are not
 * the page's to choose: main works them out, so the page cannot forge them.
 */
export interface ConversationToSave {
  /** Chosen by the page, and checked by main: a UUID in lower case, because it becomes a file name. */
  id: string
  messages: MessageToSave[]
  /** The person's instructions for this chat (D-027), saved with it. Absent means none. Checked again by main, as for a request. */
  instructions?: string
}

/** A saved conversation, as main hands it back to be put on screen. */
export interface SavedConversation {
  id: string
  /** The first thing the person wrote, on one line and cut short. */
  title: string
  /** Milliseconds since 1970. */
  createdAt: number
  updatedAt: number
  /** The person's instructions for this chat (D-027): '' for none, and for every chat saved before version 3 of the file. */
  instructions: string
  messages: SavedMessage[]
}

/** One line in the list of saved conversations. */
export interface ConversationSummary {
  id: string
  title: string
  updatedAt: number
  messageCount: number
}

export interface HistoryList {
  /** Newest first. */
  conversations: ConversationSummary[]
  /** Files in the folder that look like conversations but could not be read. They are left alone. */
  unreadable: number
  /** Where the files are kept, for the person to see. */
  folder: string
}

export type HistoryLoadResult =
  { ok: true; conversation: SavedConversation } | { ok: false; error: string }
export type HistorySaveResult =
  { ok: true; summary: ConversationSummary } | { ok: false; error: string }
export type HistoryRemoveResult = { ok: true } | { ok: false; error: string }

/** Everything the preload hands to the page as `window.api`. Nothing else is reachable. */
export interface FrontierApi {
  settings: {
    getStatus(): Promise<SettingsStatus>
    /** Hands the key for one provider to the main process, which stores it encrypted. It is never sent back. */
    setApiKey(provider: ProviderId, key: string): Promise<SetKeyResult>
    clearApiKey(provider: ProviderId): Promise<SettingsStatus>
    /**
     * Asks the provider for its list of models with the key that is SAVED for it (it costs nothing), to learn whether
     * the provider accepts the key. The page never supplies a key to test, and learns only a count or a sentence.
     */
    testApiKey(provider: ProviderId): Promise<TestKeyResult>
    /** Chooses which model answers. Main only accepts an id that is in the registry, and remembers it. */
    setModel(modelId: string): Promise<SetModelResult>
    /**
     * Chooses how hard ONE model thinks before it answers (D-024). Main accepts only a model on offer and a level that model's
     * registry entry lists, and remembers the choice per model. The answer describes the model that answers now.
     */
    setEffort(modelId: string, level: string): Promise<SetEffortResult>
    /**
     * Chooses the daily and the monthly spending limit (D-031): both together, each an amount in whole dollars and cents or "No limit". Main
     * checks them again and keeps them; the page cannot take a choice back to "not chosen", and has no other way to change a limit.
     */
    setLimits(choice: LimitsChoice): Promise<SetLimitsResult>
    /**
     * Chooses the amount above which the app asks before sending a large request (D-032), or "Never ask". Main checks it again and keeps it; the
     * page cannot send anything but those two, and this is not a limit: the spending limits still stop a request, whatever is chosen here.
     */
    setAskFirst(choice: AskFirstChoice): Promise<SetAskFirstResult>
  }
  chat: {
    /** Starts a reply. It is answered by events (see `onEvent`), not by a return value. */
    start(request: ChatRequest): void
    /** Stops a reply that is still arriving, or says no to a request that is waiting for the person's yes. */
    cancel(streamId: string): void
    /**
     * Says yes to the large request that main is waiting to send (the `confirm` event of this stream). Heard only while that question is
     * waiting: one sent before it, after it was answered, or for a stream that is not asking is dropped, so a yes cannot be given ahead of time.
     */
    confirm(streamId: string): void
    /** Listens for reply events. Returns a function that stops listening. */
    onEvent(listener: (event: ChatStreamEvent) => void): () => void
  }
  usage: {
    /**
     * What has been used and spent (D-030): this chat's sum (when an id is given), today's and this month's. Main works them out from its
     * own ledger; the page only asks. An id that is not a conversation id is treated as none.
     */
    summary(conversationId: string | null): Promise<UsageSummary>
  }
  history: {
    /** The saved conversations, newest first. */
    list(): Promise<HistoryList>
    /** One saved conversation, to put on screen. Main only answers for an id that is a saved conversation. */
    load(id: string): Promise<HistoryLoadResult>
    /** Saves the whole conversation. Main checks it and writes it; the page cannot choose the title or dates. */
    save(conversation: ConversationToSave): Promise<HistorySaveResult>
    /** Deletes a saved conversation's file. */
    remove(id: string): Promise<HistoryRemoveResult>
  }
}

export const CHANNELS = {
  settingsStatus: 'settings:status',
  settingsSetApiKey: 'settings:set-api-key',
  settingsClearApiKey: 'settings:clear-api-key',
  settingsTestApiKey: 'settings:test-api-key',
  settingsSetModel: 'settings:set-model',
  settingsSetEffort: 'settings:set-effort',
  settingsSetLimits: 'settings:set-limits',
  settingsSetAskFirst: 'settings:set-ask-first',
  chatStart: 'chat:start',
  chatCancel: 'chat:cancel',
  chatConfirm: 'chat:confirm',
  chatEvent: 'chat:event',
  usageSummary: 'usage:summary',
  historyList: 'history:list',
  historyLoad: 'history:load',
  historySave: 'history:save',
  historyRemove: 'history:remove'
} as const

/**
 * Upper bounds on one request. The whole conversation is sent again with every message, so its size
 * is also its price: this stops a runaway chat from quietly costing a lot per message.
 */
export const CHAT_LIMITS = {
  maxMessages: 500,
  maxMessageChars: 200_000,
  maxTotalChars: 600_000,
  /**
   * The person's instructions for a chat (D-027) go out with EVERY request, so they are kept short: about 2,000 tokens. They do not count
   * towards maxTotalChars. The same limit applies when they are saved and when they are read back, so what is written can always be read.
   */
  maxInstructionsChars: 8_000
} as const

/**
 * Upper bounds on what is saved (D-016). They are well above CHAT_LIMITS on purpose: a reply can push a
 * conversation past what chat will send, and the person must still be able to save what they were shown.
 * Messages with no text (a failed reply) do not count towards the chat limit but are saved, which is the
 * other reason. Whatever is written must also be readable again, hence the limit on a file.
 */
export const HISTORY_LIMITS = {
  maxConversations: 1000,
  maxMessages: 2000,
  maxMessageChars: 400_000,
  maxTotalChars: 1_500_000,
  maxErrorChars: 2_000,
  maxTitleChars: 200,
  /** The worst case of maxTotalChars (every character escaped to 6 bytes in JSON) is about 9 MB. */
  maxFileBytes: 10 * 1024 * 1024
} as const
