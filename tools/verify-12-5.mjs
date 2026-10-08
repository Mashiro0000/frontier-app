// Slice 12.5 (D-042): THE REVIEW WINDOW AND THE LIST OF CHANGES, the parts that run under plain Node. How a change is made VISIBLE before it is shown (the characters the
// eye cannot see are written out, and so are the brackets that mark them, so that a file cannot draw a marker of its own), what the chat page may see of a
// change (a summary: never a line of it) and what the Review window gets (the whole change, no real path, no checksum), the rules for applying (the whole
// difference scrolled to its end, the file still what the proposal saw, the path still allowed) on a real scratch workspace, who the Review window answers
// (only its own top frame), and the page itself (a policy that allows nothing but its own nonce'd style and script, text put in with textContent, no link or
// image or frame). The window itself is checked in the real app (verify-12-5w.mjs). Windows only.
//
// Run: node tools/verify-12-5.mjs
import './ts-resolve.mjs'
import { checker } from './cdp.mjs'
import fs from 'node:fs'
import os from 'node:os'
import { win32 } from 'node:path'
import { REPO, REPO_URL } from './paths.mjs'

const check = checker()
const guard = async (name, fn) => { try { await fn() } catch (error) { check(`${name} did not run to its end: ${String(error?.stack ?? error).slice(0, 400)}`, false) } }
const show = (v) => JSON.stringify(v)?.slice(0, 300)
const SRC = `${REPO_URL}/src`
const modelMod = await import(`${SRC}/main/reviewModel.ts`)
const svcMod = await import(`${SRC}/main/reviewService.ts`)
const pageMod = await import(`${SRC}/main/reviewPage.ts`)
const propMod = await import(`${SRC}/main/proposals.ts`)
const diffMod = await import(`${SRC}/main/lineDiff.ts`)
const textMod = await import(`${SRC}/main/workspaceText.ts`)
const wsGuardMod = await import(`${SRC}/main/workspaceGuard.ts`)
const dataMod = await import(`${SRC}/main/dataFolderGuard.ts`)
const sharedChanges = await import(`${SRC}/shared/changes.ts`)
const J = win32.join
const cp = (n) => String.fromCodePoint(n)
const OPEN = cp(0x27e6)
const CLOSE = cp(0x27e7)

// ----- a proposal to play with -----
const edit = (before, find, replace, rel = ['src', 'a.ts'], extra = {}) => {
  const bytes = Buffer.from(before, 'utf8')
  const r = propMod.makeEdit({ bytes, decoded: textMod.decodeText(bytes), rel, real: `C:\\w\\${rel.join('\\')}`, find, replace, why: 'because', secret: false, now: 1, ...extra })
  if (!r.ok) throw new Error(r.why)
  return r.proposal
}
const keep = (store, proposal) => store.add(proposal).proposal

