import { useEffect, useRef, useState } from 'react'

interface ComposerProps {
  /** When this changes (a new conversation, or another one), the input box asks for the keyboard focus. */
  focusKey?: string
  isReplying: boolean
  onSend: (text: string) => void
  onStop: () => void
  /** The chips of the files on this message (D-037), drawn above the box. */
  attachments?: React.ReactNode
  /** Files are on the message. (Until slice 9.3 they cannot be sent yet, so Send waits.) */
  hasFiles?: boolean
  /** Files pasted into the box (an image copied to the clipboard): they are attached, not typed. */
  onPasteFiles?: (files: File[]) => void
}

function Composer({
  focusKey,
  isReplying,
  onSend,
  onStop,
  attachments,
  hasFiles = false,
  onPasteFiles
}: ComposerProps): React.JSX.Element {
  const [text, setText] = useState('')
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // Starting a new chat leaves the cursor in the input box. (Opening a saved chat from the History dialog does
  // not get here: a dialog that closes gives the focus back to the button that opened it.)
  useEffect(() => {
    inputRef.current?.focus()
  }, [focusKey])
  // You can type the next message while a reply streams in, but not send it until the reply ends.
  const canSend = text.trim() !== '' && !isReplying && !hasFiles

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
      {attachments}
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
          onPaste={(event) => {
            // A pasted image (or file) is attached, not typed. When the clipboard also holds text (copied cells, a page), the text is pasted as
            // usual and nothing is attached, so a copy that happens to carry a picture never sends one by surprise.
            const files = [...event.clipboardData.files]
            if (
              files.length > 0 &&
              event.clipboardData.getData('text/plain') === '' &&
              onPasteFiles
            ) {
              event.preventDefault()
              onPasteFiles(files)
            }
          }}
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
          <button
            key="send"
            type="submit"
            className="composer-button"
            disabled={!canSend}
            title={hasFiles ? 'Sending files is not ready yet in this version.' : undefined}
          >
            Send
          </button>
        )}
      </div>
    </form>
  )
}

export default Composer
