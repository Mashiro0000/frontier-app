import type { WireMessage } from '../../../shared/ipc'
import type { ChatMessage } from './types'

/**
 * Decides what the model is told about the conversation so far (the question D-008 left open). A message of the person's that carries files is
 * told with them, even with no text (D-037).
 *
 * Everything the person saw is included, even a reply that was stopped or that failed halfway,
 * because they may refer to it ("continue", "that last part was wrong"). Only a message with no text
 * at all is left out: it says nothing, and the API refuses an empty message. If that leaves two of
 * the person's messages in a row, the main process joins them into one.
 *
 * A request for pictures (D-048, 16.5) is NEVER told: it is the person's note to themselves in this chat, and the pictures go to the model only when the person
 * attaches one ("Use in chat").
 */
export function toWireMessages(history: ChatMessage[]): WireMessage[] {
  return history
    .filter((message) => message.picture === undefined)
    .filter((message) => message.content !== '' || (message.files?.length ?? 0) > 0)
    .map((message) =>
      message.files !== undefined && message.files.length > 0
        ? {
            role: message.role,
            content: message.content,
            // The files go by the id of main's copy and their name (D-037); main reads the copies itself.
            attachments: message.files.map((file) => ({ id: file.info.id, name: file.info.name }))
          }
        : { role: message.role, content: message.content }
    )
}
