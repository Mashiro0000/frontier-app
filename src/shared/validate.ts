// Checks that run on both sides: the page uses them to give quick feedback, and the main process runs
// them again, because it must never trust what the page sends. Plain functions, no imports.

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
