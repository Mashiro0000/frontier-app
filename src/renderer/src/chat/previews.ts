import { createContext, useEffect, useRef, useState } from 'react'
import { ATTACHMENT_LIMITS } from '../../../shared/attachments'
import type { AttachmentPreview } from '../../../shared/ipc'
import type { ChatMessage } from './types'

/**
 * The small pictures and first lines of files in a chat opened from History (D-037), by id: main makes them from its own copies when the chat is put on
 * screen. They are kept apart from the messages, so that filling them in does not count as a change to the chat (which would save it again).
 */
export const PreviewsContext = createContext<ReadonlyMap<string, AttachmentPreview>>(new Map())

/**
 * Asks main, once per file and chat, for what a saved chat's files look like: those that came without a small picture or first lines (from History).
 * Opening another chat starts again (the view stays the same while chats change), so a copy deleted since is seen as missing, not as its old picture.
 */
export function useAttachmentPreviews(
  messages: ChatMessage[],
  chatId: string
): ReadonlyMap<string, AttachmentPreview> {
  const [state, setState] = useState<{
    chatId: string
    previews: ReadonlyMap<string, AttachmentPreview>
  }>({ chatId, previews: new Map() })
  const asked = useRef({ chatId, ids: new Set<string>() })
  useEffect(() => {
    if (!window.api) return
    if (asked.current.chatId !== chatId) asked.current = { chatId, ids: new Set() }
    const seen = asked.current
    const wanted = [
      ...new Set(
        messages.flatMap((message) =>
          (message.files ?? [])
            .filter((file) => file.thumbnail === null && file.firstLines === null)
            .map((file) => file.info.id)
        )
      )
    ].filter((id) => !seen.ids.has(id))
    if (wanted.length === 0) return
    for (const id of wanted) seen.ids.add(id)
    window.api.attachments
      .describe(wanted.slice(0, ATTACHMENT_LIMITS.perChat))
      .then((found) =>
        setState((before) => {
          // An answer for a chat that is no longer on screen is dropped.
          if (asked.current !== seen) return before
          const next = new Map(before.chatId === chatId ? before.previews : [])
          for (const preview of found) next.set(preview.id, preview)
          return { chatId, previews: next }
        })
      )
      .catch(() => undefined) // the chips then show their type instead of a picture
  }, [messages, chatId])
  return state.chatId === chatId ? state.previews : EMPTY
}

const EMPTY: ReadonlyMap<string, AttachmentPreview> = new Map()
