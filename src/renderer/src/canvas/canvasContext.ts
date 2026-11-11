import { createContext } from 'react'

/** A block of a reply shown in the side panel: its language (if the fence named one) and its exact text. */
export interface CanvasDoc {
  lang: string | null
  text: string
}

/** Opens a block in the side panel. Null where there is no panel (a dialog, the panel itself): the block then has no "Open" button. */
export const CanvasContext = createContext<((doc: CanvasDoc) => void) | null>(null)

/** What the panel can show besides the code: a page (HTML, SVG) drawn in a locked frame, or a document (Markdown). */
export function previewKind(lang: string | null): 'page' | 'document' | null {
  const name = lang?.toLowerCase()
  if (name === 'html' || name === 'htm' || name === 'svg') return 'page'
  if (name === 'markdown' || name === 'md') return 'document'
  return null
}
