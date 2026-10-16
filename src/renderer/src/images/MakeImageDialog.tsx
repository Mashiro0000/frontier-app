import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  IMAGE_LIMITS,
  QUALITY_LABELS,
  QUALITY_NAMES,
  SHAPE_LABELS,
  SHAPE_NAMES,
  type ImageEstimate,
  type ImageGenerateResult,
  type ImageQuality,
  type ImageShape,
  type PictureNote,
  promptBytes
} from '../../../shared/images'
import { formatMoney } from '../../../shared/limits'
import { reloadImageStatus, useImageStatus } from './imageStatus'

// "Make an image" (Stage 16.6, D-048): the person writes a description and chooses the shape, the quality, how many and the model. Before anything is sent the dialog
// shows the most it can cost, as MAIN works it out from registry/images.json ("At most $0.05 for this. $4.20 left today."); main checks everything again, asks in the
// system's box above $0.50, sends ONE request and keeps the pictures. While it waits the dialog says so and offers Stop (which may still be billed). The pictures then go
// into the chat as a request of the person's (16.5), never sent to the model.

const NO_ANSWER = 'the app did not answer'
const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many)

interface MakeImageDialogProps {
  open: boolean
  /** The chat it is asked from (the cost shows under it; the gallery notes it). */
  chatId: string | null
  /** The pictures were made and kept: put the request into the chat. */
  onMade: (description: string, note: PictureNote) => void
  onOpenGallery: () => void
  onOpenSettings: () => void
  onClose: () => void
}

interface MakeImageFormProps {
  chatId: string | null
  onMade: (description: string, note: PictureNote) => void
  onOpenGallery: () => void
  onOpenSettings: () => void
  onBusy: (busy: boolean) => void
  onDone: () => void
}

