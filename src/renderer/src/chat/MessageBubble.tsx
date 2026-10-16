import { memo, useState } from 'react'
import { piecesOf, sourcesOfNotes } from '../../../shared/toolNotes'
import PictureMessage from '../images/PictureMessage'
import Markdown from '../markdown/Markdown'
import { replyUsageText, replyUsageTitle } from '../settings/format'
import MessageActions from './MessageActions'
import MessageEdit from './MessageEdit'
import MessageFiles from './MessageFiles'
import Sources from './Sources'
import ToolNote from './ToolNote'
import type { ChatMessage } from './types'

interface MessageBubbleProps {
  message: ChatMessage
  /** The name of the model that wrote this reply, when it is worth saying (the first reply, or a change of model). */
  answeredBy: string | null
  /** True while a reply is arriving: asking again (Regenerate, Edit) waits for it to finish. */
  replying: boolean
  /** This is the last message of the conversation. */
  isLast: boolean
  /** How many messages come after this one: an edit would replace all of them. */
  later: number
  onRegenerate: () => void
  onResend: (id: string, text: string) => void
  onRemember: (text: string) => void
  /** (16.5) What to call an image model, and whether the chat's model reads pictures, for a request for pictures in the chat. */
  imageModelName: (modelId: string) => string
  canAttachPictures: boolean
  /** (16.5) "Use in chat" on a picture: it goes on the next message as an attachment. */
  onUsePicture: (id: string) => void
}

/** A short line shown under a message when something other than "all went well" happened. */
function noteFor(message: ChatMessage): string | null {
  if (message.status === 'stopped') return 'Stopped'
  if (message.status === 'error') return message.error || 'The reply failed.'
  if (message.status === 'done' && message.content === '') return 'The reply was empty.'
  return null
}

function MessageBubble({
  message,
  answeredBy,
  replying,
  isLast,
  later,
  onRegenerate,
  onResend,
  onRemember,
  imageModelName,
  canAttachPictures,
  onUsePicture
}: MessageBubbleProps): React.JSX.Element {
  // The tool calls of a reply (D-041, 11.4), each in the place of the text where the model asked for it, and the pages they brought back under the reply.
  const notes = message.role === 'assistant' ? (message.tools ?? []) : []
  const live = message.status === 'streaming'
  const lastNote = notes.at(-1)
  // The reply has been asked for but no text has arrived yet: show animated dots. With tool calls, also while the model writes again after a call that
  // has ended (a call that is waiting for the person or running shows its own line instead).
  const isWaiting =
    live &&
    (message.content === '' && notes.length === 0
      ? true
      : lastNote !== undefined &&
        lastNote.offset >= message.content.length &&
        lastNote.outcome.kind !== 'unanswered' &&
        lastNote.outcome.kind !== 'running')
  const sources = sourcesOfNotes(notes)
  const note = noteFor(message)
  // The person's own message, open for editing in place (D-026).
  const [editing, setEditing] = useState(false)

  return (
    <article
      className={`message message-${message.role}${editing ? ' message-editing' : ''}`}
      aria-label={message.role === 'user' ? 'You' : 'Assistant'}
    >
      {answeredBy && <p className="message-model">{answeredBy}</p>}
      {message.files !== undefined && message.files.length > 0 && (
        <MessageFiles files={message.files} />
      )}
      {message.picture !== undefined ? (
        // A request for pictures (D-048): the description, the pictures by their ids, the cost. Never sent to the model.
        <div className="bubble bubble-picture">
          <PictureMessage
            description={message.content}
            note={message.picture}
            modelLabel={imageModelName(message.picture.model)}
            canAttach={canAttachPictures}
            onUse={onUsePicture}
          />
        </div>
      ) : editing ? (
        <MessageEdit
          original={message.content}
          later={later}
          replying={replying}
          onCancel={() => setEditing(false)}
          onSend={(text) => {
            setEditing(false)
            onResend(message.id, text)
          }}
        />
      ) : (
        (message.content !== '' || isWaiting || notes.length > 0) && (
          <div className={message.role === 'assistant' ? 'bubble bubble-markdown' : 'bubble'}>
            {message.role === 'assistant' && notes.length > 0 ? (
              <>
                {piecesOf(message.content, notes).map((piece, index) =>
                  piece.kind === 'note' ? (
                    <ToolNote key={`note-${piece.note.id}`} note={piece.note} live={live} />
                  ) : (
                    // A reply is Markdown (D-025); the text on either side of a tool call is read as its own part.
                    <Markdown key={`text-${index}`} text={piece.text} />
                  )
                )}
                {isWaiting && (
                  <span className="typing" aria-hidden="true">
                    <span />
                    <span />
                    <span />
                  </span>
                )}
              </>
            ) : isWaiting ? (
              <span className="typing" aria-hidden="true">
                <span />
                <span />
                <span />
              </span>
            ) : message.role === 'assistant' ? (
              // A reply is Markdown (D-025); what the person typed is shown exactly as typed.
              <Markdown text={message.content} />
            ) : (
              message.content
            )}
          </div>
        )
      )}
      {sources.length > 0 && <Sources sources={sources} />}
      {note && (
        <p
          className={
            message.status === 'error' ? 'message-note message-note-error' : 'message-note'
          }
        >
          {note}
        </p>
      )}
      {message.usage && message.status !== 'streaming' && (
        <p className="message-usage" title={replyUsageTitle(message.usage)}>
          {replyUsageText(message.usage)}
        </p>
      )}
      {!editing && (
        <MessageActions
          message={message}
          replying={replying}
          isLast={isLast}
          onRegenerate={onRegenerate}
          onEdit={() => setEditing(true)}
          onRemember={onRemember}
        />
      )}
    </article>
  )
}

// memo: while a reply streams in, only its own bubble re-renders, not the whole history. (The props that are not the message are
// plain values or functions that stay the same from one render to the next, so they do not undo that.)
export default memo(MessageBubble)
