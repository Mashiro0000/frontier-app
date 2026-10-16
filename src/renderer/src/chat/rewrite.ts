import type { ChatMessage } from './types'

// What the conversation becomes when the person asks again (D-026): a reply is asked for once more, or one of their own messages is
// changed and everything after it is replaced. Plain functions with no React, so they can be checked on their own. None of them
// changes what it is given: they return the conversation to send, and the chat puts a fresh reply after it.

/**
 * The conversation to send again to replace the last reply: everything up to and including the person's last message. Null when
 * there is nothing to replace, that is, when the conversation does not end with a reply that has stopped arriving.
 */
export function withoutLastReply(messages: readonly ChatMessage[]): ChatMessage[] | null {
  const last = messages.at(-1)
  if (!last || last.role !== 'assistant' || last.status === 'streaming') return null
  const rest = messages.slice(0, -1)
  return rest.at(-1)?.role === 'user' ? [...rest] : null
}

/**
 * How many messages come after the one with this id (an edit would replace them), or null if there is no such message of the
 * person's. The reply right after the message is one of them: a count of 1 is "the last exchange", more is more than that.
 */
export function laterMessages(messages: readonly ChatMessage[], id: string): number | null {
  const at = messages.findIndex((message) => message.id === id)
  if (at === -1 || messages[at].role !== 'user' || messages[at].picture !== undefined) return null
  return messages.length - 1 - at
}

/**
 * The conversation to send for an edited message: everything before it, then the message with its new text. Everything after it
 * is dropped. Null when there is no such message of the person's, when a reply is still arriving, or when the new text is empty.
 */
export function withEditedMessage(
  messages: readonly ChatMessage[],
  id: string,
  text: string
): ChatMessage[] | null {
  if (typeof text !== 'string') return null
  const at = messages.findIndex((message) => message.id === id)
  const edited = text.trim()
  // A request for pictures (D-048) is not a message to the model, so it cannot be edited and sent.
  if (
    at === -1 ||
    messages[at].role !== 'user' ||
    messages[at].picture !== undefined ||
    edited === ''
  )
    return null
  if (messages.at(-1)?.status === 'streaming') return null
  return [...messages.slice(0, at), { ...messages[at], content: edited }]
}
