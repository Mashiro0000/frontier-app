import { join } from 'path'
import { mkdir } from 'fs/promises'
import {
  UPDATE_LIMITS,
  UPDATE_WORDS,
  type UpdateChangeResult,
  type UpdateFinding,
  type UpdateStatus
} from '../shared/updates'
import { KeptRefused } from './keptFile'
import {
  QUESTION_BUSY,
  QUESTION_FAILED,
  QUESTION_RESTING,
  type QuestionGate,
  type SystemQuestion
} from './systemQuestion'
import { ASKED_HERE, shown } from './toolQuestion'
import {
  UpdateFetchFailed,
  downloadInstaller,
  fetchSmall,
  stillTheInstaller,
  type FetchLike,
  type FetchRules
} from './updateFetch'
import {
  MAX_ENVELOPE_BYTES,
  envelopeUrl,
  readSignedManifest,
  releaseKey,
  type UpdateManifest
} from './updateManifest'
import type { UpdateSettings, UpdateSettingsStore } from './updateSettings'

// What may happen with updates (Stage 18.4 to 18.6, D-050). The switch is updateSettings.ts, the signed file updateManifest.ts, the network updateFetch.ts; this decides
// what happens and in which order. Main alone; the page gets `status()` and four calls, and no way to answer a question, to name an address, a version or a file, or
// to run anything.
//
//  - The check is OFF until the person turns it on, and turning it on asks in the system's own box (a page cannot turn it on alone). Off is at once and asks nothing.
//  - When on: one check right after it is turned on, then at most one every 24 hours (kept in updates.json, so a restart does not check again), and one on "Check now".
//    A check is ONE request for the small signed file (and its redirects); nothing else goes over the network for updates.
//  - A newer version, signed with the key built into this program, is offered in the system's box: by the daily check once per version ("Not now" is remembered), and
//    from Settings whenever the person presses Install. Only on a yes is the installer downloaded, held to the signed size and SHA-256, read again just before it runs,
//    and run; then the app closes. Only the installed app runs an installer. A lower or equal version is never offered. No Electron imports.

export interface UpdateServiceOptions {
  settings: UpdateSettingsStore
  gate: QuestionGate
  fetch: FetchLike
  /** Whether an address may be asked, every redirect too (githubOnly in the app). */
  allowed: (url: URL) => boolean
  /** The release key's public half (releaseConfig.ts). */
  publicKey: string
  /** "owner/name" of the releases repository (releaseConfig.ts). */
  repo: string
  currentVersion: string
  /** Running from source, the checks point the two addresses at a stand-in (FRONTIER_UPDATE_URL); null in the installed app. */
  rewrite?: ((address: string) => string) | null
  /** Where the installer is downloaded to (a folder in the data folder). */
  downloadsDir: () => string
  /** This is the installed app: only it runs an installer. */
  installed: boolean
  /** Starts the checked installer, detached (in the app: `--updated /S --force-run`). */
  runInstaller: (path: string) => void
  /** Closes the app after the installer has started. */
  quit: () => void
  /** The window the daily check's question belongs to; null when there is none (the question is then not asked). */
  owner: () => unknown
  now?: () => number
  timeouts?: { checkMs?: number; downloadMs?: number }
}

export interface UpdateService {
  status(): Promise<UpdateStatus>
  setOn(owner: unknown, input: unknown): Promise<UpdateChangeResult>
  reset(): Promise<UpdateChangeResult>
  checkNow(): Promise<UpdateChangeResult>
  install(owner: unknown): Promise<UpdateChangeResult>
  /** Called every hour by main (and by the checks): a check if one is due. */
  tick(): Promise<void>
  /** Ends a check or a download on its way (the app is closing). */
  cancel(): void
}

