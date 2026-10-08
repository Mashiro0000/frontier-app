// Slice 12.4 (D-042): THE MODEL CAN PROPOSE A CHANGE, AND NOTHING IS CHANGED. The line diff of our own (checked against a brute-force reference on random texts, and its
// unified form against a patch applier written here), how a proposal is made from the file as it is now (the text to find occurs exactly once; line endings, a
// byte-order mark and a size limit are kept; hidden and reversing characters are refused), the store of what waits, and the two tools that propose
// (propose_edit, propose_new_file) run through the real runtime: one box for the reply, nothing written anywhere, the model told that nothing was applied.
// Under plain Node, Windows only (a scratch workspace).
//
// Run: node tools/verify-12-4.mjs
import './ts-resolve.mjs'
import { checker } from './cdp.mjs'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import { win32 } from 'node:path'
import { REPO, REPO_URL } from './paths.mjs'

const check = checker()
const guard = async (name, fn) => { try { await fn() } catch (error) { check(`${name} did not run to its end: ${String(error?.stack ?? error).slice(0, 400)}`, false) } }
const show = (v) => JSON.stringify(v)?.slice(0, 300)
const SRC = `${REPO_URL}/src`
const diffMod = await import(`${SRC}/main/lineDiff.ts`)
const propMod = await import(`${SRC}/main/proposals.ts`)
const toolsMod = await import(`${SRC}/main/proposalTools.ts`)
const readToolsMod = await import(`${SRC}/main/workspaceTools.ts`)
const regMod = await import(`${SRC}/main/toolRegistry.ts`)
const coreMod = await import(`${SRC}/main/toolCore.ts`)
const gateMod = await import(`${SRC}/main/systemQuestion.ts`)
const dataMod = await import(`${SRC}/main/dataFolderGuard.ts`)
const wsGuardMod = await import(`${SRC}/main/workspaceGuard.ts`)
const textMod = await import(`${SRC}/main/workspaceText.ts`)
const replyMod = await import(`${SRC}/main/replyTools.ts`)
const sharedTools = await import(`${SRC}/shared/tools.ts`)
const logMod = await import(`${SRC}/main/auditLog.ts`)
const J = win32.join
const cp = (n) => String.fromCodePoint(n)
const KEY = 'sk-ant-FAKE-KEY-for-the-checks-0123456789'
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex')
const realError = console.error
console.error = () => undefined

// ----- a small deterministic random source -----
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 } }

/** The longest common subsequence's length, by the textbook table: the reference the diff is held to. */
function lcsLength(a, b) {
  const t = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0))
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) t[i][j] = a[i - 1] === b[j - 1] ? t[i - 1][j - 1] + 1 : Math.max(t[i - 1][j], t[i][j - 1])
  return t[a.length][b.length]
}

/** A patch applier written for this suite: applies the unified diff the app wrote to the old lines, and says what it found wrong. */
function applyUnified(beforeLines, text) {
  const lines = text.split('\n')
  const problems = []
  if (!/^--- /.test(lines[0] ?? '') || !/^\+\+\+ /.test(lines[1] ?? '')) problems.push('no header')
  const out = []
  let pos = 0
  for (let i = 2; i < lines.length; i++) {
    const m = /^@@ -(\d+),(\d+) \+(\d+),(\d+) @@$/.exec(lines[i])
    if (m === null) { problems.push(`bad line ${i}: ${lines[i]}`); break }
    const [oldStart, oldCount, newStart, newCount] = m.slice(1).map(Number)
    const upTo = oldCount === 0 ? oldStart : oldStart - 1
    while (pos < upTo) out.push(beforeLines[pos++])
    if (out.length !== (newCount === 0 ? newStart : newStart - 1)) problems.push(`new start ${newStart} does not match ${out.length}`)
    let seenOld = 0
    let seenNew = 0
    for (i++; i < lines.length && !lines[i].startsWith('@@'); i++) {
      const sign = lines[i][0]
      const body = lines[i].slice(1)
      if (sign === ' ') { if (beforeLines[pos] !== body) problems.push(`context differs at ${pos}`); out.push(body); pos++; seenOld++; seenNew++ }
      else if (sign === '-') { if (beforeLines[pos] !== body) problems.push(`removed line differs at ${pos}`); pos++; seenOld++ }
      else if (sign === '+') { out.push(body); seenNew++ }
      else problems.push(`unknown sign in ${lines[i]}`)
    }
    i--
    if (seenOld !== oldCount || seenNew !== newCount) problems.push(`counts ${seenOld}/${seenNew} against ${oldCount}/${newCount}`)
  }
  while (pos < beforeLines.length) out.push(beforeLines[pos++])
  return { after: out, problems }
}

