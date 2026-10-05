// Helpers for the Stage 8b.3 / 8b.4 suites (encrypting the saved chats, and the key that cannot be read). Test tooling only.
import './ts-resolve.mjs'
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { SRC } from './lib8b.mjs'

export * from './lib8b.mjs'
export const chatFile = await import(`${SRC}/main/chatFile.ts`)
export const protectionMod = await import(`${SRC}/main/chatProtection.ts`)
export const encMod = await import(`${SRC}/main/chatEncryptionService.ts`)

/**
 * A stand-in for the operating system's secure storage that behaves like the real one where it matters: what it makes has nothing readable in it, a blob made
 * under another key cannot be opened (decrypt THROWS, as safeStorage.decryptString does), and every call is counted so that a test can prove nothing was
 * encrypted while nothing may be. `lose()` is a reset profile or another account: the box gets a NEW key, so every blob made before no longer opens, and what it
 * makes from now on is under the new one. `available = false` is a computer with no keyring. `lie = true` makes decrypt answer with the wrong text.
 */
export function makeBox() {
  let secret = randomBytes(32)
  const box = {
    available: true,
    lie: false,
    /** `garble = true`: encrypt gives back bytes that look like a blob but do not open (a secure storage that is broken). */
    garble: false,
    calls: { encrypt: 0, decrypt: 0 },
    isAvailable: () => box.available,
    encrypt(plain) {
      box.calls.encrypt += 1
      if (box.garble) return Buffer.concat([Buffer.from('v10'), randomBytes(Buffer.byteLength(plain) + 28)])
      const iv = randomBytes(12)
      const c = createCipheriv('aes-256-gcm', secret, iv)
      const body = Buffer.concat([c.update(plain, 'utf8'), c.final()])
      return Buffer.concat([Buffer.from('v10'), iv, c.getAuthTag(), body])
    },
    decrypt(blob) {
      box.calls.decrypt += 1
      if (box.lie) return 'something else entirely'
      const d = createDecipheriv('aes-256-gcm', secret, blob.subarray(3, 15))
      d.setAuthTag(blob.subarray(15, 31))
      return Buffer.concat([d.update(blob.subarray(31)), d.final()]).toString('utf8')
    },
    lose() {
      secret = randomBytes(32)
    },
    /** The key as it is now, so that a test can put it back (the same account again, the profile restored). */
    exportKey() {
      return Buffer.from(secret)
    },
    importKey(key) {
      secret = Buffer.from(key)
    }
  }
  return box
}

/** The text of an encrypted file's data, flipped at one character: damage inside the envelope that is still valid JSON and valid base64. */
export function flipInData(fileText) {
  const env = JSON.parse(fileText)
  const at = Math.floor(env.data.length / 2)
  const swap = env.data[at] === 'A' ? 'B' : 'A'
  env.data = env.data.slice(0, at) + swap + env.data.slice(at + 1)
  return JSON.stringify(env)
}
