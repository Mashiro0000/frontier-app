import { MARK_CLOSE, MARK_OPEN } from './reviewModel'

// The page of the Review window (Stage 12.5, D-042): one HTML text that main builds, with its style and its script in it and nothing else, loaded as a `data:` address
// into a window the chat page cannot reach. Its rules: a Content-Security-Policy that allows nothing but this page's own nonce'd style and script (no network, no
// image, no frame, no form, no `base`); it draws every text it is given with `textContent` (never as markup: a diff full of `<script>` is only text); it has no
// link, no `src` and no `eval`; and it talks to main only through the four functions its preload gives it (`window.review`). The diff is scrolled in one box, and
// the page tells main when it was scrolled to its end: that is what turns on "Ask to apply...". No Electron imports.

/** The characters of a nonce: only these, so that it can sit in a header and an attribute without any quoting. */
export const NONCE_PATTERN = /^[A-Za-z0-9_-]{16,64}$/

const STYLE = `
:root { color-scheme: light dark; --bg: #ffffff; --fg: #1b1f24; --muted: #57606a; --line: #d0d7de; --add: #e6ffec; --addfg: #116329; --del: #ffebe9; --delfg: #82071e; --hunk: #ddf4ff; --hunkfg: #0550ae; --mark: #fff8c5; --markfg: #7d4e00; --red: #cf222e; --amber: #9a6700; --accent: #0969da; --btn: #f6f8fa; }
@media (prefers-color-scheme: dark) { :root { --bg: #0d1117; --fg: #e6edf3; --muted: #8d96a0; --line: #30363d; --add: #12261e; --addfg: #7ee787; --del: #2d1517; --delfg: #ffa198; --hunk: #0c2d6b; --hunkfg: #79c0ff; --mark: #3b2e00; --markfg: #f2cc60; --red: #ff7b72; --amber: #e3b341; --accent: #4493f8; --btn: #21262d; } }
* { box-sizing: border-box; }
html, body { height: 100%; margin: 0; }
body { display: flex; flex-direction: column; background: var(--bg); color: var(--fg); font: 14px/1.45 "Segoe UI", system-ui, sans-serif; }
header, footer { flex: none; padding: 10px 16px; border-bottom: 1px solid var(--line); }
footer { border-bottom: 0; border-top: 1px solid var(--line); display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
h1 { font-size: 16px; margin: 0 0 4px; overflow-wrap: anywhere; }
.meta { color: var(--muted); overflow-wrap: anywhere; }
.banner { margin: 6px 0 0; padding: 6px 10px; border-radius: 6px; border: 1px solid var(--line); overflow-wrap: anywhere; }
.banner.red { border-color: var(--red); color: var(--red); font-weight: 600; }
.banner.amber { border-color: var(--amber); color: var(--amber); font-weight: 600; }
nav { flex: none; display: flex; gap: 6px; padding: 8px 16px 0; }
button { font: inherit; color: var(--fg); background: var(--btn); border: 1px solid var(--line); border-radius: 6px; padding: 6px 12px; cursor: pointer; }
button:hover:not(:disabled) { border-color: var(--accent); }
button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
button:disabled { opacity: 0.55; cursor: default; }
button[aria-pressed="true"] { border-color: var(--accent); font-weight: 600; }
#ask:not(:disabled) { background: var(--accent); color: #ffffff; border-color: var(--accent); }
main { flex: 1 1 auto; min-height: 0; overflow: auto; margin: 8px 16px; border: 1px solid var(--line); border-radius: 6px; font: 13px/1.5 Consolas, "Courier New", monospace; tab-size: 4; }
main:focus-visible { outline: 2px solid var(--accent); }
.line { display: flex; white-space: pre-wrap; overflow-wrap: anywhere; padding: 0 8px; }
.line .sign { flex: none; width: 1.6em; color: var(--muted); user-select: none; }
.line .no { flex: none; width: 5ch; text-align: right; margin-right: 1.2em; color: var(--muted); user-select: none; }
.line .text { flex: 1 1 auto; min-width: 0; }
.line.add { background: var(--add); } .line.add .text { color: var(--addfg); }
.line.del { background: var(--del); } .line.del .text { color: var(--delfg); }
.line.hunk { background: var(--hunk); color: var(--hunkfg); }
.line.header { color: var(--muted); font-weight: 600; }
.mark { background: var(--mark); color: var(--markfg); border-radius: 3px; padding: 0 2px; font-weight: 600; }
#status { flex: 1 1 100%; color: var(--muted); min-height: 1.4em; overflow-wrap: anywhere; }
#status.error { color: var(--red); }
.cut { padding: 6px 8px; color: var(--muted); font-style: italic; }
`

