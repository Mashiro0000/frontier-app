import { useState } from 'react'
import type { ToolSettingsState } from './useToolSettings'

type Notice = { kind: 'ok' | 'error'; text: string }
const fmt = (n: number): string => n.toLocaleString('en-US')

interface ChangesSectionProps {
  settings: ToolSettingsState
  /** Another request of this page is out: nothing else is started meanwhile. */
  busy: boolean
}

/**
 * The changes the model has proposed and nobody has decided on (D-042, 12.5), on the Tools page under the code workspace. The page sees only a summary of each: the
 * path, what kind, the counts and the warnings, never a line of the change. "Review..." asks main to open the Review window, a window of its own that this page
 * cannot script and where the whole change is shown and applied or dropped; this page has no button that applies or drops anything. Proposals are held in memory
 * and are gone when the app closes.
 */
function ChangesSection({ settings, busy }: ChangesSectionProps): React.JSX.Element {
  const { changes } = settings
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

  return (
    <section className="tools-section" aria-labelledby="tools-changes-title">
      <h3 id="tools-changes-title" className="tools-section-title">
        Changes waiting
      </h3>
      <p className="tools-hint">
        When the model proposes a change to a file, it waits here. Nothing is written until you
        open it, read the whole difference in the Review window and apply it there. The model
        cannot apply a change, and a change is gone when the app is closed.
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
    </section>
  )
}

export default ChangesSection
