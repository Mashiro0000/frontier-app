import type { ModelEntry, ProviderId } from '../../shared/registry'
import type { Credentials, NeutralMessage, StreamRequest } from './types'

// The app's own rules for a reply (D-012, D-013), applied here, once, whichever provider answers. An adapter
// translates a StreamRequest into one provider's API and decides none of this.

/**
 * A ceiling on one reply, and so on what one reply can cost (output tokens are the expensive ones). The thinking the
 * model does before it answers counts against it too. A model that cannot write this much gets its own, lower limit
 * from the registry.
 */
export const MAX_REPLY_TOKENS = 16000

/** What the assistant is called in the system prompt: a model that is told it is someone else answers oddly. */
const ASSISTANT_NAME: Record<ProviderId, string> = { anthropic: 'Claude' }

// The chat window shows plain text only (D-009), and models write Markdown by default, which would appear as stray
// asterisks and backticks. Remove this once replies are rendered as Markdown.
const PLAIN_TEXT_RULES =
  'The window shows replies as plain text and does not render Markdown, so do not use Markdown syntax: no asterisks or ' +
  'underscores for emphasis, no # headings, no backticks, no tables. Write in ordinary paragraphs, and use simple ' +
  'hyphen lists or numbered lines when a list helps. If you include code, put it on its own lines, indented by four spaces.'

export const systemPromptFor = (provider: ProviderId): string =>
  `You are ${ASSISTANT_NAME[provider]}, chatting with someone in Frontier App, a desktop chat window. ${PLAIN_TEXT_RULES}`

/**
 * Providers want the two sides to take turns. After a reply that failed with no text, the person's next message
 * follows their previous one, so this joins consecutive messages from the same side into one. (The docs disagree on
 * whether a provider does this itself, so it is not left to the provider.)
 */
export function mergeAdjacent(messages: readonly NeutralMessage[]): NeutralMessage[] {
  const merged: NeutralMessage[] = []
  for (const message of messages) {
    const last = merged.at(-1)
    if (last && last.role === message.role) {
      last.content += `\n\n${message.content}`
    } else {
      merged.push({ ...message })
    }
  }
  return merged
}

/** Turns what the chat knows into what an adapter is given. */
export function buildStreamRequest(input: {
  credentials: Credentials
  model: ModelEntry
  messages: readonly NeutralMessage[]
  signal: AbortSignal
}): StreamRequest {
  const { credentials, model, messages, signal } = input
  return {
    credentials,
    model,
    system: systemPromptFor(model.provider),
    messages: mergeAdjacent(messages),
    maxOutputTokens: Math.min(MAX_REPLY_TOKENS, model.maxOutputTokens),
    signal
  }
}
