// The contract between the page (renderer), the preload and the main process. Everything that can
// cross that boundary is described here, so all three sides agree. Types, channel names and limits
// only: this file is bundled into the preload, which runs sandboxed (see D-004).

import type { AskFirstChoice, AskFirstSetting, RequestEstimate } from './askFirst'
import type { AttachedFile, AttachmentInfo } from './attachments'
import type { AuditDeleteResult, AuditExportResult, AuditView } from './audit'
import type { ReplyToolNote } from './toolNotes'
import type { Limits, LimitsChoice } from './limits'
import type { MemoryChangeResult, MemoryExportResult, MemoryStatus } from './memory'
import type { ProgramsChangeResult, ProgramsStatus } from './programs'
import type { ConnectorChangeResult, ConnectorsStatus } from './connectors'
import type { ProjectChangeResult, ProjectsStatus } from './projects'
import type { Suggestion, TaskOption } from './rankings'
import type { Effort, ModelPricing, ProviderId } from './registry'
import type { ToolCaps, ToolChangeResult, ToolEvent, ToolsStatus } from './tools'
import type { AppliedChange, ChangeActionResult, ChangeSummary } from './changes'
import type { WorkspaceChangeResult, WorkspaceStatus } from './workspace'
import type { ReplyUsage, UsageSummary } from './usage'
import {
  VOICE_CHANNELS,
  type VoiceBeginResult,
  type VoiceChangeResult,
  type VoiceEndResult,
  type VoiceStatus
} from './voice'
import {
  IMAGE_CHANNELS,
  type ImageChangeResult,
  type ImageEstimate,
  type ImageGenerateResult,
  type ImageQuality,
  type ImageShape,
  type ImageStatus,
  type PictureNote,
  type PictureResult,
  type PictureSummary
} from './images'

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

/** A part of a text that looks like a key, a token or a password (D-039), as the page is shown it: what it looks like, and the part masked. */
export interface SecretFinding {
  /** For "... looks like <what>": "an Anthropic API key", "a password". */
  what: string
  /** The part, masked: its first four and last two characters and its length ("sk-a…7Q (51 characters)"). */
  shown: string
}

/** The person's instructions for every chat (D-039), as main has them. */
export interface EveryChatStatus {
  /** The text ('' for none). */
  text: string
  /** Why the file that holds them cannot be read, or null when it can. While it cannot, main sends no request at all. */
  problem: string | null
}

/**
 * `cancelled`: the person said no in the system's own message box (or closed it); nothing was saved, and it is not shown as a failure. `warnings`: parts
 * that look like a key or a password; nothing was saved, and the page may send the same text again with "Save anyway".
 */
export type SaveEveryChatResult =
  | { ok: true; status: EveryChatStatus }
  | { ok: false; error: string; cancelled?: true; warnings?: SecretFinding[] }

/** What main found in a chat's own instructions before the page keeps them (D-039). Nothing is saved by this. */
export type CheckChatInstructionsResult =
  { ok: true } | { ok: false; error: string; warnings?: SecretFinding[] }

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
  /**
   * The project the chat belongs to (D-039, 10.6): main reads that project from its own file and adds its instructions, notes and files to the
   * request. A project that is not there is none. Absent for a chat in no project, which is sent exactly as before.
   */
  projectId?: string
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
      /** (12.7) True when this is asked in the middle of a reply, after files were read: the reply is not finished and what it read goes with the next request. */
      later?: true
    }
  | { streamId: string; type: 'text'; text: string }
  /**
   * (11.3, D-041) Something happened to a tool call of this reply: the very events the audit log keeps, in order, sent after they were kept. The window
   * shows the tool activity from them (11.4).
   */
  | { streamId: string; type: 'tool'; event: ToolEvent }
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
  /** The tool calls of a reply (D-041, 11.4): what was asked, what the person answered, the sources that came back. Only in a file of version 6; absent when there are none. */
  tools?: ReplyToolNote[]
  /** (16.5, D-048) A request for pictures made from this chat: on a message of the person's whose text is the description. Only in a file of version 7. Never sent to the model. */
  picture?: PictureNote
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
  /** The tool calls of a reply (11.4). Checked again by main, field by field; the file is then version 6. */
  tools?: ReplyToolNote[]
  /** (16.5) A request for pictures made from this chat. Checked again by main, field by field; the file is then version 7. */
  picture?: PictureNote
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
  /** The project the chat belongs to (D-039): a project's id, or absent for none. Main checks the project exists; the file is then version 5. */
  project?: string
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
  /** The project the chat belongs to (D-039, file version 5): absent for none. */
  project?: string
}

