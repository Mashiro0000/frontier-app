import { useEffect, useState } from 'react'
import { VOICE_RATE_BOUNDS, type VoiceChangeResult } from '../../../shared/voice'
import { speaker } from '../voice/speaker'
import { useSpeaker } from '../voice/useSpeaker'
import { reloadVoiceStatus, setVoiceStatus, useVoiceStatus } from '../voice/voiceStatus'

const NO_ANSWER = 'the app did not answer'
const WAITING = 'Waiting for your answer in the Windows message box...'
const RATES = [50, 75, 100, 125, 150, 175, 200].filter(
  (rate) => rate >= VOICE_RATE_BOUNDS.min && rate <= VOICE_RATE_BOUNDS.max
)
const TRY_WORDS = 'This is how the replies will sound.'

type Notice = { kind: 'ok' | 'error'; text: string }

interface VoiceSectionProps {
  /** Whether Settings is open: the section looks at the settings and the voices again each time it opens. */
  open: boolean
}

/**
 * "Voice" in Settings (Stage 15.6, D-047): the two switches, the voice and the speed. Main keeps them (voice.json) and the page only shows them and asks for a change.
 * "Speak to type" is switched ON only after the person's yes in the system's own message box, which this page cannot answer; OFF is at once. "Read aloud" uses the
 * voices of this computer, so it sends nothing anywhere and asks nothing.
 */
function VoiceSection({ open }: VoiceSectionProps): React.JSX.Element {
  const status = useVoiceStatus()
  const reading = useSpeaker()
  const [notice, setNotice] = useState<Notice | null>(null)
  const [busy, setBusy] = useState(false)
  const [voices, setVoices] = useState<string[]>([])
  const [starting, setStarting] = useState(false)

  useEffect(() => {
    if (!open) return
    reloadVoiceStatus()
    let alive = true
    void speaker.voices().then((names) => {
      if (alive) setVoices(names)
    })
    return () => {
      alive = false
      speaker.stop() // a "Try the voice" does not go on after Settings is closed
    }
  }, [open])

  /** Sends one change to main and shows what came of it. */
  async function change(
    send: () => Promise<VoiceChangeResult>,
    waits: boolean,
    done: string
  ): Promise<void> {
    setBusy(true)
    setNotice(waits ? { kind: 'ok', text: WAITING } : null)
    let result: VoiceChangeResult
    try {
      result = await send()
    } catch {
      result = { ok: false, error: `The voice settings could not be changed: ${NO_ANSWER}.` }
    }
    setBusy(false)
    if (result.ok) {
      setVoiceStatus(result.status)
      setNotice({ kind: 'ok', text: done })
    } else {
      setNotice({ kind: 'error', text: result.error })
      reloadVoiceStatus()
    }
  }

  const listenBlocked = status !== null && !status.listen && status.listenBlocked !== null
  const trying = reading.speaking === 'voice-try'

  return (
    <section className="settings-section voice-section" aria-labelledby="settings-voice-heading">
      <h3 id="settings-voice-heading" className="settings-heading">
        Voice
      </h3>
      <p className="settings-hint">
        Speak to type: a microphone button appears under the message box. Hold it, say your message
        and let go; OpenAI writes it down and the words appear in the box. Nothing is sent until you
        press Send. Anthropic has no speech service, so your voice goes to OpenAI, with your OpenAI
        key, even when you chat with Claude. The app keeps no recording. Read aloud uses a voice of
        this computer: nothing leaves it.
      </p>

      {notice !== null && (
        <p
          className={`settings-notice${notice.kind === 'error' ? ' settings-notice-error' : ''}`}
          role={notice.kind === 'error' ? 'alert' : 'status'}
        >
          {notice.text}
        </p>
      )}

      {status === null && <p className="settings-status">Reading the voice settings...</p>}

      {status !== null && status.problem !== null && (
        <div className="tools-problem" role="alert">
          <p>
            Your voice settings could not be read ({status.problem}), so both switches are off and
            nothing can be turned on. The app keeps a copy of the file.
          </p>
          {starting ? (
            <span className="tools-confirm">
              Start again with both switches off?{' '}
              <button
                type="button"
                className="history-button"
                disabled={busy}
                onClick={() => {
                  setStarting(false)
                  void change(
                    () => window.api.voice.reset(),
                    false,
                    'The voice settings start again: both switches are off.'
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
        <ul className="tools-switches" aria-label="Voice">
          <li className="tools-switch">
            <div className="tools-switch-text">
              <span className="tools-switch-title">Speak to type</span>
              <span className="tools-hint">
                Costs about ${status.usdPerMinute} a minute (at most {status.maxSeconds} seconds a
                recording), counted in your spending limits.
              </span>
              {listenBlocked && <span className="tools-hint">{status.listenBlocked}</span>}
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={status.listen}
              aria-label="Speak to type"
              className={`tools-toggle${status.listen ? ' tools-toggle-on' : ''}`}
              disabled={busy || status.problem !== null || listenBlocked}
              onClick={() =>
                void change(
                  () => window.api.voice.setListen(!status.listen),
                  !status.listen,
                  status.listen ? 'Speak to type is off.' : 'Speak to type is on.'
                )
              }
            >
              {status.listen ? 'On' : 'Off'}
            </button>
          </li>
          <li className="tools-switch">
            <div className="tools-switch-text">
              <span className="tools-switch-title">Read aloud</span>
              <span className="tools-hint">
                Adds a Read aloud button under each reply. A reply is never read without a click.
              </span>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={status.speak}
              aria-label="Read aloud"
              className={`tools-toggle${status.speak ? ' tools-toggle-on' : ''}`}
              disabled={busy || status.problem !== null}
              onClick={() =>
                void change(
                  () => window.api.voice.setSpeak(!status.speak),
                  false,
                  status.speak ? 'Read aloud is off.' : 'Read aloud is on.'
                )
              }
            >
              {status.speak ? 'On' : 'Off'}
            </button>
          </li>
        </ul>
      )}

      {status !== null && status.problem === null && (
        <div className="voice-pick">
          <label className="voice-pick-field">
            <span className="settings-hint">Voice (a voice of this computer)</span>
            <select
              aria-label="Voice"
              value={status.voice !== null && voices.includes(status.voice) ? status.voice : ''}
              disabled={busy || voices.length === 0}
              onChange={(event) =>
                void change(
                  () => window.api.voice.setVoice(event.target.value || null, status.rate),
                  false,
                  'The voice is kept.'
                )
              }
            >
              <option value="">The default of this computer</option>
              {voices.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label className="voice-pick-field">
            <span className="settings-hint">Speed</span>
            <select
              aria-label="Speed"
              value={status.rate}
              disabled={busy}
              onChange={(event) =>
                void change(
                  () => window.api.voice.setVoice(status.voice, Number(event.target.value)),
                  false,
                  'The speed is kept.'
                )
              }
            >
              {(RATES.includes(status.rate)
                ? RATES
                : [...RATES, status.rate].sort((a, b) => a - b)
              ).map((rate) => (
                <option key={rate} value={rate}>
                  {rate}%
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="history-button"
            onClick={() =>
              trying
                ? speaker.stop()
                : speaker.speak('voice-try', TRY_WORDS, { voice: status.voice, rate: status.rate })
            }
          >
            {trying ? 'Stop' : 'Try the voice'}
          </button>
        </div>
      )}
      {reading.notice !== null && reading.speaking === null && open && (
        <p className="settings-hint" role="status">
          {reading.notice}
        </p>
      )}
    </section>
  )
}

export default VoiceSection
