import {
  IconCheck,
  IconCopy,
  IconMemory,
  IconPencil,
  IconRegenerate,
  IconSpeaker,
  IconStop
} from '../icons'
import { copyLabel, useCopy } from '../useCopy'
import { speaker } from '../voice/speaker'
import { useSpeaker } from '../voice/useSpeaker'
import { useVoiceStatus } from '../voice/voiceStatus'
import type { ChatMessage } from './types'

interface MessageActionsProps {
  message: ChatMessage
  /** True while a reply is arriving: asking again waits for it to finish. */
  replying: boolean
  /** This is the last message of the conversation, so a reply here can be asked for again. */
  isLast: boolean
  onRegenerate: () => void
  onEdit: () => void
  /** "Remember..." (D-039): the text picked in this message, or all of it, for the Memory page's box. */
  onRemember: (text: string) => void
}

const WAIT = 'This can be done when the reply has finished.'

/** (23.2, D-055) An action's words: hidden beside its icon (its name for screen readers and the checks), or shown when they say something went wrong. */
const Label = ({ text, shown = false }: { text: string; shown?: boolean }): React.JSX.Element => (
  <span className={shown ? 'message-action-label' : 'visually-hidden'}>{text}</span>
)

/** The text the person selected inside this message's bubble, or null when nothing in it is selected. */
function selectedIn(from: Element): string | null {
  const bubble = from.closest('.message')?.querySelector('.bubble')
  const selection = window.getSelection()
  if (!bubble || !selection || selection.isCollapsed || selection.rangeCount === 0) return null
  if (!bubble.contains(selection.getRangeAt(0).commonAncestorContainer)) return null
  const text = selection.toString().trim()
  return text === '' ? null : text
}

/**
 * The small buttons under a message (D-026): Copy for any message that has finished arriving; Regenerate (or Try again, after a failure)
 * for the last reply; Edit for the person's own messages; Remember... for any message that has finished (D-039: it only opens the Memory page with
 * the text, to be cut down and saved there). Regenerate and Edit ask the model again, so they wait for a reply that is
 * arriving, and they say that the conversation is billed again. Copy writes to the clipboard only when it is clicked.
 */
function MessageActions({
  message,
  replying,
  isLast,
  onRegenerate,
  onEdit,
  onRemember
}: MessageActionsProps): React.JSX.Element | null {
  const { state, copy } = useCopy()
  const voice = useVoiceStatus()
  const reading = useSpeaker()
  const arriving = message.status === 'streaming'
  const canCopy = message.content !== '' && !arriving
  const canRegenerate = message.role === 'assistant' && isLast && !arriving
  // A request for pictures (D-048) was not a message to the model: there is nothing to edit and send again.
  const canEdit = message.role === 'user' && message.picture === undefined
  const canRemember = message.content !== '' && !arriving
  // "Read aloud" (D-047): a reply, once it has finished, when the person switched it on in Settings. Nothing is read without this click.
  const canRead =
    voice?.speak === true && message.role === 'assistant' && message.content !== '' && !arriving
  const readingThis = reading.speaking === message.id
  if (!canCopy && !canRegenerate && !canEdit && !canRemember && !canRead) return null

  return (
    <div className="message-actions">
      {canCopy && (
        <button
          type="button"
          className="message-action"
          title={
            message.role === 'assistant'
              ? 'Copy this reply as it was written (the Markdown).'
              : 'Copy this message as you typed it.'
          }
          onClick={() => copy(message.content)}
        >
          {state === 'copied' ? <IconCheck /> : <IconCopy />}
          <Label text={copyLabel(state)} shown={state === 'failed'} />
        </button>
      )}
      {canRead && (
        <button
          type="button"
          className="message-action"
          aria-pressed={readingThis}
          title={
            readingThis
              ? 'Stop reading.'
              : 'Read this reply aloud with a voice of this computer (a system voice). Nothing leaves the computer.'
          }
          onClick={() =>
            readingThis
              ? speaker.stop()
              : speaker.speak(message.id, message.content, {
                  voice: voice?.voice ?? null,
                  rate: voice?.rate ?? 100
                })
          }
        >
          {readingThis ? <IconStop /> : <IconSpeaker />}
          <Label text={readingThis ? 'Stop reading' : 'Read aloud'} />
        </button>
      )}
      {canRegenerate && (
        <button
          type="button"
          className="message-action"
          disabled={replying}
          title={
            replying
              ? WAIT
              : 'Ask again, with the model and effort chosen now. This reply is replaced by the new one. ' +
                'The conversation is sent again and billed again.'
          }
          onClick={onRegenerate}
        >
          <IconRegenerate />
          <Label
            text={message.status === 'error' ? 'Try again' : 'Regenerate'}
            shown={message.status === 'error'}
          />
        </button>
      )}
      {canEdit && (
        <button
          type="button"
          className="message-action"
          disabled={replying}
          title={
            replying
              ? WAIT
              : 'Change this message and send it again. What came after it is replaced. ' +
                'The conversation is sent again and billed again.'
          }
          onClick={onEdit}
        >
          <IconPencil />
          <Label text="Edit" />
        </button>
      )}
      {canRemember && (
        <button
          type="button"
          className="message-action"
          title="Keep a note of this for the model: the part you have selected, or the whole message. You can cut it down before it is saved."
          onClick={(event) => onRemember(selectedIn(event.currentTarget) ?? message.content)}
        >
          <IconMemory />
          <Label text="Remember..." />
        </button>
      )}
    </div>
  )
}

export default MessageActions
