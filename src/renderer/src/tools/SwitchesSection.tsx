import { useState } from 'react'
import {
  TOOL_CAPS_BOUNDS,
  type ToolCaps,
  type ToolChangeResult,
  type ToolsStatus
} from '../../../shared/tools'
import type { ToolSettingsState } from './useToolSettings'

const NO_ANSWER = 'the app did not answer'
const WAITING = 'Waiting for your answer in the Windows message box...'

type Notice = { kind: 'ok' | 'error'; text: string }

interface SwitchesSectionProps {
  settings: ToolSettingsState
  /** Another request of this page is out (the audit log's, or this section's own): nothing else is started meanwhile. */
  busy: boolean
  /** Tells the page that a request is out, so that Escape does not close it while an answer is still to come. */
  working: (on: boolean) => void
}

/** A whole number from what was typed, or null when it is not one. */
function wholeNumber(text: string): number | null {
  return /^\d{1,4}$/.test(text.trim()) ? Number(text.trim()) : null
}

/**
 * The top of the Tools page (D-041, 11.4): which tools the model may ask for, and the caps on one reply. Main keeps them (tools.json) and the page only shows
 * them and asks for a change. A tool switched ON and a cap raised are asked about in the system's own message box, which this page cannot answer, so a page
 * that had been taken over cannot switch a tool on; switching a tool off and lowering a cap are done at once.
 */
