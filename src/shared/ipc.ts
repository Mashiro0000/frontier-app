// The contract between the page (renderer), the preload and the main process. Everything that can
// cross that boundary is described here, so all three sides agree. Types, channel names and limits
// only: this file is bundled into the preload, which runs sandboxed (see D-004).

import type { AskFirstChoice, AskFirstSetting, RequestEstimate } from './askFirst'
import type { AttachedFile, AttachmentInfo } from './attachments'
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
  /** It reads images, and PDFs (D-037): the page says so before anything is sent; main checks again. */
  imageInput: boolean
  documentInput: boolean
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
  /** How hard the model that answers thinks (D-024). Null if that model takes no such setting (a registry entry with no effort levels), or none is selected. */
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
/**
 * `cancelled`: a change that lets the app spend more was asked about in the system's own message box (D-039), and the person said no (or closed it).
 * Nothing was saved, and it is not shown as a failure.
 */
export type SetLimitsResult =
  { ok: true; status: SettingsStatus } | { ok: false; error: string; cancelled?: true }
export type SetAskFirstResult =
  { ok: true; status: SettingsStatus } | { ok: false; error: string; cancelled?: true }

/** A message as the model is told about it: who wrote it, and the plain text. */
export type WireRole = 'user' | 'assistant'
export interface WireMessage {
  role: WireRole
  /** The text. It may be '' only for a message of the person's that carries files. */
  content: string
  /**
   * The files on a message of the person's (D-037), by the id of main's copy and the name to show the model. Main reads the copies from its own folder (the
   * page cannot point at any other file) and checks them again. Absent when there are none, so a request without files is what it always was.
   */
  attachments?: WireAttachment[]
}

/** A file on a message, as a request names it: the id of main's copy and its name (a label, cleaned again by main). */
export interface WireAttachment {
  id: string
  name: string
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
  /** The files on a message of the person's (D-037): what each was when it was attached. Only in a file of version 4; absent when there are none. */
  attachments?: AttachmentInfo[]
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
  /** The files on a message of the person's (D-037). Checked again by main, field by field. */
  attachments?: AttachmentInfo[]
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
  /** How the files are kept (plain or encrypted), so the dialog can say so (D-035). */
  storage: ChatStorageStatus
}

/**
 * How the saved chats are kept, as main finds it now (D-035). The numbers are of what was read at the last look at the folder; the page only
 * shows them, and never learns a key, a check or a path.
 */
export interface ChatStorageStatus {
  /**
   * What the person chose: 'off' (plain files, until they turn encryption on), 'on' (every chat is written encrypted), or 'unreadable' (the file
   * that records the choice cannot be read: nothing new is saved until the person chooses again).
   */
  choice: 'off' | 'on' | 'unreadable'
  /** False if this computer has no secure storage to encrypt with (the same one the API keys use). */
  canEncrypt: boolean
  /** With the choice 'on': whether the key that protects the chats can be used now. Null with any other choice. */
  keyUsable: boolean | null
  /** Saved chats that could be read, by how their file is kept. */
  plain: number
  encrypted: number
  /** Saved files that could not be read, and, of those, the encrypted ones that could not be opened (another key, or damage). They are left as they are. */
  unreadable: number
  unopened: number
  /** Why nothing new can be saved right now, as a sentence; null when saving works. */
  blocked: string | null
}

/** What turning encryption on or off did, for the person to read (D-035). */
export interface ChatStorageReport {
  /** Chats whose file was rewritten in the form the choice says; chats that already were in it; chats that could not be rewritten and were left exactly as they were. */
  changed: number
  already: number
  failed: number
  /** The backup that was made first (turning encryption on, when there were chats), or null. */
  backup: { count: number; leftOut: number; where: string } | null
  /** The attached files (D-037), rewritten in the same form as the chats; absent when there are none. */
  files?: { changed: number; failed: number }
}

/** `cancelled`: the person closed the system's dialog, which is not a failure and is not shown as one. */
export type ChatStorageResult =
  | { ok: true; status: ChatStorageStatus; report: ChatStorageReport }
  | { ok: false; error: string; cancelled?: true }

export type HistoryLoadResult =
  { ok: true; conversation: SavedConversation } | { ok: false; error: string }
export type HistorySaveResult =
  { ok: true; summary: ConversationSummary } | { ok: false; error: string }
export type HistoryRemoveResult = { ok: true } | { ok: false; error: string }

/** What to back up (D-034): every saved chat, or one. Never a path: the person picks where in the system's own dialog, which main opens. */
export type BackupRequest = { scope: 'all' } | { scope: 'one'; id: string }

/** `cancelled`: the person closed the dialog, which is not a failure and is not shown as one. */
export type HistoryExportResult =
  | {
      ok: true
      /** How many chats are in the file; it was read back and every one matched. */
      count: number
      /** Saved files that could not be read, and so are NOT in it. */
      leftOut: number
      /** Where it is, for the person to see. */
      where: string
      /** The attached files it holds, and those whose copies could not be read (D-037). Absent for a backup without files. */
      files?: { count: number; leftOut: number }
    }
  | { ok: false; error: string; cancelled?: true }

