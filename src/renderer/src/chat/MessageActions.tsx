import { copyLabel, useCopy } from '../useCopy'
import type { ChatMessage } from './types'

interface MessageActionsProps {
  message: ChatMessage
  /** True while a reply is arriving: asking again waits for it to finish. */
  replying: boolean
  /** This is the last message of the conversation, so a reply here can be asked for again. */
  isLast: boolean
  onRegenerate: () => void
  onEdit: () => void
}

const WAIT = 'This can be done when the reply has finished.'

/**
 * The small buttons under a message (D-026): Copy for any message that has finished arriving; Regenerate (or Try again, after a failure)
 * for the last reply; Edit for the person's own messages. Regenerate and Edit ask the model again, so they wait for a reply that is
 * arriving, and they say that the conversation is billed again. Copy writes to the clipboard only when it is clicked.
 */
function MessageActions({
  message,
  replying,
  isLast,
  onRegenerate,
  onEdit
}: MessageActionsProps): React.JSX.Element | null {
  const { state, copy } = useCopy()
  const arriving = message.status === 'streaming'
  const canCopy = message.content !== '' && !arriving
  const canRegenerate = message.role === 'assistant' && isLast && !arriving
  const canEdit = message.role === 'user'
  if (!canCopy && !canRegenerate && !canEdit) return null

  return (
    <div className="message-actions">
      {canCopy && (
        <button
          type="button"
          className="message-action"
          title={
            message.role === 'assistant'
              ? 'Copy this reply as it was written (the Markdown).'
              : 'Copy this message as you typed it.'
          }
          onClick={() => copy(message.content)}
        >
          {copyLabel(state)}
        </button>
      )}
      {canRegenerate && (
        <button
          type="button"
          className="message-action"
          disabled={replying}
          title={
            replying
              ? WAIT
              : 'Ask again, with the model and effort chosen now. This reply is replaced by the new one. ' +
                'The conversation is sent again and billed again.'
          }
          onClick={onRegenerate}
        >
          {message.status === 'error' ? 'Try again' : 'Regenerate'}
        </button>
      )}
      {canEdit && (
        <button
          type="button"
          className="message-action"
          disabled={replying}
          title={
            replying
              ? WAIT
              : 'Change this message and send it again. What came after it is replaced. ' +
                'The conversation is sent again and billed again.'
          }
          onClick={onEdit}
        >
          Edit
        </button>
      )}
    </div>
  )
}

export default MessageActions