// ============ A. the line diff ============
await guard('A', async () => {
  const { splitLines, diffLines, unifiedDiff, oldLinesOf, newLinesOf, MAX_DIFF_CELLS } = diffMod
  check('A: lines of a text: LF, CRLF and CR all end a line; a last line break does not make an empty line; the empty text has none', show(splitLines('a\nb\n')) === '["a","b"]' && show(splitLines('a\r\nb')) === '["a","b"]' && show(splitLines('a\rb\r')) === '["a","b"]' && show(splitLines('')) === '[]' && show(splitLines('\n')) === '[""]' && show(splitLines('a\n\n')) === '["a",""]' && show(splitLines('x')) === '["x"]')
  let d = diffLines(['a', 'b', 'c'], ['a', 'b', 'c'])
  check('A: two equal texts have no change', d.added === 0 && d.removed === 0 && d.lines.every((l) => l.kind === 'same') && d.lines.length === 3)
  d = diffLines([], ['x', 'y'])
  check('A: a new text is all added, numbered from 1, with no old numbers', d.added === 2 && d.removed === 0 && d.lines.every((l) => l.kind === 'add' && l.oldNo === null) && d.lines.map((l) => l.newNo).join() === '1,2')
  d = diffLines(['x', 'y'], [])
  check('A: an emptied text is all removed', d.removed === 2 && d.added === 0 && d.lines.map((l) => l.oldNo).join() === '1,2')
  d = diffLines(['a', 'b', 'c', 'd'], ['a', 'B', 'c', 'd'])
  check('A: one changed line in the middle: kept lines around it, one removed, one added, with the right numbers', show(d.lines.map((l) => [l.kind[0], l.text, l.oldNo, l.newNo])) === show([['s', 'a', 1, 1], ['d', 'b', 2, null], ['a', 'B', null, 2], ['s', 'c', 3, 3], ['s', 'd', 4, 4]]))
  d = diffLines(['a', 'b'], ['a', 'x', 'b'])
  check('A: a line put in', d.added === 1 && d.removed === 0 && show(d.lines.map((l) => l.kind[0])) === show(['s', 'a', 's']))
  d = diffLines(['1', '2', '3', '4', '5'], ['3', '4', '5', '6'])
  check('A: lines taken off the start and put at the end', d.removed === 2 && d.added === 1)
  d = diffLines(['a', 'a', 'a'], ['a', 'a'])
  check('A: repeated lines are counted (one of three removed)', d.removed === 1 && d.added === 0 && d.lines.length === 3)
  check('A: the old text and the new text are in the diff whole, in order', show(oldLinesOf(diffLines(['q', 'w', 'e'], ['q', 'e', 'r']))) === '["q","w","e"]' && show(newLinesOf(diffLines(['q', 'w', 'e'], ['q', 'e', 'r']))) === '["q","e","r"]')
  // random: the diff holds both texts, and keeps as many lines as the longest common subsequence
  const rand = rng(12345)
  const pick = () => 'abcde'[Math.floor(rand() * 5)]
  let bad = []
  let optimal = 0
  for (let n = 0; n < 400; n++) {
    const a = Array.from({ length: Math.floor(rand() * 40) }, pick)
    let b = a.slice()
    const edits = Math.floor(rand() * 8)
    for (let k = 0; k < edits; k++) {
      const at = Math.floor(rand() * (b.length + 1))
      const roll = rand()
      if (roll < 0.34) b.splice(at, 0, pick())
      else if (roll < 0.67) b.splice(at, 1)
      else if (at < b.length) b[at] = pick()
    }
    if (rand() < 0.1) b = Array.from({ length: Math.floor(rand() * 30) }, pick)
    const r = diffLines(a, b)
    const sameCount = r.lines.filter((l) => l.kind === 'same').length
    if (show(oldLinesOf(r)) !== show(a) || show(newLinesOf(r)) !== show(b)) bad.push(`texts differ for ${a.join('')} -> ${b.join('')}`)
    else if (sameCount !== lcsLength(a, b)) bad.push(`not the longest common subsequence for ${a.join('')} -> ${b.join('')}: ${sameCount} against ${lcsLength(a, b)}`)
    else optimal++
    if (r.added !== b.length - sameCount || r.removed !== a.length - sameCount) bad.push('counts')
    // numbering
    let oldNo = 0
    let newNo = 0
    for (const l of r.lines) { if (l.kind !== 'add') { oldNo++; if (l.oldNo !== oldNo) bad.push('old numbering') } if (l.kind !== 'del') { newNo++; if (l.newNo !== newNo) bad.push('new numbering') } }
  }
  check('A: 400 random pairs of texts: the diff always holds both texts exactly and keeps as many lines as the best possible (the textbook reference)', bad.length === 0 && optimal === 400, show(bad.slice(0, 3)))
  // a middle part too big for the table is shown whole as removed then added (longer than the best, never wrong)
  const bigA = Array.from({ length: 1500 }, (_, i) => `a${i}`)
  const bigB = Array.from({ length: 1500 }, (_, i) => (i % 2 === 0 ? `a${i}` : `b${i}`))
  const big = diffLines(['top', ...bigA, 'bottom'], ['top', ...bigB, 'bottom'])
  check('A: a middle part too big for the table (over the cell limit) is shown as all removed and then all added, and still holds both texts', (1501 * 1501) > MAX_DIFF_CELLS && big.removed === 1499 && big.added === 1499 && big.lines[0].kind === 'same' && big.lines.at(-1).kind === 'same' && oldLinesOf(big).length === 1502 && newLinesOf(big).length === 1502)
  const t0 = Date.now()
  const huge = diffLines(Array.from({ length: 8000 }, (_, i) => `line ${i}`), Array.from({ length: 8000 }, (_, i) => (i === 4000 ? 'changed' : `line ${i}`)))
  check('A: a file of 8,000 lines with one line changed is diffed at once (the common ends are cut off first)', huge.added === 1 && huge.removed === 1 && Date.now() - t0 < 2000, String(Date.now() - t0))
  // the unified form
  const before = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten']
  const after = ['one', 'two', 'three', 'FOUR', 'five', 'six', 'seven', 'eight', 'nine', 'ten']
  let text = unifiedDiff('src/a.ts', 'src/a.ts', diffLines(before, after))
  check('A: the unified diff of one changed line in the middle, with three lines of context, exactly', text === ['--- a/src/a.ts', '+++ b/src/a.ts', '@@ -1,7 +1,7 @@', ' one', ' two', ' three', '-four', '+FOUR', ' five', ' six', ' seven'].join('\n'), text)
  text = unifiedDiff('new.txt', null, diffLines([], ['a', 'b']))
  check('A: a new file: from /dev/null, "@@ -0,0 +1,2 @@", every line added', text === ['--- /dev/null', '+++ b/new.txt', '@@ -0,0 +1,2 @@', '+a', '+b'].join('\n'), text)
  text = unifiedDiff('x', 'x', diffLines(['a', 'b'], ['a', 'b']))
  check('A: no change: the header only', text === '--- a/x\n+++ b/x')
  check('A: the diff of a text that ends where it changed has no context after it', unifiedDiff('x', 'x', diffLines(['a', 'b', 'c'], ['a', 'b', 'C'])) === ['--- a/x', '+++ b/x', '@@ -1,3 +1,3 @@', ' a', ' b', '-c', '+C'].join('\n'))
  const far = Array.from({ length: 30 }, (_, i) => `l${i}`)
  const far2 = far.slice(); far2[2] = 'X'; far2[27] = 'Y'
  text = unifiedDiff('f', 'f', diffLines(far, far2))
  check('A: two changes far apart are two places (two "@@" headers), two close ones are one', (text.match(/^@@/gm) ?? []).length === 2 && (unifiedDiff('f', 'f', diffLines(far, far.map((l, i) => (i === 10 || i === 14 ? 'Z' : l)))).match(/^@@/gm) ?? []).length === 1)
  // random: our own patch applier turns the old text into the new one with the unified diff, for several amounts of context
  let applyBad = []
  for (let n = 0; n < 300; n++) {
    const a = Array.from({ length: Math.floor(rand() * 40) }, pick)
    const b = a.slice()
    for (let k = 0; k < Math.floor(rand() * 6); k++) { const at = Math.floor(rand() * (b.length + 1)); const roll = rand(); if (roll < 0.4) b.splice(at, 0, pick()); else if (roll < 0.7) b.splice(at, 1); else if (at < b.length) b[at] = pick() }
    for (const context of [0, 1, 3, 5]) {
      const u = unifiedDiff('p', a.length === 0 ? null : 'p', diffLines(a, b), context)
      const applied = applyUnified(a, u)
      if (applied.problems.length > 0 || show(applied.after) !== show(b)) applyBad.push(`${a.join('')} -> ${b.join('')} (context ${context}): ${applied.problems[0] ?? 'result differs'}`)
    }
  }
  check('A: 300 random changes, each written as a unified diff with 0, 1, 3 and 5 lines of context: a patch applier written for this suite turns the old text into the new one every time, and the numbers in the headers are right', applyBad.length === 0, show(applyBad.slice(0, 3)))
})

