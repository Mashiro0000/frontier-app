import { useEffect, useMemo, useRef, useState } from 'react'
import {
  costTier,
  costTierBadge,
  costTierWords,
  perMillion,
  type CostTier
} from '../../../shared/costTier'
import type { ModelOption, SettingsStatus } from '../../../shared/ipc'
import type { ProviderId } from '../../../shared/registry'
import type { TaskId } from '../../../shared/rankings'
import { providerName, suggestionsForTask } from './format'

interface ModelChooserProps {
  open: boolean
  status: SettingsStatus
  /** The model shown as chosen: the one the person just picked while main answers, or main's choice. */
  chosenId: string
  /** What the person says they are doing: the models the providers name for it are marked (D-023). */
  task: TaskId | null
  onChoose: (modelId: string) => void
  onClose: () => void
}

const TIERS: CostTier[] = [1, 2, 3, 4]

/** The words a search looks in: the name, the maker, the id and the description. */
const haystack = (status: SettingsStatus, model: ModelOption): string =>
  `${model.label} ${providerName(status, model.provider)} ${model.id} ${model.description}`.toLowerCase()

/**
 * (21.1, D-053) The model chooser, as AI Fiesta's: a dialog with a search, a filter by maker and by cost, and every model as a card with its
 * maker, a cost badge ($ to $$$$) and its exact prices, "suggested" for the chosen task, and "no key" when its maker has no key saved. Choosing
 * one does what the model menu does (main saves it); the menu stays the one source of the choice (and what the keyboard uses).
 */
function ModelChooser({
  open,
  status,
  chosenId,
  task,
  onChoose,
  onClose
}: ModelChooserProps): React.JSX.Element {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [maker, setMaker] = useState<ProviderId | null>(null)
  const [tier, setTier] = useState<CostTier | null>(null)

  // The parent decides whether the dialog is open; the <dialog> element does the modal work (as SettingsDialog). Each opening starts unfiltered.
  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) {
      setQuery('')
      setMaker(null)
      setTier(null)
      dialog.showModal()
      searchRef.current?.focus()
    } else if (!open && dialog.open) {
      dialog.close()
    }
  }, [open])

  const named = useMemo(
    () => new Set(suggestionsForTask(status, task).map((suggestion) => suggestion.modelId)),
    [status, task]
  )
  const taskLabel = status.tasks.find((option) => option.id === task)?.label ?? null
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const shown = status.models.filter(
    (model) =>
      (maker === null || model.provider === maker) &&
      (tier === null || costTier(model.pricing) === tier) &&
      words.every((word) => haystack(status, model).includes(word))
  )
  const makers = status.providers.filter((provider) =>
    status.models.some((model) => model.provider === provider.id)
  )

  return (
    <dialog
      ref={dialogRef}
      className="model-chooser"
      aria-labelledby="model-chooser-title"
      onClose={onClose}
      onClick={(event) => {
        // A click on the backdrop (the dialog element itself, outside its box) closes it.
        if (event.target === dialogRef.current) onClose()
      }}
    >
      <div className="model-chooser-head">
        <div>
          <h2 id="model-chooser-title" className="settings-title">
            Choose a model
          </h2>
          <p className="settings-hint">
            {status.models.length} models from {makers.length} makers. Prices are per million
            tokens, sent / written
            {status.modelsCheckedOn !== null ? `, checked on ${status.modelsCheckedOn}` : ''}.
          </p>
        </div>
        <button
          type="button"
          className="icon-button"
          title="Close"
          aria-label="Close"
          onClick={onClose}
        >
          <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>
      <div className="model-chooser-tools">
        <input
          ref={searchRef}
          className="model-chooser-search"
          type="search"
          placeholder="Search models..."
          aria-label="Search models"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <div className="model-chooser-filters" role="group" aria-label="Maker">
          <button
            type="button"
            className="chip"
            aria-pressed={maker === null}
            onClick={() => setMaker(null)}
          >
            All
          </button>
          {makers.map((provider) => (
            <button
              key={provider.id}
              type="button"
              className="chip"
              aria-pressed={maker === provider.id}
              onClick={() => setMaker(maker === provider.id ? null : provider.id)}
            >
              {provider.name}
            </button>
          ))}
        </div>
        <div className="model-chooser-filters" role="group" aria-label="Cost">
          {TIERS.map((step) => (
            <button
              key={step}
              type="button"
              className="chip"
              aria-pressed={tier === step}
              title={costTierWords(step)}
              onClick={() => setTier(tier === step ? null : step)}
            >
              {costTierBadge(step)}
              <span className="visually-hidden"> {costTierWords(step)}</span>
            </button>
          ))}
        </div>
      </div>
      <ul className="model-chooser-list" aria-label="Models">
        {shown.map((model) => {
          const step = costTier(model.pricing)
          const hasKey =
            status.providers.find((provider) => provider.id === model.provider)?.hasKey === true
          const chosen = model.id === chosenId
          return (
            <li key={model.id}>
              <button
                type="button"
                className="model-card"
                aria-pressed={chosen}
                data-model={model.id}
                onClick={() => onChoose(model.id)}
              >
                <span className="model-card-top">
                  <span className={`maker-dot maker-${model.provider}`} aria-hidden="true" />
                  <span className="model-card-name">{model.label}</span>
                  {chosen && (
                    <svg className="icon model-card-check" viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M5 12.5l4.5 4.5L19 7.5" />
                    </svg>
                  )}
                </span>
                <span className="model-card-maker">{providerName(status, model.provider)}</span>
                <span className="model-card-desc">{model.description}</span>
                <span className="model-card-tags">
                  <span className={`cost-badge cost-${step}`} title={costTierWords(step)}>
                    {costTierBadge(step)}
                  </span>
                  <span className="model-card-price">
                    {perMillion(model.pricing.inputPerMTok)} /{' '}
                    {perMillion(model.pricing.outputPerMTok)}
                  </span>
                  {named.has(model.id) && (
                    <span className="model-tag model-tag-good">
                      Suggested{taskLabel !== null ? ` for ${taskLabel.toLowerCase()}` : ''}
                    </span>
                  )}
                  {!hasKey && <span className="model-tag model-tag-warn">No key</span>}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
      {shown.length === 0 && <p className="settings-hint model-chooser-none">No model matches.</p>}
    </dialog>
  )
}

export default ModelChooser