/** The form: it exists only while the dialog is open, so what is typed starts empty each time and nothing of an old choice lingers. */
function MakeImageForm({
  chatId,
  onMade,
  onOpenGallery,
  onOpenSettings,
  onBusy,
  onDone
}: MakeImageFormProps): React.JSX.Element {
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const status = useImageStatus()
  const [prompt, setPrompt] = useState('')
  const [shape, setShape] = useState<ImageShape>('square')
  const [quality, setQuality] = useState<ImageQuality>('medium')
  const [count, setCount] = useState(1)
  const [model, setModel] = useState<string | null>(null)
  // What main answered for a choice, kept with the choice it was asked for: an answer for an older choice is never shown for a newer one.
  const [answered, setAnswered] = useState<{ key: string; estimate: ImageEstimate } | null>(null)
  const [making, setMaking] = useState(false)
  const [waitingBox, setWaitingBox] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    reloadImageStatus()
    inputRef.current?.focus()
  }, [])

  // The model: the one chosen, or the file's default, never a retired one.
  const usable = status?.models.filter((m) => m.state !== 'retired') ?? []
  const chosenModel =
    usable.find((m) => m.id === model) ??
    usable.find((m) => m.id === status?.defaultModelId) ??
    usable[0] ??
    null

  // What main says the choice would cost at most, asked again whenever the choice or the description's length changes. A change of the description alone keeps the
  // figure on screen until the new one comes (it moves by a fraction of a cent); a change of the choice shows "Working out the cost..." first.
  const modelId = chosenModel?.id ?? null
  const choiceKey = `${modelId}|${shape}|${quality}|${count}`
  const bytes = Math.min(promptBytes(prompt), IMAGE_LIMITS.maxPromptBytes)
  useEffect(() => {
    if (modelId === null) return
    let live = true
    window.api.images
      .estimate({ model: modelId, shape, quality, count, promptBytes: bytes })
      .then((estimate) => {
        if (live) setAnswered({ key: `${modelId}|${shape}|${quality}|${count}`, estimate })
      })
      .catch(() => {
        if (live)
          setAnswered({
            key: `${modelId}|${shape}|${quality}|${count}`,
            estimate: { ok: false, error: `The cost could not be worked out: ${NO_ANSWER}.` }
          })
      })
    return () => {
      live = false
    }
  }, [modelId, shape, quality, count, bytes])
  const estimate = answered !== null && answered.key === choiceKey ? answered.estimate : null

  const blocked = status?.blocked ?? null
  const trimmed = prompt.trim()
  const tooLong = prompt.length > IMAGE_LIMITS.maxPromptChars
  const refused = estimate !== null && (!estimate.ok || estimate.refusal !== null)
  const canMake =
    !making &&
    status !== null &&
    blocked === null &&
    chosenModel !== null &&
    trimmed !== '' &&
    !tooLong &&
    estimate !== null &&
    !refused

  async function make(): Promise<void> {
    if (!canMake || chosenModel === null || estimate === null || !estimate.ok) return
    setMaking(true)
    onBusy(true)
    setError(null)
    setWaitingBox(estimate.asks)
    const ask = { prompt, model: chosenModel.id, shape, quality, count, chat: chatId }
    let result: ImageGenerateResult
    try {
      result = await window.api.images.generate(ask)
    } catch {
      result = { ok: false, kind: 'failed', error: `The picture could not be made: ${NO_ANSWER}.` }
    }
    onBusy(false)
    setMaking(false)
    setWaitingBox(false)
    reloadImageStatus()
    if (!result.ok) {
      setError(result.error)
      return
    }
    onMade(prompt, {
      ids: result.pictures.map((p) => p.id),
      model: chosenModel.id,
      shape,
      quality,
      costUsd: result.costUsd,
      estimate: result.estimate
    })
    onDone()
  }

  const leftToday = estimate?.ok === true ? estimate.leftTodayUsd : null
  const costLine =
    estimate === null
      ? 'Working out the cost...'
      : !estimate.ok
        ? estimate.error
        : `At most ${estimate.about ? 'about ' : ''}${formatMoney(estimate.maxUsd)} for ${plural(count, 'this', 'these')}.${
            leftToday !== null ? ` ${formatMoney(leftToday)} left today.` : ''
          }`

  return (
    <>
      <form
        className="make-image-form"
        onSubmit={(event) => {
          event.preventDefault()
          void make()
        }}
      >
        <div className="make-image-body">
          <p className="instructions-hint">
            Your description goes to OpenAI, which makes the picture, even when you chat with Claude
            (Anthropic cannot make pictures). The pictures are kept in the gallery and appear in
            this chat; they are not sent to the model you chat with unless you attach one.
          </p>
          {status === null && <p className="settings-status">Reading the image settings...</p>}
          {blocked !== null && (
            <p className="settings-notice settings-notice-error" role="alert">
              {blocked}{' '}
              <button type="button" className="link-button" onClick={onOpenSettings}>
                Open Settings
              </button>
            </p>
          )}
          <label className="instructions-label" htmlFor="make-image-prompt">
            Description
          </label>
          <textarea
            id="make-image-prompt"
            ref={inputRef}
            className="instructions-input make-image-input"
            rows={4}
            value={prompt}
            disabled={making}
            aria-describedby="make-image-count"
            onChange={(event) => setPrompt(event.target.value)}
          />
          <p
            id="make-image-count"
            className={`instructions-hint${tooLong ? ' settings-notice-error' : ''}`}
          >
            {prompt.length.toLocaleString('en-US')} of{' '}
            {IMAGE_LIMITS.maxPromptChars.toLocaleString('en-US')} characters
            {tooLong ? ': too long.' : '.'}
          </p>
          <div className="make-image-choices">
            <label className="voice-pick-field">
              <span className="settings-hint">Shape</span>
              <select
                aria-label="Shape"
                value={shape}
                disabled={making}
                onChange={(event) => setShape(event.target.value as ImageShape)}
              >
                {SHAPE_NAMES.map((name) => (
                  <option key={name} value={name}>
                    {SHAPE_LABELS[name]}
                  </option>
                ))}
              </select>
            </label>
            <label className="voice-pick-field">
              <span className="settings-hint">Quality</span>
              <select
                aria-label="Quality"
                value={quality}
                disabled={making}
                onChange={(event) => setQuality(event.target.value as ImageQuality)}
              >
                {QUALITY_NAMES.map((name) => (
                  <option key={name} value={name}>
                    {QUALITY_LABELS[name]}
                  </option>
                ))}
              </select>
            </label>
            <label className="voice-pick-field">
              <span className="settings-hint">How many</span>
              <select
                aria-label="How many"
                value={count}
                disabled={making}
                onChange={(event) => setCount(Number(event.target.value))}
              >
                {Array.from(
                  { length: status?.maxCount ?? IMAGE_LIMITS.maxCount },
                  (_, i) => i + 1
                ).map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            <label className="voice-pick-field make-image-model">
              <span className="settings-hint">Model</span>
              <select
                aria-label="Model"
                value={chosenModel?.id ?? ''}
                disabled={making || usable.length === 0}
                onChange={(event) => setModel(event.target.value)}
              >
                {(status?.models ?? []).map((m) => (
                  <option key={m.id} value={m.id} disabled={m.state === 'retired'}>
                    {m.label}
                    {m.state === 'retired'
                      ? ` (retired ${m.retires})`
                      : m.state === 'retiring'
                        ? ` (retires ${m.retires})`
                        : ''}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {chosenModel !== null && !chosenModel.published && (
            <p className="instructions-hint">
              OpenAI does not publish this model&apos;s prices, so the cost shown is a ceiling.
            </p>
          )}
          <p
            className={`make-image-cost${refused ? ' settings-notice-error' : ''}`}
            role={refused ? 'alert' : 'status'}
          >
            {costLine}
            {estimate?.ok === true && estimate.refusal !== null && <> {estimate.refusal}</>}
            {estimate?.ok === true && estimate.refusal === null && estimate.asks && (
              <>
                {' '}
                Above {formatMoney(status?.askAboveUsd ?? IMAGE_LIMITS.askAboveUsd)}, so Windows
                will ask you first.
              </>
            )}
          </p>
          {making && (
            <p className="settings-notice" role="status">
              {waitingBox
                ? 'Waiting for your answer in the Windows message box, then for OpenAI...'
                : 'Making the picture. This can take a minute.'}
            </p>
          )}
          {error !== null && (
            <p className="settings-notice settings-notice-error" role="alert">
              {error}
            </p>
          )}
        </div>
        <div className="instructions-footer make-image-footer">
          <button
            type="button"
            className="button button-secondary make-image-gallery"
            disabled={making}
            onClick={onOpenGallery}
          >
            Gallery...
          </button>
          {making ? (
            <button
              type="button"
              className="button button-secondary"
              title="Stop waiting. OpenAI may still bill the request."
              onClick={() => void window.api.images.stop()}
            >
              Stop
            </button>
          ) : (
            <button type="button" className="button button-secondary" onClick={onDone}>
              Cancel
            </button>
          )}
          <button type="submit" className="button" disabled={!canMake}>
            Make
          </button>
        </div>
      </form>
    </>
  )
}

function MakeImageDialog({
  open,
  chatId,
  onMade,
  onOpenGallery,
  onOpenSettings,
  onClose
}: MakeImageDialogProps): React.JSX.Element {
  const dialogRef = useRef<HTMLDialogElement>(null)
  // While a request is on its way, Escape does not close the dialog: Stop does.
  const busy = useRef(false)

  useLayoutEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    else if (!open && dialog.open) dialog.close()
  }, [open])

  return (
    <dialog
      ref={dialogRef}
      className="make-image"
      aria-labelledby="make-image-title"
      onCancel={(event) => {
        if (busy.current) event.preventDefault() // the request is on its way: Stop, not Escape
      }}
      onClose={() => {
        busy.current = false
        onClose()
      }}
    >
      <h2 id="make-image-title" className="instructions-heading">
        Make an image
      </h2>
      {open && (
        <MakeImageForm
          chatId={chatId}
          onMade={onMade}
          onOpenGallery={onOpenGallery}
          onOpenSettings={onOpenSettings}
          onBusy={(on) => {
            busy.current = on
          }}
          onDone={() => dialogRef.current?.close()}
        />
      )}
    </dialog>
  )
}

export default MakeImageDialog
