// Checks that run on both sides: the page uses them to give quick feedback, and the main process runs
// them again, because it must never trust what the page sends. Plain functions, no Electron.

import {
  CHAT_LIMITS,
  HISTORY_LIMITS,
  type ChatRequest,
  type SavedMessage,
  type WireMessage
} from './ipc'
import { SUPPORTED_PROVIDERS, type Effort, type ProviderId } from './registry'

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

export type ProviderCheck = { ok: true; provider: ProviderId } | { ok: false; error: string }

/**
 * Checks a provider named by the page: it must be exactly one the app can call. The id handed back is the app's own
 * string, never the page's, so nothing the page invents (an object that prints as a provider, a path) is used. A provider
 * becomes part of a key file's name (D-020), which is why this is checked here and again where the file is named.
 */
export function checkProvider(input: unknown): ProviderCheck {
  const match = SUPPORTED_PROVIDERS.find((provider) => provider === input)
  return match
    ? { ok: true, provider: match }
    : { ok: false, error: 'That provider is not available.' }
}

export type KeySubmissionCheck =
  { ok: true; provider: ProviderId; key: string } | { ok: false; error: string }

/** Checks "save this key for this provider" from the page: a known provider, and a key that has the shape of one. */
export function checkKeySubmission(input: unknown): KeySubmissionCheck {
  if (typeof input !== 'object' || input === null) {
    return { ok: false, error: 'The key was not understood.' }
  }
  const { provider, key } = input as Record<string, unknown>
  const checkedProvider = checkProvider(provider)
  if (!checkedProvider.ok) return checkedProvider
  const checkedKey = checkApiKey(key)
  if (!checkedKey.ok) return checkedKey
  return { ok: true, provider: checkedProvider.provider, key: checkedKey.key }
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

export type EffortChoiceCheck =
  { ok: true; modelId: string; level: Effort } | { ok: false; error: string }

/**
 * Checks an effort choice from the page (D-024): the id of a model on offer, and a level that model's own entry lists. Both must
 * match exactly (no other letter case, no padding), and the strings handed back are the registry's, never the page's, so nothing
 * the page invents is saved or used. A level another model takes, and this one does not, is refused.
 */
export function checkEffortChoice(
  input: unknown,
  models: readonly { id: string; capabilities: { effortLevels: readonly Effort[] } }[]
): EffortChoiceCheck {
  if (typeof input !== 'object' || input === null) {
    return { ok: false, error: 'The effort choice was not understood.' }
  }
  const { modelId, level } = input as Record<string, unknown>
  if (typeof modelId !== 'string' || typeof level !== 'string') {
    return { ok: false, error: 'The effort choice was not understood.' }
  }
  const model = models.find((candidate) => candidate.id === modelId)
  if (!model) return { ok: false, error: 'That model is not available.' }
  const match = model.capabilities.effortLevels.find((candidate) => candidate === level)
  if (!match) return { ok: false, error: 'That model does not take that effort level.' }
  return { ok: true, modelId: model.id, level: match }
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

// A model's id as the providers spell them: lower case letters, digits, dots and hyphens, starting with a letter or digit
// (claude-opus-5-5, gpt-6.1-sol). Looser than the registry's list on purpose: a retired model must stay readable (D-021).
const MODEL_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/

export function isModelId(value: unknown): value is string {
  return typeof value === 'string' && MODEL_ID.test(value)
}

/**
 * Where a list of messages comes from, which decides how the two fields that say who wrote a reply (D-021) are read:
 *  - 'page'    : the page is saving. Strict: a provider the app does not know, or a model that is not an id, refuses the save.
 *  - 'file'    : a version 2 file. Forgiving: what cannot be used is read as null, because the conversation is still worth reading.
 *  - 'file-v1' : a version 1 file (Stages 2-4) has no such fields. Every reply in it came from Anthropic, the only provider
 *                then, and which model it was is not known and cannot be worked out: provider "anthropic", model null.
 */
export type MessageSource = 'page' | 'file' | 'file-v1'

function answererOf(
  item: Record<string, unknown>,
  source: MessageSource
): { provider: ProviderId | null; model: string | null } | null {
  if (source === 'file-v1') return { provider: 'anthropic', model: null }
  const lenient = source === 'file'
  let provider: ProviderId | null = null
  if (item.provider !== undefined && item.provider !== null) {
    const match = SUPPORTED_PROVIDERS.find((known) => known === item.provider)
    if (match === undefined) {
      if (!lenient) return null
    } else provider = match
  }
  let model: string | null = null
  if (item.model !== undefined && item.model !== null) {
    if (isModelId(item.model)) model = item.model
    else if (!lenient) return null
  }
  // A model with no provider says nothing a person could use: refused from the page, read as unknown from a file.
  if (provider === null && model !== null) {
    if (!lenient) return null
    model = null
  }
  return { provider, model }
}

export type MessagesCheck = { ok: true; messages: SavedMessage[] } | { ok: false; error: string }

/**
 * Checks the messages of a conversation to be saved, whether they come from the page or are read back from a
 * file, and returns a clean copy (only the fields we know about). A message that is still "streaming" is
 * kept as "stopped": a reply that is cut off by closing the window never finishes. The first message must
 * be the person's, as it is in every conversation the app makes. A reply says which model wrote it (`answererOf`);
 * the person's own messages never carry those fields, and whatever the page claims on one is dropped.
 */
export function checkSavedMessages(input: unknown, source: MessageSource = 'page'): MessagesCheck {
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
    if (role === 'assistant') {
      const answerer = answererOf(item as Record<string, unknown>, source)
      if (answerer === null) return refuse('The conversation was not understood.')
      message.provider = answerer.provider
      message.model = answerer.model
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