// ============ B. making a proposal ============
const decodeOf = (text) => { const bytes = Buffer.from(text, 'utf8'); return { bytes, decoded: textMod.decodeText(bytes) } }
await guard('B', async () => {
  const { makeEdit, makeCreate, firstHiddenCharacter, runsCommands, bytesFor } = propMod
  const edit = (fileText, find, replace, extra = {}) => { const { bytes, decoded } = extra.bytes ? { bytes: extra.bytes, decoded: textMod.decodeText(extra.bytes) } : decodeOf(fileText); return makeEdit({ bytes, decoded, rel: ['src', 'a.ts'], real: 'C:\\w\\src\\a.ts', find, replace, why: 'because', secret: false, now: 5, ...extra.input }) }
  let r = edit('let a = 1\nlet b = 2\n', 'let b = 2', 'let b = 3')
  check('B: an edit: the text occurs once and is replaced; the proposal holds before and after as the file would be, its counts, size and fingerprint', r.ok && r.proposal.after === 'let a = 1\nlet b = 3\n' && r.proposal.before === 'let a = 1\nlet b = 2\n' && r.proposal.added === 1 && r.proposal.removed === 1 && r.proposal.bytes === 20 && r.proposal.fingerprint === sha(Buffer.from('let a = 1\nlet b = 3\n')).slice(0, 12) && r.proposal.baseHash === sha(Buffer.from('let a = 1\nlet b = 2\n')) && r.proposal.path === 'src/a.ts' && r.proposal.kind === 'edit' && r.proposal.createdAt === 5 && r.proposal.why === 'because', show(r))
  check('B: the fingerprint is 12 characters of lower-case hex of the exact bytes to be written, and `bytesFor` gives those bytes', /^[0-9a-f]{12}$/.test(r.proposal.fingerprint) && bytesFor(r.proposal.after, false).equals(Buffer.from('let a = 1\nlet b = 3\n')))
  r = edit('abc', 'zzz', 'y')
  check('B: text that is not there is refused in words that say to copy it as it is, and hold none of the file', !r.ok && /not in the file exactly as given/.test(r.why) && !r.why.includes('abc'))
  r = edit('a a a', 'a', 'b')
  check('B: text that occurs three times is refused with the count and "give more of the text around it"', !r.ok && /occurs 3 times/.test(r.why) && /more of the text around it/.test(r.why))
  r = edit('aaa', 'aa', 'b')
  check('B: overlapping occurrences count too ("aa" in "aaa" is twice: the text could be read two ways)', !r.ok && /occurs 2 times/.test(r.why))
  r = edit('x'.repeat(100) + 'needle', 'needle', 'y')
  check('B: a needle at the very end of a long text is found', r.ok)
  r = edit('abc', 'b', 'b')
  check('B: the same text for both is "nothing would change"', !r.ok && /nothing would change/.test(r.why))
  r = edit('a\r\nb\r\nc\r\n', 'b', 'B')
  check('B: a file with Windows line endings keeps them in a change inside a line', r.ok && r.proposal.after === 'a\r\nB\r\nc\r\n' && r.proposal.eol === 'crlf')
  r = edit('a\r\nb\r\nc\r\n', 'a\nb', 'x\ny\nz')
  check('B: ...the model may send LF: a find across lines matches, and the new lines are written with the file\'s own line endings', r.ok && r.proposal.after === 'x\r\ny\r\nz\r\nc\r\n', show(r.proposal?.after))
  r = edit('a\r\nb\r\n', 'a\r\nb', 'x\r\ny')
  check('B: ...or CRLF, and a CRLF in the new text does not become CRCRLF', r.ok && r.proposal.after === 'x\r\ny\r\n')
  r = edit('a\r\nb\r\n', 'a\nb', 'a\r\nb')
  check('B: a change that only writes the same lines with the line endings the file already has changes nothing, and is refused as such', !r.ok && /leave the file as it is/.test(r.why), show(r))
  r = edit('a\nb\n', 'a\r\nb', 'x')
  check('B: a file with LF endings does not match a find with CRLF (said as "not in the file exactly as given")', !r.ok)
  r = edit('a\r\nb\nc\n', 'b\nc', 'x')
  check('B: a file with mixed endings is matched as it is, and written as it is', r.ok && r.proposal.after === 'a\r\nx\n' && r.proposal.eol === 'mixed')
  const bomBytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('hello world')])
  r = edit('', 'world', 'there', { bytes: bomBytes })
  check('B: a byte-order mark is kept: the proposal says so, the text has none, and the bytes to write begin with it', r.ok && r.proposal.bom === true && r.proposal.after === 'hello there' && bytesFor(r.proposal.after, true)[0] === 0xef && r.proposal.bytes === 14 && r.proposal.fingerprint === sha(bytesFor('hello there', true)).slice(0, 12))
  r = edit('é ü 日本語 😀', 'ü', 'u')
  check('B: letters of other languages and an emoji are kept as they are', r.ok && r.proposal.after === 'é u 日本語 😀' && r.proposal.bytes === Buffer.byteLength('é u 日本語 😀'))
  r = edit('x'.repeat(262144 - 3) + 'ABC', 'ABC', 'ABCDEF')
  check('B: a file that would be over 256 KB after the change is refused with both sizes in words', !r.ok && /would be 262,147 bytes after the change/.test(r.why) && /262,144/.test(r.why), r.why)
  r = edit('x'.repeat(262144 - 3) + 'ABC', 'ABC', 'XYZ')
  check('B: ...exactly 256 KB is fine', r.ok && r.proposal.bytes === 262144)
  // hidden and reversing characters
  const hiddenCodes = [0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069, 0x200b, 0x200c, 0x200d, 0x200e, 0x200f, 0x2060, 0x2061, 0x2062, 0x2063, 0x2064, 0xfeff, 0x00ad, 0x061c, 0x180e]
  const missed = hiddenCodes.filter((c) => { const x = edit('abc', 'b', `x${cp(c)}y`); return x.ok || !/hidden or reversing character \(U\+[0-9A-F]{4}\)/.test(x.why) })
  check('B: each of 23 hidden or reversing characters in the new text is refused, by its code, with the reason (a reader would see code that is not what runs)', missed.length === 0, show(missed.map((c) => c.toString(16))))
  check('B: ...the code is named in capitals with four or more digits', edit('abc', 'b', cp(0x202e)).why.includes('U+202E'))
  r = edit(`a${cp(0x202e)}b`, `a${cp(0x202e)}b`, 'ab')
  check('B: a hidden character that is already in the file may be in the text to find, and taking it out is a change (only adding one is refused)', r.ok && r.proposal.after === 'ab')
  check('B: the plain characters near them are not refused: a tab, a no-break space, a line separator that is not a control', edit('abc', 'b', '\t\u00a0\u2028').ok)
  check('B: firstHiddenCharacter gives null for plain text and the first code for the first one', firstHiddenCharacter('plain') === null && firstHiddenCharacter(`ab${cp(0x200b)}c${cp(0x202e)}`) === 'U+200B' && firstHiddenCharacter('') === null)
  // new files
  let c = makeCreate({ rel: ['docs', 'new.md'], real: 'C:\\w\\docs\\new.md', content: '# title\n\ntext\n', why: 'because', secret: false, now: 7 })
  check('B: a new file: all added, no before, no base hash, LF endings as sent, no byte-order mark', c.ok && c.proposal.before === null && c.proposal.baseHash === null && c.proposal.added === 3 && c.proposal.removed === 0 && c.proposal.eol === 'lf' && c.proposal.bom === false && c.proposal.kind === 'create' && c.proposal.path === 'docs/new.md' && c.proposal.bytes === 14, show(c))
  check('B: a new file keeps the line endings it was sent with', makeCreate({ rel: ['a'], real: 'x', content: 'a\r\nb\r\n', why: 'w', secret: false, now: 1 }).proposal.eol === 'crlf')
  check('B: a new file with a hidden character is refused', !makeCreate({ rel: ['a'], real: 'x', content: `a${cp(0x202e)}`, why: 'w', secret: false, now: 1 }).ok)
  check('B: a new file over 256 KB is refused', !makeCreate({ rel: ['a'], real: 'x', content: 'x'.repeat(262145), why: 'w', secret: false, now: 1 }).ok && makeCreate({ rel: ['a'], real: 'x', content: 'x'.repeat(262144), why: 'w', secret: false, now: 1 }).ok)
  check('B: an empty new file is a file with no lines', makeCreate({ rel: ['a'], real: 'x', content: '', why: 'w', secret: false, now: 1 }).proposal.added === 0)
  // flags
  const flagged = ['package.json', 'sub/package.json', 'Makefile', 'x/makefile', 'build.bat', 'a/b.CMD', 'run.ps1', 'x.vbs', 'x.vbe', 'x.wsf', 'deploy.sh', '.vscode/tasks.json', '.github/workflows/ci.yml', 'a/.github/workflows/x.yaml']
  const plain = ['src/index.ts', 'package-lock.json', 'readme.md', 'my-package.json.txt', 'tasks.json', '.vscode/settings.json', 'workflows/ci.yml', 'script.shx', 'a.batch']
  check('B: the files that run commands when used later are flagged (package.json, a Makefile, scripts, task files, workflows) and ordinary ones are not', flagged.every((p) => runsCommands(p)) && plain.every((p) => !runsCommands(p)), show([flagged.filter((p) => !runsCommands(p)), plain.filter((p) => runsCommands(p))]))
  r = makeEdit({ ...decodeOf('abc'), decoded: textMod.decodeText(Buffer.from('abc')), bytes: Buffer.from('abc'), rel: ['package.json'], real: 'x', find: 'b', replace: 'c', why: 'w', secret: true, now: 1 })
  check('B: the proposal carries both flags: secret (from the file\'s class) and runs-commands (from its name)', r.ok && r.proposal.flags.secret === true && r.proposal.flags.runsCommands === true && makeCreate({ rel: ['.env'], real: 'x', content: 'a', why: 'w', secret: true, now: 1 }).proposal.flags.secret === true)
})

