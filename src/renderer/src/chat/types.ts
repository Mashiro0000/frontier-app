import type { ProviderId } from '../../../shared/registry'
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
}

/** Which model is answering, as the main process reports it when a reply begins. */
export interface Answerer {
  provider: ProviderId
  model: string
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
  onUsage: (usage: ReplyUsage) => void
) => AsyncIterable<string>
