// (23.5, D-055) Colours for a block of code, with no package: comments, strings, numbers and keywords, for the languages a fence commonly names. It only
// splits the text into pieces (joined they are exactly the text); the pieces are shown as text, never as markup, and nothing is run. An unknown language,
// or none, stays plain.
// shortcut: one pass of regular expressions, not a parser (a "#" inside a JS regex literal, nested template strings or heredocs can be coloured wrongly);
// a real grammar package if the owner wants exact colours.

export type CodeTone = 'comment' | 'string' | 'number' | 'keyword'
export interface CodePiece {
  text: string
  tone: CodeTone | null
}

const C_LIKE =
  'break case catch class const continue default do else enum export extends false finally for function if import in instanceof interface let new null return static super switch this throw true try typeof var void while yield async await of from type public private protected struct impl fn mut pub use match package func go defer chan map range nil int float double bool char long short unsigned string boolean'
const PYTHON =
  'and as assert async await break class continue def del elif else except False finally for from global if import in is lambda None nonlocal not or pass raise return True try while with yield self print'
const SHELL =
  'if then else elif fi for while do done case esac in function return export local echo exit set unset source cd'
const SQL =
  'select from where and or not insert into values update set delete create table drop alter join left right inner outer on group by order having limit as distinct null is like primary key'

interface Grammar {
  keywords: Set<string>
  lineComment: string[]
  blockComment: boolean
  caseBlind?: boolean
}
const words = (list: string): Set<string> => new Set(list.split(' '))
const C: Grammar = { keywords: words(C_LIKE), lineComment: ['//'], blockComment: true }
const GRAMMARS: Record<string, Grammar> = {
  js: C,
  javascript: C,
  jsx: C,
  ts: C,
  typescript: C,
  tsx: C,
  java: C,
  c: C,
  cpp: C,
  'c++': C,
  cs: C,
  csharp: C,
  go: C,
  rust: C,
  rs: C,
  kotlin: C,
  swift: C,
  php: C,
  json: { keywords: words('true false null'), lineComment: [], blockComment: false },
  css: { keywords: words('important'), lineComment: [], blockComment: true },
  py: { keywords: words(PYTHON), lineComment: ['#'], blockComment: false },
  python: { keywords: words(PYTHON), lineComment: ['#'], blockComment: false },
  sh: { keywords: words(SHELL), lineComment: ['#'], blockComment: false },
  bash: { keywords: words(SHELL), lineComment: ['#'], blockComment: false },
  shell: { keywords: words(SHELL), lineComment: ['#'], blockComment: false },
  powershell: {
    keywords: words('if else elseif foreach for while function param return true false null'),
    lineComment: ['#'],
    blockComment: false,
    caseBlind: true
  },
  ps1: {
    keywords: words('if else elseif foreach for while function param return true false null'),
    lineComment: ['#'],
    blockComment: false,
    caseBlind: true
  },
  sql: { keywords: words(SQL), lineComment: ['--'], blockComment: true, caseBlind: true }
}

/** The pieces of `text` with their tones, or null when the language is not one this colours (then the block stays plain). */
export function colourCode(text: string, lang: string | null): CodePiece[] | null {
  const grammar = lang === null ? undefined : GRAMMARS[lang.toLowerCase()]
  if (grammar === undefined) return null
  const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const parts = [
    ...(grammar.blockComment ? ['\\/\\*[\\s\\S]*?(?:\\*\\/|$)'] : []),
    ...grammar.lineComment.map((mark) => `${escape(mark)}[^\\n]*`)
  ]
  // One pattern, tried left to right: a comment, a string (to its closing quote on the same line, or a backtick string across lines), a number, a word.
  const pattern = new RegExp(
    [
      // a group either way, so the groups after it keep their numbers
      parts.length > 0 ? `(${parts.join('|')})` : '((?!))',
      '("(?:[^"\\\\\\n]|\\\\.)*"?|\'(?:[^\'\\\\\\n]|\\\\.)*\'?|`(?:[^`\\\\]|\\\\[\\s\\S])*`?)',
      '(\\b\\d[\\d_]*(?:\\.\\d+)?(?:[eE][+-]?\\d+)?\\b|\\b0[xX][\\da-fA-F]+\\b)',
      '([A-Za-z_$][\\w$]*)'
    ].join('|'),
    'g'
  )
  const pieces: CodePiece[] = []
  const plain = (s: string): void => {
    if (s === '') return
    const last = pieces[pieces.length - 1]
    if (last !== undefined && last.tone === null) last.text += s
    else pieces.push({ text: s, tone: null })
  }
  let at = 0
  for (const match of text.matchAll(pattern)) {
    const start = match.index ?? 0
    plain(text.slice(at, start))
    const [whole, comment, string, number, word] = match
    if (comment !== undefined) pieces.push({ text: whole, tone: 'comment' })
    else if (string !== undefined) pieces.push({ text: whole, tone: 'string' })
    else if (number !== undefined) pieces.push({ text: whole, tone: 'number' })
    else if (
      word !== undefined &&
      grammar.keywords.has(grammar.caseBlind ? word.toLowerCase() : word)
    )
      pieces.push({ text: whole, tone: 'keyword' })
    else plain(whole)
    at = start + whole.length
  }
  plain(text.slice(at))
  return pieces
}
