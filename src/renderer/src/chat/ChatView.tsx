import Composer from './Composer'
import MessageList from './MessageList'
import { useChat } from './useChat'

function ChatView(): React.JSX.Element {
  const { messages, send } = useChat()

  return (
    <main className="chat">
      <MessageList messages={messages} />
      <Composer onSend={send} />
    </main>
  )
}

export default ChatView
