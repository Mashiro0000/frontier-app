import { useEffect, useRef, useState } from 'react'

interface MessageEditProps {
  /** The message as it is now. */
  original: string
  /** How many messages come after it: sending replaces all of them. */
  later: number
  /** True while a reply is arriving: nothing can be sent until it has finished. */
  replying: boolean
  onSend: (text: string) => void
  onCancel: () => void
}

/**
 * The person's own message, open for editing in place (D-026). Sending replaces the message and everything after it, and asks the model
 * again. When that would remove more than the reply right after it (the last exchange), it asks first, saying how many messages go
 * (they are gone from the saved chat too). Enter sends and Shift+Enter makes a new line, as in the box at the bottom; Escape cancels.
 */
function MessageEdit({
  original,
  later,
  replying,
  onSend,
  onCancel
}: MessageEditProps): React.JSX.Element {
  const [text, setText] = useState(original)
  const [confirming, setConfirming] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const input = inputRef.current
    if (!input) return
    input.focus()
    input.setSelectionRange(input.value.length, input.value.length)
  }, [])

  const edited = text.trim()
  const canSend = edited !== '' && edited !== original.trim() && !replying

  function submit(): void {
    if (!canSend) return
    if (later > 1 && !confirming) {
      setConfirming(true) // more than the last exchange would go: ask first
      return
    }
    onSend(edited)
  }

  return (
    <form
      className="message-edit"
      onSubmit={(event) => {
        event.preventDefault()
        submit()
      }}
    >
      <textarea
        ref={inputRef}
        className="message-edit-input"
        aria-label="Edit your message"
        value={text}
        onChange={(event) => {
          setText(event.target.value)
          setConfirming(false) // a changed text is a new question
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            onCancel()
          } else if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault()
            submit()
          }
        }}
      />
      {confirming ? (
        <p className="message-edit-warning" role="alert">
          Sending this replaces the {later} messages after it, here and in the saved chat. They
          cannot be brought back.
        </p>
      ) : (
        <p className="message-edit-note">
          Sending asks the model again: the conversation is sent again and billed again.
          {later === 1 && ' The reply after this message is replaced.'}
          {later > 1 && ` The ${later} messages after it are replaced (you are asked first).`}
        </p>
      )}
      <div className="message-edit-actions">
        <button type="button" className="button button-secondary" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="button" disabled={!canSend}>
          {confirming ? 'Send anyway' : 'Send'}
        </button>
      </div>
    </form>
  )
}

export default MessageEdit