// ============ A. making a text visible ============
await guard('A', async () => {
  const { visible } = modelMod
  const mark = (n) => `${OPEN}U+${n}${CLOSE}`
  check('A: plain text, accents, Devanagari, CJK and an emoji are shown as they are', visible('plain café नमस्ते 日本語 😀 {}[]<>&"\'') === 'plain café नमस्ते 日本語 😀 {}[]<>&"\'')
  check('A: a tab stays a tab', visible('a\tb') === 'a\tb')
  const cases = [['a NUL', '\u0000', '0000'], ['a bell', '\u0007', '0007'], ['an escape', '\u001b', '001B'], ['a delete', '\u007f', '007F'], ['a next line', '\u0085', '0085'], ['a reversing override', cp(0x202e), '202E'], ['an isolate', cp(0x2067), '2067'], ['a left-to-right mark', cp(0x200e), '200E'], ['a zero-width space', cp(0x200b), '200B'], ['a zero-width joiner', cp(0x200d), '200D'], ['a word joiner', cp(0x2060), '2060'], ['a byte-order mark', cp(0xfeff), 'FEFF'], ['a soft hyphen', cp(0x00ad), '00AD'], ['a no-break space', cp(0x00a0), '00A0'], ['an em space', cp(0x2003), '2003'], ['an ideographic space', cp(0x3000), '3000'], ['a line separator', cp(0x2028), '2028'], ['a paragraph separator', cp(0x2029), '2029'], ['a private-use character', cp(0xe000), 'E000'], ['an unassigned character', cp(0x0378), '0378'], ['a lone high surrogate', '\ud800', 'D800'], ['a lone low surrogate', '\udc00', 'DC00'], ['an astral tag character', cp(0xe0041), 'E0041']]
  for (const [what, char, code] of cases) check(`A: ${what} is written out as ${mark(code)}`, visible(`a${char}b`) === `a${mark(code)}b`, show(visible(`a${char}b`)))
  check('A: the plain space is not marked, and the characters round it are', visible('a b') === 'a b' && visible(` ${cp(0x200b)} `) === ` ${mark('200B')} `)
  check('A: the brackets that mark a character are themselves written out, so that a file cannot draw a marker (even one that looks like a real one)', visible(`${OPEN}U+0041${CLOSE}`) === `${mark('27E6')}U+0041${mark('27E7')}` && visible(OPEN) === mark('27E6') && visible(CLOSE) === mark('27E7'))
  check('A: every character of a long mixed text is accounted for: taking the markers out gives back only visible characters', (() => { const input = Array.from({ length: 300 }, (_, i) => cp(i < 128 ? i : 0x2000 + i)).join(''); const out = visible(input); return !/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Co}\p{Cn}\p{Cs}]/u.test(out.replace(/\t/g, '')) })())
  check('A: the empty text is empty, and a very long one is not cut', visible('') === '' && visible('x'.repeat(100000)).length === 100000)
})

