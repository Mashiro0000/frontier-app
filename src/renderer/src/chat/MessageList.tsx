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
  /** What to call a model: its name from the registry, or its id if the registry no longer lists it. */
  modelName: (modelId: string) => string
  /** Asks again for the last reply (D-026). */
  onRegenerate: () => void
  /** Replaces one of the person's messages and asks again (D-026). */
  onResend: (id: string, text: string) => void
  /** "Remember..." on a message (D-039): opens the Memory page with this text in the box. */
  onRemember: (text: string) => void
}

/**
 * Who answered is said above a reply when it is the first one, and whenever the model changes (D-021): a chat in which
 * the model never changes would otherwise repeat one name above every reply. A reply whose model is not known (one saved
 * before the app recorded it) says nothing, and does not count as a change.
 */
function captionsFor(
  messages: ChatMessage[],
  modelName: (modelId: string) => string
): (string | null)[] {
  let previous: string | null = null
  return messages.map((message) => {
    if (message.role !== 'assistant' || !message.model) return null
    const caption = message.model !== previous ? modelName(message.model) : null
    previous = message.model
    return caption
  })
}

function MessageList({
  messages,
  isReplying,
  emptyHint,
  modelName,
  onRegenerate,
  onResend,
  onRemember
}: MessageListProps): React.JSX.Element {
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
    // A new message means the user just sent something, so jump to it even if they had scrolled up. A conversation that got shorter is
    // one where an earlier message was edited and sent again (D-026): the new reply is at the end, and that is where to look.
    if (messages.length !== previousCount.current) stickToBottom.current = true
    previousCount.current = messages.length
    if (stickToBottom.current) list.scrollTop = list.scrollHeight
  }, [messages])

  const captions = captionsFor(messages, modelName)

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
          {messages.map((message, index) => (
            <MessageBubble
              key={message.id}
              message={message}
              answeredBy={captions[index]}
              replying={isReplying}
              isLast={index === messages.length - 1}
              later={messages.length - 1 - index}
              onRegenerate={onRegenerate}
              onResend={onResend}
              onRemember={onRemember}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export default MessageList