// ============ C. the store ============
await guard('C', async () => {
  const { createProposalStore, PROPOSAL_LIMITS } = propMod
  const store = createProposalStore()
  const one = (n) => ({ kind: 'create', rel: ['f' + n], path: 'f' + n, real: 'x', baseHash: null, before: null, after: 'a', bom: false, eol: 'none', diff: { lines: [], added: 0, removed: 0 }, added: 0, removed: 0, bytes: 1, fingerprint: 'abc', flags: { secret: false, runsCommands: false }, why: 'w', createdAt: n })
  const first = store.add(one(1))
  check('C: a proposal gets an id (p1, p2...), is frozen, and can be fetched', first.ok && first.proposal.id === 'p1' && Object.isFrozen(first.proposal) && store.get('p1') === first.proposal && store.count() === 1)
  store.add(one(2)); store.add(one(3))
  check('C: the list is newest first', store.list().map((p) => p.id).join() === 'p3,p2,p1')
  check('C: an id that is not text, or not there, gives nothing (and cannot reach another property)', store.get(1) === undefined && store.get(null) === undefined && store.get('constructor') === undefined && store.get('__proto__') === undefined && store.get('p99') === undefined && store.remove('x') === false && store.remove(1) === false)
  check('C: removing a proposal takes it away, and the ids are not used again', store.remove('p2') === true && store.count() === 2 && store.add(one(4)).proposal.id === 'p4')
  for (let n = 5; n <= 21; n++) store.add(one(n))
  const over = store.add(one(99))
  check('C: at most 20 wait at once: the 21st is refused in words, and a decision makes room', PROPOSAL_LIMITS.waiting === 20 && store.count() === 20 && !over.ok && /already 20 proposals waiting/.test(over.why) && store.remove('p1') && store.add(one(100)).ok)
  check('C: the limits are 20 waiting and 10 to a reply', PROPOSAL_LIMITS.perReply === 10 && Object.isFrozen(PROPOSAL_LIMITS))
})