// ============ B. summaries and models ============
await guard('B', async () => {
  const { summaryOf, reviewModelOf } = modelMod
  const store = propMod.createProposalStore()
  const p = keep(store, edit('line 1\nline 2\nline 3\n', 'line 2', 'line TWO <script>alert(1)</script>'))
  const s = summaryOf(p)
  check('B: the summary has the id, the kind, the path, the counts, the size and the two warnings, and nothing else', show(Object.keys(s).sort()) === show(['added', 'bytes', 'id', 'kind', 'path', 'removed', 'runsCommands', 'secret']) && s.id === 'p1' && s.kind === 'edit' && s.path === 'src/a.ts' && s.added === 1 && s.removed === 1 && s.secret === false && s.runsCommands === false)
  check('B: ...and none of the change: no line, no reason, no checksum, no real path', !JSON.stringify(s).includes('script') && !JSON.stringify(s).includes('because') && !JSON.stringify(s).includes('C:\\') && !JSON.stringify(s).includes(p.fingerprint))
  check('B: the summary of a file whose name holds a reversing character shows the name written out', summaryOf({ ...p, path: `src/x${cp(0x202e)}.ts` }).path === `src/x${mark('202E')}.ts`)
  function mark(n) { return `${OPEN}U+${n}${CLOSE}` }
  const m = reviewModelOf(p, 'ok', false)
  check('B: the model for the window: the path, the reason as one line, the counts, the fingerprint, the state, the flags', m.id === 'p1' && m.path === 'src/a.ts' && m.why === 'because' && m.added === 1 && m.removed === 1 && m.fingerprint === p.fingerprint && m.state === 'ok' && m.reachedEnd === false && m.secret === false && m.runsCommands === false && m.eol === 'lf' && m.bom === false && m.kind === 'edit')
  check('B: the difference is the unified one, line by line with its kind: headers, the heading of the place, lines that are the same, removed and added', show(m.diff.map((l) => l.kind)) === show(['header', 'header', 'hunk', 'same', 'del', 'add', 'same']) && m.diff[0].text === '--- a/src/a.ts' && m.diff[1].text === '+++ b/src/a.ts' && m.diff[2].text === '@@ -1,3 +1,3 @@' && m.diff[5].text === 'line TWO <script>alert(1)</script>', show(m.diff))
  check('B: markup in the change is only text in the model (nothing is escaped for markup, because the window never makes markup)', m.diff[5].text.includes('<script>') && m.after.includes('line TWO <script>alert(1)</script>'))
  check('B: the file as it would be is there, line by line', show(m.after) === show(['line 1', 'line TWO <script>alert(1)</script>', 'line 3']) && m.afterCut === false)
  const j = JSON.stringify(m)
  check('B: the model says nothing of where the file really is, or of the checksum of the file as it was', !j.includes('C:\\w') && !j.includes(p.baseHash) && !('real' in m) && !('baseHash' in m) && !('before' in m))
  const hidden = keep(store, edit(`a${cp(0x00a0)}b\nc\n`, 'c', `d${cp(0x200b ).slice(0, 0)}d`))
  const mh = reviewModelOf(hidden, 'ok', false)
  check('B: a character that was already in the file (here a no-break space on a line of context) is written out in the model, in the difference and in the file', mh.diff.some((l) => l.kind === 'same' && l.text === `a${mark('00A0')}b`) && mh.after[0] === `a${mark('00A0')}b`, show(mh.diff))
  const longReason = keep(store, edit('x\ny\n', 'y', 'z', ['b.ts'], { why: `first line\nsecond${cp(0x202e)} line   with   spaces` }))
  check('B: the reason is one line, with the characters written out', reviewModelOf(longReason, 'ok', false).why === `first line second${mark('202E')} line with spaces`)
  const big = keep(store, edit(Array.from({ length: 5000 }, (_, i) => `line ${i}`).join('\n') + '\n', 'line 2500', 'CHANGED', ['big.ts']))
  const mb = reviewModelOf(big, 'ok', true)
  check('B: the file as it would be is cut at 4,000 lines and says so, while the difference is whole; "reached the end" is carried', mb.after.length === 4000 && mb.afterCut === true && mb.diff.filter((l) => l.kind === 'add').length === 1 && mb.reachedEnd === true && sharedChanges.REVIEW_AFTER_LINES === 4000)
  const created = keep(store, propMod.makeCreate({ rel: ['docs', 'new.md'], real: 'C:\\w\\docs\\new.md', content: '# a\n# b\n', why: 'w', secret: true, now: 1 }).proposal)
  const mc = reviewModelOf(created, 'exists', false)
  check('B: a new file: from /dev/null, all added, the secret flag, and the state the window is told', mc.diff[0].text === '--- /dev/null' && mc.diff[2].text === '@@ -0,0 +1,2 @@' && mc.diff.filter((l) => l.kind === 'add').length === 2 && mc.secret === true && mc.state === 'exists' && mc.kind === 'create')
  const cr = keep(store, edit('a\r\nb\r\n', 'b', 'B', ['w.bat']))
  const mr = reviewModelOf(cr, 'changed', false)
  check('B: Windows line endings and the commands flag are carried (the lines hold no carriage return)', mr.eol === 'crlf' && mr.runsCommands === true && mr.diff.every((l) => !l.text.includes('\r')) && mr.state === 'changed')
  check('B: the model can be sent as it is (it survives a structured clone)', (() => { try { structuredClone(m); return true } catch { return false } })())
})

