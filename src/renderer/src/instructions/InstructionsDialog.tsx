import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  CHAT_LIMITS,
  type CheckChatInstructionsResult,
  type EveryChatStatus,
  type SaveEveryChatResult,
  type SecretFinding
} from '../../../shared/ipc'
import { checkInstructions } from '../../../shared/validate'

const MAX_CHARS = CHAT_LIMITS.maxInstructionsChars
const formatChars = (count: number): string => count.toLocaleString('en-US')
const NO_ANSWER = 'the app did not answer'

/** The parts of the instructions, in the order they are sent (D-039): the most particular last. */
type Part = 'every' | 'chat'

const PART_TITLE: Record<Part, string> = {
  every: 'For every chat',
  chat: 'For this chat'
}

type Notice = { kind: 'ok' | 'error'; text: string }

interface InstructionsFormProps {
  /** The chat's own instructions now: '' for none. */
  initial: string
  /** The instructions for every chat as main has them, or null while they are not known. */
  everyChat: EveryChatStatus | null
  onSave: (instructions: string) => void
  /** Called with what main saved, whether or not the dialog is still open by then. */
  onEveryChatSaved: (status: EveryChatStatus) => void
  onBusy: (busy: boolean) => void
  onCancel: () => void
  onDone: () => void
}

/**
 * Every part of the instructions that goes with this chat, in the order they are sent, and ONE box to change one of them. The box starts on the chat's
 * own instructions; "Change..." moves it to another part when nothing in it is waiting to be saved. It exists only while the dialog is open, so what is
 * typed is a draft: Escape and Cancel throw it away.
 */
function InstructionsForm({
  initial,
  everyChat,
  onSave,
  onEveryChatSaved,
  onBusy,
  onCancel,
  onDone
}: InstructionsFormProps): React.JSX.Element {
  const [editing, setEditing] = useState<Part>('chat')
  const [draft, setDraft] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<Notice | null>(null)
  // Parts of the draft that main said look like a key or a password: shown masked, and the button becomes "Save anyway" until the draft changes.
  const [warnings, setWarnings] = useState<SecretFinding[] | null>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  // The cursor goes to the end of the text, so that typing adds to what is there; again whenever the box moves to another part.
  useEffect(() => {
    const input = inputRef.current
    if (!input) return
    input.focus()
    input.setSelectionRange(input.value.length, input.value.length)
  }, [editing])

  const everyText = everyChat?.text ?? ''
  const everyProblem = everyChat?.problem ?? null
  const textOf = (part: Part): string => (part === 'chat' ? initial : everyText)
  const saved = textOf(editing)

  // The same rule main applies (D-027): trimmed, and not longer than the limit. The count is of the trimmed text, the text that is kept.
  const checked = checkInstructions(draft)
  const text = checked.ok ? checked.instructions : draft.trim()
  const tooMany = text.length - MAX_CHARS
  // A file that cannot be read can always be replaced, or turned off (D-039): there is something to save even when the box shows nothing new.
  const replacing = editing === 'every' && everyProblem !== null
  const turningOff = text === '' && (saved !== '' || replacing)
  const changed = text !== saved || replacing
  const canSave = checked.ok && changed && !busy
  const unsaved = draft !== saved

  function change(part: Part): void {
    setEditing(part)
    setDraft(textOf(part))
    setNotice(null)
    setWarnings(null)
  }

  function working(on: boolean): void {
    setBusy(on)
    onBusy(on)
  }

  async function saveEvery(next: string, anyway: boolean): Promise<void> {
    working(true)
    setNotice(
      next === ''
        ? null
        : { kind: 'ok', text: 'Waiting for your answer in the Windows message box...' }
    )
    let result: SaveEveryChatResult
    try {
      result = await window.api.instructions.setEveryChat(next, anyway)
    } catch {
      result = {
        ok: false,
        error: `Your instructions for every chat could not be saved: ${NO_ANSWER}.`
      }
    }
    if (result.ok) onEveryChatSaved(result.status) // the chat bar learns of it even if the dialog has gone
    if (!mounted.current) return
    working(false)
    if (result.ok) {
      onDone()
      return
    }
    setWarnings(result.warnings ?? null)
    setNotice({ kind: result.cancelled ? 'ok' : 'error', text: result.error })
  }

  async function saveChat(next: string, anyway: boolean): Promise<void> {
    if (next === '') {
      onSave('')
      onDone()
      return
    }
    // The chat's own instructions are kept by the page with the chat; main looks for secrets in them first (a saved API key is refused).
    working(true)
    let result: CheckChatInstructionsResult
    try {
      result = await window.api.instructions.checkForChat(next, anyway)
    } catch {
      result = { ok: false, error: `The instructions could not be checked: ${NO_ANSWER}.` }
    }
    if (!mounted.current) return
    working(false)
    if (result.ok) {
      onSave(next)
      onDone()
      return
    }
    setWarnings(result.warnings ?? null)
    setNotice({ kind: 'error', text: result.error })
  }

  function submit(): void {
    if (!canSave || !checked.ok) return
    const anyway = warnings !== null
    void (editing === 'every'
      ? saveEvery(checked.instructions, anyway)
      : saveChat(checked.instructions, anyway))
  }

  function summary(part: Part): React.JSX.Element {
    if (part === 'every' && everyChat === null) {
      return (
        <p className="instructions-part-text instructions-part-problem">
          Your instructions for every chat could not be read just now.
        </p>
      )
    }
    if (part === 'every' && everyProblem !== null) {
      return (
        <p className="instructions-part-text instructions-part-problem" role="alert">
          Your instructions for every chat could not be read ({everyProblem}). Nothing is sent until
          you replace them or turn them off.
        </p>
      )
    }
    const value = textOf(part)
    return value === '' ? (
      <p className="instructions-part-text instructions-part-none">None.</p>
    ) : (
      <p className="instructions-part-text">{value}</p>
    )
  }

  function editor(part: Part): React.JSX.Element {
    return (
      <>
        <p className="instructions-hint">
          {part === 'chat'
            ? 'Tell the model how to answer in this chat: who it should act as, how long or in what style to write, what to leave out. To turn the instructions off, empty the box and press the button.'
            : 'Tell the model how to answer in every chat: who you are, what you work on, how you like answers. Instructions for one chat come after these and win where they differ. To turn them off, empty the box and press the button.'}
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
          readOnly={busy}
          placeholder={
            part === 'chat'
              ? 'For example: Answer in short, plain sentences. If my question is unclear, ask me what I mean before you answer.'
              : 'For example: I am a nurse in Leeds. Use British spelling, and metric units.'
          }
          onChange={(event) => {
            setDraft(event.target.value)
            setWarnings(null)
            setNotice(null)
          }}
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
        {warnings !== null && warnings.length > 0 && (
          <ul className="instructions-secrets" aria-label="Parts that look like a secret">
            {warnings.map((finding, index) => (
              <li key={index}>
                {finding.shown} looks like {finding.what}.
              </li>
            ))}
          </ul>
        )}
        {notice !== null && (
          <p
            className={`instructions-notice${notice.kind === 'error' ? ' instructions-notice-error' : ''}`}
            role={notice.kind === 'error' ? 'alert' : 'status'}
          >
            {notice.text}
          </p>
        )}
        {part === 'chat' ? (
          <p className="instructions-hint instructions-warning">
            What you write here is added to the app&apos;s own short rules and sent with every
            message of this chat, to the company that runs the model that answers (if you change the
            model, to that company). It is billed as part of the conversation, and saved as plain
            text in this chat&apos;s file on this computer, like the messages. Do not put passwords
            or keys here. A new chat starts without instructions.
          </p>
        ) : (
          <p className="instructions-hint instructions-warning">
            What you write here is added to the app&apos;s own short rules and sent with every
            message of every chat, to the company that runs the model that answers. It is billed as
            part of each conversation, and kept in the app&apos;s data folder on this computer
            (encrypted when your chats are). Do not put passwords or keys here. When you save new
            text, Windows asks you once more in a window of its own, which the app cannot answer for
            you.
          </p>
        )}
      </>
    )
  }

  const parts: Part[] = ['every', 'chat']

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
          Sent with every message of this chat, after the app&apos;s own short rules, in this order:
        </p>
        {parts.map((part) => (
          <section
            key={part}
            className={`instructions-part${part === editing ? ' instructions-part-editing' : ''}`}
            aria-label={PART_TITLE[part]}
          >
            <div className="instructions-part-head">
              <h3 className="instructions-part-title">{PART_TITLE[part]}</h3>
              {part !== editing && (
                <button
                  type="button"
                  className="button button-secondary instructions-change"
                  disabled={busy || unsaved || (part === 'every' && everyChat === null)}
                  title={
                    unsaved
                      ? 'Save or cancel the change you are making first.'
                      : `Change the instructions ${part === 'every' ? 'for every chat' : 'for this chat'}.`
                  }
                  onClick={() => change(part)}
                >
                  Change...
                </button>
              )}
            </div>
            {part === editing ? editor(part) : summary(part)}
          </section>
        ))}
      </div>
      <div className="instructions-footer">
        <button
          type="button"
          className="button button-secondary"
          disabled={busy}
          onClick={onCancel}
        >
          Cancel
        </button>
        <button type="submit" className="button" disabled={!canSave}>
          {warnings !== null ? 'Save anyway' : turningOff ? 'Turn off' : 'Save'}
        </button>
      </div>
    </form>
  )
}

