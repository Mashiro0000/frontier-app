import { useEffect, useRef, useState } from 'react'
import type { SettingsStatus } from '../../../shared/ipc'
import AskFirstSection from './AskFirstSection'
import ChatStorageSection from './ChatStorageSection'
import { formatPrice, formatTokens, providerName } from './format'
import LimitsSection from './LimitsSection'
import ProviderKeySection from './ProviderKeySection'
import UsageSection from './UsageSection'
import VoiceSection from './VoiceSection'
import ImagesSection from './ImagesSection'

interface SettingsDialogProps {
  open: boolean
  status: SettingsStatus | null
  /** Set if the main process could not be reached. */
  loadError: string | null
  onStatusChange: (status: SettingsStatus) => void
  onClose: () => void
  /** The conversation on screen, so that Usage can say what it has cost (D-030). */
  conversationId: string
  /** Called after the saved chats were encrypted or turned back to plain files, so that the History list looks again (D-035). */
  onChatStorageChanged: () => void
}

function SettingsDialog({
  open,
  status,
  loadError,
  onStatusChange,
  onClose,
  conversationId,
  onChatStorageChanged
}: SettingsDialogProps): React.JSX.Element {
  const dialogRef = useRef<HTMLDialogElement>(null)
  // Each key section holds what the person is typing and what it last said. Closing the dialog gives them new keys, so
  // they start afresh the next time: a half-typed key is not left sitting in the page.
  const [session, setSession] = useState(0)

  // The parent decides whether the dialog is open; the <dialog> element does the modal work: it
  // traps focus, closes on Escape, and makes everything behind it unreachable.
  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    else if (!open && dialog.open) dialog.close()
  }, [open])

  function handleClosed(): void {
    setSession((count) => count + 1)
    onClose()
  }

  const model = status?.models.find((option) => option.id === status.selectedModelId)

  return (
    <dialog
      ref={dialogRef}
      className="settings"
      aria-labelledby="settings-title"
      onClose={handleClosed}
    >
      <h2 id="settings-title" className="settings-title">
        Settings
      </h2>

      {status === null ? (
        <section className="settings-section">
          <h3 className="settings-heading">API keys</h3>
          <p className="settings-status">
            {loadError ? `Settings are unavailable: ${loadError}.` : 'Checking...'}
          </p>
        </section>
      ) : (
        status.providers.map((provider) => (
          <ProviderKeySection
            key={`${provider.id}:${session}`}
            provider={provider}
            canStoreKey={status.canStoreKey}
            onStatusChange={onStatusChange}
          />
        ))
      )}

      <section className="settings-section" aria-labelledby="settings-model-heading">
        <h3 id="settings-model-heading" className="settings-heading">
          Model
        </h3>
        {status?.modelsError && (
          <p className="settings-notice settings-notice-error" role="status">
            The list of models could not be loaded: {status.modelsError}.
          </p>
        )}
        {status && model && (
          <>
            <p className="settings-status">
              {model.label}, from {providerName(status, model.provider)}
            </p>
            <p className="settings-hint">{model.description}</p>
            <p className="settings-hint">
              It can read about {formatTokens(model.contextWindow)} tokens of conversation at once.
              List price: {formatPrice(model.pricing.inputPerMTok)} per million tokens it reads and{' '}
              {formatPrice(model.pricing.outputPerMTok)} per million tokens it writes, billed to
              your {providerName(status, model.provider)} account. Prices were checked on{' '}
              {status.modelsCheckedOn}.
            </p>
            <p className="settings-hint">
              Change the model with the menu in the header. If you change it in the middle of a
              chat, the whole chat so far is sent to the new model with your next message.
            </p>
          </>
        )}
      </section>

      <UsageSection open={open} conversationId={conversationId} limits={status?.limits ?? null} />

      {/* Fresh each time Settings opens (and closes), so the boxes show the limits as they are saved NOW: they may have been chosen in the first-run question. */}
      <LimitsSection key={`${session}:${open}`} status={status} onStatusChange={onStatusChange} />

      {/* Its own key: the section above has `${session}:${open}`, and two children of one parent must not share a key. */}
      <AskFirstSection
        key={`ask-first:${session}:${open}`}
        status={status}
        onStatusChange={onStatusChange}
      />

      {/* Voice (D-047): fresh each time Settings is closed, like the section below. */}
      <VoiceSection key={`voice:${session}`} open={open} />

      {/* Images (D-048): fresh each time Settings is closed, like the sections around it. */}
      <ImagesSection key={`images:${session}`} open={open} />

      {/* Fresh each time Settings is closed, so a notice about the last change is not still there the next time it opens. */}
      <ChatStorageSection
        key={`chat-storage:${session}`}
        open={open}
        onChanged={onChatStorageChanged}
      />

      <div className="settings-footer">
        <button
          type="button"
          className="button button-secondary"
          onClick={() => dialogRef.current?.close()}
        >
          Close
        </button>
      </div>
    </dialog>
  )
}

export default SettingsDialog
