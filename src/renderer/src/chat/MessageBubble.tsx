import { memo } from 'react'
import type { ChatMessage } from './types'

interface MessageBubbleProps {
  message: ChatMessage
}

function MessageBubble({ message }: MessageBubbleProps): React.JSX.Element {
  return (
    <article
      className={`message message-${message.role}`}
      aria-label={message.role === 'user' ? 'You' : 'Assistant'}
    >
      <div className="bubble">{message.content}</div>
    </article>
  )
}

// memo: while a reply streams in, only its own bubble re-renders, not the whole history.
export default memo(MessageBubble)
