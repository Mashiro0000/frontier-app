import { useLayoutEffect, useRef } from 'react'
import { formatCost, formatTokens, largeRequestFigures } from '../settings/format'
import type { LargeRequest } from './types'

interface LargeRequestDialogProps {
  /** The large request that is waiting for the person's yes (D-032), or null when none is. */
  request: LargeRequest | null
  /** What to call the model that would answer. */
  modelName: (modelId: string) => string
  /** The person's answer: true to send the request, false not to. Escape is "no". */
  onAnswer: (yes: boolean) => void
}

/**
 * The question before a very large request (D-032). The main process has NOT sent it: it worked out what it could cost at the most, kept the
 * request, and waits for this answer. The figures are main's own, shown as they are (the page works out nothing). The first button the
 * keyboard reaches is "Don't send", so Enter alone cannot send a large request. Escape, and closing the dialog any other way, answer no.
 */
function LargeRequestDialog({
  request,
  modelName,
  onAnswer
}: LargeRequestDialogProps): React.JSX.Element {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const declineRef = useRef<HTMLButtonElement>(null)
  const open = request !== null

  // The parent decides whether the dialog is open; the <dialog> element does the modal work (see SettingsDialog).
  useLayoutEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) {
      dialog.showModal()
      declineRef.current?.focus() // the safe button first
    } else if (!open && dialog.open) {
      dialog.close()
    }
  }, [open])

  const figures = request === null ? null : largeRequestFigures(request.estimate)

  return (
    <dialog
      ref={dialogRef}
      className="large-request"
      role="alertdialog"
      aria-labelledby="large-request-title"
      aria-describedby="large-request-intro"
      // Escape (or anything else that closes it) while the question is open is "no". When the question has already been answered the dialog
      // is closed by the effect above, and `request` is null by then, so this does nothing.
      onClose={() => {
        if (request !== null) onAnswer(false)
      }}
    >
      <h2 id="large-request-title" className="settings-title">
        Send this large request?
      </h2>
      {request !== null && figures !== null && (
        <>
          <p id="large-request-intro" className="settings-hint large-request-intro">
            Nothing has been sent yet. {modelName(request.model)} would read the whole conversation
            again, and write a reply. At list prices, this is the most the request could cost:
          </p>
          {/* Two columns, the tokens under the label: three columns did not fit a window 280 px wide. */}
          <table className="settings-usage large-request-table">
            <tbody>
              <tr>
                <th scope="row">
                  Sending the conversation
                  <span className="large-request-tokens">
                    about {formatTokens(request.estimate.inputTokens)} tokens
                  </span>
                </th>
                <td className="settings-usage-cost">up to {figures.input}</td>
              </tr>
              <tr>
                <th scope="row">
                  The reply
                  <span className="large-request-tokens">
                    at most {formatTokens(request.estimate.outputTokens)} tokens
                  </span>
                </th>
                <td className="settings-usage-cost">up to {figures.output}</td>
              </tr>
              <tr className="large-request-total">
                <th scope="row">The most it could cost</th>
                <td className="settings-usage-cost">{figures.total}</td>
              </tr>
            </tbody>
          </table>
          <p className="settings-hint">
            A reply is usually much shorter than its limit (its thinking counts towards it), and a
            conversation your provider still holds in its cache, from a message a few minutes ago,
            costs much less to send. These are the app&apos;s own guesses at list prices; your
            provider&apos;s invoice decides.
          </p>
          <p className="settings-hint">
            The app asks when sending the conversation could cost more than{' '}
            {formatCost(request.askAboveUsd)}. You can change that in Settings.
          </p>
          <div className="settings-actions large-request-actions">
            <button
              ref={declineRef}
              type="button"
              className="button button-secondary"
              onClick={() => onAnswer(false)}
            >
              Don&apos;t send
            </button>
            <button type="button" className="button" onClick={() => onAnswer(true)}>
              Send
            </button>
          </div>
        </>
      )}
    </dialog>
  )
}

export default LargeRequestDialog
