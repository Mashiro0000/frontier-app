interface ChatBarProps {
  /** A reply is arriving: nothing here can start or open another chat meanwhile. */
  isReplying: boolean
  /** How many messages the chat on screen has; a new chat can only be started from one that has some. */
  messageCount: number
  /** The person's instructions for this chat (D-027); '' for none. */
  instructions: string
  /** The chat on screen could not be saved (D-017): starting a new one would lose it, and the button says so. */
  saveFailed: boolean
  onNewChat: () => void
  onOpenHistory: () => void
  onOpenInstructions: () => void
}

/**
 * The buttons of the chat on screen, in a slim row under the message box (D-029). They were in the header until Stage 7.4 made the header
 * too wide for the default window, so that it wrapped to two rows. They keep the rules they had there: all of them wait for a reply that is
 * arriving, and a tooltip says why and when they come back.
 */
function ChatBar({
  isReplying,
  messageCount,
  instructions,
  saveFailed,
  onNewChat,
  onOpenHistory,
  onOpenInstructions
}: ChatBarProps): React.JSX.Element {
  return (
    <div className="chat-bar" role="group" aria-label="This chat">
      <button
        type="button"
        className="chat-button"
        disabled={isReplying || messageCount === 0}
        title={
          isReplying
            ? 'A new chat can be started when the reply has finished.'
            : messageCount === 0
              ? 'This chat is empty.'
              : saveFailed
                ? 'Start a new chat. This one is not saved, so it would be lost.'
                : 'Start a new chat. This one stays saved in History.'
        }
        onClick={onNewChat}
      >
        New chat
      </button>
      <button
        type="button"
        className="chat-button"
        disabled={isReplying}
        title={
          isReplying
            ? 'History can be opened when the reply has finished.'
            : 'Open a saved chat, or delete one.'
        }
        onClick={onOpenHistory}
      >
        History
      </button>
      {/* The instructions are sent with every message, so while they are on the button says so: the always-visible mark (D-027). */}
      <button
        type="button"
        className="chat-button chat-instructions"
        disabled={isReplying}
        title={
          isReplying
            ? 'The instructions can be changed when the reply has finished.'
            : instructions !== ''
              ? `Instructions are on for this chat (${instructions.length.toLocaleString('en-US')} characters) and are sent with every message. Click to read or change them.`
              : 'Give the model instructions for this chat, for example how it should answer.'
        }
        onClick={onOpenInstructions}
      >
        Instructions
        {instructions !== '' && (
          <>
            {' '}
            <span className="chat-mark">on</span>
          </>
        )}
      </button>
    </div>
  )
}

export default ChatBar