const BUSY_CHANGING = 'The update settings are still being changed.'
const NOTHING_TO_RESET = 'The update settings can be read, so there is nothing to start again.'
const changeRefused = (why: string): string =>
  `Nothing was changed: your update settings could not be read (${why}). Checking for updates is off. Start again in Settings; the app keeps a copy of the file.`

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const exactly = (value: unknown, keys: string): value is Record<string, unknown> =>
  isRecord(value) && Object.keys(value).sort().join() === keys
const reason = (error: unknown): string => (error instanceof Error ? error.message : String(error))
const megabytes = (bytes: number): string => (bytes / (1024 * 1024)).toFixed(1)

/** The question before the daily check is switched on. */
export function updatesOnQuestion(repo: string): SystemQuestion {
  return {
    title: 'Updates',
    message: 'Let this app check for updates once a day?',
    detail: [
      `Once a day, and when you press "Check now", the app asks github.com/${repo} for one small file that says which version is the newest. It is an ordinary HTTPS request: GitHub sees this computer's internet address and the time, as for any web page. Nothing about you, your chats or your keys is sent, and no cookie or identifier.`,
      '',
      'Nothing is downloaded or installed by itself. When a newer version is found, the app asks you here first, and it accepts only a version signed with the release key built into this app.',
      '',
      'You can turn it off again in Settings, under Updates.',
      '',
      ASKED_HERE
    ].join('\n'),
    yes: 'Turn on',
    no: "Don't turn on"
  }
}

/** The question before an update is downloaded and installed. */
export function installQuestion(
  manifest: UpdateManifest,
  currentVersion: string,
  repo: string
): SystemQuestion {
  // The release's notes, each line quoted on its own (shown() keeps any line from passing for the box's own words), at most 12 lines of 200 characters.
  const lines = manifest.notes
    .trim()
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '')
  const notes = lines
    .slice(0, 12)
    .map((line) => shown(line.length > 200 ? `${line.slice(0, 200)}...` : line))
  if (lines.length > 12) notes.push('(and more in the release)')
  return {
    title: 'Update available',
    message: `Install Frontier App ${manifest.version}?`,
    detail: [
      `You have version ${currentVersion}. Version ${manifest.version} (${manifest.date}) is signed with the release key built into this app.`,
      '',
      `The installer (${megabytes(manifest.installer.size)} MB) is downloaded from github.com/${repo}, checked against the signed SHA-256, and run. The app then closes, and opens again when the update is installed. Your chats, keys and settings stay as they are.`,
      ...(notes.length > 0 ? ['', "What changed, in the release's own words:", ...notes] : []),
      '',
      '"Not now": the app does not ask again for this version. You can still install it from Settings, under Updates.',
      '',
      ASKED_HERE
    ].join('\n'),
    yes: 'Download and install',
    no: 'Not now'
  }
}

