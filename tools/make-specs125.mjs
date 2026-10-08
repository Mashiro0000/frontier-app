// Writes the negative-control specs for slice 12.5 (the Review window and the list of changes, D-042): one sabotage each, which a suite must notice.
// usage: node tools/make-specs125.mjs
//   then: node tools/check-specs.mjs                   (dry check)
//         node tools/nc-all.mjs specs125 <names...>    (verify-12-5.mjs, plain Node)
//         node tools/nc-all.mjs specs125w <names...>   (run125.mjs: the real window)
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { TOOLS } from './paths.mjs'

const R = '{{REPO}}/'
const RM = R + 'src/main/reviewModel.ts', RS = R + 'src/main/reviewService.ts', RP = R + 'src/main/reviewPage.ts', RW = R + 'src/main/reviewWindow.ts', PRE = R + 'src/preload/review.ts', IPC = R + 'src/main/ipc.ts'
const SEC = R + 'src/renderer/src/tools/ChangesSection.tsx', NOTE = R + 'src/shared/toolNotes.ts', CHG = R + 'src/shared/changes.ts'

const node = {
  // ----- making a text visible -----
  mBrackets: [RM, '    else if (char === OPEN || char === CLOSE || INVISIBLE.test(char)) {', '    else if (INVISIBLE.test(char)) {'],
  mInvisible: [RM, '    else if (char === OPEN || char === CLOSE || INVISIBLE.test(char)) {', '    else if (char === OPEN || char === CLOSE) {'],
  mTab: [RM, "    if (char === '\\t') out += char", '    if (false as boolean) out += char'],
  mHexCase: [RM, '.toString(16).toUpperCase().padStart(4, \'0\')', ".toString(16).padStart(4, '0')"],
  mHexPad: [RM, ".toString(16).toUpperCase().padStart(4, '0')", '.toString(16).toUpperCase()'],
  mSpaces: [RM, '|[^\\P{Zs} ]/u', '/u'],
  mFormat: [RM, 'const INVISIBLE = /[\\p{Cc}\\p{Cf}', 'const INVISIBLE = /[\\p{Cc}'],
  mSurrogate: [RM, '\\p{Cn}\\p{Cs}]', '\\p{Cn}]'],
  mSeparators: [RM, '\\p{Zl}\\p{Zp}', ''],
  mPrivate: [RM, '\\p{Co}', ''],
  mSummaryPath: [RM, '    path: visible(proposal.path),', '    path: proposal.path,'],
  mSummaryWhy: [RM, '    runsCommands: proposal.flags.runsCommands\n  }\n}', '    runsCommands: proposal.flags.runsCommands,\n    why: proposal.why\n  } as ChangeSummary\n}'],
  mWhyLine: [RM, '    why: oneLine(proposal.why),', '    why: proposal.why,'],
  mWhyVisible: [RM, "const oneLine = (text: string): string => visible(text.replace(/\\s+/g, ' ').trim())", "const oneLine = (text: string): string => text.replace(/\\s+/g, ' ').trim()"],
  mWhySpaces: [RM, "const oneLine = (text: string): string => visible(text.replace(/\\s+/g, ' ').trim())", 'const oneLine = (text: string): string => visible(text)'],
  mDiffVisible: [RM, '    lines: proposal.diff.lines.map((line) => ({ ...line, text: visible(line.text) }))', '    lines: proposal.diff.lines'],
  mAfterVisible: [RM, '    after: afterLines.slice(0, REVIEW_AFTER_LINES).map(visible),', '    after: afterLines.slice(0, REVIEW_AFTER_LINES),'],
  mAfterCut: [RM, '    after: afterLines.slice(0, REVIEW_AFTER_LINES).map(visible),', '    after: afterLines.map(visible),'],
  mAfterFlag: [RM, '    afterCut: afterLines.length > REVIEW_AFTER_LINES,', '    afterCut: false,'],
  mReal: [RM, '    reachedEnd\n  }\n}', '    reachedEnd,\n    real: proposal.real\n  } as ReviewModel\n}'],
  mBase: [RM, '    reachedEnd\n  }\n}', '    reachedEnd,\n    baseHash: proposal.baseHash\n  } as unknown as ReviewModel\n}'],
  mState: [RM, '    state,\n    diff,', "    state: 'ok' as const,\n    diff,"],
  mReached: [RM, '    afterCut: afterLines.length > REVIEW_AFTER_LINES,\n    reachedEnd', '    afterCut: afterLines.length > REVIEW_AFTER_LINES,\n    reachedEnd: false'],
  mNew: [RM, "  const diff = unifiedLines(name, proposal.kind === 'create' ? null : name, {", '  const diff = unifiedLines(name, name, {'],
  mFlags: [RM, '    secret: proposal.flags.secret,\n    runsCommands: proposal.flags.runsCommands,\n    state,', '    secret: false,\n    runsCommands: proposal.flags.runsCommands,\n    state,'],
  // ----- the service -----
  sGate: [RS, '      if (!reached.has(key(proposal))) return { ok: false, error: SCROLL_FIRST }\n', ''],
  sState: [RS, "      if (state !== 'ok') return { ok: false, error: WHY_NOT[state] }\n", ''],
  sNotThere: [RS, '      if (proposal === undefined) return { ok: false, error: NOT_THERE }\n      if (!reached', '      if (!reached'],
  sCatchApply: [RS, "      try {\n        const done = await options.requestApply(proposal, owner)\n        if (done.ok) {\n          // Applied: it no longer waits.\n          reached.delete(key(proposal))\n          store.remove(proposal.id)\n        }\n        return done\n      } catch {\n        return { ok: false, error: 'The change could not be applied.' }\n      }", '      return await options.requestApply(proposal, owner)'],
  sCatchState: [RS, "    } catch {\n      return 'unavailable'\n    }", '    } catch (error) {\n      throw error\n    }'],
  sReachedAll: [RS, '      reached.add(key(proposal))\n      return true', "      reached.add('*')\n      for (const other of store.list()) reached.add(key(other))\n      return true"],
  sRemoved: [RS, '          store.remove(proposal.id)\n', ''],
  sDrop: [RS, '      return store.remove(id)', '      return false'],
  sModelNull: [RS, '      if (proposal === undefined) return null\n      return reviewModelOf', '      if (proposal === undefined) throw new Error("none")\n      return reviewModelOf'],
  fExists: [RS, "      if (verdict.code === 'exists') return 'exists'\n", ''],
  fChanged: [RS, "    return proposal.baseHash !== null && sha256(bytes) === proposal.baseHash ? 'ok' : 'changed'", "    return 'ok'"],
  fGone: [RS, "      if (verdict.code === 'not-found') return proposal.kind === 'edit' ? 'gone' : 'unavailable'", "      if (verdict.code === 'not-found') return 'unavailable'"],
  fOp: [RS, "      op: proposal.kind === 'edit' ? 'edit' : 'create'", "      op: 'create'"],
  fPath: [RS, '      path: proposal.path,', "      path: '.',"],
  // ----- the page -----
  pCspDefault: [RP, '    "default-src \'none\'",', '    "default-src \'self\'",'],
  pCspScript: [RP, '    `script-src \'nonce-${nonce}\'`,', "    `script-src 'unsafe-inline'`,"],
  pCspStyle: [RP, '    `style-src \'nonce-${nonce}\'`,', "    `style-src 'unsafe-inline'`,"],
  pCspImg: [RP, '    "img-src \'none\'",\n', ''],
  pCspConnect: [RP, '    "connect-src \'none\'",\n', ''],
  pCspFrame: [RP, '    "frame-src \'none\'",\n', ''],
  pCspObject: [RP, '    "object-src \'none\'",\n', ''],
  pCspBase: [RP, '    "base-uri \'none\'",\n', ''],
  pCspForm: [RP, '    "form-action \'none\'"\n', '    "form-action *"\n'],
  pNonceCheck: [RP, "  if (!NONCE_PATTERN.test(nonce)) throw new Error('A nonce of letters, digits, - and _ is needed.')\n", ''],
  pNoncePattern: [RP, 'export const NONCE_PATTERN = /^[A-Za-z0-9_-]{16,64}$/', 'export const NONCE_PATTERN = /^[A-Za-z0-9_" -]{1,64}$/'],
  pScriptNonce: [RP, '<script nonce="${nonce}">${SCRIPT}</script>', '<script>${SCRIPT}</script>'],
  pStyleNonce: [RP, '<style nonce="${nonce}">${STYLE}</style>', '<style>${STYLE}</style>'],
  pInner: [RP, "    t.className = 'text'\n    put(t, text)", "    t.className = 'text'\n    t.innerHTML = text"],
  pTextNode: [RP, "      if (open === -1 || close === -1) { parent.appendChild(document.createTextNode(text.slice(at))); return }", "      if (open === -1 || close === -1) { parent.innerHTML += text.slice(at); return }"],
  pAskOff: [RP, '<button id="ask" type="button" disabled>Ask to apply...</button>', '<button id="ask" type="button">Ask to apply...</button>'],
  pStatusRole: [RP, '<span id="status" role="status"></span>', '<span id="status"></span>'],
  pImg: [RP, '<footer>', '<img src="https://example.com/x.png"><footer>'],
  pLink: [RP, '<header id="head"></header>', '<header id="head"><a href="https://example.com">x</a></header>'],
  pEval: [RP, "  $('close').addEventListener('click', () => { window.review.close() })", "  $('close').addEventListener('click', () => { eval('window.review.close()') })"],
  pFetch: [RP, '  load()\n})()', "  fetch('https://example.com/x')\n  load()\n})()"],
  // ----- the window and who it answers -----
  wSender: [RW, '    event.sender === reviewContents &&\n', ''],
  wFrame: [RW, '    frame === event.sender.mainFrame &&\n', ''],
  wData: [RW, "    frame.url.startsWith('data:text/html')", '    true'],
  wSandbox: [RW, '        sandbox: true,', '        sandbox: false,'],
  wIsolation: [RW, '        contextIsolation: true,', '        contextIsolation: false,'],
  wNode: [RW, '        nodeIntegration: false,', '        nodeIntegration: true,'],
  wSecurity: [RW, '        webSecurity: true,', '        webSecurity: false,'],
  wInsecure: [RW, '        allowRunningInsecureContent: false,', '        allowRunningInsecureContent: true,'],
  wSpell: [RW, '        spellcheck: false,', '        spellcheck: true,'],
  wDevTools: [RW, '        devTools: !app.isPackaged', '        devTools: true'],
  wPersist: [RW, "const PARTITION = 'frontier-review'", "const PARTITION = 'persist:frontier-review'"],
  wPermission: [RW, '    ses.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))', '    ses.setPermissionRequestHandler((_contents, _permission, callback) => callback(true))'],
  wPermissionCheck: [RW, '    ses.setPermissionCheckHandler(() => false)', '    ses.setPermissionCheckHandler(() => true)'],
  wRequests: [RW, "      callback({ cancel: !details.url.startsWith('data:') && !details.url.startsWith('devtools:') })", '      callback({ cancel: false })'],
  wOpen: [RW, "    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))", "    window.webContents.setWindowOpenHandler(() => ({ action: 'allow' }))"],
  wNavigate: [RW, "    window.webContents.on('will-navigate', (event) => event.preventDefault())\n", ''],
  wRedirect: [RW, "    window.webContents.on('will-redirect', (event) => event.preventDefault())\n", ''],
  wWebview: [RW, "    window.webContents.on('will-attach-webview', (event) => event.preventDefault())\n", ''],
  wNonce: [RW, "    const nonce = randomBytes(18).toString('base64url')", "    const nonce = 'aaaaaaaaaaaaaaaaaaaaaaaa'"],
  wOnlyGet: [RW, '    REVIEW_CHANNELS.get,\n    only(', '    REVIEW_CHANNELS.get,\n    ('],
  wOnlyApply: [RW, '    REVIEW_CHANNELS.apply,\n    only(', '    REVIEW_CHANNELS.apply,\n    ('],
  wOnlyDrop: [RW, '    REVIEW_CHANNELS.drop,\n    only(', '    REVIEW_CHANNELS.drop,\n    ('],
  wThrow: [RW, "        throw new Error('Blocked: this call did not come from the Review window.')", "        void 0"],
  // ----- the preloads, the wiring and the page -----
  rBridge: [PRE, '  reachedEnd: (): Promise<boolean> => ipcRenderer.invoke(REVIEW_CHANNELS.reachedEnd),\n', ''],
  rExtra: [PRE, '  close: (): Promise<void> => ipcRenderer.invoke(REVIEW_CHANNELS.close),', "  close: (): Promise<void> => ipcRenderer.invoke(REVIEW_CHANNELS.close),\n  raw: (channel: string, ...args: unknown[]): Promise<unknown> => ipcRenderer.invoke(channel, ...args),"],
  iReview: [IPC, '    CHANNELS.changesReview,\n    guardedForWindow(', '    CHANNELS.changesReview,\n    guarded('],
  iList: [IPC, '    CHANNELS.changesList,\n    guarded(', '    CHANNELS.changesList,\n    ('],
  iReviewHandler: [IPC, '  const reviewWindows = createReviewWindows({ service: changes })', "  const reviewWindows = createReviewWindows({ service: changes })\n  ipcMain.handle('review:get', async () => changes.model('p1'))"],
  cHref: [SEC, '    <section className="tools-section" aria-labelledby="tools-changes-title">', '    <section className="tools-section" aria-labelledby="tools-changes-title">\n      <a href="https://example.com">x</a>'],
  cApply: [SEC, '                Review...\n', '                Review...{void window.api.changes.review}\n'],
}

