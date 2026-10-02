// A small Markdown reader (D-025): text in, a tree of a few known kinds out. No HTML, no DOM and no React in this file, so it can be
// checked on its own with plain Node. It never throws, and a hostile text costs a bounded amount of work (see LIMITS): what it does
// not understand, or has no budget left for, is kept as the text it was. Raw HTML is never read as HTML (a "<" is just a character),
// and images are shown as the text they were written as.

export type Align = 'left' | 'center' | 'right' | null

export type Inline =
  | { type: 'text'; text: string }
  | { type: 'code'; text: string }
  | { type: 'strong'; children: Inline[] }
  | { type: 'em'; children: Inline[] }
  | { type: 'del'; children: Inline[] }
  /** Only ever an https address without credentials, as `new URL` wrote it (see `safeHttpsUrl`). */
  | { type: 'link'; url: string; children: Inline[] }
  | { type: 'br' }

export type Block =
  | { type: 'paragraph'; children: Inline[] }
  | { type: 'heading'; level: 1 | 2 | 3 | 4 | 5 | 6; children: Inline[] }
  | { type: 'code'; lang: string | null; text: string }
  | { type: 'quote'; children: Block[] }
  | { type: 'list'; ordered: boolean; start: number; items: Block[][] }
  | { type: 'table'; align: Align[]; head: Inline[][]; rows: Inline[][][] }
  | { type: 'rule' }

export const LIMITS = {
  /** Quotes and lists inside each other. Deeper than this is shown as the text it was. */
  maxDepth: 6,
  /** Emphasis and links inside each other. */
  maxInlineDepth: 6,
  maxTableColumns: 20,
  maxTableRows: 200,
  maxLinkChars: 2000,
  /** The longest text of a link, in characters. */
  maxLabelChars: 1000,
  /** The work allowed on one chunk of text: a floor plus this much per character. When it runs out, the rest is kept as plain text. */
  stepsPerChar: 40,
  stepsFloor: 5000
} as const

interface Budget {
  left: number
}

const ESCAPABLE = '!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~'

// ---- line helpers ---------------------------------------------------------------------------------

/** A line's leading tabs and spaces as spaces (tab stops of four), so that indentation can be counted. */
function expandIndent(line: string): string {
  let column = 0
  let i = 0
  for (; i < line.length; i++) {
    const c = line[i]
    if (c === ' ') column++
    else if (c === '\t') column += 4 - (column % 4)
    else break
  }
  return i === 0 ? line : ' '.repeat(column) + line.slice(i)
}

/**
 * The lines of a text, with the tabs that indent a line turned into spaces so that indentation can be counted, EXCEPT inside a
 * fenced block: code keeps exactly the characters it was written with (a tab in Go or a Makefile is not four spaces), because the
 * Copy button of a code block promises exactly those characters.
 */
function toLines(text: string): string[] {
  const replacement = String.fromCodePoint(0xfffd) // what a NUL byte becomes
  const raw = text.replaceAll('\u0000', replacement).replace(/\r\n?/g, '\n').split('\n')
  let open: string | null = null
  return raw.map((line) => {
    if (open !== null) {
      if (closesFence(line, open)) open = null
      return line
    }
    const expanded = expandIndent(line)
    const fence = fenceOf(expanded)
    if (fence) open = fence.fence
    return expanded
  })
}

const isBlank = (line: string): boolean => line.trim() === ''

function indentOf(line: string): number {
  let n = 0
  while (line[n] === ' ') n++
  return n
}

const plain = (lines: readonly string[]): Block => ({
  type: 'paragraph',
  children: [{ type: 'text', text: lines.join('\n') }]
})

// ---- recognising the start of a block -------------------------------------------------------------