// ============ C. the service on a real workspace ============
const ROOT = fs.realpathSync.native(fs.mkdtempSync(J(os.tmpdir(), 'frontier-125-')))
const DATA = J(ROOT, 'frontier-app')
const WS = J(ROOT, 'ws')
const OUT = J(ROOT, 'out')
const put = (base, rel, body) => { const full = J(base, rel); fs.mkdirSync(win32.dirname(full), { recursive: true }); fs.writeFileSync(full, body) }
put(DATA, 'memory.json', 'DATA')
put(OUT, 'x.txt', 'OUT')
put(WS, 'src\\a.ts', 'one\ntwo\nthree\n')
put(WS, 'src\\b.ts', 'alpha\nbeta\n')
let hasLink = true
try { fs.symlinkSync(OUT, J(WS, 'link'), 'junction') } catch { hasLink = false }
process.on('exit', () => { try { fs.rmdirSync(J(WS, 'link')) } catch { /* not made */ } try { fs.rmSync(ROOT, { recursive: true, force: true }) } catch { /* left for the system */ } })
await guard('C', async () => {
  const dataGuard = dataMod.createDataFolderGuard({ roots: () => [DATA] })
  const wsGuard = wsGuardMod.createWorkspaceGuard({ root: () => WS, dataGuard })
  const store = propMod.createProposalStore()
  const applied = []
  const svc = svcMod.createChangesService({ store, state: svcMod.fileStateOf(wsGuard), requestApply: async (proposal, owner) => { applied.push([proposal.id, owner]); return { ok: true } } })
  const make = (rel, find, replace) => { const real = J(WS, ...rel); const bytes = fs.readFileSync(real); return keep(store, propMod.makeEdit({ bytes, decoded: textMod.decodeText(bytes), rel, real, find, replace, why: 'because', secret: false, now: 1 }).proposal) }
  const e1 = make(['src', 'a.ts'], 'two', 'TWO')
  const e2 = make(['src', 'b.ts'], 'beta', 'BETA')
  const n1 = keep(store, propMod.makeCreate({ rel: ['docs', 'n.md'], real: J(WS, 'docs', 'n.md'), content: 'new\n', why: 'w', secret: false, now: 1 }).proposal)
  check('C: the list is newest first and holds summaries only', svc.list().map((c) => c.id).join() === 'p3,p2,p1' && svc.list().every((c) => Object.keys(c).length === 8))
  check('C: the model of a change on a file that is as it was has the state "ok", and "not reached" yet', (await svc.model(e1.id)).state === 'ok' && (await svc.model(e1.id)).reachedEnd === false && (await svc.model(n1.id)).state === 'ok')
  check('C: a change that is not there, or an id that is not text, has no model', (await svc.model('p99')) === null && (await svc.model(undefined)) === null && (await svc.model(7)) === null && (await svc.model({ id: 'p1' })) === null && (await svc.model('__proto__')) === null)
  let r = await svc.apply('p99', 'owner')
  check('C: applying a change that is not there is answered in words (an id that is not text too), and nothing is asked', !r.ok && r.error === svcMod.NOT_THERE && (await svc.apply(undefined, 'owner')).error === svcMod.NOT_THERE && (await svc.apply({ id: 'p1' }, 'owner')).error === svcMod.NOT_THERE && applied.length === 0)
  r = await svc.apply(e1.id, 'owner')
  check('C: applying before the difference was scrolled to its end is refused in words, and the question is not even asked', !r.ok && r.error === svcMod.SCROLL_FIRST && applied.length === 0)
  check('C: the window says the end was reached: for that change only', svc.markReachedEnd(e1.id) === true && (await svc.model(e1.id)).reachedEnd === true && (await svc.model(e2.id)).reachedEnd === false && svc.markReachedEnd('p99') === false)
  r = await svc.apply(e2.id, 'owner')
  check('C: another change did not inherit it', !r.ok && r.error === svcMod.SCROLL_FIRST)
  r = await svc.apply(e1.id, 'the window')
  check('C: with the end reached and the file as it was, the request goes on to the apply, for the window that asked, and what it answers is passed back', r.ok && applied.length === 1 && applied[0][0] === 'p1' && applied[0][1] === 'the window')
  check('C: nothing was written by any of this', fs.readFileSync(J(WS, 'src', 'a.ts'), 'utf8') === 'one\ntwo\nthree\n' && !fs.existsSync(J(WS, 'docs')))
  // the file changes meanwhile
  fs.writeFileSync(J(WS, 'src', 'a.ts'), 'one\ntwo\nthree\nfour\n')
  check('C: a file that changed since the proposal is "changed": the model says so and applying is refused in words (the person\'s later edit is not overwritten)', (await svc.model(e1.id)).state === 'changed' && (await svc.apply(e1.id, 'w')).error.startsWith('The file is not what it was') && applied.length === 1)
  fs.writeFileSync(J(WS, 'src', 'a.ts'), 'one\ntwo\nthree\n')
  check('C: ...and when it is back to the same bytes, it is "ok" again (the check is of the bytes, not of the time)', (await svc.model(e1.id)).state === 'ok')
  fs.rmSync(J(WS, 'src', 'b.ts'))
  check('C: a file that is gone is "gone", with its words', (await svc.model(e2.id)).state === 'gone' && svc.markReachedEnd(e2.id) && (await svc.apply(e2.id, 'w')).error === 'The file is not there any more, so the change is not applied.')
  put(WS, 'docs\\n.md', 'someone made it')
  check('C: a new file whose name is taken meanwhile is "exists", with its words', (await svc.model(n1.id)).state === 'exists' && svc.markReachedEnd(n1.id) && (await svc.apply(n1.id, 'w')).error === 'A file with that name is there now, so the new file is not made.')
  fs.rmSync(J(WS, 'docs'), { recursive: true, force: true })
  if (hasLink) {
    const viaLink = keep(store, propMod.makeCreate({ rel: ['link', 'z.txt'], real: J(WS, 'link', 'z.txt'), content: 'x', why: 'w', secret: false, now: 1 }).proposal)
    svc.markReachedEnd(viaLink.id)
    check('C: a path that goes through a junction is "unavailable" (the guard is asked again at every look), and applying is refused', (await svc.model(viaLink.id)).state === 'unavailable' && /not available any more/.test((await svc.apply(viaLink.id, 'w')).error))
  }
  const outside = keep(store, propMod.makeCreate({ rel: ['..', 'out', 'y.txt'], real: J(OUT, 'y.txt'), content: 'x', why: 'w', secret: false, now: 1 }).proposal)
  check('C: a path that leaves the workspace is "unavailable" too', (await svc.model(outside.id)).state === 'unavailable')
  const brokenGuard = svcMod.createChangesService({ store, state: async () => { throw new Error('boom') }, requestApply: async () => ({ ok: true }) })
  check('C: a look at the file that fails is "unavailable", never a thrown error', (await brokenGuard.model(e1.id)).state === 'unavailable')
  const throwing = svcMod.createChangesService({ store, state: svcMod.fileStateOf(wsGuard), requestApply: async () => { throw new Error('disk') } })
  throwing.markReachedEnd(e1.id)
  check('C: an apply that fails is an answer in words, not an error', (await throwing.apply(e1.id, 'w')).error === 'The change could not be applied.')
  const wsNone = wsGuardMod.createWorkspaceGuard({ root: () => null, dataGuard })
  const noWs = svcMod.createChangesService({ store, state: svcMod.fileStateOf(wsNone), requestApply: async () => ({ ok: true }) })
  check('C: with no workspace chosen every change is "unavailable"', (await noWs.model(e1.id)).state === 'unavailable')
  check('C: dropping a change takes it away and forgets that its end was reached; dropping what is not there, or an id that is not text, does nothing', svc.drop(e1.id) === true && store.get(e1.id) === undefined && (await svc.model(e1.id)) === null && svc.drop(e1.id) === false && svc.drop(7) === false && svc.drop(null) === false && svc.list().every((c) => c.id !== e1.id))
  check('C: the id of a dropped change is not used again, and a new change is not "reached"', (() => { const x = make(['src', 'a.ts'], 'two', 'TWO'); return x.id !== e1.id })())
  check('C: nothing was written in any of this either', fs.readFileSync(J(WS, 'src', 'a.ts'), 'utf8') === 'one\ntwo\nthree\n')
})

