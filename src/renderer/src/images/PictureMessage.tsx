import { useEffect, useState } from 'react'
import { QUALITY_LABELS, SHAPE_LABELS, type PictureNote } from '../../../shared/images'
import { formatMoney } from '../../../shared/limits'

// A request for pictures in the chat (Stage 16.5, D-048): the person's description, the pictures (asked of main by their ids in the gallery: the chat keeps no picture),
// what it cost, and two buttons under each picture. It is never sent to the model: only "Use in chat" puts a picture on the next message, as an attachment.

interface PictureMessageProps {
  description: string
  note: PictureNote
  /** What to call the model: its label from the image registry, or its id. */
  modelLabel: string
  /** The model that answers the chat reads pictures: "Use in chat" can be pressed. */
  canAttach: boolean
  onUse: (id: string) => void
}

type Shown = { state: 'loading' } | { state: 'ok'; src: string } | { state: 'missing'; why: string }

function PictureMessage({
  description,
  note,
  modelLabel,
  canAttach,
  onUse
}: PictureMessageProps): React.JSX.Element {
  const [shown, setShown] = useState<Record<string, Shown>>({})
  const [saying, setSaying] = useState<string | null>(null)
  const idsKey = note.ids.join(',')

  useEffect(() => {
    let live = true
    for (const id of idsKey.split(',')) {
      void window.api.images
        .picture(id)
        .then((result) => {
          if (!live) return
          setShown((now) => ({
            ...now,
            [id]: result.ok
              ? { state: 'ok', src: result.dataUrl }
              : { state: 'missing', why: result.error }
          }))
        })
        .catch(() => {
          if (live)
            setShown((now) => ({
              ...now,
              [id]: { state: 'missing', why: 'The picture could not be read.' }
            }))
        })
    }
    return () => {
      live = false
    }
  }, [idsKey])

  const save = (id: string): void => {
    setSaying(null)
    void window.api.images.saveCopy(id).then((result) => {
      if (result.ok) setSaying('A copy was saved.')
      else if (!result.cancelled) setSaying(result.error)
    })
  }

  const count = note.ids.length
  return (
    <div className="picture-message">
      <p className="picture-asked">
        <span className="picture-asked-label">
          You asked for {count === 1 ? 'a picture' : `${count} pictures`}:
        </span>{' '}
        <span className="picture-description">{description}</span>
      </p>
      <div className="picture-grid">
        {note.ids.map((id, index) => {
          const one = shown[id] ?? { state: 'loading' }
          return (
            <figure key={id} className="picture-figure">
              {one.state === 'ok' ? (
                <img
                  className="picture-image"
                  src={one.src}
                  alt={`Picture ${index + 1} of ${count}: ${description}`}
                />
              ) : (
                <div className="picture-missing" role="note">
                  {one.state === 'loading' ? 'Loading the picture...' : one.why}
                </div>
              )}
              {one.state === 'ok' && (
                <figcaption className="picture-actions">
                  <button
                    type="button"
                    className="message-action"
                    disabled={!canAttach}
                    title={
                      canAttach
                        ? 'Put this picture on your next message, so the model can see it.'
                        : 'The model you chat with cannot read pictures. Choose one that can to attach it.'
                    }
                    onClick={() => onUse(id)}
                  >
                    Use in chat
                  </button>
                  <button
                    type="button"
                    className="message-action"
                    title="Save a plain copy of this picture wherever you choose."
                    onClick={() => save(id)}
                  >
                    Save a copy...
                  </button>
                </figcaption>
              )}
            </figure>
          )
        })}
      </div>
      <p className="picture-facts">
        {modelLabel}, {SHAPE_LABELS[note.shape].toLowerCase()},{' '}
        {QUALITY_LABELS[note.quality].toLowerCase()}: {note.estimate ? 'about ' : ''}
        {formatMoney(note.costUsd)}. Made by OpenAI; not sent to the model you chat with.
      </p>
      {saying !== null && (
        <p className="picture-said" role="status">
          {saying}
        </p>
      )}
    </div>
  )
}

export default PictureMessage
