import { memo, useState } from 'react'
import Markdown from '../markdown/Markdown'
import MessageActions from './MessageActions'
import MessageEdit from './MessageEdit'
import type { ChatMessage } from './types'

interface MessageBubbleProps {
  message: ChatMessage
  /** The name of the model that wrote this reply, when it is worth saying (the first reply, or a change of model). */
  answeredBy: string | null
  /** True while a reply is arriving: asking again (Regenerate, Edit) waits for it to finish. */
  replying: boolean
  /** This is the last message of the conversation. */
  isLast: boolean
  /** How many messages come after this one: an edit would replace all of them. */
  later: number
  onRegenerate: () => void
  onResend: (id: string, text: string) => void
}

/** A short line shown under a message when something other than "all went well" happened. */
function noteFor(message: ChatMessage): string | null {
  if (message.status === 'stopped') return 'Stopped'
  if (message.status === 'error') return message.error || 'The reply failed.'
  if (message.status === 'done' && message.content === '') return 'The reply was empty.'
  return null
}

function MessageBubble({
  message,
  answeredBy,
  replying,
  isLast,
  later,
  onRegenerate,
  onResend
}: MessageBubbleProps): React.JSX.Element {
  // The reply has been asked for but no text has arrived yet: show animated dots.
  const isWaiting = message.status === 'streaming' && message.content === ''
  const note = noteFor(message)
  // The person's own message, open for editing in place (D-026).
  const [editing, setEditing] = useState(false)

  return (
    <article
      className={`message message-${message.role}${editing ? ' message-editing' : ''}`}
      aria-label={message.role === 'user' ? 'You' : 'Assistant'}
    >
      {answeredBy && <p className="message-model">{answeredBy}</p>}
      {editing ? (
        <MessageEdit
          original={message.content}
          later={later}
          replying={replying}
          onCancel={() => setEditing(false)}
          onSend={(text) => {
            setEditing(false)
            onResend(message.id, text)
          }}
        />
      ) : (
        (message.content !== '' || isWaiting) && (
          <div className={message.role === 'assistant' ? 'bubble bubble-markdown' : 'bubble'}>
            {isWaiting ? (
              <span className="typing" aria-hidden="true">
                <span />
                <span />
                <span />
              </span>
            ) : message.role === 'assistant' ? (
              // A reply is Markdown (D-025); what the person typed is shown exactly as typed.
              <Markdown text={message.content} />
            ) : (
              message.content
            )}
          </div>
        )
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
      {!editing && (
        <MessageActions
          message={message}
          replying={replying}
          isLast={isLast}
          onRegenerate={onRegenerate}
          onEdit={() => setEditing(true)}
        />
      )}
    </article>
  )
}

// memo: while a reply streams in, only its own bubble re-renders, not the whole history. (The props that are not the message are
// plain values or functions that stay the same from one render to the next, so they do not undo that.)
export default memo(MessageBubble)
