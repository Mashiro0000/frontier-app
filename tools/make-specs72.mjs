// Writes the negative-control specs for slice 7.2 (Markdown, D-025): one sabotage each, which the suite named must notice.
// usage: node tools/make-specs72.mjs
//   then: node tools/nc-all.mjs specs72 <names...>     (plain-Node suites: verify-7-2.mjs, provider-node-test-5.mjs)
//         node tools/nc-all.mjs specs72w <names...>    (the real window: verify-7-2w.mjs; opens a window per sabotage)
// Each spec backs up the file, applies ONE sabotage, runs the suite, and puts the file back (proved by hash).
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { TOOLS } from './paths.mjs'
import { scratch } from './drive.mjs'

const S = '{{REPO}}/src'
const P = `${S}/renderer/src/markdown/parse.ts`, M = `${S}/renderer/src/markdown/Markdown.tsx`, C = `${S}/renderer/src/markdown/CodeBlock.tsx`
const L = `${S}/renderer/src/markdown/LinkConfirm.tsx`, B = `${S}/renderer/src/chat/MessageBubble.tsx`, CSS = `${S}/renderer/src/assets/main.css`
const SEC = `${S}/main/security.ts`, REQ = `${S}/main/providers/request.ts`

// ---- the plain-Node suite: [file, from, to] (a list of edits where one sabotage needs several) ----
const node = {
  'url-accepts-http': [[P, '!/^https:\\/\\//i.test(raw)', '!/^https?:\\/\\//i.test(raw)']],
  'url-accepts-a-user-name': [[P, "url.username !== '' ||", '']],
  'url-accepts-a-password': [[P, "url.password !== '' ||", '']],
  'url-control-characters-unchecked': [[P, '  if (/[\\x00-\\x20\\x7f-\\x9f\\\\<>"]/.test(raw)) return null', '']],
  'url-length-unchecked': [[P, 'raw.length > LIMITS.maxLinkChars || ', '']],
  'link-address-unchecked': [[P, 'const url = link ? safeHttpsUrl(link.address) : null', 'const url = link ? link.address : null']],
  'image-becomes-a-link': [[P, "if (c === '!' && s[i + 1] === '[') {", 'if (false) {']],
  'link-inside-a-link': [[P, "if (c === '[' && !inLink) {", "if (c === '[') {"]],
  'nesting-uncapped': [[P, 'const nesting = depth < LIMITS.maxDepth', 'const nesting = true']],
  'table-rows-uncapped': [[P, 'while (i < lines.length && rows.length < LIMITS.maxTableRows) {', 'while (i < lines.length) {']],
  'table-columns-uncapped': [[P, 'align.length > LIMITS.maxTableColumns', 'false']],
  'table-pipe-escape-ignored': [[P, "if (c === '\\\\' && t[k + 1] === '|') {", 'if (false) {']],
  'language-unchecked': [[P, 'return /^[A-Za-z0-9_+#.-]{1,30}$/.test(word) ? word : null', 'return word']],
  'soft-break-lost': [[P, "text = text.replace(/ +$/, '') + '\\n'", "text = text.replace(/ +$/, '') + ' '"]],
  'tabs-in-code-expanded': [[P, '      if (closesFence(line, open)) open = null\n      return line', '      if (closesFence(line, open)) open = null\n      return expandIndent(line)']],
  'no-work-budget': [[P, 'const budget: Budget = { left: LIMITS.stepsFloor + source.length * LIMITS.stepsPerChar }', 'const budget: Budget = { left: Infinity }']],
  'link-scan-unbounded-and-free': [
    [P, 'const limit = Math.min(s.length, at + LIMITS.maxLabelChars + 2)', 'const limit = s.length'],
    [P, 'const urlLimit = Math.min(s.length, from + LIMITS.maxLinkChars + 2)', 'const urlLimit = s.length'],
    [P, '  b.left -= (found?.end ?? Math.min(s.length, at + LIMITS.maxLabelChars + LIMITS.maxLinkChars)) - at', '']
  ],
  'link-scan-unbounded-alone': [
    [P, 'const limit = Math.min(s.length, at + LIMITS.maxLabelChars + 2)', 'const limit = s.length'],
    [P, 'const urlLimit = Math.min(s.length, from + LIMITS.maxLinkChars + 2)', 'const urlLimit = s.length']
  ],
  'element-with-a-style': [[M, '<button type="button" className="md-link" title={url} onClick={() => openLink(url)}>', '<button type="button" className="md-link" title={url} style={{ color: "red" }} onClick={() => openLink(url)}>']],
  'text-as-html': [[M, '      return <>{node.text}</>', '      return <span dangerouslySetInnerHTML={{ __html: node.text }} />']],
  'cell-with-a-style': [[M, '<th key={i} className={alignClass(block.align[i])}>', '<th key={i} style={{ textAlign: block.align[i] ?? undefined }}>']],
  'external-allows-http': [[SEC, "return protocol === 'https:' && username === '' && password === ''", "return (protocol === 'https:' || protocol === 'http:') && username === '' && password === ''"]],
  'external-allows-credentials': [[SEC, "return protocol === 'https:' && username === '' && password === ''", "return protocol === 'https:'"]],
  'external-allows-any-scheme': [[SEC, "return protocol === 'https:' && username === '' && password === ''", 'return protocol !== "x:"']],
  'prompt-says-plain-text': [[REQ, "'The window renders Markdown, so you may use it where it helps:", "'The window shows plain text, so use it where it helps:"]]
}
const dir = join(TOOLS, 'specs72')
mkdirSync(dir, { recursive: true })
for (const [name, edits] of Object.entries(node)) {
  const script = name === 'prompt-says-plain-text' ? 'provider-node-test-5.mjs' : 'verify-7-2.mjs'
  writeFileSync(join(dir, `${name}.json`), JSON.stringify({ label: name, edits: edits.map(([file, from, to]) => ({ file, from, to })), argv: [`{{TOOLS}}/${script}`], env: {} }, null, 2) + '\n')
}
console.log(`wrote ${Object.keys(node).length} specs in specs72`)

