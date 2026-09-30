import { useRef, useState } from 'react'

interface ComposerProps {
  onSend: (text: string) => void
}

function Composer({ onSend }: ComposerProps): React.JSX.Element {
  const [text, setText] = useState('')
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const canSend = text.trim() !== ''

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
        <button type="submit" className="composer-button" disabled={!canSend}>
          Send
        </button>
      </div>
    </form>
  )
}

export default Composer