// ============ D. the tools, through the real runtime ============
const ROOT = fs.realpathSync.native(fs.mkdtempSync(J(os.tmpdir(), 'frontier-124-')))
const DATA = J(ROOT, 'frontier-app')
const WS = J(ROOT, 'ws')
const OUT = J(ROOT, 'out')
const put = (base, rel, body) => { const full = J(base, rel); fs.mkdirSync(win32.dirname(full), { recursive: true }); fs.writeFileSync(full, body) }
put(DATA, 'memory.json', 'DATA-CANARY')
put(OUT, 'secret.txt', 'OUTSIDE-CANARY')
put(WS, 'src\\main.ts', 'export function main() {\n  return 1\n}\n')
put(WS, 'src\\crlf.ts', 'const a = 1\r\nconst b = 2\r\n')
put(WS, 'src\\twice.ts', 'x = 1\nx = 1\n')
put(WS, 'package.json', '{\n  "name": "demo"\n}\n')
put(WS, 'src\\many.ts', Array.from({ length: 14 }, (_, i) => `v${i} = 0`).join('\n') + '\n')
put(WS, '.env', 'SECRET-CANARY env')
put(WS, '.git\\config', 'GIT-CANARY')
put(WS, 'binary.bin', Buffer.from([1, 2, 0, 3]))
put(WS, 'big.txt', 'x'.repeat(300 * 1024))
put(WS, 'holds-key.txt', `key = ${KEY}\n`)
process.on('exit', () => { try { fs.rmSync(ROOT, { recursive: true, force: true }) } catch { /* left for the system */ } })
const treeHash = (dir) => { const h = createHash('sha256'); const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) { const full = J(d, e.name); if (e.isDirectory()) { h.update(`D ${full}\n`); walk(full) } else if (e.isFile()) { h.update(`F ${full} ${fs.statSync(full).size} ${fs.statSync(full).mtimeMs}\n`); h.update(fs.readFileSync(full)) } } }; walk(dir); return h.digest('hex') }
const wsStart = treeHash(WS)
const dataStart = treeHash(DATA)
const registry = regMod.createToolRegistry([...regMod.BUILT_IN_TOOLS, ...readToolsMod.WORKSPACE_READ_TOOLS, ...toolsMod.WORKSPACE_PROPOSE_TOOLS])
const dataGuard = dataMod.createDataFolderGuard({ roots: () => [DATA] })
const ALL_ON = { enabled: { web_search: true, list_files: true, read_file: true, propose_edit: true, propose_new_file: true }, caps: { steps: 5, seconds: 60 } }
function makeReply(options = {}) {
  const asked = []
  const events = []
  const clock = { t: 1_000_000 }
  const script = [...(options.script ?? [])]
  const gate = gateMod.createQuestionGate(async (o, q) => { asked.push(q); return script.length === 0 ? true : script.shift() }, () => clock.t)
  const wsGuard = wsGuardMod.createWorkspaceGuard({ root: () => WS, dataGuard })
  const store = options.store ?? propMod.createProposalStore()
  const runtime = replyMod.createToolRuntime({ tools: registry, gate, guard: dataGuard, workspace: { guard: wsGuard, proposals: store }, record: async (e) => { events.push(structuredClone(e)) }, holdsSavedKey: async (t) => t.includes(KEY), now: () => 77 })
  const ctl = new AbortController()
  const reply = runtime.forReply({ owner: null, signal: ctl.signal, settings: options.settings ?? ALL_ON, provider: 'Anthropic', search: async () => ({ text: 'x', sources: [], searched: null, searches: 1, usage: {}, end: 'done' }) })
  let n = 0
  const run = async (name, input) => (await reply.runTurn([{ id: `t${++n}`, name, input: { why: 'because', ...input } }])).results[0]
  return { run, asked, events, store, reply, ctl, clock }
}
await guard('D', async () => {
  check('D: the two tools are in the registry, asked about by the reply and counted as file calls, with long texts that are never shown in the box', ['propose_edit', 'propose_new_file'].every((id) => registry.get(id).ask === 'reply' && registry.get(id).counts === 'file') && registry.get('propose_edit').args.find.kind === 'body' && registry.get('propose_edit').args.find.max === 20000 && registry.get('propose_new_file').args.content.max === 100000)
  check('D: the titles agree with the audit log\'s', registry.ids().every((id) => sharedTools.toolTitle(id) === registry.get(id).title))
  check('D: there is NO tool that applies: the registry\'s ids are search, list, read and the two that propose', registry.ids().join() === 'web_search,list_files,read_file,propose_edit,propose_new_file' && !registry.ids().some((id) => /apply|write|delete|rename|run|exec/.test(id)))
  const r = makeReply()
  const spec = r.reply.specs().find((s) => s.name === 'propose_edit')
  check('D: the model is offered the proposing tools with their limits, and told that nothing is changed and that it cannot apply', r.reply.specs().map((s) => s.name).join() === 'web_search,list_files,read_file,propose_edit,propose_new_file' && /Nothing is changed/.test(spec.description) && /you cannot apply it/.test(spec.description) && spec.parameters.properties.find.maxLength === 20000 && spec.parameters.required.join() === 'path,find,replace,why')
  const out = await r.run('propose_edit', { path: 'src/main.ts', find: 'return 1', replace: 'return 2' })
  check('D: a proposal: ONE box for the reply (the first call is a proposal), and the model is told what was recorded and that nothing was changed or applied', !out.isError && r.asked.length === 1 && /^The model asked to use your code workspace/.test(r.asked[0].detail) && /First call: Propose a change to a file in the workspace: "src\/main\.ts"/.test(r.asked[0].detail) && /^Proposal p1 recorded: a change to "src\/main\.ts" \(1 line added, 1 removed\)\. Nothing was changed on disk\./.test(out.text) && /It is NOT applied yet: do not say that it is/.test(out.text), out.text)
  check('D: the model is told nothing of the file (no text of it in what came back)', !/export function main|return 1|return 2/.test(out.text))
  check('D: the proposal is in the store with everything the Review window needs, and the person\'s side of it: the reason, the fingerprint, no flags', r.store.get('p1')?.path === 'src/main.ts' && r.store.get('p1').after === 'export function main() {\n  return 2\n}\n' && r.store.get('p1').why === 'because' && r.store.get('p1').createdAt === 77 && r.store.get('p1').flags.secret === false && r.store.get('p1').flags.runsCommands === false && r.store.get('p1').real.toLowerCase() === J(WS, 'src', 'main.ts').toLowerCase())
  check('D: NOTHING was written: the workspace is byte for byte, and time for time, what it was', treeHash(WS) === wsStart && treeHash(DATA) === dataStart)
  const second = await r.run('propose_new_file', { path: 'docs/guide/new.md', content: '# new\nbody\n' })
  check('D: a new file in folders that do not exist: recorded, covered by the reply\'s yes (no second box), and the folders were not made', !second.isError && r.asked.length === 1 && /^Proposal p2 recorded: a new file "docs\/guide\/new\.md" \(2 lines added, 0 removed\)/.test(second.text) && !fs.existsSync(J(WS, 'docs')) && r.store.get('p2').kind === 'create' && r.store.get('p2').real.toLowerCase() === J(WS, 'docs', 'guide', 'new.md').toLowerCase())
  const ids = [...new Set(r.events.map((e) => e.call))]
  check('D: the record: each call asked (the path and the lengths of the long texts, never the text), the first answered yes and the second covered, then ran and result', show(r.events.filter((e) => e.call === ids[0]).map((e) => e.type === 'answered' ? `answered:${e.answer}` : e.type)) === show(['asked', 'answered:yes', 'ran', 'result']) && show(r.events.filter((e) => e.call === ids[1]).map((e) => e.type === 'answered' ? `answered:${e.answer}` : e.type)) === show(['asked', 'answered:covered', 'ran', 'result']))
  const askedEvents = r.events.filter((e) => e.type === 'asked')
  check('D: ...the long texts are in the record as their lengths only', askedEvents[0].args.find === '(8 characters)' && askedEvents[0].args.replace === '(8 characters)' && askedEvents[1].args.content === '(11 characters)' && !JSON.stringify(r.events).includes('return 2') && !JSON.stringify(r.events).includes('# new'), show(askedEvents.map((e) => e.args)))
  check('D: every event is accepted by the log\'s strict reader', r.events.every((e) => logMod.parseAuditEvent(JSON.parse(logMod.auditLine(e))) !== null))
  const crlf = await r.run('propose_edit', { path: 'src/crlf.ts', find: 'const a = 1\nconst b', replace: 'const a = 10\nconst b' })
  check('D: a file with Windows line endings: the model\'s LF find matches, and the proposal keeps the file\'s endings', !crlf.isError && r.store.get('p3')?.after === 'const a = 10\r\nconst b = 2\r\n', show(r.store.get('p3')?.after))
  for (const [what, input, word] of [
    ['text that is not there', { path: 'src/main.ts', find: 'return 99', replace: 'x' }, /not in the file exactly as given/],
    ['text that occurs twice', { path: 'src/twice.ts', find: 'x = 1', replace: 'x = 2' }, /occurs 2 times/],
    ['a change that changes nothing', { path: 'src/main.ts', find: 'return 1', replace: 'return 1' }, /nothing would change/],
    ['a reversing character in the new text', { path: 'src/main.ts', find: 'return 1', replace: `return 1${cp(0x202e)}` }, /hidden or reversing character \(U\+202E\)/]
  ]) {
    const o = await r.run('propose_edit', input)
    check(`D: ${what}: no proposal, the model is told why in words (and is not told anything of the file)`, !o.isError && /^No proposal was made: /.test(o.text) && word.test(o.text) && !/export function/.test(o.text), o.text)
  }
  check('D: none of those made a proposal (the store holds only the three good ones)', r.store.count() === 3)
  const bin = await r.run('propose_edit', { path: 'binary.bin', find: 'a', replace: 'b' })
  const big = await r.run('propose_edit', { path: 'big.txt', find: 'x', replace: 'y' })
  check('D: a file that is not text, and one over 256 KB, are refused for the proposal in words', /cannot be read as text: it is a binary file/.test(bin.text) && /larger than 262,144 bytes/.test(big.text) && /^No proposal was made/.test(bin.text + big.text))
  const exists = await r.run('propose_new_file', { path: 'src/main.ts', content: 'x' })
  check('D: a new file where one is: the core refuses it ("wrong path"), no proposal', exists.isError && exists.text === coreMod.WRONG_PATH_TEXT && r.store.count() === 3)
  const missing = await r.run('propose_edit', { path: 'src/nothing.ts', find: 'a', replace: 'b' })
  check('D: an edit of a file that is not there: the same refusal', missing.isError && missing.text === coreMod.WRONG_PATH_TEXT)
  const git = await r.run('propose_edit', { path: '.git/config', find: 'GIT', replace: 'EVIL' })
  const git2 = await r.run('propose_new_file', { path: '.git/hooks/pre-commit', content: 'echo evil' })
  const outside = await r.run('propose_new_file', { path: '../out/new.txt', content: 'x' })
  const absolute = await r.run('propose_edit', { path: J(WS, 'src', 'main.ts'), find: 'a', replace: 'b' })
  check('D: an edit in .git, a new hook there, a file outside the workspace and an absolute path are refused with no question and no proposal', [git, git2, outside, absolute].every((o) => o.isError) && git.text === coreMod.DATA_FOLDER_TEXT && outside.text === coreMod.DATA_FOLDER_TEXT && absolute.text === coreMod.BAD_PATH_TEXT && r.asked.length === 1 && r.store.count() === 3)
  const key = await r.run('propose_edit', { path: 'src/main.ts', find: 'return 1', replace: `return '${KEY}'` })
  const key2 = await r.run('propose_new_file', { path: 'k.txt', content: `key=${KEY}` })
  check('D: a saved key in the new text or in a new file is refused as "secret" before anything is asked', key.isError && key2.isError && key.text === coreMod.SECRET_TEXT && r.store.count() === 3 && r.asked.length === 1)
  check('D: after all of that, still nothing is written anywhere', treeHash(WS) === wsStart && treeHash(DATA) === dataStart)
})

