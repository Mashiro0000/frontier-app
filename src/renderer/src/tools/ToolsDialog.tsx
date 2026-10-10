import { useLayoutEffect, useRef, useState } from 'react'
import { outcomeText, type AuditCall } from '../../../shared/audit'
import SwitchesSection from './SwitchesSection'
import ChangesSection from './ChangesSection'
import RunProgramsSection from './RunProgramsSection'
import WorkspaceSection from './WorkspaceSection'
import type { AuditState } from './useAudit'
import type { ToolSettingsState } from './useToolSettings'

const NO_ANSWER = 'the app did not answer'
const WAITING = 'Waiting for your answer in the Windows message box...'
const fmt = (n: number): string => n.toLocaleString('en-US')

type Notice = { kind: 'ok' | 'error'; text: string }

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

interface ToolsDialogProps {
  open: boolean
  audit: AuditState
  /** Which tools are on and the caps (D-041, 11.4), as main has them. */
  settings: ToolSettingsState
  onClose: () => void
}

/**
 * The Tools page (D-041). It holds the switches (which tools the model may ask for, off until the person turns one on) and the caps on one reply (11.4), and the
 * audit log: every tool call the model asked for, what it asked, why, what the person answered and how it ended. Main keeps the settings and the log and the
 * page only shows them and asks for a change. Switching a tool on, raising a cap and deleting the log are asked about in the system's own message box, which
 * this page cannot answer.
 */
function ToolsDialog({ open, audit, settings, onClose }: ToolsDialogProps): React.JSX.Element {
  const dialogRef = useRef<HTMLDialogElement>(null)
  // While main is working (the system's message box may be open), Escape does not close the dialog: the answer is still to come.
  const busyRef = useRef(false)

  useLayoutEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    else if (!open && dialog.open) dialog.close()
  }, [open])

  return (
    <dialog
      ref={dialogRef}
      className="tools"
      aria-labelledby="tools-title"
      onCancel={(event) => {
        if (busyRef.current) event.preventDefault()
      }}
      onClose={() => {
        busyRef.current = false
        onClose()
      }}
    >
      <h2 id="tools-title" className="tools-heading">
        Tools
      </h2>
      {open && (
        <ToolsBody
          audit={audit}
          settings={settings}
          onBusy={(on) => {
            busyRef.current = on
          }}
          onClose={() => dialogRef.current?.close()}
        />
      )}
    </dialog>
  )
}

interface ToolsBodyProps {
  audit: AuditState
  settings: ToolSettingsState
  onBusy: (busy: boolean) => void
  onClose: () => void
}

