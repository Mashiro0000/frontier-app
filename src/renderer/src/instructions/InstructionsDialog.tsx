import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { CHAT_LIMITS } from '../../../shared/ipc'
import { checkInstructions } from '../../../shared/validate'

const MAX_CHARS = CHAT_LIMITS.maxInstructionsChars
const formatChars = (count: number): string => count.toLocaleString('en-US')

interface InstructionsFormProps {
  /** What the chat has now: '' for none. */
  initial: string
  onSave: (instructions: string) => void
  onCancel: () => void
}

/**
 * The box and the buttons. It exists only while the dialog is open, so what is typed here is a draft: it starts from what the chat has
 * now, and is gone when the dialog closes without Save (Escape and Cancel throw it away).
 */
function InstructionsForm({ initial, onSave, onCancel }: InstructionsFormProps): React.JSX.Element {
  const [draft, setDraft] = useState(initial)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // The cursor goes to the end of the text, so that typing adds to what is there.
  useEffect(() => {
    const input = inputRef.current
    if (!input) return
    input.focus()
    input.setSelectionRange(input.value.length, input.value.length)
  }, [])

  // The same rule main applies (D-027): trimmed, and not longer than the limit. The count is of the trimmed text, the text that is kept.
  const checked = checkInstructions(draft)
  const text = checked.ok ? checked.instructions : draft.trim()
  const tooMany = text.length - MAX_CHARS
  const turningOff = text === '' && initial !== ''
  const canSave = checked.ok && text !== initial

  function submit(): void {
    if (canSave && checked.ok) onSave(checked.instructions)
  }

  return (
    <form
      className="instructions-form"
      onSubmit={(event) => {
        event.preventDefault()
        submit()
      }}
    >
      {/* Only this part scrolls when the window is short: the buttons below it stay in view, as in the History dialog. */}
      <div className="instructions-body">
        <p className="instructions-hint">
          Tell the model how to answer in this chat: who it should act as, how long or in what style
          to write, what to leave out. To turn the instructions off, empty the box and press the
          button.
        </p>
        <label className="instructions-label" htmlFor="instructions-input">
          Instructions
        </label>
        <textarea
          id="instructions-input"
          ref={inputRef}
          className="instructions-input"
          rows={7}
          value={draft}
          placeholder="For example: Answer in short, plain sentences. If my question is unclear, ask me what I mean before you answer."
          onChange={(event) => setDraft(event.target.value)}
        />
        {tooMany > 0 ? (
          <p className="instructions-count instructions-count-over" role="alert">
            {formatChars(text.length)} of {formatChars(MAX_CHARS)} characters:{' '}
            {formatChars(tooMany)} too many to save. They are sent with every message, so they are
            kept short.
          </p>
        ) : (
          <p className="instructions-count">
            {formatChars(text.length)} of {formatChars(MAX_CHARS)} characters
          </p>
        )}
        <p className="instructions-hint instructions-warning">
          What you write here is added to the app&apos;s own short rules and sent with every message
          of this chat, to the company that runs the model that answers (if you change the model, to
          that company). It is billed as part of the conversation, and saved as plain text in this
          chat&apos;s file on this computer, like the messages. Do not put passwords or keys here. A
          new chat starts without instructions.
        </p>
      </div>
      <div className="instructions-footer">
        <button type="button" className="button button-secondary" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="button" disabled={!canSave}>
          {turningOff ? 'Turn off' : 'Save'}
        </button>
      </div>
    </form>
  )
}

interface InstructionsDialogProps {
  open: boolean
  /** The instructions the chat has now: '' for none. */
  instructions: string
  /** The person pressed Save with text that passed the check, or emptied the box to turn the instructions off (''). */
  onSave: (instructions: string) => void
  onClose: () => void
}

/**
 * The person's own instructions for this chat (D-027): a text box in a dialog, opened from the header. The instructions are added to
 * the app's rules by the main process and sent with every request of this chat; this dialog says so, and says who gets them and where
 * they are kept. Nothing is changed until Save.
 */
function InstructionsDialog({
  open,
  instructions,
  onSave,
  onClose
}: InstructionsDialogProps): React.JSX.Element {
  const dialogRef = useRef<HTMLDialogElement>(null)

  // The parent decides whether the dialog is open; the <dialog> element does the modal work (see SettingsDialog). A layout effect, so the
  // dialog is already open when the form's own effect puts the cursor in the box.
  useLayoutEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    else if (!open && dialog.open) dialog.close()
  }, [open])

  const close = (): void => dialogRef.current?.close()

  return (
    <dialog
      ref={dialogRef}
      className="instructions"
      aria-labelledby="instructions-title"
      onClose={onClose}
    >
      <h2 id="instructions-title" className="instructions-heading">
        Instructions for this chat
      </h2>
      {open && (
        <InstructionsForm
          initial={instructions}
          onSave={(text) => {
            onSave(text)
            close()
          }}
          onCancel={close}
        />
      )}
    </dialog>
  )
}

export default InstructionsDialog
