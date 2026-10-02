import type { SettingsStatus } from '../../../shared/ipc'
import LinkConfirm from '../markdown/LinkConfirm'
import { providerMissingKey } from '../settings/format'
import Composer from './Composer'
import MessageList from './MessageList'
import type { UseChat } from './useChat'

interface ChatViewProps {
  /** What the main process says about settings; null until it has answered. */
  status: SettingsStatus | null
  /** The conversation. It is held in App, because the header needs to know when a reply is arriving. */
  chat: UseChat
  onOpenSettings: () => void
  /** Changes when another conversation is put on screen, so the input box can take the focus. */
  conversationId: string
}

function ChatView({
  status,
  chat,
  onOpenSettings,
  conversationId
}: ChatViewProps): React.JSX.Element {
  const { messages, isReplying, send, stop } = chat

  // What to call a model above its reply: its name from the registry, or its id if the registry no longer lists it (D-021).
  const modelName = (modelId: string): string =>
    status?.models.find((model) => model.id === modelId)?.label ?? modelId

  // Nothing is said until the main process has answered, so the hint never flashes the wrong thing.
  let emptyHint: React.ReactNode = null
  const missingKey = providerMissingKey(status)
  if (status?.modelsError) {
    emptyHint = `The list of models could not be loaded (${status.modelsError}), so replies are unavailable. Check registry/models.json.`
  } else if (status !== null && missingKey === null) {
    emptyHint = 'Type a message to start.'
  } else if (missingKey !== null) {
    emptyHint = (
      <>
        Add your {missingKey.name} API key to start chatting.{' '}
        <button type="button" className="link-button" onClick={onOpenSettings}>
          Open Settings
        </button>
      </>
    )
  }

  return (
    <main className="chat">
      <LinkConfirm>
        <MessageList
          messages={messages}
          isReplying={isReplying}
          emptyHint={emptyHint}
          modelName={modelName}
        />
      </LinkConfirm>
      <Composer focusKey={conversationId} isReplying={isReplying} onSend={send} onStop={stop} />
    </main>
  )
}

export default ChatView
