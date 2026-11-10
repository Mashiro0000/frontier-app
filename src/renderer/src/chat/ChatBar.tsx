import type { EveryChatStatus } from '../../../shared/ipc'
import type { MemoryStatus } from '../../../shared/memory'
import {
  IconAttach,
  IconImage,
  IconInstructions,
  IconMemory,
  IconPlus,
  IconProject
} from '../icons'
import { useEffect, useRef } from 'react'
import { notesSent } from '../memory/useMemory'

interface ChatBarProps {
  /** A reply is arriving: the pages that could change what the next message carries wait for it. */
  isReplying: boolean
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
  onOpenInstructions: () => void
  /** Opens the system's dialog to attach files to the message being written (D-037). */
  onAttach: () => void
  /** Main is working on files, or the message has as many as it may carry. */
  attachDisabled: boolean
  attachTitle: string
  /** (16.6, D-048) "Make images" is on: the button that opens the "Make an image" dialog is shown. */
  imagesOn: boolean
  onMakeImage: () => void
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
 * The buttons of the chat on screen, in a row inside the message box under the text (D-051). (24.2, D-056) A "+" opens a short menu with
 * every button by name: Attach, Make an image, Instructions, Memory, Project. What goes with every message is never only in the menu:
 * while instructions, notes or a project are on, their button stands in the row itself, with its words and mark (D-027, D-039). The
 * buttons keep their rules: they wait for a reply that is arriving, and a tooltip says why and when they come back.
 */
function ChatBar({
  isReplying,
  instructions,
  everyChat,
  memory,
  onOpenMemory,
  projectName,
  onOpenProjects,
  onOpenInstructions,
  onAttach,
  attachDisabled,
  attachTitle,
  imagesOn,
  onMakeImage
}: ChatBarProps): React.JSX.Element {
  const instructionsOn =
    everyChat?.problem != null || instructions !== '' || (everyChat?.text ?? '') !== ''
  const memoryOn = memory?.problem != null || notesSent(memory).length > 0
  // A button that turns on leaves the menu for the box (and goes back when off): it is a new element, so the keyboard that was on the
  // old one is handed to it, or to the "+" when it went into the closed menu.
  const barRef = useRef<HTMLDivElement>(null)
  const inProject = projectName !== null
  const was = useRef({ instructionsOn, memoryOn, inProject })
  useEffect(() => {
    const before = was.current
    was.current = { instructionsOn, memoryOn, inProject }
    const moved =
      before.instructionsOn !== instructionsOn
        ? 'chat-instructions'
        : before.memoryOn !== memoryOn
          ? 'chat-memory'
          : before.inProject !== inProject
            ? 'chat-project'
            : null
    if (moved === null || document.activeElement !== document.body) return
    const bar = barRef.current
    ;(
      bar?.querySelector<HTMLElement>(`:scope > .${moved}`) ??
      bar?.querySelector<HTMLElement>('.chat-plus')
    )?.focus()
  }, [instructionsOn, memoryOn, inProject])
  const attach = (
    <button
      type="button"
      className="chat-button chat-attach"
      disabled={attachDisabled}
      title={attachTitle}
      onClick={onAttach}
    >
      <IconAttach />
      <span className="chat-label">Attach...</span>
    </button>
  )
  /* (D-048) Only while "Make images" is on, as the microphone button is only while "Speak to type" is. */
  const makeImage = imagesOn && (
    <button
      type="button"
      className="chat-button chat-make-image"
      disabled={isReplying}
      title={
        isReplying
          ? 'A picture can be made when the reply has finished.'
          : 'Describe a picture for OpenAI to make. You see the most it can cost first.'
      }
      onClick={onMakeImage}
    >
      <IconImage />
      <span className="chat-label">Make an image...</span>
    </button>
  )
  /* The instructions are sent with every message, so while any part is on the button says so: the always-visible mark (D-027, D-039). */
  const instructionsButton = (
    <button
      type="button"
      className="chat-button chat-instructions"
      disabled={isReplying}
      title={instructionsTitle(isReplying, instructions, everyChat)}
      onClick={onOpenInstructions}
    >
      <IconInstructions />
      <span className="chat-label">Instructions</span>
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
  )
  /* The notes go with every message too, so while any do, the button says how many: they are never sent unseen (D-039). */
  const memoryButton = (
    <button
      type="button"
      className="chat-button chat-memory"
      disabled={isReplying}
      title={memoryTitle(isReplying, memory)}
      onClick={onOpenMemory}
    >
      <IconMemory />
      <span className="chat-label">Memory</span>
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
  )
  /* The project the chat belongs to (D-039): its name is the person's label, shown here and never sent to the model. */
  const projectButton = (
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
      <IconProject />
      <span className="chat-label">
        {projectName === null ? (
          'Project'
        ) : (
          <>
            <span className="visually-hidden">Project: </span>
            <span className="chat-project-name">{projectName}</span>
          </>
        )}
      </span>
    </button>
  )
  return (
    <div ref={barRef} className="chat-bar" role="group" aria-label="This chat">
      <button
        type="button"
        className="chat-plus"
        popoverTarget="chat-menu"
        title="Attach files, instructions, memory, project"
      >
        <IconPlus />
        <span className="visually-hidden">More</span>
      </button>
      {/* The platform's popover: a click outside or Esc closes it; a click on one of its buttons closes it too. */}
      <div
        id="chat-menu"
        className="chat-menu"
        popover="auto"
        onClick={(event) => event.currentTarget.hidePopover()}
      >
        {attach}
        {makeImage}
        {!instructionsOn && instructionsButton}
        {!memoryOn && memoryButton}
        {projectName === null && projectButton}
      </div>
      {instructionsOn && instructionsButton}
      {memoryOn && memoryButton}
      {projectName !== null && projectButton}
    </div>
  )
}

export default ChatBar
