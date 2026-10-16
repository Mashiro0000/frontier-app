import { useEffect, useState } from 'react'
import {
  QUALITY_LABELS,
  QUALITY_NAMES,
  SHAPE_LABELS,
  SHAPE_NAMES,
  type ImageChangeResult
} from '../../../shared/images'
import { formatMoney } from '../../../shared/limits'
import { reloadImageStatus, setImageStatus, useImageStatus } from '../images/imageStatus'

const NO_ANSWER = 'the app did not answer'
const WAITING = 'Waiting for your answer in the Windows message box...'

type Notice = { kind: 'ok' | 'error'; text: string }

/**
 * "Images" in Settings (Stage 16.6, D-048): the switch, what a picture costs, which models retire. Main keeps the switch (image-settings.json) and the page only shows it
 * and asks for a change. "Make images" is switched ON only after the person's yes in the system's own message box, which this page cannot answer; OFF is at once.
 */
function ImagesSection({ open }: { open: boolean }): React.JSX.Element {
  const status = useImageStatus()
  const [notice, setNotice] = useState<Notice | null>(null)
  const [busy, setBusy] = useState(false)
  const [starting, setStarting] = useState(false)

  useEffect(() => {
    if (open) reloadImageStatus()
  }, [open])

  async function change(
    send: () => Promise<ImageChangeResult>,
    waits: boolean,
    done: string
  ): Promise<void> {
    setBusy(true)
    setNotice(waits ? { kind: 'ok', text: WAITING } : null)
    let result: ImageChangeResult
    try {
      result = await send()
    } catch {
      result = { ok: false, error: `The image settings could not be changed: ${NO_ANSWER}.` }
    }
    setBusy(false)
    if (result.ok) {
      setImageStatus(result.status)
      setNotice({ kind: 'ok', text: done })
    } else {
      setNotice({ kind: 'error', text: result.error })
      reloadImageStatus()
    }
  }

  // Switching on needs the OpenAI key and a readable file; the other reasons a picture cannot be asked for (no limits) are said, and do not stop the switch.
  const cannotTurnOn =
    status !== null &&
    !status.on &&
    (status.problem !== null ||
      status.registryError !== null ||
      /OpenAI key/.test(status.blocked ?? ''))
  const main =
    status?.models.find((m) => m.id === status.defaultModelId) ?? status?.models[0] ?? null
  const ceilings = status?.models.filter((m) => !m.published) ?? []
  const retiring = status?.models.filter((m) => m.state !== 'ok') ?? []

  return (
    <section className="settings-section images-section" aria-labelledby="settings-images-heading">
      <h3 id="settings-images-heading" className="settings-heading">
        Images
      </h3>
      <p className="settings-hint">
        Make images: a &quot;Make an image...&quot; button appears under the message box. You write
        a description and choose the shape and quality; the dialog shows the most it can cost before
        anything is sent. Anthropic cannot make pictures, so your description goes to OpenAI, with
        your OpenAI key, even when you chat with Claude. The pictures are kept on this computer in
        the gallery (encrypted with your chats when that is on), and are never opened by Windows by
        themselves.
      </p>

      {notice !== null && (
        <p
          className={`settings-notice${notice.kind === 'error' ? ' settings-notice-error' : ''}`}
          role={notice.kind === 'error' ? 'alert' : 'status'}
        >
          {notice.text}
        </p>
      )}

      {status === null && <p className="settings-status">Reading the image settings...</p>}

      {status !== null && status.problem !== null && (
        <div className="tools-problem" role="alert">
          <p>
            Your image settings could not be read ({status.problem}), so making images is off and
            cannot be turned on. The app keeps a copy of the file.
          </p>
          {starting ? (
            <span className="tools-confirm">
              Start again with making images off?{' '}
              <button
                type="button"
                className="history-button"
                disabled={busy}
                onClick={() => {
                  setStarting(false)
                  void change(
                    () => window.api.images.reset(),
                    false,
                    'The image settings start again: making images is off.'
                  )
                }}
              >
                Yes, start again
              </button>{' '}
              <button type="button" className="history-button" onClick={() => setStarting(false)}>
                No
              </button>
            </span>
          ) : (
            <button
              type="button"
              className="history-button"
              disabled={busy}
              onClick={() => setStarting(true)}
            >
              Start again...
            </button>
          )}
        </div>
      )}

      {status !== null && (
        <ul className="tools-switches" aria-label="Images">
          <li className="tools-switch">
            <div className="tools-switch-text">
              <span className="tools-switch-title">Make images</span>
              <span className="tools-hint">
                Counted in your spending limits; a request that could cost more than{' '}
                {formatMoney(status.askAboveUsd)} asks you in a Windows message box first.{' '}
                {status.pictures} of {status.galleryMax} pictures are in the gallery.
              </span>
              {status.blocked !== null &&
                status.blocked !==
                  'Making images is off. Switch it on in Settings, under Images.' && (
                  <span className="tools-hint">{status.blocked}</span>
                )}
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={status.on}
              aria-label="Make images"
              className={`tools-toggle${status.on ? ' tools-toggle-on' : ''}`}
              disabled={busy || cannotTurnOn}
              onClick={() =>
                void change(
                  () => window.api.images.setOn(!status.on),
                  !status.on,
                  status.on ? 'Making images is off.' : 'Making images is on.'
                )
              }
            >
              {status.on ? 'On' : 'Off'}
            </button>
          </li>
        </ul>
      )}

      {main !== null && (
        <div className="images-prices">
          <table className="settings-usage images-table">
            <caption className="settings-hint">
              What one picture of {main.label} costs at most
              {main.published ? " (OpenAI's own table)" : ''}
            </caption>
            <thead>
              <tr>
                <th scope="col">Shape</th>
                {QUALITY_NAMES.map((q) => (
                  <th key={q} scope="col">
                    {QUALITY_LABELS[q]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {SHAPE_NAMES.map((shape) => (
                <tr key={shape}>
                  <th scope="row">{SHAPE_LABELS[shape]}</th>
                  {QUALITY_NAMES.map((q) => (
                    <td key={q}>{formatMoney(main.perPicture[shape][q])}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {ceilings.length > 0 && (
            <p className="settings-hint">
              {ceilings.map((m) => m.label).join(' and ')}: OpenAI does not publish their prices per
              picture, so the app counts a ceiling (up to{' '}
              {formatMoney(ceilings[0].perPicture.square.high)} a square picture) and shows the cost
              as &quot;about&quot;.
            </p>
          )}
        </div>
      )}
      {retiring.map((m) => (
        <p key={m.id} className="settings-hint" role="note">
          {m.label}{' '}
          {m.state === 'retired'
            ? `was retired by OpenAI on ${m.retires} and cannot be chosen.`
            : `is retired by OpenAI on ${m.retires}.`}
        </p>
      ))}
      {status?.registryError != null && (
        <p className="settings-notice settings-notice-error" role="alert">
          registry/images.json could not be read ({status.registryError}), so no picture can be
          made.
        </p>
      )}
    </section>
  )
}

export default ImagesSection
