import type { SettingsStatus } from '../../../shared/ipc'
import type { TaskId } from '../../../shared/rankings'
import { suggestionsForTask } from './format'

interface TaskPickerProps {
  /** What the main process says about settings; null until it has answered. */
  status: SettingsStatus | null
  /** What the person says they are doing, or null for no task. */
  task: TaskId | null
  onChange: (task: TaskId | null) => void
}

/**
 * The menu in the header that says what the person is doing. It changes nothing by itself: the model menu beside it
 * marks the models the providers' documentation names for that task, and the person picks (D-023).
 */
function TaskPicker({ status, task, onChange }: TaskPickerProps): React.JSX.Element | null {
  // Without a usable registry there is no model menu to mark, so there is nothing to ask about.
  if (status === null || status.modelsError !== null) return null

  const label = status.tasks.find((option) => option.id === task)?.label
  const suggestions = suggestionsForTask(status, task)
  const modelName = (id: string): string =>
    status.models.find((model) => model.id === id)?.label ?? id
  const title =
    task === null
      ? 'Say what you are doing. The model menu then marks the models the providers name for it. Nothing is chosen for you.'
      : suggestions.length === 0
        ? `None of the models you can use now is named for ${label?.toLowerCase()} in the providers' documentation. Nothing is guessed.`
        : [
            `Named for ${label?.toLowerCase()} in the providers' own pages (a shortlist, not a ranking; nothing is chosen for you):`,
            ...suggestions.map(
              (s) => `${modelName(s.modelId)}: ${s.note} (${s.source}, read ${s.asOf})`
            )
          ].join('\n')

  return (
    <>
      <select
        className="task-select"
        aria-label="Task"
        title={title}
        value={task ?? ''}
        onChange={(event) => {
          const value = event.target.value
          onChange(status.tasks.find((option) => option.id === value)?.id ?? null)
        }}
      >
        <option value="">Any task</option>
        {status.tasks.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
      {task !== null && suggestions.length === 0 && (
        <span className="app-badge task-note" title={title}>
          No suggestion for {label?.toLowerCase()}
        </span>
      )}
    </>
  )
}

export default TaskPicker
