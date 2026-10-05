import { useState } from 'react'
import {
  ASK_FIRST_DEFAULT_USD,
  askFirstAmount,
  parseAskFirstText,
  sameAskFirst,
  type AskFirstChoice,
  type AskFirstSetting
} from '../../../shared/askFirst'
import type { SettingsStatus } from '../../../shared/ipc'
import AmountField, { type AmountFieldState } from './AmountField'
import { formatCost } from './format'

interface AskFirstSectionProps {
  status: SettingsStatus | null
  onStatusChange: (status: SettingsStatus) => void
}

type Notice = { kind: 'ok' | 'error'; text: string }

const fieldOf = (setting: AskFirstSetting): AmountFieldState => ({
  text: setting.kind === 'usd' ? setting.usd.toFixed(2) : '',
  none: setting.kind === 'never'
})

/** What the field says, as a choice, or why it cannot be one yet (null while the box is simply empty, so nothing shouts before typing). */
function readField(field: AmountFieldState): { choice: AskFirstChoice } | { error: string | null } {
  if (field.none) return { choice: { kind: 'never' } }
  const parsed = parseAskFirstText(field.text)
  if (parsed.ok) return { choice: { kind: 'usd', usd: parsed.usd } }
  return { error: field.text.trim() === '' ? null : parsed.error }
}

/** Which amount is in force now, in a sentence. */
function inForce(setting: AskFirstSetting): string {
  const above = askFirstAmount(setting)
  if (above === null) return 'The question is off: a large request is sent without asking.'
  return setting.kind === 'default'
    ? `You have not chosen an amount, so the app asks above ${formatCost(above)}.`
    : `The app asks above ${formatCost(above)}.`
}

interface AskFirstFormProps {
  setting: AskFirstSetting
  onSaved: (status: SettingsStatus) => void
}

function AskFirstForm({ setting, onSaved }: AskFirstFormProps): React.JSX.Element {
  const [field, setField] = useState<AmountFieldState>(() => fieldOf(setting))
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<Notice | null>(null)

  const read = readField(field)
  const choice = 'choice' in read ? read.choice : null
  const unchanged = choice !== null && sameAskFirst(choice, setting)
  const canSave = !busy && choice !== null && !unchanged

  async function save(event: React.FormEvent): Promise<void> {
    event.preventDefault()
    if (!canSave || choice === null) return
    setBusy(true)
    setNotice(null)
    try {
      const result = await window.api.settings.setAskFirst(choice)
      if (result.ok) {
        onSaved(result.status)
        setNotice({ kind: 'ok', text: 'Saved.' })
      } else {
        setNotice({ kind: 'error', text: result.error })
      }
    } catch {
      setNotice({ kind: 'error', text: 'The choice could not be saved: the app did not answer.' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="limits-form" onSubmit={save}>
      <AmountField
        id="ask-first-amount"
        label="Ask first above (US dollars)"
        field={field}
        error={'error' in read ? read.error : null}
        disabled={busy}
        noneLabel="Never ask"
        placeholder={`${ASK_FIRST_DEFAULT_USD.toFixed(2)} (the default)`}
        onChange={setField}
      />
      {field.none && (
        <p className="settings-hint limits-warning">
          With Never ask, a request is sent without this question, however large it is. The spending
          limits above still stop a request that would pass them.
        </p>
      )}
      <div className="settings-actions">
        <button type="submit" className="button" disabled={!canSave}>
          Save
        </button>
      </div>
      {notice && (
        <p
          className={
            notice.kind === 'error' ? 'settings-notice settings-notice-error' : 'settings-notice'
          }
          role="status"
        >
          {notice.text}
        </p>
      )}
    </form>
  )
}

/**
 * "Large requests" in Settings (D-032): the amount above which the app shows what a request could cost and asks first, or a deliberate "Never
 * ask". Until the person picks an amount the default applies (this is only a question; the spending limits are the hard stop, and are the
 * person's alone). The main process asks the question, in the one place a provider is called; this section only collects the choice.
 */
function AskFirstSection({ status, onStatusChange }: AskFirstSectionProps): React.JSX.Element {
  return (
    <section className="settings-section" aria-labelledby="settings-ask-first-heading">
      <h3 id="settings-ask-first-heading" className="settings-heading">
        Large requests
      </h3>
      {status === null ? (
        <p className="settings-status">Checking...</p>
      ) : (
        <>
          <p className="settings-hint">
            Before a request that is large, the app shows what it could cost at the most and asks
            first. A request is large when sending it, the whole conversation so far (which goes out
            again with every message), could cost more than the amount below at list prices. The
            reply is not part of that, because its length is not known in advance; the question
            shows the most it could cost too.
          </p>
          <p className="settings-status">{inForce(status.askFirst)}</p>
          <AskFirstForm setting={status.askFirst} onSaved={onStatusChange} />
        </>
      )}
    </section>
  )
}

export default AskFirstSection
