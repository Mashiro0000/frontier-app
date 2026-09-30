import type { WireMessage } from '../../../shared/ipc'
import type { ChatMessage } from './types'

/**
 * Decides what the model is told about the conversation so far (the question D-008 left open).
 *
 * Everything the person saw is included, even a reply that was stopped or that failed halfway,
 * because they may refer to it ("continue", "that last part was wrong"). Only a message with no text
 * at all is left out: it says nothing, and the API refuses an empty message. If that leaves two of
 * the person's messages in a row, the main process joins them into one.
 */
export function toWireMessages(history: ChatMessage[]): WireMessage[] {
  return history
    .filter((message) => message.content !== '')
    .map((message) => ({ role: message.role, content: message.content }))
}
