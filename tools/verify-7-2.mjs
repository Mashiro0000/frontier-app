// Slice 7.2 (D-025), straight under Node (no window): the Markdown reader (src/renderer/src/markdown/parse.ts), the elements the page
// makes from it (Markdown.tsx, bundled here with esbuild and rendered with react-dom/server), and the link rule of the main process.
// Run: node tools/verify-7-2.mjs
import { OUT, REPO, REPO_URL } from './paths.mjs'
import './ts-resolve.mjs'
import { checker } from './cdp.mjs'
import { createRequire } from 'node:module'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const check = checker()
const { parseMarkdown, parseChunk, splitChunks, safeHttpsUrl, LIMITS } = await import(`${REPO_URL}/src/renderer/src/markdown/parse.ts`)
const { isSafeExternalUrl } = await import(`${REPO_URL}/src/main/security.ts`)

// ---- a compact text form of the tree, so that an expectation can be read ----
const inl = (xs) => xs.map((x) => {
  switch (x.type) {
    case 'text': return JSON.stringify(x.text)
    case 'code': return '`' + x.text + '`'
    case 'strong': return '**[' + inl(x.children) + ']**'
    case 'em': return '*[' + inl(x.children) + ']*'
    case 'del': return '~~[' + inl(x.children) + ']~~'
    case 'link': return 'LINK<' + x.url + '>[' + inl(x.children) + ']'
    case 'br': return '<br>'
    default: return '??' + x.type
  }
}).join(' ')
const blk = (bs) => bs.map((x) => {
  switch (x.type) {
    case 'paragraph': return 'P[' + inl(x.children) + ']'
    case 'heading': return 'H' + x.level + '[' + inl(x.children) + ']'
    case 'code': return 'CODE(' + x.lang + ')' + JSON.stringify(x.text)
    case 'quote': return 'Q{' + blk(x.children) + '}'
    case 'list': return (x.ordered ? 'OL' + x.start : 'UL') + '{' + x.items.map((i) => '(' + blk(i) + ')').join(' ') + '}'
    case 'table': return 'TABLE(' + x.align.join(',') + ')[' + x.head.map(inl).join(' | ') + ' // ' + x.rows.map((r) => r.map(inl).join(' | ')).join(' // ') + ']'
    case 'rule': return 'HR'
    default: return '??' + x.type
  }
}).join('\n')
const md = (s) => blk(parseMarkdown(s))

const eq = (name, src, want) => {
  const got = md(src)
  check(name, got === want, got === want ? '' : `${JSON.stringify(src)}\n   got  ${JSON.stringify(got)}\n   want ${JSON.stringify(want)}`)
}
const para = (s) => md(s).replace(/^P\[|\]$/g, '')

// ---- inline ----
eq('bold', '**b**', 'P[**["b"]**]')
eq('bold with underscores', '__b__', 'P[**["b"]**]')
eq('em', '*e*', 'P[*["e"]*]')
eq('em with underscores', '_e_', 'P[*["e"]*]')
eq('both', '***x***', 'P[**[*["x"]*]**]')
eq('nested', '**a *b* c**', 'P[**["a " *["b"]* " c"]**]')
eq('strike', '~~x~~', 'P[~~["x"]~~]')
eq('one tilde is text', '~x~', 'P["~x~"]')
eq('snake_case is not emphasis', 'a snake_case_name here', 'P["a snake_case_name here"]')
eq('math stars are not emphasis', '2 * 3 * 4', 'P["2 * 3 * 4"]')
eq('a lone star', 'a * b', 'P["a * b"]')
eq('unclosed bold stays text', '**bold', 'P["**bold"]')
eq('unclosed em stays text', 'a *b', 'P["a *b"]')
eq('space after the opener is not emphasis', '* a*', 'UL{(P["a*"])}')
eq('four stars are text', '****x****', 'P["****x****"]')
eq('code span', 'a `b` c', 'P["a " `b` " c"]')
eq('code span keeps markdown', '`**x**`', 'P[`**x**`]')
eq('double-backtick code span with a backtick', '`` a`b ``', 'P[`a`b`]')
eq('unclosed backtick stays text', 'a `b', 'P["a `b"]')
eq('star inside a code span does not close emphasis', '*a `*` b*', 'P[*["a " `*` " b"]*]')
eq('escaped star', '\\*not\\*', 'P["*not*"]')
eq('escaped backtick', '\\`x\\`', 'P["`x`"]')
eq('backslash before a letter stays', 'a\\b', 'P["a\\\\b"]')
eq('hard break (two spaces)', 'a  \nb', 'P["a" <br> "b"]')
eq('hard break (backslash)', 'a\\\nb', 'P["a" <br> "b"]')
eq('soft break is kept as a newline', 'a\nb', 'P["a\\nb"]')
eq('raw html is text', '<b>x</b> <script>alert(1)</script>', 'P["<b>x</b> <script>alert(1)</script>"]')
eq('raw html cannot hide in emphasis', '*<img src=x onerror=alert(1)>*', 'P[*["<img src=x onerror=alert(1)>"]*]')
eq('entities are not decoded', '&lt;b&gt; &amp;', 'P["&lt;b&gt; &amp;"]')
eq('autolink brackets are text', '<https://example.com>', 'P["<https://example.com>"]')
eq('a bare address is not a link', 'see https://example.com now', 'P["see https://example.com now"]')