// ============ D. who the Review window answers ============
await guard('D', async () => {
  const win = await import(`${SRC}/main/reviewWindow.ts`).catch((error) => ({ error }))
  if (win.error !== undefined) {
    // the module imports Electron, which does not load under plain Node: the function is checked from its source instead
    check('D: (reviewWindow.ts imports Electron and cannot be loaded here; its sender check is read from the source)', true)
    const source = fs.readFileSync(`${REPO}/src/main/reviewWindow.ts`, 'utf8')
    const fn = /export function isReviewSender\([\s\S]*?\n}\n/.exec(source)?.[0] ?? ''
    const strip = (t) => t.replace(/\(\s*event: ReviewSenderEvent & \{ sender: \{ mainFrame\?: unknown \} \},\s*reviewContents: unknown\s*\): boolean/, '(event, reviewContents)').replace('export function', 'function')
    const run = new Function(`${strip(fn).replace(/: [A-Za-z<>{}\[\]|, ]+(?=[,)=])/g, '')}\n return isReviewSender`)()
    const frame = { url: 'data:text/html;charset=utf-8,x' }
    const contents = { mainFrame: frame }
    const ok = (event, c = contents) => run(event, c)
    check('D: the window\'s own top frame, loaded from the data page, is answered', ok({ sender: contents, senderFrame: frame }) === true)
    check('D: a frame that is not the top frame is not', ok({ sender: contents, senderFrame: { url: frame.url } }) === false)
    check('D: another page (the chat window) is not', ok({ sender: { mainFrame: frame }, senderFrame: frame }) === false)
    check('D: the right page that has navigated to an address of the web or a file is not', ok({ sender: { mainFrame: { url: 'https://evil.example/' } }, senderFrame: null }) === false && (() => { const f = { url: 'https://evil.example/' }; const c = { mainFrame: f }; return ok({ sender: c, senderFrame: f }, c) === false })() && (() => { const f = { url: 'file:///C:/x.html' }; const c = { mainFrame: f }; return ok({ sender: c, senderFrame: f }, c) === false })())
    check('D: with no window open, nothing is answered', ok({ sender: contents, senderFrame: frame }, null) === false && run({ sender: contents, senderFrame: frame }, undefined) === false)
    check('D: an event with no frame is not answered', ok({ sender: contents, senderFrame: null }) === false)
  }
})

