// Updates (Stage 18, D-050): the part main and the window share. Plain types and constants; no Electron imports, nothing only Node has (the preload bundles this file).
//
// What the stage does, in one paragraph: Settings > Updates has a switch, OFF until the person turns it on (and turning it on asks in the system's own box). When on,
// main fetches one small signed file from the owner's public releases repository at most once a day, and on "Check now". A newer version, signed with the owner's key,
// is offered in the system's box: only on a yes is the installer downloaded, held to the size and SHA-256 the signed file gives, and run; the app then closes.

export const UPDATE_CHANNELS = Object.freeze({
  status: 'updates:status',
  setOn: 'updates:set-on',
  reset: 'updates:reset',
  checkNow: 'updates:check-now',
  install: 'updates:install'
})

/** The limits of the update check. Constants, not settings. */
export const UPDATE_LIMITS = Object.freeze({
  /** At most one automatic check in this many milliseconds (the owner's pick: once a day). */
  intervalMs: 24 * 60 * 60 * 1000,
  /** How often main looks whether a check is due. */
  tickMs: 60 * 60 * 1000,
  /** How long the small signed file may take. */
  checkTimeoutMs: 30_000,
  /** How long the installer may take to download. */
  downloadTimeoutMs: 30 * 60 * 1000,
  /** The most redirects one request follows (GitHub sends a release download on to its own file servers). */
  maxRedirects: 5
})

/** What the last check found. */
export type UpdateFinding =
  | { kind: 'none' }
  | { kind: 'current'; text: string }
  | {
      kind: 'available'
      text: string
      version: string
      date: string
      sizeBytes: number
      notes: string
    }
  | { kind: 'refused'; text: string }
  | { kind: 'failed'; text: string }

export interface UpdateStatus {
  /** The daily check is switched on (only after the person's yes in the system's box). */
  readonly on: boolean
  /** The settings file could not be read: the check is off and the sentence says why; null when it is fine. */
  readonly problem: string | null
  /** This build has the owner's release key; without it no update can be accepted, and the switch cannot be turned on. */
  readonly hasKey: boolean
  /** Where the check reads from, as the person can look it up ("github.com/owner/name"). */
  readonly source: string
  /** The running version. */
  readonly version: string
  /** When the last check was made (milliseconds since 1970), or null. */
  readonly lastCheck: number | null
  /** What it found (kept until the app closes). */
  readonly finding: UpdateFinding
  /** A check or a download is under way. */
  readonly busy: 'checking' | 'downloading' | null
  /** The downloaded share of the installer, 0 to 1, while downloading. */
  readonly progress: number | null
  /** This is the installed app (only it runs an installer). */
  readonly installed: boolean
}

export type UpdateChangeResult = { ok: true; status: UpdateStatus } | { ok: false; error: string }

/** The sentences the page shows. */
export const UPDATE_WORDS = Object.freeze({
  noKey: 'This build has no release key, so it cannot accept an update.',
  off: 'Checking for updates is off.',
  busy: 'A check or a download is already under way.',
  notUnderstood: 'The app did not understand the request.',
  nothingToInstall: 'There is no newer version to install. Check for updates first.',
  notInstalled: 'The update was downloaded and checked. Only the installed app runs an installer.'
})
