import type { SettingsStatus } from '../../../shared/ipc'
import Composer from './Composer'
import MessageList from './MessageList'
import type { UseChat } from './useChat'

interface ChatViewProps {
  /** What the main process says about settings; null until it has answered. */
  status: SettingsStatus | null
  /** The conversation. It is held in App, because the header needs to know when a reply is arriving. */
  chat: UseChat
  onOpenSettings: () => void
}

function ChatView({ status, chat, onOpenSettings }: ChatViewProps): React.JSX.Element {
  const { messages, isReplying, send, stop } = chat

  // Nothing is said until the main process has answered, so the hint never flashes the wrong thing.
  let emptyHint: React.ReactNode = null
  if (status?.modelsError) {
    emptyHint = `The list of models could not be loaded (${status.modelsError}), so replies are unavailable. Check registry/models.json.`
  } else if (status?.hasKey === true) {
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
