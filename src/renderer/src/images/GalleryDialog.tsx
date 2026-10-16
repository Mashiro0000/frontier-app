import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { QUALITY_LABELS, SHAPE_LABELS, type PictureSummary } from '../../../shared/images'
import { formatMoney } from '../../../shared/limits'
import { reloadImageStatus } from './imageStatus'

// The gallery (Stage 16.6, D-048): every picture the app keeps, newest first, as small pictures main made. A picture opens large, with its description, the model and
// what it cost, and three buttons: "Use in chat" (an attachment on the next message, so the model can see it), "Save a copy..." (a plain file wherever the person chooses
// in the system's save dialog) and "Delete..." (main asks in the system's box). Nothing is ever opened by the system's own viewer.

const NO_ANSWER = 'the app did not answer'

interface GalleryDialogProps {
  open: boolean
  /** The model that answers the chat reads pictures: "Use in chat" can be pressed. */
  canAttach: boolean
  onUse: (id: string) => void
  onClose: () => void
}

type Large = { summary: PictureSummary; src: string | null; why: string | null }

function GalleryDialog({ open, canAttach, onUse, onClose }: GalleryDialogProps): React.JSX.Element {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [pictures, setPictures] = useState<PictureSummary[] | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [large, setLarge] = useState<Large | null>(null)
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const lastOpened = useRef<string | null>(null)

  useLayoutEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    else if (!open && dialog.open) dialog.close()
  }, [open])

  const load = useCallback((): void => {
    void window.api.images
      .list()
      .then((list) => {
        setPictures(list.pictures)
        setProblem(list.problem)
      })
      .catch(() => {
        setPictures([])
        setProblem(NO_ANSWER)
      })
  }, [])

  // The dialog's content is made again each time it opens (the dialog is keyed by its opening), so the list starts as "reading" and nothing of an old visit lingers.
  useEffect(() => {
    load()
  }, [load])

  // Back in the grid, the keyboard goes back to the picture that was open.
  useEffect(() => {
    if (large !== null || lastOpened.current === null) return
    dialogRef.current
      ?.querySelector<HTMLButtonElement>(`[data-picture="${lastOpened.current}"]`)
      ?.focus()
  }, [large])

  async function openLarge(summary: PictureSummary): Promise<void> {
    lastOpened.current = summary.id
    setNotice(null)
    setLarge({ summary, src: null, why: summary.missing ?? null })
    if (summary.missing !== undefined) return
    try {
      const result = await window.api.images.picture(summary.id)
      setLarge(
        result.ok
          ? { summary: result.summary, src: result.dataUrl, why: null }
          : { summary, src: null, why: result.error }
      )
    } catch {
      setLarge({ summary, src: null, why: `The picture could not be read: ${NO_ANSWER}.` })
    }
  }

  async function act(
    work: () => Promise<{ ok: boolean; error?: string; cancelled?: true }>,
    done: string,
    waits: boolean
  ): Promise<boolean> {
    setBusy(true)
    busyRef.current = true
    setNotice(
      waits ? { kind: 'ok', text: 'Waiting for your answer in the Windows message box...' } : null
    )
    let result: { ok: boolean; error?: string; cancelled?: true }
    try {
      result = await work()
    } catch {
      result = { ok: false, error: `Nothing was done: ${NO_ANSWER}.` }
    }
    setBusy(false)
    busyRef.current = false
    if (result.ok) setNotice({ kind: 'ok', text: done })
    else if (result.cancelled) setNotice(waits ? { kind: 'ok', text: result.error ?? '' } : null)
    else setNotice({ kind: 'error', text: result.error ?? 'Nothing was done.' })
    return result.ok
  }

  const facts = (p: PictureSummary): string =>
    `${p.modelLabel}, ${SHAPE_LABELS[p.shape].toLowerCase()}, ${QUALITY_LABELS[p.quality].toLowerCase()}, ${p.estimate ? 'about ' : ''}${formatMoney(p.costUsd)}, ${new Date(p.at).toLocaleString()}`

  return (
    <dialog
      ref={dialogRef}
      className="gallery"
      aria-labelledby="gallery-title"
      onCancel={(event) => {
        if (busyRef.current) {
          event.preventDefault()
          return
        }
        if (large !== null) {
          event.preventDefault() // Escape goes back to the grid first
          setLarge(null)
        }
      }}
      onClose={onClose}
    >
      <h2 id="gallery-title" className="instructions-heading">
        Gallery
      </h2>
      <div className="gallery-body">
        {notice !== null && (
          <p
            className={`settings-notice${notice.kind === 'error' ? ' settings-notice-error' : ''}`}
            role={notice.kind === 'error' ? 'alert' : 'status'}
          >
            {notice.text}
          </p>
        )}
        {large !== null ? (
          <div className="gallery-large">
            {large.src !== null ? (
              <img
                className="gallery-large-image"
                src={large.src}
                alt={`The picture: ${large.summary.prompt}`}
              />
            ) : (
              <div className="picture-missing" role="note">
                {large.why ?? 'Loading the picture...'}
              </div>
            )}
            <p className="picture-description">{large.summary.prompt}</p>
            <p className="picture-facts">{facts(large.summary)}</p>
            <div className="gallery-actions">
              <button
                type="button"
                className="history-button"
                disabled={busy || large.src === null || !canAttach}
                title={
                  canAttach
                    ? 'Put this picture on your next message, so the model can see it.'
                    : 'The model you chat with cannot read pictures. Choose one that can to attach it.'
                }
                onClick={() => {
                  onUse(large.summary.id)
                  dialogRef.current?.close()
                }}
              >
                Use in chat
              </button>
              <button
                type="button"
                className="history-button"
                disabled={busy || large.src === null}
                title="Save a plain copy of this picture wherever you choose."
                onClick={() =>
                  void act(
                    () => window.api.images.saveCopy(large.summary.id),
                    'A copy was saved.',
                    false
                  )
                }
              >
                Save a copy...
              </button>
              <button
                type="button"
                className="history-button"
                disabled={busy}
                title="Delete the app's own copy. Windows asks you first."
                onClick={() =>
                  void act(
                    () => window.api.images.remove(large.summary.id),
                    'The picture was deleted.',
                    true
                  ).then((ok) => {
                    if (!ok) return
                    lastOpened.current = null
                    setLarge(null)
                    reloadImageStatus()
                    load()
                  })
                }
              >
                Delete...
              </button>
              <button
                type="button"
                className="history-button"
                disabled={busy}
                onClick={() => setLarge(null)}
              >
                Back to the gallery
              </button>
            </div>
          </div>
        ) : pictures === null ? (
          <p className="settings-status">Reading the gallery...</p>
        ) : problem !== null ? (
          <p className="settings-notice settings-notice-error" role="alert">
            The list of your pictures could not be read ({problem}), so none can be shown.
          </p>
        ) : pictures.length === 0 ? (
          <p className="instructions-hint">
            No pictures yet. Make one with &quot;Make an image...&quot; under the message box.
          </p>
        ) : (
          <ul className="gallery-grid" aria-label="Your pictures, newest first">
            {pictures.map((p) => (
              <li key={p.id} className="gallery-item">
                <button
                  type="button"
                  className="gallery-open"
                  data-picture={p.id}
                  title={p.prompt}
                  aria-label={`Open the picture: ${p.prompt}`}
                  onClick={() => void openLarge(p)}
                >
                  {p.thumbnail !== null ? (
                    <img className="gallery-thumb" src={p.thumbnail} alt="" />
                  ) : (
                    <span className="gallery-thumb gallery-thumb-missing">
                      {p.missing ?? 'No picture'}
                    </span>
                  )}
                  <span className="gallery-caption">{p.prompt}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="instructions-footer">
        <button
          type="button"
          className="button"
          disabled={busy}
          onClick={() => dialogRef.current?.close()}
        >
          Close
        </button>
      </div>
    </dialog>
  )
}

export default GalleryDialog