await guard('D2', async () => {
  // a hidden file, a file that runs commands
  const r = makeReply()
  await r.run('propose_edit', { path: 'src/main.ts', find: 'return 1', replace: 'return 2' })
  const env = await r.run('propose_edit', { path: '.env', find: 'SECRET-CANARY env', replace: 'SECRET=changed' })
  check('D: a proposal for a hidden file is asked about on its own (a box that says it is a PROPOSAL and that nothing is written without separate approval), and the proposal is flagged as secret', r.asked.length === 2 && r.asked[1].message === 'Allow the model to propose a change to this file?' && /may PROPOSE a change to it\. Nothing is written without your separate approval\./.test(r.asked[1].detail) && /File: "\.env"/.test(r.asked[1].detail) && /Proposal p2 recorded/.test(env.text) && r.store.get('p2').flags.secret === true)
  const pkg = await r.run('propose_edit', { path: 'package.json', find: '"name": "demo"', replace: '"name": "demo",\n  "scripts": { "postinstall": "node x.js" }' })
  check('D: a change to package.json is flagged as one that runs commands (an amber line for the Review window), and not as secret', r.store.get('p3')?.flags.runsCommands === true && r.store.get('p3').flags.secret === false && !pkg.isError)
  const bat = await r.run('propose_new_file', { path: 'build.bat', content: '@echo off\necho hi\n' })
  check('D: a new .bat file is flagged too', r.store.get('p4')?.flags.runsCommands === true && !bat.isError)
  const no = makeReply({ script: [true, false] })
  const refused = await no.run('propose_edit', { path: '.env', find: 'SECRET-CANARY env', replace: 'x' })
  check('D: a no to the hidden file: no proposal, and the model is told the person did not allow it', refused.isError && refused.text === coreMod.DECLINED_TEXT.no && no.store.count() === 0)
  const declinedAll = makeReply({ script: [false] })
  const first = await declinedAll.run('propose_new_file', { path: 'a.txt', content: 'x' })
  const next = await declinedAll.run('propose_edit', { path: 'src/main.ts', find: 'return 1', replace: 'return 2' })
  check('D: a no to the reply\'s box: no proposal, and the next call is refused as "the person did not allow file access in this reply" with no question', first.isError && next.text === coreMod.GRANT_DECLINED_TEXT && declinedAll.asked.length === 1 && declinedAll.store.count() === 0)
  const off = makeReply({ settings: { enabled: { propose_edit: false, read_file: true }, caps: { steps: 5, seconds: 60 } } })
  check('D: a proposing tool that is switched off is refused as "off" and is not even offered', (await off.run('propose_edit', { path: 'src/main.ts', find: 'a', replace: 'b' })).text === coreMod.TOOL_OFF && !off.reply.specs().some((s) => s.name === 'propose_edit'))
  const hiddenNew = await r.run('propose_new_file', { path: '.env.local', content: 'A=1' })
  check('D: a new hidden file is asked about on its own and flagged as secret', !hiddenNew.isError && r.store.get('p5')?.flags.secret === true && /File: "\.env\.local"/.test(r.asked.at(-1).detail), show(r.asked.at(-1)?.detail))
  check('D: nothing written in any of this', treeHash(WS) === wsStart)
})