// ---- links ----
eq('https link', '[x](https://example.com/a?b=1#c)', 'P[LINK<https://example.com/a?b=1#c>["x"]]')
eq('link with a title', '[x](https://example.com "a title")', 'P[LINK<https://example.com/>["x"]]')
eq('link with emphasis in the text', '[**x**](https://example.com)', 'P[LINK<https://example.com/>[**["x"]**]]')
eq('link address with parentheses', '[x](https://en.wikipedia.org/wiki/A_(b))', 'P[LINK<https://en.wikipedia.org/wiki/A_(b)>["x"]]')
eq('uppercase scheme', '[x](HTTPS://EXAMPLE.com)', 'P[LINK<https://example.com/>["x"]]')
eq('the address is shown as new URL writes it (punycode host)', '[x](https://bücher.example/)', 'P[LINK<https://xn--bcher-kva.example/>["x"]]')
eq('empty link text shows the address', '[](https://example.com)', 'P[LINK<https://example.com/>["https://example.com/"]]')
for (const [name, url] of [
  ['http is not clickable', 'http://example.com'],
  ['javascript:', 'javascript:alert(1)'],
  ['JaVaScRiPt:', 'JaVaScRiPt:alert(1)'],
  ['data:', 'data:text/html,<b>x</b>'],
  ['file:', 'file:///c:/windows/system32/calc.exe'],
  ['mailto:', 'mailto:a@b.c'],
  ['ms-msdt:', 'ms-msdt:/id'],
  ['a relative address', '/relative'],
  ['a scheme-less host', 'example.com'],
  ['credentials', 'https://user:pass@example.com/'],
  ['a user name only', 'https://user@example.com/'],
  ['a password only', 'https://:pass@example.com/'],
  ['https: without slashes', 'https:example.com'],
  ['one slash', 'https:/example.com'],
  ['no host', 'https://'],
  ['a backslash', 'https://example.com\\@evil.com/'],
  ['an angle bracket', 'https://example.com/<x>'],
  ['a quote', 'https://example.com/"x'],
  ['a control character', 'https://example.com/\u0001x'],
  ['a tab', 'https://example.com/\tx'],
  ['a no-break space (U+0085)', 'https://example.com/\u0085x'],
  ['too long', 'https://example.com/' + 'a'.repeat(LIMITS.maxLinkChars)],
  ['a space in the host', 'https://exa mple.com']
]) {
  const got = md(`[x](${url})`)
  check(`not a link: ${name}`, !got.includes('LINK') && (name === 'a space in the host' || got.includes('x')), got.slice(0, 160))
}
eq('image is text, never a link', '![alt](https://example.com/a.png)', 'P["![alt](https://example.com/a.png)"]')
eq('image with a bad address is text too', '![alt](javascript:x)', 'P["![alt](javascript:x)"]')
eq('a link inside a link is text', '[a [b](https://one.example)](https://two.example)', 'P[LINK<https://two.example/>["a [b](https://one.example)"]]')
eq('reference-style links are text', '[x][1]\n\n[1]: https://example.com', 'P["[x][1]"]\nP["[1]: https://example.com"]')
check('safeHttpsUrl returns what new URL writes', safeHttpsUrl('https://Example.com:443/a b'.replace(' ', '%20')) === 'https://example.com/a%20b')
// safeHttpsUrl called by itself (the link reader bounds the address first, so a link alone cannot show this layer)
check('safeHttpsUrl: an address longer than the limit is refused on its own', safeHttpsUrl('https://example.com/' + 'a'.repeat(LIMITS.maxLinkChars)) === null && safeHttpsUrl('https://example.com/' + 'a'.repeat(100)) !== null)
check('safeHttpsUrl: http, ftp and credentials are refused on their own', ['http://example.com/', 'ftp://example.com/', 'https://u:p@example.com/', 'https://:p@example.com/'].every((u) => safeHttpsUrl(u) === null))
check('safeHttpsUrl on junk returns null', [null, undefined, 5, {}].every((v) => { try { return safeHttpsUrl(String(v)) === null } catch { return false } }))

