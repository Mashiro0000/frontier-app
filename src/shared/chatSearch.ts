import type { SavedConversation } from './ipc'

// (21.5, D-053) A search of the saved chats, as AI Fiesta's "Search Chats": every word typed must be in the chat's title or in one of its messages (any case);
// the newest chats first, each with a short piece of the text around what was found. It runs in main, on this computer, over the chats main can read (the
// encrypted ones too, which main opens anyway to show them): nothing is sent anywhere, and the page gets titles and short pieces only. Plain functions.

export const SEARCH_LIMITS = { maxQueryChars: 200, maxResults: 50, snippetChars: 160 } as const

export interface ChatSearchHit {
  id: string
  title: string
  updatedAt: number
  /** A piece of the text around the first word found (with "..." where it is cut), or '' when only the title matched. */
  snippet: string
}

export type SearchQueryCheck = { ok: true; words: string[] } | { ok: false; error: string }

/** The query as the page sent it: text of 1 to 200 characters with at least one word; read as its words, in lower case. */
export function checkSearchQuery(input: unknown): SearchQueryCheck {
  if (typeof input !== 'string' || input.length > SEARCH_LIMITS.maxQueryChars) {
    return { ok: false, error: 'The search was not understood.' }
  }
  const words = input.toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return { ok: false, error: 'Type something to search for.' }
  return { ok: true, words: [...new Set(words)] }
}

/** The text around `at` (the place of a match), on one line, at most `snippetChars` long, with "..." where it was cut. */
export function snippetAround(text: string, at: number, length: number): string {
  const flat = text.replace(/\s+/g, ' ')
  // The place in the flattened text: count what the flattening took away before it.
  const before = text.slice(0, at).replace(/\s+/g, ' ').length
  const room = SEARCH_LIMITS.snippetChars
  let start = Math.max(0, before - Math.floor((room - length) / 2))
  const end = Math.min(flat.length, start + room)
  start = Math.max(0, end - room)
  return `${start > 0 ? '...' : ''}${flat.slice(start, end).trim()}${end < flat.length ? '...' : ''}`
}

/** The chats that hold every word, newest first, at most `maxResults`. */
export function searchConversations(
  conversations: readonly SavedConversation[],
  words: readonly string[]
): ChatSearchHit[] {
  const hits: ChatSearchHit[] = []
  for (const chat of conversations) {
    const texts = chat.messages.map((m) => m.content)
    const all = `${chat.title}\n${texts.join('\n')}`.toLowerCase()
    if (!words.every((word) => all.includes(word))) continue
    let snippet = ''
    for (const text of texts) {
      const at = text.toLowerCase().indexOf(words[0])
      if (at >= 0) {
        snippet = snippetAround(text, at, words[0].length)
        break
      }
    }
    hits.push({ id: chat.id, title: chat.title, updatedAt: chat.updatedAt, snippet })
  }
  return hits.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, SEARCH_LIMITS.maxResults)
}
