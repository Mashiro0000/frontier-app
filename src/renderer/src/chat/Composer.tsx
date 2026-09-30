import { useRef, useState } from 'react'

interface ComposerProps {
  isReplying: boolean
  onSend: (text: string) => void
  onStop: () => void
}

function Composer({ isReplying, onSend, onStop }: ComposerProps): React.JSX.Element {
  const [text, setText] = useState('')
  const inputRef = useRef<HTMLTextAreaElement>(null)
  // You can type the next message while a reply streams in, but not send it until the reply ends.
  const canSend = text.trim() !== '' && !isReplying

  function submit(): void {
    if (!canSend) return
    onSend(text.trim())
    setText('')
    inputRef.current?.focus() // keep typing without clicking back into the box
  }

  return (
    <form
      className="composer"
      onSubmit={(event) => {
        event.preventDefault()
        submit()
      }}
    >
      <div className="composer-inner">
        <textarea
          ref={inputRef}
          className="composer-input"
          rows={1}
          value={text}
          placeholder="Type a message"
          aria-label="Message"
          autoFocus
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            // Enter sends, Shift+Enter adds a new line. Enter that only confirms an
            // input-method candidate (for example Japanese or Chinese typing) must not send.
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault()
              submit()
            }
          }}
        />
        {/* Two separate buttons (note the keys) rather than one that changes type: otherwise a
            click on Stop could turn into a form submit and send the half-typed next message. */}
        {isReplying ? (
          <button
            key="stop"
            type="button"
            className="composer-button composer-button-stop"
            onClick={() => {
              onStop()
              inputRef.current?.focus()
            }}
          >
            Stop
          </button>
        ) : (
          <button key="send" type="submit" className="composer-button" disabled={!canSend}>
            Send
          </button>
        )}
      </div>
    </form>
  )
}

export default Composer
