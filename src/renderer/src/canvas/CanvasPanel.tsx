import { useEffect, useRef, useState } from 'react'
import CodeBlock from '../markdown/CodeBlock'
import Markdown from '../markdown/Markdown'
import { copyLabel, useCopy } from '../useCopy'
import { CanvasContext, previewKind, type CanvasDoc } from './canvasContext'

interface CanvasPanelProps {
  doc: CanvasDoc
  onClose: () => void
}

const TITLES: Record<string, string> = {
  html: 'Page',
  htm: 'Page',
  svg: 'Picture',
  markdown: 'Document',
  md: 'Document'
}

/**
 * The side panel: one block of a reply beside the chat, as a page, a picture or a document, or as its code.
 *
 * A page (HTML, SVG) is drawn in a frame that is locked: `sandbox=""` gives it no scripts, no forms, no pop-ups and an origin of its own,
 * and the page's policy (index.html), which a frame made from text inherits, lets it load nothing from the network. So what the model
 * wrote is drawn, and nothing in it runs or goes anywhere. Nothing is kept: the panel holds the text it was opened with.
 */
function CanvasPanel({ doc, onClose }: CanvasPanelProps): React.JSX.Element {
  const kind = previewKind(doc.lang)
  const [view, setView] = useState<'preview' | 'code'>(kind === null ? 'code' : 'preview')
  const { state, copy } = useCopy()
  const titleRef = useRef<HTMLHeadingElement>(null)
  // The keyboard goes to the panel when it opens, so Esc closes it and Tab walks its buttons.
  useEffect(() => titleRef.current?.focus(), [])
  const title = TITLES[doc.lang?.toLowerCase() ?? ''] ?? (doc.lang === null ? 'Code' : doc.lang)

  return (
    <aside
      className="canvas"
      aria-labelledby="canvas-title"
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return
        event.stopPropagation()
        onClose()
      }}
    >
      <header className="canvas-head">
        <h2 id="canvas-title" className="canvas-title" tabIndex={-1} ref={titleRef}>
          {title}
        </h2>
        {kind !== null && (
          <div className="canvas-views" role="group" aria-label="Show">
            {(['preview', 'code'] as const).map((name) => (
              <button
                key={name}
                type="button"
                className="canvas-view"
                aria-pressed={view === name}
                onClick={() => setView(name)}
              >
                {name === 'preview' ? 'Preview' : 'Code'}
              </button>
            ))}
          </div>
        )}
        <button type="button" className="md-copy canvas-copy" onClick={() => copy(doc.text)}>
          {copyLabel(state)}
        </button>
        <button type="button" className="md-copy canvas-close" onClick={onClose}>
          Close
        </button>
      </header>
      {/* No "Open" inside the panel: what is shown here is already open. */}
      <CanvasContext.Provider value={null}>
        {view === 'code' ? (
          <div className="canvas-body canvas-code">
            <CodeBlock lang={doc.lang} text={doc.text} />
          </div>
        ) : kind === 'page' ? (
          <>
            <iframe
              className="canvas-body canvas-frame"
              title="Preview"
              sandbox=""
              srcDoc={doc.text}
            />
            <p className="canvas-note">
              Drawn as written. Scripts do not run and nothing is loaded from the internet.
            </p>
          </>
        ) : (
          <div className="canvas-body canvas-document bubble-markdown">
            <Markdown text={doc.text} />
          </div>
        )}
      </CanvasContext.Provider>
    </aside>
  )
}

export default CanvasPanel
