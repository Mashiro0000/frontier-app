import { memo, useContext, useMemo } from 'react'
import CodeBlock from './CodeBlock'
import { OpenLinkContext } from './linkContext'
import { parseChunk, splitChunks, type Align, type Block, type Inline } from './parse'

// Turns what parse.ts read into React elements (D-025). Every element made here is one of a closed set: p, h1 to h6, strong, em, del,
// code, pre, blockquote, ul, ol, li, table and its parts, hr, br, div, span, button. Text goes in as text, so React escapes it; there is
// no dangerouslySetInnerHTML, no style attribute, no href, no src and no event handler other than the two clicks written below.

function InlineView({ nodes }: { nodes: Inline[] }): React.JSX.Element {
  return (
    <>
      {nodes.map((node, i) => (
        <InlineNode key={i} node={node} />
      ))}
    </>
  )
}

function LinkButton({
  url,
  children
}: {
  url: string
  children: React.ReactNode
}): React.JSX.Element {
  const openLink = useContext(OpenLinkContext)
  // A button, not an <a>: with no href there is nothing for the browser engine to follow by itself. The address is the tooltip.
  return (
    <button type="button" className="md-link" title={url} onClick={() => openLink(url)}>
      {children}
    </button>
  )
}

function InlineNode({ node }: { node: Inline }): React.JSX.Element {
  switch (node.type) {
    case 'text':
      return <>{node.text}</>
    case 'code':
      return <code className="md-code">{node.text}</code>
    case 'strong':
      return (
        <strong>
          <InlineView nodes={node.children} />
        </strong>
      )
    case 'em':
      return (
        <em>
          <InlineView nodes={node.children} />
        </em>
      )
    case 'del':
      return (
        <del>
          <InlineView nodes={node.children} />
        </del>
      )
    case 'br':
      return <br />
    case 'link':
      return (
        <LinkButton url={node.url}>
          <InlineView nodes={node.children} />
        </LinkButton>
      )
  }
}

const ALIGN_CLASS: Record<'left' | 'center' | 'right', string> = {
  left: 'md-align-left',
  center: 'md-align-center',
  right: 'md-align-right'
}

const alignClass = (align: Align | undefined): string | undefined =>
  align ? ALIGN_CLASS[align] : undefined

function BlocksView({ blocks }: { blocks: Block[] }): React.JSX.Element {
  return (
    <>
      {blocks.map((block, i) => (
        <BlockNode key={i} block={block} />
      ))}
    </>
  )
}

function BlockNode({ block }: { block: Block }): React.JSX.Element {
  switch (block.type) {
    case 'paragraph':
      return (
        <p>
          <InlineView nodes={block.children} />
        </p>
      )
    case 'heading': {
      const Tag = `h${block.level}` as 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6'
      return (
        <Tag className="md-heading">
          <InlineView nodes={block.children} />
        </Tag>
      )
    }
    case 'code':
      return <CodeBlock lang={block.lang} text={block.text} />
    case 'quote':
      return (
        <blockquote>
          <BlocksView blocks={block.children} />
        </blockquote>
      )
    case 'list': {
      const items = block.items.map((item, i) => (
        <li key={i}>
          <BlocksView blocks={item} />
        </li>
      ))
      return block.ordered ? (
        <ol start={block.start !== 1 ? block.start : undefined}>{items}</ol>
      ) : (
        <ul>{items}</ul>
      )
    }
    case 'table':
      return (
        <div className="md-table-wrap">
          <table className="md-table">
            <thead>
              <tr>
                {block.head.map((cell, i) => (
                  <th key={i} className={alignClass(block.align[i])}>
                    <InlineView nodes={cell} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, r) => (
                <tr key={r}>
                  {row.map((cell, i) => (
                    <td key={i} className={alignClass(block.align[i])}>
                      <InlineView nodes={cell} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
    case 'rule':
      return <hr />
  }
}

// One finished piece of the reply is read once: while the last piece grows, the earlier ones keep what was made of them.
const Chunk = memo(function Chunk({ source }: { source: string }): React.JSX.Element {
  const blocks = useMemo(() => parseChunk(source), [source])
  return <BlocksView blocks={blocks} />
})

interface MarkdownProps {
  /** A reply, as the model wrote it. */
  text: string
}

/** A reply shown as Markdown (D-025). Nothing in it is HTML, and nothing in it loads or runs by itself. */
function Markdown({ text }: MarkdownProps): React.JSX.Element {
  const chunks = useMemo(() => splitChunks(text), [text])
  return (
    <>
      {chunks.map((source, i) => (
        <Chunk key={i} source={source} />
      ))}
    </>
  )
}

export default Markdown
