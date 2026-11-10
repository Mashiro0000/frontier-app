import { useMemo } from 'react'
import { copyLabel, useCopy } from '../useCopy'
import { colourCode } from './colour'

interface CodeBlockProps {
  /** The language the fence named, if it was a plain word. */
  lang: string | null
  text: string
}

/**
 * A block of code from a reply: its language above it and a Copy button. The code is shown as text, never run or interpreted,
 * and Copy puts exactly these characters on the clipboard when the person clicks it (D-025).
 */
function CodeBlock({ lang, text }: CodeBlockProps): React.JSX.Element {
  const { state, copy } = useCopy()
  // (23.5, D-055) Coloured pieces for a language it knows; each piece is still plain text.
  const pieces = useMemo(() => colourCode(text, lang), [text, lang])

  return (
    <div className="md-codeblock">
      <div className="md-codeblock-head">
        <span className="md-codeblock-lang">{lang ?? ''}</span>
        <button type="button" className="md-copy" onClick={() => copy(text)}>
          {copyLabel(state)}
        </button>
      </div>
      <pre className="md-pre">
        <code>
          {pieces === null
            ? text
            : pieces.map((piece, i) =>
                piece.tone === null ? (
                  piece.text
                ) : (
                  <span key={i} className={`tok-${piece.tone}`}>
                    {piece.text}
                  </span>
                )
              )}
        </code>
      </pre>
    </div>
  )
}

export default CodeBlock