// ---- blocks ----
eq('headings 1 to 6', '# a\n## b\n### c\n#### d\n##### e\n###### f', 'H1["a"]\nH2["b"]\nH3["c"]\nH4["d"]\nH5["e"]\nH6["f"]')
eq('seven hashes is a paragraph', '####### a', 'P["####### a"]')
eq('a hashtag is not a heading', '#hash', 'P["#hash"]')
eq('closing hashes are dropped', '## Title ##', 'H2["Title"]')
eq('heading with emphasis', '# **a** b', 'H1[**["a"]** " b"]')
eq('empty heading', '#', 'H1[]')
eq('rules', '---\n***\n___\n- - -', 'HR\nHR\nHR\nHR')
eq('two dashes are text', '--', 'P["--"]')
eq('fenced code with a language', '```python\nprint(1)\n```', 'CODE(python)"print(1)"')
eq('fenced code keeps markdown and html', '```\n**x** <b>\n```', 'CODE(null)"**x** <b>"')
eq('fenced code keeps blank lines and indentation', '```\na\n\n  b\n```', 'CODE(null)"a\\n\\n  b"')
eq('tilde fence', '~~~js\nx\n~~~', 'CODE(js)"x"')
eq('a longer fence holds a shorter one', '````\n```\nx\n```\n````', 'CODE(null)"```\\nx\\n```"')
eq('unclosed fence runs to the end', 'a\n\n```js\nx\ny', 'P["a"]\nCODE(js)"x\\ny"')
eq('language with odd characters is dropped', '```<script>alert(1)</script>\nx\n```', 'CODE(null)"x"')
eq('a long language is dropped', '```' + 'a'.repeat(40) + '\nx\n```', 'CODE(null)"x"')
eq('indented code (how replies were written before)', 'text\n\n    code a\n    code b\n\nafter', 'P["text"]\nCODE(null)"code a\\ncode b"\nP["after"]')
eq('an indented line inside a paragraph is part of it', 'a\n    b', 'P["a\\nb"]')
eq('quote', '> a\n> b', 'Q{P["a\\nb"]}')
eq('quote with a list and code', '> - x\n> ```\n> c\n> ```', 'Q{UL{(P["x"])}\nCODE(null)"c"}')
eq('nested quote', '> a\n>> b', 'Q{P["a"]\nQ{P["b"]}}')
eq('bullets', '- a\n- b\n- c', 'UL{(P["a"]) (P["b"]) (P["c"])}')
eq('stars and pluses are bullets too', '* a\n+ b', 'UL{(P["a"])}\nUL{(P["b"])}')
eq('ordered list keeps its first number', '3. a\n4. b', 'OL3{(P["a"]) (P["b"])}')
eq('ordered with a bracket', '1) a\n2) b', 'OL1{(P["a"]) (P["b"])}')
eq('a list interrupts a paragraph', 'Here:\n- a\n- b', 'P["Here:"]\nUL{(P["a"]) (P["b"])}')
eq('a number other than 1 does not interrupt a paragraph', 'In the year\n2024. it was', 'P["In the year\\n2024. it was"]')
eq('nested bullets (two spaces)', '- a\n  - b\n  - c\n- d', 'UL{(P["a"]\nUL{(P["b"]) (P["c"])}) (P["d"])}')
eq('nested under an ordered item (three spaces)', '1. a\n   - b\n2. c', 'OL1{(P["a"]\nUL{(P["b"])}) (P["c"])}')
eq('nested under an ordered item (four spaces)', '1. a\n    - b\n2. c', 'OL1{(P["a"]\nUL{(P["b"])}) (P["c"])}')
eq('code inside an item', '1. a\n\n   ```sh\n   x\n   ```\n\n2. b', 'OL1{(P["a"]\nCODE(sh)"x")}\nOL2{(P["b"])}')
eq('a lazy continuation line', '- a\nb', 'UL{(P["a\\nb"])}')
eq('a loose list is read per item', '- a\n\n- b', 'UL{(P["a"])}\nUL{(P["b"])}')
eq('a paragraph in an item', '- a\n\n  more\n- b', 'UL{(P["a"]\nP["more"]) (P["b"])}')
eq('a different marker starts a new list', '- a\n* b', 'UL{(P["a"])}\nUL{(P["b"])}')
eq('a bold line is not a list', '**a** b', 'P[**["a"]** " b"]')
eq('a number with a dot but no space is text', '1.5 is a number', 'P["1.5 is a number"]')
eq('a negative number is text', '-5 degrees', 'P["-5 degrees"]')
eq('an empty item', '-\n- b', 'UL{() (P["b"])}')
eq('table', '| a | b |\n|---|:-:|\n| 1 | **2** |', 'TABLE(,center)["a" | "b" // "1" | **["2"]**]')
eq('table alignments', '|a|b|c|\n|:--|--:|:-:|\n|1|2|3|', 'TABLE(left,right,center)["a" | "b" | "c" // "1" | "2" | "3"]')
eq('table without outer pipes', 'a | b\n--- | ---\n1 | 2', 'TABLE(,)["a" | "b" // "1" | "2"]')
eq('table, an escaped pipe stays in its cell', '| a | b |\n|---|---|\n| x \\| y | z |', 'TABLE(,)["a" | "b" // "x | y" | "z"]')
eq('table, a short row is padded and a long one cut', '| a | b |\n|---|---|\n| 1 |\n| 1 | 2 | 3 |', 'TABLE(,)["a" | "b" // "1" |  // "1" | "2"]')
eq('table ends at a blank line', '| a |\n|---|\n| 1 |\n\ntext', 'TABLE()["a" // "1"]\nP["text"]')
eq('pipes without a delimiter row are text', 'a | b\nc | d', 'P["a | b\\nc | d"]')
eq('a table can follow a paragraph line', 'text\n| a |\n|---|\n| 1 |', 'P["text"]\nTABLE()["a" // "1"]')
eq('a header with a different width is not a table', '| a | b |\n|---|', 'P["| a | b |\\n|---|"]')
check('too many columns is not a table', !md('|' + 'a|'.repeat(LIMITS.maxTableColumns + 1) + '\n|' + '-|'.repeat(LIMITS.maxTableColumns + 1)).includes('TABLE'))
{
  const rows = Array.from({ length: LIMITS.maxTableRows + 5 }, (_, i) => `| ${i} |`).join('\n')
  const out = parseMarkdown('| a |\n|---|\n' + rows)
  check('a table holds at most maxTableRows rows, the rest is kept as text', out[0].type === 'table' && out[0].rows.length === LIMITS.maxTableRows && out.length === 2, `${out.length} blocks, ${out[0].rows?.length} rows`)
}
eq('a block start ends a paragraph', 'a\n# b\nc\n---\nd\n> e\nf', 'P["a"]\nH1["b"]\nP["c"]\nHR\nP["d"]\nQ{P["e"]}\nP["f"]')
eq('windows line endings', 'a\r\n\r\n```\r\nx\r\n```\r\n', 'P["a"]\nCODE(null)"x"')
eq('tabs are indentation', '-\ta\n\t- b', 'UL{(P["a"]\nUL{(P["b"])})}')
eq('...but inside a fenced block a tab stays a tab (Go, Makefiles; Copy promises the same characters)', '```go\nfunc f() {\n\treturn\n\t\tx   \n}\n```', 'CODE(go)"func f() {\\n\\treturn\\n\\t\\tx   \\n}"')
eq('...also in a fence that is never closed (a reply still arriving)', '```\n\tx', 'CODE(null)"\\tx"')
eq('...and after the fence is closed tabs are indentation again', '```\nx\n```\n\n-\ta\n\t- b', 'CODE(null)"x"\nUL{(P["a"]\nUL{(P["b"])})}')
eq('indented code (four spaces or a tab) is still read', '\tcode\n\n    more', 'CODE(null)"code\\n\\nmore"')
eq('a NUL byte is replaced', 'a\u0000b', 'P["a\uFFFDb"]')
eq('empty text', '', '')
eq('only blank lines', '\n\n  \n', '')

