import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChatStorageStatus, ConversationSummary } from '../../../shared/ipc'
import type { ChatMessage } from '../chat/types'
import type { UseChat } from '../chat/useChat'
import { fromSavedMessages, toMessagesToSave } from './convert'

/** While a reply streams in, the conversation is saved at most this often. */
const SAVE_EVERY_MS = 1000

const NO_BRIDGE = 'the window could not connect to the app (the preload did not load)'

// The same order main uses: the conversation saved last comes first.
const newestFirst = (a: ConversationSummary, b: ConversationSummary): number =>
  b.updatedAt - a.updatedAt || (a.id < b.id ? -1 : 1)

/**
 * What a saved copy holds: the messages and the person's instructions for the chat (D-027). The chat replaces its list of messages instead
 * of editing it, so comparing the lists by reference says whether anything has changed; the instructions are text, compared as text.
 */
interface Snapshot {
  messages: ChatMessage[]
  instructions: string
  /** The chat's project (D-039): null for none. */
  project: string | null
}
const sameSnapshot = (a: Snapshot, b: Snapshot): boolean =>
  a.messages === b.messages && a.instructions === b.instructions && a.project === b.project
const NOTHING_SAVED: Snapshot = { messages: [], instructions: '', project: null }

export interface UseHistory {
  /** What is saved, newest first; null until the main process has answered. */
  conversations: ConversationSummary[] | null
  /** How many saved files could not be read (they were left alone). */
  unreadable: number
  /** Where the files are, for the person to see; null until the main process has answered. */
  folder: string | null
  /** How the saved files are kept (plain or encrypted) and whether saving is possible now (D-035); null until the main process has answered. */
  storage: ChatStorageStatus | null
  /** Set if the list could not be fetched. */
  loadError: string | null
  /** Why the last save failed, or null if it worked. */
  saveError: string | null
  /** The id the conversation on screen is, or will be, saved under. */
  activeId: string
  /** Saves again what could not be saved. */
  retrySave: () => void
  /** Asks for the list again. */
  reload: () => void
  /** Starts an empty conversation. Whatever was on screen stays saved. */
  /** Starts a new chat, in a project (D-039) or in none. */
  startNew: (project?: string | null) => void
  /** Puts a saved conversation on screen. Resolves to null, or to the reason it could not be opened. */
  open: (id: string) => Promise<string | null>
  /** Deletes a saved conversation. Resolves to null, or to the reason it could not be deleted. */
  remove: (id: string) => Promise<string | null>
}

/**
 * Keeps the conversation on screen saved by the main process, and the list of saved ones. The page sends the
 * whole conversation each time (a snapshot), and main checks it and writes it (D-016, D-017):
 *   - nothing is saved until there is a message, so opening the app and looking leaves no file;
 *   - a message the person sends is saved at once, a reply that streams in is saved at most once a second,
 *     and a finished, stopped or failed reply is saved at once;
 *   - a change of the chat's instructions is saved at once, with the messages (D-027);
 *   - what was just opened from disk is not saved again (that would only change its date).
 */
