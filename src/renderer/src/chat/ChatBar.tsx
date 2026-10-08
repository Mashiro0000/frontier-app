import type { EveryChatStatus } from '../../../shared/ipc'
import type { MemoryStatus } from '../../../shared/memory'
import { notesSent } from '../memory/useMemory'

interface ChatBarProps {
  /** A reply is arriving: nothing here can start or open another chat meanwhile. */
  isReplying: boolean
  /** How many messages the chat on screen has; a new chat can only be started from one that has some. */
  messageCount: number
  /** The person's instructions for this chat (D-027); '' for none. */
  instructions: string
  /** Their instructions for every chat (D-039), as main has them; null while not known. */
  everyChat: EveryChatStatus | null
  /** Their notes (D-039), as main has them; null while not known. */
  memory: MemoryStatus | null
  onOpenMemory: () => void
  /** The name of the project the chat belongs to (D-039), or null for none. */
  projectName: string | null
  onOpenProjects: () => void
  /** The chat on screen could not be saved (D-017): starting a new one would lose it, and the button says so. */
  saveFailed: boolean
  onNewChat: () => void
  onOpenHistory: () => void
  onOpenInstructions: () => void
  /** Opens the system's dialog to attach files to the message being written (D-037). */
  onAttach: () => void
  /** Main is working on files, or the message has as many as it may carry. */
  attachDisabled: boolean
  attachTitle: string
}

const chars = (text: string): string => `${text.length.toLocaleString('en-US')} characters`

/** What the Instructions button's tooltip says: which parts are on and how long each is, or why it is off or marked. */
function instructionsTitle(
  isReplying: boolean,
  instructions: string,
  everyChat: EveryChatStatus | null
): string {
  if (isReplying) return 'The instructions can be changed when the reply has finished.'
  if (everyChat?.problem != null) {
    return 'Your instructions for every chat could not be read, so nothing can be sent. Click to replace them or turn them off.'
  }
  const every = everyChat?.text ?? ''
  if (every !== '' && instructions !== '') {
    return `Instructions are on for every chat (${chars(every)}) and for this chat (${chars(instructions)}), and are sent with every message. Click to read or change them.`
  }
  if (every !== '') {
    return `Your instructions for every chat are on (${chars(every)}) and are sent with every message. Click to read or change them.`
  }
  if (instructions !== '') {
    return `Instructions are on for this chat (${chars(instructions)}) and are sent with every message. Click to read or change them.`
  }
  return 'Give the model instructions for this chat or for every chat, for example how it should answer.'
}

/** What the Memory button's tooltip says: how many notes go with this chat, or that memory is off, or why nothing can be sent. */
function memoryTitle(isReplying: boolean, memory: MemoryStatus | null): string {
  if (isReplying) return 'Memory can be opened when the reply has finished.'
  if (memory?.problem != null) {
    return 'Your notes could not be read, so nothing can be sent. Click to delete them or turn memory off.'
  }
  if (memory !== null && !memory.on) {
    return 'Memory is off: none of your notes is sent. Click to see them or turn memory on.'
  }
  const count = notesSent(memory).length
  if (count > 0) {
    return `${count === 1 ? '1 note goes' : `${count} notes go`} with every message of this chat. Click to see or change them.`
  }
  return 'Keep notes for the model about you and your work. Click to add one.'
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
  everyChat,
  memory,
  onOpenMemory,
  projectName,
  onOpenProjects,
  saveFailed,
  onNewChat,
  onOpenHistory,
  onOpenInstructions,
  onAttach,
  attachDisabled,
  attachTitle
}: ChatBarProps): React.JSX.Element {
  return (
    <div className="chat-bar" role="group" aria-label="This chat">
      <button
        type="button"
        className="chat-button"
        disabled={attachDisabled}
        title={attachTitle}
        onClick={onAttach}
      >
        Attach...
      </button>
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
      {/* The instructions are sent with every message, so while any part is on the button says so: the always-visible mark (D-027, D-039). */}
      <button
        type="button"
        className="chat-button chat-instructions"
        disabled={isReplying}
        title={instructionsTitle(isReplying, instructions, everyChat)}
        onClick={onOpenInstructions}
      >
        Instructions
        {everyChat?.problem != null ? (
          <>
            {' '}
            <span className="chat-mark chat-mark-warn">!</span>
          </>
        ) : (
          (instructions !== '' || (everyChat?.text ?? '') !== '') && (
            <>
              {' '}
              <span className="chat-mark">on</span>
            </>
          )
        )}
      </button>
      {/* The notes go with every message too, so while any do, the button says how many: they are never sent unseen (D-039). */}
      <button
        type="button"
        className="chat-button chat-memory"
        disabled={isReplying}
        title={memoryTitle(isReplying, memory)}
        onClick={onOpenMemory}
      >
        Memory
        {memory?.problem != null ? (
          <>
            {' '}
            <span className="chat-mark chat-mark-warn">!</span>
          </>
        ) : (
          notesSent(memory).length > 0 && (
            <>
              {' '}
              <span className="chat-mark">{notesSent(memory).length}</span>
            </>
          )
        )}
      </button>
      {/* The project the chat belongs to (D-039): its name is the person's label, shown here and never sent to the model. */}
      <button
        type="button"
        className="chat-button chat-project"
        disabled={isReplying}
        title={
          isReplying
            ? 'Projects can be opened when the reply has finished.'
            : projectName === null
              ? 'Put this chat in a project, or make one: a project gives its chats the same instructions, files and notes.'
              : `This chat is in the project "${projectName}". Click to see the project, or to move the chat.`
        }
        onClick={onOpenProjects}
      >
        {projectName === null ? (
          'Project'
        ) : (
          <>
            Project: <span className="chat-project-name">{projectName}</span>
          </>
        )}
      </button>
    </div>
  )
}

export default ChatBar