export function createUpdateService(options: UpdateServiceOptions): UpdateService {
  const { settings, gate } = options
  const now = options.now ?? Date.now
  const hasKey = releaseKey(options.publicKey) !== null
  const rewrite = options.rewrite ?? ((address: string) => address)
  const fetchRules = (timeoutMs: number, signal: AbortSignal): FetchRules => ({
    fetch: options.fetch,
    allowed: options.allowed,
    timeoutMs,
    signal
  })

  let changing = false
  let busy: UpdateStatus['busy'] = null
  let progress: number | null = null
  let finding: UpdateFinding = { kind: 'none' }
  let available: UpdateManifest | null = null
  let inFlight: AbortController | null = null

  async function status(): Promise<UpdateStatus> {
    const { settings: chosen, problem } = await settings.read()
    return {
      on: chosen.on,
      problem,
      hasKey,
      source: `github.com/${options.repo}`,
      version: options.currentVersion,
      lastCheck: chosen.lastCheck,
      finding,
      busy,
      progress,
      installed: options.installed
    }
  }

  async function write(next: UpdateSettings, replace = false): Promise<string | null> {
    try {
      await settings.write(next, { replace })
      return null
    } catch (error) {
      if (error instanceof KeptRefused) return error.message
      console.error('Writing the update settings failed:', reason(error))
      return 'The update settings could not be saved.'
    }
  }

  async function oneChange(task: () => Promise<UpdateChangeResult>): Promise<UpdateChangeResult> {
    if (changing) return { ok: false, error: BUSY_CHANGING }
    changing = true
    try {
      return await task()
    } finally {
      changing = false
    }
  }

  /** One check: the signed file, read and judged. `daily` offers a newer version in the box (once per version). */
  async function check(daily: boolean): Promise<void> {
    if (busy !== null) return
    const before = await settings.read()
    if (before.problem !== null || !before.settings.on || !hasKey) return
    busy = 'checking'
    const controller = new AbortController()
    inFlight = controller
    try {
      const bytes = await fetchSmall(
        rewrite(envelopeUrl(options.repo)),
        MAX_ENVELOPE_BYTES,
        fetchRules(options.timeouts?.checkMs ?? UPDATE_LIMITS.checkTimeoutMs, controller.signal)
      )
      const result = readSignedManifest(bytes, {
        publicKey: options.publicKey,
        repo: options.repo,
        currentVersion: options.currentVersion
      })
      if (result.ok) {
        available = result.manifest
        const m = result.manifest
        finding = {
          kind: 'available',
          text: `Version ${m.version} is available.`,
          version: m.version,
          date: m.date,
          sizeBytes: m.installer.size,
          notes: m.notes
        }
      } else {
        available = null
        finding =
          result.kind === 'refused'
            ? { kind: 'refused', text: result.reason }
            : { kind: 'current', text: result.reason }
      }
    } catch (error) {
      available = null
      finding = {
        kind: 'failed',
        text: error instanceof UpdateFetchFailed ? error.message : 'The check could not be made.'
      }
      if (!(error instanceof UpdateFetchFailed))
        console.error('The update check failed:', reason(error))
    } finally {
      busy = null
      inFlight = null
    }
    // The time of the check is kept whatever it found, so the daily check never asks more often than once a day.
    const latest = await settings.read()
    if (latest.problem === null && latest.settings.on)
      await write({ ...latest.settings, lastCheck: now() })
    if (daily && available !== null && latest.settings.declined !== available.version) {
      const owner = options.owner()
      if (owner !== null && owner !== undefined && !gate.open()) await offer(owner, true)
    }
  }

  /** Asks, and on a yes downloads, checks and runs the installer. */
  async function offer(owner: unknown, daily: boolean): Promise<UpdateChangeResult> {
    const manifest = available
    if (manifest === null) return { ok: false, error: UPDATE_WORDS.nothingToInstall }
    if (busy !== null) return { ok: false, error: UPDATE_WORDS.busy }
    const answer = await gate.ask(
      owner,
      installQuestion(manifest, options.currentVersion, options.repo)
    )
    if (answer === 'busy') return { ok: false, error: QUESTION_BUSY }
    if (answer === 'resting') return { ok: false, error: QUESTION_RESTING }
    if (answer === 'failed') return { ok: false, error: QUESTION_FAILED }
    if (answer !== 'yes') {
      if (answer === 'no') {
        const latest = await settings.read()
        if (latest.problem === null) await write({ ...latest.settings, declined: manifest.version })
      }
      return { ok: false, error: daily ? 'Not now.' : 'Nothing was installed.' }
    }
    if (available !== manifest || busy !== null) return { ok: false, error: UPDATE_WORDS.busy }
    busy = 'downloading'
    progress = 0
    const controller = new AbortController()
    inFlight = controller
    const expected = { size: manifest.installer.size, sha256: manifest.installer.sha256 }
    let path: string
    try {
      const dir = options.downloadsDir()
      await mkdir(dir, { recursive: true })
      path = join(dir, manifest.installer.name)
      await downloadInstaller(
        rewrite(manifest.installer.url),
        path,
        expected,
        fetchRules(
          options.timeouts?.downloadMs ?? UPDATE_LIMITS.downloadTimeoutMs,
          controller.signal
        ),
        (share) => {
          progress = share
        }
      )
    } catch (error) {
      const text =
        error instanceof UpdateFetchFailed
          ? error.message
          : 'The installer could not be downloaded.'
      if (!(error instanceof UpdateFetchFailed))
        console.error('Downloading the update failed:', reason(error))
      finding = { kind: 'failed', text }
      return { ok: false, error: text }
    } finally {
      busy = null
      progress = null
      inFlight = null
    }
    if (!options.installed) return { ok: false, error: UPDATE_WORDS.notInstalled }
    // Read again just before it runs: the file on disk must still be the one that was checked.
    if (!(await stillTheInstaller(path, expected))) {
      finding = {
        kind: 'failed',
        text: 'The downloaded installer changed on the disk before it ran. Nothing was run.'
      }
      return { ok: false, error: finding.text }
    }
    try {
      options.runInstaller(path)
    } catch (error) {
      console.error('Starting the installer failed:', reason(error))
      return { ok: false, error: 'The installer could not be started.' }
    }
    options.quit()
    return { ok: true, status: await status() }
  }

  return {
    status,

    setOn: (owner, input) =>
      oneChange(async () => {
        if (!exactly(input, 'on') || typeof input.on !== 'boolean')
          return { ok: false, error: UPDATE_WORDS.notUnderstood }
        const { settings: chosen, problem } = await settings.read()
        if (problem !== null) return { ok: false, error: changeRefused(problem) }
        if (!input.on) {
          inFlight?.abort()
          const failed = await write({ ...chosen, on: false })
          return failed ? { ok: false, error: failed } : { ok: true, status: await status() }
        }
        if (chosen.on) return { ok: true, status: await status() }
        if (!hasKey) return { ok: false, error: UPDATE_WORDS.noKey }
        const answer = await gate.ask(owner, updatesOnQuestion(options.repo))
        if (answer === 'busy') return { ok: false, error: QUESTION_BUSY }
        if (answer === 'resting') return { ok: false, error: QUESTION_RESTING }
        if (answer === 'failed') return { ok: false, error: QUESTION_FAILED }
        if (answer !== 'yes') return { ok: false, error: 'Checking for updates is still off.' }
        const failed = await write({ ...chosen, on: true })
        if (failed) return { ok: false, error: failed }
        void check(false) // the first check, now that the person said yes; Settings shows it when it ends
        return { ok: true, status: await status() }
      }),

    reset: () =>
      oneChange(async () => {
        const { problem } = await settings.read()
        if (problem === null) return { ok: false, error: NOTHING_TO_RESET }
        inFlight?.abort()
        const failed = await write({ on: false, lastCheck: null, declined: null }, true)
        return failed ? { ok: false, error: failed } : { ok: true, status: await status() }
      }),

    checkNow: async () => {
      const { settings: chosen, problem } = await settings.read()
      if (problem !== null) return { ok: false, error: changeRefused(problem) }
      if (!hasKey) return { ok: false, error: UPDATE_WORDS.noKey }
      if (!chosen.on) return { ok: false, error: UPDATE_WORDS.off }
      if (busy !== null) return { ok: false, error: UPDATE_WORDS.busy }
      await check(false)
      return { ok: true, status: await status() }
    },

    install: async (owner) => {
      const { settings: chosen, problem } = await settings.read()
      if (problem !== null) return { ok: false, error: changeRefused(problem) }
      if (!chosen.on) return { ok: false, error: UPDATE_WORDS.off }
      return offer(owner, false)
    },

    tick: async () => {
      const { settings: chosen, problem } = await settings.read()
      if (problem !== null || !chosen.on || !hasKey || busy !== null) return
      const last = chosen.lastCheck
      // A last check "in the future" (the clock was moved back) counts as due, or the check could stop for as long as the clock is behind.
      if (last !== null && last <= now() && now() - last < UPDATE_LIMITS.intervalMs) return
      await check(true)
    },

    cancel: () => inFlight?.abort()
  }
}
