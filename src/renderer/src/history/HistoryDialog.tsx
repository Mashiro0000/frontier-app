import { useEffect, useRef, useState } from 'react'
import { formatCount, formatWhen } from './format'
import RestorePreviewPanel from './RestorePreviewPanel'
import { useBackup } from './useBackup'
import type { ProjectsStatus } from '../../../shared/projects'
import type { UseHistory } from './useHistory'

interface HistoryDialogProps {
  open: boolean
  history: UseHistory
  /** The projects (D-039): each chat's project is named, and the list can show one project's chats. Null while not known. */
  projects: ProjectsStatus | null
  onClose: () => void
}

/** The list of saved chats: open one, or delete one. Starting a new chat is a button in the chat bar under the message box. */
function HistoryDialog({
  open,
  history,
  projects,
  onClose
}: HistoryDialogProps): React.JSX.Element {
  const dialogRef = useRef<HTMLDialogElement>(null)
  // True while a chat is being opened or deleted: the other buttons wait, so two requests cannot cross.
  const [busy, setBusy] = useState(false)
  // The chat whose "Delete" was pressed and which is waiting for a yes.
  const [asking, setAsking] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  // Which chats the list shows (D-039): every chat ('all'), those in no project ('none'), or one project's (its id).
  const [shown, setShown] = useState('all')
  // Backing up to a file and restoring from one (D-034).
  const backup = useBackup(history.reload)
  const { dismiss: dismissPreview, clearNotice } = backup
  // Nothing is changed while a chat is being opened or deleted, or while a dialog or a file is being worked on.
  const locked = busy || backup.working

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
    dismissPreview() // a file that was looked at and not added is let go
    clearNotice()
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

  const { conversations: everyChat } = history
  // A chat's project, if it is still there: a deleted project's chats belong to none.
  const projectName = (id: string | undefined): string | null =>
    id === undefined ? null : (projects?.projects.find((p) => p.id === id)?.name ?? null)
  const conversations =
    everyChat === null || shown === 'all'
      ? everyChat
      : everyChat.filter((c) =>
          shown === 'none' ? projectName(c.project) === null : c.project === shown
        )
  // The filter, shown only when there are projects to filter by.
  const projectFilter =
    (projects?.projects.length ?? 0) > 0 ? (
      <label className="history-filter">
        Show{' '}
        <select value={shown} onChange={(event) => setShown(event.target.value)}>
          <option value="all">every chat</option>
          <option value="none">chats in no project</option>
          {(projects?.projects ?? []).map((p) => (
            <option key={p.id} value={p.id}>
              the project {p.name}
            </option>
          ))}
        </select>
      </label>
    ) : null

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

      {history.storage?.blocked && (
        <p className="history-notice history-notice-error" role="status">
          {history.storage.blocked}
        </p>
      )}

      {backup.preview !== null ? (
        <RestorePreviewPanel
          preview={backup.preview}
          disabled={locked}
          onAdd={() => void backup.add()}
          onDismiss={backup.dismiss}
        />
      ) : history.loadError ? (
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
      ) : conversations.length === 0 && shown !== 'all' ? (
        <>
          {projectFilter}
          <p className="history-hint">No saved chat here yet.</p>
        </>
      ) : conversations.length === 0 ? (
        <p className="history-hint">
          Nothing is saved yet. A chat is saved as soon as you send a message in it.
        </p>
      ) : (
        <>
          {projectFilter}
          <ul className="history-list" aria-label="Saved chats">
            {conversations.map((conversation) => {
              const isOpen = conversation.id === history.activeId
              return (
                <li key={conversation.id} className="history-row">
                  <button
                    type="button"
                    className="history-open"
                    aria-current={isOpen ? 'true' : undefined}
                    disabled={locked}
                    onClick={() => void choose(conversation.id)}
                  >
                    <span className="history-title">{conversation.title}</span>
                    <span className="history-meta">
                      {formatWhen(conversation.updatedAt)} ·{' '}
                      {formatCount(conversation.messageCount)}
                      {projectName(conversation.project) !== null
                        ? ` · ${projectName(conversation.project)}`
                        : ''}
                      {isOpen ? ' · open now' : ''}
                    </span>
                  </button>
                  {asking === conversation.id ? (
                    <span className="history-ask" role="group" aria-label="Delete this chat?">
                      <span className="history-ask-text">Delete?</span>
                      <button
                        type="button"
                        className="history-button history-button-danger"
                        disabled={locked}
                        onClick={() => void confirmDelete(conversation.id)}
                      >
                        Delete
                      </button>
                      <button
                        type="button"
                        className="history-button"
                        autoFocus
                        disabled={locked}
                        onClick={() => setAsking(null)}
                      >
                        Keep
                      </button>
                    </span>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="history-button"
                        aria-label={`Export the chat "${conversation.title}" to a file`}
                        disabled={locked}
                        onClick={() => void backup.exportOne(conversation.id)}
                      >
                        Export
                      </button>
                      <button
                        type="button"
                        className="history-button"
                        aria-label={`Delete the chat "${conversation.title}"`}
                        disabled={locked}
                        onClick={() => setAsking(conversation.id)}
                      >
                        Delete
                      </button>
                    </>
                  )}
                </li>
              )
            })}
          </ul>
        </>
      )}

      {problem && (
        <p className="history-notice history-notice-error" role="alert">
          {problem}
        </p>
      )}
      {backup.notice && (
        <p
          className={`history-notice backup-notice${backup.notice.kind === 'error' ? ' history-notice-error' : ''}`}
          role={backup.notice.kind === 'error' ? 'alert' : 'status'}
        >
          {backup.notice.text}
        </p>
      )}
      {/* While a backup file is being looked at, the dialog is only about that: the notes about the saved files wait. */}
      {backup.preview === null && (
        <>
          {history.unreadable > 0 && (
            <p className="history-hint">
              {history.unreadable === 1
                ? '1 saved file could not be read'
                : `${history.unreadable} saved files could not be read`}{' '}
              and was left as it is. The app&apos;s log says which.
              {history.storage && history.storage.unopened > 0
                ? ` ${history.storage.unopened === 1 ? '1 of them is' : `${history.storage.unopened} of them are`} encrypted and could not be opened with this computer's key; Restore from a backup brings such chats back as copies.`
                : ''}
            </p>
          )}
          <p className="history-hint history-where">
            Chats are saved on this computer
            {history.folder ? (
              <>
                , in <span className="history-folder">{history.folder}</span>,
              </>
            ) : null}{' '}
            {history.storage?.choice === 'on'
              ? "as encrypted files, protected by this computer's secure storage like your API key (see Settings, Saved chats)."
              : 'as plain files. Unlike your API key, the app does not encrypt them unless you turn that on in Settings, Saved chats.'}{' '}
            Deleting a chat deletes its file. A backup is one plain file you choose the place for;
            restoring from one adds chats and never replaces a saved one.
          </p>
        </>
      )}

      <div className="history-footer">
        <div className="history-backup-buttons">
          <button
            type="button"
            className="history-button"
            disabled={locked || backup.preview !== null || !conversations?.length}
            onClick={() => void backup.exportAll()}
          >
            Back up all chats...
          </button>
          <button
            type="button"
            className="history-button"
            disabled={locked || backup.preview !== null}
            onClick={() => void backup.look()}
          >
            Restore from a backup...
          </button>
        </div>
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