/** The script of the page. A plain function body: it is the only script, and main puts it in under the nonce. */
const SCRIPT = `
(() => {
  const OPEN = String.fromCharCode(${MARK_OPEN.charCodeAt(0)})
  const CLOSE = String.fromCharCode(${MARK_CLOSE.charCodeAt(0)})
  const $ = (id) => document.getElementById(id)
  let model = null
  let mode = 'diff'
  let dropping = false
  let sentEnd = null

  /** Puts text in a parent, the characters written out by main drawn as marks (each begins with the open bracket and ends with the close one). */
  function put(parent, text) {
    let at = 0
    while (at < text.length) {
      const open = text.indexOf(OPEN, at)
      const close = open === -1 ? -1 : text.indexOf(CLOSE, open)
      if (open === -1 || close === -1) { parent.appendChild(document.createTextNode(text.slice(at))); return }
      if (open > at) parent.appendChild(document.createTextNode(text.slice(at, open)))
      const mark = document.createElement('span')
      mark.className = 'mark'
      mark.textContent = text.slice(open, close + 1)
      parent.appendChild(mark)
      at = close + 1
    }
  }
  function line(kind, sign, no, text) {
    const row = document.createElement('div')
    row.className = 'line ' + kind
    if (no !== null) { const n = document.createElement('span'); n.className = 'no'; n.textContent = String(no); row.appendChild(n) }
    if (sign !== null) { const s = document.createElement('span'); s.className = 'sign'; s.textContent = sign; row.appendChild(s) }
    const t = document.createElement('span')
    t.className = 'text'
    put(t, text)
    row.appendChild(t)
    return row
  }
  function say(text, error) { const s = $('status'); s.textContent = text; s.className = error ? 'error' : '' }
  function banner(parent, kind, text) { const b = document.createElement('p'); b.className = 'banner ' + kind; b.setAttribute('role', kind === 'red' ? 'alert' : 'note'); put(b, text); parent.appendChild(b) }

  const STATE = {
    changed: 'The file is not what it was when this change was proposed: it was changed since. This change cannot be applied; ask the model to propose it again.',
    gone: 'The file is not there any more. This change cannot be applied.',
    exists: 'A file with this name is there now. This new file cannot be made.',
    unavailable: 'The path of this change is not available any more. It cannot be applied.'
  }

  function ready() {
    const view = $('view')
    const atEnd = view.scrollTop + view.clientHeight >= view.scrollHeight - 2
    if (mode === 'diff' && atEnd && sentEnd !== model.id && !model.reachedEnd) {
      sentEnd = model.id
      window.review.reachedEnd().then(() => { model.reachedEnd = true; sync() })
    }
  }
  function sync() {
    const ask = $('ask')
    ask.disabled = !(model.reachedEnd && model.state === 'ok')
    $('hint').textContent = model.state !== 'ok' ? '' : model.reachedEnd ? '' : 'Scroll the whole difference to its end to turn on "Ask to apply...".'
  }
  function render() {
    const head = $('head')
    head.textContent = ''
    const h1 = document.createElement('h1')
    put(h1, (model.kind === 'create' ? 'A new file: ' : 'A change to ') + model.path)
    head.appendChild(h1)
    const meta = document.createElement('div')
    meta.className = 'meta'
    meta.textContent = '+' + model.added + ' lines, -' + model.removed + ' lines; the file would be ' + model.bytes + ' bytes (' + ({ lf: 'Unix line endings', crlf: 'Windows line endings', mixed: 'mixed line endings', none: 'no line breaks' })[model.eol] + (model.bom ? ', with a byte-order mark' : '') + '). Fingerprint of the exact bytes that would be written: ' + model.fingerprint + ' (the Windows box shows the same).'
    head.appendChild(meta)
    const why = document.createElement('div')
    why.className = 'meta'
    put(why, "The model's reason: " + model.why)
    head.appendChild(why)
    if (model.secret) banner(head, 'red', 'This file is hidden or looks like it holds secrets. Look at the change with extra care.')
    if (model.runsCommands) banner(head, 'amber', 'This file runs commands when it is used later (a script, package.json, a task file or a workflow). A change here can make commands run: read every line.')
    if (model.state !== 'ok') banner(head, 'red', STATE[model.state])
    $('tab-diff').setAttribute('aria-pressed', String(mode === 'diff'))
    $('tab-file').setAttribute('aria-pressed', String(mode === 'file'))
    const view = $('view')
    view.textContent = ''
    view.setAttribute('aria-label', mode === 'diff' ? 'The difference' : 'The file as it would be')
    if (mode === 'diff') {
      for (const l of model.diff) view.appendChild(line(l.kind, l.kind === 'add' ? '+' : l.kind === 'del' ? '-' : l.kind === 'same' ? ' ' : null, null, l.text))
    } else {
      model.after.forEach((text, i) => view.appendChild(line('same', null, i + 1, text)))
      if (model.afterCut) { const cut = document.createElement('div'); cut.className = 'cut'; cut.textContent = 'The file goes on; only its first ' + model.after.length + ' lines are shown here. The difference is always whole.'; view.appendChild(cut) }
      if (model.after.length === 0) { const e = document.createElement('div'); e.className = 'cut'; e.textContent = '(The file would be empty.)'; view.appendChild(e) }
    }
    view.scrollTop = 0
    $('drop').textContent = dropping ? 'Click again to drop it' : 'Drop this change'
    sync()
    requestAnimationFrame(ready)
  }
  function load() {
    return window.review.get().then((m) => {
      if (m === null) { say('That change is not there any more.', true); model = null; $('ask').disabled = true; return }
      model = m
      dropping = false
      mode = 'diff'
      sentEnd = null
      say('', false)
      render()
    })
  }

  $('view').addEventListener('scroll', () => { if (model !== null) ready() })
  $('tab-diff').addEventListener('click', () => { if (model !== null) { mode = 'diff'; render() } })
  $('tab-file').addEventListener('click', () => { if (model !== null) { mode = 'file'; render() } })
  $('ask').addEventListener('click', () => {
    if (model === null || $('ask').disabled) return
    $('ask').disabled = true
    say('Waiting for your answer in the Windows message box...', false)
    window.review.apply().then((r) => { say(r.ok ? 'Done.' : r.error, !r.ok); return load().then(() => { if (!r.ok) say(r.error, true) }) }, () => { say('The app did not answer.', true) })
  })
  $('drop').addEventListener('click', () => {
    if (model === null) return
    if (!dropping) { dropping = true; $('drop').textContent = 'Click again to drop it'; return }
    window.review.drop().then(() => window.review.close())
  })
  $('close').addEventListener('click', () => { window.review.close() })
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') window.review.close() })
  window.review.onChanged(() => { load() })
  load()
})()
`

/** The whole page. `nonce` is made by main for this one window. */
export function reviewHtml(nonce: string): string {
  if (!NONCE_PATTERN.test(nonce)) throw new Error('A nonce of letters, digits, - and _ is needed.')
  const policy = [
    "default-src 'none'",
    `script-src 'nonce-${nonce}'`,
    `style-src 'nonce-${nonce}'`,
    "img-src 'none'",
    "connect-src 'none'",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'"
  ].join('; ')
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${policy}">
<title>Review a change</title>
<style nonce="${nonce}">${STYLE}</style>
</head>
<body>
<header id="head"></header>
<nav aria-label="What to look at"><button id="tab-diff" type="button" aria-pressed="true">The difference</button><button id="tab-file" type="button" aria-pressed="false">The file as it would be</button></nav>
<main id="view" tabindex="0" role="region" aria-label="The difference"></main>
<footer>
<span id="status" role="status"></span>
<button id="ask" type="button" disabled>Ask to apply...</button>
<button id="drop" type="button">Drop this change</button>
<button id="close" type="button">Close</button>
<span id="hint" class="meta"></span>
</footer>
<script nonce="${nonce}">${SCRIPT}</script>
</body>
</html>`
}