await guard('D3', async () => {
  // the caps of a reply, and of the store
  const r = makeReply()
  const texts = []
  for (let i = 0; i < 12; i++) texts.push((await r.run('propose_new_file', { path: `gen/f${i}.txt`, content: `file ${i}` })).text)
  check('D: a reply may make 10 proposals; the 11th and the 12th are told so in words, and made none', texts.slice(0, 10).every((t) => /^Proposal p\d+ recorded/.test(t)) && texts.slice(10).every((t) => /^No proposal was made: this reply has already made 10 proposals/.test(t)) && r.store.count() === 10)
  const e = makeReply()
  const editTexts = []
  for (let i = 0; i < 12; i++) editTexts.push((await e.run('propose_edit', { path: 'src/many.ts', find: `v${i} = 0`, replace: `v${i} = 1` })).text)
  check('D: ...the same for edits: the 11th edit of a reply is told so, in words', editTexts.slice(0, 10).every((t) => /^Proposal p\d+ recorded/.test(t)) && editTexts.slice(10).every((t) => /already made 10 proposals/.test(t)) && e.store.count() === 10, show(editTexts.map((t) => t.slice(0, 40))))
  const shared = propMod.createProposalStore()
  const a = makeReply({ store: shared })
  const b = makeReply({ store: shared })
  const c = makeReply({ store: shared })
  for (let i = 0; i < 10; i++) { await a.run('propose_new_file', { path: `a/f${i}.txt`, content: 'x' }); await b.run('propose_new_file', { path: `b/f${i}.txt`, content: 'x' }) }
  const wait = await c.run('propose_new_file', { path: 'c/f.txt', content: 'x' })
  check('D: the store holds 20 waiting from all replies together: the 21st is told "already 20 proposals waiting", whatever reply makes it', shared.count() === 20 && /No proposal was made: There are already 20 proposals waiting/.test(wait.text))
  shared.remove('p1')
  check('D: ...and a decision makes room', /^Proposal p21 recorded/.test((await c.run('propose_new_file', { path: 'c/g.txt', content: 'x' })).text))
  check('D: file calls are counted: 12 proposals used 12 of the 30 file calls and none of the 5 tool steps', r.reply.budget.used().fileCalls === 12 && r.reply.budget.used().steps === 0)
  check('D: no file was made in all this', !fs.existsSync(J(WS, 'gen')) && !fs.existsSync(J(WS, 'a')) && treeHash(WS) === wsStart)
})

