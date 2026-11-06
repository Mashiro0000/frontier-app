import type { RequestEstimate } from '../../../shared/askFirst'
import type { AttachedFile } from '../../../shared/attachments'
import type { PictureNote } from '../../../shared/images'
import type { ProviderId } from '../../../shared/registry'
import type { ToolEvent } from '../../../shared/tools'
import type { ReplyToolNote } from '../../../shared/toolNotes'
import type { ReplyUsage } from '../../../shared/usage'

export type ChatRole = 'user' | 'assistant'

// 'streaming' - the reply is still arriving
// 'done'      - finished normally
// 'stopped'   - the user pressed Stop; whatever arrived is kept
// 'error'     - the reply failed
export type MessageStatus = 'streaming' | 'done' | 'stopped' | 'error'

export interface ChatMessage {
  id: string
  role: ChatRole
  content: string
  status: MessageStatus
  /** Why the reply failed. Only set when status is 'error'. */
  error?: string
  /**
   * Who answered, for a reply (D-021): the provider and the model's id, as the main process named them when the
   * reply began. Null where it is not known: a reply saved before the app recorded it knows its provider (there was
   * only one) but not its model. Absent on the person's own messages.
   */
  provider?: ProviderId | null
  model?: string | null
  /**
   * What the reply used and cost (D-030), as main reported it when the reply ended. Kept on the screen only: it is not saved with the
   * message (the ledger in the main process is the record), so a chat opened from history shows none, and a stopped reply none either
   * (its guess is in the ledger and in the sums of Settings).
   */
  usage?: ReplyUsage
  /**
   * The files on a message of the person's (D-037): what main said about each when it was attached (and, for one just sent, its small picture). Saved with
   * the message as their descriptions; the copies are main's. Absent when there are none.
   */
  files?: AttachedFile[]
  /**
   * The tool calls of a reply (D-041, 11.4): what the model asked for, what the person answered and how each call ended, each standing at the place in the
   * reply's text where it happened. Built from the events main sends as they arrive (the same function the audit log is read with), and saved with the chat.
   * Absent when the reply used no tool.
   */
  tools?: ReplyToolNote[]
  /**
   * (16.5, D-048) A request for pictures made from this chat: on a message of the person's whose text is the description. The pictures are in the gallery (main's);
   * this holds their ids. Saved with the chat, NEVER sent to the model.
   */
  picture?: PictureNote
  /** (21.3, D-053) Why Auto picked the model of this reply, shown above it. On screen only: not saved (the model is, as for any reply). */
  autoReason?: string
}

/** (21.3, D-053) What one reply asks of main besides the conversation: the model Auto picked for it. */
export interface ReplyOptions {
  modelId?: string
  /** (21.4) A rewrite of the draft (Enhance), not a reply in the chat. */
  purpose?: 'enhance'
}

/** Which model is answering, as the main process reports it when a reply begins. */
export interface Answerer {
  provider: ProviderId
  model: string
}

/**
 * A large request that the main process is holding until the person says yes (D-032): which model would answer, what the request could cost
 * at the most (the main process's own figures, shown as they are) and the amount above which the app asks.
 */
export interface LargeRequest {
  model: string
  estimate: RequestEstimate
  askAboveUsd: number
  /** (12.7) Asked in the middle of a reply, after files were read (not before the first request). */
  later?: boolean
}

/**
 * Where assistant replies come from. Given the conversation so far (it ends with the message the
 * user just sent), it returns the reply as a stream of text pieces. It should stop producing text
 * when `signal` is aborted. `ipcReply` is the implementation: it asks the main process for a real reply.
 * `onAnswerer` is called once, before the first piece, with the model that is answering (a reply that fails
 * before any text still says which model was asked). `instructions` is the person's own text for this chat
 * ('' for none, D-027): it goes with the conversation and is added to the app's rules by the main process.
 */
export type ReplyFn = (
  history: ChatMessage[],
  signal: AbortSignal,
  onAnswerer: (answerer: Answerer) => void,
  instructions: string,
  /** The id the chat is saved under, so the cost can be shown under that chat (D-030); null if there is none. */
  conversationId: string | null,
  /** Called once, just before the reply ends, with what it used and cost, when something is owed. */
  onUsage: (usage: ReplyUsage) => void,
  /**
   * Called when the main process is holding a large request for the person's yes (D-032): it puts the question in front of them and answers
   * true for yes, false for no (and false if the reply is stopped meanwhile). Nothing is sent until it says yes.
   */
  onLargeRequest: (request: LargeRequest) => Promise<boolean>,
  /** The project the chat belongs to (D-039, 10.6), or null: main adds that project's instructions, notes and files itself. */
  projectId?: string | null,
  /** Called for every event of a tool call of this reply (D-041, 11.4), in order, as main reports them. */
  onTool?: (event: ToolEvent) => void,
  /** (21.3, D-053) The model Auto picked for this reply. */
  options?: ReplyOptions
) => AsyncIterable<string>