// ---- the pieces (what the page keeps while a reply streams) ----
{
  const doc = '# T\n\nPara one\ncontinues\n\n```js\nx\n\ny\n```\n\n- a\n- b\n  - c\n\nA | B\n--- | ---\n1 | 2\n\n> q\n\nend'
  check('reading the pieces one by one equals reading the whole', JSON.stringify(parseMarkdown(doc)) === JSON.stringify(parseChunk(doc)), splitChunks(doc).length + ' pieces')
  check('...and there are several pieces', splitChunks(doc).length === 7, JSON.stringify(splitChunks(doc)))
  const open = '```js\nx\n\n\ny'
  check('a blank line inside a fence does not cut it', splitChunks(open).length === 1)
  check('an indented line after a blank line stays with the item above', splitChunks('- a\n\n  b\n\n- c').length === 2)
  let prefixesOk = true
  for (let n = 1; n <= doc.length; n += 7) {
    const head = doc.slice(0, n)
    const a = splitChunks(head)
    const b = splitChunks(doc)
    // every finished piece of a shorter text is a piece of the longer one (so the page's cache of finished pieces stays valid)
    for (let k = 0; k < a.length - 1; k++) if (a[k] !== b[k]) prefixesOk = false
  }
  check('the finished pieces of a growing text do not change', prefixesOk)
}

