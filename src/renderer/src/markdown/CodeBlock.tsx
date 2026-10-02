import { useEffect, useRef, useState } from 'react'

interface CodeBlockProps {
  /** The language the fence named, if it was a plain word. */
  lang: string | null
  text: string
}

type CopyState = 'idle' | 'copied' | 'failed'

/**
 * A block of code from a reply: its language above it and a Copy button. The code is shown as text, never run or interpreted,
 * and Copy puts exactly these characters on the clipboard when the person clicks it (D-025).
 */
function CodeBlock({ lang, text }: CodeBlockProps): React.JSX.Element {
  const [state, setState] = useState<CopyState>('idle')
  const timer = useRef<number | null>(null)

  // A pending "Copied" must not touch a block that is gone.
  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current)
    },
    []
  )

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(text)
      setState('copied')
    } catch {
      setState('failed')
    }
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setState('idle'), 1500)
  }

  return (
    <div className="md-codeblock">
      <div className="md-codeblock-head">
        <span className="md-codeblock-lang">{lang ?? ''}</span>
        <button type="button" className="md-copy" onClick={() => void copy()}>
          {state === 'copied' ? 'Copied' : state === 'failed' ? 'Could not copy' : 'Copy'}
        </button>
      </div>
      <pre className="md-pre">
        <code>{text}</code>
      </pre>
    </div>
  )
}

export default CodeBlock
