import type { SecretFinding } from '../shared/ipc'
import { PROVIDER_NAMES, type ProviderId } from '../shared/registry'

// The look for secrets before the person's own text is kept to go out with every message (Stage 10, D-039; safety rule 5): the instructions for every
// chat and a chat's own instructions (10.2), and later the notes and a project's instructions. No Electron imports: the saved keys are handed in by main.
//
// Two kinds of finding, treated differently:
//  - ONE OF THE API KEYS SAVED IN THIS APP (the key itself, or any piece of it at least KEY_PIECE characters long): refused outright, with no way past.
//    The sentence names whose key it is and never shows any of it. The same look runs again before every request (chat.ts), so a key saved in Settings
//    after the text was kept still never goes out inside it.
//  - Text that LOOKS LIKE a key, a token or a password (the providers' key shapes, common token shapes, a private key block, "password:" and the like,
//    a long random-looking string): a warning that shows each part masked, and the person may save anyway (it may be an example, or not a secret).
// What is found is never logged, and a masked part never shows more than its first four and last two characters.

/** A run of this many characters of a saved key is enough to say the key is there: no text holds 24 characters of a random key by chance. */
export const KEY_PIECE = 24

/**
 * A part of a text, masked, never showing more than a quarter of it: up to 8 characters, its first and a dot for each of the rest; up to 23 (a password,
 * say), its first and its length; from 24 (a key's length), its first four, its last two and its length.
 */
export function mask(part: string): string {
  const chars = [...part]
  if (chars.length <= 8) return `${chars[0] ?? ''}${'•'.repeat(Math.max(0, chars.length - 1))}`
  if (chars.length < 24) return `${chars[0]}… (${chars.length} characters)`
  return `${chars.slice(0, 4).join('')}…${chars.slice(-2).join('')} (${chars.length} characters)`
}

/** A saved API key, as main hands it in: whose it is, and the key. */
export interface SavedKey {
  provider: ProviderId
  key: string
}

/** Which saved key the text holds (the whole key, or a piece of it, also with the white space taken out), or null. */
export function heldKey(text: string, keys: readonly SavedKey[]): ProviderId | null {
  const squeezed = text.replace(/\s+/g, '')
  for (const { provider, key } of keys) {
    if (key.length === 0) continue
    if (text.includes(key) || squeezed.includes(key)) return provider
    for (let at = 0; at + KEY_PIECE <= key.length; at++) {
      const piece = key.slice(at, at + KEY_PIECE)
      if (text.includes(piece) || squeezed.includes(piece)) return provider
    }
  }
  return null
}

/** The sentence for a text that holds a saved key: whose key, never the key. `kept` is what is being saved ("Instructions", "Notes"). */
export const heldKeySentence = (provider: ProviderId, kept: string): string =>
  `Not saved: this holds your ${PROVIDER_NAMES[provider]} API key, which is saved in this app. ${kept} go to the company that runs the model with every message, so a key must never be in them. Take it out and save again.`

/** The refusal of a request whose instructions hold a saved key (`whose`: "for every chat", "for this chat"). */
export const keyInInstructions = (provider: ProviderId, whose: string): string =>
  `Nothing was sent: your instructions ${whose} hold your ${PROVIDER_NAMES[provider]} API key, which is saved in this app. Open Instructions and take it out.`

/** The refusal of a request when one of the person's notes holds a saved key (10.4). */
export const keyInNotes = (provider: ProviderId): string =>
  `Nothing was sent: one of your notes holds your ${PROVIDER_NAMES[provider]} API key, which is saved in this app. Open Memory and take it out.`

/** The warning for a text with parts that look like a key or a password. */
export const lookalikeSentence = (kept: string): string =>
  `Part of this looks like a key or a password (below). ${kept} go to the company that runs the model with every message: take it out, or press "Save anyway" if it is not a secret.`