// ---- hostile text: bounded work, no throw ----
const timed = (name, text, maxMs = 1500) => {
  const t0 = performance.now()
  let ok = true
  let err = ''
  try { parseMarkdown(text) } catch (e) { ok = false; err = String(e) }
  const ms = performance.now() - t0
  check(`${name} (${(text.length / 1000).toFixed(0)} KB) is read in under ${maxMs} ms, without throwing`, ok && ms < maxMs, `${ms.toFixed(0)} ms ${err}`)
  return ms
}
const KB = 64000
timed('50,000 nested quotes', '>'.repeat(50000) + ' x')
timed('quote lines, deep', Array.from({ length: 3000 }, (_, i) => '>'.repeat(i % 300 + 1) + ' x').join('\n'))
timed('nested lists, 300 deep', Array.from({ length: 300 }, (_, i) => ' '.repeat(i * 2) + '- x').join('\n'))
timed('nested lists, 64 KB, indentation going up and down', Array.from({ length: 6000 }, (_, i) => ' '.repeat((i % 20) * 2) + '- x').join('\n'))
timed('an unmatched star every 3 characters', '*a '.repeat(KB / 3))
timed('an unmatched underscore every 3 characters', '_a '.repeat(KB / 3))
timed('an unmatched backtick every 2 characters', '`a'.repeat(KB / 2))
timed('backtick runs of growing length', Array.from({ length: 400 }, (_, i) => '`'.repeat(i + 1) + 'x').join(' '))
timed('open brackets', '['.repeat(KB))
timed('open brackets and parentheses', '[a](' .repeat(KB / 4))
timed('links, all unfinished', '[a](https://a.example '.repeat(KB / 22))
timed('images, all unfinished', '![a](https://a.example '.repeat(KB / 23))
timed('an open emphasis then many closers that do not match', '**a ' + '*b'.repeat(KB / 2))
timed('tildes', '~~a '.repeat(KB / 4))
timed('one line of spaces after a heading mark', '# a' + ' '.repeat(KB))
timed('one line of tabs', 'a' + '\t'.repeat(KB) + 'b')
timed('a heading with many closing hashes', '# a ' + '# '.repeat(KB / 2))
timed('a rule with a lot of spaces', '-' + ' -'.repeat(KB / 2))
timed('a wide table', ('|' + 'a|'.repeat(19) + '\n').repeat(1) + ('|' + '-|'.repeat(19) + '\n') + ('|' + 'x|'.repeat(19) + '\n').repeat(1500))
timed('a table of pipes', '|'.repeat(KB))
timed('5,000 columns', '|' + 'a|'.repeat(5000) + '\n|' + '-|'.repeat(5000) + '\n')
timed('fences opened and never closed', '```a\n'.repeat(KB / 5))
timed('many one-line paragraphs', 'a\n\n'.repeat(KB / 3))
timed('lines made of block starts', '# \n> \n- \n1. \n---\n```\n'.repeat(KB / 25))
timed('a single 64 KB line of plain text', 'word '.repeat(KB / 5))
timed('a 64 KB line of block-start characters', '-'.repeat(KB))
timed('a 64 KB line of hashes', '#'.repeat(KB))
timed('a 64 KB line of digits and dots', '1.'.repeat(KB / 2))
timed('unicode', '😀\u202e\u200b'.repeat(KB / 4))

