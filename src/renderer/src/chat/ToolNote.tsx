import { noteAbout, noteOutcomeText, type ReplyToolNote } from '../../../shared/toolNotes'

interface ToolNoteProps {
  note: ReplyToolNote
  /** The reply is still arriving: a call without an end is waiting for the person, or running. */
  live: boolean
}

/**
 * One tool call of a reply, in the place of the reply's text where the model asked for it (D-041, 11.4): what the tool is called, what it was asked, and
 * what became of it, in the words the audit log uses. Everything in it came from a model or from main's record of the call, and is shown as text.
 */
function ToolNote({ note, live }: ToolNoteProps): React.JSX.Element {
  const about = noteAbout(note)
  const open = live && (note.outcome.kind === 'unanswered' || note.outcome.kind === 'running')
  return (
    <div
      className={`tool-note tool-note-${note.outcome.kind}`}
      role="group"
      aria-label={note.title}
      title={note.why !== null ? `The model's reason: ${note.why}` : undefined}
    >
      <p className="tool-note-head">
        <span className="tool-note-title">{note.title}</span>
        {about !== '' && <span className="tool-note-about">{about}</span>}
      </p>
      <p className="tool-note-outcome" role={open ? 'status' : undefined}>
        {open && <span className="tool-note-spinner" aria-hidden="true" />}
        {noteOutcomeText(note.outcome, live)}
      </p>
    </div>
  )
}

export default ToolNote
