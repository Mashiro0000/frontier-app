import { useContext } from 'react'
import { hostOf } from '../../../shared/toolNotes'
import type { ToolSource } from '../../../shared/tools'
import { OpenLinkContext } from '../markdown/linkContext'

interface SourcesProps {
  sources: ToolSource[]
}

/**
 * The pages a reply's searches came back with, under the reply, always (D-041, 11.4). A title is text from a web page and is shown as text. A source is a
 * button, not a link: it carries no address the browser engine could follow, and a click asks the person, in the same box as any link in a reply, whether
 * to open the address in their browser (https only, D-025).
 */
function Sources({ sources }: SourcesProps): React.JSX.Element {
  const openLink = useContext(OpenLinkContext)
  return (
    <section className="sources" aria-label="Sources">
      <h4 className="sources-title">Sources</h4>
      <ol className="sources-list">
        {sources.map((source) => (
          <li key={source.url} className="sources-item">
            <button
              type="button"
              className="sources-link"
              title={source.url}
              onClick={() => openLink(source.url)}
            >
              <span className="sources-name">{source.title}</span>
              <span className="sources-host">{hostOf(source.url)}</span>
            </button>
          </li>
        ))}
      </ol>
    </section>
  )
}

export default Sources