// the budget: past it, the rest is plain text, never a missing piece
{
  const text = '*a '.repeat(30000)
  const out = parseMarkdown(text)
  const flat = JSON.stringify(out)
  check('past the work limit nothing is lost: the text is still all there', out.length >= 1 && flat.replace(/[^*a ]/g, '').length >= 0 && (flat.match(/a/g) ?? []).length >= 30000, String((flat.match(/a/g) ?? []).length))
}

// ---- fuzz: random text over the characters that matter ----
{
  const ALPHABET = ['*', '_', '~', '`', '[', ']', '(', ')', '!', '<', '>', '#', '-', '+', '.', '1', '2', '|', ':', '\\', '"', "'", ' ', ' ', '\n', '\n', '\t', 'a', 'b', 'https://x.example/', 'javascript:', '&', '=', '  \n', '```', '> ', '- ', '1. ', '| a |\n|---|\n']
  let seed = 12345
  const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32 }
  const KNOWN_INLINE = new Set(['text', 'code', 'strong', 'em', 'del', 'link', 'br'])
  const KNOWN_BLOCK = new Set(['paragraph', 'heading', 'code', 'quote', 'list', 'table', 'rule'])
  let bad = ''
  let worst = 0
  const walkInline = (xs) => {
    if (!Array.isArray(xs)) return (bad ||= 'inline list is not an array')
    for (const x of xs) {
      if (!KNOWN_INLINE.has(x.type)) bad ||= 'unknown inline ' + x.type
      if (x.type === 'text' && (typeof x.text !== 'string' || x.text === '')) bad ||= 'bad text node'
      if (x.type === 'link' && safeHttpsUrl(x.url) !== x.url) bad ||= 'unsafe link ' + x.url
      if (x.children) walkInline(x.children)
    }
  }
  const walkBlock = (bs) => {
    for (const x of bs) {
      if (!KNOWN_BLOCK.has(x.type)) bad ||= 'unknown block ' + x.type
      if (x.type === 'paragraph' || x.type === 'heading') walkInline(x.children)
      if (x.type === 'quote') walkBlock(x.children)
      if (x.type === 'list') { if (!Number.isInteger(x.start) || x.start < 0) bad ||= 'bad list start'; x.items.forEach(walkBlock) }
      if (x.type === 'table') { x.head.forEach(walkInline); x.rows.forEach((r) => { if (r.length !== x.head.length) bad ||= 'ragged table'; r.forEach(walkInline) }) }
      if (x.type === 'code' && typeof x.text !== 'string') bad ||= 'bad code'
    }
  }
  const N = 6000
  for (let n = 0; n < N && !bad; n++) {
    let s = ''
    const len = 1 + Math.floor(rand() * 200)
    for (let k = 0; k < len; k++) s += ALPHABET[Math.floor(rand() * ALPHABET.length)]
    const t0 = performance.now()
    try { walkBlock(parseMarkdown(s)) } catch (e) { bad = 'threw on ' + JSON.stringify(s) + ': ' + e }
    worst = Math.max(worst, performance.now() - t0)
    if (bad) bad += ' | input ' + JSON.stringify(s)
  }
  check(`fuzz: ${N} random texts over the characters that matter: never throws, only known kinds, every link passes safeHttpsUrl again, tables are rectangular`, bad === '', bad)
  check('fuzz: the slowest of them took under 50 ms', worst < 50, worst.toFixed(1) + ' ms')
}

// ---- the main process lets only https addresses through (isSafeExternalUrl) ----
for (const [url, want] of [
  ['https://example.com/', true],
  ['https://example.com:8443/a?b=c#d', true],
  ['HTTPS://EXAMPLE.COM', true],
  ['http://example.com/', false],
  ['https://user:pass@example.com/', false],
  ['https://user@example.com/', false],
  ['file:///c:/windows/system32/calc.exe', false],
  ['javascript:alert(1)', false],
  ['ms-msdt:/id', false],
  ['mailto:a@b.c', false],
  ['data:text/html,x', false],
  ['about:blank', false],
  ['//example.com', false],
  ['example.com', false],
  ['', false],
  ['https:', false],
  ['not a url', false]
]) {
  check(`isSafeExternalUrl(${JSON.stringify(url)}) is ${want}`, isSafeExternalUrl(url) === want)
}
check('isSafeExternalUrl never throws on junk', [undefined, null, 5, {}, [], 'https://[', 'https://%'].every((v) => { try { return isSafeExternalUrl(v) === false } catch { return false } }))