// ---- the real window ----
const winEnv = (name) => ({ USER_DATA_DIR: scratch('s72nc'), WIPE_USER_DATA: '1', MOCK_PORT: '8796', INSPECT_PORT: '9230', PRESEED_FILE: '', LOG_LABEL: `nc-${name}` })
const winArgv = ['{{TOOLS}}/run-with-app.mjs', 'dev', 'verify-7-2w.mjs', '{{OUT}}/shots', '9222']
const win = {
  'w72-link-opens-without-asking': [[L, 'const ask = useCallback((url: string) => setAddress(url), [])', "const ask = useCallback((url: string) => { window.open(url, '_blank', 'noopener,noreferrer') }, [])"]],
  'w72-copy-adds-a-newline': [[C, 'await navigator.clipboard.writeText(text)', "await navigator.clipboard.writeText(text + '\\n')"]],
  'w72-what-was-typed-is-rendered': [[B, ") : message.role === 'assistant' ? (", ") : message.role !== 'x' ? ("]],
  'w72-bubble-not-capped': [[CSS, '  max-width: 100%;\n  min-width: 0;\n}', '  min-width: 0;\n}']],
  'w72-lines-not-kept': [[CSS, '  white-space: pre-line;\n}', '  white-space: normal;\n}']],
  'w72-main-allows-http': [[SEC, "return protocol === 'https:' && username === '' && password === ''", "return (protocol === 'https:' || protocol === 'http:') && username === '' && password === ''"]],
  'w72-prompt-says-plain-text': [[REQ, "'The window renders Markdown, so you may use it where it helps:", "'The window shows plain text, so use it where it helps:"]],
  'w72-text-as-html': [[M, '      return <>{node.text}</>', '      return <span dangerouslySetInnerHTML={{ __html: node.text }} />']]
}
const wdir = join(TOOLS, 'specs72w')
mkdirSync(wdir, { recursive: true })
for (const [name, edits] of Object.entries(win)) {
  writeFileSync(join(wdir, `${name}.json`), JSON.stringify({ label: name, edits: edits.map(([file, from, to]) => ({ file, from, to })), argv: winArgv, env: winEnv(name) }, null, 2) + '\n')
}
console.log(`wrote ${Object.keys(win).length} specs in specs72w`)