export function useHistory(chat: UseChat): UseHistory {
  const [conversations, setConversations] = useState<ConversationSummary[] | null>(null)
  const [unreadable, setUnreadable] = useState(0)
  const [folder, setFolder] = useState<string | null>(null)
  const [storage, setStorage] = useState<ChatStorageStatus | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [activeId, setActiveId] = useState<string>(() => crypto.randomUUID())

  // The chat is told which conversation is on screen, so that the cost of a reply can be shown under it (D-030).
  const { setConversationId } = chat
  useEffect(() => setConversationId(activeId), [activeId, setConversationId])

  const latest = useRef({
    id: activeId,
    messages: chat.messages,
    instructions: chat.instructions,
    project: chat.project
  })
  // What was last opened from disk or handed over to be saved.
  const settled = useRef<Snapshot>({
    messages: chat.messages,
    instructions: chat.instructions,
    project: chat.project
  })
  const lastSaveAt = useRef(0)
  const wasReplying = useRef(false)
  const timer = useRef<number | null>(null)

  const reload = useCallback((): void => {
    // `window.api` is missing when the preload failed to load (see D-004). Say so, and set state only in the
    // callbacks below, never straight away.
    const request = window.api ? window.api.history.list() : Promise.reject(new Error(NO_BRIDGE))
    request.then(
      (list) => {
        setConversations(list.conversations)
        setUnreadable(list.unreadable)
        setFolder(list.folder)
        setStorage(list.storage)
        setLoadError(null)
      },
      (error: unknown) => setLoadError(error instanceof Error ? error.message : String(error))
    )
  }, [])

  useEffect(() => {
    reload()
  }, [reload])

  const flush = useCallback((): void => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current)
      timer.current = null
    }
    const { id, messages, instructions, project } = latest.current
    if (sameSnapshot(settled.current, latest.current) || messages.length === 0) return
    if (!window.api) {
      setSaveError(`The conversation could not be saved: ${NO_BRIDGE}.`)
      return
    }
    settled.current = { messages, instructions, project }
    lastSaveAt.current = Date.now()
    window.api.history
      .save({
        id,
        messages: toMessagesToSave(messages),
        instructions,
        ...(project !== null ? { project } : {})
      })
      .then(
        (result) => {
          if (result.ok) {
            setSaveError(null)
            setConversations((previous) =>
              previous === null
                ? previous
                : [result.summary, ...previous.filter((c) => c.id !== result.summary.id)].sort(
                    newestFirst
                  )
            )
          } else {
            settled.current = NOTHING_SAVED // not saved: the next change, or "retry", tries again
            setSaveError(result.error)
          }
        },
        () => {
          settled.current = NOTHING_SAVED
          setSaveError('The conversation could not be saved: the app did not answer.')
        }
      )
  }, [])

  useEffect(() => {
    latest.current = {
      id: activeId,
      messages: chat.messages,
      instructions: chat.instructions,
      project: chat.project
    }
    // A reply has just begun: the person has just sent a message, and that is saved at once, whatever the
    // throttle says about the save before it. After that, a reply that streams in is saved once a second.
    const replyBegan = chat.isReplying && !wasReplying.current
    wasReplying.current = chat.isReplying
    if (sameSnapshot(settled.current, latest.current) || chat.messages.length === 0) return
    const wait = SAVE_EVERY_MS - (Date.now() - lastSaveAt.current)
    if (!chat.isReplying || replyBegan || wait <= 0) flush()
    else timer.current ??= window.setTimeout(flush, wait)
  }, [activeId, chat.messages, chat.instructions, chat.project, chat.isReplying, flush])

  // Closing or reloading the window: whatever is waiting for its turn goes now, and the timer goes with the page.
  useEffect(() => {
    window.addEventListener('pagehide', flush)
    return () => {
      window.removeEventListener('pagehide', flush)
      if (timer.current !== null) window.clearTimeout(timer.current)
      timer.current = null
    }
  }, [flush])

  function startNew(project: string | null = null): void {
    flush()
    chat.load([], '', project)
    setActiveId(crypto.randomUUID())
    setSaveError(null) // a failure belongs to the chat that is leaving the screen, not to the empty one
  }

  async function open(id: string): Promise<string | null> {
    // Already on screen: reloading it from disk could only lose a message that has not been saved yet.
    if (id === activeId) return null
    if (!window.api) return `The conversation could not be opened: ${NO_BRIDGE}.`
    try {
      const result = await window.api.history.load(id)
      if (!result.ok) {
        reload() // it may have gone, or been damaged, since the list was made
        return result.error
      }
      flush()
      const messages = fromSavedMessages(result.conversation.messages)
      const { instructions } = result.conversation // '' for a chat saved before version 3 of the file (D-027)
      const project = result.conversation.project ?? null // none for a chat saved before version 5 (D-039)
      settled.current = { messages, instructions, project }
      chat.load(messages, instructions, project)
      setActiveId(id)
      return null
    } catch {
      return 'The conversation could not be opened: the app did not answer.'
    }
  }

  async function remove(id: string): Promise<string | null> {
    if (!window.api) return `The conversation could not be deleted: ${NO_BRIDGE}.`
    try {
      const result = await window.api.history.remove(id)
      if (!result.ok) return result.error
      setConversations((previous) => previous?.filter((c) => c.id !== id) ?? previous)
      if (id === activeId) {
        // What is on screen no longer has a file. It was deleted on purpose: whatever it had not managed to
        // save (a failed save) must not bring it back, so nothing of it is left to save.
        settled.current = {
          messages: latest.current.messages,
          instructions: latest.current.instructions,
          project: latest.current.project
        }
        startNew()
      }
      return null
    } catch {
      return 'The conversation could not be deleted: the app did not answer.'
    }
  }

  function retrySave(): void {
    flush() // a failed save left nothing marked as saved, so this sends the whole chat again
  }

  return {
    conversations,
    unreadable,
    folder,
    storage,
    loadError,
    saveError,
    activeId,
    retrySave,
    reload,
    startNew,
    open,
    remove
  }
}
