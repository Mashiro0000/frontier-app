import type { Listening } from './useListen'

interface MicButtonProps {
  listen: Listening
}

/**
 * The microphone button (Stage 15.6, D-047): HOLD it to speak, let go to send. It is shown only while "Speak to type" is on (Settings, Voice). A hold is a pointer held
 * down on the button (the pointer is captured, so letting go outside the button still ends it) or Space or Enter held on it with the keyboard; Escape, leaving the window
 * or the pointer being lost cancels and sends nothing. It does nothing by itself: main decides whether the microphone may open.
 */
function MicButton({ listen }: MicButtonProps): React.JSX.Element {
  const recording = listen.phase === 'recording' || listen.phase === 'starting'
  return (
    <button
      type="button"
      className={`composer-mic${recording ? ' composer-mic-on' : ''}`}
      aria-label="Hold to speak"
      aria-pressed={listen.phase === 'recording'}
      disabled={listen.phase === 'sending'}
      title="Hold to speak, let go to send. Your voice is sent to OpenAI to be written down; the words appear in the box and are not sent until you press Send."
      onPointerDown={(event) => {
        if (event.button !== 0) return
        event.currentTarget.setPointerCapture(event.pointerId)
        listen.press()
      }}
      onPointerUp={listen.release}
      onPointerCancel={listen.cancel}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          listen.cancel()
        } else if ((event.key === ' ' || event.key === 'Enter') && !event.repeat) {
          event.preventDefault()
          listen.press()
        }
      }}
      onKeyUp={(event) => {
        if (event.key === ' ' || event.key === 'Enter') {
          event.preventDefault()
          listen.release()
        }
      }}
    >
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
        <path
          fill="currentColor"
          d="M12 14a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v5a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2z"
        />
      </svg>
    </button>
  )
}

export default MicButton