function fenceOf(line: string): { fence: string; info: string; indent: number } | null {
  const m = /^( {0,3})(`{3,}|~{3,})(.*)$/.exec(line)
  if (!m) return null
  const [, spaces, fence, info] = m
  if (fence[0] === '`' && info.includes('`')) return null // an inline code span, not a fence
  return { fence, info, indent: spaces.length }
}

function closesFence(line: string, fence: string): boolean {
  if (indentOf(line) > 3) return false
  const t = line.trim()
  return t.length >= fence.length && t === fence[0].repeat(t.length)
}

function langOf(info: string): string | null {
  const word = info.trim().split(/\s+/)[0] ?? ''
  return /^[A-Za-z0-9_+#.-]{1,30}$/.test(word) ? word : null
}

function headingOf(line: string): { level: 1 | 2 | 3 | 4 | 5 | 6; text: string } | null {
  const m = /^ {0,3}(#{1,6})(?=[ \t]|$)/.exec(line)
  if (!m) return null
  let rest = line.slice(m[0].length).trim()
  // a closing run of #, set off by a space: "# Title ##"
  let end = rest.length
  while (end > 0 && rest[end - 1] === '#') end--
  if (end < rest.length && (end === 0 || rest[end - 1] === ' ')) rest = rest.slice(0, end).trimEnd()
  return { level: m[1].length as 1 | 2 | 3 | 4 | 5 | 6, text: rest }
}

function isRule(line: string): boolean {
  if (indentOf(line) > 3) return false
  const t = line.trim()
  const ch = t[0]
  if (t.length < 3 || (ch !== '-' && ch !== '*' && ch !== '_')) return false
  let marks = 0
  for (const c of t) {
    if (c === ch) marks++
    else if (c !== ' ' && c !== '\t') return false
  }
  return marks >= 3
}

const isQuote = (line: string): boolean => indentOf(line) <= 3 && line.trimStart()[0] === '>'

function stripQuote(line: string): string {
  const t = line.trimStart().slice(1)
  return t[0] === ' ' ? t.slice(1) : t
}

interface Marker {
  ordered: boolean
  /** "-", "*", "+" or "." / ")": a different one starts a new list. */
  char: string
  number: number
  /** How far the item's own lines are indented. */
  contentIndent: number
  /** What follows the marker on its line. */
  rest: string
}

function markerOf(line: string): Marker | null {
  const indent = indentOf(line)
  if (indent > 3) return null
  const t = line.slice(indent)
  const c = t[0]
  let ordered = false
  let char = ''
  let number = 0
  let i = 0
  if (c === '-' || c === '*' || c === '+') {
    char = c
    i = 1
  } else if (c !== undefined && c >= '0' && c <= '9') {
    let j = 0
    while (j < t.length && t[j] >= '0' && t[j] <= '9') j++
    if (j > 9 || (t[j] !== '.' && t[j] !== ')')) return null
    ordered = true
    char = t[j]
    number = Number(t.slice(0, j))
    i = j + 1
  } else {
    return null
  }
  if (i < t.length && t[i] !== ' ' && t[i] !== '\t') return null // "-foo", "**bold**", "1.5"
  // the white space after the marker, counted in columns (a tab goes to the next multiple of four)
  let column = indent + i
  let end = i
  while (t[end] === ' ' || t[end] === '\t') {
    column += t[end] === '\t' ? 4 - (column % 4) : 1
    end++
  }
  const spaces = column - (indent + i)
  const rest = t.slice(end)
  if (rest === '') return { ordered, char, number, contentIndent: indent + i + 1, rest }
  // five or more spaces: the text is indented code inside the item, so only one space belongs to the marker
  if (spaces > 4) {
    return {
      ordered,
      char,
      number,
      contentIndent: indent + i + 1,
      rest: ' '.repeat(spaces - 1) + rest
    }
  }
  return { ordered, char, number, contentIndent: indent + i + spaces, rest }
}

function splitRow(line: string): string[] {
  let t = line.trim()
  if (t.startsWith('|')) t = t.slice(1)
  const cells: string[] = []
  let cell = ''
  let endedOnBar = false
  for (let k = 0; k < t.length; k++) {
    const c = t[k]
    endedOnBar = false
    if (c === '\\' && t[k + 1] === '|') {
      cell += '|'
      k++
    } else if (c === '|') {
      cells.push(cell.trim())
      cell = ''
      endedOnBar = true
    } else {
      cell += c
    }
  }
  if (!endedOnBar) cells.push(cell.trim())
  return cells
}

/** The alignments of a table's second line ("| --- | :-: |"), or null if the line is not one. */
function delimiterRow(line: string | undefined): Align[] | null {
  if (line === undefined || !line.includes('|') || !line.includes('-') || indentOf(line) > 3)
    return null
  const cells = splitRow(line)
  const aligns: Align[] = []
  for (const cell of cells) {
    if (!/^:?-+:?$/.test(cell)) return null
    const left = cell.startsWith(':')
    const right = cell.endsWith(':')
    aligns.push(left && right ? 'center' : right ? 'right' : left ? 'left' : null)
  }
  return aligns.length > 0 ? aligns : null
}

function startsTable(lines: string[], i: number): boolean {
  const head = lines[i]
  if (!head.includes('|')) return false
  const aligns = delimiterRow(lines[i + 1])
  return aligns !== null && aligns.length === splitRow(head).length
}

/** Whether `line` ends a paragraph that is already going. (Indented lines never do: they are part of it.) */
function interrupts(lines: string[], i: number, nesting: boolean): boolean {
  const line = lines[i]
  if (indentOf(line) > 3) return false
  if (fenceOf(line) || headingOf(line) || isRule(line)) return true
  if (nesting && isQuote(line)) return true
  if (nesting) {
    const m = markerOf(line)
    if (m && m.rest !== '' && (!m.ordered || m.number === 1)) return true
  }
  return startsTable(lines, i)
}

// ---- blocks ---------------------------------------------------------------------------------------

function parseBlocks(lines: string[], depth: number, b: Budget): Block[] {
  const blocks: Block[] = []
  const nesting = depth < LIMITS.maxDepth
  let i = 0
  while (i < lines.length) {
    if (b.left < 0) {
      blocks.push(plain(lines.slice(i)))
      break
    }
    const line = lines[i]
    b.left -= line.length + 1
    if (isBlank(line)) {
      i++
      continue
    }

    // indented code (four spaces): how replies were written before they were rendered (D-009)
    if (indentOf(line) > 3) {
      const code: string[] = []
      while (i < lines.length && (isBlank(lines[i]) || indentOf(lines[i]) > 3)) {
        code.push(lines[i].slice(4))
        i++
      }
      while (code.length > 0 && isBlank(code[code.length - 1])) code.pop()
      blocks.push({ type: 'code', lang: null, text: code.join('\n') })
      continue
    }

    const fence = fenceOf(line)
    if (fence) {
      const code: string[] = []
      i++
      // an unclosed fence runs to the end of the text, which is what a reply still arriving looks like
      while (i < lines.length && !closesFence(lines[i], fence.fence)) {
        const own = indentOf(lines[i])
        code.push(lines[i].slice(Math.min(own, fence.indent)))
        i++
      }
      i++ // the closing fence
      blocks.push({ type: 'code', lang: langOf(fence.info), text: code.join('\n') })
      continue
    }

    const heading = headingOf(line)
    if (heading) {
      blocks.push({
        type: 'heading',
        level: heading.level,
        children: parseInline(heading.text, 0, false, b)
      })
      i++
      continue
    }

    if (isRule(line)) {
      blocks.push({ type: 'rule' })
      i++
      continue
    }

    if (nesting && isQuote(line)) {
      const inner: string[] = []
      while (i < lines.length && isQuote(lines[i])) {
        inner.push(stripQuote(lines[i]))
        i++
      }
      blocks.push({ type: 'quote', children: parseBlocks(inner, depth + 1, b) })
      continue
    }

    if (nesting && markerOf(line)) {
      const list = readList(lines, i, depth, b)
      blocks.push(list.block)
      i = list.next
      continue
    }

    if (startsTable(lines, i)) {
      const table = readTable(lines, i, b)
      if (table) {
        blocks.push(table.block)
        i = table.next
        continue
      }
    }

    // a paragraph: lines up to a blank line or the start of another block
    const para = [line.trimStart()]
    i++
    while (i < lines.length && !isBlank(lines[i]) && !interrupts(lines, i, nesting)) {
      b.left -= lines[i].length + 1
      para.push(lines[i].trimStart())
      i++
    }
    para[para.length - 1] = para[para.length - 1].trimEnd()
    blocks.push({ type: 'paragraph', children: parseInline(para.join('\n'), 0, false, b) })
  }
  return blocks
}

function readList(
  lines: string[],
  start: number,
  depth: number,
  b: Budget
): { block: Block; next: number } {
  const first = markerOf(lines[start]) as Marker
  const items: Block[][] = []
  let i = start
  while (i < lines.length) {
    const m = markerOf(lines[i])
    if (!m || m.ordered !== first.ordered || m.char !== first.char) break
    // one item: its own line, then every following line that belongs to it
    const own = [m.rest]
    let j = i + 1
    while (j < lines.length) {
      const line = lines[j]
      b.left -= line.length + 1
      if (isBlank(line)) {
        // blank lines belong to the item only when an indented line follows
        let k = j + 1
        while (k < lines.length && isBlank(lines[k])) k++
        if (k >= lines.length || indentOf(lines[k]) < m.contentIndent) break
        for (; j < k; j++) own.push('')
        continue
      }
      if (indentOf(line) >= m.contentIndent) {
        own.push(line.slice(m.contentIndent))
        j++
        continue
      }
      // not indented enough: the next line of a paragraph that is still going, or the end of the item
      if (isBlank(own[own.length - 1]) || fenceOf(line) || headingOf(line) || isRule(line)) break
      if (isQuote(line) || markerOf(line)) break
      own.push(line.trimStart())
      j++
    }
    items.push(parseBlocks(own, depth + 1, b))
    i = j
    // blank lines between two items of one list
    let k = i
    while (k < lines.length && isBlank(lines[k])) k++
    if (k > i) {
      const next = k < lines.length ? markerOf(lines[k]) : null
      if (!next || next.ordered !== first.ordered || next.char !== first.char) break
      i = k
    }
  }
  return { block: { type: 'list', ordered: first.ordered, start: first.number, items }, next: i }
}

function readTable(
  lines: string[],
  start: number,
  b: Budget
): { block: Block; next: number } | null {
  const align = delimiterRow(lines[start + 1])
  const headCells = splitRow(lines[start])
  if (!align || headCells.length !== align.length || align.length > LIMITS.maxTableColumns)
    return null
  const width = align.length
  const rows: Inline[][][] = []
  let i = start + 2
  while (i < lines.length && rows.length < LIMITS.maxTableRows) {
    const line = lines[i]
    if (isBlank(line) || !line.includes('|') || indentOf(line) > 3) break
    b.left -= line.length + 1
    const cells = splitRow(line).slice(0, width)
    while (cells.length < width) cells.push('')
    rows.push(cells.map((cell) => parseInline(cell, 0, false, b)))
    i++
  }
  return {
    block: {
      type: 'table',
      align,
      head: headCells.map((cell) => parseInline(cell, 0, false, b)),
      rows
    },
    next: i
  }
}

// ---- inline ---------------------------------------------------------------------------------------

/**
 * An https address the app is willing to offer: no credentials, no other scheme, no spaces or control characters, a host, and
 * not too long. Returns the address as `new URL` writes it (so what is shown and what is opened are the same string), or null.
 */
export function safeHttpsUrl(raw: string): string | null {
  if (raw.length > LIMITS.maxLinkChars || !/^https:\/\//i.test(raw)) return null
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x20\x7f-\x9f\\<>"]/.test(raw)) return null
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  if (
    url.protocol !== 'https:' ||
    url.username !== '' ||
    url.password !== '' ||
    url.hostname === ''
  ) {
    return null
  }
  return url.href
}

/** `[label](address "title")` starting at `s[at]`; the address is unchecked here. The scan is bounded and paid for from the budget. */
function readLink(
  s: string,
  at: number,
  b: Budget
): { label: string; address: string; end: number } | null {
  const found = scanLink(s, at)
  b.left -= (found?.end ?? Math.min(s.length, at + LIMITS.maxLabelChars + LIMITS.maxLinkChars)) - at
  return found
}

function scanLink(s: string, at: number): { label: string; address: string; end: number } | null {
  const limit = Math.min(s.length, at + LIMITS.maxLabelChars + 2)
  let depth = 0
  let k = at
  for (; k < limit; k++) {
    const c = s[k]
    if (c === '\\') k++
    else if (c === '[') depth++
    else if (c === ']' && --depth === 0) break
  }
  if (k >= limit || s[k + 1] !== '(') return null
  let p = k + 2
  while (s[p] === ' ' || s[p] === '\n') p++
  const from = p
  const urlLimit = Math.min(s.length, from + LIMITS.maxLinkChars + 2)
  let parens = 0
  while (p < urlLimit) {
    const c = s[p]
    if (c === ' ' || c === '\n') break
    if (c === '(') parens++
    else if (c === ')' && parens-- === 0) break
    if (c === '\\') p++
    p++
  }
  if (p >= urlLimit && p < s.length) return null // too long to be an address worth offering
  const address = s.slice(from, p).replace(/\\([!-/:-@[-`{-~])/g, '$1')
  while (s[p] === ' ' || s[p] === '\n') p++
  if (s[p] === '"' || s[p] === "'") {
    const close = s.indexOf(s[p], p + 1)
    if (close === -1 || close - p > LIMITS.maxLinkChars) return null
    p = close + 1
    while (s[p] === ' ' || s[p] === '\n') p++
  }
  if (s[p] !== ')') return null
  return { label: s.slice(at + 1, k), address, end: p + 1 }
}

