import { useCallback, useState } from 'react'
import type { SettingsStatus } from '../../../shared/ipc'
import LinkConfirm from '../markdown/LinkConfirm'
import { providerMissingKey } from '../settings/format'
import AttachmentChips from './AttachmentChips'
import Composer from './Composer'
import LargeRequestDialog from './LargeRequestDialog'
import MessageList from './MessageList'
import type { UseAttachments } from './useAttachments'
import type { UseChat } from './useChat'

interface ChatViewProps {
  /** What the main process says about settings; null until it has answered. */
  status: SettingsStatus | null
  /** The conversation. It is held in App, because the header and the chat bar need to know when a reply is arriving. */
  chat: UseChat
  /** True when no spending limits are chosen yet: the main process refuses every request until they are (D-031). */
  needsLimits: boolean
  onOpenSettings: () => void
  /** Asks for the spending limits again, after the person put the question off. */
  onOpenLimits: () => void
  /** Changes when another conversation is put on screen, so the input box can take the focus. */
  conversationId: string
  /** The files on the message being written (D-037). */
  attachments: UseAttachments
}

function ChatView({
  status,
  chat,
  needsLimits,
  onOpenSettings,
  onOpenLimits,
  conversationId,
  attachments
}: ChatViewProps): React.JSX.Element {
  const { messages, isReplying, largeRequest, answerLargeRequest, send, stop, regenerate, resend } =
    chat
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
  } else if (needsLimits) {
    emptyHint = (
      <>
        Set your spending limits to start chatting.{' '}
        <button type="button" className="link-button" onClick={onOpenLimits}>
          Set limits
        </button>
      </>
    )
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

  // Where the files go: the provider of the model that will answer (D-037, rule 1).
  const chosen = status?.models.find((model) => model.id === status.selectedModelId)
  const destination =
    chosen === undefined
      ? null
      : (status?.providers.find((provider) => provider.id === chosen.provider)?.name ?? null)

  return (
    <main
      className="chat"
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes('Files')) {
          event.preventDefault()
          event.dataTransfer.dropEffect = 'copy'
        }
      }}
      onDrop={(event) => {
        // Dropped files are read here and handed to main as bytes: their place on disk is never used (D-037).
        if (event.dataTransfer.files.length === 0) return
        event.preventDefault()
        attachments.addFiles([...event.dataTransfer.files])
      }}
    >
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
        hasFiles={attachments.files.length > 0}
        onPasteFiles={attachments.addFiles}
        attachments={
          <AttachmentChips
            files={attachments.files}
            notices={attachments.notices}
            destination={destination}
            onRemove={attachments.remove}
          />
        }
      />
      {/* A large request is held by the main process until the person says yes here (D-032). */}
      <LargeRequestDialog
        request={largeRequest}
        modelName={modelName}
        onAnswer={answerLargeRequest}
      />
    </main>
  )
}

export default ChatView
