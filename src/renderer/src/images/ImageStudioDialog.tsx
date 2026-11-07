import { useEffect, useRef, useState } from 'react'
import type { PictureSummary } from '../../../shared/images'
import { IMAGE_STYLES } from '../../../shared/imageStyles'
import { MakeImageForm } from './MakeImageDialog'

interface ImageStudioDialogProps {
  open: boolean
  onClose: () => void
  /** Opens the gallery (every picture, large, with Save a copy, Use in chat, Delete). */
  onOpenGallery: () => void
  onOpenSettings: () => void
}

const RECENT = 12

/**
 * (22.3, D-054) Image Studio, as AI Fiesta's: a page of its own for making pictures. The same form as "Make an image" (Stage 16: the cost before anything is
 * sent, the Windows box above the amount, one request to OpenAI), with styles in words above it (none of their pictures), and the newest pictures under it.
 * A picture made here is kept in the gallery and the Library; it is not put into a chat (the chat's own button does that).
 */
function ImageStudioDialog({
  open,
  onClose,
  onOpenGallery,
  onOpenSettings
}: ImageStudioDialogProps): React.JSX.Element {
  const dialogRef = useRef<HTMLDialogElement>(null)
  // While a request is on its way, Escape does not close the page: Stop does (as the dialog's).
  const busy = useRef(false)
  const made = useRef(false)
  const [style, setStyle] = useState<string | null>(null)
  // A new form after each picture (the description starts empty again); a new list after each picture.
  const [round, setRound] = useState(0)
  const [recent, setRecent] = useState<PictureSummary[] | null>(null)
  const [problem, setProblem] = useState<string | null>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    else if (!open && dialog.open) dialog.close()
  }, [open])

  useEffect(() => {
    if (!open) return
    let live = true
    window.api.images
      .list()
      .then((result) => {
        if (!live) return
        setRecent(result.pictures.slice(0, RECENT))
        setProblem(result.problem)
      })
      .catch(() => {
        if (live) setProblem('the list could not be read')
      })
    return () => {
      live = false
    }
  }, [open, round])

  const styleWords = IMAGE_STYLES.find((s) => s.id === style)?.words ?? null

  return (
    <dialog
      ref={dialogRef}
      className="studio"
      aria-labelledby="studio-title"
      onCancel={(event) => {
        if (busy.current) event.preventDefault()
      }}
      onClose={() => {
        busy.current = false
        setStyle(null)
        onClose()
      }}
    >
      <div className="page-head">
        <div>
          <h2 id="studio-title" className="page-title">
            Image Studio
          </h2>
          <p className="page-subtitle">
            Describe a picture, pick a style, and OpenAI makes it. You see the most it can cost
            before anything is sent.
          </p>
        </div>
        <button
          type="button"
          className="icon-button"
          title="Close"
          aria-label="Close"
          onClick={() => {
            if (!busy.current) dialogRef.current?.close()
          }}
        >
          <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>
      <div className="studio-body">
        <div className="studio-styles" role="group" aria-label="Style">
          <button
            type="button"
            className="chip"
            aria-pressed={style === null}
            onClick={() => setStyle(null)}
          >
            No style
          </button>
          {IMAGE_STYLES.map((s) => (
            <button
              key={s.id}
              type="button"
              className="chip"
              data-style={s.id}
              aria-pressed={style === s.id}
              title={`Adds "Style: ${s.words}." under your description.`}
              onClick={() => setStyle(style === s.id ? null : s.id)}
            >
              {s.label}
            </button>
          ))}
        </div>
        {open && (
          <div className="studio-form">
            <MakeImageForm
              key={round}
              chatId={null}
              inChat={false}
              style={styleWords}
              onMade={() => {
                made.current = true
              }}
              onOpenGallery={onOpenGallery}
              onOpenSettings={onOpenSettings}
              onBusy={(on) => {
                busy.current = on
              }}
              onDone={() => {
                // After a picture: a fresh form and the new picture in the list. After Cancel: the page closes.
                if (made.current) {
                  made.current = false
                  setRound((n) => n + 1)
                } else dialogRef.current?.close()
              }}
            />
          </div>
        )}
        <section className="studio-recent" aria-labelledby="studio-recent-heading">
          <div className="studio-recent-head">
            <h3 id="studio-recent-heading" className="studio-recent-title">
              Your pictures
            </h3>
            {recent !== null && recent.length > 0 && (
              <button type="button" className="link-button" onClick={onOpenGallery}>
                See them all
              </button>
            )}
          </div>
          {problem !== null && (
            <p className="settings-hint">The pictures could not all be read ({problem}).</p>
          )}
          {recent === null ? (
            <p className="settings-hint">Reading your pictures...</p>
          ) : recent.length === 0 ? (
            <p className="settings-hint">The pictures you make appear here.</p>
          ) : (
            <ul className="studio-grid" aria-label="Your pictures">
              {recent.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    className="studio-thumb"
                    title={p.prompt}
                    data-id={p.id}
                    onClick={onOpenGallery}
                  >
                    {p.thumbnail !== null ? (
                      <img src={p.thumbnail} alt={p.prompt} />
                    ) : (
                      <span className="library-kind">IMG</span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </dialog>
  )
}

export default ImageStudioDialog
