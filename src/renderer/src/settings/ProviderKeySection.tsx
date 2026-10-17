import { useState } from 'react'
import type { ProviderStatus, SettingsStatus } from '../../../shared/ipc'
import { checkApiKey } from '../../../shared/validate'
import { KEY_HELP } from './providerCopy'

interface ProviderKeySectionProps {
  provider: ProviderStatus
  /** False if this computer has no secure place to keep a key: saving is then refused. */
  canStoreKey: boolean
  /** Called with the new settings after a key is saved or removed. */
  onStatusChange: (status: SettingsStatus) => void
}

type Notice = { kind: 'ok' | 'error'; text: string }
type Busy = 'save' | 'test' | 'remove' | null

function describeStatus(provider: ProviderStatus, canStoreKey: boolean): string {
  if (!canStoreKey) return 'This computer has no secure storage, so a key cannot be saved here.'
  return provider.hasKey ? 'A key is saved.' : 'No key is saved yet.'
}

function describeTest(providerName: string, modelCount: number): string {
  if (modelCount === 0) return `The key was accepted, but ${providerName} lists no models for it.`
  return `The key was accepted. ${providerName} lists ${modelCount} model${modelCount === 1 ? '' : 's'} for it.`
}

/**
 * One provider's API key: add it, test it, remove it. The key is handed to the main process, which keeps it encrypted
 * and never sends it back: the page learns only whether one is saved. "Test key" asks the provider for its list of models
 * (it costs nothing) with the key that is SAVED, so a key must be saved before it can be tested.
 */
function ProviderKeySection({
  provider,
  canStoreKey,
  onStatusChange
}: ProviderKeySectionProps): React.JSX.Element {
  const [keyText, setKeyText] = useState('')
  const [busy, setBusy] = useState<Busy>(null)
  const [notice, setNotice] = useState<Notice | null>(null)

  const inputId = `api-key-${provider.id}`
  const check = checkApiKey(keyText)
  const canSave = busy === null && canStoreKey && check.ok
  const help = KEY_HELP[provider.id]

  async function save(event: React.FormEvent): Promise<void> {
    event.preventDefault()
    if (!check.ok || busy !== null) return
    setBusy('save')
    setNotice(null)
    try {
      const result = await window.api.settings.setApiKey(provider.id, check.key)
      if (result.ok) {
        setKeyText('') // the key now lives in the main process only
        onStatusChange(result.status)
        setNotice({ kind: 'ok', text: 'Saved.' })
      } else {
        setNotice({ kind: 'error', text: result.error })
      }
    } catch {
      setNotice({ kind: 'error', text: 'The key could not be saved: the app did not answer.' })
    } finally {
      setBusy(null)
    }
  }

  async function test(): Promise<void> {
    if (busy !== null) return
    setBusy('test')
    setNotice({ kind: 'ok', text: `Testing the key with ${provider.name}...` })
    try {
      const result = await window.api.settings.testApiKey(provider.id)
      setNotice(
        result.ok
          ? { kind: 'ok', text: describeTest(provider.name, result.modelCount) }
          : { kind: 'error', text: result.error }
      )
    } catch {
      setNotice({ kind: 'error', text: 'The key could not be tested: the app did not answer.' })
    } finally {
      setBusy(null)
    }
  }

  async function remove(): Promise<void> {
    if (busy !== null) return
    setBusy('remove')
    setNotice(null)
    try {
      onStatusChange(await window.api.settings.clearApiKey(provider.id))
      setNotice({ kind: 'ok', text: 'The key was removed.' })
    } catch {
      setNotice({ kind: 'error', text: 'The key could not be removed: the app did not answer.' })
    } finally {
      setBusy(null)
    }
  }

  return (
    <form className="settings-section" onSubmit={save}>
      <h3 className="settings-heading">{provider.name} API key</h3>
      <p className="settings-hint">
        The key lets this app use {help.uses} on your account, and the messages you send are billed
        to that account. You can create a key in {help.whereToCreate}.
      </p>
      {help.note !== undefined && <p className="settings-hint settings-key-note">{help.note}</p>}
      <p className="settings-status">{describeStatus(provider, canStoreKey)}</p>

      <label className="settings-label" htmlFor={inputId}>
        API key
      </label>
      <input
        id={inputId}
        className="settings-input"
        type="password"
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
        value={keyText}
        disabled={busy !== null}
        aria-describedby={keyText !== '' && !check.ok ? `${inputId}-problem` : undefined}
        onChange={(event) => setKeyText(event.target.value)}
      />
      {keyText !== '' && !check.ok && (
        <p id={`${inputId}-problem`} className="settings-hint">
          {check.error}
        </p>
      )}

      <div className="settings-actions">
        <button type="submit" className="button" disabled={!canSave}>
          Save key
        </button>
        {provider.hasKey && (
          <>
            <button
              type="button"
              className="button button-secondary"
              disabled={busy !== null}
              onClick={test}
            >
              Test key
            </button>
            <button
              type="button"
              className="button button-secondary"
              disabled={busy !== null}
              onClick={remove}
            >
              Remove key
            </button>
          </>
        )}
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
      <p className="settings-hint">
        Stored encrypted by your operating system, so a copy of the file is useless on another
        computer or account. The key is sent only to {provider.name}, together with your messages.
      </p>
    </form>
  )
}

export default ProviderKeySection
