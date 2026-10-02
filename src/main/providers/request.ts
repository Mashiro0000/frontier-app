import type { Effort, ModelEntry, ProviderId } from '../../shared/registry'
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
const ASSISTANT_NAME: Record<ProviderId, string> = {
  anthropic: 'Claude',
  openai: 'an AI assistant'
}

// The chat window renders Markdown (D-025; until Stage 7 it showed plain text and this said so, D-009). It draws a closed set of
// elements and nothing else, so the model is told which ones, and what is not drawn.
const MARKDOWN_RULES =
  'The window renders Markdown, so you may use it where it helps: **bold** and *italic*, `inline code`, # headings for long ' +
  'answers, bulleted and numbered lists, tables, > quotes, and fenced code blocks with the language named (```python). ' +
  'Raw HTML, images and diagrams are not shown, so do not use them. A link is written [text](https://address); only https ' +
  'addresses can be opened. Keep short answers plain: no headings or tables where a sentence will do.'

export const systemPromptFor = (provider: ProviderId): string =>
  `You are ${ASSISTANT_NAME[provider]}, chatting with someone in Frontier App, a desktop chat window. ${MARKDOWN_RULES}`

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

/**
 * Turns what the chat knows into what an adapter is given. `effort` is what chat.ts decided for this reply (the person's saved
 * choice, D-024); left out, it is the registry's own pick for the model, which is what every reply asked for before there was a
 * choice. `null` is a decision too: this model takes none.
 */
export function buildStreamRequest(input: {
  credentials: Credentials
  model: ModelEntry
  effort?: Effort | null
  messages: readonly NeutralMessage[]
  signal: AbortSignal
}): StreamRequest {
  const { credentials, model, messages, signal } = input
  return {
    credentials,
    model,
    effort: input.effort === undefined ? model.effort : input.effort,
    system: systemPromptFor(model.provider),
    messages: mergeAdjacent(messages),
    maxOutputTokens: Math.min(MAX_REPLY_TOKENS, model.maxOutputTokens),
    signal
  }
}
