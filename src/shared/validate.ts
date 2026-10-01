// Checks that run on both sides: the page uses them to give quick feedback, and the main process runs
// them again, because it must never trust what the page sends. Plain functions, no Electron.

import {
  CHAT_LIMITS,
  HISTORY_LIMITS,
  type ChatRequest,
  type SavedMessage,
  type WireMessage
} from './ipc'

export const API_KEY_MIN_LENGTH = 20
export const API_KEY_MAX_LENGTH = 300

export type KeyCheck = { ok: true; key: string } | { ok: false; error: string }

/**
 * Checks the shape of an API key: visible characters only, no spaces or line breaks, a plausible
 * length. It cannot tell whether the provider will accept the key; only a real request shows that.
 */
export function checkApiKey(input: unknown): KeyCheck {
  if (typeof input !== 'string') return { ok: false, error: 'The key must be text.' }
  const key = input.trim()
  if (key === '') return { ok: false, error: 'Paste your API key first.' }
  if (key.length < API_KEY_MIN_LENGTH || key.length > API_KEY_MAX_LENGTH) {
    return {
      ok: false,
      error: `That does not look like an API key. It should be ${API_KEY_MIN_LENGTH} to ${API_KEY_MAX_LENGTH} characters long.`
    }
  }
  if (!/^[\x21-\x7e]+$/.test(key)) {
    return {
      ok: false,
      error:
        'That does not look like an API key. It must not contain spaces, line breaks or unusual characters.'
    }
  }
  return { ok: true, key }
}

export type ModelChoiceCheck = { ok: true; modelId: string } | { ok: false; error: string }

/**
 * Checks a model choice from the page: it must be exactly the id of a model on offer. The id handed
 * back is the registry's own string, never the page's, so nothing the page invents is saved or used.
 */
export function checkModelChoice(
  input: unknown,
  models: readonly { id: string }[]
): ModelChoiceCheck {
  if (typeof input !== 'string') return { ok: false, error: 'The model choice was not understood.' }
  const match = models.find((model) => model.id === input)
  if (!match) return { ok: false, error: 'That model is not available.' }
  return { ok: true, modelId: match.id }
}

const STREAM_ID = /^[A-Za-z0-9_-]{8,64}$/

export type ChatCheck =
  | { ok: true; request: ChatRequest }
  /** `streamId` is set when the id itself was fine, so the error can still be delivered to the page. */
  | { ok: false; error: string; streamId?: string }

/**
 * Checks a reply request from the page and returns a clean copy (only the fields we know about).
 * The conversation must start and end with a message from the person: models no longer accept a
 * reply that begins by continuing the assistant's own text.
 */
export function checkChatRequest(input: unknown): ChatCheck {
  if (typeof input !== 'object' || input === null) {
    return { ok: false, error: 'The request was not understood.' }
  }
  const { streamId, messages } = input as Record<string, unknown>
  if (typeof streamId !== 'string' || !STREAM_ID.test(streamId)) {
    return { ok: false, error: 'The request was not understood.' }
  }
  const refuse = (error: string): ChatCheck => ({ ok: false, error, streamId })

  if (!Array.isArray(messages) || messages.length === 0) return refuse('There is nothing to send.')
  if (messages.length > CHAT_LIMITS.maxMessages) {
    return refuse(
      `This conversation has more than ${CHAT_LIMITS.maxMessages} messages, which is too many to send.`
    )
  }
  const clean: WireMessage[] = []
  let totalChars = 0
  for (const item of messages) {
    if (typeof item !== 'object' || item === null) return refuse('The request was not understood.')
    const { role, content } = item as Record<string, unknown>
    if (
      (role !== 'user' && role !== 'assistant') ||
      typeof content !== 'string' ||
      content === ''
    ) {
      return refuse('The request was not understood.')
    }
    if (content.length > CHAT_LIMITS.maxMessageChars)
      return refuse('A message is too long to send.')
    totalChars += content.length
    clean.push({ role, content })
  }
  if (totalChars > CHAT_LIMITS.maxTotalChars) {
    return refuse(
      'This conversation is too long to send: the whole conversation is sent again with every message. Start a new chat.'
    )
  }
  if (clean[0].role !== 'user' || clean[clean.length - 1].role !== 'user') {
    return refuse('The request was not understood.')
  }
  return { ok: true, request: { streamId, messages: clean } }
}

