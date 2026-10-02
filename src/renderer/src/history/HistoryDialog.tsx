import { useEffect, useRef, useState } from 'react'
import { formatCount, formatWhen } from './format'
import type { UseHistory } from './useHistory'

interface HistoryDialogProps {
  open: boolean
  history: UseHistory
  onClose: () => void
}

/** The list of saved chats: open one, or delete one. Starting a new chat is a button in the chat bar under the message box. */
function HistoryDialog({ open, history, onClose }: HistoryDialogProps): React.JSX.Element {
  const dialogRef = useRef<HTMLDialogElement>(null)
  // True while a chat is being opened or deleted: the other buttons wait, so two requests cannot cross.
  const [busy, setBusy] = useState(false)
  // The chat whose "Delete" was pressed and which is waiting for a yes.
  const [asking, setAsking] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)

  // The parent decides whether the dialog is open; the <dialog> element does the modal work (see SettingsDialog).
  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    else if (!open && dialog.open) dialog.close()
  }, [open])

  function handleClosed(): void {
    setAsking(null)
    setProblem(null)
    onClose()
  }

  async function choose(id: string): Promise<void> {
    if (busy) return
    setBusy(true)
    setProblem(null)
    const error = await history.open(id)
    setBusy(false)
    if (error === null) dialogRef.current?.close()
    else setProblem(error)
  }

  async function confirmDelete(id: string): Promise<void> {
    if (busy) return
    setBusy(true)
    setProblem(null)
    const error = await history.remove(id)
    setBusy(false)
    setAsking(null)
    if (error !== null) setProblem(error)
  }

  const { conversations } = history

  return (
    <dialog
      ref={dialogRef}
      className="history"
      aria-labelledby="history-title"
      onClose={handleClosed}
    >
      <h2 id="history-title" className="history-heading">
        History
      </h2>

      {history.saveError && (
        <p className="history-notice history-notice-error" role="status">
          The chat on screen is not saved ({history.saveError}). Opening another chat, or starting a
          new one, would lose it.
        </p>
      )}

      {history.loadError ? (
        <div className="history-section">
          <p className="history-notice history-notice-error" role="status">
            The saved chats could not be listed: {history.loadError}.
          </p>
          <div className="history-actions">
            <button type="button" className="button button-secondary" onClick={history.reload}>
              Try again
            </button>
          </div>
        </div>
      ) : conversations === null ? (
        <p className="history-status">Loading...</p>
      ) : conversations.length === 0 ? (
        <p className="history-hint">
          Nothing is saved yet. A chat is saved as soon as you send a message in it.
        </p>
      ) : (
        <ul className="history-list" aria-label="Saved chats">
          {conversations.map((conversation) => {
            const isOpen = conversation.id === history.activeId
            return (
              <li key={conversation.id} className="history-row">
                <button
                  type="button"
                  className="history-open"
                  aria-current={isOpen ? 'true' : undefined}
                  disabled={busy}
                  onClick={() => void choose(conversation.id)}
                >
                  <span className="history-title">{conversation.title}</span>
                  <span className="history-meta">
                    {formatWhen(conversation.updatedAt)} · {formatCount(conversation.messageCount)}
                    {isOpen ? ' · open now' : ''}
                  </span>
                </button>
                {asking === conversation.id ? (
                  <span className="history-ask" role="group" aria-label="Delete this chat?">
                    <span className="history-ask-text">Delete?</span>
                    <button
                      type="button"
                      className="history-button history-button-danger"
                      disabled={busy}
                      onClick={() => void confirmDelete(conversation.id)}
                    >
                      Delete
                    </button>
                    <button
                      type="button"
                      className="history-button"
                      autoFocus
                      disabled={busy}
                      onClick={() => setAsking(null)}
                    >
                      Keep
                    </button>
                  </span>
                ) : (
                  <button
                    type="button"
                    className="history-button"
                    aria-label={`Delete the chat "${conversation.title}"`}
                    disabled={busy}
                    onClick={() => setAsking(conversation.id)}
                  >
                    Delete
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {problem && (
        <p className="history-notice history-notice-error" role="alert">
          {problem}
        </p>
      )}
      {history.unreadable > 0 && (
        <p className="history-hint">
          {history.unreadable === 1
            ? '1 saved file could not be read'
            : `${history.unreadable} saved files could not be read`}{' '}
          and was left as it is. The app&apos;s log says which.
        </p>
      )}
      <p className="history-hint history-where">
        Chats are saved on this computer
        {history.folder ? (
          <>
            , in <span className="history-folder">{history.folder}</span>,
          </>
        ) : null}{' '}
        as plain files. Unlike your API key, the app does not encrypt them. Deleting a chat deletes
        its file.
      </p>

      <div className="history-footer">
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

export default HistoryDialog
