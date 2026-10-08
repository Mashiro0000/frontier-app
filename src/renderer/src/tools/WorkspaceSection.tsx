import { useState } from 'react'
import type { WorkspaceChangeResult } from '../../../shared/workspace'
import type { ToolSettingsState } from './useToolSettings'

const NO_ANSWER = 'the app did not answer'
const WAITING = 'Waiting for your answer in the Windows message box...'

type Notice = { kind: 'ok' | 'error'; text: string }

interface WorkspaceSectionProps {
  settings: ToolSettingsState
  /** Another request of this page is out (the audit log's, the switches' or this section's own): nothing else is started meanwhile. */
  busy: boolean
  /** Tells the page that a request is out, so that Escape does not close it while an answer is still to come. */
  working: (on: boolean) => void
}

/**
 * The code workspace on the Tools page (D-042, 12.3): the one folder the model may list and read files in, and the switch that lets it ask. Main keeps both
 * (workspace.json, tools.json) and opens the system's folder dialog itself, so this page never has a path to hand over. Choosing a folder and switching the
 * tools on are asked about in the system's own message box, which this page cannot answer; clearing the folder and switching off are done at once.
 */
function WorkspaceSection({ settings, busy, working }: WorkspaceSectionProps): React.JSX.Element {
  const { workspace } = settings
  const [notice, setNotice] = useState<Notice | null>(null)

  async function change(
    send: () => Promise<WorkspaceChangeResult>,
    waits: boolean,
    done: string
  ): Promise<void> {
    working(true)
    setNotice(waits ? { kind: 'ok', text: WAITING } : null)
    let result: WorkspaceChangeResult
    try {
      result = await send()
    } catch {
      result = { ok: false, error: `The workspace could not be changed: ${NO_ANSWER}.` }
    }
    working(false)
    if (result.ok) {
      settings.setWorkspace(result.status)
      setNotice({ kind: 'ok', text: done })
    } else {
      setNotice({ kind: result.cancelled ? 'ok' : 'error', text: result.error })
    }
    settings.reload()
  }

  const usable = workspace !== null && workspace.folder !== null && workspace.unusable === null

  return (
    <section className="tools-section" aria-labelledby="tools-workspace-title">
      <h3 id="tools-workspace-title" className="tools-section-title">
        Code workspace
      </h3>
      <p className="tools-hint">
        Choose one folder. When the switch below is on, the model can ask to list and read files in
        it and to propose changes. The first time a reply wants your files you are asked in a
        Windows message box, and your yes covers that one reply. Hidden files and files that look
        like they hold secrets are asked about one at a time, and version-control folders (.git)
        and links are never reached. Nothing is ever written to the folder in this version. What the
        model reads is sent to your AI provider.
      </p>

      {notice !== null && (
        <p
          className={`tools-notice${notice.kind === 'error' ? ' tools-notice-error' : ''}`}
          role={notice.kind === 'error' ? 'alert' : 'status'}
        >
          {notice.text}
        </p>
      )}

      {workspace === null && <p className="tools-none">Reading the workspace setting...</p>}

      {workspace !== null && workspace.problem !== null && (
        <div className="tools-problem" role="alert">
          <p>
            Your workspace setting could not be read ({workspace.problem}), so no folder is chosen.
            Choosing a folder starts it again; the app keeps a copy of the old file.
          </p>
        </div>
      )}

      {workspace !== null && (
        <>
          <div className="tools-switch workspace-folder">
            <div className="tools-switch-text">
              <span className="tools-switch-title">Workspace folder</span>
              <span className="tools-hint workspace-path" aria-label="Workspace folder path">
                {workspace.folder ?? 'No folder is chosen.'}
              </span>
              {workspace.unusable !== null && (
                <span className="tools-hint tools-notice-error" role="alert">
                  This folder cannot be used just now: {workspace.unusable}. The model cannot reach
                  it. Choose the folder again.
                </span>
              )}
            </div>
            <div className="workspace-buttons">
              <button
                type="button"
                className="history-button"
                disabled={busy}
                onClick={() =>
                  void change(
                    () => window.api.workspace.choose(),
                    true,
                    'This folder is now your workspace.'
                  )
                }
              >
                {workspace.folder === null ? 'Choose a folder...' : 'Choose another...'}
              </button>
              {workspace.folder !== null && (
                <button
                  type="button"
                  className="history-button"
                  disabled={busy}
                  onClick={() =>
                    void change(
                      () => window.api.workspace.clear(),
                      false,
                      'No folder is chosen now.'
                    )
                  }
                >
                  Clear
                </button>
              )}
            </div>
          </div>
          <ul className="tools-switches" aria-label="Workspace tools">
            <li className="tools-switch">
              <div className="tools-switch-text">
                <span className="tools-switch-title">Let the model use the workspace</span>
                <span className="tools-hint">
                  The model may ask to list and read files in the folder. Each reply asks you once.
                </span>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={workspace.on}
                aria-label="Let the model use the workspace"
                className={`tools-toggle${workspace.on ? ' tools-toggle-on' : ''}`}
                disabled={busy || (!workspace.on && !usable)}
                onClick={() =>
                  void change(
                    () => window.api.workspace.setOn(!workspace.on),
                    !workspace.on,
                    workspace.on ? 'The workspace tools are off.' : 'The workspace tools are on.'
                  )
                }
              >
                {workspace.on ? 'On' : 'Off'}
              </button>
            </li>
          </ul>
        </>
      )}
    </section>
  )
}

export default WorkspaceSection
