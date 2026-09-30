import type { SettingsStatus } from '../../../shared/ipc'
import Composer from './Composer'
import MessageList from './MessageList'
import { ipcReply } from './ipcReply'
import { useChat } from './useChat'

interface ChatViewProps {
  /** What the main process says about the API key; null until it has answered. */
  status: SettingsStatus | null
  onOpenSettings: () => void
}

function ChatView({ status, onOpenSettings }: ChatViewProps): React.JSX.Element {
  const { messages, isReplying, send, stop } = useChat(ipcReply)

  // Nothing is said until the main process has answered, so the hint never flashes the wrong thing.
  let emptyHint: React.ReactNode = null
  if (status?.hasKey === true) {
    emptyHint = 'Type a message to start.'
  } else if (status?.hasKey === false) {
    emptyHint = (
      <>
        Add your Anthropic API key to start chatting.{' '}
        <button type="button" className="link-button" onClick={onOpenSettings}>
          Open Settings
        </button>
      </>
    )
  }

  return (
    <main className="chat">
      <MessageList messages={messages} isReplying={isReplying} emptyHint={emptyHint} />
      <Composer isReplying={isReplying} onSend={send} onStop={stop} />
    </main>
  )
}

export default ChatView
