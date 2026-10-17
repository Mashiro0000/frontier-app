import { createHash } from 'crypto'
import { open, readFile } from 'fs/promises'
import { UPDATE_LIMITS } from '../shared/updates'

// The only network code of the updates (Stage 18.4 and 18.5, D-050). No Electron imports: `fetch` is handed in, so every rule is checked under plain Node against a
// stand-in server.
//
// The rules of every request:
//  - a plain GET with nothing of the person in it: no cookies (Node's fetch keeps none), no extra headers, no body;
//  - redirects are followed BY HAND, at most five, and every address on the way must pass `allowed` (in the app: HTTPS to github.com or one of GitHub's own file
//    servers, *.githubusercontent.com; GitHub sends a release download on to them). Anything else ends the request;
//  - a clock for the whole request, and a cap on the bytes: the signed file is read up to 64 KB; the installer up to exactly the size the signed file gives, so a
//    server cannot fill the disk, and a shorter or longer answer is refused.

export class UpdateFetchFailed extends Error {}

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>

export interface FetchRules {
  fetch: FetchLike
  /** Whether an address may be asked (each hop of the redirects too). */
  allowed: (url: URL) => boolean
  timeoutMs: number
  signal?: AbortSignal
}

/** GitHub only, over HTTPS, on the default port, with no user or password in the address. */
export function githubOnly(url: URL): boolean {
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '' || url.port !== '')
    return false
  return url.hostname === 'github.com' || url.hostname.endsWith('.githubusercontent.com')
}

async function follow(address: string, rules: FetchRules, signal: AbortSignal): Promise<Response> {
  let url: URL
  try {
    url = new URL(address)
  } catch {
    throw new UpdateFetchFailed('The update address is not one.')
  }
  for (let hop = 0; ; hop++) {
    if (!rules.allowed(url))
      throw new UpdateFetchFailed(
        `The update was sent somewhere the app does not go (${url.host}).`
      )
    let response: Response
    try {
      response = await rules.fetch(url.href, {
        method: 'GET',
        redirect: 'manual',
        signal,
        credentials: 'omit'
      })
    } catch (error) {
      if (signal.aborted) throw new UpdateFetchFailed('The update server did not answer in time.')
      throw new UpdateFetchFailed(
        `The update server could not be reached (${error instanceof Error ? error.message : 'no answer'}).`
      )
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location')
      await response.body?.cancel().catch(() => undefined)
      if (!location)
        throw new UpdateFetchFailed('The update server sent a redirect with no address.')
      if (hop >= UPDATE_LIMITS.maxRedirects)
        throw new UpdateFetchFailed('The update server sent too many redirects.')
      try {
        url = new URL(location, url)
      } catch {
        throw new UpdateFetchFailed(
          'The update server sent a redirect to an address that is not one.'
        )
      }
      continue
    }
    if (response.status !== 200) {
      await response.body?.cancel().catch(() => undefined)
      throw new UpdateFetchFailed(
        response.status === 404
          ? 'No release was found (the server answered 404).'
          : `The update server answered ${response.status}.`
      )
    }
    return response
  }
}

function clock(rules: FetchRules): { signal: AbortSignal; done: () => void } {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), rules.timeoutMs)
  const outer = rules.signal
  const onAbort = (): void => controller.abort()
  outer?.addEventListener('abort', onAbort)
  if (outer?.aborted) controller.abort()
  return {
    signal: controller.signal,
    done: () => {
      clearTimeout(timer)
      outer?.removeEventListener('abort', onAbort)
    }
  }
}

/** The body of a small file, at most `maxBytes`. */
export async function fetchSmall(
  address: string,
  maxBytes: number,
  rules: FetchRules
): Promise<Uint8Array> {
  const { signal, done } = clock(rules)
  try {
    const response = await follow(address, rules, signal)
    const declared = Number(response.headers.get('content-length') ?? NaN)
    if (Number.isFinite(declared) && declared > maxBytes) {
      await response.body?.cancel().catch(() => undefined)
      throw new UpdateFetchFailed('The update file is too large to be one.')
    }
    const chunks: Uint8Array[] = []
    let total = 0
    const reader = response.body?.getReader()
    if (!reader) return new Uint8Array(0)
    for (;;) {
      let part: ReadableStreamReadResult<Uint8Array>
      try {
        part = await reader.read()
      } catch {
        throw new UpdateFetchFailed(
          signal.aborted
            ? 'The update server did not answer in time.'
            : 'The update file could not be read.'
        )
      }
      if (part.done) break
      total += part.value.length
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined)
        throw new UpdateFetchFailed('The update file is too large to be one.')
      }
      chunks.push(part.value)
    }
    return Buffer.concat(chunks)
  } finally {
    done()
  }
}

/**
 * Downloads the installer to `path` (written in place), held to exactly `size` bytes and to `sha256`. Resolves when the file on disk is that file; throws
 * UpdateFetchFailed otherwise (the file may then be partial: it is never run, and the next try writes over it).
 */
export async function downloadInstaller(
  address: string,
  path: string,
  expected: { size: number; sha256: string },
  rules: FetchRules,
  onProgress?: (share: number) => void
): Promise<void> {
  const { signal, done } = clock(rules)
  const file = await open(path, 'w')
  try {
    const response = await follow(address, rules, signal)
    const declared = Number(response.headers.get('content-length') ?? NaN)
    if (Number.isFinite(declared) && declared !== expected.size) {
      await response.body?.cancel().catch(() => undefined)
      throw new UpdateFetchFailed(
        `The installer is not the size the signed release gives (${declared} bytes, not ${expected.size}).`
      )
    }
    const hash = createHash('sha256')
    let total = 0
    const reader = response.body?.getReader()
    if (!reader) throw new UpdateFetchFailed('The installer was empty.')
    for (;;) {
      let part: ReadableStreamReadResult<Uint8Array>
      try {
        part = await reader.read()
      } catch {
        throw new UpdateFetchFailed(
          signal.aborted
            ? 'The download took too long, or was stopped.'
            : 'The download was cut off.'
        )
      }
      if (part.done) break
      total += part.value.length
      if (total > expected.size) {
        await reader.cancel().catch(() => undefined)
        throw new UpdateFetchFailed(
          'The installer is larger than the signed release gives. Nothing was run.'
        )
      }
      hash.update(part.value)
      await file.write(part.value)
      onProgress?.(total / expected.size)
    }
    if (total !== expected.size)
      throw new UpdateFetchFailed(
        'The installer is smaller than the signed release gives. Nothing was run.'
      )
    if (hash.digest('hex') !== expected.sha256)
      throw new UpdateFetchFailed(
        'The installer does not match the signed release (its SHA-256 differs). Nothing was run.'
      )
  } finally {
    done()
    await file.close()
  }
}

/** Whether the file at `path` is still exactly the checked installer (read again just before it is run). */
export async function stillTheInstaller(
  path: string,
  expected: { size: number; sha256: string }
): Promise<boolean> {
  try {
    const bytes = await readFile(path)
    return (
      bytes.length === expected.size &&
      createHash('sha256').update(bytes).digest('hex') === expected.sha256
    )
  } catch {
    return false
  }
}
