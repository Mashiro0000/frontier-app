import { HISTORY_LIMITS } from '../shared/ipc'
import type { SecretBox } from './credentialStore'

// An encrypted chat file (Stage 8b.3, D-035). No Electron imports, so it can be checked under plain Node: the operating system's secure storage
// is handed in as a SecretBox, as for the API keys (credentialStore.ts).
//
// A chat's file keeps its name, "<id>.json". What it holds, when the person has turned encryption on, is one small JSON object:
//   {"format":"frontier-chat-encrypted","v":1,"data":"<base64 of what the secure storage made of the chat's own file text>"}
// where the chat's own file text is exactly what a plain file holds ({"version":3,...}). Nothing about the chat is readable in the envelope: not
// its title, its dates or its length (the file's size and date, which the disk shows anyway, are the only things it gives away). The envelope has no
// "version" field on purpose: an older copy of the app that met it would take it for a file of another version and leave it alone, which is
// right, and not for a version 1 chat that has lost its messages.
//
// There is no key and no cryptography of ours here: the secure storage (Windows DPAPI, the macOS Keychain, the Linux desktop's secret service)
// encrypts and decrypts, and protects against a copy of the files taken to another computer or account. It does NOT protect against a program
// running as you on this computer, which can ask the same storage to decrypt (D-010).

export const ENVELOPE_FORMAT = 'frontier-chat-encrypted'
export const ENVELOPE_VERSION = 1

/** How a saved chat's file is kept: as readable text, or sealed by the secure storage. */
export type FileForm = 'plain' | 'encrypted'
/** How the next write must be made, or why none may be made at all (chatProtection.ts decides; the store only obeys). */
export type WriteMode = { form: FileForm } | { refused: string }

/**
 * The most base64 text a sealed chat may be: the chat's file text at its largest (HISTORY_LIMITS.maxFileBytes), plus what the secure storage
 * adds around it (a few dozen bytes; 256 is generous), as base64.
 */
export const MAX_DATA_CHARS = Math.ceil((HISTORY_LIMITS.maxFileBytes + 256) / 3) * 4
/**
 * What an ENCRYPTED file may weigh: that, and the few bytes that wrap it. A plain file's limit stays HISTORY_LIMITS.maxFileBytes; an encrypted
 * file is bigger than the chat in it (base64), so it has its own, and is looked at before it is read.
 */
export const MAX_ENCRYPTED_FILE_BYTES = MAX_DATA_CHARS + 128

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/

/**
 * How every sealed file begins: `sealChat` writes the format first. A file bigger than a plain file may be is looked at (its first bytes only) before it is read,
 * and is read only if it begins like this, so a huge file that is not a sealed chat is refused without being read (the old rule of D-016, kept).
 */
export const SEALED_PREFIX = `{"format":"${ENVELOPE_FORMAT}"`

/** True if what was parsed from a file is an encrypted chat's envelope (it is not yet known to open). */
export function isEnvelope(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    (value as Record<string, unknown>).format === ENVELOPE_FORMAT
  )
}

/** The text of an encrypted file for a chat whose plain file text is `plain`. Throws if the secure storage cannot encrypt. */
export function sealChat(plain: string, box: SecretBox): string {
  return JSON.stringify({
    format: ENVELOPE_FORMAT,
    v: ENVELOPE_VERSION,
    data: box.encrypt(plain).toString('base64')
  })
}

export type Opened = { ok: true; text: string } | { ok: false; why: string }

/**
 * The chat's plain file text out of an envelope, or why it cannot be had. Never throws: a file that cannot be opened is a result, because the
 * caller leaves it exactly as it is and counts it. `box` is absent for a store that has no secure storage.
 */
export function openChat(envelope: Record<string, unknown>, box: SecretBox | undefined): Opened {
  const { v, data } = envelope
  if (
    v !== ENVELOPE_VERSION ||
    typeof data !== 'string' ||
    data.length > MAX_DATA_CHARS ||
    !BASE64.test(data) // which also refuses an empty string: the pattern needs at least one character
  ) {
    return { ok: false, why: 'it is encrypted in a way this version of the app cannot read' }
  }
  if (box === undefined || !box.isAvailable()) {
    return {
      ok: false,
      why: 'it is encrypted, and this computer has no secure storage to open it with'
    }
  }
  try {
    return { ok: true, text: box.decrypt(Buffer.from(data, 'base64')) }
  } catch {
    return {
      ok: false,
      why: 'it is encrypted, and could not be opened with the key this computer has (another account, a reset profile, or damage)'
    }
  }
}

/** True if `fileText` is an envelope that opens to exactly `plain`: the proof, after a write, that what is on disk gives the chat back. */
export function opensTo(fileText: string, plain: string, box: SecretBox | undefined): boolean {
  let parsed: unknown
  try {
    parsed = JSON.parse(fileText)
  } catch {
    return false
  }
  if (!isEnvelope(parsed)) return false
  const opened = openChat(parsed, box)
  return opened.ok && opened.text === plain
}
