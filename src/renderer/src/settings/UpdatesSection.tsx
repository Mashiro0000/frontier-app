import { useEffect, useState } from 'react'
import type { UpdateChangeResult, UpdateStatus } from '../../../shared/updates'

const NO_ANSWER = 'the app did not answer'
const WAITING = 'Waiting for your answer in the Windows message box...'

type Notice = { kind: 'ok' | 'error'; text: string }

const when = (ms: number): string =>
  new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
const megabytes = (bytes: number): string => `${(bytes / (1024 * 1024)).toFixed(1)} MB`

/**
 * "Updates" in Settings (Stage 18.6, D-050): the daily check's switch, "Check now", what the last check found, and "Install..." for a newer signed version. Main keeps
 * everything (updates.json) and decides; the page only shows it and asks. Switching ON and installing are asked in the system's own message box, which this page cannot
 * answer; OFF is at once.
 */
function UpdatesSection({ open }: { open: boolean }): React.JSX.Element {
  const [status, setStatus] = useState<UpdateStatus | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [busy, setBusy] = useState(false)
  const [starting, setStarting] = useState(false)

  async function reload(): Promise<void> {
    try {
      setStatus(await window.api.updates.status())
    } catch {
      setNotice({ kind: 'error', text: `The update settings could not be read: ${NO_ANSWER}.` })
    }
  }

  useEffect(() => {
    if (!open) return
    let live = true
    window.api.updates.status().then(
      (next) => {
        if (live) setStatus(next)
      },
      () => {
        if (live)
          setNotice({ kind: 'error', text: `The update settings could not be read: ${NO_ANSWER}.` })
      }
    )
    return () => {
      live = false
    }
  }, [open])

  // While main checks or downloads, the section looks again every second (the result arrives in main, not here).
  useEffect(() => {
    if (!open || status?.busy == null) return
    const timer = setInterval(() => void reload(), 1000)
    return () => clearInterval(timer)
  }, [open, status?.busy])

  async function change(
    send: () => Promise<UpdateChangeResult>,
    waits: boolean,
    done: string
  ): Promise<void> {
    setBusy(true)
    setNotice(waits ? { kind: 'ok', text: WAITING } : null)
    let result: UpdateChangeResult
    try {
      result = await send()
    } catch {
      result = { ok: false, error: `The update settings could not be changed: ${NO_ANSWER}.` }
    }
    setBusy(false)
    if (result.ok) {
      setStatus(result.status)
      setNotice({ kind: 'ok', text: done })
    } else {
      setNotice({ kind: 'error', text: result.error })
      void reload()
    }
  }

  const finding = status?.finding ?? { kind: 'none' as const }

  return (
    <section
      className="settings-section updates-section"
      aria-labelledby="settings-updates-heading"
    >
      <h3 id="settings-updates-heading" className="settings-heading">
        Updates
      </h3>
      <p className="settings-hint settings-lead">
        Off until you turn it on. Nothing about you or your chats is sent.
      </p>
      <p className="settings-hint settings-more">
        Off until you turn it on. When on, the app asks {status?.source ?? 'the releases page'} once
        a day for one small file that names the newest version; nothing about you or your chats is
        sent. A newer version is installed only after you say yes in a Windows message box, and only
        if it is signed with the release key built into this app.
      </p>

      {notice !== null && (
        <p
          className={`settings-notice${notice.kind === 'error' ? ' settings-notice-error' : ''}`}
          role={notice.kind === 'error' ? 'alert' : 'status'}
        >
          {notice.text}
        </p>
      )}

      {status === null && <p className="settings-status">Reading the update settings...</p>}

      {status !== null && status.problem !== null && (
        <div className="tools-problem" role="alert">
          <p>
            Your update settings could not be read ({status.problem}), so checking for updates is
            off and cannot be turned on. The app keeps a copy of the file.
          </p>
          {starting ? (
            <span className="tools-confirm">
              Start again with checking off?{' '}
              <button
                type="button"
                className="history-button"
                disabled={busy}
                onClick={() => {
                  setStarting(false)
                  void change(
                    () => window.api.updates.reset(),
                    false,
                    'The update settings start again: checking for updates is off.'
                  )
                }}
              >
                Yes, start again
              </button>{' '}
              <button type="button" className="history-button" onClick={() => setStarting(false)}>
                No
              </button>
            </span>
          ) : (
            <button
              type="button"
              className="history-button"
              disabled={busy}
              onClick={() => setStarting(true)}
            >
              Start again...
            </button>
          )}
        </div>
      )}

      {status !== null && (
        <ul className="tools-switches" aria-label="Updates">
          <li className="tools-switch">
            <div className="tools-switch-text">
              <span className="tools-switch-title">Check for updates once a day</span>
              <span className="tools-hint updates-version">
                This is version {status.version}.{' '}
                {status.lastCheck !== null
                  ? `Last checked ${when(status.lastCheck)}.`
                  : 'Not checked yet.'}
              </span>
              {!status.hasKey && (
                <span className="tools-hint updates-no-key">
                  This build has no release key, so it cannot accept an update.
                </span>
              )}
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={status.on}
              aria-label="Check for updates once a day"
              className={`tools-toggle${status.on ? ' tools-toggle-on' : ''}`}
              disabled={busy || status.problem !== null || (!status.on && !status.hasKey)}
              onClick={() =>
                void change(
                  () => window.api.updates.setOn(!status.on),
                  !status.on,
                  status.on ? 'Checking for updates is off.' : 'Checking for updates is on.'
                )
              }
            >
              {status.on ? 'On' : 'Off'}
            </button>
          </li>
        </ul>
      )}

      {status !== null && status.on && (
        <div className="updates-actions">
          <button
            type="button"
            className="history-button updates-check-now"
            disabled={busy || status.busy !== null}
            onClick={() =>
              void change(() => window.api.updates.checkNow(), false, 'The check is done.')
            }
          >
            {status.busy === 'checking' ? 'Checking...' : 'Check now'}
          </button>
        </div>
      )}

      {status !== null && status.busy === 'downloading' && (
        <p className="settings-status updates-progress" role="status">
          Downloading the update... {Math.round((status.progress ?? 0) * 100)}%
        </p>
      )}

      {finding.kind === 'available' && status !== null && (
        <div className="updates-available" role="note">
          <p className="settings-hint">
            Version {finding.version} ({finding.date}, {megabytes(finding.sizeBytes)}) is available.
          </p>
          {finding.notes.trim() !== '' && <p className="updates-notes">{finding.notes}</p>}
          <button
            type="button"
            className="history-button updates-install"
            disabled={busy || status.busy !== null}
            onClick={() =>
              void change(
                () => window.api.updates.install(),
                true,
                'The update is being installed.'
              )
            }
          >
            Install...
          </button>
        </div>
      )}
      {(finding.kind === 'current' || finding.kind === 'refused' || finding.kind === 'failed') && (
        <p
          className={`settings-hint updates-finding${finding.kind === 'current' ? '' : ' settings-notice-error'}`}
          role={finding.kind === 'current' ? 'status' : 'alert'}
        >
          {finding.text}
        </p>
      )}
    </section>
  )
}

export default UpdatesSection
