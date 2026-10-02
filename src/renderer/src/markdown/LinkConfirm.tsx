import { useCallback, useEffect, useRef, useState } from 'react'
import { OpenLinkContext } from './linkContext'

/** The address's host as the browser will read it, for the line that says where the link really goes. */
function hostOf(address: string): string {
  try {
    return new URL(address).host
  } catch {
    return ''
  }
}

/**
 * Wraps the chat. A link in a reply asks it, through OpenLinkContext, and this shows the whole address with Open and Cancel. Only
 * Open hands the address to the browser (window.open: the main process lets only https addresses through, D-025, and the page loads
 * nothing itself). Cancel comes first, so it is the button that has the focus.
 */
function LinkConfirm({ children }: { children: React.ReactNode }): React.JSX.Element {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [address, setAddress] = useState<string | null>(null)
  const ask = useCallback((url: string) => setAddress(url), [])

  // The state decides whether the dialog is open; the <dialog> element does the modal work (see SettingsDialog).
  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (address !== null && !dialog.open) dialog.showModal()
    else if (address === null && dialog.open) dialog.close()
  }, [address])

  function open(): void {
    if (address !== null) window.open(address, '_blank', 'noopener,noreferrer')
    setAddress(null)
  }

  return (
    <OpenLinkContext.Provider value={ask}>
      {children}
      <dialog
        ref={dialogRef}
        className="link-confirm"
        aria-labelledby="link-confirm-title"
        onClose={() => setAddress(null)}
      >
        <h2 id="link-confirm-title" className="link-confirm-heading">
          Open this address in your browser?
        </h2>
        <p className="link-confirm-address">{address}</p>
        {address !== null && (
          <p className="link-confirm-note">
            It goes to <strong>{hostOf(address)}</strong>, a page that is not part of this app. The
            words of the link may say something else, so check the address first.
          </p>
        )}
        <div className="link-confirm-actions">
          <button
            type="button"
            className="button button-secondary"
            onClick={() => setAddress(null)}
          >
            Cancel
          </button>
          <button type="button" className="button" onClick={open}>
            Open
          </button>
        </div>
      </dialog>
    </OpenLinkContext.Provider>
  )
}

export default LinkConfirm
