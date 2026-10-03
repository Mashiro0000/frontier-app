/** What an amount box and its tick-box hold: what is typed, and whether the deliberate "none" choice ("No limit", "Never ask") is ticked. */
export interface AmountFieldState {
  /** What is typed in the amount box. */
  text: string
  /** The "none" choice is ticked. */
  none: boolean
}

interface AmountFieldProps {
  id: string
  label: string
  field: AmountFieldState
  error: string | null
  disabled: boolean
  /** What the tick-box says: "No limit" for a spending limit, "Never ask" for the question before a large request. */
  noneLabel: string
  placeholder: string
  onChange: (field: AmountFieldState) => void
}

/**
 * One amount in US dollars with a deliberate "none" beside it, shared by the spending limits (D-031) and the question before a large request
 * (D-032). It only collects what is typed: the form that owns it reads the text with its own rules, and the main process checks again.
 */
function AmountField({
  id,
  label,
  field,
  error,
  disabled,
  noneLabel,
  placeholder,
  onChange
}: AmountFieldProps): React.JSX.Element {
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
          placeholder={placeholder}
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
          {noneLabel}
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

export default AmountField
