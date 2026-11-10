import { isConversationId } from './ids'

// (23.1, D-055) A chat's own name and its pin, kept apart from the chat's file in `chat-names.json` (the owner's pick: the chat files stay as they are,
// so an older Frontier still opens every chat). A name the person gave is shown in place of the title worked out from the first message, and is never
// worked out again; a pin puts the chat in its own group at the top of the sidebar.

export const CHAT_NAME_LIMITS = {
  /** A name, in characters, after it is put on one line and trimmed. */
  maxTitleChars: 100,
  /** How many chats may have a name or a pin. */
  maxEntries: 5000
} as const

export interface ChatMark {
  /** The name the person gave, or absent for the worked-out title. */
  title?: string
  /** Present (true) when the chat is pinned. */
  pinned?: true
}

/** Chat id -> its name and pin. A chat with neither has no entry. */
export type ChatMarks = Record<string, ChatMark>

export type ChatMarkResult = { ok: true } | { ok: false; error: string }

/** A name as it is kept: on one line, trimmed; '' means "go back to the worked-out title". Null when it is not a usable name. */
export function checkChatTitle(input: unknown): string | null {
  if (typeof input !== 'string') return null
  const oneLine = input.replace(/\s+/g, ' ').trim()
  if (Array.from(oneLine).length > CHAT_NAME_LIMITS.maxTitleChars) return null
  // Control characters and the bidirectional overrides could make a name show as something else.
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/.test(oneLine)) return null
  return oneLine
}

/** The marks as kept in the file, checked: every id a chat id, every entry a name, a pin, or both, nothing else. Null when anything is off. */
export function checkChatMarks(input: unknown): ChatMarks | null {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return null
  const entries = Object.entries(input as Record<string, unknown>)
  if (entries.length > CHAT_NAME_LIMITS.maxEntries) return null
  const marks: ChatMarks = {}
  for (const [id, raw] of entries) {
    if (!isConversationId(id)) return null
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
    const fields = raw as Record<string, unknown>
    const keys = Object.keys(fields)
    if (keys.length === 0 || keys.some((k) => k !== 'title' && k !== 'pinned')) return null
    const mark: ChatMark = {}
    if ('title' in fields) {
      const title = checkChatTitle(fields.title)
      if (title === null || title === '' || title !== fields.title) return null
      mark.title = title
    }
    if ('pinned' in fields) {
      if (fields.pinned !== true) return null
      mark.pinned = true
    }
    marks[id] = mark
  }
  return marks
}

/**
 * A title worked out from a message, without the Markdown marks that would show as they are in a list: emphasis and code marks, heading and quote
 * marks at the start, link brackets (the link's words are kept). Used for new titles and for old ones when they are shown.
 */
export function plainTitle(title: string): string {
  const plain = title
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1') // [words](address) -> words
    .replace(/(\*\*|__|~~|`+)/g, '')
    .replace(/(^|\s)[*_](?=\S)|(?<=\S)[*_](?=\s|$|[.,;:!?])/g, '$1')
    .replace(/^\s*(#{1,6}|>+|[-+*]|\d{1,3}[.)])\s+/, '') // 1-3 digits: "2024. Budget" keeps its year
    .replace(/\s+/g, ' ')
    .trim()
  return plain === '' ? title.trim() || 'New chat' : plain
}
