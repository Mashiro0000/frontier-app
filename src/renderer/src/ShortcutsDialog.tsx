import { useEffect, useRef } from 'react'

// (23.6, D-055) The keyboard shortcuts, listed by Ctrl+/ (ChatGPT's keys where it has them). App.tsx handles them; this only shows them.
const SHORTCUTS: readonly [keys: string, what: string][] = [
  ['Ctrl+Shift+O', 'New chat'],
  ['Ctrl+K', 'Search chats'],
  ['Esc', 'Stop the reply that is arriving'],
  ['Ctrl+/', 'This list']
]

function ShortcutsDialog({
  open,
  onClose
}: {
  open: boolean
  onClose: () => void
}): React.JSX.Element {
  const dialogRef = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    else if (!open && dialog.open) dialog.close()
  }, [open])

  return (
    <dialog
      ref={dialogRef}
      className="search-chats shortcuts"
      aria-labelledby="shortcuts-title"
      onClose={onClose}
      onClick={(event) => {
        if (event.target === dialogRef.current) dialogRef.current.close() // a click on the backdrop
      }}
    >
      <div className="search-chats-body">
        <h2 id="shortcuts-title" className="shortcuts-title">
          Keyboard shortcuts
        </h2>
        <dl className="shortcuts-list">
          {SHORTCUTS.map(([keys, what]) => (
            <div key={keys} className="shortcuts-row">
              <dt>
                <kbd>{keys}</kbd>
              </dt>
              <dd>{what}</dd>
            </div>
          ))}
        </dl>
      </div>
    </dialog>
  )
}

export default ShortcutsDialog
