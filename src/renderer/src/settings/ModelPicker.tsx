import { useState } from 'react'
import type { SettingsStatus } from '../../../shared/ipc'

interface ModelPickerProps {
  /** What the main process says about settings; null until it has answered. */
  status: SettingsStatus | null
  /**
   * True while a reply is arriving. The model is fixed when a reply starts, so changing it now would
   * leave the header naming a model that is not the one answering.
   */
  disabled: boolean
  onStatusChange: (status: SettingsStatus) => void
}

/** The menu in the header that chooses which model answers. The list comes from the registry. */
function ModelPicker({
  status,
  disabled,
  onStatusChange
}: ModelPickerProps): React.JSX.Element | null {
  // The choice the person just made, shown until main has answered, so the menu does not flick back to
  // the old model for a moment. It is not disabled meanwhile: holding an arrow key changes the choice
  // for every option it passes, and main handles those calls one at a time, in order.
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Nothing is shown until the main process has answered, so the header never flashes a wrong model.
  if (status === null) return null
  if (status.modelsError !== null) {
    return (
      <span className="app-badge app-badge-warn" title={status.modelsError}>
        Models unavailable
      </span>
    )
  }

  async function choose(modelId: string): Promise<void> {
    setPendingId(modelId)
    setError(null)
    try {
      const result = await window.api.settings.setModel(modelId)
      if (result.ok) onStatusChange(result.status)
      else setError(result.error)
    } catch {
      setError('The model could not be changed: the app did not answer.')
    } finally {
      // A newer choice made meanwhile stays on show until its own answer arrives.
      setPendingId((current) => (current === modelId ? null : current))
    }
  }

  const shown = pendingId ?? status.selectedModelId ?? ''
  const label = status.models.find((model) => model.id === shown)?.label
  return (
    <>
      <select
        className="header-select"
        aria-label="Model"
        title={
          disabled
            ? 'The model can be changed when the reply has finished.'
            : `${label ?? 'Model'}. The details are in Settings.`
        }
        value={shown}
        disabled={disabled}
        onChange={(event) => void choose(event.target.value)}
      >
        {status.models.map((model) => (
          <option key={model.id} value={model.id}>
            {model.label}
          </option>
        ))}
      </select>
      {error !== null && (
        <span className="app-badge app-badge-warn" role="alert">
          {error}
        </span>
      )}
    </>
  )
}

export default ModelPicker
