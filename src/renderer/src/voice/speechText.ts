import { VOICE_LIMITS } from '../../../shared/voice'
import { parseMarkdown, type Block, type Inline } from '../markdown/parse'

// What is said when a reply is read aloud (Stage 15.2, D-047): the reply's Markdown made into plain sentences for the ear, and cut into pieces. No DOM and no React
// in this file, so a plain-Node suite can run it. The voice is the system's (the window's `speechSynthesis`); this file decides only WHAT is said.
//
// What an ear does not want: code (said as "Code block."), a table (said as one sentence about its size), a web address (said as "link to" and the site's name),
// Markdown marks (the reader has already taken them out: this works from its tree, never from the raw text), and a reply of any length (it is cut into pieces of at
// most 600 characters at the end of a sentence, so that Stop is heard at once, and a reply of more than 20,000 characters is read up to there and says so).

const hostOf = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./i, '')
  } catch {
    return 'a website'
  }
}

/** Web addresses written in running text become "link to <site>". */
const SPOKEN_URL = /\bhttps?:\/\/[^\s<>()[\]"']+/gi
const sayAddresses = (text: string): string =>
  text.replace(SPOKEN_URL, (found) => {
    // the full stop or comma after an address belongs to the sentence, not to the address
    const end = /[.,;:!?]+$/.exec(found)?.[0] ?? ''
    return `link to ${hostOf(found.slice(0, found.length - end.length))}${end}`
  })

function inlineText(nodes: Inline[]): string {
  let out = ''
  for (const node of nodes) {
    switch (node.type) {
      case 'text':
        out += sayAddresses(node.text)
        break
      case 'code':
        // short code (a name, a command) is read as it is; a long span is not a thing to hear
        out += node.text.length <= 40 ? node.text : 'code'
        break
      case 'strong':
      case 'em':
      case 'del':
        out += inlineText(node.children)
        break
      case 'link': {
        const label = inlineText(node.children).trim()
        // a link whose words ARE its address (or are empty) is said as the site
        out += label === '' || /^link to /i.test(label) ? `link to ${hostOf(node.url)}` : label
        break
      }
      case 'br':
        out += '\n'
        break
    }
  }
  return out
}

/** The end of a sentence, so that a heading or an item is heard as one. */
const ended = (text: string): string => (/[.!?:;…]$/.test(text) ? text : `${text}.`)

function blockText(block: Block, out: string[]): void {
  switch (block.type) {
    case 'paragraph':
      out.push(inlineText(block.children))
      break
    case 'heading': {
      const text = inlineText(block.children).trim()
      if (text !== '') out.push(ended(text))
      break
    }
    case 'code':
      out.push('Code block.')
      break
    case 'quote':
      for (const child of block.children) blockText(child, out)
      break
    case 'list':
      block.items.forEach((item, index) => {
        const lines: string[] = []
        for (const child of item) blockText(child, lines)
        const text = lines.join(' ').trim()
        if (text === '') return
        out.push(block.ordered ? `${block.start + index}. ${ended(text)}` : ended(text))
      })
      break
    case 'table':
      out.push(
        `Table with ${block.head.length} ${block.head.length === 1 ? 'column' : 'columns'} and ${block.rows.length} ${block.rows.length === 1 ? 'row' : 'rows'}, not read aloud.`
      )
      break
    case 'rule':
      break
  }
}

/** A reply, as the sentences to say: paragraphs apart, spaces tidied, nothing the ear cannot use. */
export function speechOf(markdown: string): string {
  const out: string[] = []
  for (const block of parseMarkdown(markdown)) blockText(block, out)
  return out
    .map((part) =>
      part
        .replace(/[ \t]+/g, ' ')
        .replace(/ ?\n ?/g, '\n')
        .trim()
    )
    .filter((part) => part !== '')
    .join('\n\n')
}

export interface Reading {
  /** What is said, one after another. Each is at most `readPieceChars` characters. */
  pieces: string[]
  /** The reply was longer than `readMaxChars`, and the pieces stop where that ran out. */
  truncated: boolean
}

/** Cuts one long run of words into pieces of at most `size`, at a space where it can (a single word longer than `size` is cut hard). */
function cutWords(text: string, size: number): string[] {
  const out: string[] = []
  let rest = text.trim()
  while (rest.length > size) {
    let at = rest.lastIndexOf(' ', size)
    if (at <= 0) at = size
    out.push(rest.slice(0, at).trim())
    rest = rest.slice(at).trim()
  }
  if (rest !== '') out.push(rest)
  return out
}

/**
 * The pieces to say. Paragraphs are kept apart; a paragraph is cut at the end of a sentence into pieces of at most `readPieceChars`; a sentence longer than that is
 * cut at a space. Several short sentences are put in one piece, so the voice does not stop at every full stop. Reading stops at `readMaxChars` characters.
 */
export function readingOf(
  speech: string,
  size: number = VOICE_LIMITS.readPieceChars,
  max: number = VOICE_LIMITS.readMaxChars
): Reading {
  const pieces: string[] = []
  let used = 0
  let truncated = false
  for (const paragraph of speech.split(/\n{2,}/)) {
    const trimmed = paragraph.replace(/\s*\n\s*/g, ' ').trim()
    if (trimmed === '') continue
    const sentences = trimmed.match(/[^.!?…]+[.!?…]+["')\]]*\s*|[^.!?…]+$/g) ?? [trimmed]
    let current = ''
    const flush = (): void => {
      if (current.trim() !== '') pieces.push(current.trim())
      current = ''
    }
    for (const sentence of sentences) {
      const parts = sentence.length > size ? cutWords(sentence, size) : [sentence]
      for (const part of parts) {
        if (current !== '' && current.length + part.length > size) flush()
        current += part
        if (part.length > size - 40) flush()
      }
    }
    flush()
  }
  const kept: string[] = []
  for (const piece of pieces) {
    if (used + piece.length > max) {
      truncated = true
      break
    }
    kept.push(piece)
    used += piece.length
  }
  return { pieces: kept, truncated }
}