/** One line in the list of saved conversations. */
export interface ConversationSummary {
  id: string
  title: string
  updatedAt: number
  messageCount: number
  /** The project the chat belongs to (D-039): absent for none. It may name a project that has since been deleted (then it is in none). */
  project?: string
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
  /** The person's instructions for every chat and their notes (D-039), rewritten in the same form too; absent when there are none. */
  documents?: { changed: number; failed: number }
  /** The gallery's pictures (D-048), rewritten in the same form too; absent when there are none. */
  pictures?: { changed: number; failed: number }
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
      /** The projects and the notes it holds (10.7, D-039): a backup of every chat, when there are any. */
      kept?: { projects: number; notes: number }
      /** Why the projects or the notes are not in it (their file could not be read), in a sentence; absent when nothing was left out. */
      keptLeftOut?: string
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
  /**
   * The projects and the notes the backup holds (10.7, D-039; version 3): to be added (after a yes in the system's own box), already here, added as
   * copies (their id is taken by a different project), and not to be added (past a cap, a saved API key inside, or unusable in the file). `problem`:
   * why none can be added (the projects or notes here cannot be read). Absent for a backup without them.
   */
  kept?: {
    projects: { add: number; same: number; copies: number; notAdded: number; names: string[] }
    notes: { add: number; same: number; notAdded: number }
    problem: string | null
  }
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
      /**
       * The projects and notes (10.7, D-039): added, already here, not added. `declined`: the person did not say yes in the system's box (only the chats
       * were added); `problem`: why none was added otherwise. Absent for a backup without them.
       */
      kept?: {
        projects: number
        notes: number
        same: number
        notAdded: number
        declined: boolean
        problem: string | null
      }
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
  instructions: {
    /** The person's instructions for every chat, as main has them (D-039). Main adds them to every request itself; the page only shows them. */
    getEveryChat(): Promise<EveryChatStatus>
    /**
     * Saves the instructions for every chat ('' turns them off). Main checks them again and looks for secrets (a saved API key is refused; text that
     * looks like a key or a password needs `saveAnyway`), and saves new or changed text only after the person's yes in the system's own message box,
     * which the page cannot answer. Turning them off asks nothing.
     */
    setEveryChat(text: string, saveAnyway?: boolean): Promise<SaveEveryChatResult>
    /** The same look for secrets for a chat's own instructions (D-027), before the page keeps them. Saves nothing and asks nothing. */
    checkForChat(text: string, saveAnyway?: boolean): Promise<CheckChatInstructionsResult>
  }
  /**
   * The person's notes (D-039): main keeps them in memory.json and sends them itself with every request (every chat's; a project's with its chats). A
   * new or changed note is kept only after the person's yes in the system's own message box, which the page cannot answer; a saved API key is refused,
   * and text that looks like one needs `saveAnyway`. Deleting and turning memory off ask nothing there (the page asks first).
   */
  memory: {
    status(): Promise<MemoryStatus>
    /** A new note for every chat (`scope` "all") or for a project's chats (its id). */
    add(text: string, scope: string, saveAnyway?: boolean): Promise<MemoryChangeResult>
    edit(id: string, text: string, saveAnyway?: boolean): Promise<MemoryChangeResult>
    remove(id: string): Promise<MemoryChangeResult>
    removeAll(): Promise<MemoryChangeResult>
    /** Memory on or off for every chat; on asks in the system's box when there are notes. */
    setOn(on: boolean): Promise<MemoryChangeResult>
    /** Every note to one plain text file the person places in the system's save dialog (main opens it; the page sends no path). */
    exportAll(): Promise<MemoryExportResult>
  }
  /**
   * The person's projects (D-039): a name, instructions and files for a group of chats, kept by main in projects.json. New instructions and added files
   * are kept only after the person's yes in the system's own message box (the files come through the system's open dialog: the page sends no path);
   * making, renaming, taking a file off and deleting ask nothing there. A project's name is never sent to the model.
   */
  /**
   * The audit log of tool calls (Stage 11, D-041): what the model asked tools to do, what the person answered and how each call ended, kept by main in
   * audit/log.jsonl. The page can read it, export it and ask for it to be deleted, and nothing else: it cannot add a line, change one or take one out. The
   * export goes where the person places it in the system's save dialog; deleting it is asked about in the system's own message box, which the page cannot answer.
   */
  audit: {
    read(): Promise<AuditView>
    exportAll(): Promise<AuditExportResult>
    deleteAll(): Promise<AuditDeleteResult>
  }
  /**
   * The tools (Stage 11.4, D-041): which are switched on and the caps on one reply, kept by main in tools.json. The page can read them and ask for a change;
   * a change that lets the app do more (a tool on, a higher cap) is made only after the person's yes in the system's own message box, which the page cannot
   * answer, and a change that does less (a tool off, lower caps) is made at once. The page has no way to run a tool, to approve a call or to answer a question.
   */
  tools: {
    status(): Promise<ToolsStatus>
    setEnabled(tool: string, on: boolean): Promise<ToolChangeResult>
    setCaps(caps: ToolCaps): Promise<ToolChangeResult>
    /** When the settings file could not be read: start again with every tool off and the caps at their defaults (the file is kept as a copy beside it). */
    reset(): Promise<ToolChangeResult>
  }
  /**
   * The code workspace (Stage 12.3, D-042): the one folder the model may list and read files in, kept by main in workspace.json. The page can read the
   * status and ask for a change; it never supplies a path (main opens the system's folder dialog itself and judges the answer). Choosing a folder and
   * switching the tools on ask in the system's own message box, which the page cannot answer; clearing the folder and switching off do not. The page has no
   * way to read a file, list a folder, approve a call or answer a question.
   */
  workspace: {
    status(): Promise<WorkspaceStatus>
    choose(): Promise<WorkspaceChangeResult>
    clear(): Promise<WorkspaceChangeResult>
    setOn(on: boolean): Promise<WorkspaceChangeResult>
  }
  /**
   * Running programs (Stage 13.5, D-043): the switch that lets the model ask to run ONE program on a copy of a folder of the workspace, in a locked box (an
   * AppContainer with no network, inside a job object with limits). The page can read the status (with the last self-test) and ask for the switch to be changed.
   * Switching ON makes the self-test of the box first, on this PC, and then asks in the system's own message box, which the page cannot answer; a failed test keeps
   * it off and there is no way to run a program without the box. Switching OFF does neither. The page never supplies a program, a path or an argument, cannot
   * approve a run and cannot see what a program printed.
   */
  programs: {
    status(): Promise<ProgramsStatus>
    setOn(on: boolean): Promise<ProgramsChangeResult>
    /** Ends a self-test that is going on (the switch stays off). Does nothing when none is. */
    stopTest(): Promise<void>
  }
  /**
   * Connectors (Stage 14, D-045): tools that other programs offer through MCP. The page can read the list and ASK: to add one (a program the person chooses in the
   * system's own file dialog, which main opens, or a web address), to remove one, to start one and list its tools, to stop one, to switch one of its tools on or off,
   * to give or take back a grant, and to let it run "as you". Every change that lets the app do more is asked about in the system's own message box, which the page
   * cannot answer. The page never supplies a program path, never sees a token again, cannot start a call and cannot approve one.
   */
  connectors: {
    status(): Promise<ConnectorsStatus>
    addLocal(name: string, args: string[]): Promise<ConnectorChangeResult>
    addRemote(name: string, url: string, token: string): Promise<ConnectorChangeResult>
    remove(id: string): Promise<ConnectorChangeResult>
    refresh(id: string): Promise<ConnectorChangeResult>
    stop(id: string): Promise<ConnectorChangeResult>
    setTool(id: string, name: string, on: boolean): Promise<ConnectorChangeResult>
    setGrant(
      id: string,
      grant: 'network' | 'workspace',
      on: boolean
    ): Promise<ConnectorChangeResult>
    /** `typed`: the connector's name as the person typed it, to confirm "as you". */
    setPlace(id: string, place: 'box' | 'as-you', typed: string): Promise<ConnectorChangeResult>
    /**
     * Sign in to a web connector (Stage 14b, D-046). Main finds the provider, asks in the system's own box, opens the person's browser and waits for them to finish there
     * (the call returns when they have, or when it fails or is cancelled). `clientId` and `clientSecret` are '' unless the person registered the app at the provider by hand;
     * the secret goes in and never comes back. The page never sees a token, an address of the provider or a password.
     */
    signIn(id: string, clientId: string, clientSecret: string): Promise<ConnectorChangeResult>
    /** Ends the sign-in that is open in the browser, if any. */
    cancelSignIn(): Promise<ConnectorChangeResult>
    /** Signs out: the provider is asked to revoke the token, and the app forgets it. */
    signOut(id: string): Promise<ConnectorChangeResult>
  }
  /**
   * The changes the model has proposed and the person has not decided on (Stage 12.5, D-042): a summary of each (the path, the counts, the warnings: never a line
   * of the change) and a way to ask main to open the Review window for one. The Review window is a window of its own that main opens and this page cannot
   * script; applying and dropping a change are done there, never here. The page has no way to see a change's text, to apply it or to answer a question.
   */
  changes: {
    list(): Promise<ChangeSummary[]>
    review(id: string): Promise<ChangeActionResult>
    /** The changes that were applied (the newest 50), each with whether it can be undone now. */
    applied(): Promise<AppliedChange[]>
    /** Asks main to undo one: main asks in the system's own box and puts the original back only if the file is still exactly what the change wrote. */
    undo(id: string): Promise<ChangeActionResult>
    /** Asks main to delete the undo history (main asks in the system's box; the files are not touched). */
    clearHistory(): Promise<ChangeActionResult>
  }
  /**
   * Voice (Stage 15, D-047). "Speak to type": the person HOLDS a button, the window records the microphone while it is held, main sends the clip to OpenAI's speech to text
   * and the words come back as text for the message box. The page can read the status and ask: it cannot open the microphone by itself (the permission is main's, given
   * only between `begin` and `end` and for no longer than a minute), cannot name a model, a price or a key, and cannot answer the question that switching on asks in the
   * system's own message box. "Read aloud" is the window's own speech (the voices of this PC): nothing leaves the computer, so its switch asks nothing; this only keeps
   * the choice. Nothing of a recording or of the words is kept by the app.
   */
  voice: {
    status(): Promise<VoiceStatus>
    setListen(on: boolean): Promise<VoiceChangeResult>
    setSpeak(on: boolean): Promise<VoiceChangeResult>
    /** `voice`: the name as the window lists the voices of this PC, or null for the system's own choice. `rate`: percent, 50 to 200. */
    setVoice(voice: string | null, rate: number): Promise<VoiceChangeResult>
    /** When voice.json could not be read: both switches off, the file kept as a copy beside it. */
    reset(): Promise<VoiceChangeResult>
    /** The button was pressed: asks main to open the microphone for one hold. */
    begin(): Promise<VoiceBeginResult>
    /** The button was released: the clip (WebM) and how long the hold lasted by the window's clock. Resolves with the words. */
    end(bytes: Uint8Array, ms: number): Promise<VoiceEndResult>
    /** Gives up: the hold, or the clip on its way. Sends nothing. */
    cancel(): Promise<void>
  }
  /**
   * Pictures (Stage 16, D-048). The person writes a description in the "Make an image" dialog; main checks it, works out the most it can cost from registry/images.json,
   * reserves that against the limits, asks in the system's own box when it is above $0.50, sends ONE request to OpenAI and keeps the checked pictures in the gallery. The
   * page cannot name a size (only one of the three shapes), an address, a key or a price, cannot answer a question, and cannot pick a path (the system's save dialog does).
   * Pictures come back as `data:` (the page's policy is not widened). The model has no way to start one.
   */
  images: {
    status(): Promise<ImageStatus>
    /** ON asks in the system's box; OFF does not, and stops a request on its way. */
    setOn(on: boolean): Promise<ImageChangeResult>
    /** When image-settings.json could not be read: off, the file kept as a copy beside it. */
    reset(): Promise<ImageChangeResult>
    /** The most a request would cost, as main works it out, and whether it would be refused or asked about. */
    estimate(choice: {
      model: string
      shape: ImageShape
      quality: ImageQuality
      count: number
      /** The description's length in UTF-8 bytes (its words in are part of the most). */
      promptBytes: number
    }): Promise<ImageEstimate>
    /** Makes the pictures. Resolves when they are kept, or with why not. */
    generate(ask: {
      prompt: string
      model: string
      shape: ImageShape
      quality: ImageQuality
      count: number
      chat: string | null
    }): Promise<ImageGenerateResult>
    /** Stops the request on its way (it may still be billed). */
    stop(): Promise<void>
    /** The gallery, newest first, with small pictures. */
    list(): Promise<{ pictures: PictureSummary[]; problem: string | null }>
    /** One picture, large, as data:. */
    picture(id: string): Promise<PictureResult>
    /** A plain copy of a picture wherever the person chooses in the system's save dialog. */
    saveCopy(id: string): Promise<{ ok: true } | { ok: false; error: string; cancelled?: true }>
    /** Deletes the app's own copy (main asks in the system's box first). */
    remove(id: string): Promise<{ ok: true } | { ok: false; error: string; cancelled?: true }>
    /** Hands a picture to the attachments of the next message, as a pasted file. */
    useInChat(id: string): Promise<AttachBytesResult>
  }
  projects: {
    status(): Promise<ProjectsStatus>
    create(name: string): Promise<ProjectChangeResult>
    rename(id: string, name: string): Promise<ProjectChangeResult>
    setInstructions(id: string, text: string, saveAnyway?: boolean): Promise<ProjectChangeResult>
    addFiles(id: string): Promise<ProjectChangeResult>
    removeFile(id: string, fileId: string): Promise<ProjectChangeResult>
    remove(id: string): Promise<ProjectChangeResult>
    /** The way out when projects.json cannot be read: every project deleted, the damaged file kept as a copy. */
    removeAll(): Promise<ProjectChangeResult>
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
  attachmentsDescribe: 'attachments:describe',
  instructionsGetEveryChat: 'instructions:get-every-chat',
  instructionsSetEveryChat: 'instructions:set-every-chat',
  instructionsCheckForChat: 'instructions:check-for-chat',
  memoryStatus: 'memory:status',
  memoryAdd: 'memory:add',
  memoryEdit: 'memory:edit',
  memoryRemove: 'memory:remove',
  memoryRemoveAll: 'memory:remove-all',
  memorySetOn: 'memory:set-on',
  memoryExport: 'memory:export',
  projectsStatus: 'projects:status',
  projectsCreate: 'projects:create',
  projectsRename: 'projects:rename',
  projectsSetInstructions: 'projects:set-instructions',
  projectsAddFiles: 'projects:add-files',
  projectsRemoveFile: 'projects:remove-file',
  projectsRemove: 'projects:remove',
  projectsRemoveAll: 'projects:remove-all',
  auditRead: 'audit:read',
  auditExport: 'audit:export',
  auditDeleteAll: 'audit:delete-all',
  toolsStatus: 'tools:status',
  toolsSetEnabled: 'tools:set-enabled',
  toolsSetCaps: 'tools:set-caps',
  toolsReset: 'tools:reset',
  workspaceStatus: 'workspace:status',
  workspaceChoose: 'workspace:choose',
  workspaceClear: 'workspace:clear',
  workspaceSetOn: 'workspace:set-on',
  programsStatus: 'programs:status',
  programsSetOn: 'programs:set-on',
  programsStopTest: 'programs:stop-test',
  connectorsStatus: 'connectors:status',
  connectorsAddLocal: 'connectors:add-local',
  connectorsAddRemote: 'connectors:add-remote',
  connectorsRemove: 'connectors:remove',
  connectorsRefresh: 'connectors:refresh',
  connectorsStop: 'connectors:stop',
  connectorsSetTool: 'connectors:set-tool',
  connectorsSetGrant: 'connectors:set-grant',
  connectorsSetPlace: 'connectors:set-place',
  connectorsSignIn: 'connectors:sign-in',
  connectorsCancelSignIn: 'connectors:cancel-sign-in',
  connectorsSignOut: 'connectors:sign-out',
  changesList: 'changes:list',
  changesReview: 'changes:review',
  changesApplied: 'changes:applied',
  changesUndo: 'changes:undo',
  changesClearUndo: 'changes:clear-undo',
  voiceStatus: VOICE_CHANNELS.status,
  voiceSetListen: VOICE_CHANNELS.setListen,
  voiceSetSpeak: VOICE_CHANNELS.setSpeak,
  voiceSetVoice: VOICE_CHANNELS.setVoice,
  voiceReset: VOICE_CHANNELS.reset,
  voiceBegin: VOICE_CHANNELS.begin,
  voiceEnd: VOICE_CHANNELS.end,
  voiceCancel: VOICE_CHANNELS.cancel,
  imagesStatus: IMAGE_CHANNELS.status,
  imagesSetOn: IMAGE_CHANNELS.setOn,
  imagesReset: IMAGE_CHANNELS.reset,
  imagesEstimate: IMAGE_CHANNELS.estimate,
  imagesGenerate: IMAGE_CHANNELS.generate,
  imagesStop: IMAGE_CHANNELS.stop,
  imagesList: IMAGE_CHANNELS.list,
  imagesPicture: IMAGE_CHANNELS.picture,
  imagesSaveCopy: IMAGE_CHANNELS.saveCopy,
  imagesRemove: IMAGE_CHANNELS.remove,
  imagesUseInChat: IMAGE_CHANNELS.useInChat
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
