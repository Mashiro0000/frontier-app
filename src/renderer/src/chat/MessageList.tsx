import { useLayoutEffect, useRef } from 'react'
import MessageBubble from './MessageBubble'
import type { ChatMessage } from './types'

// How close to the bottom (in pixels) still counts as "at the bottom".
const BOTTOM_THRESHOLD = 48

interface MessageListProps {
  messages: ChatMessage[]
  isReplying: boolean
  /** Shown in place of the messages while there are none. */
  emptyHint: React.ReactNode
}

function MessageList({ messages, isReplying, emptyHint }: MessageListProps): React.JSX.Element {
  const listRef = useRef<HTMLDivElement>(null)
  // True while the user is reading the newest message; false once they scroll up to read older ones.
  const stickToBottom = useRef(true)
  const previousCount = useRef(0)

  function handleScroll(): void {
    const list = listRef.current
    if (!list) return
    const distanceFromBottom = list.scrollHeight - list.scrollTop - list.clientHeight
    stickToBottom.current = distanceFromBottom <= BOTTOM_THRESHOLD
  }

  // Runs after every change to the messages: a new message, or more text in the last one.
  useLayoutEffect(() => {
    const list = listRef.current
    if (!list) return
    // A new message means the user just sent something, so jump to it even if they had scrolled up.
    if (messages.length > previousCount.current) stickToBottom.current = true
    previousCount.current = messages.length
    if (stickToBottom.current) list.scrollTop = list.scrollHeight
  }, [messages])

  return (
    <div
      ref={listRef}
      className="message-list"
      role="log"
      aria-label="Conversation"
      aria-busy={isReplying} // screen readers wait for the reply to finish instead of reading every word
      onScroll={handleScroll}
    >
      {messages.length === 0 ? (
        emptyHint && <p className="empty-state">{emptyHint}</p>
      ) : (
        <div className="message-list-inner">
          {messages.map((message) => (
            <MessageBubble key={message.id} message={message} />
          ))}
        </div>
      )}
    </div>
  )
}

export default MessageList
