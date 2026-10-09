// A line diff of our own (Stage 12.4, D-042): what changes between two texts, line by line, and the unified diff the Review window shows (12.5). No package: the
// diff of a proposal is what the person approves, so it is small enough to read and to check against a brute-force reference (the suite does, on random texts).
// A change of one place (the text to find, put in its place) leaves most lines as they were, so the common beginning and end are cut off first; what is left
// is compared by the longest common subsequence when it is small, and shown as lines removed and then lines added when it is not (a diff that is longer than
// the best one, never a wrong one). No Electron imports.

export type DiffKind = 'same' | 'del' | 'add'

export interface DiffLine {
  kind: DiffKind
  text: string
  /** The line's number in the old text (1-based), or null for an added line. */
  oldNo: number | null
  /** The line's number in the new text (1-based), or null for a removed line. */
  newNo: number | null
}

export interface LineDiff {
  lines: DiffLine[]
  added: number
  removed: number
}

/** The most cells of the comparison table that are made (about 4 MB); a bigger middle part is shown as removed lines and then added ones. */
export const MAX_DIFF_CELLS = 1_000_000

/** The lines of a text: split at LF, CRLF or CR; a text that ends with a line break has no empty last line; the empty text has no lines. */
export function splitLines(text: string): string[] {
  if (text === '') return []
  const lines = text.split(/\r\n|\n|\r/)
  if (lines[lines.length - 1] === '' && /(\r\n|\n|\r)$/.test(text)) lines.pop()
  return lines
}

export function diffLines(before: readonly string[], after: readonly string[]): LineDiff {
  let head = 0
  while (head < before.length && head < after.length && before[head] === after[head]) head++
  let tail = 0
  while (
    tail < before.length - head &&
    tail < after.length - head &&
    before[before.length - 1 - tail] === after[after.length - 1 - tail]
  ) {
    tail++
  }
  const a = before.slice(head, before.length - tail)
  const b = after.slice(head, after.length - tail)
  const lines: DiffLine[] = []
  let oldNo = 1
  let newNo = 1
  const same = (text: string): void => {
    lines.push({ kind: 'same', text, oldNo: oldNo++, newNo: newNo++ })
  }
  const del = (text: string): void => {
    lines.push({ kind: 'del', text, oldNo: oldNo++, newNo: null })
  }
  const add = (text: string): void => {
    lines.push({ kind: 'add', text, oldNo: null, newNo: newNo++ })
  }
  for (let i = 0; i < head; i++) same(before[i])
  const n = a.length
  const m = b.length
  if (n === 0 || m === 0 || (n + 1) * (m + 1) > MAX_DIFF_CELLS) {
    for (const text of a) del(text)
    for (const text of b) add(text)
  } else {
    // the longest common subsequence, from the ends of the two parts (the table holds the length for each pair of suffixes)
    const width = m + 1
    const table = new Uint32Array((n + 1) * width)
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        table[i * width + j] =
          a[i] === b[j]
            ? table[(i + 1) * width + j + 1] + 1
            : Math.max(table[(i + 1) * width + j], table[i * width + j + 1])
      }
    }
    let i = 0
    let j = 0
    while (i < n && j < m) {
      if (a[i] === b[j]) {
        same(a[i])
        i++
        j++
      } else if (table[(i + 1) * width + j] >= table[i * width + j + 1]) {
        del(a[i])
        i++
      } else {
        add(b[j])
        j++
      }
    }
    while (i < n) del(a[i++])
    while (j < m) add(b[j++])
  }
  for (let i = before.length - tail; i < before.length; i++) same(before[i])
  let added = 0
  let removed = 0
  for (const line of lines) {
    if (line.kind === 'add') added++
    else if (line.kind === 'del') removed++
  }
  return { lines, added, removed }
}

/** The old text's lines from a diff (the same and the removed), and the new text's (the same and the added): what the suite checks against the texts. */
export const oldLinesOf = (diff: LineDiff): string[] =>
  diff.lines.filter((l) => l.kind !== 'add').map((l) => l.text)
export const newLinesOf = (diff: LineDiff): string[] =>
  diff.lines.filter((l) => l.kind !== 'del').map((l) => l.text)

/** One line of a unified diff: a header, the heading of a place that changed, or a line that is the same, added or removed (its text without the sign). */
export interface UnifiedLine {
  kind: 'header' | 'hunk' | 'same' | 'add' | 'del'
  text: string
}

/**
 * The unified diff of a change, line by line: a header, then each place that changed with `context` lines around it (places closer than twice that are one).
 * `oldName` is null for a new file. Only the lines the diff holds are used, so it is as long as what changed and no longer.
 */
export function unifiedLines(
  name: string,
  oldName: string | null,
  diff: LineDiff,
  context = 3
): UnifiedLine[] {
  const out: UnifiedLine[] = [
    { kind: 'header', text: `--- ${oldName === null ? '/dev/null' : `a/${oldName}`}` },
    { kind: 'header', text: `+++ b/${name}` }
  ]
  const changed: number[] = []
  diff.lines.forEach((line, index) => {
    if (line.kind !== 'same') changed.push(index)
  })
  // the ranges of lines to show, merged when they touch
  const ranges: [number, number][] = []
  for (const index of changed) {
    const from = Math.max(0, index - context)
    const to = Math.min(diff.lines.length - 1, index + context)
    const last = ranges[ranges.length - 1]
    if (last !== undefined && from <= last[1] + 1) last[1] = Math.max(last[1], to)
    else ranges.push([from, to])
  }
  for (const [from, to] of ranges) {
    const part = diff.lines.slice(from, to + 1)
    const oldCount = part.filter((l) => l.kind !== 'add').length
    const newCount = part.filter((l) => l.kind !== 'del').length
    // where each side starts: after the lines of that side that come before this place (an empty side is written as the line before it, as `diff -u` does)
    const oldBefore = diff.lines.slice(0, from).filter((l) => l.kind !== 'add').length
    const newBefore = diff.lines.slice(0, from).filter((l) => l.kind !== 'del').length
    const oldStart = oldCount === 0 ? oldBefore : oldBefore + 1
    const newStart = newCount === 0 ? newBefore : newBefore + 1
    out.push({ kind: 'hunk', text: `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@` })
    for (const line of part) out.push({ kind: line.kind, text: line.text })
  }
  return out
}

const SIGN: Readonly<Record<UnifiedLine['kind'], string>> = {
  header: '',
  hunk: '',
  same: ' ',
  add: '+',
  del: '-'
}

/** The unified diff as one text (what `diff -u` writes). */
export function unifiedDiff(
  name: string,
  oldName: string | null,
  diff: LineDiff,
  context = 3
): string {
  return unifiedLines(name, oldName, diff, context)
    .map((line) => `${SIGN[line.kind]}${line.text}`)
    .join('\n')
}