/** What a backup file holds, for the person to look at before anything is added (D-034). */
export interface RestorePreview {
  /** Given back to `restoreApply`; good for one use and for ten minutes. */
  token: string
  fileName: string
  /** Milliseconds since 1970, or null if the file does not say. */
  exportedAt: number | null
  /** False if the file stops short, is missing chats, or has lines after its end. */
  complete: boolean
  /** Chats that were not in the backup because their files could not be read when it was made; null if the file stops before it says. */
  leftOutAtExport: number | null
  /** New chats, ones already here (skipped), and ones that share an id with a different chat here (added as copies). */
  fresh: number
  same: number
  copies: number
  /** Chats that would be added (fresh and copies) and carry instructions of their own, which go out with each message of that chat (D-027). */
  withInstructions: number
  /**
   * The attached files the backup holds for its chats (D-037), how many of them are not in the app's folder yet (to be put back), and file lines that
   * cannot be used. Absent for a backup without files.
   */
  files?: { count: number; missing: number; refused: number }
  /** Chats in the file that cannot be used, and why (the first few). */
  refusedCount: number
  refused: { line: number; why: string }[]
  /** How many of the chats to add there is room for, given the limit on saved chats. */
  room: number
  /** The titles of the first chats that would be added. */
  titles: string[]
}

export type HistoryRestoreLookResult =
  { ok: true; preview: RestorePreview } | { ok: false; error: string; cancelled?: true }

export type HistoryRestoreApplyResult =
  | {
      ok: true
      /** Added as they were; added under a new id because the id was taken by a different chat; skipped because the same chat is already here. */
      added: number
      copies: number
      same: number
      /** Not added: unusable, no room, or the disk refused. */
      refused: number
      noRoom: number
      failed: number
      /** The attached files put back, already here, and not put back: no room, not written, or not usable (D-037). Absent for a backup without files. */
      files?: { added: number; already: number; noRoom: number; failed: number; refused: number }
    }
  | { ok: false; error: string }

/**
 * What came of "Attach..." (D-037): the files kept (each a copy in the app's data folder, checked by its bytes) and, for each file that was not, a sentence
 * naming it and saying why. `cancelled`: the person closed the system's dialog, which is not a failure and is not shown as one.
 */
export type AttachPickResult =
  | { ok: true; files: AttachedFile[]; refused: string[] }
  | { ok: false; error: string; cancelled?: true }

/** What came of a pasted or dropped file (D-037): kept (a copy, checked by its bytes), or a sentence that names it and says why not. */
export type AttachBytesResult = { ok: true; file: AttachedFile } | { ok: false; error: string }

/** The small picture or the first lines of a kept file, for a chat opened from History (D-037); or why its copy cannot be read. */
export type AttachmentPreview =
  | { id: string; thumbnail: string | null; firstLines: string | null }
  | { id: string; missing: string }

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
     * checks them again and keeps them; the page cannot take a choice back to "not chosen", and has no other way to change a limit. A choice
     * that lets the app spend more is saved only after the person says yes in the system's own message box, which the page cannot answer (D-039).
     */
    setLimits(choice: LimitsChoice): Promise<SetLimitsResult>
    /**
     * Chooses the amount above which the app asks before sending a large request (D-032), or "Never ask". Main checks it again and keeps it; the
     * page cannot send anything but those two, and this is not a limit: the spending limits still stop a request, whatever is chosen here. A
     * choice that asks less often is saved only after the person says yes in the system's own message box (D-039).
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
    /**
     * Backs up one chat or all of them to a file the person picks in the system's own save dialog (D-034). The page sends no path and learns
     * where the file went only afterwards. The file is read back and checked before this answers "ok".
     */
    exportChats(request: BackupRequest): Promise<HistoryExportResult>
    /**
     * Asks the person for a backup file in the system's own open dialog and reads it, adding NOTHING: the answer says what is in it. The page
     * sends no path.
     */
    restoreLook(): Promise<HistoryRestoreLookResult>
    /** Adds the chats of the file that `restoreLook` showed, with the token it gave. Never replaces a saved chat. */
    restoreApply(token: string): Promise<HistoryRestoreApplyResult>
    /** Drops what `restoreLook` read, so its token can no longer be used. */
    restoreCancel(token: string): void
    /** How the saved chats are kept now: plain or encrypted, and whether the encrypted ones can be opened (D-035). */
    storage(): Promise<ChatStorageStatus>
    /**
     * Encrypts the saved chats and, from now on, every chat that is saved (D-035). Main first asks the person, in the system's save dialog, where to put a
     * backup of the chats (a plain file), checks it, and only then changes anything. The page sends no path, and nothing is encrypted if the person closes the dialog.
     */
    encryptChats(): Promise<ChatStorageResult>
    /**
     * Goes back to plain files (D-035). Main asks the person in a system message box first, which the page cannot answer, because plain files protect less than
     * encrypted ones.
     */
    decryptChats(): Promise<ChatStorageResult>
  }
  attachments: {
    /**
     * Opens the system's own open dialog (main opens it, for the window that asked: the page never names a path) and keeps a checked copy of each
     * file the person chooses, at most `ATTACHMENT_LIMITS.perMessage` at a time (D-037).
     */
    pick(): Promise<AttachPickResult>
    /** A pasted or dropped file: its name (a label) and its bytes, never a path. Main checks it by its bytes and keeps a copy. */
    addBytes(name: string, bytes: Uint8Array): Promise<AttachBytesResult>
    /** The person took a file off the message before sending it: main stops keeping it for this message (a copy no chat uses is deleted). */
    discard(id: string): void
    /** The small pictures and first lines of kept files, by id (a chat opened from History): main reads its own copies. At most `perChat` ids. */
    describe(ids: string[]): Promise<AttachmentPreview[]>
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
  historyRemove: 'history:remove',
  historyExport: 'history:export',
  historyRestoreLook: 'history:restore-look',
  historyRestoreApply: 'history:restore-apply',
  historyRestoreCancel: 'history:restore-cancel',
  historyStorage: 'history:storage',
  historyEncrypt: 'history:encrypt',
  historyDecrypt: 'history:decrypt',
  attachmentsPick: 'attachments:pick',
  attachmentsAddBytes: 'attachments:add-bytes',
  attachmentsDiscard: 'attachments:discard',
  attachmentsDescribe: 'attachments:describe'
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
