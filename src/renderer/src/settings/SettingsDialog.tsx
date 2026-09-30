import { useEffect, useRef, useState } from 'react'
import type { SettingsStatus } from '../../../shared/ipc'
import { checkApiKey } from '../../../shared/validate'

interface SettingsDialogProps {
  open: boolean
  status: SettingsStatus | null
  /** Set if the main process could not be reached. */
  loadError: string | null
  onStatusChange: (status: SettingsStatus) => void
  onClose: () => void
}

type Notice = { kind: 'ok' | 'error'; text: string }

function describeStatus(status: SettingsStatus | null, loadError: string | null): string {
  if (loadError) return `Settings are unavailable: ${loadError}.`
  if (status === null) return 'Checking...'
  if (!status.canStoreKey)
    return 'This computer has no secure storage, so a key cannot be saved here.'
  return status.hasKey ? 'A key is saved.' : 'No key is saved yet.'
}

function SettingsDialog({
  open,
  status,
  loadError,
  onStatusChange,
  onClose
}: SettingsDialogProps): React.JSX.Element {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [keyText, setKeyText] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<Notice | null>(null)

  // The parent decides whether the dialog is open; the <dialog> element does the modal work: it
  // traps focus, closes on Escape, and makes everything behind it unreachable.
  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    else if (!open && dialog.open) dialog.close()
  }, [open])

  function handleClosed(): void {
    setKeyText('') // do not leave a half-typed key sitting in the page
    setNotice(null)
    onClose()
  }

  const check = checkApiKey(keyText)
  const canSave = !busy && status?.canStoreKey === true && check.ok

  async function save(event: React.FormEvent): Promise<void> {
    event.preventDefault()
    if (!check.ok || busy) return
    setBusy(true)
    setNotice(null)
    try {
      const result = await window.api.settings.setApiKey(check.key)
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
      setBusy(false)
    }
  }

  async function remove(): Promise<void> {
    if (busy) return
    setBusy(true)
    setNotice(null)
    try {
      onStatusChange(await window.api.settings.clearApiKey())
      setNotice({ kind: 'ok', text: 'The key was removed.' })
    } catch {
      setNotice({ kind: 'error', text: 'The key could not be removed: the app did not answer.' })
    } finally {
      setBusy(false)
    }
  }

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

      <form className="settings-section" onSubmit={save}>
        <h3 className="settings-heading">Anthropic API key</h3>
        <p className="settings-hint">
          The key lets this app use Anthropic&apos;s models on your account. You can create one in
          your Anthropic Console account.
        </p>
        <p className="settings-status">{describeStatus(status, loadError)}</p>

        <label className="settings-label" htmlFor="api-key">
          API key
        </label>
        <input
          id="api-key"
          className="settings-input"
          type="password"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          value={keyText}
          disabled={busy || status === null}
          aria-describedby={keyText !== '' && !check.ok ? 'api-key-problem' : undefined}
          onChange={(event) => setKeyText(event.target.value)}
        />
        {keyText !== '' && !check.ok && (
          <p id="api-key-problem" className="settings-hint">
            {check.error}
          </p>
        )}

        <div className="settings-actions">
          <button type="submit" className="button" disabled={!canSave}>
            Save key
          </button>
          {status?.hasKey && (
            <button
              type="button"
              className="button button-secondary"
              disabled={busy}
              onClick={remove}
            >
              Remove key
            </button>
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
          computer or account.
        </p>
      </form>

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