// ---- the elements the page makes: a closed set, and no way in for HTML ----
// Markdown.tsx is bundled with esbuild (it is already in node_modules as part of the build tool; this is test tooling only) and
// rendered with react-dom/server. Everything React writes is then read back and held to a list of tags, attributes and classes.
// React, the server renderer and the component go into ONE bundle (two copies of React would not share their hooks), made inside
// tools/.out, where the bundler finds the repo's node_modules.
const work = join(OUT, 'md72')
let render
try {
  const esbuild = createRequire(`${REPO}/package.json`)('esbuild')
  mkdirSync(work, { recursive: true })
  writeFileSync(
    join(work, 'entry.jsx'),
    `import { createElement } from 'react'\nimport { renderToStaticMarkup } from 'react-dom/server'\nimport Markdown from '${REPO}/src/renderer/src/markdown/Markdown.tsx'\nexport const render = (text) => renderToStaticMarkup(createElement(Markdown, { text }))\n`
  )
  await esbuild.build({
    entryPoints: [join(work, 'entry.jsx')],
    bundle: true,
    format: 'cjs',
    platform: 'node',
    jsx: 'automatic',
    outfile: join(work, 'bundle.cjs'),
    logLevel: 'silent'
  })
  render = createRequire(import.meta.url)(join(work, 'bundle.cjs')).render
} catch (error) {
  check('Markdown.tsx can be bundled and rendered under Node', false, String(error?.stack ?? error).slice(0, 500))
}

