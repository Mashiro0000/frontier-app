import { useEffect, useRef, useState } from 'react'
import type { SettingsStatus } from '../../../shared/ipc'
import AppearanceSection from './AppearanceSection'
import AskFirstSection from './AskFirstSection'
import ChatStorageSection from './ChatStorageSection'
import { formatDay, formatPrice, formatTokens, priceRatio, providerName } from './format'
import LimitsSection from './LimitsSection'
import ProviderKeySection from './ProviderKeySection'
import UsageSection from './UsageSection'
import VoiceSection from './VoiceSection'
import ImagesSection from './ImagesSection'
import UpdatesSection from './UpdatesSection'
import { IconChart, IconHistory, IconImage, IconKey, IconSettings } from '../icons'

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

/**
 * (24.7, D-056) Settings shows one group of sections at a time, as AI Fiesta's (until then every section was on one long page, D-052). The
 * list at the left picks the group. The keys come first: they are what a new person needs, and where the keyboard starts.
 */
const PANES = [
  { id: 'keys', label: 'Keys and model', icon: <IconKey /> },
  { id: 'usage', label: 'Usage and limits', icon: <IconChart /> },
  { id: 'media', label: 'Voice and images', icon: <IconImage /> },
  { id: 'chats', label: 'Saved chats', icon: <IconHistory /> },
  { id: 'general', label: 'General', icon: <IconSettings /> }
] as const
type PaneId = (typeof PANES)[number]['id']

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
  const [pane, setPane] = useState<PaneId>('keys')
  // (24.8) The long explanations are one click away: each section says one line until "Show details" is on.
  const [details, setDetails] = useState(false)

  // The parent decides whether the dialog is open; the <dialog> element does the modal work: it
  // traps focus, closes on Escape, and makes everything behind it unreachable.
  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) {
      dialog.showModal()
      // The keyboard starts in the first field of the page (the first key's box), as before the list of sections came first (D-052): the
      // list is one Shift+Tab away.
      dialog
        .querySelector<HTMLElement>(
          '.settings-body :is(input, select, textarea, button):not(:disabled)'
        )
        ?.focus()
    } else if (!open && dialog.open) dialog.close()
  }, [open])

  function handleClosed(): void {
    setSession((count) => count + 1)
    setPane('keys')
    onClose()
  }

  const model = status?.models.find((option) => option.id === status.selectedModelId)

  return (
    <dialog
      ref={dialogRef}
      className={details ? 'settings settings-details' : 'settings'}
      aria-labelledby="settings-title"
      onClose={handleClosed}
    >
      {/* (23.7, D-055) The title row stays in view, with the close button at its right (as ChatGPT's and Claude's). */}
      <div className="settings-top">
        <h2 id="settings-title" className="settings-title">
          Settings
        </h2>
        <button
          type="button"
          className="icon-button settings-close"
          title="Close (Esc)"
          aria-label="Close Settings"
          onClick={() => dialogRef.current?.close()}
        >
          <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>

      <div className="settings-layout">
        <nav className="settings-nav" aria-label="Sections of Settings">
          {PANES.map((item) => (
            <button
              key={item.id}
              type="button"
              className="settings-nav-item"
              aria-current={pane === item.id ? 'page' : undefined}
              onClick={() => {
                setPane(item.id)
                dialogRef.current?.scrollTo({ top: 0 })
              }}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
          <button
            type="button"
            className="settings-nav-item settings-details-toggle"
            aria-pressed={details}
            onClick={() => setDetails(!details)}
          >
            {details ? 'Hide details' : 'Show details'}
          </button>
        </nav>

        <div className="settings-body">
          <div className="settings-pane" hidden={pane !== 'keys'}>
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
                    Reads up to {formatTokens(model.contextWindow)} tokens.{' '}
                    {formatPrice(model.pricing.inputPerMTok)} in,{' '}
                    {formatPrice(model.pricing.outputPerMTok)} out per million tokens (checked{' '}
                    {status.modelsCheckedOn}).
                  </p>
                  {model.priceChange !== null && (
                    // (17.5, D-049) a change the provider has announced: the app prices each request at the prices of its day by itself
                    <p className="settings-hint settings-price-change">
                      From {formatDay(model.priceChange.from)}:{' '}
                      {formatPrice(model.priceChange.pricing.inputPerMTok)} per million tokens it
                      reads and {formatPrice(model.priceChange.pricing.outputPerMTok)} per million
                      tokens it writes
                      {model.priceChange.pricing.inputPerMTok > model.pricing.inputPerMTok
                        ? `, ${priceRatio(model.pricing, model.priceChange.pricing)}`
                        : ''}
                      . The app counts each request at the prices of the day it is sent.
                    </p>
                  )}
                  <p className="settings-hint">
                    Change it in the message box. Mid-chat, the whole chat goes to the new model.
                  </p>
                </>
              )}
            </section>
          </div>

          <div className="settings-pane" hidden={pane !== 'usage'}>
            <UsageSection
              open={open}
              conversationId={conversationId}
              limits={status?.limits ?? null}
            />

            {/* Fresh each time Settings opens (and closes), so the boxes show the limits as they are saved NOW: they may have been chosen in the first-run question. */}
            <LimitsSection
              key={`${session}:${open}`}
              status={status}
              onStatusChange={onStatusChange}
            />

            {/* Its own key: the section above has `${session}:${open}`, and two children of one parent must not share a key. */}
            <AskFirstSection
              key={`ask-first:${session}:${open}`}
              status={status}
              onStatusChange={onStatusChange}
            />
          </div>

          <div className="settings-pane" hidden={pane !== 'media'}>
            {/* Voice (D-047): fresh each time Settings is closed, like the section below. */}
            <VoiceSection key={`voice:${session}`} open={open} />

            {/* Images (D-048): fresh each time Settings is closed, like the sections around it. */}
            <ImagesSection key={`images:${session}`} open={open} />
          </div>

          <div className="settings-pane" hidden={pane !== 'chats'}>
            {/* Fresh each time Settings is closed, so a notice about the last change is not still there the next time it opens. */}
            <ChatStorageSection
              key={`chat-storage:${session}`}
              open={open}
              onChanged={onChatStorageChanged}
            />
          </div>

          <div className="settings-pane" hidden={pane !== 'general'}>
            {/* Appearance (D-051): dark or light, as the button at the foot of the sidebar. */}
            <AppearanceSection />
            {/* Updates (D-050): fresh each time Settings is closed, like the sections around it. */}
            <UpdatesSection key={`updates:${session}`} open={open} />
          </div>
        </div>
      </div>
    </dialog>
  )
}

export default SettingsDialog