// A conversation's id becomes part of a file name, so it is checked against the one spelling the app itself
// makes (crypto.randomUUID(): lower-case hexadecimal groups). Upper case is refused because Windows treats
// upper and lower case as one file: two spellings of one id would be one conversation.
const CONVERSATION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export function isConversationId(value: unknown): value is string {
  return typeof value === 'string' && CONVERSATION_ID.test(value)
}

export type ConversationIdCheck = { ok: true; id: string } | { ok: false; error: string }

/** Checks an id from the page, for loading or deleting a saved conversation. */
export function checkConversationId(input: unknown): ConversationIdCheck {
  return isConversationId(input)
    ? { ok: true, id: input }
    : { ok: false, error: 'The conversation was not understood.' }
}

export type MessagesCheck = { ok: true; messages: SavedMessage[] } | { ok: false; error: string }

/**
 * Checks the messages of a conversation to be saved, whether they come from the page or are read back from a
 * file, and returns a clean copy (only the fields we know about). A message that is still "streaming" is
 * kept as "stopped": a reply that is cut off by closing the window never finishes. The first message must
 * be the person's, as it is in every conversation the app makes.
 */
export function checkSavedMessages(input: unknown): MessagesCheck {
  const refuse = (error: string): MessagesCheck => ({ ok: false, error })
  if (!Array.isArray(input) || input.length === 0) return refuse('There is nothing to save.')
  // The count is looked at before the items, so a huge list costs nothing to refuse.
  if (input.length > HISTORY_LIMITS.maxMessages) {
    return refuse(
      `This conversation has more than ${HISTORY_LIMITS.maxMessages} messages, which is too many to save.`
    )
  }
  const messages: SavedMessage[] = []
  let totalChars = 0
  for (const item of input) {
    if (typeof item !== 'object' || item === null)
      return refuse('The conversation was not understood.')
    const { role, content, status, error } = item as Record<string, unknown>
    if (
      (role !== 'user' && role !== 'assistant') ||
      typeof content !== 'string' ||
      (status !== 'done' && status !== 'stopped' && status !== 'error' && status !== 'streaming') ||
      (role === 'user' && content.trim() === '')
    ) {
      return refuse('The conversation was not understood.')
    }
    if (content.length > HISTORY_LIMITS.maxMessageChars)
      return refuse('A message is too long to save.')
    totalChars += content.length
    if (totalChars > HISTORY_LIMITS.maxTotalChars)
      return refuse('This conversation is too long to save.')
    const message: SavedMessage = {
      role,
      content,
      status: status === 'streaming' ? 'stopped' : status
    }
    if (status === 'error' && error !== undefined) {
      if (typeof error !== 'string' || error.length > HISTORY_LIMITS.maxErrorChars) {
        return refuse('The conversation was not understood.')
      }
      message.error = error
    }
    messages.push(message)
  }
  if (messages[0].role !== 'user') return refuse('The conversation was not understood.')
  return { ok: true, messages }
}

export type SaveCheck =
  | { ok: true; conversation: { id: string; messages: SavedMessage[] } }
  | { ok: false; error: string }

/**
 * Checks a conversation the page wants saved. Only the id and the messages are taken: the title and the
 * dates are worked out by the main process, never by the page.
 */
export function checkConversationSave(input: unknown): SaveCheck {
  if (typeof input !== 'object' || input === null) {
    return { ok: false, error: 'The conversation was not understood.' }
  }
  const { id, messages } = input as Record<string, unknown>
  if (!isConversationId(id)) return { ok: false, error: 'The conversation was not understood.' }
  const checked = checkSavedMessages(messages)
  if (!checked.ok) return checked
  return { ok: true, conversation: { id, messages: checked.messages } }
}
