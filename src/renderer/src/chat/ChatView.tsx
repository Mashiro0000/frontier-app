import Composer from './Composer'
import MessageList from './MessageList'
import { useChat } from './useChat'

function ChatView(): React.JSX.Element {
  const { messages, isReplying, send, stop } = useChat()

  return (
    <main className="chat">
      <MessageList messages={messages} isReplying={isReplying} />
      <Composer isReplying={isReplying} onSend={send} onStop={stop} />
    </main>
  )
}

export default ChatView
