import { useCallback, useEffect, useRef, useState } from 'react'

export type CopyState = 'idle' | 'copied' | 'failed'

/**
 * Puts `text` on the clipboard. The async clipboard API first; since Stage 15.4 (D-047) the window refuses every permission it was not asked to give, and the permission
 * this Electron asked for when the app copied was the clipboard's READ permission (seen in 15.5, with the real window), which the window does not give: a page that could
 * read the clipboard could read whatever the person copied from somewhere else. So when the async API is refused, the old way is used, from the same click: a copy of the text selected
 * in a box that is not shown, which needs no permission. Nothing in the app reads the clipboard.
 */
async function writeToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    // refused: fall through to the old way
  }
  const area = document.createElement('textarea')
  area.value = text
  area.setAttribute('readonly', '')
  area.setAttribute('aria-hidden', 'true')
  area.style.position = 'fixed'
  area.style.top = '0'
  area.style.left = '0'
  area.style.opacity = '0'
  area.style.pointerEvents = 'none'
  const before = document.activeElement
  document.body.appendChild(area)
  try {
    area.select()
    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    area.remove()
    if (before instanceof HTMLElement) before.focus()
  }
}

/** How long "Copied" stays on a button. */
const SHOW_FOR_MS = 1500

/**
 * The one place where the app writes to the clipboard (D-025, D-026). `copy(text)` is called from a click and puts exactly those
 * characters on the clipboard; nothing in the app reads the clipboard, and nothing else writes it. `state` says how it went, for the
 * button to show for a moment.
 */
export function useCopy(): { state: CopyState; copy: (text: string) => void } {
  const [state, setState] = useState<CopyState>('idle')
  const timer = useRef<number | null>(null)

  // A pending "Copied" must not touch a button that is gone.
  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current)
    },
    []
  )

  const copy = useCallback((text: string): void => {
    void (async () => {
      setState((await writeToClipboard(text)) ? 'copied' : 'failed')
      if (timer.current !== null) window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => setState('idle'), SHOW_FOR_MS)
    })()
  }, [])

  return { state, copy }
}

/** What a Copy button says. */
export const copyLabel = (state: CopyState, idle = 'Copy'): string =>
  state === 'copied' ? 'Copied' : state === 'failed' ? 'Could not copy' : idle