const isAlnum = (c: string | undefined): boolean => c !== undefined && /[A-Za-z0-9]/.test(c)
const isSpaceChar = (c: string | undefined): boolean => c === undefined || /\s/.test(c)

/** The length of the run of `ch` that starts at `s[at]`. */
function runOf(s: string, at: number, ch: string): number {
  let n = 0
  while (s[at + n] === ch) n++
  return n
}

/** Where the matching run of exactly `n` backticks starts, or -1. */
function closingTicks(s: string, from: number, n: number, b: Budget): number {
  let j = from
  while ((j = s.indexOf('`', j)) !== -1) {
    const run = runOf(s, j, '`')
    if (run === n) return j
    j += run
  }
  b.left -= s.length - from
  return -1
}

/** Where the run that closes an emphasis opened with `n` of `ch` starts, or -1. */
function closingEmphasis(s: string, from: number, ch: string, n: number, b: Budget): number {
  let k = from
  while (k < s.length) {
    const c = s[k]
    if (c === '\\') {
      k += 2
    } else if (c === '`') {
      const run = runOf(s, k, '`')
      const close = closingTicks(s, k + run, run, b)
      k = close === -1 ? k + run : close + run
    } else if (c === ch) {
      const run = runOf(s, k, ch)
      const prev = s[k - 1]
      const next = s[k + run]
      if (run === n && !isSpaceChar(prev) && (ch !== '_' || !isAlnum(next))) return k
      k += run
    } else {
      k++
    }
  }
  b.left -= s.length - from
  return -1
}

