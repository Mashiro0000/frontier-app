import Composer from './Composer'
import MessageList from './MessageList'

function ChatView(): React.JSX.Element {
  return (
    <main className="chat">
      <MessageList />
      <Composer />
    </main>
  )
}

export default ChatView