function ToolsBody({ audit, settings, onBusy, onClose }: ToolsBodyProps): React.JSX.Element {
  const { view } = audit
  const [notice, setNotice] = useState<Notice | null>(null)
  const [busy, setBusy] = useState(false)

  function working(on: boolean): void {
    setBusy(on)
    onBusy(on)
  }

  /** "Export...": main opens the system's save dialog and writes one plain text file; the page learns where. */
  async function exportAll(): Promise<void> {
    working(true)
    setNotice(null)
    let result: Awaited<ReturnType<typeof window.api.audit.exportAll>>
    try {
      result = await window.api.audit.exportAll()
    } catch {
      result = { ok: false, error: `The audit log could not be exported: ${NO_ANSWER}.` }
    }
    working(false)
    if (result.ok) {
      setNotice({
        kind: 'ok',
        text: `Exported ${result.calls === 1 ? '1 call' : `${fmt(result.calls)} calls`} to ${result.where}. It is a plain text file: keep it somewhere safe.${result.older ? ' The log also holds older calls that are not in it.' : ''}`
      })
    } else if (!result.cancelled) {
      setNotice({ kind: 'error', text: result.error })
    }
  }

  /** "Delete all...": main asks in the system's own message box; nothing is deleted without a yes there. */
  async function deleteAll(): Promise<void> {
    working(true)
    setNotice({ kind: 'ok', text: WAITING })
    let result: Awaited<ReturnType<typeof window.api.audit.deleteAll>>
    try {
      result = await window.api.audit.deleteAll()
    } catch {
      result = { ok: false, error: `The audit log could not be deleted: ${NO_ANSWER}.` }
    }
    working(false)
    if (result.ok) {
      setNotice({ kind: 'ok', text: 'The audit log was deleted.' })
      audit.reload()
    } else {
      setNotice({ kind: result.cancelled ? 'ok' : 'error', text: result.error })
    }
  }

  const calls: AuditCall[] = view !== null && view.ok ? view.calls : []
  const hidden = view !== null && view.ok ? view.total - view.calls.length : 0

  return (
    <div className="tools-body">
      <SwitchesSection settings={settings} busy={busy} working={working} />
      <WorkspaceSection settings={settings} busy={busy} working={working} />
      <RunProgramsSection settings={settings} busy={busy} working={working} />
      <ChangesSection settings={settings} busy={busy} working={working} />
      <section className="tools-section" aria-labelledby="tools-audit-title">
        <h3 id="tools-audit-title" className="tools-section-title">
          Audit log
        </h3>
        <p className="tools-hint">
          Every time the model asks for a tool, the app writes it here: what it asked, why, what you
          answered and how it ended. The log holds no page text. It is kept on this computer
          (encrypted when your chats are) until you delete it.
        </p>

        {notice !== null && (
          <p
            className={`tools-notice${notice.kind === 'error' ? ' tools-notice-error' : ''}`}
            role={notice.kind === 'error' ? 'alert' : 'status'}
          >
            {notice.text}
          </p>
        )}

        {view === null && <p className="tools-none">Reading the audit log...</p>}
        {view !== null && !view.ok && (
          <div className="tools-problem" role="alert">
            <p>{view.error}</p>
            <button type="button" className="history-button" onClick={audit.reload}>
              Try again
            </button>
          </div>
        )}
        {view !== null && view.ok && view.skipped > 0 && (
          <p className="tools-problem" role="alert">
            {view.skipped === 1
              ? '1 line of the log could not be read'
              : `${fmt(view.skipped)} lines of the log could not be read`}
            {view.sealedClosed > 0
              ? ` (${fmt(view.sealedClosed)} of them encrypted, and this computer's key cannot open ${view.sealedClosed === 1 ? 'it' : 'them'})`
              : ''}
            . They are left in the file as they are.
          </p>
        )}
        {view !== null && view.ok && calls.length === 0 && (
          <p className="tools-none">
            Nothing has been recorded yet: no tool has been asked for.
          </p>
        )}

        {calls.length > 0 && (
          <ul className="tools-calls" aria-label="Tool calls, newest first">
            {calls.map((call) => (
              <li key={call.id} className="tools-call">
                <div className="tools-call-head">
                  <span className="tools-call-title">{call.title}</span>
                  <span className="tools-call-when">
                    {when(call.at)}, step {call.step}
                  </span>
                </div>
                {call.args !== null && (
                  <ul className="tools-args" aria-label="What was asked">
                    {Object.entries(call.args).map(([name, value]) => (
                      <li key={name}>
                        <span className="tools-arg-name">{name}</span>{' '}
                        <span className="tools-arg-value">
                          {typeof value === 'number' ? String(value) : `“${value}”`}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                {call.why !== null && (
                  <p className="tools-why">The model&apos;s reason: {call.why}</p>
                )}
                <p className={`tools-outcome tools-outcome-${call.outcome.kind}`}>
                  {outcomeText(call.outcome, call.tool)}
                </p>
                {call.outcome.kind === 'done' && call.outcome.sources.length > 0 && (
                  <ul className="tools-sources" aria-label="Sources that came back">
                    {call.outcome.sources.map((source) => (
                      <li key={source.url} className="tools-source">
                        <span className="tools-source-title">{source.title}</span>
                        <span className="tools-source-url">{source.url}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
        {hidden > 0 && (
          <p className="tools-hint">
            {fmt(hidden)} older {hidden === 1 ? 'call is' : 'calls are'} in the log and not shown
            here. Export the log to read {hidden === 1 ? 'it' : 'them'}.
          </p>
        )}
        {view !== null && view.ok && view.older && (
          <p className="tools-hint">
            The log also holds older calls than the ones read here. They stay in the file.
          </p>
        )}
      </section>

      <div className="tools-footer">
        <button
          type="button"
          className="history-button"
          disabled={busy || view === null || !view.ok || view.total === 0}
          onClick={() => void exportAll()}
        >
          Export...
        </button>
        <button
          type="button"
          className="history-button"
          disabled={busy || view === null || !view.ok || (view.total === 0 && view.skipped === 0)}
          onClick={() => void deleteAll()}
        >
          Delete all...
        </button>
        <button type="button" className="button" disabled={busy} onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  )
}

export default ToolsDialog
