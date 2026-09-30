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
}

/**
 * Where assistant replies come from. Given the conversation so far (it ends with the message the
 * user just sent), it returns the reply as a stream of text pieces. It should stop producing text
 * when `signal` is aborted. `ipcReply` is the implementation: it asks the main process for a real reply.
 */
export type ReplyFn = (history: ChatMessage[], signal: AbortSignal) => AsyncIterable<string>
