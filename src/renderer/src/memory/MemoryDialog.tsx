import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { SecretFinding } from '../../../shared/ipc'
import {
  ALL_CHATS,
  checkNoteText,
  MEMORY_LIMITS,
  scopeUse,
  type MemoryChangeResult,
  type Note
} from '../../../shared/memory'
import type { MemoryState } from './useMemory'

const fmt = (n: number): string => n.toLocaleString('en-US')
const NO_ANSWER = 'the app did not answer'
const WAITING = 'Waiting for your answer in the Windows message box...'

type Notice = { kind: 'ok' | 'error'; text: string }
/** What the one box is for: a new note, or new words for one. */
type Editing = { kind: 'add' } | { kind: 'edit'; note: Note }

/** "7 Oct 2026, 14:05", this computer's time. */
function when(ms: number): string {
  return new Date(ms).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

interface MemoryDialogProps {
  open: boolean
  memory: MemoryState
  /** Text picked with "Remember..." on a message: the box opens with it, to be cut down before saving. Null when the dialog was opened otherwise. */
  draft: string | null
  onClose: () => void
}

/**
 * The Memory page (D-039): every note the person keeps, where it applies and when it was made; each can be changed or deleted; a note is added here or
 * with "Remember..." on a message. One switch turns memory off for every chat. Main keeps the notes and sends them; a note is made or changed only after
 * the person's yes in the system's own message box, which this page cannot answer.
 */
function MemoryDialog({ open, memory, draft, onClose }: MemoryDialogProps): React.JSX.Element {
  const dialogRef = useRef<HTMLDialogElement>(null)
  // While main is working (the system's message box may be open), Escape does not close the dialog: the answer is still to come.
  const busyRef = useRef(false)

  useLayoutEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    else if (!open && dialog.open) dialog.close()
  }, [open])

  return (
    <dialog
      ref={dialogRef}
      className="memory"
      aria-labelledby="memory-title"
      onCancel={(event) => {
        if (busyRef.current) event.preventDefault()
      }}
      onClose={() => {
        busyRef.current = false
        onClose()
      }}
    >
      <h2 id="memory-title" className="memory-heading">
        Memory
      </h2>
      {open && (
        <MemoryBody
          memory={memory}
          draft={draft}
          onBusy={(on) => {
            busyRef.current = on
          }}
          onClose={() => dialogRef.current?.close()}
        />
      )}
    </dialog>
  )
}

interface MemoryBodyProps {
  memory: MemoryState
  draft: string | null
  onBusy: (busy: boolean) => void
  onClose: () => void
}

