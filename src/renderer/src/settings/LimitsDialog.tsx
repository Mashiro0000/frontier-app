import { useLayoutEffect, useRef } from 'react'
import type { SettingsStatus } from '../../../shared/ipc'
import type { Limits } from '../../../shared/limits'
import LimitsForm from './LimitsForm'

interface LimitsDialogProps {
  open: boolean
  /** The limits as saved: not chosen yet, when this dialog is asked for. */
  limits: Limits
  /** Called with the new settings after the limits are saved. */
  onSaved: (status: SettingsStatus) => void
  /** The person closed the dialog (Not now, or Escape), whether or not they saved. */
  onClose: () => void
}

/**
 * Asked for before the first message (D-031): how much this app may spend, a daily and a monthly limit, in dollars. Nothing is filled in
 * for the person. It can be put off ("Not now"): the main process then refuses every request, with a sentence that says so, until the
 * limits are set here or in Settings. Closes by itself once both limits are saved (the parent stops asking for it).
 */
function LimitsDialog({ open, limits, onSaved, onClose }: LimitsDialogProps): React.JSX.Element {
  const dialogRef = useRef<HTMLDialogElement>(null)

  // The parent decides whether the dialog is open; the <dialog> element does the modal work (see SettingsDialog).
  useLayoutEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    else if (!open && dialog.open) dialog.close()
  }, [open])

  return (
    <dialog
      ref={dialogRef}
      className="limits-dialog"
      aria-labelledby="limits-dialog-title"
      onClose={onClose}
    >
      <h2 id="limits-dialog-title" className="settings-title">
        Set your spending limits
      </h2>
      {open && (
        <>
          <p className="settings-hint limits-intro">
            Your messages are billed by the company that runs the model, to your account. Before the
            first one, choose how much this app may spend: a limit for a day and a limit for a
            month, in US dollars. The app counts what each reply costs and does not send a request
            that would pass a limit. You can change them later in Settings.
          </p>
          <LimitsForm
            limits={limits}
            idPrefix="limits-first"
            submitLabel="Save limits"
            onSaved={onSaved}
            secondary={
              <button
                type="button"
                className="button button-secondary"
                onClick={() => dialogRef.current?.close()}
              >
                Not now
              </button>
            }
          />
        </>
      )}
    </dialog>
  )
}

export default LimitsDialog