// The providers' own key shapes need a digit in the run: a real key has several, and a hyphenated phrase that happens to start with "sk-" ("sk-learn-is-a-
// python-library") has none.
const SHAPES: { what: string; pattern: RegExp }[] = [
  { what: 'an Anthropic API key', pattern: /\bsk-ant-(?=[A-Za-z0-9_-]*[0-9])[A-Za-z0-9_-]{20,}/g },
  {
    what: 'an OpenAI API key',
    pattern: /\bsk-(?!ant-)(?:proj-|svcacct-|admin-)?(?=[A-Za-z0-9_-]*[0-9])[A-Za-z0-9_-]{20,}/g
  },
  { what: 'an AWS access key', pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  {
    what: 'a GitHub token',
    pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})/g
  },
  { what: 'a Slack token', pattern: /\bxox[abposr]-[A-Za-z0-9-]{10,}/g },
  { what: 'a Google API key', pattern: /\bAIza[0-9A-Za-z_-]{35}/g },
  { what: 'a Stripe key', pattern: /\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{16,}/g },
  {
    what: 'a web token (JWT)',
    pattern: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g
  },
  { what: 'a private key', pattern: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/g }
]

/** "password: x", "api_key = x", "token=x": the word, then the value. */
const LABELLED =
  /\b(password|passwd|pwd|passcode|passphrase|pin|secret|client[_ -]?secret|api[_ -]?key|access[_ -]?key|auth[_ -]?token|token)\s*[:=]\s*("[^"\s]{1,200}"|'[^'\s]{1,200}'|[^\s,;]{1,200})/gi

/** A long run of key-like characters, looked at below for how random it is. */
const LONG_RUN = /[A-Za-z0-9+/_=-]{32,}/g

/** How surprising each character of a run is, in bits (Shannon): English words and repeated letters are low; a random key is about 5 or more. */
function bitsPerChar(run: string): number {
  const counts = new Map<string, number>()
  for (const c of run) counts.set(c, (counts.get(c) ?? 0) + 1)
  let bits = 0
  for (const n of counts.values()) {
    const p = n / run.length
    bits -= p * Math.log2(p)
  }
  return bits
}

/**
 * A key or a token made by a machine mixes small and capital letters and digits all through it; a long link, a path or a hyphenated phrase has words
 * and few digits or none. So: both cases, at least two digits, and about as surprising as random text.
 */
function looksRandom(run: string): boolean {
  const digits = run.replace(/[^0-9]/g, '').length
  return /[a-z]/.test(run) && /[A-Z]/.test(run) && digits >= 2 && bitsPerChar(run) >= 4
}

/**
 * Every part of `text` that looks like a key, a token or a password, at most `max` of them, each masked. Parts that overlap one already found are not
 * counted twice. Never throws, and says nothing about a saved key (`heldKey` does).
 */
export function findLookalikes(text: string, max = 5): SecretFinding[] {
  const found: SecretFinding[] = []
  const taken: [number, number][] = []
  const overlaps = (start: number, end: number): boolean =>
    taken.some(([s, e]) => start < e && end > s)
  const add = (start: number, end: number, finding: SecretFinding): void => {
    if (found.length >= max || overlaps(start, end)) return
    taken.push([start, end])
    found.push(finding)
  }
  for (const { what, pattern } of SHAPES) {
    for (const m of text.matchAll(pattern)) {
      add(m.index, m.index + m[0].length, { what, shown: mask(m[0]) })
    }
  }
  for (const m of text.matchAll(LABELLED)) {
    const value = m[2].replace(/^["']|["']$/g, '')
    if (value.length === 0) continue
    add(m.index, m.index + m[0].length, {
      what: `a ${m[1].toLowerCase()}`,
      shown: `${m[1]}: ${mask(value)}`
    })
  }
  for (const m of text.matchAll(LONG_RUN)) {
    if (looksRandom(m[0])) {
      add(m.index, m.index + m[0].length, {
        what: 'a long random-looking string, which could be a key or a token',
        shown: mask(m[0])
      })
    }
  }
  return found
}

export type SecretCheck =
  { ok: true; warned: boolean } | { ok: false; error: string; warnings?: SecretFinding[] }

/**
 * The look before text is kept to go out with every message: a saved key refuses it, whatever else is said; parts that look like a key or a password
 * refuse it with a warning unless the person chose "Save anyway" (`warned` then says so, for the question that follows).
 */
export function checkForSecrets(
  text: string,
  keys: readonly SavedKey[],
  saveAnyway: boolean,
  kept: string
): SecretCheck {
  const held = heldKey(text, keys)
  if (held !== null) return { ok: false, error: heldKeySentence(held, kept) }
  const lookalikes = findLookalikes(text)
  if (lookalikes.length > 0 && !saveAnyway) {
    return { ok: false, error: lookalikeSentence(kept), warnings: lookalikes }
  }
  return { ok: true, warned: lookalikes.length > 0 }
}
