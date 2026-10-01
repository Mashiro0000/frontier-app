import type { ProviderId } from '../../../shared/registry'

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
 * before any text still says which model was asked).
 */
export type ReplyFn = (
  history: ChatMessage[],
  signal: AbortSignal,
  onAnswerer: (answerer: Answerer) => void
) => AsyncIterable<string>
