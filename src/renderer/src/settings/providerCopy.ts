import type { ProviderId } from '../../../shared/registry'

// What the person is told about getting a key, for each provider: what the key lets the app use, and where to create one.
// Kept apart from the components, which may export nothing but components (the dev server's hot reload relies on that).
// A provider is added here and in the registry's list together: the type of this table is what makes sure of it.
export const KEY_HELP: Record<ProviderId, { uses: string; whereToCreate: string }> = {
  anthropic: { uses: "Anthropic's Claude", whereToCreate: 'your Anthropic Console account' },
  openai: { uses: "OpenAI's GPT models", whereToCreate: 'your OpenAI platform account' },
  google: { uses: "Google's Gemini models", whereToCreate: 'Google AI Studio' }
}
