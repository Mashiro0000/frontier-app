import { useCallback, useEffect, useRef, useState } from 'react'

export type CopyState = 'idle' | 'copied' | 'failed'

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
      try {
        await navigator.clipboard.writeText(text)
        setState('copied')
      } catch {
        setState('failed')
      }
      if (timer.current !== null) window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => setState('idle'), SHOW_FOR_MS)
    })()
  }, [])

  return { state, copy }
}

/** What a Copy button says. */
export const copyLabel = (state: CopyState, idle = 'Copy'): string =>
  state === 'copied' ? 'Copied' : state === 'failed' ? 'Could not copy' : idle
