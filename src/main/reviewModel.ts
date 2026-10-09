import {
  REVIEW_AFTER_LINES,
  type ChangeState,
  type ChangeSummary,
  type ReviewModel
} from '../shared/changes'
import { unifiedLines, splitLines } from './lineDiff'
import type { Proposal } from './proposals'

// What the two windows are told about a proposed change (Stage 12.5, D-042): a summary for the chat page's list, and, for the Review window, the whole change
// made VISIBLE. A change comes from a model that may have read a hostile file, so every text that is shown (the path, the reason, each line of the difference
// and of the file as it would be) goes through `visible` first: a character the eye cannot see (a control character, a reversing or zero-width character, a
// space that is not a plain one) is written out as `[U+202E]` in the mathematical brackets, and the brackets themselves are written out too, so that a file
// cannot draw a marker of its own. The window then puts the text in with `textContent`, never as markup. No Electron imports.

const OPEN = String.fromCodePoint(0x27e6)
const CLOSE = String.fromCodePoint(0x27e7)
const INVISIBLE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Co}\p{Cn}\p{Cs}]|[^\P{Zs} ]/u

/** The brackets that mark a character written out: the window draws them in a colour of its own. */
export const MARK_OPEN = OPEN
export const MARK_CLOSE = CLOSE

/** A text as it is shown: nothing the eye cannot see, and no marker that the text drew itself. A tab stays a tab. */
export function visible(text: string): string {
  let out = ''
  for (const char of text) {
    if (char === '\t') out += char
    else if (char === OPEN || char === CLOSE || INVISIBLE.test(char)) {
      out += `${OPEN}U+${(char.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, '0')}${CLOSE}`
    } else out += char
  }
  return out
}

export function summaryOf(proposal: Proposal): ChangeSummary {
  return {
    id: proposal.id,
    kind: proposal.kind,
    path: visible(proposal.path),
    added: proposal.added,
    removed: proposal.removed,
    bytes: proposal.bytes,
    secret: proposal.flags.secret,
    runsCommands: proposal.flags.runsCommands
  }
}

/** One line of the reason: the model's words, made visible. */
const oneLine = (text: string): string => visible(text.replace(/\s+/g, ' ').trim())

export function reviewModelOf(
  proposal: Proposal,
  state: ChangeState,
  reachedEnd: boolean
): ReviewModel {
  const name = visible(proposal.path)
  const diff = unifiedLines(name, proposal.kind === 'create' ? null : name, {
    ...proposal.diff,
    lines: proposal.diff.lines.map((line) => ({ ...line, text: visible(line.text) }))
  })
  const afterLines = splitLines(proposal.after)
  return {
    id: proposal.id,
    kind: proposal.kind,
    path: name,
    why: oneLine(proposal.why),
    added: proposal.added,
    removed: proposal.removed,
    bytes: proposal.bytes,
    fingerprint: proposal.fingerprint,
    eol: proposal.eol,
    bom: proposal.bom,
    secret: proposal.flags.secret,
    runsCommands: proposal.flags.runsCommands,
    state,
    diff,
    after: afterLines.slice(0, REVIEW_AFTER_LINES).map(visible),
    afterCut: afterLines.length > REVIEW_AFTER_LINES,
    reachedEnd
  }
}
