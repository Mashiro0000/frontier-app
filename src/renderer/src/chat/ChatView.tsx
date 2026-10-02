import { useCallback, useState } from 'react'
import type { SettingsStatus } from '../../../shared/ipc'
import LinkConfirm from '../markdown/LinkConfirm'
import { providerMissingKey } from '../settings/format'
import Composer from './Composer'
import MessageList from './MessageList'
import type { UseChat } from './useChat'

interface ChatViewProps {
  /** What the main process says about settings; null until it has answered. */
  status: SettingsStatus | null
  /** The conversation. It is held in App, because the header and the chat bar need to know when a reply is arriving. */
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
  const { messages, isReplying, send, stop, regenerate, resend } = chat
  // Asking again (Regenerate, an edited message) takes the keyboard back to the input box, as sending does.
  const [asked, setAsked] = useState(0)
  // Stable from one render to the next (the chat re-renders with every word of a reply), so that the messages that have not changed
  // do not draw again.
  const onRegenerate = useCallback((): void => {
    regenerate()
    setAsked((n) => n + 1)
  }, [regenerate])
  const onResend = useCallback(
    (id: string, text: string): void => {
      resend(id, text)
      setAsked((n) => n + 1)
    },
    [resend]
  )

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
          onRegenerate={onRegenerate}
          onResend={onResend}
        />
      </LinkConfirm>
      <Composer
        focusKey={`${conversationId}:${asked}`}
        isReplying={isReplying}
        onSend={send}
        onStop={stop}
      />
    </main>
  )
}

export default ChatView
