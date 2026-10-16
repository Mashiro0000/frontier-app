import { useEffect, useRef, useState } from 'react'
import MicButton from '../voice/MicButton'
import { useListen } from '../voice/useListen'
import { useVoiceStatus } from '../voice/voiceStatus'

interface ComposerProps {
  /** When this changes (a new conversation, or another one), the input box asks for the keyboard focus. */
  focusKey?: string
  isReplying: boolean
  onSend: (text: string) => void
  onStop: () => void
  /** The chips of the files on this message (D-037), drawn above the box. */
  attachments?: React.ReactNode
  /** Files are on the message (D-037): it can be sent with no text. */
  hasFiles?: boolean
  /** Why the message cannot be sent as it is (a model that cannot read a kind of file, too many files in the chat), or null. */
  blocked?: string | null
  /** Files pasted into the box (an image copied to the clipboard): they are attached, not typed. */
  onPasteFiles?: (files: File[]) => void
  /** The button that ends a reply says "Stop everything" when a tool is switched on (D-041, 11.4): it also stops a tool that is running and closes a question. */
  stopEverything?: boolean
}

function Composer({
  focusKey,
  isReplying,
  onSend,
  onStop,
  attachments,
  hasFiles = false,
  blocked = null,
  onPasteFiles,
  stopEverything = false
}: ComposerProps): React.JSX.Element {
  const [text, setText] = useState('')
  const inputRef = useRef<HTMLTextAreaElement>(null)
  // "Speak to type" (D-047): the words come back as text in the box, to be read and sent by the person; they are never sent from here.
  const voice = useVoiceStatus()
  const listen = useListen((words) => {
    setText((now) => (now === '' ? words : `${now}${/\s$/.test(now) ? '' : ' '}${words}`))
    inputRef.current?.focus()
  })

  // Starting a new chat leaves the cursor in the input box. (Opening a saved chat from the History dialog does
  // not get here: a dialog that closes gives the focus back to the button that opened it.)
  useEffect(() => {
    inputRef.current?.focus()
  }, [focusKey])
  // You can type the next message while a reply streams in, but not send it until the reply ends.
  const canSend = (text.trim() !== '' || hasFiles) && !isReplying && blocked === null

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
        {voice?.listen === true && <MicButton listen={listen} />}
        {/* Two separate buttons (note the keys) rather than one that changes type: otherwise a
            click on Stop could turn into a form submit and send the half-typed next message. */}
        {isReplying ? (
          <button
            key="stop"
            type="button"
            className="composer-button composer-button-stop"
            title={
              stopEverything
                ? 'Ends the reply, stops a tool that is running and closes a question that is waiting.'
                : undefined
            }
            onClick={() => {
              onStop()
              inputRef.current?.focus()
            }}
          >
            {stopEverything ? 'Stop everything' : 'Stop'}
          </button>
        ) : (
          <button
            key="send"
            type="submit"
            className="composer-button"
            disabled={!canSend}
            title={blocked ?? undefined}
          >
            Send
          </button>
        )}
      </div>
      {/* How a hold of the microphone is going (D-047). The window's title and the taskbar button say the same, and are main's; this is the page's own line. */}
      {listen.phase !== 'idle' && (
        <p className="composer-voice" role="status">
          {listen.phase === 'sending'
            ? 'Writing it down...'
            : listen.phase === 'starting'
              ? 'Opening the microphone...'
              : `Recording ${listen.seconds} s. Let go to send it to OpenAI; Esc cancels.`}
        </p>
      )}
      {listen.phase === 'idle' && listen.notice !== null && (
        <p className="composer-voice composer-voice-notice" role="status">
          {listen.notice}
        </p>
      )}
      {/* Why Send is off while files are in the way (D-037), said on screen and not only in the button's tooltip. */}
      {blocked !== null && (
        <p className="composer-blocked" role="status">
          {blocked}
        </p>
      )}
    </form>
  )
}

export default Composer