await guard('E', async () => {
  const dir = `${REPO}/src/main`
  const source = (f) => fs.readFileSync(`${dir}/${f}`, 'utf8')
  const code = (s) => s.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')
  const importsOf = (f) => [...source(f).matchAll(/^import[^';]*from '([^']+)'/gm)].map((m) => m[1]).sort()
  check('E: lineDiff.ts imports nothing', importsOf('lineDiff.ts').length === 0)
  check('E: proposals.ts imports only crypto, the shared limits, the diff and the text test: no file system', show(importsOf('proposals.ts')) === show(['../shared/workspace', './lineDiff', './workspaceText', 'crypto'].sort()), show(importsOf('proposals.ts')))
  check('E: proposalTools.ts imports the file system (to READ), the shared limits, the core and registry as types, the store and the text test', show(importsOf('proposalTools.ts')) === show(['../shared/workspace', './proposals', './toolCore', './toolRegistry', './workspaceText', 'fs'].sort()), show(importsOf('proposalTools.ts')))
  check('E: no file of the proposals writes, deletes, renames, copies or makes a folder, and none has a network, process, shell or Electron call', ['lineDiff.ts', 'proposals.ts', 'proposalTools.ts'].every((f) => !/\.(writeFile|appendFile|rm|rmdir|unlink|rename|mkdir|copyFile|truncate|symlink|link|open|createWriteStream)\(/.test(code(source(f))) && !/electron|child_process|\bfetch\(|https?:\/\/|\bspawn|\bexec\(|require\(/.test(code(source(f)))))
  check('E: proposalTools.ts uses the file system only to read a file (readFile) and nothing else of it', (code(source('proposalTools.ts')).match(/fs\.(\w+)/g) ?? []).every((u) => u === 'fs.readFile') && (code(source('proposalTools.ts')).match(/fs\.\w+/g) ?? []).length >= 1)
  const users = fs.readdirSync(dir).filter((f) => f.endsWith('.ts') && /from '\.\/(proposals|proposalTools|lineDiff)'/.test(source(f))).sort().join()
  check('E: the proposals are imported by the reply\'s tools, the wiring and each other only', users === 'ipc.ts,proposalTools.ts,proposals.ts,replyTools.ts', users)
  const preload = fs.readFileSync(`${REPO}/src/preload/index.ts`, 'utf8') + fs.readFileSync(`${REPO}/src/shared/ipc.ts`, 'utf8')
  check('E: the page\'s bridge has no function that touches a proposal (the Review window and its Changes list are 12.5)', !/proposal/i.test(preload))
  check('E: the workspace switch turns on the four tools together', readToolsMod.WORKSPACE_TOOL_IDS.join() === 'list_files,read_file,propose_edit,propose_new_file')
})

console.error = realError
const ok = check.summary()
process.exit(ok ? 0 : 1)