function parseInline(s: string, depth: number, inLink: boolean, b: Budget): Inline[] {
  const out: Inline[] = []
  let text = ''
  const flush = (): void => {
    if (text !== '') out.push({ type: 'text', text })
    text = ''
  }
  let i = 0
  while (i < s.length) {
    if (b.left < 0 || depth > LIMITS.maxInlineDepth) {
      text += s.slice(i)
      break
    }
    b.left -= 1
    const c = s[i]

    if (c === '\\') {
      const next = s[i + 1]
      if (next === '\n') {
        flush()
        out.push({ type: 'br' })
        i += 2
      } else if (next !== undefined && ESCAPABLE.includes(next)) {
        text += next
        i += 2
      } else {
        text += c
        i++
      }
      continue
    }

    if (c === '\n') {
      if (text.endsWith('  ')) {
        text = text.replace(/ +$/, '')
        flush()
        out.push({ type: 'br' })
      } else {
        // a line break inside a paragraph is kept as one (the page shows it with white-space: pre-line)
        text = text.replace(/ +$/, '') + '\n'
      }
      i++
      continue
    }

    if (c === '`') {
      const run = runOf(s, i, '`')
      const close = closingTicks(s, i + run, run, b)
      if (close === -1) {
        text += '`'.repeat(run)
        i += run
        continue
      }
      let code = s.slice(i + run, close).replace(/\n/g, ' ')
      if (code.length > 2 && code.startsWith(' ') && code.endsWith(' ') && code.trim() !== '') {
        code = code.slice(1, -1)
      }
      flush()
      out.push({ type: 'code', text: code })
      i = close + run
      continue
    }

    if (c === '!' && s[i + 1] === '[') {
      // an image: never loaded (the page loads nothing by itself), shown as the text it was written as
      const link = readLink(s, i + 1, b)
      if (link) {
        text += s.slice(i, link.end)
        i = link.end
        continue
      }
    }

    if (c === '[' && !inLink) {
      const link = readLink(s, i, b)
      const url = link ? safeHttpsUrl(link.address) : null
      if (link && url !== null) {
        flush()
        const label = parseInline(link.label, depth + 1, true, b)
        out.push({
          type: 'link',
          url,
          children: label.length > 0 ? label : [{ type: 'text', text: url }]
        })
        i = link.end
        continue
      }
    }

    if (c === '*' || c === '_' || c === '~') {
      const run = runOf(s, i, c)
      const after = s[i + run]
      const before = s[i - 1]
      const opens =
        !isSpaceChar(after) &&
        run <= 3 &&
        (c !== '_' || !isAlnum(before)) &&
        (c !== '~' || run === 2)
      const close = opens ? closingEmphasis(s, i + run, c, run, b) : -1
      if (close === -1) {
        text += c.repeat(run)
        i += run
        continue
      }
      flush()
      const inner = parseInline(s.slice(i + run, close), depth + 1, inLink, b)
      if (c === '~') out.push({ type: 'del', children: inner })
      else if (run === 1) out.push({ type: 'em', children: inner })
      else if (run === 2) out.push({ type: 'strong', children: inner })
      else out.push({ type: 'strong', children: [{ type: 'em', children: inner }] })
      i = close + run
      continue
    }

    text += c
    i++
  }
  flush()
  return out
}

