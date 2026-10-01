import type { MessageToSave, SavedMessage } from '../../../shared/ipc'
import type { ChatMessage } from '../chat/types'

/**
 * What the page hands over to be saved. The page's own message ids stay here (they only exist to key the
 * list on screen), and a reply that is still arriving is sent as it is: main saves it as stopped, because
 * a reply that is cut off by closing the window never finishes. A reply says which model answered (D-021).
 */
export function toMessagesToSave(messages: ChatMessage[]): MessageToSave[] {
  return messages.map(({ role, content, status, error, provider, model }) => ({
    role,
    content,
    status,
    ...(status === 'error' && error !== undefined ? { error } : {}),
    ...(role === 'assistant' ? { provider: provider ?? null, model: model ?? null } : {})
  }))
}

/** A saved conversation back into messages the chat can show and continue, each with a fresh id. */
export function fromSavedMessages(messages: SavedMessage[]): ChatMessage[] {
  return messages.map(({ role, content, status, error, provider, model }) => ({
    id: crypto.randomUUID(),
    role,
    content,
    status,
    ...(error !== undefined ? { error } : {}),
    ...(role === 'assistant' ? { provider: provider ?? null, model: model ?? null } : {})
  }))
}
