import type { AttachedFile } from '../../../shared/attachments'
import { factsOf, notesOf } from './attachmentText'

interface AttachmentChipsProps {
  files: AttachedFile[]
  /** One sentence per file that was not attached. */
  notices: string[]
  /** The provider the files go to with the next message ("Anthropic"), or null when no model is chosen. */
  destination: string | null
  onRemove: (id: string) => void
}

/**
 * The files on the message being written, each as a chip: a small picture (an image) or its type, its name, what it is, what was done to it, and a
 * button to take it off. Under them, where they go: the provider of the model that will answer, with this message and with every later one of this
 * chat (the whole conversation is sent each time, D-028). Then a sentence for each file that was not attached.
 */
function AttachmentChips({
  files,
  notices,
  destination,
  onRemove
}: AttachmentChipsProps): React.JSX.Element | null {
  if (files.length === 0 && notices.length === 0) return null
  return (
    <div className="attachments">
      {files.length > 0 && (
        <>
          <ul className="attachment-list" aria-label="Files on this message">
            {files.map(({ info, thumbnail, firstLines }) => {
              const notes = notesOf(info)
              return (
                <li
                  key={info.id}
                  className="attachment-chip"
                  title={firstLines !== null ? `${info.name}\n\n${firstLines}` : info.name}
                >
                  {thumbnail !== null ? (
                    <img className="attachment-thumb" src={thumbnail} alt="" />
                  ) : (
                    <span className="attachment-icon" aria-hidden="true">
                      {info.kind === 'pdf' ? 'PDF' : 'TXT'}
                    </span>
                  )}
                  <span className="attachment-text">
                    <span className="attachment-name">{info.name}</span>
                    <span className="attachment-facts">{factsOf(info)}</span>
                    {notes.length > 0 && (
                      <span className="attachment-notes">{notes.join('; ')}</span>
                    )}
                  </span>
                  <button
                    type="button"
                    className="attachment-remove"
                    aria-label={`Remove ${info.name}`}
                    title="Take this file off the message"
                    onClick={() => onRemove(info.id)}
                  >
                    ×
                  </button>
                </li>
              )
            })}
          </ul>
          <p className="attachment-destination">
            {destination === null
              ? `${files.length === 1 ? 'This file goes' : 'These files go'} to the provider of the model you choose`
              : `${files.length === 1 ? 'This file goes' : 'These files go'} to ${destination}`}{' '}
            with this message, and again with each later message of this chat.
          </p>
        </>
      )}
      {notices.length > 0 && (
        <div className="attachment-notices" role="alert">
          {notices.map((notice, index) => (
            <p key={index}>{notice}</p>
          ))}
        </div>
      )}
    </div>
  )
}

export default AttachmentChips