interface InstructionsDialogProps {
  open: boolean
  /** The instructions the chat has now: '' for none. */
  instructions: string
  /** The person's instructions for every chat as main has them (D-039), or null while they are not known. */
  everyChat: EveryChatStatus | null
  /** The person pressed Save with text that passed the checks, or emptied the box to turn the chat's instructions off (''). */
  onSave: (instructions: string) => void
  /** Main saved the instructions for every chat (the person said yes in the system's own message box) or turned them off. */
  onEveryChatSaved: (status: EveryChatStatus) => void
  onClose: () => void
}

/**
 * The person's instructions (D-027, D-039): every part that is sent with this chat, in the order it is sent, opened from the chat bar under the message
 * box. The main process adds them to the app's rules and sends them with every request; this dialog says so, and says who gets them and where they are
 * kept. Nothing is changed until Save; the instructions for every chat are kept by main, and only after the person's yes in the system's own message box.
 */
function InstructionsDialog({
  open,
  instructions,
  everyChat,
  onSave,
  onEveryChatSaved,
  onClose
}: InstructionsDialogProps): React.JSX.Element {
  const dialogRef = useRef<HTMLDialogElement>(null)
  // While main is saving (the system's message box may be open), Escape does not close the dialog: the answer is still to come.
  const busy = useRef(false)

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
      onCancel={(event) => {
        if (busy.current) event.preventDefault()
      }}
      onClose={() => {
        busy.current = false
        onClose()
      }}
    >
      <h2 id="instructions-title" className="instructions-heading">
        Instructions
      </h2>
      {open && (
        <InstructionsForm
          initial={instructions}
          everyChat={everyChat}
          onSave={onSave}
          onEveryChatSaved={onEveryChatSaved}
          onBusy={(on) => {
            busy.current = on
          }}
          onCancel={close}
          onDone={close}
        />
      )}
    </dialog>
  )
}

export default InstructionsDialog
