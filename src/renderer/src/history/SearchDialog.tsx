import { useEffect, useRef, useState } from 'react'
import type { ChatSearchHit } from '../../../shared/chatSearch'

interface SearchDialogProps {
  open: boolean
  onClose: () => void
  /** Opens a saved chat (as the sidebar's list does): null when it opened, else why not. */
  onOpenChat: (id: string) => Promise<string | null>
}

/** "12 Nov", or "12 Nov 2025" for another year. */
function when(ms: number): string {
  const date = new Date(ms)
  const sameYear = date.getFullYear() === new Date().getFullYear()
  return date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' })
  })
}

/**
 * (21.5, D-053) Search chats, as AI Fiesta's: a box, and the saved chats that hold every word typed, newest first, each with its title, a piece of the text
 * and its date. Main searches, on this computer; the page gets titles and pieces. A click (or Enter on the first) opens the chat.
 */
function SearchDialog({ open, onClose, onOpenChat }: SearchDialogProps): React.JSX.Element {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<ChatSearchHit[] | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) {
      dialog.showModal()
      inputRef.current?.focus()
    } else if (!open && dialog.open) {
      dialog.close()
    }
  }, [open])

  // A quarter of a second after the last key, the search goes to main; an answer that arrives after a newer search is dropped.
  useEffect(() => {
    if (!open) return
    const words = query.trim()
    if (words === '') return // nothing typed: the hint is shown (below), whatever an older search found
    let live = true
    const timer = setTimeout(() => {
      setBusy(true)
      void window.api.history
        .search(words)
        .then((result) => {
          if (!live) return
          if (result.ok) {
            setHits(result.hits)
            setNote(
              result.unreadable > 0
                ? `${result.unreadable} saved ${result.unreadable === 1 ? 'chat' : 'chats'} could not be read and ${result.unreadable === 1 ? 'was' : 'were'} not searched.`
                : null
            )
          } else {
            setHits([])
            setNote(result.error)
          }
        })
        .catch(() => {
          if (live) setNote('The app did not answer.')
        })
        .finally(() => {
          if (live) setBusy(false)
        })
    }, 250)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [query, open])

  // Closing clears the box, so the next opening starts empty.
  const close = (): void => {
    setQuery('')
    setHits(null)
    setNote(null)
    onClose()
  }
  const typed = query.trim() !== ''
  const shown = typed ? hits : null

  async function openHit(id: string): Promise<void> {
    const error = await onOpenChat(id)
    if (error === null) close()
    else setNote(error)
  }

  return (
    <dialog
      ref={dialogRef}
      className="search-chats"
      aria-labelledby="search-chats-title"
      onClose={close}
      onClick={(event) => {
        if (event.target === dialogRef.current) close()
      }}
    >
      <h2 id="search-chats-title" className="visually-hidden">
        Search chats
      </h2>
      <input
        ref={inputRef}
        className="search-chats-input"
        type="search"
        placeholder="Search your chats..."
        aria-label="Search your chats"
        maxLength={200}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && shown !== null && shown.length > 0) {
            event.preventDefault()
            void openHit(shown[0].id)
          }
        }}
      />
      <div className="search-chats-body">
        {shown === null ? (
          <p className="settings-hint">
            Every word you type must be in the chat. Searched on this computer only.
          </p>
        ) : shown.length === 0 && !busy ? (
          <p className="settings-hint">No chat holds all of that.</p>
        ) : (
          <ul className="search-chats-list" aria-label="Chats found">
            {shown.map((hit) => (
              <li key={hit.id}>
                <button
                  type="button"
                  className="search-hit"
                  data-chat={hit.id}
                  onClick={() => void openHit(hit.id)}
                >
                  <span className="search-hit-top">
                    <span className="search-hit-title">{hit.title}</span>
                    <span className="search-hit-date">{when(hit.updatedAt)}</span>
                  </span>
                  {hit.snippet !== '' && <span className="search-hit-snippet">{hit.snippet}</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
        {note !== null && typed && (
          <p className="settings-hint search-chats-note" role="status">
            {note}
          </p>
        )}
      </div>
    </dialog>
  )
}

export default SearchDialog