// ---- the whole text -------------------------------------------------------------------------------

/**
 * Cuts a reply into pieces that can be read one at a time: at a blank line that is followed by an unindented line, and never
 * inside a fenced block. An indented line after a blank one belongs to the list item above it, so it never starts a piece. The
 * page keeps what it made of a finished piece while the last one is still growing. Reading the pieces one by one differs from
 * reading the whole text in one way: a list whose items are separated by blank lines becomes one list per item (each keeps its
 * own number, and it looks the same).
 */
export function splitChunks(text: string): string[] {
  const lines = text.split(/\r\n|\r|\n/)
  const chunks: string[] = []
  let current: string[] = []
  let open: string | null = null
  for (let i = 0; i < lines.length; i++) {
    const line = expandIndent(lines[i])
    if (open !== null) {
      if (closesFence(line, open)) open = null
    } else {
      const fence = fenceOf(line)
      if (fence) open = fence.fence
      else if (isBlank(line)) {
        let k = i + 1
        while (k < lines.length && isBlank(lines[k])) k++
        if (k < lines.length && indentOf(expandIndent(lines[k])) === 0 && current.length > 0) {
          chunks.push(current.join('\n'))
          current = []
          i = k - 1
          continue
        }
      }
    }
    current.push(lines[i])
  }
  if (current.length > 0) chunks.push(current.join('\n'))
  return chunks
}

/** Reads one piece of text (what `splitChunks` returns). */
export function parseChunk(source: string): Block[] {
  const budget: Budget = { left: LIMITS.stepsFloor + source.length * LIMITS.stepsPerChar }
  return parseBlocks(toLines(source), 0, budget)
}

/** Reads a whole text. */
export function parseMarkdown(text: string): Block[] {
  return splitChunks(text).flatMap(parseChunk)
}
