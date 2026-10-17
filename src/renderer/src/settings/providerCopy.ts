import type { ProviderId } from '../../../shared/registry'

// What the person is told about getting a key, for each provider: what the key lets the app use, and where to create one.
// Kept apart from the components, which may export nothing but components (the dev server's hot reload relies on that).
// A provider is added here and in the registry's list together: the type of this table is what makes sure of it.
export const KEY_HELP: Record<ProviderId, { uses: string; whereToCreate: string; note?: string }> =
  {
    anthropic: { uses: "Anthropic's Claude", whereToCreate: 'your Anthropic Console account' },
    openai: { uses: "OpenAI's GPT models", whereToCreate: 'your OpenAI platform account' },
    google: {
      uses: "Google's Gemini models",
      whereToCreate: 'Google AI Studio',
      // (17.5, D-049) said here and in the system's box that asks before a Google key is saved
      note: 'On a free (unbilled) key, Google uses what you send to improve its products, and people at Google may read it; on a billed key it does not. The app cannot tell which kind of key you have. Gemini 4 Argon needs a billed key.'
    }
  }