function MemoryBody({ memory, draft, onBusy, onClose }: MemoryBodyProps): React.JSX.Element {
  const { status } = memory
  const [editing, setEditing] = useState<Editing | null>(draft !== null ? { kind: 'add' } : null)
  const [text, setText] = useState(draft ?? '')
  const [warnings, setWarnings] = useState<SecretFinding[] | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [busy, setBusy] = useState(false)
  // The note whose "Delete" was pressed, or 'all' for "Delete all...", waiting for a yes on the page.
  const [asking, setAsking] = useState<string | null>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  // The keyboard goes to the box when it opens (the cursor at the end, so that a picked text can be cut down from there).
  useEffect(() => {
    const input = inputRef.current
    if (!input || editing === null) return
    input.focus()
    input.setSelectionRange(input.value.length, input.value.length)
  }, [editing])

  function working(on: boolean): void {
    setBusy(on)
    onBusy(on)
  }

  /** Sends one change to main and shows what came of it. `asks`: main may open the system's message box for it. */
  async function change(
    run: () => Promise<MemoryChangeResult>,
    asks: boolean,
    done?: () => void
  ): Promise<void> {
    working(true)
    setNotice(asks ? { kind: 'ok', text: WAITING } : null)
    let result: MemoryChangeResult
    try {
      result = await run()
    } catch {
      result = { ok: false, error: `Your notes could not be changed: ${NO_ANSWER}.` }
    }
    if (result.ok) memory.setStatus(result.status) // the chat bar learns of it even if the dialog has gone
    if (!mounted.current) return
    working(false)
    setAsking(null)
    if (result.ok) {
      setNotice(null)
      setWarnings(null)
      done?.()
      return
    }
    setWarnings(result.warnings ?? null)
    setNotice({ kind: result.cancelled ? 'ok' : 'error', text: result.error })
  }

  function openEditor(next: Editing): void {
    setEditing(next)
    setText(next.kind === 'edit' ? next.note.text : '')
    setWarnings(null)
    setNotice(null)
    setAsking(null)
  }

  function closeEditor(): void {
    setEditing(null)
    setText('')
    setWarnings(null)
  }

  const checked = checkNoteText(text)
  const trimmed = text.trim()
  const over = trimmed.length - MEMORY_LIMITS.maxNoteChars
  const unchanged = editing?.kind === 'edit' && trimmed === editing.note.text
  const canSave = checked.ok && !unchanged && !busy

  function save(): void {
    if (!canSave || !checked.ok || editing === null) return
    const anyway = warnings !== null
    const note = checked.text
    void change(
      () =>
        editing.kind === 'add'
          ? window.api.memory.add(note, ALL_CHATS, anyway)
          : window.api.memory.edit(editing.note.id, note, anyway),
      true,
      closeEditor
    )
  }

  if (status === null) {
    return (
      <div className="memory-body">
        <p className="memory-status">Your notes could not be read just now.</p>
        <div className="memory-footer">
          <button type="button" className="button button-secondary" onClick={memory.reload}>
            Try again
          </button>
          <button type="button" className="button" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    )
  }

  const notes = status.notes.filter((note) => note.scope === ALL_CHATS)
  const use = scopeUse(status.notes, ALL_CHATS)

  const editor = (
    <form
      className="memory-editor"
      onSubmit={(event) => {
        event.preventDefault()
        save()
      }}
    >
      <label className="memory-label" htmlFor="memory-input">
        {editing?.kind === 'edit' ? 'Change the note' : 'A note for every chat'}
      </label>
      <textarea
        id="memory-input"
        ref={inputRef}
        className="memory-input"
        rows={4}
        value={text}
        readOnly={busy}
        placeholder="For example: I am a nurse in Leeds, and I work nights."
        onChange={(event) => {
          setText(event.target.value)
          setWarnings(null)
          setNotice(null)
        }}
      />
      {over > 0 ? (
        <p className="memory-count memory-count-over" role="alert">
          {fmt(trimmed.length)} of {fmt(MEMORY_LIMITS.maxNoteChars)} characters: {fmt(over)} too
          many. Cut it down to what the model should keep in mind.
        </p>
      ) : (
        <p className="memory-count">
          {fmt(trimmed.length)} of {fmt(MEMORY_LIMITS.maxNoteChars)} characters
        </p>
      )}
      {warnings !== null && warnings.length > 0 && (
        <ul className="memory-secrets" aria-label="Parts that look like a secret">
          {warnings.map((finding, index) => (
            <li key={index}>
              {finding.shown} looks like {finding.what}.
            </li>
          ))}
        </ul>
      )}
      <div className="memory-editor-actions">
        <button
          type="button"
          className="button button-secondary"
          disabled={busy}
          onClick={closeEditor}
        >
          Cancel
        </button>
        <button type="submit" className="button" disabled={!canSave}>
          {warnings !== null ? 'Save anyway' : editing?.kind === 'edit' ? 'Save' : 'Remember'}
        </button>
      </div>
    </form>
  )

  return (
    <div className="memory-body">
      <p className="memory-hint">
        Notes you keep for the model: who you are, what you work on, what it should keep in mind.
        Each goes to the company that runs the model with every message of every chat, and is kept
        in the app&apos;s data folder on this computer (encrypted when your chats are). Only you add
        notes; the model never does. Saving one asks you once more in a window of its own, which the
        app cannot answer for you.
      </p>

      {status.problem !== null && (
        <div className="memory-problem" role="alert">
          <p>
            Your notes could not be read ({status.problem}). Nothing is sent until you delete them
            all or turn memory off; the app keeps a copy of the file either way.
          </p>
          <div className="memory-problem-actions">
            <button
              type="button"
              className="history-button"
              disabled={busy}
              onClick={() => setAsking('all')}
            >
              Delete all...
            </button>
            <button
              type="button"
              className="history-button"
              disabled={busy}
              onClick={() => void change(() => window.api.memory.setOn(false), false)}
            >
              Turn memory off
            </button>
          </div>
        </div>
      )}

      {status.problem === null && (
        <label className="memory-switch">
          <input
            type="checkbox"
            checked={status.on}
            disabled={busy}
            onChange={(event) =>
              void change(() => window.api.memory.setOn(event.target.checked), event.target.checked)
            }
          />{' '}
          Send my notes with every message
        </label>
      )}
      {!status.on && status.problem === null && (
        <p className="memory-hint">Memory is off: no note is sent until you turn it on.</p>
      )}

      {notice !== null && (
        <p
          className={`memory-notice${notice.kind === 'error' ? ' memory-notice-error' : ''}`}
          role={notice.kind === 'error' ? 'alert' : 'status'}
        >
          {notice.text}
        </p>
      )}

      {status.problem === null && (
        <section className="memory-place" aria-label="For every chat">
          <div className="memory-place-head">
            <h3 className="memory-place-title">For every chat</h3>
            <span className="memory-place-use">
              {use.notes === 1 ? '1 note' : `${use.notes} notes`}, {fmt(use.chars)} of{' '}
              {fmt(MEMORY_LIMITS.maxScopeChars)} characters
            </span>
          </div>
          {editing?.kind === 'add' && editor}
          {notes.length === 0 && editing === null ? (
            <p className="memory-none">No notes yet.</p>
          ) : (
            <ul className="memory-list" aria-label="Notes for every chat">
              {notes.map((note) => (
                <li key={note.id} className="memory-row">
                  {editing?.kind === 'edit' && editing.note.id === note.id ? (
                    editor
                  ) : (
                    <>
                      <p className="memory-text">{note.text}</p>
                      <p className="memory-meta">
                        Made {when(note.createdAt)}
                        {note.updatedAt !== note.createdAt
                          ? `, changed ${when(note.updatedAt)}`
                          : ''}
                      </p>
                      {asking === note.id ? (
                        <span className="memory-ask" role="group" aria-label="Delete this note?">
                          <span className="memory-ask-text">Delete?</span>
                          <button
                            type="button"
                            className="history-button history-button-danger"
                            disabled={busy}
                            onClick={() =>
                              void change(() => window.api.memory.remove(note.id), false)
                            }
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
                        <span className="memory-row-actions">
                          <button
                            type="button"
                            className="history-button"
                            aria-label={`Change the note "${note.text.slice(0, 40)}"`}
                            disabled={busy || editing !== null}
                            onClick={() => openEditor({ kind: 'edit', note })}
                          >
                            Change...
                          </button>
                          <button
                            type="button"
                            className="history-button"
                            aria-label={`Delete the note "${note.text.slice(0, 40)}"`}
                            disabled={busy || editing !== null}
                            onClick={() => setAsking(note.id)}
                          >
                            Delete
                          </button>
                        </span>
                      )}
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
          {editing === null && (
            <div className="memory-place-actions">
              <button
                type="button"
                className="history-button"
                disabled={busy || use.notes >= MEMORY_LIMITS.maxScopeNotes}
                onClick={() => openEditor({ kind: 'add' })}
              >
                Add a note...
              </button>
            </div>
          )}
        </section>
      )}

      {asking === 'all' && (
        <div className="memory-ask memory-ask-all" role="group" aria-label="Delete all your notes?">
          <span className="memory-ask-text">
            {status.problem !== null
              ? 'Start again with no notes? The file that could not be read is kept as a copy.'
              : `Delete all ${status.notes.length === 1 ? 'your note' : `${status.notes.length} notes`}? This cannot be undone.`}
          </span>
          <button
            type="button"
            className="history-button history-button-danger"
            disabled={busy}
            onClick={() => void change(() => window.api.memory.removeAll(), false)}
          >
            Delete all
          </button>
          <button
            type="button"
            className="history-button"
            autoFocus
            disabled={busy}
            onClick={() => setAsking(null)}
          >
            Keep them
          </button>
        </div>
      )}

      <div className="memory-footer">
        <button
          type="button"
          className="history-button"
          disabled={busy || status.problem !== null || status.notes.length === 0}
          onClick={() => void exportAll(setNotice, working, mounted)}
        >
          Export all...
        </button>
        <button
          type="button"
          className="history-button"
          disabled={busy || (status.notes.length === 0 && status.problem === null)}
          onClick={() => setAsking('all')}
        >
          Delete all...
        </button>
        <button type="button" className="button" disabled={busy} onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  )
}

/** "Export all...": main opens the system's save dialog and writes one plain text file; the page learns where. */
async function exportAll(
  setNotice: (notice: Notice | null) => void,
  working: (on: boolean) => void,
  mounted: React.RefObject<boolean>
): Promise<void> {
  working(true)
  setNotice(null)
  let result: Awaited<ReturnType<typeof window.api.memory.exportAll>>
  try {
    result = await window.api.memory.exportAll()
  } catch {
    result = { ok: false, error: `The notes could not be exported: ${NO_ANSWER}.` }
  }
  if (!mounted.current) return
  working(false)
  if (result.ok) {
    setNotice({
      kind: 'ok',
      text: `Exported ${result.count === 1 ? '1 note' : `${result.count} notes`} to ${result.where}. It is a plain text file: keep it somewhere safe.`
    })
  } else if (!result.cancelled) {
    setNotice({ kind: 'error', text: result.error })
  }
}

export default MemoryDialog
