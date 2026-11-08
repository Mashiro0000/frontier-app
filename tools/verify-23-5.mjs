// Stage 23.5 (D-055), the code colourer under plain Node (src/renderer/src/markdown/colour.ts): the pieces always join back to exactly the text (for every
// language it knows and for awkward text), the tones on known samples (a comment, a string, a number, a keyword; a keyword inside a string or a comment
// stays theirs), case-blind languages, and an unknown language or none left plain. Then the source: pieces are rendered as text, never as markup.
// usage: node tools/verify-23-5.mjs
import './ts-resolve.mjs'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { checker } from './cdp.mjs'
import { REPO_URL } from './paths.mjs'

const check = checker()
const { colourCode } = await import(`${REPO_URL}/src/renderer/src/markdown/colour.ts`)
const tones = (text, lang) => (colourCode(text, lang) ?? []).filter((p) => p.tone !== null).map((p) => `${p.tone}:${p.text}`)
const BS = String.fromCharCode(92)

check('A: no language, or one it does not know: null (the block stays plain)', colourCode('const x = 1', null) === null && colourCode('const x = 1', 'brainfuck') === null && colourCode('x', '') === null)
const LANGS = ['js', 'TypeScript', 'tsx', 'python', 'py', 'json', 'css', 'bash', 'sh', 'powershell', 'sql', 'go', 'rust', 'java', 'c', 'cpp']
const AWKWARD = [
  '', ' ', '\n\n', 'const s = "unclosed', "it's", '`multi\nline`', '/* never closed', 'a // b /* c */ "d" \'e\' 1.5e-3 0xFF',
  `"esc ${BS}" still in" after`, '#!/bin/bash\necho "$HOME" # done', 'SELECT * FROM t -- x\nWHERE a = \'b\'', 'emoji 😀 and 中文', 'x'.repeat(5000), '"' + 'y'.repeat(3000)
]
let lossless = true
for (const lang of LANGS) for (const text of AWKWARD) {
  const pieces = colourCode(text, lang)
  if (pieces === null || pieces.map((p) => p.text).join('') !== text || pieces.some((p) => p.text === '')) { lossless = false; console.log(`  lost text: ${lang} ${JSON.stringify(text.slice(0, 40))}`) }
}
check(`A: the pieces join back to exactly the text, with no empty piece (${LANGS.length} languages x ${AWKWARD.length} texts)`, lossless)

check('B: JavaScript: keyword, number, string, line comment', JSON.stringify(tones('const n = 42 // the answer\nlet s = "hi"', 'js')) === JSON.stringify(['keyword:const', 'number:42', 'comment:// the answer', 'keyword:let', 'string:"hi"']), JSON.stringify(tones('const n = 42 // the answer\nlet s = "hi"', 'js')))
check('B: a keyword inside a string or a comment is not coloured as one', JSON.stringify(tones('"return if" /* for while */', 'ts')) === JSON.stringify(['string:"return if"', 'comment:/* for while */']))
check('B: a word that only holds a keyword is not one (constant, format)', tones('constant format', 'js').length === 0)
check('B: an escaped quote does not end a string', JSON.stringify(tones(`"a${BS}"b" x`, 'js')) === JSON.stringify([`string:"a${BS}"b"`]))
check('B: Python: def, a # comment, True', JSON.stringify(tones('def f(): return True  # yes', 'python')) === JSON.stringify(['keyword:def', 'keyword:return', 'keyword:True', 'comment:# yes']))
check('B: JS has no # comments (a private field stays plain)', tones('this.#x = 1', 'js').every((t) => !t.startsWith('comment')))
check('B: SQL is case-blind (SELECT, select) and -- is its comment', JSON.stringify(tones('SELECT a from t -- note', 'sql')) === JSON.stringify(['keyword:SELECT', 'keyword:from', 'comment:-- note']))
check('B: JSON: strings, numbers, true/false/null', JSON.stringify(tones('{"a": 1.5, "b": true, "c": null}', 'json')) === JSON.stringify(['string:"a"', 'number:1.5', 'string:"b"', 'keyword:true', 'string:"c"', 'keyword:null']))
check('B: a hex number', JSON.stringify(tones('x = 0xFF', 'c')) === JSON.stringify(['number:0xFF']))
check('B: a backtick string runs across lines', JSON.stringify(tones('`a\nb`', 'js')) === JSON.stringify(['string:`a\nb`']))
check('B: the language is matched in any case (JS, Python)', tones('const a', 'JS').length === 1 && tones('def f', 'Python').length === 1)
const t0 = Date.now()
colourCode(('const a = "x" // y\n').repeat(20000), 'js')
check('B: 20,000 lines are coloured in well under a second', Date.now() - t0 < 1000, `${Date.now() - t0} ms`)

const block = readFileSync(fileURLToPath(`${REPO_URL}/src/renderer/src/markdown/CodeBlock.tsx`), 'utf8')
check('C: the pieces are shown as text in spans (no innerHTML anywhere in the block)', !/dangerouslySetInnerHTML|innerHTML/.test(block) && /className=\{`tok-\$\{piece\.tone\}`\}/.test(block))
check('C: Copy still copies the text as it came', block.includes('onClick={() => copy(text)}'))

process.exit(check.summary() ? 0 : 1)
