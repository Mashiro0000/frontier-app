import { useEffect, useState } from 'react'
import type {
  ProgramsChangeResult,
  ProgramsStatus,
  SelfTestReport
} from '../../../shared/programs'
import type { ToolSettingsState } from './useToolSettings'

const NO_ANSWER = 'the app did not answer'
const TESTING =
  'Testing the box on this PC (about half a minute), then you are asked in a Windows message box...'
/** How often the page asks main again while a self-test that it did not start itself (the one at start-up) is going on. */
const POLL_MS = 2000

type Notice = { kind: 'ok' | 'error'; text: string }

interface RunProgramsSectionProps {
  settings: ToolSettingsState
  /** Another request of this page is out (the audit log's, the switches' or this section's own): nothing else is started meanwhile. */
  busy: boolean
  /** Tells the page that a request is out, so that Escape does not close it while an answer is still to come. */
  working: (on: boolean) => void
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

/** What the last self-test found, line by line: the thing a boxed program must not be able to do, and whether it was stopped. */
function Report({ report }: { report: SelfTestReport }): React.JSX.Element {
  return (
    <div className="programs-report">
      <p className="tools-hint">
        {report.ok ? 'Passed' : 'Did not pass'}: the test of {when(report.at)}
        {report.message !== null ? ` (${report.message})` : ''}.
      </p>
      {report.lines.length > 0 && (
        <ul className="programs-lines" aria-label="Self-test results">
          {report.lines.map((line) => (
            <li key={line.id} className={line.good ? 'programs-good' : 'programs-bad'}>
              <span aria-hidden="true">{line.good ? '✓' : '✗'}</span>{' '}
              <span className="programs-label">{line.label}</span>{' '}
              <span className="tools-hint">
                {line.good ? 'Good' : 'NOT AS IT MUST BE'}. {line.detail}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/**
 * Running programs on the Tools page (D-043, 13.5): the switch that lets the model ask to run ONE program on a copy of a folder of the workspace, in a locked box.
 * Switching it on makes a SELF-TEST first (a small program is put in the box and tries to read your files, write outside its copy, reach the network, run for ever
 * and use too much memory); if any of it is not stopped, the switch stays off, and there is no way to run a program without the box. Then main asks in the system's
 * own message box, which this page cannot answer. Switching it off is done at once. Main keeps the setting and makes the test; this page only shows them.
 */
function RunProgramsSection({
  settings,
  busy,
  working
}: RunProgramsSectionProps): React.JSX.Element {
  const { programs, reload } = settings
  const [notice, setNotice] = useState<Notice | null>(null)
  const [testing, setTesting] = useState(false)
  const [shown, setShown] = useState<SelfTestReport | null>(null)
  const testingAtMain = programs !== null && programs.testing

  // A test that main made by itself (at start-up, after a folder was chosen) takes a while: ask again until it is over.
  useEffect(() => {
    if (!testingAtMain || testing) return
    const timer = setTimeout(reload, POLL_MS)
    return () => clearTimeout(timer)
  }, [testingAtMain, testing, programs, reload])

  async function change(
    send: () => Promise<ProgramsChangeResult>,
    turningOn: boolean
  ): Promise<void> {
    working(true)
    setTesting(turningOn)
    setNotice(turningOn ? { kind: 'ok', text: TESTING } : null)
    let result: ProgramsChangeResult
    try {
      result = await send()
    } catch {
      result = { ok: false, error: `Running programs could not be changed: ${NO_ANSWER}.` }
    }
    working(false)
    setTesting(false)
    if (result.test !== undefined) setShown(result.test)
    if (result.ok) {
      settings.setPrograms(result.status)
      setNotice({
        kind: 'ok',
        text: result.status.on ? 'Running programs is on.' : 'Running programs is off.'
      })
    } else {
      setNotice({ kind: result.cancelled ? 'ok' : 'error', text: result.error })
    }
    reload()
  }

  async function stopTest(): Promise<void> {
    try {
      await window.api.programs.stopTest()
    } catch {
      /* the test goes on, or is over: the status says */
    }
    reload()
  }

  const status: ProgramsStatus | null = programs
  const report = shown ?? status?.test ?? null
  const ready = status !== null && status.workspaceReady && status.nodeInstalled
  const testGoingOn = testing || testingAtMain

  return (
    <section className="tools-section" aria-labelledby="tools-programs-title">
      <h3 id="tools-programs-title" className="tools-section-title">
        Run programs
      </h3>
      <p className="tools-hint">
        When this is on, the model can ask to run ONE program (for example node) on a copy of a
        folder of your workspace, in a locked box. Every run asks you first in a Windows message
        box, with &ldquo;Don&rsquo;t run it&rdquo; as the default, and shows the program, its
        arguments and the folder. The box has no network, cannot read or change anything but the
        copy, and ends a program after 120 seconds or 1 GB. Text files the program changes or makes
        come back as proposals that you review first. To switch it on, the app first tests the box
        on this PC; if any check fails, it stays off.
      </p>

      {notice !== null && (
        <p
          className={`tools-notice${notice.kind === 'error' ? ' tools-notice-error' : ''}`}
          role={notice.kind === 'error' ? 'alert' : 'status'}
        >
          {notice.text}
        </p>
      )}

      {status === null && <p className="tools-none">Reading the setting...</p>}

      {status !== null && status.problem !== null && (
        <div className="tools-problem" role="alert">
          <p>{status.problem}</p>
        </div>
      )}

      {status !== null && (
        <>
          <ul className="tools-switches" aria-label="Run programs">
            <li className="tools-switch">
              <div className="tools-switch-text">
                <span className="tools-switch-title">Let the model run programs</span>
                <span className="tools-hint">
                  {!status.workspaceReady
                    ? 'Choose a workspace folder first (above).'
                    : !status.nodeInstalled
                      ? 'Node.js is not installed on this PC, and the test needs it.'
                      : testGoingOn
                        ? 'Testing the box...'
                        : 'Each run asks you once, in a Windows message box.'}
                </span>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={status.on}
                aria-label="Let the model run programs"
                className={`tools-toggle${status.on ? ' tools-toggle-on' : ''}`}
                disabled={busy || testGoingOn || (!status.on && !ready)}
                onClick={() =>
                  void change(() => window.api.programs.setOn(!status.on), !status.on)
                }
              >
                {status.on ? 'On' : 'Off'}
              </button>
            </li>
          </ul>
          {testGoingOn && (
            <div className="programs-stop">
              <button type="button" className="history-button" onClick={() => void stopTest()}>
                Stop the test
              </button>
            </div>
          )}
          {report !== null && <Report report={report} />}
        </>
      )}
    </section>
  )
}

export default RunProgramsSection