// ============ E. the page ============
await guard('E', async () => {
  const { reviewHtml, NONCE_PATTERN } = pageMod
  const nonce = 'abcdefghijklmnopqrstuvwx'
  const html = reviewHtml(nonce)
  const csp = /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html)?.[1] ?? ''
  const rules = Object.fromEntries(csp.split('; ').map((r) => [r.split(' ')[0], r.split(' ').slice(1).join(' ')]))
  check('E: the policy allows nothing by default and only this page\'s own style and script, by nonce', rules['default-src'] === "'none'" && rules['script-src'] === `'nonce-${nonce}'` && rules['style-src'] === `'nonce-${nonce}'`)
  check('E: ...no image, connection, frame, object, base address or form', ['img-src', 'connect-src', 'frame-src', 'object-src', 'base-uri', 'form-action'].every((k) => rules[k] === "'none'"), show(rules))
  check('E: ...and nothing that would let a script in: no unsafe-inline, no unsafe-eval, no wildcard, no address', !/unsafe|\*|https?:|data:|blob:/.test(csp), csp)
  check('E: exactly one script and one style, both with the nonce, and nothing else that loads (no link, image, frame, form, base, object, embed)', (html.match(/<script/g) ?? []).length === 1 && (html.match(/<style/g) ?? []).length === 1 && html.includes(`<script nonce="${nonce}">`) && html.includes(`<style nonce="${nonce}">`) && !/<(link|img|iframe|frame|form|base|object|embed|audio|video|source|input)\b/i.test(html))
  const script = /<script nonce="[^"]+">([\s\S]*)<\/script>/.exec(html)?.[1] ?? ''
  check('E: the script puts everything in with textContent and createTextNode: no innerHTML, outerHTML, insertAdjacentHTML, document.write, eval, Function, setTimeout of a string, or address', !/innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\b|new Function|\bFunction\(|setTimeout\(\s*['"`]|setInterval\(\s*['"`]|\.src\b|\.href\b|location|fetch\(|XMLHttpRequest|WebSocket|window\.open|import\(/.test(script) && /textContent/.test(script) && /createTextNode/.test(script))
  check('E: the page has no attribute that holds an address (href, src, action, formaction, srcdoc, on...=)', !/\b(href|src|action|formaction|srcdoc|poster|data)=|\son[a-z]+=/i.test(html.replace(script, '')))
  const calls = [...new Set([...script.matchAll(/window\.review\.(\w+)/g)].map((m) => m[1]))].sort()
  check('E: the script uses only the six functions of the Review window\'s bridge', show(calls) === show(['apply', 'drop', 'close', 'get', 'onChanged', 'reachedEnd'].sort()), show(calls))
  check('E: the text of the page: the two tabs, "Ask to apply...", "Drop this change", "Close"', ['The difference', 'The file as it would be', 'Ask to apply...', 'Drop this change', 'Close', 'Review a change'].every((t) => html.includes(t)))
  check('E: "Ask to apply..." is off when the page starts (it is turned on by main\'s answer and by scrolling), and the status is announced to a screen reader', /<button id="ask" type="button" disabled>/.test(html) && /<span id="status" role="status">/.test(html) && /role="region"/.test(html))
  check('E: a nonce that is too short, too long, or holds a quote, a space or markup is refused (it sits in the policy and in attributes)', ['', 'short', 'x'.repeat(65), 'abc"def ghijklmnopqrstu', 'abc def ghijklmnopqrstu', 'abc<script>defghijkl'].every((n) => { try { reviewHtml(n); return false } catch { return NONCE_PATTERN.test(n) === false } }) && NONCE_PATTERN.test('abcdefghijklmnop') && NONCE_PATTERN.test('A-b_c0123456789xyz'))
  const html2 = reviewHtml('zzzzzzzzzzzzzzzzzz')
  check('E: two pages differ only by their nonce', html.replaceAll(nonce, 'N') === html2.replaceAll('zzzzzzzzzzzzzzzzzz', 'N'))
  check('E: the markers are drawn from the same brackets the model writes them with', script.includes(`String.fromCharCode(${OPEN.charCodeAt(0)})`) && script.includes(`String.fromCharCode(${CLOSE.charCodeAt(0)})`))
  check('E: the page is small and holds no copy of any change (it asks main for the one it shows)', html.length < 20000 && !/POSITIVE|proposal/i.test(html))
})

// ============ F. the sources ============
await guard('F', async () => {
  const dir = `${REPO}/src`
  const source = (f) => fs.readFileSync(`${dir}/${f}`, 'utf8')
  const code = (s) => s.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')
  const importsOf = (f) => [...source(f).matchAll(/^import[^';]*from '([^']+)'/gm)].map((m) => m[1]).sort()
  check('F: the preload of the Review window is separate from the chat page\'s, and gives six things and no more', /contextBridge\.exposeInMainWorld\('review', \{/.test(source('preload/review.ts')) && ['get', 'reachedEnd', 'apply', 'drop', 'close', 'onChanged'].every((n) => new RegExp(`\\b${n}:`).test(source('preload/review.ts'))) && (source('preload/review.ts').match(/^\s{2}\w+:/gm) ?? []).length === 6 && !/review/i.test(source('preload/index.ts').replace(/changes: \{[\s\S]*?\},\n  projects/, '')))
  check('F: the chat page\'s bridge gets two functions for changes, list and review, and nothing that applies, drops or reads a change', /changes: \{\s*list: \(\) => ipcRenderer\.invoke\(CHANNELS\.changesList\),\s*review: \(id\) => ipcRenderer\.invoke\(CHANNELS\.changesReview, \{ id \}\)\s*\}/.test(source('preload/index.ts')) && !/apply|drop|reachedEnd/i.test(/changes: \{[\s\S]*?\},\n  projects/.exec(source('preload/index.ts'))?.[0] ?? 'x'))
  const ww = code(source('main/reviewWindow.ts'))
  check('F: the window is made like the chat window and shut tighter: sandbox, context isolation, no Node, no spelling service, tools of the browser only when not packaged, a session of its own that is in memory', /sandbox: true/.test(ww) && /contextIsolation: true/.test(ww) && /nodeIntegration: false/.test(ww) && /spellcheck: false/.test(ww) && /devTools: !app\.isPackaged/.test(ww) && /const PARTITION = 'frontier-review'/.test(ww) && !/persist:/.test(ww) && /partition: PARTITION/.test(ww) && /webSecurity: true/.test(ww) && /allowRunningInsecureContent: false/.test(ww))
  check('F: the session allows no permission and cancels every request that is not the page\'s own data address', /setPermissionRequestHandler\(\(_contents, _permission, callback\) => callback\(false\)\)/.test(ww) && /setPermissionCheckHandler\(\(\) => false\)/.test(ww) && /cancel: !details\.url\.startsWith\('data:'\) && !details\.url\.startsWith\('devtools:'\)/.test(ww))
  check('F: it cannot navigate, open a window or attach a webview', /setWindowOpenHandler\(\(\) => \(\{ action: 'deny' \}\)\)/.test(ww) && /'will-navigate', \(event\) => event\.preventDefault\(\)/.test(ww) && /'will-redirect', \(event\) => event\.preventDefault\(\)/.test(ww) && /'will-attach-webview', \(event\) => event\.preventDefault\(\)/.test(ww))
  check('F: the wrapper REFUSES with an error, and does not run the handler, when the sender is not the Review window', /if \(!isReviewSender\(event, contents\(\)\)\) \{\s*throw new Error\('Blocked: this call did not come from the Review window\.'\)\s*\}\s*return Promise\.resolve\(handler\(event, \.\.\.args\)\)/.test(ww))
  check('F: each of its five messages is answered only through the sender check', ['get', 'reachedEnd', 'apply', 'drop', 'close'].every((c) => new RegExp(`REVIEW_CHANNELS\\.${c},\\s*only\\(`).test(ww)) && (ww.match(/ipcMain\.handle\(/g) ?? []).length === 5)
  check('F: the page is loaded as a data address of text/html, made by main for this window with its own nonce', /loadURL\(`data:text\/html;charset=utf-8,\$\{encodeURIComponent\(reviewHtml\(nonce\)\)\}`\)/.test(ww) && /randomBytes\(18\)\.toString\('base64url'\)/.test(ww))
  check('F: the handlers of the Review window are not registered in the wiring file (only the two for the chat page are)', !/REVIEW_CHANNELS|review:/.test(source('main/ipc.ts')) && /CHANNELS\.changesList/.test(source('main/ipc.ts')) && /CHANNELS\.changesReview/.test(source('main/ipc.ts')))
  const ipc = source('main/ipc.ts')
  check('F: the two handlers for the chat page are behind the check of who is asking, and the review one is for the window that asked', /CHANNELS\.changesList,\s*guarded\(/.test(ipc) && /CHANNELS\.changesReview,\s*guardedForWindow\(/.test(ipc))
  check('F: the service, the model and the page import no Electron (so they are checked here); only the window and the preload do', ['main/reviewService.ts', 'main/reviewModel.ts', 'main/reviewPage.ts'].every((f) => !/from 'electron'/.test(source(f))) && /from 'electron'/.test(source('main/reviewWindow.ts')))
  check('F: the service imports only the file system, the shared types, the proposals, the model and the guard (as a type)', show(importsOf('main/reviewService.ts')) === show(['../shared/changes', './proposals', './reviewModel', './workspaceGuard', 'fs'].sort()), show(importsOf('main/reviewService.ts')))
  check('F: the service reads a file and writes nothing: no write, delete, rename, copy or folder call', !/\.(writeFile|appendFile|rm|rmdir|unlink|rename|mkdir|copyFile|truncate|symlink|link)\(/.test(code(source('main/reviewService.ts'))))
  const section = source('renderer/src/tools/ChangesSection.tsx')
  check('F: the page that lists the changes draws text only (no link, picture, frame, innerHTML or window.open) and calls only list (through the hook) and review', !/href=|src=|<a[ >]|<iframe|innerHTML|dangerouslySetInnerHTML|window\.open/.test(section) && (section.match(/window\.api\.changes\.(\w+)/g) ?? []).join() === 'window.api.changes.review')
  check('F: the notes in the chat say that a proposal waits for the person, and that nothing is changed until they apply it', /The change waits for you: open Tools to review it\. Nothing is changed until you apply it\./.test(source('shared/toolNotes.ts')))
  check('F: the shared file of the two windows holds types and constants only', !/\b(import|require)\b.*from '(?!\.)/.test(source('shared/changes.ts')) && !/function |=> /.test(code(source('shared/changes.ts'))))
  void diffMod
})

console.error = console.error
const ok = check.summary()
process.exit(ok ? 0 : 1)