const win = {
  wPageAtEnd: [RP, '    const atEnd = view.scrollTop + view.clientHeight >= view.scrollHeight - 2', '    const atEnd = true'],
  wPageMarks: [RP, "      mark.className = 'mark'", "      mark.className = 'plain'"],
  wPageEscape: [RP, "  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') window.review.close() })", ''],
  wPageDrop: [RP, '    if (!dropping) { dropping = true;', '    if (false) { dropping = true;'],
  wPageGate: [RP, "    ask.disabled = !(model.reachedEnd && model.state === 'ok')", "    ask.disabled = !(model.state === 'ok')"],
  wPageReach: [RP, "      window.review.reachedEnd().then(() => { model.reachedEnd = true; sync() })", "      model.reachedEnd = true; sync()"],
  wWinParent: [RW, '      ...(owner !== null && !owner.isDestroyed() ? { parent: owner } : {}),', ''],
  wWinReuse: [RW, '      if (win !== null && !win.isDestroyed()) {\n        win.webContents.send(REVIEW_CHANNELS.changed)', '      if (false as boolean) {\n        win.webContents.send(REVIEW_CHANNELS.changed)'],
  wWinCurrent: [RW, '      current = id\n      if (win !== null', '      if (win !== null'],
  wWinSession: [RW, '        partition: PARTITION,\n', ''],
  wWinNav: [RW, "    window.webContents.on('will-navigate', (event) => event.preventDefault())\n", ''],
  wWinRequests: [RW, "      callback({ cancel: !details.url.startsWith('data:') && !details.url.startsWith('devtools:') })", '      callback({ cancel: false })'],
  wWinSandbox: [RW, '        sandbox: true,', '        sandbox: false,'],
  wListRow: [SEC, "              <button\n                type=\"button\"\n                className=\"history-button\"\n                disabled={busy}\n                onClick={() => void review(change.id)}", "              <button\n                type=\"button\"\n                className=\"history-button\"\n                disabled={true}\n                onClick={() => void review(change.id)}"],
  wNotePropose: [NOTE, "      if (tool === 'propose_edit' || tool === 'propose_new_file') {", '      if (false as boolean) {'],
  wNoteOrder: [NOTE, "      if (tool === 'propose_edit' || tool === 'propose_new_file') {\n        return outcome.covered === true", "      if (outcome.covered === true) {\n        return `Allowed for this reply. ${plural(outcome.size, 'character came', 'characters came')} back.`\n      }\n      if (tool === 'propose_edit' || tool === 'propose_new_file') {\n        return outcome.covered === true"]
}

const write = (dir, specs, argv, env, timeoutMs, prefix) => {
  mkdirSync(join(TOOLS, dir), { recursive: true })
  for (const [name, edit] of Object.entries(specs)) {
    const [file, from, to] = edit
    writeFileSync(join(TOOLS, dir, `${prefix}${name}.json`), JSON.stringify({ label: `${prefix}${name}`, edits: [{ file, from, to }], argv, env, ...(timeoutMs ? { timeoutMs } : {}) }, null, 2) + '\n')
  }
}
write('specs125', node, ['{{TOOLS}}/verify-12-5.mjs'], {}, 280000, 'n125-')
write('specs125w', win, ['{{TOOLS}}/run125.mjs', 'dev'], { NO_RETRY: '1' }, 600000, 'w125-')
console.log(`wrote ${Object.keys(node).length} specs in specs125 and ${Object.keys(win).length} in specs125w`)
