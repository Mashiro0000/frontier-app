import { useState } from 'react'
import type { SettingsStatus } from '../../../shared/ipc'
import {
  parseLimitText,
  sameLimits,
  type LimitChoice,
  type LimitSetting,
  type Limits
} from '../../../shared/limits'

interface LimitsFormProps {
  /** The limits as they are saved now (a limit not chosen yet has an empty box). */
  limits: Limits
  /** Makes the ids of the boxes unique when two forms exist (the first-run dialog and Settings are never open together, but belt and braces). */
  idPrefix: string
  submitLabel: string
  /** Called with the new settings after the limits are saved. */
  onSaved: (status: SettingsStatus) => void
  /** Another button beside the save button (the first-run dialog's "Not now"). */
  secondary?: React.ReactNode
}

interface Field {
  /** What is typed in the amount box. */
  text: string
  /** "No limit" is ticked. */
  none: boolean
}

type Notice = { kind: 'ok' | 'error'; text: string }

const fieldOf = (setting: LimitSetting): Field => ({
  text: setting.kind === 'usd' ? setting.usd.toFixed(2) : '',
  none: setting.kind === 'none'
})

/** What the field says, as a choice, or why it cannot be one yet (null while the box is simply empty, so nothing shouts before typing). */
function readField(field: Field): { choice: LimitChoice } | { error: string | null } {
  if (field.none) return { choice: { kind: 'none' } }
  const parsed = parseLimitText(field.text)
  if (parsed.ok) return { choice: { kind: 'usd', usd: parsed.usd } }
  return { error: field.text.trim() === '' ? null : parsed.error }
}

interface LimitFieldProps {
  id: string
  label: string
  field: Field
  error: string | null
  disabled: boolean
  onChange: (field: Field) => void
}

function LimitField({
  id,
  label,
  field,
  error,
  disabled,
  onChange
}: LimitFieldProps): React.JSX.Element {
  return (
    <div className="limit-field">
      <label className="settings-label" htmlFor={id}>
        {label}
      </label>
      <div className="limit-row">
        <span className="limit-currency" aria-hidden="true">
          $
        </span>
        <input
          id={id}
          className="settings-input limit-amount"
          type="text"
          inputMode="decimal"
          autoComplete="off"
          spellCheck={false}
          placeholder="for example 5.00"
          value={field.text}
          disabled={disabled || field.none}
          aria-invalid={error !== null}
          aria-describedby={error !== null ? `${id}-problem` : undefined}
          onChange={(event) => onChange({ ...field, text: event.target.value })}
        />
        <label className="limit-none">
          <input
            type="checkbox"
            checked={field.none}
            disabled={disabled}
            onChange={(event) => onChange({ ...field, none: event.target.checked })}
          />
          No limit
        </label>
      </div>
      {error !== null && (
        <p id={`${id}-problem`} className="settings-notice settings-notice-error">
          {error}
        </p>
      )}
    </div>
  )
}

/**
 * The daily and the monthly spending limit, in US dollars, each with a deliberate "No limit" (D-031). Both are chosen together: the app
 * refuses every request until both are. There is no amount filled in for the person. The main process checks what is sent again and is
 * what enforces the limits; this form only collects the choice.
 */
function LimitsForm({
  limits,
  idPrefix,
  submitLabel,
  onSaved,
  secondary
}: LimitsFormProps): React.JSX.Element {
  const [daily, setDaily] = useState<Field>(() => fieldOf(limits.daily))
  const [monthly, setMonthly] = useState<Field>(() => fieldOf(limits.monthly))
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<Notice | null>(null)

  const readDaily = readField(daily)
  const readMonthly = readField(monthly)
  const choice =
    'choice' in readDaily && 'choice' in readMonthly
      ? { daily: readDaily.choice, monthly: readMonthly.choice }
      : null
  const unchanged = choice !== null && sameLimits(choice, limits)
  const canSave = !busy && choice !== null && !unchanged
  const dailyAbove =
    choice !== null &&
    choice.daily.kind === 'usd' &&
    choice.monthly.kind === 'usd' &&
    choice.daily.usd > choice.monthly.usd

  async function save(event: React.FormEvent): Promise<void> {
    event.preventDefault()
    if (!canSave || choice === null) return
    setBusy(true)
    setNotice(null)
    try {
      const result = await window.api.settings.setLimits(choice)
      if (result.ok) {
        onSaved(result.status)
        setNotice({ kind: 'ok', text: 'Saved.' })
      } else {
        setNotice({ kind: 'error', text: result.error })
      }
    } catch {
      setNotice({ kind: 'error', text: 'The limits could not be saved: the app did not answer.' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="limits-form" onSubmit={save}>
      <LimitField
        id={`${idPrefix}-daily`}
        label="Daily limit (US dollars)"
        field={daily}
        error={'error' in readDaily ? readDaily.error : null}
        disabled={busy}
        onChange={setDaily}
      />
      <LimitField
        id={`${idPrefix}-monthly`}
        label="Monthly limit (US dollars)"
        field={monthly}
        error={'error' in readMonthly ? readMonthly.error : null}
        disabled={busy}
        onChange={setMonthly}
      />
      {(daily.none || monthly.none) && (
        <p className="settings-hint limits-warning">
          With No limit, nothing in this app stops spending for that period; only a limit set in
          your provider&apos;s own account would.
        </p>
      )}
      {dailyAbove && (
        <p className="settings-hint">
          The daily limit is higher than the monthly one, so the monthly limit will always stop you
          first.
        </p>
      )}
      <div className="settings-actions">
        <button type="submit" className="button" disabled={!canSave}>
          {submitLabel}
        </button>
        {secondary}
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

export default LimitsForm
