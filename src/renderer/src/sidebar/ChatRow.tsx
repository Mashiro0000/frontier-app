import { useEffect, useRef, useState } from 'react'
import type { ConversationSummary } from '../../../shared/ipc'
import { CHAT_NAME_LIMITS } from '../../../shared/chatNames'
import { IconMore, IconPencil, IconPin, IconTrash } from '../icons'

interface ChatRowProps {
  conversation: ConversationSummary
  current: boolean
  /** A reply is arriving or a chat is being opened: the row and its menu wait. */
  disabled: boolean
  /** The open button's tooltip (the title, or why it waits). */
  tooltip: string
  onOpen: () => void
  /** Each answers null when done, else why not (shown under the list). */
  onRename: (title: string) => Promise<string | null>
  onPin: (on: boolean) => Promise<string | null>
  onDelete: () => Promise<string | null>
  onProblem: (problem: string | null) => void
}

/**
 * (23.1, D-055) One saved chat in the sidebar: a click opens it; its "..." button (shown on hover, on keyboard focus and for the chat on screen) opens a
 * small menu: Rename (the name is typed in the row: Enter or leaving the box keeps it, Escape keeps the old one), Pin or Unpin, Delete (asks in the row).
 */
function ChatRow({
  conversation,
  current,
  disabled,
  tooltip,
  onOpen,
  onRename,
  onPin,
  onDelete,
  onProblem
}: ChatRowProps): React.JSX.Element {
  const [menu, setMenu] = useState(false)
  const [mode, setMode] = useState<'row' | 'rename' | 'delete'>('row')
  const [busy, setBusy] = useState(false)
  const rowRef = useRef<HTMLLIElement>(null)
  const moreRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  // A rename that ends by Escape must not be kept by the blur that follows.
  const cancelled = useRef(false)
  const pinned = conversation.pinned === true

  // The menu takes focus on its first item, and closes on a click anywhere else.
  useEffect(() => {
    if (!menu) return
    menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus()
    const away = (event: MouseEvent): void => {
      if (!rowRef.current?.contains(event.target as Node)) setMenu(false)
    }
    document.addEventListener('mousedown', away)
    return () => document.removeEventListener('mousedown', away)
  }, [menu])

  useEffect(() => {
    if (mode === 'rename') {
      cancelled.current = false
      inputRef.current?.select()
    }
  }, [mode])

  async function act(task: () => Promise<string | null>): Promise<void> {
    setBusy(true)
    onProblem(null)
    const error = await task()
    setBusy(false)
    onProblem(error)
  }

  function closeMenu(focusMore = true): void {
    setMenu(false)
    if (focusMore) moreRef.current?.focus()
  }

  /** Keeps the typed name. By Enter the keyboard goes back to the row's "..."; by a click elsewhere it stays where the click put it. */
  async function finishRename(byEnter: boolean): Promise<void> {
    if (cancelled.current) return
    cancelled.current = true // Enter, then the blur of the box leaving: once
    const typed = inputRef.current?.value ?? ''
    setMode('row')
    // After the row is drawn again (the box is gone and the "..." back).
    if (byEnter) setTimeout(() => moreRef.current?.focus())
    if (typed.replace(/\s+/g, ' ').trim() !== conversation.title) await act(() => onRename(typed))
  }

  if (mode === 'rename') {
    return (
      <li ref={rowRef} className="sidebar-chat-row sidebar-chat-row-editing">
        <input
          ref={inputRef}
          className="sidebar-chat-rename"
          aria-label="New name for the chat (Enter keeps it, Escape keeps the old name; empty goes back to its first message)"
          defaultValue={conversation.title}
          maxLength={CHAT_NAME_LIMITS.maxTitleChars}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
              event.preventDefault()
              void finishRename(true)
            } else if (event.key === 'Escape') {
              event.preventDefault()
              event.stopPropagation()
              cancelled.current = true
              setMode('row')
              setTimeout(() => moreRef.current?.focus())
            }
          }}
          onBlur={() => void finishRename(false)}
        />
      </li>
    )
  }

  if (mode === 'delete') {
    return (
      <li ref={rowRef} className="sidebar-chat-row sidebar-chat-row-asking">
        <span
          className="sidebar-chat-ask"
          role="group"
          aria-label={`Delete the chat "${conversation.title}"?`}
        >
          <span className="sidebar-chat-ask-text">Delete?</span>
          <button
            type="button"
            className="sidebar-chat-ask-yes"
            disabled={busy}
            onClick={() => void act(onDelete).then(() => setMode('row'))}
          >
            Delete
          </button>
          <button
            type="button"
            className="sidebar-chat-ask-no"
            disabled={busy}
            autoFocus
            onClick={() => {
              setMode('row')
              setTimeout(() => moreRef.current?.focus())
            }}
          >
            Cancel
          </button>
        </span>
      </li>
    )
  }

  return (
    <li ref={rowRef} className={`sidebar-chat-row${menu ? ' sidebar-chat-row-menu' : ''}`}>
      <button
        type="button"
        className="sidebar-chat"
        aria-current={current ? 'true' : undefined}
        disabled={disabled}
        title={tooltip}
        onClick={onOpen}
      >
        {pinned && (
          <span className="sidebar-chat-pin">
            <IconPin />
            <span className="visually-hidden">Pinned: </span>
          </span>
        )}
        <span className="sidebar-chat-title">{conversation.title}</span>
      </button>
      <button
        ref={moreRef}
        type="button"
        className="sidebar-chat-more"
        aria-label={`More for "${conversation.title}": rename, pin, delete`}
        title={disabled ? 'This can be done when the reply has finished.' : 'Rename, pin or delete'}
        aria-haspopup="menu"
        aria-expanded={menu}
        disabled={disabled}
        // Not disabled while a change is saved (a disabled button would lose the keyboard): its clicks wait instead.
        onClick={() => {
          if (!busy) setMenu((open) => !open)
        }}
      >
        <IconMore />
      </button>
      {menu && (
        <div
          ref={menuRef}
          className="sidebar-chat-menu"
          role="menu"
          aria-label={`The chat "${conversation.title}"`}
          onKeyDown={(event) => {
            const buttons = [
              ...(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])
            ]
            const at = buttons.indexOf(document.activeElement as HTMLButtonElement)
            if (event.key === 'Escape' || event.key === 'Tab') {
              if (event.key === 'Escape') event.preventDefault()
              event.stopPropagation()
              closeMenu(event.key === 'Escape')
            } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault()
              const step = event.key === 'ArrowDown' ? 1 : -1
              buttons[(at + step + buttons.length) % buttons.length]?.focus()
            } else if (event.key === 'Home' || event.key === 'End') {
              event.preventDefault()
              buttons[event.key === 'Home' ? 0 : buttons.length - 1]?.focus()
            }
          }}
        >
          <button
            type="button"
            role="menuitem"
            className="sidebar-chat-menu-item"
            onClick={() => {
              closeMenu(false)
              setMode('rename')
            }}
          >
            <IconPencil />
            Rename
          </button>
          <button
            type="button"
            role="menuitem"
            className="sidebar-chat-menu-item"
            onClick={() => {
              closeMenu()
              void act(() => onPin(!pinned))
            }}
          >
            <IconPin />
            {pinned ? 'Unpin' : 'Pin'}
          </button>
          <button
            type="button"
            role="menuitem"
            className="sidebar-chat-menu-item sidebar-chat-menu-danger"
            onClick={() => {
              closeMenu(false)
              setMode('delete')
            }}
          >
            <IconTrash />
            Delete
          </button>
        </div>
      )}
    </li>
  )
}

export default ChatRow