if (render) {
  const TAGS = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'strong', 'em', 'del', 'code', 'pre', 'blockquote', 'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'hr', 'br', 'div', 'span', 'button'])
  const ATTRS = new Set(['class', 'start', 'title', 'type'])
  const CLASSES = new Set(['md-heading', 'md-code', 'md-codeblock', 'md-codeblock-head', 'md-codeblock-lang', 'md-copy', 'md-pre', 'md-table-wrap', 'md-table', 'md-align-left', 'md-align-center', 'md-align-right', 'md-link'])
  const decode = (s) => s.replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
  // Everything in React's output that is not escaped text is a tag. Returns what is wrong with the markup, or ''.
  const problemsIn = (html) => {
    const tag = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:\s+[^\s=>]+(?:="[^"]*")?)*)\s*\/?>/g
    let rest = html.replace(tag, (whole, close, name, attrs) => {
      if (!TAGS.has(name)) return `\u0000BADTAG:${name}\u0000`
      for (const a of attrs.matchAll(/\s+([^\s=>]+)(?:="([^"]*)")?/g)) {
        if (!ATTRS.has(a[1])) return `\u0000BADATTR:${name}.${a[1]}\u0000`
        if (a[1] === 'class' && !a[2].split(' ').every((c) => CLASSES.has(c))) return `\u0000BADCLASS:${a[2]}\u0000`
        if (a[1] === 'type' && (name !== 'button' || a[2] !== 'button')) return `\u0000BADTYPE:${name}\u0000`
        if (a[1] === 'start' && (name !== 'ol' || !/^\d{1,9}$/.test(a[2]))) return `\u0000BADSTART\u0000`
        if (a[1] === 'title' && (name !== 'button' || safeHttpsUrl(decode(a[2])) !== decode(a[2]))) return `\u0000BADTITLE:${a[2]}\u0000`
      }
      return ''
    })
    const bad = rest.match(/\u0000[A-Z]+[^\u0000]*\u0000/)
    if (bad) return bad[0]
    if (/[<>]/.test(rest)) return 'an unescaped < or > is left in the text: ' + rest.match(/.{0,30}[<>].{0,30}/)[0]
    return ''
  }

  const one = render('# T\n\ntext **b** *i* `c` ~~d~~ [l](https://example.com/x)\n\n- a\n- b\n\n3. c\n\n| a | b |\n|:-:|--:|\n| 1 | 2 |\n\n> q\n\n---\n\n```py\nx = 1\n```')
  check('a document of every kind renders to nothing but allowed tags, attributes and classes', problemsIn(one) === '', problemsIn(one) + '\n' + one.slice(0, 600))
  check('...a heading, a table, a code block with its Copy button, a link as a button with the address as its tooltip', /<h1 class="md-heading">T<\/h1>/.test(one) && /<table class="md-table">/.test(one) && /<div class="md-codeblock">/.test(one) && /<button type="button" class="md-copy">Copy<\/button>/.test(one) && /<button type="button" class="md-link" title="https:\/\/example.com\/x">l<\/button>/.test(one))
  check('...an ordered list that does not start at 1 says where it starts', /<ol start="3">/.test(one))
  check('...a link has no href, and nothing has src, style or an event handler', !/\bhref=|\bsrc=|\bstyle=|\bon[a-z]+=|dangerouslySetInnerHTML/i.test(one))
  check('...table cells carry their alignment as a class, never as a style', /<th class="md-align-center">a<\/th>/.test(one) && /<td class="md-align-right">2<\/td>/.test(one))

  const attacks = [
    '<script>alert(1)</script>',
    '<img src=x onerror=alert(1)>',
    '<a href="javascript:alert(1)">x</a>',
    '<iframe src="https://evil.example"></iframe>',
    '<style>*{display:none}</style>',
    '<svg onload=alert(1)>',
    '"><script>alert(1)</script>',
    '[x](javascript:alert(1))',
    '[x](data:text/html,<script>alert(1)</script>)',
    '[x](https://example.com" onclick="alert(1))',
    '[x](https://example.com/"onmouseover="alert(1))',
    '![x](https://example.com/a.png)',
    '![x](x" onerror="alert(1))',
    '```" onclick="alert(1)\nx\n```',
    '```<img src=x onerror=alert(1)>\nx\n```',
    '| <b>a</b> | <img src=x> |\n|---|---|\n| <script> | </table><script> |',
    '# <script>\n> <img src=x onerror=1>\n- <iframe>\n1. <svg/onload=1>',
    '`<script>`  **<img onerror=1>**  *<b>*  ~~<i>~~',
    '[<img src=x onerror=1>](https://example.com)',
    '[a](https://example.com "<script>")',
    '&lt;script&gt;alert(1)&lt;/script&gt;',
    '\u202e<script>\u200b</script>'
  ]
  const badAttacks = attacks.filter((a) => problemsIn(render(a)) !== '')
  check(`${attacks.length} attack texts (script, img, a, iframe, style, svg, handlers, javascript: and data: links, attribute breakouts) render to nothing outside the allowed set`, badAttacks.length === 0, badAttacks.join(' || '))
  check('...the attack text itself is still there, as text', render('<script>alert(1)</script>') === '<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>', render('<script>alert(1)</script>'))
  check('...a title with a quote in it cannot break out of its attribute (the address is refused before it gets that far)', !render('[x](https://example.com/"onmouseover="alert(1))').includes('<button'), render('[x](https://example.com/"onmouseover="alert(1))'))
  check('...a link whose text is a different address still shows only its own (the dialog is what tells them apart)', /title="https:\/\/real.example\/"/.test(render('[https://bank.example](https://real.example/)')))

  // fuzz: random texts over the characters that matter, rendered and held to the same list
  {
    const ALPHABET = ['*', '_', '~', '`', '[', ']', '(', ')', '!', '<', '>', '#', '-', '+', '.', '1', '|', ':', '\\', '"', "'", ' ', '\n', '\n', 'a', 'https://x.example/', 'javascript:', '&', '=', '  \n', '```', '> ', '- ', '1. ', '| a |\n|---|\n', '<b>', '</b>', 'onerror=', '<img src=x ', '&lt;', '&amp;']
    let seed = 777
    const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32 }
    let bad = ''
    const N = 3000
    for (let n = 0; n < N && !bad; n++) {
      let s = ''
      const len = 1 + Math.floor(rand() * 160)
      for (let k = 0; k < len; k++) s += ALPHABET[Math.floor(rand() * ALPHABET.length)]
      let html
      try { html = render(s) } catch (e) { bad = 'threw: ' + e + ' on ' + JSON.stringify(s); break }
      const p = problemsIn(html)
      if (p) bad = `${p} on ${JSON.stringify(s)} -> ${html.slice(0, 300)}`
    }
    check(`fuzz: ${N} random texts rendered: only allowed tags, attributes and classes, every title an https address, no unescaped < or >, never throws`, bad === '', bad)
  }
  const t0 = performance.now()
  render('word **bold** `code` [l](https://example.com) \n\n'.repeat(1500))
  const ms = performance.now() - t0
  check('a 60 KB reply with 1,500 paragraphs renders in under 2 s', ms < 2000, ms.toFixed(0) + ' ms')
}
rmSync(work, { recursive: true, force: true })

process.exit(check.summary() ? 0 : 1)