function SwitchesSection({ settings, busy, working }: SwitchesSectionProps): React.JSX.Element {
  const { status } = settings
  const [notice, setNotice] = useState<Notice | null>(null)
  const [starting, setStarting] = useState(false)

  /** Sends one change to main and shows what came of it. `done` says what to tell the person when it worked. */
  async function change(
    send: () => Promise<ToolChangeResult>,
    waits: boolean,
    done: (status: ToolsStatus) => string
  ): Promise<void> {
    working(true)
    setNotice(waits ? { kind: 'ok', text: WAITING } : null)
    let result: ToolChangeResult
    try {
      result = await send()
    } catch {
      result = { ok: false, error: `The tool settings could not be changed: ${NO_ANSWER}.` }
    }
    working(false)
    if (result.ok) {
      settings.setStatus(result.status)
      setNotice({ kind: 'ok', text: done(result.status) })
    } else {
      setNotice({ kind: result.cancelled ? 'ok' : 'error', text: result.error })
      settings.reload()
    }
  }

  return (
    <section className="tools-section" aria-labelledby="tools-switches-title">
      <h3 id="tools-switches-title" className="tools-section-title">
        What the model may ask for
      </h3>
      <p className="tools-hint">
        Every tool is off until you turn it on. When one is on, the model can ask to use it while it
        answers you. Each time, the call is shown to you in full in a Windows message box, and it
        runs only if you say yes there. While a reply is using a tool, its Stop button reads
        &ldquo;Stop everything&rdquo;: it ends the reply, stops the tool and closes a question that
        is waiting.
      </p>

      {notice !== null && (
        <p
          className={`tools-notice${notice.kind === 'error' ? ' tools-notice-error' : ''}`}
          role={notice.kind === 'error' ? 'alert' : 'status'}
        >
          {notice.text}
        </p>
      )}

      {status === null && <p className="tools-none">Reading the tool settings...</p>}

      {status !== null && status.problem !== null && (
        <div className="tools-problem" role="alert">
          <p>
            Your tool settings could not be read ({status.problem}), so every tool is off and
            nothing can be turned on. The app keeps a copy of the file.
          </p>
          {starting ? (
            <span className="tools-confirm">
              Start again with every tool off?{' '}
              <button
                type="button"
                className="history-button"
                disabled={busy}
                onClick={() => {
                  setStarting(false)
                  void change(
                    () => window.api.tools.reset(),
                    false,
                    () => 'The tool settings start again: every tool is off.'
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
        <ul className="tools-switches" aria-label="Tools">
          {status.tools.map((tool) => (
            <li key={tool.id} className="tools-switch">
              <div className="tools-switch-text">
                <span className="tools-switch-title">{tool.title}</span>
                <span className="tools-hint">{tool.about}</span>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={tool.on}
                aria-label={tool.title}
                className={`tools-toggle${tool.on ? ' tools-toggle-on' : ''}`}
                disabled={busy || status.problem !== null}
                onClick={() =>
                  void change(
                    () => window.api.tools.setEnabled(tool.id, !tool.on),
                    !tool.on,
                    () => (tool.on ? `${tool.title} is off.` : `${tool.title} is on.`)
                  )
                }
              >
                {tool.on ? 'On' : 'Off'}
              </button>
            </li>
          ))}
        </ul>
      )}

      {status !== null && status.problem === null && (
        <CapsForm
          // The form starts again from what main says whenever the caps change, however they changed.
          key={`${status.caps.steps}:${status.caps.seconds}`}
          caps={status.caps}
          busy={busy}
          onSave={(caps) =>
            void change(
              () => window.api.tools.setCaps(caps),
              caps.steps > status.caps.steps || caps.seconds > status.caps.seconds,
              (now) =>
                `Saved. A reply may take at most ${now.caps.steps} tool ${now.caps.steps === 1 ? 'step' : 'steps'} and ${now.caps.seconds} seconds of tool time.`
            )
          }
        />
      )}
    </section>
  )
}

interface CapsFormProps {
  caps: ToolCaps
  busy: boolean
  onSave: (caps: ToolCaps) => void
}

function CapsForm({ caps, busy, onSave }: CapsFormProps): React.JSX.Element {
  const { steps, seconds } = TOOL_CAPS_BOUNDS
  const [stepsText, setStepsText] = useState(String(caps.steps))
  const [secondsText, setSecondsText] = useState(String(caps.seconds))
  const nextSteps = wholeNumber(stepsText)
  const nextSeconds = wholeNumber(secondsText)
  const valid =
    nextSteps !== null &&
    nextSeconds !== null &&
    nextSteps >= steps.min &&
    nextSteps <= steps.max &&
    nextSeconds >= seconds.min &&
    nextSeconds <= seconds.max
  const unchanged = valid && nextSteps === caps.steps && nextSeconds === caps.seconds

  return (
    <form
      className="tools-caps"
      aria-label="Limits for one reply"
      onSubmit={(event) => {
        event.preventDefault()
        if (valid && !unchanged && !busy) onSave({ steps: nextSteps, seconds: nextSeconds })
      }}
    >
      <p className="tools-switch-title">Limits for one reply</p>
      <div className="tools-caps-fields">
        <label className="tools-caps-field">
          <span>Tool steps</span>
          <input
            type="text"
            inputMode="numeric"
            className="tools-caps-input"
            value={stepsText}
            aria-invalid={nextSteps === null || nextSteps < steps.min || nextSteps > steps.max}
            onChange={(event) => setStepsText(event.target.value)}
          />
          <span className="tools-hint">
            {steps.min} to {steps.max}
          </span>
        </label>
        <label className="tools-caps-field">
          <span>Seconds of tool time</span>
          <input
            type="text"
            inputMode="numeric"
            className="tools-caps-input"
            value={secondsText}
            aria-invalid={
              nextSeconds === null || nextSeconds < seconds.min || nextSeconds > seconds.max
            }
            onChange={(event) => setSecondsText(event.target.value)}
          />
          <span className="tools-hint">
            {seconds.min} to {seconds.max}
          </span>
        </label>
        <button type="submit" className="history-button" disabled={busy || !valid || unchanged}>
          Save limits
        </button>
      </div>
      <p className="tools-hint">
        A reply stops when it reaches either limit, and says which. Every call counts as a step,
        also one you said no to. The time you spend deciding in the Windows box is not counted.
        Raising a limit asks you in a Windows message box; lowering one does not.
      </p>
    </form>
  )
}

export default SwitchesSection
