import { useState } from 'react'
import type { AppliedChange } from '../../../shared/changes'
import type { ToolSettingsState } from './useToolSettings'

type Notice = { kind: 'ok' | 'error'; text: string }
const fmt = (n: number): string => n.toLocaleString('en-US')

const STATE_TEXT: Readonly<Record<AppliedChange['state'], string>> = {
  undoable: 'The file is still as the change wrote it, so it can be undone.',
  changed: 'The file was changed after this, so it cannot be undone (that would lose what was written since).',
  gone: 'The file is not there any more.',
  unavailable: 'The file is not available now (the workspace was changed or cleared).',
  undone: 'Undone.'
}

/** "7 Oct 2026, 14:05", this computer's time. */
function when(ms: number): string {
  return new Date(ms).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

interface ChangesSectionProps {
  settings: ToolSettingsState
  /** Another request of this page is out: nothing else is started meanwhile. */
  busy: boolean
  /** Tells the page that a request is out, so that Escape does not close it while an answer is still to come. */
  working: (on: boolean) => void
}

/**
 * The changes the model has proposed and nobody has decided on (D-042, 12.5), on the Tools page under the code workspace. The page sees only a summary of each: the
 * path, what kind, the counts and the warnings, never a line of the change. "Review..." asks main to open the Review window, a window of its own that this page
 * cannot script and where the whole change is shown and applied or dropped; this page has no button that applies or drops anything. Proposals are held in memory
 * and are gone when the app closes.
 */
function ChangesSection({ settings, busy, working }: ChangesSectionProps): React.JSX.Element {
  const { changes, applied } = settings
  const [notice, setNotice] = useState<Notice | null>(null)

  async function review(id: string): Promise<void> {
    setNotice(null)
    try {
      const result = await window.api.changes.review(id)
      if (!result.ok) setNotice({ kind: 'error', text: result.error })
    } catch {
      setNotice({ kind: 'error', text: 'The Review window could not be opened: the app did not answer.' })
    }
    settings.reload()
  }

  /** Asks main to undo a change, or to delete the history: each asks in the system's own box, which this page cannot answer. */
  async function ask(
    send: () => Promise<{ ok: true; message?: string } | { ok: false; error: string }>
  ): Promise<void> {
    working(true)
    setNotice({ kind: 'ok', text: 'Waiting for your answer in the Windows message box...' })
    try {
      const result = await send()
      setNotice(
        result.ok
          ? { kind: 'ok', text: result.message ?? 'Done.' }
          : { kind: 'error', text: result.error }
      )
    } catch {
      setNotice({ kind: 'error', text: 'The app did not answer.' })
    }
    working(false)
    settings.reload()
  }

  return (
    <section className="tools-section" aria-labelledby="tools-changes-title">
      <h3 id="tools-changes-title" className="tools-section-title">
        Changes waiting
      </h3>
      <p className="tools-hint">
        When the model proposes a change to a file, it waits here. Nothing is written until you
        open it, read the whole difference in the Review window and apply it there. The model
        cannot apply a change, and a change is gone when the app is closed. A change you applied
        stays in the list below, where you can undo it while the file is still exactly as the
        change wrote it.
      </p>

      {notice !== null && (
        <p
          className={`tools-notice${notice.kind === 'error' ? ' tools-notice-error' : ''}`}
          role={notice.kind === 'error' ? 'alert' : 'status'}
        >
          {notice.text}
        </p>
      )}

      {changes === null && <p className="tools-none">Reading the waiting changes...</p>}
      {changes !== null && changes.length === 0 && (
        <p className="tools-none">No changes are waiting.</p>
      )}

      {changes !== null && changes.length > 0 && (
        <ul className="tools-switches" aria-label="Changes waiting">
          {changes.map((change) => (
            <li key={change.id} className="tools-switch change-row">
              <div className="tools-switch-text">
                <span className="tools-switch-title">
                  {change.kind === 'create' ? 'New file' : 'Change'}:{' '}
                  <span className="workspace-path">{change.path}</span>
                </span>
                <span className="tools-hint">
                  {change.added === 1 ? '1 line added' : `${fmt(change.added)} lines added`},{' '}
                  {change.removed} removed; the file would be {fmt(change.bytes)} bytes.
                </span>
                {change.secret && (
                  <span className="tools-hint tools-notice-error">
                    A hidden file or one that looks like it holds secrets.
                  </span>
                )}
                {change.runsCommands && (
                  <span className="tools-hint change-warning">
                    A file that runs commands when it is used.
                  </span>
                )}
              </div>
              <button
                type="button"
                className="history-button"
                disabled={busy}
                onClick={() => void review(change.id)}
              >
                Review...
              </button>
            </li>
          ))}
        </ul>
      )}
      {applied !== null && applied.length > 0 && (
        <>
          <h4 className="tools-switch-title">Changes you applied</h4>
          <ul className="tools-switches" aria-label="Changes applied">
            {applied.map((change) => (
              <li key={change.id} className="tools-switch change-row">
                <div className="tools-switch-text">
                  <span className="tools-switch-title">
                    {change.kind === 'create' ? 'New file' : 'Change'}:{' '}
                    <span className="workspace-path">{change.path}</span>
                  </span>
                  <span className="tools-hint">
                    {when(change.at)}; {fmt(change.bytes)} bytes written.{' '}
                    {STATE_TEXT[change.state]}
                  </span>
                </div>
                {change.state === 'undoable' && (
                  <button
                    type="button"
                    className="history-button"
                    disabled={busy}
                    onClick={() => void ask(() => window.api.changes.undo(change.id))}
                  >
                    Undo...
                  </button>
                )}
              </li>
            ))}
          </ul>
          <div>
            <button
              type="button"
              className="history-button"
              disabled={busy}
              onClick={() => void ask(() => window.api.changes.clearHistory())}
            >
              Delete the undo history...
            </button>
          </div>
        </>
      )}
    </section>
  )
}

export default ChangesSection
