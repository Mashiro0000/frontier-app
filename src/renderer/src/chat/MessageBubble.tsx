import { memo } from 'react'
import type { ChatMessage } from './types'

interface MessageBubbleProps {
  message: ChatMessage
  /** The name of the model that wrote this reply, when it is worth saying (the first reply, or a change of model). */
  answeredBy: string | null
}

/** A short line shown under a message when something other than "all went well" happened. */
function noteFor(message: ChatMessage): string | null {
  if (message.status === 'stopped') return 'Stopped'
  if (message.status === 'error') return message.error || 'The reply failed.'
  if (message.status === 'done' && message.content === '') return 'The reply was empty.'
  return null
}

function MessageBubble({ message, answeredBy }: MessageBubbleProps): React.JSX.Element {
  // The reply has been asked for but no text has arrived yet: show animated dots.
  const isWaiting = message.status === 'streaming' && message.content === ''
  const note = noteFor(message)

  return (
    <article
      className={`message message-${message.role}`}
      aria-label={message.role === 'user' ? 'You' : 'Assistant'}
    >
      {answeredBy && <p className="message-model">{answeredBy}</p>}
      {(message.content !== '' || isWaiting) && (
        <div className="bubble">
          {isWaiting ? (
            <span className="typing" aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
          ) : (
            message.content
          )}
        </div>
      )}
      {note && (
        <p
          className={
            message.status === 'error' ? 'message-note message-note-error' : 'message-note'
          }
        >
          {note}
        </p>
      )}
    </article>
  )
}

// memo: while a reply streams in, only its own bubble re-renders, not the whole history.
export default memo(MessageBubble)
