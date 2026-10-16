// Two spellings the app checks everywhere: a conversation's id and a model's id. Their own file with no imports (Stage 16.5, D-048), so that any shared module can
// use them without a loop of imports (validate.ts imports images.ts, which needs both); validate.ts exports them as before.

// A conversation's id becomes part of a file name, so it is checked against the one spelling the app itself
// makes (crypto.randomUUID(): lower-case hexadecimal groups). Upper case is refused because Windows treats
// upper and lower case as one file: two spellings of one id would be one conversation.
const CONVERSATION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export function isConversationId(value: unknown): value is string {
  return typeof value === 'string' && CONVERSATION_ID.test(value)
}

// A model's id as the providers spell them: lower case letters, digits, dots and hyphens, starting with a letter or digit
// (claude-opus-5-5, gpt-6.1-sol). Looser than the registry's list on purpose: a retired model must stay readable (D-021).
const MODEL_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/

export function isModelId(value: unknown): value is string {
  return typeof value === 'string' && MODEL_ID.test(value)
}
