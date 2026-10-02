import { useState } from 'react'
import type { SettingsStatus } from '../../../shared/ipc'
import { effortOptionText } from './format'

interface EffortPickerProps {
  /** What the main process says about settings; null until it has answered. */
  status: SettingsStatus | null
  /**
   * True while a reply is arriving. The effort is fixed when a reply starts, like the model (D-015, D-024), so changing it now
   * would leave the header describing a reply that is not the one arriving.
   */
  disabled: boolean
  onStatusChange: (status: SettingsStatus) => void
}

const HINT =
  'How hard the model thinks before it answers. A higher level is slower and costs more: the thinking is billed as output. ' +
  'Replies have a length limit that the thinking counts against, so at the highest levels a reply may be cut off.'

/**
 * The menu in the header that says how hard the model thinks (D-024). It offers only the levels main says the chosen model takes,
 * and is not shown for a model that takes none (Haiku 4.5). The choice is kept per model by the main process, which checks it
 * again; the level the registry picks stays in force until the person chooses another.
 */
function EffortPicker({
  status,
  disabled,
  onStatusChange
}: EffortPickerProps): React.JSX.Element | null {
  // The choice the person just made, shown until main has answered, so the menu does not flick back to the old level for a
  // moment. It is not disabled meanwhile, for the reason the model menu is not: holding an arrow key makes several calls, and main
  // handles them one at a time, in order.
  const [pending, setPending] = useState<{ modelId: string; level: string } | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Nothing is shown until the main process has answered, and nothing for a model that takes no such setting.
  if (
    status === null ||
    status.modelsError !== null ||
    status.effort === null ||
    status.selectedModelId === null
  ) {
    return null
  }
  const { effort } = status
  const modelId = status.selectedModelId

  async function choose(level: string): Promise<void> {
    setPending({ modelId, level })
    setError(null)
    try {
      const result = await window.api.settings.setEffort(modelId, level)
      if (result.ok) onStatusChange(result.status)
      else setError(result.error)
    } catch {
      setError('The effort could not be changed: the app did not answer.')
    } finally {
      // A newer choice made meanwhile stays on show until its own answer arrives.
      setPending((current) =>
        current?.modelId === modelId && current.level === level ? null : current
      )
    }
  }

  const shown = pending?.modelId === modelId ? pending.level : effort.selected
  return (
    <>
      <select
        className="effort-select"
        aria-label="Effort"
        title={disabled ? 'The effort can be changed when the reply has finished.' : HINT}
        value={shown}
        disabled={disabled}
        onChange={(event) => void choose(event.target.value)}
      >
        {effort.levels.map((level) => (
          <option key={level} value={level}>
            {effortOptionText(level, effort)}
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

export default EffortPicker
